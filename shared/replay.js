// shared/replay.js — Server-side Bar Replay & Backtest Fill Engine (Task 18).
// Pure ES module compatible with Node 22+ and Cloudflare Workers (zero DOM, zero Node-only APIs).
// Exact mathematical parity with btOpenPnl, btSeek, posCalc, posState, and institutional
// stop-before-target tie-breaking + gap-open fill rules. Zero synthetic market bars.

export const MAX_REPLAY_BARS = 50000;
export const MAX_OPEN_POSITIONS = 200;
export const MAX_PENDING_ORDERS = 200;
export const MAX_TRADES = 10000;

function roundFee(v) {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Number(v.toFixed(6));
}

function toEpochMs(t) {
  return t >= 1e12 ? t : t * 1000;
}

function formatUtcDate(t) {
  const d = new Date(toEpochMs(t));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function formatUtcIsoMinute(t) {
  const d = new Date(toEpochMs(t));
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 16);
}

/**
 * Normalizes a bar from either object `{ t, o, h, l, c, v? }` or tuple `[t, o, h, l, c, v?]`.
 * Returns `null` for malformed bars; never synthesizes data.
 * @param {object|Array} raw
 * @returns {{ t: number, o: number, h: number, l: number, c: number, v: number } | null}
 */
export function normalizeReplayBar(raw) {
  let t, o, h, l, c, v;
  if (Array.isArray(raw)) {
    if (raw.length < 5) return null;
    [t, o, h, l, c, v = 0] = raw;
  } else if (raw && typeof raw === "object") {
    t = raw.t ?? raw.time;
    o = raw.o ?? raw.open;
    h = raw.h ?? raw.high;
    l = raw.l ?? raw.low;
    c = raw.c ?? raw.close;
    v = raw.v ?? raw.volume ?? 0;
  } else {
    return null;
  }

  t = Number(t);
  o = Number(o);
  h = Number(h);
  l = Number(l);
  c = Number(c);
  v = Number(v);

  if (
    !Number.isFinite(t) || t <= 0 ||
    !Number.isFinite(o) || o <= 0 ||
    !Number.isFinite(h) || h <= 0 ||
    !Number.isFinite(l) || l <= 0 ||
    !Number.isFinite(c) || c <= 0
  ) {
    return null;
  }
  if (!Number.isFinite(v) || v < 0) v = 0;

  // Preserve exact OHLC while ensuring valid high/low ordering.
  if (h < Math.max(o, c) || l > Math.min(o, c)) {
    return null;
  }
  return { t, o, h, l, c, v };
}

/**
 * Live unrealized P&L for an open position at price `px`, net of entry and estimated exit fees.
 * Exact parity with index.html / src/54_backtest.js `btOpenPnl`, hardened against non-finite inputs.
 *
 * @param {{ side: "long"|"short", entry: number, qty: number, feeIn?: number } | null} pos
 * @param {number} px
 * @param {number} [feePct=0]
 * @returns {number}
 */
export function btOpenPnl(pos, px, feePct = 0) {
  if (!pos || typeof pos !== "object") return 0;
  if (!Number.isFinite(px) || px <= 0) return 0;
  const entry = Number(pos.entry);
  const qty = Number(pos.qty);
  if (!Number.isFinite(entry) || entry <= 0) return 0;
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  const fee = Number.isFinite(feePct) && feePct >= 0 ? feePct : 0;
  const d = pos.side === "long" ? 1 : -1;
  const gross = d * (px - entry) * qty;
  const exitFee = px * qty * (fee / 100);
  const feeIn = Number.isFinite(pos.feeIn) && pos.feeIn >= 0 ? pos.feeIn : 0;
  return gross - feeIn - exitFee;
}

/**
 * Long/short position risk-reward and quantity calculator.
 * Exact parity with index.html `<POS> posCalc` for `pv === 1` (used by `posCalcD`), while fixing
 * the futures leverage cap formula to divide notional by `E * pv * lot` for `pv > 1` and hardening
 * against `null`/negative/non-finite inputs and unbounded `prec`.
 *
 * @param {{
 *   side?: "long"|"short",
 *   entry: number,
 *   tp: number,
 *   sl: number,
 *   acct?: number,
 *   risk?: number,
 *   ru?: "%"|"$",
 *   lot?: number,
 *   pv?: number,
 *   lev?: number,
 *   tick?: number,
 *   prec?: number,
 * } | null | undefined} o
 */
