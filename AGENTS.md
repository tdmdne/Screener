# VEKTOR TERMINAL (`tdmdne/Screener`) — AGENT DIRECTIVES & TASK BACKLOG

## 1. HARD ARCHITECTURAL BOUNDARIES (NON-NEGOTIABLE)
- **FREEZE THE MONOLITH:** `index.html` (~7,160 lines / 676 KB) is legacy production. **DO NOT** add new features, API fetchers, scoring rules, or inline CSS to `index.html`. All changes must extract logic *out* of `index.html` into `src/` and `shared/`.
- **SINGLE SOURCE OF TRUTH (`shared/`):** Never duplicate instrument catalogs, interval maps, or symbol normalizers between `server.js` and `worker.js`. Import them from `shared/`.
- **PRESERVE STORAGE KEYS:** Never rename, wipe, or alter the schema of `scr2~<account_hash>~*` LocalStorage keys. Guest isolation and existing user watchlists/journals/scripts must remain intact.
- **NO ARTIFICIAL CANDLE CLAMPING:** Never clamp, smooth, or alter OHLC candle wicks/spikes in UI code. Fix bad ticks at the ingestion/normalization layer or switch feed providers.
- **XSS SAFETY:** Do not introduce raw `innerHTML` string concatenation with dynamic/user data in new modules; use `document.createElement` and `textContent`.
- **NO PAYWALLS / DARK PATTERNS:** Core multi-asset charting, custom Vektor scripting, bar-replay backtesting, and P1–P5 tiering must remain unrestricted.

## 2. DATA ROUTING & API QUOTA RULES
- **Crypto (Direct Browser → Binance):** Route all crypto spot/perp quotes, klines, and streams directly from the client browser to `api.binance.com` / `data-api.binance.vision` and `wss://stream.binance.com:9443`. Never route crypto through Cloudflare Workers (triggers HTTP `451`/`403` blocks) or Twelve Data (burns paid credits).
- **Symbol Normalization:** Normalize tickers prior to network calls (`BTCUSD`, `BTC/USD`, `BTC-USD` → `BTCUSDT` for Binance; standardize FX `EUR/USD` ↔ `EURUSD`).
- **Twelve Data Credit Guardrails:**
  - Batch multi-symbol requests via `/time_series?symbol=SYM1,SYM2...` instead of single-ticker loops.
  - Enforce Cloudflare Worker Cache TTLs (`1m` bars = `15–30s`; `1h`/`1d` bars = `5–15m`).
  - **Fallback Order:** `1. Live/Cached Twelve Data` → `2. Stale Worker/LocalStorage Cache (tag DELAYED)` → `3. Dukascopy Static / Sample Mode (tag SAMPLE)`. Never leave charts blank or throw unhandled rejections on HTTP `429`.
- **Resolution:** Prefer second-by-second aggregated updates over raw tick-by-tick streams for chart stability during high-volatility events (CPI, FOMC, NFP).

## 3. EXECUTABLE TASK BACKLOG

### Phase 1: Backend Deduplication & Data Pipeline
- [ ] **TASK-01: Extract Shared Catalogs & Normalizer (`shared/`)**
  - **Target:** `server.js`, `worker.js` → `shared/instruments.js`, `shared/intervals.js`, `shared/symbolNormalizer.js`
  - **Action:** Move duplicated instrument catalogs, interval maps, Dukascopy maps, and Binance fallback lists out of `server.js` and `worker.js` into `shared/`. Implement deterministic `normalizeSymbol(symbol, provider)` handling `BTCUSD` → `BTCUSDT`. Update both backends to import from `shared/`.
  - **Done When:** Zero duplicate catalog/interval blocks remain in `server.js` or `worker.js`, and unit checks confirm `BTCUSD`, `BTC/USD`, and `BTCUSDT` resolve cleanly.

- [ ] **TASK-02: Complete `dataService.js` Migration**
  - **Target:** `index.html`, `src/services/dataService.js` (or `client/dataService.js`)
  - **Action:** Remove direct legacy `fetch` / WebSocket data calls inside `index.html` and route all market data requests exclusively through `dataService.js`. Ensure crypto routes directly to Binance from the browser, and equities/FX/indices route through the Worker batch proxy with TTL caching and `429` cache fallback.
  - **Done When:** Network tab shows zero direct Twelve Data or worker-proxied Binance calls from `index.html`; all feeds flow through `dataService.js`.

