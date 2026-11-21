# Backend-first task list (Zero Frontend Logic)

Adopted 18 Nov 2026 under Tyler's mandate (see `AGENTS.md` §0). This replaces the old TASK-01…TASK-10 backlog, which is kept as history in `docs/architecture/HISTORY.md`.
Evidence for every line range is in `docs/architecture/AUDIT.md`. The line numbers are for `main @ fb0d608`, so **re-find by function name before editing**.

**How to run a task**
- **One task per fresh session.** Read only `AGENTS.md`, `STATE.md`, this task's entry and the files/line ranges it names.
- **Who runs it:** **Claude Sonnet** writes routine code. **Claude Opus** only where marked (core architecture). **Gemini** reads and summarises long docs. **Grok** (Bruce/Dex) reviews, deploys, verifies live, and handles anything that touches Tyler's accounts.
- **Spend:** any task marked 💷 needs Tyler's spend approval before it starts. Nothing paid is set up without it.
- **When done:** add a 1-line bullet to `STATE.md`, tick the task here, open a PR (never push to `main`), and Grok verifies it on a preview before merge.

**Dependencies outside this list (not Claude tasks)**
- **ACC (Dex):** accounts, sessions and D1 users (legacy TASK-04). Tasks 15 and 17–19 need it.
- **TRIAL (Dex/Priya):** Elite 7-day trial, one per person (see `STATE.md`). Needs ACC and Stripe; it doesn't block any data task.
- **💷 D2 Workers Paid:** before Task 6 goes live (10 ms CPU cap on Free).
- **💷 D3 Twelve Data Venture:** before public display at scale (by Mon 15 Feb 2027).

---

## Phase A: Server pipeline (build on Workers Free)

- [x] **Task 1: Bring the data Worker into the repo and pick one hub.** *Claude Sonnet.*
  - **Read:** `/workspace/task02/vm/worker.prod.js` (all 230 lines; Grok copies it in), `worker/hubCore.js` (1-96), `worker/hub.js` (1-65), `worker/wrangler.toml`.
  - **Do:**
    - Create `workers/market/index.js` from `worker.prod.js` unchanged.
    - Add `workers/market/wrangler.toml`: name `vektor-market`; KV `MARKET_KV` = `vektor-market-cache` (`999790ad01b6464483f28060542fff68`); DO `TD_BUDGET` → `TdBudget` (SQLite); vars `TD_PER_MIN=8`, `TD_PER_DAY=800`; `ALLOWED_ORIGINS`; **no secrets in the file**.
    - Move `worker/hubCore.js` → `workers/market/hubCore.js`.
    - Mark `worker/` (vektor-proxy, never deployed) and `worker.js` `MarketRelayDO` (1212-1528) as deprecated in a header comment. Don't delete yet.
  - **Accept:**
    - `npx wrangler deploy --dry-run` in `workers/market` succeeds.
    - A diff against the deployed source shows no behaviour change.
    - New `tests/market-canonical.test.mjs` covers `canonical()` and `allowedOrigin()`.
    - `npm test` passes.

- [x] **Task 2: DO ingestion hub with one upstream WebSocket.** *Claude **Opus** (core architecture).*
  - **Read:** `workers/market/hubCore.js`, `workers/market/index.js` 97-109 (budget helpers), `shared/schema.js`, `shared/constants.js`, AUDIT.md §3.4.
  - **Do:**
    - `workers/market/hub.js` exports a `MarketHub` DO (SQLite) holding **one** outbound WS to `wss://ws.twelvedata.com/v1/quotes/price` (key from `env.TWELVEDATA_KEY`, sent as the `X-TD-APIKEY` header).
    - Heartbeat `{"action":"heartbeat"}` every 10 s.
    - `alarm()` every 30 s: re-arm, reconnect with exponential backoff if silent for more than 30 s or closed.
    - Desired subscriptions persist in SQLite (`subs(sym TEXT PRIMARY KEY)`), resubscribed on start.
    - Cap upstream symbols at `env.TD_WS_MAX` (8 on Basic trial).
    - Ticks go to `HubCore.onTick`.
    - Admin route `/hub/stats` (no secrets).
  - **Accept:**
    - Node tests with a fake WS cover reconnect, resubscribe after restart and the cap.
    - On a preview: 2 trial symbols stream for 30 min with ≤1 reconnect; `/hub/stats` shows them.
    - DO duration is visible in the dashboard and inside 13,000 GB-s/day.

