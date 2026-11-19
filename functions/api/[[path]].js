// Cloudflare Pages Function catch-all for /api/*
// Same-origin front-door routing:
// - /api/bootstrap, /api/bars, /api/hub/stats -> forwarded via env.MARKET_SERVICE (503 UNAVAILABLE if unbound)
// - /api/auth/*, /api/me/*, /api/admin/*      -> server-side D1 auth/user/admin routes via shared/authRoutes.js
// - /api/vs/run                               -> server-side Vektor Script execution via shared/vs/index.js
// - /api/journal/stats                        -> server-side Journal/Prop analytics via shared/journal.js
// - /api/screener, /api/candles, /api/calendar, /api/news, etc. -> delegated to worker.js

import worker, {
  BINANCE_MIRRORS,
  fetchBinanceWithFallback,
  FUTURES_TO_TWELVEDATA,
  resolveTdSymbol,
  fetchBinanceCandles,
  fetchBinanceTickers,
} from "../../worker.js";
import { MAX_CHART_BARS, PROVENANCE } from "../../shared/protocol.js";
import { handleAuthRoute } from "../../shared/authRoutes.js";
import { handleWaitlistRoute } from "../../shared/waitlist.js";
import { VS_LIM, vsCompute } from "../../shared/vs/index.js";
import {
  JR_TRADES_MAX,
  dailyPnlCalendar,
  drawdownSeries,
  equityCurve,
  jrProp,
  jrStats,
  propStatus,
  rDistribution,
  tradeStats,
} from "../../shared/journal.js";

export {
  BINANCE_MIRRORS,
  fetchBinanceWithFallback,
  FUTURES_TO_TWELVEDATA,
  resolveTdSymbol,
  fetchBinanceCandles,
  fetchBinanceTickers,
};

const MARKET_SERVICE_PATHS = new Set(["/api/bootstrap", "/api/bars", "/api/hub/stats"]);

const VS_RUN_MAX_BYTES = 256 * 1024;
const JOURNAL_STATS_MAX_BYTES = 1024 * 1024;
const VS_MAX_INPUT_KEYS = 64;
const JOURNAL_MAX_TRADES = Math.min(JR_TRADES_MAX, 10000);
const JOURNAL_MAX_SETUP_LEN = 256;
const JOURNAL_BUCKET_MIN = 0.05;
const JOURNAL_BUCKET_MAX = 100;

const VS_SYMBOL_RE = /^[A-Z0-9._/:=-]{1,24}$/;
const VS_ALLOWED_TFS = new Set([
  "1m", "5m", "15m", "30m",
  "1h", "4h", "1d", "1w",
  "1H", "4H", "1D", "1W", "1M",
]);

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const EXPOSE_HEADERS = "x-cache, server-timing, cache-control, x-provenance";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toStrictNumber(v) {
  if (typeof v === "boolean" || v === null || v === undefined) return NaN;
  if (typeof v === "string" && v.trim() === "") return NaN;
  if (typeof v === "object" || typeof v === "symbol") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function parseAllowedOrigins(env) {
  const set = new Set();
  const raw = env && env.ALLOWED_ORIGINS;
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,\s]+/)
      : [];
  for (const item of items) {
    const trimmed = String(item || "").trim();
    if (!trimmed || trimmed === "*") continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        set.add(parsed.origin);
      }
    } catch {
      // Ignore malformed allowlist entries
    }
  }
  return set;
}

function resolveAllowedOrigin(request, env) {
  const rawOrigin = request.headers.get("Origin");
  if (rawOrigin === null) {
    return { present: false, allowed: true, origin: null };
  }
  const trimmed = rawOrigin.trim();
  if (!trimmed || trimmed === "null") {
    return { present: true, allowed: false, origin: null };
  }
  let parsedOrigin;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { present: true, allowed: false, origin: null };
    }
    parsedOrigin = u.origin;
  } catch {
    return { present: true, allowed: false, origin: null };
  }
  const requestOrigin = new URL(request.url).origin;
  if (parsedOrigin === requestOrigin) {
    return { present: true, allowed: true, origin: parsedOrigin };
  }
  if (parseAllowedOrigins(env).has(parsedOrigin)) {
    return { present: true, allowed: true, origin: parsedOrigin };
  }
  return { present: true, allowed: false, origin: null };
}

