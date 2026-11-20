# Vektor Terminal — Neon Orchestrator Dispatch & Gatekeeper Log

> **Protocol (`AGENTS.md` §7):** **Gemini 4 Neon** is the Lead Orchestrator & Final Gatekeeper on `feat/phase-a-backend-core` (`main` untouched until Tyler approves push). **Gemini 4 Argon** completed its sprint on isolated branch `argon` and exhausted its weekly quota; Neon has audited `argon` file-by-file below and resumed direct execution.

---

## 0. Gatekeeper Audit Log — `argon` Branch Review (`2026-11-19 13:16 UTC`)

**Reviewed Commits on `argon` (`b9188b9`, `b148d46`, `0e0eef5`):**

| File / Component | Decision | Gatekeeper Rationale |
| :--- | :---: | :--- |
| **`_routes.json`, `src/data_service.js`, `src/watchlist_starter.js`** | **KEEP** | Clean static exclusions (`/src/data_service.js`, `/src/landing.css`, `/src/landing.js`), `?thin=1` auto-bootstrap hook, and duplicate click-listener guard on `#vtWlClear`. |
| **`src/auth_ui.js`, `src/landing.js`, `src/landing.css`** | **KEEP** | Zero `innerHTML` (100% `createElement`/`textContent`), Admin Waitlist tab wired to `/api/admin/waitlist`, `#/signup` & `#/register` routes, Liquid Glass `Products ▾` dropdown, `#/features/*` & `#/products/*` dedicated pages, explicit SVG dimensions, neutral platinum/amber link styling. |
| **`index.html`, `src/98_institutional.css`, `tests/screener.js`** | **KEEP** | Removed all 12 `Math.random()` occurrences (`vtNextId` + seeded `prnd`), hard-locked same-origin runtime egress (`tests/egress.test.mjs --strict-egress` **4/4 PASS** with **0** non-origin requests), renamed Supercharts → VektorCharts, added Liquid Glass Features & Menu header dropdowns, collapsible TradingView-style indicator stack (`togIndStack`), FX Replay cockpit controls (`Move SL to BE`, `Close 50%`, risk pills, tabbed ledger), and Screener Settings modal (`scrSetM`). |
| **`docs/ui/AUDIT-2026-11-19.md`, `docs/architecture/TASKS.md`, `STATE.md`, `.agents/LOOP-STATE.md`** | **KEEP** | Clean Pass 3 audit telemetry & updated completion logs. |
| **`AGENTS.md` urgent handoff banner, `NEON_WAKEUP_PROMPT.md`, `ARGON_HANDOFF.md`** | **REJECT (left on `argon`)** | Temporary wakeup/handoff scaffolding no longer needed now that Neon has resumed leadership; kept `AGENTS.md` and repo root clean for PR/main. |

### Remaining Sprint Items (Executed Directly by Neon on `feat/phase-a-backend-core`)
1. Complete Gatekeeper Playwright verification on `feat/phase-a-backend-core`, commit approved Argon changes cleanly, and deploy refreshed Cloudflare Pages preview (`https://feat-phase-a-backend-core.screener-cso.pages.dev`).
2. Confirm full `59/59` suite health + strict egress (`4/4`) + live `vektor-market` & D1 `tdm-screener` health.
3. Optional follow-up before launch: migrate legacy test reference fixtures (`scorefns.js`, `vs.test.mjs`, `screener-server.test.mjs`) out of `index.html` into `tests/fixtures/` so `no-client-math.test.mjs --strict-monolith` can be flipped to default ON and dead legacy client math bodies deleted from `index.html`.
4. Hold `main` untouched until Tyler explicitly approves pushing/merging.

---

## 1. Gatekeeper Audit Log (Prior 25-Agent Run & `argon` Branch)

