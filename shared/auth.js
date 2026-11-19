// shared/auth.js — Server-side authentication, profile validation, Web Crypto PBKDF2,
// D1 sessions, brute-force lockout, IDOR-proof user data isolation, Admin RBAC, and OAuth2/OIDC helpers.
// Pure Cloudflare Workers + Node 22+ Web Crypto ES module. Zero Node-only imports, zero hardcoded secrets.

import { validateEmail } from "./emailValidator.js";

export const SESSION_COOKIE_NAME = "vk_session";
export const OAUTH_STATE_COOKIE_NAME = "vt_oauth_state";
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const PBKDF2_ITERATIONS = 100_000; // Cloudflare Workers Web Crypto max
export const PBKDF2_SALT_BYTES = 16;
export const PBKDF2_HASH_BYTES = 32;
export const SESSION_TOKEN_BYTES = 32; // 256-bit
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const LOCKOUT_MAX_FAILS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_PAYLOAD_BYTES = 512 * 1024; // 512 KB
export const TERMS_VERSION = "2026-11";
export const VERIFICATION_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const VERIFICATION_RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
export const VERIFICATION_HOURLY_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const VERIFICATION_HOURLY_MAX = 5;
export const VERIFICATION_MAX_ATTEMPTS = 5;

export const ALLOWED_NAMESPACES = Object.freeze([
  "watchlists",
  "alerts",
  "drawings",
  "scripts",
  "journal",
  "layouts",
]);
const ALLOWED_NAMESPACE_SET = new Set(ALLOWED_NAMESPACES);

export const ALLOWED_ROLES = Object.freeze(["user", "admin"]);
export const ALLOWED_PLANS = Object.freeze(["free", "pro", "elite"]);
export const ALLOWED_OAUTH_PROVIDERS = Object.freeze(["google", "apple"]);
export const ALLOWED_VERIFICATION_CHANNELS = Object.freeze(["email", "phone"]);

const ALLOWED_ROLE_SET = new Set(ALLOWED_ROLES);
const ALLOWED_PLAN_SET = new Set(ALLOWED_PLANS);
const ALLOWED_OAUTH_PROVIDER_SET = new Set(ALLOWED_OAUTH_PROVIDERS);
const ALLOWED_VERIFICATION_CHANNEL_SET = new Set(ALLOWED_VERIFICATION_CHANNELS);

const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;
const DOB_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PHONE_E164_RE = /^\+[1-9]\d{6,14}$/;
const OTP_CODE_RE = /^\d{6}$/;
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/;

const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "help",
  "vektor",
  "vektorterminal",
  "moderator",
  "mod",
  "staff",
  "official",
  "security",
  "api",
  "auth",
  "login",
  "logout",
  "register",
  "signup",
  "signin",
  "account",
  "accounts",
  "settings",
  "profile",
  "billing",
  "pricing",
  "terms",
  "privacy",
  "about",
  "status",
  "null",
  "undefined",
  "me",
  "owner",
  "founder",
  "ceo",
  "dev",
  "ops",
  "bot",
  "test",
  "guest",
  "anonymous",
  "public",
  "private",
  "internal",
  "oauth",
  "callback",
  "webhook",
  "webhooks",
  "health",
  "metrics",
]);

const WEAK_PASSWORDS = new Set([
  "password123",
  "password1234",
  "password123!",
  "passw0rd123",
  "p@ssword123",
  "qwerty1234",
  "qwerty12345",
  "1234567890",
  "123456789a",
  "admin12345",
  "admin123456",
  "welcome123",
  "welcome1234",
  "letmein123",
  "letmein1234",
  "iloveyou123",
  "changeme123",
  "vektor1234",
  "trading123",
  "abc1234567",
  "football123",
  "monkey1234",
  "dragon1234",
  "master1234",
  "superman123",
  "trustno123",
  "aa12345678",
]);

// Pre-formatted valid PBKDF2 hash used for constant-time anti-enumeration when an account is not found.
const DUMMY_PASSWORD_HASH =
  "pbkdf2_sha256$100000$00112233445566778899aabbccddeeff$00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Encoding & Web Crypto primitives (zero Node Buffer dependencies)
// ---------------------------------------------------------------------------

export function bytesToHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

