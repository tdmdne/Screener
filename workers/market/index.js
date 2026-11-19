// workers/market/index.js — Vektor Market Worker (vektor-market).
// Exports: MarketHub DO, TdBudget DO, canonical(), allowedOrigin(), corsHeaders(), withCors(), default fetch().
//
// Rules:
// - ZERO secrets in repo files; TWELVEDATA_KEY comes exclusively from Cloudflare Worker secrets (`env.TWELVEDATA_KEY`).
// - `/td/*` live TTL responses use Cloudflare Cache API (`caches.default`), NEVER KV per live miss (Task 4).
// - All market data ingestion, candle building, indicators, screener, and WS fan-out run inside `MarketHub` DO.
import { MarketHub } from "./hub.js";
import { utcDayKey } from "./store.js";

export { MarketHub };

const TD_REST_BASE = "https://api.twelvedata.com";
const CACHE_HOST = "https://cache.vektor-market.internal";

/** Allowlisted Twelve Data REST routes and their permitted query parameters + Cache API TTLs (seconds). */
const TD_ALLOWLIST = Object.freeze({
  "/td/time_series": Object.freeze({
    upstream: "/time_series",
    params: new Set([
      "symbol",
      "interval",
      "outputsize",
      "start_date",
      "end_date",
      "timezone",
      "order",
      "exchange",
      "type",
      "dp",
    ]),
    ttl: (params) => {
      const iv = (params.get("interval") || "").toLowerCase();
      if (iv === "1min" || iv === "1m") return 30;
      if (iv === "5min" || iv === "15min" || iv === "30min") return 60;
      if (iv === "1h" || iv === "4h") return 180;
      return 300;
    },
  }),
  "/td/price": Object.freeze({
    upstream: "/price",
    params: new Set(["symbol", "exchange", "type"]),
    ttl: () => 15,
  }),
  "/td/quote": Object.freeze({
    upstream: "/quote",
    params: new Set(["symbol", "interval", "exchange", "type"]),
    ttl: () => 20,
  }),
  "/td/symbol_search": Object.freeze({
    upstream: "/symbol_search",
    params: new Set(["symbol", "outputsize", "show_plan"]),
    ttl: () => 3600,
  }),
  "/td/exchange_rate": Object.freeze({
    upstream: "/exchange_rate",
    params: new Set(["symbol", "date"]),
    ttl: () => 30,
  }),
});

/**
 * Canonicalize an allowlisted `/td/*` route + query parameters into a deterministic cache key string.
 * - Normalizes path casing and strips trailing slashes.
 * - Filters strictly to per-endpoint allowlisted query params (always strips `apikey`, `token`, cache-busters).
 * - Normalizes symbol/interval/timezone/order and sorts query keys alphabetically.
 * - Returns `null` for non-allowlisted paths.
 *
 * @param {string|URL} pathOrUrl
 * @param {URLSearchParams|Record<string, any>|string} [searchParams]
 * @returns {string|null}
 */
export function canonical(pathOrUrl, searchParams) {
  let pathname = "";
  let params;

  if (pathOrUrl instanceof URL) {
    pathname = pathOrUrl.pathname;
    params = searchParams ? toSearchParams(searchParams) : pathOrUrl.searchParams;
  } else if (typeof pathOrUrl === "string") {
    const trimmed = pathOrUrl.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) {
      try {
        const u = new URL(trimmed);
        pathname = u.pathname;
        params = searchParams ? toSearchParams(searchParams) : u.searchParams;
      } catch {
        return null;
      }
    } else {
      const qIdx = trimmed.indexOf("?");
      pathname = qIdx >= 0 ? trimmed.slice(0, qIdx) : trimmed;
      const inlineQs = qIdx >= 0 ? trimmed.slice(qIdx + 1) : "";
      params = searchParams !== undefined ? toSearchParams(searchParams) : new URLSearchParams(inlineQs);
    }
  } else {
    return null;
  }

  const normPath = pathname.replace(/\/+$/, "").toLowerCase();
  const rule = TD_ALLOWLIST[normPath];
  if (!rule) return null;

  const entries = [];
  for (const [rawKey, rawVal] of params.entries()) {
    const key = String(rawKey || "").trim().toLowerCase();
    if (!rule.params.has(key)) continue;
    let val = String(rawVal ?? "").trim();
    if (!val) continue;

    if (key === "symbol") {
      val = val.toUpperCase().replace(/\s+/g, "");
    } else if (key === "interval") {
      val = val.toLowerCase();
    } else if (key === "timezone" || key === "order") {
      val = val.toUpperCase();
    } else if (key === "outputsize") {
      const n = Math.floor(Number(val));
      if (!Number.isFinite(n) || n < 1) continue;
      val = String(Math.min(5000, n));
    }
    entries.push([key, val]);
  }

  entries.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));

  const out = new URLSearchParams();
  const seen = new Set();
  for (const [k, v] of entries) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.set(k, v);
  }
  const qs = out.toString();
  return qs ? `${normPath}?${qs}` : normPath;
}