export function posCalc(o) {
  if (!o || typeof o !== "object") {
    return {
      riskAmt: 0,
      qty: 0,
      rr: 0,
      tpOff: 0,
      tpPct: 0,
      tpTicks: 0,
      slOff: 0,
      slPct: 0,
      slTicks: 0,
      pnlTP: 0,
      pnlSL: 0,
      amtTP: 0,
      amtSL: 0,
      pnlAt: () => 0,
    };
  }
  const L = o.side !== "short";
  const E = Number.isFinite(+o.entry) && +o.entry > 0 ? +o.entry : 0;
  const T = Number.isFinite(+o.tp) && +o.tp > 0 ? +o.tp : E;
  const Sx = Number.isFinite(+o.sl) && +o.sl > 0 ? +o.sl : E;
  const acct = Number.isFinite(+o.acct) && +o.acct > 0 ? +o.acct : 0;
  const risk = Number.isFinite(+o.risk) && +o.risk > 0 ? +o.risk : 0;
  const lot = Number.isFinite(+o.lot) && +o.lot > 0 ? +o.lot : 1;
  const pv = Number.isFinite(+o.pv) && +o.pv > 0 ? +o.pv : 1;
  const lev = Number.isFinite(+o.lev) && +o.lev > 0 ? +o.lev : 0;
  const tick = Number.isFinite(+o.tick) && +o.tick > 0 ? +o.tick : 0.01;
  const rawPrec = o.prec == null ? 2 : +o.prec;
  const prec = Number.isFinite(rawPrec) ? Math.max(0, Math.min(8, Math.trunc(rawPrec))) : 2;
  const riskAmt = o.ru === "$" ? risk : (acct * risk) / 100;
  const dist = L ? E - Sx : Sx - E;
  const gain = L ? T - E : E - T;
  let qty = dist > 0 ? riskAmt / (dist * pv) / lot : 0;
  if (lev > 0 && E > 0) qty = Math.min(qty, (acct * lev) / (E * pv * lot));
  const f = Math.pow(10, prec);
  qty = Math.floor(qty * f + 1e-9) / f;
  const per = pv * lot * qty;
  return {
    riskAmt,
    qty,
    rr: dist > 0 ? gain / dist : 0,
    tpOff: Math.abs(T - E),
    tpPct: E ? (Math.abs(T - E) / E) * 100 : 0,
    tpTicks: Math.round(Math.abs(T - E) / tick),
    slOff: Math.abs(E - Sx),
    slPct: E ? (Math.abs(E - Sx) / E) * 100 : 0,
    slTicks: Math.round(Math.abs(E - Sx) / tick),
    pnlTP: gain * per,
    pnlSL: -dist * per,
    amtTP: acct + gain * per,
    amtSL: acct - dist * per,
    pnlAt: (px) => (Number.isFinite(+px) ? (L ? +px - E : E - +px) * per : 0),
  };
}

/**
 * Evaluates a position tool over historical bars within `(t0, t1]`.
 * Entry fills at the close of bar `t0`, so only later bars (`b.t > t0`) are checked.
 * Stop-before-target rule applies when a single bar touches both SL and TP.
 * Null/undefined/non-finite `T` or `Sx` levels are ignored (never coerced to `0`).
 *
 * @param {Array<object|Array>} bars
 * @param {"long"|"short"} side
 * @param {number} E
 * @param {number|null|undefined} T
 * @param {number|null|undefined} Sx
 * @param {number} t0
 * @param {number} t1
 * @returns {{ state: "sl"|"tp"|"open"|"none", t?: number, px?: number }}
 */
export function posState(bars, side, E, T, Sx, t0, t1) {
  const L = side !== "short";
  const hasT = T != null && T !== "" && Number.isFinite(Number(T));
  const hasS = Sx != null && Sx !== "" && Number.isFinite(Number(Sx));
  const numT = hasT ? Number(T) : NaN;
  const numS = hasS ? Number(Sx) : NaN;
  let last = null;
  let n = 0;
  if (!Array.isArray(bars) || !Number.isFinite(t0) || !Number.isFinite(t1)) return { state: "none" };
  for (const raw of bars) {
    const b = normalizeReplayBar(raw);
    if (!b) continue;
    if (b.t <= t0) continue;
    if (b.t > t1) break;
    n++;
    last = b;
    const hitS = hasS && (L ? b.l <= numS : b.h >= numS);
    const hitT = hasT && (L ? b.h >= numT : b.l <= numT);
    if (hitS) return { state: "sl", t: b.t, px: numS };
    if (hitT) return { state: "tp", t: b.t, px: numT };
  }
  return n ? { state: "open", t: last.t, px: last.c } : { state: "none" };
}

/**
 * 14-period Average True Range at 1-based bar count `barCount` (`1..bars.length`).
 * Exact parity with src/54_backtest.js `btAtrAt`.
 *
 * @param {Array<{ o: number, h: number, l: number, c: number }>} bars
 * @param {number} barCount
 * @returns {number}
 */
