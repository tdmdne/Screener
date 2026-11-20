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

// ---------------------------------------------------------------------------------------------------------------
// Interval resolution: one normalizer for every backend (worker.js, Pages Function, MarketHub, candle builder).
// ---------------------------------------------------------------------------------------------------------------

/** Provider / legacy spellings -> canonical native key. "5M"/"15M"/"30M" are legacy MINUTE aliases (never months). */
const INTERVAL_ALIASES = deepFreeze({
  "1min": "1m",
  "5M": "5m",
  "5min": "5m",
  "15M": "15m",
  "15min": "15m",
  "30M": "30m",
  "30min": "30m",
  "1h": "1H",
  "60m": "1H",
  "4h": "4H",
  "1d": "1D",
  "1day": "1D",
  "1w": "1W",
  "1week": "1W",
  "1wk": "1W",
  "1month": "1M",
  "1mo": "1M",
});

const SEC = Object.freeze({ m: 60, H: 3600, D: 86400, W: 604800, M: INTERVAL_SECONDS["1M"] });
// Per-unit ceilings keep custom intervals sane (<= 1 day of minutes, <= 1 week of hours, <= ~1 year overall).
const CUSTOM_MAX = Object.freeze({ m: 1440, H: 168, D: 366, W: 52, M: 12 });
const CUSTOM_RE = /^(\d{1,4})(min|mo|m|h|H|d|D|w|W|M)$/;
const UNIT_ALIAS = Object.freeze({ min: "m", mo: "M", m: "m", h: "H", H: "H", d: "D", D: "D", w: "W", W: "W", M: "M" });

// Native bases that tile fixed-length custom steps (largest first). Weeks/months use their own native base.
const FIXED_BASES = Object.freeze(["1D", "4H", "1H", "30m", "15m", "5m", "1m"]);

function nativeKeyForStep(step) {
  for (const [k, v] of Object.entries(INTERVAL_SECONDS)) if (v === step) return k;
  return null;
}

/**
 * Resolve any interval label (native, provider alias, or custom such as "3m", "45m", "2H", "12H", "2D", "3M") to
 * `{ key, step, native, base, baseStep, ratio }`, or null when unsupported.
 *  - `key`   canonical label used for cache keys, wire payloads and hub timeframes ("1m" minute vs "1M" month never collide).
 *  - `base`  native interval that real providers (Twelve Data /time_series, Binance, Yahoo) can serve and that tiles `step` exactly.
 *  - `ratio` base bars per resampled bar (1 for native intervals).
 * Seconds ("30s") are unsupported: REST history has no sub-minute bars.
 * @param {unknown} label
 * @returns {{ key: string, step: number, native: boolean, base: string, baseStep: number, ratio: number } | null}
 */
export function resolveInterval(label) {
  if (typeof label !== "string") return null;
  const raw = label.trim();
  if (!raw) return null;

  let key = null;
  if (Object.prototype.hasOwnProperty.call(INTERVAL_SECONDS, raw)) key = raw;
  else if (Object.prototype.hasOwnProperty.call(INTERVAL_ALIASES, raw)) key = INTERVAL_ALIASES[raw];
  if (key) return { key, step: INTERVAL_SECONDS[key], native: true, base: key, baseStep: INTERVAL_SECONDS[key], ratio: 1 };

  const m = CUSTOM_RE.exec(raw);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = UNIT_ALIAS[m[2]];
  if (!Number.isInteger(n) || n < 1 || n > CUSTOM_MAX[unit]) return null;

  const step = n * SEC[unit];
  // A custom label that equals a native step (60m, 240m, 24H, 7D, 1H ...) IS that native interval.
  if (unit !== "M" || n === 1) {
    const nat = nativeKeyForStep(step);
    if (nat) return { key: nat, step: INTERVAL_SECONDS[nat], native: true, base: nat, baseStep: INTERVAL_SECONDS[nat], ratio: 1 };
  }

  let base;
  if (unit === "M") base = "1M";
  else if (unit === "W") base = "1W";
  else base = FIXED_BASES.find((b) => step > INTERVAL_SECONDS[b] && step % INTERVAL_SECONDS[b] === 0);
  if (!base) return null;

  return {
    key: `${n}${unit}`,
    step,
    native: false,
    base,
    baseStep: INTERVAL_SECONDS[base],
    ratio: Math.round(step / INTERVAL_SECONDS[base]),
  };
}
