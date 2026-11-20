// ---------- 94 edge client: Single-Source Protocol v2 WebSocket + Initial Historical REST Seeding ----------
const VT_CANDLE_IN_FLIGHT = new Map();
const VT_CANDLE_EDGE_CACHE = new Map();
const VT_BACKFILL_COOLDOWN_MS = 15000;
const VT_MAX_BARS = 25000;
const VT_EDGE = {
  ok: false,
  ts: 0,
  ws: null,
  wsReady: false,
  wsConnecting: false,
  wsRetry: 0,
  wsReconnectTimer: 0,
  wsPingTimer: 0,
  wsLastMsgAt: 0,
  wsLastViewAt: 0,
  wsViewTimer: 0,
  wsLastViewKey: "",
  wsProvenance: "UNAVAILABLE",
  wsFeeds: {},
  dirtySyms: new Set(),
  uiRaf: 0,
  lastScreenerRenderAt: 0,
  lastHeatmapRenderAt: 0,
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
        const px = Number(u[2]);
        const pct = typeof u[12] === "number" && isFinite(u[12]) ? u[12] : null;
        const prevClose = px > 0 && pct !== null && pct > -99.9 ? px / (1 + pct / 100) : null;
        const existing = VT_EDGE_META.get(u[0]);
        if (u[10] || u[11] || pct !== null || px > 0) {
          VT_EDGE_META.set(u[0], {
            name: u[10] || (existing && existing.name) || u[0],
            ex: u[11] || (existing && existing.ex) || "",
            m: u[1] || (existing && existing.m) || "STK",
            pct: pct !== null ? pct : (existing ? existing.pct : undefined),
            prevClose: prevClose || (existing ? existing.prevClose : undefined),
            last: px > 0 ? px : (existing ? existing.last : undefined),
            vol: Number(u[3]) > 0 ? Number(u[3]) : (existing ? existing.vol : undefined),
            ts: m.ts || Date.now(),
          });
        }
        return [u[0], u[1], u[2], u[3], u[4] || 1, u[5] || 0.01, u[6] || u[0], u[7] || "", u[8] || "td", u[9] || u[0]];
      })
      .filter(Boolean);
    SNAP.ok = true;
    VT_EDGE.ok = true;
    VT_EDGE.ts = SNAP.t;
    if (typeof dirtySnap === "function") try { dirtySnap(); } catch (_e) {}
    if (typeof setLive === "function") try { setLive(); } catch (_e) {}
    if (typeof vtSyncWsView === "function") try { vtSyncWsView(); } catch (_e) {}
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
        const step = (typeof STEP !== "undefined" && STEP[tf]) || 3600;
        const prevArr = Array.isArray(LIVE[k]) && LIVE[k].length ? LIVE[k] : null;
        const prevLast = prevArr ? prevArr[prevArr.length - 1] : null;
        if (prevArr) {
          const headCut = bars[0].t;
          const older = prevArr.filter((b) => b && b.t < headCut && b.c > 0);
          const combined = older.concat(bars);
          if (prevLast && prevLast.c > 0) {
            const pT = step < 86400 ? Math.floor(prevLast.t / step) * step : prevLast.t;
            const cLast = combined[combined.length - 1];
            const cT = cLast ? (step < 86400 ? Math.floor(cLast.t / step) * step : cLast.t) : 0;
            if (cLast && pT === cT) {
              const restFlat = cLast.o === cLast.h && cLast.h === cLast.l && cLast.l === cLast.c;
              const liveHasRange = prevLast.h > prevLast.l || prevLast.o !== prevLast.c;
              if (restFlat && liveHasRange) {
                combined[combined.length - 1] = Object.assign({}, prevLast, { t: pT });
              } else {
                combined[combined.length - 1] = Object.assign({}, cLast, {
                  t: cT,
                  h: Math.max(cLast.h, prevLast.h, prevLast.c),
                  l: Math.min(cLast.l, prevLast.l, prevLast.c),
                  c: prevLast.c,
                });
              }
            } else if (pT > cT) {
              combined.push(Object.assign({}, prevLast, { t: pT }));
            }
          }
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
          if (row && !(row[2] > 0)) row[2] = lastBar.c;
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
            if (Array.isArray(s) && !(s[2] > 0)) s[2] = lastC;
            if (typeof SYMS !== "undefined" && Array.isArray(SYMS)) {
              const row = SYMS.find((x) => x && x[0] === s[0]);
              if (row && !(row[2] > 0)) row[2] = lastC;
            }
            if (typeof SNAP !== "undefined" && Array.isArray(SNAP.uni)) {
              const uRow = SNAP.uni.find((x) => x && x[0] === s[0]);
              if (uRow && !(uRow[2] > 0)) uRow[2] = lastC;
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

function vtBuildWsUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return proto + "//" + location.host + "/ws";
}

function vtCollectWsPrioritySymbols() {
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    const s = String(raw || "").trim().toUpperCase();
    if (!s || seen.has(s) || !/^[A-Z0-9.=^/-]{1,24}$/.test(s)) return;
    seen.add(s);
    out.push(s);
  };
  if (typeof S !== "undefined" && S && S.chart && S.chart.sym) add(S.chart.sym);
  if (typeof wlAll === "function") {
    try {
      const wl = wlAll();
      if (Array.isArray(wl)) wl.forEach(add);
    } catch (_e) {}
  }
  if (typeof PGL !== "undefined" && Array.isArray(PGL)) {
    for (let i = 0; i < PGL.length && out.length < 40; i++) add(PGL[i]);
  }
  if (typeof SYMS !== "undefined" && Array.isArray(SYMS)) {
    for (let i = 0; i < SYMS.length && out.length < 40; i++) {
      if (SYMS[i] && SYMS[i][0]) add(SYMS[i][0]);
    }
  }
  return out.slice(0, 64);
}

