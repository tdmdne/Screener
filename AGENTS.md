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
- **Interactive Control Audit:** Every button, link, and tab must be fully wired up. **Zero dead-end links, placeholder `#` buttons, or non-functional fake controls are permitted.**
- **Comprehensive State Coverage:** Every view and component must explicitly handle:
  1. **Empty States** (clean placeholders when datasets have zero records).
  2. **Loading States** (skeleton loaders / spinners during async resolution).
  3. **Error States** (actionable, human-readable error banners).
  4. **Text Truncation & Wrapping** (`text-overflow: ellipsis` or strict multi-line wrapping to prevent layout breakage).
- **Design Inspiration Benchmarks:** Emulate industry-best design references for craft and experience:
  - **UI Design & Speed:** Model the precision, typography, responsiveness, and dark-mode elegance after **Linear**.
  - **Animations & Micro-interactions:** Model the buttery-smooth, purposeful transitions and feel after **Apple**.
  - **Onboarding & Friction Reduction:** Model the streamlined, zero-bloat, direct-to-value progression after **Duolingo**.
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
  - **Row-Level Security (RLS):** Enforce Row-Level Security on every single database table.
  - **IDOR Prevention:** Perform rigorous server-side ownership verification on all requests to prevent Insecure Direct Object Reference exploits (ensuring a user can only access records matching their verified account ID).
  - **Parameterized Queries:** Always use parameterized queries / prepared statements for all database interactions to prevent SQL injection.
- **API & Billing Protection:** Set strict hard billing caps and usage alerts on all external APIs (Twelve Data, Cloudflare, database providers) to protect against runaway loops or abuse.
- **Route Protection & Sanitization:** Enforce strict authentication on sensitive backend handlers, validate CORS headers, and sanitize all form inputs against XSS.
- **Compliance & AI Disclosures:** Platform documentation and privacy terms must explicitly state that user data is processed through AI third-party integrations to maintain regulatory compliance.

---

## 7. SEO, METADATA & PRODUCTION HYGIENE
- **Metadata & Branding:** Ensure every page features a unique title, meta description, Open Graph / social share preview image (`og:image`), canonical URL, clean custom favicon, and a proper semantic heading hierarchy (`h1`–`h3`). Strip all default Vite/React/preview branding.
- **Discovery & Error Pages:** Include a valid `sitemap.xml`, `robots.txt`, and a custom branded `404` error page.
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
- [ ] **TASK-06: Pre-Populated Starter Watchlist & Chart-to-Watchlist Action**
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

## 11. VERIFICATION CHECKLIST (RUN BEFORE CLOSING ANY TASK)
1. Confirm `scr2~*` LocalStorage keys read/write identically for both Guest and signed-in hash accounts.
2. Verify mobile layout (`data-ui="phone"`) has zero horizontal overflow.
3. Verify Playwright test suite passes with zero console errors or uncaught promise rejections.
4. Check off completed `- [x]` task above before committing.

---

## Support knowledge base (for the support bot)

> Sources: `index.html` (the only code that runs in production), `worker.js`, `functions/api/[[path]].js`, `CHANGELOG.md`, `SETUP.md`, `tests/`, `AGENTS.md` and the ops log, as of 18 Nov 2026. Anything in `src/*.js` is not loaded by the live app unless noted.
>
> ⚠ This file is publicly downloadable from the live site (screener-cso.pages.dev/AGENTS.md). Never add secrets, keys, private contact details or unpatched security issues here.

### What Vektor Terminal is
- Vektor Terminal is a free charting and research tool that runs in the browser. It covers crypto, forex, stocks, ETFs, futures, indices and CFDs, with a screener, charts, drawing tools, alerts, watchlists, a trade journal, a backtester with bar replay, calculators, a heatmap, an economic calendar and a custom indicator language (Vektor Script). It does **not** place trades, hold money or connect to a broker. Its own Terms describe it as "a browser-based set of market screening, charting, journaling, calculation and back-testing tools."
- Live URL: **https://screener-cso.pages.dev**
- Target public launch: **1 March 2027**. The bot must not promise this date (see Bot rules).
- Pricing: the in-app Terms (§4a) and the Refunds page both say **"The Service is currently free and nothing is charged."**
- The Refunds & Cancellation page is a **template for a possible future paid plan**. It contains placeholders: `[Plan name]`, `[Account → Billing page]` and `[annual]`. No paid plan exists.
- The word "Plus" in the code is the chart's price-scale **"+" button**. It is not a pricing tier.
- `TODO (needs Tyler):` Is any paid plan planned before or at launch? If so, what are its name, price and features? Until you answer, the bot says "it's free right now" and nothing more.

