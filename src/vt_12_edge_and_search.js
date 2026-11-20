// ---------- 94 edge client: Edge Cache + KV Screener + Single-Source Binance/TwelveData WebSockets ----------
const VT_TF_ORDER = ["1m", "5m", "15m", "30m", "1H", "4H", "1D", "1W", "1M"];
const VT_BNI = { "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1H": "1h", "4H": "4h", "1D": "1d", "1W": "1w", "1M": "1M" };
const VT_PREFETCH_PEND = {};
const VT_CANDLE_IN_FLIGHT = new Map();
const VT_CANDLE_EDGE_CACHE = new Map();
const VT_BACKFILL_COOLDOWN_MS = 15000;
const VT_MAX_BARS = 25000;
const VT_EDGE = {
  ok: false,
  ts: 0,
  bnWs: null,
  bnSym: "",
  bnTf: "",
  bnRetry: 0,
  bnTimer: 0,
  tdWs: null,
  tdKey: "",
  tdKeyFetched: false,
  tdActiveSym: "",
  tdActiveTdSym: "",
  tdSubTdSym: "",
  tdRetry: 0,
  tdTimer: 0,
  tdHb: 0,
  pausedCharts: new Set(),
  backfillInFlight: new Map(),
  backfillAt: new Map(),
  hasMoreHistory: new Map(),
  historyBackfillInFlight: new Map(),
  hiddenAt: 0,
  gapDocDelegated: false,
};
const VT_EDGE_META = new Map();

function vtCanUseEdge() {
  return (
    (location.protocol === "http:" || location.protocol === "https:") &&
    !Array.isArray(window.__WS)
  );
}

const VT_FUTURES_TO_TD = {
  "NQ=F": "QQQ",
  "ES=F": "SPY",
  "YM=F": "DIA",
  "RTY=F": "IWM",
  "GC=F": "XAU/USD",
  "SI=F": "XAG/USD",
  "CL=F": "WTI/USD",
  "NG=F": "NATGAS/USD",
  "6E=F": "EUR/USD",
  "6B=F": "GBP/USD",
  "6J=F": "USD/JPY",
  "6A=F": "AUD/USD",
  "6C=F": "USD/CAD",
  "6S=F": "USD/CHF",
  "ZN=F": "TLT",
  "ZB=F": "TLT",
  "ZF=F": "IEF",
  "ZT=F": "SHY",
  "BZ=F": "BRENT/USD",
  "HG=F": "COPPER/USD",
  "PL=F": "XPT/USD",
  "PA=F": "XPD/USD",
};

function vtIsCryptoSym(sOrSym) {
  const s = Array.isArray(sOrSym) ? sOrSym : (typeof symOf === "function" ? symOf(sOrSym) : null);
  const sym = String(Array.isArray(sOrSym) ? sOrSym[0] : sOrSym || "").trim().toUpperCase();
  if (s && (s[8] === "bn" || s[1] === "CRY")) return true;
  return sym.endsWith("USDT") || sym.endsWith("BUSD") || sym.endsWith("BTC");
}

function vtToBnSym(sym) {
  let u = String(sym || "").trim().toUpperCase();
  if (!u.endsWith("USDT") && !u.endsWith("BUSD") && !u.endsWith("BTC")) {
    u = u.endsWith("USD") ? u + "T" : u + "USDT";
  }
  return u;
}

function vtToTdSym(sOrSym) {
  const s = Array.isArray(sOrSym) ? sOrSym : (typeof symOf === "function" ? symOf(sOrSym) : null);
  const sym = String(s ? s[0] : sOrSym || "").trim().toUpperCase();
  if (VT_FUTURES_TO_TD[sym]) return VT_FUTURES_TO_TD[sym];
  if (s && s[9] && !String(s[9]).includes("=X")) {
    const tdCandidate = String(s[9]).trim().toUpperCase();
    if (VT_FUTURES_TO_TD[tdCandidate]) return VT_FUTURES_TO_TD[tdCandidate];
    if (tdCandidate.endsWith("=F")) return "";
    return String(s[9]).trim();
  }
  if (sym.endsWith("=F")) return "";
  if (/^[A-Z]{6}$/.test(sym)) return sym.slice(0, 3) + "/" + sym.slice(3);
  return sym;
}

function vtNextBackoff(retry) {
  return Math.min(30000, 1000 * Math.pow(2, Math.max(0, retry)));
}

function vtHasMoreHistory(sym, tf) {
  if (!sym || !tf) return false;
  return VT_EDGE.hasMoreHistory.get(sym + "|" + tf) !== false;
}

function vtHasActiveChartMount(sym, tf) {
  if (typeof document === "undefined") return true;
  try {
    const hasMain =
      typeof S !== "undefined" &&
      S &&
      S.chart &&
      S.chart.sym === sym &&
      S.chart.tf === tf &&
      typeof ch !== "undefined" &&
      !!ch &&
      typeof MS !== "undefined" &&
      !!MS &&
      !!document.getElementById("cv");
    const hasPaneB =
      typeof SC !== "undefined" &&
      SC &&
      SC.chB &&
      SC.serB &&
      SC.keyB === sym + "|" + tf &&
      !!document.getElementById("cvB");
    return !!(hasMain || hasPaneB);
  } catch (_e) {
    return false;
  }
}

function vtIsChartPaused(sym, tf) {
  if (!sym || !tf) return false;
  const k = sym + "|" + tf;
  if (VT_EDGE.pausedCharts.has(k)) return true;
  if (typeof ERR !== "undefined" && ERR[k]) return true;
  if (typeof document !== "undefined") {
    const dst = document.getElementById("dst");
    const txt = dst ? String(dst.textContent || "") : "";
    if (txt && /feed unavailable/i.test(txt)) {
      const escSym = String(sym).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (
        new RegExp("\\b" + escSym + "\\s*:\\s*feed unavailable", "i").test(txt) ||
        !/[A-Z0-9._-]+:\s*feed unavailable/i.test(txt)
      ) {
        return true;
      }
    }
  }
  return false;
}

function vtHandleGapRetry(sym, tf, badgeEl) {
  try {
    if (!sym && typeof S !== "undefined" && S && S.chart) sym = S.chart.sym;
    if (!tf && typeof S !== "undefined" && S && S.chart) tf = S.chart.tf;
    if (typeof document !== "undefined") {
      const targets = [];
      if (badgeEl) targets.push(badgeEl);
      else {
        const bMain = document.getElementById("vt_gap_badge");
        if (bMain) targets.push(bMain);
      }
      for (const b of targets) {
        if (!b) continue;
        b.style.display = "none";
        if (b.parentElement) b.parentElement.removeChild(b);
      }
    }
    if (sym && tf) {
      const k = sym + "|" + tf;
      VT_EDGE.pausedCharts.delete(k);
      if (typeof ERR !== "undefined" && ERR[k]) delete ERR[k];
      if (typeof status === "function") {
        try { status(); } catch (_e) {}
      }
      return vtBackfillChart(sym, tf, { refresh: true });
    }
  } catch (_e) {}
  return null;
}

function vtOnGapDelegatedClick(e) {
  try {
    if (!e || e.__vtGapHandled) return;
    let target = e.target;
    if (target && target.nodeType === 3) target = target.parentElement;
    if (!target) return;
    let btn = null;
    if (typeof target.closest === "function") {
      btn = target.closest("[data-vt-gap-retry], .vt-gap-retry, #vt_gap_badge button, #vt_gap_badge_b button");
    } else if (
      target.tagName === "BUTTON" &&
      (target.className === "vt-gap-retry" || (target.attributes && target.attributes["data-vt-gap-retry"]))
    ) {
      btn = target;
    }
    if (!btn) return;
    e.__vtGapHandled = true;
    if (typeof e.preventDefault === "function") e.preventDefault();
    if (typeof e.stopPropagation === "function") e.stopPropagation();
    const badge =
      typeof btn.closest === "function"
        ? btn.closest(".vt-gap-badge, #vt_gap_badge, #vt_gap_badge_b")
        : btn.parentElement || null;
    const sym =
      (btn.dataset && btn.dataset.sym) ||
      (typeof btn.getAttribute === "function" && btn.getAttribute("data-sym")) ||
      (badge && badge.dataset && badge.dataset.sym) ||
      (badge && typeof badge.getAttribute === "function" && badge.getAttribute("data-sym")) ||
      (typeof S !== "undefined" && S && S.chart ? S.chart.sym : "");
    const tf =
      (btn.dataset && btn.dataset.tf) ||
      (typeof btn.getAttribute === "function" && btn.getAttribute("data-tf")) ||
      (badge && badge.dataset && badge.dataset.tf) ||
      (badge && typeof badge.getAttribute === "function" && badge.getAttribute("data-tf")) ||
      (badge && badge.id === "vt_gap_badge_b" && typeof S !== "undefined" && S && S.sc ? S.sc.tfB : "") ||
      (typeof S !== "undefined" && S && S.chart ? S.chart.tf : "");
    vtHandleGapRetry(sym, tf, badge);
  } catch (_e) {}
}

