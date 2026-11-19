// tests/candles.test.mjs — Task 3 unit & golden parity tests for shared/market/candles.js.
// Run: node tests/candles.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  TIMEFRAMES,
  ROLLUP_TIMEFRAMES,
  normalizeTf,
  stepSeconds,
  bucketStart,
  createCandleState,
  applyTick,
  mergeBars,
  rollup,
  CandleBuilder,
  createCandleBuilder,
} from "../shared/market/candles.js";
import { INTERVAL_SECONDS } from "../shared/intervals.js";

// --- Reference ports of the 3 legacy client functions in index.html for golden parity ---

function refVtApplyTwelveDataTick(bars, price, tsSec, tf = "1m") {
  const step = INTERVAL_SECONDS[tf];
  const bucket = Math.floor(tsSec / step) * step;
  const last = bars.length ? bars[bars.length - 1] : null;
  if (!last) {
    bars.push({ t: bucket, o: price, h: price, l: price, c: price, v: 0 });
    return { gap: false, ignored: false };
  }
  if (bucket < last.t) return { gap: false, ignored: true };
  if (bucket - last.t > step * 2) return { gap: true, ignored: false };
  if (bucket === last.t) {
    last.c = price;
    last.h = Math.max(last.h, price);
    last.l = Math.min(last.l, price);
  } else {
    const open = last.c > 0 ? last.c : price;
    bars.push({ t: bucket, o: open, h: Math.max(open, price), l: Math.min(open, price), c: price, v: 0 });
  }
  return { gap: false, ignored: false };
}

function refVtMergeBars(prev, incoming, maxBars = 25000) {
  const map = new Map();
  for (const b of prev) {
    if (b && b.t != null && b.c > 0) map.set(b.t, b);
  }
  for (const b of incoming) {
    if (b && b.t != null && b.c > 0) map.set(b.t, b);
  }
  const merged = [...map.values()].sort((a, b) => a.t - b.t);
  return merged.length > maxBars ? merged.slice(-maxBars) : merged;
}

describe("shared/market/candles — timeframe normalization & bucketing", () => {
  it("normalizes canonical and case-insensitive labels while keeping 1m vs 1M distinct", () => {
    assert.deepEqual(TIMEFRAMES, ["1m", "5m", "15m", "30m", "1H", "4H", "1D", "1W", "1M"]);
    assert.deepEqual(ROLLUP_TIMEFRAMES, ["5m", "15m", "30m", "1H", "4H", "1D", "1W", "1M"]);

    assert.equal(normalizeTf("1m"), "1m");
    assert.equal(normalizeTf("1M"), "1M");
    assert.equal(stepSeconds("1m"), 60);
    assert.equal(stepSeconds("1M"), 2592000);

    assert.equal(normalizeTf("5M"), "5m");
    assert.equal(normalizeTf("15M"), "15m");
    assert.equal(normalizeTf("30M"), "30m");
    assert.equal(normalizeTf("1h"), "1H");
    assert.equal(normalizeTf("4h"), "4H");
    assert.equal(normalizeTf("1d"), "1D");
    assert.equal(normalizeTf("1w"), "1W");
    assert.equal(normalizeTf("1min"), "1m");
    assert.equal(normalizeTf("1day"), "1D");
    assert.equal(normalizeTf("1week"), "1W");
    assert.equal(normalizeTf("1month"), "1M");
    assert.equal(normalizeTf("bad"), null);
    assert.equal(stepSeconds("bad"), null);
  });

  it("aligns UTC buckets accurately for intraday, 1D, 1W (Monday UTC), and 1M (1st UTC)", () => {
    // 2026-11-18T14:37:42Z (Wednesday)
    const ts = Date.UTC(2026, 10, 18, 14, 37, 42) / 1000;
    assert.equal(bucketStart(ts, "1m"), Date.UTC(2026, 10, 18, 14, 37, 0) / 1000);
    assert.equal(bucketStart(ts, "5m"), Date.UTC(2026, 10, 18, 14, 35, 0) / 1000);
    assert.equal(bucketStart(ts, "15m"), Date.UTC(2026, 10, 18, 14, 30, 0) / 1000);
    assert.equal(bucketStart(ts, "30m"), Date.UTC(2026, 10, 18, 14, 30, 0) / 1000);
    assert.equal(bucketStart(ts, "1H"), Date.UTC(2026, 10, 18, 14, 0, 0) / 1000);
    assert.equal(bucketStart(ts, "4H"), Date.UTC(2026, 10, 18, 12, 0, 0) / 1000);
    assert.equal(bucketStart(ts, "1D"), Date.UTC(2026, 10, 18, 0, 0, 0) / 1000);
    // Monday of that week is 2026-11-16T00:00:00Z
    assert.equal(bucketStart(ts, "1W"), Date.UTC(2026, 10, 16, 0, 0, 0) / 1000);
    // Month start is 2026-11-01T00:00:00Z
    assert.equal(bucketStart(ts, "1M"), Date.UTC(2026, 10, 1, 0, 0, 0) / 1000);
    // Accepts ms timestamps cleanly
    assert.equal(bucketStart(ts * 1000, "1m"), Date.UTC(2026, 10, 18, 14, 37, 0) / 1000);
  });
});

