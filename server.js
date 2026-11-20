const http = require("http");
const path = require("path");
const express = require("express");
const WebSocket = require("ws");
// Catalogs, interval maps and symbol helpers live in shared/ (ES modules, single source of truth with worker.js).
// require() of ESM needs Node >= 22.12 (see SETUP.md / package.json "engines").
const { INTERVAL_SECONDS: STEPS, BINANCE_INTERVALS: BNI, TWELVEDATA_INTERVALS: TDI } = require("./shared/intervals.js");
const { BASE_INSTRUMENTS, INSTRUMENT_BY_SYMBOL: BY_SYM, DUKASCOPY_MAP, BINANCE_MIRRORS, STABLE_RE } = require("./shared/instruments.js");
const { resolveTdSymbol, inferMeta, normalizeSymbol } = require("./shared/symbolNormalizer.js");
const { fetchYahooCandles, fetchYahooQuote, toYahooSymbol } = require("./shared/yahooFeed.js");
const { createLocalD1 } = require("./shared/localD1.js");
const { handleAuthRoute } = require("./shared/authRoutes.js");
const { handleWaitlistRoute } = require("./shared/waitlist.js");
const { jrStats, tradeStats, propStatus, equityCurve, drawdownSeries, rDistribution, dailyPnlCalendar } = require("./shared/journal.js");
const { createReplaySession } = require("./shared/replay.js");
const { createAlertEvaluator } = require("./shared/alerts.js");
const { vsCompute } = require("./shared/vs/index.js");
const { normSymbol, toTwelveSymbol, createTickGuard } = require("./shared/schema.js");
const { createCandleBuilder, normalizeTf } = require("./shared/market/candles.js");
const { TdSubscriptionManager } = require("./shared/market/tdSlots.js");
const { BinanceMiniTickerFeed } = require("./shared/market/binanceFeed.js");
const { resolveCryptoProvider } = require("./shared/market/cryptoProvider.js");
const {
  PROTOCOL_VERSION,
  PROVENANCE,
  createSequencer,
  makeFrame,
  packQuoteFrames,
  validateClientMessage,
} = require("./shared/protocol.js");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const TWELVEDATA_KEY = (process.env.TWELVEDATA_KEY || process.env.TWELVE_DATA_API_KEY || "").trim();
const TD_WS_MAX = Math.max(1, Number(process.env.TD_WS_MAX) || 8);
const localDb = createLocalD1(__dirname);
const serverEnv = {
  DB: localDb,
  TWELVEDATA_KEY,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
  APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID || "",
  APPLE_TEAM_ID: process.env.APPLE_TEAM_ID || "",
  APPLE_KEY_ID: process.env.APPLE_KEY_ID || "",
  APPLE_PRIVATE_KEY: process.env.APPLE_PRIVATE_KEY || "",
  ADMIN_BOOTSTRAP_EMAIL: process.env.ADMIN_BOOTSTRAP_EMAIL || "",
};

app.disable("x-powered-by");

// 301 redirect legacy pages.dev apex and www to canonical vektorterminal.com + security headers
app.use((req, res, next) => {
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();
  if (host === "screener-cso.pages.dev" || host === "www.vektorterminal.com") {
    return res.redirect(301, `https://vektorterminal.com${req.originalUrl}`);
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (req.path === "/app" || req.path.startsWith("/app/")) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
  }
  return next();
});

// Sliding-window rate limit on /api/*
const apiRateBuckets = new Map();
app.use("/api", (req, res, next) => {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local").split(",")[0].trim();
  const now = Date.now();
  const win = apiRateBuckets.get(ip) || [];
  const fresh = win.filter((t) => now - t < 60000);
  if (fresh.length >= 240) {
    res.setHeader("Retry-After", "15");
    return res.status(429).json({ ok: false, error: "Too many requests" });
  }
  fresh.push(now);
  apiRateBuckets.set(ip, fresh);
  if (apiRateBuckets.size > 2000) apiRateBuckets.clear();
  return next();
});

