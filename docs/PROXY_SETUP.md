# Market-data proxy: setup & deploy

New, **additive** layout (nothing existing is changed or removed):

```
shared/   constants.js, schema.js      symbol mapping, tick/bar normalisation, zero-tolerance tick guard (worker + browser)
worker/   index.js                     router + CORS + cached REST (stale fallback instead of 502)
          hub.js / hubCore.js          Durable Object: ONE upstream feed per symbol, fan-out to N browsers (WebSocket + SSE)
          upstream.js / providers.js   Binance + Twelve Data connectors (keys live only here)
          wrangler.toml                separate Worker "vektor-proxy"
client/   services/dataService.js      the only network layer: proxy-only, reconnect, SSE fallback, ring buffer + rAF flush
```

The existing root `worker.js` / `functions/` / `index.html` keep running untouched. This is the target architecture; the
browser app is migrated onto `dataService.js` in a follow-up (see "Migrating index.html").

## 1. Prerequisites
Node 20+, a Cloudflare account (free works; Durable Objects need the Workers Free or Paid plan), `npm i -g wrangler` or use `npx wrangler`.

```bash
npx wrangler login
```

## 2. Secrets (never put keys in code, `wrangler.toml` or the browser)
```bash
cd worker
npx wrangler secret put TWELVEDATA_KEY      # paste the key when prompted (FX, stocks, indices)
```
Binance public market data needs no key. For local development create `worker/.dev.vars` (git-ignored):
```
TWELVEDATA_KEY=your_key_here
```
Check: `npx wrangler secret list`. Rotate any key that was ever pasted into a browser field or committed.

## 3. Config
`worker/wrangler.toml` → `[vars] ALLOWED_ORIGINS`. Use `"*"` while testing, then lock it, e.g.
`"https://screener-cso.pages.dev,https://app.yourdomain.com"` (`*.pages.dev` wildcard supported for preview URLs).

## 4. Run locally
```bash
cd worker && npx wrangler dev          # http://localhost:8787
curl localhost:8787/api/health         # {"ok":true,"providers":{"twelvedata":true,...}}
curl "localhost:8787/api/candles?symbol=BTCUSDT&tf=1m&limit=5"
```
WebSocket test: `new WebSocket("ws://localhost:8787/ws")` then send `{"op":"sub","symbols":["BTCUSDT"]}`.

## 5. Deploy
```bash
cd worker && npx wrangler deploy
```
First deploy creates the `MarketHub` Durable Object (migration `v1`). You get `https://vektor-proxy.<your-subdomain>.workers.dev`.
Verify: `/api/health`, then a candles call; `GET /api/hub/stats` shows connected clients and subscribed symbols.

## 6. Point the browser at it
Two options:
* **Cross-origin (simplest):** `createDataService({ baseUrl: "https://vektor-proxy.<sub>.workers.dev" })`; set `ALLOWED_ORIGINS` to your site.
* **Same origin (no CORS at all):** uncomment `[assets]` in `worker/wrangler.toml` so the Worker also serves the site, or add a
  Cloudflare route `yourdomain.com/api/*` + `/ws` + `/sse` to this Worker.

## 7. Migrating index.html (follow-up)
`index.html` still calls these third parties directly: `data-stream.binance.vision`, `ws.twelvedata.com`, `api.twelvedata.com`,
`ws.finnhub.io`/`finnhub.io`, `api.polygon.io`, `api.coingecko.com`, and takes a Finnhub key typed into the browser.
Migrate one provider at a time: replace its fetch/WebSocket code with `data.getCandles()` / `data.onTicks()`; when a provider has no
remaining direct calls, delete its key field. Finnhub, Polygon and CoinGecko connectors are not in this scaffold yet.

## Behaviour you can rely on
| Situation | Result |
|---|---|
| Upstream times out / 429 / 5xx, cached copy exists | `200`, `X-Cache: STALE`, body `cache:"STALE"` |
| Upstream down, nothing cached | `503` **JSON** (`bars:[]`) + `Retry-After`; client reuses its last bars |
| 100 browsers watch EURUSD | 1 upstream subscription (ref-counted); ticks coalesced, pushed ≤ every 100 ms |
| Corrupt tick (0, NaN, bid>ask, >1.5% FX / >5% crypto jump) | dropped, never clamped (worker **and** client) |
| WebSocket blocked | client falls back to SSE after 3 failures |
| Tab flooded with ticks | ring buffer (4096) drained once per animation frame |

## Limits / honest notes
* Memory cache is per Worker isolate (best-effort). For a durable fallback add KV (`SCREENER_KV` in the root worker already does this).
* One global Durable Object = one region and ~one thread of throughput. Fine for hundreds of clients; shard by `idFromName(assetClass)` when needed.
* Twelve Data plan limits cap concurrent WS symbols; `MAX_UPSTREAM_SYMBOLS` (100) in `shared/constants.js` should match your plan.
* The upstream connectors were verified for protocol shape and runtime wiring locally, **not against live providers** (the sandbox has no outbound market-data access). Test with real keys on a preview before relying on them.
