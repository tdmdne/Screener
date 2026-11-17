// ---------- Edge Cache + KV Screener + Candles + Silent Prefetch + /ws Relay ----------
const VT_TF_ORDER = ["1m", "5m", "15m", "30m", "1H", "4H", "1D", "1W", "1M"];
const VT_PREFETCH_PEND = {};
const VT_EDGE = { ok: false, ts: 0, ws: null, wsRetry: 0, wsDown: false };
const VT_EDGE_META = new Map();

function vtCanUseEdge() {
  return (
    (location.protocol === "http:" || location.protocol === "https:") &&
    !Array.isArray(window.__WS)
  );
}

async function edgeScreenerInit() {
  if (!vtCanUseEdge() || !isLive()) return false;
  try {
    const r = await fetch("/api/screener");
    if (!r.ok) return false;
    const m = await r.json();
    if (!m || !Array.isArray(m.universe) || !m.universe.length) return false;

    SNAP.t = m.ts || Date.now();
    SNAP.tfs = m.tfs || ["1D", "1H"];
    SNAP.uni = m.universe.map((u) => {
      if (u[10] || u[11]) {
        VT_EDGE_META.set(u[0], {
          name: u[10] || u[0],
          ex: u[11] || "",
          m: u[1] || "STK",
          pct: u[12],
        });
      }
      return [u[0], u[1], u[2], u[3], u[4] || 1, u[5] || 0.01, u[6] || u[0], u[7] || "", u[8] || "yf", u[9] || u[0]];
    });
    SNAP.ok = true;
    VT_EDGE.ok = true;
    VT_EDGE.ts = SNAP.t;
    dirtySnap();
    setLive();
    return true;
  } catch (_e) {
    return false;
  }
}

function vtMergeBars(k, incoming) {
  if (!Array.isArray(incoming) || !incoming.length) return LIVE[k] || [];
  const map = new Map();
  const prev = Array.isArray(LIVE[k]) ? LIVE[k] : [];
  for (const b of prev) {
    if (b && b.t != null && b.c > 0) map.set(b.t, b);
  }
  for (const b of incoming) {
    if (b && b.t != null && b.c > 0) map.set(b.t, b);
  }
  const merged = [...map.values()].sort((a, b) => a.t - b.t);
  LIVE[k] = merged.length > 10000 ? merged.slice(-10000) : merged;
  LT[k] = Date.now();
  dirty(k);
  return LIVE[k];
}

async function edgeFetchCandles(s, tf, opts) {
  if (!vtCanUseEdge() || !s) return null;
  try {
    const o = opts || {};
    let u = `/api/candles?symbol=${encodeURIComponent(s[0])}&interval=${encodeURIComponent(tf)}&apiSym=${encodeURIComponent(s[6] || s[0])}&mkt=${encodeURIComponent(s[1] || "")}`;
    if (o.from != null && isFinite(+o.from)) u += `&from=${Math.floor(+o.from)}`;
    if (o.to != null && isFinite(+o.to)) u += `&to=${Math.floor(+o.to)}`;
    if (o.limit != null && isFinite(+o.limit)) u += `&limit=${Math.floor(+o.limit)}`;
    if (o.replay) u += `&replay=1`;
    const r = await fetch(u);
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !j.ok || !Array.isArray(j.bars) || !j.bars.length) return null;
    if (j.source && j.source !== "simulator") VT_CSRC[s[0]] = "real";
    else if (!VT_CSRC[s[0]]) VT_CSRC[s[0]] = "simulator";
    return j.bars;
  } catch (_e) {
    return null;
  }
}

const QE = [];
let bzEdge = 0;
async function pumpEdge() {
  if (bzEdge) return;
  bzEdge = 1;
  const w = async () => {
    while (QE.length) {
      const [s, tf, k] = QE.shift();
      try {
        const bars = await edgeFetchCandles(s, tf);
        if (bars && bars.length) {
          LIVE[k] = bars;
          LT[k] = Date.now();
          dirty(k);
          markOk("edge");
          delete PEND[k];
          fin(s, tf);
          continue;
        }
      } catch (_e) {}
      const p = s[8], q = p === "bn" ? QB : p === "yf" ? QY : QT;
      q.push([s, tf, k]);
      (p === "bn" ? pumpBN : p === "yf" ? pumpYF : pumpTD)();
    }
  };
  await Promise.all([w(), w(), w(), w(), w(), w()]);
  bzEdge = 0;
  if (QE.length) pumpEdge();
}