function appendVary(headers, token) {
  const existing = headers.get("vary");
  if (!existing) {
    headers.set("vary", token);
    return;
  }
  const parts = existing.split(",").map((s) => s.trim().toLowerCase());
  if (!parts.includes(token.toLowerCase())) {
    headers.set("vary", `${existing}, ${token}`);
  }
}

function withCors(res, request, env) {
  const newHeaders = new Headers(res.headers);
  const cors = resolveAllowedOrigin(request, env);
  appendVary(newHeaders, "Origin");

  const upstreamAcao = newHeaders.get("access-control-allow-origin");
  if (upstreamAcao === "*") {
    // Never emit wildcard CORS; replace with validated origin or strip.
    if (cors.present && cors.allowed && cors.origin) {
      newHeaders.set("access-control-allow-origin", cors.origin);
    } else {
      newHeaders.delete("access-control-allow-origin");
    }
  } else if (!upstreamAcao) {
    // Only attach ACAO when a validated Origin was presented; never overwrite stricter upstream ACAO.
    if (cors.present && cors.allowed && cors.origin) {
      newHeaders.set("access-control-allow-origin", cors.origin);
    }
  }

  if (!newHeaders.has("access-control-allow-methods")) {
    newHeaders.set("access-control-allow-methods", "GET, POST, PUT, OPTIONS");
  }
  if (!newHeaders.has("access-control-allow-headers")) {
    newHeaders.set("access-control-allow-headers", "Content-Type, Authorization");
  }
  if (!newHeaders.has("access-control-expose-headers")) {
    newHeaders.set("access-control-expose-headers", EXPOSE_HEADERS);
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: newHeaders,
  });
}

function jsonResponse(payload, status = 200, extraHeaders = {}, request = null, env = null) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
    "access-control-expose-headers": EXPOSE_HEADERS,
    ...extraHeaders,
  });
  appendVary(headers, "Origin");
  if (request) {
    const cors = resolveAllowedOrigin(request, env);
    if (cors.present && cors.allowed && cors.origin) {
      headers.set("access-control-allow-origin", cors.origin);
    } else {
      headers.delete("access-control-allow-origin");
    }
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function serviceUnavailable(detail, request, env) {
  return jsonResponse(
    {
      ok: false,
      error: "Market service unavailable",
      code: "SERVICE_UNAVAILABLE",
      status: {
        provenance: PROVENANCE.UNAVAILABLE,
        asOf: Date.now(),
        detail,
      },
    },
    503,
    {
      "cache-control": "no-store",
      "x-provenance": PROVENANCE.UNAVAILABLE,
    },
    request,
    env
  );
}

async function readJsonBody(request, maxBytes) {
  const rawCl = request.headers.get("content-length");
  if (rawCl !== null) {
    const cl = Number(rawCl);
    if (!Number.isFinite(cl) || cl < 0) {
      return { ok: false, status: 400, error: "Invalid Content-Length header" };
    }
    if (cl > maxBytes) {
      return { ok: false, status: 413, error: `Request body too large (max ${maxBytes} bytes)` };
    }
  }

  let bytes;
  if (request.body && typeof request.body.getReader === "function") {
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        total += chunk.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // ignore cancel error
          }
          return { ok: false, status: 413, error: `Request body too large (max ${maxBytes} bytes)` };
        }
        chunks.push(chunk);
      }
    } catch {
      return { ok: false, status: 400, error: "Failed to read request body" };
    }
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
  } else {
    try {
      const ab = await request.arrayBuffer();
      if (ab.byteLength > maxBytes) {
        return { ok: false, status: 413, error: `Request body too large (max ${maxBytes} bytes)` };
      }
      bytes = new Uint8Array(ab);
    } catch {
      return { ok: false, status: 400, error: "Failed to read request body" };
    }
  }

  if (bytes.byteLength === 0) {
    return { ok: false, status: 400, error: "Invalid JSON body" };
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, status: 400, error: "Invalid UTF-8 in request body" };
  }

  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body" };
  }
}

