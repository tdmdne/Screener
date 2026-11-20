// tests/live-quotes-no-rest.test.mjs — worker.js live quotes come from the hub's Twelve Data WebSocket cache
// (MARKET_SERVICE /api/quotes) + Yahoo, and NEVER from Twelve Data REST /quote (the credit spike).
// Candle history (/td/time_series) is out of scope here: it is history, not a live quote.
import assert from "node:assert/strict";

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log("PASS", name); } catch (err) { failed += 1; console.error("FAIL", name, "-", err && err.stack ? err.stack : err); process.exitCode = 1; }
}

const calls = { tdQuote: 0, tdDirect: 0, hub: [], yahoo: [] };
const HUB = { EURUSD: { s: "EURUSD", c: 1.0612, t: Date.now(), src: "twelvedata" }, AAPL: { s: "AAPL", c: 225.5, t: Date.now(), src: "twelvedata" } };

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
globalThis.fetch = async (input) => {
  const u = String(typeof input === "string" ? input : input.url);
  if (u.includes("api.twelvedata.com")) { calls.tdDirect += 1; return new Response(JSON.stringify({ status: "error", code: 429 }), { status: 429 }); }
  if (u.includes("query1.finance.yahoo.com")) {
    calls.yahoo.push(u);
    return Response.json({ chart: { result: [{ meta: { regularMarketPrice: 100, chartPreviousClose: 99, regularMarketTime: Math.floor(Date.now() / 1000) }, indicators: { quote: [{ close: [99, 100], volume: [10, 20] }] } }] } });
  }
  return new Response("{}", { status: 500 }); // binance etc.: unavailable
};

const env = {
  TWELVEDATA_KEY: "TD_SECRET_KEY",
  MARKET_SERVICE: {
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/td/quote") { calls.tdQuote += 1; return Response.json({ status: "error", code: 429 }, { status: 429 }); }
      if (url.pathname === "/api/quotes") {
        calls.hub.push(url.search);
        const want = (url.searchParams.get("symbols") || "").split(",");
        const quotes = {};
        for (const s of want) if (HUB[s]) quotes[s] = HUB[s];
        return Response.json({ ok: true, ts: Date.now(), feed: "LIVE", quotes });
      }
      return Response.json({ ok: false }, { status: 404 });
    },
  },
};
const ctx = { waitUntil() {} };
const { default: worker } = await import("../worker.js");

await test("/api/quote: TD-primary symbol is priced from the hub WS cache, zero REST /quote calls", async () => {
  const res = await worker.fetch(new Request("https://x.test/api/quote?symbols=EURUSD"), env, ctx);
  const j = await res.json();
  assert.equal(j.quotes.EURUSD.c, 1.0612);
  assert.equal(j.quotes.EURUSD.source, "twelvedata");
  assert.equal(calls.tdQuote, 0);
  assert.equal(calls.tdDirect, 0);
});

await test("/api/quote: hub has no price -> Yahoo fallback, still zero Twelve Data REST", async () => {
  const res = await worker.fetch(new Request("https://x.test/api/quote?symbols=GBPUSD"), env, ctx);
  const j = await res.json();
  assert.equal(j.quotes.GBPUSD.source, "yahoo");
  assert.equal(calls.tdQuote, 0);
  assert.equal(calls.tdDirect, 0);
});

await test("/api/screener: snapshot spends zero Twelve Data REST credits; WS price wins over Yahoo for covered symbols", async () => {
  const res = await worker.fetch(new Request("https://x.test/api/screener"), env, ctx);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(calls.tdQuote, 0, "no REST /quote");
  assert.equal(calls.tdDirect, 0);
  assert.ok(calls.hub.length >= 1, "hub quotes requested");
  const row = (j.universe || j.rows || []).find((r) => r[0] === "EURUSD");
  assert.ok(row, "EURUSD present in snapshot");
  assert.equal(row[2], 1.0612, "WS price used");
  assert.ok(j.source.includes("twelvedata"), "provenance lists twelvedata for WS-fed rows: " + j.source);
});

if (failed > 0) process.exit(1);
console.log("LIVE QUOTES NO REST OK");