### Navigation (where things are)
- **Desktop top nav:** Workspace · Supercharts · Screener · Heatmaps · Calendar · Journal · Calculators · Backtest. Addresses are `#/workspace`, `#/chart`, `#/screener`, `#/heatmap`, `#/calendar`, `#/journal`, `#/calc` and `#/backtest`. They aren't case-sensitive, and the app reopens on the last page you used.
- **Phones (under 700px wide):** a bottom tab bar with Workspace, Supercharts, Screener, Calculators and **More**. More opens a sheet with Heatmaps, Calendar, Journal, Backtest, Today's session, the legal links, Cookie settings, the layout switch and the data status.
- **Tablets (700–1099px):** all eight pages appear in a nav that wraps onto more than one line.
- **Footer:** a risk warning, links to every legal page, **Cookie settings** and **Keyboard shortcuts** (the shortcuts button is hidden on touch-only phones).
- Clicking the **VT** logo goes back to Workspace.

### Features and how to use them
**Screener (Workspace list and the full-width Screener page)**
- Controls: a market filter (All, Forex, Futures, Stocks, CFDs, Crypto, ETFs, Indices), search, sorting by any column header, and a gear button on each column to edit it.
- Column types: Price, Volume, Dollar volume, Percent change, Candle change, Average daily range %, Moving average close and Moving average trend.
- **Presets P1–P5** are filters, from strictest (P1) to broadest (P5):
  - P1: full EMA alignment plus expansion.
  - P2: EMA alignment plus a positive change.
  - P3: a positive change plus partial alignment.
  - P4: any positive change.
  - P5: no filter.
  - Timeframe levels: **H** = 1H checked against 1D, **M** = 15m against 1H, **L** = 1m against 15m.
- The Screener page adds Market, 1D %, ADR 14d, Vektor score, Expansion score/phase and Tier columns. Clicking a row opens a side drawer with a mini chart and buttons for Open in Supercharts, Workspace, watchlist and alert. Esc closes the drawer.
- Saved layouts: built-in layouts include "Higher timeframe scan" and "Trend grid". You can save your own, and **Export / import presets** lets you copy layouts between devices as pasted text.
- On desktop the list is one continuous scrolling list. Phones and tablets use pages with Rows 20/50/100.
- A note under the table reads: "Scores, tiers (P1-P5) and phases are rule-based calculations on past price data. They don't predict prices and aren't investment advice."
- **Mini-chart mode:** the grid button next to "Data" turns the list into small candle charts (intervals 15m, 1H, 4H or 1D). Click a card, or focus it and press Enter, to open the full chart.

**Charts (Workspace and Supercharts)**
- **Chart header:** symbol search (click it, start typing, or press Ctrl+K), the price and 1D %, a market-status icon, the interval picker, a ★ watchlist toggle, **Indicators**, **Alerts**, **Settings**, a camera icon (Download image / Copy image / Open in new tab), **Reset chart view**, and a small "TradingView ↗" link that opens the same symbol on TradingView.
- **Timeframes:** 1s, 5s, 10s, 15s, 30s, 45s, 1m, 3m, 5m, 15m, 30m, 45m, 1H, 2H, 3H, 4H, 12H, 1D, 1W, 1M (month), 3M, 6M and 12M. You can add custom intervals and favourite them.
- **Chart types:** candles by default. The code can also draw hollow candles, line, area and bar charts.
  - `TODO (needs Tyler):` I couldn't find a visible chart-type picker in index.html. Is there one, or does chart type only come from templates? The bot shouldn't tell users how to switch chart type until this is confirmed.