**Audit Timestamp:** `2026-11-19T10:56:00Z`  
**Reviewed Commits on `feat/phase-a-backend-core` & `argon`:**
- `5872d23` — Phase 1+2 backend pipeline (`workers/market/` + `MarketHub` DO, `shared/market/*`, `shared/vs/`, `shared/protocol.js`, `shared/alerts.js`, `shared/replay.js`, `shared/journal.js`, D1 Auth/OAuth `0001_auth_and_user_data.sql`, `src/98_institutional.css`, 58/58 test suites green).
- `bfd60ad` — Phase 3A/3B D1 Auth/OAuth UI (`src/auth_ui.js`), self-hosted `/vendor/lwc.js` & `/vendor/h2c.js` (0 CDN egress), glassy 4-way resizable window manager (`src/window_manager.js`), removal of fake chart Buy/Sell overlay buttons.
- `9f80842` — Uncommitted checkpoint from the end of the 25-agent session saved onto `argon` and audited against `feat/phase-a-backend-core`.

### Decisions (`KEEP` vs `REJECT / DROP`)

| Component / Commit | Decision | Gatekeeper Rationale |
| :--- | :--- | :--- |
| **`5872d23` & `bfd60ad` (Phase 1, 2, 3A/3B core)** | **KEEP** | Verified 58/58 test suites green + 2 independent security re-audits PASS (0 Critical/High/Medium). Self-hosted `/vendor/` eliminates jsDelivr egress. |
| **`9f80842`: Pre-launch Waitlist Backend (`migrations/0002_waitlist.sql`, `shared/waitlist.js`, `functions/api/[[path]].js`, `tests/waitlist-server.test.mjs`)** | **KEEP** | 100% parameterized SQLite/D1 queries, `+tag` canonical email deduplication, 8 KB payload cap, CSRF `Origin` enforcement, IP rate limiting, and admin RBAC (`7/7` tests PASS in `tests/waitlist-server.test.mjs`). |
| **`9f80842`: Landing & Products Module (`src/landing.js`, `src/landing.css`, `src/98_institutional.css`, `docs/support/KNOWLEDGE-BASE.md`)** | **KEEP (Staged Module)** | Pure DOM construction (`createElement` / `createElementNS` + `textContent`, zero `innerHTML`, `node --check` clean, humanized copy). Currently unmounted in `index.html`; requires a clean mount ticket (`ARGON-04`) once confirmed. |
| **`9f80842`: `.agents/skills/*` & `.agents/toolbox/*` (36 skill packs + Emil cheatsheets + `.agents/PLAYBOOK.md`)** | **KEEP** | All installed skills are markdown-only references (`functions/_middleware.js` strict allowlist blocks `/.agents/*` from public serving). Mandatory reference pool for Argon execution tickets. |
| **Unfinished / Partial Monolith Strip from 25-Agent Run** | **REJECT / DROP (Replaced by Scoped Tickets Below)** | The prior 25-agent run built `src/data_service.js` and `client/services/thinDataService.js` (`3/3` unit checks pass), but left **86 `AGENTS.md` §0 violations** inside `index.html` (`emaArr`, `smaArr`, `rsiArr`, `atrArr`, `passesPreset`, `vsRun`, `bnGet`, `bnwsConnect`, `fetchFH`, `fetchPoly`, `fetchCG`, `vtBnDirectCandles`, `indexedDB.open`, `Math.random`). Rather than letting a multi-agent swarm make colliding edits to `index.html`, the monolith cutover is broken into sequential, non-overlapping Argon tickets below. |

---

## 2. Assigned to Argon (`READY_FOR_BUILD`)

