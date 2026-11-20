// Tasks 9/11: server-computed chart indicator payloads (shared/market/chartIndicators.js).
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CHART_INDICATORS,
  buildIndicatorSeries,
  chartKeepCount,
  chartWindowWithIndicators,
  parseIndicatorList,
  parseIndicatorSpec,
  warmupBars,
} from "../shared/market/chartIndicators.js";
import { ema, sma } from "../shared/market/indicators.js";

function makeBars(n, step = 60, t0 = 1_700_000_000) {
  const out = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    // Deterministic oscillation: no randomness, still exercises up and down closes.
    const c = px + Math.sin(i / 7) * 1.5 + (i % 5) * 0.1;
    out.push({ t: t0 + i * step, o: px, h: Math.max(px, c) + 0.4, l: Math.min(px, c) - 0.4, c, v: 1000 + i });
    px = c;
  }
  return out;
}

test("parseIndicatorSpec keeps the hub's canonical ids", () => {
  assert.equal(parseIndicatorSpec("ema:20").id, "ema:20");
  assert.equal(parseIndicatorSpec("bb:20:2").id, "bb:20:2");
  assert.equal(parseIndicatorSpec("rsi:14").config.type, "rsi");
  assert.equal(parseIndicatorSpec("vol").id, "vol");
  assert.equal(parseIndicatorSpec("ema:0"), null);
  assert.equal(parseIndicatorSpec("ema:1001"), null);
  assert.equal(parseIndicatorSpec("nope:5"), null);
});

test("parseIndicatorList accepts repeated and comma-joined values and dedupes", () => {
  const r = parseIndicatorList(["ema:20,sma:50", "ema:20", " rsi:14 "]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.specs.map((s) => s.id), ["ema:20", "sma:50", "rsi:14"]);
});

test("parseIndicatorList rejects invalid specs and oversize lists", () => {
  assert.equal(parseIndicatorList(["ema:20,ema:abc"]).ok, false);
  const many = Array.from({ length: MAX_CHART_INDICATORS + 1 }, (_, i) => `sma:${i + 2}`).join(",");
  assert.equal(parseIndicatorList([many]).ok, false);
  assert.deepEqual(parseIndicatorList([]), { ok: true, specs: [] });
});

test("warmupBars: window = period, recursive = 4x period, capped", () => {
  const specs = (s) => parseIndicatorList([s]).specs;
  assert.equal(warmupBars(specs("sma:50")), 50);
  assert.equal(warmupBars(specs("ema:20")), 80);
  assert.equal(warmupBars(specs("rsi:14,bb:20:2")), 56);
  assert.equal(warmupBars(specs("vol")), 0);
  assert.equal(warmupBars(specs("ema:900")), 1000);
});

test("chartKeepCount drops warm-up bars unless history is too short", () => {
  assert.equal(chartKeepCount(1080, 80, 1000), 1000);
  assert.equal(chartKeepCount(500, 80, 1000), 420);
  assert.equal(chartKeepCount(60, 80, 1000), 60);
  assert.equal(chartKeepCount(500, 0), 500);
});

test("buildIndicatorSeries serializes {t,v} points and Bollinger bands", () => {
  const bars = makeBars(40);
  const out = buildIndicatorSeries(bars, parseIndicatorList(["sma:10,bb:20:2"]).specs);
  assert.equal(out["sma:10"].type, "sma");
  assert.equal(out["sma:10"].points.length, 31);
  assert.deepEqual(Object.keys(out["sma:10"].points[0]), ["t", "v"]);
  assert.equal(out["bb:20:2"].type, "bb");
  assert.equal(out["bb:20:2"].upper.length, 21);
  assert.ok(out["bb:20:2"].upper[0].v > out["bb:20:2"].lower[0].v);
});

test("chartWindowWithIndicators returns fully warmed points that match full-history maths", () => {
  const bars = makeBars(400);
  const specs = parseIndicatorList(["sma:20,ema:20"]).specs;
  const keep = chartKeepCount(bars.length, warmupBars(specs), 300);
  const win = chartWindowWithIndicators(bars, specs, keep);
  assert.equal(win.trimmed, true);
  assert.equal(win.bars.length, 300);
  assert.equal(win.bars[0].t, bars[100].t);

  const closes = bars.map((b) => b.c);
  const fullSma = sma(closes, 20);
  const fullEma = ema(closes, 20);
  const smaPts = win.ind["sma:20"].points;
  const emaPts = win.ind["ema:20"].points;
  assert.equal(smaPts.length, 300, "every kept bar has an SMA value");
  assert.equal(emaPts.length, 300, "every kept bar has an EMA value");
  for (let i = 0; i < 300; i++) {
    assert.equal(smaPts[i].t, win.bars[i].t);
    assert.ok(Math.abs(smaPts[i].v - fullSma[100 + i]) < 1e-9);
    assert.ok(Math.abs(emaPts[i].v - fullEma[100 + i]) < 1e-9);
  }
});

test("adjacent pages computed independently join without a gap or jump (SMA exact)", () => {
  const bars = makeBars(900);
  const specs = parseIndicatorList(["sma:30"]).specs;
  const warm = warmupBars(specs);
  // Newest page: bars[400..899] + warm-up; older page: everything before bars[400].
  const newer = chartWindowWithIndicators(bars.slice(400 - warm), specs, 500);
  const older = chartWindowWithIndicators(bars.slice(0, 400), specs, chartKeepCount(400, warm, 500));
  const joined = older.ind["sma:30"].points.concat(newer.ind["sma:30"].points);
  const full = sma(bars.map((b) => b.c), 30);
  const firstOld = older.bars[0].t;
  const offset = bars.findIndex((b) => b.t === firstOld);
  assert.equal(joined.length, bars.length - offset);
  for (let i = 0; i < joined.length; i++) {
    assert.ok(Math.abs(joined[i].v - full[offset + i]) < 1e-9, `point ${i}`);
  }
});

test("chartWindowWithIndicators without trimming returns the input bars", () => {
  const bars = makeBars(30);
  const win = chartWindowWithIndicators(bars, parseIndicatorList(["ema:5"]).specs, 0);
  assert.equal(win.trimmed, false);
  assert.equal(win.bars.length, 30);
});
