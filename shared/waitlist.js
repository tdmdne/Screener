// shared/waitlist.js — Pre-launch waitlist signup & admin listing routes.
// Pure Cloudflare Workers + Node 22+ ES module. 100% parameterized SQL, zero Node-only imports.

import { validateEmail } from "./emailValidator.js";
import {
  SESSION_COOKIE_NAME,
  getSessionUser,
  normalizeCanonicalEmail,
  parseCookies,
  sha256Hex,
} from "./auth.js";
import { readBoundedJson, verifyCsrfOrigin } from "./authRoutes.js";

export const WAITLIST_MAX_BYTES = 8 * 1024; // 8 KB
export const WAITLIST_RATE_LIMIT_MAX = 10;
export const WAITLIST_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const WAITLIST_MAX_SOURCE_LEN = 64;

const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g;
const WAITLIST_SUCCESS_MESSAGE = "You're on the waitlist.";

// Lightweight in-memory sliding window fallback when login_attempts table is unavailable.
const memoryRateWindows = new Map();

function jsonResponse(body, status = 200, extraHeaders = null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      if (v !== undefined && v !== null) {
        headers.set(k, String(v));
      }
    }
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function getClientIp(request) {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp.trim();
  const xff = request.headers.get("X-Forwarded-For");
  if (xff) return xff.split(",")[0].trim();
  return null;
}

function sanitizeSource(rawSource) {
  if (typeof rawSource !== "string") return "landing";
  const cleaned = rawSource.replace(CONTROL_CHARS_RE, "").trim().slice(0, WAITLIST_MAX_SOURCE_LEN);
  return cleaned || "landing";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Clears in-memory waitlist rate-limit buckets (for tests).
 */
export function resetWaitlistRateLimitMemory() {
  memoryRateWindows.clear();
}

/**
 * Enforces per-IP rate limiting for waitlist signups.
 * Uses D1 `login_attempts` table when present; gracefully falls back to in-memory window.
 */
async function enforceWaitlistRateLimit(db, ip, nowMs, { maxRequests = WAITLIST_RATE_LIMIT_MAX, windowMs = WAITLIST_RATE_LIMIT_WINDOW_MS } = {}) {
  if (!ip) return { allowed: true, retryAfterSec: 0 };
  const ipHash = await sha256Hex(String(ip));
  const rateKey = `waitlist:ip:${ipHash}`;

  // Try D1-backed atomic counter first (shared across edge isolates when table exists)
  try {
    const existing = await db
      .prepare("SELECT count, window_start, locked_until FROM login_attempts WHERE key = ?")
      .bind(rateKey)
      .first();

    if (existing && existing.locked_until && existing.locked_until > nowMs) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((existing.locked_until - nowMs) / 1000)),
      };
    }

    const windowExpired = !existing || nowMs - existing.window_start > windowMs;
    const nextCount = windowExpired ? 1 : existing.count + 1;
    const nextWindowStart = windowExpired ? nowMs : existing.window_start;
    const nextLockedUntil = nextCount > maxRequests ? nextWindowStart + windowMs : null;

    await db
      .prepare(
        `INSERT INTO login_attempts (key, count, window_start, locked_until)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           count = excluded.count,
           window_start = excluded.window_start,
           locked_until = excluded.locked_until`
      )
      .bind(rateKey, nextCount, nextWindowStart, nextLockedUntil)
      .run();

    if (nextCount > maxRequests) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((nextWindowStart + windowMs - nowMs) / 1000)),
      };
    }
    return { allowed: true, retryAfterSec: 0 };
  } catch {
    // Fallback to in-memory sliding window if login_attempts table is not migrated in an isolated DB
    const entry = memoryRateWindows.get(rateKey);
    if (!entry || nowMs - entry.windowStart > windowMs) {
      memoryRateWindows.set(rateKey, { count: 1, windowStart: nowMs });
      return { allowed: true, retryAfterSec: 0 };
    }
    entry.count += 1;
    if (entry.count > maxRequests) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((entry.windowStart + windowMs - nowMs) / 1000)),
      };
    }
    return { allowed: true, retryAfterSec: 0 };
  }
}

/**
 * Validates and registers an email onto the pre-launch waitlist.
 * Deduplicates by canonical_email (stripping +tags) with idempotent friendly success
 * so callers cannot enumerate whether an address was previously submitted.
 */
