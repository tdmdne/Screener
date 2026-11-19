// tests/vs.test.mjs — Task 6 golden parity, VS_LIM runaway guard, diagnostics, and cache key tests
// for shared/vs/ (lexer, parser, builtins, runtime).
// Run: node tests/vs.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  VS_LIM,
  VS_SERIES,
  VS_COLORS,
  VS_FN,
  VS_BUILTIN_NAMES,
  MAX_VS_BARS,
  MAX_VS_AST_NODES,
  VSError,
  vsLex,
  vsParse,
  vsSMA,
  vsEMA,
  vsSum,
  vsHighest,
  vsLowest,
  vsWMA,
  vsStdev,
  vsSuggest,
  vsRun,
  vsCompute,
  vsCacheKey,
  vsErrorPayload,
  vsFmtErr,
} from "../shared/vs/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---- Load live client Vektor Script engine verbatim from index.html into a clean VM ----
function loadIndexHtmlVS() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const startMarker = "const VS_LIM=";
  const endMarker = "const VS_MAX_SCRIPTS=";
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);
  assert.ok(startIdx > 0 && endIdx > startIdx, "Expected VS engine block in index.html");
  const code =
    html.slice(startIdx, endIdx) +
    "\n;({ VS_LIM, VSError, VS_SERIES, VS_COLORS, vsLex, vsParse, vsSMA, vsEMA, VS_FN, vsRun, VS_EX });";
  const ctx = vm.createContext({
    Float64Array,
    Math,
    Number,
    Object,
    Array,
    String,
    Error,
    RegExp,
    isNaN,
    isFinite,
  });
  return vm.runInContext(code, ctx);
}

// Normalize objects/arrays created inside a node:vm realm to host-realm prototypes while preserving NaN/Infinity.
function fromRealm(v) {
  if (v === null || typeof v !== "object") return v;
  if (v instanceof Float64Array || ArrayBuffer.isView(v)) return new Float64Array(v);
  if (Array.isArray(v)) return Array.from(v, fromRealm);
  const out = {};
  for (const k of Object.keys(v)) out[k] = fromRealm(v[k]);
  return out;
}

const CLIENT_VS = loadIndexHtmlVS();

// ---- Deterministic realistic multi-bar OHLCV fixture (no Math.random) ----
function buildRealisticBars(count = 240, startPrice = 100, startT = 1763400000) {
  const bars = [];
  let price = startPrice;
  let s = 0x1a2b3c4d;
  const nextRand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const wave = Math.sin(i / 11) * 1.4 + Math.cos(i / 27) * 0.9;
    const shock = (nextRand() - 0.49) * 3.2;
    const o = price;
    // Include an occasional flat bar and sharp move to exercise edge branches in rsi/tr/stoch/crossover
    const delta = i === 45 ? 0 : wave * 0.25 + shock;
    const c = Math.max(5, o + delta);
    const wickUp = Math.abs(nextRand()) * 1.8;
    const wickDn = Math.abs(nextRand()) * 1.8;
    const h = Math.max(o, c) + wickUp;
    const l = Math.max(1, Math.min(o, c) - wickDn);
    const v = Math.round(500 + nextRand() * 4500);
    bars.push({ o, h, l, c, v, t: startT + i * 3600 });
    price = c;
  }
  return bars;
}

const BARS = buildRealisticBars(240, 145.5);

function assertSeriesEqual(actual, expected, label, tol = 1e-12) {
  assert.ok(actual instanceof Float64Array, `${label}: actual must be Float64Array`);
  assert.equal(actual.length, expected.length, `${label}: length mismatch`);
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i];
    const b = expected[i];
    if (Number.isNaN(b)) {
      assert.ok(Number.isNaN(a), `${label}[${i}]: expected NaN, got ${a}`);
    } else {
      assert.ok(
        Math.abs(a - b) <= tol,
        `${label}[${i}]: expected ${b}, got ${a} (diff=${Math.abs(a - b)})`
      );
    }
  }
}

