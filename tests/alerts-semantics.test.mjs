// tests/alerts-semantics.test.mjs — E-07 drawing-line alerts, E-08 watchlist alerts, E-09 multi-condition alerts
// in shared/alerts.js (evaluated server-side by the hub). Run: node tests/alerts-semantics.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAlertEvaluator,
  expandAlertDefinition,
  lineValueAt,
  normalizeAlert,
  formatAlertCondition,
  MAX_ALERT_CONDITIONS,
  MAX_WATCHLIST_ALERT_SYMBOLS,
} from "../shared/alerts.js";

const T0 = 1_763_000_000; // unix seconds
const ms = (s) => s * 1000;

test("lineValueAt interpolates and respects seg / ray / line extents", () => {
  const seg = { t1: T0, p1: 100, t2: T0 + 100, p2: 110, ext: "seg" };
  assert.equal(lineValueAt(seg, T0 + 50), 105);
  assert.equal(lineValueAt(seg, T0 + 150), null, "segment ends at t2");
  assert.equal(lineValueAt({ ...seg, ext: "ray" }, T0 + 150), 115, "ray extends forward");
  assert.equal(lineValueAt({ ...seg, ext: "ray" }, T0 - 10), null, "ray does not extend backwards");
  assert.equal(lineValueAt({ ...seg, ext: "line" }, T0 - 10), 99, "line extends both ways");
  assert.equal(lineValueAt({ ...seg, ext: "line", p2: 0.0001, t2: T0 + 1 }, T0 + 10), null, "non-positive projection is null");
});

test("normalizeAlert validates drawing lines", () => {
  const a = normalizeAlert({ id: "l1", sym: "EURUSD", condition: "cross", line: { t1: T0, p1: 1.08, t2: T0 + 3600, p2: 1.09, ext: "ray" } });
  assert.deepEqual(a.line, { t1: T0, p1: 1.08, t2: T0 + 3600, p2: 1.09, ext: "ray" });
  assert.equal(a.target, 1.08, "label target = first anchor");
  assert.throws(() => normalizeAlert({ id: "x", sym: "EURUSD", condition: "pct_up", line: { t1: T0, p1: 1, t2: T0 + 1, p2: 2 } }), /Drawing-line/);
  assert.throws(() => normalizeAlert({ id: "x", sym: "EURUSD", condition: "cross", line: { t1: ms(T0), p1: 1, t2: ms(T0) + 1000, p2: 2 } }), /unix seconds/);
  assert.throws(() => normalizeAlert({ id: "x", sym: "EURUSD", condition: "cross", line: { t1: T0, p1: 1, t2: T0, p2: 2 } }), /distinct/);
  assert.throws(() => normalizeAlert({ id: "x", sym: "EURUSD", condition: "cross", line: { t1: T0, p1: 1, t2: T0 + 1, p2: 2, ext: "both" } }), /ext/);
  assert.match(formatAlertCondition(a), /drawing line/);
});

test("drawing-line alert fires when price crosses the sloped line, not a fixed level", () => {
  const ev = createAlertEvaluator({ now: () => ms(T0) });
  // rising line: 100 at T0 -> 110 at T0+100s
  ev.addAlert({ id: "tl", sym: "BTCUSDT", condition: "cross_up", line: { t1: T0, p1: 100, t2: T0 + 100, p2: 110, ext: "ray" } });
  assert.equal(ev.evaluateTick("BTCUSDT", 104, ms(T0 + 50)).triggers.length, 0, "seed prev below line (line=105)");
  // 106 at T0+50 would cross a 105 line, but at T0+90 the line is at 109: still below -> no fire
  assert.equal(ev.evaluateTick("BTCUSDT", 106, ms(T0 + 90)).triggers.length, 0, "line has risen past price");
  const r = ev.evaluateTick("BTCUSDT", 112, ms(T0 + 95));
  assert.equal(r.triggers.length, 1, "crosses up through line value 109.5");
  assert.match(r.triggers[0].conditionText, /cross_up 109\.5 \(drawing line\)/);
});

test("segment drawing alert is silent outside its time range", () => {
  const ev = createAlertEvaluator({ now: () => ms(T0) });
  ev.addAlert({ id: "seg", sym: "BTCUSDT", condition: "above", line: { t1: T0, p1: 100, t2: T0 + 100, p2: 100, ext: "seg" } });
  assert.equal(ev.evaluateTick("BTCUSDT", 150, ms(T0 + 500)).triggers.length, 0);
  assert.equal(ev.evaluateTick("BTCUSDT", 150, ms(T0 + 50)).triggers.length, 1);
});

test("expandAlertDefinition: one child per unique symbol, parentId kept, limits enforced", () => {
  const kids = expandAlertDefinition({ id: "wl1", syms: ["eurusd", "GBPUSD", "EURUSD"], condition: "pct_up", target: 2 });
  assert.deepEqual(kids.map((k) => [k.id, k.sym, k.parentId]), [["wl1~EURUSD", "EURUSD", "wl1"], ["wl1~GBPUSD", "GBPUSD", "wl1"]]);
  assert.ok(kids.every((k) => !("syms" in k)));
  assert.deepEqual(expandAlertDefinition({ id: "a", sym: "X" }), [{ id: "a", sym: "X" }]);
  assert.throws(() => expandAlertDefinition({ id: "w", syms: [] }), /at least one/);
  assert.throws(() => expandAlertDefinition({ id: "w", syms: Array.from({ length: MAX_WATCHLIST_ALERT_SYMBOLS + 1 }, (_, i) => "S" + i) }), /at most/);
  assert.throws(() => expandAlertDefinition({ id: "w", syms: ["EURUSD"], line: {} }), /drawing line/);
  assert.throws(() => expandAlertDefinition({ id: "w", syms: ["<bad>"] }), /invalid/);
});

