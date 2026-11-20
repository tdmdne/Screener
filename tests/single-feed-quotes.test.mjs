// tests/single-feed-quotes.test.mjs — /api/screener and /api/quote serve each asset from ONE feed: Twelve Data rows come
// from the hub (live LRU slot or cached TD quote), crypto from Binance, Yahoo only for Yahoo-routed assets (futures).
// Run: node tests/single-feed-quotes.test.mjs

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.caches = { default: { async match(r) { const h = store.get(r.url); return h ? h.clone() : undefined; }, async put(r, res) { store.set(r.url, res); } } };

const calls = { yahoo: [], tdRest: 0 };
globalThis.fetch = async (input) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname.endsWith("finance.yahoo.com")) {
    calls.yahoo.push(decodeURIComponent(u.pathname.split("/").pop()));
    return Response.json({ chart: { result: [{ meta: { regularMarketPrice: 21000, chartPreviousClose: 20900, regularMarketTime: Math.floor(Date.now() / 1000) }, timestamp: [Math.floor(Date.now() / 1000)], indicators: { quote: [{ open: [21000], high: [21000], low: [21000], close: [21000], volume: [5] }] } }] } });
  }
  if (u.hostname === "api.twelvedata.com") { calls.tdRest += 1; return Response.json({ status: "error", code: 429 }); }
  if (u.hostname.includes("binance")) {
    if (u.pathname === "/api/v3/ticker/24hr") return Response.json([{ symbol: "BTCUSDT", lastPrice: "59000", priceChangePercent: "1.5", quoteVolume: "1000000", volume: "10" }]);
    if (u.pathname === "/api/v3/ticker/price") return Response.json({ symbol: "BTCUSDT", price: "59001" });
    return Response.json([]);
  }
  return new Response("{}", { status: 500 });
};

const HUB_QUOTES = {
  EURUSD: { s: "EURUSD", c: 1.0908, t: Date.now(), prevClose: 1.08, chgPct: 1, v: null, live: true, src: "twelvedata" },
  GBPUSD: { s: "GBPUSD", c: 1.27, t: Date.now() - 3600_000, prevClose: 1.26, chgPct: 0.7937, v: null, live: false, src: "twelvedata" },
};
const marketService = {
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/api/quotes") {
      const want = (u.searchParams.get("symbols") || "").split(",");
      const quotes = {};
      for (const s of want) if (HUB_QUOTES[s]) quotes[s] = HUB_QUOTES[s];
      return Response.json({ ok: true, quotes });
    }
    return Response.json({ ok: true, bars: [] });
  },
};
const env = { MARKET_SERVICE: marketService };
const { onRequest } = await import("../functions/api/[[path]].js");
const get = async (path) => (await onRequest({ request: new Request(`https://vektorterminal.com${path}`), env, waitUntil: () => {} })).json();

beforeEach(() => { store.clear(); calls.yahoo = []; calls.tdRest = 0; });

describe("quotes: one feed per asset", () => {
  it("screener: TD rows come from the hub (live and cached), never Yahoo or TD REST", async () => {
    const body = await get("/api/screener");
    const row = (s) => body.universe.find((r) => r[0] === s);
    assert.equal(row("EURUSD")[2], 1.0908, "live LRU-slot price");
    assert.equal(row("EURUSD")[12], 1, "% change computed by the hub from TD daily bars");
    assert.equal(row("GBPUSD")[2], 1.27, "cached TD quote for a symbol outside the live slots");
    assert.equal(row("USDJPY"), undefined, "no TD state yet: absent, not filled from Yahoo");
    assert.equal(row("BTCUSDT")[2], 59000, "crypto from Binance");
    const tdYahoo = calls.yahoo.filter((s) => /EURUSD|GBPUSD|USDJPY|AAPL|SPY/.test(s));
    assert.deepEqual(tdYahoo, [], "Yahoo never asked for a Twelve Data asset");
    assert.equal(calls.tdRest, 0, "no REST /quote polling");
    assert.ok(calls.yahoo.some((s) => /=F$/.test(s)), "futures (Yahoo-routed) still priced from Yahoo");
  });

  it("/api/quote: TD from the hub, crypto from Binance, futures from Yahoo", async () => {
    const body = await get("/api/quote?symbols=EURUSD,GBPUSD,USDJPY,BTCUSDT,NQ%3DF");
    assert.equal(body.quotes.EURUSD.source, "twelvedata");
    assert.equal(body.quotes.EURUSD.live, true);
    assert.equal(body.quotes.GBPUSD.live, false);
    assert.equal(body.quotes.USDJPY, undefined);
    assert.equal(body.quotes.BTCUSDT.source, "binance");
    assert.equal(body.quotes["NQ=F"].source, "yahoo");
    assert.deepEqual(calls.yahoo.filter((s) => !/=F$/.test(s)), [], "Yahoo only for the futures contract");
  });
});
