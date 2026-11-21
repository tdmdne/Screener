// shared/vs/strategy.js — server-side strategy tester for Vektor Script (E-12).
// A script declares signals with entry_long(cond) / entry_short(cond) / exit_long(cond) / exit_short(cond).
// Fill model (no look-ahead): a signal true on bar i's close fills at bar i+1's open. Exits are processed before entries;
// an opposite entry closes and reverses. One position at a time, fixed quantity, optional commission (% per side).
// Open positions are marked to the last close (reported as openPnl, not as a closed trade).

export const STRATEGY_SIGNALS = Object.freeze(["entry_long", "entry_short", "exit_long", "exit_short"]);
export const MAX_STRATEGY_TRADES = 2000;

const on = (s, i) => Boolean(s && i < s.length && s[i] && !Number.isNaN(s[i]));
const fin = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * @param {Array<{t?:number,o?:number,c:number}>} bars
 * @param {{entry_long?:ArrayLike<number>,entry_short?:ArrayLike<number>,exit_long?:ArrayLike<number>,exit_short?:ArrayLike<number>}} sig
 * @param {{ qty?: number, commissionPct?: number, initialCapital?: number }} [opts]
 */
export function vsBacktest(bars, sig, opts = {}) {
  const qty = fin(opts.qty) && opts.qty > 0 ? opts.qty : 1;
  const comm = fin(opts.commissionPct) && opts.commissionPct >= 0 && opts.commissionPct < 10 ? opts.commissionPct / 100 : 0;
  const capital = fin(opts.initialCapital) && opts.initialCapital > 0 ? opts.initialCapital : 10000;
  const n = Array.isArray(bars) ? bars.length : 0;
  const trades = [];
  const equity = [];
  let pos = null; // { side: 1|-1, entryP, entryT, entryI }
  let realized = 0;
  let peak = capital;
  let maxDD = 0;
  const openAt = (i) => (fin(bars[i].o) && bars[i].o > 0 ? bars[i].o : bars[i].c);
  const close = (i, reason) => {
    const px = openAt(i);
    const gross = (px - pos.entryP) * pos.side * qty;
    const fees = (pos.entryP + px) * qty * comm;
    const pnl = gross - fees;
    realized += pnl;
    if (trades.length < MAX_STRATEGY_TRADES) {
      trades.push({
        side: pos.side > 0 ? "long" : "short",
        entryT: pos.entryT,
        entryP: pos.entryP,
        exitT: bars[i].t ?? i,
        exitP: px,
        pnl,
        pnlPct: ((px - pos.entryP) / pos.entryP) * 100 * pos.side,
        bars: i - pos.entryI,
        reason,
      });
    }
    pos = null;
  };
  const open = (i, side) => {
    pos = { side, entryP: openAt(i), entryT: bars[i].t ?? i, entryI: i };
  };
  for (let i = 1; i < n; i++) {
    const s = i - 1; // signals from the previous close fill at this open
    if (pos && pos.side > 0 && (on(sig.exit_long, s) || on(sig.entry_short, s))) close(i, on(sig.exit_long, s) ? "exit" : "reverse");
    if (pos && pos.side < 0 && (on(sig.exit_short, s) || on(sig.entry_long, s))) close(i, on(sig.exit_short, s) ? "exit" : "reverse");
    if (!pos && on(sig.entry_long, s) && !on(sig.entry_short, s)) open(i, 1);
    else if (!pos && on(sig.entry_short, s) && !on(sig.entry_long, s)) open(i, -1);
    const mark = pos ? (bars[i].c - pos.entryP) * pos.side * qty : 0;
    const eq = capital + realized + mark;
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDD) maxDD = dd;
    equity.push({ t: bars[i].t ?? i, v: eq });
  }
  const openPnl = pos && n ? (bars[n - 1].c - pos.entryP) * pos.side * qty : 0;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0);
  return {
    trades,
    equity,
    openPosition: pos ? { side: pos.side > 0 ? "long" : "short", entryT: pos.entryT, entryP: pos.entryP, openPnl } : null,
    metrics: {
      initialCapital: capital,
      netProfit: realized,
      netProfitPct: (realized / capital) * 100,
      openPnl,
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : 0,
      avgTrade: trades.length ? realized / trades.length : 0,
      largestWin: wins.length ? Math.max(...wins.map((t) => t.pnl)) : 0,
      largestLoss: losses.length ? Math.min(...losses.map((t) => t.pnl)) : 0,
      maxDrawdown: maxDD,
      maxDrawdownPct: peak > 0 ? (maxDD / peak) * 100 : 0,
      avgBarsInTrade: trades.length ? trades.reduce((a, t) => a + t.bars, 0) / trades.length : 0,
    },
  };
}

/** CSV of the trade list (one header row); values only, nothing user-supplied is interpolated. */
export function vsTradesCsv(trades) {
  const head = "trade,side,entry_time,entry_price,exit_time,exit_price,pnl,pnl_pct,bars,reason";
  const iso = (t) => (fin(t) && t > 1e9 ? new Date(t * 1000).toISOString() : String(t));
  const rows = (trades || []).map((t, i) =>
    [i + 1, t.side, iso(t.entryT), t.entryP, iso(t.exitT), t.exitP, t.pnl.toFixed(6), t.pnlPct.toFixed(4), t.bars, t.reason].join(",")
  );
  return [head, ...rows].join("\n");
}
