# Legacy task backlog (pre-mandate numbering, history)

> Moved verbatim from `AGENTS.md` §10 on 18 Nov 2026. Superseded by `docs/architecture/TASKS.md` (backend-first). Status as of `main @ fb0d608`:
> - Done: TASK-01 (shared catalogs), TASK-06 (starter watchlist, `143f02a`).
> - TASK-02: the vektor-market Worker is live (`936013f`), plus a browser Binance fallback (`07480d9`). That fallback breaks the mandate and is removed by new Task 14. The rest of TASK-02 is superseded by new Tasks 1–10.
> - TASK-03 (provenance badges): folded into the protocol `status` frame (new Task 8) and the strip steps.
> - TASK-04 (registration/accounts): in progress with Dex. It's the **ACC** dependency.
> - TASK-05 (email validation): the client check is live. It stays open until the server checks emails too (Dex, ACC).
> - TASK-07…10: carried over as UI-07…UI-10 in TASKS.md.

## 10. EXECUTABLE TASK BACKLOG

### Phase 1: Backend Deduplication & Data Pipeline
- [x] **TASK-01: Extract Shared Catalogs & Normalizer (`shared/`)**
  - **Target:** `server.js`, `worker.js` → `shared/instruments.js`, `shared/intervals.js`, `shared/symbolNormalizer.js`
  - **Action:** Move duplicated instrument catalogs, interval maps, Dukascopy maps, and Binance fallback lists out of `server.js` and `worker.js` into `shared/`. Implement deterministic `normalizeSymbol(symbol, provider)` handling `BTCUSD` → `BTCUSDT`. Update both backends to import from `shared/`.
  - **Done When:** Zero duplicate catalog/interval blocks remain in `server.js` or `worker.js`, and unit checks confirm `BTCUSD`, `BTC/USD`, and `BTCUSDT` resolve cleanly.

- [ ] **TASK-02: Complete `dataService.js` Migration**
  - **Target:** `index.html`, `src/services/dataService.js`
  - **Action:** Remove direct legacy `fetch` / WebSocket data calls inside `index.html` and route all market data requests exclusively through `dataService.js`. Ensure crypto routes directly to Binance from the browser, and equities/FX/indices route through the Worker batch proxy (max 8-10 symbols per request) with TTL caching and `429` circuit-breaker cache fallback.
  - **Done When:** Network tab shows zero direct Twelve Data or worker-proxied Binance calls from `index.html`; all feeds flow through `dataService.js`.

- [ ] **TASK-03: Enforce Unified Data Provenance Badges**
  - **Target:** Supercharts header, Screener status bar, Watchlist quotes
  - **Action:** Replace conflicting status labels with a single deterministic provenance badge driven by `dataService.js` metadata: `LIVE (Binance WS)`, `REAL-TIME`, `DELAYED (15m)`, `CACHED (HH:MM)`, or `SAMPLE`.
  - **Done When:** Simulated/sample data and delayed feeds cannot render without an explicit matching badge visible on both chart and screener views.

### Phase 2: Authentication & Onboarding
- [ ] **TASK-04: Implement Secure Registration Form & Validation**
  - **Target:** Sign-up modal and auth handlers
  - **Action:** Build clean registration UI collecting strictly **Email**, **Username**, **Password**, and a mandatory **Terms & Conditions / Privacy Consent Checkbox** (explicitly disclosing AI data processing). Exclude first/last name and phone number to eliminate onboarding friction (following Duolingo-style frictionless entry).
  - **Done When:** Registration form accepts only these fields with mandatory T&C consent required before submission.

- [ ] **TASK-05: Enforce Strict Email Sanitization & Character Validation**
  - **Target:** Email input validation logic
  - **Action:** Implement client and server-side validation ensuring emails allow only letters, numbers, and standard symbols (`!`, `*`, `+`, `-`, `=`, `?`, `^`, `_`, `.`, `@`) while strictly rejecting injection characters (`<`, `>`, whitespace, etc.).
  - **Done When:** Invalid email characters trigger instant form validation errors and block backend request submission.

### Phase 3: UX, Onboarding Fixes & Polish
- [x] **TASK-06: Pre-Populated Starter Watchlist & Chart-to-Watchlist Action**
  - **Target:** Watchlist initialization state, Supercharts symbol header
  - **Action:** When a guest or new user initializes with an empty `scr2~*` watchlist, seed default starter symbols (`BTCUSDT`, `EURUSD`, `SPY`, `XAUUSD`, `NVDA`) with a one-click `"Clear Starter List"` option. Add a visible **`+ Watchlist`** and **`Locate in Screener`** button directly on the active chart header.
  - **Done When:** New/guest sessions never boot into a blank watchlist, and any charted symbol can be added to the active watchlist in 1 click.

- [ ] **TASK-07: Trim Default Screener Columns to 6-Column Core View**
  - **Target:** Screener column configuration & preset switcher
  - **Action:** Set the default desktop screener column preset to 6 core columns: `Symbol`, `Price`, `1D %`, `Dollar Vol`, `Vektor Tier (P1–P5)`, and `Expansion`. Ensure tabular-nums formatting on all numerical columns. Move the existing 12+ column layout into a `"Power User (All Metrics)"` preset in the preset selector.
  - **Done When:** First-time desktop load renders the clean 6-column view without horizontal table clutter, while switching to `"Power User"` restores all metrics.

- [ ] **TASK-08: Telegraph Bar-Replay Candle Window Limits**
  - **Target:** Bar-Replay / Backtest toolbar
  - **Action:** Display the exact loaded historical bar count and date range (`Replay Window: N bars | YYYY-MM-DD to YYYY-MM-DD`) directly on the replay toolbar before playback starts.
  - **Done When:** Users see exact available historical depth before initiating bar replay.

### Phase 4: Monolith Decomposition (`index.html` → `src/`)
- [ ] **TASK-09: Extract Inline Styles (`index.html` → `src/styles/main.css`)**
  - **Target:** ~1,000 lines of inline `<style>` in `index.html`
  - **Action:** Move all inline CSS into `src/styles/` without altering `data-ui="phone"` responsive rules or CSS custom properties. Clean up nested card structures and enforce proper inner/outer radius mathematics (Linear-inspired clean layout hierarchy).
  - **Done When:** `index.html` contains zero `<style>` blocks and mobile/desktop Playwright layout checks pass.

- [ ] **TASK-10: Extract Feature Modules Out of `index.html`**
  - **Target:** Inline JS in `index.html` (~6,000 lines) → `src/`
  - **Action:** Incrementally extract Custom Script Interpreter, Screener Table Renderer (replacing unsafe `innerHTML`), Journal/Prop Tracker, and Bar-Replay engine into ES modules under `src/`. Update Playwright test targets from `index.html` monolith selectors to modular build entrypoints.
  - **Done When:** `index.html` acts solely as a lightweight HTML shell (<300 lines) loading modular ES bundles, and all Playwright suites pass.