// Bridge Express req/res to Web Fetch Request/Response handlers (shared/authRoutes.js, shared/waitlist.js)
async function bridgeWebHandler(req, res, handler) {
  try {
    const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
    const host = req.headers.host || `localhost:${PORT}`;
    const fullUrl = `${proto}://${host}${req.originalUrl}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((item) => headers.append(k, item));
      else headers.set(k, String(v));
    }
    let bodyBuf = undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      bodyBuf = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
      });
    }
    const webReq = new Request(fullUrl, {
      method: req.method,
      headers,
      body: bodyBuf && bodyBuf.length ? bodyBuf : undefined,
    });
    const webRes = await handler(webReq, serverEnv);
    if (!webRes) return res.status(404).json({ ok: false, error: "Not found" });
    res.status(webRes.status);
    const setCookies = typeof webRes.headers.getSetCookie === "function" ? webRes.headers.getSetCookie() : [];
    webRes.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") return;
      res.setHeader(key, value);
    });
    if (setCookies.length) {
      res.setHeader("Set-Cookie", setCookies);
    }
    const ab = await webRes.arrayBuffer();
    return res.send(Buffer.from(ab));
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Internal API error" });
  }
}

app.all(/^\/api\/(?:auth\/.*|me\/data(?:\/.*)?|me\/import|admin\/users(?:\/.*)?)$/, (req, res) =>
  bridgeWebHandler(req, res, handleAuthRoute)
);
app.all(/^\/api\/(?:waitlist|admin\/waitlist)$/, (req, res) =>
  bridgeWebHandler(req, res, handleWaitlistRoute)
);

app.post("/api/journal/stats", express.json({ limit: "2mb" }), (req, res) => {
  try {
    const body = req.body || {};
    const trades = Array.isArray(body.trades) ? body.trades : [];
    const startBal = Number(body.balance || (body.account && body.account.acct) || 0) || 0;
    const stats = jrStats(trades);
    const summary = tradeStats(trades, startBal);
    const prop = body.account ? propStatus(trades, body.account, body.today) : null;
    return res.json({
      ok: true,
      stats,
      summary,
      prop,
      equity: equityCurve(trades, startBal),
      drawdown: drawdownSeries(trades, startBal),
      rDist: rDistribution(trades),
      dailyPnl: dailyPnlCalendar(trades),
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err && err.message ? err.message : "Invalid journal payload" });
  }
});

app.post("/api/replay/simulate", express.json({ limit: "2mb" }), (req, res) => {
  try {
    const body = req.body || {};
    const session = createReplaySession({
      bars: Array.isArray(body.bars) ? body.bars : [],
      balance: Number(body.balance) || 100000,
      feeBps: Number(body.feeBps) || 0,
      ...(body.symbol ? { symbol: String(body.symbol) } : {}),
      ...(body.interval ? { interval: String(body.interval) } : {}),
    });
    if (Array.isArray(body.actions)) {
      for (const act of body.actions) {
        if (!act || typeof act !== "object") continue;
        if (act.type === "seek" && Number.isFinite(act.index)) session.seek(act.index);
        else if (act.type === "step") session.step(Number(act.n) || 1);
        else if (act.type === "open" || act.type === "order") session.openOrder(act);
        else if (act.type === "close" && act.id) session.closePosition(act.id);
        else if (act.type === "cancel" && act.id) session.cancelOrder(act.id);
      }
    }
    return res.json({ ok: true, state: session.getState(), stats: session.getStats() });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err && err.message ? err.message : "Invalid replay payload" });
  }
});

app.post("/api/alerts/evaluate", express.json({ limit: "512kb" }), (req, res) => {
  try {
    const body = req.body || {};
    const evaluator = createAlertEvaluator({
      alerts: Array.isArray(body.alerts) ? body.alerts : [],
      ...(body.prevPrices ? { prevPrices: body.prevPrices } : {}),
    });
    const triggered = [];
    const frames = [];
    for (const tick of Array.isArray(body.ticks) ? body.ticks : []) {
      const r = evaluator.evaluateTick(tick);
      if (r.triggers.length) triggered.push(...r.triggers);
      if (r.frames.length) frames.push(...r.frames);
    }
    for (const bar of Array.isArray(body.bars) ? body.bars : []) {
      const r = evaluator.evaluateBar(bar);
      if (r.triggers.length) triggered.push(...r.triggers);
      if (r.frames.length) frames.push(...r.frames);
    }
    return res.json({ ok: true, triggered, frames, state: evaluator.snapshot() });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err && err.message ? err.message : "Alert evaluation failed" });
  }
});

app.post("/api/vs/run", express.json({ limit: "1mb" }), (req, res) => {
  try {
    const body = req.body || {};
    const code = String(body.source || body.code || "");
    const out = vsCompute(code, Array.isArray(body.bars) ? body.bars : [], { inputs: body.inputs || {} });
    return res.json({ ok: true, ...out });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err && err.message ? err.message : "Script error" });
  }
});

async function fetchBinanceWithFallback(pathAndQuery, init = {}, timeoutMs = 3500) {
  for (const base of BINANCE_MIRRORS) {
    try {
      const r = await fetchWithTimeout(`${base}${pathAndQuery}`, init, timeoutMs);
      if (r.status === 403 || r.status === 418 || r.status === 429 || r.status === 451 || (r.status >= 500 && r.status <= 599)) {
        continue;
      }
      return r;
    } catch (_e) {}
  }
  return null;
}

const dukaBlockCache = new Map();

const LIVE_SCREENER_NON_CRYPTO = BASE_INSTRUMENTS.filter((item) => item.m !== "CRY");
const isTdPrimaryMarket = (m) => m === "FX" || m === "STK" || m === "ETF";

function toTdApiSymbol(rawSym, meta) {
  const known = BY_SYM.get(String(rawSym || "").trim().toUpperCase());
  if (known && known.td) return known.td;
  const norm = normalizeSymbol(rawSym, "twelvedata");
  if (norm) return norm;
  return resolveTdSymbol((meta && meta.td) || rawSym, "");
}

function parseTdQuoteEntry(q) {
  if (!q || typeof q !== "object" || q.status === "error") return null;
  const c = Number(q.close ?? q.price);
  if (!Number.isFinite(c) || c <= 0) return null;
  const prevClose = Number(q.previous_close);
  const pctRaw = Number(q.percent_change);
  const pct = Number.isFinite(pctRaw)
    ? pctRaw
    : Number.isFinite(prevClose) && prevClose > 0
      ? ((c - prevClose) / prevClose) * 100
      : 0;
  const v = Number(q.volume);
  const t = Number(q.timestamp);
  return {
    c,
    prevClose: Number.isFinite(prevClose) && prevClose > 0 ? prevClose : c,
    pct: Number(pct.toFixed(2)),
    v: Number.isFinite(v) && v >= 0 ? v : 0,
    t: Number.isFinite(t) && t > 0 ? Math.floor(t) : Math.floor(Date.now() / 1000),
  };
}

async function fetchTwelveDataQuotes(items) {
  const out = new Map();
  if (!TWELVEDATA_KEY || !items.length) return out;
  const tdToInternal = new Map();
  const tdList = [];
  for (const item of items) {
    const tdSym = toTdApiSymbol(item.s, item);
    if (!tdSym || tdToInternal.has(tdSym)) continue;
    tdToInternal.set(tdSym, item.s);
    tdList.push(tdSym);
  }
  for (let i = 0; i < tdList.length; i += 8) {
    const chunk = tdList.slice(i, i + 8);
    const qs = new URLSearchParams({ symbol: chunk.join(","), apikey: TWELVEDATA_KEY });
    try {
      const r = await fetchWithTimeout(`https://api.twelvedata.com/quote?${qs}`, {}, 5000);
      if (!r || !r.ok) {
        if (r && r.status === 429) break;
        continue;
      }
      const j = await r.json().catch(() => null);
      if (!j || j.status === "error") {
        if (j && (j.code === 429 || /credit|limit|quota/i.test(String(j.message || "")))) break;
        continue;
      }
      if (chunk.length === 1) {
        const parsed = parseTdQuoteEntry(j);
        if (parsed) out.set(tdToInternal.get(chunk[0]), parsed);
      } else {
        for (const tdSym of chunk) {
          const parsed = parseTdQuoteEntry(j[tdSym]);
          if (parsed) out.set(tdToInternal.get(tdSym), parsed);
        }
      }
    } catch (_e) {}
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

async function fetchWithTimeout(url, opts = {}, ms = 4500) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(id);
  }
}

