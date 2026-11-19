// Public static-file allowlist (functions/_middleware.js + _routes.json).
// Run: node tests/middleware.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { onRequest, isPublicPath } from "../functions/_middleware.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
let failed = 0;
const ok = (name, f) => Promise.resolve().then(f).then(() => console.log("PASS", name), (e) => { failed++; console.log("FAIL", name, "-", e.message); });

async function hit(p, method = "GET") {
  let called = false;
  const res = await onRequest({
    request: new Request("https://x.pages.dev" + p, { method }),
    next: () => { called = true; return new Response("NEXT", { status: 200 }); },
  });
  return { status: res.status, called, res };
}

const ALLOWED = [
  "/", "/index.html", "/robots.txt", "/sitemap.xml", "/favicon.ico", "/favicon.svg", "/apple-touch-icon.png",
  "/src/auth_email_validation.js", "/src/watchlist_starter.js", "/src/48_vs_ui.css", "/shared/emailValidator.js",
  "/vendor/lwc.js", "/vendor/h2c.js",
  "/data/manifest.json", "/data/c_1h.json", "/?utm=1", "/index.html?v=2",
  "/api", "/api/screener", "/api/news?symbol=X", "/api/ws-config",
];

const BLOCKED = [
  "/AGENTS.md", "/CLAUDE.md", "/SETUP.md", "/CHANGELOG.md", "/.assetsignore", "/.env.example", "/.gitignore",
  "/.git/config", "/.git/HEAD", "/worker.js", "/server.js", "/wrangler.toml", "/package.json", "/bun.lock",
  "/config.example.js", "/config.local.js", "/site.config.js", "/_routes.json", "/functions/_middleware.js",
  "/functions/api/[[path]].js", "/functions/api/%5B%5Bpath%5D%5D.js", "/worker/index.js", "/worker/wrangler.toml",
  "/client/services/dataService.js", "/tests/harness.js", "/scripts/run-tests.js", "/docs/PROXY_SETUP.md",
  "/shared/package.json", "/src/", "/src", "/shared/", "/shared", "/vendor/", "/vendor", "/vendor/other.js",
  "/index.html/", "/robots.txt/", "/index",
  "/AGENTS.MD", "/Index.html", "/SRC/auth_email_validation.js", "/Favicon.ico", "/data/", "/data/secret.txt",
  "/src/..%2fAGENTS.md", "/src/%2e%2e/AGENTS.md", "/%2e%2e/AGENTS.md", "/src/%252e%252e/AGENTS.md",
  "/src/%252e%252e%252fAGENTS.md", "/%2Egit/config", "/%2egit/config", "/.%67it/config",
  "/src/auth_email_validation.js%00", "/src//auth_email_validation.js", "//index.html", "/src/%61uth_email_validation.js",
  "/%61pi/x", "/api%2f..%2fAGENTS.md", "/src/.hidden.js", "/src/x.js/..x", "/.well-known/x", "/.wrangler/state",
  "/node_modules/ws/package.json", "/api/.git/config", "/api/.env",
];

for (const p of ALLOWED) await ok(`allowed -> next(): ${p}`, async () => {
  const r = await hit(p);
  assert.equal(r.called, true); assert.equal(r.status, 200);
});
await ok("POST /api/login passes through", async () => {
  const r = await hit("/api/login", "POST"); assert.equal(r.called, true);
});
await ok("OPTIONS /api/screener passes through (CORS preflight)", async () => {
  const r = await hit("/api/screener", "OPTIONS"); assert.equal(r.called, true);
});
for (const p of BLOCKED) await ok(`blocked -> 404: ${p}`, async () => {
  const r = await hit(p);
  assert.equal(r.called, false); assert.equal(r.status, 404);
  assert.equal(r.res.headers.get("cache-control"), "no-store");
});

await ok("isPublicPath on raw (un-normalised) paths", () => {
  for (const p of ["/src/../AGENTS.md", "/api/../AGENTS.md", "/api/..%2fAGENTS.md", "/api/%2e%2e/AGENTS.md",
    "/.git/config", "/src/.hidden.js", "/src/./auth_email_validation.js", "/src\\..\\AGENTS.md", "/api\\..\\x",
    "/a\0", "", "AGENTS.md", "/shared/../worker.js", "/./index.html"])
    assert.equal(isPublicPath(p), false, JSON.stringify(p));
  assert.equal(isPublicPath("/api/candles"), "api");
  assert.equal(isPublicPath("/src/10_router.js"), true);
  assert.equal(isPublicPath(undefined), false);
});

