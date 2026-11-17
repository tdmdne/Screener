// ---------- TradingView-Style Instant Symbol Search ----------
const VT_SR_TABS = ["All", "Stocks", "Forex", "Crypto", "Futures", "Indices"];

const VT_CATALOG = [
  // ETFs & Popular Q-tickers (plus major ETFs)
  ["QQQ", "Invesco QQQ Trust", "ETF", "NASDAQ", "QQQ", "NASDAQ:QQQ", "yf", "QQQ"],
  ["SPY", "SPDR S&P 500 ETF Trust", "ETF", "NYSE ARCA", "SPY", "AMEX:SPY", "yf", "SPY"],
  ["IWM", "iShares Russell 2000 ETF", "ETF", "NYSE ARCA", "IWM", "AMEX:IWM", "yf", "IWM"],
  ["DIA", "SPDR Dow Jones Industrial Average ETF", "ETF", "NYSE ARCA", "DIA", "AMEX:DIA", "yf", "DIA"],
  ["GLD", "SPDR Gold Shares", "ETF", "NYSE ARCA", "GLD", "AMEX:GLD", "yf", "GLD"],
  ["SLV", "iShares Silver Trust", "ETF", "NYSE ARCA", "SLV", "AMEX:SLV", "yf", "SLV"],
  ["USO", "United States Oil Fund", "ETF", "NYSE ARCA", "USO", "AMEX:USO", "yf", "USO"],
  ["TLT", "iShares 20+ Year Treasury Bond ETF", "ETF", "NASDAQ", "TLT", "NASDAQ:TLT", "yf", "TLT"],
  ["SMH", "VanEck Semiconductor ETF", "ETF", "NASDAQ", "SMH", "NASDAQ:SMH", "yf", "SMH"],
  ["TQQQ", "ProShares UltraPro QQQ", "ETF", "NASDAQ", "TQQQ", "NASDAQ:TQQQ", "yf", "TQQQ"],
  ["SQQQ", "ProShares UltraPro Short QQQ", "ETF", "NASDAQ", "SQQQ", "NASDAQ:SQQQ", "yf", "SQQQ"],
  ["QTUM", "Defiance Quantum ETF", "ETF", "NASDAQ", "QTUM", "NASDAQ:QTUM", "yf", "QTUM"],
  ["ARKK", "ARK Innovation ETF", "ETF", "NYSE ARCA", "ARKK", "AMEX:ARKK", "yf", "ARKK"],
  // Stocks (including QCOM, QRVO, QS, QLYS, QGEN, QSR + major US equities)
  ["QCOM", "QUALCOMM Incorporated", "STK", "NASDAQ", "QCOM", "NASDAQ:QCOM", "yf", "QCOM"],
  ["QRVO", "Qorvo, Inc.", "STK", "NASDAQ", "QRVO", "NASDAQ:QRVO", "yf", "QRVO"],
  ["QS", "QuantumScape Corporation", "STK", "NYSE", "QS", "NYSE:QS", "yf", "QS"],
  ["QLYS", "Qualys, Inc.", "STK", "NASDAQ", "QLYS", "NASDAQ:QLYS", "yf", "QLYS"],
  ["QGEN", "QIAGEN N.V.", "STK", "NYSE", "QGEN", "NYSE:QGEN", "yf", "QGEN"],
  ["QSR", "Restaurant Brands International Inc.", "STK", "NYSE", "QSR", "NYSE:QSR", "yf", "QSR"],
  ["AAPL", "Apple Inc.", "STK", "NASDAQ", "AAPL", "NASDAQ:AAPL", "yf", "AAPL"],
  ["MSFT", "Microsoft Corporation", "STK", "NASDAQ", "MSFT", "NASDAQ:MSFT", "yf", "MSFT"],
  ["NVDA", "NVIDIA Corporation", "STK", "NASDAQ", "NVDA", "NASDAQ:NVDA", "yf", "NVDA"],
  ["AMZN", "Amazon.com, Inc.", "STK", "NASDAQ", "AMZN", "NASDAQ:AMZN", "yf", "AMZN"],
  ["GOOGL", "Alphabet Inc.", "STK", "NASDAQ", "GOOGL", "NASDAQ:GOOGL", "yf", "GOOGL"],
  ["META", "Meta Platforms, Inc.", "STK", "NASDAQ", "META", "NASDAQ:META", "yf", "META"],
  ["TSLA", "Tesla, Inc.", "STK", "NASDAQ", "TSLA", "NASDAQ:TSLA", "yf", "TSLA"],
  ["AVGO", "Broadcom Inc.", "STK", "NASDAQ", "AVGO", "NASDAQ:AVGO", "yf", "AVGO"],
  ["AMD", "Advanced Micro Devices, Inc.", "STK", "NASDAQ", "AMD", "NASDAQ:AMD", "yf", "AMD"],
  ["PLTR", "Palantir Technologies Inc.", "STK", "NASDAQ", "PLTR", "NASDAQ:PLTR", "yf", "PLTR"],
  ["NFLX", "Netflix, Inc.", "STK", "NASDAQ", "NFLX", "NASDAQ:NFLX", "yf", "NFLX"],
  ["CRM", "Salesforce, Inc.", "STK", "NYSE", "CRM", "NYSE:CRM", "yf", "CRM"],
  ["ORCL", "Oracle Corporation", "STK", "NYSE", "ORCL", "NYSE:ORCL", "yf", "ORCL"],
  ["JPM", "JPMorgan Chase & Co.", "STK", "NYSE", "JPM", "NYSE:JPM", "yf", "JPM"],
  ["GS", "The Goldman Sachs Group, Inc.", "STK", "NYSE", "GS", "NYSE:GS", "yf", "GS"],
  ["COIN", "Coinbase Global, Inc.", "STK", "NASDAQ", "COIN", "NASDAQ:COIN", "yf", "COIN"],
  ["MSTR", "MicroStrategy Incorporated", "STK", "NASDAQ", "MSTR", "NASDAQ:MSTR", "yf", "MSTR"],
  ["SMCI", "Super Micro Computer, Inc.", "STK", "NASDAQ", "SMCI", "NASDAQ:SMCI", "yf", "SMCI"],
  ["ARM", "Arm Holdings plc", "STK", "NASDAQ", "ARM", "NASDAQ:ARM", "yf", "ARM"],
  ["MU", "Micron Technology, Inc.", "STK", "NASDAQ", "MU", "NASDAQ:MU", "yf", "MU"],
  ["INTC", "Intel Corporation", "STK", "NASDAQ", "INTC", "NASDAQ:INTC", "yf", "INTC"],
  ["BA", "The Boeing Company", "STK", "NYSE", "BA", "NYSE:BA", "yf", "BA"],
  ["DIS", "The Walt Disney Company", "STK", "NYSE", "DIS", "NYSE:DIS", "yf", "DIS"],
  ["UBER", "Uber Technologies, Inc.", "STK", "NYSE", "UBER", "NYSE:UBER", "yf", "UBER"],
  ["SHOP", "Shopify Inc.", "STK", "NYSE", "SHOP", "NYSE:SHOP", "yf", "SHOP"],
  ["CRWD", "CrowdStrike Holdings, Inc.", "STK", "NASDAQ", "CRWD", "NASDAQ:CRWD", "yf", "CRWD"],
  ["PANW", "Palo Alto Networks, Inc.", "STK", "NASDAQ", "PANW", "NASDAQ:PANW", "yf", "PANW"],
  ["TSM", "Taiwan Semiconductor Manufacturing", "STK", "NYSE", "TSM", "NYSE:TSM", "yf", "TSM"],
  ["ASML", "ASML Holding N.V.", "STK", "NASDAQ", "ASML", "NASDAQ:ASML", "yf", "ASML"],
  // Crypto
  ["BTCUSDT", "Bitcoin / Tether", "CRY", "BINANCE", "BTCUSDT", "BINANCE:BTCUSDT", "bn", "BTC/USD"],
  ["ETHUSDT", "Ethereum / Tether", "CRY", "BINANCE", "ETHUSDT", "BINANCE:ETHUSDT", "bn", "ETH/USD"],
  ["SOLUSDT", "Solana / Tether", "CRY", "BINANCE", "SOLUSDT", "BINANCE:SOLUSDT", "bn", "SOL/USD"],
  ["BNBUSDT", "BNB / Tether", "CRY", "BINANCE", "BNBUSDT", "BINANCE:BNBUSDT", "bn", "BNB/USD"],
  ["XRPUSDT", "XRP / Tether", "CRY", "BINANCE", "XRPUSDT", "BINANCE:XRPUSDT", "bn", "XRP/USD"],
  ["DOGEUSDT", "Dogecoin / Tether", "CRY", "BINANCE", "DOGEUSDT", "BINANCE:DOGEUSDT", "bn", "DOGE/USD"],
  ["ADAUSDT", "Cardano / Tether", "CRY", "BINANCE", "ADAUSDT", "BINANCE:ADAUSDT", "bn", "ADA/USD"],
  ["AVAXUSDT", "Avalanche / Tether", "CRY", "BINANCE", "AVAXUSDT", "BINANCE:AVAXUSDT", "bn", "AVAX/USD"],
  ["LINKUSDT", "Chainlink / Tether", "CRY", "BINANCE", "LINKUSDT", "BINANCE:LINKUSDT", "bn", "LINK/USD"],
  ["QNTUSDT", "Quant / Tether", "CRY", "BINANCE", "QNTUSDT", "BINANCE:QNTUSDT", "bn", "QNT/USD"],
  ["QTUMUSDT", "Qtum / Tether", "CRY", "BINANCE", "QTUMUSDT", "BINANCE:QTUMUSDT", "bn", "QTUM/USD"],
  // Forex
  ["EURUSD", "Euro / US Dollar", "FX", "FX", "EURUSD=X", "FX:EURUSD", "yf", "EUR/USD"],
  ["GBPUSD", "British Pound / US Dollar", "FX", "FX", "GBPUSD=X", "FX:GBPUSD", "yf", "GBP/USD"],
  ["USDJPY", "US Dollar / Japanese Yen", "FX", "FX", "USDJPY=X", "FX:USDJPY", "yf", "USD/JPY"],
  ["USDCHF", "US Dollar / Swiss Franc", "FX", "FX", "USDCHF=X", "FX:USDCHF", "yf", "USD/CHF"],
  ["AUDUSD", "Australian Dollar / US Dollar", "FX", "FX", "AUDUSD=X", "FX:AUDUSD", "yf", "AUD/USD"],
  ["USDCAD", "US Dollar / Canadian Dollar", "FX", "FX", "USDCAD=X", "FX:USDCAD", "yf", "USD/CAD"],
  ["NZDUSD", "New Zealand Dollar / US Dollar", "FX", "FX", "NZDUSD=X", "FX:NZDUSD", "yf", "NZD/USD"],
  ["EURGBP", "Euro / British Pound", "FX", "FX", "EURGBP=X", "FX:EURGBP", "yf", "EUR/GBP"],
  ["EURJPY", "Euro / Japanese Yen", "FX", "FX", "EURJPY=X", "FX:EURJPY", "yf", "EUR/JPY"],
  ["GBPJPY", "British Pound / Japanese Yen", "FX", "FX", "GBPJPY=X", "FX:GBPJPY", "yf", "GBP/JPY"],
  ["XAUUSD", "Gold Spot / US Dollar", "CFD", "OANDA", "GC=F", "OANDA:XAUUSD", "yf", "XAU/USD"],
  ["XAGUSD", "Silver Spot / US Dollar", "CFD", "OANDA", "SI=F", "OANDA:XAGUSD", "yf", "XAG/USD"],
  // Futures
  ["ES=F", "E-mini S&P 500 Futures", "FUT", "CME", "ES=F", "CME_MINI:ES1!", "yf", "ES=F"],
  ["NQ=F", "E-mini Nasdaq-100 Futures", "FUT", "CME", "NQ=F", "CME_MINI:NQ1!", "yf", "NQ=F"],
  ["YM=F", "E-mini Dow ($5) Futures", "FUT", "CBOT", "YM=F", "CBOT_MINI:YM1!", "yf", "YM=F"],
  ["RTY=F", "E-mini Russell 2000 Futures", "FUT", "CME", "RTY=F", "CME_MINI:RTY1!", "yf", "RTY=F"],
  ["CL=F", "WTI Crude Oil Futures", "FUT", "NYMEX", "CL=F", "NYMEX:CL1!", "yf", "CL=F"],
  ["NG=F", "Henry Hub Natural Gas Futures", "FUT", "NYMEX", "NG=F", "NYMEX:NG1!", "yf", "NG=F"],
  ["GC=F", "Gold Futures", "FUT", "COMEX", "GC=F", "COMEX:GC1!", "yf", "GC=F"],
  ["SI=F", "Silver Futures", "FUT", "COMEX", "SI=F", "COMEX:SI1!", "yf", "SI=F"],
  ["ZN=F", "10-Year T-Note Futures", "FUT", "CBOT", "ZN=F", "CBOT:ZN1!", "yf", "ZN=F"],
  ["6E=F", "Euro FX Futures", "FUT", "CME", "6E=F", "CME:6E1!", "yf", "6E=F"],
  // Indices
  ["SPX", "S&P 500 Index", "IDX", "SP", "^GSPC", "SP:SPX", "yf", "SPX"],
  ["NASDAQ", "Nasdaq Composite Index", "IDX", "NASDAQ", "^IXIC", "NASDAQ:IXIC", "yf", "IXIC"],
  ["DJI", "Dow Jones Industrial Average", "IDX", "DJ", "^DJI", "DJ:DJI", "yf", "DJI"],
  ["RUT", "Russell 2000 Index", "IDX", "TVC", "^RUT", "TVC:RUT", "yf", "RUT"],
  ["VIX", "CBOE Volatility Index", "IDX", "CBOE", "^VIX", "TVC:VIX", "yf", "VIX"],
  ["DAX", "DAX Performance Index", "IDX", "XETR", "^GDAXI", "XETR:DAX", "yf", "DAX"],
  ["FTSE", "FTSE 100 Index", "IDX", "TVC", "^FTSE", "TVC:UKX", "yf", "FTSE"],
  ["N225", "Nikkei 225 Index", "IDX", "TVC", "^N225", "TVC:NI225", "yf", "N225"],
  ["US30", "Dow Jones 30 Index CFD", "IDX", "TVC", "^DJI", "TVC:DJI", "yf", "DJI"],
  ["DE40", "Germany 40 Index CFD", "IDX", "TVC", "^GDAXI", "TVC:DEU40", "yf", "DAX"],
  ["UK100", "UK 100 Index CFD", "IDX", "TVC", "^FTSE", "TVC:UKX", "yf", "FTSE"],
];

