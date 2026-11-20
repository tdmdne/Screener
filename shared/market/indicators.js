// shared/market/indicators.js — pure server-side technical indicators using Float64Array.
// Exact numerical parity (<= 1e-9; IEEE-754 bit-exact) with the legacy client formulas in index.html.
// Supports both batch computation and incremental bar-close updates without recomputing full history.
// Deterministic, zero Node APIs; compatible with Node 22+ and Cloudflare Workers.

/** Supported canonical indicator types. */
export const INDICATOR_TYPES = Object.freeze(["ema", "sma", "atr", "rsi", "bb", "vol", "adr"]);

/** Maximum permitted indicator lookback period (prevents Float64Array OOM). */
export const MAX_INDICATOR_PERIOD = 1000;

const TYPE_ALIASES = Object.freeze({
  ema: "ema",
  sma: "sma",
  atr: "atr",
  rsi: "rsi",
  bb: "bb",
  bollinger: "bb",
  vol: "vol",
  volume: "vol",
  adr: "adr",
});

const VALID_SOURCES = new Set(["c", "o", "h", "l", "hl2", "hlc3", "ohlc4"]);

/**
 * Validate and normalize an integer period in [1, MAX_INDICATOR_PERIOD].
 * @param {number} period
 * @param {string} name
 * @returns {number}
 */
function assertPeriod(period, name) {
  const p = Number(period);
  if (!Number.isInteger(p) || p < 1 || p > MAX_INDICATOR_PERIOD) {
    throw new RangeError(
      `${name}: period must be an integer between 1 and ${MAX_INDICATOR_PERIOD} (received ${period})`
    );
  }
  return p;
}

/**
 * Convert an array-like numeric sequence into a Float64Array without mutating the input.
 * @param {ArrayLike<number>} values
 * @returns {Float64Array}
 */
function toFloat64(values) {
  if (!values || typeof values.length !== "number") {
    throw new TypeError("values must be an array or TypedArray");
  }
  if (values instanceof Float64Array) return values;
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Number(values[i]);
  return out;
}

/**
 * Extract a scalar source value from a bar object (or pass through a raw number).
 * @param {object|number} bar
 * @param {string} [source="c"]
 * @returns {number}
 */
export function barSourceValue(bar, source = "c") {
  if (typeof bar === "number") return bar;
  if (!bar || typeof bar !== "object") return NaN;
  switch (source) {
    case "c": return Number(bar.c ?? bar.close);
    case "o": return Number(bar.o ?? bar.open);
    case "h": return Number(bar.h ?? bar.high);
    case "l": return Number(bar.l ?? bar.low);
    case "hl2": return (Number(bar.h ?? bar.high) + Number(bar.l ?? bar.low)) * 0.5;
    case "hlc3": return (Number(bar.h ?? bar.high) + Number(bar.l ?? bar.low) + Number(bar.c ?? bar.close)) / 3;
    case "ohlc4": return (Number(bar.o ?? bar.open) + Number(bar.h ?? bar.high) + Number(bar.l ?? bar.low) + Number(bar.c ?? bar.close)) * 0.25;
    default: return Number(bar.c ?? bar.close);
  }
}

/**
 * Extract a Float64Array of source prices from an array of OHLCV bars.
 * @param {Array<object|number>} bars
 * @param {string} [source="c"]
 * @returns {Float64Array}
 */
export function extractSource(bars, source = "c") {
  if (!Array.isArray(bars)) {
    if (bars instanceof Float64Array) return bars;
    throw new TypeError("bars must be an array");
  }
  const n = bars.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = barSourceValue(bars[i], source);
  return out;
}

/**
 * Normalize indicator config (accepts both canonical `{ type, period, mult, source }`
 * and legacy chart config `{ t, len, mult }`).
 * @param {object} config
 * @returns {{ type: string, period: number, mult: number, source: string }}
 */
