// tests/candle-ohlc-history.test.mjs — 1m keeps true OHLC bodies/wicks; 15m / 30m / 4H always load full history.
//
// Root causes under test (production, EURUSD, after PR #25):
//  1. worker.js called the vektor-market `/td/time_series` proxy over the MARKET_SERVICE binding WITHOUT the
//     `X-Vektor-Internal` header that handleTd() requires, so every Twelve Data REST history call was 403 and all
//     history silently fell back to Yahoo. Yahoo's FX 1m series is O=H=L=C on every bar -> flat dashes on 1m.
//     The old candle-backfill mock skipped the auth check; here worker.js talks to the REAL workers/market handler.
//  2. overlayLiveBars() let a flat REST bar overwrite the hub's real tick-built bar at the same timestamp.
//  3. When the upstream fetch failed on a `refresh=1` backfill (what the chart sends on every TF switch), the Pages
//     Function dropped to the hub-only answer: a single forming bar on 15m / 30m / 4H. Last good history must win.
// Run: node tests/candle-ohlc-history.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { bucketStart, overlayLiveBars } from "../shared/market/candles.js";
import { resolveInterval } from "../shared/intervals.js";

const NOW = Math.floor(Date.now() / 1000);
const SECRET = "itest-internal-td-secret";

// ---------------------------------------------------------------- caches (edge cache API)
const store = new Map();
globalThis.caches = {
  default: {
    async match(req) {
      const hit = store.get(req.url);
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) {
      store.set(req.url, res);
    },
  },
};

// ---------------------------------------------------------------- upstream world (Twelve Data REST + Yahoo)
const TD_KEY_OF = { "1min": "1m", "5min": "5m", "15min": "15m", "30min": "30m", "1h": "1H", "4h": "4H", "1day": "1D", "1week": "1W", "1month": "1M" };
const world = { td: new Map(), tdFail: false, yahooFlat: true, hub: new Map() };
const calls = { td: [], yahoo: 0 };

const prevBucket = (t, key) => bucketStart(t - 1, key);
const px = (t) => 1.08 + (t % 997) / 100000;
/** A real candle: distinct open/high/low/close with 5-decimal FX precision. */
const mkBar = (t) => ({ t, o: px(t), h: px(t) + 0.00042, l: px(t) - 0.00037, c: px(t) + 0.00011, v: 0 });
const isFlat = (b) => b.o === b.h && b.h === b.l && b.l === b.c;

function series(key, count, endT) {
  const out = [];
  let t = endT;
  for (let i = 0; i < count; i++) {
    out.push(mkBar(t));
    t = prevBucket(t, key);
  }
  return out.reverse();
}

const tdDt = (t, daily) => {
  const iso = new Date(t * 1000).toISOString();
  return daily ? iso.slice(0, 10) : iso.slice(0, 19).replace("T", " ");
};

globalThis.fetch = async (input) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname === "api.twelvedata.com" && u.pathname === "/time_series") {
    const iv = u.searchParams.get("interval");
    const symbol = u.searchParams.get("symbol");
    calls.td.push({ iv, symbol, apikey: u.searchParams.get("apikey") });
    if (world.tdFail) return Response.json({ status: "error", code: 429, message: "API credits exhausted" }, { status: 429 });
    const bars = world.td.get(`${symbol}|${TD_KEY_OF[iv]}`);
    if (!bars) return Response.json({ status: "error", code: 400, message: "no data" });
    const n = Number(u.searchParams.get("outputsize")) || bars.length;
    const daily = ["1day", "1week", "1month"].includes(iv);
    const values = bars
      .slice(-n)
      .reverse()
      .map((b) => ({ datetime: tdDt(b.t, daily), open: b.o.toFixed(5), high: b.h.toFixed(5), low: b.l.toFixed(5), close: b.c.toFixed(5), volume: "0" }));
    return Response.json({ meta: { symbol, interval: iv }, values, status: "ok" });
  }
  if (u.hostname.endsWith("finance.yahoo.com")) {
    calls.yahoo += 1;
    if (!world.yahooFlat) return new Response("{}", { status: 429 });
    // Yahoo FX 1m: every bar is O=H=L=C (tick samples, not candles).
    const ts = [];
    const q = { open: [], high: [], low: [], close: [], volume: [] };
    for (let i = 300; i > 0; i--) {
      const t = bucketStart(NOW, "1m") - i * 60;
      const p = px(t);
      ts.push(t);
      q.open.push(p); q.high.push(p); q.low.push(p); q.close.push(p); q.volume.push(0);
    }
    return Response.json({ chart: { result: [{ timestamp: ts, indicators: { quote: [q] } }] } });
  }
  return new Response("{}", { status: 500 });
};

