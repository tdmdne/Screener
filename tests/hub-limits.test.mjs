// tests/hub-limits.test.mjs - upstream/abuse guards: Twelve Data subscribe/unsubscribe event budget (tdThrottle), alerts
// op coalescing, paper op rate limit, and the TD slot reservation for offline alerts. Run: node tests/hub-limits.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createTdThrottle } from "../shared/market/tdThrottle.js";
import { bucketStart } from "../shared/market/candles.js";
import { MarketHub } from "../workers/market/hub.js";

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
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


async function makeHub(nowMs, extra = {}) {
  const state = { now: nowMs, upWs: null, browser: null };
  const { sql } = createSqliteDb();
  const ctx = createMockDoCtx(sql);
  const timers = createFakeTimers();
  const hub = new MarketHub(
    ctx,
    { TWELVEDATA_KEY: "TD_KEY_TEST", TD_WS_MAX: "8" },
    {
      now: () => state.now,
      jitter: false,
      ...extra,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      openUpstreamWs: async () => {
        state.upWs = new FakeWebSocket("upstream");
        return state.upWs;
      },
      createWebSocketPair: () => {
        const client = new FakeWebSocket("browser-client");
        state.browser = new FakeWebSocket("browser-server");
        return [client, state.browser];
      },
    }
  );
  await hub.ready();
  return { hub, ctx, state, timers };
}

async function connect(hub, state) {
  await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  return state.browser;
}


const tdMsgs = (up) => up.sent.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter((m) => m && (m.action === "subscribe" || m.action === "unsubscribe"));
const tdEvents = (up) => tdMsgs(up).reduce((n, m) => n + String(m.params.symbols).split(",").filter(Boolean).length, 0);

await test("tdThrottle: bucket caps events, queues the rest, cancels opposite actions, refills over time", () => {
  let t = 0;
  const th = createTdThrottle({ capacity: 3, now: () => t });
  th.enqueue("subscribe", ["A", "B", "C", "D", "E"]);
  let r = th.take();
  assert.deepEqual(r.subscribe, ["A", "B", "C"]);
  assert.equal(th.waitMs(), 20000, "1 token per 20 s at 3/min");
  th.enqueue("unsubscribe", ["D"]); // queued subscribe never sent -> cancelled for free
  th.enqueue("unsubscribe", ["A"]);
  th.enqueue("subscribe", ["A"]); // queued unsubscribe of a live symbol -> cancelled
  t += 40000;
  r = th.take();
  assert.deepEqual(r, { subscribe: ["E"], unsubscribe: [] });
  assert.equal(th.waitMs(), null, "queue empty");
  th.reset();
  th.enqueue("unsubscribe", ["B"]);
  assert.equal(th.waitMs(), null, "nothing live after reset");
});

await test("hub: rapid chart switching never exceeds the Twelve Data event budget; the queue drains later", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, state, timers } = await makeHub(fakeNow, { tdEventsPerMin: 10 });
  const ws = await connect(hub, state);
  const FX = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY", "AUDJPY", "XAUUSD"];
  await hub.ensureUpstream();
  state.upWs.sent.length = 0;
  for (let i = 0; i < 40; i++) {
    hub.clientLastViewAt.clear();
    await hub.webSocketMessage(ws, JSON.stringify({ op: "view", chart: { sym: FX[i % FX.length], tf: "1m" } }));
  }
  assert.ok(tdEvents(state.upWs) <= 10, "budget respected under churn: " + tdEvents(state.upWs));
  assert.ok(hub.tdThrottle.stats().queued > 0 || hub.tdPumpTimer !== null || tdEvents(state.upWs) > 0);
  // a minute later the pump sends the settled state, still within budget per minute
  state.now += 60_000;
  timers.fireTimeouts();
  const after = tdEvents(state.upWs);
  assert.ok(after <= 20, "two minutes of budget at most: " + after);
  const lastSub = tdMsgs(state.upWs).filter((m) => m.action === "subscribe").pop();
  assert.ok(lastSub, "queued subscribes eventually sent");
  hub.destroy();
});

await test("hub: alerts op applies at most once per second; the newest deferred set wins", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, state, timers } = await makeHub(fakeNow);
  const ws = await connect(hub, state);
  const set = (n) => JSON.stringify({ op: "alerts", alerts: Array.from({ length: n }, (_, i) => ({ id: "a" + i, sym: "BTCUSDT", condition: "above", target: 1e7 + i })) });
  await hub.webSocketMessage(ws, set(1));
  assert.equal(hub.alerts.listAlerts().length, 1, "first op applied immediately");
  await hub.webSocketMessage(ws, set(2));
  await hub.webSocketMessage(ws, set(3));
  assert.equal(hub.alerts.listAlerts().length, 1, "within the cooldown: deferred");
  state.now += 1000;
  timers.fireTimeouts();
  assert.equal(hub.alerts.listAlerts().length, 3, "newest deferred set applied");
  await hub.webSocketClose(ws);
  assert.equal(hub.alertsApplyTimers.size, 0);
  hub.destroy();
});

await test("hub: paper actions closer than 150 ms are rejected", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, state } = await makeHub(fakeNow);
  const ws = await connect(hub, state);
  await hub.webSocketMessage(ws, JSON.stringify({ op: "paper", action: "get" }));
  ws.sent.length = 0;
  await hub.webSocketMessage(ws, JSON.stringify({ op: "paper", action: "get" }));
  const f = ws.sent.map((s) => JSON.parse(s)).find((x) => x.type === "error");
  assert.equal(f && f.code, "RATE_LIMITED");
  state.now += 200;
  ws.sent.length = 0;
  await hub.webSocketMessage(ws, JSON.stringify({ op: "paper", action: "get" }));
  assert.ok(ws.sent.map((s) => JSON.parse(s)).some((x) => x.type === "paper"));
  hub.destroy();
});

await test("hub: signed-in alerts hold at most a quarter of the TD slots; crypto alert symbols always subscribed", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, state } = await makeHub(fakeNow);
  await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket", "X-Vektor-User": "user-1" } }));
  const ws = state.browser;
  const fx = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD"];
  await hub.webSocketMessage(ws, JSON.stringify({ op: "alerts", alerts: [{ id: "w", syms: [...fx, "BTCUSDT", "ETHUSDT"], condition: "pct_move", target: 5 }] }));
  const syms = [...hub.core.clients.get("__user_alerts__").syms];
  const tdCount = syms.filter((s) => fx.includes(s)).length;
  assert.equal(tdCount, 2, "TD_WS_MAX 8 / 4 = 2 reserved TD symbols: " + syms);
  assert.ok(syms.includes("BTCUSDT") && syms.includes("ETHUSDT"), "crypto always subscribed");
  hub.destroy();
});

if (failed > 0) process.exit(1);
console.log("HUB LIMITS OK");