export function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(str) {
  if (typeof str !== "string" || !/^[A-Za-z0-9_-]*$/.test(str)) return null;
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

export function randomBytes(length) {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

export async function sha256Bytes(input) {
  const data = typeof input === "string" ? encoder.encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

export async function sha256Hex(input) {
  return bytesToHex(await sha256Bytes(input));
}

export async function sha256Base64Url(input) {
  return bytesToBase64Url(await sha256Bytes(input));
}

export function constantTimeEqual(a, b) {
  const bufA = typeof a === "string" ? encoder.encode(a) : a;
  const bufB = typeof b === "string" ? encoder.encode(b) : b;
  if (!(bufA instanceof Uint8Array) || !(bufB instanceof Uint8Array)) return false;
  const maxLen = Math.max(bufA.length, bufB.length);
  let diff = bufA.length ^ bufB.length;
  for (let i = 0; i < maxLen; i++) {
    const x = i < bufA.length ? bufA[i] : 0;
    const y = i < bufB.length ? bufB[i] : 0;
    diff |= x ^ y;
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Password hashing (PBKDF2-SHA256, 100_000 iterations, 16-byte random salt)
// ---------------------------------------------------------------------------

export async function hashPassword(password, saltBytes = randomBytes(PBKDF2_SALT_BYTES)) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    PBKDF2_HASH_BYTES * 8
  );
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${bytesToHex(saltBytes)}$${bytesToHex(new Uint8Array(derived))}`;
}

export async function verifyPassword(password, storedHash) {
  if (typeof password !== "string" || typeof storedHash !== "string") return false;
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < PBKDF2_ITERATIONS || iterations > 1_000_000) {
    return false;
  }
  const saltBytes = hexToBytes(parts[2]);
  const expectedBytes = hexToBytes(parts[3]);
  if (!saltBytes || !expectedBytes || saltBytes.length < 16 || expectedBytes.length !== PBKDF2_HASH_BYTES) {
    return false;
  }
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    PBKDF2_HASH_BYTES * 8
  );
  return constantTimeEqual(new Uint8Array(derived), expectedBytes);
}

// ---------------------------------------------------------------------------
// Strict Validators
// ---------------------------------------------------------------------------

/**
 * Strips +tags on EVERY domain and lowercases the address.
 * Returns null if the input is not a valid email or has an empty base local part.
 */
export function normalizeCanonicalEmail(rawEmail) {
  const check = validateEmail(rawEmail);
  if (!check.ok) return null;
  const lower = check.email.toLowerCase();
  const at = lower.indexOf("@");
  const local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  const plus = local.indexOf("+");
  const baseLocal = plus === -1 ? local : local.slice(0, plus);
  if (!baseLocal) return null;
  return `${baseLocal}@${domain}`;
}

export function validateAndNormalizeEmail(rawEmail) {
  const check = validateEmail(rawEmail);
  if (!check.ok) return check;
  const canonical = normalizeCanonicalEmail(check.email);
  if (!canonical) {
    return { ok: false, error: "Email local part cannot start with '+'." };
  }
  return { ok: true, email: check.email.toLowerCase(), canonical };
}

export function validateFullName(value) {
  if (typeof value !== "string") return { ok: false, error: "Full name is required." };
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 100) {
    return { ok: false, error: "Full name must be between 2 and 100 characters." };
  }
  if (CONTROL_CHARS_RE.test(trimmed)) {
    return { ok: false, error: "Full name contains invalid characters." };
  }
  if (trimmed.replace(/\s+/g, "").length < 2) {
    return { ok: false, error: "Full name must contain at least 2 non-space characters." };
  }
  return { ok: true, value: trimmed };
}

export function validateUsername(value) {
  if (typeof value !== "string") return { ok: false, error: "Username is required." };
  const trimmed = value.trim();
  if (!USERNAME_RE.test(trimmed)) {
    return {
      ok: false,
      error: "Username must be 3–24 characters using letters, numbers, and underscores only.",
    };
  }
  const lower = trimmed.toLowerCase();
  if (RESERVED_USERNAMES.has(lower)) {
    return { ok: false, error: "That username is reserved." };
  }
  return { ok: true, value: trimmed, lower };
}

export function validateDob(value, nowMs = Date.now()) {
  if (typeof value !== "string") return { ok: false, error: "Date of birth is required." };
  const trimmed = value.trim();
  const match = DOB_RE.exec(trimmed);
  if (!match) {
    return { ok: false, error: "Date of birth must be in YYYY-MM-DD format." };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return { ok: false, error: "Date of birth is not a valid calendar date." };
  }

  const now = new Date(nowMs);
  let age = now.getUTCFullYear() - year;
  const monthDiff = now.getUTCMonth() + 1 - month;
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < day)) {
    age -= 1;
  }
  if (age < 18) {
    return { ok: false, error: "You must be at least 18 years old." };
  }
  if (age > 120) {
    return { ok: false, error: "Date of birth is out of valid range." };
  }
  return { ok: true, value: trimmed };
}

export function validatePhone(value) {
  if (typeof value !== "string") return { ok: false, error: "Phone number is required." };
  const trimmed = value.trim();
  if (!PHONE_E164_RE.test(trimmed)) {
    return {
      ok: false,
      error: "Phone number must be in strict E.164 format (e.g. +14155552671).",
    };
  }
  return { ok: true, value: trimmed };
}

export function validatePassword(value) {
  if (typeof value !== "string") return { ok: false, error: "Password is required." };
  if (value.length < 10 || value.length > 128) {
    return { ok: false, error: "Password must be between 10 and 128 characters." };
  }
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/[0-9]/.test(value)) {
    return {
      ok: false,
      error: "Password must include at least one uppercase letter, one lowercase letter, and one digit.",
    };
  }
  const lower = value.toLowerCase();
  if (WEAK_PASSWORDS.has(lower)) {
    return { ok: false, error: "That password is too common. Choose a stronger password." };
  }
  // Reject trivial all-repeated patterns (e.g., Aaaaaaaa11)
  if (new Set(lower).size < 4) {
    return { ok: false, error: "Password must have more character variety." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cookie & Sanitization Helpers
// ---------------------------------------------------------------------------

export function parseCookies(cookieHeader) {
  const out = Object.create(null);
  if (typeof cookieHeader !== "string" || !cookieHeader) return out;
  const parts = cookieHeader.split(";");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (name && !(name in out)) {
      out[name] = val;
    }
  }
  return out;
}

export function buildSessionCookie(token, { secure = true, maxAgeSec = Math.floor(SESSION_TTL_MS / 1000) } = {}) {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
}

export function buildClearSessionCookie({ secure = true } = {}) {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? "; Secure" : ""}`;
}

export function buildOAuthStateCookie(
  state,
  { secure = true, sameSite = "Lax", maxAgeSec = Math.floor(OAUTH_STATE_TTL_MS / 1000) } = {}
) {
  return `${OAUTH_STATE_COOKIE_NAME}=${state}; HttpOnly; SameSite=${sameSite}; Path=/api/auth/oauth; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
}

export function buildClearOAuthStateCookie({ secure = true, sameSite = "Lax" } = {}) {
  return `${OAUTH_STATE_COOKIE_NAME}=; HttpOnly; SameSite=${sameSite}; Path=/api/auth/oauth; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? "; Secure" : ""}`;
}

export function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name ?? null,
    username: row.username ?? null,
    dob: row.dob ?? null,
    phone: row.phone ?? null,
    profile_completed: Boolean(row.profile_completed),
    email_verified: Boolean(row.email_verified_at),
    phone_verified: Boolean(row.phone_verified_at),
    terms_accepted_at: row.terms_accepted_at ?? null,
    terms_version: row.terms_version ?? null,
    role: row.role,
    plan: row.plan,
    created_at: row.created_at,
    updated_at: row.updated_at,
    disabled_at: row.disabled_at ?? null,
  };
}

export function sanitizeAdminUser(row) {
  if (!row) return null;
  // Explicitly omits password_hash, phone, and dob for admin listing privacy.
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name ?? null,
    username: row.username ?? null,
    profile_completed: Boolean(row.profile_completed),
    role: row.role,
    plan: row.plan,
    created_at: row.created_at,
    updated_at: row.updated_at,
    disabled_at: row.disabled_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function generateSessionToken() {
  return bytesToBase64Url(randomBytes(SESSION_TOKEN_BYTES));
}

export async function createSession(db, userId, { ip = null, ua = null, nowMs = Date.now() } = {}) {
  const token = generateSessionToken();
  const tokenHash = await sha256Hex(token);
  const ipHash = typeof ip === "string" && ip ? await sha256Hex(ip) : null;
  const safeUa = typeof ua === "string" ? ua.slice(0, 256) : null;
  const expiresAt = nowMs + SESSION_TTL_MS;

  await db
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, ip_hash, ua) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(tokenHash, userId, nowMs, expiresAt, nowMs, ipHash, safeUa)
    .run();

  return { token, expiresAt };
}

export async function getSessionUser(db, token, { nowMs = Date.now() } = {}) {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.username, u.dob, u.phone,
              u.profile_completed, u.terms_accepted_at, u.terms_version,
              u.email_verified_at, u.phone_verified_at,
              u.role, u.plan, u.created_at, u.updated_at, u.disabled_at,
              s.expires_at AS session_expires_at, s.last_seen_at AS session_last_seen_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`
    )
    .bind(tokenHash)
    .first();

  if (!row) return null;
  if (row.session_expires_at <= nowMs) {
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  if (row.disabled_at != null) {
    return null;
  }

  if (nowMs - row.session_last_seen_at > 60_000) {
    await db
      .prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?")
      .bind(nowMs, tokenHash)
      .run();
  }

  return sanitizeUser(row);
}

export async function revokeSession(db, token) {
  if (typeof token !== "string" || !token) return;
  const tokenHash = await sha256Hex(token);
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export async function revokeAllUserSessions(db, userId) {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

// ---------------------------------------------------------------------------
// Brute-force Lockout (5 fails / 15 min -> 15 min 429)
// ---------------------------------------------------------------------------

export async function checkLoginLockout(db, keys, nowMs = Date.now()) {
  let maxRetryAfterSec = 0;
  for (let i = 0; i < keys.length; i++) {
    const row = await db
      .prepare("SELECT count, window_start, locked_until FROM login_attempts WHERE key = ?")
      .bind(keys[i])
      .first();
    if (row && row.locked_until && row.locked_until > nowMs) {
      const retryAfterSec = Math.max(1, Math.ceil((row.locked_until - nowMs) / 1000));
      if (retryAfterSec > maxRetryAfterSec) maxRetryAfterSec = retryAfterSec;
    }
  }
  return maxRetryAfterSec > 0
    ? { locked: true, retryAfterSec: maxRetryAfterSec }
    : { locked: false, retryAfterSec: 0 };
}

export async function recordLoginFailure(db, keys, nowMs = Date.now()) {
  const lockedUntilOnLimit = nowMs + LOCKOUT_DURATION_MS;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    await db
      .prepare(
        `INSERT INTO login_attempts (key, count, window_start, locked_until)
         VALUES (?, 1, ?, NULL)
         ON CONFLICT(key) DO UPDATE SET
           count = CASE
             WHEN (? - login_attempts.window_start) > ? THEN 1
             ELSE login_attempts.count + 1
           END,
           window_start = CASE
             WHEN (? - login_attempts.window_start) > ? THEN ?
             ELSE login_attempts.window_start
           END,
           locked_until = CASE
             WHEN (CASE
                     WHEN (? - login_attempts.window_start) > ? THEN 1
                     ELSE login_attempts.count + 1
                   END) >= ? THEN ?
             ELSE NULL
           END`
      )
      .bind(
        key,
        nowMs,
        nowMs,
        LOCKOUT_WINDOW_MS,
        nowMs,
        LOCKOUT_WINDOW_MS,
        nowMs,
        nowMs,
        LOCKOUT_WINDOW_MS,
        LOCKOUT_MAX_FAILS,
        lockedUntilOnLimit
      )
      .run();
  }
}

export async function clearLoginAttempts(db, keys) {
  for (let i = 0; i < keys.length; i++) {
    await db.prepare("DELETE FROM login_attempts WHERE key = ?").bind(keys[i]).run();
  }
}

// ---------------------------------------------------------------------------
// Admin Bootstrap & RBAC
// ---------------------------------------------------------------------------

export function resolveBootstrapRole(canonicalEmail, env, bootstrapSecret) {
  if (!env || typeof env.ADMIN_EMAIL !== "string" || typeof env.ADMIN_BOOTSTRAP_SECRET !== "string") {
    return "user";
  }
  if (env.ADMIN_BOOTSTRAP_SECRET.length < 16) return "user";
  if (typeof bootstrapSecret !== "string" || bootstrapSecret.length === 0) return "user";

  const adminCanonical = normalizeCanonicalEmail(env.ADMIN_EMAIL);
  if (!adminCanonical || adminCanonical !== canonicalEmail) return "user";

  return constantTimeEqual(bootstrapSecret, env.ADMIN_BOOTSTRAP_SECRET) ? "admin" : "user";
}

export async function listUsersAdmin(db, actor, { limit = 50, offset = 0 } = {}) {
  if (!actor || actor.role !== "admin" || actor.disabled_at != null) {
    return { ok: false, status: 403, error: "Forbidden." };
  }
  const safeLimit = Math.min(200, Math.max(1, Number.isInteger(limit) ? limit : 50));
  const safeOffset = Math.max(0, Number.isInteger(offset) ? offset : 0);

  const res = await db
    .prepare(
      `SELECT id, email, full_name, username, profile_completed, role, plan, created_at, updated_at, disabled_at
         FROM users
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`
    )
    .bind(safeLimit, safeOffset)
    .all();

  const rows = Array.isArray(res?.results) ? res.results : [];
  return {
    ok: true,
    status: 200,
    users: rows.map(sanitizeAdminUser),
  };
}

export async function setUserRoleOrStatus(db, actor, targetUserId, patch, { nowMs = Date.now() } = {}) {
  if (!actor || actor.role !== "admin" || actor.disabled_at != null) {
    return { ok: false, status: 403, error: "Forbidden." };
  }
  if (typeof targetUserId !== "string" || !targetUserId.trim()) {
    return { ok: false, status: 400, error: "Invalid user ID." };
  }
  if (!patch || typeof patch !== "object") {
    return { ok: false, status: 400, error: "Invalid update payload." };
  }

  const target = await db
    .prepare(
      `SELECT id, email, full_name, username, profile_completed, role, plan, created_at, updated_at, disabled_at
         FROM users WHERE id = ?`
    )
    .bind(targetUserId)
    .first();

  if (!target) {
    return { ok: false, status: 404, error: "User not found." };
  }

  let nextRole = target.role;
  let nextPlan = target.plan;
  let nextDisabledAt = target.disabled_at;

  if (patch.role !== undefined) {
    if (!ALLOWED_ROLE_SET.has(patch.role)) {
      return { ok: false, status: 400, error: "Invalid role." };
    }
    nextRole = patch.role;
  }

  if (patch.plan !== undefined) {
    if (!ALLOWED_PLAN_SET.has(patch.plan)) {
      return { ok: false, status: 400, error: "Invalid plan." };
    }
    nextPlan = patch.plan;
  }

  if (patch.disabled !== undefined) {
    if (typeof patch.disabled !== "boolean") {
      return { ok: false, status: 400, error: "disabled must be a boolean." };
    }
    nextDisabledAt = patch.disabled ? nowMs : null;
  }

  // Prevent demoting or disabling the last active admin
  const isCurrentlyActiveAdmin = target.role === "admin" && target.disabled_at == null;
  const willRemainActiveAdmin = nextRole === "admin" && nextDisabledAt == null;
  if (isCurrentlyActiveAdmin && !willRemainActiveAdmin) {
    const countRow = await db
      .prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND disabled_at IS NULL")
      .first();
    const activeAdmins = Number(countRow?.cnt ?? 0);
    if (activeAdmins <= 1) {
      return { ok: false, status: 409, error: "Cannot demote or disable the last active admin." };
    }
  }

  await db
    .prepare("UPDATE users SET role = ?, plan = ?, disabled_at = ?, updated_at = ? WHERE id = ?")
    .bind(nextRole, nextPlan, nextDisabledAt, nowMs, targetUserId)
    .run();

  if (nextDisabledAt != null) {
    await revokeAllUserSessions(db, targetUserId);
  }

  const updated = await db
    .prepare(
      `SELECT id, email, full_name, username, profile_completed, role, plan, created_at, updated_at, disabled_at
         FROM users WHERE id = ?`
    )
    .bind(targetUserId)
    .first();

  return { ok: true, status: 200, user: sanitizeAdminUser(updated) };
}

// ---------------------------------------------------------------------------
// Registration & Password Login
// ---------------------------------------------------------------------------

export async function registerUser(db, input, { env = {}, ip = null, ua = null, nowMs = Date.now() } = {}) {
  if (!input || typeof input !== "object") {
    return { ok: false, status: 400, error: "Invalid registration payload." };
  }

  const emailCheck = validateAndNormalizeEmail(input.email);
  if (!emailCheck.ok) return { ok: false, status: 400, error: emailCheck.error };

  const pwCheck = validatePassword(input.password);
  if (!pwCheck.ok) return { ok: false, status: 400, error: pwCheck.error };

  const nameCheck = validateFullName(input.full_name);
  if (!nameCheck.ok) return { ok: false, status: 400, error: nameCheck.error };

  const userCheck = validateUsername(input.username);
  if (!userCheck.ok) return { ok: false, status: 400, error: userCheck.error };

  const dobCheck = validateDob(input.dob, nowMs);
  if (!dobCheck.ok) return { ok: false, status: 400, error: dobCheck.error };

  const phoneCheck = validatePhone(input.phone);
  if (!phoneCheck.ok) return { ok: false, status: 400, error: phoneCheck.error };

  if (input.terms_accepted !== true) {
    return {
      ok: false,
      status: 400,
      error: "You must accept the Terms of Service and Privacy Policy to create an account.",
    };
  }

  const existingEmail = await db
    .prepare("SELECT id FROM users WHERE canonical_email = ? OR email = ?")
    .bind(emailCheck.canonical, emailCheck.email)
    .first();
  if (existingEmail) {
    return { ok: false, status: 409, error: "An account with that email already exists." };
  }

  const existingUsername = await db
    .prepare("SELECT id FROM users WHERE username_lower = ?")
    .bind(userCheck.lower)
    .first();
  if (existingUsername) {
    return { ok: false, status: 409, error: "That username is already taken." };
  }

  const passwordHash = await hashPassword(input.password);
  const role = resolveBootstrapRole(emailCheck.canonical, env, input.admin_bootstrap_secret);
  const id = crypto.randomUUID();

  try {
    await db
      .prepare(
        `INSERT INTO users
          (id, email, canonical_email, password_hash, full_name, username, username_lower, dob, phone,
           profile_completed, terms_accepted_at, terms_version, role, plan, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 'free', ?, ?)`
      )
      .bind(
        id,
        emailCheck.email,
        emailCheck.canonical,
        passwordHash,
        nameCheck.value,
        userCheck.value,
        userCheck.lower,
        dobCheck.value,
        phoneCheck.value,
        nowMs,
        TERMS_VERSION,
        role,
        nowMs,
        nowMs
      )
      .run();
  } catch (err) {
    const msg = String(err?.message ?? "");
    if (msg.includes("UNIQUE")) {
      return { ok: false, status: 409, error: "Email or username is already in use." };
    }
    throw err;
  }

  const session = await createSession(db, id, { ip, ua, nowMs });
  const created = await db
    .prepare(
      `SELECT id, email, full_name, username, dob, phone, profile_completed,
              terms_accepted_at, terms_version, email_verified_at, phone_verified_at,
              role, plan, created_at, updated_at, disabled_at
         FROM users WHERE id = ?`
    )
    .bind(id)
    .first();

  return { ok: true, status: 201, user: sanitizeUser(created), session };
}

export async function loginUser(db, input, { ip = null, ua = null, nowMs = Date.now() } = {}) {
  if (!input || typeof input !== "object") {
    return { ok: false, status: 400, error: "Invalid login payload." };
  }

  const emailCheck = validateAndNormalizeEmail(input.email);
  if (
    !emailCheck.ok ||
    typeof input.password !== "string" ||
    input.password.length === 0 ||
    input.password.length > 256
  ) {
    return { ok: false, status: 400, error: "Valid email and password are required." };
  }

  const lockoutKeys = [`email:${emailCheck.canonical}`];
  if (typeof ip === "string" && ip) {
    lockoutKeys.push(`ip:${await sha256Hex(ip)}`);
  }

  const lockStatus = await checkLoginLockout(db, lockoutKeys, nowMs);
  if (lockStatus.locked) {
    return {
      ok: false,
      status: 429,
      error: "Too many failed login attempts. Please try again later.",
      retryAfterSec: lockStatus.retryAfterSec,
    };
  }

  const user = await db
    .prepare(
      `SELECT id, email, password_hash, full_name, username, dob, phone,
              profile_completed, terms_accepted_at, terms_version,
              email_verified_at, phone_verified_at,
              role, plan, created_at, updated_at, disabled_at
         FROM users WHERE canonical_email = ?`
    )
    .bind(emailCheck.canonical)
    .first();

  // Timing-safe anti-enumeration: always run PBKDF2 even if user does not exist or has no password.
  const hashToCheck = user && typeof user.password_hash === "string" ? user.password_hash : DUMMY_PASSWORD_HASH;
  const passwordOk = await verifyPassword(input.password, hashToCheck);
  const valid = Boolean(user && user.password_hash && passwordOk && user.disabled_at == null);

  if (!valid) {
    await recordLoginFailure(db, lockoutKeys, nowMs);
    return { ok: false, status: 401, error: "Invalid email or password." };
  }

  await clearLoginAttempts(db, [`email:${emailCheck.canonical}`]);
  const session = await createSession(db, user.id, { ip, ua, nowMs });
  return { ok: true, status: 200, user: sanitizeUser(user), session };
}

// ---------------------------------------------------------------------------
// Per-User Data Isolation (IDOR-Proof: strictly WHERE user_id = ?)
// ---------------------------------------------------------------------------

export async function getUserData(db, userId) {
  const res = await db
    .prepare("SELECT namespace, payload, updated_at FROM user_data WHERE user_id = ?")
    .bind(userId)
    .all();
  const rows = Array.isArray(res?.results) ? res.results : [];
  const data = Object.create(null);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!ALLOWED_NAMESPACE_SET.has(row.namespace)) continue;
    try {
      data[row.namespace] = JSON.parse(row.payload);
    } catch {
      data[row.namespace] = null;
    }
  }
  return data;
}

export async function saveUserData(db, userId, namespace, payload, { nowMs = Date.now() } = {}) {
  if (!ALLOWED_NAMESPACE_SET.has(namespace)) {
    return { ok: false, status: 400, error: "Invalid data namespace." };
  }
  let serialized;
  try {
    serialized = JSON.stringify(payload ?? null);
  } catch {
    return { ok: false, status: 400, error: "Payload is not JSON-serializable." };
  }
  const byteLen = encoder.encode(serialized).byteLength;
  if (byteLen > MAX_PAYLOAD_BYTES) {
    return { ok: false, status: 413, error: "Payload exceeds maximum allowed size." };
  }

  await db
    .prepare(
      `INSERT INTO user_data (user_id, namespace, payload, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, namespace) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at`
    )
    .bind(userId, namespace, serialized, nowMs)
    .run();

  return { ok: true, status: 200, namespace, updated_at: nowMs };
}

export async function importLegacyData(db, userId, dataMap, { nowMs = Date.now() } = {}) {
  if (!dataMap || typeof dataMap !== "object" || Array.isArray(dataMap)) {
    return { ok: false, status: 400, error: "Import payload must be a JSON object." };
  }

  const keys = Object.keys(dataMap);
  const serializedEntries = [];
  let totalBytes = 0;

  for (let i = 0; i < keys.length; i++) {
    const ns = keys[i];
    if (!ALLOWED_NAMESPACE_SET.has(ns)) {
      return { ok: false, status: 400, error: `Invalid namespace: ${ns}` };
    }
    let serialized;
    try {
      serialized = JSON.stringify(dataMap[ns] ?? null);
    } catch {
      return { ok: false, status: 400, error: `Namespace ${ns} is not JSON-serializable.` };
    }
    const byteLen = encoder.encode(serialized).byteLength;
    totalBytes += byteLen;
    if (byteLen > MAX_PAYLOAD_BYTES || totalBytes > MAX_PAYLOAD_BYTES) {
      return { ok: false, status: 413, error: "Import payload exceeds maximum allowed size." };
    }
    serializedEntries.push([ns, serialized]);
  }

  const imported = [];
  for (let i = 0; i < serializedEntries.length; i++) {
    const [ns, serialized] = serializedEntries[i];
    await db
      .prepare(
        `INSERT INTO user_data (user_id, namespace, payload, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, namespace) DO UPDATE SET
           payload = excluded.payload,
           updated_at = excluded.updated_at`
      )
      .bind(userId, ns, serialized, nowMs)
      .run();
    imported.push(ns);
  }

  return { ok: true, status: 200, imported };
}

// ---------------------------------------------------------------------------
// OAuth2 / OIDC Helpers (PKCE S256, CSRF state, account linking, profile completion)
// ---------------------------------------------------------------------------

export async function generatePkcePair() {
  const verifier = bytesToBase64Url(randomBytes(32));
  const challenge = await sha256Base64Url(verifier);
  return { verifier, challenge, method: "S256" };
}

export function sanitizeReturnTo(returnTo) {
  if (typeof returnTo !== "string") return "/";
  if (CONTROL_CHARS_RE.test(returnTo) || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(returnTo)) {
    return "/";
  }
  const trimmed = returnTo.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.includes("//") ||
    trimmed.includes("\\") ||
    CONTROL_CHARS_RE.test(trimmed)
  ) {
    return "/";
  }
  try {
    const resolved = new URL(trimmed, "https://vektor.invalid");
    if (resolved.origin !== "https://vektor.invalid") {
      return "/";
    }
  } catch {
    return "/";
  }
  return trimmed.slice(0, 512);
}