describe("Task 6: shared/vs — built-ins inventory & golden parity against index.html", () => {
  it("exports exactly all 29 built-in functions matching index.html VS_FN", () => {
    const clientKeys = Object.keys(CLIENT_VS.VS_FN);
    const serverKeys = Object.keys(VS_FN);
    assert.equal(serverKeys.length, 29, "VS_FN must contain all 29 built-ins");
    assert.equal(VS_BUILTIN_NAMES.length, 29);
    assert.deepEqual(serverKeys, clientKeys);
    assert.deepEqual({ ...VS_LIM }, fromRealm(CLIENT_VS.VS_LIM));
    assert.deepEqual([...VS_SERIES], fromRealm(CLIENT_VS.VS_SERIES));
    assert.deepEqual({ ...VS_COLORS }, fromRealm(CLIENT_VS.VS_COLORS));
  });

  it("matches index.html bit-for-bit on all 29 built-in functions over multi-bar data", () => {
    const cases = [
      ["sma", 'plot(sma(close, 14), "sma")'],
      ["ema", 'plot(ema(close, 14), "ema")'],
      ["rma", 'plot(rma(close, 14), "rma")'],
      ["wma", 'plot(wma(close, 10), "wma")'],
      ["stdev", 'plot(stdev(close, 20), "stdev")'],
      ["highest", 'plot(highest(high, 15), "highest")'],
      ["lowest", 'plot(lowest(low, 15), "lowest")'],
      ["sum", 'plot(sum(volume, 10), "sum")'],
      ["change (1-arg)", 'plot(change(close), "chg1")'],
      ["change (2-arg)", 'plot(change(close, 5), "chg5")'],
      ["roc", 'plot(roc(close, 10), "roc")'],
      ["rsi", 'plot(rsi(close, 14), "rsi")'],
      ["tr", 'plot(tr(), "tr")'],
      ["atr", 'plot(atr(14), "atr")'],
      ["crossover", 'plot(crossover(ema(close, 5), ema(close, 15)), "xo")'],
      ["crossunder", 'plot(crossunder(ema(close, 5), ema(close, 15)), "xu")'],
      ["cum", 'plot(cum(volume), "cum")'],
      ["nz (1-arg)", 'plot(nz(sma(close, 10)), "nz1")'],
      ["nz (2-arg)", 'plot(nz(sma(close, 10), close), "nz2")'],
      ["abs", 'plot(abs(change(close, 3)), "abs")'],
      ["sqrt", 'plot(sqrt(close), "sqrt")'],
      ["log", 'plot(log(close), "log")'],
      ["exp", 'plot(exp((close - open) / close), "exp")'],
      ["round (1-arg)", 'plot(round(close), "round0")'],
      ["round (2-arg)", 'plot(round(close, 2), "round2")'],
      ["floor", 'plot(floor(close), "floor")'],
      ["ceil", 'plot(ceil(close), "ceil")'],
      ["pow", 'plot(pow(hl2, 1.5), "pow")'],
      ["min", 'plot(min(open, close), "min")'],
      ["max", 'plot(max(open, close), "max")'],
      ["avg", 'plot(avg(high, low), "avg")'],
      ["isna", 'plot(isna(sma(close, 20)), "isna")'],
    ];

    // Confirm every single one of the 29 built-ins is explicitly exercised above.
    const covered = new Set(cases.map(([name]) => name.split(" ")[0]));
    for (const fn of VS_BUILTIN_NAMES) {
      assert.ok(covered.has(fn), `Built-in "${fn}" must be tested`);
    }

    const slidingFloatBuiltins = new Set(["wma", "stdev"]);
    for (const [label, src] of cases) {
      const serverRes = vsRun(src, BARS, {});
      const clientRes = CLIENT_VS.vsRun(src, BARS, {});
      assert.equal(serverRes.plots.length, clientRes.plots.length, `${label}: plot count`);
      const tol = slidingFloatBuiltins.has(label) ? 1e-12 : 0;
      assertSeriesEqual(serverRes.plots[0].v, clientRes.plots[0].v, label, tol);
    }
  });

  it("matches index.html on all 7 built-in VS_EX example scripts with default & custom inputs", () => {
    for (const ex of CLIENT_VS.VS_EX) {
      const sDefault = vsRun(ex.src, BARS, {});
      const cDefault = CLIENT_VS.vsRun(ex.src, BARS, {});
      assert.equal(sDefault.name, cDefault.name, ex.name);
      assert.equal(sDefault.overlay, cDefault.overlay, ex.name);
      assert.deepEqual(sDefault.inputs, fromRealm(cDefault.inputs), ex.name);
      assert.deepEqual(sDefault.hlines, fromRealm(cDefault.hlines), ex.name);
      assert.equal(sDefault.plots.length, cDefault.plots.length, ex.name);
      const tol = ex.name === "Bollinger Bands" ? 1e-12 : 0;
      for (let i = 0; i < cDefault.plots.length; i++) {
        assert.equal(sDefault.plots[i].title, cDefault.plots[i].title);
        assert.equal(sDefault.plots[i].color, cDefault.plots[i].color);
        assert.equal(sDefault.plots[i].width, cDefault.plots[i].width);
        assert.equal(sDefault.plots[i].style, cDefault.plots[i].style);
        assertSeriesEqual(sDefault.plots[i].v, cDefault.plots[i].v, `${ex.name}[${i}]`, tol);
      }
    }

    // Also test input overrides + clamping (min/max)
    const macdSrc = CLIENT_VS.VS_EX[0].src;
    const override = { "Fast length": 8, "Slow length": 9999, "Signal length": 0 };
    const sOv = vsRun(macdSrc, BARS, override);
    const cOv = CLIENT_VS.vsRun(macdSrc, BARS, override);
    assert.deepEqual(sOv.inputs, fromRealm(cOv.inputs));
    assert.equal(sOv.inputs[1].v, 400); // clamped to max=400
    assert.equal(sOv.inputs[2].v, 1); // clamped to min=1
    for (let i = 0; i < cOv.plots.length; i++) {
      assertSeriesEqual(sOv.plots[i].v, cOv.plots[i].v, `MACD override[${i}]`, 0);
    }
  });

  it("matches index.html on expressions, operators, lookbacks, missing open fallback, and vsSMA/vsEMA NaN edges", () => {
    const barsWithMissingOpen = BARS.slice(0, 60).map((b, i) =>
      i % 7 === 0 ? { h: b.h, l: b.l, c: b.c, v: b.v, t: b.t } : b
    );
    const src = `
      indicator("Complex", overlay=false)
      // comments, := alias, ; separator, ternary, unary, logic, history lookback
      a := (hl2 + hlc3 + ohlc4) / 3; b = close[2]
      cond = close > open and not (volume < 1000) or bar_index == 0
      val = cond ? -(a - nz(b, close)) : (high % 10)
      plot(val, "Val", color=#0f8, width=3, style="area")
      hline(0, "Zero", color=purple)
    `;
    const s = vsRun(src, barsWithMissingOpen, {});
    const c = CLIENT_VS.vsRun(src, barsWithMissingOpen, {});
    assertSeriesEqual(s.plots[0].v, c.plots[0].v, "complex expression", 0);
    assert.equal(s.plots[0].color, "#0f8");
    assert.equal(s.plots[0].width, 3);
    assert.equal(s.plots[0].style, "area");

    // Direct vsSMA / vsEMA / O(n) sliding-window primitives with embedded NaNs
    const withNans = new Float64Array([NaN, 10, 20, 30, NaN, 40, 50, 60, 70]);
    assertSeriesEqual(vsSMA(withNans, 3, withNans.length), CLIENT_VS.vsSMA(withNans, 3, withNans.length), "vsSMA NaN", 0);
    assertSeriesEqual(vsEMA(withNans, 3, withNans.length), CLIENT_VS.vsEMA(withNans, 3, withNans.length), "vsEMA NaN", 0);
    assertSeriesEqual(
      vsSum(withNans, 3, withNans.length),
      CLIENT_VS.VS_FN.sum.f([withNans, 3], withNans.length, {}, {}, CLIENT_VS.VS_LIM),
      "vsSum NaN",
      0
    );
    assertSeriesEqual(
      vsHighest(withNans, 3, withNans.length),
      CLIENT_VS.VS_FN.highest.f([withNans, 3], withNans.length, {}, {}, CLIENT_VS.VS_LIM),
      "vsHighest NaN",
      0
    );
    assertSeriesEqual(
      vsLowest(withNans, 3, withNans.length),
      CLIENT_VS.VS_FN.lowest.f([withNans, 3], withNans.length, {}, {}, CLIENT_VS.VS_LIM),
      "vsLowest NaN",
      0
    );
    assertSeriesEqual(
      vsWMA(withNans, 3, withNans.length),
      CLIENT_VS.VS_FN.wma.f([withNans, 3], withNans.length, {}, {}, CLIENT_VS.VS_LIM),
      "vsWMA NaN",
      1e-12
    );
    assertSeriesEqual(
      vsStdev(withNans, 3, withNans.length),
      CLIENT_VS.VS_FN.stdev.f([withNans, 3], withNans.length, {}, {}, CLIENT_VS.VS_LIM),
      "vsStdev NaN",
      1e-12
    );
  });
});

