// tests/alerts-server.test.mjs — Task 17 server-side alert evaluator tests.
// Verifies tick & closed-bar evaluation (above, below, cross_up, cross_down, cross, % move),
// once-disarm + re-arm, recurring cooldown, crossing while tab is closed + snapshot/restore,
// clean per-symbol prevPrice tracking, and strict Protocol v2 `alert` frame validity.
// Run: node tests/alerts-server.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ALERT_CONDITIONS,
  DEFAULT_COOLDOWN_MS,
  buildAlertFrame,
  createAlertEvaluator,
  evaluateAlertCondition,
  normalizeAlert,
  normalizeAlertBar,
  normalizeCondition,
} from "../shared/alerts.js";
import {
  MAX_LIVE_FRAME_BYTES,
  PROTOCOL_VERSION,
  checkLiveFrameBudget,
  validateServerFrame,
} from "../shared/protocol.js";

const T0 = 1_763_500_000_000; // deterministic base epoch ms

describe("shared/alerts.js — normalization & schema", () => {
  it("normalizes condition aliases including '% move' and legacy index.html alerts", () => {
    assert.equal(normalizeCondition("above"), "above");
    assert.equal(normalizeCondition("below"), "below");
    assert.equal(normalizeCondition("cross_up"), "cross_up");
    assert.equal(normalizeCondition("Crossing Up"), "cross_up");
    assert.equal(normalizeCondition("cross_down"), "cross_down");
    assert.equal(normalizeCondition("cross"), "cross");
    assert.equal(normalizeCondition("% move"), "pct_move");
    assert.equal(normalizeCondition("pct_move"), "pct_move");
    assert.equal(normalizeCondition("pct_up"), "pct_up");
    assert.equal(normalizeCondition("pct_down"), "pct_down");
    assert.equal(normalizeCondition("invalid_op"), null);

    // Legacy index.html shape: numeric id, dir, price, msg
    const legacy = normalizeAlert(
      { id: 1732000000123, sym: " btcusdt ", price: 95000, dir: "cross", on: true, fired: false, msg: "Breakout!" },
      T0
    );
    assert.equal(legacy.id, "1732000000123");
    assert.equal(legacy.sym, "BTCUSDT");
    assert.equal(legacy.condition, "cross");
    assert.equal(legacy.target, 95000);
    assert.equal(legacy.mode, "once");
    assert.equal(legacy.armed, true);
    assert.equal(legacy.message, "Breakout!");
    assert.ok(ALERT_CONDITIONS.includes(legacy.condition));
  });

  it("rejects malformed alert definitions", () => {
    assert.throws(() => normalizeAlert({ id: "", sym: "BTCUSDT", condition: "above", target: 100 }));
    assert.throws(() => normalizeAlert({ id: "a1", sym: "BAD SYMBOL!", condition: "above", target: 100 }));
    assert.throws(() => normalizeAlert({ id: "a2", sym: "BTCUSDT", condition: "bogus", target: 100 }));
    assert.throws(() => normalizeAlert({ id: "a3", sym: "BTCUSDT", condition: "above", target: -5 }));
    assert.throws(() => normalizeAlert({ id: "a4", sym: "BTCUSDT", condition: "above", target: 100, cooldownMs: -1 }));
  });
});

