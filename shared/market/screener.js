// shared/market/screener.js — Server-side screener scoring, P1–P5 presets, and heatmap metrics.
// Pure, self-contained ES module compatible with Node 22+ and Cloudflare Workers.
// Zero synthetic/simulated market data: symbols without real bars or with synthetic sources are omitted.

import { assetClass, cleanBars, normSymbol } from "../schema.js";
import { MAX_INDICATOR_PERIOD, ccMetric, ema, maLast } from "./indicators.js";

export const PRESETS = Object.freeze({
  P1: Object.freeze({ name: "P1", desc: "Strictest filter: full EMA alignment + expansion" }),
  P2: Object.freeze({ name: "P2", desc: "Strict filter: EMA alignment + positive change" }),
  P3: Object.freeze({ name: "P3", desc: "Moderate filter: positive change + partial EMA alignment" }),
  P4: Object.freeze({ name: "P4", desc: "Loose filter: any positive change" }),
  P5: Object.freeze({ name: "P5", desc: "No filter: all markets" }),
});

export const EVC_TFS = Object.freeze({
  H: Object.freeze({ e: "1H", v: "1D" }),
  M: Object.freeze({ e: "15m", v: "1H" }),
  L: Object.freeze({ e: "1m", v: "15m" }),
});

export const HM_TFS = Object.freeze(["1H", "4H", "1D", "1W"]);
export const HM_METRICS = Object.freeze(["chg", "mom", "score"]);
export const MAX_PAGE_SIZE = 50;
export const MAX_HEATMAP_TILES = 100;

/** Rejects synthetic/simulated/mock provenance labels (including legacy "edge+sim"). */
const FORBIDDEN_SOURCE_RE = /(^|[+:\s_/-])(sim|simulated|synthetic|mock|fake|demo)($|[+:\s_/-])/i;

const TF_ALIASES = Object.freeze({
  "1H": "1h", "1h": "1H",
  "4H": "4h", "4h": "4H",
  "1D": "1d", "1d": "1D",
  "1W": "1w", "1w": "1W",
});

/**
 * Returns true if a source label represents disallowed synthetic/simulated data or is missing.
 * @param {unknown} source
 * @returns {boolean}
 */
export function isForbiddenSource(source) {
  if (typeof source !== "string") return true;
  const trimmed = source.trim();
  if (!trimmed) return true;
  return FORBIDDEN_SOURCE_RE.test(trimmed);
}

/**
 * Resolves a bar array for a timeframe from a record or bars map (handling 1H/1h, 1D/1d aliases).
 * @param {Record<string, Array>|{bars?: Record<string, Array>}|Array|null|undefined} source
 * @param {string} tf
 * @returns {Array|null}
 */
export function getBars(source, tf) {
  if (!source) return null;
  if (Array.isArray(source)) return source;
  const map = source.bars && typeof source.bars === "object" && !Array.isArray(source.bars) ? source.bars : source;
  if (!map || typeof map !== "object") return null;
  if (Array.isArray(map[tf])) return map[tf];
  const alias = TF_ALIASES[tf];
  if (alias && Array.isArray(map[alias])) return map[alias];
  return null;
}

/**
 * Exponential Moving Average matching client `emaArr` (seeded at values[0]).
 * Reuses single-source-of-truth `ema()` from `./indicators.js`.
 * @param {ArrayLike<number>} values
 * @param {number} len
 * @returns {Float64Array}
 */
export function emaArr(values, len) {
  return ema(values, len);
}

function closesOf(bars) {
  const n = bars.length;
  const cl = new Float64Array(n);
  for (let i = 0; i < n; i++) cl[i] = bars[i].c;
  return cl;
}

/**
 * Moving average (SMA or EMA) on candle closes. Matches client `ma()`.
 * Reuses single-source-of-truth `maLast()` from `./indicators.js`.
 * @param {Array<{c:number}>|null} bars
 * @param {"SMA"|"EMA"} type
 * @param {number} len
 * @returns {number|null}
 */
