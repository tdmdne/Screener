// Vektor Terminal — Cloudflare Worker + KV + Edge Cache + MarketRelayDO (WebSocket Hibernation API)

// Catalogs, interval maps and symbol helpers live in shared/ (single source of truth with server.js).
import { INTERVAL_SECONDS as STEPS, BINANCE_INTERVALS as BNI, TWELVEDATA_INTERVALS as TDI, resolveInterval } from "./shared/intervals.js";
import { BASE_INSTRUMENTS, INSTRUMENT_BY_SYMBOL as BY_SYM, DUKASCOPY_MAP, FUTURES_TO_TWELVEDATA, BINANCE_MIRRORS, STABLE_RE } from "./shared/instruments.js";
import { resolveTdSymbol, inferMeta, normalizeSymbol } from "./shared/symbolNormalizer.js";
import { fetchYahooCandles, fetchYahooQuote, toYahooSymbol } from "./shared/yahooFeed.js";
import { normSymbol, toTwelveSymbol, createTickGuard } from "./shared/schema.js";
import { createCandleBuilder, bucketStart, mergeBars, overlayLiveBars, rollup } from "./shared/market/candles.js";
import { hubBarsSymbol, hubTfLabel } from "./shared/market/candleRoute.js";
import { TdSubscriptionManager } from "./shared/market/tdSlots.js";
import { BinanceMiniTickerFeed } from "./shared/market/binanceFeed.js";
import { resolveCryptoProvider } from "./shared/market/cryptoProvider.js";
import { PROVENANCE } from "./shared/protocol.js";

async function fetchBinanceWithFallback(pathAndQuery, init = {}) {
  for (const base of BINANCE_MIRRORS) {
    try {
      const u = `${base}${pathAndQuery}`;
      const r = await fetch(u, init);
      // 403 (Binance WAF on Cloudflare egress), 418/429 (IP rate limits), 451 (geo) and 5xx are host-specific: try the next.
      if (r.status === 403 || r.status === 418 || r.status === 429 || r.status === 451 || (r.status >= 500 && r.status <= 599)) {
        continue;
      }
      return r;
    } catch (_e) {}
  }
  return null;
}

const HISTORICAL_KV_TTL = 2592000; // 30 days for immutable historical blocks

const LIVE_SCREENER_NON_CRYPTO = BASE_INSTRUMENTS.filter((item) => item.m !== "CRY");
const isTdPrimaryMarket = (m) => m === "FX" || m === "STK" || m === "ETF";

function toTdApiSymbol(rawSym, meta) {
  const known = BY_SYM.get(String(rawSym || "").trim().toUpperCase());
  if (known && known.td) return known.td;
  const norm = normalizeSymbol(rawSym, "twelvedata");
  if (norm) return norm;
  return resolveTdSymbol((meta && meta.td) || rawSym, "");
}

let tdAuthWarned = false;
/** Structured log (once per isolate) when vektor-market rejects the internal /td call: history then falls back to Yahoo. */
function warnTdAuth(status, hasSecret) {
  if (tdAuthWarned) return;
  tdAuthWarned = true;
  console.error(
    JSON.stringify({
      op: "td_service_auth",
      code: "TD_PROXY_FORBIDDEN",
      status,
      hasSecret,
      hint: "Set the same INTERNAL_TD_SECRET on the Pages project and on vektor-market (wrangler secret put INTERNAL_TD_SECRET).",
    })
  );
}

async function fetchTdEndpoint(tdPath, qs, env) {
  const mode = tdSource(env);
  if (!mode) return null;
  try {
    if (mode === "service" && env && env.MARKET_SERVICE && typeof env.MARKET_SERVICE.fetch === "function") {
      // vektor-market's /td/* proxy only serves callers holding the shared internal secret (it guards paid REST credits).
      const secret = typeof env.INTERNAL_TD_SECRET === "string" ? env.INTERNAL_TD_SECRET.trim() : "";
      const headers = secret ? { "X-Vektor-Internal": secret } : {};
      const r = await env.MARKET_SERVICE.fetch(new Request(`https://market-service/td${tdPath}?${qs}`, { method: "GET", headers }));
      if (r && (r.status === 401 || r.status === 403)) {
        warnTdAuth(r.status, Boolean(secret));
        const directKey = getTdKey(env);
        if (directKey) {
          const directQs = new URLSearchParams(qs);
          directQs.set("apikey", directKey);
          return await fetch(`https://api.twelvedata.com${tdPath}?${directQs}`);
        }
      }
      return r;
    }
    if (mode === "proxy") {
      return await fetch(`${tdProxyBase(env)}/td${tdPath}?${qs}`);
    }
    const directQs = new URLSearchParams(qs);
    directQs.set("apikey", mode);
    return await fetch(`https://api.twelvedata.com${tdPath}?${directQs}`);
  } catch (_e) {
    return null;
  }
}

/**
 * Live Twelve Data prices come from the MarketHub's outbound WebSocket cache (service binding `GET /api/quotes`).
 * Twelve Data REST `/quote` is never called for live prices (that was the credit spike); REST stays for candle history only.
 * @returns {Promise<Map<string,{c:number,t:number}>>} internal symbol -> latest WS-fed tick
 */
async function fetchHubQuotes(items, env) {
  const out = new Map();
  if (!env || !env.MARKET_SERVICE || typeof env.MARKET_SERVICE.fetch !== "function" || !items.length) return out;
  const syms = [...new Set(items.map((x) => (typeof x === "string" ? x : x && x.s)).filter(Boolean))];
  for (let i = 0; i < syms.length; i += 100) {
    const chunk = syms.slice(i, i + 100);
    try {
      const r = await env.MARKET_SERVICE.fetch(
        new Request(`https://market-service/api/quotes?symbols=${encodeURIComponent(chunk.join(","))}`, { method: "GET" })
      );
      if (!r || !r.ok) continue;
      const j = await r.json().catch(() => null);
      const quotes = j && j.quotes && typeof j.quotes === "object" ? j.quotes : {};
      for (const [sym, q] of Object.entries(quotes)) {
        const c = Number(q && q.c);
        if (Number.isFinite(c) && c > 0) out.set(sym, { c, t: Number(q.t) > 0 ? Number(q.t) : Date.now() });
      }
    } catch (_e) {
      /* hub unavailable: fall back to Yahoo for these symbols */
    }
  }
  return out;
}

/** WS price wins; Yahoo supplies previous close (percent change) and volume, and is the price fallback. */
function mergeLiveTdQuotes(items, hubQuotes, yahooQuotes) {
  const out = new Map();
  for (const item of items) {
    const h = hubQuotes.get(item.s);
    const y = yahooQuotes.get(item.s);
    if (h) {
      const prev = y && y.prevClose > 0 ? y.prevClose : 0;
      const pct = prev > 0 ? Number((((h.c - prev) / prev) * 100).toFixed(2)) : y && Number.isFinite(y.pct) ? y.pct : 0;
      out.set(item.s, { c: h.c, pct, v: y && y.v > 0 ? y.v : 0, t: Math.floor(h.t / 1000), live: true });
    } else if (y && y.c > 0) {
      out.set(item.s, y);
    }
  }
  return out;
}

async function fetchYahooLiveQuotes(items, concurrency = 10) {
  const out = new Map();
  let idx = 0;
  async function workerTask() {
    while (idx < items.length) {
      const item = items[idx++];
      if (!item) continue;
      const yfSym = toYahooSymbol(item.s, item.api);
      if (!yfSym) continue;
      const q = await fetchYahooQuote(yfSym);
      if (q && q.c > 0) out.set(item.s, q);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => workerTask()));
  return out;
}

function corsHeaders(origin = "*") {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Content-Type",
  };
}

async function fetchBinanceTickers() {
  try {
    const r = await fetchBinanceWithFallback("/api/v3/ticker/24hr", {
      cf: { cacheTtl: 30, cacheEverything: false },
    });
    if (!r || !r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j)) return null;
    return j
      .filter((x) => x.symbol && (x.symbol.endsWith("USDT") || x.symbol.endsWith("BUSD") || x.symbol.endsWith("BTC")) && !STABLE_RE.test(x.symbol) && +x.quoteVolume > 0)
      .sort((a, b) => +b.quoteVolume - +a.quoteVolume)
      .slice(0, 120)
      .map((x) => {
        const known = BY_SYM.get(x.symbol);
        return [
          x.symbol,
          "CRY",
          +x.lastPrice,
          +x.volume,
          1,
          0.02,
          x.symbol,
          "BINANCE:" + x.symbol,
          "bn",
          x.symbol.replace(/(USDT|BUSD|BTC)$/, "/USD"),
          known ? known.name : x.symbol.replace(/(USDT|BUSD|BTC)$/, " / $1"),
          "BINANCE",
          +x.priceChangePercent || 0,
        ];
      });
  } catch (_e) {}
  return null;
}

