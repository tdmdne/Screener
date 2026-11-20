// tests/front-door.test.mjs — Same-Origin Front-Door Routing tests for:
// - functions/ws.js + functions/_middleware.js (/ws upgrade forwarding & 503 provenance)
// - functions/api/[[path]].js (/api/bootstrap, /api/bars, /api/hub/stats service-binding forwarding,
//   /api/vs/run server-side Vektor Script, /api/journal/stats server-side Journal/Prop analytics,
//   and zero secret leakage across all responses and error paths).
// Run: node tests/front-door.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { isPublicPath } from "../functions/_middleware.js";
import { onRequest as onWsRequest } from "../functions/ws.js";
import { onRequest as onApiRequest } from "../functions/api/[[path]].js";
import { SESSION_COOKIE_NAME, createSession } from "../shared/auth.js";
import { PROVENANCE } from "../shared/protocol.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_0001_SQL = readFileSync(
  join(__dirname, "..", "migrations", "0001_auth_and_user_data.sql"),
  "utf8"
);
const MIGRATION_0003_SQL = readFileSync(
  join(__dirname, "..", "migrations", "0003_verification_and_consent.sql"),
  "utf8"
);
const MIGRATION_0004_SQL = readFileSync(
  join(__dirname, "..", "migrations", "0004_user_avatar.sql"),
  "utf8"
);

function createTestAuthDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(MIGRATION_0001_SQL);
  sqlite.exec(MIGRATION_0003_SQL);
  sqlite.exec(MIGRATION_0004_SQL);
  return {
    prepare(sql) {
      let bound = [];
      const stmt = sqlite.prepare(sql);
      const handle = {
        bind(...args) {
          bound = args.map((v) => (v === undefined ? null : v));
          return handle;
        },
        async first() {
          const r = stmt.get(...bound);
          return r === undefined ? null : r;
        },
        async all() {
          return { results: stmt.all(...bound), success: true };
        },
        async run() {
          const info = stmt.run(...bound);
          return { success: true, meta: { changes: info.changes } };
        },
      };
      return handle;
    },
  };
}

async function seedSessionCookie(db, role = "admin") {
  const id = `u-${role}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO users (id, email, canonical_email, password_hash, full_name, username, username_lower,
                          profile_completed, role, plan, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, 1, ?, 'free', ?, ?)`
    )
    .bind(id, `${id}@vektor.test`, `${id}@vektor.test`, `User ${role}`, id, id.toLowerCase(), role, now, now)
    .run();
  const { token } = await createSession(db, id, { nowMs: now });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

const SECRET_TD = "td_secret_DO_NOT_LEAK_987654321";
const SECRET_FH = "fh_secret_DO_NOT_LEAK_123456789";

function sampleBars(n = 30) {
  const out = [];
  const baseT = 1763400000;
  let px = 100;
  for (let i = 0; i < n; i++) {
    const o = px;
    const c = Number((o + (i % 3 === 0 ? 1.5 : -0.4)).toFixed(4));
    const h = Math.max(o, c) + 0.8;
    const l = Math.min(o, c) - 0.6;
    out.push({ t: baseT + i * 3600, o, h, l, c, v: 1000 + i * 25 });
    px = c;
  }
  return out;
}

describe("functions/ws.js + _middleware.js — same-origin /ws routing", () => {
  it("middleware allows exact /ws while blocking /ws/* and traversal variants", () => {
    assert.ok(isPublicPath("/ws"), "/ws must be allowed by middleware");
    assert.equal(isPublicPath("/ws/"), false);
    assert.equal(isPublicPath("/ws/foo"), false);
    assert.equal(isPublicPath("/ws/../AGENTS.md"), false);
    assert.equal(isPublicPath("/WS"), false);
    assert.equal(isPublicPath("/functions/ws.js"), false);
  });

  it("forwards GET /ws WebSocket upgrade cleanly via env.MARKET_SERVICE.fetch(request)", async () => {
    let seenReq = null;
    // Simulate a Cloudflare Workers 101-like response object returned verbatim
    const upstreamRes = new Response(null, { status: 200, headers: { "x-forwarded-by": "vektor-market" } });
    const env = {
      MARKET_SERVICE: {
        async fetch(req) {
          seenReq = req;
          return upstreamRes;
        },
      },
    };

    const req = new Request("https://screener-cso.pages.dev/ws?session=abc", {
      method: "GET",
      headers: { Upgrade: "websocket", Connection: "Upgrade" },
    });
    const res = await onWsRequest({ request: req, env });
    assert.strictEqual(res, upstreamRes, "must return service binding response directly without cloning");
    assert.ok(seenReq);
    assert.equal(new URL(seenReq.url).pathname, "/ws");
    assert.equal(new URL(seenReq.url).searchParams.get("session"), "abc");
  });

  it("returns 503 JSON with UNAVAILABLE provenance when MARKET_SERVICE binding is missing", async () => {
    const req = new Request("https://screener-cso.pages.dev/ws", {
      method: "GET",
      headers: { Upgrade: "websocket" },
    });
    const res = await onWsRequest({ request: req, env: { TWELVEDATA_KEY: SECRET_TD } });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-provenance"), PROVENANCE.UNAVAILABLE);

    const text = await res.text();
    assert.ok(!text.includes(SECRET_TD));
    const body = JSON.parse(text);
    assert.equal(body.ok, false);
    assert.equal(body.status.provenance, PROVENANCE.UNAVAILABLE);
    assert.ok(typeof body.status.asOf === "number" && body.status.asOf > 0);
  });

  it("rejects non-WebSocket upgrades (426) and non-GET methods (405)", async () => {
    const res426 = await onWsRequest({
      request: new Request("https://screener-cso.pages.dev/ws", { method: "GET" }),
      env: {},
    });
    assert.equal(res426.status, 426);

    const res405 = await onWsRequest({
      request: new Request("https://screener-cso.pages.dev/ws", {
        method: "POST",
        headers: { Upgrade: "websocket" },
      }),
      env: {},
    });
    assert.equal(res405.status, 405);
  });

  it("returns clean 502 without leaking secrets if MARKET_SERVICE.fetch throws", async () => {
    const env = {
      TWELVEDATA_KEY: SECRET_TD,
      MARKET_SERVICE: {
        async fetch() {
          throw new Error(`upstream failed with apikey=${SECRET_TD}`);
        },
      },
    };
    const req = new Request("https://screener-cso.pages.dev/ws", {
      method: "GET",
      headers: { Upgrade: "websocket" },
    });
    const res = await onWsRequest({ request: req, env });
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.ok(!text.includes(SECRET_TD), "secret leaked in /ws 502 body");
    const body = JSON.parse(text);
    assert.equal(body.status.provenance, PROVENANCE.UNAVAILABLE);
  });
});