const VT_CAT_MAP = new Map(VT_CATALOG.map((x) => [x[0], x]));

function vtAssetLabel(m) {
  return (
    {
      STK: "Stocks",
      ETF: "ETF",
      FX: "Forex",
      CRY: "Crypto",
      FUT: "Futures",
      IDX: "Indices",
      CFD: "CFD",
    }[m] || m
  );
}

function vtInferExchange(s) {
  const cat = VT_CAT_MAP.get(s[0]);
  if (cat) return cat[3];
  const em = typeof VT_EDGE_META !== "undefined" && VT_EDGE_META.get(s[0]);
  if (em && em.ex) return em.ex;
  if (s[8] === "bn" || s[1] === "CRY") return "BINANCE";
  if (s[1] === "FX") return "FX";
  if (s[1] === "FUT") return "CME";
  if (s[1] === "IDX") return "INDEX";
  if (s[1] === "CFD") return "CFD";
  return "NASDAQ";
}

function vtInferName(s) {
  const cat = VT_CAT_MAP.get(s[0]);
  if (cat) return cat[1];
  const em = typeof VT_EDGE_META !== "undefined" && VT_EDGE_META.get(s[0]);
  if (em && em.name) return em.name;
  if (s[1] === "CRY" && s[0].endsWith("USDT")) return s[0].slice(0, -4) + " / Tether";
  return s[0];
}