export function ma(bars, type, len) {
  if (!Array.isArray(bars) || bars.length === 0 || !(len > 0)) return null;
  const period = Math.floor(len);
  if (period < 1 || period > MAX_INDICATOR_PERIOD) return null;
  return maLast(closesOf(bars), type, period);
}

/**
 * N-candle change / expansion metric. Matches client `cc()`.
 * Reuses single-source-of-truth `ccMetric()` from `./indicators.js`.
 * @param {Array<{h:number,l:number,c:number}>|null} bars
 * @param {{n:number, mode?:"abs"|"exp", dir?:"bull"|"bear"}} cfg
 * @returns {number|null}
 */
export function cc(bars, cfg) {
  return ccMetric(bars, cfg);
}

/**
 * Computes a single screener column metric for a symbol record. Matches client `calc()`.
 * Never synthesizes volume multipliers.
 * @param {{price?:number, volume?:number, contractSize?:number, bars?:Record<string, Array>}} record
 * @param {{type:string, tf?:string, n?:number, mode?:string, dir?:string, ma?:string, len?:number}} col
 * @returns {number|null}
 */
export function calc(record, col) {
  if (!record || !col) return null;
  const t = col.type;
  if (t === "price") {
    return typeof record.price === "number" && Number.isFinite(record.price) ? record.price : null;
  }
  if (t === "vol" || t === "dv") {
    const v = Number(record.volume);
    if (!Number.isFinite(v) || v <= 0) return null;
    if (t === "vol") return v;
    const px = Number(record.price);
    const cs = Number(record.contractSize ?? 1);
    return Number.isFinite(px) && Number.isFinite(cs) ? v * px * cs : null;
  }
  if (t === "pct") {
    const a = getBars(record, col.tf || "1D");
    if (!a || a.length < 2) return null;
    const prev = a[a.length - 2].c;
    if (!(prev > 0)) return null;
    return ((a[a.length - 1].c - prev) / prev) * 100;
  }
  if (t === "cc") {
    return cc(getBars(record, col.tf || "1D"), col);
  }
  if (t === "adr") {
    const a = getBars(record, "1D");
    if (!a || a.length === 0) return null;
    const period = Math.max(1, Math.floor(Number(col.n) || 14));
    const start = Math.max(0, a.length - period);
    let sum = 0;
    const count = a.length - start;
    for (let i = start; i < a.length; i++) {
      if (!(a[i].c > 0)) return null;
      sum += (a[i].h - a[i].l) / a[i].c;
    }
    return (sum / count) * 100;
  }
  if (t === "mac") {
    const a = getBars(record, col.tf || "1D");
    if (!a || a.length === 0) return null;
    const m = ma(a, col.ma || "EMA", col.len);
    if (m == null || !(m > 0)) return null;
    return ((a[a.length - 1].c - m) / m) * 100;
  }
  return null;
}

/**
 * Evaluates a multi-timeframe MA trend column (`type: "mat"`).
 * @param {{bars?:Record<string, Array>}} record
 * @param {{tfs:string[], ma?:"SMA"|"EMA", len:number}} col
 * @returns {{sq:Array<boolean|null>, count:number}}
 */
export function calcMat(record, col) {
  const tfs = Array.isArray(col && col.tfs) ? col.tfs : [];
  const sq = tfs.map((tf) => {
    const a = getBars(record, tf);
    if (!a || a.length === 0) return null;
    const m = ma(a, col.ma || "EMA", col.len);
    if (m == null) return null;
    return a[a.length - 1].c > m;
  });
  let count = 0;
  for (let i = 0; i < sq.length; i++) if (sq[i] === true) count++;
  return { sq, count };
}

/**
 * Cycle score, phase, and direction from 1D candles (requires >= 50 bars).
 * Matches client `scoreSymbol()` identically.
 * @param {Array<{c:number,v?:number}>|{bars?:Record<string, Array>}|Record<string, Array>} barsOrRecord
 * @returns {{score:number, phase:string, dir:number, chg?:number}}
 */
