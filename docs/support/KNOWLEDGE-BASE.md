# Support knowledge base

> Covers the live app on `main` as of 18 Nov 2026. Update this file when a change alters user-facing behaviour.
> Sources: `index.html` (the only code that runs in production), `worker.js`, `functions/api/[[path]].js`, `CHANGELOG.md`, `SETUP.md`, `tests/`, `AGENTS.md`, and the ops log. Files in `src/*.js` do not load in production unless noted below.
>
> Warning: This file is publicly downloadable from the live site (`screener-cso.pages.dev/AGENTS.md`). Never add secrets, keys, private contact details, or unpatched security issues here.

### What Vektor Terminal is

Vektor Terminal is a free browser-based charting and research tool covering crypto, forex, stocks, ETFs, futures, indices, and CFDs. It includes a screener, charts, drawing tools, alerts, watchlists, a trade journal, a manual backtester with bar replay, calculators, a heatmap, an economic calendar, and a custom indicator language (Vektor Script). It does not place trades, hold money, or connect to a broker. Its Terms describe it as "a browser-based set of market screening, charting, journaling, calculation and back-testing tools."

- Live URL: https://screener-cso.pages.dev
- Target public launch: 1 March 2027. The bot must not promise this date (see Bot rules).
- Pricing: the app is free today and no paid plans are on sale yet. Paid plans open at launch on 1 March 2027. All prices include VAT.
  - Free: live crypto, delayed stocks and FX, 3 charts, 3 indicators (the Vektor Script editor and language are included, and Vektor Script indicators count toward the 3-indicator limit), 3 alerts, unlimited P1-P5 screener tiering, full unrestricted backtesting and bar replay, heatmaps, and an unlimited journal.
  - Pro: £11.99/mo or £109/yr ($14.99 / $135).
  - Elite: £24.99/mo or £219/yr ($29.99 / $269).
- Elite 7-day free trial: available at launch (1 March 2027) on Elite only, not Free or Pro. A card is required upfront, and the trial auto-converts to paid Elite (£24.99/mo or £219/yr; $29.99 / $269) at the end of day 7 unless cancelled. Cancelling during the trial keeps Elite access until day 7 ends, with no charge. Trials are limited to one per person: emails are normalised by removing `+tags` on every domain before checking eligibility, and a card that already used a trial is offered Elite without one. Cancel path: `[cancel path TBC by Dex]`. Full cancellation terms are on the Terms and Refunds legal pages.
- "Plus" in the code refers to the chart's price-scale "+" button, not a pricing tier.

### Navigation

- Desktop top nav: Workspace, Supercharts, Screener, Heatmaps, Calendar, Journal, Calculators, and Backtest. Routes are `#/workspace`, `#/chart`, `#/screener`, `#/heatmap`, `#/calendar`, `#/journal`, `#/calc`, and `#/backtest`. Routes are case-insensitive, and the app reopens on the last page you used.
- Phones (under 700px wide): a bottom tab bar holds Workspace, Supercharts, Screener, Calculators, and More. More opens a sheet with Heatmaps, Calendar, Journal, Backtest, Today's session, legal links, Cookie settings, the layout switch, and data status.
- Tablets (700 to 1099px): all eight pages appear in a nav bar that wraps onto more than one line.
- Footer: shows a risk warning, links to every legal page, Cookie settings, and Keyboard shortcuts (hidden on touch-only phones).
- Clicking the VT logo returns to Workspace.

### Features and how to use them

**Screener (Workspace list and full-width Screener page)**
- Controls include a market filter (All, Forex, Futures, Stocks, CFDs, Crypto, ETFs, Indices), search, sorting by any column header, and a gear button on each column to edit it.
- Column types: Price, Volume, Dollar volume, Percent change, Candle change, Average daily range %, Moving average close, and Moving average trend.
- Presets P1-P5 filter from strictest (P1) to broadest (P5):
  - P1: full EMA alignment plus expansion.
  - P2: EMA alignment plus a positive change.
  - P3: a positive change plus partial alignment.
  - P4: any positive change.
  - P5: no filter.
  - Timeframe levels: H checks 1H against 1D, M checks 15m against 1H, and L checks 1m against 15m.