- [ ] **TASK-03: Enforce Unified Data Provenance Badges**
  - **Target:** Supercharts header, Screener status bar, Watchlist quotes
  - **Action:** Replace conflicting status labels (`"Live · auto-scan"`, `"Data just now"`, `"DELAYED"`) with a single deterministic provenance badge driven by `dataService.js` metadata: `LIVE (Binance WS)`, `REAL-TIME`, `DELAYED (15m)`, `CACHED (HH:MM)`, or `SAMPLE`.
  - **Done When:** Simulated/sample data and delayed feeds cannot render without an explicit matching badge visible on both chart and screener views.

### Phase 2: UX & Onboarding Fixes (Solving High-Bounce & Density Issues)
- [ ] **TASK-04: Pre-Populated Starter Watchlist & Chart-to-Watchlist Action**
  - **Target:** Watchlist initialization state, Supercharts symbol header
  - **Action:** When a guest or new user initializes with an empty `scr2~*` watchlist, seed default starter symbols (`BTCUSDT`, `EURUSD`, `SPY`, `XAUUSD`, `NVDA`) with a one-click `"Clear Starter List"` option. Add a visible **`+ Watchlist`** and **`Locate in Screener`** button directly on the active chart header.
  - **Done When:** New/guest sessions never boot into a blank watchlist, and any charted symbol can be added to the active watchlist in 1 click.

- [ ] **TASK-05: Trim Default Screener Columns to 6-Column Core View**
  - **Target:** Screener column configuration & preset switcher
  - **Action:** Set the default desktop screener column preset to 6 core columns: `Symbol`, `Price`, `1D %`, `Dollar Vol`, `Vektor Tier (P1–P5)`, and `Expansion`. Move the existing 12+ column layout into a `"Power User (All Metrics)"` preset in the preset selector.
  - **Done When:** First-time desktop load renders the 6-column view without horizontal table clutter, while switching to `"Power User"` restores all metrics.

- [ ] **TASK-06: Telegraph Bar-Replay Candle Window Limits**
  - **Target:** Bar-Replay / Backtest toolbar
  - **Action:** Display the exact loaded historical bar count and date range (`Replay Window: N bars | YYYY-MM-DD to YYYY-MM-DD`) directly on the replay toolbar before playback starts.
  - **Done When:** Users see exact available historical depth before initiating bar replay.

### Phase 3: Monolith Decomposition (`index.html` → `src/`)
- [ ] **TASK-07: Extract Inline Styles (`index.html` → `src/styles/main.css`)**
  - **Target:** ~1,000 lines of inline `<style>` in `index.html`
  - **Action:** Move all inline CSS into `src/styles/` without altering `data-ui="phone"` responsive rules or CSS custom properties.
  - **Done When:** `index.html` contains zero `<style>` blocks and mobile/desktop Playwright layout checks pass.

- [ ] **TASK-08: Extract Feature Modules Out of `index.html`**
  - **Target:** Inline JS in `index.html` (~6,000 lines) → `src/`
  - **Action:** Incrementally extract Custom Script Interpreter, Screener Table Renderer (replacing unsafe `innerHTML`), Journal/Prop Tracker, and Bar-Replay engine into ES modules under `src/`. Update Playwright test targets from `index.html` monolith selectors to modular build entrypoints.
  - **Done When:** `index.html` acts solely as a lightweight HTML shell (<300 lines) loading modular ES bundles, and all Playwright suites pass.

## 4. VERIFICATION CHECKLIST (RUN BEFORE CLOSING ANY TASK)
1. Confirm `scr2~*` LocalStorage keys read/write identically for both Guest and signed-in hash accounts.
2. Verify mobile layout (`data-ui="phone"`) has zero horizontal overflow.
3. Verify Playwright test suite passes with zero console errors or uncaught promise rejections.
4. Check off completed `- [x]` task above before committing.
