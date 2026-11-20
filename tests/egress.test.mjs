// tests/egress.test.mjs — Task 16 same-origin egress CI guard.
// Always runs fast unit verification of Protocol v2 provenance rules and thin-client origin lock.
// When VT_STRICT_MANDATE=1 (or --strict-egress) is enabled, launches Playwright across
// /, #/screener, #/heatmap, #/backtest, and #/journal and fails on any non-origin request.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createThinDataService as createClientThinService,
  assertSameOrigin as assertClientSameOrigin,
} from "../client/services/thinDataService.js";
import {
  createThinDataService as createBrowserThinService,
  assertSameOrigin as assertBrowserSameOrigin,
  validateServerFrame as validateBrowserServerFrame,
} from "../src/data_service.js";
import { validateServerFrame } from "../shared/protocol.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const STRICT_EGRESS =
  process.env.VT_STRICT_MANDATE === "1" || process.argv.includes("--strict-egress");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, "-", err && err.message ? err.message : String(err));
  }
}

const ORIGIN = "https://vektor.example";

const FORBIDDEN_EXTERNAL_URLS = [
  "https://api.twelvedata.com/time_series?symbol=EUR/USD",
  "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT",
  "https://api.binance.com/api/v3/ticker/24hr",
  "https://api.coingecko.com/api/v3/simple/price",
  "https://finnhub.io/api/v1/quote?symbol=AAPL",
  "https://api.polygon.io/v2/aggs/ticker/AAPL",
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  "https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js",
  "http://vektor.example/api/bootstrap",
  "https://vektor.example:8443/api/bootstrap",
  "//cdn.evil.example/vendor.js",
  "/\t/evil.com",
  "/\n/evil.com",
  "/\\evil.com",
  "https://user:pass@vektor.example/api",
  "javascript:void(0)",
  "data:text/plain,evil",
  "blob:https://vektor.example/12345678-1234-1234-1234-1234567890ab",
];

for (const [label, createSvc, assertOrigin] of [
  ["client/services/thinDataService.js", createClientThinService, assertClientSameOrigin],
  ["src/data_service.js", createBrowserThinService, assertBrowserSameOrigin],
]) {
  await test(`[${label}] origin lock blocks every third-party HTTP/WS/SSE target`, async () => {
    const egressLog = [];
    const wsInstances = [];
    const esInstances = [];
    class FakeWS {
      constructor(u) {
        egressLog.push(u);
        this.url = u;
        this.readyState = 1;
        this.sent = [];
        wsInstances.push(this);
      }
      send(m) {
        this.sent.push(m);
      }
      fail() {
        this.readyState = 3;
        if (this.onerror) this.onerror(new Error("ws failed"));
      }
      close() {}
    }
    class FakeES {
      constructor(u) {
        egressLog.push(u);
        this.url = u;
        esInstances.push(this);
      }
      close() {}
    }
    const fakeFetch = async (u) => {
      egressLog.push(u);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          v: 2,
          seq: 1,
          type: "state",
          status: { provenance: "LIVE", asOf: 1732000000000 },
          chart: { sym: "BTCUSDT", tf: "1H", bars: [] },
        }),
      };
    };

    const svc = createSvc({
      origin: ORIGIN,
      WebSocket: FakeWS,
      EventSource: FakeES,
      fetch: fakeFetch,
      maxWsFails: 1,
    });

    for (const url of FORBIDDEN_EXTERNAL_URLS) {
      assert.throws(() => assertOrigin(url, ORIGIN), { code: "CROSS_ORIGIN_BLOCKED" }, `Expected block for ${url}`);
      await assert.rejects(() => svc.bootstrap({ endpoint: url }), { code: "CROSS_ORIGIN_BLOCKED" });
    }
    for (const badWsUrl of [
      "wss://ws.twelvedata.com/v1/quotes/price",
      "wss://stream.binance.com:9443/ws/!ticker@arr",
      "wss://user:pass@vektor.example/ws",
      "data:text/plain,ws",
      "blob:https://vektor.example/ws-id",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\\evil.com",
    ]) {
      assert.throws(
        () => assertOrigin(badWsUrl, ORIGIN, { ws: true }),
        { code: "CROSS_ORIGIN_BLOCKED" },
        `Expected WS block for ${badWsUrl}`
      );
    }
    assert.equal(egressLog.length, 0, "Zero egress calls allowed for rejected URLs");

    // Valid same-origin traffic only: bootstrap, loadMoreBars, WS connect, and SSE fallback
    await svc.bootstrap({ chart: { sym: "BTCUSDT", tf: "1H" } });
    await svc.loadMoreBars("BTCUSDT", "1H", 1732000000, 100);
    svc.connect();
    assert.equal(wsInstances.length, 1);

    // Trigger WS failure (maxWsFails=1) to verify SSE fallback is logged and strictly same-origin
    wsInstances[0].fail();
    assert.equal(esInstances.length, 1, "Expected SSE fallback EventSource to open after WS failure");
    assert.ok(esInstances[0].url.startsWith(`${ORIGIN}/api/sse`), `Unexpected SSE URL: ${esInstances[0].url}`);

    assert.ok(egressLog.length >= 4, "Expected HTTP bootstrap, HTTP bars, WS, and SSE egress entries");
    for (const u of egressLog) {
      const parsed = new URL(u);
      const normalizedOrigin = parsed.origin.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
      assert.equal(normalizedOrigin, ORIGIN, `Unexpected non-origin egress URL: ${u}`);
    }
    svc.close();
  });
}