describe("functions/api/[[path]].js — MARKET_SERVICE forwarding", () => {
  it("forwards /api/bootstrap, /api/bars, and admin-authenticated /api/hub/stats to env.MARKET_SERVICE", async () => {
    const db = createTestAuthDb();
    const adminCookie = await seedSessionCookie(db, "admin");
    const userCookie = await seedSessionCookie(db, "user");

    const calls = [];
    const env = {
      DB: db,
      MARKET_SERVICE: {
        async fetch(req) {
          const u = new URL(req.url);
          calls.push(u.pathname + u.search);
          return new Response(
            JSON.stringify({ ok: true, path: u.pathname, query: u.search }),
            { status: 200, headers: { "content-type": "application/json", "x-cache": "HIT" } }
          );
        },
      },
    };

    // Audit LOW #6: /api/hub/stats requires admin session (401 unauthenticated / no DB, 403 non-admin)
    const noDbRes = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/hub/stats"),
      env: { MARKET_SERVICE: env.MARKET_SERVICE },
    });
    assert.equal(noDbRes.status, 401);

    const anonStatsRes = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/hub/stats"),
      env,
    });
    assert.equal(anonStatsRes.status, 401);

    const userStatsRes = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/hub/stats", {
        headers: { Cookie: userCookie },
      }),
      env,
    });
    assert.equal(userStatsRes.status, 403);
    assert.equal(calls.length, 0, "unauthenticated/non-admin /api/hub/stats must not hit MARKET_SERVICE");

    for (const [target, headers] of [
      ["/api/bootstrap?sym=BTCUSDT&tf=1H", { Origin: "https://screener-cso.pages.dev" }],
      ["/api/bars?symbol=EURUSD&tf=15m&limit=100", { Origin: "https://screener-cso.pages.dev" }],
      ["/api/hub/stats", { Origin: "https://screener-cso.pages.dev", Cookie: adminCookie }],
    ]) {
      const res = await onApiRequest({
        request: new Request("https://screener-cso.pages.dev" + target, { headers }),
        env,
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("access-control-allow-origin"), "https://screener-cso.pages.dev");
      assert.ok((res.headers.get("vary") || "").includes("Origin"));
      const data = await res.json();
      assert.equal(data.ok, true);
    }

    assert.deepEqual(calls, [
      "/api/bootstrap?sym=BTCUSDT&tf=1H",
      "/api/bars?symbol=EURUSD&tf=15m&limit=100",
      "/api/hub/stats",
    ]);
  });

  it("returns 503 UNAVAILABLE (never synthetic data) when MARKET_SERVICE is unbound", async () => {
    const db = createTestAuthDb();
    const adminCookie = await seedSessionCookie(db, "admin");
    for (const [target, headers] of [
      ["/api/bootstrap?sym=BTCUSDT&tf=1H", {}],
      ["/api/bars?symbol=BTCUSDT&tf=1H", {}],
      ["/api/hub/stats", { Cookie: adminCookie }],
    ]) {
      const res = await onApiRequest({
        request: new Request("https://screener-cso.pages.dev" + target, { headers }),
        env: { DB: db, TWELVEDATA_KEY: SECRET_TD, FINNHUB_API_KEY: SECRET_FH },
      });
      assert.equal(res.status, 503);
      assert.equal(res.headers.get("x-provenance"), PROVENANCE.UNAVAILABLE);
      const text = await res.text();
      assert.ok(!text.includes(SECRET_TD));
      assert.ok(!text.includes(SECRET_FH));
      const data = JSON.parse(text);
      assert.equal(data.ok, false);
      assert.equal(data.status.provenance, PROVENANCE.UNAVAILABLE);
    }
  });

  it("never leaks secrets when MARKET_SERVICE throws on /api/bootstrap or /api/bars", async () => {
    const env = {
      TWELVEDATA_KEY: SECRET_TD,
      MARKET_SERVICE: {
        async fetch() {
          throw new Error(`Connection refused https://api.twelvedata.com?apikey=${SECRET_TD}`);
        },
      },
    };
    const res = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/bars?symbol=AAPL&tf=1D"),
      env,
    });
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.ok(!text.includes(SECRET_TD), "secret leaked in 502 response");
    const data = JSON.parse(text);
    assert.equal(data.ok, false);
    assert.equal(data.status.provenance, PROVENANCE.UNAVAILABLE);
  });
});