function vtMatchTab(mkt, tab) {
  if (tab === "All") return true;
  if (tab === "Stocks") return mkt === "STK" || mkt === "ETF";
  if (tab === "Forex") return mkt === "FX";
  if (tab === "Crypto") return mkt === "CRY";
  if (tab === "Futures") return mkt === "FUT";
  if (tab === "Indices") return mkt === "IDX";
  return true;
}

function vtSearchCatalog() {
  const merged = new Map();
  for (let i = 0; i < VT_CATALOG.length; i++) {
    const c = VT_CATALOG[i];
    merged.set(c[0], {
      sym: c[0],
      name: c[1],
      m: c[2],
      ex: c[3],
      api: c[4],
      tv: c[5],
      pr: c[6],
      td: c[7],
      pri: i,
    });
  }
  if (Array.isArray(SYMS)) {
    for (let i = 0; i < SYMS.length; i++) {
      const s = SYMS[i];
      if (!s || !s[0] || merged.has(s[0])) continue;
      merged.set(s[0], {
        sym: s[0],
        name: vtInferName(s),
        m: s[1] || "STK",
        ex: vtInferExchange(s),
        api: s[6] || s[0],
        tv: s[7] || s[0],
        pr: s[8] || "yf",
        td: s[9] || s[0],
        pri: 1000 + i,
      });
    }
  }
  return [...merged.values()];
}