- **Supercharts** adds:
  - A right-hand dock with Watchlist, Active alerts (with Re-arm/delete) and a Data Window (OHLC, volume and indicator values under the crosshair).
  - A 1-pane / 2-pane toggle. Pane 2 shows the same symbol on its own timeframe (5m–1W), and the two panes share a crosshair.
  - **Templates**: save the whole chart setup. Including the symbol is optional. You can load, rename, delete, set a default (★) and export/import JSON (up to 2 MB and 100 templates).
- **Settings tabs:** Symbol, Status line, Scales and lines, Canvas, Features, Interface.
- **Price-scale "+":** hover the price axis, click "+", then choose "Add alert at <price>" or "Draw horizontal line at <price>". It can be turned off under Settings → Scales → "Plus button".
- **Snapshots:** taken with html2canvas, which loads from the jsDelivr CDN.

**Indicators**
- Built in: EMA, SMA, Bollinger Bands, Volume, RSI and ATR. The default chart has EMA 10 and EMA 20.
- **Indicators › My scripts** lists your saved Vektor Script indicators, with Add/Remove, Edit and New script.

**Vektor Script (custom indicators)**
- Open it with the **Scripts** button on the chart.
- Example: `macd = ema(close, 12) - ema(close, 26)` then `plot(macd, "MACD", color=blue)`.
- Language features:
  - Series: open, high, low, close, volume and hl2. Use `close[1]` for past values.
  - Functions: sma, ema, rma, wma, rsi, stdev, atr, highest, lowest, roc and crossover.
  - Declarations: `indicator()`, `input()`, `plot()` (line, histogram or area) and `hline()`.
- Built-in examples: MACD, RSI with bands, Bollinger Bands, Stochastic, EMA cross, Keltner channel and rate of change.
- Errors show the line and column, a plain-English hint and "Did you mean" suggestions, with a **Go to line** button.
- Scripts are sandboxed: there's no `eval`, no access to the page or storage, and size, loop and look-back limits apply.
- Import/export uses `.vks.json` files (512 KB maximum).

**Drawing tools (left toolbar, saved per symbol)**
- Tools: Cursor, Trend line, Ray, Extended line, Horizontal line, Horizontal ray, Vertical line, Arrow, Brush, Rectangle, Fib retracement, Long position, Short position, Text, Note, Price Range and Date Range. The toolbar also has magnet, lock, hide and delete buttons.
- The floating toolbar has a templates button. Built-in styles are available for trend lines, horizontal rays, Fib and long/short. ★ makes a style the default for new drawings, and saving your own template needs sign-in.
- The last colour, width and line style you used becomes that tool's default.
- On touch screens, the tools become a strip above the chart.

**Long/Short position tool**
- Click to place it (the default R:R is 1:2), then drag the target, stop, entry and width handles.
- Labels show Target, Stop, "Open P&L / Closed P&L", Qty and Risk/Reward Ratio.
- Open its settings by double-clicking, using the gear button, or right-click → Settings. You can set account size, lot size, risk % or money, leverage and precision.
- Right-click menu: Settings, Clone, Lock/Unlock, Hide, Delete and Show hidden drawings.
- Results are **paper results, not broker trades**. If a bar hits both the target and the stop, the stop counts first.

**Alerts**
- Ways to add an alert: the chart **Alerts** button, the price-scale "+", or **+ Alert** in the Supercharts dock.
- Conditions: Crossing, Crossing up, Crossing down. You can add an optional custom pop-up message.
- Active alerts appear on the chart as dashed orange lines. Click a line to edit or delete it, or drag it to move the price.
- An alert fires once. After that it shows "triggered" with a **Re-arm** button.
- The app keeps a log of the last 200 triggered alerts.
- **Alert sound** is off by default. Turn it on, and set the volume or test it, in the Price Alerts dialog.
- The browser may ask permission to show desktop notifications.
- **Alerts are only checked while the app is open in a tab.** Nothing is checked on a server.
- Guests are asked to sign in before they can add an alert.

