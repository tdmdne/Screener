// shared/market/chartIndicators.js — server-computed indicator series for chart payloads (Tasks 9 and 11).
// Single source of truth for indicator spec parsing and serialization, shared by the vektor-market hub
// (`/api/bootstrap`, `/ws` view frames) and the Pages Function (`/api/candles?ind=`). Pure, zero Node APIs.

import {
  computeIndicator,
  indicatorKey,
  normalizeIndicatorConfig,
  toChartPoints,
  MAX_INDICATOR_PERIOD,
} from "./indicators.js";

/** Smallest permitted indicator period. */
export const MIN_INDICATOR_PERIOD = 1;

/** Maximum indicator specs per chart request (matches protocol `view.chart.ind` cap). */
export const MAX_CHART_INDICATORS = 24;

/** Upper bound on extra history bars fetched only to warm indicators up. */
export const MAX_WARMUP_BARS = 1000;

/**
 * Parse an indicator spec from `view.chart.ind`, `/api/bootstrap?ind=` or `/api/candles?ind=`.
 * Supports strings ("ema:20", "ema20", "bb:20:2", "rsi:14", "vol") and descriptor objects.
 * Enforces `MIN_INDICATOR_PERIOD <= period <= MAX_INDICATOR_PERIOD`.
 * @param {string|object} spec
 * @returns {{ id: string, config: { type: string, period: number, mult: number, source: string } } | null}
 */
