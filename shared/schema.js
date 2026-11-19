// shared/schema.js — symbol mapping, tick/bar normalisation and validation.
// Pure functions; identical behaviour in the Worker and in the browser.
import { ASSET, HARD_JUMP_PCT } from "./constants.js";

/**
 * @typedef {{s:string, c:number, t:number, bid?:number, ask?:number, v?:number, src?:string}} Tick
 *   s = internal symbol ("EURUSD", "BTCUSDT", "AAPL"), c = last price, t = epoch ms
 * @typedef {{t:number, o:number, h:number, l:number, c:number, v:number}} Bar   t = epoch SECONDS (bar open)
 */

const FX_CCY = new Set(["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "SEK", "NOK", "MXN", "ZAR", "SGD", "HKD", "TRY", "PLN"]);

export function normSymbol(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9.]/g, "");
}

/** Best-effort asset class from an internal symbol. */
export function assetClass(sym) {
  const s = normSymbol(sym);
  if (/(USDT|USDC|BUSD|FDUSD)$/.test(s) && s.length > 5) return ASSET.CRY;
  if (s.length === 6 && FX_CCY.has(s.slice(0, 3)) && FX_CCY.has(s.slice(3))) return ASSET.FX;
  if (/^(XAU|XAG)USD$/.test(s)) return ASSET.FX;
  if (/^(SPX|NDX|DJI|DAX|FTSE|NIKKEI|US30|US500|NAS100|GER40|UK100)$/.test(s)) return ASSET.IDX;
  if (/^[A-Z]{1,5}$/.test(s)) return ASSET.STK;
  return ASSET.OTHER;
}

/** Which upstream serves a symbol. */
export function providerFor(sym) {
  return assetClass(sym) === ASSET.CRY ? "binance" : "twelvedata";
}

/** Internal -> Twelve Data symbol ("EURUSD" -> "EUR/USD"). */
export function toTwelveSymbol(sym) {
  const s = normSymbol(sym);
  const cls = assetClass(s);
  if (cls === ASSET.FX) return `${s.slice(0, 3)}/${s.slice(3)}`;
  if (cls === ASSET.CRY) return s.replace(/(USDT|USDC)$/, "/USD");
  return s;
}

const num = (x) => (typeof x === "string" && x.trim() !== "" ? Number(x) : x);
const good = (x) => typeof x === "number" && Number.isFinite(x) && x > 0;

/**
 * Normalise any provider payload into a Tick, or null if unusable.
 * Rejects: missing symbol, zero/negative/NaN price, bid>ask, non-positive bid/ask.
 */
export function normalizeTick(raw) {
  if (!raw) return null;
  const s = normSymbol(raw.s ?? raw.symbol);
  const c = num(raw.c ?? raw.price ?? raw.p);
  if (!s || !good(c)) return null;
  const out = { s, c, t: Number(raw.t ?? raw.timestamp ?? Date.now()) };
  if (!Number.isFinite(out.t)) out.t = Date.now();
  if (out.t < 1e12) out.t *= 1000; // seconds -> ms
  const bid = num(raw.bid), ask = num(raw.ask);
  if (bid !== undefined && bid !== null) { if (!good(bid)) return null; out.bid = bid; }
  if (ask !== undefined && ask !== null) { if (!good(ask)) return null; out.ask = ask; }
  if (out.bid !== undefined && out.ask !== undefined && out.bid > out.ask) return null;
  const v = num(raw.v ?? raw.volume ?? raw.q);
  if (Number.isFinite(v) && v >= 0) out.v = v;
  if (raw.src) out.src = String(raw.src);
  return out;
}

/** Normalise a bar from either array form [t,o,h,l,c,v] or object form. Returns null if invalid. */
export function normalizeBar(raw) {
  if (!raw) return null;
  let t, o, h, l, c, v;
  if (Array.isArray(raw)) [t, o, h, l, c, v] = raw.map(num);
  else ({ t, o, h, l, c, v } = { t: num(raw.t ?? raw.time ?? raw.datetime), o: num(raw.o ?? raw.open), h: num(raw.h ?? raw.high), l: num(raw.l ?? raw.low), c: num(raw.c ?? raw.close), v: num(raw.v ?? raw.volume) });
  if (typeof t === "string") t = Date.parse(t.includes("T") ? t : t.replace(" ", "T") + "Z") / 1000;
  if (t > 1e12) t = Math.floor(t / 1000);
  if (![t, o, h, l, c].every(good)) return null;
  const hi = Math.max(h, o, c), lo = Math.min(l, o, c); // repair inverted wicks
  return { t: Math.floor(t), o, h: hi, l: lo, c, v: Number.isFinite(v) ? v : 0 };
}

/** Sort ascending, de-duplicate by time (last wins), drop invalid. */
export function cleanBars(list) {
  const m = new Map();
  for (const r of list || []) { const b = normalizeBar(r); if (b) m.set(b.t, b); }
  return [...m.values()].sort((a, b) => a.t - b.t);
}

/**
 * Stateful zero-tolerance tick filter. DROPS (never clamps) a tick whose price is
 * further than the asset-class hard limit from the last accepted price.
 * Quarantine: if 4 consecutive ticks agree with each other (within 0.2%) the new level is real
 * (genuine gap / news) and is accepted — so the feed can never get stuck on a stale reference.
 */
export function createTickGuard() {
  const last = new Map();   // sym -> last accepted price
  const held = new Map();   // sym -> {a:anchor, n:count}
  return function accept(tick) {
    const t = normalizeTick(tick);
    if (!t) return null;
    const ref = last.get(t.s);
    if (ref === undefined) { last.set(t.s, t.c); return t; }
    const lim = HARD_JUMP_PCT[assetClass(t.s)] ?? 1.5;
    if (Math.abs(t.c - ref) / ref * 100 <= lim) { last.set(t.s, t.c); held.delete(t.s); return t; }
    const h = held.get(t.s);
    if (h && Math.abs(t.c - h.a) / h.a <= 0.002) {
      if (++h.n >= 4) { last.set(t.s, t.c); held.delete(t.s); return t; }
    } else held.set(t.s, { a: t.c, n: 1 });
    return null; // dropped
  };
}