// ---------------------------------------------------------------- real vektor-market Worker behind the service binding
const { default: market } = await import("../workers/market/index.js");
const hubStub = {
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== "/api/bars") return Response.json({ ok: false }, { status: 404 });
    const iv = resolveInterval(url.searchParams.get("tf"));
    const bars = (iv && world.hub.get(iv.key)) || [];
    return Response.json({ ok: true, bars, hasMore: false, provenance: "LIVE" });
  },
};
const marketEnv = {
  TWELVEDATA_KEY: "td-test-key",
  INTERNAL_TD_SECRET: SECRET,
  ALLOWED_ORIGINS: "https://vektorterminal.com",
  MARKET_HUB: { idFromName: (n) => n, get: () => hubStub },
};
const pending = [];
const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) };
const settle = async () => {
  while (pending.length) await Promise.all(pending.splice(0));
};

const env = {
  INTERNAL_TD_SECRET: SECRET,
  MARKET_SERVICE: { fetch: (req) => market.fetch(req, marketEnv, ctx) },
};

const { default: worker } = await import("../worker.js");
const { onRequest } = await import("../functions/api/[[path]].js");

async function viaPages(sym, interval, extra = "") {
  const res = await onRequest({
    request: new Request(`https://vektorterminal.com/api/candles?symbol=${sym}&interval=${encodeURIComponent(interval)}&mkt=FX${extra}`),
    env,
    waitUntil: ctx.waitUntil,
  });
  await settle();
  return { res, body: await res.json() };
}

const CCY = ["EUR", "GBP", "USD", "JPY", "AUD", "NZD", "CAD", "CHF"];
const PAIRS = [];
for (const a of CCY) for (const b of CCY) if (a !== b) PAIRS.push([a + b, `${a}/${b}`]);
let ix = 0;
const nextPair = () => PAIRS[ix++];

// ---------------------------------------------------------------- tests
describe("service binding -> vektor-market /td proxy is authorised", () => {
  it("worker.js sends X-Vektor-Internal, so Twelve Data REST history is reached (not a silent 403 -> Yahoo)", async () => {
    const [raw, tdSym] = nextPair();
    const forming = bucketStart(NOW, "1H");
    world.td.set(`${tdSym}|1H`, series("1H", 60, prevBucket(forming, "1H")));
    world.hub.set("1H", [mkBar(forming)]);
    const before = calls.td.length;
    const { res, body } = await viaPages(raw, "1H");
    assert.equal(res.status, 200);
    assert.equal(calls.td.length - before, 1, "one upstream Twelve Data call");
    assert.equal(calls.td.at(-1).apikey, "td-test-key", "key appended inside vektor-market only");
    assert.match(body.source, /^twelvedata/);
    assert.equal(body.bars.length, 61);
  });
});