function vtBindGapContainerDelegation(container) {
  if (typeof document !== "undefined" && !VT_EDGE.gapDocDelegated && typeof document.addEventListener === "function") {
    VT_EDGE.gapDocDelegated = true;
    document.addEventListener("click", vtOnGapDelegatedClick);
  }
  if (!container || container.__vtGapDelegated || typeof container.addEventListener !== "function") return;
  container.__vtGapDelegated = true;
  container.addEventListener("click", vtOnGapDelegatedClick);
}

function vtSyncGapBadgeAttrs(el, btn, sym, tf) {
  if (el) {
    if (el.dataset) {
      el.dataset.sym = sym || "";
      el.dataset.tf = tf || "";
    }
    if (typeof el.setAttribute === "function") {
      el.setAttribute("data-sym", sym || "");
      el.setAttribute("data-tf", tf || "");
    }
  }
  if (btn) {
    if (btn.dataset) {
      btn.dataset.vtGapRetry = "1";
      btn.dataset.sym = sym || "";
      btn.dataset.tf = tf || "";
    }
    if (typeof btn.setAttribute === "function") {
      btn.setAttribute("data-vt-gap-retry", "1");
      btn.setAttribute("data-sym", sym || "");
      btn.setAttribute("data-tf", tf || "");
    }
  }
}

function vtMakeGapBadgeEl(sym, tf, id) {
  const el = document.createElement("div");
  el.id = id;
  el.className = "vt-gap-badge";
  el.setAttribute("role", "status");
  el.style.cssText =
    "position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:15;pointer-events:auto;display:flex;align-items:center;gap:8px;padding:5px 10px;border-radius:6px;background:rgba(24,20,14,0.92);border:1px solid rgba(245,158,11,0.45);color:#fbbf24;font-size:11.5px;font-weight:500;white-space:nowrap;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);box-shadow:0 4px 12px rgba(0,0,0,0.35)";
  const msg = document.createElement("span");
  msg.textContent = "Historical gap — waiting for fresh feed";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vt-gap-retry";
  btn.textContent = "Retry";
  btn.style.cssText =
    "background:rgba(245,158,11,0.16);color:#fde68a;border:1px solid rgba(245,158,11,0.45);border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;cursor:pointer;pointer-events:auto";
  vtSyncGapBadgeAttrs(el, btn, sym, tf);
  btn.onclick = (e) => {
    if (e) {
      if (e.__vtGapHandled) return;
      e.__vtGapHandled = true;
      if (typeof e.preventDefault === "function") e.preventDefault();
      if (typeof e.stopPropagation === "function") e.stopPropagation();
    }
    const curSym =
      (btn.dataset && btn.dataset.sym) ||
      (el.dataset && el.dataset.sym) ||
      sym;
    const curTf =
      (btn.dataset && btn.dataset.tf) ||
      (el.dataset && el.dataset.tf) ||
      tf;
    vtHandleGapRetry(curSym, curTf, el);
  };
  el.append(msg, btn);
  return el;
}

function vtRenderGapBadge() {
  if (typeof document === "undefined") return;
  const curBadge = document.getElementById("vt_gap_badge");
  if (curBadge && curBadge.parentElement) curBadge.parentElement.removeChild(curBadge);
  const curBadgeB = document.getElementById("vt_gap_badge_b");
  if (curBadgeB && curBadgeB.parentElement) curBadgeB.parentElement.removeChild(curBadgeB);
}

function vtSetChartGap(sym, tf, on) {
  if (!sym || !tf) return;
  const k = sym + "|" + tf;
  if (on) VT_EDGE.pausedCharts.add(k);
  else VT_EDGE.pausedCharts.delete(k);
  vtRenderGapBadge();
}

function vtMarkFeedUnavailable(sym, tf) {
  if (!sym || !tf) return;
  const k = sym + "|" + tf;
  VT_EDGE.pausedCharts.add(k);
  if (typeof ERR !== "undefined") ERR[k] = sym + ": feed unavailable";
  if (typeof status === "function") {
    try { status(); } catch (_e) {}
  }
  vtRenderGapBadge();
}

function vtClearFeedGap(sym, tf) {
  if (!sym || !tf) return;
  const k = sym + "|" + tf;
  VT_EDGE.pausedCharts.delete(k);
  if (typeof ERR !== "undefined" && ERR[k]) delete ERR[k];
  if (typeof status === "function") {
    try { status(); } catch (_e) {}
  }
  vtRenderGapBadge();
}

async function vtResolveTdKey() {
  // TASK-02: the browser never holds a Twelve Data key any more; the vektor-market Worker adds it server-side.
  return "";
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
    SNAP.uni = m.universe
      .map((u) => {
        if (!Array.isArray(u) || !u[0]) return null;
        if (u[10] || u[11]) {
          VT_EDGE_META.set(u[0], {
            name: u[10] || u[0],
            ex: u[11] || "",
            m: u[1] || "STK",
            pct: u[12],
          });
        }
        return [u[0], u[1], u[2], u[3], u[4] || 1, u[5] || 0.01, u[6] || u[0], u[7] || "", u[8] || "yf", u[9] || u[0]];
      })
      .filter(Boolean);
    SNAP.ok = true;
    VT_EDGE.ok = true;
    VT_EDGE.ts = SNAP.t;
    if (typeof dirtySnap === "function") try { dirtySnap(); } catch (_e) {}
    if (typeof setLive === "function") try { setLive(); } catch (_e) {}
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
  LIVE[k] = merged.length > VT_MAX_BARS ? merged.slice(-VT_MAX_BARS) : merged;
  LT[k] = Date.now();
  dirty(k);
  return LIVE[k];
}