**Watchlists**
- The watchlist panel has sections (by default "Traded" and "Section") with **+ Symbol**, **+ Section**, edit and remove buttons.
- Watchlist symbols load their data first.
- The ★ button in the chart header is currently broken on the live site: it calls a function that doesn't exist. Tell users to use **+ Symbol** in the watchlist panel or the "watchlist" button in the Screener drawer instead.
- Pending, not live yet: a starter watchlist (BTCUSDT, EURUSD, SPY, XAUUSD, NVDA) with a "Clear starter list" button, plus "+ Watchlist" and "Locate in Screener" buttons in the chart header (TASK-06). This work is not committed. Don't announce it.

**Backtest Lab (Backtest page)**
- Rules: EMA cross, RSI reversal or N-bar breakout; long, short or both. The stop can be an ATR(14) multiple or a % of entry, with an optional target in R and fees on both sides.
- No look-ahead: a signal fills at the next bar's open.
- Results: net, return, win rate, profit factor, expectancy (R), max drawdown, an equity curve, a trades table and **CSV export**. The CSV uses the Journal format with the account "Backtest", so it can be imported into the Journal.
- **Bar replay:** step, play/pause, speed, a slider, and entry/exit markers.
- **Manual paper trading in replay:** Buy (B), Sell (S), Close and Reverse ("Close and flip direction") buttons. Bracket presets: ATR 1:2 (default), ATR 1:3, 1% / 2%, or Manual stop/target. If a bar touches both stop and target, the stop fills first. All fills are simulated on historical candles; nothing goes to a broker.
- It runs on the candles the app already has for the symbol, usually the latest ~250 bars. Results are labelled hypothetical and not advice.

**Journal & Prop Tracker (Journal page)**
- You enter trades manually. Nothing connects to a broker.
- P&L = (exit − entry) × quantity × point value × direction − fees, or you can enter your broker's figure instead. R is calculated when you give a stop.
- Stats: net P&L, win rate, profit factor, expectancy, average R, max drawdown, streaks, an equity curve, a monthly P&L calendar, and breakdowns by setup, weekday and side.
- **Prop challenge tracker:** set a profit target, max daily loss, static or trailing drawdown, and minimum days. It flags any rule breach. Only closed trades count.
- **Import CSV / export CSV:** rows are validated, duplicates are skipped, and spreadsheet formula injection is guarded against.
- **Journal review:**
  - The local summary works entirely in the browser and sends nothing.
  - The optional **AI review** uses the user's **own** OpenAI, Anthropic or OpenAI-compatible (https) key. A disclosure and a "See exactly what will be sent" preview appear, and the user must tick a confirmation before every send. The browser calls the provider directly. Replies are plain text, labelled AI-generated and not advice.

**Calendar & News (Calendar page)**
- This week's economic events, shown in the user's local time.
- Filters: impact, currency chips, search and "show past". A countdown shows the next high-impact event.
- Headlines come from Yahoo Finance RSS for symbols the user picks. Links open on the publisher's site.
- ⚠ The source label matters:
  - **"Forex Factory"** means real feed data.
  - **"Macro calendar"** means the server couldn't reach the feed and filled in a **built-in template week** with hard-coded figures (`generateWeeklyMacroSchedule` in worker.js). That data is not real. Escalate if users rely on it.

**Heatmaps**
- A treemap of the screener's markets.
- Colour can show % change vs the previous close (1H, 4H, 1D or 1W), momentum or Vektor score. Tile size is traded value or equal. Count can be 30, 60 or 100 tiles.
- A badge shows **Live / Delayed / Sample data**, and the header shows "Candles as of HH:MM (cache)" when the map is drawn from cached data.
- Arrow keys, Home and End move between tiles, and Enter opens the chart.

**Calculators**
- Forex/metals position size (lots, units, pip value).
- Futures contracts (ES/MES, NQ/MNQ, YM/MYM, RTY/M2K, CL/MCL, NG, GC/MGC, SI, HG, ZN, ZB, 6E/6B/6J/6A).
- A pip/tick converter, a drawdown recovery table, multiple prop accounts, and a Monte Carlo prop challenge simulator.
- JPY pip value states plainly when no live rate is available.

**Today's session summary**
- Open it from "Today" in the header, or More → Today's session on phones. From 21:00 a chip offers it once a day.
- It shows position-tool paper P&L, market breadth and movers, and alerts triggered today.
- "Copy as text" or "Download .txt".

