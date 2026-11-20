// tests/protocol.test.mjs — Contract tests for WebSocket Protocol v2:
// validates every client/server frame type, rejects invalid/oversized/synthetic frames,
// verifies state gzip budget, and runs a 200-client coalesced fan-out budget test.

import assert from "node:assert/strict";

import {
  MAX_CHART_BARS,
  MAX_HEATMAP_TILES,
  MAX_LIVE_FRAME_BYTES,
  MAX_SCREENER_PAGE_ROWS,
  MAX_STATE_GZIP_BYTES,
  MAX_WATCHLIST_SYMBOLS,
  PROTOCOL_VERSION,
  PROVENANCE,
  byteLength,
  checkLiveFrameBudget,
  checkScreenerBudget,
  checkStateGzipBudget,
  createSequencer,
  makeFrame,
  packQuoteFrames,
  validateClientMessage,
  validateServerFrame,
} from "../shared/protocol.js";

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, "\n ", err && err.stack ? err.stack : err);
    process.exitCode = 1;
  }
}

const NOW = 1732000000000;

await test("client ops: accepts valid hello, view (full + partial), and ping", () => {
  const validMsgs = [
    { op: "hello", v: 2 },
    { op: "hello", v: 2, session: "sess_abc123" },
    { op: "ping" },
    { op: "ping", t: NOW },
    {
      op: "view",
      chart: { sym: "BTCUSDT", tf: "1H", ind: ["ema20", { id: "rsi14", type: "rsi", len: 14 }], vs: ["vs_01"] },
      watchlist: ["BTCUSDT", "EURUSD", "NQ=F", "AAPL"],
      screener: { preset: "P1", page: 1, evcTf: "H", dir: "long", market: "ALL", pageSize: 50 },
      heatmap: { metric: "chg", tf: "1D", n: 60, size: "value", market: "ALL" },
    },
    { op: "view", watchlist: ["EURUSD"] },
    { op: "view", screener: { preset: "P5", page: 3 } },
    { op: "view", heatmap: { metric: "score", n: 30 } },
    JSON.stringify({ op: "view", chart: { sym: "EURUSD", tf: "15m" } }),
  ];

  for (const m of validMsgs) {
    const res = validateClientMessage(m);
    assert.equal(res.ok, true, `Expected valid client message: ${JSON.stringify(m)} -> ${res.error}`);
  }
});

await test("client ops: rejects wrong version, malformed JSON, unknown op, invalid fields, and budget violations", () => {
  const invalidMsgs = [
    ["not-json{", "INVALID_JSON"],
    [null, "INVALID_MESSAGE"],
    [{ op: "sub", symbols: ["EURUSD"] }, "UNKNOWN_OP"], // legacy v1 op rejected
    [{ op: "hello", v: 1 }, "UNSUPPORTED_VERSION"],
    [{ op: "hello", v: 2, session: "" }, "INVALID_HELLO"],
    [{ op: "ping", t: -5 }, "INVALID_PING"],
    [{ op: "view" }, "INVALID_VIEW"],
    [{ op: "view", chart: { sym: "BAD SYMBOL!", tf: "1H" } }, "INVALID_VIEW"],
    [{ op: "view", chart: { sym: "BTCUSDT", tf: "30s" } }, "INVALID_VIEW"], // seconds cannot be backfilled from REST history
    [{ op: "view", screener: { preset: "P9", page: 1 } }, "INVALID_VIEW"],
    [{ op: "view", screener: { preset: "P1", page: 0 } }, "INVALID_VIEW"],
    [{ op: "view", screener: { preset: "P1", page: 1, pageSize: MAX_SCREENER_PAGE_ROWS + 1 } }, "BUDGET_EXCEEDED"],
    [{ op: "view", heatmap: { metric: "bogus" } }, "INVALID_VIEW"],
    [{ op: "view", heatmap: { metric: "chg", n: MAX_HEATMAP_TILES + 1 } }, "BUDGET_EXCEEDED"],
    [{ op: "view", watchlist: Array.from({ length: MAX_WATCHLIST_SYMBOLS + 1 }, (_, i) => `SYM${i}`) }, "BUDGET_EXCEEDED"],
    [{ op: "view", screener: { preset: "P1", page: 1, query: "x".repeat(9000) } }, "BUDGET_EXCEEDED"],
  ];

  for (const [msg, expectedCode] of invalidMsgs) {
    const res = validateClientMessage(msg);
    assert.equal(res.ok, false, `Expected invalid client message to fail: ${JSON.stringify(msg).slice(0, 80)}`);
    assert.equal(res.code, expectedCode, `Expected code ${expectedCode}, got ${res.code} (${res.error})`);
  }
});

