// tests/thin-data-service.test.mjs — Task 10 unit & contract tests for render-only Protocol v2 transport.
// Exercises BOTH client/services/thinDataService.js and src/data_service.js for 100% parity.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createThinDataService as createClientThinService,
  assertSameOrigin as assertClientSameOrigin,
} from "../client/services/thinDataService.js";
import {
  createThinDataService as createBrowserThinService,
  assertSameOrigin as assertBrowserSameOrigin,
  validateClientMessage as validateBrowserClientMessage,
  validateServerFrame as validateBrowserServerFrame,
  MAX_CLIENT_FRAME_BYTES,
} from "../src/data_service.js";
import { isPublicPath } from "../functions/_middleware.js";

const root = fileURLToPath(new URL("..", import.meta.url));
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, "-", err && err.stack ? err.stack : err);
  }
}

function makeFakeStateFrame(overrides = {}) {
  return {
    v: 2,
    seq: 1,
    type: "state",
    status: { provenance: "LIVE", asOf: 1732000000000 },
    chart: {
      sym: "BTCUSDT",
      tf: "1H",
      bars: [
        [1731992800, 91000, 91200, 90900, 91150, 120],
        [1731996400, 91150, 91500, 91050, 91450, 145],
      ],
    },
    watchlist: [{ s: "BTCUSDT", c: 91450, t: 1732000000000, provenance: "LIVE" }],
    screener: {
      page: 1,
      totalPages: 1,
      total: 1,
      preset: "P1",
      asOf: 1732000000000,
      rows: [
        { symbol: "BTCUSDT", market: "CRY", price: 91450, score: 91, tier: "P1", source: "twelvedata", asOf: 1732000000000 },
      ],
    },
    heatmap: {
      metric: "chg",
      tf: "1D",
      range: 3.5,
      asOf: 1732000000000,
      tiles: [
        { symbol: "BTCUSDT", value: 2.5, weight: 50, source: "twelvedata", asOf: 1732000000000 },
      ],
    },
    ...overrides,
  };
}

function makeControlledEnv() {
  const fetchUrls = [];
  const wsInstances = [];
  const esInstances = [];
  const timers = [];
  const rafQueue = [];
  let nextTimerId = 1;
  let nextRafId = 1;

  class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.closed = false;
      wsInstances.push(this);
    }
    open() {
      this.readyState = 1;
      if (this.onopen) this.onopen({});
    }
    emitMessage(frameOrStr) {
      const data = typeof frameOrStr === "string" ? frameOrStr : JSON.stringify(frameOrStr);
      if (this.onmessage) this.onmessage({ data });
    }
    fail() {
      this.readyState = 3;
      if (this.onerror) this.onerror(new Error("ws failed"));
    }
    drop() {
      this.readyState = 3;
      if (this.onclose) this.onclose({});
    }
    send(raw) {
      this.sent.push(JSON.parse(raw));
    }
    close() {
      this.closed = true;
      this.readyState = 3;
    }
  }

  class FakeES {
    constructor(url) {
      this.url = url;
      this.closed = false;
      esInstances.push(this);
    }
    open() {
      if (this.onopen) this.onopen({});
    }
    emitMessage(frameOrStr) {
      const data = typeof frameOrStr === "string" ? frameOrStr : JSON.stringify(frameOrStr);
      if (this.onmessage) this.onmessage({ data });
    }
    fail() {
      if (this.onerror) this.onerror(new Error("sse error"));
    }
    close() {
      this.closed = true;
    }
  }

  const setTimer = (fn, delay) => {
    const id = nextTimerId++;
    timers.push({ id, fn, delay, cleared: false });
    return id;
  };
  const clearTimer = (id) => {
    const entry = timers.find((t) => t.id === id);
    if (entry) entry.cleared = true;
  };
  const runNextTimer = () => {
    const next = timers.find((t) => !t.cleared);
    assert.ok(next, "Expected a scheduled reconnect timer");
    next.cleared = true;
    next.fn();
    return next.delay;
  };

  const raf = (fn) => {
    const id = nextRafId++;
    rafQueue.push({ id, fn, cancelled: false });
    return id;
  };
  const caf = (id) => {
    const entry = rafQueue.find((r) => r.id === id);
    if (entry) entry.cancelled = true;
  };
  const flushRaf = () => {
    const active = rafQueue.splice(0, rafQueue.length).filter((r) => !r.cancelled);
    for (const r of active) r.fn(Date.now());
    return active.length;
  };

  let fetchResponder = async () => ({ ok: true, status: 200, json: async () => makeFakeStateFrame() });
  const fakeFetch = async (url, init) => {
    fetchUrls.push({ url, init });
    return fetchResponder(url, init);
  };

  return {
    fetchUrls,
    wsInstances,
    esInstances,
    timers,
    rafQueue,
    FakeWS,
    FakeES,
    setTimer,
    clearTimer,
    runNextTimer,
    raf,
    caf,
    flushRaf,
    fakeFetch,
    setFetchResponder(fn) {
      fetchResponder = fn;
    },
  };
}