function toSearchParams(input) {
  if (input instanceof URLSearchParams) return input;
  if (typeof input === "string") return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input);
  const sp = new URLSearchParams();
  if (input && typeof input === "object") {
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined && v !== null) sp.set(k, String(v));
    }
  }
  return sp;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Validate a Request (or raw Origin string) against `env.ALLOWED_ORIGINS`.
 * Supports:
 * - `"*"` wildcard
 * - Exact origin rules (`https://screener-cso.pages.dev`)
 * - Port-optional loopback rules (`http://localhost`, `http://127.0.0.1`, `http://[::1]` match with or without port)
 * - Subdomain wildcard rules (`*.pages.dev` matches `https://foo.pages.dev`, never `https://evilpages.dev`)
 *
 * Security invariants:
 * - Rejects malformed Origins or Origins carrying userinfo, path, query, or fragment (`parsed.origin !== origin`).
 * - Returns canonical `parsed.origin`, never the raw header string.
 * - Restricts port-less arbitrary-port matching STRICTLY to loopback hosts, never production domains.
 *
 * @param {Request|string|null|undefined} reqOrOrigin
 * @param {Record<string, any>} [env]
 * @returns {string|null}
 */
export function allowedOrigin(reqOrOrigin, env = {}) {
  const origin =
    typeof reqOrOrigin === "string"
      ? reqOrOrigin.trim()
      : reqOrOrigin && reqOrOrigin.headers
        ? (reqOrOrigin.headers.get("Origin") || "").trim()
        : "";

  const rawList = env && env.ALLOWED_ORIGINS !== undefined ? String(env.ALLOWED_ORIGINS) : "";
  const rules = rawList
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!rules.length) return null;

  if (rules.includes("*")) {
    if (!origin) return "*";
    let parsedWild;
    try {
      parsedWild = new URL(origin);
    } catch {
      return null;
    }
    if (parsedWild.protocol !== "http:" && parsedWild.protocol !== "https:") return null;
    if (parsedWild.origin.toLowerCase() !== origin.toLowerCase()) return null;
    return parsedWild.origin;
  }

  if (!origin) return null;

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // Reject Origins containing userinfo, path, query, fragment, trailing slash, or non-canonical form.
  if (parsed.origin.toLowerCase() !== origin.toLowerCase()) return null;

  const originNorm = parsed.origin.toLowerCase();
  const hostNoPort = parsed.hostname.toLowerCase();
  const protoHost = `${parsed.protocol}//${hostNoPort}`;
  const isLoopback = LOOPBACK_HOSTS.has(hostNoPort);

  for (const rawRule of rules) {
    const rule = rawRule.replace(/\/+$/, "").toLowerCase();
    if (!rule) continue;

    if (rule.startsWith("*.")) {
      const suffix = rule.slice(1); // ".pages.dev"
      if (
        parsed.protocol === "https:" &&
        !parsed.port &&
        hostNoPort.endsWith(suffix) &&
        hostNoPort.length > suffix.length
      ) {
        return parsed.origin;
      }
      continue;
    }

    if (rule === originNorm) return parsed.origin;

    // Allow port-less arbitrary-port matching STRICTLY for loopback hosts (localhost, 127.0.0.1, [::1]).
    if (isLoopback) {
      try {
        const rUrl = new URL(rule);
        const rHost = rUrl.hostname.toLowerCase();
        if (!rUrl.port && LOOPBACK_HOSTS.has(rHost) && `${rUrl.protocol}//${rHost}` === protoHost) {
          return parsed.origin;
        }
      } catch {
        /* ignore malformed rule */
      }
    }
  }

  return null;
}

export function corsHeaders(req, env) {
  const o = allowedOrigin(req, env);
  const h = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (o) h["Access-Control-Allow-Origin"] = o;
  return h;
}

export function withCors(res, req, env) {
  if (res.status === 101) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(corsHeaders(req, env))) out.headers.set(k, v);
  return out;
}