async function buildScreenerSnapshot(env) {
  const ts = Date.now();
  const tdItems = LIVE_SCREENER_NON_CRYPTO.filter((item) => isTdPrimaryMarket(item.m));
  const otherItems = LIVE_SCREENER_NON_CRYPTO.filter((item) => !isTdPrimaryMarket(item.m));

  const [bnRows, hubQuotes, tdYahooQuotes, otherQuotes] = await Promise.all([
    fetchBinanceTickers(),
    fetchHubQuotes(tdItems, env),
    fetchYahooLiveQuotes(tdItems, 10),
    fetchYahooLiveQuotes(otherItems, 10),
  ]);
  const tdQuotes = mergeLiveTdQuotes(tdItems, hubQuotes, tdYahooQuotes);
  const missingTdYahooQuotes = new Map();
  const seen = new Set();
  const universe = [];

  // Crypto rows come from Binance only; if its tickers are unavailable, crypto is absent rather than another feed.
  if (bnRows && bnRows.length) {
    for (const row of bnRows) {
      seen.add(row[0]);
      universe.push(row);
    }
  }

  for (const item of LIVE_SCREENER_NON_CRYPTO) {
    if (seen.has(item.s)) continue;
    const q = tdQuotes.get(item.s) || missingTdYahooQuotes.get(item.s) || otherQuotes.get(item.s);
    if (!q || !(q.c > 0)) continue;
    seen.add(item.s);
    universe.push([
      item.s,
      item.m,
      q.c,
      q.v || 0,
      item.cs,
      item.vf,
      item.api,
      item.tv,
      item.pr,
      resolveTdSymbol(item.td || item.s, item.s),
      item.name,
      item.ex,
      q.pct,
    ]);
  }

  const sources = [];
  if (bnRows && bnRows.length) sources.push("binance");
  if (hubQuotes.size > 0) sources.push("twelvedata");
  if (otherQuotes.size > 0 || tdYahooQuotes.size > 0) sources.push("yahoo");
  return {
    ok: true,
    ts,
    tfs: ["1D", "1H"],
    source: sources.length ? `edge+${sources.join("+")}` : "edge+unavailable",
    count: universe.length,
    universe,
  };
}

async function refreshScreenerSnapshot(env) {
  const payload = await buildScreenerSnapshot(env);
  const body = JSON.stringify(payload);
  if (env.SCREENER_KV) {
    await env.SCREENER_KV.put("screener:snapshot:v1", body, { expirationTtl: 300 });
  }
  return { payload, body };
}

// Pure-JS LZMA1 decoder for Dukascopy .bi5 binary candle archives
function lzmaDecompress(bytes) {
  if (!bytes || bytes.length < 13) return new Uint8Array(0);
  const prop = bytes[0];
  if (prop >= 225) return new Uint8Array(0);
  const lc = prop % 9;
  const rem = (prop / 9) | 0;
  const lp = rem % 5;
  const pb = (rem / 5) | 0;
  const pbMask = (1 << pb) - 1;
  const lpMask = (1 << lp) - 1;
  let dictSize =
    bytes[1] | (bytes[2] << 8) | (bytes[3] << 16) | ((bytes[4] << 24) >>> 0);
  if (dictSize < 4096) dictSize = 4096;

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lo = dv.getUint32(5, true);
  const hi = dv.getUint32(9, true);
  const knownSize = !(lo === 0xffffffff && hi === 0xffffffff);
  const outSize = knownSize ? hi * 4294967296 + lo : 0;
  if (knownSize && (outSize === 0 || outSize > 16 * 1024 * 1024)) {
    return new Uint8Array(0);
  }

  let pos = 13;
  let code = 0;
  let range = 0xffffffff >>> 0;
  for (let i = 0; i < 5; i++) {
    code = ((code << 8) | (pos < bytes.length ? bytes[pos++] : 0)) >>> 0;
  }

  const initProbs = (n) => new Uint16Array(n).fill(1024);
  const decBit = (probs, idx) => {
    const prob = probs[idx];
    const bound = ((range >>> 11) * prob) >>> 0;
    if (code < bound) {
      range = bound;
      probs[idx] = prob + ((2048 - prob) >>> 5);
      if (!(range & 0xff000000)) {
        range = (range << 8) >>> 0;
        code = ((code << 8) | (pos < bytes.length ? bytes[pos++] : 0)) >>> 0;
      }
      return 0;
    }
    range = (range - bound) >>> 0;
    code = (code - bound) >>> 0;
    probs[idx] = prob - (prob >>> 5);
    if (!(range & 0xff000000)) {
      range = (range << 8) >>> 0;
      code = ((code << 8) | (pos < bytes.length ? bytes[pos++] : 0)) >>> 0;
    }
    return 1;
  };
  const decTree = (probs, offset, bits) => {
    let m = 1;
    for (let i = 0; i < bits; i++) m = (m << 1) | decBit(probs, offset + m);
    return m - (1 << bits);
  };
  const decRevTree = (probs, offset, bits) => {
    let m = 1,
      sym = 0;
    for (let i = 0; i < bits; i++) {
      const b = decBit(probs, offset + m);
      m = (m << 1) | b;
      sym |= b << i;
    }
    return sym;
  };
  const decDirect = (bits) => {
    let res = 0;
    for (let i = bits - 1; i >= 0; i--) {
      range >>>= 1;
      const t = (code - range) >>> 31;
      code = (code - (range & (t - 1))) >>> 0;
      res = (res << 1) | (1 - t);
      if (!(range & 0xff000000)) {
        range = (range << 8) >>> 0;
        code = ((code << 8) | (pos < bytes.length ? bytes[pos++] : 0)) >>> 0;
      }
    }
    return res;
  };
  const makeLenDec = () => ({
    choice: initProbs(2),
    low: initProbs(16 << 3),
    mid: initProbs(16 << 3),
    high: initProbs(256),
  });
  const decLen = (ld, posState) => {
    if (decBit(ld.choice, 0) === 0) return decTree(ld.low, posState << 3, 3);
    if (decBit(ld.choice, 1) === 0) return 8 + decTree(ld.mid, posState << 3, 3);
    return 16 + decTree(ld.high, 0, 8);
  };

  const isMatch = initProbs(12 << 4);
  const isRep = initProbs(12);
  const isRepG0 = initProbs(12);
  const isRepG1 = initProbs(12);
  const isRepG2 = initProbs(12);
  const isRep0Long = initProbs(12 << 4);
  const posSlot = initProbs(4 << 6);
  const posDecoders = initProbs(115);
  const alignDec = initProbs(16);
  const litProbs = initProbs(0x300 << (lc + lp));
  const lenDec = makeLenDec();
  const repLenDec = makeLenDec();

  const out = knownSize ? new Uint8Array(outSize) : [];
  let outPos = 0;
  let state = 0;
  let rep0 = 0,
    rep1 = 0,
    rep2 = 0,
    rep3 = 0;
  const getOut = (idx) => (knownSize ? out[idx] : out[idx]) || 0;
  const pushOut = (v) => {
    if (knownSize) out[outPos++] = v;
    else {
      out.push(v);
      outPos++;
    }
  };

  while (!knownSize ? pos <= bytes.length : outPos < outSize) {
    const posState = outPos & pbMask;
    if (decBit(isMatch, (state << 4) + posState) === 0) {
      const prevByte = outPos > 0 ? getOut(outPos - 1) : 0;
      const litBase = (((outPos & lpMask) << lc) + (prevByte >>> (8 - lc))) * 0x300;
      let sym = 1;
      if (state >= 7) {
        let matchByte = outPos >= rep0 + 1 ? getOut(outPos - rep0 - 1) : 0;
        do {
          const matchBit = (matchByte >>> 7) & 1;
          matchByte <<= 1;
          const bit = decBit(litProbs, litBase + ((1 + matchBit) << 8) + sym);
          sym = (sym << 1) | bit;
          if (matchBit !== bit) break;
        } while (sym < 0x100);
      }
      while (sym < 0x100) sym = (sym << 1) | decBit(litProbs, litBase + sym);
      pushOut(sym - 0x100);
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
    } else {
      let len;
      if (decBit(isRep, state) === 1) {
        if (decBit(isRepG0, state) === 0) {
          if (decBit(isRep0Long, (state << 4) + posState) === 0) {
            state = state < 7 ? 9 : 11;
            pushOut(outPos >= rep0 + 1 ? getOut(outPos - rep0 - 1) : 0);
            continue;
          }
        } else {
          let dist;
          if (decBit(isRepG1, state) === 0) dist = rep1;
          else {
            if (decBit(isRepG2, state) === 0) dist = rep2;
            else {
              dist = rep3;
              rep3 = rep2;
            }
            rep2 = rep1;
          }
          rep1 = rep0;
          rep0 = dist;
        }
        len = 2 + decLen(repLenDec, posState);
        state = state < 7 ? 8 : 11;
      } else {
        rep3 = rep2;
        rep2 = rep1;
        rep1 = rep0;
        len = 2 + decLen(lenDec, posState);
        state = state < 7 ? 7 : 10;
        const lenState = len - 2 < 3 ? len - 2 : 3;
        const ps = decTree(posSlot, lenState << 6, 6);
        if (ps >= 4) {
          const numDirect = (ps >> 1) - 1;
          rep0 = (2 | (ps & 1)) << numDirect;
          if (ps < 14) {
            rep0 += decRevTree(posDecoders, rep0 - ps, numDirect);
          } else {
            rep0 += decDirect(numDirect - 4) << 4;
            rep0 += decRevTree(alignDec, 0, 4);
            if (rep0 === 0xffffffff) break;
          }
        } else {
          rep0 = ps;
        }
      }
      if (rep0 >= outPos) break;
      for (let i = 0; i < len && (!knownSize || outPos < outSize); i++) {
        pushOut(getOut(outPos - rep0 - 1));
      }
    }
    if (!knownSize && outPos > 8 * 1024 * 1024) break;
  }
  return knownSize ? out : new Uint8Array(out);
}