export function scoreSymbol(barsOrRecord) {
  const a = Array.isArray(barsOrRecord) ? barsOrRecord : getBars(barsOrRecord, "1D");
  if (!a || a.length < 50) return { score: 0, phase: "—", dir: 0 };

  const cl = closesOf(a);
  const ema5 = emaArr(cl, 5);
  const ema10 = emaArr(cl, 10);
  const ema20 = emaArr(cl, 20);
  const ema50 = emaArr(cl, 50);

  const last = a.length - 1;
  const c = cl[last];
  const above5 = c > ema5[last];
  const above10 = c > ema10[last];
  const above20 = c > ema20[last];
  const above50 = c > ema50[last];
  const aligned = above5 && above10 && above20 && above50;
  const bearAlign = !above5 && !above10 && !above20 && !above50;
  const chg20 = ((c / cl[Math.max(0, last - 20)]) - 1) * 100;

  let volSum20 = 0;
  for (let i = a.length - 20; i < a.length; i++) volSum20 += a[i].v || 0;
  const vol = volSum20 / 20;

  let volSum50 = 0;
  for (let i = a.length - 50; i < a.length; i++) volSum50 += a[i].v || 0;
  const avgVol = volSum50 / 50;
  const volRatio = avgVol > 0 ? vol / avgVol : 1;

  let score = 0;
  let phase = "Neutral";
  let dir = 0;
  if (aligned && chg20 > 5) { score = 90 + Math.min(chg20, 10); phase = "Expansion"; dir = 1; }
  else if (aligned && chg20 > 0) { score = 70 + chg20; phase = "Accumulation"; dir = 1; }
  else if (bearAlign && chg20 < -5) { score = 90 + Math.min(-chg20, 10); phase = "Distribution"; dir = -1; }
  else if (bearAlign && chg20 < 0) { score = 70 - chg20; phase = "Reaccumulation"; dir = -1; }
  else if (above50 && chg20 > 0) { score = 50 + chg20; phase = "Retracement"; dir = 1; }
  else { score = 30; phase = "Range"; }

  if (volRatio > 1.5) score += 10;
  return { score: Math.min(100, score), phase, dir, chg: chg20 };
}

/**
 * Returns true when both entry and validation timeframes have >= 20 bars for the given EVC level.
 * Matches client `evcHas()`.
 * @param {Record<string, Array>|{bars?:Record<string, Array>}} barsOrRecord
 * @param {"H"|"M"|"L"} [evcTf="H"]
 * @returns {boolean}
 */
export function evcHas(barsOrRecord, evcTf = "H") {
  const cfg = EVC_TFS[evcTf] || EVC_TFS.H;
  const ae = getBars(barsOrRecord, cfg.e);
  const av = getBars(barsOrRecord, cfg.v);
  return Boolean(ae && ae.length >= 20 && av && av.length >= 20);
}

/**
 * Vektor multi-EMA alignment score (0–100) across entry + validation timeframes.
 * Matches client `scoreMarket()` identically.
 * @param {Record<string, Array>|{bars?:Record<string, Array>}} barsOrRecord
 * @param {{evcTf?:"H"|"M"|"L"}} [opts]
 * @returns {number}
 */