test("watchlist alert: evaluated per symbol independently; removing the parent removes all children", () => {
  const ev = createAlertEvaluator({ now: () => ms(T0) });
  const res = ev.addAlert({ id: "wl", syms: ["EURUSD", "GBPUSD"], condition: "above", target: 1.2, mode: "once" });
  assert.deepEqual(res, { id: "wl", syms: ["EURUSD", "GBPUSD"], children: 2 });
  assert.equal(ev.listAlerts().length, 2);
  const g = ev.evaluateTick("GBPUSD", 1.25, ms(T0));
  assert.equal(g.triggers.length, 1);
  assert.equal(g.triggers[0].parentId, "wl");
  assert.equal(g.triggers[0].sym, "GBPUSD");
  assert.equal(ev.getAlert("wl~EURUSD").fired, false, "other symbols stay armed");
  assert.equal(ev.evaluateTick("EURUSD", 1.21, ms(T0)).triggers.length, 1);
  // re-adding replaces children (symbol removed from the watchlist disappears)
  ev.addAlert({ id: "wl", syms: ["EURUSD"], condition: "above", target: 1.3 });
  assert.deepEqual(ev.listAlerts().map((a) => a.id), ["wl~EURUSD"]);
  assert.equal(ev.removeAlert("wl"), true);
  assert.equal(ev.listAlerts().length, 0);
});

test("watchlist alert definition is validated atomically (one bad symbol adds nothing)", () => {
  const ev = createAlertEvaluator({ now: () => ms(T0) });
  ev.addAlert({ id: "wl", syms: ["EURUSD"], condition: "above", target: 1.2 });
  assert.throws(() => ev.addAlert({ id: "wl", syms: ["EURUSD", "bad sym!"], condition: "above", target: 1.2 }));
  assert.deepEqual(ev.listAlerts().map((a) => a.id), ["wl~EURUSD"], "previous children kept");
});

test("multi-condition alert fires only when every condition holds on the same sample (AND)", () => {
  const ev = createAlertEvaluator({ now: () => ms(T0) });
  ev.addAlert({ id: "m", sym: "BTCUSDT", condition: "above", target: 100, conds: [{ condition: "below", target: 105 }, { condition: "pct_up", target: 2, refPrice: 98 }], mode: "recurring", cooldownMs: 0 });
  assert.equal(ev.evaluateTick("BTCUSDT", 99, ms(T0)).triggers.length, 0, "primary fails");
  assert.equal(ev.evaluateTick("BTCUSDT", 106, ms(T0 + 1)).triggers.length, 0, "second condition fails");
  assert.equal(ev.evaluateTick("BTCUSDT", 99.5, ms(T0 + 2)).triggers.length, 0, "pct_up 1.5% < 2%");
  const r = ev.evaluateTick("BTCUSDT", 101, ms(T0 + 3));
  assert.equal(r.triggers.length, 1, "100 <= 101 <= 105 and +3.06% vs 98");
  assert.match(r.triggers[0].conditionText, /AND below 105 AND pct_up 2%/);
});

test("multi-condition limits and validation", () => {
  const extra = Array.from({ length: MAX_ALERT_CONDITIONS }, () => ({ condition: "above", target: 1 }));
  assert.throws(() => normalizeAlert({ id: "m", sym: "EURUSD", condition: "above", target: 1, conds: extra }), /at most 5/);
  assert.throws(() => normalizeAlert({ id: "m", sym: "EURUSD", condition: "above", target: 1, conds: [{ condition: "nope", target: 1 }] }), /Unsupported/);
  assert.throws(() => normalizeAlert({ id: "m", sym: "EURUSD", condition: "above", target: 1, conds: [{ condition: "below", target: -1 }] }), /positive/);
  assert.equal(normalizeAlert({ id: "m", sym: "EURUSD", condition: "above", target: 1, conds: extra.slice(1) }).conds.length, 4);
  assert.equal("conds" in normalizeAlert({ id: "p", sym: "EURUSD", condition: "above", target: 1 }), false, "plain alerts unchanged");
});

test("multi-condition works on bar samples too", () => {
  const ev = createAlertEvaluator({ now: () => ms(T0) });
  ev.addAlert({ id: "mb", sym: "EURUSD", condition: "above", target: 1.1, conds: [{ condition: "below", target: 1.12 }], onBarClose: true, mode: "recurring", cooldownMs: 0 });
  assert.equal(ev.evaluateBar("EURUSD", { t: T0, o: 1.13, h: 1.14, l: 1.125, c: 1.135 }, ms(T0)).triggers.length, 0, "never at or below 1.12");
  assert.equal(ev.evaluateBar("EURUSD", { t: T0 + 60, o: 1.105, h: 1.115, l: 1.104, c: 1.11 }, ms(T0 + 60)).triggers.length, 1, "both hold");
  assert.equal(ev.evaluateTick("EURUSD", 1.11, ms(T0 + 61)).triggers.length, 0, "onBarClose ignores ticks");
});
