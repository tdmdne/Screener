# Workspace and charts

Charts in Vektor Terminal use TradingView Lightweight Charts (version 4.1.3), loaded from jsDelivr. The app can also open the same symbol and interval on TradingView in a new tab, via a small link on the chart toolbar. That link leaves this app; Vektor Terminal does not embed a TradingView account.

Nothing on the chart places a live broker order. The Long and Short **position tools** are drawing and sizing aids on the chart, saved with your other drawings.

## Workspace

**Workspace** (`#/workspace`) is the default page. On a wide (PC or large tablet) layout it shows:

- the **watchlist** and **screener list** on the left
- the **chart** on the right

On a narrower layout those areas stack. Click a row in the list to load that symbol on the chart. Arrow Up and Down move through the list.

## Supercharts

**Supercharts** is a separate page in the top navigation (`#/chart`). It is a full-width chart, without the Workspace side list.

The Supercharts dock (right-hand panel) can show one chart or **two charts side by side**, for example a higher and a lower timeframe. You can collapse or expand that panel. Chart templates (export and import as JSON) are available from a button next to Settings on Supercharts.

## Chart toolbar

On both Workspace and Supercharts the toolbar typically includes:

- **Symbol search** — click the symbol button, start typing a name, or press **Ctrl+K** (Cmd+K on a Mac)
- **Interval** — pick from the list, or type a number (for example `15` or `4H`). Available intervals run from `1s` through seconds, minutes, hours, `1D`, `1W` and months up to `12M`
- **Watchlist star** — add or remove the current symbol
- **Indicators** — built-in overlays (see [Indicators](indicators.md))
- **Alerts** — price alerts (see [Alerts](alerts.md))
- **Scripts** — [Vektor Script](vektor-script.md) editor
- **Settings** — candles, colours, timezone, status line, scales, features and interface
- **Snapshot** — download an image, copy an image, or open it in a new tab (uses html2canvas 1.4.1)
- **Reset chart view**

A short line under the chart says “Live data.” or “Sample data.”

## Drawing tools

A left-hand toolbar, in the style of a typical trading chart, offers these tools (names as shown in the app):

| Tool | Name in the app |
|---|---|
| Cursor | Cursor |
| Trend line | Trend line |
| Ray | Ray |
| Extended line | Extended line |
| Horizontal line | Horizontal line |
| Horizontal ray | Horizontal ray |
| Vertical line | Vertical line |
| Rectangle | Rectangle |
| Fib retracement | Fib retracement |
| Long position | Long position |
| Short position | Short position |
| Text | Text |
| Note | Note |
| Arrow | Arrow |
| Path | Path |
| Curve | Curve |
| Brush | Brush |
| Price Range | Price Range |
| Date Range | Date Range |

Drawings are saved per symbol (when you are signed in; guests are not persisted — see [Getting started](getting-started.md#sign-in-and-guest-mode)). Line styles include Solid, Dashed, Dotted, Dash-dot and Sparse dotted. You can save **drawing templates** (per-tool style presets).

The **Long** and **Short** position tools are built in the app’s own canvas code. You can place a position, drag entry, stop, target and width, and open a settings dialog (inputs, style, visibility). A right-click menu can clone, lock, hide or delete a position. Quantity, R:R and P&amp;L labels are calculated from the prices you set; they are not live brokerage tickets.

## Keyboard shortcuts

Press **?** anywhere (except while typing in a field) to open the in-app list, or use **Keyboard shortcuts** in the footer. The list is the authoritative set: each shortcut is covered by `tests/shortcuts.js`. On a Mac, Ctrl is shown as Cmd and Alt as Opt.

**Anywhere**

- `?` — show or hide the list
- `Esc` — close a dialog, menu or panel
- `Tab` — move between controls; the first Tab offers “Skip to main content”
- `Enter` or `Space` — activate the focused item

**Screener list** (Workspace, Supercharts and Screener)

- `Down` / `Up` — next or previous symbol

**Chart** (Workspace and Supercharts)

- `0`–`9` — change interval (type a number, for example 15 or 4H)
- `A`–`Z` — search symbol (start typing a name)
- `Left` / `Right` — scroll the chart (hold Ctrl for bigger steps)
- `Ctrl+Z` — undo
- `Ctrl+Y` or `Ctrl+Shift+Z` — redo
- `Ctrl+S` — save now
- `Alt+T` — trend line
- `Alt+H` — horizontal line
- `Alt+V` — vertical line
- `Alt+F` — Fibonacci retracement
- `Alt+R` — rectangle
- `Alt+A` — arrow
- `Alt+N` — note
- `Ctrl+Alt+H` — hide or show all drawings
- `Delete` or `Backspace` — delete the selected drawing
- `Esc` — cancel drawing and return to the cursor
- `Ctrl+K` — open symbol search (this is implemented on the chart, and shown on the symbol button; it is not repeated on the `?` overlay)

**Heatmaps**

- Arrow keys — move between markets
- `Home` / `End` — first or last market
- `Enter` — open the chart

## Settings, themes and layouts

**Settings** on the chart is a tabbed dialog: Symbol (candle colours, timezone), Status line, Scales and lines, Canvas, Features and Interface. Guests who open Settings are asked to sign in if they want those choices saved.

**Timezone** options in Settings include New York, UTC, London, Paris, Berlin, Tokyo, Shanghai, Singapore, Hong Kong, Sydney, Dubai, Moscow, São Paulo, Chicago, Denver and Los Angeles (with the UTC offsets shown in the dialog).

The header layout buttons set **phone**, **tablet** or **PC**. If you leave the choice on automatic, the breakpoints are: phone below 700px width, tablet below 1,100px, otherwise PC. A wide tablet (900px or more) can also use a split (side-by-side) Workspace.

**Theme:** a header control toggles dark and light. If you have not saved a choice, the app follows the system `prefers-color-scheme`. Charts are redrawn when the theme changes.

## Mini-charts

The screener can show a **mini-chart** mode: a small sparkline for each row, in batches of 48 on long lists, with a “Show more” control. This is a compact view of the same candle data, not a separate product.