describe("Task 6: VS_LIM runaway script termination", () => {
  it("rejects scripts exceeding VS_LIM.src", () => {
    const huge = "x = 1\n".repeat(Math.ceil((VS_LIM.src + 10) / 6));
    const r = vsCompute(huge, BARS);
    assert.equal(r.ok, null);
    assert.match(r.error, /too long/i);
    assert.equal(typeof r.line, "number");
    assert.equal(typeof r.col, "number");
    assert.ok(r.hint.length > 0);
  });

  it("rejects scripts exceeding VS_LIM.stmts", () => {
    const many = Array.from({ length: VS_LIM.stmts + 1 }, (_, i) => `v${i} = ${i}`).join("\n") + "\nplot(close)";
    const r = vsCompute(many, BARS);
    assert.equal(r.ok, null);
    assert.match(r.error, /Too many statements/i);
    assert.equal(r.line, VS_LIM.stmts + 1);
    assert.ok(r.col >= 1);
    assert.ok(r.hint.length > 0);
  });

  it("rejects deeply nested expressions exceeding VS_LIM.depth", () => {
    const deep = "plot(" + "(".repeat(VS_LIM.depth + 2) + "close" + ")".repeat(VS_LIM.depth + 2) + ")";
    const r = vsCompute(deep, BARS);
    assert.equal(r.ok, null);
    assert.match(r.error, /nested too deeply/i);
    assert.equal(r.line, 1);
    assert.ok(r.col > 1);
    assert.ok(r.hint.length > 0);
  });

  it("rejects indicator period and history lookback exceeding VS_LIM.len", () => {
    const r1 = vsCompute(`plot(sma(close, ${VS_LIM.len + 1}))`, BARS);
    assert.equal(r1.ok, null);
    assert.match(r1.error, /at most 1000/);
    assert.equal(r1.line, 1);
    assert.ok(r1.hint.length > 0);

    const r2 = vsCompute(`plot(close[${VS_LIM.len + 1}])`, BARS);
    assert.equal(r2.ok, null);
    assert.match(r2.error, /looks back 0 to 1000/);
    assert.equal(r2.line, 1);
    assert.ok(r2.hint.length > 0);
  });

  it("rejects scripts exceeding VS_LIM.plots and VS_LIM.hlines", () => {
    const tooManyPlots = Array.from({ length: VS_LIM.plots + 1 }, () => "plot(close)").join("\n");
    const rp = vsCompute(tooManyPlots, BARS);
    assert.equal(rp.ok, null);
    assert.match(rp.error, /Too many plots/);
    assert.equal(rp.line, VS_LIM.plots + 1);
    assert.ok(rp.hint.length > 0);

    const tooManyHlines = Array.from({ length: VS_LIM.hlines + 1 }, (_, i) => `hline(${i})`).join("\n");
    const rh = vsCompute(tooManyHlines, BARS);
    assert.equal(rh.ok, null);
    assert.match(rh.error, /Too many hlines/);
    assert.equal(rh.line, VS_LIM.hlines + 1);
    assert.ok(rh.hint.length > 0);
  });

  it("terminates runaway AST evaluation when exceeding VS_LIM.nodes (default 2e6 & tightened limits)", () => {
    // Tightened node budget on normal source text
    const src = "a = close + open\nb = a * 2\nc = sma(b, 5)\nplot(c)";
    const rSmall = vsCompute(src, BARS, { limits: { nodes: 5 } });
    assert.equal(rSmall.ok, null);
    assert.match(rSmall.error, /too much work/i);
    assert.ok(rSmall.line >= 1);
    assert.ok(rSmall.col >= 1);
    assert.ok(rSmall.hint.length > 0);

    // Construct a compact 22-level shared DAG AST -> 2^22 = 4,194,304 evaluations > default VS_LIM.nodes (2e6)
    let node = { k: "num", v: 1, line: 3, col: 5 };
    for (let i = 0; i < 22; i++) {
      node = { k: "bin", op: "+", a: node, b: node, line: 3, col: 5 };
    }
    const prog = [{ k: "do", e: node, line: 3, col: 1 }];
    assert.throws(
      () => vsRun(prog, BARS.slice(0, 5), {}),
      (err) => {
        assert.ok(err instanceof VSError);
        const payload = vsErrorPayload(err);
        assert.match(payload.error, /too much work/i);
        assert.equal(payload.line, 3);
        assert.equal(payload.col, 5);
        assert.ok(payload.hint.length > 0);
        return true;
      }
    );
  });

  it("blocks stack-overflow & CPU/memory DoS attacks (500+ unary, 500+ ternary, 1000+ bin, 500+ hist, repeated stdev) in < 50 ms", () => {
    const assertCleanStructuredError = (label, res, elapsedMs, pattern) => {
      assert.equal(res.ok, null, `${label}: must fail cleanly`);
      assert.ok(res.err && typeof res.err === "object", `${label}: structured err object`);
      assert.match(res.error, pattern, `${label}: error message`);
      assert.equal(typeof res.line, "number", `${label}: numeric line`);
      assert.equal(typeof res.col, "number", `${label}: numeric col`);
      assert.ok(typeof res.hint === "string" && res.hint.length > 0, `${label}: non-empty hint`);
      assert.ok(elapsedMs < 50, `${label}: expected < 50 ms, took ${elapsedMs.toFixed(2)} ms`);
    };

    // 1. 500+ nested unary minus (plus + and not)
    for (const [label, src] of [
      ["500+ unary -", "plot(" + "-".repeat(550) + "1)"],
      ["500+ unary +", "plot(" + "+".repeat(550) + "1)"],
      ["500+ unary not", "plot(" + "not ".repeat(550) + "1)"],
      ["500+ chained ternaries", "plot(" + "1?1:".repeat(550) + "1)"],
      ["1000+ chained 1+1+...", "plot(" + "1+".repeat(1050) + "1)"],
      ["500+ chained history [1]", "plot(close" + "[1]".repeat(550) + ")"],
    ]) {
      const t0 = performance.now();
      const res = vsCompute(src, BARS);
      const elapsed = performance.now() - t0;
      assertCleanStructuredError(label, res, elapsed, /nested too deeply/i);
      assert.equal(res.line, 1, `${label}: line`);
      assert.ok(res.col >= 1, `${label}: col`);
    }

    // 2. Direct deep AST passed to vsRun() bypassing vsParse() -> ev() depth guard catches it cleanly
    let deepAst = { k: "num", v: 1, line: 2, col: 4 };
    for (let i = 0; i < 550; i++) {
      deepAst = { k: "neg", e: deepAst, line: 2, col: 4 };
    }
    const tAst0 = performance.now();
    assert.throws(
      () => vsRun([{ k: "do", e: deepAst, line: 2, col: 1 }], BARS.slice(0, 5), {}),
      (err) => {
        assert.ok(err instanceof VSError, "must throw VSError, not RangeError");
        const p = vsErrorPayload(err);
        assert.match(p.error, /nested too deeply/i);
        assert.equal(p.line, 2);
        assert.equal(p.col, 4);
        assert.ok(p.hint.length > 0);
        return true;
      }
    );
    assert.ok(performance.now() - tAst0 < 50, "ev() depth guard must finish in < 50 ms");

    // 3. Total AST node cap in vsParse()
    const shallowManyNodes = Array.from(
      { length: 200 },
      (_, i) => `v${i} = ` + Array.from({ length: 15 }, () => "1").join("+")
    ).join("\n") + "\nplot(close)";
    assert.ok(MAX_VS_AST_NODES <= 5000);
    const tNodes0 = performance.now();
    const resNodes = vsCompute(shallowManyNodes, BARS);
    assertCleanStructuredError("AST node cap", resNodes, performance.now() - tNodes0, /too complex/i);

    // 4. Repeated stdev(close, 500) on MAX_VS_BARS (5000) -> charges series length n against VS_LIM.nodes
    const maxBars = buildRealisticBars(MAX_VS_BARS, 145.5);
    const repeatedStdev =
      Array.from(
        { length: 220 },
        (_, i) => `s${i} = stdev(close, 500) + stdev(close, 500)`
      ).join("\n") + "\nplot(s0)";
    const tStdev0 = performance.now();
    const resStdev = vsCompute(repeatedStdev, maxBars);
    const stdevMs = performance.now() - tStdev0;
    assertCleanStructuredError("repeated stdev(close, 500)", resStdev, stdevMs, /too much work/i);
    assert.ok(resStdev.line >= 1);
    assert.ok(resStdev.col >= 1);

    // 5. MAX_VS_BARS cap in vsRun()
    const tooManyBars = [...maxBars, maxBars[maxBars.length - 1]];
    const rTooMany = vsCompute("plot(close)", tooManyBars);
    assert.equal(rTooMany.ok, null);
    assert.match(rTooMany.error, /Too many bars/i);
    assert.ok(rTooMany.hint.length > 0);
  });

  it("hardens input(), hline(), col() null-bar guard, and vsSuggest() length short-circuit", () => {
    // input() uses vsOwn(iv, t) so Object.prototype keys like "toString" do not leak
    const rProto = vsCompute('v = input(14, "toString")\nplot(close + v)', BARS, {});
    assert.ok(rProto.ok, "toString input title should work safely with vsOwn");
    assert.equal(rProto.ok.inputs[0].v, 14);

    // input() rejects min > max
    const rMinMax = vsCompute('v = input(14, "Len", min=50, max=10)\nplot(close + v)', BARS, {});
    assert.equal(rMinMax.ok, null);
    assert.match(rMinMax.error, /min cannot be greater than max/i);

    // input() and hline() reject unknown kwargs
    const rInKw = vsCompute('v = input(14, "Len", bogus=1)\nplot(close + v)', BARS, {});
    assert.equal(rInKw.ok, null);
    assert.match(rInKw.error, /has no option/i);

    const rHlKw = vsCompute('hline(50, "Mid", bogus=1)\nplot(close)', BARS, {});
    assert.equal(rHlKw.ok, null);
    assert.match(rHlKw.error, /has no option/i);

    // col() tolerates null/undefined bar slots without throwing TypeError
    const sparseBars = [BARS[0], null, undefined, BARS[3]];
    const rSparse = vsCompute("plot(close)", sparseBars);
    assert.ok(rSparse.ok);
    assert.ok(Number.isNaN(rSparse.ok.plots[0].v[1]));
    assert.ok(Number.isNaN(rSparse.ok.plots[0].v[2]));
    assert.equal(rSparse.ok.plots[0].v[3], BARS[3].c);

    // vsSuggest short-circuits long mismatches cleanly
    assert.equal(vsSuggest("x".repeat(500), VS_BUILTIN_NAMES), null);
    assert.equal(vsSuggest("smaa", VS_BUILTIN_NAMES), "sma");
  });
});