function normalizeBarList(rawBars) {
  if (!Array.isArray(rawBars)) {
    return { ok: false, error: "Bars must be an array of OHLCV objects or [t, o, h, l, c, v] tuples" };
  }
  if (rawBars.length > MAX_CHART_BARS) {
    return { ok: false, error: `Bars array exceeds maximum length (${MAX_CHART_BARS})` };
  }
  const out = new Array(rawBars.length);
  for (let i = 0; i < rawBars.length; i++) {
    const b = rawBars[i];
    let t, o, h, l, c, v;
    if (Array.isArray(b)) {
      if (b.length < 5 || b.length > 6) {
        return { ok: false, error: `bars[${i}] tuple must have 5 or 6 elements` };
      }
      t = toStrictNumber(b[0]);
      o = toStrictNumber(b[1]);
      h = toStrictNumber(b[2]);
      l = toStrictNumber(b[3]);
      c = toStrictNumber(b[4]);
      v = b[5] !== undefined && b[5] !== null ? toStrictNumber(b[5]) : 0;
    } else if (isPlainObject(b)) {
      t = b.t !== undefined ? toStrictNumber(b.t) : toStrictNumber(b.time);
      o = b.o !== undefined ? toStrictNumber(b.o) : toStrictNumber(b.open);
      h = b.h !== undefined ? toStrictNumber(b.h) : toStrictNumber(b.high);
      l = b.l !== undefined ? toStrictNumber(b.l) : toStrictNumber(b.low);
      c = b.c !== undefined ? toStrictNumber(b.c) : toStrictNumber(b.close);
      v =
        b.v !== undefined && b.v !== null
          ? toStrictNumber(b.v)
          : b.volume !== undefined && b.volume !== null
            ? toStrictNumber(b.volume)
            : 0;
    } else {
      return { ok: false, error: `bars[${i}] must be an OHLCV object or tuple` };
    }

    if (
      !Number.isFinite(t) || t <= 0 ||
      !Number.isFinite(o) || o <= 0 ||
      !Number.isFinite(h) || h <= 0 ||
      !Number.isFinite(l) || l <= 0 ||
      !Number.isFinite(c) || c <= 0
    ) {
      return { ok: false, error: `bars[${i}] requires positive finite [t, o, h, l, c]` };
    }
    if (!Number.isFinite(v) || v < 0) {
      return { ok: false, error: `bars[${i}] volume must be a non-negative finite number` };
    }
    if (h < Math.max(o, c) || l > Math.min(o, c)) {
      return { ok: false, error: `bars[${i}] high/low must bracket open/close` };
    }

    out[i] = { t, o, h, l, c, v };
  }
  return { ok: true, bars: out };
}

function serializeFloatSeries(series) {
  if (!series || typeof series.length !== "number") return [];
  const out = new Array(series.length);
  for (let i = 0; i < series.length; i++) {
    const x = series[i];
    out[i] = typeof x === "number" && Number.isFinite(x) ? x : null;
  }
  return out;
}

async function handleMarketServiceForward(request, env) {
  if (!env || !env.MARKET_SERVICE || typeof env.MARKET_SERVICE.fetch !== "function") {
    return serviceUnavailable("Market service unavailable", request, env);
  }
  try {
    const res = await env.MARKET_SERVICE.fetch(request);
    return withCors(res, request, env);
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: "Market service upstream error",
        code: "UPSTREAM_ERROR",
        status: {
          provenance: PROVENANCE.UNAVAILABLE,
          asOf: Date.now(),
          detail: "Unable to reach market service",
        },
      },
      502,
      {
        "cache-control": "no-store",
        "x-provenance": PROVENANCE.UNAVAILABLE,
      },
      request,
      env
    );
  }
}

