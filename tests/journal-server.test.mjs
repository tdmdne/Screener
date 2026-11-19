// tests/journal-server.test.mjs — Task 19 parity & edge-case tests for shared/journal.js.
// Verifies exact parity against src/50_journal_logic.js and index.html VTC (tradeStats, propStatus, simChallenge),
// plus institutional analytics helpers (equityCurve, drawdownSeries, rDistribution, dailyPnlCalendar).
// Run: node tests/journal-server.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  JR_COLS,
  JR_HEAD,
  MAX_R_BUCKETS,
  MIN_R_BUCKET_SIZE,
  SIM_MAX_RUNS,
  SIM_MAX_DAYS,
  SIM_MAX_TRADES_PER_DAY,
  jrNum,
  jrPnl,
  jrRisk,
  jrR,
  jrDay,
  jrSort,
  jrClosed,
  jrStats,
  jrProp,
  jrCsvCell,
  jrToCsv,
  jrParseCsv,
  jrFromCsv,
  jrClean,
  jrDate,
  rng,
  simChallenge,
  tradeStats,
  propStatus,
  equityCurve,
  drawdownSeries,
  rDistribution,
  dailyPnlCalendar,
} from "../shared/journal.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---- Load live src/50_journal_logic.js verbatim in a clean VM ----
function loadLegacyJournalLogic() {
  const src = fs.readFileSync(path.join(ROOT, "src", "50_journal_logic.js"), "utf8");
  const code =
    src +
    "\n;({ jrNum, jrPnl, jrRisk, jrR, jrDay, jrSort, jrClosed, jrStats, jrProp, jrToday, jrCsvCell, jrToCsv, jrParseCsv, jrFromCsv, jrClean, jrDate });";
  return vm.runInContext(
    code,
    vm.createContext({ Date, Math, Number, Object, Array, String, RegExp, parseFloat, isNaN, isFinite })
  );
}

// ---- Load live index.html VTC (rng, simChallenge, tradeStats, propStatus) in a clean VM ----
function loadLegacyVTC() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const startIdx = html.indexOf("function rng(seed){");
  const endIdx = html.indexOf("return{fxSpec,pipValueUSD");
  assert.ok(startIdx > 0 && endIdx > startIdx, "Expected VTC journal/prop block in index.html");
  const code = html.slice(startIdx, endIdx) + "\n;({ rng, simChallenge, tradeStats, propStatus });";
  return vm.runInContext(
    code,
    vm.createContext({ Math, Number, Object, Array, String, isFinite })
  );
}

// Normalize objects/arrays created inside a node:vm realm to host-realm prototypes while preserving NaN/Infinity.
function fromRealm(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return Array.from(v, fromRealm);
  const out = {};
  for (const k of Object.keys(v)) out[k] = fromRealm(v[k]);
  return out;
}

const LEGACY_JR = loadLegacyJournalLogic();
const LEGACY_VTC = loadLegacyVTC();

const SAMPLE_JOURNAL_TRADES = [
  {
    id: "t1",
    sym: "ES",
    side: "long",
    qty: 2,
    entry: 5000,
    exit: 5010,
    pv: 50,
    stop: 4995,
    fees: 4,
    open: "2026-11-02T09:30",
    close: "2026-11-02T10:00",
    acct: "Eval 10k",
    setup: "ORB",
    tags: "A+",
    notes: "Clean breakout",
  },
  {
    id: "t2",
    sym: "NQ",
    side: "short",
    qty: 1,
    entry: 18000,
    exit: 18020,
    pv: 20,
    stop: 18010,
    fees: 2,
    open: "2026-11-03T09:00",
    close: "2026-11-03T10:00",
    acct: "Eval 10k",
    setup: "Fade",
    tags: "FOMO",
    notes: "",
  },
  {
    id: "t3",
    sym: "EURUSD",
    side: "long",
    pnl: -150,
    open: "2026-11-03T14:00",
    close: "2026-11-03T15:00",
    acct: "Eval 10k",
    setup: "",
    notes: "Moved stop",
  },
  {
    id: "t4",
    sym: "GC",
    side: "long",
    qty: 1,
    entry: 2650,
    exit: 2650,
    pv: 100,
    stop: 2645,
    fees: 0,
    open: "2026-11-04T08:00",
    close: "2026-11-04T08:30",
    acct: "Eval 10k",
    setup: "ORB, Pullback",
    notes: "Scratch breakeven",
  },
  // Open trade (no exit/pnl) — must be excluded from closed stats & prop rules
  {
    id: "t5",
    sym: "CL",
    side: "long",
    qty: 1,
    entry: 70,
    pv: 1000,
    stop: 69.5,
    open: "2026-11-04T09:00",
    close: "",
    acct: "Eval 10k",
  },
];

