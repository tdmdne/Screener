# Vektor Terminal: audit against the "Zero Frontend Logic" mandate

**For:** Tyler Mason and Bruce · **By:** Grok Bot (executor for Bruce) · **Date:** Wed 18 Nov 2026, ~22:00 GMT (Europe/London)
**Code audited:** `tdmdne/Screener` `main` @ `fb0d608` (includes PR #8 `ce4cae4`, PR #13 `c2bea20` and PR #14). Worktree `/workspace/repos/Screener-arch`, branch `arch/backend-mandate`.
**Line numbers** are for `index.html` @ `fb0d608` (7,231 lines; the app's one inline script runs from line 1162 to 7230). They drift: re-find by function name before editing.

**How this was produced (AI rules):**
- **Gemini** (`gemini-3-flash-preview`, Tyler's Google key) read all of `index.html` lines 1162–7150 and produced the first violation list. One 429 quota retry, then it succeeded. It went through a file-based wrapper of `ask-gemini` because the 625 KB prompt is larger than the shell's argument limit.
- **Grok** (me) checked every Gemini line number with `rg`/`awk` and corrected them, added items Gemini missed (CoinGecko, Finnhub/Polygon fallbacks, the `07480d9` Binance fallback, storage, CDN scripts), and did the platform and vendor research.
- **Claude** wasn't available. `ask-claude` returned "You've hit your 5-hour limit · resets 12:40am (Europe/London)" at ~21:55 GMT, so I wrote the architecture and task list myself and Gemini reviewed them (see the end of this report).

---

## 1. Summary (10 lines)

1. The browser calls **8 third-party data hosts directly**: Binance REST and two Binance WebSockets, CoinGecko, Finnhub (REST and WS), Polygon, Forex Factory (fallback), OpenAI/Anthropic (Journal AI), and the `vektor-market` Worker by its workers.dev URL.
2. The `07480d9` fix (`vtBnDirectCandles`, `index.html:6424-6438`, called from `edgeFetchCandles` `6439-6530`) moved crypto candles **back into the browser**. It breaks the mandate and probably Binance's commercial terms too (§3.1).
3. **Candles are built in the browser** in 5 places: Binance trade/kline WS handlers, Finnhub trade ticks, `updateLiveBar`, `vtApplyTwelveDataTick` and `vtMergeBars`/`vtLoadMoreHistory`. There's also a synthetic `SAMPLE`/`candles()` generator.
4. **Indicator maths** (EMA/SMA/ATR/RSI, Bollinger) runs in the browser (`1580-1587`, applied at `1637-1712`), as does the whole **Vektor Script** lexer, parser and evaluator (`4196-4368`, plus the `src/47_vs_engine.js` mirror).
5. **The screener and P1–P5** (`calc`, `scoreSymbol`, `scoreMarket`, `passesPreset`, `sxTier`, `1308-1439`, `3609-3617`) and **heatmap metrics** (`3882-3917`) are computed in the browser from raw candles.
6. **Client data caches:** an IndexedDB market cache (`idb`/`loadCache`/`flush`, `2784-2808`), in-memory `LIVE`/`VT_CANDLE_EDGE_CACHE`, and `data/manifest.json` snapshots. localStorage `scr2~*` holds watchlists, journal, alerts, drawings and scripts, which is more than UI prefs.
7. **Alerts, the position tool, backtest fills, journal and prop stats** are all evaluated in the browser (`1889-1900`, `3332-3353`, `3766-3798`, `5018-5167`). The mandate's scope for these needs Tyler's call (decision D5).
8. **The backend is already half there, but split three ways:** `vektor-market` (live, KV + `TdBudget` DO, source not in the repo), `worker.js` + `MarketRelayDO` (behind the Pages Function, synthesises bars), and `worker/` `MarketHub` (a clean fan-out hub that was never deployed).
9. **Workers Free can run it before launch, with limits:** SQLite DOs are on Free; one always-on hub DO uses ~10,800 of the 13,000 GB-s/day allowance; CPU is **10 ms per invocation**; KV allows only **1,000 writes/day**. Server-side Vektor Script and the full-universe screener realistically need **Workers Paid ($5/mo)**.
10. **Data licences are the real blocker.** The Twelve Data free key is "internal non-display" with **1 WS connection / 8 trial symbols**. Every exchange feed checked (Binance, Coinbase, Kraken, OKX, Bybit) needs written consent for commercial display. **Twelve Data Venture ($149/mo) covers crypto, FX and stocks with external-display rights from one feed.**

---

## 2. Violations by category

Severity: **H** breaks a bullet of the mandate outright · **M** data processing that must move · **L** hygiene.

### 2a. Direct external calls from the browser
| Where (`index.html`) | What | Sev |
|---|---|---|
| `2521-2523` `BNH`, `STABLE` | Binance REST hosts `data-api.binance.vision`, `api.binance.com` (also `shared/instruments.js:12-13`) | H |
| `2613-2640` `bnwsConnect` | `wss://data-stream.binance.vision/ws/!ticker@arr`, the all-market ticker stream | H |
| `2641-2673` `bnKlineStart` | Binance kline WS for the open chart | H |
| `2721-2726` `bnGet`, `loadBN` | Binance REST `/api/v3/ticker/24hr` (screener crypto universe) and klines | H |
| `6424-6438` `vtBnDirectCandles` + `6439-6530` `edgeFetchCandles` | **Commit `07480d9`**: falls back to Binance klines in the browser and skips the server for crypto for 10 min after one failure | H |
| `2569-2593` `fetchCG`, `tryFallbacks` | `api.coingecko.com/api/v3/coins/{id}/ohlc` crypto fallback | H |
| `2536-2568` `fetchFH`, `fetchPoly`; `2727-2756` `proxied`, `loadFHU`, `loadPGU` | Finnhub and Polygon REST with the **user's own key** (Settings › Data). `proxied()` is a plain `fetch`, not a proxy | H |
| `2674-2697` `fhWsStart` | `wss://ws.finnhub.io?token=<user key>` | H |
| `2769` `VT_TD_PROXY`, `2770-2783` `pumpTD`, `6985-7024` `vtTdWsConnect` | Twelve Data via `https://vektor-market.tdmltd2026.workers.dev` (cross-origin, polled every 60 s); `pumpTD` requests `outputsize=5000` | H (our Worker, but not same-origin, and the browser drives the polling and merging) |
| `4816` `CAL_URL`, `4838-4848` `calFetchJSON` | Direct `nfs.faireconomy.media` fallback when `/api/calendar` fails (also `src/53_calendar.js:4,29`) | H |
| `4733-4737` `jaiRequest` (+ `src/52_jai.js:8-9,48`) | Journal AI review: OpenAI/Anthropic/compatible endpoint called from the browser with the user's own key | H (decision D6) |
| `2810-2814` `snapInit` | `data/manifest.json` / `data/c_*.json` static snapshot loader | M |
| `1158-1159` | `cdn.jsdelivr.net` html2canvas + lightweight-charts | L (static code, not data; self-host for a strict allowlist) |
| `src/94_edge_client.js:383,415-487,910,993-1022` | Mirror of the edge client, including the Binance fallback (not loaded by the page today) | M (delete or keep in sync) |

Already same-origin, so they're fine as transport: `/api/screener` (`6375`), `/api/candles` (`edgeFetchCandles`), `/api/calendar` (`4857`), `/api/news` (`4916`). The browser still processes what they return (below).

### 2b. Candle building, merging, dedup, synthetic data
| Where | What | Sev |
|---|---|---|
| `1185` `SAMPLE`, `1290-1294` `candles` | Hard-coded universe and synthetic candles when not live | H |
| `1606-1625` `updateLiveBar` | Rolls ticks into the forming bar, gap logic | H |
| `2613-2673` | Binance ticker/kline messages turned into bars (`LIVE[...]`) | H |
| `2674-2697` (`2686-2689`) | Finnhub trades bucketed into 1-minute OHLCV | H |
| `2770-2783` `pumpTD` | Parses TD `time_series` into bars, queue, retries | H |
| `6407-6423` `vtMergeBars`, `6531-6592` `vtLoadMoreHistory` | Merges, dedups, prepends history, gap backfill | H |
| `6902-6984` `vtApplyTwelveDataTick` | Builds OHLC bars from 60 s price polls | H |
| `1626-1636` `vtBuildChartData` | Maps raw arrays into chart series | L (pure render mapping is allowed once the server sends render-ready bars) |

### 2c. Indicator maths
| Where | What | Sev |
|---|---|---|
| `1295-1317` `cc`, `ma`, `calc` | Candle change, moving averages, % change, ADR | H |
| `1580-1587` `emaArr`, `smaArr`, `atrArr`, `rsiArr` | Indicator arrays | H |
| `1637-1712` `vtApplyHistoryPrepend` (`1662-1673`) | Calls those arrays per chart indicator, Bollinger offsets | H |

### 2d. Vektor Script execution
| Where | What | Sev |
|---|---|---|
| `4196-4244` `vsLex`, `vsParse` | Tokenizer and parser | H (keep a parser for **editor diagnostics only** if Tyler agrees, see D7) |
| `4250-4288` `vsSMA`, `vsEMA`, `VS_FN` (29 built-ins) | Built-in maths | H |
| `4289-4345` `vsRun`, `4367-4368` `vsCompute` | Evaluator and result cache | H |
| `src/47_vs_engine.js`, `src/48_vs_ui.js` | Mirror of the engine | M |

### 2e. Screener filtering and P1–P5
| Where | What | Sev |
|---|---|---|
| `1327-1349` `scoreSymbol` | Cycle score, phase, expansion | H |
| `1350-1361` `rows` | Filter and sort | H |
| `1376-1406` `scoreMarket` | Vektor score (multi-EMA alignment) | H |
| `1407-1439` `passesPreset` | P1–P5 preset logic | H |
| `3609-3617` `sxTier`, `sxPct`, `sxAdr` + column renderers (`Expansion`, `Tier`) | Tiering and column maths per row | H |
| `6372-6406` `edgeScreenerInit` | Takes the server universe, then rescores it in the browser | M |

### 2f. Heatmap maths
| Where | What | Sev |
|---|---|---|
| `3882-3891` `hmTradedValue`, `hmChg`, `hmVal` | Traded value, % change vs previous close, score and momentum per tile | H |
| `3899-3917` `hmSquarify`, `hmLayout` | Treemap geometry from weights | L (layout is rendering geometry; recommend it stays client-side, D7) |

### 2g. Client data caching
| Where | What | Sev |
|---|---|---|
| `2784-2808` `idb`, `loadCache`, `flush` | IndexedDB `scr`/`c`: candles, Binance list, screener snapshot | H |
| `5998+` `VT_CANDLE_EDGE_CACHE`, `VT_EDGE`; global `LIVE`, `LT` | In-memory candle caches with TTLs | M (in-memory view state is fine; TTL caching and merging is logic) |
| `1175-1209` `lsGet`/`ssGet`, `vtSK` scoping; `LG_STORE` `5516` | localStorage `scr2~*`, `scr2p~*`: watchlists, alerts, alert log, drawings, scripts, journal, layouts; plus `vt_tdkey~*`, `vt_aikey~*` user keys | H (mandate: localStorage for layout/theme only; needs server accounts first, D4) |

### 2h. Other logic in the browser
| Where | What | Sev |
|---|---|---|
| `1889-1900` `checkAlerts` (from `fin` `2532`) | Price alerts evaluated per tick in the tab | H |
| `3332-3353` `posCalc`, `posState` | Position tool P&L, fill simulation on bars | M (D5) |
| `3766-3798` `simChallenge`, `tradeStats`, `propStatus`; `src/50_journal_logic.js` | Journal and prop stats, Monte Carlo | M (D5) |
| `5018-5167` `btOpenPnl`, `btSeek` (+ `src/54_backtest.js`) | Replay fill simulation and stats | M (D5) |
| `2854-2857` `dataM` | Settings › Data: BYO Twelve Data/Finnhub/Polygon keys | H (remove with 2a) |

### 2i. Server side (not a browser violation, but it blocks the mandate)
- `worker.js:43-80` `generateSyntheticCandles` and `:123-169` `buildScreenerSnapshot` give **simulated non-crypto prices** (the live check confirmed `source:"edge+sim"`). A server pipeline must never present sample data as live.
- `worker.js:1212-1528` `MarketRelayDO` synthesises bars (Dex H4). `worker/hub.js`, `worker/hubCore.js` `MarketHub` is the better base (refcounted subscriptions, coalesced fan-out, Node-testable), but it uses the **non-hibernating** `server.accept()` + `setInterval` (`hub.js:25-30`).
- `vektor-market` (deployed, source only at `/workspace/task02/vm/worker.prod.js`, 230 lines): allowlisted TD REST proxy, KV `vektor-market-cache` (`999790ad…`), global `TdBudget` DO (8/min, 800/day). **It writes KV on every upstream miss**, which collides with KV Free's 1,000 writes/day (§3.3).
- D1 `tdm-screener` exists (0 tables per the CF API today; Dex's report saw `users`/`sessions`). Accounts (legacy TASK-04, Dex) will own it.
- `server.js:954` undefined `fetchJSON`; `express.static` on the repo root (Dex C-findings).

---

## 3. Hard constraints and risks (with sources)

### 3.1 Crypto data at the edge
- **Binance blocks Cloudflare egress.** Tonight's tests from a Worker got `api.binance.com` → **451** and `data-api.binance.vision` → **403** (Bruce's test; commit `07480d9` message: "checked: api.binance.com 451, data-api.binance.vision 403 from the CMH colo"). A server-only design **cannot use Binance**.
- **Binance terms (Priya's flag) are confirmed as risky.** The Product Terms of Use §III.1.b (archived Oct 2020 – Feb 2023) prohibit, without written consent, "Data feeding or streaming services that make use of any market data of Binance" and "websites/apps/services that charge for or otherwise profit from … market data obtained from Binance". The live page couldn't be machine-read. The Binance Vision Dataset Terms v1.0 (26 Aug 2026) §3.4 and §4.3–4.4 exclude commercial use and "commercial financial products … paid subscription". Sources: github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md; cryptomarkets.tools/guides/exchange-api-terms. **The browser fallback in `07480d9` is in scope of this too.**
- **Coinbase Exchange:** the public WS needs no auth, but the Market Data Terms limit use to "personal or research purposes and may not be used to build an application intended for use by end users", and forbid display to third parties without written consent (coinbase.com/legal/market_data). **Not usable for a paid public app without a deal.**
- **Kraken:** public WS v2 at `wss://ws.kraken.com/v2` needs no auth. Commercial redistribution goes through **marketdata@kraken.com** for licensing (docs.kraken.com/home/support). Not usable until licensed; no published price.
- **OKX / Bybit:** API agreements confine market data to personal/internal use, and OKX says this applies to public endpoints too (cryptomarkets.tools summary of OKX API Agreement §9.4, 28 Jul 2026; Bybit API T&C).
- **CoinGecko:** paid self-serve plans are Basic $35/mo, Analyst $129/mo, Lite $499/mo, Pro $999/mo (monthly). A "Commercial redistribution license" is listed **only on Enterprise (custom pricing)** (coingecko.com/en/api/pricing). Its data is also aggregated and not tick-level.
- **Twelve Data covers crypto:** Basic includes "Real-time crypto market data" for internal non-display use. **Venture** includes "External display data access" and WS credits (twelvedata.com/pricing-business; support.twelvedata.com/en/articles/5335783-trial). The `vektor-market` Worker already reaches `api.twelvedata.com` from Cloudflare.
- **Not tested:** whether Coinbase/Kraken WS endpoints are reachable from Workers egress. I didn't deploy a probe Worker because that would change Tyler's Cloudflare account without approval. It's moot unless a licence is bought.

### 3.2 Twelve Data
| | Basic (free, current key) | Venture (business) |
|---|---|---|
| API credits | **8/min, 800/day** | 610/min, no daily cap |
| WebSocket | **trial: 1 connection, up to 8 symbols from the trial list** | 500 WS credits (1 per subscribed symbol on `/quotes/price`), up to 3 connections |
| Licence | **Internal non-display usage** | **External display data access** |
| Price | $0 | **$149/mo monthly, $124/mo billed annually** (also 1,597/1,500 at $299, 2,584/2,500 at $499) |
Sources: twelvedata.com/pricing-business, twelvedata.com/docs/websocket/websocket-getting-started (heartbeat "every 10 seconds or so"; ≤3 connections, opening more closes older ones; max 100 client events; 1 MB message cap), support article "Trial". The personal "Pro 610" at $99/mo is **internal display only**, so it isn't valid for a public app.
- **The WS `price` event carries `price`, `timestamp`, `day_volume` (equities) and bid/ask where available.** Bars built from the stream have no per-bar volume for FX/crypto, so volume has to come from REST `time_series` backfill/reconciliation.
- **What can run before launch on the free key:**
  1. The DO hub holding **the one trial WS connection**, streaming **≤8 trial symbols**. The exact trial list is on TD's Exchanges page; check it before Task 2, I didn't invent one.
  2. REST backfill inside `TdBudget`: `time_series` costs **1 credit per symbol** regardless of `outputsize` (pricing page example), so 800/day covers e.g. a one-off backfill of 40 symbols × 4 timeframes (160 credits) plus incremental top-ups.
  3. A **small dev universe** screener (tens of symbols at 1D/1H), **not** the full universe live.
  4. **Licence caveat:** Basic is "internal non-display". Showing TD data on the public `screener-cso.pages.dev` before Venture is technically outside the licence (D3).

### 3.3 Cloudflare plan limits (Free vs Paid $5/mo)
| Item | Workers Free | Workers Paid | Source |
|---|---|---|---|
| Worker requests | 100,000/day | 10M/mo incl. | developers.cloudflare.com/workers/platform/limits, /pricing |
| **CPU per invocation** | **10 ms** | 30 s default, up to 5 min | same |
| Durable Objects | **SQLite-backed only** | SQLite (+KV-backed for existing) | developers.cloudflare.com/durable-objects/platform/pricing |
| DO requests | 100,000/day (WS connect = 1 request; incoming WS messages billed 20:1; outgoing free) | 1M/mo + $0.15/M | same |
| **DO duration** | **13,000 GB-s/day** | 400,000 GB-s/mo + $12.50/M GB-s | same |
| DO SQLite rows | 5M read / **100k written per day**, 5 GB total | 25B read / 50M written per mo incl. | same |
| DO per-object soft limit | ~1,000 req/s per object; 32 MiB max received WS message | same | developers.cloudflare.com/durable-objects/platform/limits |
| **KV** | 100k reads/day, **1,000 writes/day**, 1 write/s per key, 1 GB | unlimited (billed) | developers.cloudflare.com/kv/platform/limits |
| D1 | 5M rows read / 100k written per day, 5 GB, 10 DBs | 25B / 50M per mo incl. | developers.cloudflare.com/d1/platform/pricing |
| **R2** | 10 GB-mo, 1M Class A, 10M Class B per month | same free tier | developers.cloudflare.com/r2/pricing |
| Cron triggers | 5 per account | 1,000 | Workers limits |

**What this means:**
- **One always-on hub DO fits Free, barely.** An outbound WS can't hibernate. 86,400 s × 0.125 GB = **10,800 GB-s/day** of the 13,000, leaving ~2,200 GB-s/day for every other DO. On Paid the same object is ~324,000 GB-s/mo, inside the 400,000 included.
- **The 10 ms CPU cap is the real Free-plan wall.** Computing indicators and screener scores for many symbols on each bar close, or running user Vektor Script, will exceed 10 ms per invocation. → **Workers Paid needed before server-side VS (Task 6) and the full-universe screener (Task 7) go live.** Ingestion, candles and fan-out can be built and tested on Free.
- **KV writes:** `vektor-market` already writes on every TD miss (≤800/day on Basic). Adding screener snapshots every few minutes would hit 1,000/day. → Keep hot bars and snapshots in **DO SQLite** (100k rows/day). Use KV only for a low-rate "bootstrap" snapshot (≤1/min ≈ 1,440/day is **too many on Free**, so use ≤1 per 2–5 min, or Paid).
- **R2 isn't enabled.** The CF API returned 403 code 10042 for `/r2/buckets` today, and enabling it needs a payment method on file even for the free tier (developers.cloudflare.com/r2/get-started; billing docs). → **Defer R2.** Cold history can live in DO SQLite and KV until after launch.
- I couldn't confirm the account's plan: `GET /subscriptions` returned 403 for this token. Earlier work assumed Free.

### 3.4 Outbound WS from a DO, keep-alive, reconnection, fan-out
- **Hibernation only applies to a DO acting as a WebSocket server. "Outgoing WebSockets do not hibernate."** An open outbound WS prevents eviction for **up to 15 minutes**, after which the connection can stay open but no longer stops eviction (developers.cloudflare.com/durable-objects/best-practices/websockets; changelog 2026-06-19 "Outbound connections keep Durable Objects alive"). Idle non-hibernatable objects are evicted after 70–140 s with no events (lifecycle docs).
- **Keep-alive design:**
  - `setAlarm(now + 30 s)` re-armed in `alarm()`, the same 30 s heartbeat pattern Cloudflare's Agents `keepAlive()` uses.
  - Each alarm sends a TD `{"action":"heartbeat"}` (TD asks for ~10 s, so also send it from the message loop), checks `lastMessageAt`, and **reconnects with backoff** if silent for more than 30 s or closed.
  - Persist the desired subscription set in DO SQLite so a restart (code deploys and runtime restarts happen "1–2× per day", Agents docs) resubscribes.
  - Alarms are at-least-once with retries, and each `setAlarm` costs 1 row written: 2,880/day at 30 s, inside 100k.
- **Fan-out:** browser sockets attach to the **same hub DO** through the **Hibernation API** (`ctx.acceptWebSocket`, `serializeAttachment` for per-client subscriptions; `setWebSocketAutoResponse` for ping/pong so it costs no wall time). Coalesce to the latest update per symbol per flush window, as `hubCore.js` already does. Outgoing messages aren't billed; each client connect is 1 DO request.
  - On Free: ~100k DO requests/day, so connects plus client→server messages (billed 20:1) must stay well below that.
  - Above ~1,000 msgs/s or a few thousand sockets, shard: hub DO → N "room" DOs per symbol group.
- **Payload size budget** (design targets, my estimates, not vendor limits):
  - One bar as `[t,o,h,l,c,v]` JSON is ~50–70 bytes, so **1,500 bars ≈ 75–105 KB raw**.
  - Targets: **initial bootstrap ≤ 150 KB gzipped**; **live frames ≤ 2 KB** (deltas only: the changed bar plus changed indicator points); screener page ≤ 50 rows per frame; history beyond 1,500 bars is paged over HTTP, not WS.
  - Hard platform cap: 32 MiB received WS message per DO.

### 3.5 Existing resources (verified today through the Cloudflare API, read-only)
- Workers: `vektor-market` (modified 18 Nov 21:38 GMT) and `autumn-meadow-6254` (12:51 GMT). `vektor-terminal`/`vektor-proxy` aren't deployed.
- KV: `vektor-market-cache` `999790ad01b6464483f28060542fff68` (an ID, not a secret).
- D1: `tdm-screener` `cdc126d2-…` (created 15 Nov).
- R2: not enabled (403 / 10042).
- `TdBudget` DO lives in `vektor-market`; its source is only on the box (`/workspace/task02/vm/worker.prod.js`). **Task 1 brings it into the repo.**
- Dex's report `/workspace/reports/dex-architecture-security-v1.md` recommends one front-door Worker plus a separate data Worker over a service binding, and keeping **one** DO hub as the only TD WS holder. This plan follows that.

---

## 4. Decisions Tyler needs to make (recommendations)
| # | Decision | Recommendation |
|---|---|---|
| D1 | **Crypto data source** | **Twelve Data for crypto as well** (one licensed feed, already reachable from Workers). Remove Binance (browser and server) and CoinGecko. Don't pursue Coinbase/Kraken/Binance/CoinGecko-Enterprise licences now. |
| D2 | **Workers Paid ($5/mo)** | Approve **before Task 6** (server Vektor Script) / **Task 7** (screener at scale); earliest need ~Task 5. Tasks 1–5 run on Free. Set a spending limit when upgrading. |
| D3 | **Twelve Data Venture ($149/mo, or $124/mo annual)** timing | Approve to start **no later than Mon 15 Feb 2027** for two weeks of load testing before 1 March, or earlier if any public pre-launch display of prices is wanted. Until then, keep public data to the free trial symbols and accept the non-display caveat, or put Cloudflare Access on the site before launch. |
| D4 | **Guest data and localStorage** | Signed-in users: watchlists, alerts, drawings, scripts and journal move to D1 (needs accounts, legacy TASK-04). **Guests:** recommend keeping their own work in memory only (as today: "Guests' … work is kept in memory only"), so nothing but UI prefs is stored. One-time import of existing `scr2~*` on first sign-in, then delete the local copy. |
| D5 | **Scope of "zero logic" for user tools** (backtest/replay fills, position tool, journal/prop stats, calculators) | Phase 2: move them server-side after the market-data path (Tasks 17–18). They don't touch market feeds, so they don't block launch. |
| D6 | **Journal AI review (user's own OpenAI/Anthropic key, called from the browser)** | Turn it off for launch and replace it later with a server-side route (key never stored, never logged). Needs Iris to update the privacy page. |
| D7 | **What stays client-side as "rendering"** | Allow: chart drawing (lightweight-charts), treemap **layout geometry** (`hmSquarify`), a VS **syntax checker for editor squiggles** (no execution), input validation, and in-memory view state. Everything else is server-side. |
| D8 | **BYO data keys (Settings › Data: Twelve Data/Finnhub/Polygon)** | Remove. Users never supply data keys. Chris's KB must be updated when this ships. |

---

## 5. Gemini review of the plan
Ran `gemini-3-flash-preview` over `docs/architecture/TASKS.md` for ordering and dependency gaps. Its points and what I did with them are in the PR description.