describe("functions/api/[[path]].js — /api/vs/run server-side Vektor Script", () => {
  it("executes a valid Vektor Script and returns JSON-array series, hlines, inputs, and cache key", async () => {
    const bars = sampleBars(25);
    const src = [
      'indicator("EMA Test", overlay=true)',
      'len = input(5, "Length", min=2, max=50)',
      'fast = ema(close, len)',
      'plot(fast, "Fast EMA", color=blue, width=2)',
      'hline(100, "Ref", color=gray)',
    ].join("\n");

    const req = new Request("https://screener-cso.pages.dev/api/vs/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ src, bars, inputs: { Length: 5 }, sym: "BTCUSDT", tf: "1H" }),
    });

    const res = await onApiRequest({ request: req, env: {} });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.name, "EMA Test");
    assert.equal(data.overlay, true);
    assert.equal(data.plots.length, 1);
    assert.ok(Array.isArray(data.plots[0].v), "plot.v must serialize as a plain JSON array");
    assert.equal(data.plots[0].v.length, 25);
    assert.equal(data.plots[0].v[0], null);
    assert.equal(typeof data.plots[0].v[24], "number");
    assert.ok(Number.isFinite(data.plots[0].v[24]));
    assert.equal(data.hlines.length, 1);
    assert.equal(data.hlines[0].v, 100);
    assert.equal(data.inputs.length, 1);
    assert.equal(data.inputs[0].v, 5);
    assert.ok(typeof data.key === "string" && data.key.startsWith("vs:v1:"));
  });

  it("supports compact 6-tuple bars and MARKET_SERVICE bar lookup when bars are omitted", async () => {
    const tupleBars = sampleBars(15).map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]);
    const env = {
      MARKET_SERVICE: {
        async fetch(req) {
          const u = new URL(req.url);
          assert.equal(u.pathname, "/api/bars");
          assert.equal(u.searchParams.get("symbol"), "ETHUSDT");
          assert.equal(u.searchParams.get("tf"), "1H");
          return new Response(JSON.stringify({ ok: true, bars: tupleBars }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    };

    const req = new Request("https://screener-cso.pages.dev/api/vs/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ src: 'plot(sma(close, 3), "SMA3")', sym: "ETHUSDT", tf: "1H" }),
    });
    const res = await onApiRequest({ request: req, env });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.plots[0].v.length, 15);
    assert.equal(data.plots[0].v[0], null);
    assert.equal(data.plots[0].v[1], null);
    assert.equal(typeof data.plots[0].v[2], "number");
  });

  it("returns structured { ok: false, error, line, col, hint } on script syntax & runtime errors", async () => {
    const bars = sampleBars(10);

    // Unknown function with suggestion hint on line 2
    const req1 = new Request("https://screener-cso.pages.dev/api/vs/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ src: "x = close\nplot(emaa(close, 10))", bars }),
    });
    const res1 = await onApiRequest({ request: req1, env: { TWELVEDATA_KEY: SECRET_TD } });
    assert.equal(res1.status, 422);
    const text1 = await res1.text();
    assert.ok(!text1.includes(SECRET_TD));
    const err1 = JSON.parse(text1);
    assert.equal(err1.ok, false);
    assert.equal(typeof err1.error, "string");
    assert.ok(err1.error.length > 0);
    assert.equal(err1.line, 2);
    assert.ok(typeof err1.col === "number" && err1.col >= 1);
    assert.ok(typeof err1.hint === "string" && err1.hint.includes("ema"));

    // Invalid JSON -> 400 with structured keys
    const reqBad = new Request("https://screener-cso.pages.dev/api/vs/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad-json",
    });
    const resBad = await onApiRequest({ request: reqBad, env: {} });
    assert.equal(resBad.status, 400);
    const errBad = await resBad.json();
    assert.equal(errBad.ok, false);
    assert.equal(typeof errBad.error, "string");
    assert.equal(typeof errBad.line, "number");
    assert.equal(typeof errBad.col, "number");
    assert.equal(typeof errBad.hint, "string");
  });
});