describe("Task 19: Exact parity with src/50_journal_logic.js", () => {
  it("matches jrPnl, jrRisk, jrR, jrDay, jrClosed, and jrStats identically", () => {
    for (const t of SAMPLE_JOURNAL_TRADES) {
      assert.equal(jrPnl(t), LEGACY_JR.jrPnl(t), `jrPnl(${t.id})`);
      assert.equal(jrRisk(t), LEGACY_JR.jrRisk(t), `jrRisk(${t.id})`);
      assert.equal(jrR(t), LEGACY_JR.jrR(t), `jrR(${t.id})`);
      assert.equal(jrDay(t), LEGACY_JR.jrDay(t), `jrDay(${t.id})`);
    }
    assert.deepEqual(jrClosed(SAMPLE_JOURNAL_TRADES), fromRealm(LEGACY_JR.jrClosed(SAMPLE_JOURNAL_TRADES)));

    const actual = jrStats(SAMPLE_JOURNAL_TRADES);
    const expected = fromRealm(LEGACY_JR.jrStats(SAMPLE_JOURNAL_TRADES));
    // bySetup, byDay, bySymbol are null-prototype maps to prevent prototype pollution; normalize for deep parity comparison.
    assert.equal(Object.getPrototypeOf(actual.bySetup), null);
    assert.equal(Object.getPrototypeOf(actual.byDay), null);
    assert.equal(Object.getPrototypeOf(actual.bySymbol), null);
    assert.deepEqual(fromRealm(actual), expected);

    // Sanity check hand-worked figures: +996, -402, -150, 0 -> net +444, n=4, wins=1, losses=2, be=1
    assert.equal(actual.n, 4);
    assert.equal(actual.wins, 1);
    assert.equal(actual.losses, 2);
    assert.equal(actual.be, 1);
    assert.equal(actual.net, 444);
    assert.equal(actual.maxDD, 552);
  });

  it("matches jrProp identically for static, daily breach, trailing drawdown, and passed states", () => {
    const evalAcct = { name: "Eval 10k", size: 10000, target: 10, daily: 5, maxdd: 10, mindays: 2 };
    const actualEval = jrProp(evalAcct, SAMPLE_JOURNAL_TRADES);
    const expectedEval = fromRealm(LEGACY_JR.jrProp(evalAcct, SAMPLE_JOURNAL_TRADES));
    assert.deepEqual(actualEval, expectedEval);
    assert.equal(actualEval.status, "breached");
    assert.deepEqual(actualEval.breach, { rule: "daily", day: "2026-11-03", v: 552 });

    // Trailing drawdown breach
    const trailAcct = { name: "T", size: 1000, maxdd: 5, trailing: true };
    const trailTrades = [
      { acct: "T", sym: "A", side: "long", pnl: 100, close: "2026-01-01T10:00" },
      { acct: "T", sym: "A", side: "long", pnl: -40, close: "2026-01-02T10:00" },
      { acct: "T", sym: "A", side: "long", pnl: -15, close: "2026-01-03T10:00" },
    ];
    const actualTrail = jrProp(trailAcct, trailTrades);
    const expectedTrail = fromRealm(LEGACY_JR.jrProp(trailAcct, trailTrades));
    assert.deepEqual(actualTrail, expectedTrail);
    assert.equal(actualTrail.peak, 1100);
    assert.equal(actualTrail.ddNow, 55);
    assert.equal(actualTrail.status, "breached");
    assert.equal(actualTrail.floor, 1050);

    // Passed challenge (meets target AND min trading days)
    const passAcct = { name: "P", size: 10000, target: 8, daily: 5, maxdd: 10, mindays: 2 };
    const passTrades = [
      { acct: "P", sym: "ES", side: "long", pnl: 450, close: "2026-11-01T10:00" },
      { acct: "P", sym: "ES", side: "long", pnl: 400, close: "2026-11-02T10:00" },
    ];
    assert.deepEqual(jrProp(passAcct, passTrades), fromRealm(LEGACY_JR.jrProp(passAcct, passTrades)));
    assert.equal(jrProp(passAcct, passTrades, "2026-11-02").status, "passed");
    assert.equal(jrProp(passAcct, passTrades, "2026-11-02").todayPnl, 400);
  });

  it("matches jrToCsv / jrFromCsv / jrClean / jrDate roundtrip and formula-injection guard", () => {
    const tWithFormula = [
      { ...SAMPLE_JOURNAL_TRADES[0], notes: '=HYPERLINK("x")' },
      SAMPLE_JOURNAL_TRADES[1],
    ];
    const csv = jrToCsv(tWithFormula);
    assert.equal(csv, LEGACY_JR.jrToCsv(tWithFormula));
    assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));

    const parsed = jrFromCsv(csv);
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.trades.length, 2);
    assert.equal(parsed.trades[0].notes, '=HYPERLINK("x")');
    assert.equal(jrDate("2026-02-30"), "");
    assert.equal(jrDate("2026-11-02T09:30"), "2026-11-02T09:30");
  });
});

