// tests/screener-server-side-guard.test.mjs — keeps screener filtering/sorting moving to the server (Task 13).
//
// What is true today (verified by this file):
//   SERVER  buildScreenerSnapshot() filters (preset, market, query), sorts and paginates; the hub serves it over
//           /ws (`view.screener`) and /api/bootstrap, capped at MAX_SCREENER_PAGE_ROWS rows per frame.
//   CLIENT  the legacy browser screener (src/vt_01_core_state.js and friends) STILL runs P1-P5 preset filtering,
//           scoring and the heatmap maths itself. That is Task 13 debt, not "done".
//   PROTOCOL view.screener has no `sort` field yet, so a column sort chosen in the UI cannot be requested from the server.
//
// The existing no-client-math guard only scans index.html and the thin transport files, so it cannot see this code
// (it moved into src/vt_*.js). This test is a RATCHET over src/*.js: the count of screener-math references per file
// may never go up (new browser-side maths is rejected) and must be lowered here when Task 13 removes some, so
// progress is locked in. Reaching an empty BASELINE means the browser is a pure presentation layer.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildScreenerSnapshot } from "../shared/market/screener.js";
import { MAX_SCREENER_PAGE_ROWS, validateClientMessage } from "../shared/protocol.js";

const root = fileURLToPath(new URL("..", import.meta.url));
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, "-", err && err.stack ? err.stack : err);
    process.exitCode = 1;
  }
}

/** Known remaining browser-side screener/heatmap maths (Task 13). Lower these as the code is deleted. */
const BASELINE = {
  "src/vt_01_core_state.js": 6,
  "src/vt_05_router_a11y.js": 3,
  "src/vt_06_supercharts_tools.js": 1,
  "src/vt_07_screener_pro_auth.js": 30,
};
const BANNED = /\b(passesPreset|scoreMarket|scoreSymbol|sxTier|hmSquarify|hmTradedValue|hmChg|hmVal)\b/g;

function scan() {
  const found = {};
  for (const f of fs.readdirSync(path.join(root, "src")).filter((x) => x.endsWith(".js")).sort()) {
    const n = (fs.readFileSync(path.join(root, "src", f), "utf8").match(BANNED) || []).length;
    if (n) found[`src/${f}`] = n;
  }
  return found;
}

await test("server side: screener paging cap and view.screener filters (preset, market, query, page) are part of the protocol", () => {
  assert.equal(MAX_SCREENER_PAGE_ROWS, 50);
  const ok = validateClientMessage({ op: "view", screener: { preset: "P3", page: 2, market: "CRY", query: "btc", evcTf: "H", dir: "long", pageSize: 25 } });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(validateClientMessage({ op: "view", screener: { preset: "P3", page: 1, pageSize: 51 } }).ok, false, "pages are capped server-side");
  assert.equal(validateClientMessage({ op: "view", screener: { preset: "P9", page: 1 } }).ok, false);
});

await test("server side: buildScreenerSnapshot returns a single capped page (<= 50 rows)", () => {
  const snap = buildScreenerSnapshot([], { preset: "P5", page: 1 });
  assert.equal(snap.preset, "P5");
  assert.equal(snap.page, 1);
  assert.ok(Array.isArray(snap.rows) && snap.rows.length <= MAX_SCREENER_PAGE_ROWS);
});

await test("RATCHET: browser-side screener/heatmap maths in src/*.js may not grow, and every reduction must be locked in", () => {
  const found = scan();
  const problems = [];
  for (const file of new Set([...Object.keys(found), ...Object.keys(BASELINE)])) {
    const now = found[file] || 0;
    const base = BASELINE[file] || 0;
    if (now > base) problems.push(`${file}: ${now} references, baseline ${base}. New browser-side screener maths is not allowed (AGENTS.md §0). Do it on the server.`);
    if (now < base) problems.push(`${file}: ${now} references, baseline ${base}. Good, the browser logic shrank. Lower BASELINE in tests/screener-server-side-guard.test.mjs to ${now} to lock it in.`);
  }
  assert.deepEqual(problems, [], problems.join("\n"));
  const total = Object.values(found).reduce((a, b) => a + b, 0);
  console.log(`  Task 13 debt: ${total} browser-side screener/heatmap references across ${Object.keys(found).length} files (target: 0)`);
});

await test("thin transport files stay free of screener maths (hard rule, no baseline)", () => {
  for (const f of ["client/services/thinDataService.js", "src/data_service.js"]) {
    const text = fs.readFileSync(path.join(root, f), "utf8");
    assert.equal((text.match(BANNED) || []).length, 0, `${f} must contain no screener maths`);
    assert.equal(/\.sort\(/.test(text) && /preset/i.test(text) && /passes/i.test(text), false);
  }
});

console.log(`screener-server-side-guard.test.mjs: ${passed} passed, ${failed} failed`);
