// tests/volume-profile.test.mjs — E-11 server-side volume profile (shared/market/volumeProfile.js).
// Run: node tests/volume-profile.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { volumeProfile, parseVolumeProfileQuery, VP_DEFAULT_ROWS } from "../shared/market/volumeProfile.js";

const T0 = 1_763_000_000;
const b = (i, o, h, l, c, v) => ({ t: T0 + i * 60, o, h, l, c, v });

test("volume is spread across touched rows, split up/down, totals preserved", () => {
  const bars = [b(0, 100, 110, 100, 108, 100), b(1, 108, 104, 100, 101, 50)].map((x, i) => (i === 1 ? { ...x, h: 104 } : x));
  const vp = volumeProfile(bars, { rows: 10 });
  assert.equal(vp.rows.length, 10);
  assert.equal(vp.total, 150);
  const sum = vp.rows.reduce((s, r) => s + r.v, 0);
  assert.ok(Math.abs(sum - 150) < 1e-9, "row volumes add up");
  assert.ok(Math.abs(vp.rows.reduce((s, r) => s + r.up, 0) - 100) < 1e-9, "up volume from the up bar");
  assert.ok(Math.abs(vp.rows.reduce((s, r) => s + r.dn, 0) - 50) < 1e-9, "down volume from the down bar");
  assert.equal(vp.rows[0].lo, 100);
  assert.equal(vp.rows[9].hi, 110);
});

test("POC is the heaviest row and the value area holds >= 70% of volume around it", () => {
  const bars = [];
  for (let i = 0; i < 50; i++) bars.push(b(i, 100, 101, 99, 100, i % 5 === 0 ? 1 : 10)); // heavy around 99..101
  bars.push(b(50, 110, 120, 110, 119, 5)); // light far away
  const vp = volumeProfile(bars, { rows: 20 });
  assert.ok(vp.poc >= 99 && vp.poc <= 101, "poc near 100: " + vp.poc);
  const inVa = vp.rows.filter((r) => r.lo >= vp.val - 1e-9 && r.hi <= vp.vah + 1e-9).reduce((s, r) => s + r.v, 0);
  assert.ok(inVa >= 0.7 * vp.total - 1e-9);
  assert.ok(vp.val <= vp.poc && vp.vah >= vp.poc);
  assert.ok(vp.vah < 110, "value area excludes the far light cluster");
});

test("time range filter, empty and zero-volume inputs", () => {
  const bars = [b(0, 10, 11, 9, 10, 5), b(1, 10, 12, 10, 11, 5), b(2, 11, 13, 11, 12, 5)];
  const vp = volumeProfile(bars, { from: T0 + 60, to: T0 + 120 });
  assert.equal(vp.bars, 2);
  assert.equal(vp.from, T0 + 60);
  assert.equal(vp.rows.length, VP_DEFAULT_ROWS);
  assert.equal(volumeProfile([], {}).rows.length, 0);
  const z = volumeProfile(bars.map((x) => ({ ...x, v: 0 })), { rows: 5 });
  assert.equal(z.total, 0, "FX feeds without volume report total 0 (client shows a note)");
});

test("parseVolumeProfileQuery", () => {
  const p = (q) => parseVolumeProfileQuery(new URLSearchParams(q));
  assert.equal(p("symbol=X"), null);
  assert.deepEqual(p("vp=1"), { ok: true, rows: VP_DEFAULT_ROWS, from: undefined, to: undefined });
  assert.deepEqual(p("vp=50&vpFrom=10&vpTo=20"), { ok: true, rows: 50, from: 10, to: 20 });
  assert.equal(p("vp=500").ok, false);
  assert.equal(p("vp=24&vpFrom=20&vpTo=10").ok, false);
  assert.equal(p("vp=24&vpFrom=abc").ok, false);
});