describe("Task 19: Exact parity with index.html VTC (tradeStats, propStatus, simChallenge)", () => {
  it("tradeStats matches index.html VTC.tradeStats on mixed wins, losses, breakevens", () => {
    const vtcTrades = [
      { pnl: 500, r: 2.0, date: "2026-11-01" },
      { pnl: -250, r: -1.0, date: "2026-11-02" },
      { pnl: 0, r: 0, date: "2026-11-03" },
      { pnl: -250, r: -1.0, date: "2026-11-04" },
      { pnl: 750, r: 3.0, date: "2026-11-05" },
    ];
    const actual = tradeStats(vtcTrades, 10000);
    const expected = fromRealm(LEGACY_VTC.tradeStats(vtcTrades, 10000));

    for (const key of Object.keys(expected)) {
      assert.deepEqual(actual[key], expected[key], `tradeStats.${key}`);
    }
    assert.equal(actual.breakevens, 1);
    assert.equal(actual.wins, 2);
    assert.equal(actual.losses, 2);
    assert.equal(actual.n, 5);
    assert.equal(actual.winRate, 0.4);
  });

  it("propStatus matches index.html VTC.propStatus and detects daily & drawdown breaches", () => {
    const opts = { acct: 100000, dailyDD: 5, maxDD: 10, trailing: true, target: 8 };
    const trades = [
      { pnl: 4000, date: "2026-11-01" },
      { pnl: -3000, date: "2026-11-02" },
      { pnl: -2500, date: "2026-11-02" }, // dayPnl = -5500 >= 5000 daily limit
    ];
    const actual = propStatus(trades, opts, "2026-11-02");
    const expected = fromRealm(LEGACY_VTC.propStatus(trades, opts, "2026-11-02"));
    for (const key of Object.keys(expected)) {
      assert.deepEqual(actual[key], expected[key], `propStatus.${key}`);
    }
    assert.equal(actual.dailyBreached, true);
    assert.equal(actual.maxDDBreached, false);
    assert.equal(actual.breached, true);
    assert.equal(actual.status, "breached");
    assert.equal(actual.breach.rule, "daily");

    // Trailing drawdown breach (peak 104,000 -> floor min(94,000, 100,000)=94,000; bal drops to 93,500)
    const ddTrades = [
      { pnl: 4000, date: "2026-11-01" },
      { pnl: -4000, date: "2026-11-02" },
      { pnl: -4000, date: "2026-11-03" },
      { pnl: -2500, date: "2026-11-04" },
    ];
    const ddRes = propStatus(ddTrades, opts, "2026-11-04");
    assert.equal(ddRes.dailyBreached, false);
    assert.equal(ddRes.maxDDBreached, true);
    assert.equal(ddRes.status, "breached");
    assert.equal(ddRes.breach.rule, "drawdown");

    // Static drawdown breach
    const staticRes = propStatus(
      [
        { pnl: -4000, date: "2026-11-01" },
        { pnl: -4000, date: "2026-11-02" },
        { pnl: -2000, date: "2026-11-03" },
      ],
      { acct: 100000, dailyDD: 5, maxDD: 10, trailing: false, target: 8 },
      "2026-11-03"
    );
    assert.equal(staticRes.maxDDBreached, true);
    assert.equal(staticRes.status, "breached");
    assert.equal(staticRes.floor, 90000);
  });

  it("simChallenge matches index.html VTC.simChallenge identically with deterministic PRNG seed", () => {
    const cfgStatic = {
      acct: 100000,
      target: 8,
      maxDD: 10,
      dailyDD: 5,
      riskPct: 1,
      winRate: 0.45,
      rr: 2,
      tradesPerDay: 2,
      maxDays: 30,
      trailing: false,
      fixed: true,
      runs: 1000,
    };
    const a1 = simChallenge(cfgStatic, 1234);
    const a2 = simChallenge(cfgStatic, 1234);
    const e1 = fromRealm(LEGACY_VTC.simChallenge(cfgStatic, 1234));
    assert.deepEqual(a1, a2);
    assert.deepEqual(a1, e1);
    assert.ok(Math.abs(a1.pass + a1.failDD + a1.failDay + a1.timeout - 1) < 1e-12);

    // Trailing + compounding equity mode
    const cfgTrail = { ...cfgStatic, trailing: true, fixed: false, runs: 500 };
    assert.deepEqual(simChallenge(cfgTrail, 98765), fromRealm(LEGACY_VTC.simChallenge(cfgTrail, 98765)));

    // Different seed produces distinct stream
    const sA = rng(42);
    const sB = rng(42);
    const sC = rng(99);
    assert.equal(sA(), sB());
    assert.notEqual(sA(), sC());
  });
});

