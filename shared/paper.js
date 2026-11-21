// shared/paper.js — server-side paper trading account (E-13), driven by live prices in the hub.
// Market orders fill at the current server price; stop-loss / take-profit are checked on every price update for that
// symbol (stop before target if both are crossed in one update, matching the replay fill rules). Margin = notional /
// leverage; commission is charged on notional at entry and exit. All maths stays on the server (AGENTS.md §0).

export const PAPER_MAX_POSITIONS = 50;
export const PAPER_MAX_HISTORY = 500;
export const PAPER_DEFAULTS = Object.freeze({ balance: 10000, leverage: 1, commissionPct: 0.05, currency: "USD" });
const SYM_RE = /^[A-Z0-9.=^/-]{1,24}$/;
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const pos = (v) => fin(v) && v > 0;

export function normalizePaperSettings(raw = {}) {
  const balance = pos(+raw.balance) && +raw.balance <= 1e9 ? +raw.balance : PAPER_DEFAULTS.balance;
  const leverage = pos(+raw.leverage) && +raw.leverage <= 100 ? +raw.leverage : PAPER_DEFAULTS.leverage;
  const commissionPct = fin(+raw.commissionPct) && +raw.commissionPct >= 0 && +raw.commissionPct <= 5 ? +raw.commissionPct : PAPER_DEFAULTS.commissionPct;
  return { balance, leverage, commissionPct, currency: PAPER_DEFAULTS.currency };
}

/**
 * @param {{ settings?: object, state?: object, now?: () => number }} [opts]
 */
