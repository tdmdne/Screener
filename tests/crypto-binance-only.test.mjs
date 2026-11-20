// tests/crypto-binance-only.test.mjs — crypto history and live bars come from Binance only.
//
// Root causes under test (preview d34749c1, 20 Nov, measured from a Worker in colo MAN):
//  1. data-api.binance.vision, api.binance.com and api1..4.binance.com answer 403 to Cloudflare egress; only
//     api-gcp.binance.com answers 200. fetchBinanceWithFallback() skipped only 451/5xx, so the 403 ended the mirror
//     loop, fetchBinanceCandles() returned null and BTCUSDT history silently fell back to Yahoo (~0.8% off Binance).
//  2. hubBarsSymbol("BTCUSDT") asked the hub for "BTC/USD" (stored as BTCUSD: 0 bars) while the Binance-fed hub keeps
//     bars under "BTCUSDT", so crypto never got the live overlay and the Pages hub-only fallback was empty.
// Run: node tests/crypto-binance-only.test.mjs

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { bucketStart } from "../shared/market/candles.js";
import { resolveInterval } from "../shared/intervals.js";
import { hubBarsSymbol } from "../shared/market/candleRoute.js";
import { BINANCE_MIRRORS } from "../shared/instruments.js";

const NOW = Math.floor(Date.now() / 1000);

const store = new Map();
globalThis.caches = {
  default: {
    async match(req) { const hit = store.get(req.url); return hit ? hit.clone() : undefined; },
    async put(req, res) { store.set(req.url, res); },
  },
};

const world = { blocked: new Set(), hub: new Map() };
const calls = { binanceHosts: [], yahoo: 0, hubSyms: [] };
const bnPx = (t) => 58700 + (t % 600) / 10; // Binance price level
const BN_IV = { "1m": "1m", "1h": "1H", "1d": "1D" };

globalThis.fetch = async (input) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname.endsWith("binance.com") || u.hostname.endsWith("binance.vision")) {
    calls.binanceHosts.push(u.origin);
    if (world.blocked.has(u.origin)) return new Response("<html>403 Forbidden</html>", { status: 403 });
    if (u.pathname !== "/api/v3/klines") return Response.json([]);
    const key = BN_IV[u.searchParams.get("interval")];
    const step = resolveInterval(key).step;
    const end = Number(u.searchParams.get("endTime")) ? Math.floor(Number(u.searchParams.get("endTime")) / 1000) : NOW;
    const n = Number(u.searchParams.get("limit")) || 500;
    const last = bucketStart(end, key);
    const rows = [];
    for (let i = n - 1; i >= 0; i--) {
      const t = last - i * step;
      const p = bnPx(t);
      rows.push([t * 1000, String(p), String(p + 12), String(p - 9), String(p + 3), "5.5", t * 1000 + step * 1000 - 1]);
    }
    return Response.json(rows);
  }
  if (u.hostname.endsWith("finance.yahoo.com")) {
    calls.yahoo += 1; // Yahoo is a different price series for crypto: it must never be asked.
    const ts = [], q = { open: [], high: [], low: [], close: [], volume: [] };
    for (let i = 300; i > 0; i--) { const t = bucketStart(NOW, "1m") - i * 60; ts.push(t); for (const k of ["open", "high", "low", "close"]) q[k].push(58200); q.volume.push(1); }
    return Response.json({ chart: { result: [{ timestamp: ts, indicators: { quote: [q] } }] } });
  }
  return new Response("{}", { status: 500 });
};

const { default: market } = await import("../workers/market/index.js");
const hubStub = {
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== "/api/bars") return Response.json({ ok: false }, { status: 404 });
    calls.hubSyms.push(url.searchParams.get("sym"));
    const iv = resolveInterval(url.searchParams.get("tf"));
    const bars = (iv && world.hub.get(`${url.searchParams.get("sym")}|${iv.key}`)) || [];
    return Response.json({ ok: true, bars, hasMore: false, provenance: "LIVE" });
  },
};
const marketEnv = { ALLOWED_ORIGINS: "https://vektorterminal.com", MARKET_HUB: { idFromName: (n) => n, get: () => hubStub } };
const pending = [];
const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) };
const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
const env = { MARKET_SERVICE: { fetch: (req) => market.fetch(req, marketEnv, ctx) } };

const { onRequest } = await import("../functions/api/[[path]].js");

async function candles(qs) {
  const res = await onRequest({ request: new Request(`https://vektorterminal.com/api/candles?${qs}`), env, waitUntil: ctx.waitUntil });
  await settle();
  return { res, body: await res.json() };
}

const EDGE_BLOCKED = ["https://data-api.binance.vision", "https://api.binance.com", "https://api1.binance.com", "https://api2.binance.com", "https://api3.binance.com", "https://api4.binance.com"];

