// tests/td-lru-pool.test.mjs — Twelve Data WebSocket slots are a server-side LRU pool (TD_WS_MAX) inside the hub DO,
// and screener/watchlist rows outside the pool are served from the hub's cached Twelve Data quotes (never Yahoo, never
// REST /quote). The browser has no LRU, caching or subscription logic: it only sends its view.
// Run: node tests/td-lru-pool.test.mjs

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { HubCore } from "../workers/market/hubCore.js";
import { MarketHub } from "../workers/market/hub.js";

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, "-", err && err.stack ? err.stack : err);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- HubCore pool (pure)
function makeCore(max, log) {
  const up = { subscribe: (s) => log.push(["sub", ...s]), unsubscribe: (s) => log.push(["unsub", ...s]) };
  const core = new HubCore(up, {
    maxUpstreamSymbols: max,
    setTimer: () => 0,
    clearTimer: () => {},
    onEvict: (s) => log.push(["evict", s]),
    capExempt: (s) => s.endsWith("USDT"),
  });
  core.addClient("a", () => {});
  core.addClient("b", () => {});
  return core;
}

await test("full pool: viewing a new symbol evicts the least recently used one (evict hook before unsubscribe, then subscribe)", () => {
  const log = [];
  const core = makeCore(3, log);
  core.subscribe("a", ["EURUSD", "GBPUSD", "USDJPY"]); // priority order: EURUSD most recent
  assert.deepEqual(core.poolSymbols(), ["USDJPY", "GBPUSD", "EURUSD"], "LRU -> MRU");
  log.length = 0;
  core.subscribe("b", ["AAPL"]);
  assert.deepEqual(log, [["evict", "USDJPY"], ["unsub", "USDJPY"], ["sub", "AAPL"]]);
  assert.deepEqual(core.poolSymbols(), ["GBPUSD", "EURUSD", "AAPL"]);
  assert.equal(core.upstreamCount(), 3);
});

await test("re-viewing a symbol promotes it to most recently used", () => {
  const log = [];
  const core = makeCore(3, log);
  core.subscribe("a", ["EURUSD", "GBPUSD", "USDJPY"]);
  core.promote(["USDJPY"]);
  log.length = 0;
  core.subscribe("b", ["AAPL"]);
  assert.deepEqual(log[0], ["evict", "GBPUSD"], "GBPUSD became LRU after USDJPY was promoted");
});

await test("a view larger than the pool keeps its top-priority symbols (chart first) and never thrashes on resend", () => {
  const log = [];
  const core = makeCore(3, log);
  const view = ["EURUSD", "AAPL", "MSFT", "NVDA", "TSLA", "GBPUSD"];
  core.setClientSymbols("a", view);
  assert.deepEqual(core.poolSymbols().slice().sort(), ["AAPL", "EURUSD", "MSFT"]);
  assert.equal(core.poolSymbols().at(-1), "EURUSD", "chart symbol is most recently used");
  log.length = 0;
  core.setClientSymbols("a", view);
  assert.deepEqual(log, [], "same view again: no subscribe/unsubscribe frames");
  const c = core.clients.get("a");
  assert.equal(c.syms.size, 6, "every view symbol is subscribed for fan-out even outside the pool");
});

await test("crypto (Binance) never takes a Twelve Data slot", () => {
  const log = [];
  const core = makeCore(2, log);
  core.subscribe("a", ["BTCUSDT", "ETHUSDT", "EURUSD", "GBPUSD"]);
  assert.deepEqual(core.poolSymbols().slice().sort(), ["EURUSD", "GBPUSD"]);
  assert.ok(core.hasUpstreamSymbol("BTCUSDT"));
});

await test("disconnect keeps TD slots (they keep streaming into the quote cache) until LRU eviction", () => {
  const log = [];
  const core = makeCore(2, log);
  core.subscribe("a", ["EURUSD", "GBPUSD"]);
  core.onTick({ s: "EURUSD", c: 1.09, t: Date.now() });
  log.length = 0;
  core.removeClient("a");
  assert.deepEqual(log, [], "no unsubscribe on disconnect");
  assert.deepEqual(core.poolSymbols().slice().sort(), ["EURUSD", "GBPUSD"]);
  assert.equal(core.getLastTick("EURUSD").c, 1.09);
});