> **Instructions for Gemini 4 Argon:**
> 1. Run `git checkout -b argon` from `feat/phase-a-backend-core` and verify `git branch --show-current` outputs `argon`. Never touch, merge into, or push to `main`.
> 2. Execute the tickets below **in strict numerical order** (`ARGON-01` → `ARGON-05`). Because `ARGON-01` through `ARGON-03` edit `index.html`, do **not** run parallel subagents on `index.html`—apply each slice sequentially, run its verification command, and create **one clean atomic git commit per ticket** on `argon`.
> 3. Consult the installed skills referenced in each ticket (`.agents/skills/ecc-verification-loop/SKILL.md`, `.agents/skills/ecc-security-review/SKILL.md`, `.agents/skills/apple-institutional-design/SKILL.md`, `.agents/skills/emil-design-eng/SKILL.md`, `.agents/skills/humanizer/SKILL.md`, `.agents/toolbox/emil-performance-cheatsheet.md`).
> 4. Conserve tokens: read targeted line ranges only (never read `index.html` in full) and filter terminal output (`| Select-Object -Last 35`).
> 5. When finished (or before quota expiry), write `ARGON_HANDOFF.md` in the repo root listing every commit hash, modified file, `npm.cmd test` + `VT_STRICT_MANDATE=1` output, and any trade-offs for Neon's Gatekeeper review.

---

### Ticket `ARGON-01`: Wire `src/data_service.js` Transport & Strip Client Chart/Indicator/VS Maths (Tasks 10, 11, 12)
- **Status:** `READY_FOR_BUILD`
- **Skills to Apply:** `.agents/skills/ecc-backend-patterns/SKILL.md`, `.agents/skills/ecc-verification-loop/SKILL.md`, `.agents/toolbox/emil-performance-cheatsheet.md`
- **Target Files & Line Ranges (re-verify with `Select-String` before editing):**
  - `index.html:1158-1164` (module `<script>` tags) & `_routes.json:1-21` (add `/src/data_service.js` to `_routes.json` `exclude` list so Pages serves it directly without middleware invocations)
  - `index.html:1590-1715` (`emaArr`, `smaArr`, `atrArr`, `rsiArr`, `updateLiveBar`, `vtBuildChartData`)
  - `index.html:1775-1855` (chart indicator series binding & header legend values)
  - `index.html:4280-4410` (`VS_FN`, `vsRun`, `vsCompute` — keep `vsLex`/`vsParse` syntax highlighting only per `D7`, route script evaluation through `POST /api/vs/run` or server frames)
  - `index.html:6490-6650` (`vtMergeBars`, `edgeFetchCandles`, `vtLoadMoreHistory` → route history pagination through `GET /api/bars?sym=...&tf=...&before=...`)
  - `index.html:6985-7130` (`vtApplyTwelveDataTick`, `vtTdWsConnect` → replace with `src/data_service.js` `/api/bootstrap` + `/ws` frame subscriptions: `state`, `bar`, `ind`, `vs`, `quotes`)
- **Acceptance Criteria:**
  1. `index.html` loads `src/data_service.js` and feeds charts + indicator overlays from server frames (`/api/bootstrap`, `/ws`, `/api/bars`, `/api/vs/run`).
  2. Zero occurrences of `emaArr`, `smaArr`, `atrArr`, `rsiArr`, `vsRun`, `createTickGuard`, or `cleanBars` remain in `index.html` (`node tests/no-client-math.test.mjs --strict-monolith` shows `0` hits for `ind-ema`, `ind-sma`, `ind-atr`, `ind-rsi`, `vs-run`).
  3. `node tests/supercharts.js`, `node tests/minicharts.js`, `node tests/reliability.js`, and `node tests/scripts.js` all exit `0`.
  4. Commit on `argon` as `feat(argon-01): wire data_service transport and strip client chart/indicator/VS math`.

---