export function createPaperAccount(opts = {}) {
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  let settings = normalizePaperSettings(opts.settings || (opts.state && opts.state.settings) || {});
  let cash = settings.balance; // realised balance
  let positions = [];
  let history = [];
  let seq = 1;
  if (opts.state && typeof opts.state === "object") restore(opts.state);

  function restore(st) {
    settings = normalizePaperSettings(st.settings || {});
    cash = fin(st.cash) ? st.cash : settings.balance;
    positions = Array.isArray(st.positions) ? st.positions.filter((p) => p && SYM_RE.test(p.sym) && pos(p.entry) && pos(p.qty)).slice(0, PAPER_MAX_POSITIONS) : [];
    history = Array.isArray(st.history) ? st.history.slice(-PAPER_MAX_HISTORY) : [];
    seq = Number.isSafeInteger(st.seq) && st.seq > 0 ? st.seq : positions.length + history.length + 1;
  }
  const fee = (notional) => (notional * settings.commissionPct) / 100;
  const upnl = (p, px) => (pos(px) ? (px - p.entry) * p.qty * (p.side === "long" ? 1 : -1) : 0);
  const usedMargin = () => positions.reduce((a, p) => a + (p.entry * p.qty) / settings.leverage, 0);

  /** Open a market position at `price`. Returns { ok, position? , error? }. */
  function marketOrder(o, price) {
    const sym = String(o && o.sym || "").toUpperCase();
    if (!SYM_RE.test(sym)) return { ok: false, error: "Invalid symbol" };
    const side = o.side === "short" || o.side === "sell" ? "short" : o.side === "long" || o.side === "buy" ? "long" : null;
    if (!side) return { ok: false, error: "side must be long or short" };
    const qty = +o.qty;
    if (!pos(qty) || qty > 1e9) return { ok: false, error: "Quantity must be a positive number" };
    if (!pos(price)) return { ok: false, error: "No live price for " + sym + " yet" };
    if (positions.length >= PAPER_MAX_POSITIONS) return { ok: false, error: `At most ${PAPER_MAX_POSITIONS} open positions` };
    const sl = o.sl == null || o.sl === "" ? null : +o.sl;
    const tp = o.tp == null || o.tp === "" ? null : +o.tp;
    if (sl !== null && !(pos(sl) && (side === "long" ? sl < price : sl > price))) return { ok: false, error: "Stop loss must be on the losing side of the price" };
    if (tp !== null && !(pos(tp) && (side === "long" ? tp > price : tp < price))) return { ok: false, error: "Take profit must be on the winning side of the price" };
    const notional = price * qty;
    const margin = notional / settings.leverage;
    const entryFee = fee(notional);
    const equity = cash; // free margin check against realised cash minus margin in use (conservative: ignores open profit)
    if (margin + entryFee > equity - usedMargin()) return { ok: false, error: "Not enough free margin" };
    cash -= entryFee;
    const p = { id: "p" + seq++, sym, side, qty, entry: price, sl, tp, openedAt: now(), fees: entryFee };
    positions.push(p);
    return { ok: true, position: { ...p } };
  }

  function closeAt(p, price, reason) {
    const exitFee = fee(price * p.qty);
    const pnl = upnl(p, price) - exitFee;
    cash += upnl(p, price) - exitFee;
    positions = positions.filter((x) => x !== p);
    const rec = { ...p, exit: price, closedAt: now(), reason, pnl: pnl - p.fees, fees: p.fees + exitFee };
    history.push(rec);
    if (history.length > PAPER_MAX_HISTORY) history.splice(0, history.length - PAPER_MAX_HISTORY);
    return rec;
  }

  /** Close one position at `price` (manual). */
  function close(id, price) {
    const p = positions.find((x) => x.id === id);
    if (!p) return { ok: false, error: "Position not found" };
    if (!pos(price)) return { ok: false, error: "No live price for " + p.sym + " yet" };
    return { ok: true, closed: closeAt(p, price, "manual") };
  }

  /** Price update for a symbol: fills stop-loss / take-profit (stop first). Returns closed records. */
  function onPrice(sym, price) {
    if (!pos(price)) return [];
    const out = [];
    for (const p of positions.filter((x) => x.sym === sym)) {
      const long = p.side === "long";
      const hitSl = p.sl !== null && (long ? price <= p.sl : price >= p.sl);
      const hitTp = p.tp !== null && (long ? price >= p.tp : price <= p.tp);
      if (hitSl) out.push(closeAt(p, p.sl, "stop"));
      else if (hitTp) out.push(closeAt(p, p.tp, "target"));
    }
    return out;
  }

  /** Change SL/TP of an open position. */
  function modify(id, o, price) {
    const p = positions.find((x) => x.id === id);
    if (!p) return { ok: false, error: "Position not found" };
    const ref = pos(price) ? price : p.entry;
    const sl = o.sl == null || o.sl === "" ? null : +o.sl;
    const tp = o.tp == null || o.tp === "" ? null : +o.tp;
    if (sl !== null && !(pos(sl) && (p.side === "long" ? sl < ref : sl > ref))) return { ok: false, error: "Stop loss must be on the losing side of the price" };
    if (tp !== null && !(pos(tp) && (p.side === "long" ? tp > ref : tp < ref))) return { ok: false, error: "Take profit must be on the winning side of the price" };
    p.sl = sl;
    p.tp = tp;
    return { ok: true, position: { ...p } };
  }

  function reset(raw) {
    settings = normalizePaperSettings(raw || settings);
    cash = settings.balance;
    positions = [];
    history = [];
    seq = 1;
  }

  /** Render-ready account view; `prices(sym)` returns the latest server price. */
  function snapshot(prices) {
    const open = positions.map((p) => {
      const px = prices(p.sym);
      return { ...p, price: pos(px) ? px : null, upnl: upnl(p, px) };
    });
    const u = open.reduce((a, p) => a + p.upnl, 0);
    const used = usedMargin();
    const closed = history.filter((h) => fin(h.pnl));
    const wins = closed.filter((h) => h.pnl > 0).length;
    return {
      settings: { ...settings },
      balance: cash,
      equity: cash + u,
      upnl: u,
      usedMargin: used,
      freeMargin: cash + u - used,
      realized: cash - settings.balance,
      positions: open,
      history: history.slice(-100).reverse(),
      stats: { trades: closed.length, winRate: closed.length ? (wins / closed.length) * 100 : 0 },
    };
  }

  function serialize() {
    return { settings, cash, positions, history, seq };
  }

  return { marketOrder, close, modify, onPrice, reset, snapshot, serialize, symbols: () => [...new Set(positions.map((p) => p.sym))] };
}
