// shared/yahooFeed.js — Server-side live market data fetcher for non-crypto instruments
// (FX, Stocks, ETFs, Indices, Futures, Metals) via Yahoo Finance Chart v8.
// Pure Fetch API (works in both Node >= 22 server.js and Cloudflare Workers worker.js).
// Zero synthetic or simulated bars: fails closed (returns null) when upstream has no valid bars.

import { INTERVAL_SECONDS, YAHOO_INTERVALS } from "./intervals.js";

const YF_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
const YF_HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; VektorTerminal/1.0)",
  accept: "application/json",
};

/**
 * Normalize an instrument symbol to a Yahoo Finance ticker.
 * Maps crypto pairs like BTCUSDT / ETHBUSD / BTCUSD -> BTC-USD / ETH-USD while preserving
 * already-valid Yahoo tickers (EURUSD=X, GC=F, ^GSPC, SPY, etc.).
 */
export function toYahooSymbol(rawSym, apiSym = "") {
  const pref = String(apiSym || "").trim().toUpperCase();
  const sym = String(rawSym || "").trim().toUpperCase();
  const candidate = pref || sym;
  if (!candidate) return "";
  if (candidate.includes("=") || candidate.startsWith("^") || candidate.includes("-")) return candidate;
  const slashCrypto = candidate.match(/^([A-Z0-9]{2,10})\/(USDT|BUSD|USDC|USD)$/);
  if (slashCrypto) return `${slashCrypto[1]}-USD`;
  const usdt = candidate.match(/^([A-Z0-9]{2,10})(USDT|BUSD|USDC)$/);
  if (usdt) return `${usdt[1]}-USD`;
  if (/^(BTC|ETH|SOL|BNB|XRP|DOGE|ADA|AVAX|LINK|QNT|DOT|MATIC|LTC|BCH|UNI|ATOM|NEAR|ARB|OP|SUI|TON|TRX|SHIB|PEPE)USD$/.test(candidate)) {
    return `${candidate.slice(0, -3)}-USD`;
  }
  return candidate;
}

async function fetchJsonWithTimeout(url, timeoutMs = 5500) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: YF_HEADERS });
    if (!r.ok) return null;
    return await r.json();
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(id);
  }
}

function aggregateBars(bars, bucketSec) {
  if (!Array.isArray(bars) || !bars.length || !(bucketSec > 0)) return bars || [];
  const map = new Map();
  for (const b of bars) {
    const k = Math.floor(b.t / bucketSec) * bucketSec;
    const prev = map.get(k);
    if (!prev) {
      map.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 });
    } else {
      if (b.h > prev.h) prev.h = b.h;
      if (b.l < prev.l) prev.l = b.l;
      prev.c = b.c;
      prev.v += b.v || 0;
    }
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

/**
 * Fetch real OHLCV candles from Yahoo Finance Chart v8.
 * Returns sorted, deduplicated array of { t, o, h, l, c, v } or null on failure.
 */
export async function fetchYahooCandles(apiSym, interval, opts = {}) {
  const pair = YAHOO_INTERVALS[interval];
  if (!apiSym || !pair) return null;
  const [yfInterval, defaultRange] = pair;
  const step = INTERVAL_SECONDS[interval] || 3600;
  const limit = Math.max(10, Math.min(5000, Number(opts.limit) || 500));
  const fromSec = Math.max(0, Math.floor(Number(opts.from) || 0));
  const toSec = Math.max(0, Math.floor(Number(opts.to) || 0));
  const beforeSec = Math.max(0, Math.floor(Number(opts.before) || 0));

  let query = `interval=${encodeURIComponent(yfInterval)}&includePrePost=false`;
  if (fromSec > 0 && toSec > fromSec) {
    query += `&period1=${fromSec}&period2=${toSec}`;
  } else if (beforeSec > 0) {
    const windowSec = Math.min(limit * step * (interval === "4H" ? 2 : 1.4), 365 * 86400 * 5);
    const p1 = Math.max(0, Math.floor(beforeSec - windowSec));
    query += `&period1=${p1}&period2=${beforeSec}`;
  } else {
    query += `&range=${encodeURIComponent(defaultRange)}`;
  }

  const url = `${YF_BASE}${encodeURIComponent(apiSym)}?${query}`;
  const json = await fetchJsonWithTimeout(url, 6000);
  const res = json && json.chart && Array.isArray(json.chart.result) ? json.chart.result[0] : null;
  if (!res || !Array.isArray(res.timestamp)) return null;

  const quote = res.indicators && Array.isArray(res.indicators.quote) ? res.indicators.quote[0] : null;
  if (!quote || !Array.isArray(quote.close)) return null;

  const byTime = new Map();
  const ts = res.timestamp;
  const alignStep = interval === "4H" ? 3600 : step;
  for (let i = 0; i < ts.length; i++) {
    const rawT = Math.floor(Number(ts[i]));
    const c = Number(quote.close[i]);
    if (!Number.isFinite(rawT) || rawT <= 0 || !Number.isFinite(c) || c <= 0) continue;
    const t = alignStep >= 86400 ? rawT : Math.floor(rawT / alignStep) * alignStep;
    const rawO = Number(quote.open && quote.open[i]);
    const rawH = Number(quote.high && quote.high[i]);
    const rawL = Number(quote.low && quote.low[i]);
    const rawV = Number(quote.volume && quote.volume[i]);
    const o = Number.isFinite(rawO) && rawO > 0 ? rawO : c;
    const h = Number.isFinite(rawH) && rawH > 0 ? Math.max(rawH, o, c) : Math.max(o, c);
    const l = Number.isFinite(rawL) && rawL > 0 ? Math.min(rawL, o, c) : Math.min(o, c);
    const v = Number.isFinite(rawV) && rawV >= 0 ? rawV : 0;
    const prev = byTime.get(t);
    if (!prev) {
      byTime.set(t, { t, o, h, l, c, v });
    } else {
      prev.h = Math.max(prev.h, h, c);
      prev.l = Math.min(prev.l, l, c);
      prev.c = c;
      prev.v += v;
    }
  }

  let bars = [...byTime.values()].sort((a, b) => a.t - b.t);
  if (interval === "4H") {
    bars = aggregateBars(bars, 14400);
  }
  if (beforeSec > 0) bars = bars.filter((b) => b.t < beforeSec);
  if (fromSec > 0) bars = bars.filter((b) => b.t >= fromSec);
  if (toSec > 0) bars = bars.filter((b) => b.t <= toSec);
  if (bars.length > limit) bars = bars.slice(-limit);
  if (isDegenerateSeries(bars)) return null;
  return bars.length ? bars : null;
}

