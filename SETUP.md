# Vektor Terminal — Cloudflare Edge Deployment Guide

Deploy Vektor Terminal globally with sub-50ms `/api/screener` and `/api/candles` edge caching, 1-minute Cron pre-computation, and Durable Object WebSocket fan-out (`/ws`).

## Prerequisites

- [Node.js 20+](https://nodejs.org/)
- A [Cloudflare account](https://dash.cloudflare.com/)
- Wrangler CLI (`npm install -g wrangler` or via `npx wrangler`)

## 1. Authenticate Wrangler

```bash
wrangler login
```

## 2. Create the `SCREENER_KV` Namespace

Run:

```bash
wrangler kv namespace create SCREENER_KV
```

Copy the returned `id` into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SCREENER_KV"
id = "<YOUR_KV_NAMESPACE_ID>"
```

*(Optional)* For `wrangler dev --remote`, also create a preview namespace:

```bash
wrangler kv namespace create SCREENER_KV --preview
```

and add `preview_id = "<YOUR_PREVIEW_KV_ID>"` to `[[kv_namespaces]]`.

## 3. Configure Upstream API Secrets (Optional)

If you have a Twelve Data API key for real-time Forex, Stocks, ETFs, Futures, and Indices, store it as an encrypted Worker secret:

```bash
wrangler secret put TWELVEDATA_KEY
```

> **Note:** If `TWELVEDATA_KEY` is omitted, the Worker and `MarketRelayDO` automatically use Binance public streams for Crypto, Yahoo Finance REST for equities/FX/futures, and a built-in realistic live tick + multi-timeframe candle simulator fallback so every asset class works immediately out of the box.

## 4. Deploy to Cloudflare Workers

```bash
wrangler deploy
```

Wrangler will:
1. Upload static assets (`index.html`, etc.) to Cloudflare's global edge.
2. Provision the `SCREENER_KV` binding and `MarketRelayDO` Durable Object (WebSocket Hibernation API).
3. Register the `* * * * *` (1-minute) Cron Trigger to keep `SCREENER_KV` continuously pre-warmed.

## 5. Verify Endpoints

Once deployed, check your Worker URL:

- **Pre-computed Screener (<50ms Edge/KV):** `GET /api/screener` (inspect `X-Cache: HIT-EDGE` or `HIT-KV`)
- **Edge-Cached Candles (60s TTL for `1m`/`5m`, 300s TTL for `15m`/`1H`/`4H`/`1D`):** `GET /api/candles?symbol=QQQ&interval=1H`
- **WebSocket Fan-Out (Durable Object Hibernation):** `wss://<your-worker>.workers.dev/ws`

## Local Development

- Run the Node.js local server (includes `/api/screener`, `/api/candles`, and `/ws` parity):
  ```bash
  npm run dev
  ```
- Or run the Cloudflare Workers runtime locally:
  ```bash
  npx wrangler dev
  ```