describe("shared/market/candles — applyTick golden parity & gap rules", () => {
  it("matches legacy vtApplyTwelveDataTick bit-for-bit on contiguous ticks", () => {
    const base = 1763460000; // exact minute boundary
    const ticks = [
      { s: "EURUSD", p: 1.0850, t: base + 5 },
      { s: "EURUSD", p: 1.0862, t: base + 19 },
      { s: "EURUSD", p: 1.0841, t: base + 44 },
      { s: "EURUSD", p: 1.0855, t: base + 58 },
      // Next minute (contiguous: +1 step)
      { s: "EURUSD", p: 1.0870, t: base + 62 },
      { s: "EURUSD", p: 1.0865, t: base + 90 },
      // Out-of-order tick from previous minute -> ignored
      { s: "EURUSD", p: 1.0800, t: base + 30 },
      // Skipped 1 minute (+2 steps, still within <= 2 * step rule)
      { s: "EURUSD", p: 1.0890, t: base + 185 },
      { s: "EURUSD", p: 1.0882, t: base + 210 },
    ];

    const refBars = [];
    const serverBars = [];
    let state = createCandleState({ tf: "1m" });

    for (const tk of ticks) {
      const refRes = refVtApplyTwelveDataTick(refBars, tk.p, tk.t, "1m");
      const srvRes = applyTick(state, tk);
      state = srvRes.state;

      assert.equal(srvRes.ignored, refRes.ignored);
      assert.equal(srvRes.gap, refRes.gap);
      if (srvRes.closedBar) serverBars.push(srvRes.closedBar);
    }
    if (state.current) serverBars.push(state.current);

    assert.deepEqual(serverBars, refBars);
    // Explicitly verify zero synthetic bar was inserted for skipped minute base + 120
    assert.deepEqual(serverBars.map((b) => b.t), [base, base + 60, base + 180]);
    // TD WS ticks omit volume -> v stays 0 until REST reconciliation
    for (const b of serverBars) assert.equal(b.v, 0);
  });

  it("enforces gap rule (> 2 steps starts a new bar at tick price with NO synthetic fill)", () => {
    const base = 1763460000;
    let state = createCandleState({ tf: "1m" });

    // Minute 0
    let res = applyTick(state, { s: "EURUSD", p: 1.0850, t: base + 10 });
    state = res.state;
    assert.equal(res.gap, false);
    assert.equal(res.closedBar, null);

    res = applyTick(state, { s: "EURUSD", p: 1.0855, t: base + 40 });
    state = res.state;

    // Exact 2-step jump (base + 120) -> NOT a gap (boundary check: > step * 2)
    res = applyTick(state, { s: "EURUSD", p: 1.0860, t: base + 125 });
    state = res.state;
    assert.equal(res.gap, false);
    assert.deepEqual(res.closedBar, { t: base, o: 1.0850, h: 1.0855, l: 1.0850, c: 1.0855, v: 0 });
    assert.deepEqual(res.bar, { t: base + 120, o: 1.0855, h: 1.0860, l: 1.0855, c: 1.0860, v: 0 });

    // 3-step jump (base + 300: 300 - 120 = 180 > 120) -> GAP!
    // Must close previous bar, start new bar opening at tick price (1.1025, NOT bridging 1.0860),
    // and emit ZERO synthetic bars for base+180 or base+240.
    res = applyTick(state, { s: "EURUSD", p: 1.1025, t: base + 305 });
    state = res.state;
    assert.equal(res.gap, true);
    assert.equal(res.ignored, false);
    assert.deepEqual(res.closedBar, { t: base + 120, o: 1.0855, h: 1.0860, l: 1.0855, c: 1.0860, v: 0 });
    assert.deepEqual(res.bar, { t: base + 300, o: 1.1025, h: 1.1025, l: 1.1025, c: 1.1025, v: 0 });
  });

  it("never artificially clamps large genuine moves (AGENTS.md §3) and never mutates prior state", () => {
    const base = 1763460000;
    const s0 = createCandleState({ tf: "1m" });
    const r1 = applyTick(s0, { s: "NVDA", p: 100.0, t: base + 1 });
    const snap1 = structuredClone(r1.state);

    // +35% earnings spike inside same minute — must NOT be clamped
    const r2 = applyTick(r1.state, { s: "NVDA", p: 135.0, t: base + 15 });
    assert.deepEqual(r1.state, snap1, "prior state must remain unmutated");
    assert.equal(r2.bar.h, 135.0);
    assert.equal(r2.bar.c, 135.0);
    assert.equal(r2.bar.o, 100.0);

    // -25% reversal inside same minute — must NOT be clamped
    const r3 = applyTick(r2.state, { s: "NVDA", p: 75.0, t: base + 45 });
    assert.equal(r3.bar.h, 135.0);
    assert.equal(r3.bar.l, 75.0);
    assert.equal(r3.bar.c, 75.0);
  });

  it("rejects invalid ticks and accepts both ms timestamps and { c } tick schema", () => {
    const base = 1763460000;
    let state = createCandleState({ tf: "1m" });

    for (const bad of [null, undefined, {}, { s: "BTCUSDT", p: 0, t: base }, { s: "BTCUSDT", p: -5, t: base }, { s: "BTCUSDT", p: NaN, t: base }, { s: "BTCUSDT", p: 100, t: NaN }]) {
      const r = applyTick(state, bad);
      assert.equal(r.ignored, true);
      assert.equal(r.reason, "invalid_tick");
    }

    // Normalized schema.js tick ({ s, c, t in ms, v })
    const r1 = applyTick(state, { s: "BTCUSDT", c: 95000, t: (base + 5) * 1000, v: 1.25 });
    assert.equal(r1.ignored, false);
    assert.deepEqual(r1.bar, { t: base, o: 95000, h: 95000, l: 95000, c: 95000, v: 1.25 });

    const r2 = applyTick(r1.state, { s: "BTCUSDT", c: 95100, t: (base + 20) * 1000, v: 0.75 });
    assert.equal(r2.bar.v, 2.0);

    // ignoreVolume option forces v = 0 even when tick carries v
    const r3 = applyTick(null, { s: "EURUSD", p: 1.1, t: base + 5, v: 999 }, { ignoreVolume: true });
    assert.equal(r3.bar.v, 0);
  });
});