await test("server frames: builds & validates every frame type with v=2 and strictly monotonic seq", () => {
  const seq = createSequencer();
  const sampleRow = { symbol: "BTCUSDT", market: "CRY", price: 91500, score: 92, tier: "P1", source: "twelvedata", asOf: NOW };
  const sampleTile = { symbol: "BTCUSDT", market: "CRY", value: 3.45, weight: 32.1, tradedValue: 1e9, source: "twelvedata", asOf: NOW };

  const frames = [
    makeFrame("hello", { serverTime: NOW, session: "s1", capabilities: ["bars", "ind", "vs", "screener", "heatmap", "alerts"] }, seq.next()),
    makeFrame("state", {
      status: { provenance: PROVENANCE.LIVE, asOf: NOW },
      chart: { sym: "BTCUSDT", tf: "1H", bars: [[1731996400, 91000, 91600, 90900, 91500, 120.5]] },
      watchlist: [{ s: "BTCUSDT", c: 91500, t: NOW, v: 120.5, provenance: PROVENANCE.LIVE }],
      screener: { page: 1, totalPages: 1, total: 1, preset: "P1", asOf: NOW, rows: [sampleRow] },
      heatmap: { metric: "chg", tf: "1D", range: 4.5, asOf: NOW, tiles: [sampleTile] },
    }, seq.next()),
    makeFrame("bar", { sym: "BTCUSDT", tf: "1H", bar: [1732000000, 91500, 91580, 91450, 91550, 35.2], closed: false, provenance: PROVENANCE.LIVE, asOf: NOW }, seq.next()),
    makeFrame("ind", { sym: "BTCUSDT", tf: "1H", id: "ema20", point: { t: 1732000000, v: 91230.5 } }, seq.next()),
    makeFrame("vs", { sym: "BTCUSDT", tf: "1H", id: "script_1", plots: [{ name: "Signal", points: [[1732000000, 91500]] }], markers: [] }, seq.next()),
    makeFrame("vs", { sym: "BTCUSDT", tf: "1H", id: "script_2", error: { message: "Unknown identifier 'foo'", line: 3, col: 9, hint: "Did you mean 'close'?" } }, seq.next()),
    makeFrame("quotes", { quotes: [{ s: "BTCUSDT", c: 91550, t: NOW, bid: 91549, ask: 91551, provenance: PROVENANCE.LIVE }] }, seq.next()),
    makeFrame("screener", { page: 1, totalPages: 2, total: 75, preset: "P1", asOf: NOW, rows: [sampleRow] }, seq.next()),
    makeFrame("heatmap", { metric: "chg", tf: "1D", range: 3.5, asOf: NOW, tiles: [sampleTile] }, seq.next()),
    makeFrame("status", { provenance: PROVENANCE.LIVE, asOf: NOW }, seq.next()),
    makeFrame("status", { provenance: PROVENANCE.DELAYED, asOf: NOW - 15000, detail: "15s delayed" }, seq.next()),
    makeFrame("status", { provenance: PROVENANCE.CACHED, asOf: NOW - 60000 }, seq.next()),
    makeFrame("status", { provenance: PROVENANCE.UNAVAILABLE, asOf: NOW, detail: "Upstream offline" }, seq.next()),
    makeFrame("alert", { id: "alrt_1", sym: "BTCUSDT", condition: "price >= 91500", price: 91550, triggeredAt: NOW, message: "BTC crossed 91,500" }, seq.next()),
    makeFrame("error", { code: "RATE_LIMIT", message: "Slow down", fatal: false }, seq.next()),
    makeFrame("pong", { t: NOW }, seq.next()),
  ];

  let lastSeq = 0;
  for (const f of frames) {
    assert.equal(f.v, PROTOCOL_VERSION);
    const res = validateServerFrame(JSON.stringify(f), { lastSeq });
    assert.equal(res.ok, true, `Frame ${f.type} failed: ${res.error}`);
    lastSeq = f.seq;
  }
  assert.equal(lastSeq, frames.length);
});