**Themes, layout, sound, motion**
- Dark/Light toggle in the header. If the user hasn't chosen, it follows the system setting.
- Layout mode: auto, phone, tablet or desktop (Phone / Tablet / PC layout icons in the header, Settings → Interface, or the layout switch in the More sheet).
- Animations are switched off when the device asks for reduced motion.
- Sound only plays for alerts, and only if the user turns it on.

### Keyboard shortcuts (exactly what the code binds)
- **Anywhere:** `?` shows or hides the shortcut list (not while typing, over another dialog, or on the sign-in screen). `Esc` closes a dialog, menu or panel. `Tab`/`Enter`/`Space` work as usual, and the first Tab offers "Skip to main content".
- **Screener list:** `↑` / `↓` move to the previous or next symbol.
- **Chart (Workspace and Supercharts only):**
  - Type a digit (e.g. `15`, `4H`) to change the interval.
  - Type letters to search for a symbol, or press `Ctrl+K`.
  - `←` / `→` scroll the chart (hold Ctrl for bigger steps).
  - `Ctrl+Z` undo, `Ctrl+Y` or `Ctrl+Shift+Z` redo, `Ctrl+S` save now.
  - Drawing tools: `Alt+T` trend line, `Alt+H` horizontal line, `Alt+V` vertical line, `Alt+F` Fib, `Alt+R` rectangle, `Alt+A` arrow, `Alt+N` note.
  - `Ctrl+Alt+H` hides or shows all drawings.
  - `Delete`/`Backspace` deletes the selected drawing. `Esc` cancels drawing and returns to the cursor.
- **Heatmaps:** arrow keys move between tiles, `Home` goes to the first, `End` to the last, `Enter` opens the chart.
- **Backtest bar replay:** `→` / `←` step one bar forward/back, `Space` play/pause, `B` buy (long), `S` sell (short), `X` close the open position (B/S only when flat, X only with a position).
- On a Mac, Ctrl shows as Cmd and Alt as Opt.
- Shortcuts don't fire while the cursor is in a text field.

### Markets and data sources
- **Crypto (Binance USDT pairs):** live data from Binance's public servers (`data-api.binance.vision`, WebSocket `data-stream.binance.vision`). No key is needed. CoinGecko is a fallback for daily candles.
- **Forex, stocks, ETFs, indices, futures:** on the live site, chart candles come from the app's own backend at `/api/candles`, which runs as a Cloudflare Pages Function in front of `worker.js`.
  - If the server has a Twelve Data key, candles come from Twelve Data.
  - **If it doesn't, the server sends simulated candles** (`source:"simulator"`). The chart does not label these as sample data.
  - Futures are mapped to ETF or spot proxies (e.g. NQ→QQQ, ES→SPY, GC→XAU/USD, CL→WTI/USD).
- **Screener snapshot (`/api/screener`):** crypto rows use real Binance tickers. In the current `worker.js`, **non-crypto rows get simulated prices and 1D %** (`generateSyntheticCandles`).
  - Live check (18 Nov 2026, 21:2x GMT): `/api/screener` reported `source:"edge+sim"` with fixed-looking non-crypto prices (e.g. EURUSD 1.085), and `/api/candles` for EURUSD 1H returned `source:"simulator"`. **Treat non-crypto prices on the live site as simulated until Tyler confirms otherwise.**
  - `TODO (needs Tyler):` Should non-crypto (forex/stocks/indices/futures) prices on the live site be real? Right now they are simulated server-side. Until fixed, the bot must not tell users non-crypto prices are real-time.
