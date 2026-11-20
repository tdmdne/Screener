// Tasks 9/11: `GET /api/candles?...&ind=` returns history AND server-computed indicator series in one response.
// REST history (worker.js) is forced down so the hub-only path (MARKET_SERVICE /api/bars) serves the bars.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/[[path]].js";
import { ema, sma } from "../shared/market/indicators.js";
import { PROVENANCE } from "../shared/protocol.js";

function makeBars(n, step = 3600, t0 = 1763400000) {
  const out = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    const c = Number((px + Math.sin(i / 5) * 1.2).toFixed(5));
    out.push({ t: t0 + i * step, o: px, h: Math.max(px, c) + 0.5, l: Math.min(px, c) - 0.5, c, v: 10 + i });
    px = c;
  }
  return out;
}

async function withHubOnly(allBars, fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 500 });
  const seen = [];
  const env = {
    MARKET_SERVICE: {
      async fetch(req) {
        const u = new URL(req.url);
        seen.push(u.pathname + u.search);
        if (u.pathname !== "/api/bars") return new Response("{}", { status: 500 });
        const limit = Number(u.searchParams.get("limit")) || 500;
        return Response.json({ ok: true, bars: allBars.slice(-limit), hasMore: true, provenance: PROVENANCE.LIVE });
      },
    },
  };
  try {
    return await fn(env, seen);
  } finally {
    globalThis.fetch = realFetch;
  }
}

const call = (env, qs) => onRequest({ request: new Request(`https://vektorterminal.com/api/candles?${qs}`), env });

describe("/api/candles with ind=", () => {
  it("returns `limit` bars plus fully warmed server indicator series in one request", async () => {
    const all = makeBars(400);
    await withHubOnly(all, async (env, seen) => {
      const res = await call(env, "symbol=EURUSD&interval=1H&mkt=FX&limit=200&ind=sma:20,ema:10,bb:20:2,rsi:14");
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.bars.length, 200);
      // Upstream was asked for limit + warm-up (rsi:14 -> 56 bars, the largest here).
      assert.ok(seen.includes("/api/bars?sym=EUR%2FUSD&tf=1h&limit=256"), seen.join(" | "));

      const fetched = all.slice(-256);
      const closes = fetched.map((b) => b.c);
      const fullSma = sma(closes, 20);
      const fullEma = ema(closes, 10);
      assert.equal(data.ind["sma:20"].points.length, 200);
      assert.equal(data.ind["ema:10"].points.length, 200);
      assert.equal(data.ind["rsi:14"].points.length, 200);
      assert.equal(data.ind["bb:20:2"].upper.length, 200);
      for (let i = 0; i < 200; i++) {
        assert.equal(data.ind["sma:20"].points[i].t, data.bars[i].t);
        assert.ok(Math.abs(data.ind["sma:20"].points[i].v - fullSma[56 + i]) < 1e-9);
        assert.ok(Math.abs(data.ind["ema:10"].points[i].v - fullEma[56 + i]) < 1e-9);
      }
    });
  });

  it("passes requests without ind through unchanged", async () => {
    await withHubOnly(makeBars(50), async (env, seen) => {
      const res = await call(env, "symbol=BTCUSDT&interval=1D&limit=50");
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ind, undefined);
      assert.equal(data.bars.length, 50);
      assert.ok(seen.includes("/api/bars?sym=BTC%2FUSD&tf=1d&limit=50"));
    });
  });

  it("rejects invalid indicator specs with 400 JSON", async () => {
    await withHubOnly(makeBars(50), async (env) => {
      const res = await call(env, "symbol=BTCUSDT&interval=1D&limit=50&ind=ema:0");
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.match(data.error, /invalid indicator spec/);
    });
  });

  it("keeps short histories whole instead of dropping them as warm-up", async () => {
    await withHubOnly(makeBars(30), async (env) => {
      const res = await call(env, "symbol=BTCUSDT&interval=1D&limit=100&ind=sma:50");
      const data = await res.json();
      assert.equal(data.bars.length, 30);
      assert.deepEqual(data.ind["sma:50"].points, []);
    });
  });
});
