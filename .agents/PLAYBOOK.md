# Vektor Terminal — AI Delegation Playbook

> **The Loop Rule:** Whenever an error, visual flaw, or regression happens, do NOT just patch it in chat—add a permanent rule under **Learned Guardrails** below so the system never repeats the mistake.

## 1. Goal
Transform `tdmdne/Screener` (Vektor Terminal) into an **institutional-grade, Apple-smooth, 100% backend-driven trading terminal & screener** (inspired by Apple HIG fluidity + Koyfin, Bloomberg, Trade Ideas, TradingView, and FX Replay):
- **Zero Frontend Logic:** Browser is display-only; all ingestion, candles, indicators, Vektor Script, screener P1–P5, heatmap maths, replay fills, alerts, and journal analytics run on the Cloudflare edge backend.
- **Calm, Sleek Institutional Craft:** Zero busyness, zero demo feel, instant loading via one-request `/api/bootstrap` + `/ws` v2, crisp dark obsidian surfaces, `tabular-nums`, silky micro-interactions.

## 2. Toolbox (Always Reuse—Never Reinvent)
- **Design, Motion & Audit Skills:** `.agents/skills/apple-design/SKILL.md` (128 Apple HIG refs), `.agents/skills/emil-design-eng/SKILL.md`, `.agents/skills/impeccable/SKILL.md`, `.agents/skills/taste-skill/SKILL.md`, `.agents/skills/improve-animations/SKILL.md`, `.agents/skills/review-animations/SKILL.md`, `.agents/skills/gestures/SKILL.md`, `.agents/skills/animation-performance/SKILL.md`, `.agents/skills/apple-institutional-design/SKILL.md`
- **Engineering, Security & QA Skills (pinned `affaan-m/ECC @ 3f14a103`, markdown-only, zero hooks/scripts):** `.agents/skills/ecc-security-review/SKILL.md`, `.agents/skills/ecc-web-perimeter-owasp-2025-audit/SKILL.md`, `.agents/skills/ecc-verification-loop/SKILL.md`, `.agents/skills/ecc-e2e-testing/SKILL.md`, `.agents/skills/ecc-frontend-a11y/SKILL.md`, `.agents/skills/ecc-api-design/SKILL.md`, `.agents/skills/ecc-backend-patterns/SKILL.md`
- **Copy & Writing Skill:** `.agents/skills/humanizer/SKILL.md` (mandatory for all user-facing copy: landing pages, FAQs, knowledge base, onboarding, empty states, and error messages — zero AI-sounding filler)
- **Toolbox Cheatsheets:** `.agents/toolbox/emil-ui-cheatsheet.md`, `.agents/toolbox/emil-performance-cheatsheet.md`, `.agents/toolbox/style-guide.md`
- **Loop Protocol Skill:** `.agents/skills/vektor-loop/SKILL.md`
- **Design Tokens & Style Guide:** `.agents/toolbox/style-guide.md`
- **Backend Shared Modules:** `shared/market/candles.js`, `shared/market/indicators.js`, `shared/market/screener.js`, `shared/protocol.js`, `shared/vs/`, `shared/journal.js`
- **Cloudflare Edge Data Worker:** `workers/market/` (`MarketHub` DO, `TdBudget` DO, SQLite hot store, KV `<900/day` budget guard)
- **Test Harness & Runner:** `scripts/run-tests.js`, `tests/harness.js`
- **Visual Audit Baseline:** `docs/ui/AUDIT-2026-11-19.md`

