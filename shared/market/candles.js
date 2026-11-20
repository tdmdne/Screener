// shared/market/candles.js — pure server-side candle builder, rollup, and bar merger.
// Deterministic, zero Node APIs, zero synthetic bars, zero artificial clamping (AGENTS.md §0, §3).
// Compatible with Node 22+ and Cloudflare Workers.

import { INTERVAL_SECONDS } from "../intervals.js";
import { normalizeBar, normSymbol } from "../schema.js";

/** Canonical timeframe labels supported by the backend (single source of truth: shared/intervals.js). */
export const TIMEFRAMES = Object.freeze(Object.keys(INTERVAL_SECONDS));

/** Higher timeframes supported by rollup() from 1m bars. */
export const ROLLUP_TIMEFRAMES = Object.freeze(TIMEFRAMES.filter((tf) => tf !== "1m"));

// Case-insensitive / provider aliases that never collide with "1m" (minute) vs "1M" (month).
const TF_ALIASES = Object.freeze({
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

// 1970-01-01 was a Thursday; 1970-01-05 (Monday 00:00:00 UTC) is 4 * 86400 = 345600 seconds after epoch.
const MONDAY_EPOCH_OFFSET_SEC = 345600;
const WEEK_SEC = INTERVAL_SECONDS["1W"]; // 604800

/**
 * Normalize a timeframe label to the canonical key in shared/intervals.js.
 * Preserves "1m" (1 minute) vs "1M" (1 month) without case-folding collision.
 * Returns null if unrecognized.
 * @param {string} tf
 * @returns {string|null}
 */
export function normalizeTf(tf) {
  if (typeof tf !== "string") return null;
  const trimmed = tf.trim();
  if (!trimmed) return null;
  if (Object.prototype.hasOwnProperty.call(INTERVAL_SECONDS, trimmed)) return trimmed;
  if (Object.prototype.hasOwnProperty.call(TF_ALIASES, trimmed)) return TF_ALIASES[trimmed];
  const lower = trimmed.toLowerCase();
  if (lower !== "1m" && Object.prototype.hasOwnProperty.call(TF_ALIASES, lower)) return TF_ALIASES[lower];
  return null;
}

/**
 * Return bar duration in seconds for a timeframe label, or null if unsupported.
 * @param {string} tf
 * @returns {number|null}
 */
export function stepSeconds(tf) {
  const norm = normalizeTf(tf);
  return norm ? INTERVAL_SECONDS[norm] : null;
}

/**
 * Compute the UTC bucket open timestamp (epoch seconds) containing tsSec.
 * - 1m, 5m, 15m, 30m, 1H, 4H, 1D: exact floor alignment to step seconds.
 * - 1W: Monday 00:00:00 UTC.
 * - 1M: 1st of the UTC calendar month 00:00:00 UTC.
 * @param {number} tsSec  Epoch seconds (or epoch ms if >= 1e12).
 * @param {string} [tf="1m"]
 * @returns {number}
 */
export function bucketStart(tsSec, tf = "1m") {
  const norm = normalizeTf(tf);
  if (!norm) throw new RangeError(`Unsupported timeframe: ${tf}`);
  let sec = Number(tsSec);
  if (!Number.isFinite(sec)) throw new RangeError(`Invalid timestamp: ${tsSec}`);
  if (sec >= 1e12) sec = Math.floor(sec / 1000);
  else sec = Math.floor(sec);

  if (norm === "1M") {
    const d = new Date(sec * 1000);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
  }
  if (norm === "1W") {
    return Math.floor((sec - MONDAY_EPOCH_OFFSET_SEC) / WEEK_SEC) * WEEK_SEC + MONDAY_EPOCH_OFFSET_SEC;
  }
  const step = INTERVAL_SECONDS[norm];
  return Math.floor(sec / step) * step;
}

/**
 * Convert a raw timestamp (epoch seconds or ms) to integer epoch seconds, or NaN if invalid.
 * @param {unknown} raw
 * @returns {number}
 */
function toEpochSec(raw) {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return NaN;
  return n >= 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

/**
 * Extract finite positive price from a tick ({ p } or { c } or { price }).
 * @param {object} tick
 * @returns {number}
 */
function extractPrice(tick) {
  const raw = tick.p ?? tick.c ?? tick.price;
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : NaN;
}

/**
 * Extract non-negative volume from a tick (0 when omitted, e.g. Twelve Data FX/crypto WS).
 * @param {object} tick
 * @returns {number}
 */
function extractVolume(tick) {
  const raw = tick.v ?? tick.volume ?? tick.q;
  if (raw === undefined || raw === null) return 0;
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Create an initial immutable candle-builder state.
 * @param {{ tf?: string, current?: {t:number,o:number,h:number,l:number,c:number,v:number}|null }} [opts]
 * @returns {{ tf: string, step: number, current: {t:number,o:number,h:number,l:number,c:number,v:number}|null }}
 */
export function createCandleState(opts = {}) {
  const tf = normalizeTf(opts.tf ?? "1m");
  if (!tf) throw new RangeError(`Unsupported timeframe: ${opts.tf}`);
  const current = opts.current ? normalizeBar(opts.current) : null;
  return { tf, step: INTERVAL_SECONDS[tf], current };
}

/**
 * Pure tick-to-bar reducer (defaults to 1m bars).
 *
 * Accepts ticks in `{ s?, p, t, v? }` or normalized `{ s?, c, t, v? }` shape.
 * - Never mutates `state` or `state.current`.
 * - Ignores invalid ticks and out-of-order ticks (`bucket < current.t`).
 * - Same bucket (`bucket === current.t`): updates `c`, `h = max(h, p)`, `l = min(l, p)`, `v += vol`.
 * - Contiguous advance (`0 < bucket - current.t <= step * 2`): closes `current` and opens the
 *   next bar from `current.c` (matching vtApplyTwelveDataTick semantics, no clamping).
 * - Gap rule (`bucket - current.t > step * 2`): closes `current`, sets `gap: true`, and starts a
 *   fresh bar at `bucket` opening at the incoming tick's price with ZERO synthetic fill bars.
 * - Volume defaults to 0 when absent on the tick (populated later via REST reconciliation).
 *
 * @param {{ tf?: string, step?: number, current?: object|null } | null | undefined} state
 * @param {{ s?: string, p?: number, c?: number, price?: number, t: number, v?: number }} tick
 * @param {{ tf?: string, openMode?: "prevClose" | "tick", ignoreVolume?: boolean }} [opts]
 * @returns {{
 *   state: { tf: string, step: number, current: {t:number,o:number,h:number,l:number,c:number,v:number}|null },
 *   bar: {t:number,o:number,h:number,l:number,c:number,v:number}|null,
 *   closedBar: {t:number,o:number,h:number,l:number,c:number,v:number}|null,
 *   gap: boolean,
 *   ignored: boolean,
 *   reason?: string,
 * }}
 */
export function applyTick(state, tick, opts = {}) {
  const base = state && typeof state === "object" && state.tf
    ? {
        tf: normalizeTf(state.tf) || "1m",
        step: INTERVAL_SECONDS[normalizeTf(state.tf) || "1m"],
        current: state.current || null,
      }
    : createCandleState({ tf: opts.tf ?? "1m" });

  if (!tick || typeof tick !== "object") {
    return { state: base, bar: base.current, closedBar: null, gap: false, ignored: true, reason: "invalid_tick" };
  }

  const price = extractPrice(tick);
  const tsSec = toEpochSec(tick.t ?? tick.timestamp);
  if (!Number.isFinite(price) || !Number.isFinite(tsSec)) {
    return { state: base, bar: base.current, closedBar: null, gap: false, ignored: true, reason: "invalid_tick" };
  }

  const vol = opts.ignoreVolume ? 0 : extractVolume(tick);
  const bucket = bucketStart(tsSec, base.tf);
  const prev = base.current;

  // First bar in state.
  if (!prev) {
    const bar = { t: bucket, o: price, h: price, l: price, c: price, v: vol };
    return {
      state: { tf: base.tf, step: base.step, current: bar },
      bar,
      closedBar: null,
      gap: false,
      ignored: false,
    };
  }

  // Reject out-of-order older packets (matches vtApplyTwelveDataTick & updateLiveBar).
  if (bucket < prev.t) {
    return { state: base, bar: prev, closedBar: null, gap: false, ignored: true, reason: "out_of_order" };
  }

  // Update active bar in the same bucket (no clamping).
  if (bucket === prev.t) {
    const updated = {
      t: prev.t,
      o: prev.o,
      h: Math.max(prev.h, prev.o, price),
      l: Math.min(prev.l, prev.o, price),
      c: price,
      v: (Number.isFinite(prev.v) ? prev.v : 0) + vol,
    };
    return {
      state: { tf: base.tf, step: base.step, current: updated },
      bar: updated,
      closedBar: null,
      gap: false,
      ignored: false,
    };
  }

  // New bucket: previous bar is now closed.
  const closedBar = { t: prev.t, o: prev.o, h: prev.h, l: prev.l, c: prev.c, v: Number.isFinite(prev.v) ? prev.v : 0 };
  const isGap = bucket - prev.t > base.step * 2;

  // Standard real-time WebSocket bar aggregation: initialize each new timeframe bucket with
  // open = high = low = close = tick.price on its first tick (unless caller explicitly asks for prevClose).
  const open = !isGap && opts.openMode === "prevClose" && prev.c > 0 ? prev.c : price;
  const nextBar = {
    t: bucket,
    o: open,
    h: Math.max(open, price),
    l: Math.min(open, price),
    c: price,
    v: vol,
  };

  return {
    state: { tf: base.tf, step: base.step, current: nextBar },
    bar: nextBar,
    closedBar,
    gap: isGap,
    ignored: false,
  };
}

/**
 * Deduplicate and merge two bar arrays deterministically sorted ascending by `t`.
 * - Incoming bars overwrite existing bars with the same `t` (enabling REST volume/OHLC reconciliation).
 * - Drops malformed bars; NEVER clamps valid prices and NEVER inserts synthetic bars.
 * - Optional `opts.maxBars` trims from the oldest end (matching vtMergeBars / DO hot-store cap).
 *
 * @param {Array<object|Array>} oldBars
 * @param {Array<object|Array>} incomingBars
 * @param {{ maxBars?: number }} [opts]
 * @returns {Array<{t:number,o:number,h:number,l:number,c:number,v:number}>}
 */
export function mergeBars(oldBars, incomingBars, opts = {}) {
  const byTime = new Map();

  if (Array.isArray(oldBars)) {
    for (let i = 0; i < oldBars.length; i++) {
      const b = normalizeBar(oldBars[i]);
      if (b) byTime.set(b.t, b);
    }
  }

  if (Array.isArray(incomingBars)) {
    for (let i = 0; i < incomingBars.length; i++) {
      const b = normalizeBar(incomingBars[i]);
      if (b) byTime.set(b.t, b);
    }
  }

  const merged = Array.from(byTime.values()).sort((a, b) => a.t - b.t);
  const maxBars = opts && Number.isInteger(opts.maxBars) && opts.maxBars > 0 ? opts.maxBars : 0;
  return maxBars && merged.length > maxBars ? merged.slice(-maxBars) : merged;
}

/**
 * Aggregate 1m bars into any higher timeframe (5m, 15m, 30m, 1H, 4H, 1D, 1W, 1M) or 1m.
 * - Pure: never mutates input array or bars.
 * - Deduplicates and sorts input bars ascending by `t` before aggregation.
 * - Emits ONLY buckets that contain real input bars (zero synthetic fill).
 *
 * @param {Array<object|Array>} bars1m
 * @param {string} tf
 * @returns {Array<{t:number,o:number,h:number,l:number,c:number,v:number}>}
 */
export function rollup(bars1m, tf) {
  const norm = normalizeTf(tf);
  if (!norm) throw new RangeError(`Unsupported timeframe: ${tf}`);
  const clean = mergeBars([], bars1m);
  if (!clean.length || norm === "1m") return clean;

  const out = [];
  let active = null;

  for (let i = 0; i < clean.length; i++) {
    const b = clean[i];
    const bucket = bucketStart(b.t, norm);
    if (!active || active.t !== bucket) {
      active = { t: bucket, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      out.push(active);
    } else {
      if (b.h > active.h) active.h = b.h;
      if (b.l < active.l) active.l = b.l;
      active.c = b.c;
      active.v += b.v;
    }
  }

  return out;
}

/**
 * Stateful multi-symbol candle orchestrator for MarketHub (Task 2/4).
 * Wires live ticks through `applyTick`, maintains active bars across configured timeframes,
 * and emits bar-close / bar-update events cleanly without platform-specific APIs.
 */
export class CandleBuilder {
  /**
   * @param {{
   *   timeframes?: string[],
   *   openMode?: "prevClose" | "tick",
   *   ignoreVolume?: boolean,
   *   onBarClose?: (event: { type: "bar", sym: string, tf: string, bar: object, closed: true, gap: boolean }) => void,
   *   onBarUpdate?: (event: { type: "bar", sym: string, tf: string, bar: object, closed: false, gap: boolean }) => void,
   * }} [opts]
   */
  constructor(opts = {}) {
    const rawTfs = Array.isArray(opts.timeframes) && opts.timeframes.length ? opts.timeframes : ["1m"];
    const tfSet = new Set();
    for (const raw of rawTfs) {
      const norm = normalizeTf(raw);
      if (!norm) throw new RangeError(`Unsupported timeframe: ${raw}`);
      tfSet.add(norm);
    }
    this.timeframes = Object.freeze(Array.from(tfSet));
    this.openMode = opts.openMode ?? "tick";
    this.ignoreVolume = Boolean(opts.ignoreVolume);
    this.onBarClose = typeof opts.onBarClose === "function" ? opts.onBarClose : null;
    this.onBarUpdate = typeof opts.onBarUpdate === "function" ? opts.onBarUpdate : null;
    // Map<sym, Map<tf, CandleState>>
    this._states = new Map();
  }

  /**
   * Process one incoming tick for a symbol across all configured timeframes.
   * Emits `onBarClose` whenever a bucket closes, and returns all closed/updated bar events.
   * @param {{ s?: string, symbol?: string, p?: number, c?: number, price?: number, t: number, v?: number }} tick
   */
  onTick(tick) {
    if (!tick || typeof tick !== "object") {
      return { sym: "", ignored: true, reason: "invalid_tick", gap: false, closed: [], updated: [] };
    }
    const sym = normSymbol(tick.s ?? tick.symbol);
    if (!sym) {
      return { sym: "", ignored: true, reason: "invalid_symbol", gap: false, closed: [], updated: [] };
    }

    let symStates = this._states.get(sym);
    if (!symStates) {
      symStates = new Map();
      this._states.set(sym, symStates);
    }

    const closed = [];
    const updated = [];
    let anyGap = false;
    let allIgnored = true;
    let lastReason;

    for (let i = 0; i < this.timeframes.length; i++) {
      const tf = this.timeframes[i];
      const prevState = symStates.get(tf) || createCandleState({ tf });
      const res = applyTick(prevState, tick, {
        tf,
        openMode: this.openMode,
        ignoreVolume: this.ignoreVolume,
      });
      symStates.set(tf, res.state);

      if (res.ignored) {
        lastReason = res.reason;
        continue;
      }

      allIgnored = false;
      if (res.gap) anyGap = true;

      if (res.closedBar) {
        const evt = { type: "bar", sym, tf, bar: res.closedBar, closed: true, gap: res.gap };
        closed.push(evt);
        if (this.onBarClose) this.onBarClose(evt);
      }

      if (res.bar) {
        const evt = { type: "bar", sym, tf, bar: res.bar, closed: false, gap: res.gap };
        updated.push(evt);
        if (this.onBarUpdate) this.onBarUpdate(evt);
      }
    }

    return {
      sym,
      ignored: allIgnored,
      reason: allIgnored ? lastReason : undefined,
      gap: anyGap,
      closed,
      updated,
    };
  }

  /**
   * Reconcile historical / REST bars with the currently active bar for (sym, tf).
   * Returns the merged bar series (with REST volume/OHLC winning on matching timestamps)
   * and updates the builder's active bar to the newest bar in the merged series.
   * @param {string} sym
   * @param {string} tf
   * @param {Array<object>} existingBars
   * @param {Array<object>} restBars
   * @param {{ maxBars?: number }} [opts]
   */
  reconcile(sym, tf, existingBars, restBars, opts = {}) {
    const s = normSymbol(sym);
    const norm = normalizeTf(tf);
    if (!s) throw new RangeError("Invalid symbol");
    if (!norm) throw new RangeError(`Unsupported timeframe: ${tf}`);

    const current = this.getCurrent(s, norm);
    const base = current ? mergeBars(existingBars || [], [current]) : (existingBars || []);
    const merged = mergeBars(base, restBars || [], opts);

    if (merged.length) {
      let symStates = this._states.get(s);
      if (!symStates) {
        symStates = new Map();
        this._states.set(s, symStates);
      }
      symStates.set(norm, createCandleState({ tf: norm, current: merged[merged.length - 1] }));
    }
    return merged;
  }

  /** @param {string} sym @param {string} [tf="1m"] */
  getCurrent(sym, tf = "1m") {
    const s = normSymbol(sym);
    const norm = normalizeTf(tf);
    if (!s || !norm) return null;
    return this._states.get(s)?.get(norm)?.current ?? null;
  }

  /** @param {string} sym @param {string} [tf="1m"] */
  getState(sym, tf = "1m") {
    const s = normSymbol(sym);
    const norm = normalizeTf(tf);
    if (!s || !norm) return null;
    const st = this._states.get(s)?.get(norm);
    return st ? { tf: st.tf, step: st.step, current: st.current ? { ...st.current } : null } : null;
  }

  /** @param {string} sym @param {object} state */
  restoreState(sym, state) {
    const s = normSymbol(sym);
    if (!s || !state) return;
    const restored = createCandleState(state);
    let symStates = this._states.get(s);
    if (!symStates) {
      symStates = new Map();
      this._states.set(s, symStates);
    }
    symStates.set(restored.tf, restored);
  }

  /** @param {string} [sym] */
  clear(sym) {
    if (sym === undefined) this._states.clear();
    else this._states.delete(normSymbol(sym));
  }
}

/** Factory helper for MarketHub. */
export function createCandleBuilder(opts = {}) {
  return new CandleBuilder(opts);
}
