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

function vtIsSpike(c, last) {
  if (!last || !(last.c > 0)) return false;
  const ratio = Math.abs(c / last.c - 1);
  if (ratio > 0.08) return true; // >8% single-tick jump
  if (last.h && last.l && last.h > last.l) {
    const barRange = last.h - last.l;
    if (barRange > 0 && Math.abs(c - last.c) > 12 * barRange) return true;
  }
  return false;
}

function vtProcessTick(t) {
  if (!t || !t.s) return;
  const sym = t.s;
  const c = +t.c;
  if (!(c > 0) || !isFinite(c)) return;

  const row = SYMS.find((x) => x[0] === sym);
  if (row) row[2] = c;
  checkAlerts(sym, c);

  const nowSec = Math.floor(Date.now() / 1000);
  const tf = S && S.chart ? S.chart.tf : "1H";
  const st = (typeof STEP !== "undefined" && STEP[tf]) || 3600;
  const kChart = sym + "|" + tf;
  const k1 = sym + "|1m";

  // Check spike against 1m or chart bar
  const refBar = (LIVE[k1] && LIVE[k1][LIVE[k1].length - 1]) || (LIVE[kChart] && LIVE[kChart][LIVE[kChart].length - 1]);
  if (vtIsSpike(c, refBar)) return;

  // Update 1m candle with clamped timestamp
  if (LIVE[k1] && LIVE[k1].length) {
    const last1m = LIVE[k1][LIVE[k1].length - 1];
    const clampedT = Math.max(t.t || nowSec, last1m.t);
    last1m.t = clampedT;
    last1m.c = c;
    if (t.h) last1m.h = Math.max(last1m.h, +t.h, c);
    else last1m.h = Math.max(last1m.h, c);
    if (t.l) last1m.l = Math.min(last1m.l, +t.l, c);
    else last1m.l = Math.min(last1m.l, c);
  }

  // Update active chart series if strictly matching symbol
  if (S && S.chart && S.chart.sym === sym) {
    if (LIVE[kChart] && LIVE[kChart].length) {
      const lastBar = LIVE[kChart][LIVE[kChart].length - 1];
      const bkt = Math.floor(nowSec / st) * st;
      const clampedT = Math.max(t.t || bkt, lastBar.t);
      if (lastBar.t === clampedT || (clampedT - lastBar.t < st && lastBar.t === bkt)) {
        lastBar.c = c;
        lastBar.h = Math.max(lastBar.h, c);
        lastBar.l = Math.min(lastBar.l, c);
      } else if (clampedT > lastBar.t && clampedT >= bkt) {
        LIVE[kChart].push({ t: clampedT, o: c, h: c, l: c, c, v: 1 });
      }
    }
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
    const kB = sym + "|" + tfB;
    if (LIVE[kB] && LIVE[kB].length) {
      const lb = LIVE[kB][LIVE[kB].length - 1];
      lb.c = c;
      lb.h = Math.max(lb.h, c);
      lb.l = Math.min(lb.l, c);
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
      if (!q || !(q.c > 0)) continue;
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
            vtProcessTick(t);
          }
        } else if (msg.type === "kline" && msg.symbol && msg.interval && msg.bar) {
          const key = msg.symbol + "|" + msg.interval;
          const bar = msg.bar;
          if (!LIVE[key]) LIVE[key] = [];
          const arr = LIVE[key];
          const last = arr[arr.length - 1];
          if (vtIsSpike(bar.c, last)) return;

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

