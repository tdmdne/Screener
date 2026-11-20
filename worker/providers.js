// worker/providers.js — REST upstreams. API keys are read from env here and never leave the Worker.
import { TF_BINANCE, TF_TWELVE } from "../shared/constants.js";
import { cleanBars, providerFor, toTwelveSymbol, normSymbol } from "../shared/schema.js";

export const BINANCE_REST = ["https://data-api.binance.vision", "https://api.binance.com", "https://api1.binance.com"];

async function fetchJson(url, { timeoutMs = 6000, init } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    if (!r.ok) { const e = new Error(`upstream ${r.status}`); e.status = r.status; throw e; }
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function binanceKlines(sym, tf, limit) {
  const interval = TF_BINANCE[tf];
  if (!interval) throw new Error("bad timeframe");
  let last;
  for (const base of BINANCE_REST) {
    try {
      const rows = await fetchJson(`${base}/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`);
      return cleanBars(rows.map((k) => [k[0], k[1], k[2], k[3], k[4], k[5]]));
    } catch (e) { last = e; }
  }
  throw last || new Error("binance unavailable");
}

async function twelveSeries(sym, tf, limit, env) {
  if (!env.TWELVEDATA_KEY) throw new Error("TWELVEDATA_KEY not configured");
  const interval = TF_TWELVE[tf];
  if (!interval) throw new Error("bad timeframe");
  const u = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(toTwelveSymbol(sym))}&interval=${interval}&outputsize=${limit}&timezone=UTC&order=ASC&apikey=${env.TWELVEDATA_KEY}`;
  const d = await fetchJson(u);
  if (d.status === "error") { const e = new Error(d.message || "twelvedata error"); e.status = d.code; throw e; }
  return cleanBars((d.values || []).map((v) => ({ t: v.datetime, o: v.open, h: v.high, l: v.low, c: v.close, v: v.volume })));
}

/** Candles for an internal symbol. Throws on upstream failure (caller falls back to cache). */
export async function fetchCandles(symbol, tf, limit, env) {
  const sym = normSymbol(symbol);
  limit = Math.max(1, Math.min(1000, Number(limit) || 300));
  const bars = providerFor(sym) === "binance" ? await binanceKlines(sym, tf, limit) : await twelveSeries(sym, tf, limit, env);
  if (!bars.length) throw new Error("empty response");
  return bars;
}

/** Last price (REST). */
export async function fetchQuote(symbol, env) {
  const sym = normSymbol(symbol);
  if (providerFor(sym) === "binance") {
    let last;
    for (const base of BINANCE_REST) {
      try { const d = await fetchJson(`${base}/api/v3/ticker/price?symbol=${sym}`); return { s: sym, c: Number(d.price), t: Date.now() }; }
      catch (e) { last = e; }
    }
    throw last;
  }
  if (!env.TWELVEDATA_KEY) throw new Error("TWELVEDATA_KEY not configured");
  const d = await fetchJson(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(toTwelveSymbol(sym))}&apikey=${env.TWELVEDATA_KEY}`);
  if (d.status === "error") throw new Error(d.message || "twelvedata error");
  return { s: sym, c: Number(d.price), t: Date.now() };
}
