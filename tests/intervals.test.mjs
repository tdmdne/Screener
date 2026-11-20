// tests/intervals.test.mjs — interval normalization (native, aliases, custom), custom-timeframe bucketing/resampling,
// and the live-over-history bar merge used to backfill gaps. Pure shared/ logic, no network.
// Run: node tests/intervals.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { INTERVAL_SECONDS, TWELVEDATA_INTERVALS, BINANCE_INTERVALS, resolveInterval } from "../shared/intervals.js";
import {
  TIMEFRAMES,
  normalizeTf,
  stepSeconds,
  bucketStart,
  rollup,
  overlayLiveBars,
  createCandleBuilder,
} from "../shared/market/candles.js";

const utc = (y, m, d = 1, hh = 0, mm = 0) => Math.floor(Date.UTC(y, m, d, hh, mm) / 1000);

describe("resolveInterval — native labels and provider aliases", () => {
  const cases = [
    ["1m", "1m"], ["1min", "1m"],
    ["5m", "5m"], ["5M", "5m"], ["5min", "5m"],
    ["15m", "15m"], ["15M", "15m"], ["15min", "15m"],
    ["30m", "30m"], ["30M", "30m"], ["30min", "30m"],
    ["1H", "1H"], ["1h", "1H"], ["60m", "1H"],
    ["4H", "4H"], ["4h", "4H"], ["240m", "4H"],
    ["1D", "1D"], ["1d", "1D"], ["1day", "1D"], ["24H", "1D"],
    ["1W", "1W"], ["1w", "1W"], ["1wk", "1W"], ["1week", "1W"], ["7D", "1W"],
    ["1M", "1M"], ["1mo", "1M"], ["1month", "1M"],
  ];
  for (const [input, key] of cases) {
    it(`${input} -> ${key}`, () => {
      const r = resolveInterval(input);
      assert.ok(r, `${input} should resolve`);
      assert.equal(r.key, key);
      assert.equal(r.native, true);
      assert.equal(r.base, key);
      assert.equal(r.step, INTERVAL_SECONDS[key]);
      assert.ok(TWELVEDATA_INTERVALS[key] && BINANCE_INTERVALS[key], "native keys map to both providers");
    });
  }

  it("never collides 1m (minute) with 1M (month) and trims whitespace", () => {
    assert.equal(resolveInterval("1m").key, "1m");
    assert.equal(resolveInterval(" 1M ").key, "1M");
    assert.notEqual(resolveInterval("1m").step, resolveInterval("1M").step);
  });
});

describe("resolveInterval — custom timeframes resolve to a native base", () => {
  const custom = [
    ["3m", "3m", 180, "1m"],
    ["7m", "7m", 420, "1m"],
    ["45m", "45m", 2700, "15m"],
    ["90m", "90m", 5400, "30m"],
    ["2H", "2H", 7200, "1H"],
    ["2h", "2H", 7200, "1H"],
    ["3H", "3H", 10800, "1H"],
    ["8H", "8H", 28800, "4H"],
    ["12H", "12H", 43200, "4H"],
    ["2D", "2D", 172800, "1D"],
    ["2W", "2W", 1209600, "1W"],
    ["3M", "3M", 3 * 2592000, "1M"],
    ["6M", "6M", 6 * 2592000, "1M"],
    ["12M", "12M", 12 * 2592000, "1M"],
  ];
  for (const [input, key, step, base] of custom) {
    it(`${input} -> ${key} (step ${step}, base ${base})`, () => {
      const r = resolveInterval(input);
      assert.ok(r, `${input} should resolve`);
      assert.equal(r.key, key);
      assert.equal(r.native, false);
      assert.equal(r.step, step);
      assert.equal(r.base, base);
      assert.equal(r.baseStep, INTERVAL_SECONDS[base]);
      assert.ok(r.ratio >= 2);
      assert.equal(normalizeTf(input), key);
      assert.equal(stepSeconds(input), step);
    });
  }

  it("rejects unsupported / malformed intervals (incl. seconds, which REST history cannot serve)", () => {
    for (const bad of ["", "   ", "bad", "0m", "-5m", "1.5H", "45s", "30s", "1s", "13x", "5000m", "99M", null, undefined, 5, {}]) {
      assert.equal(resolveInterval(bad), null, `${String(bad)} must be rejected`);
    }
  });

  it("native TIMEFRAMES list is unchanged (custom intervals do not widen it)", () => {
    assert.deepEqual(TIMEFRAMES, ["1m", "5m", "15m", "30m", "1H", "4H", "1D", "1W", "1M"]);
  });
});

describe("custom timeframe bucketing", () => {
  it("aligns minute/hour/day customs to epoch multiples", () => {
    const t = utc(2026, 10, 18, 10, 17);
    assert.equal(bucketStart(t, "3m") % 180, 0);
    assert.equal(bucketStart(t, "2H") % 7200, 0);
    assert.equal(bucketStart(t, "45m") % 2700, 0);
    assert.equal(bucketStart(utc(2026, 10, 18, 10, 17), "12H"), utc(2026, 10, 18, 0, 0));
  });

  it("aligns N-month customs to calendar boundaries (quarters, halves, years)", () => {
    assert.equal(bucketStart(utc(2026, 10, 18), "3M"), utc(2026, 9, 1)); // Nov -> Oct 1 (Q4)
    assert.equal(bucketStart(utc(2026, 1, 28), "3M"), utc(2026, 0, 1)); // Feb -> Jan 1 (Q1)
    assert.equal(bucketStart(utc(2026, 7, 2), "6M"), utc(2026, 6, 1)); // Aug -> Jul 1 (H2)
    assert.equal(bucketStart(utc(2026, 10, 18), "12M"), utc(2026, 0, 1));
  });

  it("native 1W is Monday-aligned and 1M is the 1st of the month", () => {
    assert.equal(new Date(bucketStart(utc(2026, 10, 18, 9), "1W") * 1000).getUTCDay(), 1);
    assert.equal(bucketStart(utc(2026, 10, 18, 9), "1M"), utc(2026, 10, 1));
  });
});