async function fetchBinanceTickers() {
  try {
    const r = await fetchBinanceWithFallback("/api/v3/ticker/24hr", {}, 3500);
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
  const getOut = (idx) => out[idx] || 0;
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

async function fetchDukascopyBi5Block(url, baseEpochSec, scale, refPrice, cacheKey, isImmutable) {
  if (isImmutable && dukaBlockCache.has(cacheKey)) {
    return dukaBlockCache.get(cacheKey);
  }
  try {
    const r = await fetchWithTimeout(url, { headers: { "user-agent": "VektorTerminal/1.0" } }, 4500);
    if (!r.ok) return [];
    const ab = await r.arrayBuffer();
    if (!ab || ab.byteLength < 14) return [];
    const raw = lzmaDecompress(new Uint8Array(ab));
    const bars = parseDukascopyBi5(raw, baseEpochSec, scale, refPrice);
    if (bars.length && isImmutable) {
      if (dukaBlockCache.size > 600) dukaBlockCache.clear();
      dukaBlockCache.set(cacheKey, bars);
    }
    return bars;
  } catch (_e) {
    return [];
  }
}

async function fetchDukascopyCandles(rawSym, interval, opts, refPrice) {
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
      jobs.push(fetchDukascopyBi5Block(url, base, cfg.scale, refPrice, `duka:1d:${cfg.id}:${y}`, y < new Date().getUTCFullYear()));
    }
    rawBars = (await Promise.all(jobs)).flat();
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
      jobs.push(fetchDukascopyBi5Block(url, base, cfg.scale, refPrice, `duka:1h:${cfg.id}:${y}-${mm}`, imm));
      if (++m >= 12) { m = 0; y++; }
    }
    rawBars = (await Promise.all(jobs)).flat();
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
      dayJobs.push(fetchDukascopyBi5Block(url, d, cfg.scale, refPrice, `duka:1m:${cfg.id}:${yyyy}-${mm}-${dd}`, d < todayUtcStart));
    }
    rawBars = (await Promise.all(dayJobs)).flat();
  }

  if (!rawBars.length) return null;
  let out = step > 60 ? aggregateCandles(rawBars, step) : rawBars;
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
const TD_CACHE_TTL_MS = 60000;

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
      const r = await fetchBinanceWithFallback(`/api/v3/klines?${qs}`, {}, 3500);
      if (r && r.ok) {
        hadUpstreamOk = true;
        const j = await r.json();
        if (Array.isArray(j) && j.length) {
          chunk = j
            .map((x) => {
              const t = Math.floor(Math.floor(x[0] / 1000) / step) * step;
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
    endMs = chunk[0].t * 1000 - step * 1000;
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

async function fetchTwelveDataCandles(tdSym, interval, opts = {}) {
  const tdi = TDI[interval];
  const step = STEPS[interval] || 3600;
  if (!tdi || !TWELVEDATA_KEY || !tdSym || String(tdSym).endsWith("=F")) return null;
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
        apikey: TWELVEDATA_KEY,
      });
      if (beforeSec > 0) {
        qs.set("end_date", new Date((beforeSec - 1) * 1000).toISOString().slice(0, 19).replace("T", " "));
      } else if (opts.to > 0) {
        qs.set("end_date", new Date(opts.to * 1000).toISOString().slice(0, 19).replace("T", " "));
      }
      const r = await fetchWithTimeout(`https://api.twelvedata.com/time_series?${qs}`, {}, 6500);
      if (!r.ok) {
        if (beforeSec > 0 && (r.status === 400 || r.status === 404)) return [];
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
        const t = Math.floor(Math.floor(rawMs / 1000) / step) * step;
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

// Local Edge/KV cache parity (strictly populated from real live upstream feeds — zero seeded static prices)
let screenerSnapshot = { ts: 0, body: "", payload: null };
const candleCache = new Map();
const livePrices = new Map();
const liveQuotes = new Map(); // sym -> { s, c, prevClose, chgPct, v, bid, ask, t, source }

function upsertLiveQuote(sym, q) {
  const key = normSymbol(sym) || String(sym || "").trim().toUpperCase();
  if (!key || !q || !(Number(q.c) > 0)) return null;
  const price = Number(q.c);
  const tsMs = Number.isFinite(Number(q.t)) && Number(q.t) > 0
    ? (Number(q.t) < 1e12 ? Number(q.t) * 1000 : Number(q.t))
    : Date.now();
  const prev = liveQuotes.get(key);
  let prevClose = Number(q.prevClose);
  if (!(prevClose > 0) && prev && prev.prevClose > 0) {
    prevClose = prev.prevClose;
  }
  let chgPct = q.chgPct !== undefined && Number.isFinite(Number(q.chgPct)) ? Number(q.chgPct) : undefined;
  if (!(prevClose > 0) && chgPct !== undefined && chgPct > -99.9) {
    prevClose = price / (1 + chgPct / 100);
  }
  if (chgPct === undefined && prevClose > 0) {
    chgPct = Number((((price - prevClose) / prevClose) * 100).toFixed(2));
  }
  const vol = q.v !== undefined && Number.isFinite(Number(q.v)) && Number(q.v) >= 0
    ? Number(q.v)
    : (prev && Number.isFinite(prev.v) ? prev.v : 0);
  const entry = {
    s: key,
    c: price,
    prevClose: prevClose > 0 ? prevClose : undefined,
    chgPct,
    v: vol,
    bid: Number(q.bid) > 0 ? Number(q.bid) : (prev ? prev.bid : undefined),
    ask: Number(q.ask) > 0 ? Number(q.ask) : (prev ? prev.ask : undefined),
    t: tsMs,
    source: q.source || (prev && prev.source) || "twelvedata",
  };
  liveQuotes.set(key, entry);
  livePrices.set(key, price);
  return entry;
}

function renderLiveScreenerBody() {
  if (!screenerSnapshot.payload || !Array.isArray(screenerSnapshot.payload.universe)) {
    return screenerSnapshot.body;
  }
  const patchedUniverse = screenerSnapshot.payload.universe.map((row) => {
    if (!Array.isArray(row) || !row[0]) return row;
    const live = liveQuotes.get(row[0]);
    if (!live || !(live.c > 0) || live.t < screenerSnapshot.ts) return row;
    const copy = row.slice();
    copy[2] = live.c;
    if (live.v > 0) copy[3] = live.v;
    if (live.chgPct !== undefined && Number.isFinite(live.chgPct)) copy[12] = live.chgPct;
    return copy;
  });
  return JSON.stringify({
    ...screenerSnapshot.payload,
    ts: Date.now(),
    universe: patchedUniverse,
  });
}

async function buildScreenerBody() {
  const ts = Date.now();
  const tdItems = LIVE_SCREENER_NON_CRYPTO.filter((item) => isTdPrimaryMarket(item.m));
  const otherItems = LIVE_SCREENER_NON_CRYPTO.filter((item) => !isTdPrimaryMarket(item.m));

  const [bnRows, tdQuotes, otherQuotes] = await Promise.all([
    fetchBinanceTickers(),
    fetchTwelveDataQuotes(tdItems),
    fetchYahooLiveQuotes(otherItems, 10),
  ]);
  const missingTdItems = tdItems.filter((item) => !tdQuotes.has(item.s));
  const missingTdYahooQuotes = missingTdItems.length ? await fetchYahooLiveQuotes(missingTdItems, 10) : new Map();
  const seen = new Set();
  const universe = [];

  if (bnRows && bnRows.length) {
    for (const row of bnRows) {
      seen.add(row[0]);
      const existing = liveQuotes.get(row[0]);
      if (row[2] > 0) {
        const merged = upsertLiveQuote(row[0], {
          c: existing && existing.t > ts - 5000 ? existing.c : row[2],
          chgPct: Number.isFinite(row[12]) ? row[12] : undefined,
          v: row[3] || 0,
          t: existing && existing.t > ts - 5000 ? existing.t : ts,
          source: existing && existing.t > ts - 5000 ? existing.source : "binance",
        });
        if (merged) {
          row[2] = merged.c;
          if (merged.chgPct !== undefined) row[12] = merged.chgPct;
        }
      }
      universe.push(row);
    }
  }
  // Crypto rows come from Binance only; if its tickers are unavailable, crypto is absent rather than another feed.

  for (const item of LIVE_SCREENER_NON_CRYPTO) {
    if (seen.has(item.s)) continue;
    const isTd = tdQuotes.has(item.s);
    const q = tdQuotes.get(item.s) || missingTdYahooQuotes.get(item.s) || otherQuotes.get(item.s);
    if (!q || !(q.c > 0)) continue;
    seen.add(item.s);
    const existing = liveQuotes.get(item.s);
    const useExisting = existing && existing.source === "twelvedata" && existing.t > ts - 15000;
    const merged = upsertLiveQuote(item.s, {
      c: useExisting ? existing.c : q.c,
      prevClose: q.prevClose,
      chgPct: useExisting && q.prevClose > 0 ? Number((((existing.c - q.prevClose) / q.prevClose) * 100).toFixed(2)) : q.pct,
      v: q.v || 0,
      t: useExisting ? existing.t : (q.t || Math.floor(ts / 1000)) * 1000,
      source: isTd || useExisting ? "twelvedata" : "yahoo",
    });
    universe.push([
      item.s,
      item.m,
      merged ? merged.c : q.c,
      q.v || 0,
      item.cs,
      item.vf,
      item.api,
      item.tv,
      item.pr,
      resolveTdSymbol(item.td || item.s, item.s),
      item.name,
      item.ex,
      merged && merged.chgPct !== undefined ? merged.chgPct : q.pct,
    ]);
  }

  const sources = [];
  if (bnRows && bnRows.length) sources.push("binance");
  if (tdQuotes.size > 0) sources.push("twelvedata");
  if (otherQuotes.size > 0 || missingTdYahooQuotes.size > 0) sources.push("yahoo");
  const payload = {
    ok: true,
    ts,
    tfs: ["1D", "1H"],
    source: sources.length ? `edge+${sources.join("+")}` : "edge+unavailable",
    count: universe.length,
    universe,
  };
  const body = JSON.stringify(payload);
  screenerSnapshot = { ts, body, payload };
  return body;
}

// Pre-warm screener snapshot on boot & every 60s (mirrors Cloudflare 1-minute Cron Trigger)
buildScreenerBody().catch(() => {});
setInterval(() => {
  buildScreenerBody().catch(() => {});
}, 60 * 1000);

app.get("/api/screener", async (_req, res) => {
  const t0 = Date.now();
  try {
    if (screenerSnapshot.body && Date.now() - screenerSnapshot.ts < 65000) {
      res.set({
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=30",
        "X-Cache": "HIT-EDGE",
        "Server-Timing": `edge;dur=${Date.now() - t0}`,
      });
      return res.send(renderLiveScreenerBody());
    }
    const body = await buildScreenerBody();
    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=30",
      "X-Cache": "MISS",
      "Server-Timing": `origin;dur=${Date.now() - t0}`,
    });
    return res.send(body);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || "Screener error" });
  }
});

