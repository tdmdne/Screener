// tests/hub-do.test.mjs — Tasks 2, 4, 8, 9 tests for MarketHub DO + MarketStore:
// - Single upstream Twelve Data WS, X-TD-APIKEY header, 10s heartbeat, 30s alarm reconnect with exponential backoff
// - Persisted SQLite `subs` resubscribed on restart, TD_WS_MAX cap
// - SQLite hot bar store trim at 1,500 bars, dedup
// - KV write-budget guard refusing write #901, immutable chunk write-once, 5-min throttle on snap:v1
// - Hibernation WS Protocol v2 flow + ticks -> CandleBuilder -> IndicatorTracker -> Screener
// - GET /api/bootstrap valid Protocol v2 `state` <= 150 KB gzipped + GET /api/bars + GET /hub/stats (zero secrets)
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  MAX_CLIENT_FRAME_BYTES,
  checkLiveFrameBudget,
  checkStateGzipBudget,
  validateServerFrame,
} from "../shared/protocol.js";
import { computeIndicator } from "../shared/market/indicators.js";
import { MAX_BOOTSTRAP_INDICATORS, MarketHub } from "../workers/market/hub.js";
import { MarketStore } from "../workers/market/store.js";

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

/** Fake Cloudflare KV namespace tracking put/get calls. */
function createFakeKv() {
  const data = new Map();
  let putCount = 0;
  let getCount = 0;
  return {
    data,
    get putCount() { return putCount; },
    get getCount() { return getCount; },
    async get(key) {
      getCount += 1;
      return data.has(key) ? data.get(key) : null;
    },
    async put(key, val) {
      putCount += 1;
      data.set(key, String(val));
    },
  };
}

await test("Task 2: Single upstream WS connect, X-TD-APIKEY header, 10s heartbeat, silent >30s alarm reconnect + exponential backoff", async () => {
  let fakeNow = Date.UTC(2026, 10, 19, 10, 0, 0);
  const { sql } = createSqliteDb();
  const ctx = createMockDoCtx(sql);
  const timers = createFakeTimers();
  const opened = [];
  let failNextOpens = 0;

  const hub = new MarketHub(
    ctx,
    { TWELVEDATA_KEY: "TD_KEY_PRIVATE_001", TD_WS_MAX: "8" },
    {
      now: () => fakeNow,
      jitter: false,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      openUpstreamWs: async (url, init) => {
        if (failNextOpens > 0) {
          failNextOpens -= 1;
          throw new Error("simulated network outage");
        }
        const ws = new FakeWebSocket(`up-${opened.length + 1}`);
        opened.push({ url, headers: init.headers, ws });
        return ws;
      },
    }
  );
  await hub.ready();

  // Initial 30s alarm armed
  assert.equal(ctx.alarms.length, 1);
  assert.equal(ctx.alarms[0], fakeNow + 30_000);

  // Subscribe 2 symbols -> strictly ONE upstream WS opened with X-TD-APIKEY header
  const subRes = hub.subscribeUpstream(["EURUSD", "AAPL"]);
  await hub.ensureUpstream();
  assert.deepEqual(subRes.accepted, ["EURUSD", "AAPL"]);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].headers["X-TD-APIKEY"], "TD_KEY_PRIVATE_001");
  assert.equal(opened[0].headers.Upgrade, "websocket");

  // Duplicate ensureUpstream() does NOT open a second socket
  await hub.ensureUpstream();
  assert.equal(opened.length, 1);

  // Initial subscribe frame sent in Twelve Data format
  const subFrame = JSON.parse(opened[0].ws.sent[0]);
  assert.equal(subFrame.action, "subscribe");
  assert.ok(subFrame.params.symbols.includes("EUR/USD"));
  assert.ok(subFrame.params.symbols.includes("AAPL"));

  // 10s heartbeat timer sends {"action":"heartbeat"}
  fakeNow += 10_000;
  timers.tickIntervals(10_000);
  assert.equal(opened[0].ws.sent.at(-1), '{"action":"heartbeat"}');

  // Healthy alarm at +20s sends heartbeat and re-arms next 30s alarm (no reconnect)
  fakeNow += 10_000;
  await hub.alarm();
  assert.equal(opened.length, 1);
  assert.equal(hub.upReconnects, 0);
  assert.equal(ctx.alarms.at(-1), fakeNow + 30_000);

  // Silent > 30s -> alarm closes stale socket and schedules exponential backoff (1s -> 2s -> 4s)
  fakeNow += 31_000; // 51s since lastUpstreamMsgAt (which was at t=0)
  await hub.alarm();
  assert.equal(opened[0].ws.closed, true);
  assert.equal(hub.upConnected, false);
  assert.equal(hub.upReconnects, 1);
  assert.equal(hub.retryAttempt, 1);
  assert.equal(hub.nextReconnectAt, fakeNow + 1_000); // 1st backoff = 1s

  // Simulate 2 consecutive failed reconnect attempts -> verify 2s then 4s exponential backoff
  failNextOpens = 2;
  fakeNow += 1_000;
  await hub.alarm(); // attempt fails -> retryAttempt becomes 2, next delay = 2s
  assert.equal(hub.upConnected, false);
  assert.equal(hub.retryAttempt, 2);
  assert.equal(hub.nextReconnectAt, fakeNow + 2_000);

  // Alarm before backoff expires does NOT attempt reconnect early
  fakeNow += 1_000;
  await hub.alarm();
  assert.equal(hub.retryAttempt, 2);

  // Backoff expires -> 2nd failure -> retryAttempt becomes 3, next delay = 4s
  fakeNow += 1_000;
  await hub.alarm();
  assert.equal(hub.retryAttempt, 3);
  assert.equal(hub.nextReconnectAt, fakeNow + 4_000);

  // Advance 4s -> reconnect succeeds, retryAttempt resets to 0, single WS open & resubscribed
  fakeNow += 4_000;
  await hub.alarm();
  assert.equal(hub.upConnected, true);
  assert.equal(hub.retryAttempt, 0);
  assert.equal(opened.length, 2);
  const resub = JSON.parse(opened[1].ws.sent[0]);
  assert.equal(resub.action, "subscribe");
  assert.ok(resub.params.symbols.includes("EUR/USD"));
  assert.ok(resub.params.symbols.includes("AAPL"));

  hub.destroy();
});

await test("Task 2: Persisted SQLite subs resubscribed on DO restart + TD_WS_MAX cap enforced", async () => {
  const { sql } = createSqliteDb();
  const timers1 = createFakeTimers();
  const opened1 = [];

  const hub1 = new MarketHub(
    createMockDoCtx(sql),
    { TWELVEDATA_KEY: "KEY_RESTART", TD_WS_MAX: "3" },
    {
      jitter: false,
      setTimer: timers1.setTimer,
      clearTimer: timers1.clearTimer,
      setTimeout: timers1.setTimeout,
      clearTimeout: timers1.clearTimeout,
      openUpstreamWs: async () => {
        const ws = new FakeWebSocket("up1");
        opened1.push(ws);
        return ws;
      },
    }
  );
  await hub1.ready();

  // Attempt to subscribe 5 symbols with TD_WS_MAX=3 -> 3 accepted, 2 rejected
  const res = hub1.subscribeUpstream(["EURUSD", "GBPUSD", "BTCUSDT", "AAPL", "MSFT"]);
  await hub1.ensureUpstream();
  assert.deepEqual(res.accepted, ["EURUSD", "GBPUSD", "BTCUSDT"]);
  assert.deepEqual(res.rejected, ["AAPL", "MSFT"]);
  assert.deepEqual(hub1.store.getSubs(), ["BTCUSDT", "EURUSD", "GBPUSD"]);
  hub1.destroy();

  // Simulate DO restart: fresh MarketHub instance mounted on SAME SQLite DB
  const timers2 = createFakeTimers();
  const opened2 = [];
  const ctx2 = createMockDoCtx(sql);
  const hub2 = new MarketHub(
    ctx2,
    { TWELVEDATA_KEY: "KEY_RESTART", TD_WS_MAX: "3" },
    {
      jitter: false,
      setTimer: timers2.setTimer,
      clearTimer: timers2.clearTimer,
      setTimeout: timers2.setTimeout,
      clearTimeout: timers2.clearTimeout,
      openUpstreamWs: async () => {
        const ws = new FakeWebSocket("up2");
        opened2.push(ws);
        return ws;
      },
    }
  );
  await hub2.ready();
  await ctx2.flushWaitUntil();

  // Automatically reconnected and resubscribed all 3 persisted symbols
  assert.equal(opened2.length, 1);
  assert.equal(hub2.upConnected, true);
  assert.deepEqual([...hub2.desiredSubs].sort(), ["BTCUSDT", "EURUSD", "GBPUSD"]);
  const msg = JSON.parse(opened2[0].sent[0]);
  assert.equal(msg.action, "subscribe");
  assert.equal(msg.params.symbols, "BTC/USD,EUR/USD,GBP/USD");
  hub2.destroy();
});

