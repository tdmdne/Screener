// tests/single-feed-history.test.mjs — every asset's history (live chart and backtest replay) comes from ONE feed:
// Twelve Data for FX / stocks / ETFs / metals / indices, Binance for crypto, Yahoo for futures and assets TD does
// not carry. Root cause under test (prod, 20 Nov): Twelve Data answered 429 and worker.js fell back to Yahoo, so
// EURUSD history was Yahoo while its live bars were Twelve Data; FX replay used Dukascopy.
// Run: node tests/single-feed-history.test.mjs

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { bucketStart } from "../shared/market/candles.js";
import { resolveInterval } from "../shared/intervals.js";
import { assetFeed, tdSymbolFor, isTdSymbolUnsupported } from "../shared/market/feedRouting.js";

const NOW = Math.floor(Date.now() / 1000);
const SECRET = "itest-internal-td-secret";

const store = new Map();
globalThis.caches = {
  default: {
    async match(req) { const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { store.set(req.url, res); },
  },
};

const TD_KEY_OF = { "1min": "1m", "5min": "5m", "15min": "15m", "30min": "30m", "1h": "1H", "4h": "4H", "1day": "1D" };
const world = { tdMode: "ok", hub: new Map() };
const calls = { td: [], yahoo: [], duka: 0, binance: 0 };
const fxPx = (t) => 1.08 + (t % 997) / 100000;

globalThis.fetch = async (input) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname === "api.twelvedata.com" && u.pathname === "/time_series") {
    const symbol = u.searchParams.get("symbol"), iv = u.searchParams.get("interval");
    calls.td.push(symbol);
    if (world.tdMode === "429") return Response.json({ code: 429, message: "You have run out of API credits for the current minute.", status: "error" }, { status: 429 });
    if (world.tdMode === "unsupported" || symbol === "US30") return Response.json({ code: 404, message: "**symbol** not found: " + symbol, status: "error" }, { status: 404 });
    const key = TD_KEY_OF[iv], step = resolveInterval(key).step, n = Number(u.searchParams.get("outputsize")) || 100;
    const last = bucketStart(NOW, key), values = [];
    for (let i = 0; i < n; i++) {
      const t = last - i * step, p = fxPx(t);
      const dt = new Date(t * 1000).toISOString();
      values.push({ datetime: key === "1D" ? dt.slice(0, 10) : dt.slice(0, 19).replace("T", " "), open: String(p), high: String(p + 0.0004), low: String(p - 0.0003), close: String(p + 0.0001), volume: "0" });
    }
    return Response.json({ meta: { symbol, interval: iv }, values, status: "ok" });
  }
  if (u.hostname.endsWith("finance.yahoo.com")) {
    calls.yahoo.push(u.pathname);
    const ts = [], q = { open: [], high: [], low: [], close: [], volume: [] };
    for (let i = 200; i > 0; i--) { const t = bucketStart(NOW, "1D") - i * 86400; ts.push(t); q.open.push(100); q.high.push(102); q.low.push(99); q.close.push(101); q.volume.push(10); }
    return Response.json({ chart: { result: [{ timestamp: ts, indicators: { quote: [q] } }] } });
  }
  if (u.hostname.includes("dukascopy")) { calls.duka += 1; return new Response(new Uint8Array(0)); }
  if (u.hostname.includes("binance")) { calls.binance += 1; return Response.json([]); }
  return new Response("{}", { status: 500 });
};

const { default: market } = await import("../workers/market/index.js");
const hubStub = {
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== "/api/bars") return Response.json({ ok: false }, { status: 404 });
    const iv = resolveInterval(url.searchParams.get("tf"));
    const bars = (iv && world.hub.get(`${url.searchParams.get("sym")}|${iv.key}`)) || [];
    return Response.json({ ok: true, bars, hasMore: false, provenance: "LIVE" });
  },
};
const marketEnv = { TWELVEDATA_KEY: "td-test-key", INTERNAL_TD_SECRET: SECRET, ALLOWED_ORIGINS: "https://vektorterminal.com", MARKET_HUB: { idFromName: (n) => n, get: () => hubStub } };
const pending = [];
const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) };
const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
const env = { INTERNAL_TD_SECRET: SECRET, MARKET_SERVICE: { fetch: (req) => market.fetch(req, marketEnv, ctx) } };
const { onRequest } = await import("../functions/api/[[path]].js");

async function candles(qs) {
  const res = await onRequest({ request: new Request(`https://vektorterminal.com/api/candles?${qs}`), env, waitUntil: ctx.waitUntil });
  await settle();
  return { res, body: await res.json() };
}

beforeEach(() => {
  store.clear(); world.tdMode = "ok"; world.hub.clear();
  calls.td = []; calls.yahoo = []; calls.duka = 0; calls.binance = 0;
});