function vtPrefetchAdjacent(s, tf) {
  if (!s || !tf || !isLive() || !vtCanUseEdge()) return;
  const idx = VT_TF_ORDER.indexOf(tf);
  if (idx < 0) return;
  const adj = [VT_TF_ORDER[idx - 1], VT_TF_ORDER[idx + 1]].filter(Boolean);
  for (const atf of adj) {
    const k = s[0] + "|" + atf;
    if (LIVE[k] && Date.now() - (LT[k] || 0) < ttl(k)) continue;
    if (PEND[k] || VT_PREFETCH_PEND[k]) continue;
    VT_PREFETCH_PEND[k] = 1;
    setTimeout(async () => {
      try {
        const bars = await edgeFetchCandles(s, atf);
        if (bars && bars.length) {
          LIVE[k] = bars;
          LT[k] = Date.now();
          dirty(k);
        }
      } catch (_e) {
      } finally {
        delete VT_PREFETCH_PEND[k];
      }
    }, 120);
  }
}

function vtWsSubscribe(sym, tf) {
  if (!VT_EDGE.ws || VT_EDGE.ws.readyState !== 1) return;
  const subs = [sym, ...(typeof wlAll === "function" ? wlAll().slice(0, 15) : [])].filter(Boolean);
  try {
    VT_EDGE.ws.send(JSON.stringify({ type: "subscribe", symbols: [...new Set(subs)], interval: tf || "1H" }));
  } catch (_e) {}
}