- The full Screener page adds Market, 1D %, ADR 14d, Vektor score, Expansion score/phase, and Tier columns. Clicking a row opens a side drawer with a mini chart and actions for Open in Supercharts, Workspace, watchlist, and alert. Esc closes the drawer.
- Built-in saved layouts include "Higher timeframe scan" and "Trend grid". You can save custom layouts and use "Export / import presets" to copy layouts between devices as pasted text.
- Desktop shows one continuous scrolling list; phones and tablets paginate with 20, 50, or 100 rows per page.
- A note under the table reads: "Scores, tiers (P1-P5) and phases are rule-based calculations on past price data. They don't predict prices and aren't investment advice."
- Mini-chart mode: the grid button next to "Data" switches the list to small candle charts (15m, 1H, 4H, or 1D). Click a card, or focus it and press Enter, to open the full chart.

**Charts (Workspace and Supercharts)**
- Chart header controls: symbol search (click, start typing, or press Ctrl+K), price and 1D %, market-status icon, interval picker, ★ watchlist toggle, "+ Watchlist" (changes to "✓ In Watchlist" once added), Locate in Screener, Indicators, Alerts, Settings, camera icon (Download image, Copy image, Open in new tab), Reset chart view, and a "TradingView ↗" link that opens the same symbol on TradingView.
- Timeframes: 1s, 5s, 10s, 15s, 30s, 45s, 1m, 3m, 5m, 15m, 30m, 45m, 1H, 2H, 3H, 4H, 12H, 1D, 1W, 1M (month), 3M, 6M, and 12M. You can add and favourite custom intervals.
- Chart types: candles by default. The code also supports hollow candles, line, area, and bar charts.
  - `TODO (needs Tyler):` I couldn't find a visible chart-type picker in `index.html`. Is there one, or does chart type only come from templates? The bot shouldn't tell users how to switch chart type until this is confirmed.
- Supercharts adds:
  - A right-hand dock with Watchlist, Active alerts (with Re-arm and delete), and a Data Window (OHLC, volume, and indicator values under the crosshair).
  - A 1-pane / 2-pane toggle. Pane 2 displays the same symbol on its own timeframe (5m to 1W) with a shared crosshair.
  - Templates to save the full chart setup (including the symbol is optional). You can load, rename, delete, set a default (★), and export or import JSON up to 2 MB and 100 templates.
- Settings tabs: Symbol, Status line, Scales and lines, Canvas, Features, and Interface.
- Price-scale "+": hover the price axis, click "+", and choose "Add alert at <price>" or "Draw horizontal line at <price>". Turn it off in Settings > Scales > "Plus button".
- Snapshots use html2canvas loaded from the jsDelivr CDN.

**Indicators**
- Built-in indicators: EMA, SMA, Bollinger Bands, Volume, RSI, and ATR. The default chart loads EMA 10 and EMA 20.
- Indicators > My scripts lists your saved Vektor Script indicators with Add/Remove, Edit, and New script.

**Vektor Script (custom indicators)**
- Open the editor with the Scripts button on the chart.
- Example: `macd = ema(close, 12) - ema(close, 26)` then `plot(macd, "MACD", color=blue)`.
- Language features:
  - Series (`VS_SERIES` in `index.html`): `open`, `high`, `low`, `close`, `volume`, `hl2`, `hlc3`, `ohlc4`, `bar_index`, and `time`. Use `close[1]` for past values.
  - Functions (all 29 in `VS_FN`): `sma`, `ema`, `rma`, `wma`, `stdev`, `highest`, `lowest`, `sum`, `change`, `roc`, `rsi`, `tr`, `atr`, `crossover`, `crossunder`, `cum`, `nz`, `abs`, `sqrt`, `log`, `exp`, `round`, `floor`, `ceil`, `pow`, `min`, `max`, `avg`, and `isna`.
  - Declarations: `indicator()`, `input()`, `plot()` (line, histogram, or area), and `hline()`.