export function calcAtrAt(bars, barCount) {
  if (!Array.isArray(bars) || bars.length === 0) return 0;
  if (!Number.isInteger(barCount) || barCount <= 0) return 0;
  const end = Math.min(bars.length, barCount);
  const start = Math.max(1, end - 14);
  let sum = 0;
  let cnt = 0;
  for (let k = start; k < end; k++) {
    const b = bars[k];
    const p = bars[k - 1];
    if (!b || !p) continue;
    if (!Number.isFinite(b.h) || !Number.isFinite(b.l) || !Number.isFinite(p.c)) continue;
    const tr = Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
    if (!Number.isFinite(tr) || tr < 0) continue;
    sum += tr;
    cnt++;
  }
  if (cnt > 0) return sum / cnt;
  const last = bars[end - 1];
  if (!last || typeof last !== "object") return 0;
  const range = Number.isFinite(last.h) && Number.isFinite(last.l) ? last.h - last.l : 0;
  if (range > 0) return range;
  return Number.isFinite(last.c) && last.c > 0 ? last.c * 0.01 : 0;
}

/**
 * Risk-based position quantity sizing matching src/54_backtest.js `btCalcQty`.
 * Returns `0` on non-finite inputs or non-positive `balance`/`riskPct`/`entry`.
 *
 * @param {{ balance: number, riskPct: number, entry: number, sl?: number|null, atr?: number }} [params]
 * @returns {number}
 */
export function calcRiskQty({ balance, riskPct, entry, sl = null, atr = 0 } = {}) {
  if (!Number.isFinite(balance) || balance <= 0) return 0;
  if (!Number.isFinite(riskPct) || riskPct <= 0) return 0;
  if (!Number.isFinite(entry) || entry <= 0) return 0;
  if (sl != null && (!Number.isFinite(sl) || sl <= 0)) return 0;
  const safeAtr = Number.isFinite(atr) && atr > 0 ? atr : 0;
  const riskAmt = Math.max(1, balance * (riskPct / 100));
  const stopDist = sl != null ? Math.abs(entry - sl) : (safeAtr || entry * 0.01);
  const safeDist = Math.max(stopDist, entry * 0.0005, 1e-8);
  const raw = riskAmt / safeDist;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw >= 100 ? Number(raw.toFixed(2)) : raw >= 1 ? Number(raw.toFixed(3)) : Number(raw.toFixed(5));
}

function validateSide(side) {
  const s = String(side ?? "").trim().toLowerCase();
  if (s === "long" || s === "buy" || s === "l") return "long";
  if (s === "short" || s === "sell" || s === "s") return "short";
  throw new Error(`Invalid order side: ${String(side)} (expected "long" or "short")`);
}

function validateOrderType(type) {
  const t = String(type ?? "market").trim().toLowerCase();
  if (t === "market" || t === "limit" || t === "stop") return t;
  throw new Error(`Invalid order type: ${String(type)} (expected "market", "limit", or "stop")`);
}

function validateStops(side, refPrice, sl, tp, refLabel = "entry") {
  if (sl != null) {
    if (!Number.isFinite(sl) || sl <= 0) throw new Error("Stop Loss must be a positive finite number");
    if (side === "long" && sl >= refPrice) {
      throw new Error(`Long Stop Loss (${sl}) must be below ${refLabel} (${refPrice})`);
    }
    if (side === "short" && sl <= refPrice) {
      throw new Error(`Short Stop Loss (${sl}) must be above ${refLabel} (${refPrice})`);
    }
  }
  if (tp != null) {
    if (!Number.isFinite(tp) || tp <= 0) throw new Error("Take Profit must be a positive finite number");
    if (side === "long" && tp <= refPrice) {
      throw new Error(`Long Take Profit (${tp}) must be above ${refLabel} (${refPrice})`);
    }
    if (side === "short" && tp >= refPrice) {
      throw new Error(`Short Take Profit (${tp}) must be below ${refLabel} (${refPrice})`);
    }
  }
}

/**
 * Evaluates SL and TP exit conditions on bar `b` for an open position `p`.
 * Enforces the institutional stop-before-target tie-break rule and optional gap-open fill pricing.
 *
 * @param {{ side: "long"|"short", sl: number|null, tp: number|null }} p
 * @param {{ o: number, h: number, l: number, c: number }} b
 * @param {{ allowGapOpenExit?: boolean }} [opts]
 * @returns {{ why: "stop"|"target", fillPx: number } | null}
 */
function evaluateBarExit(p, b, { allowGapOpenExit = true } = {}) {
  const d = p.side === "long" ? 1 : -1;

  // Stop Loss checked FIRST — exact stop-before-target rule on a tie.
  if (p.sl != null && (d > 0 ? b.l <= p.sl : b.h >= p.sl)) {
    const fillPx = allowGapOpenExit
      ? (d > 0 ? (b.o < p.sl ? b.o : p.sl) : (b.o > p.sl ? b.o : p.sl))
      : p.sl;
    return { why: "stop", fillPx };
  }
  if (p.tp != null && (d > 0 ? b.h >= p.tp : b.l <= p.tp)) {
    const fillPx = allowGapOpenExit
      ? (d > 0 ? (b.o > p.tp ? b.o : p.tp) : (b.o < p.tp ? b.o : p.tp))
      : p.tp;
    return { why: "target", fillPx };
  }
  return null;
}