export function scoreMarket(barsOrRecord, opts = {}) {
  const cfg = EVC_TFS[opts.evcTf] || EVC_TFS.H;
  const ae = getBars(barsOrRecord, cfg.e);
  const av = getBars(barsOrRecord, cfg.v);
  if (!ae || ae.length < 20 || !av || av.length < 20) return 0;

  const cle = closesOf(ae);
  const clv = closesOf(av);
  const ema5e = emaArr(cle, 5);
  const ema10e = emaArr(cle, 10);
  const ema20e = emaArr(cle, 20);
  const ema5v = emaArr(clv, 5);
  const ema10v = emaArr(clv, 10);
  const ema20v = emaArr(clv, 20);

  const le = ae.length - 1;
  const lv = av.length - 1;
  const ce = cle[le];
  const cv = clv[lv];

  let score = 0;
  // Validation timeframe (higher) — context
  if (cv > ema5v[lv]) score += 8;
  if (cv > ema10v[lv]) score += 8;
  if (cv > ema20v[lv]) score += 10;
  const chgv = ((cv / clv[Math.max(0, lv - 20)]) - 1) * 100;
  if (chgv > 10) score += 15;
  else if (chgv > 5) score += 10;
  else if (chgv > 0) score += 5;

  // Entry timeframe (lower) — momentum
  if (ce > ema5e[le]) score += 8;
  if (ce > ema10e[le]) score += 8;
  if (ce > ema20e[le]) score += 10;
  const chge = ((ce / cle[Math.max(0, le - 20)]) - 1) * 100;
  if (chge > 10) score += 15;
  else if (chge > 5) score += 10;
  else if (chge > 0) score += 5;

  // Alignment bonus
  if (cv > ema5v[lv] && cv > ema10v[lv] && cv > ema20v[lv] && ce > ema5e[le] && ce > ema10e[le]) {
    score += 8;
  }
  return Math.min(100, score);
}

/**
 * Evaluates P1–P5 preset conditions on entry + validation candles.
 * Matches client `passesPreset()` identically.
 * @param {Record<string, Array>|{bars?:Record<string, Array>}} barsOrRecord
 * @param {"P1"|"P2"|"P3"|"P4"|"P5"} preset
 * @param {{evcTf?:"H"|"M"|"L", dir?:"long"|"short"}} [opts]
 * @returns {boolean}
 */
export function passesPreset(barsOrRecord, preset, opts = {}) {
  if (preset === "P5") return true;
  const cfg = EVC_TFS[opts.evcTf] || EVC_TFS.H;
  const av = getBars(barsOrRecord, cfg.v);
  if (!av || av.length < 5) return false;

  const clv = closesOf(av);
  const lv = clv.length - 1;
  const cv = clv[lv];
  const look = Math.min(20, lv);
  const chgv = ((cv / clv[lv - look]) - 1) * 100;
  const bull = (opts.dir || "long") === "long";
  const chgOk = bull ? chgv > 0.3 : chgv < -0.3;

  let emaOk = true;
  if (av.length >= 20) {
    const ema10 = emaArr(clv, 10);
    const ema20 = emaArr(clv, 20);
    emaOk = bull ? (cv > ema10[lv] && cv > ema20[lv]) : (cv < ema10[lv] && cv < ema20[lv]);
  }

  let exp = false;
  const ae = getBars(barsOrRecord, cfg.e);
  if (ae && ae.length >= 8) {
    const ce = ae[ae.length - 1].c;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = ae.length - 8; i < ae.length; i++) {
      const c = ae[i].c;
      if (c < lo) lo = c;
      if (c > hi) hi = c;
    }
    exp = bull
      ? ((ce - lo) / Math.max(lo, 1e-9)) * 100 > 1
      : ((hi - ce) / Math.max(hi, 1e-9)) * 100 > 1;
  }

  if (preset === "P4") return chgOk;
  if (preset === "P3") return chgOk && emaOk;
  if (preset === "P2") return chgOk && emaOk && (exp || Math.abs(chgv) > 2);
  if (preset === "P1") return chgOk && emaOk && exp && Math.abs(chgv) > 3;
  return true;
}

/**
 * Strictest preset tier ("P1".."P5") passed by the market. Matches client `sxTier()`.
 * @param {Record<string, Array>|{bars?:Record<string, Array>}} barsOrRecord
 * @param {{evcTf?:"H"|"M"|"L", dir?:"long"|"short"}} [opts]
 * @returns {"P1"|"P2"|"P3"|"P4"|"P5"}
 */
export function sxTier(barsOrRecord, opts = {}) {
  for (const p of ["P1", "P2", "P3", "P4"]) {
    if (passesPreset(barsOrRecord, p, opts)) return p;
  }
  return "P5";
}

/**
 * 1D close-to-close percentage change. Matches client `sxPct()`.
 * @param {Array<{c:number}>|{bars?:Record<string, Array>}|Record<string, Array>} barsOrRecord
 * @returns {number|null}
 */