describe("functions/api/[[path]].js — /api/journal/stats server-side analytics", () => {
  it("computes stats, equity curve, drawdown, R-distribution, calendar, and prop status with zero external calls", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("External fetch MUST NOT be called by /api/journal/stats");
    };

    try {
      const trades = [
        {
          id: "t1",
          sym: "NQ=F",
          side: "long",
          open: "2026-05-01T09:30",
          close: "2026-05-01T10:15",
          entry: 20000,
          exit: 20050,
          stop: 19975,
          qty: 2,
          pv: 20,
          fees: 10,
          setup: "Breakout",
          acct: "Apex50K",
        }, // pnl = +1990, risk = 1000, R = 1.99
        {
          id: "t2",
          sym: "NQ=F",
          side: "short",
          open: "2026-05-02T09:30",
          close: "2026-05-02T10:00",
          entry: 20100,
          exit: 20125,
          stop: 20125,
          qty: 1,
          pv: 20,
          fees: 5,
          setup: "MeanRev",
          acct: "Apex50K",
        }, // pnl = -505, risk = 500, R = -1.01
        {
          id: "t3",
          sym: "BTCUSDT",
          side: "long",
          open: "2026-05-03T11:00",
          close: "2026-05-03T12:00",
          entry: 90000,
          exit: 91000,
          stop: 89500,
          qty: 1,
          pv: 1,
          fees: 0,
          setup: "Breakout",
          acct: "Apex50K",
        }, // pnl = +1000, risk = 500, R = 2.0
      ];

      const req = new Request("https://screener-cso.pages.dev/api/journal/stats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trades,
          startBal: 50000,
          today: "2026-05-03",
          prop: { acct: 50000, dailyDD: 3, maxDD: 5, trailing: true, target: 6 },
          account: { name: "Apex50K", size: 50000, target: 6, daily: 3, maxdd: 5, mindays: 3, trailing: true },
        }),
      });

      const res = await onApiRequest({
        request: req,
        env: { TWELVEDATA_KEY: SECRET_TD, FINNHUB_API_KEY: SECRET_FH },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "no-store");

      const text = await res.text();
      assert.ok(!text.includes(SECRET_TD));
      assert.ok(!text.includes(SECRET_FH));
      const data = JSON.parse(text);

      assert.equal(data.ok, true);
      assert.equal(data.stats.n, 3);
      assert.equal(data.stats.wins, 2);
      assert.equal(data.stats.losses, 1);
      assert.equal(data.stats.net, 2485);
      assert.equal(data.stats.balance, 52485);
      assert.deepEqual(data.stats.equity, [50000, 51990, 51485, 52485]);

      assert.equal(data.journal.n, 3);
      assert.equal(data.journal.net, 2485);
      assert.equal(data.journal.bySetup.Breakout.n, 2);
      assert.equal(data.journal.bySetup.Breakout.net, 2990);

      assert.equal(data.equityCurve.length, 3);
      assert.equal(data.equityCurve[0].equity, 51990);
      assert.equal(data.equityCurve[1].drawdown, 505);
      assert.equal(data.equityCurve[2].equity, 52485);

      assert.equal(data.drawdown.maxDD, 505);
      assert.equal(data.rDistribution.count, 3);
      assert.equal(data.calendar.tradingDays, 3);
      assert.equal(data.calendar.totalPnl, 2485);

      assert.equal(data.prop.balance, 52485);
      assert.equal(data.prop.breached, false);
      assert.equal(data.prop.status, "active");

      assert.equal(data.account.bal, 52485);
      assert.equal(data.account.nDays, 3);
      assert.equal(data.account.status, "active");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("validates HTTP method and payload limits on /api/journal/stats", async () => {
    const res405 = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/journal/stats", { method: "GET" }),
      env: {},
    });
    assert.equal(res405.status, 405);

    const res400 = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/journal/stats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trades: "not-an-array" }),
      }),
      env: {},
    });
    assert.equal(res400.status, 400);
  });
});

