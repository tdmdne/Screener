// tests/auth-server.test.mjs — Server-side D1 Auth, Profile Validation, Sessions, Lockout,
// IDOR Isolation, Admin RBAC, CSRF, and Google/Apple OAuth tests using real node:sqlite.
// Run: node tests/auth-server.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  bytesToBase64Url,
  findOrCreateOAuthUser,
  hashPassword,
  normalizeCanonicalEmail,
  sanitizeReturnTo,
  sha256Hex,
  verifyPassword,
} from "../shared/auth.js";
import { handleAuthRequest } from "../shared/authRoutes.js";
import { onRequest as onApiRequest } from "../functions/api/[[path]].js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(
  join(__dirname, "..", "migrations", "0001_auth_and_user_data.sql"),
  "utf8"
);

const BASE_ORIGIN = "https://terminal.vektor.test";
const BASE_TIME = Date.UTC(2026, 10, 19, 12, 0, 0); // 2026-11-19T12:00:00Z

// ---------------------------------------------------------------------------
// D1-compatible adapter over real node:sqlite (in-memory)
// ---------------------------------------------------------------------------

function createD1TestDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(MIGRATION_SQL);

  return {
    _sqlite: sqlite,
    prepare(sql) {
      let boundArgs = [];
      const stmt = sqlite.prepare(sql);
      const handle = {
        bind(...args) {
          boundArgs = args.map((v) => (v === undefined ? null : v));
          return handle;
        },
        async first() {
          const row = stmt.get(...boundArgs);
          return row === undefined ? null : row;
        },
        async all() {
          const rows = stmt.all(...boundArgs);
          return { results: rows, success: true };
        },
        async run() {
          const info = stmt.run(...boundArgs);
          return { success: true, meta: { changes: info.changes } };
        },
      };
      return handle;
    },
  };
}

// ---------------------------------------------------------------------------
// Test HTTP & OAuth Helpers
// ---------------------------------------------------------------------------

function getSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const single = response.headers.get("Set-Cookie");
  return single ? [single] : [];
}

function extractCookiePair(response, cookieName = SESSION_COOKIE_NAME) {
  const all = getSetCookies(response);
  for (const header of all) {
    const pair = header.split(";")[0];
    if (pair.startsWith(`${cookieName}=`)) return pair;
  }
  return all.length ? all[0].split(";")[0] : null;
}

async function req(env, method, path, { body = null, cookie = null, origin = BASE_ORIGIN, headers = {}, options = {} } = {}) {
  const h = new Headers(headers);
  if (origin !== null && ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) {
    if (!h.has("Origin")) h.set("Origin", origin);
  }
  if (cookie) h.set("Cookie", cookie);

  let rawBody;
  if (body !== null && body !== undefined) {
    if (typeof body === "string") {
      rawBody = body;
    } else {
      if (!h.has("Content-Type")) h.set("Content-Type", "application/json");
      rawBody = JSON.stringify(body);
    }
  }

  const request = new Request(`${BASE_ORIGIN}${path}`, {
    method,
    headers: h,
    body: rawBody,
  });
  return handleAuthRequest(request, env, options);
}

function validUserPayload(overrides = {}) {
  return {
    email: "alice@example.com",
    password: "VektorStrong2026!",
    full_name: "Alice Trader",
    username: "alice_trader",
    dob: "1995-06-15",
    phone: "+14155552671",
    ...overrides,
  };
}

async function createRsaJwtSigner(kid = "test-kid-1") {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  publicJwk.kid = kid;
  publicJwk.use = "sig";
  publicJwk.alg = "RS256";

  const enc = new TextEncoder();
  async function sign(payload) {
    const headerB64 = bytesToBase64Url(enc.encode(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })));
    const payloadB64 = bytesToBase64Url(enc.encode(JSON.stringify(payload)));
    const signingInput = `${headerB64}.${payloadB64}`;
    const sig = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keyPair.privateKey,
      enc.encode(signingInput)
    );
    return `${signingInput}.${bytesToBase64Url(new Uint8Array(sig))}`;
  }

  return { jwks: { keys: [publicJwk] }, sign };
}

// ===========================================================================
// Test Suite
// ===========================================================================