export function sxPct(barsOrRecord) {
  const a = Array.isArray(barsOrRecord) ? barsOrRecord : getBars(barsOrRecord, "1D");
  if (!a || a.length < 2) return null;
  const prev = a[a.length - 2].c;
  if (!(prev > 0)) return null;
  return (a[a.length - 1].c / prev - 1) * 100;
}

/**
 * 14-day Average Daily Range %. Matches client `sxAdr()`.
 * @param {Array<{h:number,l:number,c:number}>|{bars?:Record<string, Array>}|Record<string, Array>} barsOrRecord
 * @param {number} [period=14]
 * @returns {number|null}
 */
export function sxAdr(barsOrRecord, period = 14) {
  const a = Array.isArray(barsOrRecord) ? barsOrRecord : getBars(barsOrRecord, "1D");
  if (!a || a.length < 2) return null;
  const start = Math.max(0, a.length - period);
  let sum = 0;
  const count = a.length - start;
  for (let i = start; i < a.length; i++) {
    if (!(a[i].c > 0)) return null;
    sum += (a[i].h - a[i].l) / a[i].c;
  }
  return (sum / count) * 100;
}

/**
 * Heatmap traded value (`volume * price`). Matches client `hmTradedValue()`.
 * @param {{price?:number, volume?:number}} record
 * @returns {number}
 */
export function hmTradedValue(record) {
  if (!record) return 0;
  const v = (+record.volume || 0) * (+record.price || 0);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Log-compressed treemap tile weight. Matches client `hmLayout()` weight formula.
 * @param {{price?:number, volume?:number}} record
 * @param {"value"|"equal"} [size="value"]
 * @returns {number}
 */
export function hmWeight(record, size = "value") {
  if (size === "equal") return 1;
  return 1 + Math.pow(Math.log10(1 + hmTradedValue(record)), 1.6);
}

/**
 * % change of live price (or latest bar close) vs previous bar close for a timeframe.
 * Matches client `hmChg()`.
 * @param {Array<{c:number}>|null} bars
 * @param {number|null|undefined} livePrice
 * @returns {number|null}
 */
export function hmChg(bars, livePrice) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const prev = bars[bars.length - 2].c;
  const px = livePrice != null && Number.isFinite(+livePrice) ? +livePrice : bars[bars.length - 1].c;
  if (!(prev > 0) || !(px > 0)) return null;
  return (px / prev - 1) * 100;
}

/**
 * Heatmap tile scalar value for `metric` ("chg" | "mom" | "score"). Matches client `hmVal()`.
 * @param {{price?:number, bars?:Record<string, Array>}} record
 * @param {{metric?:"chg"|"mom"|"score", tf?:string, evcTf?:"H"|"M"|"L"}} [opts]
 * @returns {number|null}
 */