function vtSearchRank(query, tab, limit = 16) {
  const q = String(query || "").trim().toUpperCase();
  const list = vtSearchCatalog().filter((it) => vtMatchTab(it.m, tab));
  if (!q) {
    return list.sort((a, b) => a.pri - b.pri).slice(0, limit);
  }
  const scored = [];
  for (const it of list) {
    const sym = it.sym.toUpperCase();
    const nm = it.name.toUpperCase();
    let rank = 99;
    if (sym === q) rank = 0;
    else if (sym.startsWith(q)) rank = 1;
    else if (nm.split(/[\s/\-,]+/).some((w) => w.startsWith(q))) rank = 2;
    else if (sym.includes(q)) rank = 3;
    else if (nm.includes(q)) rank = 4;
    if (rank < 99) scored.push({ it, rank });
  }
  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.it.pri !== b.it.pri) return a.it.pri - b.it.pri;
    if (a.it.sym.length !== b.it.sym.length) return a.it.sym.length - b.it.sym.length;
    return a.it.sym.localeCompare(b.it.sym);
  });
  return scored.slice(0, limit).map((x) => x.it);
}

function vtHighlightPrefix(text, query) {
  const q = String(query || "").trim();
  if (!q) return esc(text);
  const idx = text.toUpperCase().indexOf(q.toUpperCase());
  if (idx < 0) return esc(text);
  return (
    esc(text.slice(0, idx)) +
    `<span class="vt-srm">${esc(text.slice(idx, idx + q.length))}</span>` +
    esc(text.slice(idx + q.length))
  );
}

