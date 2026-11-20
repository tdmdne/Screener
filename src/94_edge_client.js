// ---------- Edge Cache + KV Screener + Single-Source Binance/TwelveData WebSockets ----------
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
  const cm = document.querySelector(".cm");
  vtBindGapContainerDelegation(cm);
  const curBadge = document.getElementById("vt_gap_badge");
  const hasActive = typeof S !== "undefined" && S && S.chart && S.chart.sym && S.chart.tf;
  const showMain = !!(cm && hasActive && vtIsChartPaused(S.chart.sym, S.chart.tf));

  if (showMain) {
    if (!curBadge || curBadge.parentElement !== cm) {
      if (curBadge && curBadge.parentElement) curBadge.parentElement.removeChild(curBadge);
      cm.appendChild(vtMakeGapBadgeEl(S.chart.sym, S.chart.tf, "vt_gap_badge"));
    } else {
      curBadge.style.display = "flex";
      const curBtn = typeof curBadge.querySelector === "function" ? curBadge.querySelector("button") : null;
      vtSyncGapBadgeAttrs(curBadge, curBtn, S.chart.sym, S.chart.tf);
    }
  } else if (curBadge && curBadge.parentElement) {
    curBadge.parentElement.removeChild(curBadge);
  }

  const cvB = document.getElementById("cvB");
  vtBindGapContainerDelegation(cvB);
  const curBadgeB = document.getElementById("vt_gap_badge_b");
  const hasPaneB =
    hasActive &&
    typeof SC !== "undefined" &&
    SC &&
    S.pageView === "chart" &&
    S.sc &&
    S.sc.panes === 2 &&
    S.sc.tfB;
  const showPaneB = !!(cvB && hasPaneB && vtIsChartPaused(S.chart.sym, S.sc.tfB));

  if (showPaneB) {
    if (!curBadgeB || curBadgeB.parentElement !== cvB) {
      if (curBadgeB && curBadgeB.parentElement) curBadgeB.parentElement.removeChild(curBadgeB);
      cvB.appendChild(vtMakeGapBadgeEl(S.chart.sym, S.sc.tfB, "vt_gap_badge_b"));
    } else {
      curBadgeB.style.display = "flex";
      const curBtnB = typeof curBadgeB.querySelector === "function" ? curBadgeB.querySelector("button") : null;
      vtSyncGapBadgeAttrs(curBadgeB, curBtnB, S.chart.sym, S.sc.tfB);
    }
  } else if (curBadgeB && curBadgeB.parentElement) {
    curBadgeB.parentElement.removeChild(curBadgeB);
  }
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