export function hmVal(record, opts = {}) {
  const metric = opts.metric || "chg";
  if (metric === "score") {
    const v = scoreMarket(record, { evcTf: opts.evcTf });
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  if (metric === "mom") {
    const r = scoreSymbol(record);
    return r && r.dir ? r.dir * r.score : (r && r.phase !== "—" ? 0 : null);
  }
  return hmChg(getBars(record, opts.tf || "1D"), record ? record.price : null);
}

/**
 * Diverging color scale range (90th percentile of |values|, or 50 for Vektor score).
 * Matches client `hmRange()`.
 * @param {Array<number|null|undefined>} vals
 * @param {{metric?:"chg"|"mom"|"score", range?:"auto"|number}} [opts]
 * @returns {number}
 */
export function hmRange(vals, opts = {}) {
  if (opts.metric === "score") return 50;
  if (opts.range != null && opts.range !== "auto") {
    const r = Number(opts.range);
    if (Number.isFinite(r) && r > 0) return r;
  }
  const a = [];
  for (const v of vals || []) {
    if (v != null && Number.isFinite(v)) a.push(Math.abs(v));
  }
  if (!a.length) return 1;
  a.sort((x, y) => x - y);
  const p = a[Math.floor(a.length * 0.9)] || a[a.length - 1];
  return Math.max(0.25, +p.toPrecision(2));
}

/**
 * Validates and normalizes an input instrument record. Returns null if the symbol lacks real bars
 * or carries a synthetic/simulated source (strictly enforcing zero simulated output).
 * @param {object} raw
 * @returns {object|null}
 */
export function normalizeScreenerRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.synthetic === true || raw.simulated === true) return null;
  if (isForbiddenSource(raw.source)) return null;

  const symbol = normSymbol(raw.symbol ?? raw.s);
  if (!symbol) return null;

  const rawBars = raw.bars && typeof raw.bars === "object" && !Array.isArray(raw.bars) ? raw.bars : null;
  if (!rawBars) return null;

  const bars = {};
  let latestBarTs = 0;
  let fallbackPrice = null;
  let fallbackVolume = null;
  let totalValidBars = 0;

  for (const [tf, list] of Object.entries(rawBars)) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const cleaned = cleanBars(list);
    if (cleaned.length === 0) continue;
    bars[tf] = cleaned;
    totalValidBars += cleaned.length;
    const last = cleaned[cleaned.length - 1];
    if (last.t >= latestBarTs) {
      latestBarTs = last.t;
      fallbackPrice = last.c;
      if (Number.isFinite(last.v) && last.v >= 0) fallbackVolume = last.v;
    }
  }

  // Symbols without real bars are omitted — NEVER simulated.
  if (totalValidBars === 0) return null;

  const rawPrice = raw.price != null ? Number(raw.price) : NaN;
  const price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : fallbackPrice;
  if (!(price > 0)) return null;

  const rawVol = raw.volume != null ? Number(raw.volume) : NaN;
  const volume = Number.isFinite(rawVol) && rawVol >= 0 ? rawVol : (fallbackVolume ?? 0);

  const rawCs = raw.contractSize != null ? Number(raw.contractSize) : 1;
  const contractSize = Number.isFinite(rawCs) && rawCs > 0 ? rawCs : 1;

  let asOf = Number(raw.asOf);
  if (!Number.isFinite(asOf) || asOf <= 0) {
    asOf = latestBarTs > 0 ? latestBarTs * 1000 : 0;
  } else if (asOf < 1e12) {
    asOf = Math.floor(asOf * 1000);
  }
  if (!(asOf > 0)) return null;

  const market = String(raw.market ?? raw.mkt ?? raw.m ?? assetClass(symbol)).toUpperCase();
  const source = raw.source.trim();

  return {
    symbol,
    market,
    price,
    volume,
    contractSize,
    name: typeof raw.name === "string" ? raw.name : undefined,
    exchange: typeof raw.exchange === "string" ? raw.exchange : undefined,
    bars,
    source,
    asOf,
  };
}

/**
 * Computes full screener + heatmap metrics for a single normalized real-data record.
 * @param {object} rec
 * @param {{evcTf?:"H"|"M"|"L", dir?:"long"|"short", columns?:Array}} [opts]
 * @returns {object}
 */
export function scoreRecord(rec, opts = {}) {
  const evcTf = EVC_TFS[opts.evcTf] ? opts.evcTf : "H";
  const dir = opts.dir === "short" ? "short" : "long";

  const bars1D = getBars(rec, "1D");
  const expansion = scoreSymbol(bars1D);
  const evcReady = evcHas(rec, evcTf);
  const score = scoreMarket(rec, { evcTf });
  const tier = sxTier(rec, { evcTf, dir });
  const pct1D = sxPct(bars1D);
  const adr14 = sxAdr(bars1D, 14);
  const tradedValue = hmTradedValue(rec);

  const chg = {};
  for (const tf of HM_TFS) {
    chg[tf] = hmChg(getBars(rec, tf), rec.price);
  }

  const row = {
    symbol: rec.symbol,
    market: rec.market,
    price: rec.price,
    volume: rec.volume,
    tradedValue,
    pct1D,
    adr14,
    score,
    evcReady,
    expansion,
    tier,
    chg,
    source: rec.source,
    asOf: rec.asOf,
  };

  if (rec.name !== undefined) row.name = rec.name;
  if (rec.exchange !== undefined) row.exchange = rec.exchange;

  if (Array.isArray(opts.columns) && opts.columns.length > 0) {
    const values = {};
    const mat = {};
    for (const col of opts.columns) {
      if (!col || !col.id) continue;
      if (col.type === "mat") {
        const res = calcMat(rec, col);
        mat[col.id] = res.sq;
        values[col.id] = res.count;
      } else {
        values[col.id] = calc(rec, col);
      }
    }
    row.values = values;
    if (Object.keys(mat).length > 0) row.mat = mat;
  }

  return row;
}