function vtBuildViewFrame() {
  const syms = vtCollectWsPrioritySymbols();
  const sym = (typeof S !== "undefined" && S && S.chart && S.chart.sym) || syms[0] || "EURUSD";
  const tf = (typeof S !== "undefined" && S && S.chart && S.chart.tf) || "1H";
  return {
    op: "view",
    chart: { sym: String(sym).toUpperCase(), tf: String(tf) },
    watchlist: syms,
  };
}

function vtSendWsViewNow(force) {
  if (!VT_EDGE.ws || VT_EDGE.ws.readyState !== 1) return false;
  const view = vtBuildViewFrame();
  const key = JSON.stringify(view);
  if (!force && key === VT_EDGE.wsLastViewKey) return true;
  try {
    VT_EDGE.ws.send(key);
    VT_EDGE.wsLastViewKey = key;
    VT_EDGE.wsLastViewAt = Date.now();
    return true;
  } catch (_e) {
    return false;
  }
}

function vtSyncWsView(force) {
  if (!vtCanUseEdge() || !isLive() || vtIsPublicNonTerminalRoute()) return;
  if (!VT_EDGE.ws || (VT_EDGE.ws.readyState !== 0 && VT_EDGE.ws.readyState !== 1)) {
    vtOpenEdgeWs();
    return;
  }
  if (VT_EDGE.ws.readyState !== 1) return;

  // Respect MarketHub's 500ms VIEW_COOLDOWN_MS while delivering immediately when idle
  const elapsed = Date.now() - (VT_EDGE.wsLastViewAt || 0);
  clearTimeout(VT_EDGE.wsViewTimer);
  if (elapsed >= 550) {
    vtSendWsViewNow(!!force);
  } else {
    VT_EDGE.wsViewTimer = setTimeout(() => {
      VT_EDGE.wsViewTimer = 0;
      vtSendWsViewNow(!!force);
    }, Math.max(50, 560 - elapsed));
  }
}

