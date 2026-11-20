// tests/hub-custom-tf.test.mjs — MarketHub custom-timeframe support: `/api/bars` derives 3m/45m/2H/3M ... from native
// bars (+ the live forming bar), `1M` is built live, and a client viewing a custom timeframe receives live bar frames
// that start from the REAL forming bucket (no partial first bar, no gap).
// Run: node tests/hub-custom-tf.test.mjs
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { validateServerFrame } from "../shared/protocol.js";
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

const mk = (t, i) => ({ t, o: 1.08 + i * 0.0001, h: 1.081 + i * 0.0001, l: 1.079 + i * 0.0001, c: 1.0805 + i * 0.0001, v: 100 });

await test("/api/bars?tf=3m is resampled in the backend from stored 1m bars plus the live forming bar", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, ctx } = await makeHub(fakeNow);
  const nowSec = Math.floor(fakeNow / 1000);
  const start = Math.floor(nowSec / 180) * 180 - 90 * 60;
  const bars1m = Array.from({ length: 90 }, (_, i) => mk(start + i * 60, i));
  hub.store.upsertBars("EURUSD", "1m", bars1m);

  hub.subscribeUpstream(["EURUSD"]);
  await hub.ensureUpstream();
  const t0 = bucketStart(nowSec, "1m");
  hub.ingestTick({ s: "EURUSD", c: 1.0999, t: nowSec, v: 0, src: "twelvedata" });
  await ctx.flushWaitUntil();

  const res = await hub.fetch(new Request("https://market-hub/api/bars?sym=EURUSD&tf=3m&limit=100"));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.tf, "3m");
  assert.ok(j.bars.length >= 29, `derived ${j.bars.length} 3m bars`);
  for (const b of j.bars) assert.equal(b.t % 180, 0);
  for (let i = 1; i < j.bars.length; i++) assert.ok(j.bars[i].t > j.bars[i - 1].t);
  const last = j.bars.at(-1);
  assert.equal(last.t, bucketStart(nowSec, "3m"));
  assert.equal(last.c, 1.0999, "forming 3m bar follows the live tick");
  const first = j.bars.find((b) => b.t === bucketStart(start + 3 * 60, "3m"));
  assert.equal(first.o, bars1m.find((b) => b.t === first.t).o);
  assert.equal(first.v, 300);
  void t0;
  hub.destroy();
});

await test("/api/bars?tf=2H and tf=3M derive from 1H / 1M bases; unsupported tf is a 400", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub } = await makeHub(fakeNow);
  const hourStart = Math.floor(fakeNow / 1000 / 3600) * 3600 - 40 * 3600;
  hub.store.upsertBars("EURUSD", "1H", Array.from({ length: 40 }, (_, i) => mk(hourStart + i * 3600, i)));
  const monthly = [];
  for (let m = 0; m < 12; m++) monthly.push(mk(Math.floor(Date.UTC(2026, m, 1) / 1000), m));
  hub.store.upsertBars("EURUSD", "1M", monthly);

  const h2 = await (await hub.fetch(new Request("https://market-hub/api/bars?sym=EURUSD&tf=2H&limit=50"))).json();
  assert.equal(h2.ok, true);
  assert.ok(h2.bars.length >= 19 && h2.bars.length <= 21);
  for (const b of h2.bars) assert.equal(b.t % 7200, 0);

  const q = await (await hub.fetch(new Request("https://market-hub/api/bars?sym=EURUSD&tf=3M&limit=10"))).json();
  assert.equal(q.ok, true);
  assert.deepEqual(q.bars.map((b) => new Date(b.t * 1000).getUTCMonth()), [0, 3, 6, 9]);
  assert.equal(q.bars[0].v, 300);

  const bad = await hub.fetch(new Request("https://market-hub/api/bars?sym=EURUSD&tf=30s"));
  assert.equal(bad.status, 400);
  hub.destroy();
});

await test("1M (month) candles are built live alongside the other native timeframes", async () => {
  const fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub } = await makeHub(fakeNow);
  hub.subscribeUpstream(["EURUSD"]);
  await hub.ensureUpstream();
  hub.ingestTick({ s: "EURUSD", c: 1.09, t: Math.floor(fakeNow / 1000), v: 0, src: "twelvedata" });
  const cur = hub.candles.getCurrent("EURUSD", "1M");
  assert.ok(cur, "1M forming bar exists");
  assert.equal(cur.t, Math.floor(Date.UTC(2026, 10, 1) / 1000));
  hub.destroy();
});

await test("a client viewing a custom timeframe gets live bar frames seeded from the real forming bucket", async () => {
  let fakeNow = Date.UTC(2026, 10, 18, 10, 17, 30);
  const { hub, ctx, state } = await makeHub(fakeNow);
  const nowSec = Math.floor(fakeNow / 1000);
  const start = Math.floor(nowSec / 180) * 180 - 60 * 60;
  // 1m history already contains the first two minutes of the current 3m bucket (high 1.2 inside it)
  const cur3 = bucketStart(nowSec, "3m");
  const bars1m = [];
  for (let t = start; t < cur3 + 120; t += 60) bars1m.push(mk(t, 0));
  bars1m[bars1m.length - 1] = { t: cur3 + 60, o: 1.09, h: 1.2, l: 1.08, c: 1.1, v: 50 };
  hub.store.upsertBars("EURUSD", "1m", bars1m);

  const wsRes = await hub.fetch(new Request("https://market-hub/ws", { headers: { Upgrade: "websocket" } }));
  assert.equal(wsRes.status, 101);
  await hub.webSocketMessage(state.browser, JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "3m" } }));
  await hub.ensureUpstream();

  const stateFrame = state.browser.sent.map((s) => JSON.parse(s)).find((f) => f.type === "state");
  assert.ok(stateFrame, "state frame sent for a custom timeframe view");
  assert.equal(stateFrame.chart.tf, "3m");
  assert.ok(stateFrame.chart.bars.length > 10);
  assert.equal(validateServerFrame(stateFrame, { lastSeq: 1 }).ok, true);

  hub.core.addClient; // (client already registered by the ws upgrade)
  hub.ingestTick({ s: "EURUSD", c: 1.15, t: nowSec + 5, v: 0, src: "twelvedata" });
  await ctx.flushWaitUntil();
  const bar = state.browser.sent.map((s) => JSON.parse(s)).filter((f) => f.type === "bar" && f.tf === "3m").at(-1);
  assert.ok(bar, "3m bar frame emitted to the custom-timeframe viewer");
  assert.equal(validateServerFrame(bar, { lastSeq: 0 }).ok, true);
  const [t, o, h, l, c] = bar.bar;
  assert.equal(t, cur3);
  assert.equal(h, 1.2, "forming 3m high keeps the minutes that happened before the view opened");
  assert.equal(c, 1.15);
  assert.ok(o > 0);
  hub.destroy();
});

if (failed > 0) process.exit(1);
console.log("HUB CUSTOM TF OK");