describe("shared/market/candles — mergeBars golden parity with vtMergeBars", () => {
  it("deduplicates by t (incoming wins for REST reconciliation), sorts ascending, no clamping", () => {
    const oldBars = [
      { t: 1763460120, o: 102, h: 103, l: 101, c: 102.5, v: 0 },
      { t: 1763460000, o: 100, h: 101, l: 99, c: 100.5, v: 10 },
      { t: 1763460060, o: 100.5, h: 102, l: 100, c: 102, v: 0 },
    ];
    const incomingBars = [
      // REST reconciliation overwrites t=1763460060 with official volume and wide un-clamped wick
      { t: 1763460060, o: 100.5, h: 125.0, l: 80.0, c: 102.1, v: 4520 },
      { t: 1763460180, o: 102.5, h: 104, l: 102, c: 103.8, v: 3100 },
    ];

    const expected = refVtMergeBars(oldBars, incomingBars);
    const actual = mergeBars(oldBars, incomingBars);
    assert.deepEqual(actual, expected);
    assert.equal(actual[1].v, 4520);
    assert.equal(actual[1].h, 125.0);
    assert.equal(actual[1].l, 80.0);

    // Drop invalid bars and apply optional maxBars cap
    const withBad = mergeBars(
      [{ t: 100, o: 10, h: 11, l: 9, c: 10, v: 1 }, { t: 200, o: 0, h: 0, l: 0, c: 0, v: 0 }, null],
      [{ t: 300, o: 12, h: 13, l: 11, c: 12.5, v: 2 }, { t: 400, o: 13, h: 14, l: 12, c: 13.5, v: 3 }],
      { maxBars: 2 },
    );
    assert.deepEqual(withBad.map((b) => b.t), [300, 400]);
  });
});