const TARGETS = [
  { label: "client/services/thinDataService.js", create: createClientThinService, assertOrigin: assertClientSameOrigin },
  { label: "src/data_service.js", create: createBrowserThinService, assertOrigin: assertBrowserSameOrigin },
];

for (const target of TARGETS) {
  await test(`[${target.label}] same-origin enforcement rejects all foreign URLs`, async () => {
    const env = makeControlledEnv();
    const origin = "https://terminal.vektor.test";
    const svc = target.create({
      origin,
      WebSocket: env.FakeWS,
      EventSource: env.FakeES,
      fetch: env.fakeFetch,
      raf: env.raf,
      caf: env.caf,
    });

    const badUrls = [
      "https://api.twelvedata.com/time_series",
      "https://data-api.binance.vision/api/v3/klines",
      "http://terminal.vektor.test/api/bootstrap", // scheme downgrade
      "https://terminal.vektor.test:8443/api/bootstrap", // port mismatch
      "//evil.example/api/bootstrap", // protocol-relative
      "javascript:alert(1)",
      "data:text/plain,bad",
      "/api/bootstrap\\..\\secret",
    ];
    for (const bad of badUrls) {
      assert.throws(() => target.assertOrigin(bad, origin), { code: "CROSS_ORIGIN_BLOCKED" }, `Should block ${bad}`);
      assert.throws(() => svc.assertSameOrigin(bad), { code: "CROSS_ORIGIN_BLOCKED" }, `Service should block ${bad}`);
    }
    assert.throws(
      () => target.assertOrigin("wss://ws.twelvedata.com/v1/quotes/price", origin, { ws: true }),
      { code: "CROSS_ORIGIN_BLOCKED" }
    );
    assert.throws(
      () => target.assertOrigin("ws://terminal.vektor.test/ws", origin, { ws: true }),
      { code: "CROSS_ORIGIN_BLOCKED" }
    );

    await assert.rejects(
      () => svc.bootstrap({ endpoint: "https://evil.example/api/bootstrap" }),
      { code: "CROSS_ORIGIN_BLOCKED" }
    );
    assert.equal(env.fetchUrls.length, 0, "Zero fetches may fire for blocked cross-origin URLs");

    assert.throws(() => target.create({ origin: "ftp://invalid.example" }), { code: "CROSS_ORIGIN_BLOCKED" });
    assert.throws(() => target.create({ origin: "https://terminal.vektor.test/subpath" }), { code: "CROSS_ORIGIN_BLOCKED" });
    svc.close();
  });

  await test(`[${target.label}] bootstrap() fetches /api/bootstrap, validates state, updates provenance`, async () => {
    const env = makeControlledEnv();
    const origin = "https://terminal.vektor.test";
    const svc = target.create({
      origin,
      WebSocket: env.FakeWS,
      EventSource: env.FakeES,
      fetch: env.fakeFetch,
      raf: env.raf,
      caf: env.caf,
    });

    assert.equal(svc.status.provenance, "UNAVAILABLE");
    assert.equal(svc.status.asOf, null);

    const stateEvents = [];
    svc.on("state", (f) => stateEvents.push(f));

    const state = await svc.bootstrap({
      chart: { sym: "btcusdt", tf: "1H", ind: ["ema20"] },
      watchlist: ["btcusdt", "eurusd"],
      screener: { preset: "P1", page: 1 },
      heatmap: { metric: "chg", tf: "1D", n: 40 },
    });

    assert.equal(state.type, "state");
    assert.equal(stateEvents.length, 1);
    assert.equal(svc.status.provenance, "LIVE");
    assert.equal(svc.status.asOf, 1732000000000);

    assert.equal(env.fetchUrls.length, 1);
    const parsedUrl = new URL(env.fetchUrls[0].url);
    assert.equal(parsedUrl.origin, origin);
    assert.equal(parsedUrl.pathname, "/api/bootstrap");
    assert.equal(parsedUrl.searchParams.get("chart"), "BTCUSDT:1H");
    assert.equal(parsedUrl.searchParams.get("wl"), "BTCUSDT,EURUSD");
    assert.equal(parsedUrl.searchParams.get("preset"), "P1");
    assert.equal(parsedUrl.searchParams.get("hmMetric"), "chg");

    // Reject synthetic source in state frame
    env.setFetchResponder(async () => ({
      ok: true,
      status: 200,
      json: async () =>
        makeFakeStateFrame({
          screener: {
            page: 1,
            totalPages: 1,
            total: 1,
            preset: "P1",
            asOf: 1732000000000,
            rows: [{ symbol: "AAPL", source: "edge+sim", asOf: 1732000000000 }],
          },
        }),
    }));
    await assert.rejects(() => svc.bootstrap(), /Invalid bootstrap state frame/);
    svc.close();
  });

  await test(`[${target.label}] loadMoreBars() fetches same-origin /api/bars without client manipulation`, async () => {
    const env = makeControlledEnv();
    const origin = "https://terminal.vektor.test";
    const expectedBars = [
      [1731985600, 90500, 90800, 90400, 90750, 88],
      [1731989200, 90750, 91000, 90700, 91000, 95],
    ];
    env.setFetchResponder(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sym: "BTCUSDT", tf: "1H", bars: expectedBars, hasMore: true }),
    }));

    const svc = target.create({ origin, fetch: env.fakeFetch });
    const res = await svc.loadMoreBars("btcusdt", "1H", 1731992800, 200);
    assert.deepEqual(res.bars, expectedBars);
    assert.equal(res.hasMore, true);

    const parsed = new URL(env.fetchUrls[0].url);
    assert.equal(parsed.origin, origin);
    assert.equal(parsed.pathname, "/api/bars");
    assert.equal(parsed.searchParams.get("sym"), "BTCUSDT");
    assert.equal(parsed.searchParams.get("tf"), "1H");
    assert.equal(parsed.searchParams.get("before"), "1731992800");
    assert.equal(parsed.searchParams.get("limit"), "200");
    svc.close();
  });

  await test(`[${target.label}] connect(), hello{v:2} + view auto-replay, exponential backoff + jitter, SSE fallback`, async () => {
    const env = makeControlledEnv();
    const origin = "https://terminal.vektor.test";
    const svc = target.create({
      origin,
      session: "sess_abc",
      WebSocket: env.FakeWS,
      EventSource: env.FakeES,
      fetch: env.fakeFetch,
      raf: env.raf,
      caf: env.caf,
      setTimer: env.setTimer,
      clearTimer: env.clearTimer,
      baseBackoffMs: 500,
      maxBackoffMs: 4000,
      jitterMs: 200,
      jitterFn: () => 0.5, // deterministic +100ms jitter
      maxWsFails: 3,
    });

    svc.setView({
      chart: { sym: "eurusd", tf: "15m", ind: [{ id: "ema20", type: "ema", len: 20 }] },
      watchlist: ["eurusd", "btcusdt"],
    });
    svc.connect();

    assert.equal(env.wsInstances.length, 1);
    assert.equal(env.wsInstances[0].url, "wss://terminal.vektor.test/ws");

    // Open WS #1: must auto-send hello{v:2} then latest view
    env.wsInstances[0].open();
    assert.equal(svc.status.transport, "ws");
    assert.deepEqual(env.wsInstances[0].sent, [
      { op: "hello", v: 2, session: "sess_abc" },
      {
        op: "view",
        chart: { sym: "EURUSD", tf: "15m", ind: [{ id: "ema20", type: "ema", len: 20 }] },
        watchlist: ["EURUSD", "BTCUSDT"],
      },
    ]);

    // Update view live while connected
    svc.setView({ screener: { preset: "P2", page: 1 } });
    assert.equal(env.wsInstances[0].sent.length, 3);
    assert.deepEqual(env.wsInstances[0].sent[2], { op: "view", screener: { preset: "P2", page: 1 } });

    // Drop WS #1 -> reconnect #1 after 500 + 100 = 600ms
    env.wsInstances[0].drop();
    assert.equal(svc.status.transport, "reconnecting");
    const delay1 = env.runNextTimer();
    assert.equal(delay1, 600);
    assert.equal(env.wsInstances.length, 2);

    // WS #2 connects -> must replay hello{v:2} AND merged latest view (chart + watchlist + screener)
    env.wsInstances[1].open();
    assert.deepEqual(env.wsInstances[1].sent, [
      { op: "hello", v: 2, session: "sess_abc" },
      {
        op: "view",
        chart: { sym: "EURUSD", tf: "15m", ind: [{ id: "ema20", type: "ema", len: 20 }] },
        watchlist: ["EURUSD", "BTCUSDT"],
        screener: { preset: "P2", page: 1 },
      },
    ]);

    // Now fail WS 3 consecutive times -> exponential backoff (600ms, 1100ms) then SSE fallback on 3rd failure!
    env.wsInstances[1].fail();
    assert.equal(env.runNextTimer(), 600); // fail #1 -> WS #3
    env.wsInstances[2].fail();
    assert.equal(env.runNextTimer(), 1100); // fail #2 -> WS #4
    env.wsInstances[3].fail(); // fail #3 -> immediate SSE fallback!

    assert.equal(env.esInstances.length, 1);
    const sseUrl = new URL(env.esInstances[0].url);
    assert.equal(sseUrl.origin, origin);
    assert.equal(sseUrl.pathname, "/api/sse");
    assert.equal(sseUrl.searchParams.get("chart"), "EURUSD:15m");
    assert.equal(sseUrl.searchParams.get("preset"), "P2");

    env.esInstances[0].open();
    assert.equal(svc.status.transport, "sse");

    // Server sends status frame over SSE
    const statusFrames = [];
    svc.on("status", (f) => statusFrames.push(f));
    env.esInstances[0].emitMessage({
      v: 2,
      seq: 1,
      type: "status",
      provenance: "DELAYED",
      asOf: 1732000010000,
      detail: "SSE fallback active",
    });
    assert.equal(statusFrames.length, 1);
    assert.equal(svc.status.provenance, "DELAYED");
    assert.equal(svc.status.asOf, 1732000010000);
    assert.equal(svc.status.detail, "SSE fallback active");

    svc.close();
    assert.equal(svc.status.transport, "closed");
    assert.equal(env.esInstances[0].closed, true);
  });

  await test(`[${target.label}] rAF batching coalesces high-frequency bar & quotes frames while delivering control frames immediately`, async () => {
    const env = makeControlledEnv();
    const svc = target.create({
      origin: "https://terminal.vektor.test",
      WebSocket: env.FakeWS,
      EventSource: env.FakeES,
      fetch: env.fakeFetch,
      raf: env.raf,
      caf: env.caf,
    });

    const received = {
      bar: [],
      quotes: [],
      ind: [],
      vs: [],
      screener: [],
      heatmap: [],
      alert: [],
      status: [],
      error: [],
    };
    for (const type of Object.keys(received)) {
      svc.on(type, (frame) => received[type].push(frame));
    }

    svc.connect();
    const sock = env.wsInstances[0];
    sock.open();

    // Send 100 rapid updates for bar T=1000 and 1 closing bar + 50 updates for bar T=1060
    let seq = 1;
    for (let i = 0; i < 100; i++) {
      sock.emitMessage({
        v: 2,
        seq: seq++,
        type: "bar",
        sym: "BTCUSDT",
        tf: "1m",
        bar: [1732000000, 91000, 91200 + i, 90950, 91100 + i, 10 + i],
        closed: i === 99,
        provenance: "LIVE",
        asOf: 1732000000000 + i * 10,
      });
    }
    for (let i = 0; i < 50; i++) {
      sock.emitMessage({
        v: 2,
        seq: seq++,
        type: "bar",
        sym: "BTCUSDT",
        tf: "1m",
        bar: [1732000060, 91200, 91300 + i, 91150, 91250 + i, 1 + i],
        closed: false,
        provenance: "LIVE",
        asOf: 1732000060000 + i * 10,
      });
    }

    // Send 200 rapid quote updates across 2 symbols
    for (let i = 0; i < 200; i++) {
      const sym = i % 2 === 0 ? "BTCUSDT" : "EURUSD";
      sock.emitMessage({
        v: 2,
        seq: seq++,
        type: "quotes",
        quotes: [{ s: sym, c: sym === "BTCUSDT" ? 91000 + i : 1.08 + i * 0.0001, t: 1732000100000 + i }],
      });
    }

    // Before rAF fires: ZERO bar or quotes callbacks invoked!
    assert.equal(received.bar.length, 0);
    assert.equal(received.quotes.length, 0);
    assert.equal(env.rafQueue.length, 1, "Only a single rAF callback should be scheduled");

    // Non-batched frames (ind, vs, screener, heatmap, alert, status, error) deliver immediately!
    sock.emitMessage({ v: 2, seq: seq++, type: "ind", sym: "BTCUSDT", tf: "1m", id: "ema20", point: { t: 1732000060, v: 91180 } });
    sock.emitMessage({ v: 2, seq: seq++, type: "vs", sym: "BTCUSDT", tf: "1m", id: "sc1", plots: [{ name: "sig", points: [[1732000060, 1]] }] });
    sock.emitMessage({
      v: 2,
      seq: seq++,
      type: "screener",
      page: 1,
      totalPages: 1,
      total: 1,
      preset: "P1",
      asOf: 1732000200000,
      rows: [{ symbol: "BTCUSDT", source: "twelvedata", asOf: 1732000200000 }],
    });
    sock.emitMessage({
      v: 2,
      seq: seq++,
      type: "heatmap",
      metric: "chg",
      tf: "1D",
      asOf: 1732000200000,
      tiles: [{ symbol: "BTCUSDT", value: 1.5, weight: 10, source: "twelvedata", asOf: 1732000200000 }],
    });
    sock.emitMessage({ v: 2, seq: seq++, type: "alert", id: "a1", sym: "BTCUSDT", condition: "c >= 91200", price: 91250, triggeredAt: 1732000200000 });
    sock.emitMessage({ v: 2, seq: seq++, type: "status", provenance: "CACHED", asOf: 1732000200000 });

    assert.equal(received.ind.length, 1);
    assert.equal(received.vs.length, 1);
    assert.equal(received.screener.length, 1);
    assert.equal(received.heatmap.length, 1);
    assert.equal(received.alert.length, 1);
    assert.equal(received.status.length, 1);
    assert.equal(svc.status.provenance, "CACHED");

    // Trigger animation frame flush!
    const flushedCount = env.flushRaf();
    assert.equal(flushedCount, 1);

    // 150 bar updates across 2 distinct timestamps coalesced to 2 bar callbacks (T=1732000000 closed + T=1732000060 live)
    assert.equal(received.bar.length, 2);
    assert.equal(received.bar[0].bar[0], 1732000000);
    assert.equal(received.bar[0].closed, true);
    assert.equal(received.bar[0].bar[4], 91199);
    assert.equal(received.bar[1].bar[0], 1732000060);
    assert.equal(received.bar[1].closed, false);
    assert.equal(received.bar[1].bar[4], 91299);

    // 200 quote updates across 2 symbols coalesced into ONE quotes frame with latest price per symbol
    assert.equal(received.quotes.length, 1);
    assert.equal(received.quotes[0].quotes.length, 2);
    const bySym = Object.fromEntries(received.quotes[0].quotes.map((q) => [q.s, q]));
    assert.equal(bySym.BTCUSDT.c, 91198);
    assert.ok(Math.abs(bySym.EURUSD.c - (1.08 + 199 * 0.0001)) < 1e-12);

    svc.close();
  });

  await test(`[${target.label}] hardening: control chars, credentials, origin:"", redirect:"error", /api/ bootstrap, loadMoreBars validation`, async () => {
    const env = makeControlledEnv();
    const origin = "https://terminal.vektor.test";

    // origin: "" must NOT override globalThis.location.origin
    const prevLoc = Object.getOwnPropertyDescriptor(globalThis, "location");
    Object.defineProperty(globalThis, "location", {
      value: { origin },
      configurable: true,
      writable: true,
    });
    try {
      const sEmpty = target.create({ origin: "", fetch: env.fakeFetch });
      assert.equal(sEmpty.origin, origin);
      assert.throws(() => target.create({ origin: "https://evil.example", fetch: env.fakeFetch }), {
        code: "CROSS_ORIGIN_BLOCKED",
      });
      sEmpty.close();
    } finally {
      if (prevLoc) Object.defineProperty(globalThis, "location", prevLoc);
      else delete globalThis.location;
    }

    const svc = target.create({
      origin,
      WebSocket: env.FakeWS,
      EventSource: env.FakeES,
      fetch: env.fakeFetch,
      raf: env.raf,
      caf: env.caf,
    });

    // Reject control chars, whitespace, embedded credentials, non-/api/ bootstrap targets
    for (const bad of [
      "/\t/evil.com",
      "/\n/evil.com",
      "/api/bootstrap\r\nX-Injected: 1",
      "/api/bootstrap foo",
      "https://user:pass@terminal.vektor.test/api/bootstrap",
    ]) {
      assert.throws(() => target.assertOrigin(bad, origin), { code: "CROSS_ORIGIN_BLOCKED" });
    }
    assert.throws(
      () => target.assertOrigin("wss://user:pass@terminal.vektor.test/ws", origin, { ws: true }),
      { code: "CROSS_ORIGIN_BLOCKED" }
    );
    await assert.rejects(() => svc.bootstrap({ endpoint: "/index.html" }), { code: "CROSS_ORIGIN_BLOCKED" });
    await assert.rejects(() => svc.bootstrap({ endpoint: "/api/../secret" }), { code: "CROSS_ORIGIN_BLOCKED" });
    await assert.rejects(() => svc.bootstrap({ url: "https://terminal.vektor.test/not-api" }), {
      code: "CROSS_ORIGIN_BLOCKED",
    });

    // Verify fetch uses redirect: "error" and rejects cross-origin res.url
    await svc.bootstrap();
    assert.equal(env.fetchUrls[0].init.redirect, "error");

    env.setFetchResponder(async () => ({
      ok: true,
      status: 200,
      url: "https://evil.example/api/bootstrap",
      json: async () => makeFakeStateFrame(),
    }));
    await assert.rejects(() => svc.bootstrap(), { code: "CROSS_ORIGIN_BLOCKED" });

    // loadMoreBars argument validation
    await assert.rejects(() => svc.loadMoreBars("", "1H"), /requires a symbol/);
    await assert.rejects(() => svc.loadMoreBars("https://evil.com", "1H"), { code: "CROSS_ORIGIN_BLOCKED" });
    await assert.rejects(() => svc.loadMoreBars("../etc", "1H"), /Invalid symbol/);
    await assert.rejects(() => svc.loadMoreBars("BTCUSDT", "99Z"), /Invalid timeframe/);
    await assert.rejects(() => svc.loadMoreBars("BTCUSDT", "1H", -10, 50), /Invalid before/);
    await assert.rejects(() => svc.loadMoreBars("BTCUSDT", "1H", NaN, 50), /Invalid before/);
    await assert.rejects(() => svc.loadMoreBars("BTCUSDT", "1H", 1732000000, 0), /Invalid limit/);
    await assert.rejects(() => svc.loadMoreBars("BTCUSDT", "1H", 1732000000, 1.5), /Invalid limit/);
    await assert.rejects(() => svc.loadMoreBars("BTCUSDT", "1H", 1732000000, ""), /Invalid limit/);

    svc.close();
  });

  await test(`[${target.label}] hardening: pendingBars cap, throttled gap resync, and connect() reset after close()`, async () => {
    const env = makeControlledEnv();
    let clock = 10000;
    const svc = target.create({
      origin: "https://terminal.vektor.test",
      WebSocket: env.FakeWS,
      EventSource: env.FakeES,
      fetch: env.fakeFetch,
      raf: env.raf,
      caf: env.caf,
      setTimer: env.setTimer,
      clearTimer: env.clearTimer,
      maxWsFails: 2,
      resyncThrottleMs: 2000,
      now: () => clock,
    });

    const bars = [];
    svc.on("bar", (f) => bars.push(f));
    svc.setView({ chart: { sym: "BTCUSDT", tf: "1m" } });
    svc.connect();
    const sock1 = env.wsInstances[0];
    sock1.open();
    assert.equal(sock1.sent.length, 2); // hello + view

    // Cap pendingBars at 256 distinct bar timestamps before flush
    for (let i = 1; i <= 300; i++) {
      sock1.emitMessage({
        v: 2,
        seq: i,
        type: "bar",
        sym: "BTCUSDT",
        tf: "1m",
        bar: [1732000000 + i * 60, 100, 102, 99, 101, 10],
      });
    }
    env.flushRaf();
    assert.equal(bars.length, 256, "pendingBars must be capped at 256");
    assert.equal(bars[0].bar[0], 1732000000 + 45 * 60, "Oldest bars evicted first");

    // Sequence-gap resync throttling
    sock1.emitMessage({ v: 2, seq: 305, type: "status", provenance: "LIVE", asOf: 1732000000000 });
    assert.equal(sock1.sent.length, 3, "First gap triggers view resync");
    clock += 500; // within throttle window (2000ms)
    sock1.emitMessage({ v: 2, seq: 310, type: "status", provenance: "LIVE", asOf: 1732000001000 });
    assert.equal(sock1.sent.length, 3, "Second gap within throttle window must not spam resync");
    clock += 2000; // past throttle window
    sock1.emitMessage({ v: 2, seq: 315, type: "status", provenance: "LIVE", asOf: 1732000002000 });
    assert.equal(sock1.sent.length, 4, "Gap after throttle window triggers resync");

    // Fail once, close(), then connect() again -> wsFails/retryAttempt/lastSeq must be reset
    sock1.fail();
    svc.close();
    svc.connect();
    assert.equal(env.wsInstances.length, 2);
    const sock2 = env.wsInstances[1];
    sock2.open();
    // Sequence 1 must be accepted again (lastSeq was reset)
    const statuses = [];
    svc.on("status", (f) => statuses.push(f));
    sock2.emitMessage({ v: 2, seq: 1, type: "status", provenance: "LIVE", asOf: 1732000003000 });
    assert.equal(statuses.length, 1);
    // Failing once now must NOT immediately fall back to SSE (wsFails was reset to 0, maxWsFails=2)
    sock2.fail();
    assert.equal(env.esInstances.length, 0, "wsFails must have been reset on connect()");

    svc.close();
  });
}

