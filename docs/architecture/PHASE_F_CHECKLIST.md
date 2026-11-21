# Phase F: UI/UX overhaul, fixes and upgrades (Tyler, 21 Nov 2026)

AGENTS.md §0 applies to every item: aggregation, indicators, volume profile, screener filtering, backtest execution and
journal analytics run on the backend; the browser is a 60fps display and interaction layer only.

## Merge gate (every phase PR, before merging into `main`)
1. All unit tests pass: `tests/*.test.mjs`.
2. Cloudflare Pages preview checked in Playwright with the smoke account (`smoke-creds.local.json`):
   `node tests/smoke-live.js <preview url>` at **desktop 1440x900** and `node tests/smoke-live.js <preview url> --mobile`
   at **mobile 390x844**: zero console errors, no overlapping or clipped buttons.
3. Sub-agent diff audit of `git diff origin/main...HEAD` for bugs, regressions and §0 violations (frontend maths).
4. **Safe stop:** if any check still fails after 2 fix attempts, stop and leave the PR unmerged, so `main` and
   vektorterminal.com stay intact.

## Phase 1: Critical bug fixes and chart tooling (`feat/p1-chart-fixes`)
- [x] Volume profile: time-at-price fallback when the feed has no volume (TD FX); POC / VAH / VAL drawn.
- [x] Snapshot button: chart + drawings PNG, download / copy with toasts.
- [x] Active tool style applied from the first click.
- [x] Left rail flyout arrows no longer cover the icons (TradingView behaviour).
- [x] Template menus: one-click Save (overwrite) for chart and drawing templates; indicator templates come in Phase 2.
- [ ] Merge gate.

## Phase 2: Navigation, header cleanup, mobile/tablet
- [ ] **Save Layout control (TradingView-style)** in the chart header: one-click Save (Ctrl/Cmd+S) with an unsaved-changes
      dot when drawings, indicators, timeframe or pane layout change; split arrow menu with Save As / Rename, Make a Copy,
      Load Layout and an Auto-save toggle. Persisted per user in D1 via `/api/me/data` (`layouts` namespace); guests keep
      a local copy. Covered in `tests/smoke-live.js` (save, dirty dot, load) and a harness browser test.
- [ ] Persistent top-left workspace switcher on every view.
- [ ] Header declutter: no Locate in Screener, no volume in the readout, Scripts inside Indicators (Indicators | Scripts | Templates).
- [ ] Centred symbol search modal (asset-class tabs, type-to-search, keyboard navigation).
- [ ] Mobile/tablet: minimal top bar, bottom dock, bottom sheets, horizontal scrollers.
- [ ] Merge gate.

## Phase 3: Screener, economic calendar, FX Replay
- [ ] Custom screener builder + saved screener templates (D1 via /api/me/data); larger server-side filter library.
- [ ] Economic calendar filters: currencies, impact, time horizon / custom range.
- [ ] Replay: leverage 1:1..1:500 with server-side margin/sizing; session setup; floating playback dock; MTF sync without lookahead; partial close / BE / SL-to-entry; end-of-session analytics.
- [ ] Merge gate.

## Phase 4: Journal (TradeZella-class)
- [ ] Server-side metrics: Sharpe, Sortino, profit factor, expectancy (R and currency), max drawdown, avg win/loss, MAE/MFE from server bars.
- [ ] Daily PnL calendar with drill-down, equity / R curve, breakdowns by setup, session, symbol, weekday.
- [ ] Auto-logging from backtest/paper with levels and drawings; open a journaled trade's chart setup.
- [ ] Playbooks, mistake tags with cost of mistakes, discipline score, review notes.
- [ ] Merge gate.