/**
 * Builds heatmap tiles (sorted by traded value, capped at `n <= 100`) from real-data records.
 * @param {Array<object>} records
 * @param {{metric?:"chg"|"mom"|"score", tf?:string, size?:"value"|"equal", n?:number, market?:string, range?:"auto"|number, evcTf?:"H"|"M"|"L", dir?:"long"|"short", now?:number}} [opts]
 * @returns {{metric:string, tf:string, size:string, range:number, asOf:number, omitted:number, tiles:Array<object>}}
 */
export function buildHeatmap(records, opts = {}) {
  const metric = HM_METRICS.includes(opts.metric) ? opts.metric : "chg";
  const tf = HM_TFS.includes(opts.tf) ? opts.tf : "1D";
  const size = opts.size === "equal" ? "equal" : "value";
  const n = Math.min(MAX_HEATMAP_TILES, Math.max(1, Math.floor(Number(opts.n) || 60)));
  const market = String(opts.market || "ALL").toUpperCase();
  const evcTf = EVC_TFS[opts.evcTf] ? opts.evcTf : "H";
  const dir = opts.dir === "short" ? "short" : "long";

  const valid = [];
  let omitted = 0;
  for (const raw of records || []) {
    const rec = normalizeScreenerRecord(raw);
    if (!rec) { omitted++; continue; }
    if (market !== "ALL" && rec.market !== market) continue;
    valid.push(rec);
  }

  valid.sort((a, b) => (hmTradedValue(b) - hmTradedValue(a)) || a.symbol.localeCompare(b.symbol));
  const top = valid.slice(0, n);

  const tiles = [];
  const vals = [];
  let maxAsOf = 0;

  for (const rec of top) {
    const value = hmVal(rec, { metric, tf, evcTf });
    const weight = hmWeight(rec, size);
    const tradedValue = hmTradedValue(rec);
    const chg = {};
    for (const htf of HM_TFS) chg[htf] = hmChg(getBars(rec, htf), rec.price);
    const score = scoreMarket(rec, { evcTf });
    const tier = sxTier(rec, { evcTf, dir });
    if (rec.asOf > maxAsOf) maxAsOf = rec.asOf;
    vals.push(value);
    tiles.push({
      symbol: rec.symbol,
      market: rec.market,
      price: rec.price,
      value,
      weight,
      tradedValue,
      chg,
      score,
      tier,
      source: rec.source,
      asOf: rec.asOf,
    });
  }

  const range = hmRange(vals, { metric, range: opts.range });
  const asOf = maxAsOf || (Number.isFinite(opts.now) ? opts.now : Date.now());
  return { metric, tf, size, range, asOf, omitted, tiles };
}

function sortAccessor(by) {
  switch (by) {
    case "sym":
    case "symbol": return (r) => r.symbol;
    case "price": return (r) => r.price;
    case "pct1D": return (r) => r.pct1D;
    case "adr14": return (r) => r.adr14;
    case "tradedValue": return (r) => r.tradedValue;
    case "expansion": return (r) => r.expansion ? r.expansion.score : null;
    case "score":
    default: return (r) => r.score;
  }
}

