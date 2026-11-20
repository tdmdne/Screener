// tests/indicators.test.mjs — Task 5 numerical parity, incremental accuracy & CPU benchmark tests
// for shared/market/indicators.js.
// Run: node tests/indicators.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  MAX_INDICATOR_PERIOD,
  ema,
  sma,
  atr,
  rsi,
  bollinger,
  adr,
  maLast,
  ccMetric,
  computeIndicator,
  createIndicatorState,
  updateIndicator,
  indicatorKey,
  toChartPoints,
  createIndicatorTracker,
} from "../shared/market/indicators.js";

const TOL = 1e-9;

// --- Verbatim reference client implementations from index.html (lines 1295-1315, 1580-1587, 1664-1666) ---

const refEmaArr = (a, len) => {
  const k = 2 / (len + 1);
  let e = a[0];
  return a.map((x, i) => (i ? (e = x * k + e * (1 - k)) : e));
};

const refSmaArr = (a, n) =>
  a.map((_, i) => (i < n - 1 ? null : a.slice(i - n + 1, i + 1).reduce((x, y) => x + y, 0) / n));

const refAtrArr = (a, n) => {
  const tr = a.map((d, i) =>
    i ? Math.max(d.h - d.l, Math.abs(d.h - a[i - 1].c), Math.abs(d.l - a[i - 1].c)) : d.h - d.l
  );
  return refSmaArr(tr, n);
};

function refRsiArr(a, n) {
  const o = a.map(() => null);
  let g = 0;
  let l = 0;
  for (let i = 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    const u = Math.max(d, 0);
    const w = Math.max(-d, 0);
    if (i <= n) {
      g += u / n;
      l += w / n;
    } else {
      g = (g * (n - 1) + u) / n;
      l = (l * (n - 1) + w) / n;
    }
    if (i >= n) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return o;
}

function refBollingerArr(cl, len, mult = 2) {
  const m = refSmaArr(cl, len);
  const sd = cl.map((_, i) =>
    i < len - 1
      ? null
      : Math.sqrt(cl.slice(i - len + 1, i + 1).reduce((q, x) => q + (x - m[i]) ** 2, 0) / len)
  );
  const upper = m.map((x, i) => (x == null ? null : x + mult * sd[i]));
  const lower = m.map((x, i) => (x == null ? null : x - mult * sd[i]));
  return { middle: m, upper, lower, stdDev: sd };
}

function refCc(a, c) {
  const n = Math.min(c.n, 149);
  const last = a[a.length - 1].c;
  if (c.mode === "abs") {
    const ref = a[a.length - 1 - n].c;
    return (Math.abs(last - ref) / ref) * 100;
  }
  const w = a.slice(-n);
  if (c.dir === "bull") {
    const lo = Math.min(...w.map((x) => x.l));
    return ((last - lo) / lo) * 100;
  }
  const hi = Math.max(...w.map((x) => x.h));
  return ((hi - last) / hi) * 100;
}

// Deterministic realistic multi-bar series builder (test fixture only — pure trig/LCG, no Math.random).
function buildFixtureBars(count, basePrice, volatility, startT = 1763400000) {
  const bars = [];
  let price = basePrice;
  let s = (Math.round(basePrice * 100) ^ count ^ 0x5f3759df) >>> 0;
  const nextUnit = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const drift = Math.sin(i / 17) * volatility * 0.45 + (nextUnit() - 0.495) * volatility;
    const o = price;
    const c = Math.max(basePrice * 0.1, o * (1 + drift));
    const wickUp = Math.abs(nextUnit()) * volatility * 0.6;
    const wickDn = Math.abs(nextUnit()) * volatility * 0.6;
    const h = Math.max(o, c) * (1 + wickUp);
    const l = Math.min(o, c) * (1 - wickDn);
    const v = Math.round(1000 + nextUnit() * 50000);
    bars.push({ t: startT + i * 60, o, h, l, c, v });
    price = c;
  }
  return bars;
}