export async function createOAuthState(db, { provider, returnTo = "/", nowMs = Date.now() }) {
  if (!ALLOWED_OAUTH_PROVIDER_SET.has(provider)) {
    throw new Error("Unsupported OAuth provider.");
  }
  const state = bytesToBase64Url(randomBytes(32));
  const stateHash = await sha256Hex(state);
  const nonce = bytesToBase64Url(randomBytes(16));
  const pkce = await generatePkcePair();
  const safeReturnTo = sanitizeReturnTo(returnTo);
  const expiresAt = nowMs + OAUTH_STATE_TTL_MS;

  await db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(nowMs).run();
  await db
    .prepare(
      `INSERT INTO oauth_states (state_hash, provider, pkce_verifier, nonce, return_to, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(stateHash, provider, pkce.verifier, nonce, safeReturnTo, expiresAt)
    .run();

  return {
    state,
    nonce,
    codeChallenge: pkce.challenge,
    codeChallengeMethod: "S256",
    returnTo: safeReturnTo,
  };
}

export async function consumeOAuthState(db, state, expectedProvider, { nowMs = Date.now() } = {}) {
  if (typeof state !== "string" || state.length < 16 || !ALLOWED_OAUTH_PROVIDER_SET.has(expectedProvider)) {
    return { ok: false, error: "Invalid OAuth state." };
  }
  const stateHash = await sha256Hex(state);
  const row = await db
    .prepare(
      `DELETE FROM oauth_states
        WHERE state_hash = ?
       RETURNING state_hash, provider, pkce_verifier, nonce, return_to, expires_at`
    )
    .bind(stateHash)
    .first();

  if (!row || row.provider !== expectedProvider || row.expires_at <= nowMs) {
    return { ok: false, error: "Invalid or expired OAuth state." };
  }

  return {
    ok: true,
    pkceVerifier: row.pkce_verifier,
    nonce: row.nonce,
    returnTo: sanitizeReturnTo(row.return_to),
  };
}

export async function findOrCreateOAuthUser(
  db,
  provider,
  { providerUserId, email, fullName = null, emailVerified = false },
  { nowMs = Date.now() } = {}
) {
  if (!ALLOWED_OAUTH_PROVIDER_SET.has(provider)) {
    return { ok: false, status: 400, error: "Unsupported OAuth provider." };
  }
  if (typeof providerUserId !== "string" || !providerUserId.trim()) {
    return { ok: false, status: 400, error: "Missing OAuth subject identifier." };
  }

  // 1) Existing linked OAuth account
  const linked = await db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.username, u.dob, u.phone,
              u.profile_completed, u.terms_accepted_at, u.terms_version,
              u.email_verified_at, u.phone_verified_at,
              u.role, u.plan, u.created_at, u.updated_at, u.disabled_at
         FROM oauth_accounts oa
         JOIN users u ON u.id = oa.user_id
        WHERE oa.provider = ? AND oa.provider_user_id = ?`
    )
    .bind(provider, providerUserId)
    .first();

  if (linked) {
    if (linked.disabled_at != null) {
      return { ok: false, status: 403, error: "Account is disabled." };
    }
    return { ok: true, status: 200, user: sanitizeUser(linked), isNew: false };
  }

  // 2) Require verified email before linking or creating a new account
  if (emailVerified !== true) {
    return { ok: false, status: 403, error: "A verified email address is required." };
  }

  const emailCheck = validateAndNormalizeEmail(email);
  if (!emailCheck.ok) {
    return { ok: false, status: 400, error: "A valid verified email address is required." };
  }

  const existing = await db
    .prepare(
      `SELECT id, email, full_name, username, dob, phone,
              profile_completed, terms_accepted_at, terms_version,
              email_verified_at, phone_verified_at,
              role, plan, created_at, updated_at, disabled_at
         FROM users WHERE canonical_email = ?`
    )
    .bind(emailCheck.canonical)
    .first();

  if (existing) {
    if (existing.disabled_at != null) {
      return { ok: false, status: 403, error: "Account is disabled." };
    }
    if (existing.email_verified_at == null) {
      // Pre-account takeover defense: clear any attacker-set password, mark email verified
      // by the trusted OAuth provider, and revoke all prior sessions before linking.
      await db
        .prepare(
          `UPDATE users
              SET password_hash = NULL,
                  email_verified_at = ?,
                  updated_at = ?
            WHERE id = ? AND email_verified_at IS NULL`
        )
        .bind(nowMs, nowMs, existing.id)
        .run();
      await revokeAllUserSessions(db, existing.id);
      existing.email_verified_at = nowMs;
      existing.updated_at = nowMs;
    }
    await db
      .prepare(
        `INSERT INTO oauth_accounts (provider, provider_user_id, user_id, email, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(provider, providerUserId, existing.id, emailCheck.email, nowMs)
      .run();
    return { ok: true, status: 200, user: sanitizeUser(existing), isNew: false };
  }

  // 3) Create new OAuth user with profile_completed = 0 until required profile fields are submitted
  const id = crypto.randomUUID();
  const safeName = typeof fullName === "string" && validateFullName(fullName).ok ? fullName.trim() : null;

  await db
    .prepare(
      `INSERT INTO users
        (id, email, canonical_email, password_hash, full_name, username, username_lower, dob, phone,
         profile_completed, email_verified_at, role, plan, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, 0, ?, 'user', 'free', ?, ?)`
    )
    .bind(id, emailCheck.email, emailCheck.canonical, safeName, nowMs, nowMs, nowMs)
    .run();

  await db
    .prepare(
      `INSERT INTO oauth_accounts (provider, provider_user_id, user_id, email, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(provider, providerUserId, id, emailCheck.email, nowMs)
    .run();

  const created = await db
    .prepare(
      `SELECT id, email, full_name, username, dob, phone, profile_completed,
              terms_accepted_at, terms_version, email_verified_at, phone_verified_at,
              role, plan, created_at, updated_at, disabled_at
         FROM users WHERE id = ?`
    )
    .bind(id)
    .first();

  return { ok: true, status: 201, user: sanitizeUser(created), isNew: true };
}

export async function completeProfile(db, userId, input, { nowMs = Date.now() } = {}) {
  if (!input || typeof input !== "object") {
    return { ok: false, status: 400, error: "Invalid profile payload." };
  }

  const nameCheck = validateFullName(input.full_name);
  if (!nameCheck.ok) return { ok: false, status: 400, error: nameCheck.error };

  const userCheck = validateUsername(input.username);
  if (!userCheck.ok) return { ok: false, status: 400, error: userCheck.error };

  const dobCheck = validateDob(input.dob, nowMs);
  if (!dobCheck.ok) return { ok: false, status: 400, error: dobCheck.error };

  const phoneCheck = validatePhone(input.phone);
  if (!phoneCheck.ok) return { ok: false, status: 400, error: phoneCheck.error };

  const conflict = await db
    .prepare("SELECT id FROM users WHERE username_lower = ? AND id != ?")
    .bind(userCheck.lower, userId)
    .first();
  if (conflict) {
    return { ok: false, status: 409, error: "That username is already taken." };
  }

  const existingUser = await db
    .prepare("SELECT phone FROM users WHERE id = ?")
    .bind(userId)
    .first();
  if (!existingUser) {
    return { ok: false, status: 404, error: "User not found." };
  }
  const phoneChanged = existingUser.phone !== phoneCheck.value;

  try {
    if (phoneChanged) {
      await db
        .prepare(
          `UPDATE users
              SET full_name = ?, username = ?, username_lower = ?, dob = ?, phone = ?,
                  phone_verified_at = NULL, profile_completed = 1, updated_at = ?
            WHERE id = ?`
        )
        .bind(nameCheck.value, userCheck.value, userCheck.lower, dobCheck.value, phoneCheck.value, nowMs, userId)
        .run();
      await db
        .prepare(
          `UPDATE verification_codes
              SET consumed_at = ?
            WHERE user_id = ? AND channel = 'phone' AND consumed_at IS NULL`
        )
        .bind(nowMs, userId)
        .run();
    } else {
      await db
        .prepare(
          `UPDATE users
              SET full_name = ?, username = ?, username_lower = ?, dob = ?, phone = ?,
                  profile_completed = 1, updated_at = ?
            WHERE id = ?`
        )
        .bind(nameCheck.value, userCheck.value, userCheck.lower, dobCheck.value, phoneCheck.value, nowMs, userId)
        .run();
    }
  } catch (err) {
    const msg = String(err?.message ?? "");
    if (msg.includes("UNIQUE")) {
      return { ok: false, status: 409, error: "That username is already taken." };
    }
    throw err;
  }

  const updated = await db
    .prepare(
      `SELECT id, email, full_name, username, dob, phone, profile_completed,
              terms_accepted_at, terms_version, email_verified_at, phone_verified_at,
              role, plan, created_at, updated_at, disabled_at
         FROM users WHERE id = ?`
    )
    .bind(userId)
    .first();

  if (!updated) {
    return { ok: false, status: 404, error: "User not found." };
  }
  return { ok: true, status: 200, user: sanitizeUser(updated) };
}

// ---------------------------------------------------------------------------
// Email & Phone 6-Digit OTP Verification
// ---------------------------------------------------------------------------

export function isEmailVerifyConfigured(env) {
  return Boolean(
    env &&
      typeof env.RESEND_API_KEY === "string" &&
      env.RESEND_API_KEY.trim() &&
      typeof env.EMAIL_FROM === "string" &&
      env.EMAIL_FROM.trim()
  );
}

export function isPhoneVerifyConfigured(env) {
  return Boolean(
    env &&
      typeof env.TWILIO_ACCOUNT_SID === "string" &&
      env.TWILIO_ACCOUNT_SID.trim() &&
      typeof env.TWILIO_AUTH_TOKEN === "string" &&
      env.TWILIO_AUTH_TOKEN.trim() &&
      typeof env.TWILIO_FROM === "string" &&
      env.TWILIO_FROM.trim()
  );
}

/**
 * Generates an unbiased cryptographic 6-digit numeric OTP ("000000"–"999999")
 * using rejection sampling over crypto.getRandomValues.
 */
export function generateVerificationCode() {
  const range = 1_000_000;
  const maxUint32 = 0x100000000;
  const limit = maxUint32 - (maxUint32 % range);
  const buf = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) {
      return String(buf[0] % range).padStart(6, "0");
    }
  }
}

export async function hashVerificationCode(code, userId, channel, target = "") {
  return sha256Hex(`${code}:${userId}:${channel}:${target}`);
}

export async function sendVerificationCode(
  db,
  user,
  channel,
  { env = {}, nowMs = Date.now(), fetchImpl = globalThis.fetch, sendCodeImpl = null } = {}
) {
  if (!user || !user.id) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }
  if (!ALLOWED_VERIFICATION_CHANNEL_SET.has(channel)) {
    return { ok: false, status: 400, error: "Channel must be 'email' or 'phone'." };
  }

  const target = channel === "email" ? user.email : user.phone;
  if (typeof target !== "string" || !target.trim()) {
    return {
      ok: false,
      status: 400,
      error:
        channel === "email"
          ? "No email address on file."
          : "No phone number on file. Complete your profile first.",
    };
  }

  if (channel === "email" && user.email_verified) {
    return { ok: true, status: 200, channel, already_verified: true };
  }
  if (channel === "phone" && user.phone_verified) {
    return { ok: true, status: 200, channel, already_verified: true };
  }

  const hasCustomSender = typeof sendCodeImpl === "function";
  if (!hasCustomSender) {
    if (channel === "email" && !isEmailVerifyConfigured(env)) {
      return {
        ok: false,
        status: 503,
        error: "Email verification provider is not configured yet.",
        code: "PROVIDER_UNCONFIGURED",
      };
    }
    if (channel === "phone" && !isPhoneVerifyConfigured(env)) {
      return {
        ok: false,
        status: 503,
        error: "SMS verification provider is not configured yet.",
        code: "PROVIDER_UNCONFIGURED",
      };
    }
  }

  // Max 5 codes/hour per (user_id, channel)
  const hourly = await db
    .prepare(
      `SELECT COUNT(*) AS cnt, MIN(created_at) AS oldest
         FROM verification_codes
        WHERE user_id = ? AND channel = ? AND created_at > ?`
    )
    .bind(user.id, channel, nowMs - VERIFICATION_HOURLY_WINDOW_MS)
    .first();

  if (Number(hourly?.cnt ?? 0) >= VERIFICATION_HOURLY_MAX) {
    const oldest = Number(hourly.oldest ?? nowMs);
    const retryAfterSec = Math.max(
      1,
      Math.ceil((VERIFICATION_HOURLY_WINDOW_MS - (nowMs - oldest)) / 1000)
    );
    return {
      ok: false,
      status: 429,
      error: "Hourly verification code limit reached. Please try again later.",
      retryAfterSec,
    };
  }

  const code = generateVerificationCode();
  const codeHash = await hashVerificationCode(code, user.id, channel, target);
  const id = crypto.randomUUID();
  const expiresAt = nowMs + VERIFICATION_CODE_TTL_MS;
  const cooldownCutoff = nowMs - VERIFICATION_RESEND_COOLDOWN_MS;

  // Atomic cooldown-guarded insert BEFORE outbound delivery to close concurrent SMS/email pumping races.
  const insRes = await db
    .prepare(
      `INSERT INTO verification_codes
        (id, user_id, channel, target, code_hash, attempts, expires_at, consumed_at, created_at)
       SELECT ?, ?, ?, ?, ?, 0, ?, NULL, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM verification_codes
           WHERE user_id = ? AND channel = ? AND created_at > ?
        )`
    )
    .bind(
      id,
      user.id,
      channel,
      target,
      codeHash,
      expiresAt,
      nowMs,
      user.id,
      channel,
      cooldownCutoff
    )
    .run();

  if (Number(insRes?.meta?.changes ?? 0) !== 1) {
    const latest = await db
      .prepare(
        `SELECT created_at
           FROM verification_codes
          WHERE user_id = ? AND channel = ?
          ORDER BY created_at DESC
          LIMIT 1`
      )
      .bind(user.id, channel)
      .first();
    const retryAfterSec = latest
      ? Math.max(1, Math.ceil((VERIFICATION_RESEND_COOLDOWN_MS - (nowMs - Number(latest.created_at))) / 1000))
      : Math.ceil(VERIFICATION_RESEND_COOLDOWN_MS / 1000);
    return {
      ok: false,
      status: 429,
      error: "Please wait before requesting another verification code.",
      retryAfterSec,
    };
  }

  // Invalidate any prior active code for (user_id, channel) while preserving rows for hourly rate limits.
  await db
    .prepare(
      `UPDATE verification_codes
          SET consumed_at = ?
        WHERE user_id = ? AND channel = ? AND id != ? AND consumed_at IS NULL`
    )
    .bind(nowMs, user.id, channel, id)
    .run();

  const markUndelivered = async () => {
    await db
      .prepare("UPDATE verification_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
      .bind(nowMs, id)
      .run();
  };

  try {
    if (hasCustomSender) {
      await sendCodeImpl({ channel, target, code, userId: user.id, expiresAt });
    } else if (channel === "email") {
      const resp = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM.trim(),
          to: [target],
          subject: "Your Vektor Terminal verification code",
          text: `Your Vektor Terminal verification code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this message.`,
        }),
      });
      if (!resp || !resp.ok) {
        await markUndelivered();
        return { ok: false, status: 502, error: "Unable to send verification email. Please try again." };
      }
    } else {
      const sid = env.TWILIO_ACCOUNT_SID.trim();
      const auth = btoa(`${sid}:${env.TWILIO_AUTH_TOKEN.trim()}`);
      const resp = await fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            From: env.TWILIO_FROM.trim(),
            To: target,
            Body: `Your Vektor Terminal verification code is ${code}. It expires in 10 minutes.`,
          }).toString(),
        }
      );
      if (!resp || !resp.ok) {
        await markUndelivered();
        return { ok: false, status: 502, error: "Unable to send verification SMS. Please try again." };
      }
    }
  } catch {
    await markUndelivered();
    return {
      ok: false,
      status: 502,
      error:
        channel === "email"
          ? "Unable to send verification email. Please try again."
          : "Unable to send verification SMS. Please try again.",
    };
  }

  return {
    ok: true,
    status: 200,
    channel,
    expires_at: expiresAt,
    cooldown_sec: Math.floor(VERIFICATION_RESEND_COOLDOWN_MS / 1000),
  };
}

