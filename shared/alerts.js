// shared/alerts.js — Server-side Price Alert Evaluator (Task 17).
// Pure, Cloudflare Workers & Node 22+ compatible ES module; zero DOM or Node-only dependencies.
// Evaluates price alerts on incoming ticks and closed bars (`above`, `below`, `cross_up`,
// `cross_down`, `cross`, `pct_move`, `pct_up`, `pct_down`), supports `once` vs `recurring`
// with configurable cooldown, tracks previous price per symbol cleanly, and emits validated
// Protocol v2 `alert` frames (shared/protocol.js).

import { createSequencer, makeFrame } from "./protocol.js";

export const ALERT_CONDITIONS = Object.freeze([
  "above",
  "below",
  "cross_up",
  "cross_down",
  "cross",
  "pct_move",
  "pct_up",
  "pct_down",
]);

export const ALERT_MODES = Object.freeze(["once", "recurring"]);
export const DEFAULT_COOLDOWN_MS = 60_000;
export const DEFAULT_MAX_LOG = 500;
/** E-09: at most 5 conditions per alert (the primary one plus 4 extra, all ANDed). */
export const MAX_ALERT_CONDITIONS = 5;
/** E-08: symbols one watchlist alert may cover. */
export const MAX_WATCHLIST_ALERT_SYMBOLS = 100;
/** E-07: how a drawing line extends past its two anchor points. */
export const ALERT_LINE_EXTENDS = Object.freeze(["seg", "ray", "line"]);
const LINE_CONDITIONS = new Set(["above", "below", "cross", "cross_up", "cross_down"]);

const MAX_ID_CHARS = 64;
const MAX_ID_UTF8_BYTES = 128;
const MAX_COND_CHARS = 128;
const MAX_COND_UTF8_BYTES = 256;
const MAX_MSG_CHARS = 256;
const MAX_MSG_UTF8_BYTES = 512;

const SYMBOL_RE = /^[A-Z0-9.=^/-]{1,24}$/i;
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F]+/g;
const textEncoder = new TextEncoder();

const CONDITION_ALIASES = Object.freeze(
  Object.assign(Object.create(null), {
    above: "above",
    gte: "above",
    ">=": "above",
    below: "below",
    lte: "below",
    "<=": "below",
    cross_up: "cross_up",
    crossup: "cross_up",
    "cross up": "cross_up",
    crossing_up: "cross_up",
    "crossing up": "cross_up",
    cross_down: "cross_down",
    crossdown: "cross_down",
    "cross down": "cross_down",
    crossing_down: "cross_down",
    "crossing down": "cross_down",
    cross: "cross",
    crossing: "cross",
    pct_move: "pct_move",
    pctmove: "pct_move",
    "% move": "pct_move",
    "%_move": "pct_move",
    percent_move: "pct_move",
    "percent move": "pct_move",
    pct: "pct_move",
    pct_up: "pct_up",
    pctup: "pct_up",
    "% up": "pct_up",
    pct_down: "pct_down",
    pctdown: "pct_down",
    "% down": "pct_down",
  })
);

const isPosFinite = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
const isNonNegFinite = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * E-07: price of a drawing line (two time/price anchors, unix seconds) at time `tSec`, or null outside its extent.
 * @param {{t1:number,p1:number,t2:number,p2:number,ext:string}} line
 * @param {number} tSec
 * @returns {number|null}
 */
export function lineValueAt(line, tSec) {
  if (!line || !Number.isFinite(tSec)) return null;
  const { t1, p1, t2, p2, ext } = line;
  if (t1 === t2) return null;
  if (ext === "seg" && (tSec < Math.min(t1, t2) || tSec > Math.max(t1, t2))) return null;
  if (ext === "ray" && (t2 > t1 ? tSec < t1 : tSec > t1)) return null;
  const v = p1 + ((p2 - p1) * (tSec - t1)) / (t2 - t1);
  return isPosFinite(v) ? v : null;
}

function normalizeAlertLine(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("Alert line must be an object");
  const t1 = toFiniteNumber(raw.t1);
  const t2 = toFiniteNumber(raw.t2);
  const p1 = toFiniteNumber(raw.p1);
  const p2 = toFiniteNumber(raw.p2);
  if (!isPosFinite(t1) || !isPosFinite(t2) || t1 === t2) throw new Error("Alert line needs two distinct positive times (t1, t2)");
  // anchors are unix seconds (drawings store bar times in seconds); reject milliseconds to avoid a silent 1000x slope
  if (t1 > 1e11 || t2 > 1e11) throw new Error("Alert line times must be unix seconds");
  if (!isPosFinite(p1) || !isPosFinite(p2)) throw new Error("Alert line prices (p1, p2) must be positive finite numbers");
  const ext = raw.ext === undefined ? "seg" : String(raw.ext);
  if (!ALERT_LINE_EXTENDS.includes(ext)) throw new Error(`Alert line ext must be one of ${ALERT_LINE_EXTENDS.join(", ")}`);
  return { t1, p1, t2, p2, ext };
}