export function normalizeIndicatorConfig(config) {
  if (!config || typeof config !== "object") {
    throw new TypeError("Indicator config must be an object");
  }
  const rawType = String(config.type ?? config.t ?? "").trim().toLowerCase();
  const type = TYPE_ALIASES[rawType];
  if (!type) throw new RangeError(`Unsupported indicator type: ${config.type ?? config.t}`);

  const source = VALID_SOURCES.has(config.source) ? config.source : "c";

  if (type === "vol") {
    return { type, period: 1, mult: 0, source };
  }

  const defaultPeriod = type === "rsi" || type === "atr" || type === "adr" ? 14 : 20;
  const period = assertPeriod(config.period ?? config.len ?? defaultPeriod, type);
  const mult = type === "bb" ? Number(config.mult ?? 2) : 0;
  if (type === "bb" && (!Number.isFinite(mult) || mult <= 0)) {
    throw new RangeError(`bb: mult must be a finite positive number (received ${config.mult})`);
  }
  return { type, period, mult, source };
}

/**
 * Deterministic subscription key for an indicator configuration (for hub deduplication).
 * @param {object} config
 * @returns {string}
 */
export function indicatorKey(config) {
  const cfg = normalizeIndicatorConfig(config);
  if (cfg.type === "vol") return "vol";
  const srcSuffix = cfg.source !== "c" && cfg.type !== "atr" && cfg.type !== "adr" ? `:${cfg.source}` : "";
  if (cfg.type === "bb") return `bb:${cfg.period}:${cfg.mult}${srcSuffix}`;
  return `${cfg.type}:${cfg.period}${srcSuffix}`;
}

/**
 * Exponential Moving Average (matches index.html `emaArr`: seeded at values[0], k = 2 / (period + 1)).
 * @param {ArrayLike<number>} values
 * @param {number} period
 * @returns {Float64Array}
 */
export function ema(values, period) {
  const p = assertPeriod(period, "ema");
  const src = toFloat64(values);
  const n = src.length;
  const out = new Float64Array(n);
  if (n === 0) return out;

  const k = 2 / (p + 1);
  const oneMinusK = 1 - k;
  let e = src[0];
  out[0] = e;
  for (let i = 1; i < n; i++) {
    e = src[i] * k + e * oneMinusK;
    out[i] = e;
  }
  return out;
}

/**
 * Simple Moving Average (matches index.html `smaArr`: NaN for i < period - 1, exact window mean).
 * @param {ArrayLike<number>} values
 * @param {number} period
 * @returns {Float64Array}
 */
export function sma(values, period) {
  const p = assertPeriod(period, "sma");
  const src = toFloat64(values);
  const n = src.length;
  const out = new Float64Array(n);
  out.fill(NaN);
  if (n < p) return out;

  for (let i = p - 1; i < n; i++) {
    let sum = 0;
    const start = i - p + 1;
    for (let j = start; j <= i; j++) sum += src[j];
    out[i] = sum / p;
  }
  return out;
}

/**
 * True Range series helper.
 * @param {Array<{h:number,l:number,c:number}>} bars
 * @returns {Float64Array}
 */
export function trueRange(bars) {
  if (!Array.isArray(bars)) throw new TypeError("bars must be an array");
  const n = bars.length;
  const tr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const h = Number(bars[i].h ?? bars[i].high);
    const l = Number(bars[i].l ?? bars[i].low);
    if (i === 0) {
      tr[0] = h - l;
    } else {
      const prevC = Number(bars[i - 1].c ?? bars[i - 1].close);
      tr[i] = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    }
  }
  return tr;
}

/**
 * Average True Range (matches index.html `atrArr`: SMA of True Range over `period`).
 * @param {Array<{h:number,l:number,c:number}>} bars
 * @param {number} period
 * @returns {Float64Array}
 */
export function atr(bars, period) {
  const p = assertPeriod(period, "atr");
  const tr = trueRange(bars);
  return sma(tr, p);
}

/**
 * Relative Strength Index (matches index.html `rsiArr` exactly).
 * Returns Float64Array of length values.length with NaN for i < period.
 * @param {ArrayLike<number>} values
 * @param {number} period
 * @returns {Float64Array}
 */