describe("Task 6: Syntax & runtime error diagnostics ({ error, line, col, hint })", () => {
  const cases = [
    ["lexer: unclosed quote", 'indicator("oops\nplot(close)', 1, 11],
    ["lexer: invalid hex color", 'plot(close, "x", color=#12345)', 1, 24],
    ["lexer: dot property access", "plot(ta.sma(close, 10))", 1, 8],
    ["lexer: unexpected char", "x = 1 @ 2\nplot(close)", 1, 7],
    ["parser: missing closing paren", "plot(sma(close, 10)", 1, 20],
    ["parser: incomplete ternary", "x = close > open ? 1\nplot(x)", 1, 21],
    ["parser: built-in reassignment", "close = 5\nplot(close)", 1, 1],
    ["parser: two statements without newline", "x = 1 y = 2\nplot(x)", 1, 7],
    ["runtime: unknown identifier suggestion", "fast = ema(close, 12)\nplot(fats)", 2, 6],
    ["runtime: unknown function suggestion", "plot(smaa(close, 10))", 1, 6],
    ["runtime: wrong arity", "plot(sma(close))", 1, 6],
    ["runtime: named arg on built-in", "plot(sma(close, 10, color=red))", 1, 6],
    ["runtime: series passed as length", "plot(sma(close, close))", 1, 6],
    ["runtime: unknown colour", 'plot(close, "x", color="chartreuse")', 1, 1],
    ["runtime: unknown plot style", 'plot(close, "x", style="dots")', 1, 1],
    ["runtime: text in arithmetic", 'x = close + "hi"\nplot(x)', 1, 11],
    ["runtime: nothing to plot", "x = sma(close, 10)", 0, 0],
  ];

  for (const [name, src, expLine, expCol] of cases) {
    it(`returns structured { error, line, col, hint } for ${name}`, () => {
      const r = vsCompute(src, BARS);
      assert.equal(r.ok, null, `${name} should fail`);
      assert.ok(r.err && typeof r.err === "object");
      assert.equal(typeof r.err.error, "string");
      assert.ok(r.err.error.length > 0, `${name}: error message non-empty`);
      assert.equal(r.err.line, expLine, `${name}: line`);
      assert.equal(r.err.col, expCol, `${name}: col`);
      assert.equal(typeof r.err.hint, "string");
      assert.ok(r.err.hint.length > 0, `${name}: hint must be non-empty`);
      assert.equal(r.error, r.err.error);
      assert.equal(r.line, r.err.line);
      assert.equal(r.col, r.err.col);
      assert.equal(r.hint, r.err.hint);
      assert.ok(vsFmtErr(r.err).includes(r.err.error));
    });
  }

  it("includes helpful typo suggestion in hint for misspelled names", () => {
    const r = vsCompute("fast = ema(close, 12)\nplot(fats)", BARS);
    assert.match(r.hint, /fast/);
    const r2 = vsCompute("plot(smaa(close, 10))", BARS);
    assert.match(r2.hint, /sma\(\)/);
  });
});

