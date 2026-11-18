@AGENTS.md
@STATE.md

# CLAUDE.md — Vektor Terminal (`tdmdne/Screener`)

AGENTS.md (imported above) is the short directives index and STATE.md is the current status. Task detail is in `docs/architecture/TASKS.md`; read only the task you're given (token discipline, AGENTS.md §1). **Zero Frontend Logic (AGENTS.md §0) overrides anything below that describes browser-side data logic as the target.** This file adds what the repo actually contains and points out where AGENTS.md has drifted from it.

## Stack
- **Frontend:** vanilla JS and CSS with no framework or bundler. `index.html` (~691 KB) is the frozen legacy monolith. Extracted modules live in `src/` as numbered, load-ordered files such as `10_router.js`, `47_vs_engine.js`, `54_backtest.js`, `94_edge_client.js` and `99_stubs.js`, with a sibling `.css` file where needed.
- **Client services:** `client/services/dataService.js` and `client/services/tickBuffer.js`.
- **Shared logic:** `shared/constants.js` and `shared/schema.js`. Each workspace (`client/`, `shared/`, `worker/`) has its own small `package.json`.
- **Backends:**
  - `server.js`: Express + `ws` local dev server.
  - `worker.js`: root Worker, ~70 KB.
  - `worker/`: modular proxy (`index.js`, `hub.js`, `hubCore.js`, `upstream.js`, `providers.js`, `cache.js`, `cors.js`).
  - `functions/api/[[path]].js`: Pages Function.
- **Runtime dependencies:** only `express` and `ws`. A `bun.lock` exists, but every script runs under `node`.
- **Docs:** `SETUP.md`, `docs/PROXY_SETUP.md`, `CHANGELOG.md` (45 KB), `.env.example`, `config.example.js`. A local `config.local.js` holds the owner's Twelve Data key and must never be committed.

## Commands (from `package.json`)
| Purpose | Command |
|---|---|
| Local dev / start | `npm run dev` or `bun run dev` → `node server.js` |
| "Build" (inline-script syntax check only) | `bun run build` → `node tests/syntax.js` |
| Lint | `bun run lint` → `node --check server.js && node tests/syntax.js` |
| Proxy unit tests | `bun run test:proxy` → `node tests/proxy.test.mjs` |
| One browser check | `node tests/<name>.js`, e.g. `node tests/journal.js` |
| Phone screenshots | `node tests/mshots.js 390x844` |

One-time test setup: `npm i playwright && npx playwright install chromium`. `tests/a11y.js` also needs `npm i -D axe-core`. Playwright is **not** listed in `package.json`.

`tests/harness.js` serves `index.html` locally, skips the login gate (`auth:false` shows it), mocks Binance REST and all WebSockets, and blocks every other network call. Options: `consent:false`, `mobile`, `reducedMotion:"reduce"`. For offline runs, put `lwc.js` (lightweight-charts 4.1.3) and `h2c.js` (html2canvas 1.4.1) in `tests/vendor/`. Screenshots are written to `shots/` and `shots/m/`.

These test files exist but aren't documented in `tests/README.md`: `calc`, `logic`, `plus`, `reliability`, `router`, `screener`, `supercharts`, `shots`.

## ⚠️ Where AGENTS.md doesn't match the repo
1. **There is no `test` script, so `bun test` won't run the suite.** It would run Bun's own test runner, which finds none of these files. Run `node tests/<name>.js` or `bun run test:proxy` instead. Also, `bun run build` is just a syntax check, and `bun run dev` starts a long-running server, not a check.
2. **`dataService.js` is at `client/services/dataService.js`, not `src/services/dataService.js`.** TASK-02 and TASK-03 both use the wrong path.
3. **TASK-01 is done:** `shared/instruments.js`, `shared/intervals.js` and `shared/symbolNormalizer.js` now hold the catalogs, interval maps and `normalizeSymbol` that used to be duplicated in `server.js` and `worker.js`. `server.js` loads them with `require()` of ESM, so it needs Node ≥ 22.12. Note that `shared/intervals.js` uses uppercase labels (`1H`, `1M` = month), while `shared/constants.js` `TF_*` uses lowercase ones; `tests/shared.test.mjs` checks that the two stay in sync. `hashSeed`, `makeRng`, `generateSyntheticCandles`, the LZMA/bi5 decoder and `aggregateCandles` are still duplicated in both files.
4. **`src/` has a flat numbered layout.** There is no `src/styles/` or `src/services/`. TASK-09 targets `src/styles/main.css`, so pick a layout on purpose instead of letting it happen by accident.
5. **AGENTS.md says Playwright, but it isn't a dependency, and there's no Playwright config or `@playwright/test` runner.** The tests are standalone Node scripts.
6. **The two Workers overlap.** AGENTS.md describes one `worker.js`, but there are two Worker codebases (see below).

