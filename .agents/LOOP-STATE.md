# LOOP-STATE — Vektor Terminal

**Active Branch:** `argon` (branched from `feat/phase-a-backend-core @ b647927`)  
**Current Iteration:** Iteration 5 — Argon Sprint Complete on `argon` (`VT_STRICT_MANDATE=1` Egress 4/4 PASS, 23/23 Unit/Contract Suites PASS, Landing/Waitlist Wired, Pass 3 Visual Audit Complete) → Ready for Neon 13:15 Gatekeeper Review (`ARGON_HANDOFF.md`)  
**Cloudflare Auth:** Connected (`tdmltd2026@gmail.com` / `a194413a6dac0210959f978ba97903e1`); Workers Paid ($5/mo) active with `50 ms` hard CPU cap; `vektorterminal.com` allowlisted on `vektor-market`.

## Queue
### Phase 0 — System & Baseline
- [x] GitHub connected (`tdmdne`), repo cloned, Git author set (`Antigravity`)
- [x] Loop infrastructure created (`.agents/PLAYBOOK.md`, `.agents/LOOP-STATE.md`, `apple-institutional-design` skill, `vektor-loop` skill, `style-guide.md`, `0 */2 * * *` auto-resume cron)
- [x] Baseline Playwright visual + DOM audit completed (`docs/ui/AUDIT-2026-11-19.md`)

### Phase 1 — Backend Core, D1 Auth/OAuth & Security Gates (100%)
- [x] **Tasks 1, 2, 4, 9:** `workers/market/` (`MarketHub` DO, SQLite 1,500-bar store, KV `<900/day` guard, `/api/bootstrap`, `/api/bars`, `/hub/stats`, `50 ms` CPU cap) — **DEPLOYED LIVE** (`9eaf31af`)
- [x] **Tasks 3, 5, 6, 7, 8:** `shared/market/candles.js`, `indicators.js`, `screener.js`, `shared/vs/`, `shared/protocol.js` + `PROTOCOL.md` — **ALL GREEN**
- [x] **Tasks 10, 16, 17, 18, 19:** `thinDataService.js`, `src/data_service.js`, `egress.test.mjs`, `no-client-math.test.mjs`, `shared/alerts.js`, `shared/replay.js`, `shared/journal.js`, `functions/ws.js`, `functions/api/[[path]].js` — **ALL GREEN**
- [x] **ACC (D1 Auth, Full Signup, Google/Apple Server-Side OAuth & Admin RBAC):** `migrations/0001_auth_and_user_data.sql` (**MIGRATED LIVE on `tdm-screener`**), `shared/auth.js`, `shared/authRoutes.js`, `tests/auth-server.test.mjs` — **15/15 PASS**
- [x] **Independent Security Re-Audits (2 gates):** Phase A/Front-Door/Thin-Client/Replay **PASS** + Auth/OAuth **PASS** (0 Critical, 0 High, 0 Medium)

### Phase 2 — Institutional UI/UX Overhaul & 58/58 Test Suite (100% Tests, Pass 3 Visual Verify Next)
- [x] `src/98_institutional.css` + `index.html` Apple × Koyfin/Bloomberg/Trade Ideas/FX Replay overhaul (Pass 1 + Pass 3 Polish)
- [x] All **58/58 test suites PASS** (`minicharts.js` 4.9ms, `motion.js` 7.7ms, `a11y.js` dark+light clean, `mobile.js` + `mobile_qa.js` 0 overflow & ≥44px targets, `postool`, `backtest`, `journal`, `screener`, `heatmap`, `supercharts`, `signin`, `layout`, `sweep`, `jai`)
- [x] Pass 3 `qa-auditor` final visual screenshot verification (`1440×900` & `375×812`)

### Phase 3 — Auth/OAuth UI & Zero-Egress Cutover
- [x] **Auth UI (`src/auth_ui.js` + `index.html`):** Real `/api/auth/login`, `/api/auth/register` (`full_name`, `username`, `dob` 18+, `phone` E.164, `email`, strong `password`), `/api/auth/providers` (Google & Apple buttons), `/api/auth/complete-profile` modal, `/api/auth/logout`, Admin panel (`#vtAdminBtn` Users + Waitlist tabs), and `/api/me/import` post-200 legacy `scr2~*` migration — **Security PASS + 8/8 Tests Green**
- [x] **Self-Hosted `/vendor/` & Window Manager:** `vendor/lwc.js` + `vendor/h2c.js` exact-allowlisted (0 `cdn.jsdelivr.net` egress), fake chart BUY/SELL buttons removed, glassy draggable 4-way resizable desktop modals (`src/window_manager.js`) verified via Playwright
- [x] **Zero-Egress Runtime Lock & Thin Transport (`src/data_service.js` + `index.html`):** Same-origin edge lock (`VT_STRICT_MANDATE=1 node tests/egress.test.mjs` **4/4 PASS** with 0 non-origin requests across `/`, `#/screener`, `#/heatmap`, `#/backtest`, `#/journal`), deterministic IDs & backdrop (`0` `Math.random()` occurrences in `index.html`), while preserving frozen baseline parity functions required by `tests/scorefns.js`, `tests/vs.test.mjs`, and `tests/screener-server.test.mjs`
- [x] **Custom UI/Motion Skills & Pre-Launch Waitlist Landing Pass (`src/landing.js`, `src/landing.css`, `shared/waitlist.js`):** 36 skill packs applied (`apple-design`, `emil-design-eng`, `impeccable`, `humanizer`, `addy-web-accessibility`, `ecc-*`), `#/landing`, `#/pricing`, `#/products/*`, `#/features/*` verified on `1440×900` & `375×812` with 0 overflow and 0 errors

### Phase 4 — Final Cloudflare Preview & Push-to-Main Confirmation
- [ ] Deploy Cloudflare Pages preview (`wrangler pages deploy` preview branch) & verify live
- [ ] Confirm with Tyler before pushing/merging to `main`