// ---------------------------------------------------------------- MarketHub DO integration
function createSqlite() {
  const db = new DatabaseSync(":memory:");
  let writes = 0;
  const sql = {
    exec(query, ...bindings) {
      if (/^\s*(INSERT|UPDATE|REPLACE|DELETE)/i.test(query)) writes += 1;
      const stmt = db.prepare(query);
      if (/^\s*(SELECT|PRAGMA)/i.test(query)) return stmt.all(...bindings);
      stmt.run(...bindings);
      return [];
    },
  };
  return { sql, writes: () => writes };
}
class FakeWS {
  constructor() { this.sent = []; this.readyState = 1; this.listeners = {}; }
  send(m) { this.sent.push(m); }
  close() { this.readyState = 3; }
  accept() {}
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  serializeAttachment(a) { this.att = a; }
  deserializeAttachment() { return this.att; }
}
async function makeHub(env) {
  const { sql, writes } = createSqlite();
  const pending = [];
  const ctx = {
    storage: { sql, setAlarm: async () => {}, getAlarm: async () => null, deleteAlarm: async () => {} },
    blockConcurrencyWhile: async (fn) => fn(),
    waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})),
    acceptWebSocket: () => {},
    getWebSockets: () => [],
  };
  let now = Date.UTC(2026, 10, 20, 15, 0, 0);
  const sockets = [];
  const up = [];
  const hub = new MarketHub(ctx, { TWELVEDATA_KEY: "K", ...env }, {
    now: () => now,
    setTimer: () => 0, clearTimer: () => {}, setTimeout: () => 0, clearTimeout: () => {},
    openUpstreamWs: async () => { const w = new FakeWS(); up.push(w); return w; },
    openBinanceWs: async () => new FakeWS(),
    createWebSocketPair: () => { const s = new FakeWS(); sockets.push(s); return [new FakeWS(), s]; },
  });
  await hub.ready();
  return { hub, writes, sockets, up, setNow: (n) => { now = n; }, getNow: () => now, settle: async () => { while (pending.length) await Promise.all(pending.splice(0)); } };
}

await test("TD_WS_MAX from wrangler vars sizes the pool with zero code changes", async () => {
  for (const max of ["3", "12"]) {
    const h = await makeHub({ TD_WS_MAX: max });
    assert.equal(h.hub.core.maxUpstreamSymbols, Number(max));
    h.hub.destroy();
  }
});

