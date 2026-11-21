// tests/user-alerts.test.mjs - A3: signed-in users' alerts run in the hub with no tab open. Pages /ws signs the user id,
// vektor-market trusts it only with the internal secret, the hub persists alerts in SQLite, queues offline fires and
// delivers them on the next connect. Run: node tests/user-alerts.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { validateServerFrame } from "../shared/protocol.js";
import { withVerifiedUser } from "../workers/market/index.js";
import { withSessionUser } from "../functions/ws.js";
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


const USER = "3f2b1c9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
async function connectAs(hub, state, userId) {
  const headers = { Upgrade: "websocket", ...(userId ? { "X-Vektor-User": userId } : {}) };
  await hub.fetch(new Request("https://market-hub/ws", { headers }));
  return state.browser;
}
const alertsOf = (ws) => ws.sent.map((s) => JSON.parse(s)).filter((f) => f.type === "alert");

await test("vektor-market withVerifiedUser: user header trusted only with the internal secret; secret never forwarded", () => {
  const env = { INTERNAL_TD_SECRET: "s3cret" };
  const mk = (h) => new Request("https://x/ws", { headers: h });
  let r = withVerifiedUser(mk({ "X-Vektor-User": USER }), env);
  assert.equal(r.headers.get("X-Vektor-User"), null, "browser-claimed user stripped");
  r = withVerifiedUser(mk({ "X-Vektor-User": USER, "X-Vektor-Internal": "wrong" }), env);
  assert.equal(r.headers.get("X-Vektor-User"), null, "wrong secret stripped");
  r = withVerifiedUser(mk({ "X-Vektor-User": USER, "X-Vektor-Internal": "s3cret" }), env);
  assert.equal(r.headers.get("X-Vektor-User"), USER);
  assert.equal(r.headers.get("X-Vektor-Internal"), null, "secret not passed to the DO");
  r = withVerifiedUser(mk({ "X-Vektor-User": "bad id!", "X-Vektor-Internal": "s3cret" }), env);
  assert.equal(r.headers.get("X-Vektor-User"), null, "malformed id stripped");
  assert.equal(withVerifiedUser(mk({ "X-Vektor-User": USER, "X-Vektor-Internal": "" }), {}).headers.get("X-Vektor-User"), null, "no secret configured");
});

await test("Pages withSessionUser: valid session cookie -> signed user; spoofed headers and bad sessions stay anonymous", async () => {
  const token = "t".repeat(40);
  const db = {
    prepare(sql) {
      return {
        bind() {
          return this;
        },
        async first() {
          return /FROM sessions/.test(sql)
            ? { id: USER, session_expires_at: Date.now() + 60_000, session_last_seen_at: Date.now(), disabled_at: null }
            : null;
        },
        async run() {},
      };
    },
  };
  const env = { INTERNAL_TD_SECRET: "s3cret", DB: db };
  const req = (h) => new Request("https://app/ws", { headers: h });
  let r = await withSessionUser(req({ Cookie: "vk_session=" + token, "X-Vektor-User": "attacker", "X-Vektor-Internal": "x" }), env);
  assert.equal(r.headers.get("X-Vektor-User"), USER);
  assert.equal(r.headers.get("X-Vektor-Internal"), "s3cret");
  r = await withSessionUser(req({ "X-Vektor-User": "attacker", "X-Vektor-Internal": "s3cret" }), env);
  assert.equal(r.headers.get("X-Vektor-User"), null, "no cookie: spoofed user removed");
  assert.equal(r.headers.get("X-Vektor-Internal"), null, "spoofed secret removed");
  r = await withSessionUser(req({ Cookie: "vk_session=short" }), env);
  assert.equal(r.headers.get("X-Vektor-User"), null, "invalid token");
  const throwing = {
    prepare() {
      throw new Error("d1 down");
    },
  };
  r = await withSessionUser(req({ Cookie: "vk_session=" + token }), { INTERNAL_TD_SECRET: "s3cret", DB: throwing });
  assert.equal(r.headers.get("X-Vektor-User"), null, "D1 error degrades to anonymous");
});

