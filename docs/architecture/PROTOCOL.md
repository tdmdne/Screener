# Vektor Terminal — WebSocket Protocol v2

> Single source of truth: [`shared/protocol.js`](../../shared/protocol.js).
> Governs all browser ↔ Worker hub communication over `/ws` (and the initial bootstrap payload returned by `GET /api/bootstrap`).

## 1. Design Principles

1. **Zero Frontend Logic (§0):** The browser sends only declarative view intent (`view`) and renders server-computed bars, indicators, Vektor Script outputs, quotes, screener pages, heatmap tiles, and alerts.
2. **Versioned & Monotonic:** Every server → client frame carries `{ "v": 2, "seq": <int>, "type": "<type>" }`. `seq` strictly increases per connection so the client detects gaps and triggers a clean resync.
3. **Strict Provenance, Zero Simulation:** Every status, screener row, and heatmap tile declares real provenance (`LIVE | DELAYED | CACHED | UNAVAILABLE`) and `asOf` (epoch ms). Synthetic/simulated sources (including legacy `"edge+sim"`) are rejected by protocol validation and omitted server-side.
4. **Cloudflare DO Hibernation-Ready:** Browser sockets attach via `ctx.acceptWebSocket`, store serialized view intent with `ws.serializeAttachment`, and answer heartbeats via `ctx.setWebSocketAutoResponse` without waking the Durable Object.

---

## 2. Transport & Lifecycle

- **Endpoint:** Same-origin `wss://<host>/ws`, forwarded by the Pages Function via service binding to the `vektor-market` hub Durable Object.
- **Handshake:**
  1. Client connects and sends `hello { v: 2, session? }`.
  2. Server replies with `hello { v: 2, seq, serverTime, session?, capabilities? }`.
  3. Client sends `view { chart?, watchlist?, screener?, heatmap? }`.
  4. Server replies with a single `state` frame (or client bootstraps via `GET /api/bootstrap` and immediately subscribes to deltas via `view`).
  5. Server streams coalesced delta frames (`bar`, `ind`, `quotes`, `vs`, `screener`, `heatmap`, `status`, `alert`).
- **Keep-Alive:** Client sends `{"op":"ping"}`; DO Hibernation auto-response replies `{"v":2,"seq":0,"type":"pong"}` with zero DO wall time. Clients do not advance `lastSeq` on `pong`.
- **Resync on Gap:** If a client observes `frame.seq !== lastSeq + 1` (excluding `pong`), it re-sends its current `view` (or fetches `/api/bootstrap`) to recover clean state.

---

## 3. Payload Budgets

| Budget Constant | Limit | Scope |
|---|---|---|
| `MAX_LIVE_FRAME_BYTES` | **2,048 B** (2 KB UTF-8) | `bar`, `ind`, `quotes`, `status`, `alert`, `error`, `pong` |
| `MAX_STATE_GZIP_BYTES` | **153,600 B** (150 KB gzip) | `state` full bootstrap payload |
| `MAX_SCREENER_PAGE_ROWS` | **50 rows** | `screener.rows` and `state.screener.rows` |
| `MAX_CHART_BARS` | **1,500 bars** | `state.chart.bars` (older history paged over HTTP) |
| `MAX_HEATMAP_TILES` | **100 tiles** | `heatmap.tiles` and `state.heatmap.tiles` |
| `MAX_WATCHLIST_SYMBOLS` | **100 symbols** | `view.watchlist` and `state.watchlist` |
| `MAX_CLIENT_FRAME_BYTES` | **8,192 B** (8 KB UTF-8) | Any client → server message |

When coalesced watch-list updates exceed `MAX_LIVE_FRAME_BYTES`, the hub packs them into multiple sequential `quotes` frames via `packQuoteFrames()`.

---

## 4. Client → Server Operations

### `hello`
Negotiates protocol version and optional session token.
```json
{ "op": "hello", "v": 2, "session": "sess_optional" }
```

### `view`
Declares the client's active viewport. At least one section must be present; sections omitted are left unchanged (or cleared when explicitly `null`).
```json
{
  "op": "view",
  "chart": {
    "sym": "BTCUSDT",
    "tf": "1H",
    "ind": [{ "id": "ema20", "type": "ema", "len": 20 }],
    "vs": ["script_01"]
  },
  "watchlist": ["BTCUSDT", "EURUSD", "AAPL"],
  "screener": {
    "preset": "P1",
    "page": 1,
    "evcTf": "H",
    "dir": "long",
    "market": "ALL",
    "pageSize": 50
  },
  "heatmap": {
    "metric": "chg",
    "tf": "1D",
    "n": 60,
    "size": "value",
    "market": "ALL"
  }
}
```

### `ping`
```json
{ "op": "ping", "t": 1732000000000 }
```

---

## 5. Server → Client Frames

All frames include `"v": 2`, `"seq": <non-negative integer>`, and `"type"`.

### `hello`
```json
{ "v": 2, "seq": 1, "type": "hello", "serverTime": 1732000000000, "capabilities": ["bars", "ind", "vs", "screener", "heatmap", "alerts"] }
```

### `state` (Full Bootstrap, ≤ 150 KB gzipped)
```json
{
  "v": 2,
  "seq": 2,
  "type": "state",
  "status": { "provenance": "LIVE", "asOf": 1732000000000 },
  "chart": {
    "sym": "BTCUSDT",
    "tf": "1H",
    "bars": [[1731996400, 91200, 91500, 91000, 91450, 128.4]],
    "ind": {},
    "vs": []
  },
  "watchlist": [{ "s": "BTCUSDT", "c": 91450, "t": 1732000000000, "v": 128.4, "provenance": "LIVE" }],
  "screener": { "page": 1, "totalPages": 1, "total": 12, "preset": "P1", "asOf": 1732000000000, "rows": [] },
  "heatmap": { "metric": "chg", "tf": "1D", "range": 3.5, "asOf": 1732000000000, "tiles": [] }
}
```

