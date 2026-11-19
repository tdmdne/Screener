import assert from "node:assert/strict";
import { normalizeTick, normalizeBar, cleanBars, createTickGuard, assetClass, toTwelveSymbol } from "../shared/schema.js";
import { MemoryCache } from "../worker/cache.js";
import { HubCore } from "../worker/hubCore.js";
import { TickRing, createFlusher } from "../client/services/tickBuffer.js";
import { createDataService } from "../client/services/dataService.js";
import worker from "../worker/index.js";
let n = 0; const ok = (name, f) => Promise.resolve(f()).then(() => console.log("PASS", name), (e) => { console.log("FAIL", name, e.message); process.exitCode = 1; }).then(() => n++);

await ok("symbol classes + mapping", () => {
  assert.equal(assetClass("EURUSD"), "FX"); assert.equal(assetClass("BTCUSDT"), "CRY"); assert.equal(assetClass("AAPL"), "STK");
  assert.equal(toTwelveSymbol("EURUSD"), "EUR/USD");
});
await ok("normalizeTick rejects zero/NaN/neg/bid>ask, accepts strings + seconds", () => {
  for (const bad of [{ s: "EURUSD", c: 0 }, { s: "EURUSD", c: NaN }, { s: "EURUSD", c: -1 }, { s: "", c: 1 }, { s: "EURUSD", c: 1.1, bid: 1.2, ask: 1.1 }, { s: "EURUSD", c: 1.1, bid: 0 }, null])
    assert.equal(normalizeTick(bad), null);
  const t = normalizeTick({ symbol: "eur/usd", price: "1.0850", timestamp: 1700000000 });
  assert.equal(t.s, "EURUSD"); assert.equal(t.c, 1.085); assert.equal(t.t, 1700000000000);
});
await ok("normalizeBar repairs wicks, drops garbage, cleanBars sorts+dedupes", () => {
  assert.deepEqual(normalizeBar([1700000000, 1, 0.9, 1.2, 1.1, 5]), { t: 1700000000, o: 1, h: 1.1, l: 1, c: 1.1, v: 5 });
  assert.equal(normalizeBar([1, 0, 1, 1, 1]), null);
  assert.equal(normalizeBar([0, 1, 1, 1, 1]), null);
  assert.equal(normalizeBar([-100, 1, 1, 1, 1]), null);
  const b = cleanBars([[200, 1, 1, 1, 1], [100, 1, 1, 1, 1], [100, 2, 2, 2, 2], [300, 0, 0, 0, 0]]);
  assert.deepEqual(b.map((x) => [x.t, x.o]), [[100, 2], [200, 1]]);
});
await ok("tick guard DROPS 3.87% GBPUSD spike, accepts 0.05% move, accepts a real gap after 4 agreeing ticks", () => {
  const g = createTickGuard();
  assert.ok(g({ s: "GBPUSD", c: 1.3200 }));
  assert.equal(g({ s: "GBPUSD", c: 1.2690 }), null);           // -3.87%
  assert.ok(g({ s: "GBPUSD", c: 1.3207 }));                    // normal
  assert.equal(g({ s: "GBPUSD", c: 1.2690 }), null);           // quarantined: not clamped, not accepted
  g({ s: "GBPUSD", c: 1.2691 }); g({ s: "GBPUSD", c: 1.2690 });
  assert.ok(g({ s: "GBPUSD", c: 1.2691 }));                    // 4th agreeing tick => genuine gap
  const s = createTickGuard(); s({ s: "BTCUSDT", c: 100 });
  assert.ok(s({ s: "BTCUSDT", c: 103 })); assert.equal(s({ s: "BTCUSDT", c: 120 }), null);
});
await ok("cache: HIT, in-flight dedupe, STALE on error, throws when nothing cached", async () => {
  const c = new MemoryCache(); let calls = 0;
  const load = () => { calls++; return new Promise((r) => setTimeout(() => r("v"), 10)); };
  const [a, b] = await Promise.all([c.wrap("k", 20, load), c.wrap("k", 20, load)]);
  assert.equal(calls, 1); assert.equal(a.state, "MISS"); assert.equal(b.value, "v");
  assert.equal((await c.wrap("k", 20, load)).state, "HIT");
  await new Promise((r) => setTimeout(r, 30));
  const s = await c.wrap("k", 20, () => Promise.reject(new Error("502")));
  assert.equal(s.state, "STALE"); assert.equal(s.value, "v");
  await assert.rejects(c.wrap("none", 20, () => Promise.reject(new Error("x"))));
});
await ok("hub: refcounted upstream subs, coalescing, fan-out per client, replay, guard drops spikes", () => {
  const up = { sub: [], unsub: [], subscribe(s) { this.sub.push(...s); }, unsubscribe(s) { this.unsub.push(...s); } };
  const hub = new HubCore(up, { setTimer: () => 1, clearTimer: () => {} });
  const A = [], B = [];
  hub.addClient("a", (m) => A.push(JSON.parse(m))); hub.addClient("b", (m) => B.push(JSON.parse(m)));
  hub.subscribe("a", ["EURUSD", "BTCUSDT"]); hub.subscribe("b", ["EURUSD"]);
  assert.deepEqual(up.sub, ["EURUSD", "BTCUSDT"]);            // EURUSD subscribed upstream ONCE for two clients
  hub.onTick({ s: "EURUSD", c: 1.08 }); hub.onTick({ s: "EURUSD", c: 1.0801 }); hub.onTick({ s: "EURUSD", c: 1.0 }); // last = spike
  assert.equal(hub.stats.dropped, 1);
  hub.flush();
  assert.equal(A.length, 1); assert.equal(A[0].d.length, 1); assert.equal(A[0].d[0].c, 1.0801);  // coalesced to newest
  assert.equal(B[0].d[0].c, 1.0801);
  hub.onTick({ s: "BTCUSDT", c: 50000 }); hub.flush();
  assert.equal(B.length, 1);                                   // b isn't subscribed to BTC
  hub.addClient("c", (m) => A.push(JSON.parse(m))); hub.subscribe("c", ["EURUSD"]);
  assert.equal(A.at(-1).d[0].c, 1.0801);                       // replay last tick on subscribe
  hub.unsubscribe("a", ["EURUSD"]); assert.deepEqual(up.unsub, []);   // still referenced by b, c
  hub.removeClient("b"); hub.removeClient("c"); assert.deepEqual(up.unsub, ["EURUSD"]);
  hub.removeClient("a"); assert.ok(up.unsub.includes("BTCUSDT"));
});
await ok("ring buffer: overflow drops oldest; flusher coalesces 10k ticks into ONE frame callback", () => {
  const r = new TickRing(4); for (let i = 1; i <= 6; i++) r.push({ s: "X", c: i });
  assert.deepEqual(r.drain().map((t) => t.c), [3, 4, 5, 6]); assert.equal(r.overflow, 2);
  const ring = new TickRing(4096); let frames = [], cb = null, flushes = 0, last;
  const f = createFlusher(ring, (latest) => { flushes++; last = latest; }, { raf: (fn) => { cb = fn; return 1; }, caf: () => {} });
  for (let i = 0; i < 10000; i++) { ring.push({ s: i % 2 ? "A" : "B", c: i + 1 }); f.schedule(); }
  assert.equal(flushes, 0); cb(); assert.equal(flushes, 1); assert.equal(last.A.c, 10000); assert.equal(last.B.c, 9999);
});
await ok("dataService: only talks to configured proxy; stale fallback; WS sub replay + ring flush", async () => {
  const urls = []; let bad = false;
  const fetchStub = async (u) => { urls.push(u); if (bad) throw new Error("net"); return { ok: true, json: async () => ({ bars: [[100, 1, 1, 1, 1, 1]], cache: "MISS" }) }; };
  class FakeWS { static last; constructor(u) { urls.push(u); FakeWS.last = this; this.readyState = 0; this.sent = []; setTimeout(() => { this.readyState = 1; this.onopen(); }, 0); } send(m) { this.sent.push(JSON.parse(m)); } close() {} }
  let cb, got;
  const svc = createDataService({ baseUrl: "https://proxy.example", WebSocket: FakeWS, fetch: fetchStub, raf: (f) => { cb = f; return 1; }, caf() {} });
  svc.onTicks((l) => { got = l; });
  svc.subscribe(["eurusd"]);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(svc.status, "live"); assert.deepEqual(FakeWS.last.sent[0], { op: "sub", symbols: ["EURUSD"] });
  FakeWS.last.onmessage({ data: JSON.stringify({ type: "ticks", d: [{ s: "EURUSD", c: 1.1, t: Date.now() }, { s: "EURUSD", c: 0, t: 1 }] }) });
  cb(); assert.equal(got.EURUSD.c, 1.1);
  const ok1 = await svc.getCandles("EURUSD", "1m"); assert.equal(ok1.bars.length, 1);
  bad = true; const st = await svc.getCandles("EURUSD", "1m"); assert.equal(st.stale, true); assert.equal(st.bars.length, 1);
  assert.ok(urls.every((u) => u.startsWith("https://proxy.example") || u.startsWith("wss://proxy.example")), urls.join());
  svc.close();
});
await ok("worker router: CORS preflight, health hides key, bad input 400, candles 503 JSON (not HTML) w/o cache, origin lock", async () => {
  const env = { ALLOWED_ORIGINS: "https://app.example.com,*.pages.dev", TWELVEDATA_KEY: "SECRETVALUE" };
  let r = await worker.fetch(new Request("https://w/api/health", { method: "OPTIONS", headers: { Origin: "https://app.example.com" } }), env);
  assert.equal(r.status, 204); assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://app.example.com");
  r = await worker.fetch(new Request("https://w/api/health", { headers: { Origin: "https://screener-cso.pages.dev" } }), env);
  const txt = await r.text(); assert.ok(!txt.includes("SECRETVALUE")); assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://screener-cso.pages.dev");
  r = await worker.fetch(new Request("https://w/api/health", { headers: { Origin: "https://evil.example" } }), env);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal((await worker.fetch(new Request("https://w/api/candles?symbol=EURUSD&tf=7m"), {})).status, 400);
  const real = globalThis.fetch; globalThis.fetch = async () => { throw new Error("timeout"); };
  r = await worker.fetch(new Request("https://w/api/candles?symbol=EURUSD&tf=1m"), { TWELVEDATA_KEY: "k" });
  globalThis.fetch = real;
  assert.equal(r.status, 503); assert.match(r.headers.get("content-type"), /json/); assert.deepEqual((await r.json()).bars, []);
});
console.log(`\n${n} checks run`);
