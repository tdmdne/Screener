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
