// tests/market-canonical.test.mjs — Task 1 tests for workers/market/index.js:
// canonical(), allowedOrigin(), TdBudget DO, Cache API /td/* proxy (zero KV writes on live misses).
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker, { TdBudget, allowedOrigin, canonical } from "../workers/market/index.js";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, "-", err && err.stack ? err.stack : err);
    process.exitCode = 1;
  }
}

function createSqliteMock() {
  const db = new DatabaseSync(":memory:");
  return {
    db,
    sql: {
      exec(query, ...bindings) {
        const stmt = db.prepare(query);
        const trimmed = query.trim().toUpperCase();
        if (trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA")) {
          const rows = stmt.all(...bindings).map((r) => ({ ...r }));
          return {
            toArray: () => rows,
            one: () => rows[0],
            [Symbol.iterator]: () => rows[Symbol.iterator](),
          };
        }
        stmt.run(...bindings);
        return {
          toArray: () => [],
          one: () => undefined,
          [Symbol.iterator]: () => [][Symbol.iterator](),
        };
      },
    },
  };
}

await test("canonical(): normalizes allowlisted /td/* paths, sorts params, strips secrets & cache-busters", () => {
  const a = canonical(
    "/TD/Time_Series/?timezone=utc&symbol=eur/usd&apikey=SECRET123&outputsize=500&interval=1H&_=99999&utm_source=x"
  );
  const b = canonical("/td/time_series", {
    interval: "1h",
    outputsize: "500",
    symbol: "EUR/USD",
    timezone: "UTC",
    token: "LEAK",
  });
  assert.equal(a, "/td/time_series?interval=1h&outputsize=500&symbol=EUR%2FUSD&timezone=UTC");
  assert.equal(a, b);
  assert.ok(!a.includes("SECRET123"));
  assert.ok(!a.includes("apikey"));
  assert.ok(!a.includes("utm_source"));
});

await test("canonical(): clamps outputsize to 5000 and handles URL objects + all allowlisted endpoints", () => {
  const u = new URL("https://vektor-market.example/td/time_series/?symbol=aapl&interval=1day&outputsize=99999&order=asc");
  assert.equal(
    canonical(u),
    "/td/time_series?interval=1day&order=ASC&outputsize=5000&symbol=AAPL"
  );
  assert.equal(canonical("/td/price?symbol=btc/usd&api_key=abc"), "/td/price?symbol=BTC%2FUSD");
  assert.equal(canonical("/td/quote?symbol=eur/usd&interval=1h"), "/td/quote?interval=1h&symbol=EUR%2FUSD");
  assert.equal(canonical("/td/symbol_search?symbol=aapl&outputsize=10"), "/td/symbol_search?outputsize=10&symbol=AAPL");
  assert.equal(canonical("/td/exchange_rate?symbol=EUR/USD&date=2026-11-18"), "/td/exchange_rate?date=2026-11-18&symbol=EUR%2FUSD");
});

await test("canonical(): rejects non-allowlisted or malformed paths", () => {
  for (const bad of [
    "",
    "/",
    "/td/unknown",
    "/td/time_series/extra",
    "/api/bootstrap",
    "/ws",
    null,
    undefined,
  ]) {
    assert.equal(canonical(bad), null, `expected null for ${String(bad)}`);
  }
});

await test("allowedOrigin(): exact origins, port-optional localhost/127.0.0.1, wildcard subdomains, rejection of spoofs", () => {
  const env = {
    ALLOWED_ORIGINS: "https://screener-cso.pages.dev,http://127.0.0.1,http://localhost,*.pages.dev",
  };

  // Exact + localhost/loopback with & without ports + wildcard subdomain
  assert.equal(allowedOrigin("https://screener-cso.pages.dev", env), "https://screener-cso.pages.dev");
  assert.equal(allowedOrigin("http://localhost", env), "http://localhost");
  assert.equal(allowedOrigin("http://localhost:8787", env), "http://localhost:8787");
  assert.equal(allowedOrigin("http://127.0.0.1:3000", env), "http://127.0.0.1:3000");
  assert.equal(allowedOrigin("https://preview-abc.screener-cso.pages.dev", env), "https://preview-abc.screener-cso.pages.dev");

  // Request object form
  const reqOk = new Request("https://w/ws", { headers: { Origin: "https://screener-cso.pages.dev" } });
  assert.equal(allowedOrigin(reqOk, env), "https://screener-cso.pages.dev");

  // Spoofs, scheme mismatches, bare suffix, missing origin
  for (const evil of [
    "",
    "null",
    "not-a-url",
    "javascript:alert(1)",
    "https://evil.example",
    "https://evilpages.dev",
    "https://pages.dev",
    "https://screener-cso.pages.dev.evil.com",
    "http://localhost.evil.com",
    "https://localhost:8787",
    "http://screener-cso.pages.dev",
  ]) {
    assert.equal(allowedOrigin(evil, env), null, `expected rejection for ${evil}`);
  }

  // Wildcard "*"
  assert.equal(allowedOrigin("https://any.example", { ALLOWED_ORIGINS: "*" }), "https://any.example");
  assert.equal(allowedOrigin("", { ALLOWED_ORIGINS: "*" }), "*");
  // Empty ALLOWED_ORIGINS denies by default
  assert.equal(allowedOrigin("https://screener-cso.pages.dev", { ALLOWED_ORIGINS: "" }), null);
});

