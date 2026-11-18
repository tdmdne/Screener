# VEKTOR TERMINAL (`tdmdne/Screener`) — AGENT DIRECTIVES & TASK BACKLOG

## 1. PROJECT OVERVIEW
Vektor Terminal is a browser-based professional multi-asset trading platform.

**Primary Features:**
- TradingView-style charting
- Stock / Forex / Crypto screener
- Watchlists
- Journal
- Backtesting
- Replay
- Custom scripting language
- Cloudflare Worker backend
- Binance + Twelve Data integration

**Primary Goal:** Deliver a fast, professional trading terminal while maintaining backwards compatibility with existing user data.

---

## 2. TECH STACK & REPOSITORY STRUCTURE
**Tech Stack:**
- **Frontend:** Vanilla JavaScript (ES Modules), HTML, CSS
- **Backend:** Cloudflare Workers, Node (`server.js`)
- **Deployment:** Cloudflare Pages (`screener-cso.pages.dev`)
- **Package Manager:** Bun
- **Testing:** Playwright
- **Storage:** LocalStorage (`scr2~*`)

**Repository Structure:**
- `src/` — Modularized ES code (active migration target)
- `client/` — Client-side helpers and extensions
- `functions/` — Cloudflare Pages / API functions
- `shared/` — Cross-environment shared logic (normalizers, catalogs)
- `docs/` — Architecture notes & master specs
- `index.html` — Legacy production monolith shell (~7,160 lines)
- `server.js` — Local Node development backend
- `worker.js` — Cloudflare Worker proxy & caching layer

---

## 3. HARD ARCHITECTURAL BOUNDARIES & "NEVER BREAK"
- **FREEZE THE MONOLITH:** `index.html` (~7,160 lines / 676 KB) is legacy production. **DO NOT** add new features, API fetchers, scoring rules, or inline CSS to `index.html`. All changes must extract logic *out* of `index.html` into `src/` and `shared/`.
- **SINGLE SOURCE OF TRUTH (`shared/`):** Never duplicate instrument catalogs, interval maps, or symbol normalizers between `server.js` and `worker.js`. Import them from `shared/`.
- **PRESERVE STORAGE KEYS:** Never rename, wipe, or alter the schema of `scr2~<account_hash>~*` LocalStorage keys. Guest isolation and existing user watchlists/journals/scripts must remain intact.
- **NO ARTIFICIAL CANDLE CLAMPING:** Never clamp, smooth, or alter OHLC candle wicks/spikes in UI code. Fix bad ticks at the ingestion/normalization layer or switch feed providers.
- **XSS SAFETY:** Do not introduce raw `innerHTML` string concatenation with dynamic/user data in new modules; use `document.createElement` and `textContent`.
- **NO PAYWALLS / DARK PATTERNS:** Core multi-asset charting, custom Vektor scripting, bar-replay backtesting, and P1–P5 tiering must remain unrestricted.

**NEVER BREAK:**
- Chart rendering
- Replay / Backtesting
- Watchlists
- Journal
- Drawing tools
- Keyboard shortcuts
- Theme switching
- LocalStorage compatibility (`scr2~*`)

---

## 4. CODING STANDARDS, PERFORMANCE & UI PRINCIPLES
**Prefer:** Pure functions, reusable modules, `async/await`, early returns, descriptive variable names.
**Avoid:** Nested callbacks, duplicated code, global state, inline styles, magic numbers.

**Performance & UI Polish Standards:**
- **Never block the UI thread:** Avoid polling when WebSockets exist; batch DOM updates and avoid allocations inside animation loops.
- **Geometry & Hierarchy:** Flatten nested cards stuck inside cards. Ensure mathematical container alignment: **Inner Corner Radius = Outer Corner Radius - Padding**.
- **Data Display:** Enforce tabular numbers (`font-variant-numeric: tabular-nums`) across all financial tables, screeners, and chart legends. Always provide explicit loading states for asynchronous data fetches.
- **Anti-Glitz & Anti-Slop Rule:** Kill meaningless gradients, glowing blurs, forever-looping animations, and decorative filler badges that convey no real operational status. Keep animations strictly tied to useful feedback.
- **Interactive Control Audit:** Every button, link, and tab must be fully wired up. **Zero dead links, placeholder buttons, or non-functional fake controls are permitted.**
- **Comprehensive State Coverage:** Every view and component must explicitly handle **Empty States**, **Loading States**, **Error States** (with actionable, human-readable error messages), and **Long Text / Overflow Truncation** (`text-overflow: ellipsis` / wrapping).
- **Forbidden Libraries:** Do not introduce jQuery, Bootstrap, Tailwind, React, Vue, or Angular unless explicitly requested.