describe("feed routing table", () => {
  it("Twelve Data first except crypto; futures and unknown non-equities on Yahoo", () => {
    assert.equal(assetFeed("EURUSD"), "twelvedata");
    assert.equal(assetFeed("AAPL"), "twelvedata");
    assert.equal(assetFeed("SPY"), "twelvedata");
    assert.equal(assetFeed("XAUUSD"), "twelvedata");
    assert.equal(assetFeed("SPX"), "twelvedata");
    assert.equal(assetFeed("BTCUSDT"), "binance");
    assert.equal(assetFeed("NQ=F"), "yahoo");
    assert.equal(assetFeed("CL=F"), "yahoo");
    assert.equal(tdSymbolFor("NQ=F"), null, "no QQQ stand-in for a futures contract");
    assert.equal(tdSymbolFor("EURUSD"), "EUR/USD");
    assert.equal(assetFeed("EURUSD", { tdUnsupported: (s) => s === "EUR/USD" }), "yahoo");
  });

  it("only 'symbol not carried' errors move an asset off Twelve Data; quota and outages never do", () => {
    assert.equal(isTdSymbolUnsupported({ code: 404, message: "**symbol** not found: US30" }), true);
    assert.equal(isTdSymbolUnsupported({ code: 400, message: "This symbol is available starting with the Grow plan" }), true);
    assert.equal(isTdSymbolUnsupported({ code: 429, message: "You have run out of API credits" }), false);
    assert.equal(isTdSymbolUnsupported({ code: 500, message: "internal error" }), false);
  });
});

describe("history uses the asset's single feed", () => {
  it("EURUSD history is Twelve Data (+ hub TD bars), never Yahoo", async () => {
    const forming = bucketStart(NOW, "15m");
    world.hub.set("EUR/USD|15m", [{ t: forming, o: 1.081, h: 1.0822, l: 1.0805, c: 1.0818, v: 0 }]);
    const { res, body } = await candles("symbol=EURUSD&interval=15m&mkt=FX&apiSym=EUR%2FUSD&limit=100");
    assert.equal(res.status, 200);
    assert.equal(body.source, "twelvedata+hub");
    assert.deepEqual(calls.td, ["EUR/USD"]);
    assert.equal(calls.yahoo.length, 0);
  });

  it("Twelve Data 429: last good TD history is served, never Yahoo", async () => {
    await candles("symbol=GBPUSD&interval=1H&mkt=FX&apiSym=GBP%2FUSD&limit=100"); // primes last-good TD history
    store.clear();
    world.tdMode = "429";
    const { res, body } = await candles("symbol=GBPUSD&interval=1H&mkt=FX&apiSym=GBP%2FUSD&limit=100&refresh=1");
    assert.equal(res.status, 200);
    assert.match(body.source, /^twelvedata\+stale/, body.source);
    assert.equal(calls.yahoo.length, 0, "Yahoo never asked for a Twelve Data asset");
  });

  it("Twelve Data 429 with no TD history yet: the hub's TD bars, never Yahoo", async () => {
    world.tdMode = "429";
    const t0 = bucketStart(NOW, "1H");
    world.hub.set("AUD/USD|1H", [0, 1].map((i) => ({ t: t0 - (1 - i) * 3600, o: 0.65, h: 0.651, l: 0.649, c: 0.6505, v: 0 })));
    const { res, body } = await candles("symbol=AUDUSD&interval=1H&mkt=FX&apiSym=AUD%2FUSD&limit=100");
    assert.equal(calls.yahoo.length, 0, "Yahoo never asked for a Twelve Data asset");
    assert.equal(res.status, 200);
    assert.equal(body.source, "market-service");
    assert.equal(body.bars.length, 2);
  });

  it("FX backtest replay is Twelve Data, not Dukascopy or Yahoo", async () => {
    await candles(`symbol=EURUSD&interval=1H&mkt=FX&apiSym=EUR%2FUSD&replay=1&from=${NOW - 86400 * 20}&to=${NOW - 86400 * 10}`);
    assert.equal(calls.duka, 0, "no Dukascopy");
    assert.equal(calls.yahoo.length, 0, "no Yahoo");
    assert.ok(calls.td.includes("EUR/USD"));
  });

  it("futures history is Yahoo only: no Twelve Data stand-in, no hub overlay", async () => {
    world.hub.set("NQ=F|1D", [{ t: bucketStart(NOW, "1D"), o: 1, h: 1, l: 1, c: 1, v: 0 }]);
    const { body } = await candles("symbol=NQ%3DF&interval=1D&mkt=FUT&limit=100");
    assert.equal(body.source, "yahoo");
    assert.equal(calls.td.length, 0, "no QQQ stand-in fetched");
    assert.ok(body.bars.every((b) => b.c === 101), "pure Yahoo bars");
  });

  it("an asset Twelve Data does not carry moves to Yahoo as a whole", async () => {
    const { body } = await candles("symbol=US30&interval=1D&limit=100");
    assert.equal(body.source, "yahoo");
    const again = await candles("symbol=US30&interval=1D&limit=100&refresh=1");
    assert.equal(again.body.source, "yahoo");
    assert.equal(calls.td.filter((s) => s === "US30").length, 1, "TD is not asked again once it reported the symbol unsupported");
  });

  it("a cached Yahoo entry for a Twelve Data asset is never served", async () => {
    const yahooBody = JSON.stringify({ ok: true, symbol: "USDJPY", interval: "1D", ttl: 60, ts: Date.now(), source: "yahoo", bars: [{ t: bucketStart(NOW, "1D"), o: 1, h: 1, l: 1, c: 1, v: 0 }] });
    store.set("https://vektorterminal.com/api/candles?symbol=USDJPY&interval=1D&from=0&to=0&before=0&limit=100&replay=0", new Response(yahooBody));
    const { body } = await candles("symbol=USDJPY&interval=1D&mkt=FX&apiSym=USD%2FJPY&limit=100");
    assert.match(body.source, /^twelvedata/, body.source);
  });
});