await test("TdBudget DO only meters Twelve Data REST usage: no per-minute/per-day cap, never 429", async () => {
  let fakeNow = Date.UTC(2026, 10, 19, 12, 0, 0);
  const { sql } = createSqliteMock();
  // Legacy cap vars are ignored even if still configured somewhere.
  const budget = new TdBudget({ storage: { sql } }, { TD_PER_MIN: "3", TD_PER_DAY: "5" }, { now: () => fakeNow });

  for (let i = 1; i <= 25; i++) {
    const r = await budget.fetch(new Request("https://td-budget/consume?cost=1"));
    assert.equal(r.status, 200, `call ${i} must not be throttled`);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.usedMin, i);
    assert.equal(body.usedDay, i);
  }
  fakeNow += 60_000;
  const next = await (await budget.fetch(new Request("https://td-budget/consume?cost=1"))).json();
  assert.equal(next.usedMin, 1, "per-minute counter rolls over");
  assert.equal(next.usedDay, 26, "per-day counter keeps metering");
  const st = await (await budget.fetch(new Request("https://td-budget/status"))).json();
  assert.equal(st.usedDay, 26);
});

await test("/td/time_series is never refused by a budget (no BUDGET 429 even after 50 calls in one minute)", async () => {
  const { sql } = createSqliteMock();
  const budgetObj = new TdBudget({ storage: { sql } }, {});
  const prevFetch = globalThis.fetch;
  const prevCaches = globalThis.caches;
  globalThis.caches = undefined;
  let upstream = 0;
  globalThis.fetch = async () => {
    upstream += 1;
    return new Response(JSON.stringify({ status: "ok", values: [] }), { status: 200 });
  };
  try {
    const env = {
      TWELVEDATA_KEY: "k",
      INTERNAL_TD_SECRET: "s",
      TD_BUDGET: { idFromName: (n) => n, get: () => budgetObj },
    };
    for (let i = 0; i < 50; i++) {
      const r = await worker.fetch(
        new Request(`https://vektor-market.example/td/time_series?symbol=EUR/USD&interval=1min&outputsize=${100 + i}`, {
          headers: { "X-Vektor-Internal": "s" },
        }),
        env,
        { waitUntil: () => {} }
      );
      assert.equal(r.status, 200);
      assert.notEqual(r.headers.get("X-Cache"), "BUDGET");
    }
    assert.equal(upstream, 50);
  } finally {
    globalThis.fetch = prevFetch;
    globalThis.caches = prevCaches;
  }
});