beforeEach(() => {
  store.clear();
  world.blocked = new Set(EDGE_BLOCKED);
  world.hub.clear();
  calls.binanceHosts = []; calls.yahoo = 0; calls.hubSyms = [];
});

describe("crypto data source = Binance only", () => {
  it("hubBarsSymbol keeps Binance crypto symbols as the hub stores them; FX/equities unchanged", () => {
    assert.equal(hubBarsSymbol("BTCUSDT", "CRY"), "BTCUSDT");
    assert.equal(hubBarsSymbol("ETHUSDT"), "ETHUSDT");
    assert.equal(hubBarsSymbol("EURUSD", "FX"), "EUR/USD");
    assert.equal(hubBarsSymbol("AAPL", "STK"), "AAPL");
  });

  it("the Binance host reachable from Cloudflare (api-gcp) is tried first", () => {
    assert.equal(BINANCE_MIRRORS[0], "https://api-gcp.binance.com");
  });

  it("edge-blocked mirrors (403) fall through to a working Binance host; history is Binance + hub overlay, never Yahoo", async () => {
    world.blocked = new Set(["https://api-gcp.binance.com", ...EDGE_BLOCKED.slice(1)]); // only data-api.binance.vision works
    const forming = bucketStart(NOW, "1m");
    world.hub.set("BTCUSDT|1m", [{ t: forming, o: 58750, h: 58790, l: 58740, c: 58780, v: 1 }]);
    const { res, body } = await candles("symbol=BTCUSDT&interval=1m&mkt=CRY&apiSym=BTCUSDT&limit=200");
    assert.equal(res.status, 200);
    assert.match(body.source, /^binance\+hub$/, body.source);
    assert.equal(calls.yahoo, 0, "Yahoo never asked for crypto");
    assert.ok(calls.hubSyms.includes("BTCUSDT"), "hub asked for BTCUSDT: " + calls.hubSyms.join(","));
    assert.ok(calls.binanceHosts.includes("https://data-api.binance.vision"), "403 moved on to the next mirror");
    // Server overlay rule (shared/market/candles.js overlayLiveBars): REST open, widest high/low, live close.
    const last = body.bars.at(-1);
    assert.equal(last.t, forming);
    assert.equal(last.c, 58780, "forming bar closes at the hub's live Binance price");
    assert.ok(last.h >= 58790 && last.l <= 58740, "range widened by the live bar: " + JSON.stringify(last));
  });

  it("all Binance REST blocked: falls back to the hub's Binance bars, never Yahoo", async () => {
    world.blocked = new Set(["https://api-gcp.binance.com", ...EDGE_BLOCKED]);
    const t0 = bucketStart(NOW, "1m");
    // A symbol with no last-good history yet (BTCUSDT has some from the test above, which would correctly win).
    world.hub.set("SOLUSDT|1m", [0, 1, 2].map((i) => ({ t: t0 - (2 - i) * 60, o: 140, h: 141, l: 139, c: 140.5, v: 1 })));
    const { res, body } = await candles("symbol=SOLUSDT&interval=1m&mkt=CRY&apiSym=SOLUSDT&limit=200");
    assert.equal(calls.yahoo, 0, "Yahoo never asked for crypto");
    assert.equal(res.status, 200, JSON.stringify(body).slice(0, 200));
    assert.equal(body.source, "market-service");
    assert.equal(body.bars.length, 3);
  });

  it("a cached non-Binance (Yahoo) crypto entry is never served", async () => {
    const yahooBody = JSON.stringify({ ok: true, symbol: "BTCUSDT", interval: "1m", ttl: 60, ts: Date.now(), source: "yahoo", bars: [{ t: bucketStart(NOW, "1m"), o: 1, h: 1, l: 1, c: 1, v: 0 }] });
    store.set("https://vektorterminal.com/api/candles?symbol=BTCUSDT&interval=1m&from=0&to=0&before=0&limit=200&replay=0", new Response(yahooBody));
    const { body } = await candles("symbol=BTCUSDT&interval=1m&mkt=CRY&apiSym=BTCUSDT&limit=200");
    assert.match(body.source, /^binance/, body.source);
    assert.ok(body.bars.at(-1).c > 1000, "Binance prices, not the cached Yahoo stub");
  });

  it("replay (backtest) crypto history is Binance only too", async () => {
    world.blocked = new Set(["https://api-gcp.binance.com", ...EDGE_BLOCKED]);
    await candles(`symbol=BTCUSDT&interval=1H&mkt=CRY&apiSym=BTCUSDT&replay=1&from=${NOW - 86400 * 20}&to=${NOW - 86400 * 10}`);
    assert.equal(calls.yahoo, 0, "Yahoo never asked for crypto replay");
  });
});