### Ticket `ARGON-02`: Strip Client Screener (P1–P5), Heatmap & Sample/Synthetic Math (Task 13 + UI-07)
- **Status:** `READY_FOR_BUILD`
- **Skills to Apply:** `.agents/skills/apple-institutional-design/SKILL.md`, `.agents/skills/ecc-verification-loop/SKILL.md`
- **Target Files & Line Ranges:**
  - `index.html:1187-1205` (`SAMPLE`, `norm` `Math.random` ID generation → replace `Math.random()` with deterministic counter or `crypto.randomUUID()`)
  - `index.html:1305-1445` (`calc`, `scoreSymbol`, ` rows`, `scoreMarket`, `passesPreset`, `candles()`)
  - `index.html:1975-1985` & `index.html:3200-3950` (`sxTier`, `sxPct`, `sxAdr`, `hmTradedValue`, `hmChg`, `hmVal`, any remaining `Math.random` calls)
  - `index.html:6370-6425` (server screener/heatmap hydration — render precomputed server `screener` and `heatmap` frames; keep `hmSquarify` layout geometry only per `D7`)
  - `tests/scorefns.js` (ensure test helper imports/adapts cleanly if it reads from `index.html` or `shared/market/screener.js` without breaking `tests/screener.js`)
- **Acceptance Criteria:**
  1. Screener table, P1–P5 presets, and Heatmap tiles render strictly from server/snapshot payloads (`hmSquarify` geometry retained).
  2. Zero occurrences of `passesPreset` or `Math.random` remain in `index.html` (`node tests/no-client-math.test.mjs --strict-monolith` shows `0` hits for `scr-preset` and `math-random`).
  3. `node tests/screener.js`, `node tests/heatmap.js`, and `node tests/screener-server.test.mjs` all exit `0`.
  4. Commit on `argon` as `feat(argon-02): render server screener/heatmap and strip client scoring/synthetic math`.

---

### Ticket `ARGON-03`: Zero Third-Party Egress, IndexedDB Removal, Storage Hygiene & Deprecated Backend Cleanup (Tasks 14, 15, 16, 20)
- **Status:** `READY_FOR_BUILD`
- **Skills to Apply:** `.agents/skills/ecc-security-review/SKILL.md`, `.agents/skills/ecc-web-perimeter-owasp-2025-audit/SKILL.md`, `.agents/skills/humanizer/SKILL.md`
- **Target Files & Line Ranges:**
  - `index.html:2525-2895` (`BNH`, `fetchFH`, `fetchPoly`, `fetchCG`, `bnwsConnect`, `bnKlineStart`, `bnGet`, `loadBN`, `idb`, `loadCache`, `flush`, `snapInit`, `dataM` BYO-key inputs per `D8`)
  - `index.html:3725-3740` & `index.html:4815-4855` (direct Binance ticker poll, direct Forex Factory `nfs.faireconomy.media` fetch, direct Anthropic `api.anthropic.com` Journal AI fetch — disable browser Journal AI per `D6`)
  - `index.html:6510-6585` (`vtBnDirectCandles` `07480d9` fallback and any direct `vektor-market.tdmltd2026.workers.dev` URLs in `index.html` — all browser requests must go to same-origin `/api/*` and `/ws`)
  - `worker/` & `worker.js` / `functions/api/[[path]].js` (Task 20 cleanup: ensure no synthetic `source:"edge+sim"` or direct client third-party leak remains while keeping all existing tests passing)
  - `docs/support/KNOWLEDGE-BASE.md` & legal third-party/storage tables (`LG_SOURCES`, `LG_STORE` in `index.html` / `src/90_legal.js`)
- **Acceptance Criteria:**
  1. `VT_STRICT_MANDATE=1 node tests/no-client-math.test.mjs` passes **100% (`0` violations in `index.html`)**.
  2. `VT_STRICT_MANDATE=1 node tests/egress.test.mjs` passes **100% (`0` non-origin requests across `/`, `#/screener`, `#/heatmap`, `#/backtest`, `#/journal`)**.
  3. `node tests/jai.js`, `node tests/legal.js`, `node tests/accounts.js`, and `node tests/signin.js` all exit `0`.
  4. Commit on `argon` as `feat(argon-03): eliminate all third-party browser egress, IndexedDB cache, and BYO keys`.

