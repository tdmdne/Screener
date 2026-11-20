# Target architecture: 100% backend pipeline, render-only browser

Tyler's mandate (18 Nov 2026) is non-negotiable; the summary is in `AGENTS.md` §0. This file has the detail. Evidence and sources are in `AUDIT.md`. The build order is in `TASKS.md`.

## 1. The shape
```
browser (render only)
  ├─ GET /api/bootstrap ──► one precomputed "state" payload (chart + indicators + watchlist + screener page + heatmap)
  └─ WS  /ws ─────────────► versioned frames (bar, ind, vs, quotes, screener, heatmap, status, alert)
        │  same origin (Pages Function now; the vektor-terminal front-door Worker later, per Dex's report)
        ▼  service binding
vektor-market data Worker (workers/market/)
  ├─ MarketHub DO (SQLite)  ← the ONLY holder of the upstream WebSocket (Twelve Data)
  │    ingest ticks → candle builder → indicators → Vektor Script → screener/P1–P5 → heatmap values
  │    hot bars + snapshots in DO SQLite; alarm heartbeat every 30 s; Hibernation API for browser sockets
  ├─ TdBudget DO            ← global Twelve Data credit budget (REST backfill only)
  ├─ KV vektor-market-cache ← closed history chunks + bootstrap snapshot (low write rate; Free = 1,000 writes/day)
  └─ D1 tdm-screener        ← accounts and user data (Dex, ACC): watchlists, alerts, scripts, journal, layouts
R2: deferred (not enabled, and it needs a payment method).
```

## 2. What the browser may do
- **May:**
  - Draw what the server sends (lightweight-charts, DOM, treemap layout geometry).
  - Capture input and send it (orders in replay, view changes, script source).
  - Batch frames per animation frame.
  - Keep in-memory view state.
  - Store **UI prefs only** in localStorage: layout, theme, last page, consent.
- **May not:**
  - Call any host except our own origin, for data or anything else. Static vendor code is self-hosted.
  - Build, merge or dedup candles.
  - Compute indicators, Vektor Script, screener metrics, P1–P5, heatmap values or alerts.
  - Generate synthetic or sample data.
  - Cache market data (IndexedDB, localStorage, TTL maps).
- **Pending Tyler (see AUDIT §4):**
  - D5: backtest fills, position tool, journal stats (Phase C).
  - D6: Journal AI.
  - D7: the VS syntax checker in the editor.

## 3. `client/services/dataService.js` plan (render-only)
- **Keep:** the single shared connection (WS with SSE fallback), reconnect with backoff and jitter, the subscription/view replay after reconnect, and `tickBuffer`'s rAF batching (rendering only).
- **Remove** (no client-side data processing):
  - `createTickGuard` / tick validation.
  - `cleanBars` and the `lastCandles` stale fallback.
  - `getCandles`/`getQuote` REST helpers. History paging becomes a server-merged `GET /api/bars?before=`.
  - `normSymbol` beyond a trivial uppercase. The server is authoritative for symbols.
- **New API:**
  - `bootstrap(view)`
  - `setView(view)` (chart sym/tf/indicators/scripts, watchlist, screener preset and page, heatmap)
  - `on(type, cb)` for protocol-v2 frames
  - `status` with server-provided provenance (`LIVE | DELAYED | CACHED | UNAVAILABLE` + `asOf`)
- **Protocol:** `shared/protocol.js` + `PROTOCOL.md` (Task 8). Every frame carries `v` and `seq`. Live frames are deltas ≤2 KB; the bootstrap is ≤150 KB gzipped.

## 4. Data routing (replaces old AGENTS.md §5)
- **One upstream for all markets: Twelve Data**, server-side only, through the hub WS plus `TdBudget` REST backfill.
  - Crypto is included, pending Tyler's decision D1.
  - **Binance is not used.** It blocks Cloudflare egress (451/403) and its terms restrict commercial use.
  - **CoinGecko, Finnhub, Polygon and browser BYO keys are removed.**
- **Free key (before Venture):**
  - 1 WS connection with ≤8 trial symbols.
  - 8 credits/min and 800/day for REST backfill (1 credit per symbol per `time_series`).
  - Dev universe only.
  - The licence is internal non-display.
- **Venture (💷 D3):** 610 credits/min, 500 WS credits, external display.
- **Twelve Data guardrails (kept from old §5):**
  - ≤8 symbols per batch.
  - Respect `TdBudget`.
  - On 429, trip the breaker and serve cached data with a visible `CACHED` provenance. **Never** synthesise data.
- **Calendar and news:** server-side only (`/api/calendar`, `/api/news`). No browser fallback to feed hosts.

## 5. Plan limits that shape the design (details in AUDIT §3.3)
- **Workers Free:**
  - 10 ms CPU per invocation.
  - DO 13,000 GB-s/day; one always-on hub uses ~10,800.
  - KV 1,000 writes/day.
  - DO SQLite 100k rows written/day.
- **Workers Paid ($5/mo, 💷 D2):** needed before server Vektor Script and the full-universe screener go live.
