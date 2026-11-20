// tests/binance-feed.test.mjs — shared/market/binanceFeed.js (Binance !miniTicker@arr client).
// Deterministic: fake clock + fake sockets, no network. Covers exponential backoff (and its cap + reset),
// Binance's mandatory 24 h disconnect (forced close AND proactive make-before-break rotation),
// `serverShutdown` events, the stall watchdog, symbol filtering and stop().
import assert from "node:assert/strict";
import {
  BINANCE_BACKOFF_MAX_MS,
  BINANCE_MINI_TICKER_URLS,
  BINANCE_ROTATE_MS,
  BINANCE_STALL_MS,
  BinanceMiniTickerFeed,
  FEED_STATE,
} from "../shared/market/binanceFeed.js";

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

const flush = () => new Promise((r) => setImmediate(r));

/** Manual clock: advance() fires due timers in order, including timers scheduled while advancing. */
function createClock() {
  let t = 1_000_000;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => t,
    setTimeoutFn(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: t + ms });
      return id;
    },
    clearTimeoutFn(id) {
      timers.delete(id);
    },
    pending: () => timers.size,
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        let nextId2 = null;
        let nextAt = Infinity;
        for (const [id, e] of timers) {
          if (e.at <= end && e.at < nextAt) {
            nextAt = e.at;
            nextId2 = id;
          }
        }
        if (nextId2 === null) break;
        const e = timers.get(nextId2);
        timers.delete(nextId2);
        t = Math.max(t, e.at);
        e.fn();
        await flush();
      }
      t = end;
      await flush();
    },
  };
}

class FakeWs {
  constructor(name) {
    this.name = name;
    this.closed = false;
    this.closeInfo = null;
    this._l = new Map();
  }
  addEventListener(type, fn) {
    if (!this._l.has(type)) this._l.set(type, []);
    this._l.get(type).push(fn);
  }
  emit(type, evt = {}) {
    for (const fn of this._l.get(type) || []) fn(evt);
  }
  send() {}
  close(code = 1000, reason = "") {
    if (this.closed) return;
    this.closed = true;
    this.closeInfo = { code, reason };
    this.emit("close", { code, reason });
  }
  push(payload) {
    this.emit("message", { data: typeof payload === "string" ? payload : JSON.stringify(payload) });
  }
}

const tick = (s, c, extra = {}) => ({ e: "24hrMiniTicker", E: 1, s, c: String(c), o: String(c - 1), h: String(c + 1), l: String(c - 2), v: "10", q: "1000", ...extra });

/** Build a feed wired to a scripted connector. `plan[i]` = "fail" | "ok" decides each connect() call. */
function harness(opts = {}) {
  const clock = createClock();
  const sockets = [];
  const states = [];
  const rows = [];
  let calls = 0;
  const plan = opts.plan || [];
  const feed = new BinanceMiniTickerFeed({
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    random: () => 0, // no jitter -> exact delays
    rotateMs: opts.rotateMs,
    stallMs: opts.stallMs,
    accept: opts.accept,
    connect: async () => {
      const mode = plan[calls] || "ok";
      calls += 1;
      if (mode === "fail") throw new Error("simulated connect failure");
      const ws = new FakeWs(`ws-${sockets.length + 1}`);
      sockets.push(ws);
      return ws;
    },
    onRows: (r) => rows.push(...r),
    onState: (s) => states.push(s.state),
  });
  return { clock, feed, sockets, states, rows, calls: () => calls };
}

await test("defaults: documented URLs, 24h rotation margin, 20s stall window", () => {
  assert.ok(BINANCE_MINI_TICKER_URLS.every((u) => u.endsWith("/ws/!miniTicker@arr")));
  assert.ok(BINANCE_ROTATE_MS < 24 * 3600_000, "must rotate BEFORE Binance's 24h forced disconnect");
  assert.ok(BINANCE_ROTATE_MS > 23 * 3600_000);
  assert.equal(BINANCE_STALL_MS, 20_000);
});

