const http = require("http");
const path = require("path");
const express = require("express");
const WebSocket = require("ws");
// Catalogs, interval maps and symbol helpers live in shared/ (ES modules, single source of truth with worker.js).
// require() of ESM needs Node >= 22.12 (see SETUP.md / package.json "engines").
const { INTERVAL_SECONDS: STEPS, BINANCE_INTERVALS: BNI, TWELVEDATA_INTERVALS: TDI } = require("./shared/intervals.js");
const { BASE_INSTRUMENTS, INSTRUMENT_BY_SYMBOL: BY_SYM, DUKASCOPY_MAP, BINANCE_MIRRORS, STABLE_RE } = require("./shared/instruments.js");
const { resolveTdSymbol, inferMeta } = require("./shared/symbolNormalizer.js");
const { fetchYahooCandles, fetchYahooQuote, toYahooSymbol } = require("./shared/yahooFeed.js");
const { createLocalD1 } = require("./shared/localD1.js");
const { handleAuthRoute } = require("./shared/authRoutes.js");
const { handleWaitlistRoute } = require("./shared/waitlist.js");
const { jrStats, tradeStats, propStatus, equityCurve, drawdownSeries, rDistribution, dailyPnlCalendar } = require("./shared/journal.js");
const { createReplaySession } = require("./shared/replay.js");
const { createAlertEvaluator } = require("./shared/alerts.js");
const { vsCompute } = require("./shared/vs/index.js");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const TWELVEDATA_KEY = (process.env.TWELVEDATA_KEY || process.env.TWELVE_DATA_API_KEY || "").trim();
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
      if (r.status === 451 || (r.status >= 500 && r.status <= 599)) {
        continue;
      }
      return r;
    } catch (_e) {}
  }
  return null;
}

const dukaBlockCache = new Map();

const LIVE_SCREENER_NON_CRYPTO = BASE_INSTRUMENTS.filter((item) => item.m !== "CRY");
const LIVE_SCREENER_CRYPTO = BASE_INSTRUMENTS.filter((item) => item.m === "CRY");

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
let screenerSnapshot = { ts: 0, body: "" };
const candleCache = new Map();
const livePrices = new Map();

async function buildScreenerBody() {
  const ts = Date.now();
  const [bnRows, nonCryptoQuotes] = await Promise.all([
    fetchBinanceTickers(),
    fetchYahooLiveQuotes(LIVE_SCREENER_NON_CRYPTO, 10),
  ]);
  const cryptoFallbackQuotes = bnRows && bnRows.length
    ? new Map()
    : await fetchYahooLiveQuotes(LIVE_SCREENER_CRYPTO, 10);
  const seen = new Set();
  const universe = [];

  if (bnRows && bnRows.length) {
    for (const row of bnRows) {
      seen.add(row[0]);
      universe.push(row);
      if (row[2] > 0) livePrices.set(row[0], row[2]);
    }
  } else {
    for (const item of LIVE_SCREENER_CRYPTO) {
      const q = cryptoFallbackQuotes.get(item.s);
      if (!q || !(q.c > 0)) continue;
      seen.add(item.s);
      livePrices.set(item.s, q.c);
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
  }

  for (const item of LIVE_SCREENER_NON_CRYPTO) {
    if (seen.has(item.s)) continue;
    const q = nonCryptoQuotes.get(item.s);
    if (!q || !(q.c > 0)) continue;
    seen.add(item.s);
    livePrices.set(item.s, q.c);
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
  if (nonCryptoQuotes.size > 0 || cryptoFallbackQuotes.size > 0) sources.push("yahoo");
  const payload = {
    ok: true,
    ts,
    tfs: ["1D", "1H"],
    source: sources.length ? `edge+${sources.join("+")}` : "edge+unavailable",
    count: universe.length,
    universe,
  };
  const body = JSON.stringify(payload);
  screenerSnapshot = { ts, body };
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
        "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=30",
        "X-Cache": "HIT-EDGE",
        "Server-Timing": `edge;dur=${Date.now() - t0}`,
      });
      return res.send(screenerSnapshot.body);
    }
    const body = await buildScreenerBody();
    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=30",
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
      let px = livePrices.get(s);
      if (!(px > 0)) {
        const isCry = meta.pr === "bn" || meta.m === "CRY" || s.endsWith("USDT") || s.endsWith("BUSD") || s.endsWith("BTC");
        if (isCry) {
          const r = await fetchBinanceWithFallback(`/api/v3/ticker/price?symbol=${encodeURIComponent(meta.api || s)}`);
          if (r && r.ok) {
            const j = await r.json().catch(() => null);
            if (j && Number(j.price) > 0) px = Number(j.price);
          }
          if (!(px > 0)) {
            const q = await fetchYahooQuote(toYahooSymbol(s, meta.api));
            if (q && q.c > 0) px = q.c;
          }
        } else {
          const q = await fetchYahooQuote(toYahooSymbol(s, meta.api));
          if (q && q.c > 0) px = q.c;
        }
        if (px > 0) livePrices.set(s, px);
      }
      if (px > 0) {
        quotes[s] = { s, c: px, t: now, m: meta.m || "STK" };
      }
    })
  );
  return res.json({ ok: true, ts: Date.now(), quotes });
});

