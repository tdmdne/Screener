// tests/candle-backfill.test.mjs — /api/candles must backfill history from Twelve Data REST (/time_series) for EVERY
// timeframe (native and custom), cache it server-side, resample custom intervals in the backend, and lay the hub's
// live WebSocket bars on top so the latest candle is current and no gap is left behind a WS disconnect.
//
// Root cause under test: the Pages Function used to answer /api/candles straight from the hub's tick-built SQLite
// store, returned 200 with whatever bars existed (often 1 forming bar for 5m/30m/1H/4H) and never reached REST.
// Run: node tests/candle-backfill.test.mjs

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import { bucketStart, rollup } from "../shared/market/candles.js";
import { resolveInterval, INTERVAL_SECONDS } from "../shared/intervals.js";

// ---------------------------------------------------------------- world: fake Twelve Data + hub + caches
const NOW = Math.floor(Date.now() / 1000);

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

const calls = { td: [], hub: [], other: [] };
const world = { tdFail: false, tdBars: new Map(), hubBars: new Map(), hubProvenance: "LIVE" };

globalThis.fetch = async (input) => {
  calls.other.push(String(typeof input === "string" ? input : input.url));
  return new Response("{}", { status: 500 }); // binance / yahoo / direct TD: unavailable
};

const TD_DT = (t, daily) => {
  const iso = new Date(t * 1000).toISOString();
  return daily ? iso.slice(0, 10) : iso.slice(0, 19).replace("T", " ");
};

const prevBucket = (t, key) => bucketStart(t - 1, key);
const px = (t) => 100 + (t % 997) / 100;
const mkBar = (t) => ({ t, o: px(t), h: px(t) + 0.1, l: px(t) - 0.1, c: px(t) + 0.05, v: 10 });

/** Contiguous bars for a native key, ending at `endT`, oldest first. */
function series(key, count, endT) {
  const out = [];
  let t = endT;
  for (let i = 0; i < count; i++) {
    out.push(mkBar(t));
    t = prevBucket(t, key);
  }
  return out.reverse();
}

function setTd(symbolTd, key, bars) {
  world.tdBars.set(`${symbolTd}|${key}`, bars);
}
function setHub(key, bars) {
  world.hubBars.set(key, bars);
}

const env = {
  MARKET_SERVICE: {
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/td/time_series") {
        const iv = url.searchParams.get("interval");
        const symbol = url.searchParams.get("symbol");
        calls.td.push({ interval: iv, symbol, outputsize: Number(url.searchParams.get("outputsize")) });
        if (world.tdFail) return Response.json({ status: "error", code: 429, message: "credits" }, { status: 429 });
        const key = Object.entries({ "1min": "1m", "5min": "5m", "15min": "15m", "30min": "30m", "1h": "1H", "4h": "4H", "1day": "1D", "1week": "1W", "1month": "1M" }).find(([k]) => k === iv)?.[1];
        const bars = world.tdBars.get(`${symbol}|${key}`);
        if (!bars) return Response.json({ status: "error", code: 400, message: "no data" }, { status: 200 });
        const daily = ["1day", "1week", "1month"].includes(iv);
        const n = Number(url.searchParams.get("outputsize")) || bars.length;
        const values = bars
          .slice(-n)
          .slice()
          .reverse()
          .map((b) => ({ datetime: TD_DT(b.t, daily), open: String(b.o), high: String(b.h), low: String(b.l), close: String(b.c), volume: String(b.v) }));
        return Response.json({ status: "ok", values });
      }
      if (url.pathname === "/api/bars") {
        const tf = resolveInterval(url.searchParams.get("tf"));
        calls.hub.push({ sym: url.searchParams.get("sym"), tf: tf && tf.key, limit: url.searchParams.get("limit") });
        const bars = tf ? world.hubBars.get(tf.key) : null;
        if (!bars) return Response.json({ ok: true, bars: [], hasMore: false, provenance: world.hubProvenance });
        return Response.json({ ok: true, sym: url.searchParams.get("sym"), tf: tf.key, bars, hasMore: true, provenance: world.hubProvenance });
      }
      return Response.json({ ok: false }, { status: 404 });
    },
  },
};