describe("shared/market/candles — rollup across all higher timeframes", () => {
  it("aggregates 1m bars accurately into 5m, 15m, 30m, 1H, 4H, 1D, 1W, 1M with zero synthetic bars", () => {
    // Build sparse 1m bars across two weeks and two months:
    // Month 1 (Oct 2026): Mon 2026-10-26 00:00..00:04, 00:05..00:06, 04:15, and Fri 2026-10-30 23:59
    // Month 2 (Nov 2026): Mon 2026-11-02 09:00
    const t0 = Date.UTC(2026, 9, 26, 0, 0, 0) / 1000; // Mon Oct 26 2026 00:00 UTC
    const bars1m = [
      { t: t0 + 0 * 60, o: 100, h: 105, l: 99, c: 102, v: 10 },
      { t: t0 + 1 * 60, o: 102, h: 108, l: 101, c: 107, v: 20 },
      { t: t0 + 4 * 60, o: 107, h: 107, l: 95, c: 96, v: 30 },
      // Next 5m bucket (00:05)
      { t: t0 + 5 * 60, o: 96, h: 110, l: 96, c: 109, v: 40 },
      // Jump to 04:15 (gap of >4 hours — must NOT generate empty intermediate buckets)
      { t: t0 + 4 * 3600 + 15 * 60, o: 112, h: 120, l: 111, c: 118, v: 50 },
      // Fri Oct 30 23:59 (same ISO week & same month)
      { t: Date.UTC(2026, 9, 30, 23, 59, 0) / 1000, o: 118, h: 121, l: 117, c: 119, v: 60 },
      // Mon Nov 2 09:00 (next week AND next month)
      { t: Date.UTC(2026, 10, 2, 9, 0, 0) / 1000, o: 125, h: 130, l: 124, c: 128, v: 70 },
    ];

    // Pass reversed/unsorted copy to verify purity + sorting
    const shuffled = [...bars1m].reverse();
    const snap = structuredClone(shuffled);

    // 5m
    const b5m = rollup(shuffled, "5m");
    assert.deepEqual(shuffled, snap, "rollup must not mutate input");
    assert.equal(b5m.length, 5);
    assert.deepEqual(b5m[0], { t: t0, o: 100, h: 108, l: 95, c: 96, v: 60 });
    assert.deepEqual(b5m[1], { t: t0 + 300, o: 96, h: 110, l: 96, c: 109, v: 40 });
    assert.deepEqual(b5m[2], { t: t0 + 4 * 3600 + 900, o: 112, h: 120, l: 111, c: 118, v: 50 });

    // 15m & 30m
    const b15m = rollup(shuffled, "15m");
    assert.equal(b15m.length, 4);
    assert.deepEqual(b15m[0], { t: t0, o: 100, h: 110, l: 95, c: 109, v: 100 });
    const b30m = rollup(shuffled, "30m");
    assert.equal(b30m.length, 4);
    assert.deepEqual(b30m[0], { t: t0, o: 100, h: 110, l: 95, c: 109, v: 100 });

    // 1H (also verify lowercase "1h")
    const b1h = rollup(shuffled, "1h");
    assert.equal(b1h.length, 4);
    assert.deepEqual(b1h[0], { t: t0, o: 100, h: 110, l: 95, c: 109, v: 100 });
    assert.deepEqual(b1h[1], { t: t0 + 4 * 3600, o: 112, h: 120, l: 111, c: 118, v: 50 });

    // 4H
    const b4h = rollup(shuffled, "4H");
    assert.equal(b4h.length, 4);
    assert.equal(b4h[1].t, t0 + 4 * 3600);

    // 1D (lowercase "1d")
    const b1d = rollup(shuffled, "1d");
    assert.equal(b1d.length, 3);
    assert.deepEqual(b1d[0], { t: t0, o: 100, h: 120, l: 95, c: 118, v: 150 });
    assert.equal(b1d[1].t, Date.UTC(2026, 9, 30, 0, 0, 0) / 1000);
    assert.equal(b1d[2].t, Date.UTC(2026, 10, 2, 0, 0, 0) / 1000);

    // 1W (Monday alignment)
    const b1w = rollup(shuffled, "1W");
    assert.equal(b1w.length, 2);
    assert.deepEqual(b1w[0], { t: Date.UTC(2026, 9, 26, 0, 0, 0) / 1000, o: 100, h: 121, l: 95, c: 119, v: 210 });
    assert.deepEqual(b1w[1], { t: Date.UTC(2026, 10, 2, 0, 0, 0) / 1000, o: 125, h: 130, l: 124, c: 128, v: 70 });

    // 1M (1st of calendar month)
    const b1M = rollup(shuffled, "1M");
    assert.equal(b1M.length, 2);
    assert.deepEqual(b1M[0], { t: Date.UTC(2026, 9, 1, 0, 0, 0) / 1000, o: 100, h: 121, l: 95, c: 119, v: 210 });
    assert.deepEqual(b1M[1], { t: Date.UTC(2026, 10, 1, 0, 0, 0) / 1000, o: 125, h: 130, l: 124, c: 128, v: 70 });
  });
});

