// tests/no-client-math.test.mjs — Task 16 Zero Frontend Logic (§0) mandate CI guard.
// Always scans render-only transport modules (client/services/thinDataService.js, src/data_service.js).
// When VT_STRICT_MANDATE=1 or --strict-monolith is passed, also scans index.html and reports
// every remaining legacy violation with file, line number, rule ID, and preview.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const STRICT_MONOLITH =
  process.env.VT_STRICT_MANDATE === "1" || process.argv.includes("--strict-monolith");

const THIN_TRANSPORT_FILES = [
  "client/services/thinDataService.js",
  "src/data_service.js",
];

/**
 * Banned frontend-logic, client-caching, synthetic-generation, and external-host patterns.
 * Every rule runs against both thin transport files and (in strict mode) index.html.
 */
const BANNED_RULES = [
  { id: "ind-ema", category: "indicator-math", regex: /\bemaArr\b/g, desc: "Client EMA computation" },
  { id: "ind-sma", category: "indicator-math", regex: /\bsmaArr\b/g, desc: "Client SMA computation" },
  { id: "ind-atr", category: "indicator-math", regex: /\batrArr\b/g, desc: "Client ATR computation" },
  { id: "ind-rsi", category: "indicator-math", regex: /\brsiArr\b/g, desc: "Client RSI computation" },
  { id: "vs-run", category: "vektor-script", regex: /\bvsRun\b/g, desc: "Client Vektor Script runtime" },
  { id: "scr-preset", category: "screener-math", regex: /\bpassesPreset\b/g, desc: "Client P1-P5 screener preset math" },
  { id: "direct-bn-get", category: "third-party-fetch", regex: /\bbnGet\b/g, desc: "Direct Binance REST helper" },
  { id: "direct-bn-ws", category: "third-party-fetch", regex: /\bbnwsConnect\b/g, desc: "Direct Binance WebSocket helper" },
  { id: "idb-cache", category: "client-cache", regex: /\bindexedDB\.open\b/g, desc: "Client IndexedDB market cache" },
  { id: "tick-guard", category: "client-candle-math", regex: /\bcreateTickGuard\b/g, desc: "Client tick guard validation" },
  { id: "clean-bars", category: "client-candle-math", regex: /\bcleanBars\b/g, desc: "Client bar cleaning/dedup" },
  { id: "math-random", category: "synthetic-data", regex: /\bMath\.random\b/g, desc: "Math.random usage" },
  {
    id: "external-data-host",
    category: "third-party-fetch",
    regex: /(?:https?|wss?):\/\/(?:api\.twelvedata\.com|ws\.twelvedata\.com|data-api\.binance\.vision|api\.binance\.com|stream\.binance\.com|api\.coingecko\.com|finnhub\.io|api\.polygon\.io|nfs\.faireconomy\.media|api\.anthropic\.com)/gi,
    desc: "Direct external market/AI data host URL (HTTP/WS)",
  },
  {
    id: "direct-external-fetch",
    category: "third-party-fetch",
    regex: /\bfetch\s*\(\s*["'`]https?:\/\//gi,
    desc: "Direct fetch() to hardcoded external https:// URL",
  },
];

/** Extra strict rules applied to the thin render-only transport modules: zero hardcoded HTTP/WS or protocol-relative URLs. */
const THIN_ONLY_RULES = [
  { id: "thin-last-candles", category: "client-cache", regex: /\blastCandles\b/g, desc: "Stale client candle cache" },
  {
    id: "thin-any-http-url",
    category: "third-party-fetch",
    regex: /(?:https?|wss?):\/\//gi,
    desc: "Hardcoded http(s):// or ws(s):// URL in render-only transport",
  },
  {
    id: "thin-protocol-relative-url",
    category: "third-party-fetch",
    regex: /["'`]\/\/[a-z0-9.-]+\.[a-z]{2,}/gi,
    desc: "Hardcoded protocol-relative //host URL in render-only transport",
  },
];

function scanText(fileLabel, text, rules) {
  const lines = text.split(/\r?\n/);
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of rules) {
      rule.regex.lastIndex = 0;
      let match;
      while ((match = rule.regex.exec(line)) !== null) {
        violations.push({
          file: fileLabel,
          line: i + 1,
          col: match.index + 1,
          ruleId: rule.id,
          category: rule.category,
          match: match[0],
          preview: line.trim().slice(0, 120),
        });
        if (match.index === rule.regex.lastIndex) rule.regex.lastIndex++;
      }
    }
  }
  return violations;
}

function formatViolations(violations) {
  const byRule = new Map();
  for (const v of violations) {
    byRule.set(v.ruleId, (byRule.get(v.ruleId) || 0) + 1);
  }
  const summary = [...byRule.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => `  - ${id}: ${count}`)
    .join("\n");
  const detail = violations
    .slice(0, 40)
    .map((v) => `  ${v.file}:${v.line}:${v.col} [${v.ruleId}] ${v.match}  |  ${v.preview}`)
    .join("\n");
  const extra = violations.length > 40 ? `\n  ... and ${violations.length - 40} more violation(s)` : "";
  return `Found ${violations.length} §0 violation(s):\nBy rule:\n${summary}\nLocations:\n${detail}${extra}`;
}

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log("PASS", name);
  } catch (err) {
    failed++;
    console.error("FAIL", name, "\n" + (err && err.message ? err.message : String(err)));
  }
}