await test("signed-in user's alert keeps running after the tab closes; offline fire is queued and delivered on reconnect", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, ctx, state } = await makeHub(fakeNow);
  const nowSec = Math.floor(fakeNow / 1000);
  let ws = await connectAs(hub, state, USER);
  await hub.webSocketMessage(ws, JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1m" } }));
  await hub.ensureUpstream();
  await hub.webSocketMessage(ws, JSON.stringify({ op: "alerts", alerts: [{ id: "a1", sym: "GBPUSD", condition: "cross_up", target: 1.3 }] }));
  assert.equal(hub.store.listUserAlerts().length, 1, "persisted");
  await hub.webSocketClose(ws);
  assert.equal(hub.alerts.listAlerts().length, 1, "still registered after the tab closed");
  assert.ok(hub.core.clients.get("__user_alerts__").syms.has("GBPUSD"), "symbol kept subscribed with no socket");
  hub.ingestTick({ s: "GBPUSD", c: 1.29, t: nowSec + 1, v: 0, src: "twelvedata" });
  hub.ingestTick({ s: "GBPUSD", c: 1.31, t: nowSec + 2, v: 0, src: "twelvedata" });
  await ctx.flushWaitUntil();
  assert.equal(hub.store.listUserAlerts()[0].defs[0].fired, true, "one-shot fired state persisted");
  ws = await connectAs(hub, state, USER);
  const got = alertsOf(ws);
  assert.equal(got.length, 1, "queued alert delivered on reconnect");
  assert.equal(got[0].id, "a1");
  assert.equal(validateServerFrame(got[0], { lastSeq: 0 }).ok, true);
  const again = await connectAs(hub, state, USER);
  assert.equal(alertsOf(again).length, 0, "queue emptied after delivery");
  hub.destroy();
});

await test("user alerts go to every socket of that user and to nobody else", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, ctx, state } = await makeHub(fakeNow);
  const nowSec = Math.floor(fakeNow / 1000);
  const u1 = await connectAs(hub, state, USER);
  const u2 = await connectAs(hub, state, USER);
  const other = await connectAs(hub, state, "another-user");
  const anon = await connectAs(hub, state, null);
  for (const w of [u1, u2, other, anon]) await hub.webSocketMessage(w, JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1m" } }));
  await hub.ensureUpstream();
  await hub.webSocketMessage(u1, JSON.stringify({ op: "alerts", alerts: [{ id: "x", sym: "EURUSD", condition: "above", target: 1.2 }] }));
  for (const w of [u1, u2, other, anon]) w.sent.length = 0;
  hub.ingestTick({ s: "EURUSD", c: 1.25, t: nowSec + 1, v: 0, src: "twelvedata" });
  await ctx.flushWaitUntil();
  assert.deepEqual([u1, u2, other, anon].map((w) => alertsOf(w).length), [1, 1, 0, 0]);
  hub.destroy();
});

await test("persisted user alerts are re-registered when the DO starts (invalid rows skipped); [] deletes", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, state } = await makeHub(fakeNow);
  hub.store.saveUserAlerts(USER, [{ id: "p1", sym: "EURUSD", condition: "above", target: 1.5 }, { id: "bad", sym: "EURUSD", condition: "zzz", target: 1 }], fakeNow);
  hub.store.saveUserAlerts("bad user id!", [{ id: "q", sym: "EURUSD", condition: "above", target: 1 }], fakeNow);
  hub._loadUserAlerts();
  const ids = hub.alerts.listAlerts().map((a) => a.id);
  assert.equal(ids.length, 1, "one valid alert for the valid user: " + ids);
  assert.ok(ids[0].endsWith("~p1"));
  assert.equal(hub.alerts.listAlerts()[0].userId, USER);
  const ws = await connectAs(hub, state, USER);
  await hub.webSocketMessage(ws, JSON.stringify({ op: "alerts", alerts: [] }));
  assert.equal(hub.alerts.listAlerts().length, 0);
  assert.equal(hub.store.listUserAlerts().filter((r) => r.userId === USER).length, 0, "row deleted");
  assert.equal(hub.core.clients.has("__user_alerts__"), false, "pseudo-client removed with no user alerts left");
  hub.destroy();
});

if (failed > 0) process.exit(1);
console.log("USER ALERTS OK");