- Built-in examples: MACD, RSI with bands, Bollinger Bands, Stochastic, EMA cross, Keltner channel, and rate of change.
- Errors report the line and column, a plain-English hint, "Did you mean" suggestions, and a Go to line button.
- Scripts run in a sandbox with no `eval`, no access to the page or storage, and enforced size, loop, and look-back limits.
- Import and export use `.vks.json` files up to 512 KB.

**Drawing tools (left toolbar, saved per symbol)**
- Tools: Cursor, Trend line, Ray, Extended line, Horizontal line, Horizontal ray, Vertical line, Arrow, Brush, Rectangle, Fib retracement, Long position, Short position, Text, Note, Price Range, and Date Range. The toolbar also includes magnet, lock, hide, and delete controls.
- The floating toolbar includes a templates button with built-in styles for trend lines, horizontal rays, Fib, and long/short tools. ★ sets a default style for new drawings. Saving your own template requires sign-in.
- Each tool remembers the last colour, width, and line style you used.
- On touch screens, the toolbar moves to a strip above the chart.

**Long/Short position tool**
- Click to place (default R:R is 1:2), then drag the target, stop, entry, and width handles.
- Labels display Target, Stop, "Open P&L / Closed P&L", Qty, and Risk/Reward Ratio.
- Open settings by double-clicking, clicking the gear button, or right-clicking > Settings. You can set account size, lot size, risk % or money, leverage, and precision.
- Right-click menu: Settings, Clone, Lock/Unlock, Hide, Delete, and Show hidden drawings.
- Results are paper calculations and do not place broker trades. If a candle hits both target and stop, the stop counts first.

**Alerts**
- Add alerts from the chart Alerts button, the price-scale "+", or "+ Alert" in the Supercharts dock.
- Conditions: Crossing, Crossing up, and Crossing down, with an optional custom pop-up message.
- Active alerts draw on the chart as dashed orange lines. Click a line to edit or delete it, or drag it to move the trigger price.
- Each alert fires once, then shows "triggered" with a Re-arm button. The app logs the last 200 triggered alerts.
- Alert sound is off by default. Turn it on, adjust volume, or test it in the Price Alerts dialog.
- The browser may ask permission for desktop notifications.
- Alerts only evaluate while the app is open in a browser tab. Nothing runs on a server.
- Guests must sign in before adding an alert.