function assertSeriesParity(actual, expected, label) {
  assert.ok(actual instanceof Float64Array, `${label}: expected Float64Array`);
  assert.equal(actual.length, expected.length, `${label}: length mismatch`);
  let maxErr = 0;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] === null) {
      assert.ok(Number.isNaN(actual[i]), `${label}[${i}]: expected NaN during warmup, got ${actual[i]}`);
    } else {
      assert.ok(Number.isFinite(actual[i]), `${label}[${i}]: expected finite, got ${actual[i]}`);
      const err = Math.abs(actual[i] - expected[i]);
      if (err > maxErr) maxErr = err;
      assert.ok(err <= TOL, `${label}[${i}]: |${actual[i]} - ${expected[i]}| = ${err} > ${TOL}`);
    }
  }
  return maxErr;
}

const fxBars = buildFixtureBars(400, 1.0842, 0.0018);
const btcBars = buildFixtureBars(1500, 94500.0, 0.0085);

describe("shared/market/indicators — exact numerical parity (<= 1e-9) vs index.html", () => {
  it("matches emaArr across FX and BTC series and multiple periods", () => {
    for (const [name, bars] of [["EURUSD", fxBars], ["BTCUSDT", btcBars]]) {
      const closes = bars.map((b) => b.c);
      for (const period of [9, 20, 50, 200]) {
        assertSeriesParity(ema(closes, period), refEmaArr(closes, period), `ema(${name},${period})`);
      }
    }
  });

  it("matches smaArr across FX and BTC series and multiple periods", () => {
    for (const [name, bars] of [["EURUSD", fxBars], ["BTCUSDT", btcBars]]) {
      const closes = bars.map((b) => b.c);
      for (const period of [5, 20, 50, 200]) {
        assertSeriesParity(sma(closes, period), refSmaArr(closes, period), `sma(${name},${period})`);
      }
    }
  });

  it("matches atrArr (SMA of True Range) across FX and BTC series", () => {
    for (const [name, bars] of [["EURUSD", fxBars], ["BTCUSDT", btcBars]]) {
      for (const period of [7, 14, 21]) {
        assertSeriesParity(atr(bars, period), refAtrArr(bars, period), `atr(${name},${period})`);
      }
    }
  });

  it("matches rsiArr across FX, BTC, and flat/monotonic edge cases", () => {
    for (const [name, bars] of [["EURUSD", fxBars], ["BTCUSDT", btcBars]]) {
      const closes = bars.map((b) => b.c);
      for (const period of [7, 14, 21]) {
        assertSeriesParity(rsi(closes, period), refRsiArr(closes, period), `rsi(${name},${period})`);
      }
    }

    // Flat prices: l === 0 -> 100 (matches index.html:1587)
    const flat = Array.from({ length: 25 }, () => 100);
    assertSeriesParity(rsi(flat, 14), refRsiArr(flat, 14), "rsi(flat,14)");

    // Strictly falling prices: g === 0 -> 0
    const falling = Array.from({ length: 25 }, (_, i) => 200 - i);
    assertSeriesParity(rsi(falling, 14), refRsiArr(falling, 14), "rsi(falling,14)");
  });

  it("matches Bollinger Bands (middle, upper, lower, stdDev) from index.html lines 1664-1666", () => {
    for (const [name, bars] of [["EURUSD", fxBars], ["BTCUSDT", btcBars]]) {
      const closes = bars.map((b) => b.c);
      for (const [period, mult] of [[20, 2], [20, 2.5], [50, 2]]) {
        const ref = refBollingerArr(closes, period, mult);
        const act = bollinger(closes, period, mult);
        assertSeriesParity(act.middle, ref.middle, `bb.mid(${name},${period},${mult})`);
        assertSeriesParity(act.upper, ref.upper, `bb.up(${name},${period},${mult})`);
        assertSeriesParity(act.lower, ref.lower, `bb.lo(${name},${period},${mult})`);
        assertSeriesParity(act.stdDev, ref.stdDev, `bb.sd(${name},${period},${mult})`);
      }
    }
  });

  it("matches legacy screener helpers (maLast, ccMetric, adr)", () => {
    const closes = fxBars.map((b) => b.c);
    const refSma20 = refSmaArr(closes, 20).at(-1);
    const refEma20 = refEmaArr(closes, 20).at(-1);
    assert.ok(Math.abs(maLast(closes, "SMA", 20) - refSma20) <= TOL);
    assert.ok(Math.abs(maLast(closes, "EMA", 20) - refEma20) <= TOL);

    assert.ok(Math.abs(ccMetric(fxBars, { n: 20, mode: "abs" }) - refCc(fxBars, { n: 20, mode: "abs" })) <= TOL);
    assert.ok(Math.abs(ccMetric(fxBars, { n: 20, mode: "dir", dir: "bull" }) - refCc(fxBars, { n: 20, mode: "dir", dir: "bull" })) <= TOL);
    assert.ok(Math.abs(ccMetric(fxBars, { n: 20, mode: "dir", dir: "bear" }) - refCc(fxBars, { n: 20, mode: "dir", dir: "bear" })) <= TOL);

    const adrSeries = adr(fxBars, 14);
    const tail14 = fxBars.slice(-14);
    const refAdr14 = (tail14.reduce((x, y) => x + (y.h - y.l) / y.c, 0) / tail14.length) * 100;
    assert.ok(Math.abs(adrSeries[adrSeries.length - 1] - refAdr14) <= TOL);
  });
});

