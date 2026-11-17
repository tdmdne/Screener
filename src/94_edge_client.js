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
          let chartHit = false;
          for (const t of msg.ticks) {
            const sym = t.s;
            const c = +t.c;
            if (!(c > 0)) continue;
            const k1 = sym + "|1m";
            if (LIVE[k1] && LIVE[k1].length) {
              const last = LIVE[k1][LIVE[k1].length - 1];
              last.c = c;
              if (t.h) last.h = Math.max(last.h, +t.h);
              if (t.l) last.l = Math.min(last.l, +t.l);
            }
            const row = SYMS.find((x) => x[0] === sym);
            if (row) row[2] = c;
            checkAlerts(sym, c);
            if (S.chart.sym === sym) chartHit = true;
          }
          if (ch && chartHit) {
            updateLiveBar(S.chart.sym, S.chart.tf);
            const cs = symOf(S.chart.sym);
            const q = document.getElementById("cpx");
            if (q && cs && cs[2] != null) q.textContent = fp(cs[2]);
          }
        } else if (msg.type === "kline" && msg.symbol && msg.interval && msg.bar) {
          const key = msg.symbol + "|" + msg.interval;
          const bar = msg.bar;
          if (!LIVE[key]) LIVE[key] = [];
          const arr = LIVE[key];
          const last = arr[arr.length - 1];
          if (last && last.t === bar.t) {
            last.c = bar.c;
            last.h = Math.max(last.h, bar.h);
            last.l = Math.min(last.l, bar.l);
            last.v = Math.max(last.v || 0, bar.v || 0);
          } else if (!last || bar.t > last.t) {
            arr.push(bar);
          }
          if (arr.length > 500) arr.splice(0, arr.length - 500);
          const row = SYMS.find((x) => x[0] === msg.symbol);
          if (row) row[2] = bar.c;
          checkAlerts(msg.symbol, bar.c);
          if (S.chart.sym === msg.symbol && S.chart.tf === msg.interval) {
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
