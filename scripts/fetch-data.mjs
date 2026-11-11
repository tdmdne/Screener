// Downloads market data on GitHub's servers and writes it to site/data/.
// Needs Node 22 (built-in fetch and WebSocket). No packages to install.
import fs from "node:fs";

const TFS = ["1H", "4H", "1D", "1W", "1M"];
const KEEP = 220;                       // candles kept per series
const OUT = "site/data";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const out = Object.fromEntries(TFS.map(t => [t, {}]));   // out[tf][name] = [[t,o,h,l,c,v], ...]
const uni = [];                                          // [name, market, tvSymbol, price, volume, provider, providerSymbol]
let ok = 0, fail = 0;

const r6 = x => +Number(x).toPrecision(7);
const put = (tf, name, rows) => {
  const a = rows.filter(r => r[4] > 0).slice(-KEEP).map(r => [r[0], r6(r[1]), r6(r[2]), r6(r[3]), r6(r[4]), Math.round(r[5] || 0)]);
  if (a.length > 5) { out[tf][name] = a; ok++; } else fail++;
};
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const it = items[i++]; try { await fn(it); } catch { fail++; } }
  }));
}

// ---------- Binance (crypto) ----------
const BNI = { "1H": "1h", "4H": "4h", "1D": "1d", "1W": "1w", "1M": "1M" };
const STABLE = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|USDE|XUSD|AEUR|EUR|PYUSD|USD1)USDT$/;
async function binance() {
  let base, ticker;
  for (const h of ["https://data-api.binance.vision", "https://api.binance.com"]) {
    try { const r = await fetch(h + "/api/v3/ticker/24hr"); if (r.ok) { ticker = await r.json(); base = h; break; } } catch {}
  }
  if (!ticker) { log("Binance: unavailable from this server (possibly region-blocked) - skipping"); return; }
  const top = ticker.filter(x => x.symbol.endsWith("USDT") && !STABLE.test(x.symbol) && +x.quoteVolume > 0)
    .sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 150);
  top.forEach(x => uni.push([x.symbol, "CRY", "BINANCE:" + x.symbol, +x.lastPrice, +x.volume, "bn", x.symbol]));
  await pool(top.flatMap(x => TFS.map(tf => [x.symbol, tf])), 5, async ([s, tf]) => {
    const r = await fetch(`${base}/api/v3/klines?symbol=${s}&interval=${BNI[tf]}&limit=250`);
    if (!r.ok) throw 0;
    put(tf, s, (await r.json()).map(k => [Math.floor(k[0] / 1000), +k[1], +k[2], +k[3], +k[4], +k[5]]));
    await sleep(60);
  });
  log("Binance: done");
}

// ---------- Yahoo (forex, futures, indices, stocks, ETFs) ----------
const YI = { "1H": ["60m", "3mo"], "4H": ["60m", "6mo"], "1D": ["1d", "2y"], "1W": ["1wk", "10y"], "1M": ["1mo", "max"] };
function parseY(c, tf) {
  const q = c.indicators.quote[0], t = c.timestamp; let a = [];
  for (let i = 0; i < t.length; i++) if (q.close[i] != null && q.open[i] != null) a.push([t[i], q.open[i], q.high[i], q.low[i], q.close[i], q.volume[i] || 0]);
  if (tf === "4H") {
    const m = new Map();
    for (const x of a) {
      const b = Math.floor(x[0] / 14400) * 14400, y = m.get(b);
      if (!y) m.set(b, [b, x[1], x[2], x[3], x[4], x[5]]); else { y[2] = Math.max(y[2], x[2]); y[3] = Math.min(y[3], x[3]); y[4] = x[4]; y[5] += x[5]; }
    }
    a = [...m.values()];
  }
  return a;
}
async function yahoo(sym, tf) {
  const [iv, rg] = YI[tf];
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const h of ["query1", "query2"]) {
      try {
        const r = await fetch(`https://${h}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${iv}&range=${rg}`, { headers: { "User-Agent": UA } });
        if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
        if (!r.ok) continue;
        const j = await r.json();
        if (j.chart && j.chart.error) return null;
        const c = j.chart && j.chart.result && j.chart.result[0];
        if (!c || !c.timestamp) continue;
        return parseY(c, tf);
      } catch {}
    }
    await sleep(500);
  }
  return null;
}
const FX = "EUR/USD GBP/USD USD/JPY USD/CHF AUD/USD USD/CAD NZD/USD EUR/GBP EUR/JPY EUR/CHF EUR/AUD EUR/CAD EUR/NZD GBP/JPY GBP/CHF GBP/AUD GBP/CAD GBP/NZD AUD/JPY AUD/CHF AUD/CAD AUD/NZD CAD/JPY CAD/CHF CHF/JPY NZD/JPY NZD/CHF NZD/CAD USD/MXN USD/ZAR USD/TRY USD/SEK USD/NOK USD/DKK USD/PLN USD/HUF USD/CZK USD/SGD USD/HKD USD/CNH USD/ILS EUR/SEK EUR/NOK EUR/PLN EUR/TRY EUR/HUF".split(" ");
const IDX = [["SPX", "^GSPC", "SP:SPX"], ["NASDAQ", "^IXIC", "NASDAQ:IXIC"], ["DJI", "^DJI", "DJ:DJI"], ["RUT", "^RUT", "TVC:RUT"], ["VIX", "^VIX", "TVC:VIX"], ["FTSE", "^FTSE", "TVC:UKX"], ["DAX", "^GDAXI", "XETR:DAX"], ["CAC40", "^FCHI", "TVC:CAC40"], ["STOXX50", "^STOXX50E", "TVC:SX5E"], ["N225", "^N225", "TVC:NI225"], ["HSI", "^HSI", "TVC:HSI"], ["ASX200", "^AXJO", "ASX:XJO"], ["KOSPI", "^KS11", "TVC:KOSPI"], ["SENSEX", "^BSESN", "BSE:SENSEX"], ["TSX", "^GSPTSE", "TSX:TSX"]];
const FUT = "ES NQ YM RTY CL BZ NG GC SI HG PL ZB ZN ZF ZT ZC ZS ZW KC SB CC CT 6E 6B 6J 6A 6C 6S".split(" ");
const STK = "AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO BRK-B LLY JPM V UNH XOM MA COST HD PG JNJ ABBV NFLX BAC CRM ORCL CVX WMT KO MRK AMD PEP TMO ADBE LIN ACN MCD CSCO ABT DIS TXN WFC INTU QCOM GE IBM CAT AMGN VZ DHR PM AMAT NOW ISRG UBER GS BKNG SPGI RTX NEE LOW T HON UNP PFE AXP BLK ELV PLTR COP SYK TJX MU LRCX ADI BA COIN MSTR SMCI MARA RIOT SOFI HOOD SHOP SNOW CRWD PANW DDOG NET ARM ASML TSM BABA PDD F GM NIO RIVN LCID AAL DAL UAL CCL NCLH FCX NEM AMC GME RBLX U PYPL INTC MRVL ON ABNB DASH ROKU ZM".split(" ");
const ETF = "SPY QQQ IWM DIA GLD SLV USO UNG TLT XLE XLF XLK XLV XLY XLP XLI XLU XLB ARKK SMH SOXL TQQQ SQQQ".split(" ");
const CRY = "BTC ETH BNB SOL XRP ADA DOGE AVAX DOT LINK LTC BCH ATOM XLM NEAR ETC FIL TRX SHIB ICP AAVE ALGO XMR HBAR".split(" ");