let tracked = null;
try { tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean); } catch {}
const PUBLIC_ROOT = new Set([
  "index.html", "robots.txt", "sitemap.xml", "favicon.ico", "favicon.svg", "apple-touch-icon.png",
  "vendor/lwc.js", "vendor/h2c.js",
]);
const CLIENT_SAFE_SHARED = new Set([
  "shared/constants.js",
  "shared/emailValidator.js",
  "shared/instruments.js",
  "shared/intervals.js",
  "shared/schema.js",
  "shared/symbolNormalizer.js",
]);
await ok("every tracked file outside the app is blocked", () => {
  if (!tracked) { console.log("  (git unavailable, skipped)"); return; }
  const leaks = tracked.filter((f) => !PUBLIC_ROOT.has(f) && !CLIENT_SAFE_SHARED.has(f) && !/^src\/[A-Za-z0-9_-]+\.(js|mjs|css)$/.test(f))
    .filter((f) => isPublicPath("/" + f) !== false);
  assert.deepEqual(leaks, []);
});
await ok("every tracked src/ and client-safe shared/ code file is allowed (server-only shared/ blocked)", () => {
  if (!tracked) return;
  const miss = tracked
    .filter((f) => /^src\/.*\.(js|mjs|css)$/.test(f) || CLIENT_SAFE_SHARED.has(f))
    .filter((f) => isPublicPath("/" + f) !== true);
  assert.deepEqual(miss, []);
  const serverSharedLeaks = tracked
    .filter((f) => /^shared\/.*\.(js|mjs|css)$/.test(f) && !CLIENT_SAFE_SHARED.has(f))
    .filter((f) => isPublicPath("/" + f) !== false);
  assert.deepEqual(serverSharedLeaks, []);
});

await ok("every local asset index.html loads (and their relative imports) is allowed and exists", () => {
  const html = read("index.html");
  const refs = new Set();
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)) {
    const u = m[1];
    if (/^(https?:|\/\/|#|data:|mailto:)/.test(u) || u.includes("${") || u === "config.local.js") continue;
    refs.add(new URL(u, "https://x/").pathname);
  }
  assert.ok(refs.size >= 5, "expected at least 5 local assets, got " + [...refs]);
  const queue = [...refs];
  while (queue.length) {
    const p = queue.shift();
    if (!/\.m?js$/.test(p)) continue;
    for (const m of read(p.slice(1)).matchAll(/\bfrom\s+["'](\.{1,2}\/[^"']+)["']|\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const dep = new URL(m[1] || m[2], "https://x" + p).pathname;
      if (!refs.has(dep)) { refs.add(dep); queue.push(dep); }
    }
  }
  assert.ok(refs.has("/shared/emailValidator.js"));
  for (const p of refs) {
    assert.equal(isPublicPath(p), true, "not allowlisted: " + p);
    assert.ok(fs.existsSync(path.join(root, p.slice(1))), "missing on disk: " + p);
  }
});

await ok("_routes.json: include /*, only exact allowlisted excludes, covers the page's own assets", () => {
  const r = JSON.parse(read("_routes.json"));
  assert.equal(r.version, 1);
  assert.deepEqual(r.include, ["/*"]);
  assert.ok(r.exclude.length <= 100);
  for (const e of r.exclude) {
    // Wildcard excludes bypass the middleware, so trick paths under them would reach
    // the static server (SPA fallback) instead of a 404. Keep them exact.
    assert.ok(!e.includes("*"), "wildcard exclude not allowed: " + e);
    assert.equal(isPublicPath(e), true, "exclude not on allowlist: " + e);
    if (e !== "/") assert.ok(fs.existsSync(path.join(root, e.slice(1))), "exclude for missing file: " + e);
  }
  // Cost: every file a page load fetches should skip the Function.
  for (const p of ["/", "/favicon.ico", "/favicon.svg", "/apple-touch-icon.png", "/src/auth_email_validation.js", "/src/watchlist_starter.js", "/shared/emailValidator.js"])
    assert.ok(r.exclude.includes(p), "page asset not excluded (would count as a Function request): " + p);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall middleware tests passed");