/**
 * Builds a paginated server-side screener snapshot and heatmap payload from real instrument records.
 * Every emitted row and tile carries `{ source, asOf }`. Symbols without real bars or with synthetic
 * sources (e.g. "edge+sim") are strictly omitted.
 *
 * @param {Array<object>} records
 * @param {{
 *   preset?: "P1"|"P2"|"P3"|"P4"|"P5"|null,
 *   evcTf?: "H"|"M"|"L",
 *   dir?: "long"|"short",
 *   market?: string,
 *   query?: string,
 *   page?: number,
 *   pageSize?: number,
 *   sort?: { by?: string, dir?: 1|-1 },
 *   columns?: Array<object>,
 *   heatmap?: { metric?: "chg"|"mom"|"score", tf?: string, size?: "value"|"equal", n?: number, market?: string, range?: "auto"|number },
 *   now?: number
 * }} [opts]
 */
export function buildScreenerSnapshot(records, opts = {}) {
  const evcTf = EVC_TFS[opts.evcTf] ? opts.evcTf : "H";
  const dir = opts.dir === "short" ? "short" : "long";
  const preset = opts.preset && PRESETS[opts.preset] ? opts.preset : "P5";
  const market = String(opts.market || "ALL").toUpperCase();
  const query = String(opts.query || "").trim().toLowerCase();
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(opts.pageSize) || MAX_PAGE_SIZE)));
  const requestedPage = Math.max(1, Math.floor(Number(opts.page) || 1));
  const columns = Array.isArray(opts.columns) ? opts.columns : undefined;

  const normalized = [];
  const seen = new Set();
  let omitted = 0;

  for (const raw of records || []) {
    const rec = normalizeScreenerRecord(raw);
    if (!rec) { omitted++; continue; }
    if (seen.has(rec.symbol)) continue;
    seen.add(rec.symbol);
    normalized.push(rec);
  }

  let matched = [];
  let maxAsOf = 0;
  for (const rec of normalized) {
    if (rec.asOf > maxAsOf) maxAsOf = rec.asOf;
    if (market !== "ALL" && rec.market !== market) continue;
    if (query && !rec.symbol.toLowerCase().includes(query)) continue;
    if (!passesPreset(rec, preset, { evcTf, dir })) continue;

    const row = scoreRecord(rec, { evcTf, dir, columns });

    // Apply `cc` minimum threshold filters matching client `rows(vis)`
    if (columns) {
      let ccPass = true;
      for (const c of columns) {
        if (c && c.type === "cc" && c.min > 0) {
          const val = row.values ? row.values[c.id] : null;
          if (val == null || val < c.min) { ccPass = false; break; }
        }
      }
      if (!ccPass) continue;
    }

    matched.push(row);
  }

  const sortBy = opts.sort && opts.sort.by ? opts.sort.by : "score";
  const sortDir = opts.sort && (opts.sort.dir === 1 || opts.sort.dir === -1) ? opts.sort.dir : -1;
  const getKey = (columns && columns.some((c) => c && c.id === sortBy))
    ? (r) => (r.values ? r.values[sortBy] : null)
    : sortAccessor(sortBy);

  matched.sort((a, b) => {
    const x = getKey(a);
    const y = getKey(b);
    if (x == null && y == null) return a.symbol.localeCompare(b.symbol);
    if (x == null) return 1;
    if (y == null) return -1;
    if (x !== y) return (x > y ? 1 : -1) * sortDir;
    return a.symbol.localeCompare(b.symbol);
  });

  const total = matched.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  const pageRows = matched.slice(start, start + pageSize);

  const hmOpts = Object.assign({ evcTf, dir, market, now: opts.now }, opts.heatmap || {});
  const heatmap = buildHeatmap(normalized, hmOpts);

  const asOf = maxAsOf || (Number.isFinite(opts.now) ? opts.now : Date.now());

  return {
    asOf,
    evcTf,
    dir,
    preset,
    page,
    pageSize,
    total,
    totalPages,
    omitted,
    rows: pageRows,
    heatmap: {
      metric: heatmap.metric,
      tf: heatmap.tf,
      size: heatmap.size,
      range: heatmap.range,
      asOf: heatmap.asOf,
      tiles: heatmap.tiles,
    },
  };
}