describe("rollup resamples any finer series into a custom timeframe (backend aggregation)", () => {
  it("3m from 1m: OHLCV aggregated per 180s bucket, no synthetic fill", () => {
    const t0 = Math.floor(utc(2026, 10, 18, 10, 0) / 180) * 180;
    const bars = [];
    for (let i = 0; i < 9; i++) bars.push({ t: t0 + i * 60, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 10 });
    bars.splice(4, 1); // drop one 1m bar: bucket 2 keeps real bars only
    const out = rollup(bars, "3m");
    assert.deepEqual(out.map((b) => b.t), [t0, t0 + 180, t0 + 360]);
    assert.deepEqual(out[0], { t: t0, o: 100, h: 103, l: 99, c: 102.5, v: 30 });
    assert.equal(out[1].v, 20);
    assert.equal(out[1].o, 103);
  });

  it("2H from 1H and 3M from 1M", () => {
    const h0 = utc(2026, 10, 18, 0, 0);
    const hours = [0, 1, 2, 3].map((i) => ({ t: h0 + i * 3600, o: 1 + i, h: 2 + i, l: 0.5 + i, c: 1.5 + i, v: 5 }));
    const two = rollup(hours, "2H");
    assert.equal(two.length, 2);
    assert.deepEqual(two[0], { t: h0, o: 1, h: 3, l: 0.5, c: 2.5, v: 10 });

    const months = [utc(2026, 6, 1), utc(2026, 7, 1), utc(2026, 8, 1), utc(2026, 9, 1), utc(2026, 10, 1)].map((t, i) => ({ t, o: 10 + i, h: 20 + i, l: 5 + i, c: 15 + i, v: 100 }));
    const q = rollup(months, "3M");
    assert.deepEqual(q.map((b) => b.t), [utc(2026, 6, 1), utc(2026, 9, 1)]);
    assert.equal(q[0].v, 300);
    assert.equal(q[1].v, 200);
    assert.equal(q[0].o, 10);
    assert.equal(q[0].c, 17);
  });
});

describe("overlayLiveBars — live bars fill gaps and extend history without duplicates", () => {
  const step = 300;
  const t0 = 1_763_400_000 - (1_763_400_000 % step);
  const mk = (i, o = 100, v = 50) => ({ t: t0 + i * step, o: o + i, h: o + i + 1, l: o + i - 1, c: o + i + 0.5, v });

  it("returns history when there is no live data and live when there is no history", () => {
    const hist = [mk(0), mk(1)];
    assert.deepEqual(overlayLiveBars(hist, []), hist);
    assert.deepEqual(overlayLiveBars([], hist), hist);
    assert.deepEqual(overlayLiveBars([], []), []);
  });

  it("appends live bars newer than history (REST lag) and keeps ascending unique times", () => {
    const hist = [mk(0), mk(1), mk(2)];
    const live = [mk(3, 100, 0), mk(4, 100, 0)];
    const out = overlayLiveBars(hist, live);
    assert.deepEqual(out.map((b) => b.t), [0, 1, 2, 3, 4].map((i) => t0 + i * step));
  });

  it("fills holes inside history from live bars but never overwrites closed REST bars", () => {
    const hist = [mk(0), mk(1), mk(3), mk(4)]; // hole at 2
    const live = [mk(2, 200, 0), { ...mk(3, 300, 0) }];
    const out = overlayLiveBars(hist, live);
    assert.equal(out.length, 5);
    assert.equal(out[2].o, 202); // hole filled from live
    assert.equal(out[3].o, 103); // REST wins for a closed bar
    assert.equal(out[3].v, 50);
  });

  it("merges the forming bar: REST open/volume kept, live close and extremes win", () => {
    const hist = [mk(0), { t: t0 + step, o: 101, h: 102, l: 100, c: 101.2, v: 40 }];
    const live = [{ t: t0 + step, o: 101.1, h: 103, l: 99.5, c: 102.7, v: 0 }];
    const out = overlayLiveBars(hist, live);
    assert.equal(out.length, 2);
    assert.deepEqual(out[1], { t: t0 + step, o: 101, h: 103, l: 99.5, c: 102.7, v: 40 });
  });
});

describe("CandleBuilder handles custom timeframes tick-by-tick (live WS merge onto the active candle)", () => {
  it("3m builder rolls a new bucket every 180s and keeps one active candle", () => {
    const t0 = Math.floor(utc(2026, 10, 18, 10, 0) / 180) * 180;
    const b = createCandleBuilder({ timeframes: ["1m", "3m"], openMode: "tick" });
    b.onTick({ s: "BTCUSDT", p: 100, t: t0 + 5 });
    b.onTick({ s: "BTCUSDT", p: 105, t: t0 + 65 });
    b.onTick({ s: "BTCUSDT", p: 98, t: t0 + 125 });
    assert.deepEqual(b.getCurrent("BTCUSDT", "3m"), { t: t0, o: 100, h: 105, l: 98, c: 98, v: 0 });
    const res = b.onTick({ s: "BTCUSDT", p: 99, t: t0 + 185 });
    const closed3 = res.closed.find((e) => e.tf === "3m");
    assert.ok(closed3, "3m bar closed at the 180s boundary");
    assert.equal(closed3.bar.t, t0);
    assert.equal(b.getCurrent("BTCUSDT", "3m").t, t0 + 180);
  });
});