**Watchlists**
- The watchlist panel groups symbols into sections (by default "Traded" and "Section") with "+ Symbol", "+ Section", edit, and remove buttons. Watchlist symbols load their data first.
- The chart header ★ button adds the current symbol to the first section or removes it from every section (`src/watchlist_starter.js`, loaded from `index.html`, defines `window.wlStar` for the header button's `wlStar()` call).
- "+ Watchlist" adds the symbol to the first section without duplicates, then shows "✓ In Watchlist".
- Locate in Screener opens the Screener with that row selected and scrolled into view. If a search or market filter was hiding it, the app clears those filters and displays a notice. If a preset or column filter still hides it, or the symbol is not in the screener list, a message explains why.
- Starter list (live, TASK-06): if the watchlist is empty for a guest or for a signed-in account with no prior saved work on this device (`VT_WL_FRESH`), the first section is seeded with BTCUSDT, EURUSD, SPY, XAUUSD, and NVDA. Existing accounts with saved settings are never seeded, even if their watchlist is empty. "Clear starter list" appears in the watchlist header only while the list holds exactly those five symbols and all other sections are empty; clearing or editing the list removes the button.

**Backtest Lab (Backtest page)**
- `#/backtest` is the Manual Backtest Lab only. There is no rules-based strategy runner in the live app (no EMA-cross, RSI-reversal, or N-bar-breakout backtest, and no `btRun` in `index.html`). "EMA cross" is a Vektor Script example, not a backtest strategy. `tests/backtest.js` uses `btBuild`, `btPlay`, and `btSeek`.
- Pick a symbol, start time (or a 20%, 50%, or 75% point in history), timeframe (1m, 5m, 15m, 1H, 4H, or 1D), starting balance, risk %, and fee per side. Then step or play bars and place manual Long or Short orders with stop-loss and take-profit.
- Bar replay controls: step back/forward, play/pause, speed (1x to 16x), timeline slider, and jump to start or end. Shortcuts: Left/Right step bars, Space toggles play/pause, B/S place Long/Short, X closes the position.
- Manual paper trading in replay: Long (B), Short (S), Close (X), and Reverse. Bracket presets are ATR 1:2 (default), ATR 1:3, 1% / 2%, or Manual stop/target. If a candle touches both stop and target, the stop fills first. All fills simulate on historical candles; nothing goes to a broker.
- Results show live equity, realised net, return, trade count, win rate, average R:R, profit factor, max drawdown, an equity curve, a trades table, and Export CSV. The CSV matches the Journal format with account "Manual Replay" and setup "Manual" so you can import it directly into the Journal.
- If fewer than about 250 bars are cached, the lab requests up to 1,500 bars from the edge (`replay=true`). Replay depth is not shown before playback starts (TASK-08 is open). Results are labelled hypothetical and not advice.

**Journal & Prop Tracker (Journal page)**
- Trades are entered manually; nothing connects to a broker.
- P&L = (exit - entry) × quantity × point value × direction - fees, or you can enter your broker's figure directly. R is calculated when you include a stop.
- Stats cover net P&L, win rate, profit factor, expectancy, average R, max drawdown, streaks, an equity curve, a monthly P&L calendar, and breakdowns by setup, weekday, and side.
- Prop challenge tracker: set a profit target, max daily loss, static or trailing drawdown, and minimum trading days. It flags rule breaches using closed trades only.
- Import CSV / export CSV validates rows, skips duplicates, and guards against spreadsheet formula injection.
- Journal review:
  - The local summary runs entirely in the browser and sends no data.
  - The optional AI review uses the user's own OpenAI, Anthropic, or OpenAI-compatible (https) key. Before every send, the app shows a disclosure and a "See exactly what will be sent" preview and requires a confirmation tick. The browser calls the provider directly. Replies are plain text, labelled AI-generated and not advice.

**Calendar & News (Calendar page)**
- Displays this week's economic events in the user's local time.
- Filters include impact, currency chips, search, and "show past". A countdown tracks the next high-impact event.
- Headlines load from Yahoo Finance RSS for symbols the user selects and open on the publisher's site.
- Check the source label:
  - "Forex Factory" means live feed data.
  - "Macro calendar" means the server could not reach the feed and substituted a built-in template week with hard-coded figures (`generateWeeklyMacroSchedule` in `worker.js`). Escalate if users rely on it.

**Heatmaps**
- A treemap of the screener's markets.
- Colour maps to % change vs previous close (1H, 4H, 1D, or 1W), momentum, or Vektor score. Tile size is traded value or equal, with 30, 60, or 100 tiles.
- A badge shows Live, Delayed, or Sample data, and the header displays "Candles as of HH:MM (cache)" when drawing from cached data.
- Arrow keys, Home, and End move between tiles; Enter opens the chart.

**Calculators**
- Forex and metals position size (lots, units, pip value).
- Futures contracts: ES/MES, NQ/MNQ, YM/MYM, RTY/M2K, CL/MCL, NG, GC/MGC, SI, HG, ZN, ZB, and 6E/6B/6J/6A.
- Pip/tick converter, drawdown recovery table, multiple prop accounts, and a Monte Carlo prop challenge simulator.
- JPY pip value states plainly when no live rate is available.

**Today's session summary**
- Open from "Today" in the header, or More > Today's session on phones. From 21:00, a chip offers it once a day.
- Shows position-tool paper P&L, market breadth and movers, and alerts triggered today, with "Copy as text" and "Download .txt".

**Themes, layout, sound, and motion**
- Dark/Light toggle sits in the header. Without a manual choice, it follows the system setting.
- Layout mode supports auto, phone, tablet, or desktop via the Phone / Tablet / PC icons in the header, Settings > Interface, or the layout switch in the More sheet.
- The app turns off animations when the device requests reduced motion.
- Only alerts play sound, and only when turned on.

### Keyboard shortcuts

- Anywhere: `?` toggles the shortcut list (disabled while typing, over another dialog, or on the sign-in screen). `Esc` closes a dialog, menu, or panel. `Tab`, `Enter`, and `Space` work as usual, and the first Tab offers "Skip to main content".
- Screener list: `↑` and `↓` move to the previous or next symbol.
- Chart (Workspace and Supercharts only):
  - Type a digit (e.g. `15`, `4H`) to change the interval.
  - Type letters to search for a symbol, or press `Ctrl+K`.
  - `←` and `→` scroll the chart (hold Ctrl for larger steps).
  - `Ctrl+Z` undo, `Ctrl+Y` or `Ctrl+Shift+Z` redo, `Ctrl+S` save now.
  - Drawing tools: `Alt+T` trend line, `Alt+H` horizontal line, `Alt+V` vertical line, `Alt+F` Fib, `Alt+R` rectangle, `Alt+A` arrow, `Alt+N` note.
  - `Ctrl+Alt+H` hides or shows all drawings.
  - `Delete` or `Backspace` deletes the selected drawing. `Esc` cancels drawing and returns to the cursor.
- Heatmaps: arrow keys move between tiles, `Home` jumps to the first, `End` to the last, and `Enter` opens the chart.
- Backtest bar replay: `→` and `←` step one bar forward or back, `Space` toggles play/pause, `B` buys (long), `S` sells (short), and `X` closes the open position (B/S work only when flat, X only with an open position).
- On a Mac, Ctrl displays as Cmd and Alt as Opt.
- Shortcuts do not fire while the cursor is inside a text field.

### Markets and data sources

- Crypto (Binance USDT pairs): live data from Binance's public servers (`data-api.binance.vision`, WebSocket `data-stream.binance.vision`). No key is required. CoinGecko acts as a fallback for daily candles.
- Forex, stocks, ETFs, indices, and futures: on the live site, chart candles come from `/api/candles`, a Cloudflare Pages Function in front of `worker.js`.
  - When the server has a Twelve Data key, candles come from Twelve Data.
  - Without one, the server returns simulated candles (`source:"simulator"`), and the chart does not label them as sample data.
  - Futures map to ETF or spot proxies (e.g. NQ to QQQ, ES to SPY, GC to XAU/USD, CL to WTI/USD).
- Screener snapshot (`/api/screener`): crypto rows use real Binance tickers. In the current `worker.js`, non-crypto rows return simulated prices and 1D % (`generateSyntheticCandles`).
  - Live check (18 Nov 2026, 21:2x GMT): `/api/screener` reported `source:"edge+sim"` with fixed-looking non-crypto prices (e.g. EURUSD 1.085), and `/api/candles` for EURUSD 1H returned `source:"simulator"`. Treat non-crypto prices on the live site as simulated until Tyler confirms otherwise.
  - `TODO (needs Tyler):` Should non-crypto (forex/stocks/indices/futures) prices on the live site be real? Right now they are simulated server-side. Until fixed, the bot must not tell users non-crypto prices are real-time.
- User's own keys (Settings > Data):
  - Finnhub and Polygon keys are optional stock fallbacks.
  - Twelve Data keys cannot be entered in the browser; they live only on the server (the `vektor-market` Worker).
- Offline sample data: a checkbox in the Data dialog simulates all prices. The status reads "Offline sample data" and the chart footer says "Sample data."
- Dukascopy: historical candles fetched by the backend for Backtest replay of FX, metals, indices, and commodities.
- Yahoo Finance: used only for news headlines (RSS via `/api/news`). Older docs mentioning Yahoo for forex prices are out of date.
- Forex Factory (Fair Economy): supplies the economic calendar.
- Optional data snapshot: `data/manifest.json` and `data/c_*.json`, used only if the operator publishes one.
- Limits and delays:
  - Backend candle cache: about 60s for live requests and 24h for older history chunks.
  - Twelve Data per-minute limit: the app waits 61s and retries. Hitting the daily limit stops the queue.
  - Binance 429/418 responses trigger a pause ("Binance rate limit, pausing").
  - Binance HTTP 451 means "Binance blocks this region".
  - Forex and CFD volume is tick volume, not traded volume.
  - When live feeds go quiet, the status reads "CACHED FAILOVER".
  - Other status texts: "Live · auto-scan", "Data N min ago", "N failed (…)".

### Account and sign-in

- Sign-in is a client-only placeholder with no backend. It accepts any username or email and any password. The password is never checked, stored, or sent. Only the username is remembered: in localStorage if "Keep me signed in" is ticked, or in sessionStorage (cleared when the tab closes) otherwise.
- The username only selects which browser storage bucket to use: `scr2~<code>` and `scr2p~<code>`, derived from the username with case and spaces ignored. Anyone typing the same username in the same browser sees that work. It separates people sharing a browser, but it provides no security.
- "Continue without signing in" (guest mode): charts and screener work, but nothing is saved. Work stays in memory, and only the guest choice persists for that tab. Alerts, chart settings, templates, and saving custom drawing templates prompt the guest to sign in.
- Because there is no server account, there is no password recovery, no server-side account deletion, and no cross-device sync. Different browsers or devices have separate data, and a different username opens an empty workspace.
- Clearing browser or site data, using private browsing, or running "Delete all my data" permanently erases saved work. There is no server copy.
- Legacy data from before accounts were separated (Nov 2026): the next person to sign in is prompted to choose "Import into my account" or "Not mine". If a guest signs in to an account that already has saved work, they choose whether to load the saved work or overwrite it with the current session.
- Backups and moving data:
  - Your data (`#/legal/your-data`) > Download my data (JSON) exports everything for the current account, optionally including the cache. The file contains saved API keys, so keep it safe.
  - There is no one-click restore for the full JSON export. Partial imports are available for Journal (Import CSV), chart templates (Import JSON), Vektor Script (`.vks.json`), and screener layouts ("Export / import presets" as pasted text).
- `TODO (needs Tyler):` When will real accounts exist (TASK-04 is blocked waiting on an auth backend decision)? What should the bot say about sync and recovery until then?

### Settings and privacy

- Stored in this browser:
  - localStorage `scr2~…` and `scr2p~…`: settings, watchlist, alerts and alert log, drawings, scripts, journal, layouts, and Finnhub and Polygon keys.
  - `vt_page`, `scr2a` (sign-in name), `vt_consent`, and `vt_consent_log`.
  - `vt_legacy`, when older data has not been claimed.
  - sessionStorage `vt_guest`.
  - With Optional preferences enabled: `vt_prefs` (sound) and `vt_aikey~…`.
  - IndexedDB database `scr`: optional market-data cache, created only after consent.
- No cookies, analytics, ads, or trackers. The app uses system fonts only and inline SVG icons.
- Consent banner: "Reject all" and "Accept all" have equal weight, alongside "Manage choices". Both optional categories (market-data cache and Optional preferences) are off by default. Users can reopen it anytime from Cookie settings in the footer. The banner asks again after 12 months.
- Data sent to third parties: IP address, user-agent, timestamp, and requested symbols or timeframes go to market-data providers (Binance, Twelve Data, Finnhub, Polygon, CoinGecko, Forex Factory, Yahoo RSS, Dukascopy, and the jsDelivr CDN). API keys go only to their own provider. Journal AI data goes only to the provider the user chooses, and only when they press Send.
- Legal pages (`#/legal/...`): Terms, Privacy (UK GDPR), Cookies & Local Storage, Your data, Risk Disclaimer, Data Sources, Disclaimer of Liability, Refunds & Cancellation, About & Contact, and Accessibility.
  - All legal pages are templates marked for solicitor review, with placeholders including `[Company legal name]`, `[Registered address]`, `[Company number]`, `[ICO registration number]`, and `[Effective date]`.
- Contact address in the app: `vektorhq@proton.me` (legal pages and data-request form).
- Data-rights requests: legal pages state "within one month". The Accessibility page reply time is a placeholder, `[5 working days]`.
- `TODO (needs Tyler):` Is `vektorhq@proton.me` the address users should be sent to for support, or only for legal/data requests?
- `TODO (needs Tyler):` What are the company legal name, address and registration details? Never fill them in yourself.

### Common issues and fixes

- Chart stuck on "Loading candles…" or showing an error box: the chart displays the real error with a Try again button. Check the status line. For forex or stocks, do not tell the user to add a Twelve Data key in the browser (those keys live only on the server). Otherwise, open Data > Retry failed, or Reload data to clear the cache and refetch.
- "Historical gap — waiting for fresh feed" badge: click Retry on the badge. If it keeps returning, escalate with the symbol and timeframe.
- "The chart library didn't load.": an ad blocker, corporate firewall, or offline connection is blocking the jsDelivr CDN. Allow `cdn.jsdelivr.net` and reload.
- No crypto, or "Binance unavailable (HTTP 451 … blocks this region)": Binance is blocking the user's region or network. The app cannot bypass this. Suggest a different network, or escalate.
- "Binance rate limit, pausing": wait. The app retries automatically.
- Twelve Data errors:
  - Per-minute limits retry after about 1 minute.
  - A daily-limit message stops all further Twelve Data requests until the provider resets the quota.
  - The app rejects invalid keys on save.
  - Keys clear when the tab closes unless Optional preferences consent is granted.
- Prices look stale, or status reads "CACHED FAILOVER": live sources are quiet, so cached data is shown. The cache refreshes automatically (intraday after about 15 minutes, daily after about 6 hours, plus every 15 minutes and when returning to the tab). Data > Reload data forces a refresh.
- Prices look unrealistic or differ from a broker:
  - Check whether "Offline sample data" is ticked, or whether the heatmap badge reads Sample.
  - Non-crypto prices may be simulated server-side (see Markets and data sources). Escalate with the symbol.
  - Always remind users to verify prices with their broker.
- Lost watchlist, drawings, or journal:
  - Ask whether they are using the same browser and exact username (case and spaces do not matter), whether they used guest mode, or whether they cleared site data or used private browsing.
  - Guest work and cleared data cannot be recovered.
  - If the user dismissed an "Import into my account" prompt with "Not mine", escalate.
- Cannot add alerts or save templates: the user is in guest mode. Click Sign in in the header; this does not reload the page or lose current work.
- Alert did not fire: alerts only run while a tab with the app is open. Each alert fires once and must be Re-armed. Sound is off by default, and browser notification permission must be granted.
- Calendar says "Macro calendar": the live feed is unavailable and the events shown come from a built-in template rather than live data. If the feed fails completely, the page shows an error. Escalate if it persists.
- Mobile layout problems: check the layout switch in More (auto, phone, tablet, or desktop). Backtest has a known horizontal overflow on 375px phones.
- ★ watchlist button does nothing: hard-refresh to load `src/watchlist_starter.js`, or use "+ Watchlist", "+ Symbol", or the watchlist button in the Screener drawer. Escalate if it still fails after a refresh.
- Browser support: `TODO (needs Tyler):` Which browsers and versions are officially supported? Tests only run on Chromium. Browsers that block storage (sandboxed or private modes) fall back to memory, so nothing is saved.

### Known limitations (current main)

- 13 browser tests fail on `main` per the ops log (18 Nov 2026). User-visible issues:
  - Backtest: `btRun` is not in the live app (`#/backtest` is the Manual Backtest Lab; `tests/backtest.js` uses `btBuild`, `btPlay`, and `btSeek`).
  - Journal: an error reading `pnl` can cause Journal P&L or stats to fail in some cases.
  - Phone layout: the Backtest page overflows horizontally (700px of content on a 375px screen).
  - Today's session summary: open P&L differs from an independent recalculation (45.87 vs 46.94). Treat summary P&L as approximate.
  - Shortcuts: the test presses `Alt+G` for rectangle, while the code and shortcut list bind `Alt+R`. Tell users `Alt+R`.
  - Calendar: the next high-impact countdown time may be wrong.
  - Position tool: the test timed out.
  - Price-flash animation: fails on the chart price.
  - Screen readers: accessibility label mismatches on heatmap tiles and mini-chart cards.
  - Not user-facing: the screener test fixture is missing, and the legal-text test expects "no longer ships with a key".
- No auth backend: sign-in is local only, with no recovery and no sync (TASK-04 is blocked).
- The `vektor-proxy` Worker (`worker/`) is not deployed. Production `/api/*` routes through the Pages Function to `worker.js`. The planned shared data service and provenance badges (LIVE, DELAYED, CACHED, SAMPLE everywhere) are not built yet (TASK-02 is blocked, TASK-03 is deferred).
- Simulated candles and screener prices for non-crypto symbols are not consistently labelled as sample data.
- The backtester fetches more history when fewer than about 250 bars are cached (up to 1,500 bars on replay), but replay depth is not shown before playback starts (TASK-08 is open).
- Alerts only run while a browser tab is open. There are no server-side email, SMS, or push alerts.
- Canvas charts cannot be read by screen readers (the Data Window provides values as text), and some drawing tools require a pointer.
- Security issues (exposed keys, data leaks, or any reported vulnerability) are never discussed in chat: thank the user and escalate to Tyler privately.

### Escalation path

- Bot handles: how-to questions, features and shortcuts, data-source explanations, guest and sign-in limits, API-key setup in Settings > Data, cache/retry/reload steps, consent and privacy controls, and pointing to Your data export or delete tools.
- Escalate to Tyler (product, policy, or legal): pricing and plans, refunds and billing, legal or company details, data-rights requests (access, erasure, etc. beyond self-serve tools), security reports, accounts or sync promises, feature requests and dates, and complaints.
- Escalate to operations (Bruce): site outages, `/api/*` errors, wrong or simulated-looking prices, a persistent "Macro calendar" fallback, a gap badge that will not clear, Binance or Twelve Data outages, data loss after an update, reproducible bugs or console errors, and any of the known failing areas above.
- Collect before escalating:
  - browser and version, device and OS, screen size or phone model
  - exact URL including `#/page`
  - symbol, timeframe, and market
  - signed in or guest (never ask for passwords; username is optional)
  - status-line text and any badge (Live/Delayed/Sample, CACHED FAILOVER)
  - exact error message, screenshot, and browser console errors (F12 > Console) if available
  - time and timezone, and steps to reproduce
  - whether a Twelve Data, Finnhub, or Polygon key is set (never ask for the key itself)
- `TODO (needs Tyler):` What escalation channel should the bot use for Tyler and Bruce (ticket, email or chat)? What response time, if any, can the bot quote? No support hours or SLA exist in the repo.

### Bot rules

- Never promise features, fixes, release dates (including the 1 March 2027 target), paid plans, prices, refunds, compensation, or data recovery.
- Not financial advice: never recommend buying, selling, or holding anything, and never treat scores, P1-P5 tiers, phases, heatmaps, backtests, or AI reviews as trading signals. Point to the Risk Disclaimer (`#/legal/risk`) and remind users that prices can be delayed or wrong and to check with their broker.
- Never ask for passwords or API keys. Remind users that the JSON export contains their saved keys.
- Never invent company names, addresses, contact details beyond `vektorhq@proton.me`, support hours, SLAs, social links, or legal entities. If unsure, say you will pass it to the team.
- Be honest that sign-in is a local prototype and data lives only in the user's browser.
- Do not describe unreleased or uncommitted work as available. The starter watchlist and the header ★, "+ Watchlist", and Locate in Screener controls are live (see Watchlists).