export async function confirmVerificationCode(db, userId, channel, code, { nowMs = Date.now() } = {}) {
  if (!userId) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }
  if (!ALLOWED_VERIFICATION_CHANNEL_SET.has(channel)) {
    return { ok: false, status: 400, error: "Channel must be 'email' or 'phone'." };
  }
  if (typeof code !== "string" || !OTP_CODE_RE.test(code)) {
    return { ok: false, status: 400, error: "Enter a valid 6-digit verification code." };
  }

  const currentUser = await db
    .prepare("SELECT email, phone FROM users WHERE id = ?")
    .bind(userId)
    .first();
  if (!currentUser) {
    return { ok: false, status: 404, error: "User not found." };
  }
  const currentTarget = channel === "email" ? currentUser.email : currentUser.phone;
  if (typeof currentTarget !== "string" || !currentTarget.trim()) {
    return { ok: false, status: 400, error: "No verification target on file." };
  }

  const latest = await db
    .prepare(
      `SELECT id, target, code_hash, attempts, expires_at, consumed_at
         FROM verification_codes
        WHERE user_id = ? AND channel = ? AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`
    )
    .bind(userId, channel)
    .first();

  if (!latest) {
    return { ok: false, status: 400, error: "No active verification code found. Request a new code." };
  }
  if (latest.target !== currentTarget) {
    await db
      .prepare("UPDATE verification_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
      .bind(nowMs, latest.id)
      .run();
    return { ok: false, status: 400, error: "Verification target changed. Request a new code." };
  }
  if (Number(latest.expires_at) <= nowMs) {
    await db
      .prepare("UPDATE verification_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
      .bind(nowMs, latest.id)
      .run();
    return { ok: false, status: 400, error: "Verification code has expired. Request a new code." };
  }
  if (Number(latest.attempts) >= VERIFICATION_MAX_ATTEMPTS) {
    await db
      .prepare("UPDATE verification_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
      .bind(nowMs, latest.id)
      .run();
    return {
      ok: false,
      status: 429,
      error: "Too many incorrect attempts. Request a new verification code.",
    };
  }

  // Atomically increment attempts before verifying the hash
  const updated = await db
    .prepare(
      `UPDATE verification_codes
          SET attempts = attempts + 1
        WHERE id = ? AND consumed_at IS NULL AND expires_at > ? AND attempts < ?
       RETURNING id, target, code_hash, attempts`
    )
    .bind(latest.id, nowMs, VERIFICATION_MAX_ATTEMPTS)
    .first();

  if (!updated) {
    return { ok: false, status: 400, error: "Verification code is no longer active. Request a new code." };
  }

  const candidateHash = await hashVerificationCode(code, userId, channel, currentTarget);
  if (!constantTimeEqual(candidateHash, updated.code_hash)) {
    if (Number(updated.attempts) >= VERIFICATION_MAX_ATTEMPTS) {
      await db
        .prepare("UPDATE verification_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
        .bind(nowMs, updated.id)
        .run();
      return {
        ok: false,
        status: 429,
        error: "Too many incorrect attempts. Request a new verification code.",
      };
    }
    const remaining = VERIFICATION_MAX_ATTEMPTS - Number(updated.attempts);
    return {
      ok: false,
      status: 400,
      error: `Invalid verification code. ${remaining} ${remaining === 1 ? "attempt" : "attempts"} remaining.`,
    };
  }

  const consumed = await db
    .prepare(
      `UPDATE verification_codes
          SET consumed_at = ?
        WHERE id = ? AND consumed_at IS NULL
       RETURNING id`
    )
    .bind(nowMs, updated.id)
    .first();

  if (!consumed) {
    return { ok: false, status: 400, error: "Verification code has already been used." };
  }

  const verifyRes =
    channel === "email"
      ? await db
          .prepare("UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ? AND email = ?")
          .bind(nowMs, nowMs, userId, currentTarget)
          .run()
      : await db
          .prepare("UPDATE users SET phone_verified_at = ?, updated_at = ? WHERE id = ? AND phone = ?")
          .bind(nowMs, nowMs, userId, currentTarget)
          .run();

  if (Number(verifyRes?.meta?.changes ?? 0) !== 1) {
    return { ok: false, status: 409, error: "Verification target changed. Request a new code." };
  }

  const userRow = await db
    .prepare(
      `SELECT id, email, full_name, username, dob, phone, profile_completed,
              terms_accepted_at, terms_version, email_verified_at, phone_verified_at,
              role, plan, created_at, updated_at, disabled_at
         FROM users WHERE id = ?`
    )
    .bind(userId)
    .first();

  if (!userRow) {
    return { ok: false, status: 404, error: "User not found." };
  }
  return { ok: true, status: 200, user: sanitizeUser(userRow) };
}

export function decodeUtf8(bytes) {
  return decoder.decode(bytes);
}
