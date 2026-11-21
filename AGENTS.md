# VEKTOR TERMINAL (`tdmdne/Screener`): AGENT DIRECTIVES (index)

> **Product goal (Tyler, 21 Nov 2026):** Vektor Terminal is a lag-free, institutional-grade charting and screening platform that delivers more capability than TradingView at less than half the price. It is built on **60fps zero-lag client rendering** (canvas drawing, pan/zoom/crosshair, local panel state, WS frame dispatch) and **100% server-side intelligence** (bars, transforms, indicators, alerts, screening, backtests, paper fills), so unit costs stay tiny as we scale. One upstream stream per symbol fans out to unlimited browsers; upstream subscribe/unsubscribe stays inside the Twelve Data event budget (`shared/market/tdThrottle.js`).

This is a short index, so read it in full. The detail lives in the linked docs: open only the one your task names. **Never put secrets in any repo file.** AGENTS.md is no longer served publicly (PR #12), but the repo is shared.

## 0. NON-NEGOTIABLE: ZERO FRONTEND LOGIC (Tyler, 18 Nov 2026)
The browser is a **dumb terminal, a presentation layer only**.
- **No direct external API calls from the browser.** Its only network peer is our own origin (`/api/*`, `/ws`).
- **No client-side** data deduplication, candle aggregation, indicator calculations, Vektor Script execution, screener filtering (P1–P5), heatmap maths, alert evaluation or synthetic/sample data.
- **No heavy client-side caching.** localStorage is for UI layout and theme preferences only. No IndexedDB or TTL caches of market data.
- **100% backend pipeline (Cloudflare edge):**
  1. A **Durable Object hub** holds the single server-side WebSocket to the market-data provider and ingests ticks, builds candles, runs indicator maths and evaluates screener filters in real time.
  2. **KV / D1 (R2 later)** cache precomputed bars and screener snapshots, so the app opens with complete chart and watchlist state in **one request**.
  3. The frontend connects **only** to our Worker over **one WebSocket** and receives precomputed, render-ready payloads.
- **Any change that adds browser-side data logic, or a non-origin request, is rejected in review.** Target design, the `dataService.js` plan and data routing: `docs/architecture/ARCHITECTURE.md`. Current violations: `docs/architecture/AUDIT.md`.

## 1. Token discipline (Tyler's permanent rule)
- No full-history or whole-codebase reads. Read **only** `AGENTS.md`, `STATE.md`, and the files or **line ranges** your task names (`index.html` is ~7,200 lines, so never read it whole).
- Use `rg` to find a function by name, then read just that range.
- After each completed step, add **one 1-line bullet** to `STATE.md` (Done or Next). Keep STATE.md under 50 lines by collapsing old bullets.
- One task per fresh session. **Claude Sonnet** by default; **Opus** only for complex debugging or core architecture. **Gemini** reads long docs and audits and returns compact bullets. **Grok** plans, reviews, deploys and verifies (`/workspace/repos/AI-RULES.md`).
- No pay-as-you-go API credits, ever. Nothing paid is set up without Tyler's approval.

## 2. Project and repo map
- **Product:** multi-asset trading terminal: charts, screener (P1–P5), watchlists, alerts, heatmaps, journal, manual backtest and replay, Vektor Script. Launch: **1 March 2027**.
- `index.html`: the legacy monolith that runs in production (inline script from line ~1162).
- `src/`: extracted modules (most aren't loaded yet).
- `shared/`: pure logic shared by the backends.
- `client/services/`: browser transport.
- `functions/`: Pages Functions (`/api/*` and the public-file allowlist middleware).
- `worker.js`: the edge API behind the Pages Function.
- `workers/market/`: the vektor-market data Worker + hub (Task 1).
- `worker/`: deprecated.
- `server.js`: local dev only.
- `tests/`: Node test scripts (`npm test`).
- **Docs:**
  - `STATE.md`: status, done and next.
  - `docs/architecture/`: ARCHITECTURE, AUDIT, TASKS, HISTORY, PROTOCOL (Task 8).
  - `docs/agents/STANDARDS.md`: coding, UI, security, SEO, git and workflow rules.
  - `docs/support/KNOWLEDGE-BASE.md`: the support bot's KB (Chris).
  - `docs/legal/`: legal pages and the review checklist.

## 3. Hard boundaries and "never break"
- **Monolith:** don't add features, fetchers, scoring rules or inline CSS to `index.html`. **Deleting client logic from it is required** under §0 (one task at a time, verified live).
- **Single source of truth:** catalogs, intervals, normalizers and all market maths live in `shared/` and are imported by the backends. Never duplicate them.
- **Storage keys:** keep reading `scr2~<account_hash>~*` exactly as they are until Task 15 migrates that data to the server (one-time import, then the local copy is deleted). Never wipe it before a server ack.
- **No artificial candle clamping:** fix bad ticks at server ingestion or switch provider, never in UI code.
- **XSS safety:** no `innerHTML` with dynamic or user data in new code; use `createElement`/`textContent`.
- **NO PAYWALLS / DARK PATTERNS:** The Vektor Script editor and language must remain available on Free, but Vektor Script indicators count toward Free's 3-indicator limit. P1–P5 tiering must remain unrestricted. Backtesting and bar replay must never be paywalled or limited, and heatmaps and the journal are included on Free and must remain unrestricted. The approved Free limits — 3 charts, 3 indicators, and 3 alerts — are allowed.
- **Never break:** chart rendering, replay/backtesting, watchlists, journal, drawing tools, keyboard shortcuts, theme switching, existing users' saved data.

## 4. Task list (backend-first). Details, files, line ranges, AI and acceptance criteria: `docs/architecture/TASKS.md`
- **Dependencies (not Claude tasks):**
  - **ACC:** accounts on D1 (Dex, legacy TASK-04).
  - **TRIAL:** Elite 7-day trial (rules in STATE.md).
  - 💷 **D2:** Workers Paid.
  - 💷 **D3:** Twelve Data Venture.
- **Phase A, server pipeline:**
  - Task 1: data Worker into the repo, one hub.
  - Task 2: DO ingestion hub (one upstream WS).
  - Task 3: candle builder.
  - Task 4: bar/snapshot store.
  - Task 5: indicators.
  - Task 6: Vektor Script runtime 💷D2.
  - Task 7: screener + P1–P5 + heatmap values.
  - Task 8: WS protocol and payload schema.
  - Task 9: one-request bootstrap.
- **Phase B, strip the client (each step verified live):**
  - Task 10: thin `dataService.js`.
  - Task 11: chart from server bars and indicators.
  - Task 12: VS runs on the server.
  - Task 13: screener and heatmap from the server.
  - Task 14: remove all direct third-party fetches (incl. the `07480d9` Binance fallback).
  - Task 15: storage = UI prefs only (ACC).
  - Task 16: mandate tests in CI (build right after Task 10).
- **Phase C, user tools:**
  - Task 17: server alerts (ACC).
  - Task 18: replay and backtest fills.
  - Task 19: journal and prop stats (ACC).
- **Phase D:** Task 20: delete the deprecated backends.
- **UI-AUDIT (recurring, §6):** a UI review pass runs before any feature is marked complete, and a full-app audit runs once per phase.
- **UI carry-overs:** UI-07 six-column screener, UI-08 replay window, UI-09/10 monolith decomposition.
- **History:** completed legacy tasks (TASK-01, TASK-06) and the old backlog are in `docs/architecture/HISTORY.md`.

## 5. Verification checklist (before closing any task)
1. `npm test` passes with zero console errors or unhandled rejections, including the mandate tests once Task 16 lands: **no request to any non-origin host, no banned client maths**.
2. Saved user data still loads for guests and signed-in accounts (`scr2~*` until Task 15, then the server).
3. Mobile layout (`data-ui="phone"`) has zero horizontal overflow.
4. Verified on a preview deploy, then live after merge. Tick the task in TASKS.md and add a 1-line bullet to STATE.md.
5. **UI Audit pass (§6)** is done for every UI-touching task: Playwright screenshots and DOM checks against the live or preview site, all findings fixed or logged in STATE.md.
6. Open a PR. Never push to `main`.
7. Live smoke (preview or prod): `node tests/smoke-live.js <https url>` reads the smoke account from `smoke-creds.local.json` in the repo root (gitignored, never served; never print or commit it).

## 6. INSTITUTIONAL UI/UX STANDARD (Tyler, 18 Nov 2026)
- **Benchmark:** every screen, modal, chart overlay, watchlist, auth form and replay control must meet institutional trading-terminal standards, modelled on **TradingView**, **Tradovate** and **FX Replay**.
- **Design rules:**
  - High-density layout with crisp dark-mode contrast (WCAG AA minimum).
  - `font-variant-numeric: tabular-nums` and a monospace stack for every price, tick, size and PnL, so numbers never jitter.
  - Clean pane docking and resizing.
  - Consistent spacing scale and alignment, and no layout shift on updates.
  - Feedback under 100 ms for every click and hover; never more than 1 s.
  - No generic "AI-template" styling: no gradient blobs, oversized rounded cards, emoji UI or filler copy.
- **§0 still wins:** UI polish is presentation only. It must never add client-side data processing.
- **UI Audit workflow:** before any feature is marked complete, run a UI review pass. Playwright takes screenshots and runs DOM checks (desktop 1440×900 and phone 375×812) on the live or preview site. Claude (Sonnet, fresh session) reviews them against the benchmark, then fixes the problems in small single-task PRs that name the files and line ranges. A full-app audit runs once per phase. Findings go to `docs/ui/AUDIT-<date>.md`, with a 1-line summary in STATE.md.

## 7. NEON ORCHESTRATOR & ARGON DELEGATION PROTOCOL (Tyler, 19 Nov 2026)
- **Role separation:** **Gemini 4 Neon** is the **Lead Orchestrator & Final Gatekeeper**. **Gemini 4 Argon** is the **Execution Engine** operating on a separate 5-hour quota pool.
- **Token conservation on Neon:** Neon must never spawn large swarms of subagents for routine multi-file edits, monolith stripping, or broad searches on its own 5-hour pool. Neon focuses strictly on architecture, diff review, security/mandate auditing, and approval.
- **Scoped ticket dispatch (`DISPATCH.md`):** Neon assigns heavy/grunt execution work to Argon by writing scoped job tickets in `DISPATCH.md` under `## Assigned to Argon (READY_FOR_BUILD)` with exact file paths, line ranges, skill references, and acceptance criteria.
- **Argon branch isolation:** When Argon runs, it must branch off the active working branch into `argon` (`git checkout -b argon`), execute the `READY_FOR_BUILD` tickets in `DISPATCH.md`, commit cleanly on `argon` (never touching or pushing to `main`), and log every commit hash, modified file, test result, and edge case in `ARGON_HANDOFF.md`.
- **Gatekeeper review on Neon resume:** Whenever Neon resumes, Neon must inspect `git diff ..argon` and read `ARGON_HANDOFF.md` + `DISPATCH.md` to review, cherry-pick (`KEEP`), or discard (`REJECT / DROP`) Argon's changes—logging the decision in `DISPATCH.md` before queuing the next tickets.