await test("Task 4: SQLite bar trim at 1,500 bars, deduplication, KV budget guard refuses write #901, 5-min snap:v1 throttle", async () => {
  let fakeNow = Date.UTC(2026, 10, 19, 8, 0, 0);
  const { sql } = createSqliteDb();
  const store = new MarketStore(sql, { now: () => fakeNow });
  store.init();

  // 1. Insert 1,650 bars -> trimmed strictly to newest 1,500
  const baseT = 1700000000;
  const batch = [];
  for (let i = 0; i < 1650; i++) {
    const px = 100 + i * 0.01;
    batch.push({ t: baseT + i * 60, o: px, h: px + 0.5, l: px - 0.5, c: px + 0.1, v: 10 + i });
  }
  store.upsertBars("EURUSD", "1m", batch);
  assert.equal(store.getBarCount("EURUSD", "1m"), 1500);

  const got = store.getBars("EURUSD", "1m");
  assert.equal(got.length, 1500);
  assert.equal(got[0].t, baseT + 150 * 60); // oldest 150 trimmed
  assert.equal(got[1499].t, baseT + 1649 * 60);

  // 2. Single upsert beyond 1,500 trims oldest immediately; duplicate timestamp updates in place (dedup)
  const dupT = got[1499].t;
  store.upsertBar("EURUSD", "1m", { t: dupT, o: 120, h: 125, l: 119, c: 124, v: 999 });
  assert.equal(store.getBarCount("EURUSD", "1m"), 1500);
  const latest = store.getBars("EURUSD", "1m", { limit: 1 })[0];
  assert.equal(latest.c, 124);
  assert.equal(latest.v, 999);

  // 3. Immutable history chunk written ONCE; second attempt does not consume KV writes
  const kv = createFakeKv();
  const c1 = await store.writeHistoryChunk(kv, "EURUSD", "1m", "202610", [
    { t: 1700000000, o: 1.08, h: 1.09, l: 1.07, c: 1.085, v: 100 },
  ]);
  assert.equal(c1.ok, true);
  assert.equal(c1.key, "bars:EURUSD:1m:202610");
  assert.equal(kv.putCount, 1);
  assert.equal(store.getKvWritesToday(), 1);

  const c1Dup = await store.writeHistoryChunk(kv, "EURUSD", "1m", "202610", [
    { t: 1700000000, o: 1.08, h: 1.09, l: 1.07, c: 1.085, v: 100 },
  ]);
  assert.equal(c1Dup.ok, false);
  assert.equal(c1Dup.reason, "already_written");
  assert.equal(kv.putCount, 1);
  assert.equal(store.getKvWritesToday(), 1);

  // 4. 5-minute throttle on snap:v1
  const s1 = await store.writeBootstrapSnapshot(kv, { rows: [], asOf: fakeNow });
  assert.equal(s1.ok, true);
  assert.equal(s1.key, "snap:v1");
  assert.equal(kv.putCount, 2);

  fakeNow += 60_000; // +1 min -> throttled
  const s2 = await store.writeBootstrapSnapshot(kv, { rows: [], asOf: fakeNow });
  assert.equal(s2.ok, false);
  assert.equal(s2.reason, "throttled");
  assert.equal(kv.putCount, 2);

  fakeNow += 239_000; // +4m59s total -> still throttled
  const s3 = await store.writeBootstrapSnapshot(kv, { rows: [], asOf: fakeNow });
  assert.equal(s3.ok, false);
  assert.equal(s3.reason, "throttled");
  assert.equal(kv.putCount, 2);

  fakeNow += 1_000; // +5m00s -> allowed
  const s4 = await store.writeBootstrapSnapshot(kv, { rows: [], asOf: fakeNow });
  assert.equal(s4.ok, true);
  assert.equal(kv.putCount, 3);
  assert.equal(store.getKvWritesToday(), 3);

  // Verify throttle survives restart (new MarketStore instance on same SQLite DB)
  const storeAfterRestart = new MarketStore(sql, { now: () => fakeNow });
  storeAfterRestart.init();
  fakeNow += 10_000;
  const s5 = await storeAfterRestart.writeBootstrapSnapshot(kv, { rows: [], asOf: fakeNow });
  assert.equal(s5.ok, false);
  assert.equal(s5.reason, "throttled");

  // 5. Strict < 900 KV writes/UTC day: write #900 succeeds, write #901 is REFUSED
  let writes = store.getKvWritesToday();
  assert.equal(writes, 3);
  while (writes < 900) {
    const res = store.consumeKvWrite(fakeNow);
    assert.equal(res.ok, true);
    writes = res.writes;
  }
  assert.equal(store.getKvWritesToday(fakeNow), 900);

  // Write #901 refused across consumeKvWrite, writeHistoryChunk, and writeBootstrapSnapshot
  const r901 = store.consumeKvWrite(fakeNow);
  assert.equal(r901.ok, false);
  assert.equal(r901.reason, "kv_budget_exhausted");

  const chunk901 = await store.writeHistoryChunk(kv, "GBPUSD", "1m", "202610", [
    { t: 1700000000, o: 1.25, h: 1.26, l: 1.24, c: 1.255, v: 50 },
  ]);
  assert.equal(chunk901.ok, false);
  assert.equal(chunk901.reason, "kv_budget_exhausted");

  fakeNow += 10 * 60_000; // past 5-min throttle, still same UTC day -> refused by daily KV budget
  const snap901 = await store.writeBootstrapSnapshot(kv, { rows: [], asOf: fakeNow });
  assert.equal(snap901.ok, false);
  assert.equal(snap901.reason, "kv_budget_exhausted");
  assert.equal(kv.putCount, 3); // no KV put happened on refusal

  // Next UTC day resets budget to 0
  fakeNow += 24 * 60 * 60 * 1000;
  assert.equal(store.getKvWritesToday(fakeNow), 0);
  const nextDaySnap = await store.writeBootstrapSnapshot(kv, { rows: [], asOf: fakeNow });
  assert.equal(nextDaySnap.ok, true);
  assert.equal(nextDaySnap.writes, 1);
  assert.equal(kv.putCount, 4);
});