async function yahooAll(skip) {
  const list = [
    ...FX.map(p => ({ n: p.replace("/", ""), m: "FX", y: p.replace("/", "") + "=X", tv: "FX:" + p.replace("/", "") })),
    { n: "XAUUSD", m: "CFD", y: "XAUUSD=X", tv: "OANDA:XAUUSD" }, { n: "XAGUSD", m: "CFD", y: "XAGUSD=X", tv: "OANDA:XAGUSD" },
    ...IDX.map(([n, y, tv]) => ({ n, m: "IDX", y, tv })),
    ...FUT.map(n => ({ n: n + "=F", m: "FUT", y: n + "=F", tv: n + "1!" })),
    ...STK.map(n => ({ n: n.replace("-", ""), m: "STK", y: n, tv: "" })),
    ...ETF.map(n => ({ n, m: "ETF", y: n, tv: "" })),
    ...(out["1D"] && uni.some(u => u[5] === "bn") ? [] : CRY.map(n => ({ n: n + "USD", m: "CRY", y: n + "-USD", tv: "COINBASE:" + n + "USD" }))),
  ].filter(x => !skip.has(x.n) && !(skip.size && ["FX", "CFD", "IDX"].includes(x.m)));   // when IC Markets is connected, it supplies forex, metals and indices
  list.forEach(x => uni.push([x.n, x.m, x.tv, 0, 0, "yf", x.y]));
  await pool(list.flatMap(x => TFS.map(tf => [x, tf])), 4, async ([x, tf]) => {
    const rows = await yahoo(x.y, tf);
    if (rows) put(tf, x.n, rows); else fail++;
    await sleep(120);
  });
  log("Yahoo: done");
}