- **User's own keys:** go to **Settings › Data** (the "Data" dialog).
  - **Twelve Data key (your own)** is optional. It is used for browser requests to Twelve Data (the live price stream for the open chart, and candles when the app isn't using the backend).
  - **Finnhub key** and **Polygon key** are optional stock fallbacks.
  - The Twelve Data key lasts for the tab only. It is saved, per account, only if the user allows "Optional preferences", and is never saved for guests.
  - Error shown when no Twelve Data key is set: "no Twelve Data key (add yours in Settings › Data)".
- **Offline sample data:** a checkbox in the Data dialog. All prices are simulated. The status reads "Offline sample data" and the chart footer says "Sample data."
- **Dukascopy:** historical candles used only for Backtest replay of FX, metals, indices and commodities, fetched by the backend.
- **Yahoo Finance:** in the current code, used only for **news headlines** (RSS via `/api/news`). Older docs that say "Yahoo for forex prices" are out of date.
- **Forex Factory (Fair Economy):** the economic calendar.
- **Optional data snapshot:** `data/manifest.json` / `data/c_*.json`, used only if the operator publishes one.
- **Limits and delays:**
  - Backend candle cache: about 60s for live requests and 24h for older history chunks.
  - Twelve Data per-minute limit: the app waits 61s and retries. If the **daily** limit is hit, it stops the queue.
  - Binance 429/418 responses make the app pause ("Binance rate limit, pausing").
  - Binance HTTP 451 means "Binance blocks this region".
  - Forex/CFD volume is tick volume, not traded volume.
  - When live feeds go quiet, the status shows **"CACHED FAILOVER"**.
  - Other status texts: "Live · auto-scan", "Data N min ago", "N failed (…)".

### Account and sign-in (be honest)
- **Sign-in is a client-only placeholder with no backend.** It accepts any username/email and any password. The password is **never checked, stored or sent**. Only the username is remembered:
  - in localStorage if "Keep me signed in" is ticked,
  - otherwise in sessionStorage, which is cleared when the tab closes.
- The username only decides **which bucket of this browser's storage** is used: `scr2~<code>` and `scr2p~<code>`, where the code comes from the username with case and spaces ignored. **Anyone who types the same username on the same browser sees that work.** It separates people who share a browser. It is not security.
- **"Continue without signing in" (guest mode):** charts and screener work, but nothing is saved. Work stays in memory, and only the guest choice is kept for the tab. Alerts, chart settings, templates and saving your own drawing templates ask the guest to sign in.
- **No password recovery, no account deletion request and no cross-device sync are possible, because there is no server account.** Different browsers or devices have separate data. Using a different username shows empty work.
- **Clearing browser or site data, using private browsing, or "Delete all my data" permanently erases the work.** There is no server copy.
- **Older data from before accounts were separated (Nov 2026):** the next person to sign in is asked **"Import into my account"** or **"Not mine"**. If a guest signs in to an account that already has saved work, they choose whether to open the saved work or keep the current session over it.
- **Backups and moving data:**
  - **Your data** (`#/legal/your-data`) → **Download my data (JSON)**: a full export for this account. The cache can optionally be included. The file **includes saved API keys**, so keep it safe.
  - There is **no one-click restore of the full JSON export.** Partial imports exist: Journal **Import CSV**, chart templates **Import JSON**, Vektor Script `.vks.json`, and screener **Export / import presets** (paste text).
- `TODO (needs Tyler):` When will real accounts exist (TASK-04 is blocked waiting on an auth backend decision)? What should the bot say about sync and recovery until then?

### Settings and privacy
- **Stored in this browser:**
  - localStorage `scr2~…` / `scr2p~…`: settings, watchlist, alerts and alert log, drawings, scripts, journal, layouts, Finnhub and Polygon keys.
  - `vt_page`, `scr2a` (sign-in name), `vt_consent` and `vt_consent_log`.
  - `vt_legacy`, when older data hasn't been claimed.
  - sessionStorage `vt_guest`.
  - With Optional preferences only: `vt_prefs` (sound), `vt_tdkey~…` and `vt_aikey~…`.
  - IndexedDB database `scr`: the **optional** market-data cache, created only after consent.
- **No cookies, analytics, ads or trackers.** System fonts only, and icons are inline SVG.
- **Consent banner:** "Reject all" and "Accept all" have equal weight, plus "Manage choices". The optional categories are the market-data cache and Optional preferences, both off by default. Users can reopen it any time from **Cookie settings** in the footer. Users are asked again after 12 months.
- **Sent to third parties:** the IP address, user-agent, time and requested symbols/timeframes go to market-data providers (Binance, Twelve Data, Finnhub, Polygon, CoinGecko, Forex Factory, Yahoo RSS, Dukascopy, the jsDelivr CDN). API keys are sent only to their own provider. Journal AI data goes only to the AI provider the user picks, and only when they press Send.
- **Legal pages** (`#/legal/...`): Terms, Privacy (UK GDPR), Cookies & Local Storage, Your data, Risk Disclaimer, Data Sources, Disclaimer of Liability, Refunds & Cancellation, About & Contact, Accessibility.
  - All of them are **templates marked for solicitor review**, with placeholders such as `[Company legal name]`, `[Registered address]`, `[Company number]`, `[ICO registration number]` and `[Effective date]`.
- **Contact address in the app:** `vektorhq@proton.me` (legal pages and the data-request form).
- Data-rights requests: the legal pages say "within one month". The Accessibility page's reply time is a placeholder, `[5 working days]`.
- `TODO (needs Tyler):` Is vektorhq@proton.me the address users should be sent to for support, or only for legal/data requests?
- `TODO (needs Tyler):` What are the company legal name, address and registration details? Never fill them in yourself.

### Common issues and fixes
- **Chart stuck on "Loading candles…" or showing an error box:** the chart shows the real error with a **Try again** button. Check the status line.
  - For forex/stocks with "no Twelve Data key", tell the user to add their own key in Settings › Data.
  - Otherwise, open Data → **Retry failed**, or **Reload data**, which also empties the cache.
- **"Historical gap — waiting for fresh feed" badge:** press **Retry** on the badge. If it keeps coming back, escalate with the symbol and timeframe.
- **"The chart library didn't load.":** the jsDelivr CDN is blocked. This can be caused by an ad blocker, a corporate network or no internet. Allow cdn.jsdelivr.net and reload.
- **No crypto, or "Binance unavailable (HTTP 451 … blocks this region)":** Binance is blocking the user's region or network. The app can't get around this. Suggest a different network, or escalate.
- **"Binance rate limit, pausing":** wait. The app retries by itself.
- **Twelve Data errors:**
  - A per-minute limit retries after about 1 minute.
  - A daily-limit message stops all further Twelve Data requests until the provider resets the limit.
  - An invalid key is refused when saved.
  - The key disappears after closing the tab unless Optional preferences consent is given.
- **Prices look stale, or the status says "CACHED FAILOVER":** the live sources are quiet, so cached data is shown. The cache refreshes on its own (intraday after about 15 minutes, daily data after about 6 hours, plus every 15 minutes and when the user returns to the tab). Data → Reload data forces a refresh.
- **Prices look unrealistic or don't match the broker:**
  - Check whether "Offline sample data" is ticked, or the heatmap badge says Sample.
  - Non-crypto prices may be simulated server-side (see the Data section). Escalate with the symbol.
  - Always tell users to check prices with their broker.
- **Lost watchlist, drawings or journal:**
  - Ask whether they're using the same browser, the same exact username (case and spaces don't matter), whether they were in guest mode, or whether they cleared site data or used private browsing.
  - Guest work and cleared data can't be recovered.
  - If an "Import into my account" prompt was dismissed with "Not mine", escalate.
