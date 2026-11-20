// shared/market/feedRouting.js — ONE market-data feed per asset (history, replay, live overlay and quotes).
//
// Priority (Tyler, 20 Nov 2026): Twelve Data first for everything except crypto, Binance for crypto, Yahoo last.
//   crypto                         -> binance
//   futures (=F)                   -> yahoo      (Twelve Data only has stand-ins such as QQQ for NQ=F; real contracts win)
//   catalog entry with a TD symbol -> twelvedata (FX, stocks, ETFs, XAU/XAG, indices)
//   catalog entry without one      -> yahoo
//   unknown FX / stock / ETF       -> twelvedata
//   anything else                  -> yahoo
// An asset whose Twelve Data symbol TD reports as not carried (not a 429 or an outage) is routed to Yahoo as a whole:
// the next feed in priority for that asset, never a per-request mix. Pure and Workers-safe.

import { INSTRUMENT_BY_SYMBOL as BY_SYM } from "../instruments.js";
import { inferMeta, normalizeSymbol } from "../symbolNormalizer.js";

export const FEED = Object.freeze({ TWELVEDATA: "twelvedata", BINANCE: "binance", YAHOO: "yahoo" });

const TD_MARKETS = new Set(["FX", "STK", "ETF"]);

/** True for crypto pairs (Binance-served). */
export function isCryptoAsset(sym, meta = inferMeta(sym)) {
  const s = String(sym || "").toUpperCase();
  return (meta && (meta.pr === "bn" || meta.m === "CRY")) || /(?:USDT|BUSD)$/.test(s) || (/BTC$/.test(s) && s.length > 3);
}

/** True for exchange-traded futures (`NQ=F`, `CL=F`, ...). */
export function isFuturesAsset(sym, meta = inferMeta(sym)) {
  return /=F$/i.test(String(sym || "")) || Boolean(meta && meta.m === "FUT");
}

/**
 * Twelve Data symbol for an asset, or null when Twelve Data must not serve it (crypto, futures, catalog entries
 * without a TD symbol, non FX/stock/ETF unknowns).
 * @param {string} sym
 * @param {object} [meta]
 * @returns {string|null}
 */
export function tdSymbolFor(sym, meta = inferMeta(sym)) {
  const s = String(sym || "").trim().toUpperCase();
  if (!s || isCryptoAsset(s, meta) || isFuturesAsset(s, meta)) return null;
  const known = BY_SYM.get(s);
  if (known) return known.td || null;
  if (meta && TD_MARKETS.has(meta.m)) return normalizeSymbol(s, "twelvedata") || null;
  return null;
}

/**
 * The single feed that serves `sym`.
 * @param {string} sym
 * @param {{ meta?: object, tdUnsupported?: (tdSym: string) => boolean }} [opts]
 * @returns {"twelvedata"|"binance"|"yahoo"}
 */
export function assetFeed(sym, opts = {}) {
  const meta = opts.meta || inferMeta(sym);
  if (isCryptoAsset(sym, meta)) return FEED.BINANCE;
  const td = tdSymbolFor(sym, meta);
  if (td && !(typeof opts.tdUnsupported === "function" && opts.tdUnsupported(td))) return FEED.TWELVEDATA;
  return FEED.YAHOO;
}

/** True when a history/cache `source` label ("twelvedata", "twelvedata+hub", "binance+stale") came from `feed`. */
export function isFeedSource(source, feed) {
  return String(source || "").split("+")[0] === feed;
}

/**
 * True when a Twelve Data error means "this symbol is not carried" (as opposed to quota, rate limit or outage).
 * @param {{ code?: number, message?: string, status?: string }} body  Twelve Data JSON error body
 */
export function isTdSymbolUnsupported(body) {
  if (!body || typeof body !== "object") return false;
  const code = Number(body.code);
  const msg = String(body.message || "");
  if (code === 429 || /credit|rate limit|quota|run out|too many/i.test(msg)) return false;
  return (code === 400 || code === 404) && /symbol|not found|invalid|not available|upgrade|plan|access/i.test(msg);
}