/**
 * Evaluates whether a pending limit or stop order triggers on bar `b`.
 * Applies gap-through fill pricing when the bar opens past the trigger level.
 *
 * @param {{ side: "long"|"short", type: "limit"|"stop", entry: number }} ord
 * @param {{ o: number, h: number, l: number, c: number }} b
 * @returns {{ fillPx: number, gapped: boolean } | null}
 */
function evaluatePendingTrigger(ord, b) {
  const isLong = ord.side === "long";
  if (ord.type === "limit") {
    if (isLong && b.l <= ord.entry) {
      const gapped = b.o < ord.entry;
      return { fillPx: gapped ? b.o : ord.entry, gapped };
    }
    if (!isLong && b.h >= ord.entry) {
      const gapped = b.o > ord.entry;
      return { fillPx: gapped ? b.o : ord.entry, gapped };
    }
    return null;
  }
  if (ord.type === "stop") {
    if (isLong && b.h >= ord.entry) {
      const gapped = b.o > ord.entry;
      return { fillPx: gapped ? b.o : ord.entry, gapped };
    }
    if (!isLong && b.l <= ord.entry) {
      const gapped = b.o < ord.entry;
      return { fillPx: gapped ? b.o : ord.entry, gapped };
    }
    return null;
  }
  return null;
}

/**
 * Creates a deterministic, server-side bar replay & backtest fill session.
 *
 * @param {{
 *   symbol?: string,
 *   tf?: string,
 *   bars: Array<object|Array>,
 *   startIndex?: number,
 *   balance?: number,
 *   riskPct?: number,
 *   feePct?: number,
 * }} opts
 */