check("scanner self-test detects every banned pattern including THIN_ONLY_RULES and wss://", () => {
  const sample = [
    "const a = emaArr(c, 20), b = smaArr(c, 50), d = atrArr(b, 14), r = rsiArr(c, 14);",
    "const x = vsRun(src); if (passesPreset(row, 'P1')) bnGet('/klines'); bnwsConnect();",
    "indexedDB.open('vt'); createTickGuard(); cleanBars(raw); const j = Math.random();",
    "fetch('https://api.binance.com/api/v3/klines');",
    "const cache = lastCandles; const protoRel = '//cdn.evil.example/vendor.js';",
  ].join("\n");
  const allRules = [...BANNED_RULES, ...THIN_ONLY_RULES];
  const found = scanText("<synthetic>", sample, allRules);
  const foundIds = new Set(found.map((v) => v.ruleId));
  for (const rule of allRules) {
    assert.ok(foundIds.has(rule.id), `Scanner failed to catch rule ${rule.id}`);
  }

  // Prove wss:// external market WebSocket URLs are caught by BOTH external-data-host and thin-any-http-url
  const wsSample = "new WebSocket('wss://stream.binance.com:9443/ws/!ticker@arr');";
  const wsHits = scanText("<synthetic-ws>", wsSample, allRules);
  const wsRuleIds = new Set(wsHits.map((v) => v.ruleId));
  assert.ok(wsRuleIds.has("external-data-host"), "external-data-host must catch wss://stream.binance.com/...");
  assert.ok(wsRuleIds.has("thin-any-http-url"), "thin-any-http-url must catch wss://stream.binance.com/...");
});

for (const rel of THIN_TRANSPORT_FILES) {
  check(`${rel} has ZERO banned §0 patterns or external URLs`, () => {
    const abs = path.join(root, rel);
    assert.ok(fs.existsSync(abs), `Missing required transport module: ${rel}`);
    const text = fs.readFileSync(abs, "utf8");
    assert.ok(text.trim().length > 0, `${rel} must not be empty`);
    const violations = scanText(rel, text, [...BANNED_RULES, ...THIN_ONLY_RULES]);
    if (violations.length > 0) {
      assert.fail(formatViolations(violations));
    }
  });
}

if (STRICT_MONOLITH) {
  check("STRICT MANDATE: index.html has ZERO banned §0 patterns", () => {
    const rel = "index.html";
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    const violations = scanText(rel, text, BANNED_RULES);
    if (violations.length > 0) {
      assert.fail(formatViolations(violations));
    }
  });
} else {
  console.log("INFO index.html strict monolith scan skipped (enable with VT_STRICT_MANDATE=1 or --strict-monolith)");
}

console.log(`\nno-client-math: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