await test("Tasks 2, 8, 9: Hibernation WS, ticks -> candles -> indicators -> screener, /api/bootstrap <= 150KB gzip, /api/bars, /hub/stats leaks zero secrets", async () => {
  let fakeNow = Date.UTC(2026, 10, 19, 12, 0, 0);
  const SECRET = "TD_SECRET_DO_NOT_LEAK_99999";
  const { sql } = createSqliteDb();
  const ctx = createMockDoCtx(sql);
  const kv = createFakeKv();
  const timers = createFakeTimers();
  let upWs = null;
  let browserServerWs = null;

  const hub = new MarketHub(
    ctx,
    {
      TWELVEDATA_KEY: SECRET,
      TD_WS_MAX: "8",
      MARKET_KV: kv,
    },
    {
      now: () => fakeNow,
      jitter: false,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      openUpstreamWs: async () => {
        upWs = new FakeWebSocket("upstream");
        return upWs;
      },
      createWebSocketPair: () => {
        const client = new FakeWebSocket("browser-client");
        browserServerWs = new FakeWebSocket("browser-server");
        return [client, browserServerWs];
      },
    }
  );
  await hub.ready();

  // Seed 1,500 real 1m bars for EURUSD + 60 daily & hourly bars across 6 symbols for realistic bootstrap payload
  const seedSymbols = ["EURUSD", "GBPUSD", "USDJPY", "BTCUSDT", "ETHUSDT", "AAPL"];
  const nowSec = Math.floor(fakeNow / 1000);
  const minStart = Math.floor(nowSec / 60) * 60 - 1500 * 60;
  const eurusd1m = [];
  for (let i = 0; i < 1500; i++) {
    const px = 1.08 + Math.sin(i / 25) * 0.005 + i * 0.00001;
    eurusd1m.push({
      t: minStart + i * 60,
      o: px,
      h: px + 0.0008,
      l: px - 0.0007,
      c: px + 0.0002,
      v: 120 + (i % 50),
    });
  }
  hub.store.upsertBars("EURUSD", "1m", eurusd1m);

  for (let sIdx = 0; sIdx < seedSymbols.length; sIdx++) {
    const sym = seedSymbols[sIdx];
    const basePx = sym === "BTCUSDT" ? 90000 : sym === "ETHUSDT" ? 3200 : sym === "AAPL" ? 225 : 1.1 + sIdx * 0.1;
    const bars1D = [];
    const bars1H = [];
    for (let i = 0; i < 60; i++) {
      const p = basePx * (1 + i * 0.002);
      bars1D.push({ t: nowSec - (60 - i) * 86400, o: p, h: p * 1.01, l: p * 0.99, c: p * 1.005, v: 10000 + i * 50 });
      bars1H.push({ t: nowSec - (60 - i) * 3600, o: p, h: p * 1.004, l: p * 0.996, c: p * 1.002, v: 1000 + i * 10 });
    }
    hub.store.upsertBars(sym, "1D", bars1D);
    hub.store.upsertBars(sym, "1H", bars1H);
  }

  // Also store an immutable older KV chunk for /api/bars server-merged history paging
  const olderChunkT = minStart - 3600;
  const olderDate = new Date(olderChunkT * 1000);
  const olderYm = `${olderDate.getUTCFullYear()}${String(olderDate.getUTCMonth() + 1).padStart(2, "0")}`;
  await hub.store.writeHistoryChunk(kv, "EURUSD", "1m", olderYm, [
    { t: olderChunkT, o: 1.075, h: 1.076, l: 1.074, c: 1.0755, v: 88 },
    { t: olderChunkT + 60, o: 1.0755, h: 1.0765, l: 1.075, c: 1.076, v: 92 },
  ]);

  // 1. Connect browser via Hibernation API (/ws)
  const wsRes = await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  assert.equal(wsRes.status, 101);
  assert.equal(ctx.acceptedSockets.length, 1);
  assert.ok(browserServerWs.deserializeAttachment().id, "attachment serialized on upgrade");

  const helloFrame = JSON.parse(browserServerWs.sent[0]);
  assert.equal(validateServerFrame(helloFrame).ok, true);
  assert.equal(helloFrame.type, "hello");
  assert.equal(helloFrame.seq, 1);

  // 2. Client sends Protocol v2 `view` -> receives valid `state` frame + triggers upstream subscribe
  await hub.webSocketMessage(
    browserServerWs,
    JSON.stringify({
      op: "view",
      chart: { sym: "EURUSD", tf: "1m", ind: [{ id: "ema5", type: "ema", period: 5 }] },
      watchlist: ["EURUSD", "BTCUSDT"],
      screener: { preset: "P5", page: 1 },
      heatmap: { metric: "chg", tf: "1D", n: 20 },
    })
  );
  await hub.ensureUpstream();

  const sentFramesAfterView = browserServerWs.sent.map((s) => JSON.parse(s));
  const stateFrameFromWs = sentFramesAfterView.find((f) => f.type === "state");
  assert.ok(stateFrameFromWs, "state frame sent after view");
  assert.equal(validateServerFrame(stateFrameFromWs, { lastSeq: 1 }).ok, true);
  assert.equal(stateFrameFromWs.type, "state");
  assert.equal(stateFrameFromWs.chart.sym, "EURUSD");
  assert.equal(stateFrameFromWs.chart.bars.length, 1500);
  assert.ok(stateFrameFromWs.chart.ind.ema5.points.length > 0);
  assert.ok(stateFrameFromWs.screener.rows.length > 0);
  assert.ok(stateFrameFromWs.heatmap.tiles.length > 0);

  // 3. Feed upstream ticks (including 1 bogus 5% FX spike) across a 1m close boundary
  assert.ok(upWs, "upstream WS connected");
  const lastSeqBeforeTicks = sentFramesAfterView.at(-1).seq;
  const bar1T = Math.floor(fakeNow / 1000);
  upWs.emit("message", {
    data: JSON.stringify({ event: "price", symbol: "EUR/USD", price: 1.095, timestamp: bar1T }),
  });
  // Bogus 5% FX spike -> must be dropped by zero-tolerance tick guard!
  upWs.emit("message", {
    data: JSON.stringify({ event: "price", symbol: "EUR/USD", price: 1.15, timestamp: bar1T + 5 }),
  });
  // Next minute tick -> closes bar1, triggers IndicatorTracker (`ind`) + screener refresh!
  fakeNow += 65_000;
  upWs.emit("message", {
    data: JSON.stringify({ event: "price", symbol: "EUR/USD", price: 1.0955, timestamp: bar1T + 65 }),
  });
  await ctx.flushWaitUntil();

  // Flush coalesced quotes to browser
  hub.core.flush();

  const allBrowserFrames = browserServerWs.sent.map((s) => JSON.parse(s));
  let prevSeq = 0;
  for (const f of allBrowserFrames) {
    if (f.type !== "pong") {
      const v = validateServerFrame(f, { lastSeq: prevSeq });
      assert.equal(v.ok, true, `frame invalid: ${v.error}`);
      prevSeq = f.seq;
    }
    if (f.type === "bar" || f.type === "ind" || f.type === "quotes" || f.type === "status") {
      assert.equal(checkLiveFrameBudget(f).ok, true, `${f.type} frame exceeded 2KB live budget`);
    }
  }
  assert.ok(prevSeq > lastSeqBeforeTicks);
  assert.ok(allBrowserFrames.some((f) => f.type === "bar" && f.closed === true), "closed bar frame emitted");
  assert.ok(allBrowserFrames.some((f) => f.type === "ind" && f.id === "ema5"), "indicator delta frame emitted");
  assert.ok(allBrowserFrames.some((f) => f.type === "quotes"), "coalesced quotes frame emitted");

  // 4. GET /api/bootstrap?chart=EURUSD:1m&wl=EURUSD,BTCUSDT&preset=P5&ind=ema:20,rsi:14
  const bootRes = await hub.fetch(
    new Request(
      "https://market-hub/api/bootstrap?chart=EURUSD:1m&wl=EURUSD,BTCUSDT&preset=P5&ind=ema:20,rsi:14"
    )
  );
  assert.equal(bootRes.status, 200);
  const bootState = await bootRes.json();
  const bootValid = validateServerFrame(bootState);
  assert.equal(bootValid.ok, true, `bootstrap state invalid: ${bootValid.error}`);
  assert.equal(bootState.type, "state");
  assert.equal(bootState.chart.sym, "EURUSD");
  assert.equal(bootState.chart.bars.length, 1500);
  assert.ok(bootState.chart.ind["ema:20"].points.length > 0);
  assert.ok(bootState.chart.ind["rsi:14"].points.length > 0);
  assert.equal(bootState.watchlist.length, 2);
  assert.equal(bootState.screener.rows.length, 6);
  assert.equal(bootState.heatmap.tiles.length, 6);

  // Strict <= 150 KB gzipped bootstrap budget check
  const gzipCheck = await checkStateGzipBudget(bootState);
  assert.equal(
    gzipCheck.ok,
    true,
    `bootstrap state gzip (${gzipCheck.gzipBytes}B) exceeded 150KB limit (${gzipCheck.limit}B)`
  );

  // 5. GET /api/bars server-merged history paging (KV immutable chunk + SQLite hot bars)
  // Note: Only the 1 closed live 1m bar (bar1T) was persisted to SQLite (forming bar stays in memory),
  // trimming only minStart and leaving 2 SQLite bars < minStart+180 (minStart+60, minStart+120)
  // merged with the 2 older KV chunk bars = 4 bars.
  const barsRes = await hub.fetch(
    new Request(`https://market-hub/api/bars?sym=EURUSD&tf=1m&before=${minStart + 180}&limit=10`)
  );
  assert.equal(barsRes.status, 200);
  const barsJson = await barsRes.json();
  assert.equal(barsJson.ok, true);
  assert.equal(barsJson.bars.length, 4);
  assert.equal(barsJson.bars[0].t, olderChunkT);
  assert.equal(barsJson.bars[1].t, olderChunkT + 60);
  assert.equal(barsJson.bars[2].t, minStart + 60);
  assert.equal(barsJson.bars[3].t, minStart + 120);

  // 6. GET /hub/stats leaks ZERO secrets and reports accurate telemetry
  const statsRes = await hub.fetch(new Request("https://market-hub/hub/stats"));
  assert.equal(statsRes.status, 200);
  const statsText = await statsRes.text();
  assert.ok(!statsText.includes(SECRET), "TWELVEDATA_KEY must NEVER appear in /hub/stats");
  const stats = JSON.parse(statsText);
  assert.equal(stats.ok, true);
  assert.equal(stats.clients, 1);
  assert.equal(stats.upstream.connected, true);
  assert.equal(stats.ticks.dropped, 1);
  assert.ok(stats.barsClosed >= 1);
  assert.ok(stats.kvWritesToday >= 1 && stats.kvWritesToday < 900);

  hub.destroy();
});