/**
 * Yahoo's FX intraday feed (notably 1m) often returns tick samples with O=H=L=C on (nearly) every bar. Rendering
 * those draws flat dashes instead of candles, so such a series is treated as "no data" and callers fall back to
 * cached history / the hub's tick-built bars. Real candle series have only a few flat bars (quiet minutes).
 */
export const DEGENERATE_FLAT_RATIO = 0.9;
export function isDegenerateSeries(bars) {
  if (!Array.isArray(bars) || bars.length < 20) return false;
  let flat = 0;
  for (const b of bars) if (b.o === b.h && b.h === b.l && b.l === b.c) flat++;
  return flat / bars.length >= DEGENERATE_FLAT_RATIO;
}

/**
 * Fetch a real live quote snapshot (latest price, 24h % change, volume) for a Yahoo symbol.
 * Returns { c, prevClose, pct, v, t } or null on failure.
 */
export async function fetchYahooQuote(apiSym) {
  if (!apiSym) return null;
  const url = `${YF_BASE}${encodeURIComponent(apiSym)}?interval=1d&range=5d&includePrePost=false`;
  const json = await fetchJsonWithTimeout(url, 4500);
  const res = json && json.chart && Array.isArray(json.chart.result) ? json.chart.result[0] : null;
  if (!res) return null;

  const meta = res.meta || {};
  const quote = res.indicators && Array.isArray(res.indicators.quote) ? res.indicators.quote[0] : null;
  const closes = quote && Array.isArray(quote.close)
    ? quote.close.map(Number).filter((x) => Number.isFinite(x) && x > 0)
    : [];
  const vols = quote && Array.isArray(quote.volume)
    ? quote.volume.map(Number).filter((x) => Number.isFinite(x) && x >= 0)
    : [];

  const regPrice = Number(meta.regularMarketPrice);
  const c = Number.isFinite(regPrice) && regPrice > 0
    ? regPrice
    : closes.length
      ? closes[closes.length - 1]
      : 0;
  if (!(c > 0)) return null;

  const prevCloseMeta = Number(meta.chartPreviousClose || meta.previousClose);
  const prevClose = closes.length >= 2
    ? closes[closes.length - 2]
    : Number.isFinite(prevCloseMeta) && prevCloseMeta > 0
      ? prevCloseMeta
      : c;
  const pct = prevClose > 0 ? ((c - prevClose) / prevClose) * 100 : 0;
  const v = Number.isFinite(Number(meta.regularMarketVolume)) && Number(meta.regularMarketVolume) > 0
    ? Number(meta.regularMarketVolume)
    : vols.length
      ? vols[vols.length - 1]
      : 0;
  const t = Number.isFinite(Number(meta.regularMarketTime)) && Number(meta.regularMarketTime) > 0
    ? Math.floor(Number(meta.regularMarketTime))
    : Math.floor(Date.now() / 1000);

  return {
    c,
    prevClose,
    pct: Number(pct.toFixed(2)),
    v,
    t,
  };
}