describe("shared/alerts.js — ticks & closed bars conditions", () => {
  it("evaluates above and below accurately on ticks and closed bars (including wick touches)", () => {
    let clock = T0;
    const ev = createAlertEvaluator({ now: () => clock });
    ev.addAlert({ id: "a_above", sym: "BTCUSDT", condition: "above", target: 100000 });
    ev.addAlert({ id: "a_below", sym: "ETHUSDT", condition: "below", target: 3000 });

    // Below threshold -> no trigger
    assert.equal(ev.evaluateTick("BTCUSDT", 99999).triggers.length, 0);
    // Exact hit -> triggers
    clock += 1000;
    const r1 = ev.evaluateTick("BTCUSDT", 100000);
    assert.equal(r1.triggers.length, 1);
    assert.equal(r1.triggers[0].id, "a_above");
    assert.equal(r1.triggers[0].price, 100000);
    assert.equal(r1.frames[0].triggeredAt, T0 + 1000);

    // Closed bar wick touches below 3000 even though bar closes above 3000
    clock += 5000;
    const r2 = ev.evaluateBar("ETHUSDT", { t: 1763500000, o: 3050, h: 3080, l: 2995, c: 3020 });
    assert.equal(r2.triggers.length, 1);
    assert.equal(r2.triggers[0].id, "a_below");
    assert.equal(r2.triggers[0].price, 2995);
    assert.equal(r2.triggers[0].source, "bar");
  });

  it("evaluates cross_up, cross_down, and cross strictly on direction transitions", () => {
    let clock = T0;
    const ev = createAlertEvaluator({ now: () => clock });
    ev.addAlert({ id: "cu", sym: "EURUSD", condition: "cross_up", target: 1.1 });
    ev.addAlert({ id: "cd", sym: "EURUSD", condition: "cross_down", target: 1.08 });
    ev.addAlert({ id: "cx", sym: "EURUSD", condition: "cross", target: 1.09, mode: "recurring", cooldownMs: 0 });

    // First tick establishes prevPrice = 1.105 (already above 1.1 -> must NOT trigger cross_up)
    assert.equal(ev.evaluateTick("EURUSD", 1.105).triggers.length, 0);
    assert.equal(ev.getPrevPrice("EURUSD"), 1.105);

    // Move down across 1.09 -> triggers cx only (not cu, not cd)
    clock += 1000;
    const r1 = ev.evaluateTick("EURUSD", 1.085);
    assert.deepEqual(
      r1.triggers.map((t) => t.id),
      ["cx"]
    );

    // Move down across 1.08 -> triggers cd
    clock += 1000;
    const r2 = ev.evaluateTick("EURUSD", 1.079);
    assert.deepEqual(
      r2.triggers.map((t) => t.id),
      ["cd"]
    );

    // Rebound up across 1.09 and 1.10 in one jump -> BOTH cu and cx see same prev=1.079!
    clock += 1000;
    const r3 = ev.evaluateTick("EURUSD", 1.102);
    assert.deepEqual(
      r3.triggers.map((t) => t.id).sort(),
      ["cu", "cx"]
    );
    assert.equal(r3.triggers[0].prevPrice, 1.079);
  });

  it("detects intrabar crosses and gap crosses on closed bars (object and 6-tuple)", () => {
    let clock = T0;
    const ev = createAlertEvaluator({ now: () => clock });
    ev.addAlert({ id: "bar_up", sym: "AAPL", condition: "cross_up", target: 200 });
    ev.addAlert({ id: "bar_dn", sym: "MSFT", condition: "cross_down", target: 400 });

    // AAPL: no prior tick, bar opens at 198, wicks to 201.5, closes at 199.5 -> intrabar cross_up
    const r1 = ev.evaluateBar("AAPL", [1763500000, 198, 201.5, 197.5, 199.5, 5000]);
    assert.equal(r1.triggers.length, 1);
    assert.equal(r1.triggers[0].id, "bar_up");
    assert.equal(r1.triggers[0].price, 201.5);
    assert.equal(ev.getPrevPrice("AAPL"), 199.5);

    // MSFT: prior tick at 405, bar gaps open at 398 -> gap cross_down
    ev.evaluateTick("MSFT", 405);
    clock += 60_000;
    const r2 = ev.evaluateBar({ sym: "MSFT", o: 398, h: 399, l: 395, c: 397, t: 1763500060 });
    assert.equal(r2.triggers.length, 1);
    assert.equal(r2.triggers[0].id, "bar_dn");
    assert.equal(r2.triggers[0].price, 397);
  });

  it("evaluates '% move' (pct_move, pct_up, pct_down) with explicit and lazy refPrice", () => {
    let clock = T0;
    const ev = createAlertEvaluator({ now: () => clock });

    // Explicit refPrice
    ev.addAlert({ id: "pm_abs", sym: "SOLUSDT", condition: "% move", target: 5, refPrice: 200 });
    // Lazy refPrice seeded from first tick
    ev.addAlert({ id: "pm_up", sym: "NVDA", condition: "pct_up", target: 3 });
    ev.addAlert({ id: "pm_dn", sym: "NVDA", condition: "pct_down", target: 3 });

    // SOLUSDT +4.9% -> no trigger
    assert.equal(ev.evaluateTick("SOLUSDT", 209.8).triggers.length, 0);
    // SOLUSDT -5.0% (190 vs 200) -> triggers pct_move
    clock += 1000;
    const rSol = ev.evaluateTick("SOLUSDT", 190);
    assert.equal(rSol.triggers.length, 1);
    assert.equal(rSol.triggers[0].id, "pm_abs");
    assert.equal(rSol.triggers[0].movePct, -5);

    // NVDA first tick 100 seeds refPrice=100 for both pm_up & pm_dn
    assert.equal(ev.evaluateTick("NVDA", 100).triggers.length, 0);
    // NVDA drops to 96.5 (-3.5%) -> triggers pm_dn only (not pm_up)
    clock += 1000;
    const rDn = ev.evaluateTick("NVDA", 96.5);
    assert.deepEqual(
      rDn.triggers.map((t) => t.id),
      ["pm_dn"]
    );
    // NVDA rallies to 103.2 (+3.2% vs 100) -> triggers pm_up
    clock += 1000;
    const rUp = ev.evaluateTick("NVDA", 103.2);
    assert.deepEqual(
      rUp.triggers.map((t) => t.id),
      ["pm_up"]
    );
  });
});