describe("Task 19: Edge cases (empty trades, all breakevens, all wins, open trades)", () => {
  it("handles empty trade lists cleanly across all functions", () => {
    const ts = tradeStats([], 10000);
    assert.equal(ts.n, 0);
    assert.equal(ts.wins, 0);
    assert.equal(ts.losses, 0);
    assert.equal(ts.breakevens, 0);
    assert.equal(ts.winRate, 0);
    assert.equal(ts.net, 0);
    assert.equal(ts.profitFactor, 0);
    assert.equal(ts.balance, 10000);
    assert.deepEqual(ts.equity, [10000]);

    const js = jrStats([]);
    assert.equal(js.n, 0);
    assert.equal(js.winRate, null);
    assert.equal(js.pf, null);
    assert.equal(js.avgR, null);

    const ps = propStatus([], { acct: 50000, dailyDD: 5, maxDD: 10, target: 8 }, "2026-11-01");
    assert.equal(ps.balance, 50000);
    assert.equal(ps.status, "active");
    assert.equal(ps.breached, false);

    assert.deepEqual(equityCurve([], 10000), []);
    const dd = drawdownSeries([], 10000);
    assert.deepEqual(dd.points, []);
    assert.equal(dd.maxDD, 0);
    assert.equal(dd.longestUnderwaterBars, 0);

    const rd = rDistribution([]);
    assert.equal(rd.count, 0);
    assert.equal(rd.mean, null);
    assert.deepEqual(rd.buckets, []);

    const cal = dailyPnlCalendar([]);
    assert.equal(cal.tradingDays, 0);
    assert.equal(cal.totalPnl, 0);
    assert.deepEqual(cal.days, []);
  });

  it("handles breakeven-only trades and open trades without dividing by zero or counting open positions", () => {
    const trades = [
      { pnl: 0, r: 0, date: "2026-11-01" },
      { pnl: 0, r: 0, date: "2026-11-02" },
      { sym: "CL", side: "long", qty: 1, entry: 70, exit: null, pnl: null, open: "2026-11-03" },
    ];
    const ts = tradeStats(trades, 10000);
    assert.equal(ts.n, 2);
    assert.equal(ts.wins, 0);
    assert.equal(ts.losses, 0);
    assert.equal(ts.breakevens, 2);
    assert.equal(ts.winRate, 0);
    assert.equal(ts.profitFactor, 0);
    assert.equal(ts.expectancy, 0);
    assert.equal(ts.balance, 10000);

    // All-wins gives Infinity profitFactor
    const allWins = tradeStats([{ pnl: 100 }, { pnl: 250 }], 1000);
    assert.equal(allWins.profitFactor, Infinity);
    assert.equal(allWins.winRate, 1);
  });
});