const pending = [];
const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) };
const settle = async () => {
  while (pending.length) await Promise.all(pending.splice(0));
};

const { default: worker } = await import("../worker.js");
const { onRequest: onApiRequest } = await import("../functions/api/[[path]].js");

async function getCandles(sym, interval, extra = "") {
  const res = await worker.fetch(new Request(`https://x.test/api/candles?symbol=${sym}&interval=${encodeURIComponent(interval)}&mkt=FX${extra}`), env, ctx);
  await settle();
  const body = await res.json();
  return { res, body };
}

function assertAscendingUnique(bars) {
  for (let i = 1; i < bars.length; i++) assert.ok(bars[i].t > bars[i - 1].t, `bar ${i} (${bars[i].t}) must be after ${bars[i - 1].t}`);
}

// Distinct FX pairs so the process-wide TD memory cache never leaks between cases.
const CCY = ["EUR", "GBP", "USD", "JPY", "AUD", "NZD", "CAD", "CHF"];
const PAIRS = [];
for (const a of CCY) for (const b of CCY) if (a !== b) PAIRS.push([a + b, `${a}/${b}`]);
let pairIx = 0;
const nextPair = () => PAIRS[pairIx++];

const TD_NAME = { "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1H": "1h", "4H": "4h", "1D": "1day", "1W": "1week", "1M": "1month" };

// ---------------------------------------------------------------- tests
describe("native timeframes: REST backfill + live hub overlay (1m, 5m, 30m, 1H, 4H, 1D, 1W, 1M)", () => {
  for (const key of ["1m", "5m", "30m", "1H", "4H", "1D", "1W", "1M"]) {
    it(`${key}: hub holds only the forming bar -> full REST history is returned with the live candle on top`, async () => {
      const [raw, tdSym] = nextPair();
      const formingT = bucketStart(NOW, key);
      setTd(tdSym, key, series(key, 40, prevBucket(formingT, key)));
      setHub(key, [{ t: formingT, o: 1.1, h: 1.3, l: 1.0, c: 1.2, v: 0 }]);
      world.tdFail = false;

      const before = calls.td.length;
      const { res, body } = await getCandles(raw, key);
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.interval, key);
      assert.equal(body.bars.length, 41, `${key}: 40 REST bars + 1 live forming bar`);
      assertAscendingUnique(body.bars);
      assert.equal(body.bars.at(-1).t, formingT, "latest candle is the live forming bar");
      assert.equal(body.bars.at(-1).c, 1.2, "live close applied onto the active candle");
      assert.ok(String(body.source).includes("twelvedata"), `source=${body.source}`);
      assert.equal(calls.td.length - before, 1, "exactly one /time_series call");
      assert.equal(calls.td.at(-1).interval, TD_NAME[key]);
    });
  }

  it("1W bars are Monday-aligned and 1M bars are month-start-aligned (so they merge with hub bars, never duplicate)", async () => {
    const [rawW, tdW] = nextPair();
    const mondayNow = bucketStart(NOW, "1W");
    setTd(tdW, "1W", series("1W", 20, prevBucket(mondayNow, "1W")));
    setHub("1W", [mkBar(mondayNow)]);
    const w = await getCandles(rawW, "1W");
    for (const b of w.body.bars) assert.equal(new Date(b.t * 1000).getUTCDay(), 1, "weekly bar opens Monday");
    assert.equal(w.body.bars.length, 21);

    const [rawM, tdM] = nextPair();
    const monthNow = bucketStart(NOW, "1M");
    setTd(tdM, "1M", series("1M", 20, prevBucket(monthNow, "1M")));
    setHub("1M", [mkBar(monthNow)]);
    const m = await getCandles(rawM, "1M");
    for (const b of m.body.bars) assert.equal(new Date(b.t * 1000).getUTCDate(), 1, "monthly bar opens on the 1st");
    assert.equal(m.body.bars.length, 21);
  });
});