---

### Ticket `ARGON-04`: Wire Pre-Launch Waitlist & Products Landing Module (`src/landing.js` + `src/landing.css`)
- **Status:** `READY_FOR_BUILD`
- **Skills to Apply:** `.agents/skills/apple-design/SKILL.md`, `.agents/skills/emil-design-eng/SKILL.md`, `.agents/skills/impeccable/SKILL.md`, `.agents/skills/humanizer/SKILL.md`, `.agents/skills/addy-web-accessibility/SKILL.md`
- **Target Files & Line Ranges:**
  - `index.html:20-25` & `index.html:1158-1164`: Link `<link rel="stylesheet" href="src/landing.css">` and `<script type="module" src="src/landing.js"></script>`.
  - `_routes.json:1-21`: Add `"/src/landing.css"` and `"/src/landing.js"` to `exclude` so they are served as zero-cost static assets.
  - `src/landing.js:1975-2037`: Verify route handling so `#/landing`, `#/waitlist`, `#/pricing`, and `#/products/<slug>` mount the landing view cleanly without interfering with the default terminal workspace routes (`#`, `#charts`, `#screener`, `#heatmap`, `#backtest`, `#journal`, `#auth`) or breaking any existing Playwright tests.
  - `src/auth_ui.js`: Add a Waitlist tab or count viewer inside the Admin modal (`#vtAdminBtn`) wired to `GET /api/admin/waitlist`.
- **Acceptance Criteria:**
  1. Navigating to `#/landing`, `#/pricing`, and `#/products/supercharts` renders the institutional landing/product pages with `0` console errors, `0` horizontal overflow on `375×812`, and working `POST /api/waitlist` submission.
  2. Default terminal routes and all existing Playwright suites (`tests/signin.js`, `tests/layout.js`, `tests/a11y.js`, `tests/mobile.js`, `tests/seo.js`) continue to pass 100%.
  3. Commit on `argon` as `feat(argon-04): wire institutional landing, products pages, and admin waitlist viewer`.

---

### Ticket `ARGON-05`: Full Regression Suite, Pass 3 Playwright Visual/DOM Audit (`1440×900` & `375×812`) & `ARGON_HANDOFF.md`
- **Status:** `READY_FOR_BUILD`
- **Skills to Apply:** `.agents/skills/apple-institutional-design/SKILL.md`, `.agents/skills/review-animations/SKILL.md`, `.agents/skills/ecc-e2e-testing/SKILL.md`, `.agents/skills/ecc-frontend-a11y/SKILL.md`
- **Target Files:**
  - `docs/ui/AUDIT-2026-11-19.md` (append Pass 3 verification telemetry table & screenshot sign-off)
  - `STATE.md`, `docs/architecture/TASKS.md`, `.agents/LOOP-STATE.md`
  - `ARGON_HANDOFF.md` (new file in repo root)
- **Acceptance Criteria:**
  1. `npm.cmd test` passes **100%** across all test files (59/59 suites including `waitlist-server.test.mjs`).
  2. `VT_STRICT_MANDATE=1 node tests/no-client-math.test.mjs` and `VT_STRICT_MANDATE=1 node tests/egress.test.mjs` both pass **100%**.
  3. `.\node_modules\.bin\wrangler.cmd deploy --dry-run` in `workers/market` succeeds.
  4. Desktop (`1440×900`) and Phone (`375×812`) Playwright audit verifies `0` pageerrors, `0` console errors, `0` horizontal overflow, and `0` High/Medium visual defects across Workspace, Supercharts, Screener, Heatmap, Backtest/Replay, Journal, and `#/landing`.
  5. Write comprehensive `ARGON_HANDOFF.md` for Neon's final Gatekeeper review and commit on `argon` as `docs(argon-05): complete Pass 3 visual audit and log ARGON_HANDOFF.md`.