function parseDukascopyBi5(rawBytes, baseEpochSec, scale, refPrice) {
  if (!rawBytes || rawBytes.length < 24) return [];
  const count = Math.floor(rawBytes.length / 24);
  const dv = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
  let adjScale = scale || 100000;
  if (refPrice > 0 && count > 0) {
    const sampleClose = dv.getUint32(8, false);
    if (sampleClose > 0) {
      const candidates = [100000, 10000, 1000, 100, 10, 1];
      let best = adjScale;
      let bestErr = Infinity;
      for (const c of candidates) {
        const err = Math.abs(Math.log10(sampleClose / c / refPrice));
        if (err < bestErr) {
          bestErr = err;
          best = c;
        }
      }
      if (bestErr < 0.8) adjScale = best;
    }
  }
  const bars = [];
  for (let i = 0; i < count; i++) {
    const off = i * 24;
    const tOff = dv.getUint32(off, false);
    const o = dv.getUint32(off + 4, false) / adjScale;
    const c = dv.getUint32(off + 8, false) / adjScale;
    const l = dv.getUint32(off + 12, false) / adjScale;
    const h = dv.getUint32(off + 16, false) / adjScale;
    const v = dv.getFloat32(off + 20, false);
    if (!(c > 0)) continue;
    bars.push({
      t: baseEpochSec + tOff,
      o,
      h: Math.max(o, c, h, l),
      l: Math.min(o, c, h, l),
      c,
      v: isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : 0,
    });
  }
  return bars;
}

function aggregateCandles(bars, targetStep) {
  if (!Array.isArray(bars) || !bars.length) return [];
  if (targetStep <= 60) return bars;
  const buckets = new Map();
  for (const b of bars) {
    const t = Math.floor(b.t / targetStep) * targetStep;
    const cur = buckets.get(t);
    if (!cur) {
      buckets.set(t, { t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 });
    } else {
      if (b.h > cur.h) cur.h = b.h;
      if (b.l < cur.l) cur.l = b.l;
      cur.c = b.c;
      cur.v = Number(((cur.v || 0) + (b.v || 0)).toFixed(2));
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

async function fetchDukascopyBi5Block(url, baseEpochSec, scale, refPrice, kvKey, isImmutable, env) {
  if (env && env.SCREENER_KV && isImmutable) {
    try {
      const hit = await env.SCREENER_KV.get(kvKey, "json");
      if (Array.isArray(hit) && hit.length) return hit;
    } catch (_e) {}
  }
  try {
    const r = await fetch(url, { headers: { "user-agent": "VektorTerminal/1.0" } });
    if (!r.ok) return [];
    const ab = await r.arrayBuffer();
    if (!ab || ab.byteLength < 14) return [];
    const raw = lzmaDecompress(new Uint8Array(ab));
    const bars = parseDukascopyBi5(raw, baseEpochSec, scale, refPrice);
    if (bars.length && env && env.SCREENER_KV && isImmutable) {
      env.SCREENER_KV.put(kvKey, JSON.stringify(bars), { expirationTtl: HISTORICAL_KV_TTL }).catch(() => {});
    }
    return bars;
  } catch (_e) {
    return [];
  }
}

async function fetchDukascopyCandles(rawSym, interval, opts, env, refPrice) {
  const cfg = DUKASCOPY_MAP[rawSym];
  const step = STEPS[interval];
  if (!cfg || !step) return null;

  const limit = Math.max(60, Math.min(5000, Number(opts.limit) || 500));
  const nowSec = Math.floor(Date.now() / 1000);
  const toSec = opts.to > 0 ? Math.min(nowSec, Number(opts.to)) : nowSec;
  const fromSec = opts.from > 0 ? Number(opts.from) : toSec - limit * step;
  const spanDays = Math.ceil((toSec - fromSec) / 86400);
  const todayUtcStart = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) / 1000);

  let rawBars = [];
  if (step >= 86400) {
    const y0 = new Date(fromSec * 1000).getUTCFullYear();
    const y1 = new Date(toSec * 1000).getUTCFullYear();
    const jobs = [];
    for (let y = y0; y <= y1; y++) {
      const base = Math.floor(Date.UTC(y, 0, 1) / 1000);
      const url = `https://datafeed.dukascopy.com/datafeed/${cfg.id}/${y}/BID_candles_day_1.bi5`;
      jobs.push(fetchDukascopyBi5Block(url, base, cfg.scale, refPrice, `duka:1d:${cfg.id}:${y}`, y < new Date().getUTCFullYear(), env));
    }
    const chunks = await Promise.all(jobs);
    rawBars = chunks.flat();
  } else if (step >= 3600 || spanDays > 16) {
    const d0 = new Date(fromSec * 1000);
    const d1 = new Date(toSec * 1000);
    let y = Math.max(2007, d0.getUTCFullYear()), m = d0.getUTCMonth();
    const curY = new Date().getUTCFullYear(), curM = new Date().getUTCMonth();
    const endY = Math.min(curY, d1.getUTCFullYear()), endM = d1.getUTCFullYear() > curY ? curM : d1.getUTCMonth();
    const jobs = [];
    let guard = 0;
    const maxMonths = Math.min(360, Math.max(1, (endY - y) * 12 + (endM - m) + 1));
    while ((y < endY || (y === endY && m <= endM)) && guard++ < maxMonths) {
      const mm = String(m).padStart(2, "0");
      const base = Math.floor(Date.UTC(y, m, 1) / 1000);
      const url = `https://datafeed.dukascopy.com/datafeed/${cfg.id}/${y}/${mm}/BID_candles_hour_1.bi5`;
      const imm = y < curY || (y === curY && m < curM);
      jobs.push(fetchDukascopyBi5Block(url, base, cfg.scale, refPrice, `duka:1h:${cfg.id}:${y}-${mm}`, imm, env));
      if (++m >= 12) { m = 0; y++; }
    }
    const chunks = await Promise.all(jobs);
    rawBars = chunks.flat();
  } else {
    const dayJobs = [];
    const maxDays = Math.min(60, Math.max(2, spanDays + 2));
    const endDay = Math.floor(toSec / 86400) * 86400;
    const startDay = Math.max(endDay - (maxDays - 1) * 86400, Math.floor(fromSec / 86400) * 86400);
    for (let d = startDay; d <= endDay; d += 86400) {
      const dt = new Date(d * 1000);
      if (dt.getUTCDay() === 6) continue;
      const yyyy = dt.getUTCFullYear();
      const mm = String(dt.getUTCMonth()).padStart(2, "0");
      const dd = String(dt.getUTCDate()).padStart(2, "0");
      const url = `https://datafeed.dukascopy.com/datafeed/${cfg.id}/${yyyy}/${mm}/${dd}/BID_candles_min_1.bi5`;
      dayJobs.push(fetchDukascopyBi5Block(url, d, cfg.scale, refPrice, `duka:1m:${cfg.id}:${yyyy}-${mm}-${dd}`, d < todayUtcStart, env));
    }
    const chunks = await Promise.all(dayJobs);
    rawBars = chunks.flat();
  }

  if (!rawBars.length) return null;
  let out = step > 60 && step < 86400 ? aggregateCandles(rawBars, step) : step >= 86400 ? aggregateCandles(rawBars, step) : rawBars;
  if (opts.from > 0) out = out.filter((b) => b.t >= opts.from);
  if (opts.to > 0) out = out.filter((b) => b.t <= opts.to);

  // Seamlessly stitch recent/live bar if fetching near live edge
  if (out.length && (!opts.to || opts.to >= nowSec - step * 2) && refPrice > 0) {
    const lastBar = out[out.length - 1];
    const curBucket = Math.floor(nowSec / step) * step;
    if (lastBar.t === curBucket) {
      lastBar.c = refPrice;
      lastBar.h = Math.max(lastBar.h, refPrice);
      lastBar.l = Math.min(lastBar.l, refPrice);
    } else if (lastBar.t < curBucket && curBucket - lastBar.t <= step * 8) {
      out.push({
        t: curBucket,
        o: lastBar.c || refPrice,
        h: Math.max(lastBar.c || refPrice, refPrice),
        l: Math.min(lastBar.c || refPrice, refPrice),
        c: refPrice,
        v: 120
      });
    }
  }

  if (out.length > limit) out = out.slice(-limit);
  return out.length ? out : null;
}

const TD_MEM_CACHE = new Map();
const TD_IN_FLIGHT = new Map();
const CANDLE_IN_FLIGHT = new Map();

// Last good candle history per normalized window (isolate memory first, then the KV copy that outlives its TTL).
const LAST_GOOD_HISTORY = new Map();
const LAST_GOOD_MAX = 48; // ~5k bars each; bounded for the 128 MB isolate (arrays are usually shared with TD_MEM_CACHE)
const LAST_GOOD_KV_TTL = 7 * 86400;
function rememberLastGoodHistory(key, bars, source) {
  if (!Array.isArray(bars) || !bars.length) return;
  LAST_GOOD_HISTORY.delete(key);
  LAST_GOOD_HISTORY.set(key, { bars, source });
  if (LAST_GOOD_HISTORY.size > LAST_GOOD_MAX) LAST_GOOD_HISTORY.delete(LAST_GOOD_HISTORY.keys().next().value);
}
async function readLastGoodHistory(env, key) {
  const mem = LAST_GOOD_HISTORY.get(key);
  if (mem) return mem;
  if (!env || !env.SCREENER_KV) return null;
  try {
    const j = await env.SCREENER_KV.get(key, "json");
    if (j && Array.isArray(j.bars) && j.bars.length) return { bars: j.bars, source: j.source || "cache" };
  } catch (_e) {}
  return null;
}
const TD_CACHE_TTL_MS = 60000;

function getTdKey(env) {
  return String((env && (env.TWELVEDATA_KEY || env.TWELVE_DATA_API_KEY)) || "").trim();
}

// TASK-02: REST candles go through configured TD_PROXY_URL or server-side TWELVEDATA_KEY (never exposed to browser).
const TD_PROXY_DEFAULT = "";
function tdProxyBase(env) {
  const v = String((env && env.TD_PROXY_URL) || TD_PROXY_DEFAULT).trim().replace(/\/+$/, "");
  return v === "off" ? "" : v;
}
// Truthy when candles/quotes can be fetched from Twelve Data (via MARKET_SERVICE binding, proxy, or direct key).
function tdSource(env) {
  if (env && env.MARKET_SERVICE && typeof env.MARKET_SERVICE.fetch === "function") return "service";
  return tdProxyBase(env) ? "proxy" : getTdKey(env);
}

async function fetchBinanceCandles(apiSym, interval, opts = {}) {
  const bni = BNI[interval];
  const step = STEPS[interval] || 3600;
  if (!bni) return null;
  let bnSym = String(apiSym || "").trim().toUpperCase();
  if (!bnSym.endsWith("USDT") && !bnSym.endsWith("BUSD") && !bnSym.endsWith("BTC")) {
    bnSym = bnSym.endsWith("USD") ? bnSym + "T" : bnSym + "USDT";
  }
  const maxLimit = opts.replay ? 10000 : 1000;
  const limit = Math.max(10, Math.min(maxLimit, Number(opts.limit) || 1000));
  const beforeSec = opts.before > 0 ? Math.floor(opts.before) : 0;
  let endMs = beforeSec > 0 ? beforeSec * 1000 - 1 : (opts.to > 0 ? Number(opts.to) * 1000 : Date.now());
  const startMs = opts.from > 0 ? Number(opts.from) * 1000 : 0;
  const batches = Math.max(1, Math.min(10, Math.ceil(limit / 1000)));
  const all = [];
  let hadUpstreamOk = false;
  let hadUpstreamErr = false;

  for (let b = 0; b < batches; b++) {
    const chunkLim = Math.min(1000, limit - all.length);
    if (chunkLim <= 0) break;
    let chunk = null;
    try {
      const qs = new URLSearchParams({ symbol: bnSym, interval: bni, limit: String(chunkLim) });
      if (beforeSec > 0 || opts.to > 0 || b > 0) qs.set("endTime", String(Math.floor(endMs)));
      if (startMs > 0) qs.set("startTime", String(Math.floor(startMs)));
      const r = await fetchBinanceWithFallback(`/api/v3/klines?${qs}`);
      if (r && r.ok) {
        hadUpstreamOk = true;
        const j = await r.json();
        if (Array.isArray(j) && j.length) {
          chunk = j
            .map((x) => {
              const t = bucketStart(Math.floor(x[0] / 1000), interval);
              return { t, o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] };
            })
            .filter((x) => x.o > 0 && x.h > 0 && x.l > 0 && x.c > 0);
        }
      } else if (!r || r.status !== 400) {
        hadUpstreamErr = true;
      }
    } catch (_e) {
      hadUpstreamErr = true;
    }
    if (!chunk || !chunk.length) break;
    all.unshift(...chunk);
    endMs = chunk[0].t * 1000 - 1;
    if (chunk.length < chunkLim || (startMs > 0 && endMs < startMs)) break;
  }

  if (!all.length) {
    return beforeSec > 0 && hadUpstreamOk && !hadUpstreamErr ? [] : null;
  }
  const uniq = new Map();
  for (const bar of all) uniq.set(bar.t, bar);
  let res = [...uniq.values()].sort((a, b) => a.t - b.t);
  if (beforeSec > 0) res = res.filter((x) => x.t < beforeSec);
  if (opts.from > 0) res = res.filter((x) => x.t >= opts.from);
  if (opts.to > 0) res = res.filter((x) => x.t <= opts.to);
  if (!res.length) {
    return beforeSec > 0 && hadUpstreamOk && !hadUpstreamErr ? [] : null;
  }
  return res.slice(-limit);
}