## 3. Non-Negotiable Rules
1. **Zero Frontend Logic (`AGENTS.md` §0):** No direct third-party fetches, no client market maths, no IndexedDB market caches, no synthetic/simulated prices (`source:"edge+sim"` forbidden).
2. **No Paywalls / Fair Free Tier (`AGENTS.md` §3):** Free = 3 charts, 3 indicators (VS counts), 3 alerts; unlimited P1–P5 screener, backtest/replay, heatmap, journal.
3. **Approved Architecture Decisions (`AUDIT.md` §4):** D1 (Twelve Data single feed incl. crypto), D4 (signed-in D1 / guests in memory), D5 (user tools server-side), D6 (disable browser Journal AI), D7 (pure client rendering only), D8 (remove BYO keys).
4. **Spend Gate:** Stay on $0 Workers Free through Tasks 1–5; confirm explicitly with Tyler before enabling Workers Paid ($5/mo) or Twelve Data Venture.
5. **Git Gate:** Repo-local author `Antigravity <antigravity@users.noreply.github.com>`. Full autonomy on feature branches (commits, tests, audits, iteration); **ONLY stop to ask Tyler before pushing/merging to `main`** (and before any paid spend).
6. **Zero Forbidden Frameworks:** No React, Tailwind, Vue, Angular, Bootstrap, or jQuery.

## 4. `DONE MEANS` (Proof Checklist — Every Box Must Pass)
- [ ] `npm.cmd test` exits `0` with **100% passing tests** (all existing 43 suites + new backend/protocol/egress/no-client-math suites)
- [ ] **0 pageerrors** and **0 console errors** across all views on Desktop (`1440×900`) and Phone (`375×812`)
- [ ] **0 horizontal overflow** on Phone (`375×812` & `390×844`) across every route with safety clip disabled
- [ ] **0 non-origin third-party requests** from the browser (`tests/egress.test.mjs` green)
- [ ] **0 High/Medium visual or UX defects** in `qa-auditor` Playwright inspection against `apple-institutional-design/SKILL.md` (Supercharts, Screener, Heatmap, Backtest/Replay, Journal, Workspace)
- [ ] `workers/market` passes `wrangler deploy --dry-run` with zero secrets in tracked files
- [ ] `STATE.md`, `docs/architecture/TASKS.md`, and `.agents/LOOP-STATE.md` updated concisely

## 5. Learned Guardrails (Self-Improving Log)
- **2026-11-19 (Windows npm):** PowerShell blocks `npm.ps1`; always invoke `npm.cmd`, `npx.cmd`, `.\node_modules\.bin\wrangler.cmd`, and `.\node_modules\.bin\playwright.cmd`.
- **2026-11-19 (`--no-save` pruning):** Running `npm.cmd install --no-save <single-pkg>` prunes previously `--no-save`-installed packages. Always install `playwright wrangler axe-core` together in one command and remove untracked `package-lock.json`.
- **2026-11-19 (Windows CRLF tests):** Normalize `\r\n` to `\n` in hash/regex file tests (`tests/scorefns.js`, `tests/seo.js`) so Windows checkouts match Linux CI.
- **2026-11-19 (Guest sign-in legacy check):** `vtLegacyCheck()` must fire after an in-place guest → signed-in transition when `BOOTED === true`, not only inside `boot()`.
- **2026-11-19 (Canvas right-click occlusion):** Never render an oversized opaque floating indicator box at the top-left of `#cv` — it blocks candlesticks on phone AND intercepts canvas context-menu clicks (`tests/postool.js`). Use a compact inline transparent single-line legend with `pointer-events: none` on non-interactive wrappers.
- **2026-11-19 (`axe-core` button labels):** Interactive `.hmt` heatmap tiles and `.mc` minichart buttons must have `aria-label` that starts with / contains their visible text (never trigger `label-content-name-mismatch`).
- **2026-11-19 (Workers DO security & scale):** Always cap user-supplied indicator periods (`<= 1000`) & counts (`<= 24`), enforce recursion depth across ALL parser/evaluator paths, use `Object.create(null)` for dynamic JS maps (zero `__proto__` pollution), use `crypto.randomUUID()` for Hibernation WS client IDs, persist `att.seq` on every outbound frame, acquire KV throttle locks synchronously before `await kv.put`, and persist DO SQLite bars on bar-close only (never per tick).
- **2026-11-19 (Retroactive Skill Upgrades):** Whenever Tyler installs a new skill, read its `README.md`/`SKILL.md`, map it to every stage where it applies, and re-run a targeted upgrade pass on previously completed work so the entire app levels up uniformly.
