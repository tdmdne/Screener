// shared/intervals.js — chart interval maps for the root backends (server.js + worker.js).
// Pure data, no Node APIs, frozen.
//
// Labels here are the UI/legacy labels ("1H", "1D", "1M" = 1 month). shared/constants.js
// holds the lowercase-label equivalents (TF_SECONDS / TF_BINANCE / TF_TWELVE, "1h", "1d")
// used by the worker/ proxy; the two cannot share keys because "1m" vs "1M" would collide
// when case-folded. tests/shared.test.mjs asserts the overlapping values stay identical.

const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v); return Object.freeze(o); };

/** Interval label -> bar length in seconds. Also the whitelist of accepted intervals. */
export const INTERVAL_SECONDS = deepFreeze({
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1H": 3600,
  "4H": 14400,
  "1D": 86400,
  "1W": 604800,
  "1M": 2592000,
});

/** Interval label -> Binance kline interval. */
export const BINANCE_INTERVALS = deepFreeze({
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1H": "1h",
  "4H": "4h",
  "1D": "1d",
  "1W": "1w",
  "1M": "1M",
});

/** Interval label -> Twelve Data /time_series interval. */
export const TWELVEDATA_INTERVALS = deepFreeze({
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1H": "1h",
  "4H": "4h",
  "1D": "1day",
  "1W": "1week",
  "1M": "1month",
});

/** Interval label -> Yahoo chart [interval, range]. */
export const YAHOO_INTERVALS = deepFreeze({
  "1m": ["1m", "5d"],
  "5m": ["5m", "1mo"],
  "15m": ["15m", "1mo"],
  "30m": ["30m", "1mo"],
  "1H": ["60m", "3mo"],
  "4H": ["60m", "6mo"],
  "1D": ["1d", "1y"],
  "1W": ["1wk", "5y"],
  "1M": ["1mo", "max"],
});