app.get("/api/quote", async (req, res) => {
  const raw = String(req.query.symbols || req.query.symbol || "").trim();
  const list = raw ? raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 24) : ["BTCUSDT"];
  const quotes = {};
  const now = Math.floor(Date.now() / 1000);
  await Promise.all(
    list.map(async (s) => {
      const meta = inferMeta(s);
      const cachedQ = liveQuotes.get(s);
      let px = cachedQ ? cachedQ.c : livePrices.get(s);
      let qMeta = cachedQ || null;
      if (!(px > 0)) {
        const isCry = meta.pr === "bn" || meta.m === "CRY" || s.endsWith("USDT") || s.endsWith("BUSD") || s.endsWith("BTC");
        if (isCry) {
          const r = await fetchBinanceWithFallback(`/api/v3/ticker/price?symbol=${encodeURIComponent(meta.api || s)}`);
          if (r && r.ok) {
            const j = await r.json().catch(() => null);
            if (j && Number(j.price) > 0) {
              px = Number(j.price);
              qMeta = upsertLiveQuote(s, { c: px, t: Date.now(), source: "binance" });
            }
          }
          // Crypto quotes: Binance only.
        } else {
          if (isTdPrimaryMarket(meta.m || "STK") && TWELVEDATA_KEY) {
            const tdSym = toTdApiSymbol(s, meta);
            if (tdSym) {
              try {
                const qs = new URLSearchParams({ symbol: tdSym, apikey: TWELVEDATA_KEY });
                const r = await fetchWithTimeout(`https://api.twelvedata.com/quote?${qs}`, {}, 4500);
                if (r && r.ok) {
                  const j = await r.json().catch(() => null);
                  const q = parseTdQuoteEntry(j);
                  if (q && q.c > 0) {
                    px = q.c;
                    qMeta = upsertLiveQuote(s, { c: q.c, prevClose: q.prevClose, chgPct: q.pct, v: q.v, t: (q.t || now) * 1000, source: "twelvedata" });
                  }
                }
              } catch (_e) {}
            }
          }
          if (!(px > 0)) {
            const q = await fetchYahooQuote(toYahooSymbol(s, meta.api));
            if (q && q.c > 0) {
              px = q.c;
              qMeta = upsertLiveQuote(s, { c: q.c, prevClose: q.prevClose, chgPct: q.pct, v: q.v, t: (q.t || now) * 1000, source: "yahoo" });
            }
          }
        }
      }
      if (px > 0) {
        quotes[s] = {
          s,
          c: px,
          t: qMeta && qMeta.t ? Math.floor(qMeta.t / 1000) : now,
          m: meta.m || "STK",
          ...(qMeta && qMeta.chgPct !== undefined ? { chgPct: qMeta.chgPct } : {}),
          ...(qMeta && qMeta.v > 0 ? { v: qMeta.v } : {}),
          source: (qMeta && qMeta.source) || "twelvedata",
        };
      }
    })
  );
  return res.json({ ok: true, ts: Date.now(), quotes });
});

app.get("/api/ws-config", (_req, res) => {
  res.set({ "Cache-Control": "no-store" });
  return res.json({
    ok: true,
    tdKey: "", // TASK-02: never expose the key
    ws: {
      connected: tdConnected,
      maxSlots: tdSlots.maxSlots,
      active: tdSlots.getActiveSymbols(),
      rejected: [...tdSlots.failedUntil.keys()],
      lastSubscribeStatus: lastTdSubStatus,
    },
  });
});