export function rsi(values, period) {
  const p = assertPeriod(period, "rsi");
  const src = toFloat64(values);
  const n = src.length;
  const out = new Float64Array(n);
  out.fill(NaN);
  if (n <= 1) return out;

  let g = 0;
  let l = 0;
  for (let i = 1; i < n; i++) {
    const d = src[i] - src[i - 1];
    const u = d > 0 ? d : 0;
    const w = d < 0 ? -d : 0;
    if (i <= p) {
      g += u / p;
      l += w / p;
    } else {
      g = (g * (p - 1) + u) / p;
      l = (l * (p - 1) + w) / p;
    }
    if (i >= p) {
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
  }
  return out;
}

/**
 * Bollinger Bands (matches index.html lines 1664-1666 & 1774-1775: SMA + population StdDev * mult).
 * @param {ArrayLike<number>} values
 * @param {number} period
 * @param {number} [mult=2]
 * @returns {{ middle: Float64Array, upper: Float64Array, lower: Float64Array, stdDev: Float64Array }}
 */
export function bollinger(values, period, mult = 2) {
  const p = assertPeriod(period, "bollinger");
  const m = Number(mult);
  if (!Number.isFinite(m) || m <= 0) {
    throw new RangeError(`bollinger: mult must be a finite positive number (received ${mult})`);
  }
  const src = toFloat64(values);
  const n = src.length;
  const middle = new Float64Array(n);
  const upper = new Float64Array(n);
  const lower = new Float64Array(n);
  const stdDev = new Float64Array(n);
  middle.fill(NaN);
  upper.fill(NaN);
  lower.fill(NaN);
  stdDev.fill(NaN);

  if (n < p) return { middle, upper, lower, stdDev };

  for (let i = p - 1; i < n; i++) {
    const start = i - p + 1;
    let sum = 0;
    for (let j = start; j <= i; j++) sum += src[j];
    const mean = sum / p;

    let sumSq = 0;
    for (let j = start; j <= i; j++) {
      const diff = src[j] - mean;
      sumSq += diff * diff;
    }
    const sd = Math.sqrt(sumSq / p);

    middle[i] = mean;
    stdDev[i] = sd;
    upper[i] = mean + m * sd;
    lower[i] = mean - m * sd;
  }

  return { middle, upper, lower, stdDev };
}

/**
 * Average Daily Range % series (per-bar `(h - l) / c * 100` SMA over `period`).
 * Matches index.html `calc` type `"adr"` on full windows.
 * @param {Array<{h:number,l:number,c:number}>} bars
 * @param {number} period
 * @returns {Float64Array}
 */
export function adr(bars, period) {
  const p = assertPeriod(period, "adr");
  if (!Array.isArray(bars)) throw new TypeError("bars must be an array");
  const n = bars.length;
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const h = Number(bars[i].h ?? bars[i].high);
    const l = Number(bars[i].l ?? bars[i].low);
    const c = Number(bars[i].c ?? bars[i].close);
    raw[i] = c > 0 ? ((h - l) / c) * 100 : NaN;
  }
  return sma(raw, p);
}

/**
 * Legacy screener scalar moving average helper (matches index.html `ma()` lines 1301-1306).
 * @param {ArrayLike<number>} closes
 * @param {"SMA"|"EMA"} type
 * @param {number} period
 * @returns {number|null}
 */
export function maLast(closes, type, period) {
  const p = assertPeriod(period, "maLast");
  const src = toFloat64(closes);
  const n = src.length;
  if (n === 0) return null;
  if (String(type).toUpperCase() === "SMA") {
    const start = Math.max(0, n - p);
    const len = n - start;
    let sum = 0;
    for (let i = start; i < n; i++) sum += src[i];
    return sum / len;
  }
  const k = 2 / (p + 1);
  const oneMinusK = 1 - k;
  let e = src[0];
  for (let i = 1; i < n; i++) e = src[i] * k + e * oneMinusK;
  return e;
}

/**
 * Legacy screener candle-change metric (matches index.html `cc()` lines 1295-1298).
 * @param {Array<{h:number,l:number,c:number}>} bars
 * @param {{ n: number, mode?: "abs"|"dir", dir?: "bull"|"bear" }} opts
 * @returns {number|null}
 */