export function parseIndicatorSpec(spec) {
  if (!spec) return null;
  const inBounds = (cfg) =>
    Number.isInteger(cfg.period) && cfg.period >= MIN_INDICATOR_PERIOD && cfg.period <= MAX_INDICATOR_PERIOD;
  try {
    if (typeof spec === "string") {
      const s = spec.trim();
      if (!s) return null;
      if (s.toLowerCase() === "vol" || s.toLowerCase() === "volume") {
        const cfg = normalizeIndicatorConfig({ type: "vol" });
        return { id: indicatorKey(cfg), config: cfg };
      }
      const colonParts = s.split(":");
      if (colonParts.length >= 2) {
        const mult = colonParts[2] !== undefined ? Number(colonParts[2]) : undefined;
        const cfg = normalizeIndicatorConfig({ type: colonParts[0], period: Number(colonParts[1]), mult });
        return inBounds(cfg) ? { id: indicatorKey(cfg), config: cfg } : null;
      }
      const m = /^([a-zA-Z]+)(\d+)$/.exec(s);
      if (m) {
        const cfg = normalizeIndicatorConfig({ type: m[1], period: Number(m[2]) });
        return inBounds(cfg) ? { id: s.toLowerCase(), config: cfg } : null;
      }
      const cfg = normalizeIndicatorConfig({ type: s });
      return inBounds(cfg) ? { id: indicatorKey(cfg), config: cfg } : null;
    }
    if (typeof spec === "object") {
      const cfg = normalizeIndicatorConfig(spec);
      if (!inBounds(cfg)) return null;
      const id = typeof spec.id === "string" && spec.id.trim() ? spec.id.trim() : indicatorKey(cfg);
      return { id, config: cfg };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Parse repeated / comma-joined `ind` query values into unique specs.
 * @param {string[]} rawValues  e.g. `url.searchParams.getAll("ind")`
 * @returns {{ ok: true, specs: Array<{id: string, config: object}> } | { ok: false, error: string }}
 */
export function parseIndicatorList(rawValues) {
  const tokens = (Array.isArray(rawValues) ? rawValues : [])
    .flatMap((v) => String(v).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  if (tokens.length > MAX_CHART_INDICATORS) {
    return { ok: false, error: `too many indicators: max ${MAX_CHART_INDICATORS}` };
  }
  const specs = [];
  const seen = new Set();
  for (const token of tokens) {
    const spec = parseIndicatorSpec(token);
    if (!spec) {
      return {
        ok: false,
        error: `invalid indicator spec (period must be ${MIN_INDICATOR_PERIOD}..${MAX_INDICATOR_PERIOD}): ${token.slice(0, 32)}`,
      };
    }
    if (seen.has(spec.id)) continue;
    seen.add(spec.id);
    specs.push(spec);
  }
  return { ok: true, specs };
}

/**
 * Extra bars needed before the first displayed bar so every spec is fully warmed up there.
 * Windowed indicators (SMA/BB/ATR/ADR) need exactly `period`; recursive ones (EMA/RSI) get 4x period,
 * which leaves a residual seed weight of (1 - 2/(p+1))^(4p) ≈ e^-8 (< 0.04%).
 * @param {Array<{config: {type: string, period: number}}>} specs
 * @returns {number}
 */
export function warmupBars(specs) {
  let need = 0;
  for (const { config } of specs || []) {
    if (config.type === "vol") continue;
    const n = config.type === "ema" || config.type === "rsi" ? config.period * 4 : config.period;
    if (n > need) need = n;
  }
  return Math.min(MAX_WARMUP_BARS, need);
}

/**
 * Serialize one computed indicator into the Protocol v2 chart shape (`{t, v}` points, finite values only).
 * @param {Array<{t:number}>} bars
 * @param {object} computed  result of `computeIndicator`
 */
export function serializeIndicatorSeries(bars, computed) {
  if (computed.type === "bb") {
    return {
      type: "bb",
      middle: toChartPoints(bars, computed.middle),
      upper: toChartPoints(bars, computed.upper),
      lower: toChartPoints(bars, computed.lower),
    };
  }
  return { type: computed.type, points: toChartPoints(bars, computed.values) };
}

/**
 * Compute every spec over `bars` (oldest first) and serialize the results keyed by spec id.
 * @param {Array<object>} bars
 * @param {Array<{id: string, config: object}>} specs
 * @returns {Record<string, object>}
 */
export function buildIndicatorSeries(bars, specs) {
  const out = {};
  for (const spec of specs || []) {
    out[spec.id] = serializeIndicatorSeries(bars, computeIndicator(bars, spec.config));
  }
  return out;
}

function dropBefore(points, t0) {
  let i = 0;
  while (i < points.length && points[i].t < t0) i++;
  return i ? points.slice(i) : points;
}

/**
 * Number of newest bars to return from `total` fetched bars when `warm` of them were fetched only for warm-up.
 * The oldest `warm` bars are dropped (the next `before=` page fetches them again, warmed by older bars), unless
 * the history is too short to spare them. The result never exceeds `limit` when one is given.
 * @param {number} total
 * @param {number} warm
 * @param {number} [limit]
 * @returns {number}
 */
export function chartKeepCount(total, warm, limit) {
  const keep = total > warm ? total - warm : total;
  return Number.isInteger(limit) && limit > 0 ? Math.min(keep, limit) : keep;
}

/**
 * Compute indicators over the full (warm-up inclusive) history, then keep only the newest `keep` bars
 * and the indicator points that fall inside them.
 * @param {Array<object>} bars  history oldest first, including warm-up bars
 * @param {Array<{id: string, config: object}>} specs
 * @param {number} keep  number of newest bars to return
 * @returns {{ bars: Array<object>, ind: Record<string, object>, trimmed: boolean }}
 */
export function chartWindowWithIndicators(bars, specs, keep) {
  const all = Array.isArray(bars) ? bars : [];
  const ind = buildIndicatorSeries(all, specs);
  const cut = Number.isInteger(keep) && keep > 0 && all.length > keep ? all.length - keep : 0;
  if (!cut) return { bars: all, ind, trimmed: false };
  const kept = all.slice(cut);
  const t0 = kept[0].t;
  for (const id of Object.keys(ind)) {
    const s = ind[id];
    if (s.type === "bb") {
      s.middle = dropBefore(s.middle, t0);
      s.upper = dropBefore(s.upper, t0);
      s.lower = dropBefore(s.lower, t0);
    } else {
      s.points = dropBefore(s.points, t0);
    }
  }
  return { bars: kept, ind, trimmed: true };
}