describe("shared/market/indicators — incremental updateIndicator parity & purity", () => {
  const configs = [
    { type: "ema", period: 20 },
    { type: "sma", period: 20 },
    { type: "atr", period: 14 },
    { type: "rsi", period: 14 },
    { type: "bb", period: 20, mult: 2 },
    { type: "vol" },
    { type: "adr", period: 14 },
    // Legacy chart config alias check ({ t, len })
    { t: "ema", len: 9 },
  ];

  it("matches full computeIndicator at EVERY bar from bar 0 through N-1 (<= 1e-9)", () => {
    const series = fxBars.slice(0, 120);
    for (const cfg of configs) {
      const full = computeIndicator(series, cfg);
      let state = createIndicatorState(cfg);

      for (let i = 0; i < series.length; i++) {
        const res = updateIndicator(state, series[i]);
        state = res.state;
        assert.equal(res.barT, series[i].t);

        if (full.type === "bb") {
          if (Number.isNaN(full.middle[i])) {
            assert.equal(res.value, null);
          } else {
            assert.ok(res.value !== null);
            assert.ok(Math.abs(res.value.middle - full.middle[i]) <= TOL);
            assert.ok(Math.abs(res.value.upper - full.upper[i]) <= TOL);
            assert.ok(Math.abs(res.value.lower - full.lower[i]) <= TOL);
            assert.ok(Math.abs(res.value.stdDev - full.stdDev[i]) <= TOL);
          }
        } else {
          if (Number.isNaN(full.values[i])) {
            assert.equal(res.value, null);
          } else {
            assert.ok(res.value !== null);
            assert.ok(Math.abs(res.value - full.values[i]) <= TOL, `${indicatorKey(cfg)}[${i}] mismatch`);
          }
        }
      }
    }
  });

  it("matches full recomputation when seeded from historical slice and updated incrementally", () => {
    const split = 1000;
    const tail = btcBars.slice(split);

    for (const cfg of [
      { type: "ema", period: 50 },
      { type: "sma", period: 50 },
      { type: "atr", period: 14 },
      { type: "rsi", period: 14 },
      { type: "bb", period: 20, mult: 2 },
    ]) {
      const full = computeIndicator(btcBars, cfg);
      let state = computeIndicator(btcBars.slice(0, split), cfg).state;

      // Verify state purity on first update
      const prevSnapshot = state.window ? Array.from(state.window) : null;
      const prevCount = state.count;

      for (let j = 0; j < tail.length; j++) {
        const res = updateIndicator(state, tail[j]);
        if (j === 0) {
          assert.equal(state.count, prevCount, "updateIndicator must not mutate input state");
          if (prevSnapshot) assert.deepEqual(Array.from(state.window), prevSnapshot, "must not mutate ring buffer");
        }
        state = res.state;
        const idx = split + j;
        if (full.type === "bb") {
          assert.ok(Math.abs(res.value.middle - full.middle[idx]) <= TOL);
          assert.ok(Math.abs(res.value.upper - full.upper[idx]) <= TOL);
          assert.ok(Math.abs(res.value.lower - full.lower[idx]) <= TOL);
        } else {
          assert.ok(Math.abs(res.value - full.values[idx]) <= TOL);
        }
      }
    }
  });

  it("supports IndicatorTracker hub subscriptions and toChartPoints formatting", () => {
    const tracker = createIndicatorTracker();
    const seed = fxBars.slice(0, 100);
    const nextBar = fxBars[100];

    const regEma = tracker.register("EURUSD", "1m", { type: "ema", period: 20 }, seed);
    const regBb = tracker.register("EURUSD", "1m", { type: "bb", period: 20, mult: 2 }, seed);
    assert.equal(regEma.key, "ema:20");
    assert.equal(regBb.key, "bb:20:2");

    const pts = toChartPoints(seed, regEma.values);
    assert.equal(pts.length, 100);
    assert.deepEqual(pts[0], { t: seed[0].t, v: regEma.values[0] });

    const deltas = tracker.onBarClose("EURUSD", "1m", nextBar);
    assert.equal(deltas.length, 2);
    const full101 = computeIndicator(fxBars.slice(0, 101), { type: "ema", period: 20 });
    assert.ok(Math.abs(tracker.getLast("EURUSD", "1m", { type: "ema", period: 20 }) - full101.last) <= TOL);

    tracker.unregister("EURUSD", "1m", { type: "ema", period: 20 });
    assert.equal(tracker.getLast("EURUSD", "1m", { type: "ema", period: 20 }), undefined);
  });

  it("enforces MAX_INDICATOR_PERIOD = 1000 across all indicators to prevent Float64Array OOM", () => {
    assert.equal(MAX_INDICATOR_PERIOD, 1000);
    const closes = fxBars.slice(0, 50).map((b) => b.c);
    const sampleBars = fxBars.slice(0, 50);

    for (const badPeriod of [1001, 1e6, 1e9, 0, -1, 1.5, NaN, Infinity]) {
      assert.throws(() => ema(closes, badPeriod), RangeError, `ema(${badPeriod})`);
      assert.throws(() => sma(closes, badPeriod), RangeError, `sma(${badPeriod})`);
      assert.throws(() => atr(sampleBars, badPeriod), RangeError, `atr(${badPeriod})`);
      assert.throws(() => rsi(closes, badPeriod), RangeError, `rsi(${badPeriod})`);
      assert.throws(() => bollinger(closes, badPeriod, 2), RangeError, `bollinger(${badPeriod})`);
      assert.throws(() => adr(sampleBars, badPeriod), RangeError, `adr(${badPeriod})`);
      assert.throws(() => maLast(closes, "SMA", badPeriod), RangeError, `maLast(${badPeriod})`);
      assert.throws(() => computeIndicator(sampleBars, { type: "sma", period: badPeriod }), RangeError);
      assert.throws(() => createIndicatorState({ type: "bb", period: badPeriod, mult: 2 }), RangeError);
      const tracker = createIndicatorTracker();
      assert.throws(() => tracker.register("EURUSD", "1m", { type: "ema", period: badPeriod }, sampleBars), RangeError);
    }

    // Boundary: period === 1000 must still succeed cleanly
    const res1000 = computeIndicator(btcBars, { type: "sma", period: 1000 });
    assert.equal(res1000.values.length, btcBars.length);
    assert.ok(Number.isFinite(res1000.last));
  });

  it("ignores duplicate or out-of-order bar timestamps in IndicatorTracker.onBarClose()", () => {
    const tracker = createIndicatorTracker();
    const seed = fxBars.slice(0, 100);
    const indConfigs = [
      { type: "ema", period: 20 },
      { type: "sma", period: 20 },
      { type: "rsi", period: 14 },
      { type: "atr", period: 14 },
      { type: "bb", period: 20, mult: 2 },
    ];
    for (const cfg of indConfigs) tracker.register("EURUSD", "1m", cfg, seed);

    const snapshotBefore = indConfigs.map((cfg) => tracker.getLast("EURUSD", "1m", cfg));

    // Re-delivering the last seeded bar timestamp (bar.t === entry.lastT) must be ignored
    const dupDeltas = tracker.onBarClose("EURUSD", "1m", seed[seed.length - 1]);
    assert.deepEqual(dupDeltas, []);
    assert.deepEqual(
      indConfigs.map((cfg) => tracker.getLast("EURUSD", "1m", cfg)),
      snapshotBefore
    );

    // Delivering an older bar timestamp (bar.t < entry.lastT) must also be ignored
    const oldDeltas = tracker.onBarClose("EURUSD", "1m", seed[50]);
    assert.deepEqual(oldDeltas, []);
    assert.deepEqual(
      indConfigs.map((cfg) => tracker.getLast("EURUSD", "1m", cfg)),
      snapshotBefore
    );

    // Delivering a strictly newer bar advances all 5 indicators accurately
    const nextBar = fxBars[100];
    const nextDeltas = tracker.onBarClose("EURUSD", "1m", nextBar);
    assert.equal(nextDeltas.length, indConfigs.length);
    const full101 = indConfigs.map((cfg) => computeIndicator(fxBars.slice(0, 101), cfg).last);
    for (let i = 0; i < indConfigs.length; i++) {
      const actual = tracker.getLast("EURUSD", "1m", indConfigs[i]);
      if (indConfigs[i].type === "bb") {
        assert.ok(Math.abs(actual.middle - full101[i].middle) <= TOL);
        assert.ok(Math.abs(actual.upper - full101[i].upper) <= TOL);
        assert.ok(Math.abs(actual.lower - full101[i].lower) <= TOL);
      } else {
        assert.ok(Math.abs(actual - full101[i]) <= TOL);
      }
    }

    // Re-delivering bar 100 a second time must be a complete no-op
    const snapshotAfter100 = indConfigs.map((cfg) => tracker.getLast("EURUSD", "1m", cfg));
    assert.deepEqual(tracker.onBarClose("EURUSD", "1m", nextBar), []);
    assert.deepEqual(
      indConfigs.map((cfg) => tracker.getLast("EURUSD", "1m", cfg)),
      snapshotAfter100
    );
  });
});