export function ccMetric(bars, opts) {
  if (!Array.isArray(bars) || !bars.length || !opts) return null;
  const n = Math.min(Math.max(1, Math.floor(Number(opts.n) || 1)), 149);
  const last = Number(bars[bars.length - 1].c ?? bars[bars.length - 1].close);
  if (!Number.isFinite(last)) return null;
  if (opts.mode === "abs") {
    const refIdx = bars.length - 1 - n;
    if (refIdx < 0) return null;
    const ref = Number(bars[refIdx].c ?? bars[refIdx].close);
    return Number.isFinite(ref) && ref > 0 ? (Math.abs(last - ref) / ref) * 100 : null;
  }
  const start = Math.max(0, bars.length - n);
  if (opts.dir === "bull") {
    let lo = Infinity;
    for (let i = start; i < bars.length; i++) {
      const l = Number(bars[i].l ?? bars[i].low);
      if (l < lo) lo = l;
    }
    return Number.isFinite(lo) && lo > 0 ? ((last - lo) / lo) * 100 : null;
  }
  let hi = -Infinity;
  for (let i = start; i < bars.length; i++) {
    const h = Number(bars[i].h ?? bars[i].high);
    if (h > hi) hi = h;
  }
  return Number.isFinite(hi) && hi > 0 ? ((hi - last) / hi) * 100 : null;
}

/** Seed a chronological ring buffer from the tail of a Float64Array. */
function seedRing(src, period) {
  const n = src.length;
  const win = new Float64Array(period);
  const take = Math.min(n, period);
  const start = n - take;
  for (let j = 0; j < take; j++) win[j] = src[start + j];
  return { window: win, pos: take === period ? 0 : take };
}

/** Extract optional bar timestamp if present and finite. */
function barTime(bar) {
  if (!bar || typeof bar !== "object") return null;
  const t = Number(bar.t ?? bar.time);
  return Number.isFinite(t) ? t : null;
}

/**
 * Compute a full indicator series on historical bars AND return an incremental state
 * for O(1) / O(period) bar-close updates via `updateIndicator(state, bar)`.
 *
 * @param {Array<object>} bars
 * @param {object} config  e.g. `{ type: "ema", period: 20 }`, `{ type: "bb", period: 20, mult: 2 }`, `{ t: "rsi", len: 14 }`
 */
