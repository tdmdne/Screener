// tests/vs-strategy.test.mjs — E-12 Vektor Script strategy tester (server-side): entry_/exit_ statements in the runtime
// and the next-bar-open fill engine in shared/vs/strategy.js. Run: node tests/vs-strategy.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { vsBacktest, vsTradesCsv } from "../shared/vs/strategy.js";
import { vsCompute } from "../shared/vs/index.js";

const T0 = 1_763_000_000;
const mk = (closes) => closes.map((c, i) => ({ t: T0 + i * 3600, o: i ? closes[i - 1] : c, h: c + 1, l: c - 1, c, v: 1 }));
const sig = (n, idx) => Float64Array.from({ length: n }, (_, i) => (idx.includes(i) ? 1 : 0));

test("signal on bar i fills at bar i+1 open (no look-ahead); exit closes; metrics add up", () => {
  const bars = mk([10, 11, 12, 13, 12, 11, 10]);
  const r = vsBacktest(bars, { entry_long: sig(7, [0]), exit_long: sig(7, [3]) });
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.equal(t.side, "long");
  assert.equal(t.entryT, bars[1].t, "filled on the next bar");
  assert.equal(t.entryP, bars[1].o);
  assert.equal(t.exitT, bars[4].t);
  assert.equal(t.exitP, bars[4].o);
  assert.equal(t.pnl, 13 - 10);
  assert.equal(r.metrics.netProfit, 3);
  assert.equal(r.metrics.winRate, 100);
  assert.equal(r.equity.length, 6);
});

test("opposite entry reverses; open position reported, not counted as a trade; commission applied", () => {
  const bars = mk([100, 100, 110, 120, 110, 100, 90]);
  const r = vsBacktest(bars, { entry_long: sig(7, [0]), entry_short: sig(7, [3]) }, { commissionPct: 0.1, qty: 2 });
  assert.equal(r.trades.length, 1, "long closed by the short entry");
  assert.equal(r.trades[0].reason, "reverse");
  const t = r.trades[0];
  assert.ok(Math.abs(t.pnl - ((120 - 100) * 2 - (100 + 120) * 2 * 0.001)) < 1e-9, "fees on both sides");
  assert.equal(r.openPosition.side, "short");
  assert.equal(r.openPosition.entryP, 120);
  assert.equal(r.metrics.openPnl, (120 - 90) * 2);
  assert.ok(r.metrics.maxDrawdown >= 0);
});

test("simultaneous long and short entries are ignored; no signals means no trades", () => {
  const bars = mk([1, 2, 3, 4]);
  assert.equal(vsBacktest(bars, { entry_long: sig(4, [0]), entry_short: sig(4, [0]) }).trades.length, 0);
  const r = vsBacktest(bars, {});
  assert.equal(r.trades.length, 0);
  assert.equal(r.metrics.profitFactor, 0);
});

test("CSV export", () => {
  const bars = mk([10, 11, 12, 13]);
  const csv = vsTradesCsv(vsBacktest(bars, { entry_long: sig(4, [0]), exit_long: sig(4, [1]) }).trades);
  const lines = csv.split("\n");
  assert.equal(lines[0], "trade,side,entry_time,entry_price,exit_time,exit_price,pnl,pnl_pct,bars,reason");
  assert.match(lines[1], /^1,long,2025-11-13T\d\d:\d\d:\d\d\.000Z,10,/);
});

test("runtime: entry_/exit_ statements produce signal series; a strategy-only script is valid", () => {
  const closes = Array.from({ length: 80 }, (_, i) => 100 + 10 * Math.sin(i / 6));
  const bars = mk(closes);
  const src = 'f = ema(close, 5)\ns = ema(close, 20)\nentry_long(crossover(f, s))\nexit_long(crossunder(f, s))\nentry_long(0)';
  const res = vsCompute(src, bars, {});
  assert.equal(res.error, null, JSON.stringify(res));
  const sg = res.ok.signals;
  assert.ok(sg.entry_long instanceof Float64Array && sg.entry_long.length === 80);
  assert.ok([...sg.entry_long].some((v) => v === 1) && [...sg.exit_long].some((v) => v === 1));
  const bt = vsBacktest(bars, sg);
  assert.ok(bt.trades.length >= 1, "crossovers produce trades");
  const bad = vsCompute("entry_long()", bars, {});
  assert.ok(bad.error && /one condition/.test(bad.error));
  const reassign = vsCompute("entry_long = 1\nplot(close)", bars, {});
  assert.ok(reassign.error && /built-in name/.test(reassign.error), "statement names are reserved");
});