describe("gap filling after a WebSocket disconnect", () => {
  it("5m: holes in the hub series are filled from REST; result is contiguous with REST volume", async () => {
    const [raw, tdSym] = nextPair();
    const formingT = bucketStart(NOW, "5m");
    const full = series("5m", 60, formingT); // contiguous truth, includes the forming bar
    setTd(tdSym, "5m", full.slice(0, -1));
    setHub("5m", [...full.slice(-12, -8), ...full.slice(-3)].map((b) => ({ ...b, v: 0 }))); // WS was down for ~5 buckets
    const { body } = await getCandles(raw, "5m");
    assertAscendingUnique(body.bars);
    for (let i = 1; i < body.bars.length; i++) assert.equal(body.bars[i].t - body.bars[i - 1].t, 300, `no gap before ${body.bars[i].t}`);
    assert.equal(body.bars.at(-1).t, formingT);
    assert.ok(body.bars.slice(0, -1).every((b) => b.v === 10), "closed bars carry REST volume, not hub zero volume");
  });

  it("REST lagging behind live: hub bars newer than the last REST bar extend the series", async () => {
    const [raw, tdSym] = nextPair();
    const formingT = bucketStart(NOW, "30m");
    const full = series("30m", 50, formingT);
    setTd(tdSym, "30m", full.slice(0, -4)); // REST stops 4 bars ago
    setHub("30m", full.slice(-4).map((b) => ({ ...b, v: 0 })));
    const { body } = await getCandles(raw, "30m");
    assert.equal(body.bars.length, 50);
    assertAscendingUnique(body.bars);
    assert.equal(body.bars.at(-1).t, formingT);
  });

  it("hub offline (service binding returns nothing): REST history alone is served", async () => {
    const [raw, tdSym] = nextPair();
    setTd(tdSym, "1H", series("1H", 30, prevBucket(bucketStart(NOW, "1H"), "1H")));
    world.hubBars.delete("1H");
    const { res, body } = await getCandles(raw, "1H");
    assert.equal(res.status, 200);
    assert.equal(body.bars.length, 30);
  });
});

describe("interval normalization and cache keys", () => {
  it("5m / 5min / 5M share one cache entry and one REST call", async () => {
    const [raw, tdSym] = nextPair();
    setTd(tdSym, "5m", series("5m", 30, prevBucket(bucketStart(NOW, "5m"), "5m")));
    setHub("5m", []);
    const before = calls.td.length;
    for (const label of ["5m", "5min", "5M"]) {
      const { res, body } = await getCandles(raw, label);
      assert.equal(res.status, 200, label);
      assert.equal(body.interval, "5m", `${label} reported as canonical 5m`);
      assert.equal(body.bars.length, 30);
    }
    assert.equal(calls.td.length - before, 1, "aliases resolve to the same cache key");
  });

  it("1h / 1H and 60m share a key; 1m (minute) and 1M (month) never collide", async () => {
    const [raw, tdSym] = nextPair();
    setTd(tdSym, "1H", series("1H", 25, prevBucket(bucketStart(NOW, "1H"), "1H")));
    setTd(tdSym, "1m", series("1m", 25, prevBucket(bucketStart(NOW, "1m"), "1m")));
    setTd(tdSym, "1M", series("1M", 25, prevBucket(bucketStart(NOW, "1M"), "1M")));
    const before = calls.td.length;
    for (const label of ["1h", "1H", "60m"]) await getCandles(raw, label);
    assert.equal(calls.td.length - before, 1);
    const m = await getCandles(raw, "1m");
    const M = await getCandles(raw, "1M");
    assert.equal(m.body.interval, "1m");
    assert.equal(M.body.interval, "1M");
    assert.deepEqual(calls.td.slice(before).map((c) => c.interval), ["1h", "1min", "1month"]);
  });

  it("rejects unsupported intervals with 400 and makes no upstream call", async () => {
    const before = calls.td.length;
    for (const bad of ["30s", "1s", "bogus", "0m"]) {
      const { res, body } = await getCandles("EURUSD", bad);
      assert.equal(res.status, 400, bad);
      assert.equal(body.ok, false);
    }
    assert.equal(calls.td.length, before);
  });
});