---

## 5. DATA ROUTING & API QUOTA RULES
- **Crypto (Direct Browser → Binance):** Route all crypto spot/perp quotes, klines, and streams directly from the client browser to `api.binance.com` / `data-api.binance.vision` and `wss://stream.binance.com:9443`. Never route crypto through Cloudflare Workers (triggers HTTP `451`/`403` blocks) or Twelve Data (burns paid credits).
- **Symbol Normalization:** Normalize tickers prior to network calls (`BTCUSD`, `BTC/USD`, `BTC-USD` → `BTCUSDT` for Binance; standardize FX `EUR/USD` ↔ `EURUSD`).
- **Twelve Data Credit & Rate-Limit Guardrails:**
  - **Bulk Batch Limit:** Never exceed 8–10 symbols per single `/time_series` batch request string to prevent silent HTTP `400` truncation errors. Chunk larger watchlists into parallel arrays.
  - Enforce Cloudflare Worker Cache TTLs (`1m` bars = `15–30s`; `1h`/`1d` bars = `5–15m`).
  - **HTTP 429 Circuit Breaker:** When a `429` rate limit is encountered, immediately trip a 60-second circuit breaker, fall back to LocalStorage cached candles, and display a visible `RATE LIMITED — SERVING CACHE` badge without throwing unhandled promise rejections.
  - **Fallback Order:** `1. Live/Cached Twelve Data` → `2. Stale Worker/LocalStorage Cache (tag DELAYED)` → `3. Dukascopy Static / Sample Mode (tag SAMPLE)`. Never leave charts blank.

---

## 6. SECURITY, PRIVACY & COMPLIANCE HARDENING
- **Secrets & Storage Security:** Never expose API keys or credentials in client bundles. Ensure storage buckets are strictly private (never public) and all user uploads are promptly purged when deleted. Check Git history to ensure no secrets were ever leaked.
- **Database & Query Protection:**
  - **Client vs. Server Keys:** Never use database admin/service-role keys on the frontend; use strictly public anon keys client-side.
  - **Row-Level Security (RLS) & IDOR Prevention:** Enforce RLS on every database table and perform rigorous server-side ownership checks to prevent Insecure Direct Object Reference (IDOR) exploits.
  - **Parameterized Queries:** Always use parameterized queries / prepared statements for all database interactions to prevent SQL injection.
- **API & Billing Protection:** Set strict hard billing caps and usage alerts on all external APIs (Twelve Data, Cloudflare, database providers) to protect against runaway loops or abuse.
- **Route Protection & Sanitization:** Enforce strict authentication on sensitive backend handlers, validate CORS headers, and sanitize all form inputs against XSS.
- **Compliance & AI Disclosures:** Platform documentation and privacy terms must explicitly state that user data is processed through AI third-party integrations to maintain regulatory compliance.

---

## 7. SEO, METADATA & PRODUCTION HYGIENE
- **Metadata & Branding:** Ensure every page features a unique title, meta description, Open Graph / social share preview image, canonical URL, clean favicon, and a proper semantic heading hierarchy (`h1`–`h3`). Strip all default Vite/React/preview branding.
- **Discovery & Error Pages:** Include a valid `sitemap.xml`, `robots.txt`, and a custom `404` error page.
- **Code Hygiene:** Strip all leftover `console.log` statements, development debug files, and bloated JavaScript build artifacts prior to deployment.

---

## 8. DEPLOYMENT, TESTING & GIT WORKFLOW
**Deploy Targets:** Cloudflare Pages & Cloudflare Workers. Never introduce dependencies incompatible with Cloudflare Workers.

**Before committing, run:**
- `bun install`
- `bun test`
- `bun run dev`
- `bun run build`

**Commit Message Prefixes:**
- `feat:` (New features or modular extractions)
- `fix:` (Bug fixes or fallback corrections)
- `refactor:` (Code cleanup without behavior changes)
- `docs:` (Documentation & `.md` updates)
- `test:` (Playwright test additions/fixes)

---

## 9. AGENT WORKFLOW & UNCERTAINTY PROTOCOL
**Before making changes:**
1. Read relevant files completely.
2. Search for existing implementations.
3. Reuse existing utilities.
4. Avoid duplicate functionality.
5. Make the smallest possible change.
6. Verify no existing behavior changed.
7. Run tests.
8. Update documentation if behavior changed.

**Cross-Agent Validation:** Never rely solely on self-review; cross-verify critical security changes and data pipelines using multi-agent code checks before merging.