- **Can't add alerts or save templates:** they're in guest mode. Sign in from the header **Sign in** button. This doesn't reload the page or lose current work.
- **Alert didn't fire:** alerts only run while a tab with the app is open. Each alert fires once, and the user must **Re-arm** it. The sound is off by default, and browser notification permission must be granted.
- **Calendar says "Macro calendar":** the live feed is unavailable and the events shown are a template, not real. If the feed fails entirely, the page shows an error. Escalate if it persists.
- **Mobile layout problems:** check the layout switch in More (auto/phone/tablet/desktop). Backtest has a known overflow problem on 375px phones.
- **The ★ watchlist button does nothing:** this is a known bug. Use + Symbol in the watchlist panel.
- **Browser support:** `TODO (needs Tyler):` Which browsers and versions are officially supported? The tests only use Chromium. Browsers that block storage (sandboxed or private modes) fall back to memory, so nothing is saved.

### Known limitations (current main)
- **13 browser tests fail on main** according to the ops log (18 Nov 2026). The ones users might notice:
  - **Backtest:** the test fails with "btRun not defined". The name exists only in the test, so this may be the test being out of date rather than a broken Run button. Not confirmed.
  - **Journal:** an error reading `pnl`. Journal P&L or stats may fail in some cases.
  - **Phone layout:** the Backtest page overflows sideways (700px of content on a 375px screen).
  - **Today's session summary:** open P&L doesn't match an independent recalculation (45.87 vs 46.94). Treat summary P&L as approximate.
  - **Shortcuts:** the test presses Alt+G for rectangle, but the code and the shortcut list use **Alt+R**. Tell users Alt+R.
  - **Calendar:** the next high-impact countdown time may be wrong.
  - **Position tool:** the test timed out.
  - **Price-flash animation:** fails on the chart price.
  - **Screen readers:** accessibility label mismatches on heatmap tiles and mini-chart cards.
  - **Not user-facing:** the screener test fixture is missing, and the legal-text test expects "no longer ships with a key".
