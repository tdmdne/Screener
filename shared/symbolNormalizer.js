// shared/symbolNormalizer.js — deterministic ticker normalisation for every backend.
// Pure functions, no Node APIs. Builds on shared/schema.js (normSymbol / toTwelveSymbol)
// so the worker/ proxy, the root backends and the browser all agree on symbol shape.
import { normSymbol, toTwelveSymbol } from "./schema.js";
import { FUTURES_TO_TWELVEDATA, INSTRUMENT_BY_SYMBOL } from "./instruments.js";

const PROVIDER_ALIASES = Object.freeze({ binance: "binance", bn: "binance", twelvedata: "twelvedata", td: "twelvedata" });
const VENUE_PREFIX_RE = /^[A-Z_]+:/;               // "BINANCE:BTCUSDT", "FX:EURUSD"
const SEPARATOR_RE = /[\s/\-_:.]/g;
const USD_STABLE_QUOTE_RE = /(BUSD|FDUSD|TUSD|PYUSD)$/; // real Binance quote assets ending in "USD"

const clean = (symbol) => String(symbol ?? "").trim().toUpperCase();

/**
 * Map a futures root / alias to its Twelve Data symbol.
 * Unmapped "=F" roots resolve to "" (Twelve Data has no futures); anything else falls back.
 */
export function resolveTdSymbol(sym, fallback) {
  if (!sym) return fallback || "";
  const s = String(sym).trim().toUpperCase();
  if (FUTURES_TO_TWELVEDATA[s]) return FUTURES_TO_TWELVEDATA[s];
  if (fallback && FUTURES_TO_TWELVEDATA[String(fallback).trim().toUpperCase()]) {
    return FUTURES_TO_TWELVEDATA[String(fallback).trim().toUpperCase()];
  }
  if (s.endsWith("=F")) return "";
  return fallback || s;
}

function toBinanceSymbol(s) {
  const compact = s.replace(VENUE_PREFIX_RE, "").replace(SEPARATOR_RE, "");
  if (compact.length > 3 && compact.endsWith("USD") && !USD_STABLE_QUOTE_RE.test(compact)) return `${compact}T`;
  return compact;
}

function toInternalSymbol(s) {
  if (s.endsWith("=F") || s.startsWith("^")) return s.replace(/\s+/g, "");
  return normSymbol(s);
}

/**
 * Normalise a ticker for a provider before any network call.
 *   binance     ("bn"): "BTCUSD" | "BTC/USD" | "BTC-USD" | " btcusdt " -> "BTCUSDT"
 *   twelvedata  ("td"): "EURUSD" | "eur-usd" -> "EUR/USD";  "ES=F" -> "SPY" (futures proxy)
 *   anything else     : internal form, "EUR/USD" -> "EURUSD" (same as schema.normSymbol;
 *                       "=F" futures and "^" Yahoo indices are kept verbatim)
 * Empty / nullish input returns "".
 */
export function normalizeSymbol(symbol, provider) {
  const s = clean(symbol);
  if (!s) return "";
  const target = PROVIDER_ALIASES[String(provider ?? "").toLowerCase()];
  if (target === "binance") return toBinanceSymbol(s);
  if (target === "twelvedata") return s.endsWith("=F") ? resolveTdSymbol(s, "") : toTwelveSymbol(s);
  return toInternalSymbol(s);
}

/** Catalog metadata for a symbol, or a best-effort inferred record for unknown symbols. */
export function inferMeta(symbol, mktHint, apiHint) {
  const sym = String(symbol || "").trim().toUpperCase();
  const known = INSTRUMENT_BY_SYMBOL.get(sym);
  if (known) {
    const tdResolved = resolveTdSymbol(known.td, known.s);
    return { ...known, td: tdResolved };
  }
  const isBn = sym.endsWith("USDT") || sym.endsWith("BUSD") || sym.endsWith("BTC") || mktHint === "CRY";
  const isFx = mktHint === "FX" || /^[A-Z]{6}$/.test(sym);
  const isFut = mktHint === "FUT" || sym.endsWith("=F");
  const futTd = resolveTdSymbol(sym, "");
  const tdSym = futTd ? futTd : (isFx && sym.length === 6 ? sym.slice(0, 3) + "/" + sym.slice(3) : (sym.endsWith("=F") ? "" : sym));
  return {
    s: sym,
    m: isBn ? "CRY" : isFx ? "FX" : isFut ? "FUT" : mktHint || "STK",
    name: sym,
    ex: isBn ? "BINANCE" : isFx ? "FX" : isFut ? "CME" : "NASDAQ",
    p: isFx ? 1.12 : isBn ? 42.5 : 100,
    v: isFx ? 0 : 1200000,
    cs: 1,
    vf: isFx ? 0.006 : 0.02,
    api: apiHint || (isFx && !sym.includes("=") ? sym + "=X" : sym),
    td: tdSym,
    tv: sym,
    pr: isBn ? "bn" : "yf",
  };
}