await test("Security Fix #1: /api/bootstrap?ind= count cap (24) and period cap (1..1000) + WS view rejection", async () => {
  const { sql } = createSqliteDb();
  const ctx = createMockDoCtx(sql);
  const timers = createFakeTimers();
  let serverWs = null;

  const hub = new MarketHub(
    ctx,
    { TWELVEDATA_KEY: "KEY" },
    {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      openUpstreamWs: async () => new FakeWebSocket("up"),
      createWebSocketPair: () => {
        serverWs = new FakeWebSocket("srv");
        return [new FakeWebSocket("cli"), serverWs];
      },
    }
  );
  await hub.ready();

  // 1. 25 indicators (> MAX_BOOTSTRAP_INDICATORS = 24) -> 400
  const tooMany = Array.from({ length: MAX_BOOTSTRAP_INDICATORS + 1 }, (_, i) => `ema:${i + 2}`).join(",");
  const resTooMany = await hub.fetch(
    new Request(`https://market-hub/api/bootstrap?chart=EURUSD:1m&ind=${tooMany}`)
  );
  assert.equal(resTooMany.status, 400);
  const bodyTooMany = await resTooMany.json();
  assert.equal(bodyTooMany.ok, false);

  // 2. Period > 1000, period <= 0, unknown indicator -> 400
  for (const badInd of ["ema:1001", "ema:0", "rsi:-5", "sma:999999", "notreal:14"]) {
    const r = await hub.fetch(
      new Request(`https://market-hub/api/bootstrap?chart=EURUSD:1m&ind=${encodeURIComponent(badInd)}`)
    );
    assert.equal(r.status, 400, `expected 400 for ind=${badInd}`);
  }

  // 3. Valid boundary period 1000 -> 200
  const resOk = await hub.fetch(new Request("https://market-hub/api/bootstrap?chart=EURUSD:1m&ind=ema:1000,rsi:1"));
  assert.equal(resOk.status, 200);

  // 4. WS view with period > 1000 -> clean Protocol v2 error frame, indicator NOT registered
  await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  await hub.webSocketMessage(
    serverWs,
    JSON.stringify({
      op: "view",
      chart: { sym: "EURUSD", tf: "1m", ind: [{ id: "huge", type: "ema", period: 5000 }] },
    })
  );
  const lastFrame = JSON.parse(serverWs.sent.at(-1));
  assert.equal(validateServerFrame(lastFrame).ok, true);
  assert.equal(lastFrame.type, "error");
  assert.equal(lastFrame.code, "INVALID_INDICATOR");
  assert.equal(hub.indicatorRefs.size, 0);

  hub.destroy();
});

await test("Security Fix #2 & #9: Hibernation UUID client IDs never collide & seq stays strictly monotonic after HubCore.flush()", async () => {
  let fakeNow = Date.UTC(2026, 10, 19, 14, 0, 0);
  const { sql } = createSqliteDb();
  const ctx1 = createMockDoCtx(sql);
  const timers1 = createFakeTimers();
  let ws1Server = null;

  const hub1 = new MarketHub(
    ctx1,
    { TWELVEDATA_KEY: "KEY" },
    {
      now: () => fakeNow,
      setTimer: timers1.setTimer,
      clearTimer: timers1.clearTimer,
      setTimeout: timers1.setTimeout,
      clearTimeout: timers1.clearTimeout,
      openUpstreamWs: async () => new FakeWebSocket("up1"),
      createWebSocketPair: () => {
        ws1Server = new FakeWebSocket("srv-1");
        return [new FakeWebSocket("cli-1"), ws1Server];
      },
    }
  );
  await hub1.ready();

  // Connect client 1
  await hub1.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  const id1 = ws1Server.deserializeAttachment().id;
  assert.match(id1, /^c-[0-9a-f-]{36}$/i, "client ID must be UUID-based");

  // Subscribe client 1 to EURUSD & flush quotes via HubCore.flush()
  await hub1.webSocketMessage(
    ws1Server,
    JSON.stringify({ op: "view", watchlist: ["EURUSD"] })
  );
  hub1.ingestTick({ s: "EURUSD", c: 1.0901, t: fakeNow });
  hub1.core.flush();
  fakeNow += 1000;
  hub1.ingestTick({ s: "EURUSD", c: 1.0902, t: fakeNow });
  hub1.core.flush();

  const framesBeforeHib = ws1Server.sent.map((s) => JSON.parse(s));
  const maxSeqBeforeHib = framesBeforeHib.at(-1).seq;
  assert.equal(
    ws1Server.deserializeAttachment().seq,
    maxSeqBeforeHib,
    "HubCore.flush() must persist updated att.seq via serializeAttachment"
  );
  hub1.destroy();

  // Simulate DO hibernation wake-up: new MarketHub mounted with ws1Server already in ctx.getWebSockets()
  const ctx2 = createMockDoCtx(sql);
  ctx2.acceptedSockets.push(ws1Server);
  const timers2 = createFakeTimers();
  let ws2Server = null;
  const hub2 = new MarketHub(
    ctx2,
    { TWELVEDATA_KEY: "KEY" },
    {
      now: () => fakeNow,
      setTimer: timers2.setTimer,
      clearTimer: timers2.clearTimer,
      setTimeout: timers2.setTimeout,
      clearTimeout: timers2.clearTimeout,
      openUpstreamWs: async () => new FakeWebSocket("up2"),
      createWebSocketPair: () => {
        ws2Server = new FakeWebSocket("srv-2");
        return [new FakeWebSocket("cli-2"), ws2Server];
      },
    }
  );
  await hub2.ready();

  // Connect brand-new client 2 after hibernation wake-up -> MUST NOT collide with hydrated id1
  await hub2.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  const id2 = ws2Server.deserializeAttachment().id;
  assert.notEqual(id2, id1, "new client ID after hibernation must never collide with hydrated socket ID");
  assert.equal(hub2.core.clients.size, 2);

  // Flush a new tick to hydrated client 1 -> seq MUST strictly increase (> maxSeqBeforeHib)
  fakeNow += 1000;
  hub2.ingestTick({ s: "EURUSD", c: 1.0905, t: fakeNow });
  hub2.core.flush();

  const framesAfterHib = ws1Server.sent.map((s) => JSON.parse(s));
  const postHibFrame = framesAfterHib.at(-1);
  assert.ok(
    postHibFrame.seq > maxSeqBeforeHib,
    `post-hibernation seq (${postHibFrame.seq}) must be > pre-hibernation seq (${maxSeqBeforeHib})`
  );
  assert.equal(ws1Server.deserializeAttachment().seq, postHibFrame.seq);

  hub2.destroy();
});