await test("Protocol v2 and src/data_service.js reject synthetic/simulated sources", () => {
  for (const [validatorName, validateFn] of [
    ["shared/protocol.js", validateServerFrame],
    ["src/data_service.js", validateBrowserServerFrame],
  ]) {
    for (const badSource of ["edge+sim", "simulated", "synthetic", "mock", "fake", "demo", ""]) {
      const sc = validateFn({
        v: 2,
        seq: 1,
        type: "screener",
        page: 1,
        totalPages: 1,
        total: 1,
        preset: "P1",
        asOf: 1732000000000,
        rows: [{ symbol: "AAPL", source: badSource, asOf: 1732000000000 }],
      });
      assert.equal(sc.ok, false, `[${validatorName}] Screener must reject source=${JSON.stringify(badSource)}`);

      const hm = validateFn({
        v: 2,
        seq: 2,
        type: "heatmap",
        metric: "chg",
        tf: "1D",
        asOf: 1732000000000,
        tiles: [{ symbol: "AAPL", value: 1.2, weight: 10, source: badSource, asOf: 1732000000000 }],
      });
      assert.equal(hm.ok, false, `[${validatorName}] Heatmap must reject source=${JSON.stringify(badSource)}`);
    }
  }

  // Browser validator also rejects synthetic sources on bar, quote, and state.chart frames
  for (const badSource of ["edge+sim", "synthetic", "mock"]) {
    const barRes = validateBrowserServerFrame({
      v: 2,
      seq: 3,
      type: "bar",
      sym: "BTCUSDT",
      tf: "1H",
      bar: [1732000000, 100, 102, 99, 101, 10],
      source: badSource,
    });
    assert.equal(barRes.ok, false, `src/data_service.js bar must reject source=${badSource}`);

    const quoteRes = validateBrowserServerFrame({
      v: 2,
      seq: 4,
      type: "quotes",
      quotes: [{ s: "BTCUSDT", c: 101, t: 1732000000000, source: badSource }],
    });
    assert.equal(quoteRes.ok, false, `src/data_service.js quotes must reject source=${badSource}`);

    const stateRes = validateBrowserServerFrame({
      v: 2,
      seq: 5,
      type: "state",
      status: { provenance: "LIVE", asOf: 1732000000000 },
      chart: { sym: "BTCUSDT", tf: "1H", bars: [], source: badSource },
    });
    assert.equal(stateRes.ok, false, `src/data_service.js state.chart must reject source=${badSource}`);
  }
});

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function startLocalServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      if (urlPath.startsWith("/api/")) {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        if (urlPath === "/api/bootstrap") {
          res.end(
            JSON.stringify({
              v: 2,
              seq: 1,
              type: "state",
              status: { provenance: "CACHED", asOf: Date.now() },
              chart: { sym: "BTCUSDT", tf: "1H", bars: [] },
              watchlist: [],
              screener: { page: 1, totalPages: 1, total: 0, preset: "P1", asOf: Date.now(), rows: [] },
              heatmap: { metric: "chg", tf: "1D", asOf: Date.now(), tiles: [] },
            })
          );
          return;
        }
        res.end(JSON.stringify({ ok: true, bars: [], rows: [], items: [] }));
        return;
      }

      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
      const abs = path.resolve(root, rel);
      if (!abs.startsWith(root) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found");
        return;
      }
      const ext = path.extname(abs).toLowerCase();
      res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
      fs.createReadStream(abs).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