## Cloudflare deploy configs
| Config | Name | Entry | Bindings / features |
|---|---|---|---|
| `wrangler.toml` (root) | `vektor-terminal` | `worker.js` | Assets `directory="."` (binding `ASSETS`, `run_worker_first=["/api/*","/ws"]`); KV `SCREENER_KV` (**id is still the placeholder `REPLACE_WITH_…`**); DO `MARKET_RELAY` → `MarketRelayDO` (SQLite migration `v1`); cron `* * * * *` |
| `worker/wrangler.toml` | `vektor-proxy` | `worker/index.js` | DO `MarketHub` (hub/hubCore); upstream proxy and cache layer |

`worker/wrangler.toml` was read from GitHub: `ALLOWED_ORIGINS = "*"` (lock down for production), secret `TWELVEDATA_KEY` via `wrangler secret put`.

Pages (`screener-cso.pages.dev`) also serves `functions/api/[[path]].js`. Before changing routes, confirm which of the three handles `/api/*` in production.

## Which skill to use when
| Situation | Skill |
|---|---|
| New or reshaped UI: screener columns, onboarding, registration modal, badges (TASK-04, 06, 07) | `frontend-design` |
| Quick check of a local UI change, screenshots, browser console logs | `webapp-testing` |
| Writing or fixing `tests/*.js` harness checks, or driving a browser session from the CLI | `playwright-cli` |
| Editing `worker.js`, `worker/*` or `functions/api/*`: caching TTLs, CORS, 429 circuit breaker, secrets | `workers-best-practices` |
| `MarketRelayDO` or `MarketHub`: WebSocket fan-out, storage, alarms, migrations | `durable-objects` |
| `wrangler dev` / `deploy`, KV ids, DO migrations, cron triggers, choosing between the two configs | `wrangler` |
| Load time of the 691 KB `index.html`, CWV, render cost in screener and heatmap | `web-perf` |
| axe failures, focus traps, 44px targets, keyboard paths (`tests/a11y.js`, `shortcuts.js`) | `accessibility` |
| Meta, OG, canonical, `sitemap.xml`, `robots.txt`, 404 page (`docs/agents/STANDARDS.md` §7) | `seo` |
| Any failing test, bad tick, feed gap or blank chart, before proposing a fix | `systematic-debugging` |
| Any feature or bugfix, especially extractions out of `index.html` and `shared/` normalizers | `test-driven-development` |
| Before saying something is done, committing or opening a PR: run the relevant `node tests/*.js` and show the output | `verification-before-completion` |

## Top risks
1. **Monolith regressions:** extracting code from `index.html` can break load order between the numbered `src/` files and inline scripts. Run `tests/syntax.js` plus the affected feature test after every move.
2. **Storage compatibility:** `scr2~<hash>~*` keys, guest isolation and claiming older unscoped data are covered by `tests/accounts.js` and `tests/privacy.js`. Run both before any storage change.
3. **Two overlapping Workers** (root `worker.js` with `MarketRelayDO`, `worker/` with `MarketHub`) plus a Pages Function. Fixing the wrong one, or fixing only one, is easy.
4. **Root assets directory is `"."`:** the whole repo root may be publicly served. Check `.assetsignore` before adding files, so `server.js`, `config.local.js`, `.env` and tests never become public.
5. **Per-minute cron and a placeholder KV id:** deploy fails or misbehaves until the KV id is set, and the cron runs 1,440 invocations a day, which affects billing and quota.
6. **Twelve Data credits and Binance geo-blocks:** keep crypto going browser → Binance directly, batch at most 8–10 symbols, and keep the 429 → cache fallback.
7. **Score integrity:** `tests/claims.js` hash-checks the scoring functions against `tests/scorefns.js`. Any change to them, even an accidental one, fails it.
8. **XSS:** Vektor Script sandbox (`tests/scripts.js`), template and CSV imports, AI replies. Never use `innerHTML` with dynamic data.