describe("Task 19: Institutional analytics helpers (equityCurve, drawdownSeries, rDistribution, dailyPnlCalendar)", () => {
  const trades = [
    { pnl: 400, r: 2.0, date: "2026-11-01" },
    { pnl: -200, r: -1.0, date: "2026-11-02" },
    { pnl: -100, r: -0.5, date: "2026-11-02" },
    { pnl: 0, r: 0.0, date: "2026-11-03" },
    { pnl: 500, r: 2.5, date: "2026-11-04" },
    { pnl: -150, r: -0.75, date: "2026-12-01" },
  ];

  it("equityCurve produces chronological cumulative equity, peak, and drawdown", () => {
    // Deliberately pass out-of-order trades to verify chronological sorting
    const shuffled = [trades[4], trades[0], trades[2], trades[1], trades[5], trades[3]];
    const ec = equityCurve(shuffled, 10000);
    assert.equal(ec.length, 6);
    assert.deepEqual(
      ec.map((p) => p.equity),
      [10400, 10300, 10100, 10100, 10600, 10450]
    );
    assert.equal(ec[2].peak, 10400);
    assert.equal(ec[2].drawdown, 300);
    assert.ok(Math.abs(ec[2].drawdownPct - 300 / 10400) < 1e-12);
    assert.equal(ec[4].drawdown, 0);
  });

  it("drawdownSeries tracks maxDD, peak/trough/recovery indices, and underwater duration", () => {
    const dd = drawdownSeries(trades, 10000);
    assert.equal(dd.points.length, 6);
    assert.equal(dd.maxDD, 300);
    assert.equal(dd.maxDDPeakIndex, 0);
    assert.equal(dd.maxDDTroughIndex, 2);
    assert.equal(dd.maxDDRecoveryIndex, 4); // recovered on +500 trade to 10,600
    assert.equal(dd.longestUnderwaterBars, 3); // indices 1, 2, 3 all below 10,400 peak
    assert.equal(dd.currentDD, 150);
  });

  it("rDistribution computes summary stats, SQN, and histogram buckets summing to 100%", () => {
    const rd = rDistribution(trades, { bucketSize: 1.0 });
    assert.equal(rd.count, 6);
    assert.equal(rd.min, -1.0);
    assert.equal(rd.max, 2.5);
    assert.equal(rd.positiveCount, 2);
    assert.equal(rd.negativeCount, 3);
    assert.equal(rd.zeroCount, 1);
    assert.ok(Math.abs(rd.mean - (2 - 1 - 0.5 + 0 + 2.5 - 0.75) / 6) < 1e-12);
    assert.equal(rd.median, -0.25); // sorted [-1, -0.75, -0.5, 0, 2, 2.5] -> avg(-0.5, 0)
    assert.ok(rd.stdev > 0);
    assert.ok(rd.sqn != null && Number.isFinite(rd.sqn));
    const totalCount = rd.buckets.reduce((s, b) => s + b.count, 0);
    const totalPct = rd.buckets.reduce((s, b) => s + b.pct, 0);
    assert.equal(totalCount, 6);
    assert.ok(Math.abs(totalPct - 1) < 1e-12);
  });

  it("dailyPnlCalendar aggregates daily totals and supports month/year filtering", () => {
    const all = dailyPnlCalendar(trades);
    assert.equal(all.tradingDays, 5);
    assert.equal(all.greenDays, 2);
    assert.equal(all.redDays, 2);
    assert.equal(all.flatDays, 1);
    assert.equal(all.totalPnl, 450);
    assert.equal(all.bestDay.date, "2026-11-04");
    assert.equal(all.bestDay.pnl, 500);
    assert.equal(all.worstDay.date, "2026-11-02");
    assert.equal(all.worstDay.pnl, -300);
    assert.equal(all.byDay["2026-11-02"].trades, 2);

    const novOnly = dailyPnlCalendar(trades, { month: "2026-11" });
    assert.equal(novOnly.tradingDays, 4);
    assert.equal(novOnly.totalPnl, 600);
  });

  it("shared/journal.js has zero DOM or Node API dependencies", () => {
    const text = fs.readFileSync(path.join(ROOT, "shared", "journal.js"), "utf8");
    assert.doesNotMatch(text, /\b(document|window|localStorage)\b/);
    assert.doesNotMatch(text, /from\s+["']node:/);
  });
});

describe("Security & DoS hardening regressions (prototype pollution, DoS bounds, invalid dates)", () => {
  it("prevents prototype pollution when setup/symbol is __proto__, constructor, or toString", () => {
    const hostileTrades = [
      { sym: "__proto__", side: "long", pnl: 250, close: "2026-11-02T10:00", setup: "__proto__, constructor, toString", acct: "Eval" },
      { sym: "constructor", side: "short", pnl: -100, close: "2026-11-03T10:00", setup: "__proto__", acct: "Eval" },
    ];
    const stats = jrStats(hostileTrades);
    assert.equal(Object.getPrototypeOf(stats.bySetup), null);
    assert.equal(Object.getPrototypeOf(stats.byDay), null);
    assert.equal(Object.getPrototypeOf(stats.bySymbol), null);
    assert.equal(stats.bySetup["__proto__"].n, 2);
    assert.equal(stats.bySetup["__proto__"].net, 150);
    assert.equal(stats.bySetup.constructor.n, 1);
    assert.equal(stats.bySetup.toString.n, 1);
    assert.equal(stats.bySymbol["__PROTO__"].n, 1);
    assert.equal(({}).n, undefined, "Object.prototype must never be polluted");
    assert.equal(({}).net, undefined, "Object.prototype must never be polluted");

    const prop = jrProp({ name: "Eval", size: 10000, target: 10, daily: 5, maxdd: 10 }, hostileTrades, "2026-11-03");
    assert.equal(prop.n, 2);
    assert.equal(prop.profit, 150);
  });

  it("caps rDistribution buckets at MAX_R_BUCKETS (200) and minimum bucketSize >= 0.05 on extreme outliers", () => {
    assert.equal(MAX_R_BUCKETS, 200);
    assert.equal(MIN_R_BUCKET_SIZE, 0.05);
    const outlierTrades = [
      { pnl: -100, r: -1.0, date: "2026-11-01" },
      { pnl: 200, r: 2.0, date: "2026-11-02" },
      { pnl: 1e11, r: 1e9, date: "2026-11-03" },
    ];
    const t0 = Date.now();
    const rd = rDistribution(outlierTrades, { bucketSize: 0.5 });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 100, `rDistribution outlier must run fast, took ${elapsed} ms`);
    assert.equal(rd.count, 3);
    assert.ok(rd.buckets.length > 0 && rd.buckets.length <= MAX_R_BUCKETS);
    assert.equal(rd.buckets.reduce((s, b) => s + b.count, 0), 3);
    assert.ok(Math.abs(rd.buckets.reduce((s, b) => s + b.pct, 0) - 1) < 1e-12);

    // Tiny bucketSize below 0.05 must be clamped cleanly
    const rdTiny = rDistribution(
      [{ pnl: -100, r: -1 }, { pnl: 100, r: 1 }],
      { bucketSize: 1e-9 }
    );
    assert.ok(rdTiny.buckets.length <= MAX_R_BUCKETS);
    assert.equal(rdTiny.buckets.reduce((s, b) => s + b.count, 0), 2);
  });

  it("caps simChallenge runs (<= 2000), maxDays (<= 1000), and tradesPerDay (<= 50) on huge args", () => {
    assert.equal(SIM_MAX_RUNS, 2000);
    assert.equal(SIM_MAX_DAYS, 1000);
    assert.equal(SIM_MAX_TRADES_PER_DAY, 50);

    const t0 = Date.now();
    const res = simChallenge(
      {
        acct: 100000,
        target: 8,
        maxDD: 10,
        dailyDD: 5,
        riskPct: 1,
        winRate: 0.45,
        rr: 2,
        tradesPerDay: 1e9,
        maxDays: 1e9,
        runs: 1e9,
      },
      42
    );
    const elapsed = Date.now() - t0;
    assert.equal(res.runs, SIM_MAX_RUNS);
    assert.ok(Math.abs(res.pass + res.failDD + res.failDay + res.timeout - 1) < 1e-12);
    assert.ok(elapsed < 500, `simChallenge huge args must stay bounded, took ${elapsed} ms`);
  });

  it("rejects impossible calendar dates like 2026-13-45 without crashing byWeekday", () => {
    assert.equal(jrDate("2026-13-45"), "");
    assert.equal(jrDay({ close: "2026-13-45", pnl: 100 }), null);
    assert.equal(jrDay({ close: "2026-02-30", pnl: 100 }), null);

    const mixed = [
      { sym: "ES", side: "long", pnl: 500, close: "2026-13-45", setup: "ORB" },
      { sym: "NQ", side: "long", pnl: 300, close: "2026-02-30", setup: "ORB" },
      { sym: "GC", side: "long", pnl: 200, close: "2026-11-02T10:00", setup: "ORB" }, // Monday (UTC day 1)
    ];
    const stats = jrStats(mixed);
    assert.equal(stats.n, 1);
    assert.equal(stats.net, 200);
    assert.equal(stats.byWeekday[1].n, 1);
    assert.equal(stats.byWeekday[1].net, 200);
    assert.equal(stats.byWeekday.reduce((s, d) => s + d.n, 0), 1);

    const cal = dailyPnlCalendar(mixed);
    assert.equal(cal.tradingDays, 1);
    assert.equal(cal.totalPnl, 200);
  });
});