await test("Security Fix #3: Concurrent KV write-budget stampede TOCTOU guard (snap:v1 & history chunks) + waitUntil catch", async () => {
  let fakeNow = Date.UTC(2026, 10, 19, 15, 0, 0);
  const { sql } = createSqliteDb();
  const store = new MarketStore(sql, { now: () => fakeNow });
  store.init();

  // Slow KV whose put/get pause on a deferred promise to expose TOCTOU races
  let releasePut;
  let putCalls = 0;
  const slowKv = {
    async get() {
      await Promise.resolve();
      return null;
    },
    async put() {
      putCalls += 1;
      await new Promise((r) => { releasePut = r; });
    },
  };

  // 1. Fire 5 concurrent writeBootstrapSnapshot() calls before first put resolves
  const snapPromises = Array.from({ length: 5 }, () =>
    store.writeBootstrapSnapshot(slowKv, { rows: [], asOf: fakeNow }, { now: fakeNow })
  );
  releasePut();
  const snapResults = await Promise.all(snapPromises);
  assert.equal(putCalls, 1, "concurrent snap:v1 writes must coalesce to exactly 1 kv.put");
  assert.equal(snapResults.filter((r) => r.ok).length, 1);
  assert.equal(snapResults.filter((r) => !r.ok && (r.reason === "in_flight" || r.reason === "throttled")).length, 4);
  assert.equal(store.getKvWritesToday(fakeNow), 1);

  // 2. Fire 5 concurrent writeHistoryChunk() calls for the SAME key before kv.get/put resolve
  let chunkPutCalls = 0;
  let releaseChunkGet;
  const slowChunkKv = {
    async get() {
      await new Promise((r) => { releaseChunkGet = r; });
      return null;
    },
    async put() {
      chunkPutCalls += 1;
    },
  };
  const bar = [{ t: 1700000000, o: 1.08, h: 1.09, l: 1.07, c: 1.085, v: 10 }];
  const chunkPromises = Array.from({ length: 5 }, () =>
    store.writeHistoryChunk(slowChunkKv, "EURUSD", "1m", "202609", bar, { now: fakeNow })
  );
  releaseChunkGet();
  const chunkResults = await Promise.all(chunkPromises);
  assert.equal(chunkPutCalls, 1, "concurrent chunk writes for same key must coalesce to exactly 1 kv.put");
  assert.equal(chunkResults.filter((r) => r.ok).length, 1);
  assert.equal(chunkResults.filter((r) => !r.ok && r.reason === "in_flight").length, 4);

  // 3. Failing KV inside hub.ingestTick -> refreshScreenerSnapshot waitUntil rejects cleanly (no unhandled rejection)
  const ctx = createMockDoCtx(sql);
  const timers = createFakeTimers();
  const failingKv = {
    async get() { return null; },
    async put() { throw new Error("KV 503 unavailable"); },
  };
  const hub = new MarketHub(
    ctx,
    { TWELVEDATA_KEY: "KEY", MARKET_KV: failingKv },
    {
      now: () => fakeNow + 10 * 60_000,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      openUpstreamWs: async () => new FakeWebSocket("up"),
    }
  );
  await hub.ready();
  const t0 = Math.floor(fakeNow / 1000);
  hub.ingestTick({ s: "EURUSD", c: 1.08, t: t0 * 1000 });
  hub.ingestTick({ s: "EURUSD", c: 1.081, t: (t0 + 65) * 1000 }); // closes bar -> triggers refreshScreenerSnapshot
  await ctx.flushWaitUntil(); // must NOT throw!
  hub.destroy();
});

await test("Security Fix #4: Unauthenticated client views cannot poison TD_WS_MAX; disconnect evicts ephemeral subs & cleans caches", async () => {
  const { sql } = createSqliteDb();
  const ctx = createMockDoCtx(sql);
  const timers = createFakeTimers();
  let upWs = null;
  const serverSockets = [];

  const hub = new MarketHub(
    ctx,
    { TWELVEDATA_KEY: "KEY", TD_WS_MAX: "2" },
    {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      openUpstreamWs: async () => {
        upWs = new FakeWebSocket("up");
        return upWs;
      },
      createWebSocketPair: () => {
        const srv = new FakeWebSocket(`srv-${serverSockets.length}`);
        serverSockets.push(srv);
        return [new FakeWebSocket(`cli-${serverSockets.length}`), srv];
      },
    }
  );
  await hub.ready();

  // Attacker connects (unauthenticated) and views 2 bogus unknown symbols -> MUST NOT occupy TD_WS_MAX slots!
  await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  const attackerWs = serverSockets[0];
  await hub.webSocketMessage(attackerWs, JSON.stringify({ op: "view", watchlist: ["BOGUS1", "BOGUS2"] }));
  await ctx.flushWaitUntil();

  // Unknown symbols from unauthenticated client MUST NOT be subscribed upstream or persisted to SQLite `subs`
  assert.deepEqual(hub.store.getSubs(), []);
  assert.equal(hub.desiredSubs.size, 0);
  assert.equal(hub.ephemeralSubs.size, 0);
  await hub.webSocketClose(attackerWs);

  // Legitimate client connects and views known universe symbols -> gets ephemeral slots, evicted cleanly on disconnect
  await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  const legitWs = serverSockets[1];
  await hub.webSocketMessage(legitWs, JSON.stringify({ op: "view", watchlist: ["EURUSD", "GBPUSD"] }));
  assert.deepEqual(hub.store.getSubs(), []);
  assert.equal(hub.desiredSubs.size, 0);
  assert.deepEqual([...hub.ephemeralSubs].sort(), ["EURUSD", "GBPUSD"]);

  // Feed a tick so CandleBuilder holds state for EURUSD
  hub.ingestTick({ s: "EURUSD", c: 1.09, t: Date.now() });
  assert.ok(hub.candles.getCurrent("EURUSD", "1m"));

  // Client disconnects -> ephemeral subs immediately evicted, upstream unsubscribed, caches cleared!
  await hub.webSocketClose(legitWs);
  assert.equal(hub.ephemeralSubs.size, 0);
  assert.equal(hub.tdToInternal.has("EUR/USD"), false);
  assert.equal(hub.candles.getCurrent("EURUSD", "1m"), null);

  // Also test explicit unsubscribeUpstream clears tdToInternal & candles
  hub.subscribeUpstream(["AAPL"]);
  hub.ingestTick({ s: "AAPL", c: 225, t: Date.now() });
  assert.ok(hub.candles.getCurrent("AAPL", "1m"));
  assert.equal(hub.tdToInternal.get("AAPL"), "AAPL");
  hub.unsubscribeUpstream(["AAPL"]);
  assert.equal(hub.tdToInternal.has("AAPL"), false);
  assert.equal(hub.candles.getCurrent("AAPL", "1m"), null);

  hub.destroy();
});