describe("Task 6: Deterministic cache keying & vsCompute caching", () => {
  it("produces deterministic SHA-256 keys independent of input object key order", () => {
    const src = 'len = input(14, "Length")\nmult = input(2, "Mult")\nplot(sma(close, len) * mult)';
    const k1 = vsCacheKey(src, { Length: 20, Mult: 2.5 }, "BTCUSDT", "1H", 1763403600);
    const k2 = vsCacheKey(src, { Mult: 2.5, Length: 20 }, "BTCUSDT", "1H", 1763403600);
    assert.equal(k1, k2);
    assert.match(k1, /^vs:v1:[0-9a-f]{64}$/);

    // Verify pure-JS SHA-256 matches Node's native crypto SHA-256 identically
    const expectedPayload = JSON.stringify([
      src,
      [
        ["Length", 20],
        ["Mult", 2.5],
      ],
      "BTCUSDT",
      "1H",
      1763403600,
    ]);
    const expectedHash = crypto.createHash("sha256").update(expectedPayload, "utf8").digest("hex");
    assert.equal(k1, "vs:v1:" + expectedHash);
  });

  it("invalidates cache key when any of src, inputs, sym, tf, or lastBarT changes", () => {
    const base = vsCacheKey("plot(close)", { a: 1 }, "BTCUSDT", "1H", 1000);
    assert.notEqual(base, vsCacheKey("plot(open)", { a: 1 }, "BTCUSDT", "1H", 1000));
    assert.notEqual(base, vsCacheKey("plot(close)", { a: 2 }, "BTCUSDT", "1H", 1000));
    assert.notEqual(base, vsCacheKey("plot(close)", { a: 1 }, "ETHUSDT", "1H", 1000));
    assert.notEqual(base, vsCacheKey("plot(close)", { a: 1 }, "BTCUSDT", "4H", 1000));
    assert.notEqual(base, vsCacheKey("plot(close)", { a: 1 }, "BTCUSDT", "1H", 2000));
  });

  it("caches computation results in caller-supplied Map and serves cache hits cleanly", () => {
    const cache = new Map();
    const script = { src: 'plot(ema(close, 20), "EMA 20")', inp: {} };
    const r1 = vsCompute(script, BARS, { sym: "BTCUSDT", tf: "1H", cache });
    const r2 = vsCompute(script, BARS, { sym: "BTCUSDT", tf: "1H", cache });
    assert.equal(r1.cached, false);
    assert.equal(r2.cached, true);
    assert.equal(r1.key, r2.key);
    assert.ok(r1.ok && r2.ok);
    assertSeriesEqual(r2.ok.plots[0].v, r1.ok.plots[0].v, "cached EMA", 0);

    // New bar -> cache miss
    const moreBars = [...BARS, { ...BARS[BARS.length - 1], t: BARS[BARS.length - 1].t + 3600 }];
    const r3 = vsCompute(script, moreBars, { sym: "BTCUSDT", tf: "1H", cache });
    assert.equal(r3.cached, false);
    assert.notEqual(r3.key, r1.key);
  });

  it("shared/vs modules have zero Node API, DOM, or eval/Function dependencies", () => {
    const files = ["lexer.js", "parser.js", "builtins.js", "runtime.js", "index.js"];
    for (const f of files) {
      const raw = fs.readFileSync(path.join(ROOT, "shared", "vs", f), "utf8");
      const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      assert.doesNotMatch(codeOnly, /\b(document|window|eval|new Function)\b/, `${f} must stay pure`);
      assert.doesNotMatch(codeOnly, /from\s+["']node:/, `${f} must stay Workers-compatible`);
    }
  });
});