### `bar` (Delta, ≤ 2 KB)
```json
{ "v": 2, "seq": 3, "type": "bar", "sym": "BTCUSDT", "tf": "1H", "bar": [1732000000, 91450, 91520, 91410, 91500, 42.1], "closed": false, "provenance": "LIVE", "asOf": 1732000005000 }
```

### `ind` (Indicator Delta, ≤ 2 KB)
```json
{ "v": 2, "seq": 4, "type": "ind", "sym": "BTCUSDT", "tf": "1H", "id": "ema20", "point": { "t": 1732000000, "v": 91280.42 } }
```

### `vs` (Vektor Script Series or Error)
Success:
```json
{ "v": 2, "seq": 5, "type": "vs", "sym": "BTCUSDT", "tf": "1H", "id": "script_01", "plots": [{ "name": "Fast", "points": [[1732000000, 91300]] }], "markers": [] }
```
Error:
```json
{ "v": 2, "seq": 5, "type": "vs", "sym": "BTCUSDT", "tf": "1H", "id": "script_01", "error": { "message": "Division by zero", "line": 4, "col": 12, "hint": "Guard denominator with max(x, 1e-9)" } }
```

### `quotes` (Coalesced Watchlist Delta, ≤ 2 KB)
```json
{ "v": 2, "seq": 6, "type": "quotes", "quotes": [{ "s": "BTCUSDT", "c": 91510, "t": 1732000006000, "bid": 91509, "ask": 91511, "provenance": "LIVE" }] }
```

### `screener` (Paginated Snapshot, ≤ 50 Rows)
Every row carries real `{ source, asOf }`.
```json
{
  "v": 2,
  "seq": 7,
  "type": "screener",
  "page": 1,
  "totalPages": 2,
  "total": 75,
  "preset": "P1",
  "asOf": 1732000006000,
  "rows": [
    { "symbol": "BTCUSDT", "market": "CRY", "price": 91510, "score": 92, "tier": "P1", "source": "twelvedata", "asOf": 1732000006000 }
  ]
}
```

### `heatmap` (Tiles with Values & Weights, ≤ 100 Tiles)
Every tile carries real `{ value, weight, source, asOf }`.
```json
{
  "v": 2,
  "seq": 8,
  "type": "heatmap",
  "metric": "chg",
  "tf": "1D",
  "range": 4.2,
  "asOf": 1732000006000,
  "tiles": [
    { "symbol": "BTCUSDT", "market": "CRY", "value": 3.42, "weight": 41.8, "tradedValue": 1200000000, "source": "twelvedata", "asOf": 1732000006000 }
  ]
}
```

### `status` (Data Provenance, ≤ 2 KB)
```json
{ "v": 2, "seq": 9, "type": "status", "provenance": "DELAYED", "asOf": 1731999900000, "detail": "Upstream reconnect in progress" }
```
Valid provenance values:
- `LIVE` — Real-time upstream stream active.
- `DELAYED` — Real upstream data delayed beyond live threshold.
- `CACHED` — Last known real snapshot served from DO SQLite / KV cache.
- `UNAVAILABLE` — No real data available (UI renders unavailable/empty state; never fabricated data).

### `alert` (Server-Evaluated Trigger, ≤ 2 KB)
```json
{ "v": 2, "seq": 10, "type": "alert", "id": "alrt_42", "sym": "BTCUSDT", "condition": "price >= 91500", "price": 91510, "triggeredAt": 1732000006000 }
```

### `error` (Protocol / Execution Error, ≤ 2 KB)
```json
{ "v": 2, "seq": 11, "type": "error", "code": "INVALID_VIEW", "message": "view.screener.page must be an integer >= 1", "fatal": false }
```

### `pong` (Heartbeat Reply, ≤ 2 KB)
```json
{ "v": 2, "seq": 0, "type": "pong", "t": 1732000006000 }
```

---

### Chart history with indicators (HTTP, Tasks 9/11)
The chart's one request is `GET /api/candles?symbol=ETHUSDT&interval=1H&limit=1000&ind=ema:10,sma:20,bb:20:2,rsi:14`
(`before=<sec>` pages older history). The server fetches `limit` plus warm-up bars (window indicators: `period`;
EMA/RSI: `4 × period`; capped at 1,000), computes every series with `shared/market/chartIndicators.js`, and returns
only the newest bars, so every returned point is fully warmed and independently fetched pages join without gaps.
```json
{ "ok": true, "bars": [{ "t": 1732000000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 0 }],
  "ind": { "ema:10": { "type": "ema", "points": [{ "t": 1732000000, "v": 3180.2 }] },
           "bb:20:2": { "type": "bb", "upper": [], "middle": [], "lower": [] } } }
```
Spec ids are the hub's canonical keys (`ema:20`, `bb:20:2`) and match `view.chart.ind` and `ind` frame ids. Invalid or
more than 24 specs → `400 { ok:false, error }`. Without `ind` the response is unchanged. Live values for closed bars
come from `ind` frames; the browser never computes them.

---

## 6. Validation & Fan-Out Coalescing

- Use `validateClientMessage(raw)` on every inbound socket message; reply with an `error` frame on failure.
- Use `makeFrame(type, payload, seq)` or `validateServerFrame(frame, { lastSeq })` in tests and hub emitters.
- In the hub flush loop (every `HUB_FLUSH_MS`), coalesce updates to the latest value per symbol and pack per-client quote updates with `packQuoteFrames()` so every fanned-out frame across hundreds of sockets stays strictly `<= 2,048` bytes.