describe("shared/market/candles — CandleBuilder Hub wiring & Workers hygiene", () => {
  it("emits bar close events across timeframes and supports REST reconciliation & state restore", () => {
    const closedEvents = [];
    const builder = createCandleBuilder({
      timeframes: ["1m", "5m"],
      onBarClose: (evt) => closedEvents.push(evt),
    });
    assert.ok(builder instanceof CandleBuilder);

    const t0 = Date.UTC(2026, 10, 18, 12, 0, 0) / 1000;
    builder.onTick({ s: "eur/usd", p: 1.0800, t: t0 + 10 });
    builder.onTick({ s: "EURUSD", p: 1.0810, t: t0 + 40 });
    assert.equal(closedEvents.length, 0);

    // Cross 1m boundary -> only 1m closes
    builder.onTick({ s: "EURUSD", p: 1.0820, t: t0 + 65 });
    assert.equal(closedEvents.length, 1);
    assert.equal(closedEvents[0].sym, "EURUSD");
    assert.equal(closedEvents[0].tf, "1m");
    assert.equal(closedEvents[0].closed, true);
    assert.equal(closedEvents[0].bar.t, t0);

    // Cross 5m boundary (t0 + 300) -> both 1m (gap=true since 300 - 60 = 240 > 120) and 5m (contiguous) close
    builder.onTick({ s: "EURUSD", p: 1.0850, t: t0 + 305 });
    assert.equal(closedEvents.length, 3);
    assert.equal(closedEvents[1].tf, "1m");
    assert.equal(closedEvents[1].gap, true);
    assert.equal(closedEvents[2].tf, "5m");
    assert.equal(closedEvents[2].gap, false);
    assert.deepEqual(closedEvents[2].bar, { t: t0, o: 1.0800, h: 1.0820, l: 1.0800, c: 1.0820, v: 0 });

    // REST reconciliation restores official volume
    const reconciled = builder.reconcile(
      "EURUSD",
      "1m",
      [closedEvents[0].bar],
      [{ t: t0 + 300, o: 1.0848, h: 1.0855, l: 1.0845, c: 1.0852, v: 1234 }],
    );
    assert.equal(reconciled[reconciled.length - 1].v, 1234);
    assert.equal(builder.getCurrent("EURUSD", "1m").v, 1234);

    // Serializable state roundtrip (for DO storage)
    const serialized = JSON.stringify(builder.getState("EURUSD", "1m"));
    const builder2 = createCandleBuilder({ timeframes: ["1m"] });
    builder2.restoreState("EURUSD", JSON.parse(serialized));
    assert.deepEqual(builder2.getCurrent("EURUSD", "1m"), builder.getCurrent("EURUSD", "1m"));
  });

  it("has zero Math.random and zero Node-only APIs (Workers-safe)", () => {
    const src = fs.readFileSync(fileURLToPath(new URL("../shared/market/candles.js", import.meta.url)), "utf8");
    assert.ok(!src.includes("Math.random"), "candles.js must never use Math.random");
    assert.ok(!/from\s+["']node:|require\(|process\./.test(src), "candles.js must be Workers-safe");
  });
});
