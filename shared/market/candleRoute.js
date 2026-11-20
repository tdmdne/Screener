// shared/market/candleRoute.js — symbol/interval spellings used when one backend asks the MarketHub for bars
// (`GET /api/bars?sym=&tf=`). Shared by worker.js and the Pages Function so both address the hub identically.

import { toTwelveSymbol } from "../schema.js";
import { INTERVAL_SECONDS } from "../intervals.js";
import { isBinanceCryptoSymbol } from "./cryptoProvider.js";

/**
 * Hub `sym` query value. Crypto is Binance-only: the hub stores Binance bars under the Binance pair ("BTCUSDT"), so
 * those symbols pass through unchanged. Everything else uses the Twelve Data spelling ("EUR/USD", "AAPL").
 */
export function hubBarsSymbol(rawSym, mktHint = "") {
  const sym = String(rawSym || "").trim().toUpperCase();
  if (!sym) return "";
  if (isBinanceCryptoSymbol(sym)) return sym;
  if (sym.includes("/")) return sym;
  const mapped = toTwelveSymbol(sym);
  if (mapped && mapped.includes("/")) return mapped;
  if (mktHint === "FX" && /^[A-Z]{6}$/.test(sym)) return `${sym.slice(0, 3)}/${sym.slice(3)}`;
  return mapped || sym;
}

/**
 * Hub `tf` query value for a canonical interval key. Native: "1H" -> "1h", "1M" (month) stays upper-case, "1m" stays minute.
 * Custom keys ("3m", "2H", "3M") are sent as-is; the hub resolves them with the same shared/intervals.js.
 */
export function hubTfLabel(key) {
  const k = String(key);
  if (!Object.prototype.hasOwnProperty.call(INTERVAL_SECONDS, k)) return k;
  return k === "1M" ? "1M" : k.toLowerCase();
}