describe("ACC — Signup Validation, Canonical Email & Profile Fields", () => {
  it("normalizes canonical emails by stripping +tags on every domain", () => {
    assert.equal(normalizeCanonicalEmail("Alice+promo@CustomDomain.IO"), "alice@customdomain.io");
    assert.equal(normalizeCanonicalEmail("bob+1+2@gmail.com"), "bob@gmail.com");
    assert.equal(normalizeCanonicalEmail("+onlytag@example.com"), null);
    assert.equal(normalizeCanonicalEmail("not-an-email"), null);
  });

  it("rejects invalid email, +tag duplicate, weak password, full_name, username, dob, and phone", async () => {
    const db = createD1TestDb();
    const env = { DB: db };
    const opts = { nowMs: () => BASE_TIME };

    // Valid registration succeeds
    const okRes = await req(env, "POST", "/api/auth/register", {
      body: validUserPayload(),
      options: opts,
    });
    assert.equal(okRes.status, 201);
    const okJson = await okRes.json();
    assert.equal(okJson.ok, true);
    assert.equal(okJson.user.email, "alice@example.com");
    assert.equal(okJson.user.role, "user");
    assert.equal(okJson.user.profile_completed, true);
    assert.equal("password_hash" in okJson.user, false);

    // +tag duplicate on same domain -> 409
    const plusDup = await req(env, "POST", "/api/auth/register", {
      body: validUserPayload({ email: "Alice+second@example.com", username: "alice_2" }),
      options: opts,
    });
    assert.equal(plusDup.status, 409);

    // Case-insensitive username duplicate -> 409
    const userDup = await req(env, "POST", "/api/auth/register", {
      body: validUserPayload({ email: "bob@example.com", username: "ALICE_TRADER" }),
      options: opts,
    });
    assert.equal(userDup.status, 409);

    // Invalid email -> 400
    const badEmail = await req(env, "POST", "/api/auth/register", {
      body: validUserPayload({ email: "bad@@example", username: "bob_1" }),
      options: opts,
    });
    assert.equal(badEmail.status, 400);

    // Weak / short / missing-class passwords -> 400
    for (const pw of ["Short1A", "alllowercase123", "ALLUPPERCASE123", "NoDigitsHere!!", "Password123"]) {
      const r = await req(env, "POST", "/api/auth/register", {
        body: validUserPayload({ email: "pw@example.com", username: "pw_user", password: pw }),
        options: opts,
      });
      assert.equal(r.status, 400, `Expected 400 for password: ${pw}`);
    }

    // Invalid full_name -> 400
    for (const fn of ["A", "   ", "Bad\x00Name", "X".repeat(101)]) {
      const r = await req(env, "POST", "/api/auth/register", {
        body: validUserPayload({ email: "fn@example.com", username: "fn_user", full_name: fn }),
        options: opts,
      });
      assert.equal(r.status, 400, `Expected 400 for full_name: ${JSON.stringify(fn)}`);
    }

    // Invalid & reserved usernames -> 400
    for (const un of ["ab", "bad-dash", "has space", "admin", "Vektor", "support", "a".repeat(25)]) {
      const r = await req(env, "POST", "/api/auth/register", {
        body: validUserPayload({ email: "un@example.com", username: un }),
        options: opts,
      });
      assert.equal(r.status, 400, `Expected 400 for username: ${un}`);
    }

    // Invalid dob (under 18, over 120, impossible calendar dates) -> 400
    for (const dob of ["2010-01-01", "2008-11-20", "1890-01-01", "2000-02-30", "2001-02-29", "1995/06/15"]) {
      const r = await req(env, "POST", "/api/auth/register", {
        body: validUserPayload({ email: "dob@example.com", username: "dob_user", dob }),
        options: opts,
      });
      assert.equal(r.status, 400, `Expected 400 for dob: ${dob}`);
    }

    // Valid leap day DOB (2000-02-29) succeeds
    const leapRes = await req(env, "POST", "/api/auth/register", {
      body: validUserPayload({ email: "leap@example.com", username: "leap_user", dob: "2000-02-29" }),
      options: opts,
    });
    assert.equal(leapRes.status, 201);

    // Invalid phone (non-E.164) -> 400
    for (const phone of ["4155552671", "+0123456789", "+1-415-555-2671", "+12345", "+1234567890123456"]) {
      const r = await req(env, "POST", "/api/auth/register", {
        body: validUserPayload({ email: "ph@example.com", username: "ph_user", phone }),
        options: opts,
      });
      assert.equal(r.status, 400, `Expected 400 for phone: ${phone}`);
    }
  });
});

