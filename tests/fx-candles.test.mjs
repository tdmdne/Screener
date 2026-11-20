// tests/fx-candles.test.mjs: FX bars must have visible bodies when quotes are sparse.
// FX is a continuous quote market: a new bar opens at the previous bar's close (no gap candles), so one tick per
// bucket still draws a body. Opening every bucket at its first tick collapsed sparse FX bars to flat O=H=L=C dashes.
// Crypto and equities keep tick-open. Run: node tests/fx-candles.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCandleBuilder } from "../shared/market/candles.js";

const T0 = 1795190400; // a Friday 00:00:00 UTC, minute aligned

// One tick every `gap` seconds on a deterministic random walk; returns closed bars for `tf`.
function closedBars(sym, base, gap, n, opts = {}, tf = "1m") {
  const b = createCandleBuilder({ timeframes: ["1m", "5m", "1H"], ...opts });
  let p = base, seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = [];
  for (let i = 1; i <= n; i++) {
    p = +(p * (1 + (rnd() - 0.5) * 0.0002)).toFixed(5);
    const r = b.onTick({ s: sym, c: p, t: (T0 + i * gap) * 1000, v: 1 });
    for (const e of r.closed) if (e.tf === tf) out.push(e.bar);
  }
  return out;
}
const flat = (b) => b.o === b.h && b.h === b.l && b.l === b.c;

describe("FX candles with sparse quotes", () => {
  it("1m bars built from one tick each are not flat dashes (open = previous close)", () => {
    const bars = closedBars("GBPUSD", 1.27, 70, 300); // one tick every 70s: at most one tick per minute bucket
    assert.ok(bars.length > 100);
    const flats = bars.filter(flat).length;
    // a flat bar is only legitimate when the quote repeats the previous close exactly (5 decimals), which is rare
    assert.ok(flats / bars.length < 0.1, `flat 1m FX bars: ${flats}/${bars.length}`);
  });

  it("contiguous FX bars connect: each open equals the previous close", () => {
    const bars = closedBars("EURUSD", 1.08, 30, 400);
    let linked = 0;
    for (let i = 1; i < bars.length; i++) {
      if (bars[i].t - bars[i - 1].t === 60) {
        assert.equal(bars[i].o, bars[i - 1].c, `bar ${i} opens at the previous close`);
        linked++;
      }
    }
    assert.ok(linked > 100);
  });

  it("high and low always contain open and close", () => {
    for (const b of closedBars("USDJPY", 151.2, 45, 400)) {
      assert.ok(b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c));
    }
  });

  it("a gap of more than two steps still opens at the tick (never bridges the gap)", () => {
    const b = createCandleBuilder({ timeframes: ["1m"] });
    b.onTick({ s: "GBPUSD", c: 1.27, t: T0 * 1000 });
    b.onTick({ s: "GBPUSD", c: 1.2705, t: (T0 + 30) * 1000 });
    const r = b.onTick({ s: "GBPUSD", c: 1.29, t: (T0 + 600) * 1000 });
    assert.equal(r.updated[0].bar.o, 1.29, "gap bar opens at its own tick");
  });

  it("an explicit openMode:'tick' is still honoured for FX", () => {
    const flats = closedBars("GBPUSD", 1.27, 70, 300, { openMode: "tick" }).filter(flat).length;
    assert.ok(flats > 100, `explicit tick mode keeps tick-open: ${flats}`);
  });
});

describe("other asset classes keep tick-open", () => {
  for (const [sym, base] of [["BTCUSDT", 65000], ["AAPL", 190]]) {
    it(`${sym}: a new bucket opens at its first tick price`, () => {
      const b = createCandleBuilder({ timeframes: ["1m"] });
      b.onTick({ s: sym, c: base, t: T0 * 1000 });
      const r = b.onTick({ s: sym, c: base * 1.001, t: (T0 + 61) * 1000 });
      assert.equal(r.updated[0].bar.o, base * 1.001);
      assert.ok(flat(r.updated[0].bar), "first tick of the bucket is a point until more ticks arrive");
    });
  }
});