await test("Fix #5: IndicatorTracker refcounts & unregisters on view change/disconnect + never double-counts open forming bar", async () => {
  const baseSec = 1700000040; // aligned to 60s
  let fakeNow = (baseSec + 10 * 60 + 10) * 1000;
  const { sql } = createSqliteDb();
  const ctx = createMockDoCtx(sql);
  const timers = createFakeTimers();
  const serverSockets = [];

  const hub = new MarketHub(
    ctx,
    { TWELVEDATA_KEY: "KEY" },
    {
      now: () => fakeNow,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      openUpstreamWs: async () => new FakeWebSocket("up"),
      createWebSocketPair: () => {
        const srv = new FakeWebSocket(`srv-${serverSockets.length}`);
        serverSockets.push(srv);
        return [new FakeWebSocket(`cli-${serverSockets.length}`), srv];
      },
    }
  );
  await hub.ready();

  // Seed 10 closed 1m bars in SQLite
  const closed10 = [];
  for (let i = 0; i < 10; i++) {
    const p = 100 + i;
    closed10.push({ t: baseSec + i * 60, o: p, h: p + 1, l: p - 1, c: p + 0.5, v: 100 });
  }
  hub.store.upsertBars("AAPL", "1m", closed10);

  // Open forming bar #11 in CandleBuilder (and even simulate a checkpointed copy in SQLite!)
  const bar11T = baseSec + 10 * 60;
  hub.ingestTick({ s: "AAPL", c: 111.2, t: (bar11T + 5) * 1000 });
  hub.store.upsertBar("AAPL", "1m", { t: bar11T, o: 111.2, h: 111.2, l: 111.2, c: 111.2, v: 0 });

  // Client A & Client B both subscribe to AAPL 1m ema:5 while bar #11 is open
  await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  const wsA = serverSockets[0];
  const wsB = serverSockets[1];

  const viewAapl = JSON.stringify({
    op: "view",
    chart: { sym: "AAPL", tf: "1m", ind: [{ id: "ema5", type: "ema", period: 5 }] },
  });
  await hub.webSocketMessage(wsA, viewAapl);
  await hub.webSocketMessage(wsB, viewAapl);
  assert.equal(hub.indicatorRefs.get("AAPL|1m|ema:5").count, 2);

  // Now close bar #11 by ingesting tick in bar #12
  hub.ingestTick({ s: "AAPL", c: 111.8, t: (bar11T + 30) * 1000 });
  hub.ingestTick({ s: "AAPL", c: 112.0, t: (bar11T + 65) * 1000 });

  // Verify incremental EMA matches exact batch EMA over the 11 closed bars (zero double-counting of bar #11!)
  const bar11Closed = hub.store.getBars("AAPL", "1m", { limit: 1 })[0];
  assert.equal(bar11Closed.t, bar11T);
  const expectedEma = computeIndicator([...closed10, bar11Closed], { type: "ema", period: 5 }).last;
  const actualEma = hub.indicators.getLast("AAPL", "1m", { type: "ema", period: 5 });
  assert.ok(Math.abs(actualEma - expectedEma) < 1e-12, `EMA mismatch: ${actualEma} vs ${expectedEma}`);

  // Client A switches view away (past 500ms view cooldown) -> refcount drops to 1, indicator still tracked for Client B
  fakeNow += 1000;
  await hub.webSocketMessage(wsA, JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1m", ind: [] } }));
  assert.equal(hub.indicatorRefs.get("AAPL|1m|ema:5").count, 1);
  assert.notEqual(hub.indicators.getLast("AAPL", "1m", { type: "ema", period: 5 }), undefined);

  // Client B disconnects -> refcount drops to 0, IndicatorTracker stream unregistered!
  await hub.webSocketClose(wsB);
  assert.equal(hub.indicatorRefs.has("AAPL|1m|ema:5"), false);
  assert.equal(hub.indicators.getLast("AAPL", "1m", { type: "ema", period: 5 }), undefined);

  hub.destroy();
});

await test("Fix #6: Twelve Data cumulative day_volume is converted to non-negative per-tick delta with UTC-day reset", async () => {
  let fakeNow = Date.UTC(2026, 10, 19, 16, 0, 0);
  const { sql } = createSqliteDb();
  const ctx = createMockDoCtx(sql);
  const timers = createFakeTimers();
  let upWs = null;

  const hub = new MarketHub(
    ctx,
    { TWELVEDATA_KEY: "KEY" },
    {
      now: () => fakeNow,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      openUpstreamWs: async () => {
        upWs = new FakeWebSocket("up");
        return upWs;
      },
    }
  );
  await hub.ready();
  hub.subscribeUpstream(["AAPL"]);
  await hub.ensureUpstream();

  const t0 = Math.floor(fakeNow / 1000);
  // 3 ticks within same 1m bar carrying cumulative day_volume + 1 out-of-order dip
  upWs.emit("message", { data: JSON.stringify({ event: "price", symbol: "AAPL", price: 225.0, day_volume: 10_000_000, timestamp: t0 }) });
  upWs.emit("message", { data: JSON.stringify({ event: "price", symbol: "AAPL", price: 225.1, day_volume: 10_000_250, timestamp: t0 + 5 }) });
  upWs.emit("message", { data: JSON.stringify({ event: "price", symbol: "AAPL", price: 225.2, day_volume: 10_000_200, timestamp: t0 + 8 }) }); // dip -> 0
  upWs.emit("message", { data: JSON.stringify({ event: "price", symbol: "AAPL", price: 225.3, day_volume: 10_000_400, timestamp: t0 + 12 }) });

  const forming = hub.candles.getCurrent("AAPL", "1m");
  assert.equal(forming.v, 400, `expected delta volume 400, got ${forming.v} (must NOT inflate cumulative day_volume!)`);

  // Next UTC day reset: baseline resets to 500 (delta 0), then 620 -> delta 120
  const nextDaySec = Math.floor(Date.UTC(2026, 10, 20, 14, 30, 0) / 1000);
  upWs.emit("message", { data: JSON.stringify({ event: "price", symbol: "AAPL", price: 225.4, day_volume: 500, timestamp: nextDaySec }) });
  upWs.emit("message", { data: JSON.stringify({ event: "price", symbol: "AAPL", price: 225.5, day_volume: 620, timestamp: nextDaySec + 10 }) });
  const nextDayBar = hub.candles.getCurrent("AAPL", "1m");
  assert.equal(nextDayBar.v, 120, `expected next-day delta volume 120, got ${nextDayBar.v}`);

  hub.destroy();
});

await test("Fix #7: Zero SQLite writes on intra-bar ticks (write ONLY on bar close) + _trimBars only on new bar insert", async () => {
  const { sql: rawSql } = createSqliteDb();
  const queryLog = [];
  const trackedSql = {
    exec(query, ...bindings) {
      queryLog.push(query.trim());
      return rawSql.exec(query, ...bindings);
    },
  };

  const ctx = createMockDoCtx(trackedSql);
  const timers = createFakeTimers();
  const baseSec = 1700000040;
  const hub = new MarketHub(
    ctx,
    { TWELVEDATA_KEY: "KEY" },
    {
      now: () => baseSec * 1000,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      openUpstreamWs: async () => new FakeWebSocket("up"),
    }
  );
  await hub.ready();
  queryLog.length = 0;

  // 10 intra-bar ticks in the same 1m bucket -> ZERO SQLite statements executed!
  for (let i = 0; i < 10; i++) {
    hub.ingestTick({ s: "EURUSD", c: 1.09 + i * 0.0001, t: (baseSec + i * 3) * 1000 });
  }
  assert.equal(queryLog.length, 0, `expected 0 SQLite statements on intra-bar ticks, got ${queryLog.length}`);

  // Tick in next minute closes 1m bar -> SQLite INSERT happens now!
  hub.ingestTick({ s: "EURUSD", c: 1.0915, t: (baseSec + 65) * 1000 });
  assert.ok(queryLog.some((q) => q.startsWith("INSERT INTO bars")), "closed bar persisted to SQLite");

  // MarketStore._trimBars (SELECT COUNT(*)) runs ONLY on new bar insert, NOT on in-place update!
  queryLog.length = 0;
  hub.store.upsertBar("EURUSD", "1m", { t: baseSec, o: 1.09, h: 1.092, l: 1.089, c: 1.091, v: 555 }); // existing timestamp
  assert.ok(
    !queryLog.some((q) => q.includes("COUNT(*)")),
    "_trimBars must NOT run when updating an existing bar timestamp"
  );

  queryLog.length = 0;
  hub.store.upsertBar("EURUSD", "1m", { t: baseSec + 120, o: 1.091, h: 1.093, l: 1.09, c: 1.092, v: 100 }); // brand-new timestamp
  assert.ok(
    queryLog.some((q) => q.includes("COUNT(*)")),
    "_trimBars MUST run when inserting a new bar timestamp"
  );

  hub.destroy();
});

await test("Fix #10: Slow/hung upstream WS never stalls blockConcurrencyWhile, /api/bootstrap, or /api/bars", async () => {
  const { sql } = createSqliteDb();
  const seedStore = new MarketStore(sql);
  seedStore.init();
  seedStore.addSubs(["EURUSD"]);
  seedStore.upsertBar("EURUSD", "1m", { t: 1700000040, o: 1.08, h: 1.09, l: 1.07, c: 1.085, v: 50 });

  const ctx = createMockDoCtx(sql);
  const timers = createFakeTimers();
  let releaseUpstream;
  const hub = new MarketHub(
    ctx,
    { TWELVEDATA_KEY: "KEY" },
    {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      openUpstreamWs: () =>
        new Promise((resolve) => {
          releaseUpstream = () => resolve(new FakeWebSocket("slow-up"));
        }),
    }
  );

  // Must resolve IMMEDIATELY even though openUpstreamWs has NOT resolved yet!
  await hub.ready();
  assert.equal(hub.upConnected, false);

  const bootRes = await hub.fetch(new Request("https://market-hub/api/bootstrap?chart=EURUSD:1m"));
  assert.equal(bootRes.status, 200);
  const barsRes = await hub.fetch(new Request("https://market-hub/api/bars?sym=EURUSD&tf=1m"));
  assert.equal(barsRes.status, 200);

  // Release slow upstream WS and verify waitUntil finishes cleanly
  releaseUpstream();
  await ctx.flushWaitUntil();
  assert.equal(hub.upConnected, true);
  hub.destroy();
});

await test("Fix #11 & #12: Real status.asOf provenance, accurate KV hasMore, pre-decode WS size guard & buildBootstrapState error boundary", async () => {
  const twoHoursAgo = Date.UTC(2026, 10, 19, 10, 0, 0);
  const fakeNow = twoHoursAgo + 2 * 3600 * 1000;
  const { sql } = createSqliteDb();
  const ctx = createMockDoCtx(sql);
  const kv = createFakeKv();
  const timers = createFakeTimers();
  let serverWs = null;

  const hub = new MarketHub(
    ctx,
    { TWELVEDATA_KEY: "KEY", MARKET_KV: kv },
    {
      now: () => fakeNow,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      openUpstreamWs: async () => new FakeWebSocket("up"),
      createWebSocketPair: () => {
        serverWs = new FakeWebSocket("srv");
        return [new FakeWebSocket("cli"), serverWs];
      },
    }
  );
  await hub.ready();

  // 1. Seed stale 2-hour-old bar in SQLite -> /api/bootstrap status.asOf preserves real bar timestamp (NOT fakeNow!)
  const staleSec = Math.floor(twoHoursAgo / 1000);
  hub.store.upsertBar("EURUSD", "1m", { t: staleSec, o: 1.08, h: 1.09, l: 1.07, c: 1.085, v: 50 });
  const bootRes = await hub.fetch(new Request("https://market-hub/api/bootstrap?chart=EURUSD:1m"));
  const bootState = await bootRes.json();
  assert.equal(bootState.status.provenance, "CACHED");
  assert.equal(bootState.status.asOf, staleSec * 1000, "CACHED status.asOf must reflect real data timestamp, not Date.now()");

  // 2. handleBarsRoute sets hasMore=true when KV merged > limit AND when an older KV chunk exists
  const octT = Math.floor(Date.UTC(2026, 9, 15, 12, 0, 0) / 1000);
  await hub.store.writeHistoryChunk(kv, "EURUSD", "1m", "202610", [
    { t: octT, o: 1.07, h: 1.071, l: 1.069, c: 1.0705, v: 10 },
    { t: octT + 60, o: 1.0705, h: 1.072, l: 1.07, c: 1.071, v: 12 },
    { t: octT + 120, o: 1.071, h: 1.073, l: 1.07, c: 1.072, v: 14 },
  ]);
  const sepT = Math.floor(Date.UTC(2026, 8, 20, 12, 0, 0) / 1000);
  await hub.store.writeHistoryChunk(kv, "EURUSD", "1m", "202609", [
    { t: sepT, o: 1.06, h: 1.061, l: 1.059, c: 1.0605, v: 9 },
  ]);

  // Request limit=2 before octT+180 -> merged has 3 KV bars (> limit 2) -> hasMore MUST be true
  const page1 = await (
    await hub.fetch(new Request(`https://market-hub/api/bars?sym=EURUSD&tf=1m&before=${octT + 180}&limit=2`))
  ).json();
  assert.equal(page1.bars.length, 2);
  assert.equal(page1.hasMore, true);

  // Request limit=10 before octT+60 -> returns octT + sepT (all remaining) -> hasMore MUST be false
  const page2 = await (
    await hub.fetch(new Request(`https://market-hub/api/bars?sym=EURUSD&tf=1m&before=${octT + 60}&limit=10`))
  ).json();
  assert.equal(page2.bars.length, 2);
  assert.equal(page2.bars[0].t, sepT);
  assert.equal(page2.hasMore, false);

  // 3. Pre-decode WS frame size guard rejects oversized Uint8Array before decoding
  await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  const oversized = new Uint8Array(MAX_CLIENT_FRAME_BYTES + 128);
  await hub.webSocketMessage(serverWs, oversized);
  const errSize = JSON.parse(serverWs.sent.at(-1));
  assert.equal(errSize.type, "error");
  assert.equal(errSize.code, "BUDGET_EXCEEDED");

  // 4. buildBootstrapState() throwing inside WS view sends clean Protocol v2 error frame
  const origBuild = hub.buildBootstrapState.bind(hub);
  hub.buildBootstrapState = async () => {
    throw new Error("simulated state builder failure");
  };
  await hub.webSocketMessage(serverWs, JSON.stringify({ op: "view", watchlist: ["EURUSD"] }));
  const errState = serverWs.sent
    .map((s) => JSON.parse(s))
    .find((f) => f.type === "error" && f.code === "STATE_BUILD_ERROR");
  assert.ok(errState, "expected STATE_BUILD_ERROR frame");
  assert.equal(validateServerFrame(errState).ok, true);
  assert.equal(errState.type, "error");
  assert.equal(errState.code, "STATE_BUILD_ERROR");
  hub.buildBootstrapState = origBuild;

  hub.destroy();
});

await test("Task 17 End-to-End: MarketHub evaluates alerts offline (0 browser sockets) and broadcasts valid Protocol v2 alert frames when connected", async () => {
  let fakeNow = Date.UTC(2026, 10, 19, 16, 0, 0);
  const { sql } = createSqliteDb();
  const ctx = createMockDoCtx(sql);
  const timers = createFakeTimers();
  let serverWs = null;

  const hub = new MarketHub(
    ctx,
    { TWELVEDATA_KEY: "KEY" },
    {
      now: () => fakeNow,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      openUpstreamWs: async () => new FakeWebSocket("up-alerts"),
      createWebSocketPair: () => {
        serverWs = new FakeWebSocket("srv-alerts");
        return [new FakeWebSocket("cli-alerts"), serverWs];
      },
    }
  );
  await hub.ready();

  // 1. Register an offline cross_up alert on EURUSD with 0 browser sockets open
  hub.alerts.addAlert({
    id: "offline-eur-cross",
    sym: "EURUSD",
    condition: "cross_up",
    target: 1.095,
    mode: "once",
  });

  // Verify /hub/stats exposes alertsCount
  const stats1 = await (await hub.fetch(new Request("https://market-hub/hub/stats"))).json();
  assert.equal(stats1.alertsCount, 1);
  assert.equal(stats1.clients, 0);

  // Feed two upstream ticks while 0 browser sockets are connected (1.094 -> 1.096 crosses 1.095)
  const r1 = hub.ingestTick({ s: "EURUSD", c: 1.094, t: fakeNow });
  assert.equal(r1.accepted, true);
  assert.equal(r1.alerts.length, 0);

  fakeNow += 5_000;
  const r2 = hub.ingestTick({ s: "EURUSD", c: 1.096, t: fakeNow });
  assert.equal(r2.accepted, true);
  assert.equal(r2.alerts.length, 1);
  assert.equal(r2.alerts[0].id, "offline-eur-cross");
  assert.equal(r2.alerts[0].price, 1.096);

  // Confirm offline crossing is persisted in the evaluator log and alert disarmed
  const logOffline = hub.alerts.getLog({ sym: "EURUSD" });
  assert.equal(logOffline.length, 1);
  assert.equal(logOffline[0].id, "offline-eur-cross");
  assert.equal(hub.alerts.getAlert("offline-eur-cross").armed, false);

  // 2. Connect a browser client subscribed to EURUSD and register a live alert + bar-close alert
  await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  await hub.webSocketMessage(
    serverWs,
    JSON.stringify({ op: "view", watchlist: ["EURUSD"] })
  );
  const seqBeforeAlert = JSON.parse(serverWs.sent.at(-1)).seq;

  hub.alerts.addAlert({
    id: "live-eur-above",
    sym: "EURUSD",
    condition: "above",
    target: 1.097,
    mode: "once",
  });
  hub.alerts.addAlert({
    id: "bar-close-eur",
    sym: "EURUSD",
    condition: "above",
    target: 1.095,
    onBarClose: true,
    mode: "once",
  });

  const stats2 = await (await hub.fetch(new Request("https://market-hub/hub/stats"))).json();
  assert.equal(stats2.alertsCount, 3);
  assert.equal(stats2.clients, 1);

  // Tick crosses live-eur-above (1.0975 >= 1.097) -> broadcasts Protocol v2 alert frame immediately
  fakeNow += 5_000;
  hub.ingestTick({ s: "EURUSD", c: 1.0975, t: fakeNow });

  const liveFrames = serverWs.sent.map((s) => JSON.parse(s));
  const liveAlertFrame = liveFrames.find((f) => f.type === "alert" && f.id === "live-eur-above");
  assert.ok(liveAlertFrame, "expected live Protocol v2 alert frame on connected socket");
  assert.equal(validateServerFrame(liveAlertFrame, { lastSeq: seqBeforeAlert }).ok, true);
  assert.equal(checkLiveFrameBudget(liveAlertFrame).ok, true);
  assert.equal(liveAlertFrame.sym, "EURUSD");
  assert.equal(liveAlertFrame.price, 1.0975);
  assert.equal(serverWs.deserializeAttachment().seq, liveAlertFrame.seq);

  // Next minute tick closes the 1m bar -> triggers onBarClose alert and broadcasts Protocol v2 alert frame
  fakeNow += 65_000;
  hub.ingestTick({ s: "EURUSD", c: 1.0972, t: fakeNow });
  await ctx.flushWaitUntil();

  const allFrames = serverWs.sent.map((s) => JSON.parse(s));
  const barAlertFrame = allFrames.find((f) => f.type === "alert" && f.id === "bar-close-eur");
  assert.ok(barAlertFrame, "expected onBarClose Protocol v2 alert frame on bar close");
  assert.equal(validateServerFrame(barAlertFrame, { lastSeq: liveAlertFrame.seq }).ok, true);
  assert.equal(checkLiveFrameBudget(barAlertFrame).ok, true);

  hub.destroy();
});

await test("Audit HIGH #1 & HIGH #3: Cross-tenant alert isolation (fail-closed) + per-client view cooldown + bootstrap TTL cache", async () => {
  let fakeNow = Date.UTC(2026, 10, 19, 17, 0, 0);
  const { sql } = createSqliteDb();
  const ctx = createMockDoCtx(sql);
  const timers = createFakeTimers();
  const serverSockets = [];

  const hub = new MarketHub(
    ctx,
    { TWELVEDATA_KEY: "KEY", TD_WS_MAX: "4" },
    {
      now: () => fakeNow,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      openUpstreamWs: async () => new FakeWebSocket("up-audit"),
      createWebSocketPair: () => {
        const srv = new FakeWebSocket(`srv-audit-${serverSockets.length}`);
        serverSockets.push(srv);
        return [new FakeWebSocket(`cli-audit-${serverSockets.length}`), srv];
      },
    }
  );
  await hub.ready();

  // Seed 1 bar so bootstrap builds real records
  const t0 = Math.floor(fakeNow / 1000);
  hub.store.upsertBar("EURUSD", "1m", { t: t0 - 60, o: 1.09, h: 1.092, l: 1.089, c: 1.091, v: 50 });

  // Connect 3 sockets: unauthenticated, user-alice, user-bob
  await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  const [wsAnon, wsAlice, wsBob] = serverSockets;

  const idAlice = wsAlice.deserializeAttachment().id;
  const idBob = wsBob.deserializeAttachment().id;
  hub.core.clients.get(idAlice).userId = "user-alice";
  hub.core.clients.get(idBob).userId = "user-bob";

  for (const ws of [wsAnon, wsAlice, wsBob]) {
    await hub.webSocketMessage(ws, JSON.stringify({ op: "view", watchlist: ["EURUSD"] }));
  }

  // HIGH #3: Rapid second `view` within 500ms -> RATE_LIMITED error frame
  fakeNow += 100;
  await hub.webSocketMessage(wsAnon, JSON.stringify({ op: "view", watchlist: ["EURUSD", "GBPUSD"] }));
  const rateLimitFrame = JSON.parse(wsAnon.sent.at(-1));
  assert.equal(rateLimitFrame.type, "error");
  assert.equal(rateLimitFrame.code, "RATE_LIMITED");

  // After 500ms cooldown passes -> view succeeds
  fakeNow += 500;
  await hub.webSocketMessage(wsAnon, JSON.stringify({ op: "view", watchlist: ["EURUSD"] }));
  assert.equal(JSON.parse(wsAnon.sent.at(-1)).type, "state");

  // HIGH #1: Register a user-owned alert for user-alice and trigger it
  hub.alerts.addAlert({
    id: "alice-private-alert",
    sym: "EURUSD",
    condition: "above",
    target: 1.095,
    mode: "once",
    userId: "user-alice",
  });

  fakeNow += 1000;
  hub.ingestTick({ s: "EURUSD", c: 1.096, t: fakeNow });

  const anonAlerts = wsAnon.sent.map((s) => JSON.parse(s)).filter((f) => f.type === "alert");
  const bobAlerts = wsBob.sent.map((s) => JSON.parse(s)).filter((f) => f.type === "alert");
  const aliceAlerts = wsAlice.sent.map((s) => JSON.parse(s)).filter((f) => f.type === "alert");

  assert.equal(anonAlerts.length, 0, "user-owned alert MUST NOT broadcast to unauthenticated socket");
  assert.equal(bobAlerts.length, 0, "user-owned alert MUST NOT broadcast to another user's socket");
  assert.equal(aliceAlerts.length, 1, "user-owned alert MUST deliver to owner socket");
  assert.equal(aliceAlerts[0].id, "alice-private-alert");
  assert.equal("userId" in aliceAlerts[0], false, "userId MUST NEVER appear on the wire alert frame");

  // HIGH #3: Bootstrap records cache avoids repeated SQLite scans within 1500ms TTL, invalidated on closed bar
  let buildRealCalls = 0;
  const origBuildReal = hub._buildRealRecords.bind(hub);
  hub._buildRealRecords = () => {
    buildRealCalls += 1;
    return origBuildReal();
  };
  hub._invalidateBootstrapCache();
  await hub.buildBootstrapState({}, 1);
  await hub.buildBootstrapState({}, 2);
  assert.equal(buildRealCalls, 1, "repeated buildBootstrapState within 1500ms must hit cache");

  // Advance past 1500ms TTL -> cache refreshes
  fakeNow += 1600;
  await hub.buildBootstrapState({}, 3);
  assert.equal(buildRealCalls, 2);

  // Closing a 1m bar immediately invalidates bootstrap cache
  fakeNow += 65_000;
  hub.ingestTick({ s: "EURUSD", c: 1.097, t: fakeNow });
  await ctx.flushWaitUntil();
  const callsAfterClose = buildRealCalls;
  await hub.buildBootstrapState({}, 4);
  assert.equal(buildRealCalls, callsAfterClose + 1, "closed bar must invalidate bootstrap cache");

  hub.destroy();
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
