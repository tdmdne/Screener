// tests/td-ws-ingestion.test.mjs — Twelve Data outbound WebSocket ingestion (backend only).
// - MarketHub keeps ONE persistent outbound WS to wss://ws.twelvedata.com/v1/quotes/price while a key is configured
//   (even with zero symbols), with subscribe/unsubscribe, 10 s heartbeat, backoff reconnect.
// - Twelve Data auth/limit error frames close the socket and back off (never hammer, never stay "healthy").
// - GET /api/quotes serves the WS-fed latest prices (the backend cache) so worker.js never needs REST /quote for live prices.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { MarketHub } from "../workers/market/hub.js";

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log("PASS", name); } catch (err) { failed += 1; console.error("FAIL", name, "-", err && err.stack ? err.stack : err); process.exitCode = 1; }
}

function createSql() {
  const db = new DatabaseSync(":memory:");
  return {
    exec(query, ...b) {
      const stmt = db.prepare(query);
      const up = query.trim().toUpperCase();
      if (up.startsWith("SELECT") || up.startsWith("PRAGMA")) {
        const rows = stmt.all(...b).map((r) => ({ ...r }));
        return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() };
      }
      stmt.run(...b);
      return { toArray: () => [], one: () => undefined, [Symbol.iterator]: () => [][Symbol.iterator]() };
    },
  };
}

class FakeWs {
  constructor() { this.readyState = 1; this.sent = []; this.closed = false; this.l = new Map(); this._att = null; }
  addEventListener(t, f) { if (!this.l.has(t)) this.l.set(t, []); this.l.get(t).push(f); }
  emit(t, e = {}) { for (const f of this.l.get(t) || []) f(e); }
  send(d) { if (this.closed) throw new Error("closed"); this.sent.push(String(d)); }
  close(code = 1000, reason = "") { if (this.closed) return; this.closed = true; this.readyState = 3; this.emit("close", { code, reason }); }
  accept() {}
  serializeAttachment(o) { this._att = JSON.parse(JSON.stringify(o)); }
  deserializeAttachment() { return this._att ? JSON.parse(JSON.stringify(this._att)) : null; }
}

function timers() {
  let id = 1; const iv = new Map(); const to = new Map();
  return {
    iv, to,
    setTimer: (fn, ms) => { iv.set(id, { fn, ms }); return id++; },
    clearTimer: (h) => iv.delete(h),
    setTimeout: (fn, ms) => { to.set(id, { fn, ms }); return id++; },
    clearTimeout: (h) => to.delete(h),
    tick(ms) { for (const e of [...iv.values()]) if (e.ms === ms) e.fn(); },
    fire() { const l = [...to.values()]; to.clear(); for (const e of l) e.fn(); },
  };
}

function makeHub(env = {}) {
  let now = Date.UTC(2026, 10, 20, 10, 0, 0);
  const sql = createSql();
  const waits = [];
  const ctx = {
    storage: { sql, async setAlarm() {} },
    acceptWebSocket() {}, getWebSockets: () => [], setWebSocketAutoResponse() {},
    blockConcurrencyWhile: (fn) => Promise.resolve().then(fn),
    waitUntil: (p) => waits.push(Promise.resolve(p)),
  };
  const t = timers();
  const opened = [];
  let failOpens = 0;
  const hub = new MarketHub(ctx, { TWELVEDATA_KEY: "TD_SECRET_KEY", ...env }, {
    now: () => now, jitter: false,
    setTimer: t.setTimer, clearTimer: t.clearTimer, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout,
    openUpstreamWs: async (url, init) => {
      if (failOpens > 0) { failOpens -= 1; throw new Error("outage"); }
      const ws = new FakeWs(); opened.push({ url, init, ws }); return ws;
    },
  });
  return { hub, t, opened, advance: (ms) => { now += ms; }, failOpens: (n) => { failOpens = n; }, flush: async () => { while (waits.length) await Promise.all(waits.splice(0)); } };
}

