// tests/screener-server.test.mjs — Proves server-side screener & heatmap parity with client math,
// verifies { source, asOf } on every row/tile, and enforces zero synthetic/simulated output.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  buildHeatmap,
  buildScreenerSnapshot,
  calc,
  calcMat,
  cc,
  emaArr,
  evcHas,
  hmChg,
  hmRange,
  hmTradedValue,
  hmVal,
  hmWeight,
  isForbiddenSource,
  ma,
  passesPreset,
  scoreMarket,
  scoreSymbol,
  sxAdr,
  sxPct,
  sxTier,
} from "../shared/market/screener.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.resolve(__dirname, "..", "index.html");

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

// Extract exact client function definitions from index.html so parity is proven against the real baseline.
function extractFn(src, name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`Could not find ${marker} in index.html`);
  const braceStart = src.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function ${name} in index.html`);
}

function loadClientReference(fixtureBySymbol) {
  const html = fs.readFileSync(INDEX_PATH, "utf8");
  const emaLine = html.match(/const emaArr=\(a,len\)=>[^\r\n]+/);
  if (!emaLine) throw new Error("Could not find emaArr in index.html");

  const fns = [
    "cc", "ma", "calc", "scoreSymbol", "scoreMarket", "passesPreset",
    "sxTier", "sxPct", "sxAdr", "hmTradedValue", "hmChg", "hmVal", "hmRange",
  ].map((n) => extractFn(html, n));

  const sandbox = {
    S: { evcTf: "H", dir: "long", hm: { mkt: "ALL", tf: "1D", metric: "chg", size: "value", n: 60, range: "auto" } },
    LT: {},
    MAC: new Map(),
    isLive: () => true,
    hmCfg: () => sandbox.S.hm,
    candles: (s, tf) => {
      const rec = fixtureBySymbol[s[0]];
      return rec && rec.bars ? (rec.bars[tf] || null) : null;
    },
    Math, Number, Array, Object, Map, Set, String, Boolean, isFinite,
  };

  vm.createContext(sandbox);
  vm.runInContext(`${emaLine[0]}\nglobalThis.emaArr = emaArr;\n${fns.join("\n")}`, sandbox);
  return sandbox;
}

// Deterministic recorded-bar fixture builder (representing real OHLCV history across TFs).
function makeBarSeries({ count, startTs, stepSec, startClose, driftPerBar, waveAmp, wavePeriod, baseVol, volBoostTail = 1 }) {
  const bars = [];
  let prev = startClose;
  for (let i = 0; i < count; i++) {
    const wave = Math.sin((i / wavePeriod) * Math.PI * 2) * waveAmp;
    const o = prev;
    const c = Math.max(0.01, o * (1 + driftPerBar + wave));
    const spread = Math.max(Math.abs(c - o) * 0.6, c * 0.006);
    const h = Math.max(o, c) + spread;
    const l = Math.max(0.005, Math.min(o, c) - spread * 0.8);
    const v = baseVol * (i >= count - 20 ? volBoostTail : 1);
    bars.push({
      t: startTs + i * stepSec,
      o: Number(o.toFixed(6)),
      h: Number(h.toFixed(6)),
      l: Number(l.toFixed(6)),
      c: Number(c.toFixed(6)),
      v: Number(v.toFixed(2)),
    });
    prev = bars[bars.length - 1].c;
  }
  return bars;
}

const BASE_TS = 1700000000;

function buildFixtures() {
  // 1. BTCUSDT: Strong bullish expansion (passes P1 long, Expansion phase, volRatio > 1.5)
  const btc1D = makeBarSeries({ count: 80, startTs: BASE_TS - 80 * 86400, stepSec: 86400, startClose: 52000, driftPerBar: 0.0085, waveAmp: 0.002, wavePeriod: 11, baseVol: 12000, volBoostTail: 2.1 });
  const btc1H = makeBarSeries({ count: 60, startTs: BASE_TS - 60 * 3600, stepSec: 3600, startClose: 90000, driftPerBar: 0.0032, waveAmp: 0.001, wavePeriod: 9, baseVol: 900 });
  const btc4H = makeBarSeries({ count: 50, startTs: BASE_TS - 50 * 14400, stepSec: 14400, startClose: 85000, driftPerBar: 0.004, waveAmp: 0.001, wavePeriod: 7, baseVol: 3600 });
  const btc1W = makeBarSeries({ count: 40, startTs: BASE_TS - 40 * 604800, stepSec: 604800, startClose: 45000, driftPerBar: 0.015, waveAmp: 0.004, wavePeriod: 8, baseVol: 70000 });
  const btc15m = makeBarSeries({ count: 50, startTs: BASE_TS - 50 * 900, stepSec: 900, startClose: 95000, driftPerBar: 0.0018, waveAmp: 0.0005, wavePeriod: 8, baseVol: 250 });
  const btc1m = makeBarSeries({ count: 40, startTs: BASE_TS - 40 * 60, stepSec: 60, startClose: 99000, driftPerBar: 0.0016, waveAmp: 0.0003, wavePeriod: 6, baseVol: 40 });

  // 2. AAPL: Moderate bullish accumulation (small positive chg20, EMA aligned)
  const aapl1D = makeBarSeries({ count: 70, startTs: BASE_TS - 70 * 86400, stepSec: 86400, startClose: 180, driftPerBar: 0.0014, waveAmp: 0.0006, wavePeriod: 13, baseVol: 45000000 });
  const aapl1H = makeBarSeries({ count: 50, startTs: BASE_TS - 50 * 3600, stepSec: 3600, startClose: 195, driftPerBar: 0.0006, waveAmp: 0.0003, wavePeriod: 10, baseVol: 5000000 });
  const aapl4H = makeBarSeries({ count: 40, startTs: BASE_TS - 40 * 14400, stepSec: 14400, startClose: 192, driftPerBar: 0.0008, waveAmp: 0.0004, wavePeriod: 9, baseVol: 16000000 });
  const aapl1W = makeBarSeries({ count: 30, startTs: BASE_TS - 30 * 604800, stepSec: 604800, startClose: 175, driftPerBar: 0.003, waveAmp: 0.001, wavePeriod: 7, baseVol: 210000000 });

  // 3. EURUSD: Strong bearish distribution (passes P1 short, Distribution phase)
  const eur1D = makeBarSeries({ count: 80, startTs: BASE_TS - 80 * 86400, stepSec: 86400, startClose: 1.18, driftPerBar: -0.0055, waveAmp: 0.0008, wavePeriod: 12, baseVol: 80000, volBoostTail: 1.8 });
  const eur1H = makeBarSeries({ count: 60, startTs: BASE_TS - 60 * 3600, stepSec: 3600, startClose: 1.07, driftPerBar: -0.0022, waveAmp: 0.0005, wavePeriod: 8, baseVol: 4000 });
  const eur4H = makeBarSeries({ count: 40, startTs: BASE_TS - 40 * 14400, stepSec: 14400, startClose: 1.09, driftPerBar: -0.003, waveAmp: 0.0005, wavePeriod: 8, baseVol: 14000 });
  const eur1W = makeBarSeries({ count: 35, startTs: BASE_TS - 35 * 604800, stepSec: 604800, startClose: 1.21, driftPerBar: -0.007, waveAmp: 0.001, wavePeriod: 9, baseVol: 320000 });
  const eur15m = makeBarSeries({ count: 50, startTs: BASE_TS - 50 * 900, stepSec: 900, startClose: 1.06, driftPerBar: -0.0018, waveAmp: 0.0003, wavePeriod: 7, baseVol: 1200 });
  const eur1m = makeBarSeries({ count: 40, startTs: BASE_TS - 40 * 60, stepSec: 60, startClose: 1.05, driftPerBar: -0.0016, waveAmp: 0.0002, wavePeriod: 6, baseVol: 250 });

  // 4. USDJPY: Sideways chop (Range phase, P5 only)
  const jpy1D = makeBarSeries({ count: 70, startTs: BASE_TS - 70 * 86400, stepSec: 86400, startClose: 150, driftPerBar: 0.0, waveAmp: 0.003, wavePeriod: 10, baseVol: 60000 });
  const jpy1H = makeBarSeries({ count: 50, startTs: BASE_TS - 50 * 3600, stepSec: 3600, startClose: 150, driftPerBar: 0.0, waveAmp: 0.001, wavePeriod: 8, baseVol: 3000 });

  // 5. NVDA: Short history (< 50 1D bars, >= 20 bars) -> scoreSymbol returns "—", scoreMarket still scores
  const nvda1D = makeBarSeries({ count: 30, startTs: BASE_TS - 30 * 86400, stepSec: 86400, startClose: 110, driftPerBar: 0.004, waveAmp: 0.001, wavePeriod: 7, baseVol: 30000000 });
  const nvda1H = makeBarSeries({ count: 30, startTs: BASE_TS - 30 * 3600, stepSec: 3600, startClose: 122, driftPerBar: 0.002, waveAmp: 0.0005, wavePeriod: 6, baseVol: 4000000 });

  return [
    {
      symbol: "BTCUSDT", market: "CRY", price: btc1H[btc1H.length - 1].c * 1.001, volume: 42000, contractSize: 1,
      bars: { "1D": btc1D, "1H": btc1H, "4H": btc4H, "1W": btc1W, "15m": btc15m, "1m": btc1m },
      source: "twelvedata", asOf: 1700000100000,
    },
    {
      symbol: "AAPL", market: "STK", price: aapl1H[aapl1H.length - 1].c, volume: 45000000, contractSize: 1,
      bars: { "1D": aapl1D, "1H": aapl1H, "4H": aapl4H, "1W": aapl1W },
      source: "twelvedata", asOf: 1700000200000,
    },
    {
      symbol: "EURUSD", market: "FX", price: eur1H[eur1H.length - 1].c * 0.999, volume: 125000, contractSize: 100000,
      bars: { "1D": eur1D, "1H": eur1H, "4H": eur4H, "1W": eur1W, "15m": eur15m, "1m": eur1m },
      source: "dukascopy", asOf: 1700000300000,
    },
    {
      symbol: "USDJPY", market: "FX", price: jpy1H[jpy1H.length - 1].c, volume: 90000, contractSize: 100000,
      bars: { "1D": jpy1D, "1H": jpy1H },
      source: "dukascopy", asOf: 1700000400000,
    },
    {
      symbol: "NVDA", market: "STK", price: nvda1H[nvda1H.length - 1].c, volume: 35000000, contractSize: 1,
      bars: { "1D": nvda1D, "1H": nvda1H },
      source: "twelvedata", asOf: 1700000500000,
    },
  ];
}

const fixtures = buildFixtures();
const bySym = Object.fromEntries(fixtures.map((f) => [f.symbol, f]));
const client = loadClientReference(bySym);

function toClientTuple(rec) {
  // index.html SYMS tuple: [symbol, market, price, volume, contractSize, volFactor]
  return [rec.symbol, rec.market, rec.price, rec.volume, rec.contractSize ?? 1, 0.01];
}

function assertClose(actual, expected, label, eps = 1e-12) {
  if (expected == null) {
    assert.equal(actual, expected, `${label}: expected null/undefined`);
    return;
  }
  assert.equal(typeof actual, "number", `${label}: expected number, got ${typeof actual}`);
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: actual=${actual} vs expected=${expected}`);
}

