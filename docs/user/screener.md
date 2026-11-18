# Screener

The screener is a table of markets (stocks, forex, crypto and other asset classes in the app’s universe). You will find it:

- in the left-hand list on **Workspace**
- as a full-width **Screener** page (`#/screener`), sometimes referred to in the code as Screener Pro, with extra columns, filter pills and a slide-over chart

The watchlist is separate; see [Watchlists](watchlists.md).

## Using the list

- Search the visible list with the search box.
- Filter by asset class with the market dropdown.
- Click a row to open that symbol on the chart. Arrow Up and Down move the selection.
- On a desktop (Workspace and Screener) the list is one continuous scrolling table with sticky headers; only nearby rows are drawn. Phones and tablets still paginate.
- Sort by clicking a column, or with the phone sort control.
- You can save and switch screener **layouts** (column sets) on this device, and export or import them.

A footnote on the list explains how **Absolute**, **Expansion** and **Dollar volume** are calculated:

- Absolute = |latest close − close N candles ago|
- Expansion = move from the lowest low (bullish) or highest high (bearish) of the last N candles to the latest close
- Dollar volume = price × 7-day average volume × contract size; FX/CFD volume is tick volume, so it is not filtered

Preset layouts are saved in this browser only; use Export/Import to move them between devices.

Under the list the app shows a short not-investment-advice note: scores, tiers (P1–P5) and phases are rule-based calculations on past price data. They do not predict prices and are not investment advice.

## P1–P5 presets

The preset buttons are **P1** to **P5**. The labels in the app are:

| Preset | Label in the app |
|---|---|
| P1 | Strictest filter: full EMA alignment + expansion |
| P2 | Strict filter: EMA alignment + positive change |
| P3 | Moderate filter: positive change + partial EMA alignment |
| P4 | Loose filter: any positive change |
| P5 | No filter: all markets |

**P5** always includes every market in the current search and asset-class filter.

The other presets use a higher **validation** timeframe and a lower **entry** timeframe, chosen with the **H / M / L** buttons (an info control explains them):

- **H** — entry 1H, validated on 1D
- **M** — entry 15m, validated on 1H
- **L** — entry 1m, validated on 15m

**Long** and **Short** set the direction. The default is Long (rising-price conditions). Short reverses the comparisons (falling-price conditions).

As implemented, a market also needs enough validation candles (at least 5, and 20 for the EMA tests). Change is measured over up to 20 bars on the validation timeframe. In more detail:

- A “positive change” (**chgOk**) means the validation-timeframe move is greater than **0.3%** (Long) or less than **−0.3%** (Short).
- **EMA alignment** (**emaOk**), when at least 20 validation bars are present, means the latest close is above both the EMA 10 and EMA 20 (Long), or below both (Short).
- **Expansion** (**exp**) uses the last 8 entry-timeframe closes: for Long, the close is more than 1% above the lowest of those eight; for Short, more than 1% below the highest.
- **P4** — `chgOk` only
- **P3** — `chgOk` and `emaOk`
- **P2** — `chgOk` and `emaOk`, and either expansion or an absolute validation change greater than 2%
- **P1** — `chgOk`, `emaOk`, expansion, and an absolute validation change greater than 3%

The **Vektor score** (0–100, used on the heatmap and some columns) is a separate points total: closes versus EMA 5/10/20 on both timeframes, size of the 20-bar change, and an alignment bonus, capped at 100. It is not the same test as P1–P5.

## S01–S04

The S01–S04 “Cycle” filter is **not** on the Screener page. It was removed. Cycle scores are no longer used to re-sort the list. An expansion / momentum read-out related to the old scoring function still feeds the Expansion column, the chart preview and the heatmap’s momentum metric.

## Mini-charts

Mini-chart mode draws a small sparkline for rows in the list. On long lists it shows batches of 48 with **Show more**.