- [x] **Task 3: Server candle builder.** *Claude Sonnet.*
  - **Read:** `index.html` 1606-1625 (`updateLiveBar`), 6407-6423 (`vtMergeBars`), 6902-6984 (`vtApplyTwelveDataTick`), `shared/intervals.js`, `shared/schema.js`.
  - **Do:**
    - Pure module `shared/market/candles.js`: `applyTick(state, tick)` builds 1m bars.
    - `rollup(bars1m, tf)` builds 5m/15m/30m/1H/4H/1D/1W/1M.
    - `mergeBars(old, incoming)`: dedup by `t`, sorted, no clamping (AGENTS §3).
    - Gap rule: a new bucket more than 2 steps away starts a new bar, with no synthetic fill.
    - Volume from REST reconciliation only (the TD WS has none for FX/crypto).
    - Hub wires ticks → builder; on bar close emits `bar` events.
  - **Accept:**
    - `tests/candles.test.mjs` has golden cases ported from the three client functions (same outputs for the same inputs).
    - No `Math.random`; no synthetic bars.

- [x] **Task 4: Bar and snapshot store.** *Claude Sonnet.*
  - **Read:** `workers/market/index.js` 111-171 (`handleTd`, KV pattern), AUDIT.md §3.3.
  - **Do:**
    - **Hot store in DO SQLite:** `bars(sym, tf, t, o, h, l, c, v, PRIMARY KEY(sym, tf, t))`, keeping the last 1,500 bars per sym/tf (trim on insert).
    - Backfill via TD `time_series` through `TdBudget` (1 credit per symbol).
    - **KV only for** (a) immutable closed history chunks keyed `bars:{sym}:{tf}:{yyyymm}`, written once, and (b) the bootstrap snapshot `snap:v1`, written at most every 5 min.
    - Write counter in DO storage; refuse KV writes after 900 per UTC day (Free cap 1,000).
    - Stop `handleTd` writing KV for live TTL responses (Cache API instead).
    - **No R2** (not enabled; needs a payment method).
  - **Accept:**
    - Tests cover trim, dedup and the write-budget guard.
    - On a preview: a cold start serves 1,500 bars for one symbol/tf from SQLite in one call.
    - KV writes per day are visible and under 900.

- [x] **Task 5: Server-side indicators.** *Claude Sonnet.*
  - **Read:** `index.html` 1295-1317 (`cc`, `ma`, `calc`), 1580-1587 (`emaArr`, `smaArr`, `atrArr`, `rsiArr`), 1637-1712 (how the chart applies them, including Bollinger offsets 1662-1673).
  - **Do:**
    - `shared/market/indicators.js` (pure, Float64Array), with incremental update on bar close.
    - The hub computes the series for subscribed (sym, tf, indicator config) and keeps the last value per bar.
  - **Accept:**
    - `tests/indicators.test.mjs` matches the client outputs to 1e-9 on recorded bars.
    - Per-bar-close CPU is measured and logged. If any invocation goes over 8 ms on Free, Grok flags D2 before continuing.

- [x] **Task 6: Vektor Script runtime on the server.** *Claude Sonnet* (a port with golden tests; Opus only if the sandbox design needs changing). 💷 **D2 must be approved before this goes live.**
  - **Read:** `index.html` 4196-4244 (`vsLex`, `vsParse`), 4250-4288 (`vsSMA`, `vsEMA`, `VS_FN`), 4289-4345 (`vsRun`), 4367-4368 (`vsCompute`); `src/47_vs_engine.js` (mirror; diff only).
  - **Do:**
    - Move the engine to `shared/vs/` (lexer, parser, runtime, builtins), unchanged semantics and limits (`VS_LIM`).
    - The server runs scripts on bars from Task 4 and returns series and errors with line/col.
    - Script source is stored per user in D1 (**needs ACC**). Guests send the source per session and it isn't stored (D4).
    - Results are cached by `hash(src, inputs, sym, tf, lastBarT)`.
  - **Accept:**
    - `tests/vs.test.mjs` golden outputs for all 29 built-ins match the client.
    - A runaway script is stopped by the limits.
    - An error payload carries line, col and hint.