function normalizeExtraConditions(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("Alert conds must be an array");
  if (raw.length > MAX_ALERT_CONDITIONS - 1) throw new Error(`An alert can have at most ${MAX_ALERT_CONDITIONS} conditions`);
  return raw.map((c, i) => {
    if (!c || typeof c !== "object" || Array.isArray(c)) throw new Error(`Alert conds[${i}] must be an object`);
    const condition = normalizeCondition(c.condition ?? c.dir);
    if (!condition) throw new Error(`Unsupported alert condition in conds[${i}]`);
    const target = toFiniteNumber(c.target ?? c.price ?? c.pct);
    if (!isPosFinite(target)) throw new Error(`Alert conds[${i}].target must be a positive finite number`);
    const r = toFiniteNumber(c.refPrice);
    return { condition, target, refPrice: isPosFinite(r) ? r : null };
  });
}

/**
 * Strict numeric coercion that rejects booleans, empty/whitespace strings, null, undefined, objects, and symbols.
 * @param {unknown} v
 * @returns {number}
 */
function toFiniteNumber(v) {
  if (typeof v === "boolean" || v === null || v === undefined) return NaN;
  if (typeof v === "string" && v.trim() === "") return NaN;
  if (typeof v === "object" || typeof v === "symbol") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Strip ASCII/C1 control characters and enforce both UTF-16 char length and UTF-8 byte caps
 * without splitting surrogate pairs.
 * @param {unknown} raw
 * @param {number} maxChars
 * @param {number} maxBytes
 * @returns {string}
 */
function sanitizeAlertText(raw, maxChars, maxBytes) {
  if (typeof raw !== "string") return "";
  const cleaned = raw.replace(CONTROL_CHARS_RE, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const charCapped = cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned;
  if (textEncoder.encode(charCapped).byteLength <= maxBytes) return charCapped;

  let out = "";
  let used = 0;
  for (const cp of Array.from(charCapped)) {
    const b = textEncoder.encode(cp).byteLength;
    if (used + b > maxBytes) break;
    out += cp;
    used += b;
  }
  return out.trim();
}

/**
 * Normalize a symbol string for alert matching while preserving Protocol v2 characters
 * (e.g. BTCUSDT, EURUSD, NQ=F, ^GSPC, BRK.B, EUR/USD).
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeAlertSymbol(raw) {
  if (typeof raw !== "string") return "";
  const s = raw.trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : "";
}

/**
 * Normalize an alert condition name or alias.
 * Uses a null-prototype lookup table with `Object.hasOwn` so prototype keys never resolve.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeCondition(raw) {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return Object.hasOwn(CONDITION_ALIASES, key) ? CONDITION_ALIASES[key] : null;
}

/**
 * Normalize epoch timestamp (seconds or milliseconds) to epoch milliseconds.
 * Rejects booleans, empty strings, and non-positive values; falls back to `fallbackMs`.
 * @param {unknown} raw
 * @param {number} fallbackMs
 * @returns {number}
 */
function normalizeEpochMs(raw, fallbackMs) {
  const n = toFiniteNumber(raw);
  if (!isPosFinite(n)) return fallbackMs;
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

/**
 * Normalize a raw bar object or 6-tuple `[t, o, h, l, c, v?]` into `{ t, o, h, l, c, v }`.
 * Returns `null` if invalid, non-positive OHLC, or corrupted (`h < max(o, c)` or `l > min(o, c)`).
 * Never clamps or fabricates OHLC values (AGENTS.md §3).
 * @param {unknown} raw
 * @returns {{ t: number | null, o: number, h: number, l: number, c: number, v: number } | null}
 */
export function normalizeAlertBar(raw) {
  if (!raw || typeof raw !== "object") return null;
  let t, o, h, l, c, v, hasVol;
  if (Array.isArray(raw)) {
    if (raw.length < 5) return null;
    t = toFiniteNumber(raw[0]);
    o = toFiniteNumber(raw[1]);
    h = toFiniteNumber(raw[2]);
    l = toFiniteNumber(raw[3]);
    c = toFiniteNumber(raw[4]);
    hasVol = raw[5] !== undefined && raw[5] !== null;
    v = hasVol ? toFiniteNumber(raw[5]) : 0;
  } else {
    t = raw.t !== undefined ? toFiniteNumber(raw.t) : raw.time !== undefined ? toFiniteNumber(raw.time) : NaN;
    o = toFiniteNumber(raw.o ?? raw.open);
    h = toFiniteNumber(raw.h ?? raw.high);
    l = toFiniteNumber(raw.l ?? raw.low);
    c = toFiniteNumber(raw.c ?? raw.close);
    const rawV = raw.v !== undefined ? raw.v : raw.volume;
    hasVol = rawV !== undefined && rawV !== null;
    v = hasVol ? toFiniteNumber(rawV) : 0;
  }
  if (!isPosFinite(o) || !isPosFinite(h) || !isPosFinite(l) || !isPosFinite(c)) return null;
  if (h < Math.max(o, c) || l > Math.min(o, c)) return null;
  if (hasVol && !isNonNegFinite(v)) return null;

  return {
    t: isPosFinite(t) ? t : null,
    o,
    h,
    l,
    c,
    v: isNonNegFinite(v) ? v : 0,
  };
}

/**
 * Validate and normalize an alert definition (supports both server schema and legacy `index.html` alerts).
 * Throws an Error if required fields (`id`, `sym`, `condition`, `target`) or numeric options are invalid.
 *
 * @param {object} input
 * @param {number} [nowMs=Date.now()]
 * @returns {object}
 */
export function normalizeAlert(input, nowMs = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Alert definition must be an object");
  }

  const rawIdInput = input.id !== undefined && input.id !== null ? String(input.id) : "";
  const rawId = sanitizeAlertText(rawIdInput, MAX_ID_CHARS, MAX_ID_UTF8_BYTES);
  if (!rawId || rawIdInput.trim().length > MAX_ID_CHARS) {
    throw new Error("Alert id must be a non-empty string <= 64 chars");
  }

  const sym = normalizeAlertSymbol(input.sym ?? input.symbol);
  if (!sym) {
    throw new Error(`Alert symbol is invalid: ${String(input.sym ?? input.symbol ?? "")}`);
  }

  const condition = normalizeCondition(input.condition ?? input.dir);
  if (!condition) {
    throw new Error(`Unsupported alert condition: ${String(input.condition ?? input.dir ?? "")}`);
  }

  const line = normalizeAlertLine(input.line);
  if (line && !LINE_CONDITIONS.has(condition)) {
    throw new Error(`Drawing-line alerts support above, below, cross, cross_up and cross_down (got ${condition})`);
  }
  // a line alert's target moves with time; the stored target is the first anchor price (used for labels only)
  const target = line ? line.p1 : toFiniteNumber(input.target ?? input.price ?? input.threshold ?? input.pct);
  if (!isPosFinite(target)) {
    throw new Error("Alert target must be a positive finite number");
  }
  const conds = normalizeExtraConditions(input.conds);

  let mode = "once";
  if (typeof input.mode === "string") {
    const m = input.mode.trim().toLowerCase();
    if (m === "recurring" || m === "repeat") mode = "recurring";
    else if (m === "once") mode = "once";
    else throw new Error(`Unsupported alert mode: ${input.mode}`);
  } else if (input.recurring === true || input.once === false) {
    mode = "recurring";
  }

  const defaultCooldown = mode === "recurring" ? DEFAULT_COOLDOWN_MS : 0;
  const rawCooldown = input.cooldownMs;
  let cooldownMs;
  if (
    rawCooldown === undefined ||
    rawCooldown === null ||
    (typeof rawCooldown === "string" && rawCooldown.trim() === "")
  ) {
    cooldownMs = defaultCooldown;
  } else {
    cooldownMs = toFiniteNumber(rawCooldown);
    if (!isNonNegFinite(cooldownMs)) {
      throw new Error("Alert cooldownMs must be a non-negative finite number");
    }
  }

  let refPrice = null;
  const rawRef = input.refPrice ?? input.basePrice ?? input.anchorPrice;
  if (rawRef !== undefined && rawRef !== null && !(typeof rawRef === "string" && rawRef.trim() === "")) {
    const r = toFiniteNumber(rawRef);
    if (!isPosFinite(r)) {
      throw new Error("Alert refPrice must be a positive finite number");
    }
    refPrice = r;
  }

  const fired = Boolean(input.fired);
  const enabled = input.enabled !== undefined ? Boolean(input.enabled) : input.on !== undefined ? Boolean(input.on) : true;
  const armed = input.armed !== undefined ? Boolean(input.armed) : enabled && (mode === "recurring" || !fired);

  const rawMsg = input.message ?? input.msg;
  const sanitizedMsg = typeof rawMsg === "string" ? sanitizeAlertText(rawMsg, MAX_MSG_CHARS, MAX_MSG_UTF8_BYTES) : "";
  const message = sanitizedMsg.length > 0 ? sanitizedMsg : undefined;

  const createdAt = normalizeEpochMs(input.createdAt, nowMs);

  let lastTriggeredAt = null;
  const rawLastTrig = input.lastTriggeredAt;
  if (
    rawLastTrig !== undefined &&
    rawLastTrig !== null &&
    !(typeof rawLastTrig === "string" && rawLastTrig.trim() === "") &&
    rawLastTrig !== 0 &&
    !(typeof rawLastTrig === "string" && rawLastTrig.trim() === "0")
  ) {
    const parsedLast = toFiniteNumber(rawLastTrig);
    if (!isPosFinite(parsedLast)) {
      throw new Error("Alert lastTriggeredAt must be a positive finite timestamp");
    }
    lastTriggeredAt = parsedLast < 1e12 ? Math.round(parsedLast * 1000) : Math.round(parsedLast);
  }

  const parsedLastPrice = toFiniteNumber(input.lastTriggerPrice);
  const lastTriggerPrice = isPosFinite(parsedLastPrice) ? parsedLastPrice : null;

  return {
    id: rawId,
    sym,
    condition,
    target,
    mode,
    cooldownMs,
    refPrice,
    resetRefOnTrigger: Boolean(input.resetRefOnTrigger),
    onBarClose: Boolean(input.onBarClose),
    armed,
    on: armed,
    fired,
    triggerCount: Number.isSafeInteger(input.triggerCount) && input.triggerCount >= 0 ? input.triggerCount : 0,
    lastTriggeredAt,
    lastTriggerPrice,
    createdAt,
    ...(message !== undefined ? { message } : {}),
    ...(input.userId !== undefined && input.userId !== null ? { userId: String(input.userId) } : {}),
    ...(line ? { line } : {}),
    ...(conds.length ? { conds } : {}),
    ...(input.parentId !== undefined && input.parentId !== null ? { parentId: String(input.parentId).slice(0, MAX_ID_CHARS) } : {}),
  };
}

/**
 * E-08: expand a watchlist alert ({ id, syms: [...], ...condition }) into one child definition per symbol
 * (id `<id>~<SYM>`, parentId = id). A plain alert (no `syms`) comes back as a one-element list, unchanged.
 * @param {object} def
 * @returns {object[]}
 */
export function expandAlertDefinition(def) {
  if (!def || typeof def !== "object" || !Array.isArray(def.syms)) return [def];
  if (def.syms.length === 0) throw new Error("Watchlist alert needs at least one symbol");
  if (def.syms.length > MAX_WATCHLIST_ALERT_SYMBOLS) {
    throw new Error(`A watchlist alert covers at most ${MAX_WATCHLIST_ALERT_SYMBOLS} symbols`);
  }
  if (def.line) throw new Error("A watchlist alert cannot use a drawing line");
  const parentId = String(def.id ?? "");
  const { syms, ...rest } = def;
  const seen = new Set();
  const out = [];
  for (const raw of syms) {
    const sym = normalizeAlertSymbol(raw);
    if (!sym) throw new Error(`Watchlist alert symbol is invalid: ${String(raw)}`);
    if (seen.has(sym)) continue;
    seen.add(sym);
    out.push({ ...rest, id: `${parentId}~${sym}`, sym, parentId });
  }
  return out;
}

/**
 * Format a canonical condition label (`<= 128` chars, control-char sanitized) for Protocol v2 `alert.condition`.
 * @param {object} alert
 * @returns {string}
 */
export function formatAlertCondition(alert) {
  const t = alert.target;
  let text;
  switch (alert.condition) {
    case "above":
      text = `price >= ${t}`;
      break;
    case "below":
      text = `price <= ${t}`;
      break;
    case "cross_up":
      text = `cross_up ${t}`;
      break;
    case "cross_down":
      text = `cross_down ${t}`;
      break;
    case "cross":
      text = `cross ${t}`;
      break;
    case "pct_move":
      text = alert.refPrice != null ? `pct_move >= ${t}% (ref ${alert.refPrice})` : `pct_move >= ${t}%`;
      break;
    case "pct_up":
      text = alert.refPrice != null ? `pct_up >= ${t}% (ref ${alert.refPrice})` : `pct_up >= ${t}%`;
      break;
    case "pct_down":
      text = alert.refPrice != null ? `pct_down >= ${t}% (ref ${alert.refPrice})` : `pct_down >= ${t}%`;
      break;
    default:
      text = `${alert.condition} ${t}`;
  }
  if (alert.line) text += " (drawing line)";
  if (Array.isArray(alert.conds) && alert.conds.length) {
    text += " AND " + alert.conds.map((c) => `${c.condition} ${c.target}${/^pct/.test(c.condition) ? "%" : ""}`).join(" AND ");
  }
  return sanitizeAlertText(text, MAX_COND_CHARS, MAX_COND_UTF8_BYTES);
}

/**
 * Format a human-readable alert notification message (`<= 256` chars, UTF-8 & control-char sanitized).
 * Uses custom `alert.message` when set.
 * @param {object} alert
 * @param {number} triggerPrice
 * @returns {string}
 */
export function formatAlertMessage(alert, triggerPrice) {
  if (typeof alert.message === "string") {
    const custom = sanitizeAlertText(alert.message, MAX_MSG_CHARS, MAX_MSG_UTF8_BYTES);
    if (custom.length > 0) return custom;
  }
  let desc;
  switch (alert.condition) {
    case "above":
      desc = `${alert.sym} reached >= ${alert.target} (${triggerPrice})`;
      break;
    case "below":
      desc = `${alert.sym} reached <= ${alert.target} (${triggerPrice})`;
      break;
    case "cross_up":
      desc = `${alert.sym} crossed up ${alert.target} (${triggerPrice})`;
      break;
    case "cross_down":
      desc = `${alert.sym} crossed down ${alert.target} (${triggerPrice})`;
      break;
    case "cross":
      desc = `${alert.sym} crossed ${alert.target} (${triggerPrice})`;
      break;
    case "pct_move":
    case "pct_up":
    case "pct_down": {
      const ref = alert.refPrice;
      const pct = ref ? (((triggerPrice - ref) / ref) * 100).toFixed(2) : String(alert.target);
      const sign = Number(pct) > 0 ? "+" : "";
      desc = `${alert.sym} moved ${sign}${pct}% vs ${ref ?? "ref"} (target ${alert.target}%, price ${triggerPrice})`;
      break;
    }
    default:
      desc = `${alert.sym} alert triggered at ${triggerPrice}`;
  }
  return sanitizeAlertText(desc, MAX_MSG_CHARS, MAX_MSG_UTF8_BYTES);
}

/**
 * Pure stateless evaluation of a single alert against either a tick or a closed bar.
 *
 * @param {object} alert — normalized alert
 * @param {{ type: "tick", price: number } | { type: "bar", o: number, h: number, l: number, c: number }} sample
 * @param {number | undefined} prevPrice — previous observed price for `alert.sym`
 * @returns {{ matched: boolean, triggerPrice: number | null, movePct?: number }}
 */
export function evaluateAlertCondition(alert, sample, prevPrice) {
  if (!alert || typeof alert !== "object" || !sample || typeof sample !== "object") {
    return { matched: false, triggerPrice: null };
  }
  const target = alert.target;
  if (!isPosFinite(target)) {
    return { matched: false, triggerPrice: null };
  }
  const hasPrev = isPosFinite(prevPrice);

  if (sample.type === "tick") {
    const px = sample.price;
    if (!isPosFinite(px)) return { matched: false, triggerPrice: null };

    switch (alert.condition) {
      case "above":
        return px >= target ? { matched: true, triggerPrice: px } : { matched: false, triggerPrice: null };

      case "below":
        return px <= target ? { matched: true, triggerPrice: px } : { matched: false, triggerPrice: null };

      case "cross_up":
        return hasPrev && prevPrice < target && px >= target
          ? { matched: true, triggerPrice: px }
          : { matched: false, triggerPrice: null };

      case "cross_down":
        return hasPrev && prevPrice > target && px <= target
          ? { matched: true, triggerPrice: px }
          : { matched: false, triggerPrice: null };

      case "cross": {
        const up = hasPrev && prevPrice < target && px >= target;
        const dn = hasPrev && prevPrice > target && px <= target;
        return up || dn ? { matched: true, triggerPrice: px } : { matched: false, triggerPrice: null };
      }

      case "pct_move":
      case "pct_up":
      case "pct_down": {
        const ref = alert.refPrice;
        if (!isPosFinite(ref)) return { matched: false, triggerPrice: null };
        const signedPct = ((px - ref) / ref) * 100;
        const absPct = Math.abs(signedPct);
        const hit =
          alert.condition === "pct_up"
            ? signedPct >= target
            : alert.condition === "pct_down"
              ? -signedPct >= target
              : absPct >= target;
        return hit
          ? { matched: true, triggerPrice: px, movePct: signedPct }
          : { matched: false, triggerPrice: null };
      }

      default:
        return { matched: false, triggerPrice: null };
    }
  }

  if (sample.type === "bar") {
    const { o, h, l, c } = sample;
    if (!isPosFinite(o) || !isPosFinite(h) || !isPosFinite(l) || !isPosFinite(c)) {
      return { matched: false, triggerPrice: null };
    }
    if (h < Math.max(o, c) || l > Math.min(o, c)) {
      return { matched: false, triggerPrice: null };
    }

    switch (alert.condition) {
      case "above":
        return h >= target || c >= target
          ? { matched: true, triggerPrice: c >= target ? c : h }
          : { matched: false, triggerPrice: null };

      case "below":
        return l <= target || c <= target
          ? { matched: true, triggerPrice: c <= target ? c : l }
          : { matched: false, triggerPrice: null };

      case "cross_up": {
        const viaPrev = hasPrev && prevPrice < target && (o >= target || h >= target || c >= target);
        const intrabar = o < target && h >= target;
        if (viaPrev || intrabar) {
          return { matched: true, triggerPrice: c >= target ? c : h };
        }
        return { matched: false, triggerPrice: null };
      }

      case "cross_down": {
        const viaPrev = hasPrev && prevPrice > target && (o <= target || l <= target || c <= target);
        const intrabar = o > target && l <= target;
        if (viaPrev || intrabar) {
          return { matched: true, triggerPrice: c <= target ? c : l };
        }
        return { matched: false, triggerPrice: null };
      }

      case "cross": {
        const up = (hasPrev && prevPrice < target && (o >= target || h >= target || c >= target)) || (o < target && h >= target);
        const dn = (hasPrev && prevPrice > target && (o <= target || l <= target || c <= target)) || (o > target && l <= target);
        if (up) return { matched: true, triggerPrice: c >= target ? c : h };
        if (dn) return { matched: true, triggerPrice: c <= target ? c : l };
        return { matched: false, triggerPrice: null };
      }

      case "pct_move":
      case "pct_up":
      case "pct_down": {
        const ref = alert.refPrice;
        if (!isPosFinite(ref)) return { matched: false, triggerPrice: null };
        const upPct = ((h - ref) / ref) * 100;
        const dnPct = ((ref - l) / ref) * 100;
        const closePct = ((c - ref) / ref) * 100;

        if (alert.condition === "pct_up") {
          if (upPct >= target || closePct >= target) {
            const px = closePct >= target ? c : h;
            return { matched: true, triggerPrice: px, movePct: ((px - ref) / ref) * 100 };
          }
          return { matched: false, triggerPrice: null };
        }
        if (alert.condition === "pct_down") {
          if (dnPct >= target || -closePct >= target) {
            const px = -closePct >= target ? c : l;
            return { matched: true, triggerPrice: px, movePct: ((px - ref) / ref) * 100 };
          }
          return { matched: false, triggerPrice: null };
        }

        const absClose = Math.abs(closePct);
        const absHigh = Math.abs(((h - ref) / ref) * 100);
        const absLow = Math.abs(((l - ref) / ref) * 100);
        if (Math.max(absClose, absHigh, absLow) >= target) {
          let px = c;
          if (absClose < target) {
            px = absHigh >= absLow ? h : l;
          }
          return { matched: true, triggerPrice: px, movePct: ((px - ref) / ref) * 100 };
        }
        return { matched: false, triggerPrice: null };
      }

      default:
        return { matched: false, triggerPrice: null };
    }
  }

  return { matched: false, triggerPrice: null };
}

/**
 * Construct and validate a Protocol v2 `alert` frame via `shared/protocol.js`.
 * Sanitizes control characters and enforces UTF-8 byte caps on `id`, `condition`, and `message`.
 * @param {{ id: string, sym: string, condition: string, price: number, triggeredAt: number, message?: string }} trigger
 * @param {number} seq
 * @returns {object}
 */
export function buildAlertFrame(trigger, seq) {
  const payload = {
    id: sanitizeAlertText(String(trigger.id ?? ""), MAX_ID_CHARS, MAX_ID_UTF8_BYTES),
    sym: normalizeAlertSymbol(trigger.sym),
    condition: sanitizeAlertText(String(trigger.condition ?? ""), MAX_COND_CHARS, MAX_COND_UTF8_BYTES),
    price: toFiniteNumber(trigger.price),
    triggeredAt: toFiniteNumber(trigger.triggeredAt),
  };
  if (typeof trigger.message === "string") {
    const cleanMsg = sanitizeAlertText(trigger.message, MAX_MSG_CHARS, MAX_MSG_UTF8_BYTES);
    if (cleanMsg.length > 0) {
      payload.message = cleanMsg;
    }
  }
  return makeFrame("alert", payload, seq);
}

/**
 * Create a stateful server-side alert evaluator suitable for `MarketHub` DO or worker execution.
 *
 * @param {{
 *   alerts?: Array<object>,
 *   prevPrices?: Record<string, number> | Map<string, number>,
 *   now?: () => number,
 *   nextSeq?: () => number,
 *   sequencer?: { next: () => number },
 *   maxLog?: number,
 * }} [opts]
 */
export function createAlertEvaluator(opts = {}) {
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  const nextSeq =
    typeof opts.nextSeq === "function"
      ? opts.nextSeq
      : opts.sequencer && typeof opts.sequencer.next === "function"
        ? () => opts.sequencer.next()
        : (() => {
            const s = createSequencer(0);
            return () => s.next();
          })();
  const maxLog = Number.isSafeInteger(opts.maxLog) && opts.maxLog >= 1 ? opts.maxLog : DEFAULT_MAX_LOG;

  /** @type {Map<string, object>} */
  const alerts = new Map();
  /** @type {Map<string, Map<string, object>>} */
  const alertsBySym = new Map();
  /** @type {Map<string, number>} */
  const prevPrices = new Map();
  /** @type {Array<object>} */
  const log = [];

  function isPctCondition(cond) {
    return cond === "pct_move" || cond === "pct_up" || cond === "pct_down";
  }

  function unlinkAlert(existing) {
    const bucket = alertsBySym.get(existing.sym);
    if (bucket) {
      bucket.delete(existing.id);
      if (bucket.size === 0) {
        alertsBySym.delete(existing.sym);
        prevPrices.delete(existing.sym);
      }
    }
  }

  function addAlert(def) {
    if (def && typeof def === "object" && Array.isArray(def.syms)) {
      const parentId = String(def.id ?? "");
      const kids = expandAlertDefinition(def).map((d) => normalizeAlert(d, now())); // validate all before mutating
      removeAlert(parentId);
      for (const k of kids) addOne(k);
      return { id: parentId, syms: kids.map((k) => k.sym), children: kids.length };
    }
    return addOne(normalizeAlert(def, now()));
  }

  function addOne(a) {
    const prev = alerts.get(a.id);
    if (prev) {
      unlinkAlert(prev);
    }

    let bucket = alertsBySym.get(a.sym);
    if (!bucket) {
      bucket = new Map();
      alertsBySym.set(a.sym, bucket);
    }
    bucket.set(a.id, a);
    alerts.set(a.id, a);

    if (isPctCondition(a.condition) && a.refPrice == null && prevPrices.has(a.sym)) {
      a.refPrice = prevPrices.get(a.sym);
    }
    return { ...a };
  }

  function seedPrevPrices(rawPrev) {
    const entries =
      rawPrev instanceof Map
        ? rawPrev.entries()
        : rawPrev && typeof rawPrev === "object"
          ? Object.entries(rawPrev)
          : [];
    for (const [k, v] of entries) {
      const sym = normalizeAlertSymbol(k);
      const px = toFiniteNumber(v);
      if (sym && isPosFinite(px) && alertsBySym.has(sym)) {
        prevPrices.set(sym, px);
        const bucket = alertsBySym.get(sym);
        if (bucket) {
          for (const a of bucket.values()) {
            if (isPctCondition(a.condition) && a.refPrice == null) {
              a.refPrice = px;
            }
          }
        }
      }
    }
  }

  // Register alerts first so prevPrices only tracks symbols with registered alerts.
  if (Array.isArray(opts.alerts)) {
    for (const a of opts.alerts) addAlert(a);
  }
  if (opts.prevPrices) {
    seedPrevPrices(opts.prevPrices);
  }

  function removeAlert(id) {
    const key = String(id);
    let removed = false;
    // a watchlist alert id removes every per-symbol child
    for (const [cid, a] of [...alerts.entries()]) {
      if (a.parentId === key) {
        alerts.delete(cid);
        unlinkAlert(a);
        removed = true;
      }
    }
    const existing = alerts.get(key);
    if (!existing) return removed;
    alerts.delete(key);
    unlinkAlert(existing);
    return true;
  }

  function getAlert(id) {
    const a = alerts.get(String(id));
    return a ? { ...a } : null;
  }

  function listAlerts(filter = {}) {
    const symFilter = filter.sym ? normalizeAlertSymbol(filter.sym) : null;
    const source = symFilter ? alertsBySym.get(symFilter)?.values() || [] : alerts.values();
    const out = [];
    for (const a of source) {
      if (filter.armed !== undefined && a.armed !== Boolean(filter.armed)) continue;
      if (filter.userId !== undefined && a.userId !== String(filter.userId)) continue;
      out.push({ ...a });
    }
    return out;
  }

  function rearmAlert(id, rearmOpts = {}) {
    const a = alerts.get(String(id));
    if (!a) return null;
    a.fired = false;
    a.armed = true;
    a.on = true;
    a.lastTriggeredAt = null;
    if (rearmOpts.refPrice !== undefined) {
      const parsedRef = toFiniteNumber(rearmOpts.refPrice);
      if (isPosFinite(parsedRef)) {
        a.refPrice = parsedRef;
      }
    }
    if (rearmOpts.resetPrev) {
      prevPrices.delete(a.sym);
    }
    return { ...a };
  }

  function setPrevPrice(sym, price) {
    const s = normalizeAlertSymbol(sym);
    const p = toFiniteNumber(price);
    if (!s || !isPosFinite(p) || !alertsBySym.has(s)) return false;
    prevPrices.set(s, p);
    return true;
  }

  function getPrevPrice(sym) {
    const s = normalizeAlertSymbol(sym);
    return s && prevPrices.has(s) ? prevPrices.get(s) : undefined;
  }

  function runEvaluation(sym, sample, evalTs, nextPrevPrice) {
    const bucket = alertsBySym.get(sym);
    if (!bucket || bucket.size === 0) {
      return { triggers: [], frames: [] };
    }

    const prev = prevPrices.get(sym);
    const triggers = [];
    const frames = [];

    for (const a of bucket.values()) {
      if (!a.armed || !a.on) continue;
      if (a.mode === "once" && a.fired) continue;
      if (sample.type === "tick" && a.onBarClose) continue;

      // Enforce recurring cooldown window cleanly (strictly < cooldownMs suppresses).
      if (a.mode === "recurring" && a.lastTriggeredAt != null && evalTs - a.lastTriggeredAt < a.cooldownMs) {
        continue;
      }

      // Evaluate with candidate lazy refPrice without mutating `a` yet.
      let seedRef = null;
      let evalAlert = a;
      if (isPctCondition(a.condition) && a.refPrice == null) {
        seedRef = sample.type === "bar" ? sample.o : sample.price;
        evalAlert = { ...a, refPrice: seedRef };
      }

      if (a.line) {
        const lt = lineValueAt(a.line, Math.floor(evalTs / 1000));
        if (lt === null) continue; // outside the drawn segment/ray
        evalAlert = { ...evalAlert, target: lt };
      }
      let res = evaluateAlertCondition(evalAlert, sample, prev);
      if (res.matched && a.conds) {
        // E-09: every extra condition must hold on the same sample (AND)
        for (const c of a.conds) {
          if (isPctCondition(c.condition) && c.refPrice == null) c.refPrice = sample.type === "bar" ? sample.o : sample.price;
          if (!evaluateAlertCondition({ condition: c.condition, target: c.target, refPrice: c.refPrice }, sample, prev).matched) {
            res = { matched: false, triggerPrice: null };
            break;
          }
        }
      }
      if (!res.matched || !isPosFinite(res.triggerPrice)) {
        if (seedRef !== null) {
          a.refPrice = seedRef;
        }
        continue;
      }

      const conditionText = formatAlertCondition(evalAlert);
      const message = formatAlertMessage(evalAlert, res.triggerPrice);

      // Construct & validate Protocol v2 frame BEFORE mutating alert state so any
      // frame/budget error never partially corrupts alert state or skips other alerts.
      let frame;
      try {
        frame = buildAlertFrame(
          {
            id: a.id,
            sym: a.sym,
            condition: conditionText,
            price: res.triggerPrice,
            triggeredAt: evalTs,
            message,
          },
          nextSeq()
        );
      } catch {
        continue;
      }

      // Commit state mutations only after validated frame construction succeeded.
      a.triggerCount += 1;
      a.lastTriggeredAt = evalTs;
      a.lastTriggerPrice = res.triggerPrice;

      if (a.mode === "once") {
        a.fired = true;
        a.armed = false;
        a.on = false;
      } else {
        a.fired = false;
        a.armed = true;
        a.on = true;
      }

      if (isPctCondition(a.condition)) {
        if (a.resetRefOnTrigger) {
          a.refPrice = res.triggerPrice;
        } else if (seedRef !== null) {
          a.refPrice = seedRef;
        }
      }

      const entry = {
        id: a.id,
        sym: a.sym,
        condition: a.condition,
        conditionText,
        target: a.target,
        mode: a.mode,
        price: res.triggerPrice,
        prevPrice: prev ?? null,
        source: sample.type,
        triggeredAt: evalTs,
        triggerCount: a.triggerCount,
        message,
        ...(res.movePct !== undefined ? { movePct: res.movePct } : {}),
        ...(a.userId !== undefined ? { userId: a.userId } : {}),
        ...(a.parentId !== undefined ? { parentId: a.parentId } : {}),
        seq: frame.seq,
      };

      triggers.push(entry);
      frames.push(frame);

      log.push(entry);
      if (log.length > maxLog) {
        log.splice(0, log.length - maxLog);
      }
    }

    prevPrices.set(sym, nextPrevPrice);
    return { triggers, frames };
  }

  /**
   * Evaluate alerts on an incoming price tick.
   * Accepts `evaluateTick({ s|sym, c|price, t? })` or `evaluateTick(sym, price, ts?)`.
   *
   * @param {string | object} tickOrSym
   * @param {number} [maybePrice]
   * @param {number} [maybeTs]
   * @returns {{ triggers: Array<object>, frames: Array<object> }}
   */
  function evaluateTick(tickOrSym, maybePrice, maybeTs) {
    let sym, price, rawTs;
    if (tickOrSym && typeof tickOrSym === "object") {
      sym = normalizeAlertSymbol(tickOrSym.sym ?? tickOrSym.s ?? tickOrSym.symbol);
      const rawPx = tickOrSym.price !== undefined ? tickOrSym.price : tickOrSym.c !== undefined ? tickOrSym.c : tickOrSym.p;
      price = toFiniteNumber(rawPx);
      rawTs = maybePrice !== undefined ? maybePrice : tickOrSym.t ?? tickOrSym.ts ?? tickOrSym.timestamp;
    } else {
      sym = normalizeAlertSymbol(tickOrSym);
      price = toFiniteNumber(maybePrice);
      rawTs = maybeTs;
    }

    if (!sym || !isPosFinite(price)) {
      return { triggers: [], frames: [] };
    }

    const evalTs = normalizeEpochMs(rawTs, now());
    return runEvaluation(sym, { type: "tick", price }, evalTs, price);
  }

  /**
   * Evaluate alerts on a closed OHLCV bar.
   * Accepts `evaluateBar({ sym|s, o, h, l, c, t?, v? }, ts?)` or `evaluateBar(sym, bar, ts?)`.
   *
   * @param {string | object} barOrSym
   * @param {object | Array<number> | number} [maybeBar]
   * @param {number} [maybeTs]
   * @returns {{ triggers: Array<object>, frames: Array<object> }}
   */
  function evaluateBar(barOrSym, maybeBar, maybeTs) {
    let sym, rawBar, rawTs;
    if (typeof barOrSym === "string") {
      sym = normalizeAlertSymbol(barOrSym);
      rawBar = maybeBar;
      rawTs = maybeTs;
    } else if (barOrSym && typeof barOrSym === "object") {
      sym = normalizeAlertSymbol(barOrSym.sym ?? barOrSym.s ?? barOrSym.symbol);
      rawBar = barOrSym.bar ?? barOrSym;
      rawTs = maybeBar !== undefined ? maybeBar : barOrSym.triggeredAt ?? barOrSym.ts;
    } else {
      return { triggers: [], frames: [] };
    }

    const bar = normalizeAlertBar(rawBar);
    if (!sym || !bar) {
      return { triggers: [], frames: [] };
    }

    const evalTs = normalizeEpochMs(rawTs, now());
    return runEvaluation(sym, { type: "bar", ...bar }, evalTs, bar.c);
  }

  function getLog(filter = {}) {
    const symFilter = filter.sym ? normalizeAlertSymbol(filter.sym) : null;
    const since = filter.since !== undefined ? toFiniteNumber(filter.since) : NaN;
    const userId = filter.userId !== undefined ? String(filter.userId) : null;
    let out = log.filter((e) => {
      if (symFilter && e.sym !== symFilter) return false;
      if (Number.isFinite(since) && e.triggeredAt < since) return false;
      if (userId !== null && e.userId !== userId) return false;
      return true;
    });
    if (Number.isSafeInteger(filter.limit) && filter.limit > 0 && out.length > filter.limit) {
      out = out.slice(-filter.limit);
    }
    return out.map((e) => ({ ...e }));
  }

  function clearLog() {
    log.length = 0;
  }

  function snapshot() {
    return {
      alerts: Array.from(alerts.values(), (a) => ({ ...a })),
      prevPrices: Object.fromEntries(prevPrices.entries()),
      log: log.map((e) => ({ ...e })),
    };
  }

  function restore(snap) {
    if (!snap || typeof snap !== "object") return;
    alerts.clear();
    alertsBySym.clear();
    prevPrices.clear();
    log.length = 0;
    if (Array.isArray(snap.alerts)) {
      for (const a of snap.alerts) addAlert(a);
    }
    if (snap.prevPrices && typeof snap.prevPrices === "object") {
      seedPrevPrices(snap.prevPrices);
    }
    if (Array.isArray(snap.log)) {
      for (const entry of snap.log.slice(-maxLog)) log.push({ ...entry });
    }
  }

  return {
    addAlert,
    removeAlert,
    getAlert,
    listAlerts,
    rearmAlert,
    setPrevPrice,
    getPrevPrice,
    evaluateTick,
    evaluateBar,
    getLog,
    clearLog,
    snapshot,
    restore,
  };
}