function vtPatchLiveDomForSymbols(syms) {
  if (typeof document === "undefined" || !syms || !syms.length) return;
  for (const sym of syms) {
    const s = typeof symOf === "function" ? symOf(sym) : null;
    if (!s) continue;
    const d = typeof wlData === "function" ? wlData(sym) : { last: s[2], chg: null, vol: s[3] };
    const priceTxt = d.last == null ? "…" : fp(d.last, s);
    const chgTxt = d.chg == null ? "…" : (d.chg > 0 ? "+" : "") + d.chg.toFixed(2) + "%";
    const volTxt = d.vol ? fm(d.vol) : "–";

    // Targeted zero-jitter patch for Watchlist rows
    const wlRows = document.querySelectorAll(`#wl .wr[data-s="${sym}"]`);
    for (const row of wlRows) {
      const vals = row.querySelectorAll(".wv");
      if (vals[0] && vals[0].textContent !== priceTxt) vals[0].textContent = priceTxt;
      if (vals[1]) {
        if (vals[1].textContent !== chgTxt) vals[1].textContent = chgTxt;
        vals[1].classList.toggle("up", d.chg != null && d.chg >= 0);
        vals[1].classList.toggle("dn", d.chg != null && d.chg < 0);
      }
      if (vals[2] && vals[2].textContent !== volTxt) vals[2].textContent = volTxt;
    }

    // Targeted zero-jitter patch for Supercharts right-dock rows
    const dkRows = document.querySelectorAll(`#dkwl .dkr[data-s="${sym}"]`);
    for (const row of dkRows) {
      const pEl = row.querySelector(".dkp");
      const cEl = row.querySelector(".dkc");
      if (pEl && pEl.textContent !== priceTxt) pEl.textContent = priceTxt;
      if (cEl) {
        if (cEl.textContent !== chgTxt) cEl.textContent = chgTxt;
        cEl.classList.toggle("up", d.chg != null && d.chg >= 0);
        cEl.classList.toggle("dn", d.chg != null && d.chg < 0);
      }
    }

    // Targeted zero-jitter patch for active Screener rows
    const tr = document.querySelector(`#t tbody tr[data-s="${sym}"]`);
    if (tr && typeof S !== "undefined" && S && Array.isArray(S.cols)) {
      const visCols = S.cols.filter((c) => !c.hide);
      const cells = tr.querySelectorAll("td");
      for (let i = 0; i < visCols.length; i++) {
        const col = visCols[i];
        const td = cells[i + 1];
        if (!td) continue;
        if (col.type === "price" && d.last != null) {
          if (td.textContent !== priceTxt) td.textContent = priceTxt;
        } else if (col.type === "pct" && col.tf === "1D" && d.chg != null) {
          if (td.textContent !== chgTxt) td.textContent = chgTxt;
          td.classList.toggle("up", d.chg >= 0);
          td.classList.toggle("dn", d.chg < 0);
        } else if (col.type === "vol" && d.vol != null) {
          if (td.textContent !== volTxt) td.textContent = volTxt;
        }
      }
    }
  }
}

function vtFlushLiveUi() {
  VT_EDGE.uiRaf = 0;
  if (!VT_EDGE.dirtySyms.size) return;
  const syms = [...VT_EDGE.dirtySyms];
  VT_EDGE.dirtySyms.clear();

  vtPatchLiveDomForSymbols(syms);

  const now = Date.now();
  // Periodic throttled full re-render for Screener sorting & Heatmap tiles (never on every tick)
  if (typeof S !== "undefined" && S) {
    if (S.pageView === "screener" && now - VT_EDGE.lastScreenerRenderAt > 2500) {
      const ae = typeof document !== "undefined" ? document.activeElement : null;
      const typing = ae && /INPUT|SELECT|TEXTAREA/.test(ae.tagName || "");
      const modalOpen = typeof MD !== "undefined" && MD && MD.innerHTML;
      if (!typing && !modalOpen && typeof render === "function") {
        VT_EDGE.lastScreenerRenderAt = now;
        try { render(); } catch (_e) {}
      }
    } else if (S.pageView === "heatmap" && now - VT_EDGE.lastHeatmapRenderAt > 2500) {
      if (typeof render === "function") {
        VT_EDGE.lastHeatmapRenderAt = now;
        try { render(); } catch (_e) {}
      }
    }
  }
}