describe("Security & architecture hardening regressions (CORS, CSWSH, body bounds, validation, middleware)", () => {
  it("enforces strict Origin validation on /ws upgrades (CSWSH 403) and OPTIONS preflight", async () => {
    let forwarded = 0;
    const env = {
      ALLOWED_ORIGINS: "https://terminal.vektor.example, https://staging.vektor.example",
      MARKET_SERVICE: {
        async fetch() {
          forwarded += 1;
          return new Response(null, { status: 200 });
        },
      },
    };

    // Disallowed cross-origin browser upgrade -> 403 JSON, NEVER forwarded
    for (const badOrigin of ["https://evil.example", "null", "javascript:alert(1)", "   "]) {
      const res = await onWsRequest({
        request: new Request("https://screener-cso.pages.dev/ws", {
          method: "GET",
          headers: { Upgrade: "websocket", Origin: badOrigin },
        }),
        env,
      });
      assert.equal(res.status, 403, `Expected 403 for Origin=${JSON.stringify(badOrigin)}`);
      assert.equal(res.headers.get("access-control-allow-origin"), null);
      assert.ok((res.headers.get("vary") || "").includes("Origin"));
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.equal(body.code, "FORBIDDEN_ORIGIN");
      assert.equal(body.status.provenance, PROVENANCE.UNAVAILABLE);
    }
    assert.equal(forwarded, 0, "Disallowed origins must never reach upstream MARKET_SERVICE");

    // Disallowed OPTIONS preflight -> 403, never wildcard '*'
    const optBad = await onWsRequest({
      request: new Request("https://screener-cso.pages.dev/ws", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      }),
      env,
    });
    assert.equal(optBad.status, 403);
    assert.equal(optBad.headers.get("access-control-allow-origin"), null);

    // Same-origin & ALLOWED_ORIGINS upgrades -> allowed and forwarded
    for (const goodOrigin of ["https://screener-cso.pages.dev", "https://terminal.vektor.example"]) {
      const res = await onWsRequest({
        request: new Request("https://screener-cso.pages.dev/ws", {
          method: "GET",
          headers: { Upgrade: "websocket", Origin: goodOrigin },
        }),
        env,
      });
      assert.equal(res.status, 200);
    }
    assert.equal(forwarded, 2);

    // Allowed OPTIONS -> exact Origin + Vary: Origin (never '*')
    const optOk = await onWsRequest({
      request: new Request("https://screener-cso.pages.dev/ws", {
        method: "OPTIONS",
        headers: { Origin: "https://terminal.vektor.example" },
      }),
      env,
    });
    assert.equal(optOk.status, 204);
    assert.equal(optOk.headers.get("access-control-allow-origin"), "https://terminal.vektor.example");
    assert.ok((optOk.headers.get("vary") || "").includes("Origin"));
  });

  it("enforces strict CORS on /api/* (never '*', Vary: Origin, ALLOWED_ORIGINS, preserves stricter upstream ACAO)", async () => {
    const env = {
      ALLOWED_ORIGINS: "https://app.vektor.example, *",
      MARKET_SERVICE: {
        async fetch(req) {
          const u = new URL(req.url);
          if (u.searchParams.get("mode") === "wildcard") {
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
            });
          }
          if (u.searchParams.get("mode") === "strict") {
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: {
                "content-type": "application/json",
                "access-control-allow-origin": "https://strict-only.example",
              },
            });
          }
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    };

    // No Origin header -> no ACAO header (never '*'), Vary: Origin present
    const resNoOrigin = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/bootstrap"),
      env,
    });
    assert.equal(resNoOrigin.status, 200);
    assert.equal(resNoOrigin.headers.get("access-control-allow-origin"), null);
    assert.ok((resNoOrigin.headers.get("vary") || "").includes("Origin"));

    // Allowlisted Origin -> echoed cleanly
    const resAllowed = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/bootstrap", {
        headers: { Origin: "https://app.vektor.example" },
      }),
      env,
    });
    assert.equal(resAllowed.headers.get("access-control-allow-origin"), "https://app.vektor.example");
    assert.ok((resAllowed.headers.get("vary") || "").includes("Origin"));

    // Disallowed Origin -> no ACAO, even if upstream returned '*' (and '*' in ALLOWED_ORIGINS is ignored!)
    const resDisallowed = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/bootstrap?mode=wildcard", {
        headers: { Origin: "https://evil.example" },
      }),
      env,
    });
    assert.equal(resDisallowed.headers.get("access-control-allow-origin"), null);
    assert.notEqual(resDisallowed.headers.get("access-control-allow-origin"), "*");
    assert.ok((resDisallowed.headers.get("vary") || "").includes("Origin"));

    // Disallowed OPTIONS preflight -> 403
    const optBad = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/vs/run", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      }),
      env,
    });
    assert.equal(optBad.status, 403);
    assert.equal(optBad.headers.get("access-control-allow-origin"), null);

    // Stricter upstream ACAO is NEVER overwritten
    const resStrict = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/bootstrap?mode=strict", {
        headers: { Origin: "https://screener-cso.pages.dev" },
      }),
      env,
    });
    assert.equal(resStrict.headers.get("access-control-allow-origin"), "https://strict-only.example");
    assert.ok((resStrict.headers.get("vary") || "").includes("Origin"));
  });

  it("never exposes internal binding name MARKET_SERVICE in public JSON error responses", async () => {
    const ws503 = await onWsRequest({
      request: new Request("https://screener-cso.pages.dev/ws", {
        method: "GET",
        headers: { Upgrade: "websocket" },
      }),
      env: {},
    });
    assert.ok(!(await ws503.text()).includes("MARKET_SERVICE"));

    const ws502 = await onWsRequest({
      request: new Request("https://screener-cso.pages.dev/ws", {
        method: "GET",
        headers: { Upgrade: "websocket" },
      }),
      env: { MARKET_SERVICE: { async fetch() { throw new Error("boom"); } } },
    });
    assert.ok(!(await ws502.text()).includes("MARKET_SERVICE"));

    const api503 = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/bootstrap?sym=BTCUSDT&tf=1H"),
      env: {},
    });
    assert.ok(!(await api503.text()).includes("MARKET_SERVICE"));

    const api502 = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/bars?symbol=BTCUSDT&tf=1H"),
      env: { MARKET_SERVICE: { async fetch() { throw new Error("boom"); } } },
    });
    assert.ok(!(await api502.text()).includes("MARKET_SERVICE"));

    const vsNoBars = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/vs/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ src: "plot(close)" }),
      }),
      env: {},
    });
    assert.ok(!(await vsNoBars.text()).includes("MARKET_SERVICE"));
  });

  it("enforces bounded JSON body size (413) and strict pre-compute validation on POST /api/vs/run", async () => {
    // 1. Oversized body (> 256 KB) -> 413 (both streaming body & Content-Length header)
    const hugeBody = JSON.stringify({ src: "plot(close)", pad: "A".repeat(260 * 1024) });
    const res413Stream = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/vs/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: hugeBody,
      }),
      env: {},
    });
    assert.equal(res413Stream.status, 413);

    const res413Cl = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/vs/run", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(300 * 1024) },
        body: JSON.stringify({ src: "plot(close)" }),
      }),
      env: {},
    });
    assert.equal(res413Cl.status, 413);

    // 2. Oversized src (> 20000 chars) rejected BEFORE vsCompute
    const resBigSrc = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/vs/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ src: "a = 1\n".repeat(4000), bars: sampleBars(5) }),
      }),
      env: {},
    });
    assert.equal(resBigSrc.status, 400);

    // 3. > 64 input keys rejected BEFORE vsCompute
    const manyInputs = {};
    for (let i = 0; i < 65; i++) manyInputs[`k${i}`] = i;
    const resManyInp = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/vs/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ src: "plot(close)", bars: sampleBars(5), inputs: manyInputs }),
      }),
      env: {},
    });
    assert.equal(resManyInp.status, 400);

    // 4. bars.length > 1500 rejected
    const resTooManyBars = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/vs/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ src: "plot(close)", bars: sampleBars(1501) }),
      }),
      env: {},
    });
    assert.equal(resTooManyBars.status, 400);

    // 5. Non-positive / corrupted OHLC bars rejected
    for (const badBars of [
      [{ t: 1763400000, o: -1, h: 10, l: 1, c: 5, v: 10 }],
      [{ t: 1763400000, o: 10, h: 9, l: 8, c: 10, v: 10 }], // h < o
      [{ t: 1763400000, o: 10, h: 12, l: 11, c: 10, v: 10 }], // l > o
      [[1763400000, true, 12, 8, 10, 10]], // boolean OHLC
    ]) {
      const resBadBars = await onApiRequest({
        request: new Request("https://screener-cso.pages.dev/api/vs/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ src: "plot(close)", bars: badBars }),
        }),
        env: {},
      });
      assert.equal(resBadBars.status, 400);
    }

    // 6. Invalid sym, tf, limit rejected BEFORE forwarding to MARKET_SERVICE /api/bars
    let fetched = 0;
    const mockEnv = {
      MARKET_SERVICE: {
        async fetch() {
          fetched += 1;
          return new Response(JSON.stringify({ ok: true, bars: sampleBars(5) }), { status: 200 });
        },
      },
    };
    for (const payload of [
      { src: "plot(close)", sym: "BTC&evil=1", tf: "1H" },
      { src: "plot(close)", sym: "../etc/passwd", tf: "1H" },
      { src: "plot(close)", sym: "BTCUSDT", tf: "99X" },
      { src: "plot(close)", sym: "BTCUSDT", tf: "1H", limit: 0 },
      { src: "plot(close)", sym: "BTCUSDT", tf: "1H", limit: 1501 },
      { src: "plot(close)", sym: "BTCUSDT", tf: "1H", limit: true },
    ]) {
      const res = await onApiRequest({
        request: new Request("https://screener-cso.pages.dev/api/vs/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
        env: mockEnv,
      });
      assert.equal(res.status, 400, `Expected 400 for ${JSON.stringify(payload)}`);
    }
    assert.equal(fetched, 0, "Invalid sym/tf/limit must never hit MARKET_SERVICE");
  });

  it("enforces bounded body (413), trade/setup validation, bucketSize bounds, and prop.acct on /api/journal/stats", async () => {
    // 1. Oversized body (> 1 MB) -> 413
    const hugeJournal = JSON.stringify({ trades: [], pad: "B".repeat(1024 * 1024 + 512) });
    const res413 = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/journal/stats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: hugeJournal,
      }),
      env: {},
    });
    assert.equal(res413.status, 413);

    // 2. Malformed trades elements (null, primitive, array, object setup, > 256-char setup) -> 400
    for (const trades of [
      [null],
      ["bad"],
      [123],
      [[]],
      [{ sym: "BTCUSDT", pnl: 100, close: "2026-05-01", setup: { nested: true } }],
      [{ sym: "BTCUSDT", pnl: 100, close: "2026-05-01", setup: "x".repeat(257) }],
    ]) {
      const res = await onApiRequest({
        request: new Request("https://screener-cso.pages.dev/api/journal/stats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ trades }),
        }),
        env: {},
      });
      assert.equal(res.status, 400, `Expected 400 for trades=${JSON.stringify(trades)}`);
    }

    // 3. Numeric/boolean setup coerced safely to string without crashing jrStats
    const resCoerce = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/journal/stats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trades: [{ id: "c1", sym: "BTCUSDT", side: "long", close: "2026-05-01", pnl: 100, setup: 42 }],
        }),
      }),
      env: {},
    });
    assert.equal(resCoerce.status, 200);
    const coerceData = await resCoerce.json();
    assert.equal(coerceData.journal.bySetup["42"].n, 1);

    // 4. Dangerous bucketSize (1e-12 DoS, Infinity, negative, >100, boolean) -> 400
    const baseTrade = {
      id: "t1",
      sym: "NQ=F",
      side: "long",
      open: "2026-05-01T09:30",
      close: "2026-05-01T10:15",
      entry: 20000,
      exit: 20050,
      stop: 19975,
      qty: 1,
      pv: 20,
    };
    for (const badBucket of [1e-12, 0, -1, 100.01, "Infinity", true]) {
      const res = await onApiRequest({
        request: new Request("https://screener-cso.pages.dev/api/journal/stats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ trades: [baseTrade], bucketSize: badBucket }),
        }),
        env: {},
      });
      assert.equal(res.status, 400, `Expected 400 for bucketSize=${String(badBucket)}`);
    }

    // 5. Invalid prop.acct -> 400
    for (const badProp of [{ acct: 0 }, { acct: -50000 }, { acct: true }, { acct: "bad" }, {}]) {
      const res = await onApiRequest({
        request: new Request("https://screener-cso.pages.dev/api/journal/stats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ trades: [baseTrade], prop: badProp }),
        }),
        env: {},
      });
      assert.equal(res.status, 400, `Expected 400 for prop=${JSON.stringify(badProp)}`);
    }
  });

  it("hardens _middleware.js against %00/%5c in /api/* and blocks server-only /shared/* modules", () => {
    assert.equal(isPublicPath("/api/bars%00"), false);
    assert.equal(isPublicPath("/api/bars%5cfoo"), false);
    assert.equal(isPublicPath("/api/bars%5Cfoo"), false);
    assert.equal(isPublicPath("/shared/alerts.js"), false);
    assert.equal(isPublicPath("/shared/journal.js"), false);
    assert.equal(isPublicPath("/shared/protocol.js"), false);
    assert.equal(isPublicPath("/shared/replay.js"), false);
    assert.equal(isPublicPath("/shared/emailValidator.js"), true);
    assert.equal(isPublicPath("/ws"), "ws");
  });

  it("handles POST /api/replay/simulate with strict validation, 405/413/CORS, and stop-before-target tie-breaking", async () => {
    // 1. 405 on non-POST
    const res405 = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/replay/simulate", { method: "GET" }),
      env: {},
    });
    assert.equal(res405.status, 405);
    assert.equal(res405.headers.get("allow"), "POST, OPTIONS");

    // 2. 413 on oversized body (> 512 KB)
    const hugeReplay = JSON.stringify({ bars: [], pad: "R".repeat(520 * 1024) });
    const res413Body = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/replay/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: hugeReplay,
      }),
      env: {},
    });
    assert.equal(res413Body.status, 413);

    // 3. 413 on > 500 actions
    const tooManyActions = Array.from({ length: 501 }, () => ({ type: "step", n: 1 }));
    const res413Actions = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/replay/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: "BTCUSDT",
          tf: "1H",
          bars: sampleBars(5),
          actions: tooManyActions,
        }),
      }),
      env: {},
    });
    assert.equal(res413Actions.status, 413);

    // 4. 400 on malformed bars (boolean OHLC)
    const resBadBar = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/replay/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: "BTCUSDT",
          tf: "1H",
          bars: [[1763400000, true, 105, 95, 100, 10]],
        }),
      }),
      env: {},
    });
    assert.equal(resBadBar.status, 400);

    // 5. Valid replay simulation: conservative stop-before-target tie-breaking + strict CORS
    const tieBars = [
      { t: 1763400000, o: 100, h: 101, l: 99, c: 100, v: 50 },
      // Bar 1 hits BOTH SL (95) and TP (110) -> must fill at SL (95), never TP!
      { t: 1763403600, o: 100, h: 112, l: 94, c: 108, v: 80 },
      { t: 1763407200, o: 108, h: 110, l: 107, c: 109, v: 60 },
    ];
    const simPayload = {
      symbol: "BTCUSDT",
      tf: "1H",
      bars: tieBars,
      startIndex: 0,
      balance: 10000,
      riskPct: 1,
      feePct: 0,
      actions: [
        { type: "open", side: "long", orderType: "market", qty: 10, sl: 95, tp: 110 },
        { type: "step", n: 1 },
      ],
    };

    const resOk = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/replay/simulate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://screener-cso.pages.dev",
        },
        body: JSON.stringify(simPayload),
      }),
      env: {},
    });
    assert.equal(resOk.status, 200);
    assert.equal(resOk.headers.get("access-control-allow-origin"), "https://screener-cso.pages.dev");
    const simData = await resOk.json();
    assert.equal(simData.ok, true);
    assert.equal(simData.window.symbol, "BTCUSDT");
    assert.equal(simData.window.currentIndex, 1);
    assert.equal(simData.openPositions.length, 0);
    assert.equal(simData.pendingOrders.length, 0);
    assert.equal(simData.trades.length, 1);
    assert.equal(simData.trades[0].exit, 95, "Tie-break must stop out at SL (95) before TP (110)");
    assert.equal(simData.trades[0].why, "stop");
    assert.equal(simData.trades[0].pnl, -50);
    assert.equal(simData.equity, 9950);
    assert.equal(simData.openPnl, 0);
    assert.equal(simData.stats.losses, 1);

    // 6. Strict CORS: evil origin must NOT receive ACAO header
    const resEvilCors = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/replay/simulate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify(simPayload),
      }),
      env: {},
    });
    assert.equal(resEvilCors.status, 200);
    assert.equal(resEvilCors.headers.get("access-control-allow-origin"), null);
  });

  it("handles POST /api/alerts/evaluate with strict validation, 405/413/CORS, and crossing evaluation", async () => {
    // 1. 405 on non-POST
    const res405 = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/alerts/evaluate", { method: "GET" }),
      env: {},
    });
    assert.equal(res405.status, 405);
    assert.equal(res405.headers.get("allow"), "POST, OPTIONS");

    // 2. 413 on oversized body (> 256 KB)
    const hugeAlerts = JSON.stringify({ alerts: [], pad: "A".repeat(260 * 1024) });
    const res413Body = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/alerts/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: hugeAlerts,
      }),
      env: {},
    });
    assert.equal(res413Body.status, 413);

    // 3. 413 on > 500 alerts
    const tooManyAlerts = Array.from({ length: 501 }, (_, i) => ({
      id: `a${i}`,
      sym: "BTCUSDT",
      condition: "above",
      target: 100000,
    }));
    const res413Count = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/alerts/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alerts: tooManyAlerts }),
      }),
      env: {},
    });
    assert.equal(res413Count.status, 413);

    // 4. 400 on invalid prevPrices (non-positive / boolean)
    const resBadPrev = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/alerts/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alerts: [], prevPrices: { BTCUSDT: true } }),
      }),
      env: {},
    });
    assert.equal(resBadPrev.status, 400);

    // 5. Valid cross_up alert evaluation + strict CORS
    const alertPayload = {
      alerts: [
        { id: "btc-break", sym: "BTCUSDT", condition: "cross_up", target: 100000, mode: "once" },
        { id: "eth-bar", sym: "ETHUSDT", condition: "below", target: 3000, onBarClose: true, mode: "once" },
      ],
      prevPrices: { BTCUSDT: 99500 },
      ticks: [
        { s: "BTCUSDT", c: 99900, t: 1763400000000 },
        { s: "BTCUSDT", c: 100250, t: 1763400005000 },
        { s: "BTCUSDT", c: 100500, t: 1763400010000 }, // already disarmed (mode=once)
      ],
      bars: [
        { sym: "ETHUSDT", o: 3050, h: 3060, l: 2980, c: 2990, t: 1763400060 },
      ],
    };

    const resOk = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/alerts/evaluate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://screener-cso.pages.dev",
        },
        body: JSON.stringify(alertPayload),
      }),
      env: {},
    });
    assert.equal(resOk.status, 200);
    assert.equal(resOk.headers.get("access-control-allow-origin"), "https://screener-cso.pages.dev");
    const evalData = await resOk.json();
    assert.equal(evalData.ok, true);
    assert.equal(evalData.triggered.length, 2);
    assert.equal(evalData.triggered[0].id, "btc-break");
    assert.equal(evalData.triggered[0].price, 100250);
    assert.equal(evalData.triggered[1].id, "eth-bar");
    assert.equal(evalData.frames.length, 2);
    assert.equal(evalData.frames[0].v, 2);
    assert.equal(evalData.frames[0].type, "alert");
    assert.equal(evalData.frames[0].sym, "BTCUSDT");
    assert.equal(evalData.state.alerts.length, 2);
    assert.equal(evalData.state.alerts.find((a) => a.id === "btc-break").armed, false);

    // 6. Strict CORS: evil origin gets no ACAO header
    const resEvilCors = await onApiRequest({
      request: new Request("https://screener-cso.pages.dev/api/alerts/evaluate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify(alertPayload),
      }),
      env: {},
    });
    assert.equal(resEvilCors.status, 200);
    assert.equal(resEvilCors.headers.get("access-control-allow-origin"), null);
  });
});