**When uncertain:**
- Prefer refactoring over rewriting.
- Prefer extracting modules over modifying legacy code.
- Ask for clarification before deleting functionality.

---

## 10. EXECUTABLE TASK BACKLOG

### Phase 1: Backend Deduplication & Data Pipeline
- [ ] **TASK-01: Extract Shared Catalogs & Normalizer (`shared/`)**
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
- [ ] **TASK-04: Implement Secure Auth & Registration Flow**
  - **Target:** Sign-up / Sign-in modals and backend handlers
  - **Action:** Build clean authentication UI collecting strictly **Email**, **Username**, **Password**, and a mandatory **Terms & Conditions / Privacy Consent Checkbox** (disclosing AI data processing). Exclude first/last name and phone number to minimize onboarding friction. Enforce strict server/client email validation allowing only letters, numbers, and standard email symbols (`!`, `*`, `+`, `-`, `=`, `?`, `^`, `_`, `.`, `@`) while blocking injection characters (`<`, `>`, whitespace, etc.). Securely hash passwords and verify RLS account ownership sessions.
  - **Done When:** New users can successfully register and log in with clean validation, secure password hashing, and mandatory T&C consent recorded.

### Phase 3: UX, Onboarding Fixes & Polish
- [ ] **TASK-05: Pre-Populated Starter Watchlist & Chart-to-Watchlist Action**
  - **Target:** Watchlist initialization state, Supercharts symbol header
  - **Action:** When a guest or new user initializes with an empty `scr2~*` watchlist, seed default starter symbols (`BTCUSDT`, `EURUSD`, `SPY`, `XAUUSD`, `NVDA`) with a one-click `"Clear Starter List"` option. Add a visible **`+ Watchlist`** and **`Locate in Screener`** button directly on the active chart header.
  - **Done When:** New/guest sessions never boot into a blank watchlist, and any charted symbol can be added to the active watchlist in 1 click.

- [ ] **TASK-06: Trim Default Screener Columns to 6-Column Core View**
  - **Target:** Screener column configuration & preset switcher
  - **Action:** Set the default desktop screener column preset to 6 core columns: `Symbol`, `Price`, `1D %`, `Dollar Vol`, `Vektor Tier (P1–P5)`, and `Expansion`. Ensure tabular-nums formatting on all numerical columns. Move the existing 12+ column layout into a `"Power User (All Metrics)"` preset in the preset selector.
  - **Done When:** First-time desktop load renders the clean 6-column view without horizontal table clutter, while switching to `"Power User"` restores all metrics.

- [ ] **TASK-07: Telegraph Bar-Replay Candle Window Limits**
  - **Target:** Bar-Replay / Backtest toolbar
  - **Action:** Display the exact loaded historical bar count and date range (`Replay Window: N bars | YYYY-MM-DD to YYYY-MM-DD`) directly on the replay toolbar before playback starts.
  - **Done When:** Users see exact available historical depth before initiating bar replay.

### Phase 4: Monolith Decomposition (`index.html` → `src/`)
- [ ] **TASK-08: Extract Inline Styles (`index.html` → `src/styles/main.css`)**
  - **Target:** ~1,000 lines of inline `<style>` in `index.html`
  - **Action:** Move all inline CSS into `src/styles/` without altering `data-ui="phone"` responsive rules or CSS custom properties. Clean up nested card structures and enforce proper inner/outer radius mathematics.
  - **Done When:** `index.html` contains zero `<style>` blocks and mobile/desktop Playwright layout checks pass.

- [ ] **TASK-09: Extract Feature Modules Out of `index.html`**
  - **Target:** Inline JS in `index.html` (~6,000 lines) → `src/`
  - **Action:** Incrementally extract Custom Script Interpreter, Screener Table Renderer (replacing unsafe `innerHTML`), Journal/Prop Tracker, and Bar-Replay engine into ES modules under `src/`. Update Playwright test targets from `index.html` monolith selectors to modular build entrypoints.
  - **Done When:** `index.html` acts solely as a lightweight HTML shell (<300 lines) loading modular ES bundles, and all Playwright suites pass.

## 11. VERIFICATION CHECKLIST (RUN BEFORE CLOSING ANY TASK)
1. Confirm `scr2~*` LocalStorage keys read/write identically for both Guest and signed-in hash accounts.
2. Verify mobile layout (`data-ui="phone"`) has zero horizontal overflow.
3. Verify Playwright test suite passes with zero console errors or uncaught promise rejections.
4. Check off completed `- [x]` task above before committing.
