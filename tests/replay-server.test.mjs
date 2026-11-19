// tests/replay-server.test.mjs — Task 18 comprehensive tests for shared/replay.js.
// Verifies stop-before-target tie-breaking, gap-open fills, Long & Short fills, pending limit/stop
// orders & cancellation, risk sizing, fee accounting, UI-08 window metadata, backward seek rewind,
// session summary stats, and exact mathematical parity with index.html btOpenPnl / posCalc / posState.

import assert from "node:assert/strict";
import {
  createReplaySession,
  btOpenPnl,
  posCalc,
  posState,
  calcAtrAt,
  calcRiskQty,
  MAX_REPLAY_BARS,
  MAX_OPEN_POSITIONS,
  MAX_PENDING_ORDERS,
} from "../shared/replay.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, "-", err && err.stack ? err.stack : err);
  }
}

function approx(actual, expected, eps = 1e-9, msg = "") {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${msg ? msg + ": " : ""}expected ${expected}, got ${actual} (diff=${Math.abs(actual - expected)})`
  );
}

// Helper: daily UTC bars starting 2026-01-01T00:00:00Z
const DAY = 86400;
const BASE_T = Date.UTC(2026, 0, 1) / 1000;
function bar(dayOffset, o, h, l, c, v = 1000) {
  return { t: BASE_T + dayOffset * DAY, o, h, l, c, v };
}

test("UI-08 window metadata: totalBars, replayableBars, fromDate, toDate, currentIndex, currentBar", () => {
  const bars = [
    bar(0, 100, 102, 99, 101),   // 2026-01-01
    bar(1, 101, 104, 100, 103),  // 2026-01-02
    bar(2, 103, 105, 102, 104),  // 2026-01-03
    bar(3, 104, 107, 103, 106),  // 2026-01-04
    bar(4, 106, 108, 105, 107),  // 2026-01-05
    bar(5, 107, 110, 106, 109),  // 2026-01-06
  ];

  // Also test tuple inputs & unsorted deduplication
  const tupleBars = [
    [bars[2].t, 103, 105, 102, 104, 500],
    [bars[0].t, 100, 102, 99, 101, 500],
    [bars[5].t, 107, 110, 106, 109, 500],
    [bars[1].t, 101, 104, 100, 103, 500],
    [bars[4].t, 106, 108, 105, 107, 500],
    [bars[3].t, 104, 107, 103, 106, 500],
  ];

  const ses = createReplaySession({
    symbol: "btcusdt",
    tf: "1D",
    bars: tupleBars,
    startIndex: 2,
    balance: 10000,
    riskPct: 1,
    feePct: 0.05,
  });

  const w = ses.window;
  assert.equal(w.symbol, "BTCUSDT");
  assert.equal(w.tf, "1D");
  assert.equal(w.totalBars, 6);
  assert.equal(w.replayableBars, 3); // bars 3, 4, 5 ahead of startIndex=2
  assert.equal(w.remainingBars, 3);
  assert.equal(w.fromDate, "2026-01-01");
  assert.equal(w.toDate, "2026-01-06");
  assert.equal(w.currentIndex, 2);
  assert.equal(w.currentBar.c, 104);

  ses.step(2);
  assert.equal(ses.window.currentIndex, 4);
  assert.equal(ses.window.remainingBars, 1);
  assert.equal(ses.window.replayableBars, 3);
  assert.equal(ses.currentBar.c, 107);

  // Empty bars edge case
  const empty = createReplaySession({ symbol: "EURUSD", tf: "1H", bars: [] });
  assert.equal(empty.window.totalBars, 0);
  assert.equal(empty.window.replayableBars, 0);
  assert.equal(empty.window.fromDate, null);
  assert.equal(empty.window.toDate, null);
  assert.equal(empty.window.currentIndex, -1);
  assert.equal(empty.window.currentBar, null);
});

test("Tie-breaking rule: Stop Loss fills BEFORE Take Profit when both are inside a single bar (Long & Short)", () => {
  // Bar 0: entry at close 100
  // Bar 1: wide range L=90, H=120 -> touches BOTH SL and TP on same bar!
  const bars = [
    bar(0, 99, 101, 98, 100),
    bar(1, 100, 120, 90, 115),
    bar(2, 115, 118, 114, 117),
  ];

  // Long: entry 100, SL 95, TP 110 -> Bar 1 has L=90 <= 95 AND H=120 >= 110 -> MUST fill SL at 95!
  const longSes = createReplaySession({ symbol: "BTCUSDT", tf: "1D", bars, startIndex: 0, balance: 10000, feePct: 0 });
  const longOrd = longSes.openOrder({ side: "long", type: "market", sl: 95, tp: 110, qty: 10 });
  assert.equal(longOrd.status, "filled");
  const longStep = longSes.step(1);
  assert.equal(longStep.fills.length, 1);
  assert.equal(longStep.fills[0].why, "stop");
  assert.equal(longStep.fills[0].exit, 95);
  approx(longStep.fills[0].pnl, -50);
  assert.equal(longSes.positions.length, 0);

  // Short: entry 100, SL 105, TP 92 -> Bar 1 has H=120 >= 105 AND L=90 <= 92 -> MUST fill SL at 105!
  const shortSes = createReplaySession({ symbol: "BTCUSDT", tf: "1D", bars, startIndex: 0, balance: 10000, feePct: 0 });
  shortSes.openOrder({ side: "short", type: "market", sl: 105, tp: 92, qty: 10 });
  const shortStep = shortSes.step(1);
  assert.equal(shortStep.fills.length, 1);
  assert.equal(shortStep.fills[0].why, "stop");
  assert.equal(shortStep.fills[0].exit, 105);
  approx(shortStep.fills[0].pnl, -50);
});

test("Gap-open fill pricing: gaps past SL or TP fill at bar Open (exact btSeek parity)", () => {
  // Long gap down below SL: entry 100, SL 95, next bar opens at 92 -> fills at 92!
  const gapDownBars = [
    bar(0, 99, 101, 98, 100),
    bar(1, 92, 94, 91, 93),
  ];
  const s1 = createReplaySession({ symbol: "AAPL", tf: "1D", bars: gapDownBars, startIndex: 0, balance: 10000, feePct: 0 });
  s1.openOrder({ side: "long", sl: 95, tp: 110, qty: 10 });
  const r1 = s1.step(1);
  assert.equal(r1.fills[0].why, "stop");
  assert.equal(r1.fills[0].exit, 92);
  approx(r1.fills[0].pnl, -80);

  // Long gap up above TP: entry 100, SL 95, TP 110, next bar opens at 114 -> fills at 114!
  const gapUpBars = [
    bar(0, 99, 101, 98, 100),
    bar(1, 114, 116, 113, 115),
  ];
  const s2 = createReplaySession({ symbol: "AAPL", tf: "1D", bars: gapUpBars, startIndex: 0, balance: 10000, feePct: 0 });
  s2.openOrder({ side: "long", sl: 95, tp: 110, qty: 10 });
  const r2 = s2.step(1);
  assert.equal(r2.fills[0].why, "target");
  assert.equal(r2.fills[0].exit, 114);
  approx(r2.fills[0].pnl, 140);

  // Short gap up above SL: entry 100, SL 105, next bar opens at 108 -> fills at 108!
  const shortGapUp = [
    bar(0, 99, 101, 98, 100),
    bar(1, 108, 110, 107, 109),
  ];
  const s3 = createReplaySession({ symbol: "AAPL", tf: "1D", bars: shortGapUp, startIndex: 0, balance: 10000, feePct: 0 });
  s3.openOrder({ side: "short", sl: 105, tp: 90, qty: 10 });
  const r3 = s3.step(1);
  assert.equal(r3.fills[0].why, "stop");
  assert.equal(r3.fills[0].exit, 108);
  approx(r3.fills[0].pnl, -80);

  // Short gap down below TP: entry 100, SL 105, TP 90, next bar opens at 86 -> fills at 86!
  const shortGapDown = [
    bar(0, 99, 101, 98, 100),
    bar(1, 86, 88, 85, 87),
  ];
  const s4 = createReplaySession({ symbol: "AAPL", tf: "1D", bars: shortGapDown, startIndex: 0, balance: 10000, feePct: 0 });
  s4.openOrder({ side: "short", sl: 105, tp: 90, qty: 10 });
  const r4 = s4.step(1);
  assert.equal(r4.fills[0].why, "target");
  assert.equal(r4.fills[0].exit, 86);
  approx(r4.fills[0].pnl, 140);
});

test("Risk sizing, fee accounting, openPnl, manual close, and session summary stats", () => {
  const bars = [
    bar(0, 99, 101, 98, 100),
    bar(1, 100, 106, 99, 105),   // openPnl check at close 105
    bar(2, 105, 112, 104, 110),  // Long TP=110 hit!
    bar(3, 110, 113, 109, 112),  // Short entry at 112, SL=117, TP=102
    bar(4, 112, 118, 111, 116),  // Short SL=117 hit!
    bar(5, 116, 121, 115, 120),  // Long entry at 120, manual close on bar 6 at 126
    bar(6, 120, 127, 119, 126),
  ];

  const ses = createReplaySession({
    symbol: "ETHUSDT",
    tf: "1D",
    bars,
    startIndex: 0,
    balance: 10000,
    riskPct: 2, // $200 risk on $10,000
    feePct: 0.1, // 0.1% per side
  });

  // Trade 1: Long at 100, SL 95 (stopDist=5) -> riskAmt = $200 -> qty = 200 / 5 = 40
  const o1 = ses.openOrder({ side: "long", sl: 95, tp: 110 });
  assert.equal(o1.qty, 40);
  approx(o1.feeIn, 100 * 40 * 0.001); // $4.00 entry fee

  // Step to bar 1 (close 105): check live openPnl matches btOpenPnl exactly!
  const st1 = ses.step(1);
  const expectedOpen1 = (105 - 100) * 40 - 4 - 105 * 40 * 0.001; // 200 - 4 - 4.2 = 191.8
  approx(st1.openPnl, expectedOpen1);
  approx(st1.openPnl, btOpenPnl(ses.positions[0], 105, 0.1));
  approx(st1.equity, 10000 + expectedOpen1);

  // Step to bar 2: TP=110 hit!
  const st2 = ses.step(1);
  assert.equal(st2.fills.length, 1);
  const t1 = st2.fills[0];
  assert.equal(t1.why, "target");
  const t1Fee = 100 * 40 * 0.001 + 110 * 40 * 0.001; // 4 + 4.4 = 8.4
  const t1Pnl = (110 - 100) * 40 - t1Fee; // 400 - 8.4 = 391.6
  approx(t1.fees, t1Fee, 1e-6);
  approx(t1.pnl, t1Pnl, 1e-6);
  approx(ses.equity, 10000 + t1Pnl, 1e-6);

  // Step to bar 3: Short at 112, SL 117, TP 102 with explicit riskPct=1%
  ses.step(1);
  const o2 = ses.openOrder({ side: "short", sl: 117, tp: 102, riskPct: 1 });
  const expectedQty2 = calcRiskQty({ balance: 10000 + t1Pnl, riskPct: 1, entry: 112, sl: 117 });
  assert.equal(o2.qty, expectedQty2);

  // Step to bar 4: Short SL=117 hit!
  const st4 = ses.step(1);
  assert.equal(st4.fills.length, 1);
  const t2 = st4.fills[0];
  assert.equal(t2.why, "stop");
  const t2Fee = 112 * expectedQty2 * 0.001 + 117 * expectedQty2 * 0.001;
  const t2Pnl = -1 * (117 - 112) * expectedQty2 - t2Fee;
  approx(t2.pnl, t2Pnl, 1e-6);

  // Step to bar 5: Long at 120, qty=10, then step to bar 6 and manually close
  ses.step(1);
  const o3 = ses.openOrder({ side: "long", qty: 10 });
  ses.step(1);
  const t3 = ses.closePosition(o3.id);
  assert.equal(t3.why, "manual");
  assert.equal(t3.exit, 126);
  const t3Pnl = (126 - 120) * 10 - (120 * 10 * 0.001 + 126 * 10 * 0.001);
  approx(t3.pnl, t3Pnl, 1e-6);

  // Check session summary stats
  const stats = ses.getStats();
  assert.equal(stats.trades.length, 3);
  assert.equal(stats.wins, 2);
  assert.equal(stats.losses, 1);
  approx(stats.winRate, 2 / 3);
  const net = t1Pnl + t2Pnl + t3Pnl;
  approx(stats.netPnl, net, 1e-6);
  approx(stats.expectancy, net / 3, 1e-6);
  approx(stats.profitFactor, (t1Pnl + t3Pnl) / Math.abs(t2Pnl), 1e-6);
  // Peak after Trade 1 was 10000 + t1Pnl; Trade 2 lost |t2Pnl| -> maxDrawdown === |t2Pnl|!
  approx(stats.maxDrawdown, Math.abs(t2Pnl), 1e-6);
  assert.equal(stats.equityCurve.length, 4); // start + 3 closed trades
  approx(stats.equityCurve[3].equity, 10000 + net, 1e-6);
});

test("Pending limit & stop orders: trigger, gap-through fill, and cancelOrder(id)", () => {
  const bars = [
    bar(0, 100, 102, 99, 101),
    bar(1, 101, 103, 97, 98),   // triggers Long Limit @ 98
    bar(2, 98, 106, 97, 105),   // hits Long TP @ 105!
    bar(3, 105, 106, 104, 105),
    bar(4, 105, 111, 104, 110), // triggers Long Stop @ 108
  ];

  const ses = createReplaySession({ symbol: "SOLUSDT", tf: "1D", bars, startIndex: 0, balance: 10000, feePct: 0 });

  // Place two pending orders: a Long Limit @ 98 and a Short Limit @ 120 (which we will cancel)
  const lim = ses.openOrder({ side: "long", type: "limit", entry: 98, sl: 94, tp: 105, qty: 10 });
  const toCancel = ses.openOrder({ side: "short", type: "limit", entry: 120, sl: 125, tp: 110, qty: 5 });
  assert.equal(lim.status, "pending");
  assert.equal(ses.pendingOrders.length, 2);

  const cancelled = ses.cancelOrder(toCancel.id);
  assert.equal(cancelled.id, toCancel.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(ses.pendingOrders.length, 1);

  // Step to bar 1 -> Long Limit @ 98 triggers!
  const s1 = ses.step(1);
  assert.equal(s1.triggeredOrders.length, 1);
  assert.equal(s1.triggeredOrders[0].position.entry, 98);
  assert.equal(ses.pendingOrders.length, 0);
  assert.equal(ses.positions.length, 1);

  // Step to bar 2 -> TP @ 105 fills!
  const s2 = ses.step(1);
  assert.equal(s2.fills.length, 1);
  assert.equal(s2.fills[0].why, "target");
  approx(s2.fills[0].pnl, 70);

  // Step to bar 3 and place Long Stop @ 108
  ses.step(1);
  const stp = ses.openOrder({ side: "long", type: "stop", entry: 108, sl: 103, tp: 115, qty: 10 });
  assert.equal(stp.status, "pending");

  // Step to bar 4 -> H=111 >= 108 triggers Long Stop @ 108!
  const s4 = ses.step(1);
  assert.equal(s4.triggeredOrders.length, 1);
  assert.equal(s4.triggeredOrders[0].position.entry, 108);
  approx(s4.openPnl, (110 - 108) * 10);
});

test("Seek backward rewinds closed trades into open positions and drops future orders cleanly", () => {
  const bars = [
    bar(0, 100, 101, 99, 100),
    bar(1, 100, 104, 99, 103),
    bar(2, 103, 111, 102, 110), // hits TP=110
    bar(3, 110, 112, 108, 109),
  ];

  const ses = createReplaySession({ symbol: "BTCUSDT", tf: "1D", bars, startIndex: 0, balance: 10000, feePct: 0 });
  ses.openOrder({ side: "long", sl: 95, tp: 110, qty: 10 });
  ses.seek(3);
  assert.equal(ses.trades.length, 1);
  assert.equal(ses.positions.length, 0);

  // Rewind to bar 1 (before TP hit on bar 2): trade must reopen as active position!
  ses.seek(1);
  assert.equal(ses.trades.length, 0);
  assert.equal(ses.positions.length, 1);
  assert.equal(ses.positions[0].entry, 100);
  approx(ses.openPnl, 30); // (103 - 100) * 10

  // Step forward again to bar 2 -> TP hits again identically!
  const fwd = ses.step(1);
  assert.equal(fwd.fills.length, 1);
  assert.equal(fwd.fills[0].why, "target");
  approx(fwd.fills[0].pnl, 100);
});

test("Exact parity with index.html btOpenPnl, posCalc, and posState", () => {
  // Reference implementations copied verbatim from index.html lines 3332-3348 & 5018-5024
  function refBtOpenPnl(pos, px, feePct) {
    if (!pos || !(px > 0)) return 0;
    const d = pos.side === "long" ? 1 : -1;
    const gross = d * (px - pos.entry) * pos.qty;
    const exitFee = px * pos.qty * (feePct / 100);
    return gross - pos.feeIn - exitFee;
  }
  function refPosCalc(o) {
    const L = o.side !== "short", E = +o.entry, T = +o.tp, Sx = +o.sl, acct = +o.acct || 0, lot = +o.lot || 1, pv = +o.pv || 1, tick = +o.tick || 0.01, prec = o.prec == null ? 2 : +o.prec;
    const riskAmt = o.ru === "$" ? (+o.risk || 0) : acct * (+o.risk || 0) / 100, dist = L ? E - Sx : Sx - E, gain = L ? T - E : E - T;
    let qty = dist > 0 ? riskAmt / (dist * pv) / lot : 0; if (+o.lev > 0 && E > 0) qty = Math.min(qty, acct * o.lev / E * pv / lot);
    const f = Math.pow(10, prec); qty = Math.floor(qty * f + 1e-9) / f;
    const per = pv * lot * qty;
    return {
      riskAmt, qty, rr: dist > 0 ? gain / dist : 0,
      tpOff: Math.abs(T - E), tpPct: E ? Math.abs(T - E) / E * 100 : 0, tpTicks: Math.round(Math.abs(T - E) / tick),
      slOff: Math.abs(E - Sx), slPct: E ? Math.abs(E - Sx) / E * 100 : 0, slTicks: Math.round(Math.abs(E - Sx) / tick),
      pnlTP: gain * per, pnlSL: -dist * per, amtTP: acct + gain * per, amtSL: acct - dist * per,
      pnlAt: (px) => (L ? px - E : E - px) * per,
    };
  }
  function refPosState(bars, side, E, T, Sx, t0, t1) {
    const L = side !== "short"; let last = null, n = 0;
    for (const b of bars) {
      if (b.t <= t0) continue;
      if (b.t > t1) break; n++; last = b;
      const hitS = L ? b.l <= Sx : b.h >= Sx, hitT = L ? b.h >= T : b.l <= T;
      if (hitS) return { state: "sl", t: b.t, px: Sx };
      if (hitT) return { state: "tp", t: b.t, px: T };
    }
    return n ? { state: "open", t: last.t, px: last.c } : { state: "none" };
  }

  // 1. btOpenPnl parity across Long & Short with fees
  for (const pos of [
    { side: "long", entry: 91250.5, qty: 0.42, feeIn: 19.162605 },
    { side: "short", entry: 1.0845, qty: 25000, feeIn: 13.55625 },
  ]) {
    for (const px of [pos.entry * 0.97, pos.entry, pos.entry * 1.04]) {
      for (const fee of [0, 0.05, 0.1]) {
        approx(btOpenPnl(pos, px, fee), refBtOpenPnl(pos, px, fee), 1e-12, "btOpenPnl parity");
      }
    }
  }

  // 2. posCalc parity across % risk, $ risk, leverage cap, FX & futures point values
  const posCases = [
    { side: "long", entry: 100, tp: 112, sl: 96, acct: 25000, risk: 1.5, ru: "%", lot: 1, pv: 1, lev: 0, tick: 0.01, prec: 2 },
    { side: "short", entry: 1.0850, tp: 1.0750, sl: 1.0900, acct: 10000, risk: 150, ru: "$", lot: 1000, pv: 1, lev: 30, tick: 0.0001, prec: 3 },
    { side: "long", entry: 5200, tp: 5240, sl: 5180, acct: 50000, risk: 1, ru: "%", lot: 1, pv: 50, lev: 5, tick: 0.25, prec: 0 },
  ];
  for (const tc of posCases) {
    const got = posCalc(tc);
    const exp = refPosCalc(tc);
    for (const k of ["riskAmt", "qty", "rr", "tpOff", "tpPct", "tpTicks", "slOff", "slPct", "slTicks", "pnlTP", "pnlSL", "amtTP", "amtSL"]) {
      approx(got[k], exp[k], 1e-12, `posCalc.${k}`);
    }
    approx(got.pnlAt(tc.entry * 1.02), exp.pnlAt(tc.entry * 1.02), 1e-12, "posCalc.pnlAt");
  }

  // 3. posState parity (including tie bar -> sl first, tp bar, open, none)
  const bars = [
    bar(0, 100, 102, 98, 100),
    bar(1, 100, 103, 99, 102),
    bar(2, 102, 115, 92, 108), // tie bar for SL=95, TP=110
    bar(3, 108, 114, 106, 112),
  ];
  assert.deepEqual(
    posState(bars, "long", 100, 110, 95, bars[0].t, bars[3].t),
    refPosState(bars, "long", 100, 110, 95, bars[0].t, bars[3].t)
  );
  assert.deepEqual(
    posState(bars, "long", 100, 110, 95, bars[0].t, bars[1].t),
    refPosState(bars, "long", 100, 110, 95, bars[0].t, bars[1].t)
  );
  assert.deepEqual(
    posState(bars, "long", 100, 110, 95, bars[3].t, bars[3].t),
    refPosState(bars, "long", 100, 110, 95, bars[3].t, bars[3].t)
  );
  assert.deepEqual(
    posState(bars, "short", 102, 95, 112, bars[1].t, bars[3].t),
    refPosState(bars, "short", 102, 95, 112, bars[1].t, bars[3].t)
  );

  // 4. calcAtrAt sanity
  const atr = calcAtrAt(bars, 4);
  assert.ok(Number.isFinite(atr) && atr > 0);
});

test("Hardening: intraday-triggered pending order does NOT exit at pre-trigger bar open (allowGapOpenExit: false)", () => {
  // Bar 0: close 101; place Long Limit @ 98, SL 95, TP 105.
  // Bar 1: opens at 108 (above TP!), dips to 97 (triggers Long Limit @ 98), high 108 (hits TP @ 105).
  // Must exit at TP=105, NOT at pre-trigger b.o=108!
  const bars = [
    bar(0, 100, 102, 99, 101),
    bar(1, 108, 108, 97, 100),
  ];
  const ses = createReplaySession({ symbol: "BTCUSDT", tf: "1D", bars, startIndex: 0, balance: 10000, feePct: 0 });
  ses.openOrder({ side: "long", type: "limit", entry: 98, sl: 95, tp: 105, qty: 10 });
  const res = ses.step(1);
  assert.equal(res.triggeredOrders.length, 1);
  assert.equal(res.triggeredOrders[0].position.entry, 98);
  assert.equal(res.fills.length, 1);
  assert.equal(res.fills[0].why, "target");
  assert.equal(res.fills[0].exit, 105, "Intraday-triggered pending order must exit at TP=105, not pre-trigger b.o=108");
  approx(res.fills[0].pnl, 70);
});

test("Hardening: updateStops() validates against current market price (breakeven & trailing stops allowed)", () => {
  const bars = [
    bar(0, 99, 101, 98, 100),
    bar(1, 100, 112, 99, 110), // Long in profit: curPx = 110
    bar(2, 110, 111, 103, 104), // Pulls back to hit trailing SL @ 105
  ];
  const ses = createReplaySession({ symbol: "BTCUSDT", tf: "1D", bars, startIndex: 0, balance: 10000, feePct: 0 });
  const ord = ses.openOrder({ side: "long", sl: 95, tp: 120, qty: 10 });
  ses.step(1); // curPx = 110

  // Breakeven stop (sl === entry = 100 < curPx 110) must succeed!
  const be = ses.updateStops(ord.id, { sl: 100 });
  assert.equal(be.sl, 100);
  assert.equal(be.sl0, 95, "Initial stop sl0 preserved for R-multiple");

  // Trailing profit stop (sl = 105 > entry 100, < curPx 110) must succeed!
  const trail = ses.updateStops(ord.id, { sl: 105 });
  assert.equal(trail.sl, 105);

  // Stop at or above current market price (110) must be rejected!
  assert.throws(() => ses.updateStops(ord.id, { sl: 110 }), /current price/);
  assert.throws(() => ses.updateStops(ord.id, { sl: 112 }), /current price/);
  // TP at or below current market price (110) must be rejected!
  assert.throws(() => ses.updateStops(ord.id, { tp: 109 }), /current price/);

  // Step to bar 2 -> trailing SL @ 105 fills profitably!
  const st2 = ses.step(1);
  assert.equal(st2.fills.length, 1);
  assert.equal(st2.fills[0].why, "stop");
  assert.equal(st2.fills[0].exit, 105);
  approx(st2.fills[0].pnl, 50);
});

test("Hardening: NaN/Infinity/<=0/null handling without silent bad defaults or null->0 false TP/SL", () => {
  // btOpenPnl
  assert.equal(btOpenPnl(null, 100, 0.05), 0);
  assert.equal(btOpenPnl({ side: "long", entry: NaN, qty: 10 }, 100, 0.05), 0);
  assert.equal(btOpenPnl({ side: "long", entry: 100, qty: -5 }, 100, 0.05), 0);
  assert.equal(btOpenPnl({ side: "long", entry: 100, qty: 10 }, Infinity, 0.05), 0);

  // posCalc
  const nullCalc = posCalc(null);
  assert.equal(nullCalc.qty, 0);
  assert.equal(nullCalc.pnlAt(NaN), 0);
  const badCalc = posCalc({ entry: NaN, tp: Infinity, sl: -10, acct: -100, risk: NaN, prec: 999 });
  assert.equal(badCalc.qty, 0);
  assert.equal(badCalc.rr, 0);

  // posState: null/undefined/NaN SL or TP must NEVER coerce to 0
  const bars = [
    bar(0, 100, 102, 98, 100),
    bar(1, 100, 105, 95, 103),
  ];
  assert.equal(posState(bars, "short", 100, null, null, bars[0].t, bars[1].t).state, "open");
  assert.equal(posState(bars, "long", 100, undefined, NaN, bars[0].t, bars[1].t).state, "open");
  assert.equal(posState(null, "long", 100, 110, 95, 0, 10).state, "none");

  // calcAtrAt & calcRiskQty
  assert.equal(calcAtrAt([], 1), 0);
  assert.equal(calcAtrAt(bars, 0), 0);
  assert.equal(calcAtrAt([null, { h: NaN, l: NaN, c: NaN }], 2), 0);
  assert.equal(calcRiskQty({ balance: NaN, riskPct: 1, entry: 100 }), 0);
  assert.equal(calcRiskQty({ balance: 10000, riskPct: -1, entry: 100 }), 0);
  assert.equal(calcRiskQty({ balance: 10000, riskPct: 1, entry: 0 }), 0);
  assert.equal(calcRiskQty({ balance: 10000, riskPct: 1, entry: 100, sl: -5 }), 0);

  // openOrder & closePosition reject NaN/Infinity/<=0/""
  const ses = createReplaySession({ symbol: "BTCUSDT", tf: "1D", bars, startIndex: 0, balance: 10000, feePct: 0 });
  assert.throws(() => ses.openOrder(null), /must be an object/);
  assert.throws(() => ses.openOrder({ side: "long", qty: NaN }), /qty/);
  assert.throws(() => ses.openOrder({ side: "long", qty: 0 }), /qty/);
  assert.throws(() => ses.openOrder({ side: "long", riskPct: -1 }), /riskPct/);
  assert.throws(() => ses.openOrder({ side: "long", entry: Infinity }), /entry/);
  assert.throws(() => ses.openOrder({ side: "long", type: "limit", entry: "" }), /entry/);

  const ord = ses.openOrder({ side: "long", qty: 1 });
  assert.throws(() => ses.closePosition(ord.id, { price: NaN }), /positive finite/);
  assert.throws(() => ses.closePosition(ord.id, { price: -10 }), /positive finite/);
  assert.throws(() => ses.closePosition(ord.id, { price: "" }), /positive finite/);
});

test("Hardening: caps (MAX_REPLAY_BARS, MAX_OPEN_POSITIONS, MAX_PENDING_ORDERS) and JSON-safe profitFactor", () => {
  // MAX_REPLAY_BARS cap
  const tooMany = new Array(MAX_REPLAY_BARS + 1);
  assert.throws(() => createReplaySession({ symbol: "BTCUSDT", tf: "1D", bars: tooMany }), /MAX_REPLAY_BARS/);

  const bars = [
    bar(0, 100, 102, 99, 100),
    bar(1, 100, 112, 99, 110),
  ];
  const ses = createReplaySession({ symbol: "BTCUSDT", tf: "1D", bars, startIndex: 0, balance: 10000, feePct: 0 });

  // MAX_OPEN_POSITIONS cap
  for (let i = 0; i < MAX_OPEN_POSITIONS; i++) {
    ses.openOrder({ side: "long", qty: 1 });
  }
  assert.throws(() => ses.openOrder({ side: "long", qty: 1 }), /Max open positions/);

  // MAX_PENDING_ORDERS cap
  for (let i = 0; i < MAX_PENDING_ORDERS; i++) {
    ses.openOrder({ side: "long", type: "limit", entry: 90, qty: 1 });
  }
  assert.throws(() => ses.openOrder({ side: "long", type: "limit", entry: 90, qty: 1 }), /Max pending orders/);

  // JSON-safe profitFactor on all-winning session (must be null, never Infinity)
  const winSes = createReplaySession({ symbol: "BTCUSDT", tf: "1D", bars, startIndex: 0, balance: 10000, feePct: 0 });
  winSes.openOrder({ side: "long", sl: 95, tp: 110, qty: 10 });
  winSes.step(1);
  const stats = winSes.getStats();
  assert.equal(stats.wins, 1);
  assert.equal(stats.losses, 0);
  assert.equal(stats.profitFactor, null, "Zero-loss winning session must return null profitFactor, never Infinity");
  assert.equal(JSON.parse(JSON.stringify(stats)).profitFactor, null);
});

console.log(`\nreplay-server: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