await test("start(): RECONNECTING until the first frame arrives, then LIVE; rows are filtered", async () => {
  const h = harness();
  h.feed.start();
  assert.deepEqual(h.states, [FEED_STATE.RECONNECTING]);
  await flush();
  assert.equal(h.sockets.length, 1);
  assert.deepEqual(h.states, [FEED_STATE.RECONNECTING], "an open socket with no data is not LIVE yet");
  h.sockets[0].push([
    tick("BTCUSDT", 100),
    tick("USDCUSDT", 1), // stablecoin pair
    tick("ETHBTC", 0.05), // not USDT
    tick("ETHUSDT", 0), // non-positive price
    tick("SOLUSDT", 50),
  ]);
  assert.deepEqual(h.states, [FEED_STATE.RECONNECTING, FEED_STATE.LIVE]);
  assert.deepEqual(h.rows.map((r) => r.s), ["BTCUSDT", "SOLUSDT"]);
  assert.equal(h.rows[0].c, 100);
  h.sockets[0].push("not json {{{"); // garbage is ignored, never throws
  h.sockets[0].push({ result: null, id: 1 });
  assert.equal(h.rows.length, 2);
  h.feed.stop();
});

await test("custom accept() limits rows to the symbols the hub wants", async () => {
  const h = harness({ accept: (s) => s === "BTCUSDT" });
  h.feed.start();
  await flush();
  h.sockets[0].push([tick("BTCUSDT", 100), tick("ETHUSDT", 5)]);
  assert.deepEqual(h.rows.map((r) => r.s), ["BTCUSDT"]);
  h.feed.stop();
});

await test("Binance 24h forced disconnect: close -> RECONNECTING -> automatic reconnect -> LIVE", async () => {
  const h = harness();
  h.feed.start();
  await flush();
  h.sockets[0].push([tick("BTCUSDT", 100)]);
  assert.equal(h.feed.state, FEED_STATE.LIVE);

  h.sockets[0].close(1006, "forced by server after 24h");
  assert.equal(h.feed.state, FEED_STATE.RECONNECTING);
  assert.equal(h.feed.snapshot().nextRetryMs, 1000);
  await h.clock.advance(1000);
  assert.equal(h.sockets.length, 2, "reconnected without any caller action");
  h.sockets[1].push([tick("BTCUSDT", 101)]);
  assert.equal(h.feed.state, FEED_STATE.LIVE);
  assert.equal(h.rows.at(-1).c, 101);
  h.feed.stop();
});