describe("shared/alerts.js — once-disarm, re-arm, and recurring cooldown", () => {
  it("disarms once alerts after first trigger and allows explicit re-arming", () => {
    let clock = T0;
    const ev = createAlertEvaluator({ now: () => clock });
    ev.addAlert({ id: "once_1", sym: "BTCUSDT", condition: "cross_up", target: 90000, mode: "once" });

    ev.evaluateTick("BTCUSDT", 89500);
    clock += 1000;
    const first = ev.evaluateTick("BTCUSDT", 90100);
    assert.equal(first.triggers.length, 1);

    const stateAfter = ev.getAlert("once_1");
    assert.equal(stateAfter.fired, true);
    assert.equal(stateAfter.armed, false);
    assert.equal(stateAfter.triggerCount, 1);

    // Price dips and crosses again -> must NOT fire while disarmed
    clock += 1000;
    ev.evaluateTick("BTCUSDT", 89000);
    clock += 1000;
    assert.equal(ev.evaluateTick("BTCUSDT", 90500).triggers.length, 0);

    // Re-arm -> next cross fires again
    ev.rearmAlert("once_1");
    clock += 1000;
    ev.evaluateTick("BTCUSDT", 89800);
    clock += 1000;
    const second = ev.evaluateTick("BTCUSDT", 90200);
    assert.equal(second.triggers.length, 1);
    assert.equal(ev.getAlert("once_1").triggerCount, 2);
  });

  it("enforces recurring cooldown window deterministically", () => {
    let clock = T0;
    const ev = createAlertEvaluator({ now: () => clock });
    ev.addAlert({
      id: "rec_1",
      sym: "NQ=F",
      condition: "above",
      target: 21000,
      mode: "recurring",
      cooldownMs: 30_000,
    });

    // Trigger #1 at T0
    const r1 = ev.evaluateTick("NQ=F", 21010);
    assert.equal(r1.triggers.length, 1);
    assert.equal(ev.getAlert("rec_1").armed, true);
    assert.equal(ev.getAlert("rec_1").fired, false);

    // Suppressed during cooldown
    clock = T0 + 15_000;
    assert.equal(ev.evaluateTick("NQ=F", 21050).triggers.length, 0);
    clock = T0 + 29_999;
    assert.equal(ev.evaluateTick("NQ=F", 21060).triggers.length, 0);

    // Exact boundary T0 + 30_000 -> triggers #2
    clock = T0 + 30_000;
    const r2 = ev.evaluateTick("NQ=F", 21070);
    assert.equal(r2.triggers.length, 1);
    assert.equal(r2.triggers[0].triggerCount, 2);
    assert.equal(r2.frames[0].triggeredAt, T0 + 30_000);

    // Default cooldown on recurring alert without explicit cooldownMs is DEFAULT_COOLDOWN_MS (60s)
    const defRec = ev.addAlert({ id: "rec_def", sym: "ES=F", condition: "above", target: 6000, mode: "recurring" });
    assert.equal(defRec.cooldownMs, DEFAULT_COOLDOWN_MS);
  });
});