// ---------- IC Markets (cTrader Open API) - only if secrets are set ----------
// Credentials are used from GitHub Secrets if you add them, otherwise from these defaults.
const IC_DEFAULT = { id: "48268_ERLvtukwIDdY4bsHqCaM4y3fa6kM7Y0gFDxeETE9shbNyTaesd", sec: "Rq0FmGOMnvzOHZcjRTRQE2wdVllLbR8ZMiJ6CvNEZup9G8yYXp", tok: "3MyzHSgMYVy7moLQmfl0Sp06jH-li3TG_0RXAJT-zHI" };
const ICP = { "1H": 9, "4H": 10, "1D": 12, "1W": 13, "1M": 14 }, DAY = 864e5;
const ICS = { "1H": 30 * DAY, "4H": 90 * DAY, "1D": 365 * DAY, "1W": 1800 * DAY, "1M": 1825 * DAY };
async function icRun(live, id, sec, tok) {
  const names = new Set();
  const ws = new WebSocket(`wss://${live ? "live" : "demo"}.ctraderapi.com:5036`);
  let n = 1; const pend = {};
  ws.onmessage = e => { const m = JSON.parse(e.data), f = m.clientMsgId && pend[m.clientMsgId]; if (f) f(m); };
  const req = (type, payload) => new Promise((res, rej) => {
    const k = "m" + n++, t = setTimeout(() => { delete pend[k]; rej(new Error("timeout")); }, 20000);
    pend[k] = m => { clearTimeout(t); delete pend[k]; m.payloadType === 2142 ? rej(new Error((m.payload && m.payload.description) || "error")) : res(m.payload || {}); };
    ws.send(JSON.stringify({ clientMsgId: k, payloadType: type, payload }));
  });
  let hb;
  try {
    await new Promise((ok2, no) => { ws.onopen = ok2; ws.onerror = () => no(new Error("could not connect")); });
    hb = setInterval(() => { try { ws.send(JSON.stringify({ payloadType: 51, payload: {} })); } catch {} }, 9000);
    await req(2100, { clientId: id, clientSecret: sec });
    const al = await req(2149, { accessToken: tok }), accs = al.ctidTraderAccount || [];
    const a = accs.find(x => !!x.isLive === live) || accs[0];
    if (!a) throw new Error("no trading account found for this token");
    const acct = +a.ctidTraderAccountId;
    await req(2102, { ctidTraderAccountId: acct, accessToken: tok });
    const cr = await req(2160, { ctidTraderAccountId: acct }), cats = {};
    (cr.symbolCategory || []).forEach(c => { cats[c.id] = c.name || ""; });
    const sr = await req(2114, { ctidTraderAccountId: acct, includeArchivedSymbols: false });
    const syms = (sr.lightSymbol || []).filter(x => x.enabled !== false).map(x => {
      const cn = cats[x.symbolCategoryId] || "";
      const m = /share|stock|equit|etf/i.test(cn) ? null : /forex|currenc|fx/i.test(cn) ? "FX" : /index|indic/i.test(cn) ? "IDX" : /crypto/i.test(cn) ? "CRY" : "CFD";
      return m && { n: x.symbolName, m, id: x.symbolId };
    }).filter(Boolean);
    log(`IC Markets (${live ? "live" : "demo"}): ${syms.length} symbols`);
    syms.forEach(s => { names.add(s.n); uni.push([s.n, s.m, "ICMARKETS:" + s.n, 0, 0, "ic", s.id]); });
    for (const s of syms) for (const tf of TFS) {
      try {
        const to = Date.now(), r = await req(2137, { ctidTraderAccountId: acct, symbolId: s.id, period: ICP[tf], fromTimestamp: to - ICS[tf], toTimestamp: to });
        const d = x => +(x || 0);
        put(tf, s.n, (r.trendbar || []).map(b => { const lo = d(b.low); return [b.utcTimestampInMinutes * 60, (lo + d(b.deltaOpen)) / 1e5, (lo + d(b.deltaHigh)) / 1e5, lo / 1e5, (lo + d(b.deltaClose)) / 1e5, d(b.volume)]; }));
      } catch { fail++; }
      await sleep(230);                                  // cTrader allows about 5 history requests a second
    }
  } finally { clearInterval(hb); try { ws.close(); } catch {} }
  return names;
}
async function icMarkets() {
  const id = process.env.IC_CLIENT_ID || IC_DEFAULT.id, sec = process.env.IC_CLIENT_SECRET || IC_DEFAULT.sec, tok = process.env.IC_ACCESS_TOKEN || IC_DEFAULT.tok;
  if (!(id && sec && tok)) { log("IC Markets: no credentials set - skipping"); return new Set(); }
  for (const live of process.env.IC_DEMO ? [false, true] : [true, false]) {   // tries the other environment if the first one rejects the token
    try { const names = await icRun(live, id, sec, tok); if (names.size) return names; }
    catch (e) { log(`IC Markets (${live ? "live" : "demo"}) failed:`, e.message); uni.length = 0; }
  }
  return new Set();
}

// ---------- main ----------
const icNames = await icMarkets();
await binance();
await yahooAll(icNames);                                  // skips anything IC Markets already provided

// fill price and average volume from the daily candles where the provider gave none
for (const u of uni) {
  const d = out["1D"][u[0]];
  if (d && d.length) {
    if (!u[3]) u[3] = d[d.length - 1][4];
    if (!u[4] && (u[1] === "STK" || u[1] === "ETF" || u[1] === "FUT")) u[4] = Math.round(d.slice(-7).reduce((s, r) => s + r[5], 0) / Math.min(7, d.length));
  }
}
const universe = uni.filter(u => TFS.some(tf => out[tf][u[0]]));
if (ok < 50) { console.error(`Only ${ok} series downloaded - not publishing so the last good data stays online.`); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });
for (const tf of TFS) fs.writeFileSync(`${OUT}/c_${tf}.json`, JSON.stringify(out[tf]));
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ t: Date.now(), tfs: TFS, universe }));
log(`Done: ${ok} series ok, ${fail} failed, ${universe.length} symbols`);

