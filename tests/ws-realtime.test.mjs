// Verifies Twelve Data WebSocket single-source real-time pipeline:
// - Zero client polling & zero direct external WS
// - Exact upstream symbol mapping (BTCUSDT -> BTC/USD, ETHUSDT -> ETH/USD, EURUSD -> EUR/USD)
// - LRU zero-viewer slot eviction when TD_WS_MAX (8) is reached + cached quote fallback
// - Trial-whitelist resilience: immediate slot release + backfill on subscribe-status fails
// - Unified client state sync across Chart, Watchlist, Screener, and Heatmap

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { toTwelveSymbol } from "../shared/schema.js";
import { TdSubscriptionManager } from "../shared/market/tdSlots.js";
import { MarketHub } from "../workers/market/hub.js";

const ROOT = process.cwd();
const edgeSrc = fs.readFileSync(path.join(ROOT, "src/vt_12_edge_and_search.js"), "utf8");
const wlSrc = fs.readFileSync(path.join(ROOT, "src/vt_02_watchlist_screener.js"), "utf8");
const feedSrc = fs.readFileSync(path.join(ROOT, "src/vt_04_market_feed.js"), "utf8");
const serverSrc = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const workerSrc = fs.readFileSync(path.join(ROOT, "worker.js"), "utf8");

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}:`, err.stack || err.message);
    process.exitCode = 1;
  }
}

console.log("ws-realtime.test.mjs");

await test("client edge module has zero direct external WebSockets and zero REST price polling loops", () => {
  assert.equal(/wss:\/\/ws\.twelvedata\.com/i.test(edgeSrc), false, "must not open direct Twelve Data WS from browser");
  assert.equal(/wss:\/\/stream\.binance\.com/i.test(edgeSrc), false, "must not open direct Binance WS from browser");
  assert.equal(/setInterval\s*\(\s*vtTdPoll/.test(edgeSrc), false, "must not poll vtTdPoll on interval");
  assert.equal(/setTimeout\s*\(\s*poll\s*,\s*15000\s*\)/.test(edgeSrc), false, "must not poll klines every 15s");
  assert.match(edgeSrc, /vtOpenEdgeWs/, "must connect to same-origin /ws");
  assert.match(edgeSrc, /proto\s*\+\s*"\/\/"\s*\+\s*location\.host\s*\+\s*"\/ws"/, "must target same-origin /ws");
});

await test("market feed module removed 15-minute polling interval and connects WS on boot", () => {
  assert.equal(/setInterval\s*\(\s*\(\)\s*=>\s*\{\s*if\s*\(!document\.hidden\)\s*autoRefresh/.test(feedSrc), false, "must not poll autoRefresh every 15 minutes");
  assert.match(feedSrc, /vtWsConnect\s*\(\)/, "boot must initialize unified WS connection");
});

await test("watchlist wlData reads VT_EDGE_META via Map.get()", () => {
  assert.match(wlSrc, /VT_EDGE_META\.get\s*\(\s*n\s*\)/, "wlData must read VT_EDGE_META.get(n)");
});

await test("server.js and worker.js wire TdSubscriptionManager, subscribe-status fails, and Protocol v2", () => {
  assert.match(serverSrc, /wss:\/\/ws\.twelvedata\.com\/v1\/quotes\/price/, "server.js must connect to Twelve Data WS");
  assert.match(serverSrc, /new TdSubscriptionManager/, "server.js must use shared TdSubscriptionManager");
  assert.match(serverSrc, /handleSubscribeStatus/, "server.js must release slots on subscribe-status fails");
  assert.match(serverSrc, /upsertLiveQuote/, "server.js must maintain unified liveQuotes store");
  assert.match(serverSrc, /renderLiveScreenerBody/, "server.js must serve live WS quotes in /api/screener");
  assert.match(serverSrc, /op\s*===\s*"view"/, "server.js must support Protocol v2 view frames");
  assert.match(workerSrc, /https:\/\/ws\.twelvedata\.com\/v1\/quotes\/price/, "worker.js MarketRelayDO must connect to Twelve Data WS via CF fetch upgrade");
  assert.match(workerSrc, /new TdSubscriptionManager/, "worker.js MarketRelayDO must use shared TdSubscriptionManager");
  assert.match(workerSrc, /handleSubscribeStatus/, "worker.js MarketRelayDO must release slots on subscribe-status fails");
  assert.match(workerSrc, /"action"\s*:\s*"heartbeat"/, "worker.js MarketRelayDO must send Twelve Data 10s heartbeat");
  assert.match(workerSrc, /_sendV2\s*\(\s*ws\s*,\s*"quotes"/, "worker.js MarketRelayDO must emit Protocol v2 quotes frames");
});

await test("upstream symbol mapping translates internal crypto/FX/equity tickers to exact Twelve Data format", () => {
  assert.equal(toTwelveSymbol("BTCUSDT"), "BTC/USD");
  assert.equal(toTwelveSymbol("ETHUSDT"), "ETH/USD");
  assert.equal(toTwelveSymbol("SOLUSDC"), "SOL/USD");
  assert.equal(toTwelveSymbol("BTCBUSD"), "BTC/USD");
  assert.equal(toTwelveSymbol("BTCUSD"), "BTC/USD");
  assert.equal(toTwelveSymbol("ETHUSD"), "ETH/USD");
  assert.equal(toTwelveSymbol("BTC/USD"), "BTC/USD");
  assert.equal(toTwelveSymbol("ETH/USD"), "ETH/USD");
  assert.equal(toTwelveSymbol("EURUSD"), "EUR/USD");
  assert.equal(toTwelveSymbol("GBPUSD"), "GBP/USD");
  assert.equal(toTwelveSymbol("USDJPY"), "USD/JPY");
  assert.equal(toTwelveSymbol("XAUUSD"), "XAU/USD");
  assert.equal(toTwelveSymbol("AAPL"), "AAPL");
  assert.equal(toTwelveSymbol("QQQ"), "QQQ");
});

await test("TdSubscriptionManager enforces TD_WS_MAX=8 with LRU zero-viewer eviction and exact Twelve Data mapping", () => {
  let now = 1000;
  const mgr = new TdSubscriptionManager({ maxSlots: 8, now: () => now });

  // Fill 8 slots at distinct timestamps so lastAccessedAt order is deterministic
  const initial8 = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "AAPL", "QQQ"];
  for (let i = 0; i < initial8.length; i++) {
    now = 1000 + i * 100;
    const viewers = new Map(initial8.slice(0, i + 1).map((s) => [s, 1]));
    const res = mgr.reconcile({
      chartSymbols: [initial8[i]],
      requestedSymbols: initial8.slice(0, i + 1),
      activeViewers: viewers,
    });
    assert.equal(res.toSubscribe.length, 1);
    assert.equal(res.evicted.length, 0);
  }
  assert.equal(mgr.size(), 8);

  // Drop active viewers on GBPUSD (make it oldest) and AUDUSD (newer)
  // Touch all OTHER 6 symbols at now=5000, while keeping GBPUSD at 2000 and AUDUSD at 3000
  mgr.touch("GBPUSD", 2000);
  mgr.touch("AUDUSD", 3000);
  now = 5000;
  const viewersWith2Zero = new Map([
    ["EURUSD", 1],
    ["USDJPY", 1],
    ["USDCAD", 1],
    ["USDCHF", 1],
    ["AAPL", 1],
    ["QQQ", 1],
    ["BTCUSDT", 1],
  ]);

  // Request 9th symbol BTCUSDT -> MUST evict GBPUSD (oldest zero-viewer) and subscribe BTC/USD
  const r9 = mgr.reconcile({
    chartSymbols: ["BTCUSDT"],
    requestedSymbols: ["EURUSD", "USDJPY", "USDCAD", "USDCHF", "AAPL", "QQQ", "BTCUSDT"],
    activeViewers: viewersWith2Zero,
  });
  assert.deepEqual(r9.evicted, ["GBPUSD"], "must evict oldest zero-viewer symbol GBPUSD");
  assert.deepEqual(r9.toUnsubscribe, [{ sym: "GBPUSD", tdSym: "GBP/USD" }]);
  assert.deepEqual(r9.toSubscribe, [{ sym: "BTCUSDT", tdSym: "BTC/USD" }]);
  assert.equal(mgr.size(), 8);
  assert.equal(mgr.has("GBPUSD"), false);
  assert.equal(mgr.has("BTCUSDT"), true);
  assert.equal(mgr.resolveInternal("BTC/USD"), "BTCUSDT");

  // Request 10th symbol ETHUSDT -> MUST evict AUDUSD (next oldest zero-viewer) and subscribe ETH/USD
  now = 6000;
  viewersWith2Zero.set("ETHUSDT", 1);
  const r10 = mgr.reconcile({
    chartSymbols: ["ETHUSDT"],
    requestedSymbols: ["EURUSD", "USDJPY", "USDCAD", "USDCHF", "AAPL", "QQQ", "BTCUSDT", "ETHUSDT"],
    activeViewers: viewersWith2Zero,
  });
  assert.deepEqual(r10.evicted, ["AUDUSD"], "must evict remaining zero-viewer symbol AUDUSD");
  assert.deepEqual(r10.toUnsubscribe, [{ sym: "AUDUSD", tdSym: "AUD/USD" }]);
  assert.deepEqual(r10.toSubscribe, [{ sym: "ETHUSDT", tdSym: "ETH/USD" }]);
  assert.equal(mgr.size(), 8);
  assert.equal(mgr.resolveInternal("ETH/USD"), "ETHUSDT");

  // Now ALL 8 slots have active viewers; requesting a passive 9th watchlist symbol MUST NOT evict active viewers
  now = 7000;
  viewersWith2Zero.set("SOLUSDT", 1);
  const r11 = mgr.reconcile({
    chartSymbols: ["ETHUSDT"],
    requestedSymbols: ["EURUSD", "USDJPY", "USDCAD", "USDCHF", "AAPL", "QQQ", "BTCUSDT", "ETHUSDT", "SOLUSDT"],
    activeViewers: viewersWith2Zero,
  });
  assert.deepEqual(r11.evicted, [], "must not evict active-viewer symbols for passive watchlist overflow");
  assert.deepEqual(r11.deferred, ["SOLUSDT"], "overflow symbol defers to cached liveQuotes / REST snapshot");
  assert.equal(mgr.size(), 8);
});

await test("TdSubscriptionManager releases subscribe-status fails slots immediately and backfills valid trial tickers", () => {
  let now = 10_000;
  const mgr = new TdSubscriptionManager({ maxSlots: 4, failCooldownMs: 600_000, now: () => now });

  const allReq = ["NVDA", "MSFT", "EURUSD", "AAPL", "BTCUSDT", "ETHUSDT"];
  const viewers = new Map(allReq.map((s) => [s, 1]));

  // Initial subscribe fills 4 slots (including 2 non-trial tickers NVDA, MSFT)
  const r1 = mgr.reconcile({ chartSymbols: ["NVDA"], requestedSymbols: allReq, activeViewers: viewers });
  assert.deepEqual(
    r1.toSubscribe.map((x) => x.tdSym),
    ["NVDA", "MSFT", "EUR/USD", "AAPL"]
  );
  assert.deepEqual(r1.deferred, ["BTCUSDT", "ETHUSDT"]);
  assert.equal(mgr.size(), 4);

  // Twelve Data returns subscribe-status with NVDA and MSFT in `fails`
  const statusRes = mgr.handleSubscribeStatus({
    event: "subscribe-status",
    status: "ok",
    success: [{ symbol: "EUR/USD" }, { symbol: "AAPL" }],
    fails: [{ symbol: "NVDA", message: "Not included in Basic plan" }, { symbol: "MSFT" }],
  });
  assert.deepEqual(statusRes.released.sort(), ["MSFT", "NVDA"]);
  assert.equal(mgr.size(), 2, "failed non-trial slots must be immediately released");
  assert.equal(mgr.isRejected("NVDA"), true);
  assert.equal(mgr.isRejected("MSFT"), true);

  // Immediately reconciling backfills the 2 released slots with BTC/USD and ETH/USD
  now += 50;
  const r2 = mgr.reconcile({ chartSymbols: ["NVDA"], requestedSymbols: allReq, activeViewers: viewers });
  assert.deepEqual(
    r2.toSubscribe,
    [
      { sym: "BTCUSDT", tdSym: "BTC/USD" },
      { sym: "ETHUSDT", tdSym: "ETH/USD" },
    ],
    "valid trial tickers BTC/USD and ETH/USD must immediately fill released slots"
  );
  assert.equal(mgr.size(), 4);
  assert.equal(mgr.has("BTCUSDT"), true);
  assert.equal(mgr.has("ETHUSDT"), true);
});

await test("MarketHub DO performs LRU zero-viewer eviction and subscribe-status fails release + BTC/USD & ETH/USD tick delivery", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(query, ...bindings) {
      const stmt = db.prepare(query);
      if (/^\s*(SELECT|PRAGMA)/i.test(query)) return stmt.all(...bindings);
      stmt.run(...bindings);
      return [];
    },
  };
  let now = 1_700_000_000_000;
  const sentUp = [];
  const clientSent = [];
  const serverSockets = [];
  let upWs = null;

  class MockWs {
    constructor(name) {
      this.name = name;
      this.readyState = 1;
      this.listeners = new Map();
      this.att = null;
    }
    accept() {}
    send(data) {
      if (this.name === "up") sentUp.push(JSON.parse(data));
      else clientSent.push(JSON.parse(data));
    }
    close() { this.readyState = 3; }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    emit(type, ev) {
      for (const fn of this.listeners.get(type) || []) fn(ev);
    }
    serializeAttachment(v) { this.att = JSON.parse(JSON.stringify(v)); }
    deserializeAttachment() { return this.att ? JSON.parse(JSON.stringify(this.att)) : null; }
  }

  const ctx = {
    storage: { sql, setAlarm: async () => {} },
    acceptWebSocket(ws) { ws._accepted = true; },
    getWebSockets() { return serverSockets; },
    waitUntil(p) { Promise.resolve(p).catch(() => {}); },
  };

  const hub = new MarketHub(
    ctx,
    { TWELVEDATA_KEY: "TEST_KEY", TD_WS_MAX: "2", CRYPTO_PROVIDER: "twelvedata" }, // this test exercises crypto on Twelve Data slots
    {
      now: () => now,
      jitter: false,
      setTimer: () => 1,
      clearTimer: () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
      openUpstreamWs: async () => {
        upWs = new MockWs("up");
        return upWs;
      },
      createWebSocketPair: () => {
        const srv = new MockWs("srv");
        serverSockets.push(srv);
        return [new MockWs("cli"), srv];
      },
    }
  );
  await hub.ready();

  // Seed 2 pinned symbols at t0 and t1 (0 active viewers)
  hub.subscribeUpstream(["EURUSD"]);
  now += 1000;
  hub.subscribeUpstream(["GBPUSD"]);
  await hub.ensureUpstream();
  // Ingest a cached tick for EURUSD so fallback quote exists
  hub.ingestTick({ s: "EURUSD", c: 1.0912, t: now });
  assert.equal(hub.core.last.get("EURUSD").c, 1.0912);

  // Client connects and requests BTCUSDT -> MUST evict LRU zero-viewer EURUSD (oldest) & subscribe BTC/USD
  now += 1000;
  await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  const clientWs = serverSockets[0];
  await hub.webSocketMessage(
    clientWs,
    JSON.stringify({ op: "view", chart: { sym: "BTCUSDT", tf: "1H" }, watchlist: ["BTCUSDT", "NVDA", "ETHUSDT"] })
  );

  const unsubs = sentUp.filter((m) => m.action === "unsubscribe").map((m) => m.params.symbols);
  const subs = sentUp.filter((m) => m.action === "subscribe").map((m) => m.params.symbols);
  assert.ok(unsubs.some((s) => s.includes("EUR/USD")), "must unsubscribe evicted LRU zero-viewer EUR/USD");
  assert.ok(subs.some((s) => s.includes("BTC/USD")), "must subscribe BTC/USD upstream");
  assert.equal(hub.core.last.get("EURUSD").c, 1.0912, "evicted symbol must retain cached fallback quote");

  // Upstream rejects NVDA in subscribe-status fails -> slot released & ETH/USD backfilled immediately
  sentUp.length = 0;
  upWs.emit("message", {
    data: JSON.stringify({
      event: "subscribe-status",
      status: "ok",
      success: [{ symbol: "BTC/USD" }],
      fails: [{ symbol: "NVDA" }],
    }),
  });
  const backfilled = sentUp.filter((m) => m.action === "subscribe").map((m) => m.params.symbols);
  assert.ok(backfilled.some((s) => s.includes("ETH/USD")), "ETH/USD must backfill released NVDA slot");

  // Deliver live ticks for BTC/USD and ETH/USD and flush to client
  clientSent.length = 0;
  upWs.emit("message", { data: JSON.stringify({ event: "price", symbol: "BTC/USD", price: 92450.5, timestamp: Math.floor(now / 1000) }) });
  upWs.emit("message", { data: JSON.stringify({ event: "price", symbol: "ETH/USD", price: 3180.25, timestamp: Math.floor(now / 1000) }) });
  hub.core.flush();

  const quoteFrames = clientSent.filter((m) => m.type === "quotes");
  const receivedSyms = quoteFrames.flatMap((f) => f.quotes.map((q) => `${q.s}:${q.c}`));
  assert.ok(receivedSyms.includes("BTCUSDT:92450.5"), "client must receive normalized BTCUSDT tick from BTC/USD");
  assert.ok(receivedSyms.includes("ETHUSDT:3180.25"), "client must receive normalized ETHUSDT tick from ETH/USD");

  hub.destroy();
  db.close();
});

await test("single normalized WS quotes & bar frames update chart, watchlist, screener, and metadata identically", () => {
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
  const cutIdx = edgeSrc.indexOf("// ---------- 95 symbol search:");
  vm.runInContext(edgeSrc.slice(0, cutIdx) + "\nthis.__META = VT_EDGE_META;\n", sandbox);
  const metaMap = sandbox.__META;

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

  assert.equal(sandbox.SYMS[0][2], 1.0854, "SYMS EURUSD updated");
  assert.equal(sandbox.SNAP.uni[0][2], 1.0854, "SNAP.uni EURUSD updated");
  assert.equal(metaMap.get("EURUSD").last, 1.0854, "VT_EDGE_META EURUSD updated");
  assert.equal(metaMap.get("EURUSD").pct, 0.5, "VT_EDGE_META EURUSD chgPct updated");
  // Task 11: quote ticks update prices only. Candles (chart and 1D) change solely through server `bar` frames.
  assert.equal(sandbox.LIVE["EURUSD|1H"][0].c, 1.0800, "quote tick leaves the chart candle close untouched");
  assert.equal(sandbox.LIVE["EURUSD|1H"][0].h, 1.0810, "quote tick leaves the chart candle high untouched");
  assert.equal(sandbox.LIVE["EURUSD|1D"][1].c, 1.0800, "quote tick leaves the 1D candle untouched");
  assert.equal(fakeCpx.textContent, "1.0854", "chart live price header updated");
  assert.equal(updatedBars.length, 0, "quote ticks never push candles to the chart");

  assert.equal(sandbox.SYMS[1][2], 224.50, "SYMS AAPL updated");
  assert.equal(sandbox.SNAP.uni[1][2], 224.50, "SNAP.uni AAPL updated");
  assert.equal(metaMap.get("AAPL").pct, 2.05, "VT_EDGE_META AAPL chgPct updated");

  assert.equal(sandbox.SYMS[2][2], 91250.25, "SYMS BTCUSDT updated");
  assert.equal(metaMap.get("BTCUSDT").last, 91250.25, "VT_EDGE_META BTCUSDT updated");
  assert.equal(alerted.length, 0, "quotes never trigger browser-side alert checks (alerts are evaluated by the hub)");

  const barFrame = JSON.stringify({
    v: 2,
    seq: 2,
    type: "bar",
    sym: "EURUSD",
    tf: "1H",
    bar: [baseSec, 1.0800, 1.0870, 1.0790, 1.0865, 1650],
  });
  sandbox.vtHandleEdgeWsMessage(barFrame);

  assert.deepEqual({ ...sandbox.LIVE["EURUSD|1H"][0] }, { t: baseSec, o: 1.0800, h: 1.0870, l: 1.0790, c: 1.0865, v: 1650 }, "server bar applied verbatim");
  assert.equal(updatedBars.length, 1, "server bar pushed to the chart once");
  assert.equal(fakeCpx.textContent, "1.0865", "chart price header follows the server bar");
  assert.equal(sandbox.SYMS[0][2], 1.0865, "server bar price synced to SYMS");
  assert.equal(sandbox.SNAP.uni[0][2], 1.0865, "server bar price synced to SNAP.uni");
  assert.equal(metaMap.get("EURUSD").last, 1.0865, "server bar price synced to VT_EDGE_META");
});

await test("FX pairs retain 5-decimal precision (0.00001) and live 1m server bar frames render verbatim without polling gap freeze", () => {
  const coreSrc = fs.readFileSync(path.join(ROOT, "src/vt_01_core_state.js"), "utf8");
  const specIdx = coreSrc.indexOf("const vtPriceSpec=");
  const labelIdx = coreSrc.indexOf("function label(c)");
  assert.ok(specIdx >= 0 && labelIdx > specIdx, "vtPriceSpec and fp must exist in vt_01_core_state.js");

  const updatedChartBars = [];
  const fakeCpx = { textContent: "" };
  const baseMin = Math.floor(Date.now() / 60000) * 60;
  // Simulate stale REST history (10 minutes behind live edge, previously frozen by >2*step guard)
  const staleMin = baseMin - 600;

  const sandbox = {
    console, Date, Math, JSON, Map, Set, Array, Number, String, Object, RegExp, isFinite,
    setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
    requestAnimationFrame: () => 1,
    location: { protocol: "https:", host: "vektorterminal.com", hash: "" },
    window: {},
    document: {
      hidden: false, visibilityState: "visible",
      documentElement: { classList: { contains: () => false }, dataset: {} },
      addEventListener: () => {},
      getElementById: (id) => (id === "cpx" ? fakeCpx : null),
      querySelectorAll: () => [],
      querySelector: () => null,
    },
    S: { chart: { sym: "EURUSD", tf: "1m" }, pageView: "chart", cols: [], sc: { panes: 1, tfB: "5m" } },
    SC: {},
    SNAP: { t: 0, tfs: ["1m"], ok: true, uni: [["EURUSD", "FX", 1.09874, 0, 1, 0.00001, "EUR/USD", "", "td", "EUR/USD"]] },
    SYMS: [
      ["EURUSD", "FX", 1.09874, 0, 1, 0.00001, "EUR/USD", "", "td", "EUR/USD"],
      ["USDJPY", "FX", 154.321, 0, 1, 0.001, "USD/JPY", "", "td", "USD/JPY"],
      ["AAPL", "STK", 228.50, 0, 1, 0.01, "AAPL", "", "td", "AAPL"],
      ["NIO", "STK", 4.35, 0, 1, 0.01, "NIO", "", "td", "NIO"],
    ],
    CUS: {},
    LIVE: {
      "EURUSD|1m": [{ t: staleMin, o: 1.09850, h: 1.09850, l: 1.09850, c: 1.09850, v: 0 }],
    },
    LT: {}, ERR: {}, PEND: {},
    STEP: { "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1H": 3600, "4H": 14400, "1D": 86400 },
    ch: {}, MS: { update: (bar) => updatedChartBars.push(bar) },
    isLive: () => true,
    symOf: (sym) => sandbox.SYMS.find((x) => x[0] === sym) || null,
    wlAll: () => ["EURUSD"],
    fm: (v) => String(v),
    dirty: () => {}, markOk: () => {}, status: () => {},
    updateLiveBar: (sym, tf) => {
      const b = sandbox.LIVE[sym + "|" + tf].at(-1);
      sandbox.MS.update({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c });
    },
    checkAlerts: () => {},
  };

  vm.createContext(sandbox);
  vm.runInContext(coreSrc.slice(specIdx, labelIdx) + "\nthis.vtPriceSpec = vtPriceSpec; this.fp = fp;\n", sandbox);
  const cutIdx = edgeSrc.indexOf("// ---------- 95 symbol search:");
  vm.runInContext(edgeSrc.slice(0, cutIdx), sandbox);

  // 1. Verify exact 5-decimal FX, 3-decimal JPY, and 2-decimal equity precision specs
  assert.deepEqual({ ...sandbox.vtPriceSpec(sandbox.SYMS[0]) }, { precision: 5, minMove: 0.00001 });
  assert.deepEqual({ ...sandbox.vtPriceSpec(sandbox.SYMS[1]) }, { precision: 3, minMove: 0.001 });
  assert.deepEqual({ ...sandbox.vtPriceSpec(sandbox.SYMS[2]) }, { precision: 2, minMove: 0.01 });
  assert.deepEqual({ ...sandbox.vtPriceSpec(sandbox.SYMS[3]) }, { precision: 2, minMove: 0.01 });
  assert.equal(sandbox.fp(1.09874, sandbox.SYMS[0]), "1.09874");
  assert.equal(sandbox.fp(154.321, sandbox.SYMS[1]), "154.321");
  assert.equal(sandbox.fp(4.35, sandbox.SYMS[3]), "4.35");

  // 2. Stream 4 hub `bar` frames for a 1m bucket 10m ahead of stale history: each is rendered verbatim (no client
  //    open/high/low reshaping, no pause), and the gap triggers a server history request instead of local patching.
  const frames = [
    [baseMin, 1.09874, 1.09874, 1.09874, 1.09874, 0],
    [baseMin, 1.09874, 1.09889, 1.09874, 1.09889, 0],
    [baseMin, 1.09874, 1.09889, 1.09861, 1.09861, 0],
    [baseMin, 1.09874, 1.09889, 1.09861, 1.09878, 0],
  ];
  for (const bar of frames) {
    sandbox.vtHandleEdgeWsMessage(JSON.stringify({ v: 2, seq: 1, type: "bar", sym: "EURUSD", tf: "1m", bar }));
  }

  const liveBar = sandbox.LIVE["EURUSD|1m"].at(-1);
  assert.equal(sandbox.LIVE["EURUSD|1m"].length, 2, "one new bar appended after the stale one");
  assert.equal(liveBar.t, baseMin, "1m bar timestamp comes from the server");
  assert.equal(liveBar.o, 1.09874, "open is the server's open");
  assert.equal(liveBar.h, 1.09889, "high is the server's high (5-decimal precision)");
  assert.equal(liveBar.l, 1.09861, "low is the server's low (5-decimal precision)");
  assert.equal(liveBar.c, 1.09878, "close is the server's close");
  assert.equal(fakeCpx.textContent, "1.09878", "header live price must format to 5 decimals for EURUSD");
  assert.equal(updatedChartBars.length, 4, "every server bar frame updates LightweightCharts without gap freeze");
});

await test("legacy REST-polling timers, staggered fetch queues, and header-override patches are removed across src/vt_*.js", () => {
  const clientFiles = fs
    .readdirSync(path.join(ROOT, "src"))
    .filter((f) => /^vt_\d+.*\.js$/.test(f))
    .map((f) => ({ name: f, src: fs.readFileSync(path.join(ROOT, "src", f), "utf8") }));
  assert.ok(clientFiles.length >= 10, "expected all vt_*.js client modules");

  const bannedPatterns = [
    { re: /setInterval\s*\([^)]*vtPxWatch/, msg: "dead 250ms DOM polling timer for vtPxWatch" },
    { re: /SC\.iv\s*=\s*setInterval/, msg: "dead 1.5s Supercharts dock/pane polling timer" },
    { re: /\bvtPrefetchAdjacent\b/, msg: "legacy adjacent-TF REST prefetcher" },
    { re: /\b(pumpTD|pumpBN|loadFHU|loadPGU|autoRefresh)\b/, msg: "legacy REST polling queue/loader" },
    { re: /\b(bnKlineStart|fhSubscribe|vtBnKlineStart|vtTdWsConnect|tryFallbacks)\b/, msg: "dead external provider WS/fallback helper" },
    { re: /\bconst\s+(QT|QB|QY|BNH|FHU|PGU)\s*=/, msg: "dead REST queue or external API host constant" },
    { re: /BNWS\.ws/, msg: "stale BNWS.ws live badge check" },
  ];

  for (const { name, src } of clientFiles) {
    for (const { re, msg } of bannedPatterns) {
      assert.equal(re.test(src), false, `${name} must not contain ${msg} (${re})`);
    }
  }

  const hmSrc = fs.readFileSync(path.join(ROOT, "src/vt_07_screener_pro_auth.js"), "utf8");
  assert.match(hmSrc, /VT_EDGE\.ws\s*&&\s*VT_EDGE\.ws\.readyState\s*===\s*1/, "heatmap badge must reflect VT_EDGE.ws");
  assert.equal(/if\s*\(n\s*>=\s*8\)\s*break;\s*need\(/.test(hmSrc), false, "hmTick must not stagger REST fetches");

  assert.match(wlSrc, /VT_EDGE_META\.get\s*\(\s*s\[0\]\s*\)/, "drawChart must prefer live VT_EDGE_META price over REST close");
  assert.match(edgeSrc, /!\s*\(\s*row\[2\]\s*>\s*0\s*\)/, "REST backfill/pump must not clobber existing live WS price");
});

await test("MarketHub DO updates liveQuotes and open bars purely in memory with zero per-tick SQLite/KV writes", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  let sqlWrites = 0;
  let kvPuts = 0;
  const sql = {
    exec(query, ...bindings) {
      if (/^\s*(INSERT|UPDATE|REPLACE|DELETE)/i.test(query)) sqlWrites++;
      const stmt = db.prepare(query);
      if (/^\s*(SELECT|PRAGMA)/i.test(query)) return stmt.all(...bindings);
      stmt.run(...bindings);
      return [];
    },
  };
  const kv = {
    async get() { return null; },
    async put() { kvPuts++; },
  };
  const ctx = {
    storage: { sql, setAlarm: async () => {} },
    acceptWebSocket() {},
    getWebSockets() { return []; },
    waitUntil(p) { Promise.resolve(p).catch(() => {}); },
  };
  let now = 1_700_000_040_000; // aligned +40s inside a 1m bucket
  const hub = new MarketHub(
    ctx,
    { TWELVEDATA_KEY: "TEST_KEY", SNAPSHOT_KV: kv },
    {
      now: () => now,
      jitter: false,
      setTimer: () => 1,
      clearTimer: () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
      openUpstreamWs: async () => null,
    }
  );
  await hub.ready();
  sqlWrites = 0;
  kvPuts = 0;

  // Stream 5 intra-bar ticks within the same 1m bucket
  const intraPrices = [1.09100, 1.09125, 1.09095, 1.09140, 1.09118];
  for (let i = 0; i < intraPrices.length; i++) {
    hub.ingestTick({ s: "EURUSD", c: intraPrices[i], t: now + i * 2000 });
  }
  assert.equal(sqlWrites, 0, "intra-bar WS ticks must trigger ZERO SQLite writes");
  assert.equal(kvPuts, 0, "intra-bar WS ticks must trigger ZERO KV writes");
  assert.equal(hub.core.last.get("EURUSD").c, 1.09118, "in-memory live quote must reflect latest tick");
  const open1m = hub.candles.getCurrent("EURUSD", "1m");
  assert.equal(open1m.o, 1.09100);
  assert.equal(open1m.h, 1.09140);
  assert.equal(open1m.l, 1.09095);
  assert.equal(open1m.c, 1.09118);

  // Advance into the next 1m bucket -> closes the 1m bar and persists ONLY the closed bar to DO SQLite
  hub.ingestTick({ s: "EURUSD", c: 1.09130, t: now + 60_000 });
  assert.ok(sqlWrites >= 1, "closed 1m bar must persist to DO SQLite");
  assert.equal(kvPuts, 0, "bar close tick must still NOT write KV per tick (KV is checkpoint-only)");

  hub.destroy();
  db.close();
});

console.log(`ws-realtime.test.mjs: ${passed} passed`);