describe("shared/alerts.js — offline crossing (tab closed) & Protocol v2 compliance", () => {
  it("fires with no browser open, persists across snapshot/restore, and returns missed log on reconnect", () => {
    let clock = T0;
    const hub1 = createAlertEvaluator({ now: () => clock });
    hub1.addAlert({
      id: "offline_btc",
      sym: "BTCUSDT",
      condition: "cross_up",
      target: 95000,
      mode: "once",
      userId: "user_42",
      message: "BTC breakout above 95k",
    });

    // Browser disconnects after seeing 94,200; server keeps ingesting ticks
    hub1.evaluateTick("BTCUSDT", 94200);
    const disconnectTs = clock;

    // Durable Object hibernates & restores from SQLite snapshot
    const saved = hub1.snapshot();
    clock += 120_000;
    const hub2 = createAlertEvaluator({ now: () => clock });
    hub2.restore(saved);

    // Crossing happens while tab is closed!
    const { triggers, frames } = hub2.evaluateTick("BTCUSDT", 95125);
    assert.equal(triggers.length, 1);
    assert.equal(frames.length, 1);

    // On next load, client queries missed alert log since disconnect
    const missed = hub2.getLog({ userId: "user_42", since: disconnectTs });
    assert.equal(missed.length, 1);
    assert.equal(missed[0].id, "offline_btc");
    assert.equal(missed[0].price, 95125);
    assert.equal(missed[0].triggeredAt, T0 + 120_000);
    assert.equal(missed[0].message, "BTC breakout above 95k");
  });

  it("emits strictly valid Protocol v2 alert frames within 2 KB live budget", () => {
    let clock = T0;
    const ev = createAlertEvaluator({ now: () => clock });
    ev.addAlert({
      id: "alrt_proto_1",
      sym: "BTCUSDT",
      condition: "cross_up",
      target: 91500,
      message: "X".repeat(400), // intentionally oversized -> must truncate cleanly to <= 256 chars
    });
    ev.addAlert({
      id: "alrt_proto_2",
      sym: "BTCUSDT",
      condition: "pct_move",
      target: 1.5,
      refPrice: 90000,
    });

    ev.evaluateTick("BTCUSDT", 91000);
    clock += 2000;
    const { frames } = ev.evaluateTick("BTCUSDT", 91600);
    assert.equal(frames.length, 2);

    let lastSeq = 0;
    for (const frame of frames) {
      assert.equal(frame.v, PROTOCOL_VERSION);
      assert.equal(frame.type, "alert");
      const v = validateServerFrame(frame, { lastSeq });
      assert.equal(v.ok, true, `Invalid Protocol v2 frame: ${v.error}`);
      const budget = checkLiveFrameBudget(frame);
      assert.equal(budget.ok, true, `Frame exceeded ${MAX_LIVE_FRAME_BYTES}B: ${budget.bytes}B`);
      assert.ok(frame.message.length <= 256);
      lastSeq = frame.seq;
    }

    // Direct buildAlertFrame helper validation
    const direct = buildAlertFrame(
      { id: "alrt_99", sym: "EURUSD", condition: "price >= 1.1", price: 1.1012, triggeredAt: T0 },
      99
    );
    assert.equal(validateServerFrame(direct).ok, true);
  });

  it("ignores invalid ticks/bars without corrupting prevPrice state", () => {
    const ev = createAlertEvaluator({ now: () => T0 });
    ev.addAlert({ id: "safe_1", sym: "EURUSD", condition: "cross_up", target: 1.1 });

    ev.evaluateTick("EURUSD", 1.09);
    assert.equal(ev.evaluateTick("EURUSD", NaN).triggers.length, 0);
    assert.equal(ev.evaluateTick("EURUSD", -1).triggers.length, 0);
    assert.equal(ev.evaluateTick("EURUSD", 0).triggers.length, 0);
    assert.equal(ev.evaluateBar("EURUSD", null).triggers.length, 0);
    assert.equal(ev.getPrevPrice("EURUSD"), 1.09);

    // Pure evaluateAlertCondition sanity check
    const check = evaluateAlertCondition(
      normalizeAlert({ id: "pure_1", sym: "EURUSD", condition: "cross_up", target: 1.1 }, T0),
      { type: "tick", price: 1.105 },
      1.09
    );
    assert.equal(check.matched, true);
    assert.equal(check.triggerPrice, 1.105);
  });
});