function jsonResponse(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

function cursorRows(cursor) {
  if (!cursor) return [];
  if (typeof cursor.toArray === "function") return cursor.toArray();
  if (Array.isArray(cursor)) return cursor;
  return [...cursor];
}

/**
 * TdBudget — SQLite-backed Durable Object enforcing Twelve Data REST credit budgets
 * (`TD_PER_MIN` default 8/min, `TD_PER_DAY` default 800/day).
 */
export class TdBudget {
  constructor(ctx, env, opts = {}) {
    this.ctx = ctx;
    this.env = env || {};
    this.now = typeof opts.now === "function" ? opts.now : () => Date.now();
    this.perMin = Math.max(1, Number(this.env.TD_PER_MIN || 8) || 8);
    this.perDay = Math.max(1, Number(this.env.TD_PER_DAY || 800) || 800);
    this._initialized = false;
    this._lastPruneMin = -1;
  }

  _init() {
    if (this._initialized) return;
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS td_budget_counts (" +
        "bucket TEXT PRIMARY KEY, " +
        "used INTEGER NOT NULL)"
    );
    this._initialized = true;
  }

  _getBucket(bucket) {
    const rows = cursorRows(
      this.ctx.storage.sql.exec("SELECT used FROM td_budget_counts WHERE bucket = ?", bucket)
    );
    return rows.length ? Number(rows[0].used) : 0;
  }

  _setBucket(bucket, used) {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO td_budget_counts (bucket, used) VALUES (?, ?)",
      bucket,
      used
    );
  }

  _buckets(nowMs) {
    const minNum = Math.floor(nowMs / 60_000);
    const dayStr = utcDayKey(nowMs);
    return {
      minNum,
      minBucket: `min:${minNum}`,
      dayBucket: `day:${dayStr}`,
      secUntilNextMin: Math.max(1, 60 - Math.floor((nowMs % 60_000) / 1000)),
    };
  }

  /** Periodically prune expired `min:*` (> 2 min old) and `day:*` (> 7 UTC days old) rows so SQLite stays bounded. */
  _prune(nowMs) {
    const minNum = Math.floor(nowMs / 60_000);
    if (this._lastPruneMin === minNum) return;
    this._lastPruneMin = minNum;
    const minCutoff = minNum - 2;
    const dayCutoff = `day:${utcDayKey(nowMs - 7 * 86_400_000)}`;
    this.ctx.storage.sql.exec(
      "DELETE FROM td_budget_counts WHERE (bucket LIKE 'min:%' AND CAST(SUBSTR(bucket, 5) AS INTEGER) < ?) OR (bucket LIKE 'day:%' AND bucket < ?)",
      minCutoff,
      dayCutoff
    );
  }

  consume(cost = 1) {
    this._init();
    const n = Math.max(1, Math.floor(Number(cost) || 1));
    const nowMs = this.now();
    this._prune(nowMs);
    const { minBucket, dayBucket, secUntilNextMin } = this._buckets(nowMs);

    const usedMin = this._getBucket(minBucket);
    const usedDay = this._getBucket(dayBucket);

    if (usedDay + n > this.perDay) {
      return {
        ok: false,
        reason: "per_day",
        retryAfterSec: 3600,
        usedMin,
        usedDay,
        remainingMin: Math.max(0, this.perMin - usedMin),
        remainingDay: Math.max(0, this.perDay - usedDay),
      };
    }

    if (usedMin + n > this.perMin) {
      return {
        ok: false,
        reason: "per_min",
        retryAfterSec: secUntilNextMin,
        usedMin,
        usedDay,
        remainingMin: Math.max(0, this.perMin - usedMin),
        remainingDay: Math.max(0, this.perDay - usedDay),
      };
    }

    const nextMin = usedMin + n;
    const nextDay = usedDay + n;
    this._setBucket(minBucket, nextMin);
    this._setBucket(dayBucket, nextDay);

    return {
      ok: true,
      usedMin: nextMin,
      usedDay: nextDay,
      remainingMin: Math.max(0, this.perMin - nextMin),
      remainingDay: Math.max(0, this.perDay - nextDay),
    };
  }

  status() {
    this._init();
    const nowMs = this.now();
    const { minBucket, dayBucket } = this._buckets(nowMs);
    const usedMin = this._getBucket(minBucket);
    const usedDay = this._getBucket(dayBucket);
    return {
      ok: true,
      perMin: this.perMin,
      perDay: this.perDay,
      usedMin,
      usedDay,
      remainingMin: Math.max(0, this.perMin - usedMin),
      remainingDay: Math.max(0, this.perDay - usedDay),
    };
  }

  async fetch(req) {
    const url = new URL(typeof req === "string" ? req : req.url);
    if (url.pathname === "/status") {
      return jsonResponse(this.status(), 200);
    }
    if (url.pathname === "/consume") {
      const cost = Number(url.searchParams.get("cost")) || 1;
      const res = this.consume(cost);
      return jsonResponse(
        res,
        res.ok ? 200 : 429,
        res.ok ? {} : { "Retry-After": String(res.retryAfterSec) }
      );
    }
    return jsonResponse({ ok: false, error: "not found" }, 404);
  }
}

