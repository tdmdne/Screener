// tests/hub-compare.test.mjs — E-04: a chart view's compare symbols (view.chart.cmp) are subscribed upstream and their
// live bars on the chart timeframe are fanned out as bar frames; protocol caps cmp at MAX_COMPARE_SYMBOLS.
// Run: node tests/hub-compare.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { validateServerFrame, validateClientMessage, MAX_COMPARE_SYMBOLS, MAX_LAYOUT_PANES } from "../shared/protocol.js";
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


await test("protocol accepts view.chart.cmp up to MAX_COMPARE_SYMBOLS valid symbols", () => {
  const ok = validateClientMessage(JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1H", cmp: ["GBPUSD", "XAUUSD"] } }));
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const many = validateClientMessage(JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1H", cmp: Array(MAX_COMPARE_SYMBOLS + 1).fill("GBPUSD") } }));
  assert.equal(many.ok, false);
  const bad = validateClientMessage(JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1H", cmp: ["<script>"] } }));
  assert.equal(bad.ok, false);
  const notArr = validateClientMessage(JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1H", cmp: "GBPUSD" } }));
  assert.equal(notArr.ok, false);
});

await test("compare symbols are subscribed and their chart-tf bars reach the viewer; other tfs/symbols do not", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, ctx, state } = await makeHub(fakeNow);
  const nowSec = Math.floor(fakeNow / 1000);
  const wsRes = await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  assert.equal(wsRes.status, 101);
  await hub.webSocketMessage(state.browser, JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1m", cmp: ["GBPUSD", "EURUSD"] } }));
  await hub.ensureUpstream();

  const id = [...hub.clientViews.keys()][0];
  const subs = hub._symbolsFromView(hub.clientViews.get(id));
  assert.ok(subs.includes("GBPUSD"), "compare symbol subscribed: " + subs);

  state.browser.sent.length = 0;
  hub.ingestTick({ s: "GBPUSD", c: 1.27, t: nowSec + 1, v: 0, src: "twelvedata" });
  hub.ingestTick({ s: "USDJPY", c: 150.1, t: nowSec + 1, v: 0, src: "twelvedata" });
  await ctx.flushWaitUntil();
  const bars = state.browser.sent.map((s) => JSON.parse(s)).filter((f) => f.type === "bar");
  const gbp = bars.filter((f) => f.sym === "GBPUSD");
  assert.ok(gbp.length >= 1, "GBPUSD bar frame sent");
  assert.ok(gbp.every((f) => f.tf === "1m"), "only the chart timeframe: " + gbp.map((f) => f.tf));
  assert.equal(validateServerFrame(gbp[0], { lastSeq: 0 }).ok, true);
  assert.equal(bars.filter((f) => f.sym === "USDJPY").length, 0, "non-compare symbol bars not sent");

  // dropping the compare symbol stops its bars
  await new Promise((r) => setTimeout(r, 0));
  hub.clientLastViewAt.clear();
  await hub.webSocketMessage(state.browser, JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1m" } }));
  state.browser.sent.length = 0;
  hub.ingestTick({ s: "GBPUSD", c: 1.271, t: nowSec + 2, v: 0, src: "twelvedata" });
  await ctx.flushWaitUntil();
  assert.equal(state.browser.sent.map((s) => JSON.parse(s)).filter((f) => f.type === "bar" && f.sym === "GBPUSD").length, 0, "no bars after compare removed");
  hub.destroy();
});

await test("protocol accepts view.chart.panes (E-05) up to MAX_LAYOUT_PANES {sym, tf}", () => {
  const ok = validateClientMessage(JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1H", panes: [{ sym: "GBPUSD", tf: "15m" }, { sym: "EURUSD", tf: "4H" }] } }));
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const many = validateClientMessage(JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1H", panes: Array(MAX_LAYOUT_PANES + 1).fill({ sym: "GBPUSD", tf: "1H" }) } }));
  assert.equal(many.ok, false);
  assert.equal(validateClientMessage(JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1H", panes: [{ sym: "GBPUSD", tf: "7x" }] } })).ok, false);
  assert.equal(validateClientMessage(JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1H", panes: ["GBPUSD"] } })).ok, false);
});

await test("layout panes get bars for their own symbol AND timeframe; same symbol on another tf works", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, ctx, state } = await makeHub(fakeNow);
  const nowSec = Math.floor(fakeNow / 1000);
  await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  await hub.webSocketMessage(state.browser, JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1m", panes: [{ sym: "GBPUSD", tf: "15m" }, { sym: "EURUSD", tf: "1H" }] } }));
  await hub.ensureUpstream();
  const id = [...hub.clientViews.keys()][0];
  assert.ok(hub._symbolsFromView(hub.clientViews.get(id)).includes("GBPUSD"));
  state.browser.sent.length = 0;
  hub.ingestTick({ s: "GBPUSD", c: 1.27, t: nowSec + 1, v: 0, src: "twelvedata" });
  hub.ingestTick({ s: "EURUSD", c: 1.09, t: nowSec + 1, v: 0, src: "twelvedata" });
  await ctx.flushWaitUntil();
  const keys = new Set(state.browser.sent.map((s) => JSON.parse(s)).filter((f) => f.type === "bar").map((f) => f.sym + "|" + f.tf));
  assert.ok(keys.has("GBPUSD|15m"), "pane GBPUSD 15m: " + [...keys]);
  assert.ok(keys.has("EURUSD|1H"), "pane EURUSD 1H");
  assert.ok(keys.has("EURUSD|1m"), "main chart");
  assert.ok(!keys.has("GBPUSD|1m") && !keys.has("GBPUSD|1H"), "no other GBPUSD timeframes: " + [...keys]);
  hub.destroy();
});

await test("a pane on a custom timeframe gets live bars", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, ctx, state } = await makeHub(fakeNow);
  const nowSec = Math.floor(fakeNow / 1000);
  await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  await hub.webSocketMessage(state.browser, JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "1H", panes: [{ sym: "GBPUSD", tf: "3m" }] } }));
  await hub.ensureUpstream();
  assert.ok(hub.candles.hasTimeframe("3m"), "custom pane timeframe registered");
  state.browser.sent.length = 0;
  hub.ingestTick({ s: "GBPUSD", c: 1.27, t: nowSec + 1, v: 0, src: "twelvedata" });
  await ctx.flushWaitUntil();
  assert.ok(state.browser.sent.map((s) => JSON.parse(s)).some((f) => f.type === "bar" && f.sym === "GBPUSD" && f.tf === "3m"));
  hub.destroy();
});

if (failed > 0) process.exit(1);
console.log("HUB COMPARE OK");
