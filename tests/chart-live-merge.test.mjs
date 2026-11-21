// tests/chart-live-merge.test.mjs — live WS ticks must merge onto / append to the server's historical series and never
// replace it with a one-bar array (the "15m / 30m / 4H collapse to a single candle" bug).
//
// Root cause under test (src/vt_12_edge_and_search.js): a tick arriving on a timeframe with no history yet did
// `LIVE[k] = [oneTickBar]`; every later tick refreshed LT[k], so need() saw "fresh" data and never queued the REST
// history request. pumpEdge() also replaced LIVE[k] wholesale, dropping live bars received while REST was in flight.
// Since Task 11 the chart never builds candles from quote ticks; hub `bar` frames are applied verbatim.
// Run: node tests/chart-live-merge.test.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const edgeSrc = fs.readFileSync(path.join(ROOT, "src/vt_12_edge_and_search.js"), "utf8");
const feedSrc = fs.readFileSync(path.join(ROOT, "src/vt_04_market_feed.js"), "utf8");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}:`, err.stack || err.message);
  }
}

const STEP = { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1H": 3600, "4H": 14400, "1D": 86400 };
const mk = (t) => ({ t, o: 1.08, h: 1.0812, l: 1.0791, c: 1.0805, v: 0 });

function makeSandbox(tf, { history = null, fetchBars = [] } = {}) {
  const fetches = [];
  const LIVE = {};
  if (history) LIVE[`EURUSD|${tf}`] = history;
  const sandbox = {
    console, Date, Math, JSON, Map, Set, Array, Number, String, Object, RegExp, Promise, isFinite, URLSearchParams,
    setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
    requestAnimationFrame: () => 1,
    location: { protocol: "https:", host: "vektorterminal.com", hash: "" },
    window: {},
    document: {
      hidden: false, visibilityState: "visible",
      documentElement: { classList: { contains: () => false }, dataset: {} },
      addEventListener: () => {}, getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
    },
    fetch: async (u) => {
      fetches.push(String(u));
      return { ok: true, json: async () => ({ ok: true, bars: fetchBars.map((b) => ({ ...b })) }) };
    },
    S: { chart: { sym: "EURUSD", tf }, pageView: "chart", cols: [], sc: { panes: 1, tfB: "1D" }, data: { mode: "all" } },
    SC: {},
    SNAP: { t: 0, tfs: [], ok: true, uni: [["EURUSD", "FX", 1.08, 0, 1, 0.0001, "EUR/USD", "", "td", "EUR/USD"]] },
    SYMS: [["EURUSD", "FX", 1.08, 0, 1, 0.0001, "EUR/USD", "", "td", "EUR/USD"]],
    CUS: {}, LIVE, LT: {}, ERR: {}, PEND: {}, STEP, ch: {}, MS: {},
    isLive: () => true,
    symOf: (sym) => sandbox.SYMS.find((x) => x[0] === sym) || null,
    wlAll: () => ["EURUSD"],
    fp: (v) => Number(v).toFixed(5), fm: (v) => String(v),
    dirty: () => {}, markOk: () => {}, status: () => {}, fin: () => {},
    updateLiveBar: () => {}, checkAlerts: () => {}, drawChart: () => {},
  };
  vm.createContext(sandbox);
  const cutIdx = edgeSrc.indexOf("// ---------- 95 symbol search:");
  vm.runInContext(edgeSrc.slice(0, cutIdx) + "\nthis.vtCanUseEdge = () => true; vtCanUseEdge = this.vtCanUseEdge; this.QE = QE;\n", sandbox);
  return { sandbox, fetches };
}

const flush = () => new Promise((r) => setImmediate(r));

console.log("chart-live-merge.test.mjs");

for (const tf of ["15m", "30m", "4H"]) {
  await test(`${tf}: a server bar with no history never seeds a one-bar series; full history is requested from the backend`, async () => {
    const step = STEP[tf];
    const now = Math.floor(Date.now() / 1000);
    const forming = Math.floor(now / step) * step;
    const history = Array.from({ length: 300 }, (_, i) => mk(forming - (300 - i) * step));
    const { sandbox, fetches } = makeSandbox(tf, { fetchBars: history });
    const k = `EURUSD|${tf}`;

    // Quote ticks never build candles (Task 11): they neither seed nor request anything for the chart series.
    sandbox.vtApplyNormalizedTick("EURUSD", 1.0811, now * 1000, { source: "twelvedata" });
    assert.equal(sandbox.LIVE[k], undefined, "a quote tick never creates a chart series");

    // The first hub bar frame for a timeframe with no history asks for the server-merged history instead.
    sandbox.vtApplyServerBar("EURUSD", tf, [forming, 1.08, 1.0815, 1.0799, 1.0811, 0]);
    assert.ok(!Array.isArray(sandbox.LIVE[k]) || sandbox.LIVE[k].length !== 1, "no single-bar LIVE series");
    assert.ok(fetches.some((u) => u.includes("/api/candles") && u.includes(`interval=${encodeURIComponent(tf)}`)), "history requested");
    await flush();
    await flush();
    assert.equal(sandbox.LIVE[k].length, 300, "full server history installed");

    // Later server bars append the forming bar verbatim and never replace the series.
    sandbox.vtApplyServerBar("EURUSD", tf, [forming, 1.08, 1.0822, 1.0799, 1.082, 0]);
    assert.equal(sandbox.LIVE[k].length, 301);
    assert.deepEqual({ ...sandbox.LIVE[k].at(-1) }, { t: forming, o: 1.08, h: 1.0822, l: 1.0799, c: 1.082, v: 0 });
    assert.equal(sandbox.LIVE[k][0].t, history[0].t, "history head untouched");
  });

  await test(`${tf}: pumpEdge installs server bars without dropping a live bar newer than the server window`, async () => {
    const step = STEP[tf];
    const forming = Math.floor(Date.now() / 1000 / step) * step;
    const server = Array.from({ length: 200 }, (_, i) => mk(forming - (200 - i) * step)); // REST lags: no forming bar
    const liveForming = { t: forming, o: 1.08, h: 1.0822, l: 1.0799, c: 1.0815, v: 0 };
    const { sandbox } = makeSandbox(tf, { history: [liveForming], fetchBars: server });
    const k = `EURUSD|${tf}`;
    sandbox.QE.push([sandbox.SYMS[0], tf, k]);
    await sandbox.pumpEdge();
    assert.equal(sandbox.LIVE[k].length, 201, "server history + live forming bar");
    assert.equal(sandbox.LIVE[k].at(-1).c, 1.0815, "live forming bar kept");
    assert.equal(sandbox.LIVE[k][0].t, server[0].t);
  });
}

await test("source guard: no `LIVE[...] = [ {one tick bar} ]` seeding anywhere in the chart feed modules", () => {
  for (const [name, src] of [["vt_12_edge_and_search.js", edgeSrc], ["vt_04_market_feed.js", feedSrc]]) {
    assert.equal(/LIVE\[[^\]]+\]\s*=\s*\[\s*\{/.test(src), false, `${name} must not seed LIVE with a literal one-bar array`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