await test("exponential backoff 1s,2s,4s,8s... capped at 60s, jitter-free here", async () => {
  const h = harness({ plan: ["fail", "fail", "fail", "fail", "fail", "fail", "fail", "fail", "fail"] });
  h.feed.start();
  await flush();
  const seen = [];
  for (let i = 0; i < 8; i += 1) {
    seen.push(h.feed.snapshot().nextRetryMs);
    await h.clock.advance(h.feed.snapshot().nextRetryMs);
  }
  assert.deepEqual(seen, [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  assert.ok(seen.every((d) => d <= BINANCE_BACKOFF_MAX_MS));
  assert.equal(h.feed.state, FEED_STATE.RECONNECTING);
  h.feed.stop();
});

await test("backoff resets only after real data, not on a bare open", async () => {
  const h = harness({ plan: ["fail", "fail", "ok", "ok"] });
  h.feed.start();
  await flush(); // call 1 fails -> retry in 1s
  await h.clock.advance(1000); // call 2 fails -> retry in 2s
  assert.equal(h.feed.snapshot().nextRetryMs, 2000);
  await h.clock.advance(2000); // call 3 ok, socket opens but is silent
  h.sockets[0].close(1006, "dropped before any data");
  assert.equal(h.feed.snapshot().nextRetryMs, 4000, "silent open does not reset the counter");
  await h.clock.advance(4000); // call 4 ok
  h.sockets[1].push([tick("BTCUSDT", 100)]); // data -> healthy -> reset
  h.sockets[1].close(1006, "later drop");
  assert.equal(h.feed.snapshot().nextRetryMs, 1000, "after real data the next retry starts from 1s again");
  h.feed.stop();
});

await test("proactive 24h rotation is make-before-break: no gap, no RECONNECTING, old socket retired after the new delivers", async () => {
  const h = harness({ rotateMs: 10_000 });
  h.feed.start();
  await flush();
  h.sockets[0].push([tick("BTCUSDT", 100)]);
  const statesBefore = [...h.states];
  await h.clock.advance(10_000);
  assert.equal(h.sockets.length, 2, "replacement opened before the old one is closed");
  assert.equal(h.sockets[0].closed, false, "old socket still serving until the new one delivers");
  h.sockets[0].push([tick("BTCUSDT", 101)]); // still flows from the old socket during the handover
  assert.equal(h.rows.at(-1).c, 101);
  h.sockets[1].push([tick("BTCUSDT", 102)]);
  assert.equal(h.sockets[0].closed, true, "old socket retired once the replacement delivered");
  assert.equal(h.sockets[0].closeInfo.reason, "rotated");
  assert.equal(h.rows.at(-1).c, 102);
  assert.deepEqual(h.states, statesBefore, "state never left LIVE during rotation");
  assert.equal(h.feed.snapshot().rotations, 1);
  // old socket's close event must not trigger a reconnect storm
  await h.clock.advance(5_000);
  assert.equal(h.sockets.length, 2);
  h.feed.stop();
});

await test("rotation connect failure keeps the old socket live and retries", async () => {
  const h = harness({ rotateMs: 10_000, plan: ["ok", "fail", "ok"] });
  h.feed.start();
  await flush();
  h.sockets[0].push([tick("BTCUSDT", 100)]);
  await h.clock.advance(10_000); // rotation attempt fails
  assert.equal(h.sockets[0].closed, false);
  assert.equal(h.feed.state, FEED_STATE.LIVE);
  await h.clock.advance(1_000); // retry succeeds
  assert.equal(h.sockets.length, 2);
  h.sockets[1].push([tick("BTCUSDT", 105)]);
  assert.equal(h.sockets[0].closed, true);
  h.feed.stop();
});

await test("serverShutdown event: moves to a fresh connection immediately, no backoff penalty, stays LIVE", async () => {
  const h = harness();
  h.feed.start();
  await flush();
  h.sockets[0].push([tick("BTCUSDT", 100)]);
  h.sockets[0].push({ e: "serverShutdown", E: 1700000000000 });
  await flush();
  assert.equal(h.sockets.length, 2);
  h.sockets[1].push([tick("BTCUSDT", 103)]);
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.feed.state, FEED_STATE.LIVE);
  assert.equal(h.feed.snapshot().attempt, 0);
  assert.ok(!h.states.slice(2).includes(FEED_STATE.RECONNECTING), "no RECONNECTING flash for a planned handover");
  h.feed.stop();
});

await test("stall watchdog: >20s of silence forces a reconnect; check() does the same on demand", async () => {
  const h = harness();
  h.feed.start();
  await flush();
  h.sockets[0].push([tick("BTCUSDT", 100)]);
  await h.clock.advance(BINANCE_STALL_MS + 6_000); // internal watchdog fires
  assert.equal(h.sockets[0].closed, true, "stalled socket was dropped");
  assert.equal(h.feed.state, FEED_STATE.RECONNECTING);
  await h.clock.advance(1_000);
  assert.equal(h.sockets.length, 2);
  h.sockets[1].push([tick("BTCUSDT", 100)]);
  assert.equal(h.feed.state, FEED_STATE.LIVE);

  // DO alarm path: check() alone catches a stall without the internal timer
  const h2 = harness();
  h2.feed.start();
  await flush();
  h2.sockets[0].push([tick("BTCUSDT", 100)]);
  await h2.clock.advance(BINANCE_STALL_MS + 1); // watchdog also runs here; ensure idempotent
  h2.feed.check();
  assert.equal(h2.feed.state, FEED_STATE.RECONNECTING);
  h.feed.stop();
  h2.feed.stop();
});

await test("initial connect failure: RECONNECTING, then self-heals", async () => {
  const h = harness({ plan: ["fail"] });
  h.feed.start();
  await flush();
  assert.equal(h.feed.state, FEED_STATE.RECONNECTING);
  assert.equal(h.feed.snapshot().nextRetryMs, 1000);
  await h.clock.advance(1000);
  assert.equal(h.sockets.length, 1);
  h.sockets[0].push([tick("BTCUSDT", 1)]);
  assert.equal(h.feed.state, FEED_STATE.LIVE);
  h.feed.stop();
});

await test("stop(): closes the socket, cancels every timer, never reconnects", async () => {
  const h = harness({ rotateMs: 10_000 });
  h.feed.start();
  await flush();
  h.sockets[0].push([tick("BTCUSDT", 100)]);
  h.feed.stop();
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.clock.pending(), 0, "no timers left behind");
  await h.clock.advance(3_600_000);
  assert.equal(h.sockets.length, 1);
  assert.equal(h.feed.state, null);
});

console.log(`binance-feed.test.mjs: ${passed} passed, ${failed} failed`);