async function fetchTwelveDataCandles(tdSym, interval, apiKey, opts = {}) {
  const tdi = TDI[interval];
  const step = STEPS[interval] || 3600;
  if (!tdi || !apiKey || !tdSym || String(tdSym).endsWith("=F")) return null;
  const limit = Math.max(10, Math.min(5000, Number(opts.limit) || 5000));
  const beforeSec = opts.before > 0 ? Math.floor(opts.before) : 0;
  const cacheKey = `${tdSym}|${interval}|${opts.from || 0}|${opts.to || 0}|${beforeSec}|${limit}`;
  const memTtlMs = beforeSec > 0 ? 86400 * 1000 : TD_CACHE_TTL_MS;

  if (!opts.refresh) {
    const memHit = TD_MEM_CACHE.get(cacheKey);
    if (memHit && Date.now() - memHit.ts < memTtlMs) {
      return memHit.bars;
    }
  }
  if (TD_IN_FLIGHT.has(cacheKey)) {
    return TD_IN_FLIGHT.get(cacheKey);
  }

  const job = (async () => {
    try {
      const qs = new URLSearchParams({
        symbol: tdSym,
        interval: tdi,
        outputsize: String(limit),
        timezone: "UTC",
      });
      if (beforeSec > 0) {
        qs.set("end_date", new Date((beforeSec - 1) * 1000).toISOString().slice(0, 19).replace("T", " "));
      } else if (opts.to > 0) {
        qs.set("end_date", new Date(opts.to * 1000).toISOString().slice(0, 19).replace("T", " "));
      }
      const r = await fetchTdEndpoint("/time_series", qs, opts.env);
      if (!r || !r.ok) {
        if (r && beforeSec > 0 && (r.status === 400 || r.status === 404)) return [];
        return null;
      }
      const j = await r.json();
      if (j.status === "error" || !Array.isArray(j.values) || !j.values.length) {
        const msg = String((j && j.message) || "");
        if (beforeSec > 0 && j && j.code !== 429 && !/credit|limit|quota|429/i.test(msg)) {
          if (/no data|specified dates|not found|empty/i.test(msg) || !msg) return [];
        }
        return null;
      }
      const byBucket = new Map();
      for (const v of j.values.slice().reverse()) {
        const rawMs = Date.parse(
          v.datetime.length > 10 ? v.datetime.replace(" ", "T") + "Z" : v.datetime + "T00:00:00Z"
        );
        if (!isFinite(rawMs)) continue;
        const t = bucketStart(Math.floor(rawMs / 1000), interval);
        const o = +v.open, h = +v.high, l = +v.low, c = +v.close, vol = +(v.volume || 0);
        if (!(o > 0 && h > 0 && l > 0 && c > 0)) continue;
        byBucket.set(t, { t, o, h: Math.max(h, o, c), l: Math.min(l, o, c), c, v: vol });
      }
      let res = [...byBucket.values()].sort((a, b) => a.t - b.t);
      if (beforeSec > 0) res = res.filter((b) => b.t < beforeSec);
      if (opts.from > 0) res = res.filter((b) => b.t >= opts.from);
      if (opts.to > 0) res = res.filter((b) => b.t <= opts.to);
      if (res.length > limit) res = res.slice(-limit);
      if (res.length) {
        if (TD_MEM_CACHE.size > 300) TD_MEM_CACHE.clear();
        TD_MEM_CACHE.set(cacheKey, { ts: Date.now(), bars: res });
        return res;
      }
      return beforeSec > 0 ? [] : null;
    } catch (_e) {
      return null;
    } finally {
      TD_IN_FLIGHT.delete(cacheKey);
    }
  })();

  TD_IN_FLIGHT.set(cacheKey, job);
  return job;
}