await test("parity: emaArr, ma(SMA/EMA), cc(abs/bull/bear), calc match index.html bit-for-bit", () => {
  for (const rec of fixtures) {
    const tup = toClientTuple(rec);
    const closes = rec.bars["1D"].map((b) => b.c);
    const cEma = client.emaArr(closes, 20);
    const sEma = emaArr(closes, 20);
    assert.equal(sEma.length, cEma.length);
    for (let i = 0; i < cEma.length; i++) assertClose(sEma[i], cEma[i], `${rec.symbol} ema20[${i}]`);

    for (const ty of ["SMA", "EMA"]) {
      for (const len of [5, 10, 20]) {
        assertClose(ma(rec.bars["1D"], ty, len), client.ma(tup, "1D", ty, len), `${rec.symbol} ma(${ty},${len})`);
      }
    }

    const cols = [
      { type: "price" },
      { type: "vol", per: "1d" },
      { type: "dv", per: "1d" },
      { type: "pct", tf: "1D" },
      { type: "cc", tf: "1D", n: 10, mode: "abs" },
      { type: "cc", tf: "1D", n: 10, mode: "exp", dir: "bull" },
      { type: "cc", tf: "1D", n: 10, mode: "exp", dir: "bear" },
      { type: "adr", n: 14 },
      { type: "mac", tf: "1D", ma: "EMA", len: 20 },
      { type: "mac", tf: "1D", ma: "SMA", len: 10 },
    ];
    for (const col of cols) {
      assertClose(calc(rec, col), client.calc(tup, col), `${rec.symbol} calc(${col.type})`);
    }
    assertClose(cc(rec.bars["1H"], { n: 8, mode: "exp", dir: "bull" }), client.cc(tup, { tf: "1H", n: 8, mode: "exp", dir: "bull" }), `${rec.symbol} cc(1H)`);

    const matRes = calcMat(rec, { tfs: ["1H", "1D"], ma: "EMA", len: 20 });
    assert.equal(matRes.sq.length, 2);
    assert.equal(matRes.count, matRes.sq.filter((x) => x === true).length);
  }
});

