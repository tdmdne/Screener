// Verifies Twelve Data WebSocket single-source real-time pipeline (zero client polling, zero direct external WS, unified normalization across chart, watchlist, screener, and heatmap)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = process.cwd();
const edgeSrc = fs.readFileSync(path.join(ROOT, "src/vt_12_edge_and_search.js"), "utf8");
const wlSrc = fs.readFileSync(path.join(ROOT, "src/vt_02_watchlist_screener.js"), "utf8");
const feedSrc = fs.readFileSync(path.join(ROOT, "src/vt_04_market_feed.js"), "utf8");
const serverSrc = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const workerSrc = fs.readFileSync(path.join(ROOT, "worker.js"), "utf8");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}:`, err.message);
    process.exitCode = 1;
  }
}

console.log("ws-realtime.test.mjs");

test("client edge module has zero direct external WebSockets and zero REST price polling loops", () => {
  assert.equal(/wss:\/\/ws\.twelvedata\.com/i.test(edgeSrc), false, "must not open direct Twelve Data WS from browser");
  assert.equal(/wss:\/\/stream\.binance\.com/i.test(edgeSrc), false, "must not open direct Binance WS from browser");
  assert.equal(/setInterval\s*\(\s*vtTdPoll/.test(edgeSrc), false, "must not poll vtTdPoll on interval");
  assert.equal(/setTimeout\s*\(\s*poll\s*,\s*15000\s*\)/.test(edgeSrc), false, "must not poll klines every 15s");
  assert.match(edgeSrc, /vtOpenEdgeWs/, "must connect to same-origin /ws");
  assert.match(edgeSrc, /proto\s*\+\s*"\/\/"\s*\+\s*location\.host\s*\+\s*"\/ws"/, "must target same-origin /ws");
});

test("market feed module removed 15-minute polling interval and connects WS on boot", () => {
  assert.equal(/setInterval\s*\(\s*\(\)\s*=>\s*\{\s*if\s*\(!document\.hidden\)\s*autoRefresh/.test(feedSrc), false, "must not poll autoRefresh every 15 minutes");
  assert.match(feedSrc, /vtWsConnect\s*\(\)/, "boot must initialize unified WS connection");
});

test("watchlist wlData reads VT_EDGE_META via Map.get()", () => {
  assert.match(wlSrc, /VT_EDGE_META\.get\s*\(\s*n\s*\)/, "wlData must read VT_EDGE_META.get(n)");
});

test("server.js and worker.js connect upstream to Twelve Data WS and speak Protocol v2", () => {
  assert.match(serverSrc, /wss:\/\/ws\.twelvedata\.com\/v1\/quotes\/price/, "server.js must connect to Twelve Data WS");
  assert.match(serverSrc, /upsertLiveQuote/, "server.js must maintain unified liveQuotes store");
  assert.match(serverSrc, /renderLiveScreenerBody/, "server.js must serve live WS quotes in /api/screener");
  assert.match(serverSrc, /op\s*===\s*"view"/, "server.js must support Protocol v2 view frames");
  assert.match(workerSrc, /https:\/\/ws\.twelvedata\.com\/v1\/quotes\/price/, "worker.js MarketRelayDO must connect to Twelve Data WS via CF fetch upgrade");
  assert.match(workerSrc, /"action"\s*:\s*"heartbeat"/, "worker.js MarketRelayDO must send Twelve Data 10s heartbeat");
  assert.match(workerSrc, /_sendV2\s*\(\s*ws\s*,\s*"quotes"/, "worker.js MarketRelayDO must emit Protocol v2 quotes frames");
});

test("single normalized WS quotes & bar frames update chart, watchlist, screener, and metadata identically", () => {
  const updatedBars = [];
  const alerted = [];
  const fakeCpx = { textContent: "" };

  const baseSec = Math.floor(Date.now() / 3600000) * 3600;
  const daySec = Math.floor(baseSec / 86400) * 86400;

  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Map,
    Set,
    Array,
    Number,
    String,
    Object,
    RegExp,
    isFinite,
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    requestAnimationFrame: () => 1,
    location: { protocol: "https:", host: "vektorterminal.com", hash: "" },
    window: {},
    document: {
      hidden: false,
      visibilityState: "visible",
      documentElement: { classList: { contains: () => false }, dataset: {} },
      addEventListener: () => {},
      getElementById: (id) => (id === "cpx" ? fakeCpx : null),
      querySelectorAll: () => [],
      querySelector: () => null,
    },
    S: {
      chart: { sym: "EURUSD", tf: "1H" },
      pageView: "chart",
      cols: [],
      sc: { panes: 1, tfB: "1D" },
    },
    SC: {},
    SNAP: {
      t: 0,
      tfs: ["1D", "1H"],
      ok: true,
      uni: [
        ["EURUSD", "FX", 1.0800, 1000, 1, 0.0001, "EUR/USD", "", "td", "EUR/USD"],
        ["AAPL", "STK", 220.00, 500000, 1, 0.01, "AAPL", "", "td", "AAPL"],
        ["BTCUSDT", "CRY", 90000, 1200, 1, 0.01, "BTC/USD", "", "td", "BTC/USD"],
      ],
    },
    SYMS: [
      ["EURUSD", "FX", 1.0800, 1000, 1, 0.0001, "EUR/USD", "", "td", "EUR/USD"],
      ["AAPL", "STK", 220.00, 500000, 1, 0.01, "AAPL", "", "td", "AAPL"],
      ["BTCUSDT", "CRY", 90000, 1200, 1, 0.01, "BTC/USD", "", "td", "BTC/USD"],
    ],
    CUS: {},
    LIVE: {
      "EURUSD|1H": [{ t: baseSec, o: 1.0800, h: 1.0810, l: 1.0790, c: 1.0800, v: 500 }],
      "EURUSD|1D": [
        { t: daySec - 86400, o: 1.0750, h: 1.0810, l: 1.0740, c: 1.0800, v: 900 },
        { t: daySec, o: 1.0800, h: 1.0810, l: 1.0790, c: 1.0800, v: 500 },
      ],
    },
    LT: {},
    ERR: {},
    PEND: {},
    STEP: { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1H": 3600, "4H": 14400, "1D": 86400 },
    ch: {},
    MS: {},
    isLive: () => true,
    symOf: (sym) => sandbox.SYMS.find((x) => x[0] === sym) || null,
    wlAll: () => ["EURUSD", "AAPL", "BTCUSDT"],
    fp: (v) => Number(v).toFixed(4),
    fm: (v) => String(v),
    dirty: () => {},
    markOk: () => {},
    status: () => {},
    updateLiveBar: (sym, tf, t) => updatedBars.push({ sym, tf, t }),
    checkAlerts: (sym, px) => alerted.push({ sym, px }),
  };

  vm.createContext(sandbox);
  // Load only the edge client portion (before symbol search catalog) and expose lexical VT_EDGE_META
  const cutIdx = edgeSrc.indexOf("// ---------- 95 symbol search:");
  vm.runInContext(edgeSrc.slice(0, cutIdx) + "\nthis.__META = VT_EDGE_META;\n", sandbox);
  const metaMap = sandbox.__META;

  // Feed Protocol v2 quotes frame from Twelve Data WS relay
  const quotesFrame = JSON.stringify({
    v: 2,
    seq: 1,
    type: "quotes",
    quotes: [
      { s: "EURUSD", c: 1.0854, v: 1420, chgPct: 0.5, t: baseSec * 1000 + 5000, source: "twelvedata" },
      { s: "AAPL", c: 224.50, v: 610000, chgPct: 2.05, t: baseSec * 1000 + 5000, source: "twelvedata" },
      { s: "BTCUSDT", c: 91250.25, v: 1800, chgPct: 1.39, t: baseSec * 1000 + 5000, source: "twelvedata" },
    ],
  });

  sandbox.vtHandleEdgeWsMessage(quotesFrame);

  // Verify single normalized state across SYMS, SNAP.uni, VT_EDGE_META, LIVE 1D, LIVE 1H, and chart header
  assert.equal(sandbox.SYMS[0][2], 1.0854, "SYMS EURUSD updated");
  assert.equal(sandbox.SNAP.uni[0][2], 1.0854, "SNAP.uni EURUSD updated");
  assert.equal(metaMap.get("EURUSD").last, 1.0854, "VT_EDGE_META EURUSD updated");
  assert.equal(metaMap.get("EURUSD").pct, 0.5, "VT_EDGE_META EURUSD chgPct updated");
  assert.equal(sandbox.LIVE["EURUSD|1H"][0].c, 1.0854, "active 1H chart candle close updated");
  assert.equal(sandbox.LIVE["EURUSD|1H"][0].h, 1.0854, "active 1H chart candle high updated");
  assert.equal(sandbox.LIVE["EURUSD|1D"][1].c, 1.0854, "1D candle close synced for watchlist/screener");
  assert.equal(fakeCpx.textContent, "1.0854", "chart live price header updated");
  assert.equal(updatedBars.length, 1, "updateLiveBar called once for active chart symbol");

  assert.equal(sandbox.SYMS[1][2], 224.50, "SYMS AAPL updated");
  assert.equal(sandbox.SNAP.uni[1][2], 224.50, "SNAP.uni AAPL updated");
  assert.equal(metaMap.get("AAPL").pct, 2.05, "VT_EDGE_META AAPL chgPct updated");

  assert.equal(sandbox.SYMS[2][2], 91250.25, "SYMS BTCUSDT updated");
  assert.equal(metaMap.get("BTCUSDT").last, 91250.25, "VT_EDGE_META BTCUSDT updated");
  assert.equal(alerted.length, 3, "alerts checked for all incoming quotes");

  // Feed Protocol v2 server bar frame for EURUSD 1H
  const barFrame = JSON.stringify({
    v: 2,
    seq: 2,
    type: "bar",
    sym: "EURUSD",
    tf: "1H",
    bar: [baseSec, 1.0800, 1.0870, 1.0790, 1.0865, 1650],
  });
  sandbox.vtHandleEdgeWsMessage(barFrame);

  assert.equal(sandbox.LIVE["EURUSD|1H"][0].c, 1.0865, "server bar close applied to active chart");
  assert.equal(sandbox.LIVE["EURUSD|1H"][0].h, 1.0870, "server bar high applied to active chart");
  assert.equal(sandbox.SYMS[0][2], 1.0865, "server bar price synced to SYMS");
  assert.equal(sandbox.SNAP.uni[0][2], 1.0865, "server bar price synced to SNAP.uni");
  assert.equal(metaMap.get("EURUSD").last, 1.0865, "server bar price synced to VT_EDGE_META");
});

console.log(`ws-realtime.test.mjs: ${passed} passed`);