await test("src/data_service.js validator matches shared/protocol.js parity", () => {
  // MAX_CLIENT_FRAME_BYTES enforcement
  const bigStr = JSON.stringify({ op: "view", watchlist: Array.from({ length: 1200 }, (_, i) => `SYM${i}`) });
  assert.ok(bigStr.length > MAX_CLIENT_FRAME_BYTES);
  const bigRes = validateBrowserClientMessage(bigStr);
  assert.equal(bigRes.ok, false);
  assert.equal(bigRes.code, "BUDGET_EXCEEDED");

  // OHLC bracketing rejection on bar & state.chart.bars
  const badBar = validateBrowserServerFrame({
    v: 2,
    seq: 1,
    type: "bar",
    sym: "BTCUSDT",
    tf: "1H",
    bar: [1732000000, 100, 99, 98, 101, 10], // h < max(o,c)
  });
  assert.equal(badBar.ok, false);

  const badStateBar = validateBrowserServerFrame(
    makeFakeStateFrame({
      chart: { sym: "BTCUSDT", tf: "1H", bars: [[1732000000, 100, 105, 102, 101, 10]] }, // l > min(o,c)
    })
  );
  assert.equal(badStateBar.ok, false);

  // Heatmap tf, range, and finite value checks
  assert.equal(
    validateBrowserServerFrame({
      v: 2, seq: 2, type: "heatmap", metric: "chg", tf: "99X", asOf: 1732000000000, tiles: [],
    }).ok,
    false
  );
  assert.equal(
    validateBrowserServerFrame({
      v: 2, seq: 3, type: "heatmap", metric: "chg", tf: "1D", range: -5, asOf: 1732000000000, tiles: [],
    }).ok,
    false
  );
  assert.equal(
    validateBrowserServerFrame({
      v: 2,
      seq: 4,
      type: "heatmap",
      metric: "chg",
      tf: "1D",
      asOf: 1732000000000,
      tiles: [{ symbol: "AAPL", value: Infinity, weight: 10, source: "twelvedata", asOf: 1732000000000 }],
    }).ok,
    false
  );

  // vs error, plots, markers validation
  assert.equal(
    validateBrowserServerFrame({
      v: 2, seq: 5, type: "vs", sym: "BTCUSDT", tf: "1H", id: "s1", error: { message: "Syntax error", line: 2, col: 4 },
    }).ok,
    true
  );
  assert.equal(
    validateBrowserServerFrame({
      v: 2, seq: 6, type: "vs", sym: "BTCUSDT", tf: "1H", id: "s1", error: { message: "Bad line", line: 0 },
    }).ok,
    false
  );
  assert.equal(
    validateBrowserServerFrame({
      v: 2, seq: 7, type: "vs", sym: "BTCUSDT", tf: "1H", id: "s1",
    }).ok,
    false
  );
});

await test("src/data_service.js is allowed by functions/_middleware.js and both modules have ZERO banned identifiers", () => {
  assert.equal(isPublicPath("/src/data_service.js"), true, "/src/data_service.js must be allowlisted");

  const banned = [
    /\bemaArr\b/,
    /\bsmaArr\b/,
    /\batrArr\b/,
    /\brsiArr\b/,
    /\bvsRun\b/,
    /\bpassesPreset\b/,
    /\bbnGet\b/,
    /\bbnwsConnect\b/,
    /\bindexedDB\.open\b/,
    /\bcreateTickGuard\b/,
    /\bcleanBars\b/,
    /\blastCandles\b/,
    /\bMath\.random\b/,
    /https?:\/\//i,
  ];

  for (const rel of ["client/services/thinDataService.js", "src/data_service.js"]) {
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    for (const re of banned) {
      assert.equal(re.test(src), false, `Banned pattern ${re} found in ${rel}`);
    }
  }
});

console.log(`\nthin-data-service: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