if (STRICT_EGRESS) {
  await test("STRICT EGRESS: Playwright routes (/, #/screener, #/heatmap, #/backtest, #/journal) make ZERO non-origin requests", async () => {
    const { chromium } = await import("playwright");
    const srv = await startLocalServer();
    const port = srv.address().port;
    const localOrigin = `http://127.0.0.1:${port}`;
    const localWsOrigin = `ws://127.0.0.1:${port}`;
    const routes = ["/", "/#/screener", "/#/heatmap", "/#/backtest", "/#/journal"];
    const violations = [];
    let currentRoute = routes[0];

    const browser = await chromium.launch();
    try {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript(() => {
        if (!localStorage.getItem("scr2a")) localStorage.setItem("scr2a", JSON.stringify({ id: "egress-check" }));
        if (!localStorage.getItem("vt_consent")) {
          localStorage.setItem("vt_consent", JSON.stringify({ v: "1.1", ts: Date.now(), cache: false, method: "test" }));
        }
      });

      await ctx.route("**/*", (route) => {
        const u = route.request().url();
        if (/^(?:data:|blob:|about:)/i.test(u)) return route.continue();
        let parsed;
        try {
          parsed = new URL(u);
        } catch {
          return route.abort();
        }
        if (parsed.origin === localOrigin) {
          return route.continue();
        }
        violations.push({ route: currentRoute, kind: "http", url: u, resourceType: route.request().resourceType() });
        return route.abort();
      });

      const page = await ctx.newPage();
      page.on("websocket", (ws) => {
        const u = ws.url();
        try {
          const parsed = new URL(u);
          if (parsed.origin !== localWsOrigin) {
            violations.push({ route: currentRoute, kind: "ws", url: u, resourceType: "websocket" });
          }
        } catch {
          violations.push({ route: currentRoute, kind: "ws", url: u, resourceType: "websocket" });
        }
      });

      for (const r of routes) {
        currentRoute = r;
        await page.goto(localOrigin + r, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(750);
      }
    } finally {
      await browser.close();
      srv.close();
    }

    if (violations.length > 0) {
      const unique = new Map();
      for (const v of violations) {
        const key = `${v.route}|${v.kind}|${v.url}`;
        if (!unique.has(key)) unique.set(key, v);
      }
      const lines = [...unique.values()].map((v) => `  [${v.route}] (${v.kind}/${v.resourceType}) ${v.url}`);
      assert.fail(`Captured ${unique.size} non-origin egress request(s):\n${lines.join("\n")}`);
    }
  });
} else {
  console.log("INFO Playwright egress crawl skipped (enable with VT_STRICT_MANDATE=1 or --strict-egress)");
}

console.log(`\negress: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