async function handleScreener(request, env, ctx) {
  const t0 = Date.now();
  const url = new URL(request.url);
  const cache = caches.default;
  const cacheKey = new Request(url.origin + "/api/screener", { method: "GET" });

  const edgeHit = await cache.match(cacheKey);
  if (edgeHit) {
    const res = new Response(edgeHit.body, edgeHit);
    res.headers.set("x-cache", "HIT-EDGE");
    res.headers.set("server-timing", `edge;dur=${Date.now() - t0}`);
    return res;
  }

  if (env.SCREENER_KV) {
    const kvRaw = await env.SCREENER_KV.get("screener:snapshot:v1", "text");
    if (kvRaw) {
      const res = new Response(kvRaw, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=30",
          "x-cache": "HIT-KV",
          "server-timing": `kv;dur=${Date.now() - t0}`,
          ...corsHeaders(),
        },
      });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    }
  }

  const { body } = await refreshScreenerSnapshot(env);
  const res = new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=30",
      "x-cache": "MISS",
      "server-timing": `origin;dur=${Date.now() - t0}`,
      ...corsHeaders(),
    },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/**
 * Latest live bars for (symbol, native base interval) from the MarketHub's WebSocket-built store, via the service binding.
 * Returns null when the hub is not bound / unreachable; never throws.
 * @returns {Promise<{bars: object[], provenance: string} | null>}
 */
async function fetchHubBars(env, rawSym, mktHint, baseKey, limit) {
  if (!env || !env.MARKET_SERVICE || typeof env.MARKET_SERVICE.fetch !== "function") return null;
  try {
    const u = new URL("https://market-service/api/bars");
    u.searchParams.set("sym", hubBarsSymbol(rawSym, mktHint));
    u.searchParams.set("tf", hubTfLabel(baseKey));
    u.searchParams.set("limit", String(Math.max(1, Math.min(1500, limit))));
    const r = await env.MARKET_SERVICE.fetch(new Request(u.toString(), { method: "GET" }));
    if (!r || !r.ok) return null;
    const j = await r.json();
    if (!j || j.ok === false || !Array.isArray(j.bars)) return null;
    return { bars: mergeBars([], j.bars), provenance: typeof j.provenance === "string" ? j.provenance : PROVENANCE.LIVE };
  } catch (_e) {
    return null;
  }
}

/**
 * Historical candles for the NATIVE interval `iv.base`, cached server-side (edge cache + KV + in-flight dedupe).
 * Custom timeframes (3m, 45m, 2H, 3M ...) share the base interval's cache entry; they are resampled afterwards.
 * @returns {Promise<{bars: object[]|null, source: string, cache: string}>}
 */