function vtScheduleLiveUiFlush(sym) {
  if (sym) VT_EDGE.dirtySyms.add(sym);
  if (VT_EDGE.uiRaf) return;
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 50);
  VT_EDGE.uiRaf = raf(vtFlushLiveUi);
}

// Single normalized real-time price ingestion store for Charts, Watchlists, Screeners, and Heatmaps
// Open of a bar born from a live tick. FX/CFD quotes are a continuous market and arrive sparsely, so a bar opens at the
// previous close when it follows it directly (no flat one-tick dashes). Everything else opens at its first tick, and a
// gap of more than two steps never bridges the previous close. Mirrors shared/market/candles.js ("auto" open mode).
function vtNewBarOpen(sym, prevBar, prevBucket, bucket, step, price) {
  const rec = typeof symOf === "function" ? symOf(sym) : null;
  const cont = rec && (rec[1] === "FX" || rec[1] === "CFD");
  if (cont && prevBar && prevBar.c > 0 && bucket - prevBucket <= step * 2) return prevBar.c;
  return price;
}

function vtApplyNormalizedTick(rawSym, rawPrice, rawTs, meta) {
  const sym = String(rawSym || "").trim().toUpperCase();
  const price = Number(rawPrice);
  if (!sym || !(price > 0) || !isFinite(price)) return;

  const opts = meta || {};
  const nowMs = Date.now();
  const numT = Number(rawTs);
  const tsMs = isFinite(numT) && numT > 0 ? (numT < 1e12 ? numT * 1000 : numT) : nowMs;
  const rawTsSec = Math.floor(tsMs / 1000);

  // 1. Update single normalized metadata map (prevClose, live Chg%, live vol, bid/ask, source)
  const prevMeta = VT_EDGE_META.get(sym) || { name: sym, ex: "", m: "" };
  const d1 = typeof LIVE !== "undefined" && Array.isArray(LIVE[sym + "|1D"]) ? LIVE[sym + "|1D"] : null;
  let prevClose = d1 && d1.length > 1 && d1[d1.length - 2].c > 0 ? d1[d1.length - 2].c : prevMeta.prevClose;
  let chgPct = typeof opts.chgPct === "number" && isFinite(opts.chgPct) ? opts.chgPct : undefined;
  if (!(prevClose > 0) && chgPct !== undefined && chgPct > -99.9) {
    prevClose = price / (1 + chgPct / 100);
  }
  if (chgPct === undefined && prevClose > 0) {
    chgPct = ((price - prevClose) / prevClose) * 100;
  }
  const vol = typeof opts.vol === "number" && isFinite(opts.vol) && opts.vol > 0 ? opts.vol : prevMeta.vol;
  VT_EDGE_META.set(sym, {
    ...prevMeta,
    last: price,
    prevClose: prevClose > 0 ? prevClose : prevMeta.prevClose,
    pct: chgPct !== undefined ? chgPct : prevMeta.pct,
    vol,
    bid: opts.bid > 0 ? opts.bid : prevMeta.bid,
    ask: opts.ask > 0 ? opts.ask : prevMeta.ask,
    ts: tsMs,
    source: opts.source || prevMeta.source || "twelvedata",
  });

  // 2. Sync SYMS, SNAP.uni, and custom watchlist cache so every screen reads the exact same price
  if (typeof SYMS !== "undefined" && Array.isArray(SYMS)) {
    const row = SYMS.find((x) => x && x[0] === sym);
    if (row) {
      row[2] = price;
      if (vol > 0) row[3] = vol;
    }
  }
  if (typeof SNAP !== "undefined" && Array.isArray(SNAP.uni)) {
    const uRow = SNAP.uni.find((x) => x && x[0] === sym);
    if (uRow) {
      uRow[2] = price;
      if (vol > 0) uRow[3] = vol;
    }
  }
  if (typeof CUS !== "undefined" && CUS && CUS["L" + sym]) {
    CUS["L" + sym][2] = price;
    if (vol > 0) CUS["L" + sym][3] = vol;
  }

  // 3. Keep loaded 1D bar in sync so Watchlist/Screener/Heatmap 1D change matches live tick
  if (d1 && d1.length) {
    const dayBucket = Math.floor(rawTsSec / 86400) * 86400;
    const last1D = d1[d1.length - 1];
    if (last1D && dayBucket >= last1D.t && dayBucket - last1D.t <= 86400) {
      if (dayBucket === last1D.t) {
        last1D.c = price;
        if (price > last1D.h) last1D.h = price;
        if (price < last1D.l) last1D.l = price;
        if (vol > 0 && vol > (last1D.v || 0)) last1D.v = vol;
      }
    }
  }

  // 4. Sync active chart & split pane B in real time (standard WS bar aggregation, no polling gap freeze)
  if (!opts.skipChartUpdate) {
    const tf = (typeof S !== "undefined" && S && S.chart && S.chart.tf) || "1H";
    if (typeof S !== "undefined" && S && S.chart && S.chart.sym === sym) {
      const step = (typeof STEP !== "undefined" && STEP[tf]) || 3600;
      const bucket = Math.floor(rawTsSec / step) * step;
      const kChart = sym + "|" + tf;
      const arr = typeof LIVE !== "undefined" && Array.isArray(LIVE[kChart]) ? LIVE[kChart] : null;
      const last = arr && arr.length ? arr[arr.length - 1] : null;

      if (!last) {
        if (typeof LIVE !== "undefined") {
          LIVE[kChart] = [{ t: bucket, o: price, h: price, l: price, c: price, v: 0 }];
        }
        if (typeof PEND === "undefined" || !PEND[kChart]) {
          vtBackfillChart(sym, tf);
        }
      } else {
        const lastBucket = step < 86400 ? Math.floor(last.t / step) * step : last.t;
        if (bucket < lastBucket) {
          // Ignore out-of-order older packets
        } else {
          if (bucket === lastBucket) {
            last.t = lastBucket;
            last.h = Math.max(last.h, last.o, price);
            last.l = Math.min(last.l, last.o, price);
            last.c = price;
          } else {
            const open = vtNewBarOpen(sym, last, lastBucket, bucket, step, price);
            arr.push({
              t: bucket,
              o: open,
              h: Math.max(open, price),
              l: Math.min(open, price),
              c: price,
              v: 0,
            });
            if (arr.length > VT_MAX_BARS) arr.splice(0, arr.length - VT_MAX_BARS);
            if (bucket - lastBucket > step * 2 && typeof vtBackfillChart === "function") {
              vtBackfillChart(sym, tf);
            }
          }
          if (typeof LT !== "undefined") LT[kChart] = nowMs;
          if (typeof ch !== "undefined" && ch && typeof updateLiveBar === "function") {
            updateLiveBar(sym, tf, bucket);
          }
          const q = document.getElementById("cpx");
          if (q) {
            const sRec = typeof symOf === "function" ? symOf(sym) : null;
            const txt = fp(price, sRec || sym);
            if (q.textContent !== txt) {
              q.textContent = txt;
              if (typeof vtPxWatch === "function") vtPxWatch();
            }
          }
        }
      }
    }

    if (typeof SC !== "undefined" && SC && SC.keyB && SC.keyB.startsWith(sym + "|") && SC.serB) {
      const tfB = (S && S.sc && S.sc.tfB) || "1D";
      const kB = sym + "|" + tfB;
      const stB = (typeof STEP !== "undefined" && STEP[tfB]) || 86400;
      const bktB = Math.floor(rawTsSec / stB) * stB;
      if (LIVE[kB] && LIVE[kB].length) {
        const lb = LIVE[kB][LIVE[kB].length - 1];
        const lbBucket = stB < 86400 ? Math.floor(lb.t / stB) * stB : lb.t;
        if (bktB >= lbBucket) {
          if (bktB === lbBucket) {
            lb.t = lbBucket;
            lb.h = Math.max(lb.h, lb.o, price);
            lb.l = Math.min(lb.l, lb.o, price);
            lb.c = price;
            try { SC.serB.update({ time: lb.t, open: lb.o, high: lb.h, low: lb.l, close: lb.c }); } catch (_e) {}
          } else {
            const openB = vtNewBarOpen(sym, lb, lbBucket, bktB, stB, price);
            const nb = { t: bktB, o: openB, h: Math.max(openB, price), l: Math.min(openB, price), c: price, v: 0 };
            LIVE[kB].push(nb);
            try { SC.serB.update({ time: nb.t, open: nb.o, high: nb.h, low: nb.l, close: nb.c }); } catch (_e) {}
          }
        }
      }
    }
  }

  if (typeof checkAlerts === "function") checkAlerts(sym, price);
  if (typeof markOk === "function") markOk("tdws");
  vtScheduleLiveUiFlush(sym);
}

