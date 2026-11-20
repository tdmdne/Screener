// shared/market/cryptoProvider.js — the ONE switch that decides which upstream carries crypto.
//
//   CRYPTO_PROVIDER=binance      (default) public Binance !miniTicker@arr stream, no Twelve Data slots used
//   CRYPTO_PROVIDER=twelvedata   all crypto rides the Twelve Data WebSocket (BTC/USD, ETH/USD, ...),
//                                the switch to flip when the Venture plan is active
//
// Pure + Workers-safe (no node:, no process). Unknown or empty values fall back to "binance".
import { assetClass } from "../schema.js";
import { ASSET } from "../constants.js";
import { STABLE_RE } from "../instruments.js";

export const CRYPTO_PROVIDERS = Object.freeze({ BINANCE: "binance", TWELVEDATA: "twelvedata" });
export const DEFAULT_CRYPTO_PROVIDER = CRYPTO_PROVIDERS.BINANCE;

/**
 * Resolve the crypto provider from a Worker `env` (or any plain object).
 * @param {{CRYPTO_PROVIDER?: string}|null|undefined} env
 * @returns {"binance"|"twelvedata"}
 */
export function resolveCryptoProvider(env) {
  const raw = env && typeof env.CRYPTO_PROVIDER === "string" ? env.CRYPTO_PROVIDER.trim().toLowerCase() : "";
  return raw === CRYPTO_PROVIDERS.TWELVEDATA ? CRYPTO_PROVIDERS.TWELVEDATA : DEFAULT_CRYPTO_PROVIDER;
}

/** True for symbols the Binance miniTicker feed can serve (`<BASE>USDT`, stablecoin pairs excluded). */
export function isBinanceCryptoSymbol(sym) {
  const s = String(sym || "").toUpperCase();
  return s.length > 4 && s.endsWith("USDT") && !STABLE_RE.test(s) && assetClass(s) === ASSET.CRY;
}

/** True when `sym` must be served by the Binance feed (and kept OFF Twelve Data) under `provider`. */
export function isBinanceRouted(sym, provider) {
  return provider === CRYPTO_PROVIDERS.BINANCE && isBinanceCryptoSymbol(sym);
}
