# LEARNINGS (dated, deduplicated, one line each)

- 2026-11-20: `npm i --no-save <pkg>` prunes every other unsaved package (playwright disappeared after installing axe-core). Install test-only tools together: `npm i --no-save playwright axe-core`.
- 2026-11-20: Refreshing chart indicators over HTTP on every bar close would miss the 60 s `/api/candles` cache and spend about 1,440 Twelve Data credits a day per open 1m chart. Live indicator values come from hub `ind` WS frames instead; HTTP is for history only.
- 2026-11-20: Indicator pages fetched separately join exactly only if each page is computed over extra warm-up bars and then trimmed (`chartWindowWithIndicators`). Computing over the page alone leaves `period - 1` gaps at every `before=` boundary.
- 2026-11-20: `src/*.js`, `server.js` and `tests/harness.js` have CRLF line endings (autocrlf). Multi-line string replacements in Node scripts must normalise `\r\n` first, and inline `node -e` scripts break on apostrophes inside bash single quotes; use a script file.
- 2026-11-21: `rmInd()` reopens the Indicators dialog (it calls `indM()`); remove indicators from other UI with `S.chart.ind=filter; save(); drawChart()` instead.
- 2026-11-21: A dock list that rebuilds on every `dsel()`/`save()` breaks dblclick (the second click lands on a new node). Rebuild only when a content signature changes and update selection classes in place.
- 2026-11-21: `tests/drawpresets.js` (`#ds_tpl` timeout), `tests/shortcuts.js` (`#vft_kb` missing) and `tests/postool.js` already fail on origin/main `abbc7d9`.
- 2026-11-21: `index.html` is LF in the repo, but autocrlf does not renormalise it if the working copy turns all-CRLF (e.g. a script that re-joins with `
`): the commit then rewrites all 150 lines. Write `index.html` with `
` only and check `git show --stat` after each commit.
- 2026-11-21: The hub only streams `bar` frames for `view.chart.sym/tf`; extra series (compare, layout panes) need their own `view.chart.*` field plus `_broadcastBar`/`_symbolsFromView` support, or they never update live.
- 2026-11-21: Task 17 was ticked but alerts were still evaluated in the browser (`checkAlerts`); the hub evaluator never received alerts. Verify a 'server-side' claim by grepping for the client path, not by the existence of the server module.
- 2026-11-21: Also failing on origin/main `abbc7d9`: `calendar`, `claims`, `screener`, `sound` (besides drawpresets/layout/postool/shortcuts). The full browser sweep takes ~20 min (`tests/*.js`).
- 2026-11-21: Bash heredocs with JS containing `${...}` template literals plus quotes can break the tool's quoting (unexpected EOF); write such files with the Write tool and assemble with a short command.
- 2026-11-21: Heikin Ashi is still computed in the browser (`vtToHeikinAshi` in vt_02 and the backtest lab) - a §0 violation; move it to `shared/market/chartTransforms.js` (`type=heikin`) like Renko/Line Break.
- 2026-11-21: `tests/motion.js` is flaky (failed once in a full sweep, passed twice standalone).
- 2026-11-21: A reconnecting tab sends its alert set before processing queued 'fired offline' frames; the hub keeps one-shot user alerts fired unless the client's `armedAt` is newer than the hub's `firedAt`.
- 2026-11-21: `core.last` can hold hours-old ticks for unstreamed symbols; anything that fills at 'the current price' (paper) must check tick age (`t` is ms after normalizeTick).
- 2026-11-21: After a vektor-market deploy the first /ws connections can still hit the old MarketHub instance for a short while; re-test before concluding a deploy failed.
- 2026-11-21: The TD LRU pool evicts by recency regardless of viewers, so any server-side 'keep subscribed' (alerts, paper) can evict live charts' slots. Keep side subscriptions to cap-exempt feeds plus a small fixed TD reservation.
- 2026-11-21: Claude Security scans need the Workflow tool (Dynamic workflows setting); without it the plugin refuses to run and a manual review is the fallback.