async function edgeFetchCandles(s, tf, opts) {
  if (!vtCanUseEdge() || !s) return null;
  const o = opts || {};
  const fromSec = o.from != null && isFinite(+o.from) ? Math.floor(+o.from) : 0;
  const toSec = o.to != null && isFinite(+o.to) ? Math.floor(+o.to) : 0;
  const rawBefore = o.before != null && isFinite(+o.before) ? +o.before : 0;
  const beforeSec = rawBefore > 0 ? Math.floor(rawBefore > 1e11 ? rawBefore / 1000 : rawBefore) : 0;
  const replay = o.replay ? 1 : 0;
  const refresh = o.refresh ? 1 : 0;
  const defaultLim = replay ? (fromSec || toSec ? 1500 : 1000) : (vtIsCryptoSym(s) ? 1000 : 5000);
  const limit = o.limit != null && isFinite(+o.limit) && +o.limit > 0 ? Math.floor(+o.limit) : defaultLim;
  const flightKey = `${s[0]}|${tf}|${fromSec}|${toSec}|${beforeSec}|${limit}|${replay}|${refresh}`;
  const memTtlMs = beforeSec > 0 ? 86400000 : 60000;

  if (!replay && !refresh) {
    const cached = VT_CANDLE_EDGE_CACHE.get(flightKey);
    if (cached && Date.now() - cached.ts < memTtlMs) {
      return cached.bars;
    }
  }
  if (VT_CANDLE_IN_FLIGHT.has(flightKey)) {
    return VT_CANDLE_IN_FLIGHT.get(flightKey);
  }

  const job = (async () => {
    try {
      const tdMapped = !vtIsCryptoSym(s) ? vtToTdSym(s) : "";
      const apiSym = vtIsCryptoSym(s) ? (s[6] || s[0]) : (tdMapped || s[6] || s[0]);
      let u = `/api/candles?symbol=${encodeURIComponent(s[0])}&interval=${encodeURIComponent(tf)}&apiSym=${encodeURIComponent(apiSym)}&mkt=${encodeURIComponent(s[1] || "")}`;
      if (fromSec > 0) u += `&from=${fromSec}`;
      if (toSec > 0) u += `&to=${toSec}`;
      if (beforeSec > 0) u += `&before=${beforeSec}`;
      if (limit > 0) u += `&limit=${limit}`;
      if (replay) u += `&replay=1`;
      if (refresh) u += `&refresh=1`;
      let j = null;
      try {
        const r = await fetch(u);
        if (r.ok) j = await r.json();
      } catch (_e) {}
      if (!j || !j.ok || !Array.isArray(j.bars)) {
        if (!replay && !beforeSec && s[0]) vtMarkFeedUnavailable(s[0], tf);
        return null;
      }
      if (beforeSec > 0 && (j.bars.length === 0 || j.hasMore === false)) {
        if (s[0] && j.bars.length === 0) {
          VT_EDGE.hasMoreHistory.set(s[0] + "|" + tf, false);
        }
        if (j.bars.length === 0) {
          if (!replay) {
            if (VT_CANDLE_EDGE_CACHE.size > 160) VT_CANDLE_EDGE_CACHE.clear();
            VT_CANDLE_EDGE_CACHE.set(flightKey, { ts: Date.now(), bars: [] });
          }
          return [];
        }
      }
      if (!j.bars.length) {
        if (!replay && !beforeSec && s[0]) vtMarkFeedUnavailable(s[0], tf);
        return null;
      }
      if (!replay) {
        if (VT_CANDLE_EDGE_CACHE.size > 160) VT_CANDLE_EDGE_CACHE.clear();
        VT_CANDLE_EDGE_CACHE.set(flightKey, { ts: Date.now(), bars: j.bars });
      }
      if (!replay && !beforeSec && s[0]) {
        VT_EDGE.pausedCharts.delete(s[0] + "|" + tf);
        if (typeof ERR !== "undefined" && ERR[s[0] + "|" + tf]) delete ERR[s[0] + "|" + tf];
      }
      return j.bars;
    } catch (_e) {
      if (!replay && !beforeSec && s[0]) vtMarkFeedUnavailable(s[0], tf);
      return null;
    } finally {
      VT_CANDLE_IN_FLIGHT.delete(flightKey);
    }
  })();

  VT_CANDLE_IN_FLIGHT.set(flightKey, job);
  return job;
}

async function vtLoadMoreHistory(sym, tf) {
  if (!vtCanUseEdge() || !isLive() || !sym || !tf) return null;
  const k = sym + "|" + tf;
  if (VT_EDGE.hasMoreHistory.get(k) === false) return null;
  if (VT_EDGE.historyBackfillInFlight.has(k)) {
    return VT_EDGE.historyBackfillInFlight.get(k);
  }
  const cur = Array.isArray(LIVE[k]) ? LIVE[k] : [];
  if (!cur.length || !(cur[0].t > 0)) return null;
  const oldestT = cur[0].t;

  let s = typeof symOf === "function" ? symOf(sym) : null;
  if (!s) {
    const isCry = vtIsCryptoSym(sym);
    s = [sym, isCry ? "CRY" : "FX", 0, 0, 1, 0.01, sym, "", isCry ? "bn" : "yf", sym];
  }
  const lim = vtIsCryptoSym(s) ? 1000 : 5000;

  const job = (async () => {
    try {
      const rawOlder = await edgeFetchCandles(s, tf, { before: oldestT, limit: lim });
      if (rawOlder === null) return null;

      const byT = new Map();
      for (const b of rawOlder) {
        if (b && b.t != null && b.t < oldestT && b.c > 0) {
          byT.set(b.t, b);
        }
      }
      const older = [...byT.values()].sort((a, b) => a.t - b.t);
      if (!older.length) {
        VT_EDGE.hasMoreHistory.set(k, false);
        return [];
      }

      const latest = Array.isArray(LIVE[k]) ? LIVE[k] : [];
      const cutT = latest.length && latest[0].t > 0 ? latest[0].t : oldestT;
      const prepended = older.filter((b) => b.t < cutT);
      if (!prepended.length) {
        VT_EDGE.hasMoreHistory.set(k, false);
        return [];
      }

      const combined = prepended.concat(latest);
      LIVE[k] = combined.length > VT_MAX_BARS ? combined.slice(-VT_MAX_BARS) : combined;
      if (typeof dirty === "function") dirty(k);

      if (typeof vtApplyHistoryPrepend === "function") {
        vtApplyHistoryPrepend(sym, tf, prepended.length);
      }
      return prepended;
    } catch (_e) {
      return null;
    } finally {
      VT_EDGE.historyBackfillInFlight.delete(k);
    }
  })();

  VT_EDGE.historyBackfillInFlight.set(k, job);
  return job;
}

function vtCheckHistoryScroll(sym, tf, range) {
  try {
    if (!vtCanUseEdge() || !isLive() || !sym || !tf || !range || !isFinite(range.from)) return;
    if (!vtHasActiveChartMount(sym, tf)) return;
    if (range.from > 50) return;
    const k = sym + "|" + tf;
    if (VT_EDGE.hasMoreHistory.get(k) === false) return;
    if (VT_EDGE.historyBackfillInFlight.has(k)) return;
    const cur = typeof LIVE !== "undefined" && Array.isArray(LIVE[k]) ? LIVE[k] : null;
    if (!cur || !cur.length || !(cur[0].t > 0)) return;
    vtLoadMoreHistory(sym, tf);
  } catch (_e) {}
}

async function vtBackfillChart(sym, tf, opts) {
  if (!vtCanUseEdge() || !isLive() || !sym || !tf) return null;
  const k = sym + "|" + tf;
  if (VT_EDGE.backfillInFlight.has(k)) {
    return VT_EDGE.backfillInFlight.get(k);
  }
  const o = opts || {};
  const now = Date.now();
  const lastTry = VT_EDGE.backfillAt.get(k) || 0;
  if (!o.force && !o.refresh && now - lastTry < VT_BACKFILL_COOLDOWN_MS) {
    return null;
  }
  VT_EDGE.backfillAt.set(k, now);

  let s = typeof symOf === "function" ? symOf(sym) : null;
  if (!s) {
    const isCry = vtIsCryptoSym(sym);
    s = [sym, isCry ? "CRY" : "FX", 0, 0, 1, 0.01, sym, "", isCry ? "bn" : "yf", sym];
  }

  const job = (async () => {
    try {
      const bars = await edgeFetchCandles(s, tf, { refresh: true });
      if (bars && bars.length) {
        if (Array.isArray(LIVE[k]) && LIVE[k].length) {
          const headCut = bars[0].t;
          const older = LIVE[k].filter((b) => b && b.t < headCut && b.c > 0);
          const combined = older.concat(bars);
          LIVE[k] = combined.length > VT_MAX_BARS ? combined.slice(-VT_MAX_BARS) : combined;
        } else {
          LIVE[k] = bars;
        }
        LT[k] = Date.now();
        dirty(k);
        if (typeof markOk === "function") markOk("edge");
        vtClearFeedGap(sym, tf);

        const lastBar = LIVE[k][LIVE[k].length - 1];
        if (typeof vtLastPlotT !== "undefined" && lastBar) vtLastPlotT[k] = lastBar.t;
        if (typeof SYMS !== "undefined" && lastBar) {
          const row = SYMS.find((x) => x[0] === sym);
          if (row) row[2] = lastBar.c;
        }
        if (typeof checkAlerts === "function" && lastBar) checkAlerts(sym, lastBar.c);

        if (typeof S !== "undefined" && S && S.chart && S.chart.sym === sym && S.chart.tf === tf) {
          if (typeof drawChart === "function") drawChart();
        }
        if (
          typeof SC !== "undefined" &&
          SC &&
          typeof S !== "undefined" &&
          S &&
          S.pageView === "chart" &&
          S.sc &&
          S.sc.panes === 2 &&
          S.chart &&
          S.chart.sym === sym &&
          S.sc.tfB === tf &&
          typeof scPaneB === "function"
        ) {
          scPaneB();
        }
        return LIVE[k];
      }
      vtMarkFeedUnavailable(sym, tf);
      return null;
    } catch (_e) {
      vtMarkFeedUnavailable(sym, tf);
      return null;
    } finally {
      VT_EDGE.backfillInFlight.delete(k);
    }
  })();

  VT_EDGE.backfillInFlight.set(k, job);
  return job;
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
          const lastC = bars[bars.length - 1] && bars[bars.length - 1].c;
          if (lastC > 0) {
            if (Array.isArray(s)) s[2] = lastC;
            if (typeof SYMS !== "undefined" && Array.isArray(SYMS)) {
              const row = SYMS.find((x) => x && x[0] === s[0]);
              if (row) row[2] = lastC;
            }
            if (typeof SNAP !== "undefined" && Array.isArray(SNAP.uni)) {
              const uRow = SNAP.uni.find((x) => x && x[0] === s[0]);
              if (uRow) uRow[2] = lastC;
            }
          }
          dirty(k);
          markOk("edge");
          VT_EDGE.pausedCharts.delete(k);
          delete ERR[k];
          delete PEND[k];
          fin(s, tf);
          vtRenderGapBadge();
          continue;
        }
      } catch (_e) {}
      vtMarkFeedUnavailable(s[0], tf);
      delete PEND[k];
      fin(s, tf);
    }
  };
  await Promise.all([w(), w(), w(), w()]);
  bzEdge = 0;
  if (QE.length) pumpEdge();
}