async function vtBnDirectCandles(s, tf, limit, beforeSec) {
  try {
    if (typeof bnGet !== "function" || typeof BNI === "undefined" || !BNI[tf]) return null;
    const sym = String(s[6] || s[0] || "").toUpperCase();
    if (!/^[A-Z0-9]{2,20}$/.test(sym)) return null;
    let p = `/api/v3/klines?symbol=${sym}&interval=${BNI[tf]}&limit=${Math.max(10, Math.min(1000, limit || 1000))}`;
    if (beforeSec > 0) p += `&endTime=${beforeSec * 1000 - 1}`;
    const raw = await bnGet(p);
    if (!Array.isArray(raw)) return null;
    return raw.map((x) => ({ t: Math.floor(x[0] / 1000), o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] })).filter((x) => x.c > 0);
  } catch (_e) {
    return null;
  }
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
      const crypto = vtIsCryptoSym(s);
      // After one failed server attempt for crypto, go straight to Binance for 10 minutes.
      if (!(crypto && !replay && VT_EDGE.bnServerDownUntil > Date.now())) {
        try {
          const r = await fetch(u);
          if (r.ok) j = await r.json();
        } catch (_e) {}
        if (crypto && !replay && (!j || !j.ok)) VT_EDGE.bnServerDownUntil = Date.now() + 600000;
      }
      // Binance blocks some Cloudflare egress locations (HTTP 451/403), so if our server can't reach it,
      // load crypto candles straight from Binance in the browser (public data, no key involved).
      if (!replay && crypto && (!j || !j.ok || !Array.isArray(j.bars) || (!j.bars.length && !beforeSec))) {
        const direct = await vtBnDirectCandles(s, tf, limit, beforeSec);
        if (direct) j = { ok: true, bars: direct, source: "binance", hasMore: direct.length > 0 };
      }
      if (!j || !j.ok || !Array.isArray(j.bars)) {
        if (!replay && !beforeSec && s[0]) vtMarkFeedUnavailable(s[0], tf);
        return null;
      }
      if (beforeSec > 0 && (j.bars.length === 0 || j.hasMore === false)) {
        if (s[0] && j.bars.length === 0) {
          VT_EDGE.hasMoreHistory.set(s[0] + "|" + tf, false);
        }
        if (j.bars.length === 0) {
          if (!replay && j.source !== "simulator") {
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
      if (!replay && j.source !== "simulator") {
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
  if (!vtCanUseEdge() || !isLive() || !sym || !tf) return;
  const bni = VT_BNI[tf];
  if (!bni) return;
  const bnSym = vtToBnSym(sym);
  if (VT_EDGE.bnWs && (VT_EDGE.bnWs.readyState === 0 || VT_EDGE.bnWs.readyState === 1) && VT_EDGE.bnSym === sym && VT_EDGE.bnTf === tf) {
    return;
  }
  vtBnKlineStop();
  VT_EDGE.bnSym = sym;
  VT_EDGE.bnTf = tf;

  const stream = bnSym.toLowerCase() + "@kline_" + bni;
  try {
    const ws = new WebSocket(`wss://data-stream.binance.vision:443/ws/${stream}`);
    VT_EDGE.bnWs = ws;
    ws.onopen = () => {
      VT_EDGE.bnRetry = 0;
      markOk("bnws");
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const k = msg && msg.k;
        if (!k) return;
        const step = (typeof STEP !== "undefined" && STEP[tf]) || 3600;
        const bar = {
          t: Math.floor(Math.floor(k.t / 1000) / step) * step,
          o: +k.o,
          h: +k.h,
          l: +k.l,
          c: +k.c,
          v: +k.v || 0,
        };
        if (!(bar.o > 0 && bar.h > 0 && bar.l > 0 && bar.c > 0)) return;
        markOk("bnws");

        const key = sym + "|" + tf;
        const arr = Array.isArray(LIVE[key]) ? LIVE[key] : null;
        const last = arr && arr.length ? arr[arr.length - 1] : null;

        if (vtIsChartPaused(sym, tf)) {
          vtBackfillChart(sym, tf);
        } else if (!last) {
          if (typeof PEND === "undefined" || !PEND[key]) {
            vtSetChartGap(sym, tf, true);
            vtBackfillChart(sym, tf);
          }
        } else if (bar.t < last.t) {
          // Ignore out-of-order older klines
        } else if (bar.t - last.t > step * 2) {
          vtSetChartGap(sym, tf, true);
          vtBackfillChart(sym, tf);
        } else {
          if (last.t === bar.t) {
            arr[arr.length - 1] = bar;
          } else {
            arr.push(bar);
            if (arr.length > VT_MAX_BARS) arr.splice(0, arr.length - VT_MAX_BARS);
          }

          const row = SYMS.find((x) => x[0] === sym);
          if (row) row[2] = bar.c;
          checkAlerts(sym, bar.c);

          if (S && S.chart && S.chart.sym === sym && S.chart.tf === tf) {
            if (typeof ch !== "undefined" && ch && typeof updateLiveBar === "function") {
              updateLiveBar(sym, tf, bar.t);
            }
            const q = document.getElementById("cpx");
            if (q) q.textContent = fp(bar.c);
          }
        }

        if (typeof SC !== "undefined" && SC && SC.keyB && SC.keyB.startsWith(sym + "|") && SC.serB) {
          const tfB = (S.sc && S.sc.tfB) || "1D";
          const kB = sym + "|" + tfB;
          const stB = (typeof STEP !== "undefined" && STEP[tfB]) || 86400;
          const bktB = Math.floor(bar.t / stB) * stB;
          if (vtIsChartPaused(sym, tfB)) {
            vtBackfillChart(sym, tfB);
          } else if (LIVE[kB] && LIVE[kB].length) {
            const lb = LIVE[kB][LIVE[kB].length - 1];
            if (bktB - lb.t > stB * 2) {
              vtSetChartGap(sym, tfB, true);
              vtBackfillChart(sym, tfB);
            } else if (bktB === lb.t) {
              lb.c = bar.c;
              lb.h = Math.max(lb.h, bar.c);
              lb.l = Math.min(lb.l, bar.c);
              try { SC.serB.update({ time: lb.t, open: lb.o, high: lb.h, low: lb.l, close: lb.c }); } catch (_e) {}
            } else if (bktB > lb.t) {
              const nb = { t: bktB, o: lb.c, h: Math.max(lb.c, bar.c), l: Math.min(lb.c, bar.c), c: bar.c, v: bar.v };
              LIVE[kB].push(nb);
              try { SC.serB.update({ time: nb.t, open: nb.o, high: nb.h, low: nb.l, close: nb.c }); } catch (_e) {}
            }
          }
        }
      } catch (_err) {}
    };
    ws.onclose = () => {
      if (VT_EDGE.bnWs === ws) VT_EDGE.bnWs = null;
      if (VT_EDGE.bnSym === sym && VT_EDGE.bnTf === tf && isLive() && S && S.chart && S.chart.sym === sym) {
        const delay = vtNextBackoff(VT_EDGE.bnRetry++);
        clearTimeout(VT_EDGE.bnTimer);
        VT_EDGE.bnTimer = setTimeout(() => {
          if (S && S.chart && S.chart.sym === sym && S.chart.tf === tf) {
            vtBnKlineStart(sym, tf);
          }
        }, delay);
      }
    };
    ws.onerror = () => {
      try { ws.close(); } catch (_e) {}
    };
  } catch (_e) {}
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
      if (q) q.textContent = fp(price);
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

  // TASK-02: no browser WebSocket to Twelve Data (that needed the key). Poll the latest price
  // through our vektor-market Worker instead; it caches each symbol and enforces the plan limits.
  if (VT_EDGE.tdActiveSym !== sym || !isLive()) return;
  clearInterval(VT_EDGE.tdHb);
  const vtTdPoll = async () => {
    if (VT_EDGE.tdActiveSym !== sym || !isLive() || document.hidden) return;
    try {
      const r = await fetch(`/api/quote?symbols=${encodeURIComponent(sym)}`);
      const d = await r.json();
      if (VT_EDGE.tdActiveSym !== sym || !d || !(Number(d.price) > 0)) return;
      markOk("tdws");
      vtApplyTwelveDataTick(sym, Number(d.price), Math.floor(Date.now() / 1000));
    } catch (_e) {}
  };
  vtTdPoll();
  VT_EDGE.tdHb = setInterval(vtTdPoll, 60000);
}

function vtSyncChartFeed(sym, tf) {
  if (!vtCanUseEdge() || !isLive() || !sym) return;
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