export function computeIndicator(bars, config) {
  if (!Array.isArray(bars)) throw new TypeError("bars must be an array");
  const cfg = normalizeIndicatorConfig(config);
  const n = bars.length;
  const lastT = n ? barTime(bars[n - 1]) : null;

  if (cfg.type === "ema") {
    const src = extractSource(bars, cfg.source);
    const values = ema(src, cfg.period);
    const lastNum = n ? values[n - 1] : NaN;
    const state = {
      type: "ema",
      period: cfg.period,
      source: cfg.source,
      k: 2 / (cfg.period + 1),
      count: n,
      value: lastNum,
      lastT,
    };
    return {
      type: "ema",
      config: cfg,
      values,
      last: Number.isFinite(lastNum) ? lastNum : null,
      state,
    };
  }

  if (cfg.type === "sma") {
    const src = extractSource(bars, cfg.source);
    const values = sma(src, cfg.period);
    const lastNum = n ? values[n - 1] : NaN;
    const { window, pos } = seedRing(src, cfg.period);
    const state = {
      type: "sma",
      period: cfg.period,
      source: cfg.source,
      window,
      pos,
      count: n,
      value: lastNum,
      lastT,
    };
    return {
      type: "sma",
      config: cfg,
      values,
      last: Number.isFinite(lastNum) ? lastNum : null,
      state,
    };
  }

  if (cfg.type === "atr") {
    const tr = trueRange(bars);
    const values = sma(tr, cfg.period);
    const lastNum = n ? values[n - 1] : NaN;
    const { window, pos } = seedRing(tr, cfg.period);
    const state = {
      type: "atr",
      period: cfg.period,
      source: cfg.source,
      window,
      pos,
      count: n,
      prevClose: n ? Number(bars[n - 1].c ?? bars[n - 1].close) : NaN,
      value: lastNum,
      lastT,
    };
    return {
      type: "atr",
      config: cfg,
      values,
      last: Number.isFinite(lastNum) ? lastNum : null,
      state,
    };
  }

  if (cfg.type === "rsi") {
    const src = extractSource(bars, cfg.source);
    const p = cfg.period;
    const values = new Float64Array(n);
    values.fill(NaN);
    let g = 0;
    let l = 0;
    for (let i = 1; i < n; i++) {
      const d = src[i] - src[i - 1];
      const u = d > 0 ? d : 0;
      const w = d < 0 ? -d : 0;
      if (i <= p) {
        g += u / p;
        l += w / p;
      } else {
        g = (g * (p - 1) + u) / p;
        l = (l * (p - 1) + w) / p;
      }
      if (i >= p) {
        values[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
      }
    }
    const lastNum = n ? values[n - 1] : NaN;
    const state = {
      type: "rsi",
      period: p,
      source: cfg.source,
      count: n,
      prev: n ? src[n - 1] : NaN,
      avgGain: g,
      avgLoss: l,
      value: lastNum,
      lastT,
    };
    return {
      type: "rsi",
      config: cfg,
      values,
      last: Number.isFinite(lastNum) ? lastNum : null,
      state,
    };
  }

  if (cfg.type === "bb") {
    const src = extractSource(bars, cfg.source);
    const { middle, upper, lower, stdDev } = bollinger(src, cfg.period, cfg.mult);
    const hasLast = n >= cfg.period && Number.isFinite(middle[n - 1]);
    const lastObj = hasLast
      ? { middle: middle[n - 1], upper: upper[n - 1], lower: lower[n - 1], stdDev: stdDev[n - 1] }
      : null;
    const { window, pos } = seedRing(src, cfg.period);
    const state = {
      type: "bb",
      period: cfg.period,
      mult: cfg.mult,
      source: cfg.source,
      window,
      pos,
      count: n,
      value: lastObj,
      lastT,
    };
    return {
      type: "bb",
      config: cfg,
      middle,
      upper,
      lower,
      stdDev,
      last: lastObj,
      state,
    };
  }

  if (cfg.type === "vol") {
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const v = Number(bars[i].v ?? bars[i].volume ?? 0);
      values[i] = Number.isFinite(v) ? v : 0;
    }
    const lastNum = n ? values[n - 1] : NaN;
    const state = { type: "vol", period: 1, source: cfg.source, count: n, value: lastNum, lastT };
    return {
      type: "vol",
      config: cfg,
      values,
      last: Number.isFinite(lastNum) ? lastNum : null,
      state,
    };
  }

  // cfg.type === "adr"
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const h = Number(bars[i].h ?? bars[i].high);
    const l = Number(bars[i].l ?? bars[i].low);
    const c = Number(bars[i].c ?? bars[i].close);
    raw[i] = c > 0 ? ((h - l) / c) * 100 : NaN;
  }
  const values = sma(raw, cfg.period);
  const lastNum = n ? values[n - 1] : NaN;
  const { window, pos } = seedRing(raw, cfg.period);
  const state = {
    type: "adr",
    period: cfg.period,
    source: cfg.source,
    window,
    pos,
    count: n,
    value: lastNum,
    lastT,
  };
  return {
    type: "adr",
    config: cfg,
    values,
    last: Number.isFinite(lastNum) ? lastNum : null,
    state,
  };
}

/**
 * Create an initial incremental indicator state (optionally pre-seeded with historical bars).
 * @param {object} config
 * @param {Array<object>} [initialBars=[]]
 */
export function createIndicatorState(config, initialBars = []) {
  return computeIndicator(initialBars, config).state;
}

/**
 * Pure incremental bar-close update for any indicator state returned by
 * `computeIndicator` or `createIndicatorState`. Never mutates `state`.
 *
 * @param {object} state
 * @param {object|number} bar  Closed bar `{ t?, o, h, l, c, v? }` (or number for price-only indicators)
 * @returns {{ state: object, value: number | { middle: number, upper: number, lower: number, stdDev: number } | null, barT: number | null }}
 */
