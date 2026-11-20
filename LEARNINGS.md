# LEARNINGS (dated, deduplicated, one line each)

- 2026-11-20: `npm i --no-save <pkg>` prunes every other unsaved package (playwright disappeared after installing axe-core). Install test-only tools together: `npm i --no-save playwright axe-core`.
- 2026-11-20: Refreshing chart indicators over HTTP on every bar close would miss the 60 s `/api/candles` cache and spend about 1,440 Twelve Data credits a day per open 1m chart. Live indicator values come from hub `ind` WS frames instead; HTTP is for history only.
- 2026-11-20: Indicator pages fetched separately join exactly only if each page is computed over extra warm-up bars and then trimmed (`chartWindowWithIndicators`). Computing over the page alone leaves `period - 1` gaps at every `before=` boundary.
- 2026-11-20: `src/*.js`, `server.js` and `tests/harness.js` have CRLF line endings (autocrlf). Multi-line string replacements in Node scripts must normalise `\r\n` first, and inline `node -e` scripts break on apostrophes inside bash single quotes; use a script file.