await test("persistent: connects with zero symbols, heartbeats, subscribes + unsubscribes on the SAME socket", async () => {
  const h = makeHub(); await h.hub.ready();
  await h.hub.ensureUpstream();
  assert.equal(h.opened.length, 1, "one outbound WS even with no symbols");
  assert.equal(h.opened[0].init.headers["X-TD-APIKEY"], "TD_SECRET_KEY");
  h.t.tick(10_000);
  assert.ok(h.opened[0].ws.sent.some((s) => JSON.parse(s).action === "heartbeat"), "10 s heartbeat");
  h.hub.subscribeUpstream(["EURUSD"]); await h.hub.ensureUpstream();
  assert.equal(h.opened.length, 1);
  assert.ok(h.opened[0].ws.sent.some((s) => { const j = JSON.parse(s); return j.action === "subscribe" && j.params.symbols.includes("EUR/USD"); }));
  h.hub.unsubscribeUpstream(["EURUSD"]);
  assert.ok(h.opened[0].ws.sent.some((s) => JSON.parse(s).action === "unsubscribe"));
  assert.equal(h.opened[0].ws.closed, false, "socket stays up when the last symbol is removed");
});

await test("persistent: TD_WS_KEEPALIVE=0 restores demand-driven connect", async () => {
  const h = makeHub({ TD_WS_KEEPALIVE: "0" }); await h.hub.ready();
  await h.hub.ensureUpstream();
  assert.equal(h.opened.length, 0);
});

await test("persistent: no key -> never opens", async () => {
  const h = makeHub({ TWELVEDATA_KEY: "" }); await h.hub.ready();
  await h.hub.ensureUpstream();
  assert.equal(h.opened.length, 0);
});

await test("reconnect: dropped idle socket reconnects with exponential backoff and resubscribes", async () => {
  const h = makeHub(); await h.hub.ready();
  h.hub.subscribeUpstream(["AAPL"]); await h.hub.ensureUpstream();
  h.opened[0].ws.close(1006, "drop");
  assert.equal(h.t.to.size, 1, "reconnect timer scheduled");
  assert.equal([...h.t.to.values()][0].ms, 1000);
  h.failOpens(1); h.advance(1000); h.t.fire(); await h.flush(); await new Promise((r) => setImmediate(r));
  assert.equal([...h.t.to.values()][0].ms, 2000, "backoff doubles after a failed attempt");
  h.advance(2000); h.t.fire(); await new Promise((r) => setImmediate(r));
  assert.equal(h.opened.length, 2);
  assert.ok(h.opened[1].ws.sent.some((s) => JSON.parse(s).params?.symbols === "AAPL"), "resubscribed after reconnect");
});

await test("auth/limit error frames close the socket and back off instead of staying 'healthy'", async () => {
  for (const frame of [
    { code: 401, message: "**apikey** parameter is incorrect", status: "error" },
    { code: 429, message: "You have reached the WebSocket connection limit", status: "error" },
  ]) {
    const h = makeHub(); await h.hub.ready();
    await h.hub.ensureUpstream();
    h.opened[0].ws.emit("message", { data: JSON.stringify(frame) });
    assert.equal(h.opened[0].ws.closed, true, "socket closed on " + frame.code);
    assert.equal(h.t.to.size, 1, "backoff reconnect scheduled");
    assert.ok([...h.t.to.values()][0].ms >= 1000);
  }
});

await test("GET /api/quotes serves WS-fed prices (latest tick), omits unknown symbols, leaks no key", async () => {
  const h = makeHub(); await h.hub.ready();
  h.hub.subscribeUpstream(["EURUSD", "AAPL"]); await h.hub.ensureUpstream();
  const ts = Math.floor(Date.UTC(2026, 10, 20, 10, 0, 1) / 1000);
  h.opened[0].ws.emit("message", { data: JSON.stringify({ event: "price", symbol: "EUR/USD", price: 1.0612, timestamp: ts }) });
  h.opened[0].ws.emit("message", { data: JSON.stringify({ event: "price", symbol: "AAPL", price: 225.5, timestamp: ts, day_volume: 100 }) });
  const res = await h.hub.fetch(new Request("https://market-service/api/quotes?symbols=EURUSD,AAPL,NOPE"));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.quotes.EURUSD.c, 1.0612);
  assert.equal(j.quotes.AAPL.c, 225.5);
  assert.equal(j.quotes.NOPE, undefined);
  assert.equal(j.quotes.EURUSD.src, "twelvedata");
  assert.ok(!JSON.stringify(j).includes("TD_SECRET_KEY"));
});

if (failed > 0) process.exit(1);
console.log("TD WS INGESTION OK");