await test("evicted symbols keep a cached Twelve Data quote (price, prev close, % change) that /api/quotes and bootstrap serve", async () => {
  const h = await makeHub({ TD_WS_MAX: "2" });
  const day = Math.floor(h.getNow() / 1000 / 86400) * 86400;
  h.hub.store.upsertBar("EURUSD", "1D", { t: day - 86400, o: 1.07, h: 1.09, l: 1.06, c: 1.08, v: 0 }); // yesterday's TD close

  await h.hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  const ws = h.sockets[0];
  await h.hub.webSocketMessage(ws, JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1m" }, watchlist: ["EURUSD", "GBPUSD"] }));
  h.hub.ingestTick({ s: "EURUSD", c: 1.0908, t: h.getNow() });
  h.hub.ingestTick({ s: "GBPUSD", c: 1.27, t: h.getNow() });

  // Live while in the pool, with % change computed server-side from the hub's TD daily bars.
  let res = await (await h.hub.fetch(new Request("https://market-hub/api/quotes?symbols=EURUSD,GBPUSD"))).json();
  assert.deepEqual(res.slots.slice().sort(), ["EURUSD", "GBPUSD"]);
  assert.equal(res.maxSlots, 2);
  assert.equal(res.quotes.EURUSD.live, true);
  assert.equal(res.quotes.EURUSD.prevClose, 1.08);
  assert.equal(res.quotes.EURUSD.chgPct, 1);

  // The view moves to two new symbols: EURUSD and GBPUSD are evicted (their quotes persisted first).
  h.setNow(h.getNow() + 1000);
  await h.hub.webSocketMessage(ws, JSON.stringify({ op: "view", chart: { sym: "AAPL", tf: "1m" }, watchlist: ["AAPL", "MSFT"] }));
  assert.deepEqual(h.hub.core.poolSymbols().slice().sort(), ["AAPL", "MSFT"]);
  const unsub = h.up.flatMap((w) => w.sent.map((m) => JSON.parse(m))).filter((m) => m.action === "unsubscribe").flatMap((m) => m.params.symbols.split(","));
  assert.ok(unsub.includes("EUR/USD") && unsub.includes("GBP/USD"), "unsubscribe frames sent upstream: " + unsub);

  res = await (await h.hub.fetch(new Request("https://market-hub/api/quotes?symbols=EURUSD,GBPUSD,AAPL"))).json();
  assert.equal(res.quotes.EURUSD.live, false, "served from cache outside the pool");
  assert.equal(res.quotes.EURUSD.c, 1.0908);
  assert.equal(res.quotes.EURUSD.chgPct, 1);
  assert.equal(res.quotes.GBPUSD.c, 1.27);
  assert.equal(res.quotes.AAPL, undefined, "no tick and no cache yet: absent (never another feed)");

  // A fresh DO instance (restart) still has the cache in SQLite.
  const cached = h.hub.store.getQuoteCaches(["EURUSD"]).get("EURUSD");
  assert.equal(cached.c, 1.0908);
  assert.equal(cached.prevClose, 1.08);

  // Bootstrap watchlist row for an evicted symbol comes from the cached TD quote.
  const st = await (await h.hub.fetch(new Request("https://market-hub/api/bootstrap?wl=EURUSD"))).json();
  const row = st.watchlist.find((q) => q.s === "EURUSD");
  assert.equal(row.c, 1.0908);
  assert.equal(row.provenance, "CACHED");
  assert.equal(row.chgPct, 1);
  h.hub.destroy();
});

await test("quote cache is written per closed 1m bar and on eviction, never per tick", async () => {
  const h = await makeHub({ TD_WS_MAX: "2" });
  await h.hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  await h.hub.webSocketMessage(h.sockets[0], JSON.stringify({ op: "view", watchlist: ["EURUSD"] }));
  const t0 = Math.floor(h.getNow() / 60000) * 60000;
  h.hub.ingestTick({ s: "EURUSD", c: 1.09, t: t0 + 1000 });
  const before = h.writes();
  for (let i = 2; i < 30; i++) h.hub.ingestTick({ s: "EURUSD", c: 1.09 + i / 100000, t: t0 + i * 1000 });
  assert.equal(h.writes(), before, "intra-bar ticks never write SQLite");
  assert.equal(h.hub.store.getQuoteCaches(["EURUSD"]).size, 0);
  h.hub.ingestTick({ s: "EURUSD", c: 1.0950, t: t0 + 61000 }); // closes the 1m bar
  const cached = h.hub.store.getQuoteCaches(["EURUSD"]).get("EURUSD");
  assert.ok(cached, "persisted on bar close");
  h.hub.destroy();
});

await test("vektor-market routes /api/quotes to the hub DO (it 404ed, so every hub quote lookup came back empty)", async () => {
  const { default: market } = await import("../workers/market/index.js");
  const seen = [];
  const env = { MARKET_HUB: { idFromName: (n) => n, get: () => ({ fetch: async (r) => { seen.push(new URL(r.url).pathname + new URL(r.url).search); return Response.json({ ok: true, quotes: {} }); } }) } };
  const res = await market.fetch(new Request("https://market-service/api/quotes?symbols=EURUSD"), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.deepEqual(seen, ["/api/quotes?symbols=EURUSD"]);
});

console.log(`td-lru-pool.test.mjs: ${passed} passed, ${failed} failed`);