export function updateIndicator(state, bar) {
  if (!state || typeof state !== "object" || !state.type) {
    throw new TypeError("Invalid indicator state");
  }
  const t = barTime(bar);
  const lastT = t !== null ? t : state.lastT;

  if (state.type === "ema") {
    const x = barSourceValue(bar, state.source);
    const k = state.k;
    const nextVal = state.count === 0 ? x : x * k + state.value * (1 - k);
    const nextState = {
      type: "ema",
      period: state.period,
      source: state.source,
      k,
      count: state.count + 1,
      value: nextVal,
      lastT,
    };
    return { state: nextState, value: Number.isFinite(nextVal) ? nextVal : null, barT: t };
  }

  if (state.type === "sma") {
    const p = state.period;
    const x = barSourceValue(bar, state.source);
    const win = new Float64Array(state.window);
    win[state.pos] = x;
    const nextPos = (state.pos + 1) % p;
    const nextCount = state.count + 1;
    let nextVal = NaN;
    if (nextCount >= p) {
      let sum = 0;
      for (let k = 0; k < p; k++) sum += win[(nextPos + k) % p];
      nextVal = sum / p;
    }
    const nextState = {
      type: "sma",
      period: p,
      source: state.source,
      window: win,
      pos: nextPos,
      count: nextCount,
      value: nextVal,
      lastT,
    };
    return { state: nextState, value: Number.isFinite(nextVal) ? nextVal : null, barT: t };
  }

  if (state.type === "atr") {
    const p = state.period;
    const h = Number(bar.h ?? bar.high);
    const l = Number(bar.l ?? bar.low);
    const c = Number(bar.c ?? bar.close);
    const tr = state.count === 0
      ? h - l
      : Math.max(h - l, Math.abs(h - state.prevClose), Math.abs(l - state.prevClose));
    const win = new Float64Array(state.window);
    win[state.pos] = tr;
    const nextPos = (state.pos + 1) % p;
    const nextCount = state.count + 1;
    let nextVal = NaN;
    if (nextCount >= p) {
      let sum = 0;
      for (let k = 0; k < p; k++) sum += win[(nextPos + k) % p];
      nextVal = sum / p;
    }
    const nextState = {
      type: "atr",
      period: p,
      source: state.source,
      window: win,
      pos: nextPos,
      count: nextCount,
      prevClose: c,
      value: nextVal,
      lastT,
    };
    return { state: nextState, value: Number.isFinite(nextVal) ? nextVal : null, barT: t };
  }

  if (state.type === "rsi") {
    const p = state.period;
    const x = barSourceValue(bar, state.source);
    const idx = state.count; // 0-based index of this bar
    let g = state.avgGain;
    let l = state.avgLoss;
    let nextVal = NaN;
    if (idx >= 1) {
      const d = x - state.prev;
      const u = d > 0 ? d : 0;
      const w = d < 0 ? -d : 0;
      if (idx <= p) {
        g += u / p;
        l += w / p;
      } else {
        g = (g * (p - 1) + u) / p;
        l = (l * (p - 1) + w) / p;
      }
      if (idx >= p) {
        nextVal = l === 0 ? 100 : 100 - 100 / (1 + g / l);
      }
    }
    const nextState = {
      type: "rsi",
      period: p,
      source: state.source,
      count: idx + 1,
      prev: x,
      avgGain: g,
      avgLoss: l,
      value: nextVal,
      lastT,
    };
    return { state: nextState, value: Number.isFinite(nextVal) ? nextVal : null, barT: t };
  }

  if (state.type === "bb") {
    const p = state.period;
    const m = state.mult;
    const x = barSourceValue(bar, state.source);
    const win = new Float64Array(state.window);
    win[state.pos] = x;
    const nextPos = (state.pos + 1) % p;
    const nextCount = state.count + 1;
    let nextVal = null;
    if (nextCount >= p) {
      let sum = 0;
      for (let k = 0; k < p; k++) sum += win[(nextPos + k) % p];
      const mean = sum / p;
      let sumSq = 0;
      for (let k = 0; k < p; k++) {
        const diff = win[(nextPos + k) % p] - mean;
        sumSq += diff * diff;
      }
      const sd = Math.sqrt(sumSq / p);
      if (Number.isFinite(mean) && Number.isFinite(sd)) {
        nextVal = { middle: mean, upper: mean + m * sd, lower: mean - m * sd, stdDev: sd };
      }
    }
    const nextState = {
      type: "bb",
      period: p,
      mult: m,
      source: state.source,
      window: win,
      pos: nextPos,
      count: nextCount,
      value: nextVal,
      lastT,
    };
    return { state: nextState, value: nextVal, barT: t };
  }

  if (state.type === "vol") {
    const raw = typeof bar === "number" ? bar : Number(bar.v ?? bar.volume ?? 0);
    const v = Number.isFinite(raw) ? raw : 0;
    const nextState = {
      type: "vol",
      period: 1,
      source: state.source,
      count: state.count + 1,
      value: v,
      lastT,
    };
    return { state: nextState, value: v, barT: t };
  }

  if (state.type === "adr") {
    const p = state.period;
    const h = Number(bar.h ?? bar.high);
    const l = Number(bar.l ?? bar.low);
    const c = Number(bar.c ?? bar.close);
    const pct = c > 0 ? ((h - l) / c) * 100 : NaN;
    const win = new Float64Array(state.window);
    win[state.pos] = pct;
    const nextPos = (state.pos + 1) % p;
    const nextCount = state.count + 1;
    let nextVal = NaN;
    if (nextCount >= p) {
      let sum = 0;
      for (let k = 0; k < p; k++) sum += win[(nextPos + k) % p];
      nextVal = sum / p;
    }
    const nextState = {
      type: "adr",
      period: p,
      source: state.source,
      window: win,
      pos: nextPos,
      count: nextCount,
      value: nextVal,
      lastT,
    };
    return { state: nextState, value: Number.isFinite(nextVal) ? nextVal : null, barT: t };
  }

  throw new RangeError(`Unsupported indicator state type: ${state.type}`);
}

