// ---------- 13 server indicators: render-only store for server-computed chart series (Tasks 9-11) ----------
// The browser never computes indicator values (AGENTS.md §0). `/api/candles?ind=` returns the series with the bars in
// one request (shared/market/chartIndicators.js); the hub's `ind` WS frames add each closed bar's value. This module
// only maps UI indicator descriptors to server spec ids, keeps the server's points keyed by bar time, and hands them
// to LightweightCharts.

const VT_IND = new Map(); // "SYM|TF" -> Map(specId -> Map(t -> number | {upper, middle, lower}))
const VT_IND_MAX_KEYS = 16;
const VT_IND_FETCH = new Set(); // "SYM|TF|specs" fetches in flight
const VT_IND_LINE = new Set(["ema", "sma", "rsi", "atr"]);

/** Server spec id for a UI indicator descriptor ({t, len}); null when it has no server series (vol renders raw volume). */
function vtIndSpec(d) {
  if (!d || !d.t) return null;
  const len = Math.floor(Number(d.len));
  if (!(len >= 1 && len <= 1000)) return null;
  if (VT_IND_LINE.has(d.t)) return d.t + ":" + len;
  if (d.t === "bb") return "bb:" + len + ":2";
  return null;
}

/** Unique spec ids for the chart's indicator list (hidden ones included, so toggling visibility never refetches). */
function vtChartIndSpecs() {
  const out = [];
  const list = typeof S !== "undefined" && S && S.chart && Array.isArray(S.chart.ind) ? S.chart.ind : [];
  for (const d of list) {
    const id = vtIndSpec(d);
    if (id && !out.includes(id)) out.push(id);
  }
  return out.slice(0, 24);
}

/** True when `sym|tf` is rendered by the main chart or the split pane, i.e. its history should carry indicators. */
function vtWantsInd(sym, tf) {
  if (typeof S === "undefined" || !S || !S.chart || S.chart.sym !== sym) return false;
  if (S.chart.tf === tf) return true;
  return !!(S.pageView === "chart" && S.sc && S.sc.panes === 2 && S.sc.tfB === tf);
}

function vtIndBucket(sym, tf) {
  const k = sym + "|" + tf;
  let byId = VT_IND.get(k);
  if (!byId) {
    if (VT_IND.size >= VT_IND_MAX_KEYS) {
      for (const key of VT_IND.keys()) {
        if (!vtWantsInd(...key.split("|"))) { VT_IND.delete(key); break; }
      }
    }
    byId = new Map();
    VT_IND.set(k, byId);
  }
  return byId;
}

/** Store a `/api/candles` (or protocol `state.chart`) `ind` object: {id: {type, points} | {type:"bb", upper, middle, lower}}. */
function vtStoreServerInd(sym, tf, ind) {
  if (!sym || !tf || !ind || typeof ind !== "object") return;
  const byId = vtIndBucket(sym, tf);
  for (const id of Object.keys(ind)) {
    const s = ind[id];
    if (!s || typeof s !== "object") continue;
    let pts = byId.get(id);
    if (!pts) { pts = new Map(); byId.set(id, pts); }
    if (s.type === "bb") {
      const mid = new Map((s.middle || []).map((p) => [p.t, p.v]));
      const low = new Map((s.lower || []).map((p) => [p.t, p.v]));
      for (const p of s.upper || []) {
        if (low.has(p.t)) pts.set(p.t, { upper: p.v, middle: mid.get(p.t), lower: low.get(p.t) });
      }
    } else {
      for (const p of s.points || []) pts.set(p.t, p.v);
    }
  }
}

function vtIndPoints(sym, tf, id) {
  const byId = VT_IND.get(sym + "|" + tf);
  return byId ? byId.get(id) || null : null;
}

/** Spec ids the chart needs for `sym|tf` that the store has no series for yet. */
function vtIndMissing(sym, tf) {
  const byId = VT_IND.get(sym + "|" + tf);
  return vtChartIndSpecs().filter((id) => !byId || !byId.has(id));
}

/** Server values aligned to `bars` by time (null where the server sent none). For bb: {upper:[], lower:[]}. */
function vtIndAligned(sym, tf, d, bars) {
  const id = vtIndSpec(d);
  const pts = id ? vtIndPoints(sym, tf, id) : null;
  const n = Array.isArray(bars) ? bars.length : 0;
  if (d && d.t === "bb") {
    const upper = new Array(n).fill(null), lower = new Array(n).fill(null);
    if (pts) for (let i = 0; i < n; i++) { const v = pts.get(bars[i].t); if (v) { upper[i] = v.upper; lower[i] = v.lower; } }
    return { upper, lower };
  }
  const out = new Array(n).fill(null);
  if (pts) for (let i = 0; i < n; i++) { const v = pts.get(bars[i].t); if (typeof v === "number") out[i] = v; }
  return out;
}