describe("cache behavior", () => {
  it("history is cached server-side but the live overlay is applied fresh on every request", async () => {
    const [raw, tdSym] = nextPair();
    const formingT = bucketStart(NOW, "4H");
    setTd(tdSym, "4H", series("4H", 30, prevBucket(formingT, "4H")));
    setHub("4H", [{ t: formingT, o: 1, h: 2, l: 0.5, c: 1.5, v: 0 }]);
    const before = calls.td.length;
    const first = await getCandles(raw, "4H");
    assert.equal(first.body.bars.at(-1).c, 1.5);

    setHub("4H", [{ t: formingT, o: 1, h: 2.5, l: 0.5, c: 2.25, v: 0 }]);
    const second = await getCandles(raw, "4H");
    assert.equal(calls.td.length - before, 1, "second request served from the history cache, no new REST call");
    assert.equal(second.body.bars.at(-1).c, 2.25, "live close is fresh");
    assert.equal(second.body.bars.at(-1).h, 2.5);
    assert.equal(second.body.bars.length, 31);
  });

  it("refresh=1 bypasses the history cache", async () => {
    const [raw, tdSym] = nextPair();
    setTd(tdSym, "1D", series("1D", 30, prevBucket(bucketStart(NOW, "1D"), "1D")));
    const before = calls.td.length;
    await getCandles(raw, "1D");
    await getCandles(raw, "1D", "&refresh=1");
    assert.equal(calls.td.length - before, 2);
  });

  it("no artificial REST throttle or credit cap: 24 distinct symbols fetched concurrently all hit REST", async () => {
    const syms = ["AAPL", "MSFT", "GOOG", "AMZN", "META", "NVDA", "TSLA", "NFLX", "AMD", "INTC", "ORCL", "IBM", "CSCO", "ADBE", "CRM", "PYPL", "QCOM", "TXN", "AVGO", "UBER", "SHOP", "SNOW", "PLTR", "COIN"];
    for (const s of syms) setTd(s, "15m", series("15m", 20, prevBucket(bucketStart(NOW, "15m"), "15m")));
    const before = calls.td.length;
    const results = await Promise.all(
      syms.map((s) => worker.fetch(new Request(`https://x.test/api/candles?symbol=${s}&interval=15m&mkt=STK`), env, ctx))
    );
    await settle();
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(calls.td.length - before, syms.length);
  });
});