- **No auth backend.** Sign-in is local only, with no recovery and no sync. TASK-04 is blocked.
- **The `vektor-proxy` Worker (`worker/`) is not deployed.** Production `/api/*` is the Pages Function → `worker.js`. The planned shared data service and provenance badges (LIVE/DELAYED/CACHED/SAMPLE everywhere) are **not built yet** (TASK-02 is blocked, TASK-03 is deferred).
- Simulated candles and screener prices for non-crypto symbols aren't consistently labelled as sample data.
- The backtester uses only about 250 recent bars. Replay depth isn't shown before playback starts (TASK-08 is open).
- Alerts only work while a tab is open. There are no email, SMS or push alerts from a server.
- Canvas charts can't be read by screen readers (the Data Window gives the values as text). Some drawing tools need a pointer.
- Security issues (exposed keys, data leaks, anything a user reports as a vulnerability) are never discussed in chat: thank the user and escalate to Tyler privately.

### Escalation path
- **The bot handles:** how-to questions, explaining features and shortcuts, data-source explanations, the guest/sign-in limits, API-key setup in Settings › Data, the cache, retry and reload steps, explaining the consent and privacy controls, and pointing to the Your data export or delete tools.
- **Escalate to Tyler (product, policy or legal):** pricing and plans, refunds and billing, legal or company details, data-rights requests (access, erasure and so on, besides the self-serve tools), security reports, accounts or sync promises, feature requests and dates, and complaints.
- **Escalate to operations (Bruce):** the live site is down, `/api/*` errors, wrong or simulated-looking prices, a "Macro calendar" fallback that persists, a gap badge that won't clear, Binance or Twelve Data outages, data loss after an update, any reproducible bug or console error, and any of the known failing areas above.
- **Collect before escalating:**
  - browser and version, device and OS, screen size or phone model
  - the exact URL including `#/page`
  - symbol, timeframe and market
  - signed in or guest (never ask for passwords; the username is optional)
  - the status-line text and any badge (Live/Delayed/Sample, CACHED FAILOVER)
  - the exact error message, a screenshot, and browser console errors (F12 → Console) if they can get them
  - time and timezone, and the steps to reproduce
  - whether a Twelve Data, Finnhub or Polygon key is set (**never ask for the key itself**)
- `TODO (needs Tyler):` What escalation channel should the bot use for Tyler and Bruce (ticket, email or chat)? What response time, if any, can the bot quote? No support hours or SLA exist in the repo.

### Bot rules
- **Never promise** features, fixes, release dates (including the 1 March 2027 target), paid plans, prices, refunds, compensation, or data recovery.
- **Not financial advice:** never recommend buying, selling or holding anything, and never read scores, P1–P5 tiers, phases, heatmaps, backtests or AI reviews as signals. Point to the Risk Disclaimer (`#/legal/risk`). Remind users that prices can be delayed or wrong and to check with their broker.
- Never ask for passwords or API keys. Remind users that the JSON export contains their saved keys.
- Never make up company names, addresses, contact details beyond `vektorhq@proton.me`, support hours, SLAs, social links or legal entities. If unsure, say you'll pass it to the team.
- Be honest that sign-in is a local prototype and that data lives only in the user's browser.
- Don't describe unreleased or uncommitted work (for example the starter watchlist) as available.