app.get("/api/candles", async (req, res) => {
  const t0 = Date.now();
  const rawSym = String(req.query.symbol || "").trim().toUpperCase();
  const interval = String(req.query.interval || "1H").trim();
  const mktHint = String(req.query.mkt || "").trim().toUpperCase();
  const apiHint = String(req.query.apiSym || "").trim();
  const fromSec = Math.max(0, Math.floor(Number(req.query.from) || 0));
  const toSec = Math.max(0, Math.floor(Number(req.query.to) || 0));
  const rawBefore = Number(req.query.before) || 0;
  const beforeSec = rawBefore > 0 ? Math.floor(rawBefore > 1e11 ? rawBefore / 1000 : rawBefore) : 0;
  const replay = req.query.replay === "1";
  const refresh = req.query.refresh === "1";

  if (!rawSym || !STEPS[interval]) {
    return res.status(400).json({ ok: false, error: "Invalid symbol or interval" });
  }

  const meta = inferMeta(rawSym, mktHint, apiHint);
  const isCrypto = meta.pr === "bn" || meta.m === "CRY" || rawSym.endsWith("USDT") || rawSym.endsWith("BUSD") || rawSym.endsWith("BTC");
  const rawLimit = Math.floor(Number(req.query.limit) || 0);
  const defaultLimit = replay ? (fromSec || toSec ? 1500 : 1000) : (isCrypto ? 1000 : 5000);
  const limit = Math.max(10, Math.min(5000, rawLimit || defaultLimit));

  const nowSec = Math.floor(Date.now() / 1000);
  const step = STEPS[interval];
  const isHistoricalChunk = beforeSec > 0;
  const isHistoricalWindow = isHistoricalChunk || (replay && ((toSec > 0 && toSec < nowSec - step * 4) || (fromSec > 0 && !toSec && limit > 250)));
  const ttl = isHistoricalWindow ? 86400 : 60;
  const cacheKey = `${rawSym}|${interval}|${fromSec}|${toSec}|${beforeSec}|${limit}|${replay ? 1 : 0}`;
  if (!refresh) {
    const cached = candleCache.get(cacheKey);
    if (cached && (isHistoricalWindow || Date.now() - cached.ts < ttl * 1000)) {
      const body = !isHistoricalWindow && !replay && cached.bars
        ? JSON.stringify({ ...cached.meta, ts: Date.now(), bars: overlayServerLiveBars(rawSym, interval, cached.bars, limit) })
        : cached.body;
      res.set({
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${ttl}, s-maxage=${ttl}`,
        "X-Cache": "HIT-EDGE",
        "Server-Timing": `edge;dur=${Date.now() - t0}`,
      });
      return res.send(body);
    }
  }

  const opts = { from: fromSec, to: toSec, before: beforeSec, limit, replay, refresh };

  let resultPromise = CANDLE_IN_FLIGHT.get(cacheKey);
  if (!resultPromise) {
    resultPromise = (async () => {
      let bars = null;
      let source = "none";

      if (replay) {
        if (isCrypto) {
          bars = await fetchBinanceCandles(meta.api || rawSym, interval, opts); // crypto: Binance only
          if (bars) source = "binance";
        } else if (DUKASCOPY_MAP[rawSym]) {
          bars = await fetchDukascopyCandles(rawSym, interval, opts, livePrices.get(rawSym) || meta.p);
          if (bars) source = "dukascopy";
        }
        if (!bars && !isCrypto && TWELVEDATA_KEY) {
          const tdResolved = toTdApiSymbol(rawSym, meta);
          if (tdResolved) {
            bars = await fetchTwelveDataCandles(tdResolved, interval, opts);
            if (bars) source = "twelvedata";
          }
        }
        if (!bars && !isCrypto) {
          bars = await fetchYahooCandles(toYahooSymbol(rawSym, meta.api), interval, opts);
          if (bars && bars.length) source = "yahoo";
        }
      } else {
        if (isCrypto) {
          bars = await fetchBinanceCandles(meta.api || rawSym, interval, opts); // crypto: Binance only
          if (bars !== null) source = "binance";
        } else {
          if (TWELVEDATA_KEY) {
            const tdResolved = toTdApiSymbol(rawSym, meta);
            if (tdResolved) {
              bars = await fetchTwelveDataCandles(tdResolved, interval, opts);
              if (bars !== null) source = "twelvedata";
            }
          }
          if (bars === null) {
            bars = await fetchYahooCandles(toYahooSymbol(rawSym, meta.api), interval, opts);
            if (bars !== null) source = "yahoo";
          }
        }
      }

      if (bars && bars.length && bars[bars.length - 1].c > 0 && !isHistoricalChunk) {
        livePrices.set(rawSym, bars[bars.length - 1].c);
      }

      return { bars, source };
    })().finally(() => {
      CANDLE_IN_FLIGHT.delete(cacheKey);
    });
    CANDLE_IN_FLIGHT.set(cacheKey, resultPromise);
  }

  const { bars, source } = await resultPromise;
  if (bars === null || (!bars.length && !isHistoricalChunk)) {
    res.set({ "Cache-Control": "no-store" });
    return res.status(502).json({ ok: false, symbol: rawSym, interval, source, error: "Upstream candle feed unavailable" });
  }

  const finalBars = !isHistoricalChunk && !replay
    ? overlayServerLiveBars(rawSym, interval, bars, limit)
    : bars;

  const metaPayload = {
    ok: true,
    symbol: rawSym,
    interval,
    ttl,
    ts: Date.now(),
    source,
    hasMore: isHistoricalChunk ? finalBars.length > 0 : true,
  };
  const payload = { ...metaPayload, bars: finalBars };
  const body = JSON.stringify(payload);
  if (candleCache.size > 500) candleCache.clear();
  candleCache.set(cacheKey, { ts: Date.now(), body, bars, meta: metaPayload });

  res.set({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `public, max-age=${ttl}, s-maxage=${ttl}`,
    "X-Cache": "MISS",
    "Server-Timing": `origin;dur=${Date.now() - t0}`,
  });
  return res.send(body);
});

const calendarCache = { ts: 0, body: "" };
const newsCache = new Map();

app.get("/api/calendar", async (req, res) => {
  const t0 = Date.now();
  const force = req.query.force === "1";
  if (!force && calendarCache.body && Date.now() - calendarCache.ts < 900 * 1000) {
    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=900",
      "X-Cache": "HIT-EDGE",
      "Server-Timing": `edge;dur=${Date.now() - t0}`,
    });
    return res.send(calendarCache.body);
  }

  let events = [];
  let source = "unavailable";
  try {
    const json = await fetchJSON("https://nfs.faireconomy.media/ff_calendar_thisweek.json", 4500);
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
  } catch (_e) {}

  const body = JSON.stringify({ ok: true, source, ts: Date.now(), ttl: events.length ? 900 : 60, events });
  if (events.length) {
    calendarCache.ts = Date.now();
    calendarCache.body = body;
  }
  res.set({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": events.length ? "public, max-age=300, s-maxage=900" : "no-store",
    "X-Cache": "MISS",
    "Server-Timing": `origin;dur=${Date.now() - t0}`,
  });
  return res.send(body);
});

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

app.get("/api/news", async (req, res) => {
  const t0 = Date.now();
  const sym = String(req.query.symbol || "").trim().toUpperCase().slice(0, 24);
  if (!sym) return res.status(400).json({ ok: false, error: "Missing symbol" });

  const cached = newsCache.get(sym);
  if (cached && Date.now() - cached.ts < 300 * 1000) {
    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Cache": "HIT-EDGE",
    });
    return res.send(cached.body);
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
  newsCache.set(sym, { ts: Date.now(), body });
  res.set({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300, s-maxage=300",
    "X-Cache": "MISS",
    "Server-Timing": `origin;dur=${Date.now() - t0}`,
  });
  return res.send(body);
});

app.use(
  express.static(__dirname, {
    dotfiles: "ignore",
    index: ["index.html"],
  })
);

app.get(["/", "/pricing", "/privacy", "/terms", "/risk", "/legal", "/legal/*", "/features/*", "/products/*", "/app", "/app/*"], (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });
const clients = new Map(); // ws -> { subs: Set<string>, chart: { sym, tf } | null, seq: Sequencer }
const serverTickGuard = createTickGuard();
const serverCandles = createCandleBuilder({
  timeframes: ["1m", "5m", "15m", "30m", "1H", "4H", "1D", "1W"],
  openMode: "auto",
});
const serverLiveBars = new Map(); // "SYM|TF" -> Map<bucketT, Bar> (rolling WS-aggregated bars)
const SERVER_LIVE_BARS_CAP = 240;

function recordServerLiveBar(sym, tf, bar) {
  if (!sym || !tf || !bar || !(bar.t > 0) || !(bar.c > 0)) return;
  const k = `${sym}|${tf}`;
  let bucketMap = serverLiveBars.get(k);
  if (!bucketMap) {
    bucketMap = new Map();
    serverLiveBars.set(k, bucketMap);
  }
  bucketMap.set(bar.t, { t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: Number.isFinite(bar.v) ? bar.v : 0 });
  if (bucketMap.size > SERVER_LIVE_BARS_CAP) {
    const oldest = bucketMap.keys().next().value;
    if (oldest !== undefined) bucketMap.delete(oldest);
  }
}

function overlayServerLiveBars(sym, tf, restBars, limit) {
  const norm = normSymbol(sym);
  const normTf = normalizeTf(tf);
  if (!norm || !normTf) return restBars;
  const bucketMap = serverLiveBars.get(`${norm}|${normTf}`);
  const cur = serverCandles.getCurrent(norm, normTf);
  if ((!bucketMap || !bucketMap.size) && !cur) return restBars;

  const byT = new Map();
  for (const b of restBars || []) {
    if (b && b.t > 0 && b.c > 0) byT.set(b.t, { ...b });
  }
  const mergeOne = (lb) => {
    if (!lb || !(lb.t > 0) || !(lb.c > 0)) return;
    const prev = byT.get(lb.t);
    if (!prev) {
      byT.set(lb.t, { ...lb });
      return;
    }
    const prevFlat = prev.o === prev.h && prev.h === prev.l && prev.l === prev.c;
    const liveHasRange = lb.h > lb.l || lb.o !== lb.c;
    if (prevFlat && liveHasRange) {
      byT.set(lb.t, { ...lb, v: Math.max(prev.v || 0, lb.v || 0) });
    } else {
      byT.set(lb.t, {
        t: lb.t,
        o: prev.o,
        h: Math.max(prev.h, lb.h, lb.c),
        l: Math.min(prev.l, lb.l, lb.c),
        c: lb.c,
        v: Math.max(prev.v || 0, lb.v || 0),
      });
    }
  };
  if (bucketMap) {
    for (const lb of bucketMap.values()) mergeOne(lb);
  }
  if (cur) mergeOne(cur);
  const out = [...byT.values()].sort((a, b) => a.t - b.t);
  return limit && out.length > limit ? out.slice(-limit) : out;
}
const pendingQuotes = new Map(); // sym -> Protocol v2 quote object
const tdSlots = new TdSubscriptionManager({ maxSlots: TD_WS_MAX });
const tdDayVolume = new Map(); // sym -> { day: "YYYY-MM-DD", value: number }

let binanceUpstream = null;
let tdUpstream = null;
let tdConnected = false;
let tdHbTimer = null;
let tdReconnectTimer = null;
let tdRetryAttempt = 0;
let tdLastMsgAt = 0;
let lastTdSubStatus = null;

function sendFrameToClient(ws, state, type, payload, opts = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !state) return;
  try {
    const seq = opts.seq !== undefined ? opts.seq : (type === "pong" ? 0 : state.seq.next());
    const frame = makeFrame(type, payload, seq, { validate: false });
    ws.send(JSON.stringify(frame));
  } catch (_e) {}
}

function broadcastStatus(provenance, detail) {
  const asOf = Date.now();
  for (const [ws, state] of clients) {
    sendFrameToClient(ws, state, "status", { provenance, asOf, detail });
  }
}

function toProtocolQuote(entry, provenance = PROVENANCE.LIVE) {
  const q = {
    s: entry.s,
    c: entry.c,
    t: entry.t || Date.now(),
    provenance,
  };
  if (entry.bid > 0) q.bid = entry.bid;
  if (entry.ask > 0 && (!q.bid || entry.ask >= q.bid)) q.ask = entry.ask;
  if (entry.v >= 0) q.v = entry.v;
  if (entry.chgPct !== undefined && Number.isFinite(entry.chgPct)) q.chgPct = entry.chgPct;
  return q;
}

function ingestServerTick(rawTick, extra = {}) {
  const tick = serverTickGuard(rawTick);
  if (!tick) return null;

  const entry = upsertLiveQuote(tick.s, {
    c: tick.c,
    v: extra.dayVol !== undefined ? extra.dayVol : tick.v,
    chgPct: extra.chgPct,
    bid: tick.bid,
    ask: tick.ask,
    t: tick.t,
    source: tick.src || extra.source || "twelvedata",
  });
  if (!entry) return null;

  pendingQuotes.set(entry.s, toProtocolQuote(entry, PROVENANCE.LIVE));

  const candleRes = serverCandles.onTick(tick);
  if (!candleRes.ignored) {
    const asOf = Date.now();
    const emitBars = (list, closed) => {
      for (const evt of list) {
        recordServerLiveBar(evt.sym, evt.tf, evt.bar);
        const tuple = [evt.bar.t, evt.bar.o, evt.bar.h, evt.bar.l, evt.bar.c, Number.isFinite(evt.bar.v) ? evt.bar.v : 0];
        for (const [ws, state] of clients) {
          if (!state.chart) continue;
          if (state.chart.sym !== evt.sym || state.chart.tf !== evt.tf) continue;
          sendFrameToClient(ws, state, "bar", {
            sym: evt.sym,
            tf: evt.tf,
            bar: tuple,
            closed,
            provenance: PROVENANCE.LIVE,
            asOf,
          });
        }
      }
    };
    emitBars(candleRes.closed, true);
    emitBars(candleRes.updated, false);
  }
  return entry;
}

// Coalesced 250ms Protocol v2 `quotes` fan-out (strictly <= 2 KB per frame)
setInterval(() => {
  if (!pendingQuotes.size || !clients.size) return;
  const batch = pendingQuotes;
  const snapshot = new Map(batch);
  batch.clear();

  for (const [ws, state] of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    const out = [];
    for (const [sym, q] of snapshot) {
      if (state.subs.size === 0 || state.subs.has(sym) || (state.chart && state.chart.sym === sym)) {
        out.push(q);
      }
    }
    if (!out.length) continue;
    const frames = packQuoteFrames(out, () => state.seq.next());
    for (const frame of frames) {
      try {
        ws.send(JSON.stringify(frame));
      } catch (_e) {
        break;
      }
    }
  }
}, 250);

function collectClientTdDemand() {
  const chartSymbols = [];
  const requestedSymbols = [];
  const activeViewers = new Map();
  const seenChart = new Set();

  for (const [, state] of clients) {
    const clientSet = new Set();
    if (state.chart && state.chart.sym) {
      const s = normSymbol(state.chart.sym);
      if (s) {
        clientSet.add(s);
        if (!seenChart.has(s)) {
          seenChart.add(s);
          chartSymbols.push(s);
        }
      }
    }
    for (const raw of state.subs) {
      const s = normSymbol(raw);
      if (s) {
        clientSet.add(s);
        requestedSymbols.push(s);
      }
    }
    for (const s of clientSet) {
      activeViewers.set(s, (activeViewers.get(s) || 0) + 1);
    }
  }
  return { chartSymbols, requestedSymbols, activeViewers };
}

function syncTdUpstreamSubscriptions() {
  if (!TWELVEDATA_KEY) return;
  if (clients.size === 0) {
    teardownTdUpstream();
    return;
  }
  const demand = collectClientTdDemand();
  if (!demand.chartSymbols.length && !demand.requestedSymbols.length) return;

  if (!tdUpstream || !tdConnected) {
    ensureTdUpstream();
    return;
  }

  const { toUnsubscribe, toSubscribe } = tdSlots.reconcile(demand);

  // Evicted symbols are unsubscribed upstream while retaining cached liveQuotes / REST snapshots
  if (toUnsubscribe.length) {
    const tdList = toUnsubscribe.map((x) => x.tdSym).filter(Boolean);
    if (tdList.length) {
      try {
        tdUpstream.send(JSON.stringify({ action: "unsubscribe", params: { symbols: tdList.join(",") } }));
      } catch (_e) {}
    }
  }

  if (toSubscribe.length) {
    const tdList = toSubscribe.map((x) => x.tdSym).filter(Boolean);
    if (tdList.length) {
      try {
        tdUpstream.send(JSON.stringify({ action: "subscribe", params: { symbols: tdList.join(",") } }));
      } catch (_e) {}
    }
  }
}

function teardownTdUpstream() {
  clearInterval(tdHbTimer);
  tdHbTimer = null;
  clearTimeout(tdReconnectTimer);
  tdReconnectTimer = null;
  tdConnected = false;
  tdSlots.resetActive();
  if (tdUpstream) {
    try { tdUpstream.close(); } catch (_e) {}
    tdUpstream = null;
  }
}

function scheduleTdReconnect() {
  if (!TWELVEDATA_KEY || clients.size === 0 || tdReconnectTimer) return;
  const delay = Math.min(60_000, 1000 * Math.pow(2, tdRetryAttempt));
  tdRetryAttempt += 1;
  tdReconnectTimer = setTimeout(() => {
    tdReconnectTimer = null;
    ensureTdUpstream();
  }, delay);
}

function extractTdTickVol(sym, msg, tickMs) {
  if (msg.day_volume !== undefined && msg.day_volume !== null) {
    const dv = Number(msg.day_volume);
    if (!Number.isFinite(dv) || dv < 0) return { tickVol: 0, dayVol: undefined };
    const day = new Date(tickMs).toISOString().slice(0, 10);
    const prev = tdDayVolume.get(sym);
    if (!prev || prev.day !== day) {
      tdDayVolume.set(sym, { day, value: dv });
      return { tickVol: 0, dayVol: dv };
    }
    if (dv <= prev.value) return { tickVol: 0, dayVol: dv };
    const delta = dv - prev.value;
    prev.value = dv;
    return { tickVol: delta, dayVol: dv };
  }
  const rawV = Number(msg.volume ?? msg.v);
  return { tickVol: Number.isFinite(rawV) && rawV >= 0 ? rawV : 0, dayVol: undefined };
}

function ensureTdUpstream() {
  if (!TWELVEDATA_KEY || tdUpstream || clients.size === 0) return;
  const demand = collectClientTdDemand();
  if (!demand.chartSymbols.length && !demand.requestedSymbols.length) return;

  try {
    const url = `wss://ws.twelvedata.com/v1/quotes/price?apikey=${encodeURIComponent(TWELVEDATA_KEY)}`;
    const uws = new WebSocket(url, { headers: { "X-TD-APIKEY": TWELVEDATA_KEY } });
    tdUpstream = uws;

    uws.on("open", () => {
      if (tdUpstream !== uws) return;
      tdConnected = true;
      tdRetryAttempt = 0;
      tdLastMsgAt = Date.now();
      tdSlots.resetActive();
      clearInterval(tdHbTimer);
      tdHbTimer = setInterval(() => {
        if (!tdUpstream || !tdConnected) return;
        if (tdLastMsgAt > 0 && Date.now() - tdLastMsgAt > 30_000) {
          teardownTdUpstream();
          broadcastStatus(PROVENANCE.DELAYED, "Twelve Data stream silent >30s; reconnecting");
          scheduleTdReconnect();
          return;
        }
        try {
          tdUpstream.send('{"action":"heartbeat"}');
        } catch (_e) {}
      }, 10_000);
      syncTdUpstreamSubscriptions();
      broadcastStatus(PROVENANCE.LIVE, "Twelve Data WebSocket connected");
    });

    uws.on("message", (raw) => {
      tdLastMsgAt = Date.now();
      try {
        const m = JSON.parse(String(raw));
        if (!m || typeof m !== "object") return;
        if (m.event === "heartbeat" || m.event === "unsubscribe-status") return;
        if (m.event === "subscribe-status") {
          lastTdSubStatus = {
            status: m.status || null,
            success: Array.isArray(m.success) ? m.success.map((x) => (typeof x === "string" ? x : x && x.symbol)) : [],
            fails: Array.isArray(m.fails) ? m.fails.map((x) => (typeof x === "string" ? x : x && (x.symbol || x.message))) : [],
          };
          const { released } = tdSlots.handleSubscribeStatus(m);
          if (released.length > 0) {
            // Immediately backfill freed slots with waiting valid symbols
            syncTdUpstreamSubscriptions();
          }
          return;
        }
        if (m.event === "price" || (m.symbol && (m.price !== undefined || m.c !== undefined))) {
          const internalSym = tdSlots.resolveInternal(m.symbol);
          if (!internalSym) return;
          const rawT = Number(m.timestamp ?? m.t ?? Date.now());
          const tickMs = Number.isFinite(rawT) && rawT > 0 ? (rawT < 1e12 ? rawT * 1000 : rawT) : Date.now();
          const { tickVol, dayVol } = extractTdTickVol(internalSym, m, tickMs);
          ingestServerTick(
            {
              s: internalSym,
              c: m.price ?? m.c,
              t: tickMs,
              bid: m.bid,
              ask: m.ask,
              v: tickVol,
              src: "twelvedata",
            },
            { dayVol, source: "twelvedata" }
          );
        }
      } catch (_e) {}
    });

    const onLost = () => {
      if (tdUpstream !== uws) return;
      clearInterval(tdHbTimer);
      tdHbTimer = null;
      tdUpstream = null;
      tdConnected = false;
      tdSlots.resetActive();
      if (clients.size > 0) {
        broadcastStatus(PROVENANCE.DELAYED, "Twelve Data stream disconnected; reconnecting");
        scheduleTdReconnect();
      }
    };
    uws.on("close", onLost);
    uws.on("error", () => {
      try { uws.close(); } catch (_e) {}
      onLost();
    });
  } catch (_e) {
    tdUpstream = null;
    tdConnected = false;
    scheduleTdReconnect();
  }
}

const BINANCE_WS_URLS = [
  "wss://data-stream.binance.vision/ws/!miniTicker@arr",
  "wss://stream.binance.com:9443/ws/!miniTicker@arr",
];

// Local-dev connector: the `ws` package speaks addEventListener, so the shared feed (exponential backoff,
// 24h rotation, serverShutdown handling, stall watchdog) runs unchanged here.
function openBinanceNodeWs() {
  return new Promise((resolve, reject) => {
    let i = 0;
    const attempt = () => {
      const uws = new WebSocket(BINANCE_WS_URLS[i % BINANCE_WS_URLS.length]);
      uws.once("open", () => resolve(uws));
      uws.once("error", (err) => {
        try { uws.close(); } catch (_e) {}
        i += 1;
        if (i >= BINANCE_WS_URLS.length) reject(err);
        else attempt();
      });
    };
    attempt();
  });
}

function ensureBinanceUpstream() {
  if (binanceUpstream || clients.size === 0) return;
  if (resolveCryptoProvider(process.env) !== "binance") return; // CRYPTO_PROVIDER=twelvedata: crypto rides Twelve Data
  binanceUpstream = new BinanceMiniTickerFeed({
    connect: openBinanceNodeWs,
    // Prefer Twelve Data WebSocket whenever a symbol is actively streamed from Twelve Data
    accept: (sym) => sym.endsWith("USDT") && !STABLE_RE.test(sym) && !(tdConnected && tdSlots.has(sym)),
    onRows: (rows) => {
      for (const t of rows) {
        const vol = t.v;
        const pct = t.o > 0 ? ((t.c - t.o) / t.o) * 100 : NaN;
        ingestServerTick(
          { s: t.s, c: t.c, t: t.t, v: Number.isFinite(vol) && vol >= 0 ? vol : 0, src: "binance" },
          {
            dayVol: Number.isFinite(vol) && vol >= 0 ? vol : undefined,
            chgPct: Number.isFinite(pct) ? Number(pct.toFixed(2)) : undefined,
            source: "binance",
          }
        );
      }
    },
  });
  binanceUpstream.start();
}

function replayKnownQuotesToClient(ws, state) {
  const replay = [];
  const syms = new Set(state.subs);
  if (state.chart && state.chart.sym) syms.add(state.chart.sym);
  for (const s of syms) {
    const q = liveQuotes.get(s);
    if (q && q.c > 0) {
      const prov = tdConnected && tdSlots.has(s) ? PROVENANCE.LIVE : PROVENANCE.CACHED;
      replay.push(toProtocolQuote(q, prov));
    }
  }
  if (!replay.length) return;
  const frames = packQuoteFrames(replay, () => state.seq.next());
  for (const frame of frames) {
    try {
      ws.send(JSON.stringify(frame));
    } catch (_e) {
      break;
    }
  }
}

wss.on("connection", (ws) => {
  const state = { subs: new Set(), chart: null, seq: createSequencer(0) };
  clients.set(ws, state);
  ensureBinanceUpstream();

  sendFrameToClient(ws, state, "hello", {
    serverTime: Date.now(),
    capabilities: ["bars", "quotes", "screener", "heatmap"],
  });

  ws.on("message", (raw) => {
    try {
      const text = String(raw);
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") return;

      // Protocol v2 messages (`hello`, `ping`, `view`)
      if (parsed.op) {
        const check = validateClientMessage(parsed);
        if (!check.ok) {
          sendFrameToClient(ws, state, "error", {
            code: check.code,
            message: check.error,
            fatal: false,
          });
          return;
        }
        const msg = check.value;
        if (msg.op === "ping") {
          sendFrameToClient(ws, state, "pong", msg.t ? { t: msg.t } : {}, { seq: 0 });
          return;
        }
        if (msg.op === "hello") {
          sendFrameToClient(ws, state, "hello", {
            serverTime: Date.now(),
            capabilities: ["bars", "quotes", "screener", "heatmap"],
            ...(msg.session ? { session: msg.session } : {}),
          });
          return;
        }
        if (msg.op === "view") {
          const nextSubs = new Set();
          if (msg.chart && msg.chart.sym) {
            const sym = normSymbol(msg.chart.sym);
            const tf = normalizeTf(msg.chart.tf || "1H") || "1H";
            if (sym) {
              state.chart = { sym, tf };
              nextSubs.add(sym);
            }
          } else if (msg.chart === null) {
            state.chart = null;
          }
          if (Array.isArray(msg.watchlist)) {
            for (const s of msg.watchlist) {
              const ns = normSymbol(s);
              if (ns) nextSubs.add(ns);
            }
          } else if (state.subs.size) {
            for (const s of state.subs) nextSubs.add(s);
          }
          state.subs = nextSubs;
          syncTdUpstreamSubscriptions();
          replayKnownQuotesToClient(ws, state);
          return;
        }
      }

      // Legacy fallback messages (`type: "ping" | "subscribe"`)
      if (parsed.type === "ping") {
        sendFrameToClient(ws, state, "pong", { t: Date.now() }, { seq: 0 });
        return;
      }
      if (parsed.type === "subscribe") {
        if (Array.isArray(parsed.symbols)) {
          state.subs = new Set(parsed.symbols.map((s) => normSymbol(s)).filter(Boolean));
        } else if (parsed.symbol) {
          const ns = normSymbol(parsed.symbol);
          if (ns) state.subs.add(ns);
        }
        if (parsed.interval && STEPS[parsed.interval] && state.subs.size) {
          const first = [...state.subs][0];
          state.chart = { sym: first, tf: normalizeTf(parsed.interval) || "1H" };
        }
        syncTdUpstreamSubscriptions();
        replayKnownQuotesToClient(ws, state);
      }
    } catch (_e) {}
  });

  ws.on("close", () => {
    clients.delete(ws);
    if (clients.size === 0) {
      teardownTdUpstream();
      if (binanceUpstream) {
        try { binanceUpstream.stop(); } catch (_e) {}
        binanceUpstream = null;
      }
    } else {
      syncTdUpstreamSubscriptions();
    }
  });
});

// Keep live upstream WebSockets healthy while clients are connected (zero simulated ticks)
setInterval(() => {
  if (clients.size === 0) return;
  ensureBinanceUpstream();
  if (TWELVEDATA_KEY && !tdUpstream && !tdReconnectTimer) {
    ensureTdUpstream();
  }
}, 15000);

server.listen(PORT, HOST, () => {
  console.log(`Vektor Terminal listening on http://${HOST}:${PORT}`);
});