// Backward-compatible alias used by tests/callers
function vtApplyTwelveDataTick(sym, price, tsSec) {
  vtApplyNormalizedTick(sym, price, tsSec, { source: "twelvedata" });
}

function vtApplyServerBar(sym, tf, rawBar) {
  if (!sym || !tf || !rawBar) return;
  const b = Array.isArray(rawBar)
    ? { t: Number(rawBar[0]), o: Number(rawBar[1]), h: Number(rawBar[2]), l: Number(rawBar[3]), c: Number(rawBar[4]), v: Number(rawBar[5]) || 0 }
    : { t: Number(rawBar.t), o: Number(rawBar.o), h: Number(rawBar.h), l: Number(rawBar.l), c: Number(rawBar.c), v: Number(rawBar.v) || 0 };
  if (!(b.t > 0) || !(b.c > 0) || !isFinite(b.c)) return;
  const step = (typeof STEP !== "undefined" && STEP[tf]) || 3600;
  if (step < 86400) b.t = Math.floor(b.t / step) * step;

  const k = sym + "|" + tf;
  const arr = typeof LIVE !== "undefined" && Array.isArray(LIVE[k]) ? LIVE[k] : null;
  if (arr && arr.length) {
    const last = arr[arr.length - 1];
    const lastBucket = step < 86400 ? Math.floor(last.t / step) * step : last.t;
    if (b.t === lastBucket) {
      last.t = lastBucket;
      const lastFlat = last.o === last.h && last.h === last.l && last.l === last.c;
      const barHasRange = b.h > b.l || b.o !== b.c;
      if (lastFlat && barHasRange) {
        last.o = b.o;
        last.h = b.h;
        last.l = b.l;
        last.c = b.c;
      } else {
        last.h = Math.max(last.h, last.o, b.h, b.c);
        last.l = Math.min(last.l, last.o, b.l, b.c);
        last.c = b.c;
      }
      if (b.v > 0) last.v = Math.max(last.v || 0, b.v);
    } else if (b.t > lastBucket) {
      arr.push(b);
      if (arr.length > VT_MAX_BARS) arr.splice(0, arr.length - VT_MAX_BARS);
    }
    if (typeof LT !== "undefined") LT[k] = Date.now();
    if (typeof S !== "undefined" && S && S.chart && S.chart.sym === sym && S.chart.tf === tf) {
      if (typeof ch !== "undefined" && ch && typeof updateLiveBar === "function") {
        updateLiveBar(sym, tf, b.t);
      }
      const q = document.getElementById("cpx");
      if (q) {
        const sRec = typeof symOf === "function" ? symOf(sym) : sym;
        const txt = fp(b.c, sRec);
        if (q.textContent !== txt) {
          q.textContent = txt;
          if (typeof vtPxWatch === "function") vtPxWatch();
        }
      }
    }
  }

  // Feed the same normalized price into Watchlist, Screener, and Heatmap store
  vtApplyNormalizedTick(sym, b.c, b.t * 1000, { source: "twelvedata", skipChartUpdate: true });
}

