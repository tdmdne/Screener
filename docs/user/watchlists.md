# Watchlists

Your watchlist is **your own list of symbols**. It is separate from the screener universe and from saved screener presets.

It appears in the left column on **Workspace**, under the heading **WATCHLIST**. You can collapse the whole list, add a **+ Symbol** or **+ Section**, and expand, rename or delete sections. Each section shows a name and a count. A new watchlist starts with two empty sections named **Traded** and **Section**.

Columns in the list are **Symbol**, **Last**, **Chg%** and **Vol**, using daily candles where they are available.

## Starter list

For a guest, or a signed-in account that has no saved work on this device yet, the app can seed the first section with five symbols: **BTCUSDT**, **EURUSD**, **SPY**, **XAUUSD** and **NVDA**. Existing accounts that already have saved settings are not changed, even if their watchlist is empty.

While that list is still exactly those five symbols (and the other sections are still empty), a **Clear starter list** button appears in the watchlist heading. It removes those five names. Any other change (adding, removing or reordering symbols) marks the starter as finished, and the button goes away.

## Adding symbols

**+ Symbol** asks for one or more names and a section. Anything already in the screener is matched by name. For other stocks and ETFs you can type the ticker.

The dialog says that otherwise you should use the Yahoo format: `ES=F` (futures), `EURUSD=X` (forex), `BTC-USD` (crypto), `^GSPC` (indices), separated by commas or spaces. The app classifies a custom ticker from that pattern (`=X` as FX, `=F` as futures, `^` as an index, `-USD` as crypto, otherwise a stock). That is a **naming convention only**. Custom and built-in symbols load prices through the same routes as the rest of the app (Binance for crypto; the edge router / Twelve Data, or the worker’s simulator, for other markets). There is no Yahoo Finance price client in the running app. See [Data and settings](data-and-settings.md#how-prices-are-routed-today).

On the chart header:

- the **star** adds the current symbol to the first section, or removes it from every section
- **+ Watchlist** adds it to the first section (it changes to **✓ In Watchlist** if the symbol is already there, and does not add a duplicate)
- **Locate in Screener** switches to the Screener, selects the row and scrolls to it. If a search or market filter was hiding the symbol, those filters are cleared first. If a preset or column filter still hides it, the app says so. If the symbol is not in the screener’s market list, it says that instead.

Signed-in work is saved on this device under your account’s storage key. Guest changes are not kept after you close the tab.