async function loadCandleHistory(p) {
  const { env, ctx, cache, t0, rawSym, meta, tdKey, isCrypto, iv, fromSec, toSec, beforeSec, fetchLimit, replay, refresh, ttl, isHistoricalChunk, isHistoricalReplay } = p;
  const base = iv.base;
  // Crypto is Binance-only (same series as the hub's live Binance bars). Entries cached before that rule, e.g. Yahoo
  // fallbacks, are never served for crypto.
  const usable = (source) => !isCrypto || /^binance/.test(String(source || ""));
  const normUrl = `${p.origin}/api/candles?symbol=${encodeURIComponent(rawSym)}&interval=${encodeURIComponent(base)}&from=${fromSec}&to=${toSec}&before=${beforeSec}&limit=${fetchLimit}&replay=${replay ? 1 : 0}`;
  const cacheKey = new Request(normUrl, { method: "GET" });

  if (!refresh && cache) {
    const edgeHit = await cache.match(cacheKey);
    if (edgeHit) {
      try {
        const j = await edgeHit.clone().json();
        if (j && Array.isArray(j.bars) && usable(j.source)) return { bars: j.bars, source: j.source || "cache", cache: "HIT-EDGE" };
      } catch (_e) {}
    }
  }

  const kvKey = `candles:${rawSym}:${base}:${fromSec}:${toSec}:${beforeSec}:${fetchLimit}:${replay ? 1 : 0}`;
  if (!refresh && env.SCREENER_KV) {
    const kvCached = await env.SCREENER_KV.get(kvKey, "json");
    if (
      kvCached &&
      Array.isArray(kvCached.bars) &&
      usable(kvCached.source) &&
      (kvCached.bars.length || isHistoricalChunk) &&
      (isHistoricalChunk || isHistoricalReplay || Date.now() - kvCached.ts < ttl * 1000)
    ) {
      return { bars: kvCached.bars, source: kvCached.source || "cache", cache: "HIT-KV" };
    }
  }

  const opts = { from: fromSec, to: toSec, before: beforeSec, limit: fetchLimit, replay, refresh, env };
  const flightKey = kvKey;
  let resultPromise = CANDLE_IN_FLIGHT.get(flightKey);
  if (!resultPromise) {
    resultPromise = (async () => {
      let bars = null;
      let source = "none";

      if (replay) {
        // Offline Backtest Replay mode ONLY (Dukascopy strictly isolated here)
        if (isCrypto) {
          bars = await fetchBinanceCandles(meta.api || rawSym, base, opts);
          if (bars) source = "binance";
        } else if (DUKASCOPY_MAP[rawSym]) {
          bars = await fetchDukascopyCandles(rawSym, base, opts, env, meta.p);
          if (bars) source = "dukascopy";
        }
        if (!bars && !isCrypto && tdKey) {
          const tdResolved = toTdApiSymbol(rawSym, meta);
          if (tdResolved) {
            bars = await fetchTwelveDataCandles(tdResolved, base, tdKey, opts);
            if (bars) source = "twelvedata";
          }
        }
        if (!bars && !isCrypto) {
          bars = await fetchYahooCandles(toYahooSymbol(rawSym, meta.api), base, opts);
          if (bars && bars.length) source = "yahoo";
        }
      } else {
        // Live Workspace & Supercharts: Single-Source-Per-Chart Routing (Zero Cross-Feed Mixing, Zero Synthetic Data)
        if (isCrypto) {
          // Binance only. On failure the caller serves last good Binance history, then the hub's Binance-fed bars.
          bars = await fetchBinanceCandles(meta.api || rawSym, base, opts);
          if (bars !== null) source = "binance";
        } else {
          if (tdKey) {
            const tdResolved = toTdApiSymbol(rawSym, meta);
            if (tdResolved) {
              bars = await fetchTwelveDataCandles(tdResolved, base, tdKey, opts);
              if (bars !== null) source = "twelvedata";
            }
          }
          if (bars === null) {
            bars = await fetchYahooCandles(toYahooSymbol(rawSym, meta.api), base, opts);
            if (bars !== null) source = "yahoo";
          }
        }
      }

      return { bars, source };
    })().finally(() => {
      CANDLE_IN_FLIGHT.delete(flightKey);
    });
    CANDLE_IN_FLIGHT.set(flightKey, resultPromise);
  }

  const { bars, source } = await resultPromise;
  if (bars === null || (!bars.length && !isHistoricalChunk)) {
    // Upstream failed (credits, 429, Yahoo block, refresh=1 during an outage): serve the last good history for this
    // exact window rather than letting the caller drop to the hub's few tick-built bars (the "single 15m/4H candle").
    const stale = await readLastGoodHistory(env, kvKey);
    if (stale && usable(stale.source)) return { bars: stale.bars, source: `${stale.source}+stale`, cache: "STALE" };
    return { bars: null, source, cache: "MISS" };
  }
  if (!isHistoricalChunk && !replay) rememberLastGoodHistory(kvKey, bars, source);

  const body = JSON.stringify({ ok: true, symbol: rawSym, interval: base, ttl, ts: Date.now(), source, bars });
  if (ctx && typeof ctx.waitUntil === "function") {
    const edgeRes = new Response(body, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${ttl}, s-maxage=${ttl}` },
    });
    ctx.waitUntil(
      Promise.all([
        cache ? cache.put(cacheKey, edgeRes) : Promise.resolve(),
        // Freshness is judged from `ts` on read; the entry outlives its TTL so it can back a stale fallback.
        env.SCREENER_KV ? env.SCREENER_KV.put(kvKey, body, { expirationTtl: Math.max(LAST_GOOD_KV_TTL, ttl) }) : Promise.resolve(),
      ])
    );
  }
  return { bars, source, cache: "MISS" };
}

async function handleCandles(request, env, ctx) {
  const t0 = Date.now();
  const url = new URL(request.url);
  const rawSym = (url.searchParams.get("symbol") || "").trim().toUpperCase();
  const iv = resolveInterval(url.searchParams.get("interval") || "1H");
  const mktHint = (url.searchParams.get("mkt") || "").trim().toUpperCase();
  const apiHint = (url.searchParams.get("apiSym") || "").trim();
  const fromSec = Math.max(0, Math.floor(Number(url.searchParams.get("from")) || 0));
  const toSec = Math.max(0, Math.floor(Number(url.searchParams.get("to")) || 0));
  const rawBefore = Number(url.searchParams.get("before")) || 0;
  const beforeSec = rawBefore > 0 ? Math.floor(rawBefore > 1e11 ? rawBefore / 1000 : rawBefore) : 0;
  const replay = url.searchParams.get("replay") === "1";
  const refresh = url.searchParams.get("refresh") === "1";

  if (!rawSym || !iv) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid symbol or interval" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
    });
  }

  // Canonical interval key: "5m" / "5min" / "5M" and "1h" / "1H" / "60m" all share cache entries; "1m" (minute) != "1M" (month).
  const interval = iv.key;
  const meta = inferMeta(rawSym, mktHint, apiHint);
  const tdKey = tdSource(env);
  const isCrypto = meta.pr === "bn" || meta.m === "CRY" || rawSym.endsWith("USDT") || rawSym.endsWith("BUSD") || rawSym.endsWith("BTC");
  const rawLimit = Math.floor(Number(url.searchParams.get("limit")) || 0);
  const defaultLimit = replay ? (fromSec || toSec ? 1500 : 1000) : (isCrypto ? 1000 : 5000);
  const limit = Math.max(10, Math.min(5000, rawLimit || defaultLimit));
  // Custom timeframes are resampled from `iv.base` bars; request enough base bars to cover `limit` resampled bars.
  const providerMax = replay ? (isCrypto ? 10000 : 5000) : (isCrypto ? 1000 : 5000);
  const fetchLimit = iv.native ? limit : Math.max(10, Math.min(providerMax, limit * iv.ratio));

  const nowSec = Math.floor(Date.now() / 1000);
  const step = iv.step;
  const isHistoricalChunk = beforeSec > 0;
  const isHistoricalReplay = replay && ((toSec > 0 && toSec < nowSec - step * 4) || (fromSec > 0 && !toSec && limit > 250));
  const ttl = isHistoricalChunk ? 86400 : isHistoricalReplay ? HISTORICAL_KV_TTL : 60;
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;

  const hist = await loadCandleHistory({
    env, ctx, cache, t0, origin: url.origin, rawSym, meta, tdKey, isCrypto, iv,
    fromSec, toSec, beforeSec, fetchLimit, replay, refresh, ttl, isHistoricalChunk, isHistoricalReplay,
  });

  if (hist.bars === null) {
    return new Response(
      JSON.stringify({ ok: false, symbol: rawSym, interval, source: hist.source, error: "Upstream candle feed unavailable" }),
      {
        status: 502,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders() },
      }
    );
  }

  let bars = hist.bars;
  let source = hist.source;
  let provenance = PROVENANCE.CACHED;
  let live = false;

  // Lay the hub's live WebSocket bars over the REST history: fills holes left by WS disconnects, extends past REST lag,
  // and keeps the forming candle current. Applied per request (never cached) at the base interval, before resampling.
  const overlayEligible = !replay && !isHistoricalChunk && (toSec === 0 || toSec >= nowSec - step * 2);
  if (overlayEligible) {
    const hub = await fetchHubBars(env, rawSym, mktHint, iv.base, fetchLimit);
    if (hub && hub.bars.length) {
      bars = overlayLiveBars(bars, hub.bars);
      if (fromSec > 0) bars = bars.filter((b) => b.t >= fromSec);
      source = `${source}+hub`;
      provenance = hub.provenance;
      live = true;
    }
  }

  if (!iv.native) {
    const truncated = bars.length >= fetchLimit;
    bars = rollup(bars, interval);
    if (isHistoricalChunk) bars = bars.filter((b) => b.t < beforeSec);
    if (truncated && bars.length > 1) bars = bars.slice(1); // oldest bucket may be partial when the base window was cut
  }
  if (bars.length > limit) bars = bars.slice(-limit);

  if (!bars.length && !isHistoricalChunk) {
    return new Response(
      JSON.stringify({ ok: false, symbol: rawSym, interval, source, error: "Upstream candle feed unavailable" }),
      {
        status: 502,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...corsHeaders() },
      }
    );
  }

  const payload = {
    ok: true,
    symbol: rawSym,
    interval,
    ttl: live ? 0 : ttl,
    ts: Date.now(),
    source,
    provenance,
    hasMore: isHistoricalChunk ? bars.length > 0 : true,
    bars,
  };
  return new Response(JSON.stringify(payload), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": live || source === "simulator" ? "no-store" : `public, max-age=${ttl}, s-maxage=${ttl}`,
      "x-cache": hist.cache,
      "x-provenance": provenance,
      "server-timing": `origin;dur=${Date.now() - t0}`,
      ...corsHeaders(),
    },
  });
}

async function handleCalendar(request, env, ctx) {
  const t0 = Date.now();
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const cache = caches.default;
  const normUrl = `${url.origin}/api/calendar`;
  const cacheKey = new Request(normUrl, { method: "GET" });

  if (!force) {
    const edgeHit = await cache.match(cacheKey);
    if (edgeHit) {
      const res = new Response(edgeHit.body, edgeHit);
      res.headers.set("x-cache", "HIT-EDGE");
      res.headers.set("server-timing", `edge;dur=${Date.now() - t0}`);
      return res;
    }

    if (env.SCREENER_KV) {
      const kvCached = await env.SCREENER_KV.get("calendar:week:v1", "json");
      if (kvCached && Array.isArray(kvCached.events) && kvCached.events.length && Date.now() - kvCached.ts < 900 * 1000) {
        const res = new Response(JSON.stringify(kvCached), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "public, max-age=300, s-maxage=900",
            "x-cache": "HIT-KV",
            "server-timing": `kv;dur=${Date.now() - t0}`,
            ...corsHeaders(),
          },
        });
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      }
    }
  }

  let events = null;
  let source = "macro-schedule";
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4500);
    const resp = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
      signal: ac.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; VektorTerminal/1.0)",
        accept: "application/json",
      },
    });
    clearTimeout(timer);
    if (resp.ok) {
      const json = await resp.json();
      if (Array.isArray(json) && json.length) {
        const impSet = new Set(["High", "Medium", "Low", "Holiday"]);
        events = json
          .filter((e) => e && typeof e.title === "string" && typeof e.date === "string" && isFinite(Date.parse(e.date)))
          .map((e) => {
            const hasTime = /T\d{2}:\d{2}/.test(e.date) && !(e.time && /all\s*day|tentative/i.test(String(e.time))) && e.impact !== "Holiday";
            return {
              t: Date.parse(e.date),
              hasTime,
              title: e.title.slice(0, 140),
              ccy: String(e.country || "").toUpperCase().slice(0, 4),
              imp: impSet.has(e.impact) ? e.impact : "Low",
              fc: String(e.forecast == null ? "" : e.forecast).slice(0, 24),
              pv: String(e.previous == null ? "" : e.previous).slice(0, 24),
              act: String(e.actual == null ? "" : e.actual).slice(0, 24),
            };
          })
          .sort((a, b) => a.t - b.t);
        if (events.length) source = "forexfactory";
      }
    }
  } catch (_e) {}

  if (!events || !events.length) {
    events = [];
    source = "unavailable";
  }

  const payload = { ok: true, source, ts: Date.now(), ttl: 900, events };
  const body = JSON.stringify(payload);
  const res = new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=900",
      "x-cache": "MISS",
      "server-timing": `origin;dur=${Date.now() - t0}`,
      ...corsHeaders(),
    },
  });

  ctx.waitUntil(
    Promise.all([
      cache.put(cacheKey, res.clone()),
      env.SCREENER_KV ? env.SCREENER_KV.put("calendar:week:v1", body, { expirationTtl: 900 }) : Promise.resolve(),
    ])
  );
  return res;
}

function decodeXmlEntities(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .trim();
}

async function handleNews(request, env, ctx) {
  const t0 = Date.now();
  const url = new URL(request.url);
  const sym = (url.searchParams.get("symbol") || "").trim().toUpperCase().slice(0, 24);
  if (!sym) {
    return new Response(JSON.stringify({ ok: false, error: "Missing symbol" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
    });
  }

  const cache = caches.default;
  const normUrl = `${url.origin}/api/news?symbol=${encodeURIComponent(sym)}`;
  const cacheKey = new Request(normUrl, { method: "GET" });
  const edgeHit = await cache.match(cacheKey);
  if (edgeHit) {
    const res = new Response(edgeHit.body, edgeHit);
    res.headers.set("x-cache", "HIT-EDGE");
    return res;
  }

  let items = [];
  let source = "yahoo";
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(sym)}&region=US&lang=en-US`;
    const resp = await fetch(rssUrl, {
      signal: ac.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; VektorTerminal/1.0)", accept: "application/rss+xml, application/xml, text/xml" },
    });
    clearTimeout(timer);
    if (resp.ok) {
      const xml = await resp.text();
      const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const blk of blocks.slice(0, 20)) {
        const titleM = /<title>([\s\S]*?)<\/title>/i.exec(blk);
        const linkM = /<link>([\s\S]*?)<\/link>/i.exec(blk);
        const pubM = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(blk);
        const title = decodeXmlEntities(titleM ? titleM[1] : "").slice(0, 200);
        let link = decodeXmlEntities(linkM ? linkM[1] : "");
        try {
          const parsed = new URL(link);
          link = /^https?:$/.test(parsed.protocol) ? parsed.href : "";
        } catch (_e) {
          link = "";
        }
        const t = pubM ? Date.parse(decodeXmlEntities(pubM[1])) : NaN;
        if (title && link) items.push({ title, link, t: isFinite(t) ? t : null });
      }
    } else {
      source = "unavailable";
    }
  } catch (_e) {
    source = "unavailable";
  }

  const body = JSON.stringify({ ok: true, symbol: sym, source, ts: Date.now(), items });
  const res = new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
      "x-cache": "MISS",
      "server-timing": `origin;dur=${Date.now() - t0}`,
      ...corsHeaders(),
    },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