await test("server frames: rejects wrong v, non-monotonic seq, oversized live frames, >50 screener rows, and edge+sim", () => {
  // Wrong version
  assert.equal(validateServerFrame({ v: 1, seq: 1, type: "status", provenance: "LIVE", asOf: NOW }).code, "UNSUPPORTED_VERSION");

  // Non-monotonic seq
  assert.equal(validateServerFrame({ v: 2, seq: 5, type: "status", provenance: "LIVE", asOf: NOW }, { lastSeq: 5 }).code, "NON_MONOTONIC_SEQ");
  assert.equal(validateServerFrame({ v: 2, seq: 4, type: "status", provenance: "LIVE", asOf: NOW }, { lastSeq: 5 }).code, "NON_MONOTONIC_SEQ");
  assert.equal(validateServerFrame({ v: 2, seq: -1, type: "status", provenance: "LIVE", asOf: NOW }).code, "INVALID_SEQ");

  // Invalid provenance
  assert.equal(validateServerFrame({ v: 2, seq: 1, type: "status", provenance: "SIMULATED", asOf: NOW }).code, "INVALID_STATUS");

  // Oversized live frame (> 2048 bytes)
  const hugeQuotes = Array.from({ length: 40 }, (_, i) => ({
    s: `SYMBOL${String(i).padStart(3, "0")}`,
    c: 12345.6789,
    t: NOW,
    bid: 12345.1,
    ask: 12346.2,
    v: 987654.32,
    provenance: "LIVE",
  }));
  const oversized = { v: 2, seq: 1, type: "quotes", quotes: hugeQuotes };
  assert.equal(checkLiveFrameBudget(oversized).ok, false);
  assert.equal(validateServerFrame(oversized).code, "BUDGET_EXCEEDED");
  assert.throws(() => makeFrame("quotes", { quotes: hugeQuotes }, 1), /BUDGET_EXCEEDED/);

  // > 50 screener rows rejected
  const rows51 = Array.from({ length: MAX_SCREENER_PAGE_ROWS + 1 }, (_, i) => ({
    symbol: `S${i}`, source: "twelvedata", asOf: NOW,
  }));
  const scFrame = { v: 2, seq: 1, type: "screener", page: 1, totalPages: 1, total: 51, preset: "P5", asOf: NOW, rows: rows51 };
  assert.equal(checkScreenerBudget(scFrame).ok, false);
  assert.equal(validateServerFrame(scFrame).code, "BUDGET_EXCEEDED");

  // Synthetic source "edge+sim" rejected in both screener and heatmap frames
  const simScreener = {
    v: 2, seq: 1, type: "screener", page: 1, totalPages: 1, total: 1, preset: "P5", asOf: NOW,
    rows: [{ symbol: "EURUSD", source: "edge+sim", asOf: NOW }],
  };
  assert.equal(validateServerFrame(simScreener).code, "FORBIDDEN_SOURCE");

  const simHeatmap = {
    v: 2, seq: 1, type: "heatmap", metric: "chg", tf: "1D", asOf: NOW,
    tiles: [{ symbol: "EURUSD", value: 0.5, weight: 10, source: "edge+sim", asOf: NOW }],
  };
  assert.equal(validateServerFrame(simHeatmap).code, "FORBIDDEN_SOURCE");

  // Inverted bar wick & > 1500 bars rejected
  const badBar = { v: 2, seq: 1, type: "bar", sym: "EURUSD", tf: "1H", bar: [1732000000, 1.1, 1.05, 1.2, 1.12, 10] };
  assert.equal(validateServerFrame(badBar).code, "INVALID_BAR");

  const tooManyBars = Array.from({ length: MAX_CHART_BARS + 1 }, (_, i) => [1730000000 + i * 60, 100, 101, 99, 100.5, 10]);
  const badState = { v: 2, seq: 1, type: "state", status: { provenance: "LIVE", asOf: NOW }, chart: { sym: "AAPL", tf: "1m", bars: tooManyBars } };
  assert.equal(validateServerFrame(badState).code, "BUDGET_EXCEEDED");
});