function vtEnsureSym(sym, allowCustom) {
  const up = String(sym || "").trim().toUpperCase();
  if (!up) return null;
  const existing = SYMS.find((x) => x[0] === up);
  if (existing) return existing;
  const k = (isLive() ? "L" : "S") + up;
  if (CUS[k]) {
    if (isLive()) {
      const d = LIVE[up + "|1D"];
      if (d && d.length) CUS[k][2] = d[d.length - 1].c;
    }
    return CUS[k];
  }
  const cat = VT_CAT_MAP.get(up);
  if (cat) {
    CUS[k] = isLive()
      ? [cat[0], cat[2], null, 0, 1, 0.015, cat[4], cat[5], cat[6], cat[7], 1]
      : [cat[0], cat[2], 50 + (seed(up) % 350), 8e6, 1, 0.025];
    if (isLive()) {
      const d = LIVE[up + "|1D"];
      if (d && d.length) CUS[k][2] = d[d.length - 1].c;
    }
    return CUS[k];
  }
  if (allowCustom) {
    const m = guessM(up);
    CUS[k] = isLive()
      ? [up, m, null, 0, 1, 0.015, up, "", m === "CRY" ? "bn" : "yf", up, 1]
      : [up, m, 20 + (seed(up) % 380), 5e6, 1, 0.03];
    return CUS[k];
  }
  return null;
}

