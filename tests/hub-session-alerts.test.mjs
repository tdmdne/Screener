// tests/hub-session-alerts.test.mjs — A2: the `alerts` WS op registers a socket's alerts in the hub (server-side
// evaluation, AGENTS.md §0); frames go only to that socket under the client's ids; replace/close remove them.
// Run: node tests/hub-session-alerts.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { validateServerFrame, validateClientMessage } from "../shared/protocol.js";
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


async function makeHub(nowMs) {
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
  return { hub, ctx, state };
}


async function connect(hub, state) {
  await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  return state.browser;
}
const frames = (ws, type) => ws.sent.map((s) => JSON.parse(s)).filter((f) => !type || f.type === type);

await test("protocol: alerts op shape and budget", () => {
  assert.equal(validateClientMessage(JSON.stringify({ op: "alerts", alerts: [{ id: 1, sym: "EURUSD", condition: "above", target: 1.2 }] })).ok, true);
  assert.equal(validateClientMessage(JSON.stringify({ op: "alerts", alerts: {} })).ok, false);
  assert.equal(validateClientMessage(JSON.stringify({ op: "alerts", alerts: [{ sym: "EURUSD" }] })).ok, false, "id required");
  assert.equal(validateClientMessage(JSON.stringify({ op: "alerts", alerts: Array.from({ length: 41 }, (_, i) => ({ id: i + 1 })) })).ok, false);
});

await test("session alert fires only to its socket, with the client's id, and subscribes the symbol", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, ctx, state } = await makeHub(fakeNow);
  const nowSec = Math.floor(fakeNow / 1000);
  const a = await connect(hub, state);
  await hub.webSocketMessage(a, JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1m" } }));
  const b = await connect(hub, state);
  await hub.webSocketMessage(b, JSON.stringify({ op: "view", chart: { sym: "GBPUSD", tf: "1m" } }));
  await hub.ensureUpstream();
  await hub.webSocketMessage(a, JSON.stringify({ op: "alerts", alerts: [{ id: 1700000000001, sym: "GBPUSD", condition: "cross_up", target: 1.3, userId: "someone-else" }] }));
  const idA = [...hub.sessionAlerts.keys()][0];
  assert.ok(hub.core.clients.get(idA).syms.has("GBPUSD"), "alert symbol subscribed for socket A");
  hub.ingestTick({ s: "GBPUSD", c: 1.29, t: nowSec + 1, v: 0, src: "twelvedata" });
  a.sent.length = 0; b.sent.length = 0;
  hub.ingestTick({ s: "GBPUSD", c: 1.31, t: nowSec + 2, v: 0, src: "twelvedata" });
  await ctx.flushWaitUntil();
  const fa = frames(a, "alert");
  assert.equal(fa.length, 1, "A gets its alert");
  assert.equal(fa[0].id, "1700000000001", "client's own id on the wire");
  assert.equal(fa[0].sym, "GBPUSD");
  assert.equal(validateServerFrame(fa[0], { lastSeq: 0 }).ok, true);
  assert.equal(frames(b, "alert").length, 0, "B (also on GBPUSD) does not");
  hub.destroy();
});

await test("watchlist + multi-condition + line alerts through the op; invalid ones reported, valid ones kept", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, ctx, state } = await makeHub(fakeNow);
  const nowSec = Math.floor(fakeNow / 1000);
  const a = await connect(hub, state);
  await hub.webSocketMessage(a, JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1m" } }));
  await hub.ensureUpstream();
  await hub.webSocketMessage(a, JSON.stringify({ op: "alerts", alerts: [
    { id: "w1", syms: ["EURUSD", "GBPUSD"], condition: "above", target: 1.2 },
    { id: "bad", sym: "EURUSD", condition: "nope", target: 1 },
    { id: "m1", sym: "EURUSD", condition: "above", target: 1.0, conds: [{ condition: "below", target: 1.1 }] },
    { id: "l1", sym: "EURUSD", condition: "cross_up", line: { t1: nowSec - 3600, p1: 1.05, t2: nowSec, p2: 1.06, ext: "ray" } },
  ] }));
  const err = frames(a, "error").find((f) => f.code === "INVALID_ALERTS");
  assert.ok(err && /bad/.test(err.message), "one error frame names the rejected alert");
  assert.equal(hub.sessionAlerts.values().next().value.ids.size, 3);
  a.sent.length = 0;
  hub.ingestTick({ s: "EURUSD", c: 1.059, t: nowSec + 1, v: 0, src: "twelvedata" });
  hub.ingestTick({ s: "EURUSD", c: 1.065, t: nowSec + 2, v: 0, src: "twelvedata" });
  hub.ingestTick({ s: "GBPUSD", c: 1.25, t: nowSec + 2, v: 0, src: "twelvedata" });
  await ctx.flushWaitUntil();
  const ids = frames(a, "alert").map((f) => f.id + "@" + f.sym).sort();
  assert.deepEqual(ids, ["l1@EURUSD", "m1@EURUSD", "w1@GBPUSD"], "line crossed, multi-condition held, watchlist child fired: " + ids);
  hub.destroy();
});

await test("replacing with [] or closing the socket removes the session alerts", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, state } = await makeHub(fakeNow);
  const a = await connect(hub, state);
  await hub.webSocketMessage(a, JSON.stringify({ op: "alerts", alerts: [{ id: "x", sym: "EURUSD", condition: "above", target: 2 }] }));
  assert.equal(hub.alerts.listAlerts().length, 1);
  await hub.webSocketMessage(a, JSON.stringify({ op: "alerts", alerts: [] }));
  assert.equal(hub.alerts.listAlerts().length, 0);
  await hub.webSocketMessage(a, JSON.stringify({ op: "alerts", alerts: [{ id: "y", syms: ["EURUSD", "GBPUSD"], condition: "above", target: 2 }] }));
  assert.equal(hub.alerts.listAlerts().length, 2);
  await hub.webSocketClose(a);
  assert.equal(hub.alerts.listAlerts().length, 0);
  assert.equal(hub.sessionAlerts.size, 0);
  hub.destroy();
});

if (failed > 0) process.exit(1);
console.log("HUB SESSION ALERTS OK");
