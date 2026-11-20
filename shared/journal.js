// shared/journal.js — Server-side Journal, Prop Tracker, Monte Carlo simulator, and institutional analytics.
// Pure ES module, zero DOM or Node API dependencies; compatible with Node 22+ and Cloudflare Workers.
// Exact parity with src/50_journal_logic.js (lines 1-79) and index.html VTC (lines 3763-3793).

/* ==========================================================================
   Constants & Low-Level Journal Primitives (src/50_journal_logic.js)
   ========================================================================== */

export const JR_SETUP_MAX = 40;
export const JR_TRADES_MAX = 5000;
export const MAX_R_BUCKETS = 200;
export const MIN_R_BUCKET_SIZE = 0.05;
export const SIM_MAX_RUNS = 2000;
export const SIM_MAX_DAYS = 1000;
export const SIM_MAX_TRADES_PER_DAY = 50;

export const JR_COLS = Object.freeze([
  "open",
  "close",
  "sym",
  "side",
  "qty",
  "entry",
  "exit",
  "stop",
  "fees",
  "pv",
  "pnl",
  "acct",
  "setup",
  "tags",
  "notes",
]);

export const JR_HEAD = Object.freeze([
  "date_open",
  "date_close",
  "symbol",
  "side",
  "quantity",
  "entry",
  "exit",
  "stop",
  "fees",
  "point_value",
  "pnl_override",
  "account",
  "setup",
  "tags",
  "notes",
]);

/**
 * Parse a numeric value from a number or formatted string (stripping `,`, `$`, spaces).
 * @param {unknown} v
 * @returns {number | null}
 */
export function jrNum(v) {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[, $]/g, ""));
  return isFinite(n) ? n : null;
}

/**
 * Realised P&L for one trade: explicit override `pnl`, else `(exit - entry) * qty * pv * dir - fees`.
 * Returns `null` for open or incomplete trades.
 * @param {object} t
 * @returns {number | null}
 */
export function jrPnl(t) {
  if (!t || typeof t !== "object") return null;
  const m = jrNum(t.pnl);
  if (m != null) return m;
  const e = jrNum(t.entry);
  const x = jrNum(t.exit);
  const q = jrNum(t.qty);
  if (e == null || x == null || q == null) return null;
  const pv = jrNum(t.pv) || 1;
  const f = jrNum(t.fees) || 0;
  const dir = t.side === "short" ? -1 : 1;
  return (x - e) * q * pv * dir - f;
}

/**
 * Initial dollar risk at stop: `|entry - stop| * qty * pv`.
 * @param {object} t
 * @returns {number | null}
 */
export function jrRisk(t) {
  if (!t || typeof t !== "object") return null;
  const e = jrNum(t.entry);
  const s = jrNum(t.stop);
  const q = jrNum(t.qty);
  if (e == null || s == null || q == null || e === s) return null;
  return Math.abs(e - s) * q * (jrNum(t.pv) || 1);
}

/**
 * Realised R-multiple: `pnl / risk`.
 * @param {object} t
 * @returns {number | null}
 */
export function jrR(t) {
  const p = jrPnl(t);
  const r = jrRisk(t);
  return p == null || !r ? null : p / r;
}

/**
 * Extract validated `YYYY-MM-DD` date key from `close` or `open`.
 * Rejects impossible calendar dates (e.g. "2026-13-45" or "2026-02-30").
 * @param {object} t
 * @returns {string | null}
 */
export function jrDay(t) {
  if (!t || typeof t !== "object") return null;
  const d = jrDate(t.close || t.open || "");
  return d ? d.slice(0, 10) : null;
}

/**
 * Return a shallow copy of trades sorted chronologically by `close || open`.
 * @param {Array<object>} a
 * @returns {Array<object>}
 */
export function jrSort(a) {
  return a
    .slice()
    .sort((x, y) => String(x.close || x.open || "").localeCompare(String(y.close || y.open || "")));
}

/**
 * Filter to closed trades with a known P&L and valid date, oldest first.
 * @param {Array<object>} trades
 * @returns {Array<object>}
 */
export function jrClosed(trades) {
  if (!Array.isArray(trades)) return [];
  return jrSort(trades.filter((t) => jrPnl(t) != null && jrDay(t)));
}

/**
 * Today's local date as `YYYY-MM-DD`. Accepts optional Date for deterministic tests.
 * @param {Date} [now]
 * @returns {string}
 */