async function handleVsRun(request, env) {
  const errResp = (status, error, hint, extraHeaders = {}) =>
    jsonResponse(
      { ok: false, error, line: 0, col: 0, hint },
      status,
      { "cache-control": "no-store", ...extraHeaders },
      request,
      env
    );

  if (request.method !== "POST") {
    return errResp(405, "Method not allowed; use POST", "Send a POST request with JSON body { src, bars, inputs? }.", {
      allow: "POST, OPTIONS",
    });
  }

  const parsed = await readJsonBody(request, VS_RUN_MAX_BYTES);
  if (!parsed.ok) {
    return errResp(
      parsed.status,
      parsed.error,
      parsed.status === 413
        ? `Keep /api/vs/run request bodies under ${VS_RUN_MAX_BYTES} bytes.`
        : "Send a valid JSON object containing src and bars."
    );
  }

  const body = parsed.data;
  if (!isPlainObject(body)) {
    return errResp(400, "Request body must be a JSON object", "Send { src, bars, inputs? } as a JSON object.");
  }

  const src = body.src ?? body.script ?? body.code;
  if (typeof src !== "string" || src.trim().length === 0) {
    return errResp(
      400,
      "Script source (src) is required",
      'Provide a Vektor Script string in the src field, e.g. plot(ema(close, 20), "EMA 20").'
    );
  }
  if (src.length > VS_LIM.src) {
    return errResp(
      400,
      `Script source exceeds maximum length (${VS_LIM.src} chars)`,
      `Shorten the script to at most ${VS_LIM.src} characters.`
    );
  }

  const rawInputs = body.inputs !== undefined ? body.inputs : body.inp;
  const inputs = Object.create(null);
  if (rawInputs !== undefined && rawInputs !== null) {
    if (!isPlainObject(rawInputs)) {
      return errResp(400, "inputs must be a plain JSON object", "Pass script input overrides as a flat key/value object.");
    }
    const keys = Object.keys(rawInputs);
    if (keys.length > VS_MAX_INPUT_KEYS) {
      return errResp(
        400,
        `Too many script inputs (max ${VS_MAX_INPUT_KEYS})`,
        `Pass at most ${VS_MAX_INPUT_KEYS} input overrides.`
      );
    }
    for (const k of keys) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      inputs[k] = rawInputs[k];
    }
  }

  const rawSym = body.sym !== undefined ? body.sym : body.symbol;
  let sym;
  if (rawSym !== undefined && rawSym !== null) {
    if (typeof rawSym !== "string") {
      return errResp(400, "sym must be a valid uppercase symbol string", "Pass a symbol like BTCUSDT or EURUSD.");
    }
    const normalizedSym = rawSym.trim().toUpperCase();
    if (!normalizedSym || normalizedSym.includes("..") || !VS_SYMBOL_RE.test(normalizedSym)) {
      return errResp(400, "Invalid symbol format", "Symbol must match ^[A-Z0-9._/:=-]{1,24}$.");
    }
    sym = normalizedSym;
  }

  const rawTf = body.tf !== undefined ? body.tf : body.interval;
  let tf;
  if (rawTf !== undefined && rawTf !== null) {
    if (typeof rawTf !== "string") {
      return errResp(400, "tf must be an allowlisted timeframe string", "Use a supported timeframe such as 1m, 5m, 15m, 1H, 4H, 1D.");
    }
    const normalizedTf = rawTf.trim();
    if (!VS_ALLOWED_TFS.has(normalizedTf)) {
      return errResp(400, "Unsupported timeframe (tf)", "Use a supported timeframe such as 1m, 5m, 15m, 1H, 4H, 1D.");
    }
    tf = normalizedTf;
  }

  let limit;
  if (body.limit !== undefined && body.limit !== null) {
    const parsedLimit = toStrictNumber(body.limit);
    if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_CHART_BARS) {
      return errResp(
        400,
        `limit must be an integer between 1 and ${MAX_CHART_BARS}`,
        `Pass an integer limit in 1..${MAX_CHART_BARS}.`
      );
    }
    limit = parsedLimit;
  }

  let bars = null;
  if (body.bars !== undefined) {
    const norm = normalizeBarList(body.bars);
    if (!norm.ok) {
      return errResp(400, norm.error, "Pass up to 1500 valid OHLCV bars as [{ t, o, h, l, c, v }] or [[t, o, h, l, c, v]].");
    }
    bars = norm.bars;
  } else if (sym && tf && env && env.MARKET_SERVICE && typeof env.MARKET_SERVICE.fetch === "function") {
    try {
      const barsUrl = new URL("/api/bars", request.url);
      barsUrl.searchParams.set("symbol", sym);
      barsUrl.searchParams.set("tf", tf);
      if (limit !== undefined) barsUrl.searchParams.set("limit", String(limit));
      const bRes = await env.MARKET_SERVICE.fetch(new Request(barsUrl.toString(), { method: "GET" }));
      if (!bRes.ok) {
        return errResp(
          503,
          "Failed to load market bars for script execution",
          "Retry when market bars are available or include bars directly in the request body.",
          { "x-provenance": PROVENANCE.UNAVAILABLE }
        );
      }
      const bData = await bRes.json();
      const norm = normalizeBarList(bData && bData.bars);
      if (!norm.ok) {
        return errResp(
          502,
          "Market service returned invalid bar data",
          "Retry later or pass OHLCV bars directly in the request body.",
          { "x-provenance": PROVENANCE.UNAVAILABLE }
        );
      }
      bars = norm.bars;
    } catch {
      return errResp(
        502,
        "Market service unavailable while fetching bars",
        "Pass OHLCV bars directly or retry when the market service is available.",
        { "x-provenance": PROVENANCE.UNAVAILABLE }
      );
    }
  }

  if (!bars) {
    return errResp(
      400,
      "Bars array is required",
      "Provide OHLCV bars in the bars field or pass sym and tf to load market bars."
    );
  }

  let res;
  try {
    res = vsCompute(src, bars, { inputs, sym, tf });
  } catch {
    return errResp(500, "Script execution failed", "Verify script syntax and OHLCV inputs.");
  }

  if (res.error !== null) {
    return jsonResponse(
      {
        ok: false,
        error: res.error,
        line: res.line,
        col: res.col,
        hint: res.hint,
        key: res.key,
      },
      422,
      { "cache-control": "no-store" },
      request,
      env
    );
  }

  return jsonResponse(
    {
      ok: true,
      name: res.ok.name,
      overlay: res.ok.overlay,
      plots: res.ok.plots.map((p) => ({
        title: p.title,
        color: p.color,
        width: p.width,
        style: p.style,
        v: serializeFloatSeries(p.v),
      })),
      hlines: res.ok.hlines.map((h) => ({
        v: typeof h.v === "number" && Number.isFinite(h.v) ? h.v : null,
        title: h.title,
        color: h.color,
      })),
      inputs: res.ok.inputs,
      key: res.key,
      cached: res.cached,
    },
    200,
    { "cache-control": "no-store" },
    request,
    env
  );
}