describe("ACC — PBKDF2 Hashing, Sessions, Cookies & Brute-Force Lockout", () => {
  it("hashes passwords with PBKDF2-SHA256 100k iterations and stores only SHA-256 session token_hash", async () => {
    const db = createD1TestDb();
    const env = { DB: db };
    const opts = { nowMs: () => BASE_TIME };

    const reg = await req(env, "POST", "/api/auth/register", {
      body: validUserPayload(),
      options: opts,
    });
    assert.equal(reg.status, 201);

    const setCookie = reg.headers.get("Set-Cookie");
    assert.ok(setCookie.includes(`${SESSION_COOKIE_NAME}=`));
    assert.ok(setCookie.includes("HttpOnly"));
    assert.ok(setCookie.includes("SameSite=Lax"));
    assert.ok(setCookie.includes("Path=/"));
    assert.ok(setCookie.includes("Secure"));

    const cookiePair = extractCookiePair(reg);
    const rawToken = cookiePair.split("=")[1];

    // Verify password hash format in DB
    const userRow = db._sqlite.prepare("SELECT password_hash FROM users WHERE email = ?").get("alice@example.com");
    assert.ok(userRow.password_hash.startsWith("pbkdf2_sha256$100000$"));
    assert.equal(await verifyPassword("VektorStrong2026!", userRow.password_hash), true);
    assert.equal(await verifyPassword("WrongPassword2026!", userRow.password_hash), false);

    // Verify raw session token is NOT in DB, only its SHA-256 hash
    const expectedHash = await sha256Hex(rawToken);
    const sessRow = db._sqlite.prepare("SELECT token_hash FROM sessions").get();
    assert.equal(sessRow.token_hash, expectedHash);
    assert.notEqual(sessRow.token_hash, rawToken);

    // GET /api/auth/me succeeds with cookie
    const me = await req(env, "GET", "/api/auth/me", { cookie: cookiePair, options: opts });
    assert.equal(me.status, 200);
    const meJson = await me.json();
    assert.equal(meJson.user.username, "alice_trader");

    // POST /api/auth/logout revokes session
    const logout = await req(env, "POST", "/api/auth/logout", { cookie: cookiePair, options: opts });
    assert.equal(logout.status, 200);
    assert.ok(logout.headers.get("Set-Cookie").includes("Max-Age=0"));

    // Reusing logged-out cookie -> 401
    const meAfter = await req(env, "GET", "/api/auth/me", { cookie: cookiePair, options: opts });
    assert.equal(meAfter.status, 401);
  });

  it("enforces 5-fail / 15-min brute-force lockout (429) and unlocks after 15 min", async () => {
    const db = createD1TestDb();
    const env = { DB: db };
    let now = BASE_TIME;
    const opts = { nowMs: () => now };

    await req(env, "POST", "/api/auth/register", { body: validUserPayload(), options: opts });

    // 5 failed attempts -> 401 each
    for (let i = 0; i < 5; i++) {
      const fail = await req(env, "POST", "/api/auth/login", {
        body: { email: "alice@example.com", password: "WrongPassword999!" },
        options: opts,
      });
      assert.equal(fail.status, 401);
    }

    // 6th attempt (even with correct password!) -> 429 Too Many Requests
    const locked = await req(env, "POST", "/api/auth/login", {
      body: { email: "alice@example.com", password: "VektorStrong2026!" },
      options: opts,
    });
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get("Retry-After")) > 0);

    // Non-existent account returns identical 401 error (anti-enumeration)
    const missing = await req(env, "POST", "/api/auth/login", {
      body: { email: "nobody@example.com", password: "VektorStrong2026!" },
      options: opts,
    });
    assert.equal(missing.status, 401);

    // Advance 15 min + 1 sec -> login succeeds
    now += 15 * 60 * 1000 + 1000;
    const ok = await req(env, "POST", "/api/auth/login", {
      body: { email: "alice@example.com", password: "VektorStrong2026!" },
      options: opts,
    });
    assert.equal(ok.status, 200);
  });
});

describe("ACC — IDOR Isolation, Payload Bounds & CSRF Protection", () => {
  it("isolates per-user data strictly by user_id and rejects oversized or invalid namespaces", async () => {
    const db = createD1TestDb();
    const env = { DB: db };
    const opts = { nowMs: () => BASE_TIME };

    const regA = await req(env, "POST", "/api/auth/register", {
      body: validUserPayload({ email: "a@example.com", username: "user_alpha" }),
      options: opts,
    });
    const cookieA = extractCookiePair(regA);

    const regB = await req(env, "POST", "/api/auth/register", {
      body: validUserPayload({ email: "b@example.com", username: "user_beta" }),
      options: opts,
    });
    const cookieB = extractCookiePair(regB);

    // User A saves watchlists & imports alerts
    const putA = await req(env, "PUT", "/api/me/data/watchlists", {
      cookie: cookieA,
      body: { symbols: ["BTCUSDT", "ETHUSDT"] },
      options: opts,
    });
    assert.equal(putA.status, 200);

    const impA = await req(env, "POST", "/api/me/import", {
      cookie: cookieA,
      body: { alerts: [{ sym: "BTCUSDT", price: 100000 }] },
      options: opts,
    });
    assert.equal(impA.status, 200);

    // User A sees their data
    const getA = await req(env, "GET", "/api/me/data", { cookie: cookieA, options: opts });
    assert.equal(getA.status, 200);
    const dataA = (await getA.json()).data;
    assert.deepEqual(dataA.watchlists, { symbols: ["BTCUSDT", "ETHUSDT"] });
    assert.equal(dataA.alerts.length, 1);

    // User B sees ONLY empty data (IDOR proof)
    const getB = await req(env, "GET", "/api/me/data", { cookie: cookieB, options: opts });
    assert.equal(getB.status, 200);
    assert.deepEqual((await getB.json()).data, {});

    // Disallowed namespace -> 400
    const badNs = await req(env, "PUT", "/api/me/data/admin_secrets", {
      cookie: cookieA,
      body: { hack: true },
      options: opts,
    });
    assert.equal(badNs.status, 400);

    // Oversized body (> 512 KB) -> 413
    const huge = await req(env, "PUT", "/api/me/data/drawings", {
      cookie: cookieA,
      body: JSON.stringify({ blob: "x".repeat(520 * 1024) }),
      headers: { "Content-Type": "application/json" },
      options: opts,
    });
    assert.equal(huge.status, 413);
  });

  it("rejects cross-origin and missing-Origin state-changing requests with 403 CSRF", async () => {
    const db = createD1TestDb();
    const env = { DB: db, ALLOWED_ORIGINS: "https://trusted.vektor.test" };
    const opts = { nowMs: () => BASE_TIME };

    // Cross-origin -> 403
    const evil = await req(env, "POST", "/api/auth/register", {
      body: validUserPayload(),
      origin: "https://evil.attacker.example",
      options: opts,
    });
    assert.equal(evil.status, 403);

    // Missing Origin & Referer -> 403
    const missingOrigin = await req(env, "POST", "/api/auth/register", {
      body: validUserPayload(),
      origin: null,
      options: opts,
    });
    assert.equal(missingOrigin.status, 403);

    // Explicitly allowed origin via ALLOWED_ORIGINS -> 201
    const trusted = await req(env, "POST", "/api/auth/register", {
      body: validUserPayload(),
      origin: "https://trusted.vektor.test",
      options: opts,
    });
    assert.equal(trusted.status, 201);
  });
});