describe("1m preserves true OHLC bodies and wicks", () => {
  it("full 1m history comes from Twelve Data with distinct O/H/L/C (no flat dashes), live candle on top", async () => {
    const [raw, tdSym] = nextPair();
    const forming = bucketStart(NOW, "1m");
    world.td.set(`${tdSym}|1m`, series("1m", 1500, prevBucket(forming, "1m")));
    world.hub.set("1m", [{ t: forming, o: 1.1, h: 1.1003, l: 1.0998, c: 1.1001, v: 0 }]);
    const { res, body } = await viaPages(raw, "1m", "&limit=5000");
    assert.equal(res.status, 200);
    assert.match(body.source, /^twelvedata/);
    assert.equal(body.bars.length, 1501);
    const flat = body.bars.filter(isFlat).length;
    assert.equal(flat, 0, `${flat} flat 1m bars`);
    for (const b of body.bars.slice(0, -1)) {
      assert.ok(b.h > b.l, "wick range kept");
      assert.ok(b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c));
    }
    // 5-decimal precision is not truncated
    const first = body.bars[0];
    assert.equal(first.o, Number(mkBar(first.t).o.toFixed(5)));
    assert.equal(body.bars.at(-1).c, 1.1001);
  });

  it("Yahoo's degenerate O=H=L=C 1m series is never served as candles when Twelve Data is down", async () => {
    const [raw] = nextPair();
    world.tdFail = true;
    world.yahooFlat = true;
    const forming = bucketStart(NOW, "1m");
    world.hub.set("1m", [
      { t: forming - 120, o: 1.1, h: 1.1004, l: 1.0997, c: 1.1002, v: 0 },
      { t: forming - 60, o: 1.1002, h: 1.1006, l: 1.1, c: 1.1005, v: 0 },
      { t: forming, o: 1.1005, h: 1.1007, l: 1.1003, c: 1.1004, v: 0 },
    ]);
    try {
      const { res, body } = await viaPages(raw, "1m");
      assert.equal(res.status, 200);
      assert.ok(body.bars.length > 0);
      assert.equal(body.bars.filter(isFlat).length, 0, "flat Yahoo dashes rejected; hub's real bars served");
    } finally {
      world.tdFail = false;
    }
  });

  it("overlayLiveBars: a real live candle replaces a flat REST bar at the same timestamp", () => {
    const hist = [
      { t: 60, o: 1, h: 1, l: 1, c: 1, v: 0 },
      { t: 120, o: 1, h: 1.2, l: 0.9, c: 1.1, v: 0 },
      { t: 180, o: 1.1, h: 1.1, l: 1.1, c: 1.1, v: 0 },
    ];
    const live = [
      { t: 60, o: 1, h: 1.05, l: 0.95, c: 1.02, v: 3 },
      { t: 120, o: 2, h: 3, l: 1.5, c: 2.5, v: 1 },
      { t: 180, o: 1.1, h: 1.15, l: 1.05, c: 1.12, v: 2 },
    ];
    const out = overlayLiveBars(hist, live);
    assert.deepEqual(out[0], live[0], "flat REST bar replaced by the hub's real candle");
    assert.deepEqual(out[1], hist[1], "a real REST bar still wins over a partial hub bar");
    assert.equal(out[2].h, 1.15);
    assert.equal(out[2].l, 1.05);
    assert.equal(out[2].c, 1.12);
  });
});

describe("15m / 30m / 4H load full history and merge the live hub bar", () => {
  for (const [key, n] of [["15m", 2000], ["30m", 1000], ["4H", 800]]) {
    it(`${key}: full Twelve Data history + live forming bar (never a single bar)`, async () => {
      const [raw, tdSym] = nextPair();
      const forming = bucketStart(NOW, key);
      world.td.set(`${tdSym}|${key}`, series(key, n, prevBucket(forming, key)));
      world.hub.set(key, [{ t: forming, o: 1.2, h: 1.21, l: 1.19, c: 1.205, v: 0 }]);
      const { res, body } = await viaPages(raw, key);
      assert.equal(res.status, 200);
      assert.equal(body.interval, key);
      assert.equal(body.bars.length, n + 1);
      assert.equal(body.bars.at(-1).t, forming);
      assert.equal(body.bars.at(-1).c, 1.205);
      for (let i = 1; i < body.bars.length; i++) assert.ok(body.bars[i].t > body.bars[i - 1].t);
      assert.equal(body.bars.filter(isFlat).length, 0);
    });

    it(`${key}: refresh=1 backfill while upstream fails serves the last good history, not the hub's single bar`, async () => {
      const [raw, tdSym] = nextPair();
      const forming = bucketStart(NOW, key);
      world.td.set(`${tdSym}|${key}`, series(key, 300, prevBucket(forming, key)));
      world.hub.set(key, [{ t: forming, o: 1.2, h: 1.21, l: 1.19, c: 1.205, v: 0 }]);
      const warm = await viaPages(raw, key);
      assert.equal(warm.body.bars.length, 301);

      store.clear(); // every edge / vektor-market /td cache entry has expired
      world.tdFail = true;
      world.yahooFlat = false;
      world.hub.set(key, [{ t: forming, o: 1.2, h: 1.22, l: 1.18, c: 1.215, v: 0 }]);
      try {
        const { res, body } = await viaPages(raw, key, "&refresh=1");
        assert.equal(res.status, 200);
        assert.equal(body.bars.length, 301, "last good history kept");
        assert.equal(body.bars.at(-1).c, 1.215, "fresh live bar still overlaid");
        assert.match(body.source, /stale/);
      } finally {
        world.tdFail = false;
        world.yahooFlat = true;
      }
    });
  }
});