function vtHandleEdgeWsMessage(raw) {
  VT_EDGE.wsLastMsgAt = Date.now();
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (_e) {
    return;
  }
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "pong") {
    if (typeof markOk === "function") markOk("edge");
    return;
  }

  if (msg.type === "hello") {
    VT_EDGE.wsReady = true;
    VT_EDGE.wsRetry = 0;
    if (typeof markOk === "function") markOk("edge");
    if (!VT_EDGE.wsLastViewKey) vtSendWsViewNow(true);
    return;
  }

  if (msg.type === "status") {
    if (msg.provenance) VT_EDGE.wsProvenance = msg.provenance;
    if (msg.feeds && typeof msg.feeds === "object") VT_EDGE.wsFeeds = msg.feeds;
    if (msg.provenance === "LIVE" && typeof markOk === "function") markOk("tdws");
    if (typeof status === "function") status(); // badge mirrors the backend's stream health
    return;
  }

  if (msg.type === "quotes" && Array.isArray(msg.quotes)) {
    for (const q of msg.quotes) {
      if (!q || !q.s || !(Number(q.c) > 0)) continue;
      vtApplyNormalizedTick(q.s, Number(q.c), q.t, {
        vol: Number(q.v),
        chgPct: typeof q.chgPct === "number" ? q.chgPct : undefined,
        bid: Number(q.bid),
        ask: Number(q.ask),
        source: q.source || "twelvedata",
      });
    }
    return;
  }

  if (msg.type === "bar" && msg.sym && msg.tf && msg.bar) {
    vtApplyServerBar(String(msg.sym).toUpperCase(), String(msg.tf), msg.bar);
    return;
  }

  if (msg.type === "state") {
    if (msg.status && msg.status.provenance) {
      VT_EDGE.wsProvenance = msg.status.provenance;
      if (msg.status.feeds && typeof msg.status.feeds === "object") VT_EDGE.wsFeeds = msg.status.feeds;
      if (typeof status === "function") status();
    }
    if (Array.isArray(msg.watchlist)) {
      for (const q of msg.watchlist) {
        if (!q || !q.s || !(Number(q.c) > 0)) continue;
        vtApplyNormalizedTick(q.s, Number(q.c), q.t, {
          vol: Number(q.v),
          chgPct: typeof q.chgPct === "number" ? q.chgPct : undefined,
          bid: Number(q.bid),
          ask: Number(q.ask),
          source: q.source || "twelvedata",
        });
      }
    }
    if (msg.chart && msg.chart.sym && msg.chart.tf && Array.isArray(msg.chart.bars) && msg.chart.bars.length) {
      const last = msg.chart.bars[msg.chart.bars.length - 1];
      vtApplyServerBar(String(msg.chart.sym).toUpperCase(), String(msg.chart.tf), last);
    }
    return;
  }

  // Backward-compatible legacy ticks frame
  if (msg.type === "ticks") {
    const arr = Array.isArray(msg.ticks) ? msg.ticks : (Array.isArray(msg.d) ? msg.d : []);
    for (const t of arr) {
      if (!t || !t.s || !(Number(t.c) > 0)) continue;
      vtApplyNormalizedTick(t.s, Number(t.c), t.t || msg.ts, {
        vol: Number(t.v),
        source: msg.source || t.src || "twelvedata",
      });
    }
  }
}