- [x] **Task 7: Server-side screener, P1–P5 and heatmap values.** *Claude Sonnet.* (Full universe needs 💷 D2 and 💷 D3.)
  - **Read:** `index.html` 1327-1439 (`scoreSymbol`, `rows`, `scoreMarket`, `passesPreset`), 3609-3617 (`sxTier`, `sxPct`, `sxAdr`, `Expansion`/`Tier` columns), 3882-3891 (`hmTradedValue`, `hmChg`, `hmVal`); `worker.js` 123-169 (`buildScreenerSnapshot`, which simulates non-crypto).
  - **Do:**
    - `shared/market/screener.js`: per-symbol metrics, score, phase, expansion, tier, and the heatmap metric (% vs previous close for 1H/4H/1D/1W, momentum, score, traded value).
    - The hub recomputes on bar close and writes snapshot rows to SQLite. Task 4 publishes `snap:v1`.
    - **Delete the synthetic non-crypto path.** Symbols without real data are omitted, never simulated.
  - **Accept:**
    - `tests/screener-server.test.mjs` gives identical tiers and scores to the client on recorded bars.
    - The snapshot carries `source` and `asOf` per row.
    - No `source:"edge+sim"` anywhere.

- [x] **Task 8: Client WebSocket protocol and versioned payload schema.** *Claude **Opus**.*
  - **Read:** `client/services/dataService.js` (1-125), `worker/hub.js` header (1-4), `shared/schema.js`, AUDIT.md §3.4 (size budget).
  - **Do:**
    - Write `shared/protocol.js` + `docs/architecture/PROTOCOL.md`, protocol `v: 2`.
    - Client → server ops: `hello{v, session}`, `view{chart:{sym, tf, ind:[…], vs:[ids]}, watchlist:[…], screener:{preset, page}, heatmap:{metric, tf, n}}`, `ping`.
    - Server → client frames: `hello`, `state` (full), `bar` (delta), `ind` (delta), `vs` (series/error), `quotes`, `screener` (page), `heatmap` (tiles with values and weights), `status{provenance: LIVE|DELAYED|CACHED|UNAVAILABLE, asOf}`, `error`.
    - Every frame has `v` and `seq`.
    - Budgets: live frame ≤2 KB, `state` ≤150 KB gzipped, ≤50 screener rows per frame.
    - Front door: `/ws` on the Pages Function forwards to the hub (service binding to `vektor-market`).
    - Hub accepts browser sockets with the **Hibernation API** (`ctx.acceptWebSocket`, `serializeAttachment`, `setWebSocketAutoResponse`), replacing `server.accept()` + `setInterval`.
  - **Accept:**
    - Contract tests validate every frame type against the schema.
    - Fan-out test: 200 fake clients, coalesced, no frame over budget.
    - A Pages preview `/ws` handshake works same-origin.

- [x] **Task 9: One-request initial state.** *Claude Sonnet.*
  - **Read:** `shared/protocol.js`, `workers/market/hub.js` (store accessors), `functions/api/[[path]].js` (1-69), `_routes.json`.
  - **Do:** `GET /api/bootstrap?chart=SYM:tf&wl=…&preset=…` returns one `state` payload (chart bars + indicator series + watchlist quotes + screener page 1 + heatmap) from the hub/KV snapshot.
  - **Accept:**
    - One request, ≤150 KB gzipped, p50 under 300 ms from a warm cache on a preview.
    - Every number in it was computed server-side.

## Phase B: Strip the client, one step at a time, each verified live

