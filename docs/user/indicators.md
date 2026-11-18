# Indicators

The **Indicators** button on the chart toolbar opens the built-in indicator list. These are separate from [Vektor Script](vektor-script.md) custom scripts (listed under **My scripts** in the same dialog, and edited with the **Scripts** button).

## Built-in indicators

The app ships these six types (names as shown in the dialog):

| Key | Name |
|---|---|
| `ema` | EMA |
| `sma` | SMA |
| `bb` | Bollinger Bands |
| `vol` | Volume |
| `rsi` | RSI |
| `atr` | ATR |

A new Workspace chart starts with two EMAs, lengths **10** and **20**.

When you add an indicator, **length** defaults to 20 if you do not enter one, and is limited to 2–200. Each indicator has a colour and a line width (1–4). You can hide, edit or remove an indicator from the chart legend. A star marks **favourites** in the dialog.

The Data Window (crosshair values) shows the indicator readings for the bar under the cursor.

These calculations use the candles currently on the chart, including when the chart is in [sample mode](data-and-settings.md#offline-sample-data).

## Custom scripts

For MACD, Stochastic, Keltner channels and other studies, use **Scripts** and the shipped [Vektor Script examples](vektor-script.md#shipped-examples), or write your own. Built-in indicators cannot be extended in this dialog beyond the six types above.
