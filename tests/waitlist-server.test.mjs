// tests/waitlist-server.test.mjs — Real node:sqlite D1 tests for pre-launch waitlist & admin RBAC.
// Run: node tests/waitlist-server.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  SESSION_COOKIE_NAME,
  createSession,
  registerUser,
} from "../shared/auth.js";
import {
  WAITLIST_MAX_BYTES,
  handleWaitlistRoute,
  joinWaitlist,
  listWaitlistAdmin,
  resetWaitlistRateLimitMemory,
} from "../shared/waitlist.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_MIGRATION_SQL = readFileSync(
  join(__dirname, "..", "migrations", "0001_auth_and_user_data.sql"),
  "utf8"
);
const WAITLIST_MIGRATION_SQL = readFileSync(
  join(__dirname, "..", "migrations", "0002_waitlist.sql"),
  "utf8"
);
const VERIFY_MIGRATION_SQL = readFileSync(
  join(__dirname, "..", "migrations", "0003_verification_and_consent.sql"),
  "utf8"
);

const BASE_ORIGIN = "https://terminal.vektor.test";
const BASE_TIME = Date.UTC(2026, 10, 19, 14, 0, 0);

function createD1TestDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(AUTH_MIGRATION_SQL);
  sqlite.exec(WAITLIST_MIGRATION_SQL);
  sqlite.exec(VERIFY_MIGRATION_SQL);

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

async function req(
  env,
  method,
  path,
  { body = null, cookie = null, origin = BASE_ORIGIN, headers = {}, options = {} } = {}
) {
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
  return handleWaitlistRoute(request, env, options);
}