await test("parity: scoreSymbol (cycle score, phase, dir, chg), sxPct, sxAdr match index.html", () => {
  for (const rec of fixtures) {
    const tup = toClientTuple(rec);
    const cSym = client.scoreSymbol(tup);
    const sSym = scoreSymbol(rec);
    assertClose(sSym.score, cSym.score, `${rec.symbol} scoreSymbol.score`);
    assert.equal(sSym.phase, cSym.phase, `${rec.symbol} scoreSymbol.phase`);
    assert.equal(sSym.dir, cSym.dir, `${rec.symbol} scoreSymbol.dir`);
    assertClose(sSym.chg, cSym.chg, `${rec.symbol} scoreSymbol.chg`);

    assertClose(sxPct(rec), client.sxPct(tup), `${rec.symbol} sxPct`);
    assertClose(sxAdr(rec), client.sxAdr(tup), `${rec.symbol} sxAdr`);
  }

  // Verify diverse phases were actually exercised across the fixtures
  assert.equal(scoreSymbol(bySym.BTCUSDT).phase, "Expansion");
  assert.equal(scoreSymbol(bySym.EURUSD).phase, "Distribution");
  assert.equal(scoreSymbol(bySym.NVDA).phase, "—");
});

await test("parity: scoreMarket, passesPreset (P1-P5), sxTier across all EVC levels (H/M/L) & directions (long/short)", () => {
  for (const evcTf of ["H", "M", "L"]) {
    for (const dir of ["long", "short"]) {
      client.S.evcTf = evcTf;
      client.S.dir = dir;
      for (const rec of fixtures) {
        const tup = toClientTuple(rec);
        assert.equal(scoreMarket(rec, { evcTf }), client.scoreMarket(tup), `${rec.symbol} scoreMarket(${evcTf})`);
        for (const p of ["P1", "P2", "P3", "P4", "P5"]) {
          assert.equal(
            passesPreset(rec, p, { evcTf, dir }),
            client.passesPreset(tup, p),
            `${rec.symbol} passesPreset(${p},${evcTf},${dir})`
          );
        }
        assert.equal(sxTier(rec, { evcTf, dir }), client.sxTier(tup), `${rec.symbol} sxTier(${evcTf},${dir})`);
      }
    }
  }
  // Confirm BTCUSDT hits P1 long and EURUSD hits P1 short on H
  assert.equal(sxTier(bySym.BTCUSDT, { evcTf: "H", dir: "long" }), "P1");
  assert.equal(sxTier(bySym.EURUSD, { evcTf: "H", dir: "short" }), "P1");
  assert.equal(evcHas(bySym.BTCUSDT, "H"), true);
  assert.equal(evcHas(bySym.AAPL, "L"), false);
});