describe("custom timeframes: fetched from a native REST base and resampled in the backend", () => {
  const expectResample = (baseBars, tf) => rollup(baseBars, tf);

  it("3m is built from 1m REST bars (not requested as '3min'), with the live forming bucket on top", async () => {
    const [raw, tdSym] = nextPair();
    const forming1m = bucketStart(NOW, "1m");
    const base = series("1m", 600, forming1m);
    setTd(tdSym, "1m", base.slice(0, -2));
    setHub("1m", base.slice(-2).map((b) => ({ ...b, v: 0 })));
    const before = calls.td.length;
    const { res, body } = await getCandles(raw, "3m");
    assert.equal(res.status, 200);
    assert.equal(body.interval, "3m");
    assert.equal(calls.td.at(-1).interval, "1min");
    assert.equal(calls.td.length - before, 1);
    assert.ok(body.bars.length >= 190);
    assertAscendingUnique(body.bars);
    for (const b of body.bars) assert.equal(b.t % 180, 0);
    const want = expectResample(base, "3m");
    const mid = want[Math.floor(want.length / 2)];
    const got = body.bars.find((b) => b.t === mid.t);
    assert.ok(got, "middle bucket present");
    assert.equal(got.o, mid.o);
    assert.equal(got.h, mid.h);
    assert.equal(got.l, mid.l);
    assert.equal(got.c, mid.c);
    assert.equal(got.v, 30);
    assert.equal(body.bars.at(-1).t, bucketStart(NOW, "3m"), "forming 3m bar present");
    assert.equal(body.bars.at(-1).c, base.at(-1).c, "forming 3m close follows the live 1m close");
  });

  for (const [tf, baseKey, tdIv] of [["45m", "15m", "15min"], ["2H", "1H", "1h"], ["12H", "4H", "4h"], ["2D", "1D", "1day"], ["3M", "1M", "1month"]]) {
    it(`${tf}: REST base ${baseKey} (${tdIv}), buckets aligned to the custom step`, async () => {
      const [raw, tdSym] = nextPair();
      const forming = bucketStart(NOW, baseKey);
      const count = baseKey === "1M" ? 48 : 400;
      const baseBars = series(baseKey, count, prevBucket(forming, baseKey));
      setTd(tdSym, baseKey, baseBars);
      setHub(baseKey, [mkBar(forming)]);
      const { res, body } = await getCandles(raw, tf);
      assert.equal(res.status, 200);
      assert.equal(body.interval, tf);
      assert.equal(calls.td.at(-1).interval, tdIv);
      assertAscendingUnique(body.bars);
      for (const b of body.bars) assert.equal(b.t, bucketStart(b.t, tf), `${tf} bar ${b.t} is bucket-aligned`);
      assert.equal(body.bars.at(-1).t, bucketStart(NOW, tf));
      const step = resolveInterval(tf).step;
      assert.ok(body.bars.length < baseBars.length, `${tf} aggregates ${baseKey} bars`);
      assert.ok(step > INTERVAL_SECONDS[baseKey]);
    });
  }

  it("3M buckets are calendar quarters", async () => {
    const [raw, tdSym] = nextPair();
    const forming = bucketStart(NOW, "1M");
    setTd(tdSym, "1M", series("1M", 36, prevBucket(forming, "1M")));
    setHub("1M", [mkBar(forming)]);
    const { body } = await getCandles(raw, "3M");
    for (const b of body.bars) assert.equal(new Date(b.t * 1000).getUTCMonth() % 3, 0);
  });
});

describe("/api/candles through the Pages Function (production path with MARKET_SERVICE)", () => {
  it("5m: hub has 1 bar -> REST history is merged in; no more '1 candle' charts", async () => {
    const [raw, tdSym] = nextPair();
    const formingT = bucketStart(NOW, "5m");
    setTd(tdSym, "5m", series("5m", 40, prevBucket(formingT, "5m")));
    setHub("5m", [{ t: formingT, o: 1, h: 2, l: 0.5, c: 1.4, v: 0 }]);
    const res = await onApiRequest({
      request: new Request(`https://vektorterminal.com/api/candles?symbol=${raw}&interval=5m&mkt=FX&limit=500`),
      env,
      waitUntil: ctx.waitUntil,
    });
    await settle();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.bars.length, 41);
    assert.equal(body.bars.at(-1).c, 1.4);
    assert.ok(res.headers.get("x-provenance"));
  });

  it("REST unavailable: falls back to the hub-only response instead of failing", async () => {
    const [raw] = nextPair();
    world.tdFail = true;
    const formingT = bucketStart(NOW, "1H");
    setHub("1H", [mkBar(formingT)]);
    try {
      const res = await onApiRequest({
        request: new Request(`https://vektorterminal.com/api/candles?symbol=${raw}&interval=1H&mkt=FX&limit=100`),
        env,
        waitUntil: ctx.waitUntil,
      });
      await settle();
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.source, "market-service");
      assert.equal(body.bars.length, 1);
    } finally {
      world.tdFail = false;
    }
  });

  it("custom 2H goes through the same path and returns aggregated history", async () => {
    const [raw, tdSym] = nextPair();
    const forming = bucketStart(NOW, "1H");
    setTd(tdSym, "1H", series("1H", 120, prevBucket(forming, "1H")));
    setHub("1H", [mkBar(forming)]);
    const res = await onApiRequest({
      request: new Request(`https://vektorterminal.com/api/candles?symbol=${raw}&interval=2H&mkt=FX`),
      env,
      waitUntil: ctx.waitUntil,
    });
    await settle();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.interval, "2H");
    assert.ok(body.bars.length >= 60);
    for (const b of body.bars) assert.equal(b.t % 7200, 0);
  });
});
