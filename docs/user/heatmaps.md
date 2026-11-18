# Heatmaps

**Heatmaps** (`#/heatmap`) draws a treemap of markets from the same universe as the screener.

## What the tiles show

The universe is the screener’s symbol list, filtered by the **Market** control, ranked by traded value (price × volume), and limited to 30, 60 or 100 names (30 on a narrow screen by default, otherwise 60).

**Colour by** has three metrics:

| Metric | Meaning |
|---|---|
| % change | Change of the live price against the previous close of the selected timeframe (`1H`, `4H`, `1D` or `1W`) |
| Momentum (signed expansion) | The screener’s expansion read-out (green = rising, red = falling) |
| Vektor score | The same 0–100 score used in the screener (50 is treated as neutral on the colour scale) |

For % change you can also set the colour **Scale**: Auto, or ±1%, ±3%, ±5%, ±10%. Auto uses a 90th-percentile range of the visible values.

**Size** is either **Traded value** or **Equal** (every tile the same size).

Tiles update about once a second while the page is open, using the same live prices and candle store as the screener. The first paint can come from whatever was already cached when the app started. A footnote repeats that colours are not investment advice.

## Moving around

The grid is a keyboard-accessible treemap: arrow keys move between markets, Home and End jump to the first or last tile, and Enter opens the chart. Hover or focus shows a tooltip. See [Workspace and charts](workspace-charts.md#keyboard-shortcuts).