await test("parity: heatmap hmTradedValue, hmChg (1H/4H/1D/1W), hmVal (chg/mom/score), hmRange match index.html", () => {
  client.S.evcTf = "H";
  client.S.dir = "long";

  for (const rec of fixtures) {
    const tup = toClientTuple(rec);
    assertClose(hmTradedValue(rec), client.hmTradedValue(tup), `${rec.symbol} hmTradedValue`);
    for (const tf of ["1H", "4H", "1D", "1W"]) {
      assertClose(hmChg(rec.bars[tf], rec.price), client.hmChg(tup, tf), `${rec.symbol} hmChg(${tf})`);
    }
  }

  for (const metric of ["chg", "mom", "score"]) {
    for (const tf of ["1H", "4H", "1D", "1W"]) {
      client.S.hm.metric = metric;
      client.S.hm.tf = tf;
      client.S.hm.range = "auto";
      const sVals = [];
      const cVals = [];
      for (const rec of fixtures) {
        const tup = toClientTuple(rec);
        const sv = hmVal(rec, { metric, tf, evcTf: "H" });
        const cv = client.hmVal(tup);
        assertClose(sv, cv, `${rec.symbol} hmVal(${metric},${tf})`);
        sVals.push(sv);
        cVals.push(cv);
      }
      assertClose(hmRange(sVals, { metric, range: "auto" }), client.hmRange(cVals), `hmRange(${metric},${tf})`);
    }
  }

  // Weight monotonicity: equal=1, value grows with traded value
  assert.equal(hmWeight(bySym.BTCUSDT, "equal"), 1);
  assert.ok(hmWeight(bySym.AAPL, "value") > hmWeight(bySym.USDJPY, "value"));
});