// ---- Live tick guard: zero tolerance. A corrupted tick is dropped, never clamped, and never touches open/high/low/close ----
// VT_CSRC: where each symbol's candles came from ("real" provider or "simulator"). Simulated ticks/klines are only
// allowed to touch simulated candles, never a real chart (they random-walk from a static seed price, e.g. GBPUSD 1.271).
const VT_CSRC=Object.create(null);
const VT_TG={ref:Object.create(null),q:Object.create(null)};
// true during the New York 17:00 FX rollover (16:50-17:10 NY time, DST-safe) when spreads blow out
function vtTgRoll(ms){try{const p=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",hour:"numeric",minute:"numeric",hourCycle:"h23"}).formatToParts(ms),m=+p.find(x=>x.type==="hour").value*60+ +p.find(x=>x.type==="minute").value;return m>=1010&&m<=1030}catch(e){return false}}
// A tick is invalid if its symbol or price is missing, NaN, Infinity or <= 0, or if bid/ask are invalid or crossed (bid > ask).
function vtTickOk(t){
  if(!t||!t.s)return false;
  const c=+t.c;if(!(c>0)||!isFinite(c))return false;
  const hb=t.bid!=null&&t.bid!=="",ha=t.ask!=null&&t.ask!=="",b=+t.bid,a=+t.ask;
  if(hb&&!(b>0&&isFinite(b)))return false;
  if(ha&&!(a>0&&isFinite(a)))return false;
  if(hb&&ha&&b>a)return false;
  return true}
// Returns the prices to apply, in order: [c] for a normal tick, [] while a jump is unconfirmed (the tick is dropped),
// or the held ticks plus c once the new level is confirmed by consecutive ticks (a true repricing must not freeze the feed).
// Jumps above the hard limit (FX/indices/futures/CFDs 1.5%, crypto/stocks/ETFs 5%) need 8 confirming ticks within 2 minutes,
// smaller ones 3 (4 at the FX rollover) within 1 minute. An isolated print that price leaves again is never applied.
function vtTgFilter(sym,c,mk,ms,seed){
  const R=VT_TG.ref,Q=VT_TG.q;let ref=R[sym];if(!(ref>0))ref=seed>0?seed:0;
  if(!(ref>0)){R[sym]=c;return[c]}
  const roll=mk==="FX"&&vtTgRoll(ms),vol=mk==="CRY"||mk==="STK"||mk==="ETF";
  const lim=mk==="CRY"?0.02:mk==="FX"?(roll?0.0007:0.0015):0.01,hard=vol?0.05:0.015,jump=Math.abs(c/ref-1);
  if(jump<=lim){delete Q[sym];R[sym]=c;return[c]}
  const big=jump>hard,tol=Math.max(lim,jump*0.25);let q=Q[sym];
  if(q&&ms-q.t0<q.w&&Math.abs(c/q.a[0]-1)<=tol)q.a.push(c);else Q[sym]=q={t0:ms,a:[c],w:big?120000:60000,n:big?8:roll?4:3};
  if(q.a.length>=q.n){delete Q[sym];R[sym]=c;return q.a.slice()}
  return[]}
// Candle builder: a tick only updates the bar it falls in, or opens the next bar AT the previous close (no gap spike at
// session rollover). A stale tick never rewrites history. High/low come only from accepted ticks. Bars on the last bar's own grid.
function vtBarApply(sym,tf,c,ts){
  const a=LIVE[sym+"|"+tf],st=STEP[tf];if(!a||!a.length||!st)return false;
  const last=a[a.length-1];if(!(last.c>0)||ts<last.t)return false;
  if(ts<last.t+st){last.c=c;if(c>last.h)last.h=c;if(c<last.l)last.l=c;return true}
  if(st>86400)return false;
  const o=last.c;a.push({t:last.t+Math.floor((ts-last.t)/st)*st,o,h:Math.max(o,c),l:Math.min(o,c),c,v:0});
  if(a.length>500)a.splice(0,a.length-500);return true}

function vtProcessTick(t) {
  if (!vtTickOk(t)) return; // missing / NaN / <= 0 price, bad or crossed bid/ask: dropped
  const sym = t.s, c0 = +t.c;
  const row = SYMS.find((x) => x[0] === sym);
  const nowMs = Date.now(), ts = Math.floor(nowMs / 1000);
  const l1 = LIVE[sym + "|1m"];
  const seed = (l1 && l1.length ? l1[l1.length - 1].c : 0) || (row && row[2]) || 0;
  const accepted = vtTgFilter(sym, c0, row ? row[1] : "", nowMs, seed);
  if (!accepted.length) return; // unconfirmed jump: ignored entirely
  const tf = S && S.chart ? S.chart.tf : "1H";
  for (const c of accepted) {
    vtBarApply(sym, "1m", c, ts);
    if (S && S.chart && S.chart.sym === sym && tf !== "1m") vtBarApply(sym, tf, c, ts);
    if (row) row[2] = c;
    checkAlerts(sym, c);
  }
  const c = accepted[accepted.length - 1];

  // Update active chart series if strictly matching symbol
  if (S && S.chart && S.chart.sym === sym) {
    if (typeof ch !== "undefined" && ch && typeof updateLiveBar === "function") {
      updateLiveBar(sym, tf);
    }
    const cs = symOf(sym);
    const q = document.getElementById("cpx");
    if (q && cs && cs[2] != null) q.textContent = fp(cs[2]);
  }

  // Update secondary pane if active and strictly matching symbol
  if (typeof SC !== "undefined" && SC && SC.keyB && SC.keyB.startsWith(sym + "|") && SC.serB) {
    const tfB = S.sc && S.sc.tfB ? S.sc.tfB : "1D";
    vtBarApply(sym, tfB, c, ts);
    const lb = LIVE[sym + "|" + tfB] && LIVE[sym + "|" + tfB][LIVE[sym + "|" + tfB].length - 1];
    if (lb) {
      try {
        SC.serB.update({ time: lb.t, open: lb.o, high: lb.h, low: lb.l, close: lb.c });
      } catch (_e) {}
    }
  }
}

async function vtPollQuotes() {
  if (VT_EDGE.ws && VT_EDGE.ws.readyState === 1) return;
  if (!isLive() || !vtCanUseEdge()) return;
  const activeSyms = new Set();
  if (S && S.chart && S.chart.sym) activeSyms.add(S.chart.sym);
  if (typeof SC !== "undefined" && SC && SC.keyB) activeSyms.add(SC.keyB.split("|")[0]);
  if (typeof wlAll === "function") {
    wlAll().slice(0, 10).forEach((s) => activeSyms.add(s));
  }
  if (!activeSyms.size) return;
  try {
    const list = [...activeSyms].join(",");
    const r = await fetch(`/api/quote?symbols=${encodeURIComponent(list)}`);
    if (!r.ok) return;
    const j = await r.json();
    if (!j || !j.ok || !j.quotes) return;
    for (const [sym, q] of Object.entries(j.quotes)) {
      if (!q || !(q.c > 0) || q.src === "static") continue; // static = symbol-table reference price, not a live quote
      vtProcessTick({ s: sym, c: q.c, h: q.h, l: q.l, t: q.t });
    }
  } catch (_e) {}
}

if (!window.__vtQuotePollIv) {
  window.__vtQuotePollIv = setInterval(vtPollQuotes, 2000);
}

function vtWsConnect() {
  if (!vtCanUseEdge()) {
    bnwsConnect();
    return;
  }
  if (VT_EDGE.ws && (VT_EDGE.ws.readyState === 0 || VT_EDGE.ws.readyState === 1)) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  try {
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    VT_EDGE.ws = ws;
    ws.onopen = () => {
      VT_EDGE.wsRetry = 0;
      VT_EDGE.wsDown = false;
      markOk("ws");
      if (S && S.chart && S.chart.sym) {
        vtWsSubscribe(S.chart.sym, S.chart.tf);
      }
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        markOk("ws");
        if (msg.type === "ticks" && Array.isArray(msg.ticks)) {
          for (const t of msg.ticks) {
            if (msg.source === "simulator" && t && VT_CSRC[t.s] !== "simulator") continue;
            vtProcessTick(t);
          }
        } else if (msg.type === "kline" && msg.symbol && msg.interval && msg.bar) {
          const key = msg.symbol + "|" + msg.interval;
          const bar = msg.bar;
          if (!LIVE[key]) LIVE[key] = [];
          const arr = LIVE[key];
          const last = arr[arr.length - 1];
          if ((msg.source || "simulator") === "simulator" && VT_CSRC[msg.symbol] !== "simulator") return;
          if (![bar.o, bar.h, bar.l, bar.c].every((x) => x > 0 && isFinite(x)) || bar.h < bar.l) return;

          const clampedT = last ? Math.max(bar.t, last.t) : bar.t;
          if (last && last.t === clampedT) {
            last.c = bar.c;
            last.h = Math.max(last.h, bar.h);
            last.l = Math.min(last.l, bar.l);
            last.v = Math.max(last.v || 0, bar.v || 0);
          } else if (!last || clampedT > last.t) {
            bar.t = clampedT;
            arr.push(bar);
          }
          if (arr.length > 500) arr.splice(0, arr.length - 500);
          const row = SYMS.find((x) => x[0] === msg.symbol);
          if (row) row[2] = bar.c;
          checkAlerts(msg.symbol, bar.c);
          if (S && S.chart && S.chart.sym === msg.symbol && S.chart.tf === msg.interval) {
            updateLiveBar(msg.symbol, msg.interval);
            const q = document.getElementById("cpx");
            if (q) q.textContent = fp(bar.c);
          }
        }
      } catch (_err) {}
    };
    ws.onclose = () => {
      VT_EDGE.ws = null;
      if (++VT_EDGE.wsRetry >= 3 && !BNWS.ws) {
        VT_EDGE.wsDown = true;
        bnwsConnect();
        return;
      }
      setTimeout(vtWsConnect, Math.min(10000, 1500 * VT_EDGE.wsRetry));
    };
    ws.onerror = () => {
      try { ws.close(); } catch (_e) {}
    };
  } catch (_e) {
    bnwsConnect();
  }
}

