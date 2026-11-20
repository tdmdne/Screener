// Mandate guard for Tasks 9-11 (AGENTS.md §0): the chart renders server bars and server indicator series only.
// 1. The deleted client candle builders/mergers never come back in any script index.html loads.
// 2. Browser indicator maths (emaArr/smaArr/rsiArr/atrArr calls) may only shrink. What is left is screener scoring and
//    filtering (Task 13); chart, split pane, data window, legend and ATR badge read vt_13_server_indicators.js.
// Run: node tests/chart-server-side-guard.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, "-", err && err.message ? err.message : err);
    process.exitCode = 1;
  }
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const loaded = [...html.matchAll(/<script[^>]*src="(src\/[^"]+\.js)"/g)].map((m) => m[1]);
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const DELETED = /\b(vtBuildChartData|vtMergeBars|vtNewBarOpen)\b/g;
const MATHS = /\b(emaArr|smaArr|rsiArr|atrArr)\s*\(/g;
/** Remaining browser indicator maths (screener scoring/filters, Task 13). Lower as code is deleted; never raise. */
const BASELINE = {
  "src/vt_01_core_state.js": 12,
  "src/vt_02_watchlist_screener.js": 6,
};

test("index.html loads the server-indicator store after the edge client", () => {
  const edge = loaded.indexOf("src/vt_12_edge_and_search.js");
  const ind = loaded.indexOf("src/vt_13_server_indicators.js");
  assert.ok(edge >= 0 && ind > edge, JSON.stringify(loaded));
});

test("deleted client candle building/merging functions stay deleted", () => {
  const hits = loaded.filter((f) => (read(f).match(DELETED) || []).length);
  assert.deepEqual(hits, []);
});

test("chart renderers never call browser indicator maths", () => {
  for (const f of ["src/vt_06_supercharts_tools.js", "src/vt_13_server_indicators.js", "src/vt_12_edge_and_search.js"]) {
    assert.equal((read(f).match(MATHS) || []).length, 0, f);
  }
  const chartSrc = read("src/vt_02_watchlist_screener.js");
  const draw = chartSrc.slice(chartSrc.indexOf("function updateLiveBar("));
  assert.equal((draw.match(MATHS) || []).length, 0, "updateLiveBar..drawChart in vt_02 uses server series only");
});

test("browser indicator maths only shrinks (ratchet)", () => {
  const problems = [];
  for (const f of loaded) {
    const now = (read(f).match(MATHS) || []).length;
    const base = BASELINE[f] || 0;
    if (now > base) problems.push(`${f}: ${now} indicator maths calls, baseline ${base}. Compute it on the server instead.`);
    if (now < base) problems.push(`${f}: ${now} calls, baseline ${base}. Lower BASELINE to ${now} to lock the progress in.`);
  }
  assert.deepEqual(problems, []);
});

console.log(`chart-server-side-guard.test.mjs: ${passed} passed, ${failed} failed`);