describe("functions/api/[[path]].js — /api/candles via MARKET_SERVICE", () => {
  it("adapts GET /api/candles through env.MARKET_SERVICE /api/bars with symbol/tf mapping (REST backfill unavailable -> hub-only)", async () => {
    // REST history is tried first (worker.js); with every upstream down the hub-only answer must still be served.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("{}", { status: 500 });
    try {
    const bars = sampleBars(5);
    const seenUrls = [];
    const env = {
      MARKET_SERVICE: {
        async fetch(req) {
          const u = new URL(req.url);
          seenUrls.push(u.pathname + u.search);
          return new Response(
            JSON.stringify({
              ok: true,
              sym: u.searchParams.get("sym"),
              tf: u.searchParams.get("tf"),
              bars,
              hasMore: true,
              provenance: PROVENANCE.LIVE,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        },
      },
    };

    const fxRes = await onApiRequest({
      request: new Request(
        "https://vektorterminal.com/api/candles?symbol=EURUSD&interval=1H&apiSym=EURUSD&mkt=FX&limit=100",
        { headers: { Origin: "https://vektorterminal.com" } }
      ),
      env,
    });
    assert.equal(fxRes.status, 200);
    assert.equal(fxRes.headers.get("x-provenance"), PROVENANCE.LIVE);
    assert.equal(fxRes.headers.get("access-control-allow-origin"), "https://vektorterminal.com");
    const fxData = await fxRes.json();
    assert.equal(fxData.ok, true);
    assert.equal(fxData.symbol, "EURUSD");
    assert.equal(fxData.interval, "1H");
    assert.equal(fxData.source, "market-service");
    assert.equal(fxData.provenance, PROVENANCE.LIVE);
    assert.equal(fxData.hasMore, true);
    assert.equal(fxData.bars.length, 5);

    const cryRes = await onApiRequest({
      request: new Request("https://vektorterminal.com/api/candles?symbol=BTCUSDT&interval=1D&limit=50"),
      env,
    });
    assert.equal(cryRes.status, 200);
    const cryData = await cryRes.json();
    assert.equal(cryData.ok, true);
    assert.equal(cryData.symbol, "BTCUSDT");
    assert.equal(cryData.interval, "1D");
    assert.equal(cryData.bars.length, 5);

    assert.deepEqual(seenUrls.filter((u) => u.startsWith("/api/bars")), [
      "/api/bars?sym=EUR%2FUSD&tf=1h&limit=100",
      "/api/bars?sym=BTCUSDT&tf=1d&limit=50", // crypto: the hub stores Binance bars under the Binance pair
    ]);
    assert.ok(seenUrls.some((u) => u.startsWith("/td/time_series")), "Twelve Data REST history is attempted before the hub-only fallback");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("returns clean 503 JSON with PROVENANCE.UNAVAILABLE (never 502 plain text) when upstream has no bars or throws", async (t) => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("{}", { status: 500 });
    t.after(() => { globalThis.fetch = realFetch; });
    const emptyEnv = {
      TWELVEDATA_KEY: SECRET_TD,
      MARKET_SERVICE: {
        async fetch() {
          return new Response(JSON.stringify({ ok: true, bars: [], hasMore: false }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    };
    const emptyRes = await onApiRequest({
      request: new Request("https://vektorterminal.com/api/candles?symbol=ZZZNONEXISTENT999&interval=1H&limit=100"),
      env: emptyEnv,
    });
    assert.equal(emptyRes.status, 503);
    assert.equal(emptyRes.headers.get("x-provenance"), PROVENANCE.UNAVAILABLE);
    const emptyText = await emptyRes.text();
    assert.ok(!emptyText.includes(SECRET_TD));
    const emptyData = JSON.parse(emptyText);
    assert.equal(emptyData.ok, false);
    assert.equal(emptyData.status.provenance, PROVENANCE.UNAVAILABLE);

    const errEnv = {
      TWELVEDATA_KEY: SECRET_TD,
      MARKET_SERVICE: {
        async fetch() {
          throw new Error(`Upstream boom apikey=${SECRET_TD}`);
        },
      },
    };
    const errRes = await onApiRequest({
      request: new Request("https://vektorterminal.com/api/candles?symbol=ZZZNONEXISTENT999&interval=1H&limit=100"),
      env: errEnv,
    });
    assert.equal(errRes.status, 503);
    assert.equal(errRes.headers.get("x-provenance"), PROVENANCE.UNAVAILABLE);
    const errText = await errRes.text();
    assert.ok(!errText.includes(SECRET_TD), "secret leaked in /api/candles 503 body");
    const errData = JSON.parse(errText);
    assert.equal(errData.ok, false);
    assert.equal(errData.status.provenance, PROVENANCE.UNAVAILABLE);
  });
});