describe("ACC — Admin Bootstrap & RBAC", () => {
  it("grants admin only with matching ADMIN_EMAIL + ADMIN_BOOTSTRAP_SECRET, masks PII, and protects last admin", async () => {
    const db = createD1TestDb();
    const env = {
      DB: db,
      ADMIN_EMAIL: "boss@vektor.test",
      ADMIN_BOOTSTRAP_SECRET: "super-secret-bootstrap-token-2026",
    };
    const opts = { nowMs: () => BASE_TIME };

    // Regular user trying to self-assign role: 'admin' gets 'user'
    const regUser = await req(env, "POST", "/api/auth/register", {
      body: validUserPayload({ email: "normie@example.com", username: "normie_1", role: "admin" }),
      options: opts,
    });
    assert.equal(regUser.status, 201);
    const userJson = await regUser.json();
    assert.equal(userJson.user.role, "user");
    const userCookie = extractCookiePair(regUser);

    // Regular user calling /api/admin/users -> 403
    const forbidden = await req(env, "GET", "/api/admin/users", { cookie: userCookie, options: opts });
    assert.equal(forbidden.status, 403);

    // Admin bootstrap with matching email + secret
    const regAdmin = await req(env, "POST", "/api/auth/register", {
      body: validUserPayload({
        email: "boss@vektor.test",
        username: "vektor_boss",
        admin_bootstrap_secret: "super-secret-bootstrap-token-2026",
      }),
      options: opts,
    });
    assert.equal(regAdmin.status, 201);
    const adminJson = await regAdmin.json();
    assert.equal(adminJson.user.role, "admin");
    const adminCookie = extractCookiePair(regAdmin);

    // Admin lists users -> 200 and omits password_hash, phone, dob
    const listRes = await req(env, "GET", "/api/admin/users", { cookie: adminCookie, options: opts });
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.equal(listJson.users.length, 2);
    for (const u of listJson.users) {
      assert.equal("password_hash" in u, false);
      assert.equal("phone" in u, false);
      assert.equal("dob" in u, false);
    }

    // Cannot demote or disable the last active admin -> 409
    const demoteLast = await req(env, "POST", `/api/admin/users/${adminJson.user.id}`, {
      cookie: adminCookie,
      body: { role: "user" },
      options: opts,
    });
    assert.equal(demoteLast.status, 409);

    const disableLast = await req(env, "POST", `/api/admin/users/${adminJson.user.id}`, {
      cookie: adminCookie,
      body: { disabled: true },
      options: opts,
    });
    assert.equal(disableLast.status, 409);

    // Admin updates regular user's plan and disables them -> revokes their session
    const disableUser = await req(env, "POST", `/api/admin/users/${userJson.user.id}`, {
      cookie: adminCookie,
      body: { plan: "pro", disabled: true },
      options: opts,
    });
    assert.equal(disableUser.status, 200);
    const updatedUser = (await disableUser.json()).user;
    assert.equal(updatedUser.plan, "pro");
    assert.ok(updatedUser.disabled_at !== null);

    // Disabled user's session is immediately invalid
    const meDisabled = await req(env, "GET", "/api/auth/me", { cookie: userCookie, options: opts });
    assert.equal(meDisabled.status, 401);
  });
});

