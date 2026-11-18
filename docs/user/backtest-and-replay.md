# Backtest and replay

**Backtest** (`#/backtest`) is the **Manual Backtest Lab**: an interactive bar-replay paper-trading desk on historical candles. It does not connect to a broker and does not place live orders.

The in-app risk disclaimer applies in full: back-tests and bar replays are hypothetical, benefit from hindsight, and typically ignore some real-world costs. The lab does let you set a **fee** percentage (default 0.05% in the code). Real results will differ.

## How a session works

You pick:

- a **symbol** (default is the Workspace chart symbol, or `BTCUSDT` if none)
- a **timeframe** (default `1H`)
- a **start date and time**
- a starting **balance** (default 10,000)
- **risk %** per trade (default 1%)
- **fee %**
- a stop/target **bracket** style (the default in the code is `atr2`, a multiple of ATR)
- **playback speed**

The app loads historical candles, including — for forex, metals, indices and commodities in its map — **Dukascopy** archives. Those archives are used **only** for this offline replay, not for the live Workspace chart. Crypto replay uses the same Binance history path as the rest of the app. See [Data and settings](data-and-settings.md).

You can step **back** and **forward** one bar at a time, jump to the start or end, or **auto-play**. At each bar you can place a manual **Long** or **Short** with stop-loss and take-profit, **update SL/TP**, **reverse** (close and flip), or **close** at the current bar’s price. Quantity is derived from your risk %, stop distance and live equity.

The desk shows open-position details (entry, mark, quantity, planned R:R, stop and target, unrealised P&amp;L) and running **performance** figures such as equity, return, and a trade log.

This is paper trading on recorded (or, in sample mode, simulated) bars. It is not a recommendation and not a record of live fills.