const VT_SR_STATE = { tab: "All", idx: 0, results: [] };
const VT_SY_STATE = { tab: "All", idx: 0, results: [] };

function vtRenderSearchBody(q, state, pickFn, tabFn) {
  state.results = vtSearchRank(q, state.tab, 18);
  if (state.idx >= state.results.length) state.idx = 0;
  if (state.idx < 0) state.idx = 0;

  const tabsHtml = `<div class="vt-sftabs" role="tablist" aria-label="Asset class filter">${VT_SR_TABS.map(
    (t) =>
      `<button type="button" role="tab" aria-selected="${state.tab === t}" class="vt-sftab${
        state.tab === t ? " on" : ""
      }" onmousedown="event.preventDefault();${tabFn}('${t}')">${t}</button>`
  ).join("")}</div>`;

  const rowsHtml = state.results.length
    ? state.results
        .map(
          (it, i) =>
            `<div class="vt-srrow${i === state.idx ? " on" : ""}" role="option" aria-selected="${
              i === state.idx
            }" data-sym="${esc(it.sym)}" onmousedown="event.preventDefault();${pickFn}('${esc(it.sym)}')">
              <span class="vt-srl">
                <span class="vt-srtk">${vtHighlightPrefix(it.sym, q)}</span>
                <span class="vt-srnm">${vtHighlightPrefix(it.name, q)}</span>
              </span>
              <span class="vt-srr">
                <span class="vt-srbadge" data-m="${esc(it.m)}">${esc(vtAssetLabel(it.m))}</span>
                <span class="vt-srex">${esc(it.ex)}</span>
              </span>
            </div>`
        )
        .join("")
    : `<div class="vt-srempty">No matching symbols in ${esc(state.tab)}. Press Enter to open “${esc(
        q.toUpperCase() || "…"
      )}”.</div>`;

  const footHtml = `<div class="vt-srfoot"><span>Up/Down Navigate &middot; Enter Select &middot; Esc Close</span><span>Vektor Terminal</span></div>`;

  return `${tabsHtml}<div class="vt-srlist" role="listbox">${rowsHtml}</div>${footHtml}`;
}

function vtSelectHeaderSym(sym) {
  vtEnsureSym(sym, true);
  openChart(sym);
  hideSr();
}

function vtSetHeaderTab(tab) {
  VT_SR_STATE.tab = tab;
  VT_SR_STATE.idx = 0;
  srch();
}

function srch() {
  const inp = document.getElementById("sq");
  const b = document.getElementById("sr");
  if (!inp || !b) return;
  const q = inp.value.trim().toUpperCase();
  if (!q && document.activeElement !== inp) {
    b.style.display = "none";
    return;
  }
  b.innerHTML = vtRenderSearchBody(q, VT_SR_STATE, "vtSelectHeaderSym", "vtSetHeaderTab");
  b.style.display = "block";
}

function srchKey(e) {
  const b = document.getElementById("sr");
  const open = b && b.style.display !== "none";
  if (e.key === "ArrowDown" && open && VT_SR_STATE.results.length) {
    e.preventDefault();
    VT_SR_STATE.idx = (VT_SR_STATE.idx + 1) % VT_SR_STATE.results.length;
    srch();
    const row = b.querySelector(".vt-srrow.on");
    if (row) row.scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.key === "ArrowUp" && open && VT_SR_STATE.results.length) {
    e.preventDefault();
    VT_SR_STATE.idx = (VT_SR_STATE.idx - 1 + VT_SR_STATE.results.length) % VT_SR_STATE.results.length;
    srch();
    const row = b.querySelector(".vt-srrow.on");
    if (row) row.scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.key === "Escape") {
    hideSrBox();
    e.target.blur();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    srchGo();
  }
}

function srchGo() {
  const inp = document.getElementById("sq");
  const q = inp ? inp.value.trim().toUpperCase() : "";
  const hit = VT_SR_STATE.results[VT_SR_STATE.idx] || VT_SR_STATE.results[0];
  if (hit) {
    vtSelectHeaderSym(hit.sym);
    return;
  }
  if (q) {
    vtEnsureSym(q, true);
    openChart(q);
    hideSr();
  }
}

function hideSrBox() {
  const b = document.getElementById("sr");
  if (b) b.style.display = "none";
}

function hideSr() {
  hideSrBox();
  const inp = document.getElementById("sq");
  if (inp) inp.value = "";
  VT_SR_STATE.idx = 0;
}

function syOpen() {
  SYBUF = "";
  VT_SY_STATE.idx = 0;
  syShow();
}

function vtSetSyTab(tab) {
  VT_SY_STATE.tab = tab;
  VT_SY_STATE.idx = 0;
  vtUpdateSyList();
}

function vtPickSy(sym) {
  syCancel();
  vtEnsureSym(sym, true);
  openChart(sym);
}

function vtUpdateSyList() {
  const resEl = document.getElementById("sy_res");
  if (!resEl) return;
  resEl.innerHTML = vtRenderSearchBody(SYBUF, VT_SY_STATE, "vtPickSy", "vtSetSyTab");
}

function syShow() {
  let h = document.getElementById("sypop");
  if (!h) {
    h = document.createElement("div");
    h.id = "sypop";
    h.className = "vt-sypop";
    h.setAttribute("role", "dialog");
    h.setAttribute("aria-label", "Symbol Search");
    document.body.appendChild(h);
  }
  h.innerHTML = `<div class="vt-syhd">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input id="sy_in" value="${esc(SYBUF)}" placeholder="Search symbol, name, exchange…" autocomplete="off" spellcheck="false" aria-label="Symbol search">
    <button type="button" class="vt-syclose" onclick="syCancel()">Esc</button>
  </div>
  <div id="sy_res"></div>`;
  h.style.display = "flex";
  vtUpdateSyList();

  const inp = document.getElementById("sy_in");
  if (inp) {
    inp.oninput = (e) => {
      SYBUF = e.target.value.toUpperCase();
      VT_SY_STATE.idx = 0;
      vtUpdateSyList();
    };
    inp.onkeydown = (e) => {
      if (e.key === "ArrowDown" && VT_SY_STATE.results.length) {
        e.preventDefault();
        e.stopPropagation();
        VT_SY_STATE.idx = (VT_SY_STATE.idx + 1) % VT_SY_STATE.results.length;
        vtUpdateSyList();
        const row = h.querySelector(".vt-srrow.on");
        if (row) row.scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp" && VT_SY_STATE.results.length) {
        e.preventDefault();
        e.stopPropagation();
        VT_SY_STATE.idx = (VT_SY_STATE.idx - 1 + VT_SY_STATE.results.length) % VT_SY_STATE.results.length;
        vtUpdateSyList();
        const row = h.querySelector(".vt-srrow.on");
        if (row) row.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        syConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        syCancel();
      }
    };
    setTimeout(() => {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }, 15);
  }
}

function syCancel() {
  SYBUF = "";
  VT_SY_STATE.idx = 0;
  const h = document.getElementById("sypop");
  if (h) h.style.display = "none";
}

function syConfirm() {
  const hit = VT_SY_STATE.results[VT_SY_STATE.idx] || VT_SY_STATE.results[0];
  const q = SYBUF.trim().toUpperCase();
  syCancel();
  if (hit) {
    vtEnsureSym(hit.sym, true);
    openChart(hit.sym);
    return;
  }
  if (!q) return;
  const m = SYMS.find((s) => s[0].toUpperCase() === q) || SYMS.find((s) => s[0].toUpperCase().startsWith(q));
  if (m) openChart(m[0]);
  else {
    vtEnsureSym(q, true);
    openChart(q);
  }
}

document.addEventListener("mousedown", (e) => {
  const h = document.getElementById("sypop");
  if (h && h.style.display !== "none" && !h.contains(e.target) && !e.target.closest(".vt-symbtn")) {
    syCancel();
  }
});