function vtCloseEdgeWs() {
  clearTimeout(VT_EDGE.wsReconnectTimer);
  VT_EDGE.wsReconnectTimer = 0;
  clearInterval(VT_EDGE.wsPingTimer);
  VT_EDGE.wsPingTimer = 0;
  clearTimeout(VT_EDGE.wsViewTimer);
  VT_EDGE.wsViewTimer = 0;
  VT_EDGE.wsReady = false;
  VT_EDGE.wsConnecting = false;
  VT_EDGE.wsLastViewKey = "";
  if (VT_EDGE.ws) {
    try {
      VT_EDGE.ws.onopen = VT_EDGE.ws.onmessage = VT_EDGE.ws.onclose = VT_EDGE.ws.onerror = null;
      VT_EDGE.ws.close(1000, "client-stop");
    } catch (_e) {}
    VT_EDGE.ws = null;
  }
}

function vtScheduleEdgeWsReconnect() {
  if (!vtCanUseEdge() || !isLive() || vtIsPublicNonTerminalRoute()) return;
  if (VT_EDGE.wsReconnectTimer) return;
  const base = vtNextBackoff(VT_EDGE.wsRetry);
  VT_EDGE.wsRetry += 1;
  const jitter = Math.floor((Date.now() % 250));
  VT_EDGE.wsReconnectTimer = setTimeout(() => {
    VT_EDGE.wsReconnectTimer = 0;
    vtOpenEdgeWs();
  }, base + jitter);
}