describe("shared/market/indicators — per-bar-close CPU benchmark & Workers hygiene", () => {
  it("stays well under the 8 ms Cloudflare Workers Free CPU budget per bar close", () => {
    const seed = btcBars.slice(0, 1000);
    const stream = btcBars.slice(1000, 1500); // 500 bar closes

    // Realistic hub load: 10 symbols x 5 indicators (EMA 20, SMA 50, ATR 14, RSI 14, BB 20/2) = 50 active states
    const indConfigs = [
      { type: "ema", period: 20 },
      { type: "sma", period: 50 },
      { type: "atr", period: 14 },
      { type: "rsi", period: 14 },
      { type: "bb", period: 20, mult: 2 },
    ];
    const symbols = 10;
    const states = [];
    for (let s = 0; s < symbols; s++) {
      for (const cfg of indConfigs) {
        states.push(computeIndicator(seed, cfg).state);
      }
    }

    // Warmup JIT
    for (let i = 0; i < 50; i++) {
      const bar = stream[i];
      for (let k = 0; k < states.length; k++) states[k] = updateIndicator(states[k], bar).state;
    }

    // Timed benchmark across 450 bar closes x 50 indicators = 22,500 incremental updates
    const rounds = stream.length - 50;
    const tStart = performance.now();
    for (let i = 50; i < stream.length; i++) {
      const bar = stream[i];
      for (let k = 0; k < states.length; k++) {
        states[k] = updateIndicator(states[k], bar).state;
      }
    }
    const elapsedMs = performance.now() - tStart;
    const perBarClose50IndMs = elapsedMs / rounds;
    const perSymbol5IndMs = perBarClose50IndMs / symbols;
    const perSingleIndMs = perBarClose50IndMs / states.length;

    console.log(
      `[BENCH indicators] 1 bar-close (50 indicators / 10 syms): ${perBarClose50IndMs.toFixed(4)} ms | ` +
      `1 sym (5 inds): ${perSymbol5IndMs.toFixed(4)} ms | ` +
      `1 ind: ${(perSingleIndMs * 1000).toFixed(3)} µs (budget: 8.000 ms)`
    );

    // Must be well under the 8 ms Workers Free cap even for 50 concurrent indicator updates
    assert.ok(perBarClose50IndMs < 8.0, `Expected < 8 ms per bar close, got ${perBarClose50IndMs.toFixed(4)} ms`);
  });

  it("has zero Math.random and zero Node-only APIs (Workers-safe)", () => {
    const src = fs.readFileSync(fileURLToPath(new URL("../shared/market/indicators.js", import.meta.url)), "utf8");
    assert.ok(!src.includes("Math.random"), "indicators.js must never use Math.random");
    assert.ok(!/from\s+["']node:|require\(|process\./.test(src), "indicators.js must be Workers-safe");
  });
});
