// tests/crypto-routing-health.test.mjs — CRYPTO_PROVIDER toggle, Binance routing in the production hub,
// and the LIVE / DELAYED / RECONNECTING / CACHED health states the UI badge binds to.
// Scaffolding (sqlite DO ctx, fake sockets, fake timers) mirrors tests/hub-do.test.mjs.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { PROVENANCE, makeFrame, validateServerFrame } from "../shared/protocol.js";
import { validateServerFrame as validateBrowserFrame } from "../src/data_service.js";
import { CRYPTO_PROVIDERS, isBinanceRouted, resolveCryptoProvider } from "../shared/market/cryptoProvider.js";
import { combineFeedProvenance } from "../shared/market/feedHealth.js";
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

/** Faithful Cloudflare DO ctx.storage.sql wrapper backed by real in-memory SQLite (node:sqlite). */
function createSqliteDb() {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(query, ...bindings) {
      const stmt = db.prepare(query);
      const upper = query.trim().toUpperCase();
      if (upper.startsWith("SELECT") || upper.startsWith("PRAGMA")) {
        const rows = stmt.all(...bindings).map((r) => ({ ...r }));
        return {
          toArray: () => rows,
          one: () => rows[0],
          [Symbol.iterator]: () => rows[Symbol.iterator](),
        };
      }
      stmt.run(...bindings);
      return {
        toArray: () => [],
        one: () => undefined,
        [Symbol.iterator]: () => [][Symbol.iterator](),
      };
    },
  };
  return { db, sql };
}

/** Fake WebSocket supporting both upstream TD client WS and Hibernation server WS attachments. */
class FakeWebSocket {
  constructor(name = "ws") {
    this.name = name;
    this.readyState = 1;
    this.sent = [];
    this.closed = false;
    this.closeInfo = null;
    this._listeners = new Map();
    this._attachment = null;
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }

  emit(type, evt = {}) {
    for (const fn of this._listeners.get(type) || []) fn(evt);
  }

  send(data) {
    if (this.closed) throw new Error("socket closed");
    this.sent.push(typeof data === "string" ? data : String(data));
  }

  close(code = 1000, reason = "") {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.closeInfo = { code, reason };
    this.emit("close", { code, reason });
  }

  accept() {}

  serializeAttachment(obj) {
    this._attachment = JSON.parse(JSON.stringify(obj));
  }

  deserializeAttachment() {
    return this._attachment ? JSON.parse(JSON.stringify(this._attachment)) : null;
  }
}