async function handleWsConfig(request, env, _ctx) {
  // TASK-02: never send a Twelve Data key to the browser.
  return new Response(JSON.stringify({ ok: true, tdKey: "" }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(),
    },
  });
}

async function handleQuote(request, env, _ctx) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get("symbols") || url.searchParams.get("symbol") || "").trim();
  const list = raw ? raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 24) : ["BTCUSDT"];
  const quotes = {};
  const now = Math.floor(Date.now() / 1000);
  await Promise.all(
    list.map(async (s) => {
      const meta = inferMeta(s);
      const isCry = meta.pr === "bn" || meta.m === "CRY" || s.endsWith("USDT") || s.endsWith("BUSD") || s.endsWith("BTC");
      if (isCry) {
        const r = await fetchBinanceWithFallback(`/api/v3/ticker/price?symbol=${encodeURIComponent(meta.api || s)}`);
        if (r && r.ok) {
          const j = await r.json().catch(() => null);
          const px = j && Number(j.price);
          if (Number.isFinite(px) && px > 0) {
            quotes[s] = { s, c: px, t: now, m: meta.m || "CRY", source: "binance" };
          }
        }
        // Crypto quotes: Binance only.
      } else {
        if (isTdPrimaryMarket(meta.m || "STK")) {
          const hq = (await fetchHubQuotes([s], env)).get(s);
          if (hq) {
            quotes[s] = { s, c: hq.c, t: Math.floor(hq.t / 1000) || now, m: meta.m || "STK", source: "twelvedata" };
          }
        }
        if (!quotes[s]) {
          const q = await fetchYahooQuote(toYahooSymbol(s, meta.api));
          if (q && q.c > 0) {
            quotes[s] = { s, c: q.c, t: q.t || now, m: meta.m || "STK", source: "yahoo" };
          }
        }
      }
    })
  );
  return new Response(JSON.stringify({ ok: true, ts: Date.now(), quotes }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-cache",
      ...corsHeaders(),
    },
  });
}

