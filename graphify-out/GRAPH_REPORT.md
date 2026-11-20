# Graph Report - Screener  (2026-11-20)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 684 nodes · 1322 edges · 48 communities (43 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `761e1451`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- worker.js
- 94_edge_client.js
- server.js
- 54_backtest.js
- 47_vs_engine.js
- 95_symbol_search.js
- 51_journal.js
- 53_calendar.js
- 48_vs_ui.js
- 91_privacy.js
- 50_journal_logic.js
- 52_jai.js
- ref_fs
- harness.js
- logic.js
- launch
- ref_assert
- 97_sweep.js
- 10_router.js
- ref_path
- package.json
- 92_account.js
- calendar.js
- sound.js
- unit.js
- fetchDukascopyBi5Block
- 90_legal.js
- jai.js
- 98_layout.js
- journal.js
- shortcuts.js
- templates.js
- generateSyntheticCandles
- a11y.js
- backtest.js
- minicharts.js
- scripts.js
- summary.js
- sweep.js
- scripts
- accounts.js
- mobile_qa.js
- motion.js
- heatmap.js
- smoke.spec.js
- ensureBinanceUpstream

## God Nodes (most connected - your core abstractions)
1. `launch()` - 39 edges
2. `vsM()` - 17 edges
3. `btBuild()` - 15 edges
4. `jrRender()` - 15 edges
5. `calRender()` - 15 edges
6. `fetch()` - 13 edges
7. `vtCanUseEdge()` - 13 edges
8. `jaiCardRender()` - 13 edges
9. `ev()` - 12 edges
10. `jrBuild()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `onRequest()` --calls--> `fetch()`  [EXTRACTED]
  functions/api/[[path]].js → worker.js
- `run()` --calls--> `launch()`  [EXTRACTED]
  tests/mobile_qa.js → tests/harness.js
- `setup()` --calls--> `launch()`  [EXTRACTED]
  tests/postool.js → tests/harness.js
- `run()` --calls--> `launch()`  [EXTRACTED]
  tests/mobile.js → tests/harness.js

## Import Cycles
- None detected.

## Communities (48 total, 5 thin omitted)

### Community 0 - "worker.js"
Cohesion: 0.08
Nodes (42): onRequest(), aggregateCandles(), BASE_INSTRUMENTS, BINANCE_MIRRORS, BNI, buildScreenerSnapshot(), BY_SYM, CANDLE_IN_FLIGHT (+34 more)

### Community 1 - "94_edge_client.js"
Cohesion: 0.11
Nodes (43): edgeFetchCandles(), edgeScreenerInit(), pumpEdge(), QE, VT_BNI, VT_CANDLE_EDGE_CACHE, VT_CANDLE_IN_FLIGHT, VT_EDGE (+35 more)

### Community 2 - "server.js"
Cohesion: 0.06
Nodes (31): app, BASE_INSTRUMENTS, BINANCE_MIRRORS, BNI, BY_SYM, CACHE_SIZES, calendarCache, CANDLE_IN_FLIGHT (+23 more)

### Community 3 - "54_backtest.js"
Cohesion: 0.17
Nodes (31): BT, BT_IC, btAtrAt(), btBracketPrices(), btBuild(), btCalcQty(), btCfg(), btCloseInternal() (+23 more)

### Community 4 - "47_vs_engine.js"
Cohesion: 0.15
Nodes (29): VS_COLORS, VS_DECL, VS_FN, VS_LIM, VS_SERIES, vsColor(), vsEMA(), vsErr() (+21 more)

### Community 5 - "95_symbol_search.js"
Cohesion: 0.14
Nodes (28): hideSr(), hideSrBox(), srch(), srchGo(), srchKey(), syCancel(), syConfirm(), syOpen() (+20 more)

### Community 6 - "51_journal.js"
Cohesion: 0.24
Nodes (26): enter(), jrAbs(), jrAcctEdit(), jrAcctNames(), jrBuild(), jrCal(), jrCfg(), jrCls() (+18 more)

### Community 7 - "53_calendar.js"
Cohesion: 0.19
Nodes (25): CAL, CAL_IMP, CAL_TZ_PRESETS, calActCls(), calBuild(), calCfg(), calDateFmt(), calDayKey() (+17 more)

### Community 8 - "48_vs_ui.js"
Cohesion: 0.20
Nodes (24): VS_EX, vsBarsKey(), vsBtn(), vsCfg(), vsCheck(), vsClean(), vsCompute(), vsExport() (+16 more)

### Community 9 - "91_privacy.js"
Cohesion: 0.17
Nodes (22): DSR_TYPES, vtBanner(), vtBannerClose(), vtCacheApply(), vtCacheOK(), vtConsent(), vtConsentLog(), vtConsentSet() (+14 more)

### Community 10 - "50_journal_logic.js"
Cohesion: 0.23
Nodes (18): JR_COLS, JR_HEAD, jrClean(), jrClosed(), jrCsvCell(), jrDate(), jrDay(), jrFromCsv() (+10 more)

### Community 11 - "52_jai.js"
Cohesion: 0.25
Nodes (17): JAI, JAI_PROV, JAI_T, jaiCard(), jaiCardRender(), jaiCfg(), jaiEndpoint(), jaiForget() (+9 more)

### Community 12 - "ref_fs"
Cohesion: 0.12
Nodes (9): assert, AXE, fs, path, assert, fs, assert, assert (+1 more)

### Community 13 - "harness.js"
Cohesion: 0.12
Nodes (11): {chromium}, CRY, fs, http, path, ROOT, STEPS, assert (+3 more)

### Community 14 - "logic.js"
Cohesion: 0.16
Nodes (13): assert, base, block(), ctx, fs, html, near(), vm (+5 more)

### Community 15 - "launch"
Cohesion: 0.15
Nodes (10): genK(), launch(), serve(), assert, PAGES, run(), pages, [W,H] (+2 more)

### Community 16 - "ref_assert"
Cohesion: 0.14
Nodes (8): assert, assert, assert, assert, viaPlus(), assert, assert, PAGES

### Community 17 - "97_sweep.js"
Cohesion: 0.20
Nodes (12): VT_TZ_IANA_SW, VT_TZ_LIST_SW, vtAttachClockAndCd(), vtChartErr(), vtChartRetry(), vtFmtCd(), vtFmtClock(), vtFmtTzBadge() (+4 more)

### Community 18 - "10_router.js"
Cohesion: 0.22
Nodes (10): chartOnPage(), go(), HIDDEN_PAGES, navHTML(), PAGE_HOOK, PAGE_IDS, pageOf(), PAGES (+2 more)

### Community 19 - "ref_path"
Cohesion: 0.21
Nodes (8): assert, path, R, BASE, fs, grab(), hashes(), NAMES

### Community 20 - "package.json"
Cohesion: 0.24
Nodes (9): dependencies, express@^4.21.2, ws@^8.23.0, description, name, private, version, express (+1 more)

### Community 21 - "92_account.js"
Cohesion: 0.44
Nodes (7): VT_TDK, vtCfgTdKey(), vtTdCanStore(), vtTdKey(), vtTdKeyName(), vtTdKeyNote(), vtTdKeySet()

### Community 22 - "calendar.js"
Cohesion: 0.20
Nodes (6): assert, AXE, FEED, fs, now, path

### Community 23 - "sound.js"
Cohesion: 0.20
Nodes (4): assert, AXE, fs, path

### Community 24 - "unit.js"
Cohesion: 0.22
Nodes (4): assert, catalog, vsLev(), vtSearchRank()

### Community 25 - "fetchDukascopyBi5Block"
Cohesion: 0.22
Nodes (9): aggregateCandles(), fetchBinanceCandles(), fetchBinanceWithFallback(), fetchDukascopyBi5Block(), fetchDukascopyCandles(), fetchTwelveDataCandles(), fetchWithTimeout(), lzmaDecompress() (+1 more)

### Community 26 - "90_legal.js"
Cohesion: 0.33
Nodes (7): LEGAL, legalDoc(), legalRender(), LG_META(), LG_ORDER, PH(), VT_MAIL()

### Community 27 - "jai.js"
Cohesion: 0.22
Nodes (4): assert, AXE, fs, path

### Community 28 - "98_layout.js"
Cohesion: 0.57
Nodes (7): vtVirt(), vtVirtBind(), vtVirtHead(), vtVirtOn(), vtVirtRange(), vtVirtShow(), VV

### Community 29 - "journal.js"
Cohesion: 0.25
Nodes (4): assert, AXE, fs, path

### Community 30 - "shortcuts.js"
Cohesion: 0.25
Nodes (4): assert, AXE, fs, path

### Community 31 - "templates.js"
Cohesion: 0.29
Nodes (4): assert, fs, os, path

### Community 32 - "generateSyntheticCandles"
Cohesion: 0.33
Nodes (7): buildScreenerBody(), fetchBinanceTickers(), generateSyntheticCandles(), hashSeed(), inferMeta(), makeRng(), resolveTdSymbol()

### Community 33 - "a11y.js"
Cohesion: 0.29
Nodes (5): assert, AXE, fs, PAGES, path

### Community 34 - "backtest.js"
Cohesion: 0.29
Nodes (4): assert, AXE, fs, path

### Community 35 - "minicharts.js"
Cohesion: 0.29
Nodes (4): assert, AXE, fs, path

### Community 36 - "scripts.js"
Cohesion: 0.29
Nodes (4): assert, AXE, fs, path

### Community 37 - "summary.js"
Cohesion: 0.29
Nodes (4): assert, AXE, fs, path

### Community 38 - "sweep.js"
Cohesion: 0.29
Nodes (4): assert, AXE, fs, path

### Community 39 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, lint, start, test:smoke

### Community 40 - "accounts.js"
Cohesion: 0.40
Nodes (3): assert, booted(), signIn()

### Community 41 - "mobile_qa.js"
Cohesion: 0.47
Nodes (5): assert, audit(), DLGS, PAGES, run()

### Community 45 - "ensureBinanceUpstream"
Cohesion: 0.67
Nodes (3): broadcastWs(), ensureBinanceUpstream(), WebSocket

## Knowledge Gaps
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `launch()` connect `launch` to `ref_fs`, `harness.js`, `ref_assert`, `ref_path`, `calendar.js`, `sound.js`, `jai.js`, `journal.js`, `shortcuts.js`, `templates.js`, `a11y.js`, `backtest.js`, `minicharts.js`, `scripts.js`, `summary.js`, `sweep.js`, `accounts.js`, `mobile_qa.js`, `motion.js`, `heatmap.js`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Should `worker.js` be split into smaller, more focused modules?**
  _Cohesion score 0.08245981830887492 - nodes in this community are weakly interconnected._
- **Why does `express` connect `package.json` to `server.js`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Should `94_edge_client.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1072463768115942 - nodes in this community are weakly interconnected._
- **Why does `ws` connect `package.json` to `server.js`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05714285714285714 - nodes in this community are weakly interconnected._
- **Should `95_symbol_search.js` be split into smaller, more focused modules?**
  _Cohesion score 0.13793103448275862 - nodes in this community are weakly interconnected._