await test("zero-simulation enforcement: omits missing bars & rejects edge+sim / synthetic sources", () => {
  assert.equal(isForbiddenSource("edge+sim"), true);
  assert.equal(isForbiddenSource("sim"), true);
  assert.equal(isForbiddenSource("synthetic"), true);
  assert.equal(isForbiddenSource("mock-feed"), true);
  assert.equal(isForbiddenSource(""), true);
  assert.equal(isForbiddenSource(null), true);
  assert.equal(isForbiddenSource("twelvedata"), false);
  assert.equal(isForbiddenSource("dukascopy"), false);

  const mixed = [
    ...fixtures,
    // No bars at all -> MUST be omitted, never simulated
    { symbol: "GHOST1", market: "FX", price: 1.25, volume: 1000, bars: {}, source: "twelvedata", asOf: 1700000900000 },
    // Empty arrays -> MUST be omitted
    { symbol: "GHOST2", market: "STK", price: 50, volume: 1000, bars: { "1D": [], "1H": [] }, source: "twelvedata", asOf: 1700000900000 },
    // Invalid/zero-price bars -> MUST be omitted
    { symbol: "GHOST3", market: "STK", price: 50, bars: { "1D": [[1700000000, 0, 0, 0, 0, 0]] }, source: "twelvedata", asOf: 1700000900000 },
    // Legacy synthetic source "edge+sim" -> MUST be rejected
    { symbol: "FAKE1", market: "FX", price: 1.1, bars: { "1D": bySym.EURUSD.bars["1D"] }, source: "edge+sim", asOf: 1700000900000 },
    // Explicit synthetic flag -> MUST be rejected
    { symbol: "FAKE2", market: "CRY", price: 90000, bars: { "1D": bySym.BTCUSDT.bars["1D"] }, source: "twelvedata", synthetic: true, asOf: 1700000900000 },
    // Missing source -> MUST be rejected
    { symbol: "NOSRC", market: "CRY", price: 90000, bars: { "1D": bySym.BTCUSDT.bars["1D"] }, asOf: 1700000900000 },
  ];

  const snap = buildScreenerSnapshot(mixed, { preset: "P5", evcTf: "H", dir: "long" });
  assert.equal(snap.omitted, 6, "all 6 invalid/synthetic records must be omitted");
  assert.equal(snap.total, fixtures.length);
  assert.equal(snap.rows.length, fixtures.length);
  assert.equal(snap.heatmap.tiles.length, fixtures.length);

  // Every row & tile MUST carry real { source, asOf }
  for (const row of snap.rows) {
    assert.ok(typeof row.source === "string" && row.source.length > 0, `${row.symbol} missing source`);
    assert.equal(isForbiddenSource(row.source), false, `${row.symbol} has forbidden source ${row.source}`);
    assert.ok(Number.isFinite(row.asOf) && row.asOf > 0, `${row.symbol} missing asOf`);
  }
  for (const tile of snap.heatmap.tiles) {
    assert.ok(typeof tile.source === "string" && tile.source.length > 0, `${tile.symbol} tile missing source`);
    assert.equal(isForbiddenSource(tile.source), false, `${tile.symbol} tile forbidden source`);
    assert.ok(Number.isFinite(tile.asOf) && tile.asOf > 0, `${tile.symbol} tile missing asOf`);
    assert.ok(Number.isFinite(tile.weight) && tile.weight > 0, `${tile.symbol} tile invalid weight`);
  }

  // Serialized payload must NEVER contain "edge+sim" or any omitted ghost/fake symbols
  const serialized = JSON.stringify(snap);
  assert.ok(!serialized.includes("edge+sim"), "snapshot must never contain edge+sim");
  for (const dropped of ["GHOST1", "GHOST2", "GHOST3", "FAKE1", "FAKE2", "NOSRC"]) {
    assert.ok(!serialized.includes(dropped), `dropped symbol ${dropped} leaked into snapshot`);
  }
});

