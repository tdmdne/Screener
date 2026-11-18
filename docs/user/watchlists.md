# Watchlists

Your watchlist is **your own list of symbols**. It is separate from the screener universe and from saved screener presets.

It appears in the left column on **Workspace**, under the heading **WATCHLIST**. You can collapse the whole list, add a **+ Symbol** or **+ Section**, and expand, rename or delete sections. Each section shows a name and a count.

Columns in the list are **Symbol**, **Last**, **Chg%** and **Vol**, using daily candles where they are available.

## Adding symbols

**+ Symbol** asks for one or more names and a section. Anything already in the screener is matched by name. For other stocks and ETFs you can type the ticker.

The dialog says that otherwise you should use the Yahoo format: `ES=F` (futures), `EURUSD=X` (forex), `BTC-USD` (crypto), `^GSPC` (indices), separated by commas or spaces. The app classifies a custom ticker from that pattern (`=X` as FX, `=F` as futures, `^` as an index, `-USD` as crypto, otherwise a stock).

On the chart toolbar, the **star** adds or removes the current symbol from the watchlist.

Signed-in work is saved on this device under your account’s storage key. Guest changes are not kept after you close the tab.

> TODO (needs Tyler): the add-symbol dialog and some code comments still talk about loading custom tickers “from Yahoo.” A Yahoo-style **symbol format** is clearly implemented. Whether those custom symbols still fetch prices from Yahoo Finance, or from Twelve Data / the edge router / the simulator, is not obvious from the current client (see [Data and settings](data-and-settings.md#yahoo-finance-wording)).
