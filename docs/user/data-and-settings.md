# Data and settings

**Data** (on Workspace or Screener, next to the list search) is where you choose feeds, paste optional API keys, and switch between live and sample data. Chart **Settings** (appearance, timezone and so on) are described in [Workspace and charts](workspace-charts.md#settings-themes-and-layouts).

## How prices are routed today

The Data dialog states the current routing:

- **Crypto** loads from **Binance Spot** (REST and WebSocket) only. No API key is required.
- **Forex, stocks, indices, ETFs and futures** load via the app’s backend edge router from **Twelve Data** (with an edge cache, and a single-symbol WebSocket stream).
- **Dukascopy** historical archives are used only for offline [Backtest replay](backtest-and-replay.md).

Optional fallbacks, if you paste a key:

- **Finnhub** — stock candles and a trade stream
- **Polygon** — stock candles and a stock/ETF list

**CoinGecko** can be used as a fallback for daily crypto candles when other crypto paths fail (no key is collected in the Data dialog).

The **Calendar &amp; News** page uses Forex Factory (Fair Economy) and Yahoo Finance RSS; see [Calendar and news](calendar-and-news.md).

When a live source is quiet, the status can read **CACHED FAILOVER** and the app may show cached data. A “Live · auto-scan” tag is used when live mode is on and the feed is moving.

## API keys on this device

- **Twelve Data:** type your own key in Data. It is kept in memory for the tab. It is saved as `vt_tdkey~…` (per signed-in account) only if **Optional preferences** is allowed in Cookie settings. It is never saved for guests, and it is deleted if you clear the field or withdraw that preference. The key is sent only to Twelve Data.
- **Finnhub and Polygon keys** are stored with your other signed-in settings (`scr2~…`) and are sent only to the provider they belong to.
- You can also put a Twelve Data key in a local `config.local.js` on a developer machine (see `config.example.js`); that file is for localhost only and must not be committed. A key typed in Data takes priority.

There is no Twelve Data key built into the app any more. If no key is set, forex and stocks that need Twelve Data may fail to load live bars (the chart can say there is no Twelve Data key). Crypto on Binance still works.

**Retry failed** and **Reload data** in the Data dialog clear or retry the in-memory and cached candle series. Reload data also empties the optional IndexedDB market-data cache.

### Yahoo Finance wording

> TODO (needs Tyler): several leftover strings still say that without a Twelve Data key, “forex and metals load from Yahoo only.” That sentence still appears under the Twelve Data field (`vtTdKeyNote()` in `index.html`). `CHANGELOG.md` and `SETUP.md` say the same. The Data dialog’s own routing paragraph, and the in-app Data Sources table, describe Yahoo Finance only as an RSS headline source, and describe non-crypto prices as Twelve Data (or the simulator). This author could not find a Yahoo Finance chart/quote HTTP client in the current `index.html`. Custom watchlist tickers are still *formatted* in a Yahoo style (see [Watchlists](watchlists.md)). Please confirm what should be told to users, and consider updating the leftover Data-dialog sentence so it matches the live routing.

## Offline sample data

Tick **Offline sample data instead** in the Data dialog. That sets data mode to `sample`. The chart note reads “Sample data.” and the status tag can read **Offline sample data**. Prices and volumes are simulated in the browser; they are not real market data. Indicators and scores then run on those simulated candles.

## Storage and consent

The first-visit banner and **Cookie settings** (footer) are described in [Getting started](getting-started.md#storage-on-this-device).

In short, as the running app implements it:

- The app states that it does not set cookies and does not use analytics or advertising trackers.
- Strictly necessary **localStorage** holds signed-in settings (`scr2~…`, including watchlist, alerts, drawings, scripts, journal, calculator inputs, Finnhub/Polygon keys), screener layouts (`scr2p~…`), the last page (`vt_page`), the sign-in name (`scr2a`), and the consent record (`vt_consent`, `vt_consent_log`).
- Guests get a session flag only (`vt_guest` in `sessionStorage`); their work is not written to `localStorage`.
- **Market-data cache** (IndexedDB database `scr`) is created only with consent.
- **Optional preferences** (`vt_prefs`, and remembered `vt_tdkey~…` / `vt_aikey~…`) are stored only with consent.

**Your data** in the legal pages (`#/legal/your-data`) can export or delete what is on this device, or start a rights request by email. **Log out** removes the sign-in entry. **Reload data** in Data empties the candle cache. Clearing this site’s data in the browser removes everything stored here.

Third-party services you use (Binance, Twelve Data, optional Finnhub/Polygon, CoinGecko, Dukascopy, Forex Factory, Yahoo RSS, jsDelivr, and any Journal AI provider) receive the request details needed to serve that data, including your IP address. The in-app **Privacy Policy** and **Data Sources** pages (`#/legal/privacy`, `#/legal/data`) are the full wording.