export function jrToday(now) {
  const d = now instanceof Date ? now : new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

/**
 * Full journal summary statistics — exact parity with src/50_journal_logic.js `jrStats`.
 * @param {Array<object>} trades
 */
export function jrStats(trades) {
  const T = jrClosed(trades);
  const n = T.length;
  const o = {
    n,
    wins: 0,
    losses: 0,
    be: 0,
    gw: 0,
    gl: 0,
    net: 0,
    winRate: null,
    pf: null,
    avgWin: null,
    avgLoss: null,
    exp: null,
    avgR: null,
    nR: 0,
    maxDD: 0,
    maxDDPct: null,
    best: null,
    worst: null,
    winStreak: 0,
    lossStreak: 0,
    bySetup: Object.create(null),
    byDay: Object.create(null),
    byWeekday: [0, 1, 2, 3, 4, 5, 6].map(() => ({ n: 0, net: 0 })),
    bySymbol: Object.create(null),
    bySide: {
      long: { n: 0, net: 0, wins: 0 },
      short: { n: 0, net: 0, wins: 0 },
    },
    curve: [],
  };
  let eq = 0;
  let peak = 0;
  let ws = 0;
  let ls = 0;
  let sumR = 0;

  for (const t of T) {
    const p = jrPnl(t);
    const r = jrR(t);
    const d = jrDay(t);
    o.net += p;
    eq += p;
    peak = Math.max(peak, eq);
    o.maxDD = Math.max(o.maxDD, peak - eq);
    o.curve.push({ d, eq, p });

    if (p > 0) {
      o.wins++;
      o.gw += p;
      ws++;
      ls = 0;
    } else if (p < 0) {
      o.losses++;
      o.gl += -p;
      ls++;
      ws = 0;
    } else {
      o.be++;
      ws = 0;
      ls = 0;
    }

    o.winStreak = Math.max(o.winStreak, ws);
    o.lossStreak = Math.max(o.lossStreak, ls);
    if (r != null) {
      sumR += r;
      o.nR++;
    }
    if (!o.best || p > jrPnl(o.best)) o.best = t;
    if (!o.worst || p < jrPnl(o.worst)) o.worst = t;

    const tags = (t.setup || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const g of tags.length ? tags : ["(no setup)"]) {
      const b = o.bySetup[g] || (o.bySetup[g] = { n: 0, net: 0, wins: 0, sumR: 0, nR: 0 });
      b.n++;
      b.net += p;
      if (p > 0) b.wins++;
      if (r != null) {
        b.sumR += r;
        b.nR++;
      }
    }

    o.byDay[d] = (o.byDay[d] || 0) + p;
    const validDay = jrDate(d);
    if (validDay) {
      const wd = new Date(validDay.slice(0, 10) + "T12:00:00Z").getUTCDay();
      if (Number.isInteger(wd) && wd >= 0 && wd <= 6) {
        o.byWeekday[wd].n++;
        o.byWeekday[wd].net += p;
      }
    }

    const sy = String(t.sym || "").toUpperCase() || "(none)";
    const bs = o.bySymbol[sy] || (o.bySymbol[sy] = { n: 0, net: 0, wins: 0 });
    bs.n++;
    bs.net += p;
    if (p > 0) bs.wins++;

    const sd = o.bySide[t.side === "short" ? "short" : "long"];
    sd.n++;
    sd.net += p;
    if (p > 0) sd.wins++;
  }

  if (n) {
    o.winRate = o.wins / n;
    o.exp = o.net / n;
  }
  if (o.wins) o.avgWin = o.gw / o.wins;
  if (o.losses) o.avgLoss = -o.gl / o.losses;
  o.pf = o.gl > 0 ? o.gw / o.gl : o.gw > 0 ? Infinity : null;
  if (o.nR) o.avgR = sumR / o.nR;
  return o;
}

/**
 * Prop-challenge progress for one named account — exact parity with src/50_journal_logic.js `jrProp`.
 * Accepts optional `today` (`YYYY-MM-DD`) for deterministic server evaluation.
 *
 * @param {{ name?: string, size: number|string, target?: number|string, daily?: number|string, maxdd?: number|string, mindays?: number|string, trailing?: boolean }} acct
 * @param {Array<object>} trades
 * @param {string} [today]
 */
export function jrProp(acct, trades, today) {
  const size = jrNum(acct.size) || 0;
  const T = jrClosed(
    (Array.isArray(trades) ? trades : []).filter((t) => (t.acct || "") === (acct.name || ""))
  );
  const pctOf = (v) => {
    const x = jrNum(v);
    return x != null && x > 0 ? (size * x) / 100 : null;
  };
  const tgt = pctOf(acct.target);
  const dLim = pctOf(acct.daily);
  const ddLim = pctOf(acct.maxdd);

  let bal = size;
  let peak = size;
  let maxDD = 0;
  let breach = null;
  let day = null;
  let dayPnl = 0;
  let worstDay = 0;
  const days = Object.create(null);

  for (const t of T) {
    const p = jrPnl(t);
    const d = jrDay(t);
    if (d !== day) {
      day = d;
      dayPnl = 0;
    }
    dayPnl += p;
    days[d] = (days[d] || 0) + p;
    bal += p;
    peak = Math.max(peak, bal);
    const dd = acct.trailing ? peak - bal : size - bal;
    maxDD = Math.max(maxDD, dd);
    worstDay = Math.min(worstDay, days[d]);
    if (!breach && dLim != null && -days[d] >= dLim - 1e-9) {
      breach = { rule: "daily", day: d, v: -days[d] };
    }
    if (!breach && ddLim != null && dd >= ddLim - 1e-9) {
      breach = { rule: "drawdown", day: d, v: dd };
    }
  }

  const profit = bal - size;
  const nDays = Object.keys(days).length;
  const minDays = jrNum(acct.mindays) || 0;
  const curDay = today != null ? String(today).slice(0, 10) : jrToday();
  const todayPnl = days[curDay] || 0;
  const ddNow = acct.trailing ? peak - bal : Math.max(0, size - bal);
  const passed = !breach && tgt != null && profit >= tgt - 1e-9 && nDays >= minDays;

  return {
    size,
    bal,
    profit,
    peak,
    tgt,
    dLim,
    ddLim,
    maxDD,
    ddNow,
    worstDay,
    nDays,
    minDays,
    todayPnl,
    breach,
    passed,
    n: T.length,
    status: breach ? "breached" : passed ? "passed" : "active",
    toTarget: tgt != null ? Math.max(0, tgt - profit) : null,
    dailyRoom: dLim != null ? Math.max(0, dLim + Math.min(0, todayPnl)) : null,
    ddRoom: ddLim != null ? Math.max(0, ddLim - ddNow) : null,
    floor: ddLim != null ? (acct.trailing ? peak - ddLim : size - ddLim) : null,
  };
}

/* ==========================================================================
   CSV & Trade Validation Helpers (src/50_journal_logic.js)
   ========================================================================== */

export function jrCsvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) || (/^[=+\-@\t]/.test(s) && isNaN(+s))
    ? '"' + (/^[=+\-@\t]/.test(s) && isNaN(+s) ? "'" : "") + s.replace(/"/g, '""') + '"'
    : s;
}