async function handleJournalStats(request, env) {
  const errResp = (status, error, extraHeaders = {}) =>
    jsonResponse({ ok: false, error }, status, { "cache-control": "no-store", ...extraHeaders }, request, env);

  if (request.method !== "POST") {
    return errResp(405, "Method not allowed; use POST", { allow: "POST, OPTIONS" });
  }

  const parsed = await readJsonBody(request, JOURNAL_STATS_MAX_BYTES);
  if (!parsed.ok) {
    return errResp(parsed.status, parsed.error);
  }

  const body = parsed.data;
  if (!isPlainObject(body)) {
    return errResp(400, "Request body must be a JSON object");
  }

  if (!Array.isArray(body.trades)) {
    return errResp(400, "trades array is required");
  }

  if (body.trades.length > JOURNAL_MAX_TRADES) {
    return errResp(413, `Too many trades (max ${JOURNAL_MAX_TRADES})`);
  }

  const sanitizedTrades = new Array(body.trades.length);
  for (let i = 0; i < body.trades.length; i++) {
    const raw = body.trades[i];
    if (!isPlainObject(raw)) {
      return errResp(400, `trades[${i}] must be a plain object`);
    }

    let setup = "";
    if (raw.setup !== undefined && raw.setup !== null) {
      if (typeof raw.setup === "string") {
        if (raw.setup.length > JOURNAL_MAX_SETUP_LEN) {
          return errResp(400, `trades[${i}].setup exceeds maximum length (${JOURNAL_MAX_SETUP_LEN} chars)`);
        }
        setup = raw.setup;
      } else if (typeof raw.setup === "number" || typeof raw.setup === "boolean") {
        setup = String(raw.setup).slice(0, JOURNAL_MAX_SETUP_LEN);
      } else {
        return errResp(400, `trades[${i}].setup must be a string`);
      }
    }

    sanitizedTrades[i] = { ...raw, setup };
  }

  let startBal = 0;
  if (body.startBal !== undefined && body.startBal !== null) {
    const sb = toStrictNumber(body.startBal);
    if (!Number.isFinite(sb)) {
      return errResp(400, "startBal must be a finite number");
    }
    startBal = sb;
  }

  let bucketSize;
  if (body.bucketSize !== undefined && body.bucketSize !== null) {
    const bs = toStrictNumber(body.bucketSize);
    if (!Number.isFinite(bs) || bs < JOURNAL_BUCKET_MIN || bs > JOURNAL_BUCKET_MAX) {
      return errResp(
        400,
        `bucketSize must be a finite number between ${JOURNAL_BUCKET_MIN} and ${JOURNAL_BUCKET_MAX}`
      );
    }
    bucketSize = bs;
  }

  if (body.today !== undefined && body.today !== null) {
    if (typeof body.today !== "string" || body.today.length > 32) {
      return errResp(400, "today must be a string <= 32 chars");
    }
  }

  let propCfg = null;
  if (body.prop !== undefined && body.prop !== null) {
    if (!isPlainObject(body.prop)) {
      return errResp(400, "prop must be a plain object");
    }
    const acct = toStrictNumber(body.prop.acct);
    if (!Number.isFinite(acct) || acct <= 0) {
      return errResp(400, "prop.acct must be a positive finite number");
    }
    for (const field of ["dailyDD", "maxDD", "target"]) {
      if (body.prop[field] !== undefined && body.prop[field] !== null) {
        const val = toStrictNumber(body.prop[field]);
        if (!Number.isFinite(val) || val < 0) {
          return errResp(400, `prop.${field} must be a non-negative finite number`);
        }
      }
    }
    propCfg = { ...body.prop, acct };
  }

  let accountCfg = null;
  if (body.account !== undefined && body.account !== null) {
    if (!isPlainObject(body.account)) {
      return errResp(400, "account must be a plain object");
    }
    if (body.account.size !== undefined && body.account.size !== null) {
      const sz = toStrictNumber(body.account.size);
      if (!Number.isFinite(sz) || sz <= 0) {
        return errResp(400, "account.size must be a positive finite number");
      }
    }
    accountCfg = body.account;
  }

  const calendarOpts = isPlainObject(body.calendar) ? body.calendar : {};

  try {
    const stats = tradeStats(sanitizedTrades, startBal);
    const journal = jrStats(sanitizedTrades);
    const curve = equityCurve(sanitizedTrades, startBal);
    const drawdown = drawdownSeries(sanitizedTrades, startBal);
    const rDist = rDistribution(sanitizedTrades, bucketSize !== undefined ? { bucketSize } : {});
    const calendar = dailyPnlCalendar(sanitizedTrades, calendarOpts);

    const payload = {
      ok: true,
      stats,
      journal,
      equityCurve: curve,
      drawdown,
      rDistribution: rDist,
      calendar,
    };

    if (propCfg) {
      payload.prop = propStatus(sanitizedTrades, propCfg, body.today);
    }
    if (accountCfg) {
      payload.account = jrProp(accountCfg, sanitizedTrades, body.today);
    }

    return jsonResponse(payload, 200, { "cache-control": "no-store" }, request, env);
  } catch {
    return errResp(500, "Failed to compute journal statistics");
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  // Handle CORS preflight with strict Origin validation
  if (request.method === "OPTIONS") {
    const cors = resolveAllowedOrigin(request, env);
    if (cors.present && !cors.allowed) {
      return jsonResponse(
        { ok: false, error: "Origin not allowed", code: "FORBIDDEN_ORIGIN" },
        403,
        { "cache-control": "no-store" },
        request,
        env
      );
    }
    const headers = {
      vary: "Origin",
      "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization",
    };
    if (cors.origin) {
      headers["access-control-allow-origin"] = cors.origin;
    }
    return new Response(null, { status: 204, headers });
  }

  // Same-origin front-door routes
  if (pathname === "/api/waitlist" || pathname === "/api/admin/waitlist") {
    const waitlistRes = await handleWaitlistRoute(request, env);
    if (waitlistRes) {
      return withCors(waitlistRes, request, env);
    }
  }
  if (
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/me/data" ||
    pathname.startsWith("/api/me/data/") ||
    pathname === "/api/me/import" ||
    pathname === "/api/admin/users" ||
    pathname.startsWith("/api/admin/users/")
  ) {
    const authRes = await handleAuthRoute(request, env);
    if (authRes) {
      return withCors(authRes, request, env);
    }
  }
  if (MARKET_SERVICE_PATHS.has(pathname)) {
    return handleMarketServiceForward(request, env);
  }
  if (pathname === "/api/vs/run") {
    return handleVsRun(request, env);
  }
  if (pathname === "/api/journal/stats") {
    return handleJournalStats(request, env);
  }

  // Ensure secrets / environment bindings are passed correctly from Cloudflare secrets
  const safeEnv = env || {};
  const augmentedEnv = {
    ...safeEnv,
    TWELVEDATA_KEY: safeEnv.TWELVEDATA_KEY || safeEnv.TWELVE_DATA_API_KEY || "",
    FINNHUB_API_KEY: safeEnv.FINNHUB_API_KEY || safeEnv.FINNHUB_KEY || "",
  };

  // Forward legacy /api/screener, /api/candles, /api/calendar, /api/news, etc. to worker.js
  try {
    const res = await worker.fetch(request, augmentedEnv, context);
    return withCors(res, request, env);
  } catch {
    // Never echo raw exception strings that may contain upstream URLs or secret query params.
    return jsonResponse(
      { ok: false, error: "API delegation error" },
      500,
      { "cache-control": "no-store" },
      request,
      env
    );
  }
}