Before each step merges, Grok runs a preview with a network-egress check (Task 16's test).

- [x] **Task 10: Thin `dataService.js`.** *Claude Sonnet.*
  - **Read:** `client/services/dataService.js` (1-125), `client/services/tickBuffer.js` (1-45), `shared/protocol.js`.
  - **Do:**
    - Rewrite as **render-only transport**: `bootstrap()` → `/api/bootstrap`; one `/ws`; `setView()`; `on(frameType, cb)`; reconnect with backoff; SSE fallback kept.
    - **Remove** `createTickGuard`, `cleanBars`, the client stale-candle cache (`lastCandles`) and `getCandles`. Keep `tickBuffer` only as rAF frame batching for rendering.
    - Load it from `index.html` behind `?thin=1`.
  - **Accept:**
    - With `?thin=1` the chart, watchlist and screener render from server frames alone.
    - The module has no maths beyond formatting.
    - Add `src/data_service.js` to the `_middleware.js` allowlist.

- [x] **Task 11: Chart renders server bars and indicators only.** *Claude Sonnet.*
  - **Read:** `index.html` 1606-1712 (`updateLiveBar`, `vtBuildChartData`, `vtApplyHistoryPrepend`), 6407-6592 (`vtMergeBars`, `edgeFetchCandles`, `vtLoadMoreHistory`), 6902-7051 (TD tick/poll, `vtSyncChartFeed`, `vtWsConnect`).
  - **Do:** Feed lightweight-charts from `state`/`bar`/`ind` frames, then delete the client candle building and merging above. History paging becomes `GET /api/bars?before=` (server-merged).
  - **Accept:**
    - Live chart for 3 symbols works on a preview and on prod after merge.
    - `rg` finds none of the deleted function names.
    - `tests/supercharts.js`, `tests/reliability.js` and `tests/minicharts.js` are updated and green.
  - **Status (20 Nov, `feat/tasks-9-11-bootstrap-server-indicators`):** code and tests done. **Preview verified** (`d34749c1`, EURUSD 15m / AAPL 1D / BTCUSDT 1m: one history+indicator request each, live `bar` and `ind` frames update the chart and legend). **Prod verified 21 Nov** (PR #27 merged as `f0395c4`): vektorterminal.com BTCUSDT `binance+hub`, EURUSD `twelvedata+hub`, NQ=F `yahoo`, each with `ema:20`/`rsi:14` series in the same response; live `/ws` sent `bar` and `ind` frames across a 1m close. Paging uses `/api/candles?before=&ind=` (server-merged, the same pipeline as the initial load) rather than a separate `/api/bars`. `vtBuildChartData`, `vtMergeBars` and `vtNewBarOpen` are deleted; `updateLiveBar`, `edgeFetchCandles` and `vtLoadMoreHistory` remain as render/transport wrappers with no maths. The dead `src/54_backtest.js` still contains old names (Task 20).

- [ ] **Task 12: Vektor Script runs on the server; the editor stays.** *Claude Sonnet.*
  - **Read:** `index.html` 4246-4368, `src/48_vs_ui.js`.
  - **Do:**
    - The editor sends source to the server and shows returned series and errors.
    - Delete `vsRun`/`vsCompute`/`VS_FN` from the client. Keep `vsLex`/`vsParse` only as an editor syntax checker if D7 is approved.
    - The 3-indicator Free limit is enforced server-side (§3 pricing rule).
  - **Accept:** `tests/scripts.js` is green against the server runtime; the client has no evaluator.

- [ ] **Task 13: Screener, P1–P5 and heatmap render server values only.** *Claude Sonnet.*
  - **Read:** `index.html` 1290-1439, 3609-3640, 3882-3917, 6372-6406.
  - **Do:**
    - Render `screener`/`heatmap` frames.
    - Delete `calc`, `scoreSymbol`, `scoreMarket`, `passesPreset`, `sxTier`/`sxPct`/`sxAdr` maths, `hmChg`/`hmVal`, `SAMPLE` + `candles()`.
    - Keep `hmSquarify` layout only (D7).
  - **Accept:** `tests/screener.js` and `tests/heatmap.js` are green; P1–P5 tiers on prod match the server snapshot.

- [ ] **Task 14: Remove every direct third-party fetch.** *Claude Sonnet.*
  - **Read:** `index.html` 2521-2808, 2854-2857 (`dataM`), 4816-4848, 6424-6438; `shared/instruments.js` 12-13; `src/94_edge_client.js`, `src/53_calendar.js`, `src/52_jai.js`.
  - **Do:**
    - Delete the Binance REST/WS code (`BNH`, `bnwsConnect`, `bnKlineStart`, `bnGet`, `loadBN`), **the `07480d9` fallback `vtBnDirectCandles`**, CoinGecko (`fetchCG`), Finnhub/Polygon (`fetchFH`, `fetchPoly`, `fhWsStart`, `loadFHU`, `loadPGU`, `proxied`), `VT_TD_PROXY` + `pumpTD`, and the direct Forex Factory fallback.
    - Remove the BYO-key fields in Settings › Data (D8).
    - Journal AI per D6.
    - Self-host lightweight-charts and html2canvas under an allowlisted `/vendor/`.
    - Delete the dead `src/` mirrors or sync them.
  - **Accept:**
    - Task 16's egress test shows **zero requests to any host except our origin**.
    - Iris updates `docs/support/KNOWLEDGE-BASE.md` and the legal "Third parties" table (`LG_SOURCES`).

- [ ] **Task 15: Client storage = UI prefs only.** *Claude Sonnet.* **Needs ACC.**
  - **Read:** `index.html` 1175-1209 (`lsGet`/`vtSK` scoping), 2784-2814 (`idb`, `loadCache`, `flush`, `snapInit`), 5516 (`LG_STORE`); `src/90_legal.js` 9-16, 59, 80.
  - **Do:**
    - Delete the IndexedDB market cache and the `data/manifest.json` loader.
    - Move watchlists, alerts, drawings, scripts, journal and layouts to `/api/me/*` (D1).
    - One-time import of `scr2~*`/`scr2p~*` on first signed-in load, then delete the local copy after a server ack.
    - Guests: memory only (D4).
    - localStorage keeps only layout, theme, page and consent.
  - **Accept:**
    - After sign-in on a device with old data, everything appears from the server and localStorage holds only prefs keys.
    - Iris updates the privacy and storage tables.

- [x] **Task 16: Mandate tests in CI.** *Claude Sonnet.*
  - **Read:** `scripts/run-tests.js`, `tests/harness.js`, `tests/README.md`.
  - **Do:**
    - `tests/egress.test.mjs`: headless load of `/`, `#/screener`, `#/heatmap`, `#/backtest`, `#/journal`; fail on any request whose origin isn't ours.
    - `tests/no-client-math.test.mjs`: `rg` guard that fails if banned identifiers come back (`emaArr`, `rsiArr`, `vsRun`, `passesPreset`, `bnGet`, `indexedDB.open`, `fetch("https://`).
    - Protocol contract tests from Task 8.
  - **Accept:** both run in `npm test`; Bruce adds them to the verification checklist. **Build this right after Task 10 so each strip step is checked by it.**

## Phase C: User tools server-side (D5, after the market path)

- [x] **Task 17: Server-side alerts.** *Claude Sonnet.* **Needs ACC.**
  - **Read:** `index.html` 1889-1900 (`checkAlerts`), 2532 (`fin`).
  - **Do:** The hub evaluates alerts on ticks and bars and pushes `alert` frames. The alert log goes to D1. This unlocks alerts with the tab closed (KB "Known limitations").
  - **Accept:** An alert fires with no browser open, and shows on next load.

- [x] **Task 18: Replay and backtest fills server-side.** *Claude Sonnet.*
  - **Read:** `index.html` 5018-5167 (`btOpenPnl`, `btSeek`), 3332-3353 (`posCalc`, `posState`); `src/54_backtest.js`.
  - **Do:** A replay session DO streams bars step by step and simulates fills with the same rules (stop before target on a tie). The client sends Long/Short/Close only. Backtesting stays free and unlimited (§3).
  - **Accept:** `tests/backtest.js` is green; CSV export is unchanged.

- [x] **Task 19: Journal and prop stats server-side.** *Claude Sonnet.* **Needs ACC.**
  - **Read:** `src/50_journal_logic.js` (1-79), `index.html` 3766-3798.
  - **Do:** Move `tradeStats`/`propStatus`/`simChallenge` to `shared/journal.js`, exposed via `/api/me/journal/stats`.
  - **Accept:** `tests/journal.js` is green; the client shows server figures only.

## Phase D: Clean-up

- [ ] **Task 20: Delete deprecated backends.** *Claude Sonnet.* Remove `worker/` (vektor-proxy), `MarketRelayDO`, `generateSyntheticCandles`, the Binance helpers in `worker.js`/`functions/api/[[path]].js` (1-19), and the `server.js` data routes. Grok retires `autumn-meadow-6254` once Tyler approves. **Accept:** one data Worker, one hub; `npm test` is green.

### Carried-over UI tasks (not backend; run alongside, after Task 11)
- **UI-07** Trim the screener to the 6-column core view (legacy TASK-07). Uses server columns.
- **UI-08** Show the replay window (bars and date range) before playback (legacy TASK-08). It comes from server metadata after Task 18.
- **UI-09/10** Monolith decomposition (legacy TASK-09/10). Most of the JS removed in Tasks 11–15 simply goes away, so do styles (UI-09) first and module extraction last.

## Phase E: TradingView parity (Tyler, 21 Nov 2026; Tiers 1–2)
Gap list taken from tradingview.com/features (community and ideas left out). One branch and one PR per ticket. §0 applies to every ticket: any series transform or calculation runs in `shared/` (served by `/api/*` or hub frames), and the browser only renders it. Free limits stay at 3 charts, 3 indicators and 3 alerts (§3).

**Tier 1: expected on day one**
- [x] **E-01 Price scale modes** (log, percent, indexed to 100). Right-click on the price scale or use the chart settings; saved for each pane. Accept: mode survives reload; nothing is recomputed client-side (lightweight-charts `PriceScaleMode`).
- [x] **E-02 Command palette** (Ctrl/Cmd+K): symbols, timeframes, chart types, tools, routes, settings. Accept: keyboard-only flow, focus trap, axe clean.
- [x] **E-03 Object tree**: panel listing every drawing and indicator, with hide, lock, delete and rename. Accept: state persists with the drawings; keyboard accessible.
- [x] **E-04 Compare/overlay symbol**: a second series on the same pane, % or own scale, bars from `/api/candles`. Accept: no client maths beyond rendering; removable; persisted.
- [x] **E-05 Multi-chart layouts**: 1/2/3/4/6/8 grids (Free = 3 charts), synced symbol/interval/crosshair/drawings toggles. Accept: one `/ws` connection shared by every pane; phone shows one chart. *Done 21 Nov: drawings are not mirrored onto panes yet, and the Free 3-chart cap waits for server-side plan checks (ACC).*
- [x] **E-06 Drawing tools**: parallel channel, fib extension, Andrews/Schiff pitchfork. Accept: drag/edit/delete like the existing tools; persisted; object-tree entries.

**Tier 1: alerts (builds on Task 17 server alerts)**
- [x] **E-07 Drawing alerts**: trendline/ray/channel/hline cross, evaluated in the hub (line value at bar time).
- [x] **E-08 Watchlist alerts**: one alert covers every symbol in a list; counts as one Free alert.
- [x] **E-09 Multi-condition alerts**: up to 5 conditions joined with AND, in `shared/alerts.js`.

**Tier 2: what sets us apart**
- [ ] **E-10 Chart types: Renko, Line Break, Baseline.** Renko/Line Break are built server-side in `shared/market/` (`/api/candles?type=`); Baseline is a render mode.
- [ ] **E-11 Volume Profile** (visible range and fixed range): rows computed server-side; crypto and stocks first (FX volume from Twelve Data is weak).
- [ ] **E-12 Vektor Script strategy tester**: entries/exits in the VS runtime, server-side; metrics, list of trades, CSV export.
- [ ] **E-13 Paper trading on live data**: account balance, leverage, commission; reuses the replay fill rules (Task 18). Persisted per account (ACC).
- [ ] **E-14 Earnings calendar**: check that Twelve Data Basic `/earnings_calendar` is available first; if it isn't, park it as 💷 D3.