export function jrToCsv(trades) {
  return (
    [JR_HEAD.join(","), ...jrSort(trades).map((t) => JR_COLS.map((k) => jrCsvCell(t[k])).join(","))].join(
      "\r\n"
    ) + "\r\n"
  );
}

export function jrParseCsv(txt) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) {
      if (c === '"') {
        if (txt[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          q = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      q = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && txt[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

export function jrDate(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return "";
  const y = +m[1];
  const mo = +m[2] - 1;
  const da = +m[3];
  const d = new Date(Date.UTC(y, mo, da));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo || d.getUTCDate() !== da) return "";
  return m[1] + "-" + m[2] + "-" + m[3] + (m[4] ? "T" + m[4] + ":" + m[5] : "");
}

export function jrClean(t) {
  const side = String(t.side || "").toLowerCase();
  const o = {
    id: t.id || "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    sym: String(t.sym || "")
      .trim()
      .toUpperCase()
      .slice(0, 24),
    side:
      side === "short" || side === "sell" || side === "s"
        ? "short"
        : side === "long" || side === "buy" || side === "l"
          ? "long"
          : "",
    open: jrDate(t.open),
    close: jrDate(t.close),
    qty: jrNum(t.qty),
    entry: jrNum(t.entry),
    exit: jrNum(t.exit),
    stop: jrNum(t.stop),
    fees: jrNum(t.fees),
    pv: jrNum(t.pv),
    pnl: jrNum(t.pnl),
    acct: String(t.acct || "")
      .trim()
      .slice(0, 40),
    setup: String(t.setup || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6)
      .join(", ")
      .slice(0, 120),
    tags: String(t.tags || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10)
      .join(", ")
      .slice(0, 160),
    notes: String(t.notes || "").slice(0, 2000),
  };
  if (!o.sym) return { err: "symbol is missing" };
  if (!o.side) return { err: "side must be long or short" };
  if (o.qty != null && o.qty <= 0) return { err: "quantity must be above zero" };
  if (o.pv != null && o.pv <= 0) return { err: "point value must be above zero" };
  if (o.close && o.open && o.close < o.open) return { err: "close time is before open time" };
  if (o.pnl == null && o.exit != null && (o.entry == null || o.qty == null)) {
    return { err: "entry and quantity are needed to work out the P&L" };
  }
  if (o.exit != null && !o.close) return { err: "a closed trade needs a close date" };
  return { t: o };
}

export function jrFromCsv(txt) {
  const res = { trades: [], errors: [] };
  if (typeof txt !== "string" || txt.length > 5e6) {
    res.errors.push("File is too large (5 MB max)");
    return res;
  }
  const rows = jrParseCsv(txt.replace(/^\ufeff/, ""));
  if (!rows.length) {
    res.errors.push("The file is empty");
    return res;
  }
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const idx = JR_HEAD.map((h) => head.indexOf(h));
  if (idx[JR_HEAD.indexOf("symbol")] < 0 || idx[JR_HEAD.indexOf("side")] < 0) {
    res.errors.push(
      "Missing columns: the first row must include at least symbol and side (export a journal to see the layout)"
    );
    return res;
  }
  rows.slice(1, 1 + JR_TRADES_MAX).forEach((r, i) => {
    const t = {};
    JR_COLS.forEach((k, j) => {
      if (idx[j] >= 0) {
        t[k] = String(r[idx[j]] == null ? "" : r[idx[j]])
          .trim()
          .replace(/^'(?=[=+\-@\t])/, "");
      }
    });
    const v = jrClean(t);
    if (v.err) res.errors.push("Row " + (i + 2) + ": " + v.err);
    else res.trades.push(v.t);
  });
  return res;
}

/* ==========================================================================
   VTC Core Functions (index.html lines 3763-3793)
   ========================================================================== */

/**
 * Deterministic Mulberry32 PRNG returning floats in `[0, 1)`.
 * @param {number} seed
 * @returns {() => number}
 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Monte Carlo prop-firm challenge simulator.
 * Each trade risks `riskPct` of current equity (or starting balance if `fixed`),
 * winning `rr * risk` with probability `winRate` (0..1).
 * Fails on daily loss or max drawdown (static or trailing-to-start-balance).
 *
 * @param {{
 *   acct: number,
 *   target: number,
 *   maxDD: number,
 *   dailyDD: number,
 *   riskPct: number,
 *   winRate: number,
 *   rr: number,
 *   tradesPerDay: number,
 *   maxDays: number,
 *   trailing?: boolean,
 *   fixed?: boolean,
 *   runs?: number,
 * }} o
 * @param {number} [seed=12345]
 * @returns {{ runs: number, pass: number, failDD: number, failDay: number, timeout: number, medianDays: number | null }}
 */
export function simChallenge(o, seed) {
  const cfg = o && typeof o === "object" ? o : {};
  const rawRuns = Number(cfg.runs);
  const N = Math.min(
    SIM_MAX_RUNS,
    Math.max(1, Math.floor(Number.isFinite(rawRuns) && rawRuns > 0 ? rawRuns : 1000))
  );
  const rawMaxDays = Number(cfg.maxDays);
  const maxDays = Math.min(
    SIM_MAX_DAYS,
    Math.max(0, Math.floor(Number.isFinite(rawMaxDays) ? rawMaxDays : 0))
  );
  const rawTpd = Number(cfg.tradesPerDay);
  const tradesPerDay = Math.min(
    SIM_MAX_TRADES_PER_DAY,
    Math.max(0, Math.floor(Number.isFinite(rawTpd) ? rawTpd : 0))
  );
  const r = rng(seed == null ? 12345 : seed);
  let pass = 0;
  let failDD = 0;
  let failDay = 0;
  let timeout = 0;
  const days = [];

  for (let k = 0; k < N; k++) {
    let eq = cfg.acct;
    let peak = cfg.acct;
    let done = false;
    for (let d = 1; d <= maxDays && !done; d++) {
      const dayStart = eq;
      for (let t = 0; t < tradesPerDay; t++) {
        const risk = ((cfg.fixed ? cfg.acct : eq) * cfg.riskPct) / 100;
        eq += r() < cfg.winRate ? risk * cfg.rr : -risk;
        if (eq > peak) peak = eq;
        const floor = cfg.trailing
          ? Math.min(peak - (cfg.acct * cfg.maxDD) / 100, cfg.acct)
          : cfg.acct * (1 - cfg.maxDD / 100);
        if (eq <= floor) {
          failDD++;
          done = true;
          break;
        }
        if (cfg.dailyDD > 0 && dayStart - eq >= (cfg.acct * cfg.dailyDD) / 100) {
          failDay++;
          done = true;
          break;
        }
        if (eq >= cfg.acct * (1 + cfg.target / 100)) {
          pass++;
          days.push(d);
          done = true;
          break;
        }
      }
    }
    if (!done) timeout++;
  }

  days.sort((a, b) => a - b);
  return {
    runs: N,
    pass: pass / N,
    failDD: failDD / N,
    failDay: failDay / N,
    timeout: timeout / N,
    medianDays: days.length ? days[days.length >> 1] : null,
  };
}

/** Resolve numeric P&L from either `{ pnl }` or `{ entry, exit, qty, pv, fees, side }`. */
function resolveTradePnl(t) {
  if (!t || typeof t !== "object") return null;
  if (typeof t.pnl === "number") return Number.isFinite(t.pnl) ? t.pnl : null;
  return jrPnl(t);
}

/** Resolve numeric R-multiple from either `{ r }` or `{ entry, exit, stop, qty, pv, pnl }`. */
function resolveTradeR(t) {
  if (!t || typeof t !== "object") return null;
  if (typeof t.r === "number") return Number.isFinite(t.r) ? t.r : null;
  return jrR(t);
}

/** Resolve validated `YYYY-MM-DD` date string from `date`, `close`, or `open`. */
function resolveTradeDay(t) {
  if (!t || typeof t !== "object") return null;
  const d = jrDate(t.date || t.close || t.open || "");
  return d ? d.slice(0, 10) : null;
}

/** Resolve full timestamp/date sort key from `date`, `close`, or `open`. */
function resolveTradeSortKey(t) {
  if (!t || typeof t !== "object") return "";
  return String(t.date || t.close || t.open || "");
}

/**
 * Journal performance statistics from closed trades `[{ pnl, r?, date? }]` (or journal records
 * with `{ entry, exit, qty, pv?, fees?, stop?, side?, close? }`).
 * Matches `index.html` `VTC.tradeStats` (lines 3777-3783) with breakeven tracking.
 *
 * @param {Array<object>} trades
 * @param {number} [startBal=0]
 */
export function tradeStats(trades, startBal = 0) {
  const list = Array.isArray(trades) ? trades : [];
  const T = [];
  for (const t of list) {
    const pnl = resolveTradePnl(t);
    if (pnl != null) T.push({ pnl, r: resolveTradeR(t), raw: t });
  }

  const n = T.length;
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let gw = 0;
  let gl = 0;
  let sumR = 0;
  let nR = 0;

  let eq = startBal || 0;
  let peak = eq;
  let maxDD = 0;
  let maxDDpct = 0;
  const curve = [eq];
  const rcurve = [0];
  let rc = 0;

  for (const t of T) {
    if (t.pnl > 0) {
      wins++;
      gw += t.pnl;
    } else if (t.pnl < 0) {
      losses++;
      gl += -t.pnl;
    } else {
      breakevens++;
    }
    if (t.r != null) {
      sumR += t.r;
      nR++;
      rc += t.r;
    }
    eq += t.pnl;
    curve.push(eq);
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDD) maxDD = dd;
    if (peak > 0 && dd / peak > maxDDpct) maxDDpct = dd / peak;
    rcurve.push(rc);
  }

  const net = gw - gl;
  return {
    n,
    wins,
    losses,
    breakevens,
    winRate: n ? wins / n : 0,
    net,
    grossWin: gw,
    grossLoss: gl,
    profitFactor: gl > 0 ? gw / gl : gw > 0 ? Infinity : 0,
    expectancy: n ? net / n : 0,
    avgWin: wins ? gw / wins : 0,
    avgLoss: losses ? gl / losses : 0,
    avgR: nR ? sumR / nR : 0,
    maxDD,
    maxDDpct,
    equity: curve,
    rCurve: rcurve,
    balance: eq,
  };
}

/**
 * Prop-firm rule usage & breach evaluation from closed trades.
 * Matches `index.html` `VTC.propStatus` (lines 3785-3791) and adds explicit breach detection.
 *
 * @param {Array<object>} trades
 * @param {{ acct: number, dailyDD: number, maxDD: number, trailing?: boolean, target?: number }} o
 * @param {string} [today]
 */
export function propStatus(trades, o, today) {
  const list = Array.isArray(trades) ? trades : [];
  const T = [];
  for (const t of list) {
    const pnl = resolveTradePnl(t);
    if (pnl != null) T.push({ pnl, day: resolveTradeDay(t) });
  }

  const dailyLimit = (o.acct * (o.dailyDD || 0)) / 100;
  const maxLimit = (o.acct * (o.maxDD || 0)) / 100;
  const curDay = today != null ? String(today).slice(0, 10) : jrToday();

  let bal = o.acct;
  let peak = o.acct;
  let breach = null;
  let dailyBreached = false;
  let maxDDBreached = false;
  const byDay = Object.create(null);

  for (const t of T) {
    bal += t.pnl;
    if (bal > peak) peak = bal;
    if (t.day) {
      byDay[t.day] = (byDay[t.day] || 0) + t.pnl;
      if (dailyLimit > 0 && -byDay[t.day] >= dailyLimit - 1e-9) {
        dailyBreached = true;
        if (!breach) breach = { rule: "daily", day: t.day, value: -byDay[t.day] };
      }
    }
    const stepFloor = o.trailing ? Math.min(peak - maxLimit, o.acct) : o.acct - maxLimit;
    if (maxLimit > 0 && bal <= stepFloor + 1e-9) {
      maxDDBreached = true;
      if (!breach) breach = { rule: "drawdown", day: t.day, value: peak - bal };
    }
  }

  const dayPnl = byDay[curDay] || 0;
  const floor = o.trailing ? Math.min(peak - maxLimit, o.acct) : o.acct - maxLimit;
  const targetGoal = o.target > 0 ? o.acct * (1 + o.target / 100) : null;
  const targetLeft = targetGoal != null ? targetGoal - bal : null;
  const breached = dailyBreached || maxDDBreached;
  const passed = !breached && targetGoal != null && bal >= targetGoal - 1e-9;

  return {
    balance: bal,
    peak,
    dayPnl,
    dailyUsed: dailyLimit > 0 ? Math.max(0, -dayPnl) / dailyLimit : 0,
    dailyLeft: dailyLimit + Math.min(0, dayPnl),
    floor,
    maxUsed: maxLimit > 0 ? Math.min(1, Math.max(0, 1 - (bal - floor) / maxLimit)) : 0,
    toFloor: bal - floor,
    targetLeft,
    dailyBreached,
    maxDDBreached,
    breached,
    breach,
    passed,
    status: breached ? "breached" : passed ? "passed" : "active",
  };
}

/* ==========================================================================
   Institutional Analytics Helpers
   ========================================================================== */

/**
 * Chronological equity curve with running peak and drawdown per trade.
 *
 * @param {Array<object>} trades
 * @param {number} [startBal=0]
 * @returns {Array<{
 *   index: number,
 *   date: string | null,
 *   pnl: number,
 *   cumulativePnl: number,
 *   equity: number,
 *   peak: number,
 *   drawdown: number,
 *   drawdownPct: number
 * }>}
 */
export function equityCurve(trades, startBal = 0) {
  const list = Array.isArray(trades) ? trades : [];
  const valid = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const pnl = resolveTradePnl(t);
    if (pnl != null) {
      valid.push({ pnl, date: resolveTradeDay(t), sortKey: resolveTradeSortKey(t), origIdx: i });
    }
  }
  if (!valid.length) return [];

  // Preserve chronological order when timestamps/dates exist; keep original order for ties/dateless entries.
  const hasAnyDate = valid.some((x) => x.sortKey !== "");
  if (hasAnyDate) {
    valid.sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.origIdx - b.origIdx);
  }

  let eq = startBal || 0;
  let peak = eq;
  let cumPnl = 0;
  const out = [];

  for (let i = 0; i < valid.length; i++) {
    const item = valid[i];
    cumPnl += item.pnl;
    eq += item.pnl;
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    const ddPct = peak > 0 ? dd / peak : 0;
    out.push({
      index: i,
      date: item.date,
      pnl: item.pnl,
      cumulativePnl: cumPnl,
      equity: eq,
      peak,
      drawdown: dd,
      drawdownPct: ddPct,
    });
  }
  return out;
}

/**
 * Underwater drawdown series and drawdown duration analytics.
 *
 * @param {Array<object>} trades
 * @param {number} [startBal=0]
 */
export function drawdownSeries(trades, startBal = 0) {
  const curve = equityCurve(trades, startBal);
  if (!curve.length) {
    return {
      points: [],
      maxDD: 0,
      maxDDPct: 0,
      maxDDPeakIndex: null,
      maxDDTroughIndex: null,
      maxDDRecoveryIndex: null,
      longestUnderwaterBars: 0,
      currentDD: 0,
      currentDDPct: 0,
    };
  }

  const points = [];
  let maxDD = 0;
  let maxDDPct = 0;
  let maxDDPeakIndex = null;
  let maxDDTroughIndex = null;
  let currentPeakIndex = -1;
  let currentPeakVal = startBal || 0;
  let underwaterStreak = 0;
  let longestUnderwaterBars = 0;

  for (let i = 0; i < curve.length; i++) {
    const pt = curve[i];
    const underwater = pt.drawdown > 0;
    if (!underwater) {
      currentPeakIndex = i;
      currentPeakVal = pt.peak;
      underwaterStreak = 0;
    } else {
      underwaterStreak++;
      if (underwaterStreak > longestUnderwaterBars) longestUnderwaterBars = underwaterStreak;
    }

    if (pt.drawdown > maxDD) {
      maxDD = pt.drawdown;
      maxDDPeakIndex = currentPeakIndex;
      maxDDTroughIndex = i;
    }
    if (pt.drawdownPct > maxDDPct) {
      maxDDPct = pt.drawdownPct;
    }

    points.push({
      index: pt.index,
      date: pt.date,
      equity: pt.equity,
      peak: pt.peak,
      drawdown: pt.drawdown,
      drawdownPct: pt.drawdownPct,
      underwater,
    });
  }

  let maxDDRecoveryIndex = null;
  if (maxDDTroughIndex != null) {
    const peakToRecover = curve[maxDDTroughIndex].peak;
    for (let i = maxDDTroughIndex + 1; i < curve.length; i++) {
      if (curve[i].equity >= peakToRecover - 1e-9) {
        maxDDRecoveryIndex = i;
        break;
      }
    }
  }

  const last = curve[curve.length - 1];
  return {
    points,
    maxDD,
    maxDDPct,
    maxDDPeakIndex,
    maxDDTroughIndex,
    maxDDRecoveryIndex,
    longestUnderwaterBars,
    currentDD: last.drawdown,
    currentDDPct: last.drawdownPct,
  };
}

/**
 * R-multiple distribution, histogram buckets, expectancy, and Van Tharp SQN.
 *
 * @param {Array<object>} trades
 * @param {{ bucketSize?: number }} [opts]
 */
export function rDistribution(trades, opts = {}) {
  const rawBucketSize = Number(opts && opts.bucketSize);
  let bucketSize =
    Number.isFinite(rawBucketSize) && rawBucketSize > 0
      ? Math.max(MIN_R_BUCKET_SIZE, rawBucketSize)
      : 0.5;
  const list = Array.isArray(trades) ? trades : [];
  const rs = [];
  for (const t of list) {
    const r = resolveTradeR(t);
    if (r != null && Number.isFinite(r)) rs.push(r);
  }

  const count = rs.length;
  if (!count) {
    return {
      count: 0,
      min: null,
      max: null,
      mean: null,
      median: null,
      stdev: null,
      positiveCount: 0,
      negativeCount: 0,
      zeroCount: 0,
      expectancyR: null,
      sqn: null,
      buckets: [],
    };
  }

  const sorted = rs.slice().sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[count - 1];
  const sum = rs.reduce((a, b) => a + b, 0);
  const mean = sum / count;
  const mid = count >> 1;
  const median = count % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const variance = rs.reduce((a, v) => a + (v - mean) * (v - mean), 0) / count;
  const stdev = Math.sqrt(variance);

  // Enforce MAX_R_BUCKETS cap by widening bucketSize when extreme R outliers span > MAX_R_BUCKETS.
  const rawMinIdx = Math.floor(min / bucketSize);
  const rawMaxIdx = Math.floor(max / bucketSize);
  if (!Number.isFinite(rawMaxIdx - rawMinIdx) || rawMaxIdx - rawMinIdx + 1 > MAX_R_BUCKETS) {
    const span = max - min;
    const denom = MAX_R_BUCKETS - 2;
    bucketSize = Number.isFinite(span) ? span / denom : max / denom - min / denom;
    if (!Number.isFinite(bucketSize) || bucketSize < MIN_R_BUCKET_SIZE) {
      bucketSize = MIN_R_BUCKET_SIZE;
    }
  }

  let positiveCount = 0;
  let negativeCount = 0;
  let zeroCount = 0;
  const bucketMap = new Map();

  for (const r of rs) {
    if (r > 0) positiveCount++;
    else if (r < 0) negativeCount++;
    else zeroCount++;

    const idx = Math.floor(r / bucketSize);
    bucketMap.set(idx, (bucketMap.get(idx) || 0) + 1);
  }

  const minIdx = Math.floor(min / bucketSize);
  const maxIdx = Math.min(Math.floor(max / bucketSize), minIdx + MAX_R_BUCKETS - 1);
  const buckets = [];
  for (let idx = minIdx; idx <= maxIdx; idx++) {
    const lo = Number((idx * bucketSize).toFixed(6));
    const hi = Number(((idx + 1) * bucketSize).toFixed(6));
    const c = bucketMap.get(idx) || 0;
    buckets.push({
      min: lo,
      max: hi,
      label: `${lo}R to ${hi}R`,
      count: c,
      pct: c / count,
    });
  }

  const sqn = count >= 2 && stdev > 0 ? (mean / stdev) * Math.sqrt(count) : null;
  return {
    count,
    min,
    max,
    mean,
    median,
    stdev,
    positiveCount,
    negativeCount,
    zeroCount,
    expectancyR: mean,
    sqn,
    buckets,
  };
}

/**
 * Daily P&L calendar aggregation, optionally scoped by `month` (`YYYY-MM`) or `year` (`YYYY`).
 *
 * @param {Array<object>} trades
 * @param {{ month?: string, year?: string }} [opts]
 */
export function dailyPnlCalendar(trades, opts = {}) {
  const list = Array.isArray(trades) ? trades : [];
  const monthFilter = opts.month ? String(opts.month).slice(0, 7) : null;
  const yearFilter = opts.year ? String(opts.year).slice(0, 4) : null;
  const acc = Object.create(null);

  for (const t of list) {
    const pnl = resolveTradePnl(t);
    const date = resolveTradeDay(t);
    if (pnl == null || !date) continue;
    if (monthFilter && !date.startsWith(monthFilter)) continue;
    if (yearFilter && !date.startsWith(yearFilter)) continue;

    let d = acc[date];
    if (!d) {
      d = acc[date] = {
        date,
        pnl: 0,
        trades: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        _sumR: 0,
        _nR: 0,
        bestTrade: pnl,
        worstTrade: pnl,
      };
    }
    d.pnl += pnl;
    d.trades++;
    if (pnl > 0) d.wins++;
    else if (pnl < 0) d.losses++;
    else d.breakevens++;
    if (pnl > d.bestTrade) d.bestTrade = pnl;
    if (pnl < d.worstTrade) d.worstTrade = pnl;

    const r = resolveTradeR(t);
    if (r != null) {
      d._sumR += r;
      d._nR++;
    }
  }

  const dates = Object.keys(acc).sort();
  const byDay = Object.create(null);
  const days = [];
  let greenDays = 0;
  let redDays = 0;
  let flatDays = 0;
  let totalPnl = 0;
  let bestDay = null;
  let worstDay = null;

  for (const date of dates) {
    const raw = acc[date];
    const entry = {
      date: raw.date,
      pnl: raw.pnl,
      trades: raw.trades,
      wins: raw.wins,
      losses: raw.losses,
      breakevens: raw.breakevens,
      winRate: raw.trades ? raw.wins / raw.trades : 0,
      avgR: raw._nR ? raw._sumR / raw._nR : null,
      bestTrade: raw.bestTrade,
      worstTrade: raw.worstTrade,
    };
    days.push(entry);
    byDay[date] = entry;
    totalPnl += entry.pnl;

    if (entry.pnl > 0) greenDays++;
    else if (entry.pnl < 0) redDays++;
    else flatDays++;

    if (!bestDay || entry.pnl > bestDay.pnl) bestDay = entry;
    if (!worstDay || entry.pnl < worstDay.pnl) worstDay = entry;
  }

  return {
    days,
    byDay,
    tradingDays: days.length,
    greenDays,
    redDays,
    flatDays,
    bestDay,
    worstDay,
    totalPnl,
    avgDailyPnl: days.length ? totalPnl / days.length : 0,
  };
}