function vtOpenEdgeWs() {
  if (!vtCanUseEdge() || !isLive() || vtIsPublicNonTerminalRoute()) return;
  if (typeof WebSocket === "undefined") return;
  if (VT_EDGE.ws && (VT_EDGE.ws.readyState === 0 || VT_EDGE.ws.readyState === 1)) return;

  clearTimeout(VT_EDGE.wsReconnectTimer);
  VT_EDGE.wsReconnectTimer = 0;
  VT_EDGE.wsConnecting = true;

  let ws;
  try {
    ws = new WebSocket(vtBuildWsUrl());
  } catch (_e) {
    VT_EDGE.wsConnecting = false;
    vtScheduleEdgeWsReconnect();
    return;
  }

  VT_EDGE.ws = ws;
  ws.onopen = () => {
    if (VT_EDGE.ws !== ws) return;
    VT_EDGE.wsConnecting = false;
    VT_EDGE.wsReady = true;
    VT_EDGE.wsRetry = 0;
    VT_EDGE.wsLastMsgAt = Date.now();
    VT_EDGE.wsLastViewKey = "";
    try {
      ws.send(JSON.stringify({ op: "hello", v: 2 }));
    } catch (_e) {}
    vtSendWsViewNow(true);

    clearInterval(VT_EDGE.wsPingTimer);
    VT_EDGE.wsPingTimer = setInterval(() => {
      if (!VT_EDGE.ws || VT_EDGE.ws.readyState !== 1) return;
      if (VT_EDGE.wsLastMsgAt > 0 && Date.now() - VT_EDGE.wsLastMsgAt > 65000) {
        try { VT_EDGE.ws.close(4000, "stale"); } catch (_e) {}
        return;
      }
      try {
        VT_EDGE.ws.send(JSON.stringify({ op: "ping", t: Date.now() }));
      } catch (_e) {}
    }, 25000);
  };

  ws.onmessage = (ev) => {
    if (VT_EDGE.ws !== ws) return;
    if (typeof ev.data === "string") vtHandleEdgeWsMessage(ev.data);
  };

  const onDrop = () => {
    if (VT_EDGE.ws !== ws) return;
    clearInterval(VT_EDGE.wsPingTimer);
    VT_EDGE.wsPingTimer = 0;
    VT_EDGE.ws = null;
    VT_EDGE.wsReady = false;
    VT_EDGE.wsConnecting = false;
    VT_EDGE.wsLastViewKey = "";
    vtScheduleEdgeWsReconnect();
  };

  ws.onclose = onDrop;
  ws.onerror = () => {
    try { ws.close(); } catch (_e) {}
    onDrop();
  };
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
  vtSyncWsView();
}

function vtWsSubscribe(sym, tf) {
  if (!vtCanUseEdge()) return;
  vtSyncChartFeed(sym, tf);
}

function vtWsConnect() {
  if (!vtCanUseEdge() || vtIsPublicNonTerminalRoute()) return;
  vtOpenEdgeWs();
  if (S && S.chart && S.chart.sym) {
    vtSyncChartFeed(S.chart.sym, S.chart.tf);
  }
}

function vtStopAllFeeds() {
  vtCloseEdgeWs();
}

async function vtHandleTabWake() {
  if (!vtCanUseEdge() || !isLive()) return;
  if (typeof S === "undefined" || !S || !S.chart || !S.chart.sym) return;
  const sym = S.chart.sym;
  const tf = S.chart.tf || "1H";
  const jobs = [vtBackfillChart(sym, tf, { force: true })];
  if (typeof SC !== "undefined" && SC && S.pageView === "chart" && S.sc && S.sc.panes === 2 && S.sc.tfB && S.sc.tfB !== tf) {
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
      const wsUp = VT_EDGE.ws && VT_EDGE.ws.readyState === 1;
      if (!wsUp) vtWsConnect();
      if (awayMs > 60000 && !wsUp) {
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