await test("state gzip budget: full 1,500-bar + 50-row + 60-tile bootstrap stays well under 150 KB gzipped", async () => {
  const bars = [];
  let p = 65000;
  for (let i = 0; i < MAX_CHART_BARS; i++) {
    const o = p;
    const c = Number((o * (1 + Math.sin(i / 25) * 0.002)).toFixed(2));
    const h = Number((Math.max(o, c) * 1.003).toFixed(2));
    const l = Number((Math.min(o, c) * 0.997).toFixed(2));
    bars.push([1730000000 + i * 3600, o, h, l, c, Number((100 + (i % 50) * 3.5).toFixed(2))]);
    p = c;
  }

  const screenerRows = Array.from({ length: MAX_SCREENER_PAGE_ROWS }, (_, i) => ({
    symbol: `SYM${String(i).padStart(2, "0")}`,
    market: i % 2 === 0 ? "CRY" : "STK",
    price: 100 + i,
    pct1D: Number(((i - 25) * 0.15).toFixed(2)),
    adr14: 2.35,
    score: 50 + (i % 50),
    tier: "P2",
    source: "twelvedata",
    asOf: NOW,
  }));

  const heatmapTiles = Array.from({ length: 60 }, (_, i) => ({
    symbol: `SYM${String(i).padStart(2, "0")}`,
    market: i % 3 === 0 ? "FX" : "CRY",
    value: Number(((i - 30) * 0.2).toFixed(2)),
    weight: Number((5 + i * 0.4).toFixed(2)),
    tradedValue: 1000000 * (i + 1),
    source: "twelvedata",
    asOf: NOW,
  }));

  const watchlist = Array.from({ length: 30 }, (_, i) => ({
    s: `SYM${String(i).padStart(2, "0")}`,
    c: 100 + i * 1.25,
    t: NOW,
    v: 5000 + i,
    provenance: PROVENANCE.LIVE,
  }));

  const stateFrame = makeFrame("state", {
    status: { provenance: PROVENANCE.LIVE, asOf: NOW },
    chart: { sym: "BTCUSDT", tf: "1H", bars },
    watchlist,
    screener: { page: 1, totalPages: 3, total: 140, preset: "P2", asOf: NOW, rows: screenerRows },
    heatmap: { metric: "chg", tf: "1D", range: 5.5, asOf: NOW, tiles: heatmapTiles },
  }, 1);

  const gzip = await checkStateGzipBudget(stateFrame);
  assert.equal(gzip.ok, true, `Full bootstrap gzip ${gzip.gzipBytes}B exceeded ${MAX_STATE_GZIP_BYTES}B`);
  assert.ok(gzip.gzipBytes < MAX_STATE_GZIP_BYTES, `Expected gzip (${gzip.gzipBytes}B) < ${MAX_STATE_GZIP_BYTES}B`);

  // Verify checkStateGzipBudget accurately flags an over-budget payload
  const tightCheck = await checkStateGzipBudget(stateFrame, 512);
  assert.equal(tightCheck.ok, false);
  assert.ok(tightCheck.overBy > 0);
});

