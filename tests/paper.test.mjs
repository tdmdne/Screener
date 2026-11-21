// tests/paper.test.mjs - E-13 paper trading on live data: shared/paper.js engine + hub `paper` op (session and
// signed-in persisted accounts, SL/TP filled server-side on ticks). Run: node tests/paper.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { validateServerFrame, validateClientMessage } from "../shared/protocol.js";
import { createPaperAccount } from "../shared/paper.js";
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
const papers = (ws) => ws.sent.map((s) => JSON.parse(s)).filter((f) => f.type === "paper");
const errors = (ws) => ws.sent.map((s) => JSON.parse(s)).filter((f) => f.type === "error");

await test("paper engine: market fill, margin, commission, SL before TP, manual close, reset", () => {
  let t = 1000;
  const a = createPaperAccount({ settings: { balance: 1000, leverage: 10, commissionPct: 0.1 }, now: () => t++ });
  assert.equal(a.marketOrder({ sym: "EURUSD", side: "long", qty: 1000 }, 0).ok, false, "needs a price");
  assert.match(a.marketOrder({ sym: "EURUSD", side: "long", qty: 100000 }, 1.1).error, /margin/);
  assert.match(a.marketOrder({ sym: "EURUSD", side: "long", qty: 1000, sl: 1.2 }, 1.1).error, /Stop loss/);
  const o = a.marketOrder({ sym: "EURUSD", side: "long", qty: 1000, sl: 1.09, tp: 1.12 }, 1.1);
  assert.equal(o.ok, true);
  let s = a.snapshot(() => 1.105);
  assert.ok(Math.abs(s.balance - (1000 - 1.1)) < 1e-9, "entry commission 0.1% of 1100");
  assert.ok(Math.abs(s.upnl - 5) < 1e-9);
  assert.ok(Math.abs(s.usedMargin - 110) < 1e-9, "1100 notional / 10x");
  const closed = a.onPrice("EURUSD", 1.085);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].reason, "stop");
  assert.equal(closed[0].exit, 1.09, "fills at the stop level");
  s = a.snapshot(() => null);
  assert.equal(s.positions.length, 0);
  assert.ok(Math.abs(s.balance - (1000 - 10 - 1.1 - 1.09)) < 1e-9, "-10 loss and both commissions");
  const sh = a.marketOrder({ sym: "BTCUSDT", side: "short", qty: 0.01, tp: 90 }, 100);
  assert.equal(a.onPrice("BTCUSDT", 95).length, 0);
  assert.equal(a.close(sh.position.id, 95).closed.reason, "manual");
  assert.equal(a.snapshot(() => null).stats.trades, 2);
  a.reset({ balance: 5000, leverage: 2 });
  assert.deepEqual([a.snapshot(() => null).balance, a.snapshot(() => null).settings.leverage], [5000, 2]);
  const b = createPaperAccount({ state: a.serialize() });
  assert.equal(b.snapshot(() => null).balance, 5000, "serialize/restore");
});

await test("hub: guest paper order fills at the live price, SL fills on ticks, account frames sent, gone on close", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, ctx, state } = await makeHub(fakeNow);
  const nowSec = Math.floor(fakeNow / 1000);
  const ws = await connectAs(hub, state, null);
  await hub.webSocketMessage(ws, JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1m" } }));
  await hub.ensureUpstream();
  await hub.webSocketMessage(ws, JSON.stringify({ op: "paper", action: "order", sym: "GBPUSD", side: "long", qty: 1000 }));
  assert.equal(errors(ws).pop().code, "PAPER_REJECTED", "no live price yet");
  hub.ingestTick({ s: "GBPUSD", c: 1.27, t: nowSec + 1, v: 0, src: "twelvedata" });
  ws.sent.length = 0;
  await hub.webSocketMessage(ws, JSON.stringify({ op: "paper", action: "order", sym: "GBPUSD", side: "long", qty: 1000, sl: 1.26 }));
  let f = papers(ws).pop();
  assert.equal(validateServerFrame(f, { lastSeq: 0 }).ok, true);
  assert.equal(f.account.positions.length, 1);
  assert.equal(f.account.positions[0].entry, 1.27);
  const id = [...hub.paperAccounts.keys()][0];
  assert.ok(id.startsWith("c:"));
  assert.ok(hub.core.clients.get(id.slice(2)).syms.has("GBPUSD"), "position symbol subscribed");
  ws.sent.length = 0;
  hub.ingestTick({ s: "GBPUSD", c: 1.259, t: nowSec + 2, v: 0, src: "twelvedata" });
  await ctx.flushWaitUntil();
  f = papers(ws).pop();
  assert.equal(f.event.action, "stop");
  assert.equal(f.account.positions.length, 0);
  await hub.webSocketClose(ws);
  assert.equal(hub.paperAccounts.size, 0, "session account dropped");
  hub.destroy();
});

await test("hub: signed-in user's paper account persists, SL fills with no tab open, shared across that user's sockets", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, ctx, state } = await makeHub(fakeNow);
  const nowSec = Math.floor(fakeNow / 1000);
  let ws = await connectAs(hub, state, USER);
  await hub.ensureUpstream();
  hub.ingestTick({ s: "EURUSD", c: 1.1, t: nowSec + 1, v: 0, src: "twelvedata" });
  await hub.webSocketMessage(ws, JSON.stringify({ op: "paper", action: "reset", balance: 20000, leverage: 5 }));
  await hub.webSocketMessage(ws, JSON.stringify({ op: "paper", action: "order", sym: "EURUSD", side: "short", qty: 10000, tp: 1.09 }));
  assert.equal(hub.store.listUserPaper()[0].state.positions.length, 1, "persisted");
  await hub.webSocketClose(ws);
  assert.ok(hub.core.clients.get("__user_alerts__").syms.has("EURUSD"), "kept subscribed offline");
  hub.ingestTick({ s: "EURUSD", c: 1.089, t: nowSec + 2, v: 0, src: "twelvedata" });
  await ctx.flushWaitUntil();
  const st = hub.store.listUserPaper()[0].state;
  assert.equal(st.positions.length, 0, "take profit filled offline");
  assert.equal(st.history[0].reason, "target");
  ws = await connectAs(hub, state, USER);
  const ws2 = await connectAs(hub, state, USER);
  await hub.webSocketMessage(ws, JSON.stringify({ op: "paper", action: "get" }));
  const f1 = papers(ws).pop(), f2 = papers(ws2).pop();
  assert.ok(f1 && f2, "both sockets of the user get the account");
  assert.equal(f1.account.settings.balance, 20000);
  assert.ok(f1.account.balance > 20000, "profit realised");
  // restart: re-registered from SQLite
  hub.paperAccounts.clear();
  hub._loadUserPaper();
  assert.equal(hub.paperAccounts.get("u:" + USER).snapshot(() => null).history.length, 1);
  hub.destroy();
});

await test("protocol: paper op shape", () => {
  assert.equal(validateClientMessage(JSON.stringify({ op: "paper", action: "get" })).ok, true);
  assert.equal(validateClientMessage(JSON.stringify({ op: "paper", action: "nuke" })).ok, false);
  assert.equal(validateClientMessage(JSON.stringify({ op: "paper", action: "order", sym: "<x>" })).ok, false);
  assert.equal(validateClientMessage(JSON.stringify({ op: "paper", action: "close" })).ok, false);
});

if (failed > 0) process.exit(1);
console.log("PAPER OK");