describe("shared/alerts.js — security & architecture hardening regressions", () => {
  it("blocks prototype-chain keys in CONDITION_ALIASES (constructor, __proto__, toString)", () => {
    for (const key of ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"]) {
      assert.equal(normalizeCondition(key), null, `Expected null for ${key}`);
      assert.throws(() =>
        normalizeAlert({ id: `proto_${key}`, sym: "BTCUSDT", condition: key, target: 100 }, T0)
      );
    }
  });

  it("rejects booleans in all numeric coercion helpers and handles empty/zero cooldown & lastTriggeredAt safely", () => {
    // Boolean target / cooldownMs / refPrice / lastTriggeredAt rejected
    assert.throws(() => normalizeAlert({ id: "b1", sym: "BTCUSDT", condition: "above", target: true }, T0));
    assert.throws(() => normalizeAlert({ id: "b2", sym: "BTCUSDT", condition: "above", target: false }, T0));
    assert.throws(() =>
      normalizeAlert({ id: "b3", sym: "BTCUSDT", condition: "above", target: 100, mode: "recurring", cooldownMs: false }, T0)
    );
    assert.throws(() =>
      normalizeAlert({ id: "b4", sym: "BTCUSDT", condition: "above", target: 100, mode: "recurring", cooldownMs: true }, T0)
    );
    assert.throws(() =>
      normalizeAlert({ id: "b5", sym: "BTCUSDT", condition: "pct_move", target: 5, refPrice: true }, T0)
    );
    assert.throws(() =>
      normalizeAlert({ id: "b6", sym: "BTCUSDT", condition: "above", target: 100, lastTriggeredAt: true }, T0)
    );
    assert.throws(() =>
      normalizeAlert({ id: "b7", sym: "BTCUSDT", condition: "above", target: 100, lastTriggeredAt: false }, T0)
    );

    // lastTriggerPrice: true must NOT coerce to 1
    const cleanLtp = normalizeAlert(
      { id: "b8", sym: "BTCUSDT", condition: "above", target: 100, lastTriggerPrice: true },
      T0
    );
    assert.equal(cleanLtp.lastTriggerPrice, null);

    // cooldownMs: "" on recurring alert -> absent -> DEFAULT_COOLDOWN_MS (never 0!)
    const emptyCd = normalizeAlert(
      { id: "cd_empty", sym: "BTCUSDT", condition: "above", target: 100, mode: "recurring", cooldownMs: "" },
      T0
    );
    assert.equal(emptyCd.cooldownMs, DEFAULT_COOLDOWN_MS);

    const wsCd = normalizeAlert(
      { id: "cd_ws", sym: "BTCUSDT", condition: "above", target: 100, mode: "recurring", cooldownMs: "   " },
      T0
    );
    assert.equal(wsCd.cooldownMs, DEFAULT_COOLDOWN_MS);

    // lastTriggeredAt: "" or 0 -> null (must NOT falsely start a cooldown at nowMs!)
    for (const rawLast of ["", "   ", 0, "0", null, undefined]) {
      const a = normalizeAlert(
        { id: "lt_null", sym: "BTCUSDT", condition: "above", target: 100, mode: "recurring", lastTriggeredAt: rawLast },
        T0
      );
      assert.equal(a.lastTriggeredAt, null, `Expected null for lastTriggeredAt=${JSON.stringify(rawLast)}`);
    }

    // Boolean tick price or boolean timestamp rejected/ignored cleanly
    const ev = createAlertEvaluator({ now: () => T0 });
    ev.addAlert({ id: "tick_bool", sym: "BTCUSDT", condition: "above", target: 0.5 });
    assert.equal(ev.evaluateTick("BTCUSDT", true).triggers.length, 0);
    assert.equal(ev.evaluateTick({ sym: "BTCUSDT", price: true }).triggers.length, 0);
    assert.equal(ev.getPrevPrice("BTCUSDT"), undefined);
    assert.equal(ev.setPrevPrice("BTCUSDT", true), false);

    // Boolean timestamp falls back to now()
    const trig = ev.evaluateTick("BTCUSDT", 10, true);
    assert.equal(trig.triggers.length, 1);
    assert.equal(trig.triggers[0].triggeredAt, T0);
  });

  it("rejects corrupted OHLC bars instead of clamping (AGENTS.md §3)", () => {
    // High below open/close
    assert.equal(normalizeAlertBar({ t: T0, o: 100, h: 99, l: 95, c: 101 }), null);
    assert.equal(normalizeAlertBar([T0, 100, 99, 95, 101, 50]), null);
    // Low above open/close
    assert.equal(normalizeAlertBar({ t: T0, o: 100, h: 105, l: 101, c: 99 }), null);
    assert.equal(normalizeAlertBar([T0, 100, 105, 101, 99, 50]), null);
    // Boolean OHLC or volume
    assert.equal(normalizeAlertBar([T0, true, 105, 95, 100, 50]), null);
    assert.equal(normalizeAlertBar({ t: T0, o: 100, h: 105, l: 95, c: 100, v: false }), null);

    const ev = createAlertEvaluator({ now: () => T0 });
    ev.addAlert({ id: "corrupt_bar", sym: "ETHUSDT", condition: "above", target: 90 });
    const res = ev.evaluateBar("ETHUSDT", { t: T0, o: 100, h: 95, l: 90, c: 101 });
    assert.equal(res.triggers.length, 0);
    assert.equal(ev.getPrevPrice("ETHUSDT"), undefined);
  });

  it("validates isPosFinite(target) at the start of evaluateAlertCondition", () => {
    for (const badTarget of [NaN, 0, -10, Infinity, -Infinity, true, undefined, null, "100"]) {
      const res = evaluateAlertCondition(
        { condition: "above", target: badTarget },
        { type: "tick", price: 500 },
        400
      );
      assert.equal(res.matched, false, `Expected matched=false for target=${String(badTarget)}`);
      assert.equal(res.triggerPrice, null);
    }
  });

  it("sanitizes control chars + enforces UTF-8 byte cap and builds frame BEFORE mutating alert state", () => {
    // Control chars + multi-byte UTF-8 emojis stay strictly within Protocol v2 frame budget
    let clock = T0;
    const ev1 = createAlertEvaluator({ now: () => clock });
    ev1.addAlert({
      id: "alrt\x00\r\n_ctrl",
      sym: "BTCUSDT",
      condition: "above",
      target: 100,
      message: "\x00\x1b[31mALERT\r\n" + "🚀".repeat(256),
    });
    const r1 = ev1.evaluateTick("BTCUSDT", 105);
    assert.equal(r1.frames.length, 1);
    const frame = r1.frames[0];
    assert.ok(!/[\u0000-\u001F\u007F-\u009F]/.test(frame.id), "frame.id must have no control chars");
    assert.ok(!/[\u0000-\u001F\u007F-\u009F]/.test(frame.message), "frame.message must have no control chars");
    assert.equal(validateServerFrame(frame).ok, true);
    assert.equal(checkLiveFrameBudget(frame).ok, true);

    // Frame build failure on first alert must NOT corrupt its state AND must NOT skip subsequent alerts!
    let seqCalls = 0;
    const ev2 = createAlertEvaluator({
      now: () => clock,
      nextSeq: () => {
        seqCalls += 1;
        // First call returns invalid seq -1 -> makeFrame throws; second call returns valid seq 1
        return seqCalls === 1 ? -1 : seqCalls - 1;
      },
    });
    ev2.addAlert({ id: "first_fails", sym: "BTCUSDT", condition: "above", target: 100, mode: "once" });
    ev2.addAlert({ id: "second_ok", sym: "BTCUSDT", condition: "above", target: 100, mode: "once" });

    const r2 = ev2.evaluateTick("BTCUSDT", 110);
    assert.equal(r2.triggers.length, 1);
    assert.equal(r2.triggers[0].id, "second_ok");
    assert.equal(r2.frames.length, 1);
    assert.equal(r2.frames[0].id, "second_ok");

    // First alert must remain completely unmutated (armed=true, fired=false, triggerCount=0, lastTriggeredAt=null)
    const firstState = ev2.getAlert("first_fails");
    assert.equal(firstState.triggerCount, 0);
    assert.equal(firstState.lastTriggeredAt, null);
    assert.equal(firstState.fired, false);
    assert.equal(firstState.armed, true);
    assert.equal(firstState.on, true);

    // Second alert properly disarmed
    const secondState = ev2.getAlert("second_ok");
    assert.equal(secondState.triggerCount, 1);
    assert.equal(secondState.fired, true);
    assert.equal(secondState.armed, false);
  });

  it("indexes alerts by symbol and never leaks prevPrices for unmonitored or removed symbols", () => {
    const ev = createAlertEvaluator({ now: () => T0 });
    ev.addAlert({ id: "m1", sym: "BTCUSDT", condition: "above", target: 100000 });
    ev.addAlert({ id: "m2", sym: "BTCUSDT", condition: "below", target: 50000 });

    // Ticks/bars on unmonitored symbols must NOT populate prevPrices
    for (let i = 0; i < 50; i++) {
      ev.evaluateTick(`NOALERT${i}`, 100 + i);
      ev.evaluateBar(`NOALRTB${i}`, { t: T0, o: 100, h: 105, l: 95, c: 102 });
    }
    assert.equal(ev.getPrevPrice("NOALERT0"), undefined);
    assert.equal(ev.getPrevPrice("NOALRTB0"), undefined);
    assert.equal(ev.setPrevPrice("UNREGISTERED", 123), false);
    assert.deepEqual(Object.keys(ev.snapshot().prevPrices), []);

    // Monitored symbol records prevPrice
    ev.evaluateTick("BTCUSDT", 75000);
    assert.equal(ev.getPrevPrice("BTCUSDT"), 75000);

    // Removing one of two alerts keeps prevPrice
    assert.equal(ev.removeAlert("m1"), true);
    assert.equal(ev.getPrevPrice("BTCUSDT"), 75000);

    // Removing the last alert for BTCUSDT cleans up prevPrices
    assert.equal(ev.removeAlert("m2"), true);
    assert.equal(ev.getPrevPrice("BTCUSDT"), undefined);
    assert.deepEqual(Object.keys(ev.snapshot().prevPrices), []);

    // Updating an alert's symbol via addAlert cleans up old symbol's prevPrices when last
    ev.addAlert({ id: "move_me", sym: "ETHUSDT", condition: "above", target: 5000 });
    ev.evaluateTick("ETHUSDT", 3000);
    assert.equal(ev.getPrevPrice("ETHUSDT"), 3000);
    ev.addAlert({ id: "move_me", sym: "SOLUSDT", condition: "above", target: 300 });
    assert.equal(ev.getPrevPrice("ETHUSDT"), undefined);
  });
});
