// worker/index.js — Vektor market-data proxy.
//   GET  /api/health
//   GET  /api/candles?symbol=EURUSD&tf=1m&limit=300   (cached; serves STALE data instead of a 502)
//   GET  /api/quote?symbol=BTCUSDT
//   GET  /ws                                           (WebSocket, multiplexed ticks)
//   GET  /sse?symbols=EURUSD,BTCUSDT                   (Server-Sent Events fallback)
import { TF_SECONDS } from "../shared/constants.js";
import { normSymbol } from "../shared/schema.js";
import { MemoryCache } from "./cache.js";
import { corsHeaders, json, withCors, allowedOrigin } from "./cors.js";
import { fetchCandles, fetchQuote } from "./providers.js";

export { MarketHub } from "./hub.js";

const cache = new MemoryCache(500);

// Fresh window per timeframe: fast for 1m, longer higher up. Stale copies are kept for 6 h as the error fallback.
const candleTtl = (tf) => Math.min(60_000, Math.max(3_000, (TF_SECONDS[tf] || 60) * 100));

async function candles(url, env) {
  const symbol = normSymbol(url.searchParams.get("symbol"));
  const tf = url.searchParams.get("tf") || "1m";
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit")) || 300));
  if (!symbol) return json({ error: "symbol required" }, 400);
  if (!TF_SECONDS[tf]) return json({ error: "bad tf", allowed: Object.keys(TF_SECONDS) }, 400);
  try {
    const r = await cache.wrap(`c:${symbol}:${tf}:${limit}`, candleTtl(tf), () => fetchCandles(symbol, tf, limit, env));
    return json({ symbol, tf, bars: r.value, cache: r.state, ageMs: r.ageMs, ...(r.error ? { upstreamError: r.error } : {}) }, 200, {
      "X-Cache": r.state, "Cache-Control": "no-store",
    });
  } catch (e) {
    // No cached copy exists at all: still a well-formed JSON body the client can handle (not an HTML 502 page).
    return json({ symbol, tf, bars: [], cache: "NONE", error: String((e && e.message) || e) }, 503, { "Retry-After": "5" });
  }
}

async function quote(url, env) {
  const symbol = normSymbol(url.searchParams.get("symbol"));
  if (!symbol) return json({ error: "symbol required" }, 400);
  try {
    const r = await cache.wrap(`q:${symbol}`, 1_500, () => fetchQuote(symbol, env), { staleMs: 600_000 });
    return json({ ...r.value, cache: r.state }, 200, { "X-Cache": r.state, "Cache-Control": "no-store" });
  } catch (e) { return json({ error: String((e && e.message) || e) }, 503); }
}

async function route(req, env, ctx) {
  const url = new URL(req.url);
  const p = url.pathname;

  if (p === "/api/health") {
    return json({ ok: true, time: Date.now(), providers: { twelvedata: !!env.TWELVEDATA_KEY, binance: true } });  // booleans only, never the key
  }
  if (p === "/api/candles") return candles(url, env);
  if (p === "/api/quote") return quote(url, env);

  if (p === "/ws" || p === "/sse" || p === "/api/hub/stats") {
    if (p === "/ws" && req.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    if (p === "/ws" && !allowedOrigin(req, env)) return new Response("Origin not allowed", { status: 403 });
    const stub = env.MARKET_HUB.get(env.MARKET_HUB.idFromName("global"));
    const inner = new Request(new URL(p === "/api/hub/stats" ? "/stats" : p + url.search, "https://hub").toString(), req);
    return stub.fetch(inner);
  }

  // Everything else: static frontend, if an assets binding is configured; otherwise 404.
  if (env.ASSETS) return env.ASSETS.fetch(req);
  return json({ error: "not found" }, 404);
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    try { return withCors(await route(req, env, ctx), req, env); }
    catch (e) { return withCors(json({ error: "internal", detail: String((e && e.message) || e) }, 500), req, env); }
  },
};