describe("ACC — Google & Apple OAuth Start/Callback, Profile Completion & /api/auth/providers", () => {
  it("reports provider availability and returns clean 503 without leaking binding names", async () => {
    // No DB at all
    const provNoDb = await req({}, "GET", "/api/auth/providers");
    assert.equal(provNoDb.status, 200);
    assert.deepEqual((await provNoDb.json()).providers, { email: false, google: false, apple: false });

    const loginNoDb = await req({}, "POST", "/api/auth/login", {
      body: { email: "a@b.com", password: "VektorStrong2026!" },
    });
    assert.equal(loginNoDb.status, 503);
    const errText = await loginNoDb.text();
    assert.equal(errText.includes("env.DB"), false);
    assert.equal(errText.includes("GOOGLE_CLIENT"), false);

    // DB present, OAuth secrets missing
    const db = createD1TestDb();
    const provDbOnly = await req({ DB: db }, "GET", "/api/auth/providers");
    assert.equal(provDbOnly.status, 200);
    assert.deepEqual((await provDbOnly.json()).providers, { email: true, google: false, apple: false });

    const googleUnconf = await req({ DB: db }, "GET", "/api/auth/oauth/google");
    assert.equal(googleUnconf.status, 503);

    const appleUnconf = await req({ DB: db }, "GET", "/api/auth/oauth/apple");
    assert.equal(appleUnconf.status, 503);
  });

  it("completes full Google OAuth PKCE S256 flow -> profile_completed = false -> /api/auth/complete-profile", async () => {
    const db = createD1TestDb();
    const signer = await createRsaJwtSigner("google-k1");
    const env = {
      DB: db,
      GOOGLE_CLIENT_ID: "google-client-123",
      GOOGLE_CLIENT_SECRET: "google-secret-456",
    };
    const opts = { nowMs: () => BASE_TIME };

    // 1) Providers shows google: true
    const prov = await req(env, "GET", "/api/auth/providers", { options: opts });
    assert.deepEqual((await prov.json()).providers, { email: true, google: true, apple: false });

    // 2) Start Google OAuth
    const start = await req(env, "GET", "/api/auth/oauth/google?return_to=/charts", { options: opts });
    assert.equal(start.status, 302);
    const authUrl = new URL(start.headers.get("Location"));
    assert.equal(authUrl.origin, "https://accounts.google.com");
    assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
    const state = authUrl.searchParams.get("state");
    const nonce = authUrl.searchParams.get("nonce");
    assert.ok(state && nonce);
    const oauthStateCookie = extractCookiePair(start, OAUTH_STATE_COOKIE_NAME);
    assert.equal(oauthStateCookie, `${OAUTH_STATE_COOKIE_NAME}=${state}`);
    const startSetCookie = getSetCookies(start).find((c) => c.startsWith(`${OAUTH_STATE_COOKIE_NAME}=`));
    assert.ok(startSetCookie.includes("HttpOnly"));
    assert.ok(startSetCookie.includes("SameSite=Lax"));
    assert.ok(startSetCookie.includes("Path=/api/auth/oauth"));
    assert.ok(startSetCookie.includes("Secure"));

    // 3) Mock Google token exchange + JWKS
    const idToken = await signer.sign({
      iss: "https://accounts.google.com",
      aud: env.GOOGLE_CLIENT_ID,
      sub: "google-sub-999",
      email: "oauth.user@gmail.com",
      email_verified: true,
      name: "OAuth Trader",
      nonce,
      exp: Math.floor(BASE_TIME / 1000) + 600,
    });

    const fetchImpl = async (url, init) => {
      if (url === "https://oauth2.googleapis.com/token") {
        const params = new URLSearchParams(init.body);
        assert.equal(params.get("code"), "google-auth-code-1");
        assert.ok(params.get("code_verifier"));
        return new Response(JSON.stringify({ id_token: idToken, access_token: "ya29.test" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "https://www.googleapis.com/oauth2/v3/certs") {
        return new Response(JSON.stringify(signer.jwks), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    // 4) Callback succeeds with matching vt_oauth_state cookie, sets session cookie, clears vt_oauth_state
    const cb = await req(
      env,
      "GET",
      `/api/auth/oauth/google/callback?code=google-auth-code-1&state=${encodeURIComponent(state)}`,
      { cookie: oauthStateCookie, options: { ...opts, fetchImpl } }
    );
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get("Location"), "/?complete_profile=1");
    const cookie = extractCookiePair(cb, SESSION_COOKIE_NAME);
    assert.ok(cookie && cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
    const cbSetCookies = getSetCookies(cb);
    assert.ok(cbSetCookies.some((c) => c.startsWith(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes("Max-Age=0")));

    // Replaying the same state (even with matching cookie) must fail with 400 (atomic DELETE RETURNING)
    const replay = await req(
      env,
      "GET",
      `/api/auth/oauth/google/callback?code=google-auth-code-1&state=${encodeURIComponent(state)}`,
      { cookie: oauthStateCookie, options: { ...opts, fetchImpl } }
    );
    assert.equal(replay.status, 400);

    // 5) /api/auth/me shows profile_completed === false
    const me1 = await req(env, "GET", "/api/auth/me", { cookie, options: opts });
    assert.equal(me1.status, 200);
    const u1 = (await me1.json()).user;
    assert.equal(u1.profile_completed, false);
    assert.equal(u1.email, "oauth.user@gmail.com");

    // 6) POST /api/auth/complete-profile flips profile_completed to true
    const complete = await req(env, "POST", "/api/auth/complete-profile", {
      cookie,
      body: {
        full_name: "OAuth Trader",
        username: "oauth_trader",
        dob: "1992-03-14",
        phone: "+447700900123",
      },
      options: opts,
    });
    assert.equal(complete.status, 200);
    const u2 = (await complete.json()).user;
    assert.equal(u2.profile_completed, true);
    assert.equal(u2.username, "oauth_trader");
    assert.equal(u2.phone, "+447700900123");
  });

  it("completes full Apple OAuth form_post flow without same-origin Origin header", async () => {
    const db = createD1TestDb();
    const signer = await createRsaJwtSigner("apple-k1");
    const env = {
      DB: db,
      APPLE_CLIENT_ID: "com.vektor.web",
      APPLE_CLIENT_SECRET: "apple-pre-minted-secret",
    };
    const opts = { nowMs: () => BASE_TIME };

    const start = await req(env, "GET", "/api/auth/oauth/apple", { options: opts });
    assert.equal(start.status, 302);
    const authUrl = new URL(start.headers.get("Location"));
    assert.equal(authUrl.origin, "https://appleid.apple.com");
    assert.equal(authUrl.searchParams.get("response_mode"), "form_post");
    const state = authUrl.searchParams.get("state");
    const nonce = authUrl.searchParams.get("nonce");
    const oauthStateCookie = extractCookiePair(start, OAUTH_STATE_COOKIE_NAME);
    assert.equal(oauthStateCookie, `${OAUTH_STATE_COOKIE_NAME}=${state}`);
    const appleStartSetCookie = getSetCookies(start).find((c) => c.startsWith(`${OAUTH_STATE_COOKIE_NAME}=`));
    assert.ok(appleStartSetCookie.includes("SameSite=None"));
    assert.ok(appleStartSetCookie.includes("Secure"));

    const idToken = await signer.sign({
      iss: "https://appleid.apple.com",
      aud: env.APPLE_CLIENT_ID,
      sub: "apple-sub-777",
      email: "apple.trader@icloud.com",
      email_verified: "true",
      nonce,
      exp: Math.floor(BASE_TIME / 1000) + 600,
    });

    const fetchImpl = async (url) => {
      if (url === "https://appleid.apple.com/auth/token") {
        return new Response(JSON.stringify({ id_token: idToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "https://appleid.apple.com/auth/keys") {
        return new Response(JSON.stringify(signer.jwks), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    // Apple sends POST form_post cross-site from https://appleid.apple.com
    const formBody = new URLSearchParams({
      code: "apple-auth-code-1",
      state,
      user: JSON.stringify({ name: { firstName: "Jane", lastName: "Doe" } }),
    }).toString();

    const cb = await req(env, "POST", "/api/auth/oauth/apple/callback", {
      body: formBody,
      cookie: oauthStateCookie,
      origin: "https://appleid.apple.com",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      options: { ...opts, fetchImpl },
    });
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get("Location"), "/?complete_profile=1");
    const cookie = extractCookiePair(cb, SESSION_COOKIE_NAME);
    assert.ok(cookie && cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
    assert.ok(getSetCookies(cb).some((c) => c.startsWith(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes("Max-Age=0")));

    const me = await req(env, "GET", "/api/auth/me", { cookie, options: opts });
    assert.equal(me.status, 200);
    const u = (await me.json()).user;
    assert.equal(u.email, "apple.trader@icloud.com");
    assert.equal(u.full_name, "Jane Doe");
    assert.equal(u.profile_completed, false);
  });
});

describe("ACC — Security Review Regression Tests", () => {
  it("rejects Apple callback when email_verified is false or omitted (403) and blocks account takeover", async () => {
    const db = createD1TestDb();
    const signer = await createRsaJwtSigner("apple-sec-1");
    const env = {
      DB: db,
      ADMIN_EMAIL: "boss@vektor.test",
      ADMIN_BOOTSTRAP_SECRET: "super-secret-bootstrap-token-2026",
      APPLE_CLIENT_ID: "com.vektor.web",
      APPLE_CLIENT_SECRET: "apple-pre-minted-secret",
    };
    const opts = { nowMs: () => BASE_TIME };

    // Create an existing admin account
    const regAdmin = await req(env, "POST", "/api/auth/register", {
      body: validUserPayload({
        email: "boss@vektor.test",
        username: "vektor_boss",
        admin_bootstrap_secret: "super-secret-bootstrap-token-2026",
      }),
      options: opts,
    });
    assert.equal(regAdmin.status, 201);

    for (const emailVerifiedClaim of [false, "false", undefined]) {
      const start = await req(env, "GET", "/api/auth/oauth/apple", { options: opts });
      assert.equal(start.status, 302);
      const authUrl = new URL(start.headers.get("Location"));
      const state = authUrl.searchParams.get("state");
      const nonce = authUrl.searchParams.get("nonce");
      const oauthStateCookie = extractCookiePair(start, OAUTH_STATE_COOKIE_NAME);

      const claims = {
        iss: "https://appleid.apple.com",
        aud: env.APPLE_CLIENT_ID,
        sub: `attacker-apple-sub-${String(emailVerifiedClaim)}`,
        email: "boss@vektor.test",
        nonce,
        exp: Math.floor(BASE_TIME / 1000) + 600,
      };
      if (emailVerifiedClaim !== undefined) {
        claims.email_verified = emailVerifiedClaim;
      }
      const idToken = await signer.sign(claims);

      const fetchImpl = async (url) => {
        if (url === "https://appleid.apple.com/auth/token") {
          return new Response(JSON.stringify({ id_token: idToken }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "https://appleid.apple.com/auth/keys") {
          return new Response(JSON.stringify(signer.jwks), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      };

      const formBody = new URLSearchParams({ code: "apple-code", state }).toString();
      const cb = await req(env, "POST", "/api/auth/oauth/apple/callback", {
        body: formBody,
        cookie: oauthStateCookie,
        origin: "https://appleid.apple.com",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        options: { ...opts, fetchImpl },
      });
      assert.equal(cb.status, 403, `Expected 403 for email_verified=${String(emailVerifiedClaim)}`);
    }

    // Verify no oauth_accounts row was linked to the admin
    const linked = db._sqlite.prepare("SELECT COUNT(*) AS cnt FROM oauth_accounts").get();
    assert.equal(linked.cnt, 0);

    // Direct defense-in-depth check on findOrCreateOAuthUser
    const directRes = await findOrCreateOAuthUser(
      db,
      "apple",
      { providerUserId: "direct-sub-1", email: "boss@vektor.test", emailVerified: false },
      { nowMs: BASE_TIME }
    );
    assert.equal(directRes.ok, false);
    assert.equal(directRes.status, 403);
  });

  it("blocks OAuth Login CSRF (403) when vt_oauth_state browser cookie is missing or mismatched", async () => {
    const db = createD1TestDb();
    const env = {
      DB: db,
      GOOGLE_CLIENT_ID: "google-client-123",
      GOOGLE_CLIENT_SECRET: "google-secret-456",
      APPLE_CLIENT_ID: "com.vektor.web",
      APPLE_CLIENT_SECRET: "apple-pre-minted-secret",
    };
    const opts = { nowMs: () => BASE_TIME };

    // Google start
    const gStart = await req(env, "GET", "/api/auth/oauth/google", { options: opts });
    const gState = new URL(gStart.headers.get("Location")).searchParams.get("state");

    // Missing cookie -> 403
    const gMissing = await req(
      env,
      "GET",
      `/api/auth/oauth/google/callback?code=c1&state=${encodeURIComponent(gState)}`,
      { options: opts }
    );
    assert.equal(gMissing.status, 403);
    assert.ok(getSetCookies(gMissing).some((c) => c.startsWith(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes("Max-Age=0")));

    // Mismatched cookie -> 403
    const gMismatch = await req(
      env,
      "GET",
      `/api/auth/oauth/google/callback?code=c1&state=${encodeURIComponent(gState)}`,
      { cookie: `${OAUTH_STATE_COOKIE_NAME}=wrong-state-value`, options: opts }
    );
    assert.equal(gMismatch.status, 403);

    // Apple start
    const aStart = await req(env, "GET", "/api/auth/oauth/apple", { options: opts });
    const aState = new URL(aStart.headers.get("Location")).searchParams.get("state");

    // Missing cookie -> 403
    const aMissing = await req(env, "POST", "/api/auth/oauth/apple/callback", {
      body: new URLSearchParams({ code: "c2", state: aState }).toString(),
      origin: "https://appleid.apple.com",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      options: opts,
    });
    assert.equal(aMissing.status, 403);
    assert.ok(getSetCookies(aMissing).some((c) => c.startsWith(`${OAUTH_STATE_COOKIE_NAME}=;`) && c.includes("Max-Age=0")));

    // Mismatched cookie -> 403
    const aMismatch = await req(env, "POST", "/api/auth/oauth/apple/callback", {
      body: new URLSearchParams({ code: "c2", state: aState }).toString(),
      cookie: `${OAUTH_STATE_COOKIE_NAME}=wrong-apple-state`,
      origin: "https://appleid.apple.com",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      options: opts,
    });
    assert.equal(aMismatch.status, 403);

    // State rows were NOT consumed by the rejected CSRF probes
    const stateCount = db._sqlite.prepare("SELECT COUNT(*) AS cnt FROM oauth_states").get();
    assert.equal(stateCount.cnt, 2);
  });

  it("sanitizes open-redirect return_to payloads including /%09/evil.com and /\\t/evil.com to '/'", async () => {
    assert.equal(sanitizeReturnTo("/%09/evil.com"), "/");
    assert.equal(sanitizeReturnTo("/\t/evil.com"), "/");
    assert.equal(sanitizeReturnTo("/\r\n/evil.com"), "/");
    assert.equal(sanitizeReturnTo("//evil.com"), "/");
    assert.equal(sanitizeReturnTo("/\\evil.com"), "/");
    assert.equal(sanitizeReturnTo("https://evil.com/phish"), "/");
    assert.equal(sanitizeReturnTo("/charts?sym=BTCUSDT"), "/charts?sym=BTCUSDT");

    const db = createD1TestDb();
    const env = {
      DB: db,
      GOOGLE_CLIENT_ID: "google-client-123",
      GOOGLE_CLIENT_SECRET: "google-secret-456",
    };
    const opts = { nowMs: () => BASE_TIME };

    const res = await req(env, "GET", "/api/auth/oauth/google?return_to=/%09/evil.com", { options: opts });
    assert.equal(res.status, 302);
    const row = db._sqlite.prepare("SELECT return_to FROM oauth_states").get();
    assert.equal(row.return_to, "/");
  });

  it("returns 400 on malformed %ZZ namespace/userId, 409 on duplicate username in completeProfile, and 400 on oversized login password", async () => {
    const db = createD1TestDb();
    const env = {
      DB: db,
      ADMIN_EMAIL: "boss@vektor.test",
      ADMIN_BOOTSTRAP_SECRET: "super-secret-bootstrap-token-2026",
    };
    const opts = { nowMs: () => BASE_TIME };

    const regAdmin = await req(env, "POST", "/api/auth/register", {
      body: validUserPayload({
        email: "boss@vektor.test",
        username: "taken_name",
        admin_bootstrap_secret: "super-secret-bootstrap-token-2026",
      }),
      options: opts,
    });
    assert.equal(regAdmin.status, 201);
    const adminCookie = extractCookiePair(regAdmin);

    // Malformed %ZZ namespace -> 400 (not 500)
    const badNs = await req(env, "PUT", "/api/me/data/%ZZ", {
      cookie: adminCookie,
      body: { test: 1 },
      options: opts,
    });
    assert.equal(badNs.status, 400);

    // Malformed %ZZ admin target user ID -> 400 (not 500)
    const badAdminId = await req(env, "POST", "/api/admin/users/%ZZ", {
      cookie: adminCookie,
      body: { plan: "pro" },
      options: opts,
    });
    assert.equal(badAdminId.status, 400);

    // Oversized password (> 256 chars) in login -> 400 before PBKDF2
    const hugePw = await req(env, "POST", "/api/auth/login", {
      body: { email: "boss@vektor.test", password: "A".repeat(300) },
      options: opts,
    });
    assert.equal(hugePw.status, 400);

    // Create a second OAuth user and try to claim "taken_name" in completeProfile -> 409
    const oauthUser = await findOrCreateOAuthUser(
      db,
      "google",
      { providerUserId: "g-dup-1", email: "new.oauth@example.com", emailVerified: true },
      { nowMs: BASE_TIME }
    );
    assert.equal(oauthUser.ok, true);
    const reg2CookieRes = await req(env, "POST", "/api/auth/register", {
      body: validUserPayload({ email: "other@example.com", username: "other_user" }),
      options: opts,
    });
    const otherCookie = extractCookiePair(reg2CookieRes);

    const dupComplete = await req(env, "POST", "/api/auth/complete-profile", {
      cookie: otherCookie,
      body: {
        full_name: "Other Trader",
        username: "TAKEN_NAME",
        dob: "1994-05-10",
        phone: "+14155550199",
      },
      options: opts,
    });
    assert.equal(dupComplete.status, 409);
  });

  it("wires /api/auth/* cleanly through functions/api/[[path]].js with strict CORS & Vary: Origin", async () => {
    const db = createD1TestDb();
    const env = { DB: db, ALLOWED_ORIGINS: "https://trusted.vektor.test" };

    const reqAllowed = new Request("https://terminal.vektor.test/api/auth/providers", {
      method: "GET",
      headers: { Origin: "https://trusted.vektor.test" },
    });
    const resAllowed = await onApiRequest({ request: reqAllowed, env });
    assert.equal(resAllowed.status, 200);
    assert.equal(resAllowed.headers.get("access-control-allow-origin"), "https://trusted.vektor.test");
    assert.ok(resAllowed.headers.get("vary").toLowerCase().includes("origin"));
    assert.deepEqual((await resAllowed.json()).providers, { email: true, google: false, apple: false });

    const reqEvil = new Request("https://terminal.vektor.test/api/auth/providers", {
      method: "GET",
      headers: { Origin: "https://evil.example" },
    });
    const resEvil = await onApiRequest({ request: reqEvil, env });
    assert.equal(resEvil.status, 200);
    assert.equal(resEvil.headers.get("access-control-allow-origin"), null);
  });
});
