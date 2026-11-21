# STATE: Vektor Terminal (update after every completed step; 1 line each)

**Now (18 Nov 2026, 22:05 GMT):**
- The app is live at screener-cso.pages.dev; launch is 1 March 2027.
- Tyler's **Zero Frontend Logic** mandate is adopted (`AGENTS.md` §0). We're building the backend pipeline from Task 1 (`docs/architecture/TASKS.md`).
- Tests: 37 of 42 pass. 5 real bugs are left: a11y/minicharts labels, mobile `#vnav` overflow, motion, postool.

## Done
- Legacy TASK-01 shared catalogs/normalizer; TASK-06 starter watchlist + ★/+Watchlist/Locate (`143f02a`).
- vektor-market Worker live; the Twelve Data key is server-side only (`936013f`).
- Public-file allowlist: repo internals return 404 (PR #12, `8241661`).
- KB fixes, pricing and Free tier (PRs #9, #10, #11); Free = 3 charts/3 indicators (VS counts)/3 alerts; backtesting, replay, heatmaps and the journal are unlimited.
- PR #8 final UK legal pages merged as `ce4cae4`.
- PR #13 test fixes merged as `c2bea20` (37/42 passing).
- PR #14 Elite trial eligibility in the legal pages + btRun notes (`fb0d608`).
- Backend-mandate audit + backend-first task list + compact AGENTS.md (this PR).
- PR #17: leftover client Twelve Data key helpers (`vtTdKey` / `vt_tdkey~`) removed; a one-time cleanup deletes leftover keys and never sends them; keys stay on the vektor-market Worker only.

- 18 Nov: AGENTS.md §6 Institutional UI/UX standard + recurring UI Audit phase (TradingView/Tradovate/FX Replay benchmark).
- 19 Nov: Phase 1+2 checkpoint on `feat/phase-a-backend-core` — full backend pipeline (`workers/market/` + `MarketHub` DO live w/ 50ms CPU cap, `shared/market/*`, `shared/vs/`, `shared/protocol.js`, `shared/alerts.js`, `shared/replay.js`, `shared/journal.js`), D1 Auth/OAuth/Admin RBAC live on `tdm-screener`, both security re-audits PASS, institutional UI overhaul (`src/98_institutional.css`), all 58/58 test suites green.
- 19 Nov: Phase 3A/3B on `feat/phase-a-backend-core` — `src/auth_ui.js` (security PASS: D1 Login/Signup/OAuth/Complete-Profile/Admin panel), self-hosted `/vendor/lwc.js` + `/vendor/h2c.js` (0 CDN egress), removed fake chart BUY/SELL overlay buttons, added glassy draggable 4-way resizable desktop modals (`src/window_manager.js`), preview live at `feat-phase-a-backend-core.screener-cso.pages.dev`.
- 19 Nov: Neon Gatekeeper audit complete — salvaged pre-launch D1 Waitlist (`shared/waitlist.js`, `migrations/0002_waitlist.sql`, 7/7 tests green), staged landing/products UI (`src/landing.js`, `src/landing.css`), and 36 skill packs; codified Neon/Argon delegation protocol (`AGENTS.md` §7) and queued scoped monolith-cutover tickets `ARGON-01`..`ARGON-05` in `DISPATCH.md`.
- 19 Nov: Argon execution sprint on `argon` branch — wired `src/data_service.js`, `src/landing.js`, `src/landing.css`, and `_routes.json`; added Admin Waitlist tab in `src/auth_ui.js`; removed all 12 `Math.random()` occurrences in `index.html`; locked runtime edge egress so `tests/egress.test.mjs --strict-egress` passes 4/4 (0 non-origin requests); completed Pass 3 visual/DOM audit (`docs/ui/AUDIT-2026-11-19.md`) and logged `ARGON_HANDOFF.md` + `NEON_WAKEUP_PROMPT.md` for Neon's 13:15 reset.
- 19 Nov: Argon UI/UX revamp on `argon` branch — dedicated Sign Up route (`#/signup`) + Create Account buttons (`src/auth_ui.js`, `src/landing.js`), renamed Supercharts to VektorCharts, auto-responsive viewport layout (`#uim` toggle removed), replaced Data button with Screener Settings (`scrSetM`), added Liquid Glass Features & Menu dropdowns in header + fixed-position chart header popovers, collapsible vertical indicator stack with badge count (`togIndStack`), and FX Replay backtest cockpit upgrades (Move SL to BE, Close 50%, risk presets, tabs).
- 20 Nov: PR `chore/verify-ws-pipeline` — shared `BinanceMiniTickerFeed` (backoff, 24h rotation, serverShutdown, stall watchdog) wired into the vektor-market hub; `CRYPTO_PROVIDER=binance|twelvedata` toggle (default binance, crypto exempt from TD_WS_MAX); `/ws` status frames carry `RECONNECTING` + per-feed health and the `#dst` badge binds to them; ratchet guard `tests/screener-server-side-guard.test.mjs` (browser screener maths still 40 refs = Task 13).
- 20 Nov: fix/fx-candle-rendering: FX bars open at the previous close again (builder `openMode:"auto"` + client `vtNewBarOpen`), so sparse one-tick FX bars are no longer flat O=H=L=C dashes; crypto/equities stay tick-open; tests `fx-candles.test.mjs` + `fx-chart.js`; harness serves FX.
- 20 Nov: test/port-remaining-browser-suites: 11 legacy browser suites moved off BNWS/__WS onto harness `VT_EDGE.ws` + same-origin mocks with zero off-origin assertions; 6 pass (heatmap, legal, privacy, router, sound, supercharts); accounts/signin/templates/mobile/summary-mobile fail on product drift (see PR).
- 20 Nov: fix/twelvedata-ws-and-browser-suites: Twelve Data hub keeps one persistent outbound WS (keepalive, heartbeat, backoff, error frames) and serves it to `worker.js` via `/api/quotes`, so no TD REST `/quote` for live prices; mobile/summary/accounts/signin/templates/email_ui/watchlist_starter/mobile_qa suites fixed (D1 sign-in now reloads into the account scope; terminal routes open the edge WS); 11 older browser suites still fail on origin/main (see PR).
- 20 Nov: fix/backfill-intermediate-timeframe-candles: `/api/candles` now backfills 5m/30m/1H/4H/custom (3m, 45m, 2H, 12H, 2D, 3M …) from Twelve Data REST `/time_series`, caches it server-side, resamples custom intervals in the backend and overlays the hub's live WS bars (no gaps, no duplicates); one shared interval normalizer (`resolveInterval`); hub builds 1M and custom live bars; tests `intervals`, `candle-backfill`, `hub-custom-tf`.
- 20 Nov: fix/1m-ohlc-and-15m-30m-4h-history: prod history was 100% Yahoo because worker.js never sent `X-Vektor-Internal` to vektor-market `/td/*` (and `INTERNAL_TD_SECRET` is unset on both sides) -> 403; Yahoo FX 1m is O=H=L=C (flat dashes) and Yahoo failures dropped 15m/30m/4H to the hub's 1 bar. Now: header sent, flat Yahoo series rejected, flat REST bars never overwrite real hub candles, last-good history served on upstream failure; test `candle-ohlc-history`. **Needs `INTERNAL_TD_SECRET` set on Pages + vektor-market.** Follow-up: TdBudget is metering-only (no 8/min / 800/day 429s); client no longer seeds `LIVE[k]` with a one-tick bar (which made need() skip REST history) and pumpEdge merges instead of replacing; test `chart-live-merge`.
- 20 Nov: fix/crypto-history-binance-only: crypto is Binance only (history, replay, quotes, screener rows; no Yahoo). Measured from a Worker in MAN: data-api.binance.vision and api[1-4].binance.com return 403 to Cloudflare, so api-gcp.binance.com goes first and 403/418/429 try the next mirror. The hub is asked for `BTCUSDT`, not `BTC/USD` (which held 0 bars), so crypto history gets the live overlay again. Cached non-Binance crypto entries are ignored. Test `crypto-binance-only`.
- 20 Nov: fix/single-feed-per-asset: one feed per asset (`shared/market/feedRouting.js`): Twelve Data for FX/stocks/ETFs/metals/indices, Binance for crypto, Yahoo for futures and symbols TD doesn't carry. No cross-feed fallback, and replay no longer uses Dukascopy. TD slots are a server-side LRU pool in the hub (`TD_WS_MAX`): evicted and non-streamed symbols serve a cached TD quote (SQLite `quote_cache`, written on eviction and per closed 1m bar) with prev close and % change from the hub's TD daily bars. Root causes: prod TD REST answered 429 so history fell back to Yahoo; previews lacked `INTERNAL_TD_SECRET` (now synced on vektor-market + Pages prod/preview, local copy in `.dev.vars`).
- 20 Nov: feat/tasks-9-11-bootstrap-server-indicators: the chart is a dumb terminal. `/api/candles?ind=` returns bars plus warmed server indicator series in one request (`shared/market/chartIndicators.js`, shared with the hub). Live candles are hub `bar` frames rendered verbatim; closed-bar indicator values come from hub `ind` frames (`src/vt_13_server_indicators.js`). The client no longer builds candles from ticks, and `vtBuildChartData`/`vtMergeBars`/`vtNewBarOpen`/`94_edge_client.js` are gone. Preview verified with 3 live symbols (needed PR #28, vektor-market `ALLOWED_ORIGINS` += `*.screener-cso.pages.dev`, deployed as `6fcd36b2`). Merged as `f0395c4` (PR #27); prod verified 21 Nov, Task 11 ticked. The crypto history step was fixed by #29 (Binance only).

## Elite trial rules (Tyler, confirmed)
- 7 days, Elite only, card upfront, converts to paid after 7 days.
- One trial per person. A card that already had a trial gets no trial and is offered Elite without one.
- Cancelling during the trial keeps Elite until the trial ends, with no charge.
- Emails are normalised by removing `+tags` on every domain before the one-per-person check.

## Next
- Task 1: bring vektor-market into `workers/market/` (Claude Sonnet, after the 00:40 GMT Claude reset).
- First UI Audit pass (Claude Sonnet + Playwright) → `docs/ui/AUDIT-2026-11-19.md`.
- Fix the 5 failing test bugs (Mara).
- Accounts (Dex, legacy TASK-04 = ACC dependency).
- Tyler decisions D1–D8 (`docs/architecture/AUDIT.md` §4): crypto source, Workers Paid, TD Venture timing.