/** LightweightCharts data for a descriptor over `bars`: [{time, value}] lines, or {upper, lower} for Bollinger bands. */
function vtIndSeriesData(sym, tf, d, bars) {
  const al = vtIndAligned(sym, tf, d, bars);
  const toPts = (arr) => {
    const out = [];
    for (let i = 0; i < arr.length; i++) if (arr[i] != null && isFinite(arr[i])) out.push({ time: bars[i].t, value: arr[i] });
    return out;
  };
  return d && d.t === "bb" ? { upper: toPts(al.upper), lower: toPts(al.lower) } : toPts(al);
}

/** Latest server value for a descriptor (number, or the bb object), or null. */
function vtIndLast(sym, tf, d) {
  const id = vtIndSpec(d);
  const pts = id ? vtIndPoints(sym, tf, id) : null;
  if (!pts || !pts.size) return null;
  let bestT = -Infinity, best = null;
  for (const [t, v] of pts) if (t > bestT) { bestT = t; best = v; }
  return best;
}

/** `&ind=` query fragment for a history request of `sym|tf` (empty when that chart shows no server indicators). */
function vtIndQuery(sym, tf) {
  if (!vtWantsInd(sym, tf)) return "";
  const specs = vtChartIndSpecs();
  return specs.length ? "&ind=" + encodeURIComponent(specs.join(",")) : "";
}

/**
 * The chart asked for indicators the store lacks (an indicator was added, or the history predates it): fetch the same
 * one-request history+indicators payload and redraw. Server bars win; older paged bars are kept in front.
 */
async function vtEnsureChartInd(sym, tf) {
  if (typeof vtCanUseEdge !== "function" || !vtCanUseEdge() || typeof isLive !== "function" || !isLive()) return;
  const missing = vtIndMissing(sym, tf);
  if (!missing.length) return;
  const key = sym + "|" + tf + "|" + vtChartIndSpecs().join(",");
  if (VT_IND_FETCH.has(key)) return;
  VT_IND_FETCH.add(key);
  try {
    const s = typeof symOf === "function" ? symOf(sym) : null;
    if (!s) return;
    const bars = await edgeFetchCandles(s, tf);
    if (!bars || !bars.length) return;
    vtSetServerBars(sym + "|" + tf, bars);
    if (vtIndMissing(sym, tf).length) return; // server sent no series for them: do not redraw into another fetch
    if (S.chart.sym === sym && S.chart.tf === tf && typeof drawChart === "function") drawChart();
    else if (vtWantsInd(sym, tf) && typeof scPaneB === "function") scPaneB();
  } catch (e) {
    console.error("vtEnsureChartInd error:", e);
  } finally {
    VT_IND_FETCH.delete(key);
  }
}

/** Apply one hub `ind` frame point ({t, v}) for a closed bar and update the rendered series in place. */
function vtApplyServerIndPoint(sym, tf, id, point) {
  if (!sym || !tf || !id || !point || !(point.t > 0) || point.v == null) return;
  const byId = VT_IND.get(sym + "|" + tf);
  if (!byId || !byId.has(id)) return; // no history for this spec yet: the next history fetch carries it
  byId.get(id).set(point.t, point.v);
  if (typeof vtChartMeta === "undefined" || !vtChartMeta || vtChartMeta.sym !== sym || vtChartMeta.tf !== tf) return;
  const v = point.v;
  const put = (ser, value) => {
    if (!ser || typeof value !== "number" || !isFinite(value)) return;
    try { ser.update({ time: point.t, value }); } catch (_e) { /* older than the series' last point: next redraw has it */ }
  };
  for (const item of vtChartMeta.indSeries || []) {
    if (vtIndSpec(item.d) !== id) continue;
    if (item.kind === "bb" && v && typeof v === "object") { put(item.sers[0], v.upper); put(item.sers[1], v.lower); }
    else if (item.kind !== "vol") put(item.ser, v);
  }
  if (vtChartMeta.rsiSer && vtChartMeta.rsiId === id) put(vtChartMeta.rsiSer, v);
  vtRefreshIndLegend(sym, tf);
}

/** Update the legend's value cells from the store (no recomputation). */
function vtRefreshIndLegend(sym, tf) {
  if (typeof document === "undefined" || !S || !S.chart) return;
  const box = document.getElementById("vt_ind_legend");
  if (!box) return;
  const s = typeof symOf === "function" ? symOf(sym) : null;
  for (const d of S.chart.ind) {
    const row = box.querySelector(`.vt-ind-row[data-indid="${CSS.escape(String(d.id))}"] .vt-ind-val`);
    if (row) row.textContent = vtIndLabel(sym, tf, d, s);
  }
}

/** Formatted last value for the legend (RSI one decimal, prices in instrument precision). */
function vtIndLabel(sym, tf, d, s) {
  if (!d || (d.t !== "ema" && d.t !== "sma" && d.t !== "rsi")) return "";
  const v = vtIndLast(sym, tf, d);
  if (typeof v !== "number" || !isFinite(v)) return "";
  return d.t === "rsi" ? v.toFixed(1) : (typeof fp === "function" ? fp(v, s || sym) : String(v));
}