app.get("/api/ws-config", (_req, res) => {
  res.set({ "Cache-Control": "no-store" });
  return res.json({ ok: true, tdKey: "" }); // TASK-02: never expose the key
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
      res.set({
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${ttl}, s-maxage=${ttl}`,
        "X-Cache": "HIT-EDGE",
        "Server-Timing": `edge;dur=${Date.now() - t0}`,
      });
      return res.send(cached.body);
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
          bars = await fetchBinanceCandles(meta.api || rawSym, interval, opts);
          if (bars) source = "binance";
          if (!bars) {
            bars = await fetchYahooCandles(toYahooSymbol(rawSym, meta.api), interval, opts);
            if (bars && bars.length) source = "yahoo";
          }
        } else if (DUKASCOPY_MAP[rawSym]) {
          bars = await fetchDukascopyCandles(rawSym, interval, opts, livePrices.get(rawSym) || meta.p);
          if (bars) source = "dukascopy";
        }
        if (!bars && !isCrypto && TWELVEDATA_KEY) {
          const tdResolved = resolveTdSymbol(meta.td || rawSym, "");
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
          bars = await fetchBinanceCandles(meta.api || rawSym, interval, opts);
          if (bars !== null) source = "binance";
          if (bars === null) {
            bars = await fetchYahooCandles(toYahooSymbol(rawSym, meta.api), interval, opts);
            if (bars !== null) source = "yahoo";
          }
        } else {
          if (TWELVEDATA_KEY) {
            const tdResolved = resolveTdSymbol(meta.td || rawSym, "");
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

  const payload = {
    ok: true,
    symbol: rawSym,
    interval,
    ttl,
    ts: Date.now(),
    source,
    hasMore: isHistoricalChunk ? bars.length > 0 : true,
    bars,
  };
  const body = JSON.stringify(payload);
  if (candleCache.size > 500) candleCache.clear();
  candleCache.set(cacheKey, { ts: Date.now(), body });

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
const clients = new Map(); // ws -> { subs: Set<string>, interval: string }
let binanceUpstream = null;

function broadcastWs(payload) {
  const raw = JSON.stringify(payload);
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(raw);
      } catch (_e) {}
    }
  }
}

function ensureBinanceUpstream() {
  if (binanceUpstream || clients.size === 0) return;
  try {
    const uws = new WebSocket("wss://stream.binance.com:9443/ws/!ticker@arr");
    binanceUpstream = uws;
    uws.on("message", (data) => {
      try {
        const arr = JSON.parse(String(data));
        if (!Array.isArray(arr)) return;
        const ticks = [];
        for (const t of arr) {
          if (!t.s || !t.s.endsWith("USDT") || STABLE_RE.test(t.s)) continue;
          const c = +t.c;
          if (c > 0) {
            livePrices.set(t.s, c);
            ticks.push({ s: t.s, c, h: +t.h, l: +t.l, v: +t.v });
          }
        }
        if (ticks.length) {
          broadcastWs({ type: "ticks", source: "binance", ticks: ticks.slice(0, 120), ts: Date.now() });
        }
      } catch (_e) {}
    });
    uws.on("close", () => { binanceUpstream = null; });
    uws.on("error", () => {
      try { uws.close(); } catch (_e) {}
      binanceUpstream = null;
    });
  } catch (_e) {
    binanceUpstream = null;
  }
}

wss.on("connection", (ws) => {
  clients.set(ws, { subs: new Set(), interval: "1H" });
  ensureBinanceUpstream();

  ws.send(
    JSON.stringify({
      type: "hello",
      relay: "NodeLocalRelay",
      hibernation: false,
      mode: TWELVEDATA_KEY ? "live+twelvedata" : "live",
      ts: Date.now(),
    })
  );

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        return;
      }
      if (msg.type === "subscribe") {
        const state = clients.get(ws) || { subs: new Set(), interval: "1H" };
        if (Array.isArray(msg.symbols)) {
          state.subs = new Set(msg.symbols.map((s) => String(s).toUpperCase()));
        } else if (msg.symbol) {
          state.subs.add(String(msg.symbol).toUpperCase());
        }
        if (msg.interval && STEPS[msg.interval]) state.interval = msg.interval;
        clients.set(ws, state);
      }
    } catch (_e) {}
  });

  ws.on("close", () => {
    clients.delete(ws);
    if (clients.size === 0 && binanceUpstream) {
      try { binanceUpstream.close(); } catch (_e) {}
      binanceUpstream = null;
    }
  });
});

// Keep live Binance WebSocket connected while clients are open (zero simulated ticks)
setInterval(() => {
  if (clients.size === 0) return;
  ensureBinanceUpstream();
}, 15000);

server.listen(PORT, HOST, () => {
  console.log(`Vektor Terminal listening on http://${HOST}:${PORT}`);
});