// Durable Object using the WebSocket Hibernation API for /ws fan-out (live Twelve Data + Binance upstream WebSockets)
export class MarketRelayDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.binanceFeed = null; // shared/market/binanceFeed.js: backoff, 24h rotation, serverShutdown, stall watchdog
    this.tdWs = null;
    this.tdSlots = new TdSubscriptionManager({
      maxSlots: Math.max(1, Number(env && env.TD_WS_MAX) || 8),
    });
    this.tickGuard = createTickGuard();
    this.candles = createCandleBuilder({
      timeframes: ["1m", "5m", "15m", "30m", "1H", "4H", "1D", "1W"],
      openMode: "auto",
    });
    this.prices = new Map();
    this.lastTdMsg = 0;
  }

  _nextSeq(ws) {
    const att = (typeof ws.deserializeAttachment === "function" && ws.deserializeAttachment()) || { subs: [], interval: "1H", seq: 0 };
    const next = (Number(att.seq) || 0) + 1;
    att.seq = next;
    if (typeof ws.serializeAttachment === "function") {
      try { ws.serializeAttachment(att); } catch (_e) {}
    }
    return next;
  }

  _sendV2(ws, type, payload, seqOverride) {
    try {
      const seq = seqOverride !== undefined ? seqOverride : (type === "pong" ? 0 : this._nextSeq(ws));
      ws.send(JSON.stringify({ v: 2, seq, type, ...payload }));
    } catch (_e) {}
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // WebSocket Hibernation API: ctx.acceptWebSocket enables hibernation when idle
    this.ctx.acceptWebSocket(server, ["client"]);
    server.serializeAttachment({ subs: [], chart: null, interval: "1H", seq: 0 });

    this.ensureUpstream();
    await this.scheduleNextTick();

    this._sendV2(server, "hello", {
      serverTime: Date.now(),
      capabilities: ["bars", "quotes", "screener", "heatmap"],
      relay: "MarketRelayDO",
      hibernation: true,
      mode: getTdKey(this.env) ? "live+twelvedata" : "live",
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  _collectTdDemand() {
    const chartSymbols = [];
    const requestedSymbols = [];
    const activeViewers = new Map();
    const seenChart = new Set();
    const sockets = this.ctx.getWebSockets("client");

    for (const ws of sockets) {
      const att = ws.deserializeAttachment() || {};
      const clientSet = new Set();
      if (att.chart && att.chart.sym) {
        const s = normSymbol(att.chart.sym);
        if (s) {
          clientSet.add(s);
          if (!seenChart.has(s)) {
            seenChart.add(s);
            chartSymbols.push(s);
          }
        }
      }
      if (Array.isArray(att.subs)) {
        for (const raw of att.subs) {
          const s = normSymbol(raw);
          if (s) {
            clientSet.add(s);
            requestedSymbols.push(s);
          }
        }
      }
      for (const s of clientSet) {
        activeViewers.set(s, (activeViewers.get(s) || 0) + 1);
      }
    }
    return { chartSymbols, requestedSymbols, activeViewers };
  }

  _syncTdSubscriptions() {
    if (!this.tdWs || this.tdWs.readyState !== 1) return;
    const { toUnsubscribe, toSubscribe } = this.tdSlots.reconcile(this._collectTdDemand());
    if (toUnsubscribe.length) {
      const tdList = toUnsubscribe.map((x) => x.tdSym).filter(Boolean);
      if (tdList.length) {
        try {
          this.tdWs.send(JSON.stringify({ action: "unsubscribe", params: { symbols: tdList.join(",") } }));
        } catch (_e) {}
      }
    }
    if (toSubscribe.length) {
      const tdList = toSubscribe.map((x) => x.tdSym).filter(Boolean);
      if (tdList.length) {
        try {
          this.tdWs.send(JSON.stringify({ action: "subscribe", params: { symbols: tdList.join(",") } }));
        } catch (_e) {}
      }
    }
  }

  _replayCachedPrices(ws, syms) {
    const quotes = [];
    const now = Date.now();
    for (const s of syms) {
      const c = this.prices.get(s);
      if (Number(c) > 0) {
        quotes.push({
          s,
          c: Number(c),
          t: now,
          provenance: this.tdWs && this.tdSlots.has(s) ? PROVENANCE.LIVE : PROVENANCE.CACHED,
        });
      }
    }
    if (quotes.length) {
      this._sendV2(ws, "quotes", { quotes: quotes.slice(0, 24) });
    }
  }

  async webSocketMessage(ws, message) {
    try {
      const msg = typeof message === "string" ? JSON.parse(message) : null;
      if (!msg) return;

      if (msg.op === "ping" || msg.type === "ping") {
        this._sendV2(ws, "pong", { t: msg.t || Date.now() }, 0);
        return;
      }

      if (msg.op === "hello") {
        this._sendV2(ws, "hello", {
          serverTime: Date.now(),
          capabilities: ["bars", "quotes", "screener", "heatmap"],
          ...(msg.session ? { session: msg.session } : {}),
        });
        return;
      }

      if (msg.op === "view") {
        const prev = ws.deserializeAttachment() || { subs: [], chart: null, interval: "1H", seq: 0 };
        const nextSubs = new Set();
        let chart = prev.chart || null;
        if (msg.chart && msg.chart.sym) {
          const sym = normSymbol(msg.chart.sym);
          if (sym) {
            chart = { sym, tf: msg.chart.tf || prev.interval || "1H" };
            nextSubs.add(sym);
          }
        } else if (msg.chart === null) {
          chart = null;
        }
        if (Array.isArray(msg.watchlist)) {
          for (const raw of msg.watchlist) {
            const s = normSymbol(raw);
            if (s) nextSubs.add(s);
          }
        } else if (Array.isArray(prev.subs)) {
          for (const s of prev.subs) nextSubs.add(s);
        }
        ws.serializeAttachment({
          ...prev,
          chart,
          interval: (chart && chart.tf) || prev.interval || "1H",
          subs: [...nextSubs],
        });
        this.ensureUpstream();
        this._syncTdSubscriptions();
        this._replayCachedPrices(ws, nextSubs);
        await this.scheduleNextTick();
        return;
      }

      if (msg.type === "subscribe") {
        const prev = ws.deserializeAttachment() || { subs: [], chart: null, interval: "1H", seq: 0 };
        const nextSubs = Array.isArray(msg.symbols)
          ? msg.symbols.map((s) => normSymbol(s)).filter(Boolean)
          : msg.symbol
            ? [normSymbol(msg.symbol)].filter(Boolean)
            : prev.subs;
        const interval = msg.interval && STEPS[msg.interval] ? msg.interval : prev.interval || "1H";
        ws.serializeAttachment({ ...prev, subs: [...new Set(nextSubs)], interval });
        this.ensureUpstream();
        this._syncTdSubscriptions();
        await this.scheduleNextTick();
      }
    } catch (_e) {}
  }

  async webSocketClose(ws, code, reason) {
    try {
      ws.close(code || 1000, reason || "Closed");
    } catch (_e) {}
    this.cleanupIfEmpty();
  }

  async webSocketError(ws) {
    try {
      ws.close(1011, "WebSocket error");
    } catch (_e) {}
    this.cleanupIfEmpty();
  }

  cleanupIfEmpty() {
    if (this.ctx.getWebSockets("client").length === 0) {
      if (this.binanceFeed) {
        this.binanceFeed.stop();
        this.binanceFeed = null;
      }
      if (this.tdWs) {
        try { this.tdWs.close(); } catch (_e) {}
        this.tdWs = null;
      }
      this.tdSlots.resetActive();
    } else {
      this._syncTdSubscriptions();
    }
  }

  async scheduleNextTick() {
    if (this.ctx.getWebSockets("client").length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 10000);
    }
  }

  broadcastQuotes(quotes) {
    if (!Array.isArray(quotes) || !quotes.length) return;
    for (const ws of this.ctx.getWebSockets("client")) {
      const att = ws.deserializeAttachment() || {};
      const subs = new Set(Array.isArray(att.subs) ? att.subs : []);
      if (att.chart && att.chart.sym) subs.add(att.chart.sym);
      const filtered = subs.size ? quotes.filter((q) => subs.has(q.s)) : quotes;
      if (!filtered.length) continue;
      this._sendV2(ws, "quotes", { quotes: filtered.slice(0, 24) });
    }
  }

  broadcastBarUpdates(sym, updates) {
    if (!sym || !updates) return;
    for (const ws of this.ctx.getWebSockets("client")) {
      const att = ws.deserializeAttachment() || {};
      const chartSym = att.chart && att.chart.sym ? att.chart.sym : null;
      if (chartSym !== sym) continue;
      const tf = (att.chart && att.chart.tf) || att.interval || "1H";
      const u = updates[tf];
      if (!u || u.ignored || !u.bar) continue;
      if (u.closedBar) {
        const cb = u.closedBar;
        this._sendV2(ws, "bar", {
          sym,
          tf,
          closed: true,
          bar: [cb.t, cb.o, cb.h, cb.l, cb.c, cb.v || 0],
        });
      }
      const b = u.bar;
      this._sendV2(ws, "bar", {
        sym,
        tf,
        closed: false,
        bar: [b.t, b.o, b.h, b.l, b.c, b.v || 0],
      });
    }
  }

  ensureUpstream() {
    if (resolveCryptoProvider(this.env) === "binance" && !this.binanceFeed) {
      this.binanceFeed = new BinanceMiniTickerFeed({
        // symbols already carried by a Twelve Data slot are skipped here (no double feed)
        accept: (sym) => sym.endsWith("USDT") && !STABLE_RE.test(sym) && !(this.tdWs && this.tdSlots.has(sym)),
        onRows: (rows) => {
          const now = Date.now();
          const quotes = [];
          for (const t of rows) {
            this.prices.set(t.s, t.c);
            const pct = t.o > 0 ? ((t.c - t.o) / t.o) * 100 : NaN;
            quotes.push({
              s: t.s,
              c: t.c,
              t: now,
              ...(Number.isFinite(t.v) && t.v >= 0 ? { v: t.v } : {}),
              ...(Number.isFinite(pct) ? { chgPct: Number(pct.toFixed(2)) } : {}),
              provenance: PROVENANCE.LIVE,
            });
          }
          if (quotes.length) this.broadcastQuotes(quotes);
        },
      });
      this.binanceFeed.start();
    }

    const tdKey = getTdKey(this.env);
    if (tdKey && !this.tdWs) {
      try {
        fetch(`https://ws.twelvedata.com/v1/quotes/price?apikey=${encodeURIComponent(tdKey)}`, {
          headers: { Upgrade: "websocket", "X-TD-APIKEY": tdKey },
        })
          .then((resp) => {
            const ws = resp && resp.webSocket;
            if (!ws) return;
            ws.accept();
            this.tdWs = ws;
            this.lastTdMsg = Date.now();
            this.tdSlots.resetActive();
            this._syncTdSubscriptions();
            ws.addEventListener("message", (ev) => {
              this.lastTdMsg = Date.now();
              try {
                const d = JSON.parse(ev.data);
                if (!d || typeof d !== "object") return;
                if (d.event === "subscribe-status") {
                  const { released } = this.tdSlots.handleSubscribeStatus(d);
                  if (released.length > 0) this._syncTdSubscriptions();
                  return;
                }
                if (d.event === "price" && d.symbol && Number(d.price) > 0) {
                  const sym = this.tdSlots.resolveInternal(d.symbol);
                  if (!sym) return;
                  const price = Number(d.price);
                  const rawT = Number(d.timestamp ?? Date.now());
                  const tsMs = Number.isFinite(rawT) && rawT > 0 ? (rawT < 1e12 ? rawT * 1000 : rawT) : Date.now();
                  const checked = this.tickGuard({ s: sym, c: price, t: tsMs });
                  if (!checked) return;
                  this.prices.set(sym, price);
                  const quote = {
                    s: sym,
                    c: price,
                    t: tsMs,
                    provenance: PROVENANCE.LIVE,
                  };
                  if (Number(d.bid) > 0) quote.bid = Number(d.bid);
                  if (Number(d.ask) > 0 && (!quote.bid || Number(d.ask) >= quote.bid)) quote.ask = Number(d.ask);
                  if (Number(d.day_volume) >= 0) quote.v = Number(d.day_volume);
                  this.broadcastQuotes([quote]);
                  const updates = this.candles.onTick({
                    s: sym,
                    p: price,
                    t: Math.floor(tsMs / 1000),
                  });
                  this.broadcastBarUpdates(sym, updates);
                }
              } catch (_e) {}
            });
            ws.addEventListener("close", () => { this.tdWs = null; this.tdSlots.resetActive(); });
            ws.addEventListener("error", () => { this.tdWs = null; this.tdSlots.resetActive(); });
          })
          .catch(() => { this.tdWs = null; });
      } catch (_e) {}
    }
  }

  // Hibernation alarm: sends Twelve Data 10s heartbeat & keeps live upstream WebSockets healthy (zero simulated ticks)
  async alarm() {
    const clients = this.ctx.getWebSockets("client");
    if (!clients.length) {
      this.cleanupIfEmpty();
      return;
    }

    if (this.tdWs) {
      if (this.lastTdMsg > 0 && Date.now() - this.lastTdMsg > 30000) {
        try { this.tdWs.close(); } catch (_e) {}
        this.tdWs = null;
        this.tdSlots.resetActive();
      } else {
        try { this.tdWs.send('{"action":"heartbeat"}'); } catch (_e) {}
      }
    }

    if (this.binanceFeed) this.binanceFeed.check();
    this.ensureUpstream();
    this._syncTdSubscriptions();
    await this.ctx.storage.setAlarm(Date.now() + 10000);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/api/screener") {
      return handleScreener(request, env, ctx);
    }

    if (url.pathname === "/api/candles") {
      return handleCandles(request, env, ctx);
    }

    if (url.pathname === "/api/ws-config") {
      return handleWsConfig(request, env, ctx);
    }

    if (url.pathname === "/api/quote") {
      return handleQuote(request, env, ctx);
    }

    if (url.pathname === "/api/calendar") {
      return handleCalendar(request, env, ctx);
    }

    if (url.pathname === "/api/news") {
      return handleNews(request, env, ctx);
    }

    if (url.pathname === "/ws") {
      if (!env.MARKET_RELAY) {
        return new Response("MarketRelayDO binding not configured", { status: 500 });
      }
      const id = env.MARKET_RELAY.idFromName("global-market-relay");
      const stub = env.MARKET_RELAY.get(id);
      return stub.fetch(request);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(refreshScreenerSnapshot(env));
  },
};

export {
  BINANCE_MIRRORS,
  fetchBinanceWithFallback,
  FUTURES_TO_TWELVEDATA,
  resolveTdSymbol,
  fetchBinanceCandles,
  fetchBinanceTickers,
};