await test("Worker /health hides secrets and /td/* uses Cache API (zero KV writes on live misses)", async () => {
  const secret = "TD_SUPER_SECRET_KEY_XYZ";
  const { sql } = createSqliteMock();
  const budgetObj = new TdBudget({ storage: { sql } }, { TD_PER_MIN: "8", TD_PER_DAY: "800" });

  let kvPutCalls = 0;
  const fakeKv = {
    async get() { return null; },
    async put() { kvPutCalls += 1; },
  };

  // Fake Cache API
  const cacheStore = new Map();
  const prevCaches = globalThis.caches;
  globalThis.caches = {
    default: {
      async match(req) {
        const hit = cacheStore.get(req.url);
        return hit ? hit.clone() : undefined;
      },
      async put(req, res) {
        cacheStore.set(req.url, res.clone());
      },
    },
  };

  let upstreamCalls = 0;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    upstreamCalls += 1;
    assert.ok(String(url).includes(`apikey=${secret}`), "key appended server-side");
    return new Response(JSON.stringify({ price: "1.0842" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const env = {
      TWELVEDATA_KEY: secret,
      INTERNAL_TD_SECRET: "internal-td-secret-test-001",
      ALLOWED_ORIGINS: "https://screener-cso.pages.dev",
      MARKET_KV: fakeKv,
      TD_BUDGET: {
        idFromName: (n) => n,
        get: () => budgetObj,
      },
    };
    const internalHeaders = { "X-Vektor-Internal": env.INTERNAL_TD_SECRET };

    // Health check leaks zero secrets
    const hRes = await worker.fetch(
      new Request("https://vektor-market.example/health", {
        headers: { Origin: "https://screener-cso.pages.dev" },
      }),
      env
    );
    assert.equal(hRes.status, 200);
    const hText = await hRes.text();
    assert.ok(!hText.includes(secret));
    assert.equal(hRes.headers.get("Access-Control-Allow-Origin"), "https://screener-cso.pages.dev");

    // First /td/price call -> MISS, cached in Cache API, ZERO KV writes
    const td1 = await worker.fetch(
      new Request("https://vektor-market.example/td/price?symbol=eur/usd&apikey=ATTACKER_KEY", {
        headers: internalHeaders,
      }),
      env
    );
    assert.equal(td1.status, 200);
    assert.equal(td1.headers.get("X-Cache"), "MISS");
    assert.equal(upstreamCalls, 1);
    assert.equal(kvPutCalls, 0);

    // Second equivalent /td/price call -> HIT from Cache API, still 1 upstream call, 0 KV writes
    const td2 = await worker.fetch(
      new Request("https://vektor-market.example/td/price?symbol=EUR/USD", {
        headers: internalHeaders,
      }),
      env
    );
    assert.equal(td2.status, 200);
    assert.equal(td2.headers.get("X-Cache"), "HIT");
    assert.equal(upstreamCalls, 1);
    assert.equal(kvPutCalls, 0);

    // Disallowed /td/ route -> 404
    const tdBad = await worker.fetch(
      new Request("https://vektor-market.example/td/billing", { headers: internalHeaders }),
      env
    );
    assert.equal(tdBad.status, 404);
  } finally {
    globalThis.fetch = prevFetch;
    globalThis.caches = prevCaches;
  }
});

await test("Security Fix #8: /td/* rejects non-GET (405) and disallowed Origin (403) BEFORE touching TdBudget or upstream fetch", async () => {
  const { sql } = createSqliteMock();
  const budgetObj = new TdBudget({ storage: { sql } }, { TD_PER_MIN: "8", TD_PER_DAY: "800" });

  let upstreamCalls = 0;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify({ price: "1.0850" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const env = {
      TWELVEDATA_KEY: "TD_SECRET_TEST",
      INTERNAL_TD_SECRET: "internal-td-secret-test-002",
      ALLOWED_ORIGINS: "https://screener-cso.pages.dev",
      TD_BUDGET: {
        idFromName: (n) => n,
        get: () => budgetObj,
      },
    };

    // 0. Audit HIGH #4: Missing / mismatched X-Vektor-Internal or unset INTERNAL_TD_SECRET -> 403, 0 budget spent
    const noSecretHeaderRes = await worker.fetch(
      new Request("https://vektor-market.example/td/price?symbol=EUR/USD", { method: "GET" }),
      env
    );
    assert.equal(noSecretHeaderRes.status, 403);
    assert.equal(upstreamCalls, 0);
    assert.equal(budgetObj.status().usedMin, 0);

    const wrongSecretRes = await worker.fetch(
      new Request("https://vektor-market.example/td/price?symbol=EUR/USD", {
        method: "GET",
        headers: { "X-Vektor-Internal": "wrong-secret" },
      }),
      env
    );
    assert.equal(wrongSecretRes.status, 403);
    assert.equal(upstreamCalls, 0);
    assert.equal(budgetObj.status().usedMin, 0);

    const unsetEnvSecretRes = await worker.fetch(
      new Request("https://vektor-market.example/td/price?symbol=EUR/USD", {
        method: "GET",
        headers: { "X-Vektor-Internal": "anything" },
      }),
      { ...env, INTERNAL_TD_SECRET: "" }
    );
    assert.equal(unsetEnvSecretRes.status, 403);
    assert.equal(upstreamCalls, 0);
    assert.equal(budgetObj.status().usedMin, 0);

    // 1. POST /td/price -> 405 Method Not Allowed, 0 budget spent, 0 upstream calls
    const postRes = await worker.fetch(
      new Request("https://vektor-market.example/td/price?symbol=EUR/USD", {
        method: "POST",
        headers: { Origin: "https://screener-cso.pages.dev", "X-Vektor-Internal": env.INTERNAL_TD_SECRET },
      }),
      env
    );
    assert.equal(postRes.status, 405);
    assert.equal(postRes.headers.get("Allow"), "GET, OPTIONS");
    assert.equal(upstreamCalls, 0);
    assert.equal(budgetObj.status().usedMin, 0);

    // 2. GET /td/price with disallowed Origin -> 403 Forbidden, 0 budget spent, 0 upstream calls
    const evilOriginRes = await worker.fetch(
      new Request("https://vektor-market.example/td/price?symbol=EUR/USD", {
        method: "GET",
        headers: { Origin: "https://evil-attacker.example", "X-Vektor-Internal": env.INTERNAL_TD_SECRET },
      }),
      env
    );
    assert.equal(evilOriginRes.status, 403);
    assert.equal(upstreamCalls, 0);
    assert.equal(budgetObj.status().usedMin, 0);

    // 3. GET /td/price with valid internal secret + allowed Origin -> 200 OK, 1 budget spent, 1 upstream call
    const okRes = await worker.fetch(
      new Request("https://vektor-market.example/td/price?symbol=EUR/USD", {
        method: "GET",
        headers: { Origin: "https://screener-cso.pages.dev", "X-Vektor-Internal": env.INTERNAL_TD_SECRET },
      }),
      env
    );
    assert.equal(okRes.status, 200);
    assert.equal(upstreamCalls, 1);
    assert.equal(budgetObj.status().usedMin, 1);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

await test("Security Fix #8: allowedOrigin() rejects userinfo/path/query/fragment, returns canonical origin, loopback-only port matching", () => {
  const env = {
    ALLOWED_ORIGINS: "https://screener-cso.pages.dev,http://localhost,http://127.0.0.1,http://[::1],*.pages.dev",
  };

  // Canonical origin returned (lowercased host)
  assert.equal(allowedOrigin("https://SCREENER-CSO.PAGES.DEV", env), "https://screener-cso.pages.dev");

  // Loopback hosts allow arbitrary ports
  assert.equal(allowedOrigin("http://localhost:5173", env), "http://localhost:5173");
  assert.equal(allowedOrigin("http://127.0.0.1:4173", env), "http://127.0.0.1:4173");
  assert.equal(allowedOrigin("http://[::1]:8787", env), "http://[::1]:8787");
  assert.equal(allowedOrigin("http://[::1]", env), "http://[::1]");

  // Production domain MUST NOT allow arbitrary ports via port-less rule or wildcard
  assert.equal(allowedOrigin("https://screener-cso.pages.dev:8443", env), null);
  assert.equal(allowedOrigin("https://preview.screener-cso.pages.dev:8443", env), null);

  // Reject userinfo, path, query, fragment, trailing slash
  for (const malformed of [
    "https://user:pass@screener-cso.pages.dev",
    "https://screener-cso.pages.dev/path",
    "https://screener-cso.pages.dev/",
    "https://screener-cso.pages.dev?x=1",
    "https://screener-cso.pages.dev#frag",
    "http://localhost:8787/extra",
  ]) {
    assert.equal(allowedOrigin(malformed, env), null, `expected rejection for ${malformed}`);
    assert.equal(allowedOrigin(malformed, { ALLOWED_ORIGINS: "*" }), null, `expected wildcard rejection for ${malformed}`);
  }
});

await test("Fix #11: TdBudget prunes expired min:* and old day:* rows so SQLite stays bounded", () => {
  let fakeNow = Date.UTC(2026, 10, 1, 12, 0, 0);
  const { sql } = createSqliteMock();
  const budget = new TdBudget(
    { storage: { sql } },
    { TD_PER_MIN: "100", TD_PER_DAY: "1000" },
    { now: () => fakeNow }
  );

  // Consume across 10 different days (and multiple minutes)
  for (let d = 0; d < 10; d++) {
    fakeNow = Date.UTC(2026, 10, 1 + d, 12, 0, 0);
    assert.equal(budget.consume(1).ok, true);
    fakeNow += 60_000;
    assert.equal(budget.consume(1).ok, true);
  }

  // Advance 5 minutes on day 10 and consume -> old min:* and day:* (> 7 days old) pruned
  fakeNow += 5 * 60_000;
  assert.equal(budget.consume(1).ok, true);

  const rows = sql.exec("SELECT bucket FROM td_budget_counts").toArray().map((r) => r.bucket);
  const minRows = rows.filter((b) => b.startsWith("min:"));
  const dayRows = rows.filter((b) => b.startsWith("day:"));

  // Only current minute bucket remains (previous minutes were > 2 min old)
  assert.equal(minRows.length, 1, `expected 1 min row, got ${minRows.join(",")}`);
  // Days older than 7 days (Nov 1, Nov 2) are pruned; <= 8 day rows remain
  assert.ok(dayRows.length <= 8, `expected <= 8 day rows, got ${dayRows.length}`);
  assert.ok(!dayRows.includes("day:2026-11-01"));
  assert.ok(!dayRows.includes("day:2026-11-02"));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