await test("buildScreenerSnapshot pagination (<= 50 rows), preset filtering, and lowercase TF aliases", () => {
  // Generate 75 real-bar instruments to test pagination capping at 50 rows
  const many = [];
  for (let i = 0; i < 75; i++) {
    many.push({
      symbol: `SYM${String(i).padStart(3, "0")}`,
      market: i % 2 === 0 ? "STK" : "CRY",
      price: bySym.BTCUSDT.price,
      volume: 10000 + i * 100,
      bars: { "1d": bySym.BTCUSDT.bars["1D"], "1h": bySym.BTCUSDT.bars["1H"] }, // lowercase TF keys!
      source: "twelvedata",
      asOf: 1700001000000 + i,
    });
  }

  const p1 = buildScreenerSnapshot(many, { preset: "P1", page: 1, pageSize: 100 }); // requesting 100 must clamp to 50
  assert.equal(p1.pageSize, 50);
  assert.equal(p1.total, 75);
  assert.equal(p1.totalPages, 2);
  assert.equal(p1.page, 1);
  assert.equal(p1.rows.length, 50);
  assert.equal(p1.rows[0].tier, "P1");
  assert.equal(p1.rows[0].score, scoreMarket(bySym.BTCUSDT, { evcTf: "H" }));

  const p2 = buildScreenerSnapshot(many, { preset: "P1", page: 2, pageSize: 50 });
  assert.equal(p2.page, 2);
  assert.equal(p2.rows.length, 25);

  const hm = buildHeatmap(many, { metric: "score", n: 30, size: "value" });
  assert.equal(hm.tiles.length, 30);
  assert.equal(hm.range, 50);
  // Sorted descending by tradedValue
  assert.ok(hm.tiles[0].tradedValue >= hm.tiles[29].tradedValue);
});

console.log(`\nscreener-server.test.mjs: ${passed} passed, ${failed} failed`);
