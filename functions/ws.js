// functions/ws.js — Cloudflare Pages Function handling same-origin GET /ws WebSocket upgrades.
// Validates browser Origin against same-origin + env.ALLOWED_ORIGINS (CSWSH defense),
// forwards upgrades cleanly via Cloudflare Service Binding `env.MARKET_SERVICE.fetch(request)`
// to the `vektor-market` Worker / MarketHub DO, or returns a clean 503 JSON response with
// Protocol v2 provenance (`UNAVAILABLE`) when the service binding is not yet configured.

import { PROVENANCE } from "../shared/protocol.js";

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

function jsonResponse(payload, status, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      vary: "Origin",
      ...extraHeaders,
    },
  });
}

export async function onRequest(context) {
  const { request, env } = context || {};
  if (!request) {
    return jsonResponse(
      {
        ok: false,
        error: "Invalid request context",
        code: "INVALID_REQUEST",
        status: { provenance: PROVENANCE.UNAVAILABLE, asOf: Date.now() },
      },
      400
    );
  }

  const originCheck = resolveAllowedOrigin(request, env);

  if (request.method === "OPTIONS") {
    if (originCheck.present && !originCheck.allowed) {
      return jsonResponse(
        {
          ok: false,
          error: "Origin not allowed",
          code: "FORBIDDEN_ORIGIN",
          status: { provenance: PROVENANCE.UNAVAILABLE, asOf: Date.now() },
        },
        403
      );
    }
    const headers = {
      vary: "Origin",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers":
        "Content-Type, Authorization, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version, Sec-WebSocket-Protocol",
    };
    if (originCheck.origin) {
      headers["access-control-allow-origin"] = originCheck.origin;
    }
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "GET") {
    return jsonResponse(
      {
        ok: false,
        error: "Method not allowed; WebSocket upgrade requires GET",
        code: "METHOD_NOT_ALLOWED",
        status: { provenance: PROVENANCE.UNAVAILABLE, asOf: Date.now() },
      },
      405,
      { allow: "GET, OPTIONS" }
    );
  }

  // Reject disallowed browser origins (CSWSH protection) before upgrade forwarding.
  if (originCheck.present && !originCheck.allowed) {
    return jsonResponse(
      {
        ok: false,
        error: "Origin not allowed",
        code: "FORBIDDEN_ORIGIN",
        status: { provenance: PROVENANCE.UNAVAILABLE, asOf: Date.now() },
      },
      403
    );
  }

  const upgrade = (request.headers.get("Upgrade") || "").toLowerCase();
  if (upgrade !== "websocket") {
    return jsonResponse(
      {
        ok: false,
        error: "Expected WebSocket upgrade",
        code: "UPGRADE_REQUIRED",
        status: { provenance: PROVENANCE.UNAVAILABLE, asOf: Date.now() },
      },
      426,
      { upgrade: "websocket" }
    );
  }

  if (!env || !env.MARKET_SERVICE || typeof env.MARKET_SERVICE.fetch !== "function") {
    return jsonResponse(
      {
        ok: false,
        error: "Market service unavailable",
        code: "SERVICE_UNAVAILABLE",
        status: {
          provenance: PROVENANCE.UNAVAILABLE,
          asOf: Date.now(),
          detail: "Market WebSocket service unavailable",
        },
      },
      503,
      { "x-provenance": PROVENANCE.UNAVAILABLE }
    );
  }

  try {
    // Return the service-binding response directly so 101 Switching Protocols + .webSocket remain intact.
    return await env.MARKET_SERVICE.fetch(request);
  } catch {
    // Never leak upstream URLs, headers, internal binding names, secrets, or stack traces.
    return jsonResponse(
      {
        ok: false,
        error: "Market WebSocket upstream error",
        code: "UPSTREAM_ERROR",
        status: {
          provenance: PROVENANCE.UNAVAILABLE,
          asOf: Date.now(),
          detail: "Unable to reach market WebSocket service",
        },
      },
      502,
      { "x-provenance": PROVENANCE.UNAVAILABLE }
    );
  }
}

export const onRequestGet = onRequest;