/** Deterministic fake timer registry so tests never wait wall-clock seconds. */
function createFakeTimers() {
  let nextId = 1;
  const intervals = new Map();
  const timeouts = new Map();
  return {
    intervals,
    timeouts,
    setTimer(fn, ms) {
      const id = nextId++;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearTimer(id) {
      intervals.delete(id);
    },
    setTimeout(fn, ms) {
      const id = nextId++;
      timeouts.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
    tickIntervals(msFilter) {
      for (const entry of [...intervals.values()]) {
        if (msFilter === undefined || entry.ms === msFilter) entry.fn();
      }
    },
    fireTimeouts() {
      const list = [...timeouts.entries()];
      timeouts.clear();
      for (const [, entry] of list) entry.fn();
    },
  };
}

/** Fake Cloudflare DO context with SQLite, alarms, and Hibernation WebSocket API. */
function createMockDoCtx(sql) {
  const acceptedSockets = [];
  const alarms = [];
  let autoResponsePair = null;
  const waitPromises = [];

  return {
    acceptedSockets,
    alarms,
    waitPromises,
    get autoResponsePair() {
      return autoResponsePair;
    },
    storage: {
      sql,
      async setAlarm(ts) {
        alarms.push(ts);
      },
    },
    acceptWebSocket(ws) {
      acceptedSockets.push(ws);
    },
    getWebSockets() {
      return acceptedSockets.filter((ws) => !ws.closed);
    },
    setWebSocketAutoResponse(pair) {
      autoResponsePair = pair;
    },
    blockConcurrencyWhile(fn) {
      return Promise.resolve().then(fn);
    },
    waitUntil(p) {
      waitPromises.push(Promise.resolve(p));
    },
    async flushWaitUntil() {
      while (waitPromises.length) {
        const batch = waitPromises.splice(0);
        await Promise.all(batch);
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Pure units
// ---------------------------------------------------------------------------------------------------------------
await test("CRYPTO_PROVIDER: defaults to binance; accepts binance|twelvedata (case/space-insensitive); junk -> binance", () => {
  assert.equal(resolveCryptoProvider(undefined), "binance");
  assert.equal(resolveCryptoProvider({}), "binance");
  assert.equal(resolveCryptoProvider({ CRYPTO_PROVIDER: "binance" }), "binance");
  assert.equal(resolveCryptoProvider({ CRYPTO_PROVIDER: "twelvedata" }), "twelvedata");
  assert.equal(resolveCryptoProvider({ CRYPTO_PROVIDER: "  TwelveData " }), "twelvedata");
  assert.equal(resolveCryptoProvider({ CRYPTO_PROVIDER: "kraken" }), "binance");
  assert.equal(resolveCryptoProvider({ CRYPTO_PROVIDER: 7 }), "binance");
  assert.deepEqual(Object.values(CRYPTO_PROVIDERS).sort(), ["binance", "twelvedata"]);
});

await test("routing predicate: only non-stable *USDT crypto goes to Binance, and only under CRYPTO_PROVIDER=binance", () => {
  for (const s of ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT"]) {
    assert.equal(isBinanceRouted(s, "binance"), true, s);
    assert.equal(isBinanceRouted(s, "twelvedata"), false, s);
  }
  for (const s of ["EURUSD", "AAPL", "XAUUSD", "SPX", "USDCUSDT", "FDUSDUSDT", ""]) {
    assert.equal(isBinanceRouted(s, "binance"), false, s || "(empty)");
  }
});

await test("combineFeedProvenance: worst active feed wins; idle feeds ignored; cache only when nothing is live", () => {
  const P = PROVENANCE;
  assert.equal(combineFeedProvenance({}), P.UNAVAILABLE);
  assert.equal(combineFeedProvenance({}, { hasCache: true }), P.CACHED);
  assert.equal(combineFeedProvenance({ twelvedata: P.LIVE }), P.LIVE);
  assert.equal(combineFeedProvenance({ twelvedata: P.LIVE, binance: P.LIVE }), P.LIVE);
  assert.equal(combineFeedProvenance({ twelvedata: P.LIVE, binance: P.RECONNECTING }), P.RECONNECTING);
  assert.equal(combineFeedProvenance({ twelvedata: P.RECONNECTING, binance: P.LIVE }, { hasCache: true }), P.RECONNECTING);
  assert.equal(combineFeedProvenance({ twelvedata: P.DELAYED, binance: P.LIVE }), P.DELAYED);
  assert.equal(combineFeedProvenance({ twelvedata: P.UNAVAILABLE }, { hasCache: true }), P.CACHED);
  assert.equal(combineFeedProvenance({ twelvedata: P.UNAVAILABLE }), P.UNAVAILABLE);
  assert.equal(combineFeedProvenance({ twelvedata: P.LIVE, binance: P.UNAVAILABLE }), P.DELAYED);
});

await test("protocol: status frames carry RECONNECTING + per-feed health, and bad values are rejected (server AND browser validators)", () => {
  assert.equal(PROVENANCE.RECONNECTING, "RECONNECTING");
  const good = makeFrame(
    "status",
    { provenance: "RECONNECTING", asOf: 1_700_000_000_000, detail: "Binance reconnecting", feeds: { twelvedata: "LIVE", binance: "RECONNECTING" } },
    5
  );
  assert.equal(validateServerFrame(good).ok, true);
  assert.equal(validateBrowserFrame(good).ok, true);
  for (const feeds of [{ binance: "BOGUS" }, "binance", { "bad key!": "LIVE" }, { a: "LIVE", b: "LIVE", c: "LIVE", d: "LIVE", e: "LIVE", f: "LIVE", g: "LIVE", h: "LIVE", i: "LIVE" }]) {
    const bad = { v: 2, seq: 6, type: "status", provenance: "LIVE", asOf: 1_700_000_000_000, feeds }; // hand-built: makeFrame itself refuses invalid input
    assert.equal(validateServerFrame(bad).ok, false, `server accepted ${JSON.stringify(feeds)}`);
    assert.equal(validateBrowserFrame(bad).ok, false, `browser accepted ${JSON.stringify(feeds)}`);
  }
  // status without feeds (older senders) is still valid
  assert.equal(validateServerFrame(makeFrame("status", { provenance: "CACHED", asOf: 1_700_000_000_000 }, 7)).ok, true);
});

// ---------------------------------------------------------------------------------------------------------------
// Hub integration
// ---------------------------------------------------------------------------------------------------------------
async function makeHub(env = {}) {
  const { sql } = createSqliteDb();
  const ctx = createMockDoCtx(sql);
  const timers = createFakeTimers();
  let now = Date.UTC(2026, 10, 20, 10, 0, 0);
  const td = [];
  const binance = [];
  let browser = null;
  const hub = new MarketHub(
    ctx,
    { TWELVEDATA_KEY: "TD_TEST_KEY", TD_WS_MAX: "8", ...env },
    {
      now: () => now,
      jitter: false,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      openUpstreamWs: async () => {
        const ws = new FakeWebSocket(`td-${td.length + 1}`);
        td.push(ws);
        return ws;
      },
      openBinanceWs: async () => {
        const ws = new FakeWebSocket(`bn-${binance.length + 1}`);
        binance.push(ws);
        return ws;
      },
      createWebSocketPair: () => {
        const client = new FakeWebSocket("browser-client");
        browser = new FakeWebSocket("browser-server");
        return [client, browser];
      },
    }
  );
  await hub.ready();
  const tdSubs = () => td.flatMap((w) => w.sent.map((s) => JSON.parse(s))).filter((m) => m.action === "subscribe").flatMap((m) => m.params.symbols.split(","));
  const frames = () => browser.sent.map((s) => JSON.parse(s));
  const statuses = () => frames().filter((f) => f.type === "status");
  const flush = () => new Promise((r) => setImmediate(r));
  const miniTicker = (rows) => JSON.stringify(rows.map(([s, c]) => ({ e: "24hrMiniTicker", s, c: String(c), o: String(c - 1), h: String(c + 1), l: String(c - 2), v: "5", q: "500" })));
  return { hub, ctx, timers, td, binance, tdSubs, frames, statuses, flush, miniTicker, setNow: (n) => { now = n; }, getNow: () => now, getBrowser: () => browser };
}

await test("default provider (binance): crypto stays OFF Twelve Data, Binance feed carries it, TD_WS_MAX counts only TD symbols", async () => {
  const h = await makeHub({ TD_WS_MAX: "2" });
  assert.equal(h.hub.cryptoProvider, "binance");
  const res = h.hub.subscribeUpstream(["BTCUSDT", "ETHUSDT", "SOLUSDT", "EURUSD", "AAPL", "MSFT"]);
  await h.hub.ensureUpstream();
  await h.flush();
  // 3 crypto on Binance (exempt from the cap) + 2 TD slots; MSFT is the 3rd TD symbol -> rejected
  assert.deepEqual(res.accepted.sort(), ["AAPL", "BTCUSDT", "ETHUSDT", "EURUSD", "SOLUSDT"]);
  assert.deepEqual(res.rejected, ["MSFT"]);
  assert.deepEqual(h.hub._activeUpstreamSymbols(), ["AAPL", "EURUSD"]);
  assert.equal(h.td.length, 1, "exactly one Twelve Data socket");
  assert.equal(h.tdSubs().some((s) => /BTC|ETH|SOL/.test(s)), false, "no crypto symbol was ever sent to Twelve Data");
  assert.ok(h.tdSubs().includes("EUR/USD"));
  assert.equal(h.binance.length, 1, "one Binance miniTicker socket");
  assert.equal(h.hub.getStats().cryptoProvider, "binance");
  assert.equal(h.hub.getStats().binance.symbols, 3);
  h.hub.destroy();
});

await test("browser view: crypto symbols never trip the HubCore Twelve Data cap (TD_WS_MAX=2 still serves 4 crypto + 2 FX)", async () => {
  const h = await makeHub({ TD_WS_MAX: "2" });
  await h.hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  await h.hub.webSocketMessage(h.getBrowser(), JSON.stringify({ op: "view", watchlist: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "EURUSD", "GBPUSD"] }));
  await h.hub.ensureUpstream();
  await h.flush();
  const client = [...h.hub.core.clients.values()][0];
  assert.deepEqual([...client.syms].sort(), ["BNBUSDT", "BTCUSDT", "ETHUSDT", "EURUSD", "GBPUSD", "SOLUSDT"], "every watchlist symbol was accepted");
  assert.equal(h.hub.core.upstreamCount(), 2, "only the 2 FX symbols count against the Twelve Data cap");
  assert.deepEqual(h.hub._activeUpstreamSymbols(), ["EURUSD", "GBPUSD"]);
  assert.equal(h.hub.getStats().binance.symbols, 4);
  h.hub.destroy();
});

await test("Binance rows become real ticks for subscribed symbols only (unsubscribed symbols are ignored)", async () => {
  const h = await makeHub();
  h.hub.subscribeUpstream(["BTCUSDT", "ETHUSDT"]);
  await h.flush();
  h.binance[0].emit("message", { data: h.miniTicker([["BTCUSDT", 91000], ["ETHUSDT", 3100], ["XRPUSDT", 2]]) });
  assert.equal(h.hub.core.last.get("BTCUSDT").c, 91000);
  assert.equal(h.hub.core.last.get("ETHUSDT").c, 3100);
  assert.equal(h.hub.core.last.has("XRPUSDT"), false);
  h.hub.destroy();
});

await test("twelvedata provider: ALL crypto rides Twelve Data (BTC/USD, ETH/USD), no Binance socket is ever opened", async () => {
  const h = await makeHub({ CRYPTO_PROVIDER: "twelvedata", TD_WS_MAX: "3" });
  assert.equal(h.hub.cryptoProvider, "twelvedata");
  const res = h.hub.subscribeUpstream(["BTCUSDT", "ETHUSDT", "EURUSD", "AAPL"]);
  await h.hub.ensureUpstream();
  await h.flush();
  assert.deepEqual(res.accepted, ["BTCUSDT", "ETHUSDT", "EURUSD"]);
  assert.deepEqual(res.rejected, ["AAPL"], "crypto now consumes Twelve Data slots again");
  assert.ok(h.tdSubs().includes("BTC/USD") && h.tdSubs().includes("ETH/USD"));
  assert.equal(h.binance.length, 0);
  assert.equal(h.hub.binanceFeed, null);
  h.hub.destroy();
});

await test("/ws status frames: LIVE -> RECONNECTING (Binance 24h drop) -> LIVE, with per-feed provenance on every frame", async () => {
  const h = await makeHub();
  const wsRes = await h.hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  assert.equal(wsRes.status, 101);
  await h.hub.webSocketMessage(h.getBrowser(), JSON.stringify({ op: "view", watchlist: ["EURUSD", "BTCUSDT"] }));
  await h.hub.ensureUpstream();
  await h.flush();

  // Twelve Data is up; Binance socket is open but silent -> overall RECONNECTING, feeds explain why
  let last = h.statuses().at(-1);
  assert.ok(last, "a status frame was emitted");
  assert.equal(last.provenance, "RECONNECTING");
  assert.deepEqual(last.feeds, { twelvedata: "LIVE", binance: "RECONNECTING" });

  // first Binance frame -> LIVE everywhere
  h.binance[0].emit("message", { data: h.miniTicker([["BTCUSDT", 91000]]) });
  last = h.statuses().at(-1);
  assert.equal(last.provenance, "LIVE");
  assert.deepEqual(last.feeds, { twelvedata: "LIVE", binance: "LIVE" });

  // Binance's forced 24h disconnect
  h.binance[0].close(1006, "24h limit");
  last = h.statuses().at(-1);
  assert.equal(last.provenance, "RECONNECTING");
  assert.deepEqual(last.feeds, { twelvedata: "LIVE", binance: "RECONNECTING" });
  assert.match(last.detail, /binance/i);

  // automatic reconnect (retry timer fires) and data resumes
  h.timers.fireTimeouts();
  await h.flush();
  assert.equal(h.binance.length, 2, "feed reconnected by itself");
  h.binance[1].emit("message", { data: h.miniTicker([["BTCUSDT", 91050]]) });
  last = h.statuses().at(-1);
  assert.equal(last.provenance, "LIVE");
  assert.equal(h.hub.core.last.get("BTCUSDT").c, 91050);

  // Twelve Data drop is reported the same way
  h.td[0].close(1006, "td dropped");
  last = h.statuses().at(-1);
  assert.equal(last.provenance, "RECONNECTING");
  assert.deepEqual(last.feeds, { twelvedata: "RECONNECTING", binance: "LIVE" });

  // every status frame is a valid protocol v2 frame
  let prev = 0;
  for (const f of h.frames()) {
    const v = validateServerFrame(f, { lastSeq: prev });
    assert.equal(v.ok, true, `frame ${f.type} invalid: ${v.error}`);
    if (f.type !== "pong") prev = f.seq;
  }
  h.hub.destroy();
});

await test("DO alarm revives a dead Binance feed and a stalled one (alarm -> feed.check())", async () => {
  const h = await makeHub();
  h.hub.subscribeUpstream(["BTCUSDT"]);
  await h.flush();
  h.binance[0].emit("message", { data: h.miniTicker([["BTCUSDT", 100]]) });
  // 25 s with no frames on a socket that never closed: the alarm path must notice
  h.setNow(h.getNow() + 25_000);
  await h.hub.alarm();
  assert.equal(h.binance[0].closed, true, "stalled socket dropped by alarm check");
  assert.equal(h.hub.binanceFeed.state, "RECONNECTING");
  h.hub.destroy();
});

await test("no crypto subscribers -> Binance feed is stopped (no idle upstream socket), restarts on demand", async () => {
  const h = await makeHub();
  h.hub.subscribeUpstream(["BTCUSDT"]);
  await h.flush();
  assert.equal(h.binance.length, 1);
  h.hub.unsubscribeUpstream(["BTCUSDT"]);
  assert.equal(h.hub.binanceFeed, null);
  assert.equal(h.binance[0].closed, true);
  h.hub.subscribeUpstream(["ETHUSDT"]);
  await h.flush();
  assert.equal(h.binance.length, 2);
  h.hub.destroy();
});

await test("CACHED: no active upstream but stored bars exist -> bootstrap status is CACHED with no feeds listed", async () => {
  const h = await makeHub();
  const nowSec = Math.floor(h.getNow() / 1000);
  h.hub.store.upsertBars("EURUSD", "1D", Array.from({ length: 30 }, (_, i) => ({ t: nowSec - (30 - i) * 86400, o: 1.1, h: 1.11, l: 1.09, c: 1.105, v: 100 })));
  const res = await h.hub.fetch(new Request("https://market-hub/api/bootstrap?chart=EURUSD:1D&wl=EURUSD&preset=P5"));
  assert.equal(res.status, 200);
  const state = await res.json();
  assert.equal(validateServerFrame(state).ok, true);
  assert.equal(state.status.provenance, "CACHED");
  assert.deepEqual(state.status.feeds, {});
  h.hub.destroy();
});

console.log(`crypto-routing-health.test.mjs: ${passed} passed, ${failed} failed`);