export function createReplaySession(opts = {}) {
  if (Array.isArray(opts.bars) && opts.bars.length > MAX_REPLAY_BARS) {
    throw new Error(`Replay bars (${opts.bars.length}) exceed MAX_REPLAY_BARS (${MAX_REPLAY_BARS})`);
  }

  const symbol = String(opts.symbol ?? "").trim().toUpperCase();
  const tf = String(opts.tf ?? "1H").trim();
  const startBalance = Number.isFinite(+opts.balance) && +opts.balance > 0 ? +opts.balance : 10000;
  const defaultRiskPct = Number.isFinite(+opts.riskPct) && +opts.riskPct > 0 ? +opts.riskPct : 1;
  const feePct = Number.isFinite(+opts.feePct) && +opts.feePct >= 0 ? +opts.feePct : 0.05;

  // Normalize, deduplicate by timestamp, and sort ascending.
  const barMap = new Map();
  if (Array.isArray(opts.bars)) {
    for (const raw of opts.bars) {
      const b = normalizeReplayBar(raw);
      if (b) barMap.set(b.t, b);
    }
  }
  const bars = [...barMap.values()].sort((a, b) => a.t - b.t);
  const totalBars = bars.length;

  function clampIndex(idx) {
    if (totalBars === 0) return -1;
    const raw = Number.isFinite(idx) ? Math.round(idx) : Math.floor(totalBars * 0.5);
    return Math.max(0, Math.min(totalBars - 1, raw));
  }

  let initialStartIndex = clampIndex(opts.startIndex);
  let currentIndex = initialStartIndex;

  let nextId = 1;
  let realizedBalance = startBalance;
  /** @type {Array<object>} */
  let openPositions = [];
  /** @type {Array<object>} */
  let pendingOrders = [];
  /** @type {Array<object>} */
  let triggeredHistory = []; // supports clean rewind on seek backward
  /** @type {Array<object>} */
  let trades = [];

  function getCurrentBar() {
    return currentIndex >= 0 && currentIndex < totalBars ? { ...bars[currentIndex] } : null;
  }

  function computeOpenPnlAt(bar) {
    if (!bar || openPositions.length === 0) return 0;
    let sum = 0;
    for (const pos of openPositions) {
      sum += btOpenPnl(pos, bar.c, feePct);
    }
    return sum;
  }

  function getLiveOpenPnl(bar = currentIndex >= 0 ? bars[currentIndex] : null) {
    return computeOpenPnlAt(bar);
  }

  function getLiveEquity(bar = currentIndex >= 0 ? bars[currentIndex] : null) {
    return realizedBalance + computeOpenPnlAt(bar);
  }

  function computeStats() {
    const n = trades.length;
    let wins = 0;
    let losses = 0;
    let breakevens = 0;
    let grossWin = 0;
    let grossLoss = 0;
    let netPnl = 0;
    let totalFees = 0;
    let sumR = 0;
    let nR = 0;

    let eq = startBalance;
    let peak = startBalance;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;

    const equityCurve = [];
    if (totalBars > 0 && initialStartIndex >= 0) {
      equityCurve.push({
        tradeId: null,
        index: initialStartIndex,
        barTime: bars[initialStartIndex].t,
        pnl: 0,
        realizedPnl: 0,
        equity: startBalance,
        drawdown: 0,
      });
    } else {
      equityCurve.push({
        tradeId: null,
        index: -1,
        barTime: null,
        pnl: 0,
        realizedPnl: 0,
        equity: startBalance,
        drawdown: 0,
      });
    }

    for (const t of trades) {
      const p = t.pnl;
      netPnl += p;
      totalFees += t.fees;
      eq += p;
      if (eq > peak) peak = eq;
      const dd = peak - eq;
      if (dd > maxDrawdown) maxDrawdown = dd;
      if (peak > 0 && dd / peak > maxDrawdownPct) maxDrawdownPct = dd / peak;

      if (p > 0) {
        wins++;
        grossWin += p;
      } else if (p < 0) {
        losses++;
        grossLoss += -p;
      } else {
        breakevens++;
      }
      if (t.rMultiple != null && Number.isFinite(t.rMultiple)) {
        sumR += t.rMultiple;
        nR++;
      }

      equityCurve.push({
        tradeId: t.id,
        index: t.i1,
        barTime: bars[t.i1] ? bars[t.i1].t : null,
        pnl: p,
        realizedPnl: netPnl,
        equity: eq,
        drawdown: dd,
      });
    }

    const curBar = currentIndex >= 0 ? bars[currentIndex] : null;
    const openPnl = computeOpenPnlAt(curBar);
    const equity = startBalance + netPnl + openPnl;

    // JSON-serializable profitFactor: `null` represents zero-loss winning sessions (avoiding Infinity -> null drift).
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : 0);

    return {
      totalTrades: n,
      n,
      wins,
      losses,
      breakevens,
      winRate: n > 0 ? wins / n : 0,
      grossWin,
      grossLoss,
      profitFactor,
      maxDrawdown,
      maxDrawdownPct,
      netPnl,
      realizedPnl: netPnl,
      openPnl,
      expectancy: n > 0 ? netPnl / n : 0,
      avgWin: wins > 0 ? grossWin / wins : 0,
      avgLoss: losses > 0 ? -grossLoss / losses : 0,
      avgR: nR > 0 ? sumR / nR : null,
      totalFees: roundFee(totalFees),
      balance: startBalance,
      equity,
      returnPct: startBalance > 0 ? (equity - startBalance) / startBalance : 0,
      equityCurve,
      trades: trades.map((t) => ({ ...t })),
    };
  }

  function closePositionInternal(pos, exitIdx, exitBar, exitPx, why) {
    const d = pos.side === "long" ? 1 : -1;
    const feeIn = roundFee(pos.feeIn);
    const feeOut = roundFee(exitPx * pos.qty * (feePct / 100));
    const fees = roundFee(feeIn + feeOut);
    const grossPnl = d * (exitPx - pos.entry) * pos.qty;
    const pnl = grossPnl - fees;
    const initialStop = pos.sl0 != null ? pos.sl0 : pos.sl;
    const riskDollars =
      initialStop != null && initialStop !== pos.entry
        ? Math.abs(pos.entry - initialStop) * pos.qty
        : null;
    const rMultiple = riskDollars && riskDollars > 0 ? pnl / riskDollars : null;

    const trade = {
      id: pos.id,
      sym: symbol,
      side: pos.side,
      entry: pos.entry,
      exit: exitPx,
      qty: pos.qty,
      stop: initialStop != null ? initialStop : null,
      tgt: pos.tp != null ? pos.tp : null,
      slCur: pos.sl != null ? pos.sl : null,
      feeIn,
      feeOut,
      fees,
      grossPnl,
      pnl,
      rMultiple,
      open: pos.openTime,
      close: formatUtcIsoMinute(exitBar.t),
      why,
      i0: pos.openIdx,
      i1: exitIdx,
    };

    trades.push(trade);
    realizedBalance += pnl;
    openPositions = openPositions.filter((item) => item.id !== pos.id);
    return trade;
  }

  function getWindow() {
    return {
      symbol,
      tf,
      totalBars,
      replayableBars: totalBars > 0 ? Math.max(0, totalBars - 1 - initialStartIndex) : 0,
      remainingBars: totalBars > 0 ? Math.max(0, totalBars - 1 - currentIndex) : 0,
      startIndex: initialStartIndex,
      fromDate: totalBars > 0 ? formatUtcDate(bars[0].t) : null,
      toDate: totalBars > 0 ? formatUtcDate(bars[totalBars - 1].t) : null,
      currentIndex,
      currentBar: getCurrentBar(),
    };
  }

  function seek(targetRaw) {
    if (totalBars === 0) {
      const stats = computeStats();
      return {
        previousIndex: -1,
        currentIndex: -1,
        currentBar: null,
        steppedBars: [],
        fills: [],
        triggeredOrders: [],
        openPnl: 0,
        equity: startBalance,
        window: getWindow(),
        stats,
      };
    }

    const previousIndex = currentIndex;
    // Prevent seeking before initialStartIndex so remainingBars <= replayableBars and equityCurve stays monotonic.
    const target = Math.max(initialStartIndex, clampIndex(targetRaw));
    const steppedBars = [];
    const fills = [];
    const triggeredOrders = [];

    if (target > previousIndex) {
      for (let k = previousIndex + 1; k <= target; k++) {
        const b = bars[k];
        steppedBars.push({ ...b });

        // 1. Evaluate existing open positions (entered on earlier bars) — stop before target on a tie.
        const snapshotOpen = openPositions.slice();
        for (const pos of snapshotOpen) {
          if (pos.openIdx >= k) continue;
          const hit = evaluateBarExit(pos, b, { allowGapOpenExit: true });
          if (hit) {
            const trade = closePositionInternal(pos, k, b, hit.fillPx, hit.why);
            fills.push(trade);
          }
        }

        // 2. Evaluate pending limit/stop orders placed on earlier bars.
        const stillPending = [];
        for (const ord of pendingOrders) {
          if (ord.placedIdx >= k) {
            stillPending.push(ord);
            continue;
          }
          if (openPositions.length >= MAX_OPEN_POSITIONS || trades.length + openPositions.length >= MAX_TRADES) {
            stillPending.push(ord);
            continue;
          }
          const trig = evaluatePendingTrigger(ord, b);
          if (!trig) {
            stillPending.push(ord);
            continue;
          }

          const fillPx = trig.fillPx;
          // Resolve qty at trigger time if not explicitly fixed at placement (O(openPositions), no trades.reduce).
          let qty = ord.qty;
          if (!(qty > 0)) {
            const liveEq = getLiveEquity(b);
            const atr = calcAtrAt(bars, k + 1);
            qty = calcRiskQty({
              balance: liveEq,
              riskPct: ord.riskPct,
              entry: fillPx,
              sl: ord.sl,
              atr,
            });
            if (!(qty > 0)) {
              stillPending.push(ord);
              continue;
            }
          }
          const feeIn = roundFee(fillPx * qty * (feePct / 100));
          const pos = {
            id: ord.id,
            side: ord.side,
            entry: fillPx,
            qty,
            sl: ord.sl,
            sl0: ord.sl,
            tp: ord.tp,
            feeIn,
            openIdx: k,
            openTime: formatUtcIsoMinute(b.t),
          };
          openPositions.push(pos);
          triggeredOrders.push({ orderId: ord.id, position: { ...pos }, triggerBarIdx: k });
          triggeredHistory.push({ order: { ...ord }, triggerIdx: k });

          const d = pos.side === "long" ? 1 : -1;
          let sameBarHit = null;
          // Guard against inverted SL when a limit/stop order gaps at or past SL: stop out immediately at gap fillPx.
          if (pos.sl != null && (d > 0 ? fillPx <= pos.sl : fillPx >= pos.sl)) {
            sameBarHit = { why: "stop", fillPx };
          } else if (pos.tp != null && (d > 0 ? fillPx >= pos.tp : fillPx <= pos.tp)) {
            // Gap-through past TP: check SL on trigger bar first (intraday), else exit at gap fillPx.
            const slHit = evaluateBarExit({ side: pos.side, sl: pos.sl, tp: null }, b, { allowGapOpenExit: false });
            sameBarHit = slHit || { why: "target", fillPx };
          } else {
            // Same-bar check after trigger: never fill exit at pre-trigger bar open `b.o`.
            sameBarHit = evaluateBarExit(pos, b, { allowGapOpenExit: false });
          }

          if (sameBarHit) {
            const trade = closePositionInternal(pos, k, b, sameBarHit.fillPx, sameBarHit.why);
            fills.push(trade);
          }
        }
        pendingOrders = stillPending;
      }
    } else if (target < previousIndex) {
      // Rewind state cleanly to `target`.
      pendingOrders = pendingOrders.filter((ord) => ord.placedIdx <= target);

      // Restore pending orders that had triggered after `target` (if placed at or before `target`).
      const remainingTriggered = [];
      for (const rec of triggeredHistory) {
        if (rec.triggerIdx > target) {
          if (rec.order.placedIdx <= target) {
            pendingOrders.push({ ...rec.order });
          }
        } else {
          remainingTriggered.push(rec);
        }
      }
      triggeredHistory = remainingTriggered;

      openPositions = openPositions.filter((pos) => pos.openIdx <= target);

      const keptTrades = [];
      let keptRealizedPnl = 0;
      for (const t of trades) {
        if (t.i0 > target) continue;
        if (t.i1 <= target) {
          keptTrades.push(t);
          keptRealizedPnl += t.pnl;
          continue;
        }
        // Trade was opened at/before target and closed after target -> reopen position.
        const feeIn = roundFee(t.entry * t.qty * (feePct / 100));
        openPositions.push({
          id: t.id,
          side: t.side,
          entry: t.entry,
          qty: t.qty,
          sl: t.slCur != null ? t.slCur : t.stop,
          sl0: t.stop,
          tp: t.tgt,
          feeIn,
          openIdx: t.i0,
          openTime: t.open,
        });
      }
      trades = keptTrades;
      realizedBalance = startBalance + keptRealizedPnl;
    }

    currentIndex = target;
    const stats = computeStats();
    return {
      previousIndex,
      currentIndex,
      currentBar: getCurrentBar(),
      steppedBars,
      fills,
      triggeredOrders,
      openPnl: stats.openPnl,
      equity: stats.equity,
      window: getWindow(),
      stats,
    };
  }

  function step(n = 1) {
    const delta = Number.isFinite(n) ? Math.trunc(n) : 1;
    return seek(currentIndex + delta);
  }

  function openOrder(orderOpts = {}) {
    if (!orderOpts || typeof orderOpts !== "object") {
      throw new Error("Order options must be an object");
    }
    if (totalBars === 0 || currentIndex < 0) {
      throw new Error("Cannot place order: replay session has no loaded bars");
    }
    if (trades.length + openPositions.length >= MAX_TRADES) {
      throw new Error(`Max trades limit reached (${MAX_TRADES})`);
    }
    const bar = bars[currentIndex];
    const side = validateSide(orderOpts.side);
    const type = validateOrderType(orderOpts.type);
    const sl = orderOpts.sl != null && orderOpts.sl !== "" ? Number(orderOpts.sl) : null;
    const tp = orderOpts.tp != null && orderOpts.tp !== "" ? Number(orderOpts.tp) : null;

    let riskPct = defaultRiskPct;
    if (orderOpts.riskPct !== undefined && orderOpts.riskPct !== null) {
      const parsedRisk = orderOpts.riskPct === "" ? NaN : Number(orderOpts.riskPct);
      if (!Number.isFinite(parsedRisk) || parsedRisk <= 0) {
        throw new Error("Order riskPct must be a positive finite number");
      }
      riskPct = parsedRisk;
    }

    let explicitQty = null;
    if (orderOpts.qty !== undefined && orderOpts.qty !== null) {
      const parsedQty = orderOpts.qty === "" ? NaN : Number(orderOpts.qty);
      if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
        throw new Error("Order qty must be a positive finite number");
      }
      explicitQty = parsedQty;
    }

    let entry;
    if (type === "market") {
      if (orderOpts.entry !== undefined && orderOpts.entry !== null) {
        const parsedEntry = orderOpts.entry === "" ? NaN : Number(orderOpts.entry);
        if (!Number.isFinite(parsedEntry) || parsedEntry <= 0) {
          throw new Error("market order entry must be a positive finite number");
        }
        entry = parsedEntry;
      } else {
        entry = bar.c;
      }
    } else {
      const parsedEntry = orderOpts.entry === undefined || orderOpts.entry === null || orderOpts.entry === ""
        ? NaN
        : Number(orderOpts.entry);
      if (!Number.isFinite(parsedEntry) || parsedEntry <= 0) {
        throw new Error(`${type} order requires a positive finite entry price`);
      }
      entry = parsedEntry;
    }

    validateStops(side, entry, sl, tp, "entry");

    if (type === "market") {
      if (openPositions.length >= MAX_OPEN_POSITIONS) {
        throw new Error(`Max open positions limit reached (${MAX_OPEN_POSITIONS})`);
      }
      const equityNow = getLiveEquity(bar);
      const atr = calcAtrAt(bars, currentIndex + 1);
      const qty =
        explicitQty != null
          ? explicitQty
          : calcRiskQty({
              balance: equityNow,
              riskPct,
              entry,
              sl,
              atr,
            });
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error("Insufficient equity to size position");
      }
      const id = `ord_${nextId++}`;
      const feeIn = roundFee(entry * qty * (feePct / 100));
      const pos = {
        id,
        side,
        entry,
        qty,
        sl,
        sl0: sl,
        tp,
        feeIn,
        openIdx: currentIndex,
        openTime: formatUtcIsoMinute(bar.t),
      };
      openPositions.push(pos);
      const openPnlAfter = getLiveOpenPnl(bar);
      const equityAfter = realizedBalance + openPnlAfter;
      return {
        id,
        status: "filled",
        side,
        type,
        entry,
        qty,
        sl,
        tp,
        feeIn,
        position: { ...pos },
        order: null,
        openPnl: openPnlAfter,
        equity: equityAfter,
      };
    }

    // Pending limit or stop order
    if (pendingOrders.length >= MAX_PENDING_ORDERS) {
      throw new Error(`Max pending orders limit reached (${MAX_PENDING_ORDERS})`);
    }
    const id = `ord_${nextId++}`;
    const order = {
      id,
      side,
      type,
      entry,
      sl,
      tp,
      riskPct,
      qty: explicitQty,
      placedIdx: currentIndex,
      placedTime: formatUtcIsoMinute(bar.t),
    };
    pendingOrders.push(order);
    const openPnlAfter = getLiveOpenPnl(bar);
    const equityAfter = realizedBalance + openPnlAfter;
    return {
      id,
      status: "pending",
      side,
      type,
      entry,
      qty: explicitQty,
      sl,
      tp,
      position: null,
      order: { ...order },
      openPnl: openPnlAfter,
      equity: equityAfter,
    };
  }

  function closePosition(id, closeOpts = {}) {
    if (totalBars === 0 || currentIndex < 0) return null;
    const pos =
      id != null
        ? openPositions.find((p) => p.id === id)
        : openPositions[openPositions.length - 1];
    if (!pos) return null;

    const bar = bars[currentIndex];
    let exitPx = bar.c;
    if (closeOpts && closeOpts.price !== undefined && closeOpts.price !== null) {
      const parsedPx = closeOpts.price === "" ? NaN : Number(closeOpts.price);
      if (!Number.isFinite(parsedPx) || parsedPx <= 0) {
        throw new Error("closePosition price must be a positive finite number");
      }
      exitPx = parsedPx;
    }
    const reason = closeOpts && closeOpts.reason ? String(closeOpts.reason) : "manual";
    return closePositionInternal(pos, currentIndex, bar, exitPx, reason);
  }

  function cancelOrder(id) {
    const idx = pendingOrders.findIndex((o) => o.id === id);
    if (idx < 0) return null;
    const [removed] = pendingOrders.splice(idx, 1);
    return { ...removed, status: "cancelled" };
  }

  function updateStops(id, { sl, tp } = {}) {
    if (totalBars === 0 || currentIndex < 0) return null;
    const pos =
      id != null
        ? openPositions.find((p) => p.id === id)
        : openPositions[openPositions.length - 1];
    if (!pos) return null;

    const curPx = bars[currentIndex].c;
    const nextSl = sl === undefined ? pos.sl : (sl != null && sl !== "" ? Number(sl) : null);
    const nextTp = tp === undefined ? pos.tp : (tp != null && tp !== "" ? Number(tp) : null);
    // Validate against current market price so breakeven and profit-trailing stops are allowed.
    validateStops(pos.side, curPx, nextSl, nextTp, "current price");
    pos.sl = nextSl;
    if (pos.sl0 == null && nextSl != null) pos.sl0 = nextSl;
    pos.tp = nextTp;
    return { ...pos };
  }

  function reset(newStartIndex) {
    if (newStartIndex !== undefined) {
      initialStartIndex = clampIndex(newStartIndex);
    }
    currentIndex = initialStartIndex;
    realizedBalance = startBalance;
    openPositions = [];
    pendingOrders = [];
    triggeredHistory = [];
    trades = [];
    return getState();
  }

  function getState() {
    const stats = computeStats();
    return {
      symbol,
      tf,
      balance: startBalance,
      riskPct: defaultRiskPct,
      feePct,
      window: getWindow(),
      openPnl: stats.openPnl,
      equity: stats.equity,
      positions: openPositions.map((p) => ({ ...p })),
      pendingOrders: pendingOrders.map((o) => ({ ...o })),
      trades: stats.trades,
      stats,
    };
  }

  return {
    getWindow,
    getStats: computeStats,
    getState,
    step,
    seek,
    openOrder,
    closePosition,
    cancelOrder,
    updateStops,
    reset,

    get window() {
      return getWindow();
    },
    get currentIndex() {
      return currentIndex;
    },
    get currentBar() {
      return getCurrentBar();
    },
    get openPnl() {
      return getLiveOpenPnl();
    },
    get equity() {
      return getLiveEquity();
    },
    get positions() {
      return openPositions.map((p) => ({ ...p }));
    },
    get pendingOrders() {
      return pendingOrders.map((o) => ({ ...o }));
    },
    get trades() {
      return trades.map((t) => ({ ...t }));
    },
  };
}