await test("200-client coalesced fan-out: every frame valid, monotonic seq, strictly <= 2 KB budget", () => {
  const NUM_CLIENTS = 200;
  const UNIVERSE = Array.from({ length: 60 }, (_, i) => `MKT${String(i).padStart(2, "0")}USDT`);

  // Create 200 fake clients, each with a chart + 25–40 watchlist symbols (deterministic overlap)
  const clients = [];
  for (let i = 0; i < NUM_CLIENTS; i++) {
    const wlCount = 25 + (i % 16); // 25..40 symbols per client
    const watchlist = [];
    for (let j = 0; j < wlCount; j++) {
      watchlist.push(UNIVERSE[(i * 7 + j) % UNIVERSE.length]);
    }
    const chartSym = watchlist[0];
    const viewMsg = {
      op: "view",
      chart: { sym: chartSym, tf: "1H", ind: ["ema20"] },
      watchlist,
    };
    assert.equal(validateClientMessage(viewMsg).ok, true);
    clients.push({
      id: `c${i}`,
      chartSym,
      watchlistSet: new Set(watchlist),
      seq: createSequencer(),
      inbox: [],
    });
  }

  // Coalesce a burst of 5,000 upstream ticks across all 60 symbols -> latest tick per symbol
  const coalesced = new Map();
  for (let tickIdx = 0; tickIdx < 5000; tickIdx++) {
    const sym = UNIVERSE[tickIdx % UNIVERSE.length];
    const price = Number((100 + (tickIdx % 60) + tickIdx * 0.001).toFixed(4));
    coalesced.set(sym, {
      s: sym,
      c: price,
      t: NOW + tickIdx,
      v: 100 + (tickIdx % 50),
      provenance: PROVENANCE.LIVE,
    });
  }
  assert.equal(coalesced.size, 60, "5,000 ticks must coalesce to 60 latest quotes");

  // Fan out coalesced quotes + chart bar/ind deltas to all 200 clients
  let totalFramesSent = 0;
  let maxFrameBytes = 0;

  for (const client of clients) {
    const clientQuotes = [];
    for (const sym of client.watchlistSet) {
      const q = coalesced.get(sym);
      if (q) clientQuotes.push(q);
    }

    // Pack into <= 2 KB quote frames
    const quoteFrames = packQuoteFrames(clientQuotes, () => client.seq.next(), MAX_LIVE_FRAME_BYTES);
    for (const f of quoteFrames) {
      const wire = JSON.stringify(f);
      client.inbox.push(wire);
    }

    // Push coalesced chart bar + indicator delta for the client's active chart symbol
    const latest = coalesced.get(client.chartSym);
    const barFrame = makeFrame("bar", {
      sym: client.chartSym,
      tf: "1H",
      bar: [1732000000, latest.c - 0.5, latest.c + 0.5, latest.c - 0.8, latest.c, latest.v],
      closed: false,
      provenance: PROVENANCE.LIVE,
      asOf: latest.t,
    }, client.seq.next());
    client.inbox.push(JSON.stringify(barFrame));

    const indFrame = makeFrame("ind", {
      sym: client.chartSym,
      tf: "1H",
      id: "ema20",
      point: { t: 1732000000, v: Number((latest.c * 0.995).toFixed(4)) },
    }, client.seq.next());
    client.inbox.push(JSON.stringify(indFrame));
  }

  // Verify every single wire frame delivered across all 200 clients
  for (const client of clients) {
    let lastSeq = 0;
    const seenSyms = new Map();
    for (const wire of client.inbox) {
      const bytes = byteLength(wire);
      assert.ok(bytes <= MAX_LIVE_FRAME_BYTES, `Client ${client.id} received ${bytes}B frame > ${MAX_LIVE_FRAME_BYTES}B`);
      if (bytes > maxFrameBytes) maxFrameBytes = bytes;

      const res = validateServerFrame(wire, { lastSeq });
      assert.equal(res.ok, true, `Client ${client.id} invalid frame: ${res.error}`);
      lastSeq = res.value.seq;
      totalFramesSent++;

      if (res.value.type === "quotes") {
        for (const q of res.value.quotes) seenSyms.set(q.s, q.c);
      }
    }

    // Every client received exact latest coalesced price for every symbol in its watchlist
    assert.equal(seenSyms.size, client.watchlistSet.size, `Client ${client.id} missed symbols`);
    for (const sym of client.watchlistSet) {
      assert.equal(seenSyms.get(sym), coalesced.get(sym).c, `Client ${client.id} stale price for ${sym}`);
    }
  }

  assert.ok(totalFramesSent >= NUM_CLIENTS * 3, "expected quotes + bar + ind frames per client");
  assert.ok(maxFrameBytes <= MAX_LIVE_FRAME_BYTES, `max frame ${maxFrameBytes}B exceeded 2 KB`);
  console.log(`  [fan-out stats] clients=${NUM_CLIENTS}, frames=${totalFramesSent}, maxFrameBytes=${maxFrameBytes}B / ${MAX_LIVE_FRAME_BYTES}B`);
});

console.log(`\nprotocol.test.mjs: ${passed} passed, ${failed} failed`);