function vtPrefetchAdjacent(s, tf) {
  if (!s || !tf || !isLive() || !vtCanUseEdge()) return;
  // Credit protection: prefetch adjacent timeframes ONLY for Crypto (never Twelve Data)
  if (!vtIsCryptoSym(s)) return;
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

function vtBnKlineStop() {
  clearTimeout(VT_EDGE.bnTimer);
  VT_EDGE.bnTimer = 0;
  VT_EDGE.bnSym = "";
  VT_EDGE.bnTf = "";
  if (VT_EDGE.bnWs) {
    try {
      VT_EDGE.bnWs.onopen = VT_EDGE.bnWs.onmessage = VT_EDGE.bnWs.onclose = VT_EDGE.bnWs.onerror = null;
      VT_EDGE.bnWs.close();
    } catch (_e) {}
    VT_EDGE.bnWs = null;
  }
}

function vtBnKlineStart(sym, tf) {
  if (!vtCanUseEdge() || !isLive() || !sym || !tf || vtIsPublicNonTerminalRoute()) return;
  // Same-origin edge policy (§0): refresh active crypto chart via /api/candles (no direct external WS).
  VT_EDGE.bnSym = sym;
  VT_EDGE.bnTf = tf;
  clearTimeout(VT_EDGE.bnTimer);
  const poll = async () => {
    if (VT_EDGE.bnSym !== sym || VT_EDGE.bnTf !== tf || !isLive() || document.hidden || vtIsPublicNonTerminalRoute()) return;
    try {
      const s = typeof symOf === "function" ? symOf(sym) : [sym, "CRY", 0, 0, 1, 0.01, sym, "", "bn", sym];
      const bars = await edgeFetchCandles(s, tf, { refresh: true });
      if (VT_EDGE.bnSym !== sym || VT_EDGE.bnTf !== tf || !bars || !bars.length) return;
      const last = bars[bars.length - 1];
      if (!last || !(Number(last.c) > 0)) return;
      LIVE[sym + "|" + tf] = bars;
      LT[sym + "|" + tf] = Date.now();
      markOk("edge");
      const row = typeof SYMS !== "undefined" ? SYMS.find((x) => x && x[0] === sym) : null;
      if (row) row[2] = Number(last.c);
      if (typeof checkAlerts === "function") checkAlerts(sym, Number(last.c));
      if (S && S.chart && S.chart.sym === sym && S.chart.tf === tf) {
        if (typeof ch !== "undefined" && ch && typeof updateLiveBar === "function") updateLiveBar(sym, tf, last.t);
        const q = document.getElementById("cpx");
        if (q) { q.textContent = fp(Number(last.c)); if (typeof vtPxWatch === "function") vtPxWatch(); }
      }
    } catch (_e) {}
    if (VT_EDGE.bnSym === sym && VT_EDGE.bnTf === tf) {
      VT_EDGE.bnTimer = setTimeout(poll, 15000);
    }
  };
  VT_EDGE.bnTimer = setTimeout(poll, 15000);
}

function vtTdWsStop() {
  const prevSub = VT_EDGE.tdSubTdSym;
  clearTimeout(VT_EDGE.tdTimer);
  VT_EDGE.tdTimer = 0;
  clearInterval(VT_EDGE.tdHb);
  VT_EDGE.tdHb = 0;
  VT_EDGE.tdActiveSym = "";
  VT_EDGE.tdActiveTdSym = "";
  VT_EDGE.tdSubTdSym = "";
  if (VT_EDGE.tdWs) {
    try {
      if (VT_EDGE.tdWs.readyState === 1 && prevSub) {
        VT_EDGE.tdWs.send(JSON.stringify({ action: "unsubscribe", params: { symbols: prevSub } }));
      }
    } catch (_e) {}
    try {
      VT_EDGE.tdWs.onopen = VT_EDGE.tdWs.onmessage = VT_EDGE.tdWs.onclose = VT_EDGE.tdWs.onerror = null;
      VT_EDGE.tdWs.close();
    } catch (_e) {}
    VT_EDGE.tdWs = null;
  }
}

function vtApplyTwelveDataTick(sym, price, tsSec) {
  if (!sym || !(price > 0) || !isFinite(price)) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const rawTs = tsSec && isFinite(tsSec) && tsSec > 1000000000 ? Math.floor(tsSec) : nowSec;
  const tf = (S && S.chart && S.chart.tf) || "1H";
  const step = (typeof STEP !== "undefined" && STEP[tf]) || 3600;
  const bucket = Math.floor(rawTs / step) * step;
  const kChart = sym + "|" + tf;

  const arr = Array.isArray(LIVE[kChart]) ? LIVE[kChart] : null;
  const last = arr && arr.length ? arr[arr.length - 1] : null;

  if (vtIsChartPaused(sym, tf)) {
    vtBackfillChart(sym, tf);
  } else if (!last) {
    if (typeof PEND === "undefined" || !PEND[kChart]) {
      vtSetChartGap(sym, tf, true);
      vtBackfillChart(sym, tf);
    }
  } else if (bucket < last.t) {
    // Ignore out-of-order older packets
  } else if (bucket - last.t > step * 2) {
    vtSetChartGap(sym, tf, true);
    vtBackfillChart(sym, tf);
  } else {
    if (bucket === last.t) {
      last.c = price;
      last.h = Math.max(last.h, price);
      last.l = Math.min(last.l, price);
    } else {
      const open = last.c > 0 ? last.c : price;
      arr.push({
        t: bucket,
        o: open,
        h: Math.max(open, price),
        l: Math.min(open, price),
        c: price,
        v: 0,
      });
      if (arr.length > VT_MAX_BARS) arr.splice(0, arr.length - VT_MAX_BARS);
    }

    const row = SYMS.find((x) => x[0] === sym);
    if (row) row[2] = price;
    checkAlerts(sym, price);

    if (S && S.chart && S.chart.sym === sym) {
      if (typeof ch !== "undefined" && ch && typeof updateLiveBar === "function") {
        updateLiveBar(sym, tf, bucket);
      }
      const q = document.getElementById("cpx");
      if (q) { q.textContent = fp(price); if (typeof vtPxWatch === "function") vtPxWatch(); }
    }
  }

  if (typeof SC !== "undefined" && SC && SC.keyB && SC.keyB.startsWith(sym + "|") && SC.serB) {
    const tfB = (S.sc && S.sc.tfB) || "1D";
    const kB = sym + "|" + tfB;
    const stB = (typeof STEP !== "undefined" && STEP[tfB]) || 86400;
    const bktB = Math.floor(rawTs / stB) * stB;
    if (vtIsChartPaused(sym, tfB)) {
      vtBackfillChart(sym, tfB);
    } else if (LIVE[kB] && LIVE[kB].length) {
      const lb = LIVE[kB][LIVE[kB].length - 1];
      if (bktB - lb.t > stB * 2) {
        vtSetChartGap(sym, tfB, true);
        vtBackfillChart(sym, tfB);
      } else if (bktB >= lb.t) {
        if (bktB === lb.t) {
          lb.c = price;
          lb.h = Math.max(lb.h, price);
          lb.l = Math.min(lb.l, price);
          try { SC.serB.update({ time: lb.t, open: lb.o, high: lb.h, low: lb.l, close: lb.c }); } catch (_e) {}
        } else {
          const nb = { t: bktB, o: lb.c, h: Math.max(lb.c, price), l: Math.min(lb.c, price), c: price, v: 0 };
          LIVE[kB].push(nb);
          try { SC.serB.update({ time: nb.t, open: nb.o, high: nb.h, low: nb.l, close: nb.c }); } catch (_e) {}
        }
      }
    }
  }
}

async function vtTdWsConnect(sym) {
  if (!vtCanUseEdge() || !isLive() || !sym || vtIsCryptoSym(sym)) return;
  const sObj = typeof symOf === "function" ? symOf(sym) : null;
  const tdSym = vtToTdSym(sObj || sym);
  if (!tdSym) return;
  VT_EDGE.tdActiveSym = sym;
  VT_EDGE.tdActiveTdSym = tdSym;

  if (VT_EDGE.tdWs && VT_EDGE.tdWs.readyState === 1) {
    if (VT_EDGE.tdSubTdSym !== tdSym) {
      try {
        if (VT_EDGE.tdSubTdSym) {
          VT_EDGE.tdWs.send(JSON.stringify({ action: "unsubscribe", params: { symbols: VT_EDGE.tdSubTdSym } }));
        }
        VT_EDGE.tdWs.send(JSON.stringify({ action: "subscribe", params: { symbols: tdSym } }));
        VT_EDGE.tdSubTdSym = tdSym;
      } catch (_e) {}
    }
    return;
  }
  if (VT_EDGE.tdWs && VT_EDGE.tdWs.readyState === 0) return;

  // TASK-02 / Phase 3: poll or stream strictly via same-origin /api/candles when edge is active
  if (VT_EDGE.tdActiveSym !== sym || !isLive() || vtIsPublicNonTerminalRoute()) return;
  clearInterval(VT_EDGE.tdHb);
  const vtTdPoll = async () => {
    if (VT_EDGE.tdActiveSym !== sym || !isLive() || document.hidden || vtIsPublicNonTerminalRoute()) return;
    try {
      const s = typeof symOf === "function" ? symOf(sym) : null;
      const tf = (typeof S !== "undefined" && S && S.chart && S.chart.tf) || "1H";
      const bars = s ? await edgeFetchCandles(s, tf, { refresh: true }) : null;
      if (VT_EDGE.tdActiveSym !== sym || !bars || !bars.length) return;
      const last = bars[bars.length - 1];
      if (!last || !(Number(last.c) > 0)) return;
      markOk("tdws");
      vtApplyTwelveDataTick(sym, Number(last.c), last.t || Math.floor(Date.now() / 1000));
    } catch (_e) {}
  };
  vtTdPoll();
  VT_EDGE.tdHb = setInterval(vtTdPoll, 60000);
}

function vtIsPublicNonTerminalRoute() {
  if (typeof document === "undefined") return false;
  if (document.getElementById("vt-landing-root")) return true;
  if (document.documentElement.classList.contains("locked")) return true;
  if (document.documentElement.dataset.page === "legal") return true;
  if (typeof vtIsExternalHash === "function" && vtIsExternalHash(location.hash)) return true;
  return false;
}

function vtSyncChartFeed(sym, tf) {
  if (!vtCanUseEdge() || !isLive() || !sym || vtIsPublicNonTerminalRoute()) return;
  const s = typeof symOf === "function" ? symOf(sym) : null;
  if (vtIsCryptoSym(s || sym)) {
    vtTdWsStop();
    vtBnKlineStart(sym, tf || (S && S.chart && S.chart.tf) || "1H");
  } else {
    vtBnKlineStop();
    vtTdWsConnect(sym);
  }
}

function vtWsSubscribe(sym, tf) {
  if (!vtCanUseEdge()) return;
  vtSyncChartFeed(sym, tf);
}

function vtWsConnect() {
  if (!vtCanUseEdge()) {
    bnwsConnect();
    return;
  }
  if (S && S.chart && S.chart.sym) {
    vtSyncChartFeed(S.chart.sym, S.chart.tf);
  }
}

function vtStopAllFeeds() {
  vtBnKlineStop();
  vtTdWsStop();
}

async function vtHandleTabWake() {
  if (!vtCanUseEdge() || !isLive()) return;
  if (typeof S === "undefined" || !S || !S.chart || !S.chart.sym) return;
  const sym = S.chart.sym;
  const tf = S.chart.tf || "1H";
  vtSetChartGap(sym, tf, true);
  const jobs = [vtBackfillChart(sym, tf, { force: true })];
  if (typeof SC !== "undefined" && SC && S.pageView === "chart" && S.sc && S.sc.panes === 2 && S.sc.tfB && S.sc.tfB !== tf) {
    vtSetChartGap(sym, S.sc.tfB, true);
    jobs.push(vtBackfillChart(sym, S.sc.tfB, { force: true }));
  }
  const resList = await Promise.all(jobs);
  if (resList[0] && S && S.chart && S.chart.sym === sym) {
    vtSyncChartFeed(sym, S.chart.tf);
  }
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("visibilitychange", () => {
    try {
      if (document.hidden || document.visibilityState === "hidden") {
        if (!VT_EDGE.hiddenAt) VT_EDGE.hiddenAt = Date.now();
        return;
      }
      const awayMs = VT_EDGE.hiddenAt ? Date.now() - VT_EDGE.hiddenAt : 0;
      VT_EDGE.hiddenAt = 0;
      if (awayMs > 60000) {
        vtHandleTabWake();
      }
    } catch (_e) {}
  });
}
// ---------- 95 symbol search: TradingView-style instant prefix-matching autocomplete ----------
const VT_SR_TABS=["All","Stocks","Forex","Crypto","Futures","Indices"];
const VT_CATALOG=[
  ["QQQ","Invesco QQQ Trust","ETF","NASDAQ","QQQ","NASDAQ:QQQ","yf","QQQ"],
  ["SPY","SPDR S&P 500 ETF Trust","ETF","NYSE ARCA","SPY","AMEX:SPY","yf","SPY"],
  ["IWM","iShares Russell 2000 ETF","ETF","NYSE ARCA","IWM","AMEX:IWM","yf","IWM"],
  ["DIA","SPDR Dow Jones Industrial Average ETF","ETF","NYSE ARCA","DIA","AMEX:DIA","yf","DIA"],
  ["GLD","SPDR Gold Shares","ETF","NYSE ARCA","GLD","AMEX:GLD","yf","GLD"],
  ["SLV","iShares Silver Trust","ETF","NYSE ARCA","SLV","AMEX:SLV","yf","SLV"],
  ["USO","United States Oil Fund","ETF","NYSE ARCA","USO","AMEX:USO","yf","USO"],
  ["TLT","iShares 20+ Year Treasury Bond ETF","ETF","NASDAQ","TLT","NASDAQ:TLT","yf","TLT"],
  ["SMH","VanEck Semiconductor ETF","ETF","NASDAQ","SMH","NASDAQ:SMH","yf","SMH"],
  ["TQQQ","ProShares UltraPro QQQ","ETF","NASDAQ","TQQQ","NASDAQ:TQQQ","yf","TQQQ"],
  ["SQQQ","ProShares UltraPro Short QQQ","ETF","NASDAQ","SQQQ","NASDAQ:SQQQ","yf","SQQQ"],
  ["QTUM","Defiance Quantum ETF","ETF","NASDAQ","QTUM","NASDAQ:QTUM","yf","QTUM"],
  ["ARKK","ARK Innovation ETF","ETF","NYSE ARCA","ARKK","AMEX:ARKK","yf","ARKK"],
  ["QCOM","QUALCOMM Incorporated","STK","NASDAQ","QCOM","NASDAQ:QCOM","yf","QCOM"],
  ["QRVO","Qorvo, Inc.","STK","NASDAQ","QRVO","NASDAQ:QRVO","yf","QRVO"],
  ["QS","QuantumScape Corporation","STK","NYSE","QS","NYSE:QS","yf","QS"],
  ["QLYS","Qualys, Inc.","STK","NASDAQ","QLYS","NASDAQ:QLYS","yf","QLYS"],
  ["QGEN","QIAGEN N.V.","STK","NYSE","QGEN","NYSE:QGEN","yf","QGEN"],
  ["QSR","Restaurant Brands International Inc.","STK","NYSE","QSR","NYSE:QSR","yf","QSR"],
  ["AAPL","Apple Inc.","STK","NASDAQ","AAPL","NASDAQ:AAPL","yf","AAPL"],
  ["MSFT","Microsoft Corporation","STK","NASDAQ","MSFT","NASDAQ:MSFT","yf","MSFT"],
  ["NVDA","NVIDIA Corporation","STK","NASDAQ","NVDA","NASDAQ:NVDA","yf","NVDA"],
  ["AMZN","Amazon.com, Inc.","STK","NASDAQ","AMZN","NASDAQ:AMZN","yf","AMZN"],
  ["GOOGL","Alphabet Inc.","STK","NASDAQ","GOOGL","NASDAQ:GOOGL","yf","GOOGL"],
  ["META","Meta Platforms, Inc.","STK","NASDAQ","META","NASDAQ:META","yf","META"],
  ["TSLA","Tesla, Inc.","STK","NASDAQ","TSLA","NASDAQ:TSLA","yf","TSLA"],
  ["AVGO","Broadcom Inc.","STK","NASDAQ","AVGO","NASDAQ:AVGO","yf","AVGO"],
  ["AMD","Advanced Micro Devices, Inc.","STK","NASDAQ","AMD","NASDAQ:AMD","yf","AMD"],
  ["PLTR","Palantir Technologies Inc.","STK","NASDAQ","PLTR","NASDAQ:PLTR","yf","PLTR"],
  ["NFLX","Netflix, Inc.","STK","NASDAQ","NFLX","NASDAQ:NFLX","yf","NFLX"],
  ["CRM","Salesforce, Inc.","STK","NYSE","CRM","NYSE:CRM","yf","CRM"],
  ["ORCL","Oracle Corporation","STK","NYSE","ORCL","NYSE:ORCL","yf","ORCL"],
  ["JPM","JPMorgan Chase & Co.","STK","NYSE","JPM","NYSE:JPM","yf","JPM"],
  ["GS","The Goldman Sachs Group, Inc.","STK","NYSE","GS","NYSE:GS","yf","GS"],
  ["COIN","Coinbase Global, Inc.","STK","NASDAQ","COIN","NASDAQ:COIN","yf","COIN"],
  ["MSTR","MicroStrategy Incorporated","STK","NASDAQ","MSTR","NASDAQ:MSTR","yf","MSTR"],
  ["SMCI","Super Micro Computer, Inc.","STK","NASDAQ","SMCI","NASDAQ:SMCI","yf","SMCI"],
  ["ARM","Arm Holdings plc","STK","NASDAQ","ARM","NASDAQ:ARM","yf","ARM"],
  ["MU","Micron Technology, Inc.","STK","NASDAQ","MU","NASDAQ:MU","yf","MU"],
  ["INTC","Intel Corporation","STK","NASDAQ","INTC","NASDAQ:INTC","yf","INTC"],
  ["BA","The Boeing Company","STK","NYSE","BA","NYSE:BA","yf","BA"],
  ["DIS","The Walt Disney Company","STK","NYSE","DIS","NYSE:DIS","yf","DIS"],
  ["UBER","Uber Technologies, Inc.","STK","NYSE","UBER","NYSE:UBER","yf","UBER"],
  ["SHOP","Shopify Inc.","STK","NYSE","SHOP","NYSE:SHOP","yf","SHOP"],
  ["CRWD","CrowdStrike Holdings, Inc.","STK","NASDAQ","CRWD","NASDAQ:CRWD","yf","CRWD"],
  ["PANW","Palo Alto Networks, Inc.","STK","NASDAQ","PANW","NASDAQ:PANW","yf","PANW"],
  ["TSM","Taiwan Semiconductor Manufacturing","STK","NYSE","TSM","NYSE:TSM","yf","TSM"],
  ["ASML","ASML Holding N.V.","STK","NASDAQ","ASML","NASDAQ:ASML","yf","ASML"],
  ["BTCUSDT","Bitcoin / Tether","CRY","BINANCE","BTCUSDT","BINANCE:BTCUSDT","bn","BTC/USD"],
  ["ETHUSDT","Ethereum / Tether","CRY","BINANCE","ETHUSDT","BINANCE:ETHUSDT","bn","ETH/USD"],
  ["SOLUSDT","Solana / Tether","CRY","BINANCE","SOLUSDT","BINANCE:SOLUSDT","bn","SOL/USD"],
  ["BNBUSDT","BNB / Tether","CRY","BINANCE","BNBUSDT","BINANCE:BNBUSDT","bn","BNB/USD"],
  ["XRPUSDT","XRP / Tether","CRY","BINANCE","XRPUSDT","BINANCE:XRPUSDT","bn","XRP/USD"],
  ["DOGEUSDT","Dogecoin / Tether","CRY","BINANCE","DOGEUSDT","BINANCE:DOGEUSDT","bn","DOGE/USD"],
  ["ADAUSDT","Cardano / Tether","CRY","BINANCE","ADAUSDT","BINANCE:ADAUSDT","bn","ADA/USD"],
  ["AVAXUSDT","Avalanche / Tether","CRY","BINANCE","AVAXUSDT","BINANCE:AVAXUSDT","bn","AVAX/USD"],
  ["LINKUSDT","Chainlink / Tether","CRY","BINANCE","LINKUSDT","BINANCE:LINKUSDT","bn","LINK/USD"],
  ["QNTUSDT","Quant / Tether","CRY","BINANCE","QNTUSDT","BINANCE:QNTUSDT","bn","QNT/USD"],
  ["QTUMUSDT","Qtum / Tether","CRY","BINANCE","QTUMUSDT","BINANCE:QTUMUSDT","bn","QTUM/USD"],
  ["EURUSD","Euro / US Dollar","FX","FX","EURUSD=X","FX:EURUSD","yf","EUR/USD"],
  ["GBPUSD","British Pound / US Dollar","FX","FX","GBPUSD=X","FX:GBPUSD","yf","GBP/USD"],
  ["USDJPY","US Dollar / Japanese Yen","FX","FX","USDJPY=X","FX:USDJPY","yf","USD/JPY"],
  ["USDCHF","US Dollar / Swiss Franc","FX","FX","USDCHF=X","FX:USDCHF","yf","USD/CHF"],
  ["AUDUSD","Australian Dollar / US Dollar","FX","FX","AUDUSD=X","FX:AUDUSD","yf","AUD/USD"],
  ["USDCAD","US Dollar / Canadian Dollar","FX","FX","USDCAD=X","FX:USDCAD","yf","USD/CAD"],
  ["NZDUSD","New Zealand Dollar / US Dollar","FX","FX","NZDUSD=X","FX:NZDUSD","yf","NZD/USD"],
  ["EURGBP","Euro / British Pound","FX","FX","EURGBP=X","FX:EURGBP","yf","EUR/GBP"],
  ["EURJPY","Euro / Japanese Yen","FX","FX","EURJPY=X","FX:EURJPY","yf","EUR/JPY"],
  ["GBPJPY","British Pound / Japanese Yen","FX","FX","GBPJPY=X","FX:GBPJPY","yf","GBP/JPY"],
  ["XAUUSD","Gold Spot / US Dollar","CFD","OANDA","GC=F","OANDA:XAUUSD","yf","XAU/USD"],
  ["XAGUSD","Silver Spot / US Dollar","CFD","OANDA","SI=F","OANDA:XAGUSD","yf","XAG/USD"],
  ["ES=F","E-mini S&P 500 Futures","FUT","CME","ES=F","CME_MINI:ES1!","yf","SPY"],
  ["NQ=F","E-mini Nasdaq-100 Futures","FUT","CME","NQ=F","CME_MINI:NQ1!","yf","QQQ"],
  ["YM=F","E-mini Dow ($5) Futures","FUT","CBOT","YM=F","CBOT_MINI:YM1!","yf","DIA"],
  ["RTY=F","E-mini Russell 2000 Futures","FUT","CME","RTY=F","CME_MINI:RTY1!","yf","IWM"],
  ["CL=F","WTI Crude Oil Futures","FUT","NYMEX","CL=F","NYMEX:CL1!","yf","WTI/USD"],
  ["NG=F","Henry Hub Natural Gas Futures","FUT","NYMEX","NG=F","NYMEX:NG1!","yf","NATGAS/USD"],
  ["GC=F","Gold Futures","FUT","COMEX","GC=F","COMEX:GC1!","yf","XAU/USD"],
  ["SI=F","Silver Futures","FUT","COMEX","SI=F","COMEX:SI1!","yf","XAG/USD"],
  ["ZN=F","10-Year T-Note Futures","FUT","CBOT","ZN=F","CBOT:ZN1!","yf","TLT"],
  ["6E=F","Euro FX Futures","FUT","CME","6E=F","CME:6E1!","yf","EUR/USD"],
  ["SPX","S&P 500 Index","IDX","SP","^GSPC","SP:SPX","yf","SPX"],
  ["NASDAQ","Nasdaq Composite Index","IDX","NASDAQ","^IXIC","NASDAQ:IXIC","yf","IXIC"],
  ["DJI","Dow Jones Industrial Average","IDX","DJ","^DJI","DJ:DJI","yf","DJI"],
  ["RUT","Russell 2000 Index","IDX","TVC","^RUT","TVC:RUT","yf","RUT"],
  ["VIX","CBOE Volatility Index","IDX","CBOE","^VIX","TVC:VIX","yf","VIX"],
  ["DAX","DAX Performance Index","IDX","XETR","^GDAXI","XETR:DAX","yf","DAX"],
  ["FTSE","FTSE 100 Index","IDX","TVC","^FTSE","TVC:UKX","yf","FTSE"],
  ["N225","Nikkei 225 Index","IDX","TVC","^N225","TVC:NI225","yf","N225"],
  ["US30","Dow Jones 30 Index CFD","IDX","TVC","^DJI","TVC:DJI","yf","DJI"],
  ["DE40","Germany 40 Index CFD","IDX","TVC","^GDAXI","TVC:DEU40","yf","DAX"],
  ["UK100","UK 100 Index CFD","IDX","TVC","^FTSE","TVC:UKX","yf","FTSE"]
];
const VT_CAT_MAP=new Map(VT_CATALOG.map(x=>[x[0],x]));
function vtAssetLabel(m){return({STK:"Stocks",ETF:"ETF",FX:"Forex",CRY:"Crypto",FUT:"Futures",IDX:"Indices",CFD:"CFD"}[m]||m)}
function vtInferExchange(s){const cat=VT_CAT_MAP.get(s[0]);if(cat)return cat[3];const em=typeof VT_EDGE_META!=="undefined"&&VT_EDGE_META.get(s[0]);if(em&&em.ex)return em.ex;if(s[8]==="bn"||s[1]==="CRY")return"BINANCE";if(s[1]==="FX")return"FX";if(s[1]==="FUT")return"CME";if(s[1]==="IDX")return"INDEX";if(s[1]==="CFD")return"CFD";return"NASDAQ"}
function vtInferName(s){const cat=VT_CAT_MAP.get(s[0]);if(cat)return cat[1];const em=typeof VT_EDGE_META!=="undefined"&&VT_EDGE_META.get(s[0]);if(em&&em.name)return em.name;if(s[1]==="CRY"&&s[0].endsWith("USDT"))return s[0].slice(0,-4)+" / Tether";return s[0]}
function vtMatchTab(mkt,tab){if(tab==="All")return true;if(tab==="Stocks")return mkt==="STK"||mkt==="ETF";if(tab==="Forex")return mkt==="FX";if(tab==="Crypto")return mkt==="CRY";if(tab==="Futures")return mkt==="FUT";if(tab==="Indices")return mkt==="IDX";return true}
function vtSearchCatalog(){const merged=new Map();for(let i=0;i<VT_CATALOG.length;i++){const c=VT_CATALOG[i];merged.set(c[0],{sym:c[0],name:c[1],m:c[2],ex:c[3],api:c[4],tv:c[5],pr:c[6],td:c[7],pri:i})}if(Array.isArray(SYMS)){for(let i=0;i<SYMS.length;i++){const s=SYMS[i];if(!s||!s[0]||merged.has(s[0]))continue;merged.set(s[0],{sym:s[0],name:vtInferName(s),m:s[1]||"STK",ex:vtInferExchange(s),api:s[6]||s[0],tv:s[7]||s[0],pr:s[8]||"yf",td:s[9]||s[0],pri:1000+i})}}return[...merged.values()]}
function vtSearchRank(query,tab,limit=18){const q=String(query||"").trim().toUpperCase();const list=vtSearchCatalog().filter(it=>vtMatchTab(it.m,tab));if(!q)return list.sort((a,b)=>a.pri-b.pri).slice(0,limit);const scored=[];for(const it of list){const sym=it.sym.toUpperCase(),nm=it.name.toUpperCase();let rank=99;if(sym===q)rank=0;else if(sym.startsWith(q))rank=1;else if(nm.split(/[\s/\-,]+/).some(w=>w.startsWith(q)))rank=2;else if(sym.includes(q))rank=3;else if(nm.includes(q))rank=4;if(rank<99)scored.push({it,rank})}scored.sort((a,b)=>{if(a.rank!==b.rank)return a.rank-b.rank;if(a.it.pri!==b.it.pri)return a.it.pri-b.it.pri;if(a.it.sym.length!==b.it.sym.length)return a.it.sym.length-b.it.sym.length;return a.it.sym.localeCompare(b.it.sym)});return scored.slice(0,limit).map(x=>x.it)}
function vtHighlightPrefix(text,query){const q=String(query||"").trim();if(!q)return esc(text);const idx=text.toUpperCase().indexOf(q.toUpperCase());if(idx<0)return esc(text);return esc(text.slice(0,idx))+`<span class="vt-srm">${esc(text.slice(idx,idx+q.length))}</span>`+esc(text.slice(idx+q.length))}
function vtEnsureSym(sym,allowCustom){const up=String(sym||"").trim().toUpperCase();if(!up)return null;const existing=SYMS.find(x=>x[0]===up);if(existing)return existing;const k=(isLive()?"L":"S")+up;if(CUS[k]){if(isLive()){const d=LIVE[up+"|1D"];if(d&&d.length)CUS[k][2]=d[d.length-1].c}return CUS[k]}const cat=VT_CAT_MAP.get(up);if(cat){CUS[k]=isLive()?[cat[0],cat[2],null,0,1,0.015,cat[4],cat[5],cat[6],cat[7],1]:[cat[0],cat[2],50+(seed(up)%350),8e6,1,0.025];if(isLive()){const d=LIVE[up+"|1D"];if(d&&d.length)CUS[k][2]=d[d.length-1].c}return CUS[k]}if(allowCustom){const m=guessM(up);CUS[k]=isLive()?[up,m,null,0,1,0.015,up,"",m==="CRY"?"bn":"yf",up,1]:[up,m,20+(seed(up)%380),5e6,1,0.03];return CUS[k]}return null}
const VT_SR_STATE={tab:"All",idx:0,results:[]};
const VT_SY_STATE={tab:"All",idx:0,results:[]};
function vtRenderSearchBody(q,state,pickFn,tabFn){state.results=vtSearchRank(q,state.tab,18);if(state.idx>=state.results.length)state.idx=0;if(state.idx<0)state.idx=0;const tabsHtml=`<div class="vt-sftabs" role="tablist" aria-label="Asset class filter">${VT_SR_TABS.map(t=>`<button type="button" role="tab" aria-selected="${state.tab===t}" class="vt-sftab${state.tab===t?" on":""}" onmousedown="event.preventDefault();${tabFn}('${t}')">${t}</button>`).join("")}</div>`;const rowsHtml=state.results.length?state.results.map((it,i)=>`<div class="vt-srrow${i===state.idx?" on":""}" role="option" aria-selected="${i===state.idx}" data-sym="${esc(it.sym)}" onmousedown="event.preventDefault();${pickFn}('${esc(it.sym)}')"><span class="vt-srl"><span class="vt-srtk">${vtHighlightPrefix(it.sym,q)}</span><span class="vt-srnm">${vtHighlightPrefix(it.name,q)}</span></span><span class="vt-srr"><span class="vt-srbadge" data-m="${esc(it.m)}">${esc(vtAssetLabel(it.m))}</span><span class="vt-srex">${esc(it.ex)}</span></span></div>`).join(""):`<div class="vt-srempty">No matching symbols in ${esc(state.tab)}. Press Enter to open “${esc(q.toUpperCase()||"…")}”.</div>`;const extSvg='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-1px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';const tvHref=`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(q.trim().toUpperCase()||"SPY")}`;const footHtml=`<div class="vt-srfoot"><span>Up/Down Navigate &middot; Enter Select &middot; Esc Close</span><a href="${tvHref}" target="_blank" rel="noopener">TradingView ${extSvg}</a></div>`;return `${tabsHtml}<div class="vt-srlist" role="listbox">${rowsHtml}</div>${footHtml}`}
function vtSelectHeaderSym(sym){vtEnsureSym(sym,true);openChart(sym);hideSr()}
function vtSetHeaderTab(tab){VT_SR_STATE.tab=tab;VT_SR_STATE.idx=0;srch()}
function srch(){const inp=document.getElementById("sq"),b=document.getElementById("sr");if(!inp||!b)return;const q=inp.value.trim().toUpperCase();if(!q&&document.activeElement!==inp){b.style.display="none";return}b.innerHTML=vtRenderSearchBody(q,VT_SR_STATE,"vtSelectHeaderSym","vtSetHeaderTab");b.style.display="block"}
function srchKey(e){const b=document.getElementById("sr"),open=b&&b.style.display!=="none";if(e.key==="ArrowDown"&&open&&VT_SR_STATE.results.length){e.preventDefault();VT_SR_STATE.idx=(VT_SR_STATE.idx+1)%VT_SR_STATE.results.length;srch();const row=b.querySelector(".vt-srrow.on");if(row)row.scrollIntoView({block:"nearest"});return}if(e.key==="ArrowUp"&&open&&VT_SR_STATE.results.length){e.preventDefault();VT_SR_STATE.idx=(VT_SR_STATE.idx-1+VT_SR_STATE.results.length)%VT_SR_STATE.results.length;srch();const row=b.querySelector(".vt-srrow.on");if(row)row.scrollIntoView({block:"nearest"});return}if(e.key==="Escape"){hideSrBox();e.target.blur();return}if(e.key==="Enter"){e.preventDefault();srchGo()}}
function srchGo(){const inp=document.getElementById("sq"),q=inp?inp.value.trim().toUpperCase():"",hit=VT_SR_STATE.results[VT_SR_STATE.idx]||VT_SR_STATE.results[0];if(hit){vtSelectHeaderSym(hit.sym);return}if(q){vtEnsureSym(q,true);openChart(q);hideSr()}}
function hideSrBox(){const b=document.getElementById("sr");if(b)b.style.display="none"}
function hideSr(){hideSrBox();const inp=document.getElementById("sq");if(inp)inp.value="";VT_SR_STATE.idx=0}
function syOpen(){SYBUF="";VT_SY_STATE.idx=0;syShow()}
function vtSetSyTab(tab){VT_SY_STATE.tab=tab;VT_SY_STATE.idx=0;vtUpdateSyList()}
function vtPickSy(sym){syCancel();vtEnsureSym(sym,true);openChart(sym)}
function vtUpdateSyList(){const resEl=document.getElementById("sy_res");if(!resEl)return;resEl.innerHTML=vtRenderSearchBody(SYBUF,VT_SY_STATE,"vtPickSy","vtSetSyTab")}
function syShow(){let h=document.getElementById("sypop");if(!h){h=document.createElement("div");h.id="sypop";h.className="vt-sypop";h.setAttribute("role","dialog");h.setAttribute("aria-label","Symbol Search");document.body.appendChild(h)}h.innerHTML=`<div class="vt-syhd"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input id="sy_in" value="${esc(SYBUF)}" placeholder="Search symbol, name, exchange…" autocomplete="off" spellcheck="false" aria-label="Symbol search"><button type="button" class="vt-syclose" onclick="syCancel()">Esc</button></div><div id="sy_res"></div>`;h.style.display="flex";vtUpdateSyList();const inp=document.getElementById("sy_in");if(inp){inp.oninput=e=>{SYBUF=e.target.value.toUpperCase();VT_SY_STATE.idx=0;vtUpdateSyList()};inp.onkeydown=e=>{if(e.key==="ArrowDown"&&VT_SY_STATE.results.length){e.preventDefault();e.stopPropagation();VT_SY_STATE.idx=(VT_SY_STATE.idx+1)%VT_SY_STATE.results.length;vtUpdateSyList();const row=h.querySelector(".vt-srrow.on");if(row)row.scrollIntoView({block:"nearest"})}else if(e.key==="ArrowUp"&&VT_SY_STATE.results.length){e.preventDefault();e.stopPropagation();VT_SY_STATE.idx=(VT_SY_STATE.idx-1+VT_SY_STATE.results.length)%VT_SY_STATE.results.length;vtUpdateSyList();const row=h.querySelector(".vt-srrow.on");if(row)row.scrollIntoView({block:"nearest"})}else if(e.key==="Enter"){e.preventDefault();e.stopPropagation();syConfirm()}else if(e.key==="Escape"){e.preventDefault();e.stopPropagation();syCancel()}};setTimeout(()=>{inp.focus();inp.setSelectionRange(inp.value.length,inp.value.length)},15)}}
function syCancel(){SYBUF="";VT_SY_STATE.idx=0;const h=document.getElementById("sypop");if(h)h.style.display="none"}
function syConfirm(){const hit=VT_SY_STATE.results[VT_SY_STATE.idx]||VT_SY_STATE.results[0],q=SYBUF.trim().toUpperCase();syCancel();if(hit){vtEnsureSym(hit.sym,true);openChart(hit.sym);return}if(!q)return;const m=SYMS.find(s=>s[0].toUpperCase()===q)||SYMS.find(s=>s[0].toUpperCase().startsWith(q));if(m)openChart(m[0]);else{vtEnsureSym(q,true);openChart(q)}}
document.addEventListener("mousedown",e=>{const h=document.getElementById("sypop");if(h&&h.style.display!=="none"&&!h.contains(e.target)&&!e.target.closest(".vt-symbtn"))syCancel()});
// ==== VT PAGES END ====
function vtStartup(){
  try{applyTheme()}catch(e){console.error("applyTheme error:",e)}
  try{authInit()}catch(e){console.error("authInit error:",e)}
}
if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",vtStartup,{once:true});
}else{
  vtStartup();
}
window.addEventListener("load",()=>{
  try{
    if(BOOTED&&READY){
      const tbl=document.getElementById("t");
      if(tbl&&(!tbl.tBodies||!tbl.tBodies.length))render();
    }
  }catch(e){console.error("window load error:",e)}
});
