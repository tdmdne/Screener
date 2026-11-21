// tests/chart-transforms.test.mjs — E-10 server-side Renko and Line Break (shared/market/chartTransforms.js).
// Run: node tests/chart-transforms.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { renkoBricks, lineBreak, parseChartTransform, applyChartTransform, averageTrueRange, niceBox } from "../shared/market/chartTransforms.js";

const T0 = 1_763_000_000;
const bar = (i, c, o = c) => ({ t: T0 + i * 60, o, h: Math.max(o, c), l: Math.min(o, c), c, v: 10 });
const closes = (arr) => arr.map((c, i) => bar(i, c));

test("renko: one brick per full box, reversal needs two boxes, bricks are strictly increasing in time", () => {
  const { bars, box } = renkoBricks(closes([100, 101, 103.2, 102.5, 101.9, 99.8, 99.7, 104.1]), { box: 1 });
  assert.equal(box, 1);
  const seq = bars.map((b) => [b.o, b.c]);
  assert.deepEqual(seq, [
    [100, 101], // 101
    [101, 102], [102, 103], // 103.2 -> two bricks in one bar
    // 102.5 / 101.9: no reversal (needs <= 101)
    [102, 101], [101, 100], // 99.8: reversal from 103 top -> 102->101, then 101->100
    // 99.7: not a full box below 100
    [101, 102], [102, 103], [103, 104], // 104.1: reversal needs >= 102; bricks from 101
  ]);
  for (let i = 1; i < bars.length; i++) assert.ok(bars[i].t > bars[i - 1].t, "strictly increasing");
  assert.equal(bars[1].t, T0 + 2 * 60);
  assert.equal(bars[2].t, T0 + 2 * 60 + 1, "second brick in the same bar gets +1 s");
  for (const b of bars) assert.ok(b.h === Math.max(b.o, b.c) && b.l === Math.min(b.o, b.c), "no wicks");
});

test("renko default box = rounded ATR(14)", () => {
  const src = Array.from({ length: 40 }, (_, i) => ({ t: T0 + i * 60, o: 100, h: 100.5, l: 99.5, c: 100 + (i % 2 ? 0.2 : -0.2), v: 1 }));
  const atr = averageTrueRange(src, 14);
  assert.ok(Math.abs(atr - 1) < 0.21);
  assert.equal(renkoBricks(src).box, niceBox(atr));
  assert.equal(niceBox(0.000123456), 0.000123);
  assert.equal(renkoBricks([], {}).bars.length, 0);
});

test("line break (3): continuation on new extreme; reversal must break the last three lines", () => {
  const src = [bar(0, 10, 9), bar(1, 11), bar(2, 12), bar(3, 11.5), bar(4, 13), bar(5, 10.5), bar(6, 9.9), bar(7, 9)];
  const { bars, n } = lineBreak(src);
  assert.equal(n, 3);
  assert.deepEqual(bars.map((b) => [b.o, b.c]), [
    [9, 10], [10, 11], [11, 12],
    // 11.5 neither higher than 12 nor below the low of last 3 lines (9)
    [12, 13],
    // 10.5: not below min low of last 3 (10) -> nothing; 9.9 < 10 -> reversal from 12 (open of last up line)
    [12, 9.9],
    [9.9, 9], // continuation down
  ]);
});

test("parseChartTransform validates type / box / lb; null for plain candles", () => {
  const p = (q) => parseChartTransform(new URLSearchParams(q));
  assert.equal(p(""), null);
  assert.equal(p("type=candles"), null);
  assert.deepEqual(p("type=renko&box=0.5"), { ok: true, type: "renko", box: 0.5, n: undefined });
  assert.deepEqual(p("type=linebreak&lb=2"), { ok: true, type: "linebreak", box: undefined, n: 2 });
  assert.equal(p("type=kagi").ok, false);
  assert.equal(p("type=renko&box=-1").ok, false);
  assert.equal(p("type=linebreak&lb=9").ok, false);
});

test("applyChartTransform returns bars + meta", () => {
  const r = applyChartTransform(closes([100, 102, 104]), { type: "renko", box: 1 });
  assert.equal(r.meta.type, "renko");
  assert.equal(r.meta.box, 1);
  assert.equal(r.bars.length, 4);
  assert.equal(applyChartTransform(closes([1, 2, 3]), { type: "linebreak" }).meta.lb, 3);
});