/**
 * Proxy allowlisted `/td/*` requests through `TdBudget` DO and Cloudflare Cache API (NOT KV per miss!).
 */
async function handleTd(req, url, env, ctx) {
  if (req.method !== "GET") {
    return jsonResponse(
      { ok: false, error: "method not allowed" },
      405,
      { Allow: "GET, OPTIONS" }
    );
  }

  // Reject disallowed browser Origins BEFORE Cache API, TdBudget, or upstream Twelve Data calls.
  const rawOrigin = (req.headers.get("Origin") || "").trim();
  if (rawOrigin && !allowedOrigin(rawOrigin, env)) {
    return jsonResponse({ ok: false, error: "origin not allowed" }, 403);
  }

  const canon = canonical(url.pathname, url.searchParams);
  if (!canon) {
    return jsonResponse({ ok: false, error: "endpoint not allowed" }, 404);
  }

  const qIdx = canon.indexOf("?");
  const normPath = qIdx >= 0 ? canon.slice(0, qIdx) : canon;
  const canonQs = qIdx >= 0 ? canon.slice(qIdx + 1) : "";
  const rule = TD_ALLOWLIST[normPath];
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const cacheKey = new Request(`${CACHE_HOST}${canon}`, { method: "GET" });

  // 1. Cloudflare Cache API lookup (zero KV ops)
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set("X-Cache", "HIT");
      return hit;
    }
  }

  if (!env.TWELVEDATA_KEY) {
    return jsonResponse({ ok: false, error: "TWELVEDATA_KEY not configured" }, 503);
  }

  // 2. Enforce global Twelve Data REST credit budget via TdBudget DO
  if (env.TD_BUDGET) {
    const budgetStub = env.TD_BUDGET.get(env.TD_BUDGET.idFromName("global"));
    const bRes = await budgetStub.fetch(new Request("https://td-budget/consume?cost=1"));
    if (!bRes.ok) {
      const body = await bRes.text();
      return new Response(body, {
        status: bRes.status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Retry-After": bRes.headers.get("Retry-After") || "60",
          "X-Cache": "BUDGET",
        },
      });
    }
  }

  // 3. Upstream Twelve Data REST call (key appended server-side only; never echoed or cached)
  const upstreamParams = new URLSearchParams(canonQs);
  upstreamParams.set("apikey", String(env.TWELVEDATA_KEY));
  const upstreamUrl = `${TD_REST_BASE}${rule.upstream}?${upstreamParams.toString()}`;

  let upRes;
  try {
    upRes = await fetch(upstreamUrl, {
      headers: { Accept: "application/json" },
    });
  } catch {
    return jsonResponse({ ok: false, error: "upstream request failed" }, 502);
  }

  const text = await upRes.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  const ttl = rule.ttl(new URLSearchParams(canonQs));
  const isCacheable = upRes.ok && parsed && parsed.status !== "error";

  const response = new Response(text, {
    status: upRes.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": isCacheable ? `public, max-age=${ttl}` : "no-store",
      "X-Cache": "MISS",
    },
  });

  if (cache && isCacheable) {
    const putPromise = cache.put(cacheKey, response.clone());
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(putPromise);
    } else {
      await putPromise;
    }
  }

  return response;
}

async function route(req, env, ctx) {
  const url = new URL(req.url);
  const p = url.pathname;

  if (p === "/health" || p === "/api/health") {
    return jsonResponse({
      ok: true,
      worker: "vektor-market",
      time: Date.now(),
      hasTdKey: Boolean(env.TWELVEDATA_KEY),
    });
  }

  if (p === "/ws" || p === "/api/bootstrap" || p === "/api/bars" || p === "/hub/stats" || p === "/api/hub/stats") {
    if (p === "/ws") {
      if ((req.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      if (!allowedOrigin(req, env)) {
        return new Response("Origin not allowed", { status: 403 });
      }
    }
    if (!env.MARKET_HUB) {
      return jsonResponse({ ok: false, error: "MARKET_HUB binding unavailable" }, 503);
    }
    const stub = env.MARKET_HUB.get(env.MARKET_HUB.idFromName("global"));
    const targetPath = p === "/api/hub/stats" ? "/hub/stats" : p;
    const innerUrl = new URL(`${targetPath}${url.search}`, "https://market-hub");
    return stub.fetch(new Request(innerUrl.toString(), req));
  }

  if (p.startsWith("/td/")) {
    return handleTd(req, url, env, ctx);
  }

  return jsonResponse({ ok: false, error: "not found" }, 404);
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    }
    try {
      const res = await route(req, env, ctx);
      return withCors(res, req, env);
    } catch {
      return withCors(jsonResponse({ ok: false, error: "internal error" }, 500), req, env);
    }
  },
};
