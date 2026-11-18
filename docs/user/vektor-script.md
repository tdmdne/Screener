# Vektor Script

Vektor Script is a small indicator language built into the app. Open **Scripts** on the chart toolbar to edit, check, save, import and export scripts, and to add the shipped examples. Enabled scripts are drawn on the Workspace and Supercharts price scale (overlay) or in a band under the chart.

This reference describes the **interpreter in the running app** (`index.html`). It is not a copy of every function that exists in the extracted `src/47_vs_engine.js` module, which is not loaded by the live page (see [Differences from `src/`](#differences-from-src)).

Scripts are calculations on the chart’s candles. They are not investment advice, and they cannot place trades.

The editor’s **Language help** panel lists the same syntax, operators, series, function signatures and colours as below.

## Syntax

- Each line is `name = expression` or a call such as `plot(...)`.
- `//` starts a comment to the end of the line.
- `;` is treated as a line break.
- Identifiers are letters, digits and `_`, and must not be a built-in series or function name (the editor will suggest another name, for example `my_close`).
- `:=` is accepted and stored as `=`.
- Text for titles and colours is a single- or double-quoted string on one line, at most 80 characters.
- Colours are `#rgb` or `#rrggbb`, or a name: `blue`, `red`, `green`, `orange`, `yellow`, `purple`, `teal`, `gray`, `grey`, `white`, `black`, `aqua`, `lime`, `fuchsia`, `navy`, `maroon`, `olive`, `silver`.
- Keywords: `and`, `or`, `not`, `true`, `false`, `na`. `na` is a missing value (NaN).
- Scientific numbers such as `1e-3` are allowed.
- A `.` that is not part of a number is rejected: the language has no object properties. Write `sma(close, 20)`, not `ta.sma(...)`.

## Operators

- Arithmetic: `+` `-` `*` `/` `%`
- Comparison: `<` `<=` `>` `>=` `==` `!=`
- Logic: `and` `or` `not`
- Ternary: `condition ? a : b`
- History: `close[1]` is the previous bar (`[n]` shifts a series back by n bars)

When a function expects a series and you pass a number, the number is expanded to a series the length of the chart.

## Series

These built-in series are the chart’s candles:

`open`, `high`, `low`, `close`, `volume`, `hl2`, `hlc3`, `ohlc4`, `bar_index`, `time`

## Declarations

Only these four declarations exist in the running app: `indicator`, `input`, `plot`, `hline`.

### `indicator("Name", overlay=true)`

Sets the display name (at most 60 characters) and whether the script is an overlay. `overlay=false` draws in its own band. The only allowed option is `overlay`.

### `input(default, "Title", min=…, max=…)`

A numeric input, shown in the editor when the script is checked or saved. The first argument is the default (required). The optional second argument is the title (otherwise `Input 1`, `Input 2`, …). Optional named bounds are `min` and `max` (if omitted they are a very large range). Saved input values are looked up by title.

There is no `input_bool` or `input_source` in the running app.

### `plot(series, "Title", color=…, width=…, style=…)`

Draws a series. At most 12 plots (`VS_LIM.plots`). The first argument is required. The optional second argument is the title. Colour may be a named option `color=` or a third positional argument; otherwise colours cycle through blue, orange, purple, green and red. `width` is 1–4 (default 2). `style` is `"line"`, `"histogram"` or `"area"` (default `"line"`). No other named options are allowed.

### `hline(value, "Title", color=…)`

A horizontal level. At most 8 lines (`VS_LIM.hlines`). The value must be a number (not a series). The optional second argument is a title. `color` defaults to gray.

There is no `plotshape` or `bgcolor` in the running app.

## Functions

Lengths passed to moving-average and window functions must be a **number**, not a series, at least 1, and at most 1,000 (`VS_LIM.len`).

If every argument is a number, the result is a number. If any argument is a series, the result is a series the length of the chart (missing values are `na`). Named options are not allowed on these functions; use the positional arguments in the signatures below.

| Signature | What it returns in this implementation |
|---|---|
| `sma(source, length)` | Simple moving average. A missing bar resets the window. |
| `ema(source, length)` | Exponential moving average, α = 2/(length+1). The first value is the SMA of the first `length` valid bars; later missing bars are skipped rather than resetting the average. |
| `rma(source, length)` | Wilder-style moving average: an EMA with α = 1/length. |
| `wma(source, length)` | Weighted moving average; weights `1…length`, divisor `length×(length+1)/2`. A window that contains `na` is itself `na`. |
| `stdev(source, length)` | Population standard deviation of the window (the sum of squared deviations is divided by `length`, not `length−1`). |
| `highest(source, length)` | Highest value in the window. |
| `lowest(source, length)` | Lowest value in the window. |
| `sum(source, length)` | Sum of the window. |
| `change(source, length = 1)` | `source` minus `source` from `length` bars earlier. |
| `roc(source, length)` | Rate of change as a percentage: `(source / previous − 1) × 100`. |
| `rsi(source, length)` | Relative Strength Index using Wilder averages of gains and losses. |
| `tr()` | True range for each bar (no arguments). |
| `atr(length)` | Average true range: an RMA of `tr()`. |
| `crossover(a, b)` | `1` on bars where `a` crosses above `b`, otherwise `0`. |
| `crossunder(a, b)` | `1` on bars where `a` crosses below `b`, otherwise `0`. |
| `cum(source)` | Running sum. Missing values are skipped (they do not add, and they do not reset the total). |
| `nz(source, replacement = 0)` | Replaces `na` with `replacement` (default 0). |
| `abs(x)` | Absolute value. |
| `sqrt(x)` | Square root. |
| `log(x)` | Natural logarithm. |
| `exp(x)` | e raised to `x`. |
| `round(x, decimals = 0)` | Rounded to `decimals` places (0–10 when `decimals` is a number). |
| `floor(x)` | Floor. |
| `ceil(x)` | Ceiling. |
| `pow(x, y)` | `x` raised to `y`. |
| `min(a, b)` | Minimum; `na` if either side is `na`. |
| `max(a, b)` | Maximum; `na` if either side is `na`. |
| `avg(a, b)` | Midpoint `(a + b) / 2`. |
| `isna(x)` | `1` if `x` is `na`, otherwise `0`. |

Unknown function names produce an error; the interpreter may suggest a close spelling.

There are **no** built-in `macd()`, `bb()`, `vwap()`, `stoch()` or `cci()` functions in the running app. The shipped examples that look like those studies are written with the functions above (for example MACD is built from `ema`).

## Limits (`VS_LIM`)

| Limit | Value |
|---|---|
| Source length | 20,000 characters |
| Statements | 300 |
| Expression depth | 40 |
| Window / length argument | 1,000 |
| Plots | 12 |
| Horizontal lines | 8 |
| Evaluated nodes | 2,000,000 |

You can keep up to **50** scripts. Names are at most 60 characters. A new blank script starts as:

```
indicator("My script", overlay=true)
plot(ema(close, 20), "EMA 20", color=orange)
```

## Sandbox rules

The source is never passed to `eval` or `Function`. There is no member access, no loops, and no strings beyond literal titles and colours. Names resolve only from the fixed series, function and declaration tables (a null-prototype map). A script can read the chart’s candles and draw lines; it cannot open pages, send data, or read storage. Work is bounded by the limits above. Hostile or runaway scripts are rejected with a line and column (covered by `tests/scripts.js`).

## Import and export

- **Export** / **Export all** downloads JSON with `format: "vektor-script"`, `version: 1`, an `exported` timestamp, and `scripts: [{name, src, inp}]`. A single script is named from its title with a `.vks.json` suffix; several scripts use `vektor-scripts.vks.json`.
- **Import** accepts `.json`, `.vks` or `.txt` (or typed JSON). A file may be that export shape, an array, a single `{name, src}` object, or plain script text. Maximum file size is **512 KB**. Only known fields are kept; at most 30 numeric inputs per script, keys at most 80 characters. Scripts that fail to parse are reported and skipped. At most 50 scripts are taken from one file.

## Pine translation

The running app’s Scripts editor has **Check**, **Save**, **Duplicate**, **Export** and **Delete**. It does **not** have a “Translate Pine” button, and `index.html` does not contain `vsTranspilePine`.

> A Pine-to-Vektor translator and extra declarations (`input_bool`, `input_source`, `plotshape`, `bgcolor`) plus `macd` / `bb` / `vwap` / `stoch` / `cci` exist in `src/47_vs_engine.js` and `src/48_vs_ui.js`, but those files are not loaded by the live page (the only `src/` script the monolith includes is `src/auth_email_validation.js`). This manual does not document them as available features.

## Shipped examples

These seven examples are the `VS_EX` list in the running app, copied verbatim. Choosing one adds a copy to **My scripts**.

### MACD

```
indicator("MACD", overlay=false)
fast = input(12, "Fast length", min=1, max=200)
slow = input(26, "Slow length", min=1, max=400)
signal_len = input(9, "Signal length", min=1, max=100)
macd = ema(close, fast) - ema(close, slow)
signal = ema(macd, signal_len)
plot(macd - signal, "Histogram", color=gray, style="histogram")
plot(macd, "MACD", color=blue)
plot(signal, "Signal", color=orange)
hline(0, "Zero")
```

### RSI with bands

```
indicator("RSI", overlay=false)
len = input(14, "Length", min=2, max=200)
r = rsi(close, len)
plot(r, "RSI", color=purple)
hline(70, "Upper", color=red)
hline(30, "Lower", color=green)
```

### Bollinger Bands

```
indicator("Bollinger Bands", overlay=true)
len = input(20, "Length", min=2, max=400)
mult = input(2, "StdDev", min=0.5, max=5)
basis = sma(close, len)
dev = mult * stdev(close, len)
plot(basis, "Basis", color=orange)
plot(basis + dev, "Upper", color=blue, width=1)
plot(basis - dev, "Lower", color=blue, width=1)
```

### Stochastic

```
indicator("Stochastic", overlay=false)
k_len = input(14, "%K length", min=1, max=200)
d_len = input(3, "%D smoothing", min=1, max=50)
lo = lowest(low, k_len)
hi = highest(high, k_len)
k = hi - lo == 0 ? 50 : 100 * (close - lo) / (hi - lo)
d = sma(k, d_len)
plot(k, "%K", color=blue)
plot(d, "%D", color=orange)
hline(80, "Upper")
hline(20, "Lower")
```

### EMA cross

```
indicator("EMA cross", overlay=true)
fast_len = input(9, "Fast", min=1, max=200)
slow_len = input(21, "Slow", min=1, max=400)
fast = ema(close, fast_len)
slow = ema(close, slow_len)
plot(fast, "Fast EMA", color=teal)
plot(slow, "Slow EMA", color=red)
```

### Keltner channel (ATR)

```
indicator("Keltner channel", overlay=true)
len = input(20, "Length", min=2, max=400)
mult = input(1.5, "ATR multiple", min=0.1, max=10)
mid = ema(close, len)
band = mult * atr(len)
plot(mid, "Middle", color=gray)
plot(mid + band, "Upper", color=teal, width=1)
plot(mid - band, "Lower", color=teal, width=1)
```

### Rate of change

```
indicator("Rate of change", overlay=false)
len = input(10, "Length", min=1, max=400)
plot(roc(close, len), "ROC %", color=blue)
hline(0, "Zero")
```

## Differences from `src/`

For contributors: `src/47_vs_engine.js` currently adds `macd`, `bb`, `vwap`, `stoch`, `cci`, `input_bool`, `input_source`, `plotshape`, `bgcolor`, and `vsTranspilePine`. Those are **not** in `index.html` today, so they are not available to users of the running app. When the monolith extraction lands, this page should be updated against whatever `index.html` then loads.