/**
 * Convert a Float64Array indicator series + bars into render-ready `{ t, v }[]` points
 * (skipping warmup NaNs), matching lightweight-charts / wire protocol payload needs.
 * @param {Array<{t:number}>} bars
 * @param {Float64Array} series
 * @returns {Array<{t:number, v:number}>}
 */
export function toChartPoints(bars, series) {
  const n = Math.min(bars.length, series.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = series[i];
    if (Number.isFinite(v)) out.push({ t: bars[i].t, v });
  }
  return out;
}

/**
 * Stateful hub helper for tracking subscribed `(sym, tf, indicatorConfig)` streams.
 * Computes the initial series once on subscribe/seed, then updates incrementally on each bar close
 * and keeps the latest value per bar.
 */
export class IndicatorTracker {
  constructor() {
    // Map<`${sym}|${tf}`, Map<indKey, { config, state, last, lastT }>>
    this._streams = new Map();
  }

  _streamKey(sym, tf) {
    return `${sym}|${tf}`;
  }

  /**
   * Register and initialize an indicator on `(sym, tf)` using historical bars.
   * Returns the full computed result (series + last + key).
   */
  register(sym, tf, config, bars = []) {
    const key = indicatorKey(config);
    const sk = this._streamKey(sym, tf);
    let byInd = this._streams.get(sk);
    if (!byInd) {
      byInd = new Map();
      this._streams.set(sk, byInd);
    }
    const computed = computeIndicator(bars, config);
    byInd.set(key, {
      key,
      config: computed.config,
      state: computed.state,
      last: computed.last,
      lastT: computed.state.lastT,
    });
    return { key, ...computed };
  }

  /** Remove a specific indicator subscription or an entire `(sym, tf)` stream. */
  unregister(sym, tf, config) {
    const sk = this._streamKey(sym, tf);
    if (!config) {
      this._streams.delete(sk);
      return;
    }
    const byInd = this._streams.get(sk);
    if (!byInd) return;
    byInd.delete(indicatorKey(config));
    if (!byInd.size) this._streams.delete(sk);
  }

  /**
   * Incrementally advance all registered indicators for `(sym, tf)` on a closed bar.
   * Ignores duplicate or out-of-order bar timestamps (`bar.t <= entry.lastT`) to prevent double-counting.
   * Returns delta payloads `{ key, type, t, value }[]`.
   */
  onBarClose(sym, tf, bar) {
    const byInd = this._streams.get(this._streamKey(sym, tf));
    if (!byInd || !byInd.size) return [];
    const incomingT = barTime(bar);
    const deltas = [];
    for (const entry of byInd.values()) {
      if (incomingT !== null && entry.lastT !== null && incomingT <= entry.lastT) {
        continue;
      }
      const res = updateIndicator(entry.state, bar);
      entry.state = res.state;
      entry.last = res.value;
      entry.lastT = res.barT !== null ? res.barT : entry.lastT;
      deltas.push({ key: entry.key, type: entry.config.type, t: res.barT, value: res.value });
    }
    return deltas;
  }

  /** Get the latest cached value for a registered `(sym, tf, config)`. */
  getLast(sym, tf, config) {
    const byInd = this._streams.get(this._streamKey(sym, tf));
    if (!byInd) return undefined;
    return byInd.get(indicatorKey(config))?.last;
  }
}

export function createIndicatorTracker() {
  return new IndicatorTracker();
}