export async function joinWaitlist(db, { email, source } = {}, { ip = null, nowMs = Date.now(), rateLimit } = {}) {
  const rate = await enforceWaitlistRateLimit(db, ip, nowMs, rateLimit);
  if (!rate.allowed) {
    return {
      ok: false,
      status: 429,
      error: "Too many waitlist requests. Please try again later.",
      retryAfterSec: rate.retryAfterSec,
    };
  }

  const check = validateEmail(email);
  if (!check.ok) {
    return { ok: false, status: 400, error: check.error };
  }

  const canonical = normalizeCanonicalEmail(check.email);
  if (!canonical) {
    return { ok: false, status: 400, error: "Email local part cannot start with '+'." };
  }

  const normalizedEmail = check.email.toLowerCase();
  const safeSource = sanitizeSource(source);

  const existing = await db
    .prepare("SELECT id FROM waitlist WHERE canonical_email = ? OR email = ?")
    .bind(canonical, normalizedEmail)
    .first();

  if (existing) {
    return {
      ok: true,
      status: 200,
      message: WAITLIST_SUCCESS_MESSAGE,
    };
  }

  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        "INSERT INTO waitlist (id, email, canonical_email, source, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(id, normalizedEmail, canonical, safeSource, nowMs)
      .run();
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (msg.includes("UNIQUE") || msg.includes("constraint")) {
      return {
        ok: true,
        status: 200,
        message: WAITLIST_SUCCESS_MESSAGE,
      };
    }
    throw err;
  }

  return {
    ok: true,
    status: 200,
    message: WAITLIST_SUCCESS_MESSAGE,
  };
}

/**
 * Lists waitlist entries for authenticated administrators only.
 */
export async function listWaitlistAdmin(db, adminUser, { limit = 50, offset = 0 } = {}) {
  if (!adminUser || adminUser.role !== "admin" || adminUser.disabled_at != null) {
    return { ok: false, status: 403, error: "Forbidden." };
  }

  const safeLimit = Math.min(200, Math.max(1, Number.isInteger(limit) ? limit : 50));
  const safeOffset = Math.max(0, Number.isInteger(offset) ? offset : 0);

  const [listRes, countRow] = await Promise.all([
    db
      .prepare(
        `SELECT id, email, canonical_email, source, created_at
           FROM waitlist
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?`
      )
      .bind(safeLimit, safeOffset)
      .all(),
    db.prepare("SELECT COUNT(*) AS total FROM waitlist").first(),
  ]);

  const rows = Array.isArray(listRes?.results) ? listRes.results : [];
  return {
    ok: true,
    status: 200,
    entries: rows.map((row) => ({
      id: row.id,
      email: row.email,
      canonical_email: row.canonical_email,
      source: row.source ?? null,
      created_at: row.created_at,
    })),
    total: Number(countRow?.total ?? rows.length),
    limit: safeLimit,
    offset: safeOffset,
  };
}

/**
 * HTTP route handler for:
 *   - POST /api/waitlist
 *   - GET  /api/admin/waitlist
 * Returns null for non-matching paths so it composes cleanly in functions/api/[[path]].js.
 */
export async function handleWaitlistRoute(request, env, options = {}) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname !== "/api/waitlist" && pathname !== "/api/admin/waitlist") {
    return null;
  }

  const db = env && env.DB;
  if (!db) {
    return jsonResponse({ ok: false, error: "Waitlist database is not configured." }, 503);
  }

  const method = request.method.toUpperCase();
  const nowMs = typeof options.nowMs === "function" ? options.nowMs() : Date.now();

  if (pathname === "/api/waitlist") {
    if (method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed." }, 405, { Allow: "POST" });
    }

    const csrf = verifyCsrfOrigin(request, url, env);
    if (!csrf.ok) {
      return jsonResponse({ ok: false, error: csrf.error }, 403);
    }

    const bodyRes = await readBoundedJson(request, WAITLIST_MAX_BYTES);
    if (!bodyRes.ok) {
      return jsonResponse({ ok: false, error: bodyRes.error }, bodyRes.status);
    }
    if (!isPlainObject(bodyRes.data)) {
      return jsonResponse({ ok: false, error: "Invalid request payload." }, 400);
    }

    const ip = getClientIp(request);
    const result = await joinWaitlist(
      db,
      { email: bodyRes.data.email, source: bodyRes.data.source },
      { ip, nowMs, rateLimit: options.rateLimit }
    );

    if (!result.ok) {
      const extraHeaders = result.retryAfterSec ? { "Retry-After": result.retryAfterSec } : null;
      return jsonResponse({ ok: false, error: result.error }, result.status, extraHeaders);
    }

    return jsonResponse({ ok: true, message: result.message }, result.status);
  }

  // GET /api/admin/waitlist
  if (method !== "GET") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405, { Allow: "GET" });
  }

  const cookies = parseCookies(request.headers.get("Cookie"));
  const sessionToken = cookies[SESSION_COOKIE_NAME] || null;
  const user = await getSessionUser(db, sessionToken, { nowMs });
  if (!user) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }

  const rawLimit = url.searchParams.get("limit");
  const rawOffset = url.searchParams.get("offset");
  const parsedLimit = rawLimit !== null ? Number(rawLimit) : 50;
  const parsedOffset = rawOffset !== null ? Number(rawOffset) : 0;

  const result = await listWaitlistAdmin(db, user, {
    limit: Number.isInteger(parsedLimit) ? parsedLimit : 50,
    offset: Number.isInteger(parsedOffset) ? parsedOffset : 0,
  });

  if (!result.ok) {
    return jsonResponse({ ok: false, error: result.error }, result.status);
  }

  return jsonResponse(
    {
      ok: true,
      entries: result.entries,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    },
    200
  );
}
