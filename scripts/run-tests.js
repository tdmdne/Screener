#!/usr/bin/env node
// Run every standalone test under tests/ with node. Exits non-zero if any fail.
// Skips helper modules that are imported by other tests (harness.js, scorefns.js).
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dir = path.join(root, "tests");
const skip = new Set(["harness.js", "scorefns.js"]);

const files = fs
  .readdirSync(dir)
  .filter((f) => /\.(js|mjs)$/.test(f) && !skip.has(f))
  .sort();

if (!files.length) {
  console.error("No tests found in", dir);
  process.exit(1);
}

let failed = 0;
const results = [];

for (const file of files) {
  const t0 = Date.now();
  console.log(`\n=== ${file} ===`);
  const r = spawnSync(process.execPath, [path.join("tests", file)], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  const status = r.status == null ? 1 : r.status;
  const ms = Date.now() - t0;
  const ok = status === 0;
  if (!ok) failed += 1;
  const line = `${file} ${ok ? "PASS" : "FAIL"} exit=${status} ${ms}ms`;
  results.push(line);
  console.log(line);
}

console.log("\n--- summary ---");
for (const line of results) console.log(line);
console.log(
  failed
    ? `${failed} of ${files.length} failed`
    : `all ${files.length} passed`
);
process.exit(failed ? 1 : 0);