describe("WAITLIST — Validation, Canonical Deduplication, Security & Admin RBAC", () => {
  it("returns null for non-waitlist routes so it composes cleanly", async () => {
    const db = createD1TestDb();
    const res = await req({ DB: db }, "GET", "/api/health");
    assert.equal(res, null);
  });

  it("rejects invalid emails strictly", async () => {
    resetWaitlistRateLimitMemory();
    const db = createD1TestDb();
    const env = { DB: db };
    const opts = { nowMs: () => BASE_TIME };

    const invalidInputs = [
      "",
      "not-an-email",
      "bad space@example.com",
      "+onlytag@example.com",
      "user@localhost",
      "user@bad..example.com",
      "user@example.c",
      "user<script>@example.com",
    ];

    for (const email of invalidInputs) {
      const res = await req(env, "POST", "/api/waitlist", {
        body: { email },
        options: opts,
      });
      assert.equal(res.status, 400, `Expected 400 for email=${JSON.stringify(email)}`);
      const json = await res.json();
      assert.equal(json.ok, false);
      assert.equal(typeof json.error, "string");
    }

    const rowCount = db._sqlite.prepare("SELECT COUNT(*) AS cnt FROM waitlist").get();
    assert.equal(rowCount.cnt, 0);
  });

  it("deduplicates +tag aliases via canonical_email with idempotent friendly success", async () => {
    resetWaitlistRateLimitMemory();
    const db = createD1TestDb();
    const env = { DB: db };
    const opts = { nowMs: () => BASE_TIME };

    const first = await req(env, "POST", "/api/waitlist", {
      body: { email: "Trader@Desk.IO", source: "landing" },
      options: opts,
    });
    assert.equal(first.status, 200);
    const firstJson = await first.json();
    assert.deepEqual(firstJson, { ok: true, message: "You're on the waitlist." });

    // Second submission with +tag alias on same domain
    const second = await req(env, "POST", "/api/waitlist", {
      body: { email: "trader+promo2027@desk.io", source: "hero" },
      options: opts,
    });
    assert.equal(second.status, 200);
    const secondJson = await second.json();
    assert.deepEqual(secondJson, { ok: true, message: "You're on the waitlist." });

    // Only one row stored
    const rows = db._sqlite.prepare("SELECT email, canonical_email, source FROM waitlist").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, "trader@desk.io");
    assert.equal(rows[0].canonical_email, "trader@desk.io");
    assert.equal(rows[0].source, "landing");
  });

  it("rejects payloads over 8 KB with 413", async () => {
    resetWaitlistRateLimitMemory();
    const db = createD1TestDb();
    const env = { DB: db };

    const oversized = JSON.stringify({
      email: "big@example.com",
      source: "x".repeat(WAITLIST_MAX_BYTES + 256),
    });

    const res = await req(env, "POST", "/api/waitlist", {
      body: oversized,
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(res.status, 413);
    const json = await res.json();
    assert.equal(json.ok, false);
  });

  it("enforces strict CSRF Origin checks with 403", async () => {
    resetWaitlistRateLimitMemory();
    const db = createD1TestDb();
    const env = { DB: db };

    // Cross-origin request
    const crossOrigin = await req(env, "POST", "/api/waitlist", {
      body: { email: "csrf@example.com" },
      origin: "https://evil.attacker.test",
    });
    assert.equal(crossOrigin.status, 403);

    // Missing Origin and Referer
    const missingOrigin = await req(env, "POST", "/api/waitlist", {
      body: { email: "csrf@example.com" },
      origin: null,
    });
    assert.equal(missingOrigin.status, 403);

    // Cross-site Sec-Fetch-Site
    const crossSite = await req(env, "POST", "/api/waitlist", {
      body: { email: "csrf@example.com" },
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    assert.equal(crossSite.status, 403);
  });

  it("enforces per-IP rate limiting with 429 and Retry-After", async () => {
    resetWaitlistRateLimitMemory();
    const db = createD1TestDb();
    const env = { DB: db };
    const opts = {
      nowMs: () => BASE_TIME,
      rateLimit: { maxRequests: 2, windowMs: 60_000 },
    };

    const r1 = await req(env, "POST", "/api/waitlist", {
      body: { email: "one@example.com" },
      headers: { "CF-Connecting-IP": "203.0.113.42" },
      options: opts,
    });
    assert.equal(r1.status, 200);

    const r2 = await req(env, "POST", "/api/waitlist", {
      body: { email: "two@example.com" },
      headers: { "CF-Connecting-IP": "203.0.113.42" },
      options: opts,
    });
    assert.equal(r2.status, 200);

    const r3 = await req(env, "POST", "/api/waitlist", {
      body: { email: "three@example.com" },
      headers: { "CF-Connecting-IP": "203.0.113.42" },
      options: opts,
    });
    assert.equal(r3.status, 429);
    assert.ok(Number(r3.headers.get("Retry-After")) >= 1);
  });

  it("protects GET /api/admin/waitlist: 401 unauthenticated, 403 non-admin, 200 admin", async () => {
    resetWaitlistRateLimitMemory();
    const db = createD1TestDb();
    const env = {
      DB: db,
      ADMIN_EMAIL: "tyler@vektor.test",
      ADMIN_BOOTSTRAP_SECRET: "super-secret-bootstrap-token-2027",
    };
    const opts = { nowMs: () => BASE_TIME };

    // Seed two waitlist entries
    await joinWaitlist(db, { email: "first@desk.io", source: "landing" }, { nowMs: BASE_TIME });
    await joinWaitlist(db, { email: "second@desk.io", source: "hero" }, { nowMs: BASE_TIME + 1000 });

    // 1. Unauthenticated -> 401
    const unauth = await req(env, "GET", "/api/admin/waitlist", { options: opts });
    assert.equal(unauth.status, 401);

    // 2. Authenticated regular user -> 403
    const regularReg = await registerUser(
      db,
      {
        email: "member@example.com",
        password: "VektorStrong2026!",
        full_name: "Regular Member",
        username: "reg_member",
        dob: "1994-03-10",
        phone: "+14155550101",
        terms_accepted: true,
      },
      { env, nowMs: BASE_TIME }
    );
    assert.equal(regularReg.ok, true);
    assert.equal(regularReg.user.role, "user");

    const regularSess = await createSession(db, regularReg.user.id, { nowMs: BASE_TIME });
    const nonAdminRes = await req(env, "GET", "/api/admin/waitlist", {
      cookie: `${SESSION_COOKIE_NAME}=${regularSess.token}`,
      options: opts,
    });
    assert.equal(nonAdminRes.status, 403);
    const nonAdminJson = await nonAdminRes.json();
    assert.equal(nonAdminJson.ok, false);

    // Direct helper check for non-admin
    const directNonAdmin = await listWaitlistAdmin(db, regularReg.user);
    assert.equal(directNonAdmin.ok, false);
    assert.equal(directNonAdmin.status, 403);

    // 3. Authenticated admin -> 200 with entries ordered newest first
    const adminReg = await registerUser(
      db,
      {
        email: "tyler@vektor.test",
        password: "VektorAdmin2026!",
        full_name: "Tyler Admin",
        username: "tyler_admin",
        dob: "1992-05-20",
        phone: "+14155550102",
        terms_accepted: true,
        admin_bootstrap_secret: env.ADMIN_BOOTSTRAP_SECRET,
      },
      { env, nowMs: BASE_TIME }
    );
    assert.equal(adminReg.ok, true);
    assert.equal(adminReg.user.role, "admin");

    const adminSess = await createSession(db, adminReg.user.id, { nowMs: BASE_TIME });
    const adminRes = await req(env, "GET", "/api/admin/waitlist?limit=10&offset=0", {
      cookie: `${SESSION_COOKIE_NAME}=${adminSess.token}`,
      options: opts,
    });
    assert.equal(adminRes.status, 200);
    const adminJson = await adminRes.json();
    assert.equal(adminJson.ok, true);
    assert.equal(adminJson.total, 2);
    assert.equal(adminJson.entries.length, 2);
    assert.equal(adminJson.entries[0].email, "second@desk.io");
    assert.equal(adminJson.entries[1].email, "first@desk.io");
  });
});
