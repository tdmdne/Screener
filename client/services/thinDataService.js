// client/services/thinDataService.js — Render-only Protocol v2 transport.
// Same-origin HTTP (/api/bootstrap, /api/bars), single /ws with backoff + jitter,
// auto-replay of hello{v:2} + latest view, /api/sse fallback, and rAF frame batching.
// Zero client-side market maths, zero bar cleaning, zero client market caches.

import {
  PROTOCOL_VERSION,
  PROVENANCE,
  SERVER_TYPES,
  validateClientMessage,
  validateServerFrame,
} from "../../shared/protocol.js";

const VALID_FRAME_TYPES = new Set(SERVER_TYPES);
const PROVENANCE_VALUES = new Set(Object.values(PROVENANCE));
const HTTP_SCHEMES = new Set(["http:", "https:"]);
const WS_SCHEMES = new Set(["ws:", "wss:"]);
const VALID_TF_SET = new Set([
  "1m", "5m", "15m", "30m",
  "1h", "4h", "1d", "1w",
  "1H", "4H", "1D", "1W", "1M",
]);
const SYMBOL_RE = /^[A-Z0-9.=^/-]{1,24}$/i;
const CONTROL_OR_SPACE_RE = /[\u0000-\u0020\u007f]/;
const SENTINEL_ORIGIN = ["https:", "", "same-origin.invalid"].join("/");

const MAX_PENDING_BARS = 256;
const MAX_PENDING_QUOTES = 512;
const DEFAULT_RESYNC_THROTTLE_MS = 2000;

let fallbackJitterCounter = 0;

function cryptoUnitFloat() {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0] / 4294967296;
  }
  fallbackJitterCounter = (fallbackJitterCounter + 1) % 16;
  return (fallbackJitterCounter + 0.5) / 16;
}

function makeOriginError(message) {
  const err = new Error(message);
  err.code = "CROSS_ORIGIN_BLOCKED";
  return err;
}

function getPageOrigin() {
  return typeof globalThis.location === "object" &&
    globalThis.location &&
    typeof globalThis.location.origin === "string" &&
    globalThis.location.origin !== "null"
    ? globalThis.location.origin.trim()
    : "";
}

function normalizeOrigin(rawOrigin, fallbackOrigin = getPageOrigin()) {
  const fallback = typeof fallbackOrigin === "string" ? fallbackOrigin.trim() : "";
  const rawStr = rawOrigin === undefined || rawOrigin === null ? "" : String(rawOrigin).trim();
  // Never allow an empty string to override a valid page/fallback origin.
  const chosen = rawStr || fallback;
  if (!chosen) return "";
  if (CONTROL_OR_SPACE_RE.test(chosen)) {
    throw makeOriginError(`Invalid origin: ${chosen}`);
  }

  let parsed;
  try {
    parsed = new URL(chosen);
  } catch {
    throw makeOriginError(`Invalid origin: ${chosen}`);
  }
  if (!HTTP_SCHEMES.has(parsed.protocol)) {
    throw makeOriginError(`Unsupported origin protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw makeOriginError(`Origin must not include credentials: ${chosen}`);
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw makeOriginError(`Origin must not include a path: ${chosen}`);
  }
  if (parsed.search || parsed.hash) {
    throw makeOriginError(`Origin must not include query or hash: ${chosen}`);
  }
  // If running in a real browser window with an established origin, refuse a foreign origin.
  if (fallback && parsed.origin !== fallback) {
    throw makeOriginError(`Configured origin (${parsed.origin}) does not match page origin (${fallback})`);
  }
  return parsed.origin;
}

/**
 * Validates that `target` resolves strictly to `expectedOrigin` (or relative root path when
 * `expectedOrigin` is empty). Rejects control characters, whitespace, embedded credentials,
 * protocol-relative URLs, backslashes, non-HTTP(S)/WS(S) schemes, and any cross-origin host or port.
 *
 * @param {string} target
 * @param {string} expectedOrigin
 * @param {{ ws?: boolean }} [opts]
 * @returns {string}
 */
export function assertSameOrigin(target, expectedOrigin, { ws = false } = {}) {
  if (typeof target !== "string" || target.length === 0) {
    throw makeOriginError("URL must be a non-empty string");
  }
  if (CONTROL_OR_SPACE_RE.test(target)) {
    throw makeOriginError(`URL contains forbidden control or whitespace characters: ${JSON.stringify(target)}`);
  }

  // Reject protocol-relative URLs and backslashes unconditionally.
  if (target.startsWith("//") || target.includes("\\")) {
    throw makeOriginError(`Cross-origin or unsafe URL rejected: ${target}`);
  }

  const hasScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target);
  if (!expectedOrigin) {
    if (hasScheme) {
      throw makeOriginError(`Absolute URL rejected without matching origin: ${target}`);
    }
    if (!target.startsWith("/")) {
      throw makeOriginError(`Relative path must start with '/': ${target}`);
    }
    let parsed;
    try {
      parsed = new URL(target, SENTINEL_ORIGIN);
    } catch {
      throw makeOriginError(`Malformed relative URL rejected: ${target}`);
    }
    if (parsed.origin !== SENTINEL_ORIGIN || parsed.username || parsed.password) {
      throw makeOriginError(`Cross-origin or unsafe relative URL rejected: ${target}`);
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  let base;
  try {
    base = new URL(expectedOrigin);
  } catch {
    throw makeOriginError(`Invalid expected origin: ${expectedOrigin}`);
  }
  if (!HTTP_SCHEMES.has(base.protocol) || base.username || base.password) {
    throw makeOriginError(`Unsafe expected origin rejected: ${expectedOrigin}`);
  }

  let parsed;
  try {
    parsed = hasScheme ? new URL(target) : new URL(target, base);
  } catch {
    throw makeOriginError(`Malformed URL rejected: ${target}`);
  }

  if (parsed.username || parsed.password) {
    throw makeOriginError(`URL with embedded credentials rejected: ${target}`);
  }

  if (ws) {
    const expectedWsProto = base.protocol === "https:" ? "wss:" : "ws:";
    if (WS_SCHEMES.has(parsed.protocol)) {
      if (parsed.protocol !== expectedWsProto || parsed.host !== base.host) {
        throw makeOriginError(`Cross-origin WebSocket URL rejected: ${target}`);
      }
      return parsed.toString();
    }
    if (HTTP_SCHEMES.has(parsed.protocol)) {
      if (parsed.origin !== base.origin) {
        throw makeOriginError(`Cross-origin WebSocket URL rejected: ${target}`);
      }
      return `${expectedWsProto}//${base.host}${parsed.pathname}${parsed.search}`;
    }
    throw makeOriginError(`Unsupported WebSocket protocol rejected: ${parsed.protocol}`);
  }

  if (!HTTP_SCHEMES.has(parsed.protocol) || parsed.origin !== base.origin) {
    throw makeOriginError(`Cross-origin URL rejected: ${target}`);
  }
  return parsed.toString();
}

function assertSameOriginApiPath(target, expectedOrigin) {
  const checked = assertSameOrigin(target, expectedOrigin);
  const base = expectedOrigin || SENTINEL_ORIGIN;
  const parsed = new URL(checked, base);
  if (!parsed.pathname.startsWith("/api/")) {
    throw makeOriginError(`Bootstrap endpoint must be under /api/: ${target}`);
  }
  return checked;
}

function upperSym(sym) {
  return String(sym ?? "").trim().toUpperCase();
}

function normalizeViewPayload(view) {
  if (!view || typeof view !== "object" || Array.isArray(view)) {
    throw new Error("view must be an object");
  }
  const msg = { op: "view" };
  if (view.chart !== undefined) {
    if (view.chart === null) {
      msg.chart = null;
    } else if (typeof view.chart === "object") {
      const ch = {
        sym: upperSym(view.chart.sym),
        tf: String(view.chart.tf ?? "").trim(),
      };
      if (view.chart.ind !== undefined) ch.ind = view.chart.ind;
      if (view.chart.vs !== undefined) ch.vs = view.chart.vs;
      msg.chart = ch;
    } else {
      msg.chart = view.chart;
    }
  }
  if (view.watchlist !== undefined) {
    msg.watchlist = Array.isArray(view.watchlist)
      ? view.watchlist.map(upperSym).filter(Boolean)
      : view.watchlist;
  }
  if (view.screener !== undefined) {
    msg.screener = view.screener === null ? null : { ...view.screener };
  }
  if (view.heatmap !== undefined) {
    msg.heatmap = view.heatmap === null ? null : { ...view.heatmap };
  }
  return msg;
}

function mergeViewState(prev, nextMsg) {
  const merged = prev ? { ...prev } : { op: "view" };
  if (nextMsg.chart !== undefined) merged.chart = nextMsg.chart;
  if (nextMsg.watchlist !== undefined) merged.watchlist = nextMsg.watchlist;
  if (nextMsg.screener !== undefined) merged.screener = nextMsg.screener;
  if (nextMsg.heatmap !== undefined) merged.heatmap = nextMsg.heatmap;
  return merged;
}

function buildViewQuery(view) {
  const params = new URLSearchParams();
  if (!view || typeof view !== "object") return params;

  if (view.chart && typeof view.chart === "object") {
    const sym = upperSym(view.chart.sym);
    const tf = String(view.chart.tf ?? "").trim();
    if (sym && tf) params.set("chart", `${sym}:${tf}`);
    if (Array.isArray(view.chart.ind) && view.chart.ind.length) {
      for (const item of view.chart.ind) {
        params.append("ind", typeof item === "string" ? item : JSON.stringify(item));
      }
    }
    if (Array.isArray(view.chart.vs) && view.chart.vs.length) {
      for (const id of view.chart.vs) {
        params.append("vs", String(id));
      }
    }
  }

  if (Array.isArray(view.watchlist) && view.watchlist.length) {
    const wl = view.watchlist.map(upperSym).filter(Boolean);
    if (wl.length) params.set("wl", wl.join(","));
  }

  if (view.screener && typeof view.screener === "object") {
    if (view.screener.preset) params.set("preset", String(view.screener.preset));
    if (view.screener.page != null) params.set("page", String(view.screener.page));
    if (view.screener.evcTf) params.set("evcTf", String(view.screener.evcTf));
    if (view.screener.dir) params.set("dir", String(view.screener.dir));
    if (view.screener.market) params.set("market", String(view.screener.market));
    if (view.screener.query) params.set("query", String(view.screener.query));
    if (view.screener.pageSize != null) params.set("pageSize", String(view.screener.pageSize));
  }

  if (view.heatmap && typeof view.heatmap === "object") {
    if (view.heatmap.metric) params.set("hmMetric", String(view.heatmap.metric));
    if (view.heatmap.tf) params.set("hmTf", String(view.heatmap.tf));
    if (view.heatmap.n != null) params.set("hmN", String(view.heatmap.n));
    if (view.heatmap.size) params.set("hmSize", String(view.heatmap.size));
    if (view.heatmap.market) params.set("hmMarket", String(view.heatmap.market));
  }

  return params;
}

function getBarTimestamp(bar) {
  if (Array.isArray(bar)) return bar[0];
  if (bar && typeof bar === "object") return bar.t;
  return null;
}

function setBounded(map, key, value, maxEntries) {
  if (map.has(key)) {
    map.delete(key);
  } else if (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, value);
}

/**
 * Creates a render-only Protocol v2 transport bound strictly to a single origin.
 *
 * @param {{
 *   origin?: string,
 *   WebSocket?: typeof WebSocket,
 *   EventSource?: typeof EventSource,
 *   fetch?: typeof fetch,
 *   raf?: (cb: FrameRequestCallback) => number,
 *   caf?: (id: number) => void,
 *   session?: string,
 *   maxWsFails?: number,
 *   baseBackoffMs?: number,
 *   maxBackoffMs?: number,
 *   jitterMs?: number,
 *   jitterFn?: () => number,
 *   resyncThrottleMs?: number,
 *   now?: () => number,
 *   setTimer?: typeof setTimeout,
 *   clearTimer?: typeof clearTimeout,
 * }} [opts]
 */
export function createThinDataService(opts = {}) {
  const origin = normalizeOrigin(opts.origin);
  const WS = opts.WebSocket !== undefined ? opts.WebSocket : (typeof WebSocket !== "undefined" ? WebSocket : null);
  const ES = opts.EventSource !== undefined ? opts.EventSource : (typeof EventSource !== "undefined" ? EventSource : null);
  const doFetch = opts.fetch || ((...args) => fetch(...args));
  const R =
    opts.raf ||
    (typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (fn) => setTimeout(() => fn(Date.now()), 16));
  const C =
    opts.caf ||
    (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout);
  const setTimer = opts.setTimer || setTimeout;
  const clearTimer = opts.clearTimer || clearTimeout;
  const jitterFn = typeof opts.jitterFn === "function" ? opts.jitterFn : cryptoUnitFloat;
  const nowFn = typeof opts.now === "function" ? opts.now : () => Date.now();

  const maxWsFails = Number.isInteger(opts.maxWsFails) && opts.maxWsFails >= 1 ? opts.maxWsFails : 3;
  const baseBackoffMs = Number.isFinite(opts.baseBackoffMs) && opts.baseBackoffMs >= 0 ? opts.baseBackoffMs : 500;
  const maxBackoffMs = Number.isFinite(opts.maxBackoffMs) && opts.maxBackoffMs >= baseBackoffMs ? opts.maxBackoffMs : 30000;
  const jitterMs = Number.isFinite(opts.jitterMs) && opts.jitterMs >= 0 ? opts.jitterMs : 250;
  const resyncThrottleMs =
    Number.isFinite(opts.resyncThrottleMs) && opts.resyncThrottleMs >= 0
      ? opts.resyncThrottleMs
      : DEFAULT_RESYNC_THROTTLE_MS;
  const sessionToken = typeof opts.session === "string" && opts.session.trim() ? opts.session.trim() : undefined;

  /** @type {Map<string, Set<(frame: object) => void>>} */
  const listeners = new Map();
  for (const t of VALID_FRAME_TYPES) listeners.set(t, new Set());

  let ws = null;
  let es = null;
  let reconnectTimer = null;
  let retryAttempt = 0;
  let wsFails = 0;
  let closed = false;
  let lastSeq = -1;
  let lastResyncAt = -Infinity;
  let latestView = null;

  let currentStatus = {
    provenance: PROVENANCE.UNAVAILABLE,
    asOf: null,
    transport: "idle",
    detail: null,
    sym: null,
  };

  // rAF batching state for high-frequency `bar` and `quotes` frames only.
  let rafHandle = null;
  /** @type {Map<string, object>} */
  const pendingBars = new Map();
  /** @type {Map<string, object>} */
  const pendingQuotes = new Map();
  let latestQuoteFrameMeta = null;

  function emit(type, frame) {
    const subs = listeners.get(type);
    if (!subs || subs.size === 0) return;
    for (const cb of subs) {
      try {
        cb(frame);
      } catch (err) {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error(err);
        }
      }
    }
  }

  function updateProvenance(prov, asOf, extra = {}) {
    if (!PROVENANCE_VALUES.has(prov)) return;
    currentStatus = {
      ...currentStatus,
      provenance: prov,
      asOf: typeof asOf === "number" && Number.isFinite(asOf) ? asOf : currentStatus.asOf,
      detail: extra.detail !== undefined ? extra.detail : currentStatus.detail,
      sym: extra.sym !== undefined ? extra.sym : currentStatus.sym,
    };
  }

  function setTransport(transport) {
    if (currentStatus.transport !== transport) {
      currentStatus = { ...currentStatus, transport };
    }
  }

  function flushBatchedFrames() {
    rafHandle = null;

    if (pendingBars.size > 0) {
      const barsToEmit = [...pendingBars.values()];
      pendingBars.clear();
      for (const frame of barsToEmit) {
        emit("bar", frame);
      }
    }

    if (pendingQuotes.size > 0 && latestQuoteFrameMeta) {
      const coalesced = [...pendingQuotes.values()];
      const meta = latestQuoteFrameMeta;
      pendingQuotes.clear();
      latestQuoteFrameMeta = null;
      emit("quotes", {
        v: meta.v,
        seq: meta.seq,
        type: "quotes",
        quotes: coalesced,
      });
    }
  }

  function scheduleFlush() {
    if (rafHandle === null) {
      rafHandle = R(flushBatchedFrames);
    }
  }

  function clearPendingBatches() {
    if (rafHandle !== null) {
      C(rafHandle);
      rafHandle = null;
    }
    pendingBars.clear();
    pendingQuotes.clear();
    latestQuoteFrameMeta = null;
  }

  function sendJson(obj) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function replayHelloAndView() {
    const helloMsg = { op: "hello", v: PROTOCOL_VERSION };
    if (sessionToken) helloMsg.session = sessionToken;
    const hCheck = validateClientMessage(helloMsg);
    if (!hCheck.ok) {
      throw new Error(`Invalid hello message: ${hCheck.error}`);
    }
    sendJson(helloMsg);
    if (latestView) {
      sendJson(latestView);
    }
  }

  function processValidatedFrame(frame, { enforceSeq = true } = {}) {
    // Protocol v2 §2: pong does not advance lastSeq.
    if (frame.type !== "pong" && enforceSeq) {
      if (lastSeq >= 0 && frame.seq <= lastSeq) {
        return null;
      }
      const hasGap = lastSeq >= 0 && frame.seq > lastSeq + 1;
      lastSeq = frame.seq;
      if (hasGap && latestView && ws && ws.readyState === 1) {
        const now = nowFn();
        if (now - lastResyncAt >= resyncThrottleMs) {
          lastResyncAt = now;
          sendJson(latestView);
        }
      }
    } else if (frame.type !== "pong" && frame.seq > lastSeq) {
      lastSeq = frame.seq;
    }

    if (frame.type === "state") {
      // Drop stale queued deltas before emitting full authoritative state.
      clearPendingBatches();
      updateProvenance(frame.status.provenance, frame.status.asOf, {
        detail: frame.status.detail ?? null,
        sym: frame.status.sym ?? null,
      });
      emit("state", frame);
      return frame;
    }

    if (frame.type === "status") {
      updateProvenance(frame.provenance, frame.asOf, {
        detail: frame.detail ?? null,
        sym: frame.sym ?? null,
      });
      emit("status", frame);
      return frame;
    }

    if (frame.type === "bar") {
      if (frame.provenance) {
        updateProvenance(frame.provenance, frame.asOf);
      }
      const barT = getBarTimestamp(frame.bar);
      const key = `${frame.sym}|${frame.tf}|${barT}`;
      setBounded(pendingBars, key, frame, MAX_PENDING_BARS);
      scheduleFlush();
      return frame;
    }

    if (frame.type === "quotes") {
      for (const q of frame.quotes) {
        setBounded(pendingQuotes, q.s, q, MAX_PENDING_QUOTES);
      }
      latestQuoteFrameMeta = { v: frame.v, seq: frame.seq };
      scheduleFlush();
      return frame;
    }

    emit(frame.type, frame);
    return frame;
  }

  function handleInboundFrame(raw, { enforceSeq = true } = {}) {
    const check = validateServerFrame(raw, { enforceBudget: false });
    if (!check.ok) {
      emit("error", {
        v: PROTOCOL_VERSION,
        seq: Math.max(0, lastSeq),
        type: "error",
        code: check.code,
        message: check.error,
        fatal: false,
      });
      return null;
    }
    return processValidatedFrame(check.value, { enforceSeq });
  }

  function scheduleReconnect(connectFn) {
    if (closed) return;
    clearTimer(reconnectTimer);
    const exp = Math.min(maxBackoffMs, baseBackoffMs * Math.pow(2, retryAttempt));
    retryAttempt += 1;
    const rawJitter = Number(jitterFn());
    const bounded = Number.isFinite(rawJitter) ? Math.min(1, Math.max(0, rawJitter)) : 0;
    const delay = Math.round(exp + bounded * jitterMs);
    setTransport("reconnecting");
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      if (!closed) connectFn();
    }, delay);
  }

  function buildWsEndpoint() {
    return assertSameOrigin("/ws", origin, { ws: true });
  }

  function buildSseEndpoint() {
    const params = buildViewQuery(latestView);
    const qs = params.toString();
    const path = qs ? `/api/sse?${qs}` : "/api/sse";
    return assertSameOrigin(path, origin);
  }

  function connectSse() {
    if (closed || !ES) return;
    if (es) {
      es.onopen = es.onmessage = es.onerror = null;
      try {
        es.close();
      } catch {
        // ignore close errors
      }
      es = null;
    }

    const url = buildSseEndpoint();
    setTransport("connecting");
    try {
      es = new ES(url);
    } catch {
      scheduleReconnect(connectSse);
      return;
    }

    es.onopen = () => {
      retryAttempt = 0;
      lastSeq = -1;
      lastResyncAt = -Infinity;
      setTransport("sse");
    };
    es.onmessage = (ev) => {
      try {
        handleInboundFrame(ev.data, { enforceSeq: true });
      } catch {
        // handled inside handleInboundFrame
      }
    };
    es.onerror = () => {
      if (!es) return;
      const dead = es;
      es = null;
      dead.onopen = dead.onmessage = dead.onerror = null;
      try {
        dead.close();
      } catch {
        // ignore
      }
      scheduleReconnect(connectSse);
    };
  }

  function failWs() {
    if (closed) return;
    wsFails += 1;
    if (wsFails >= maxWsFails && ES) {
      connectSse();
      return;
    }
    scheduleReconnect(connectWs);
  }

  function connectWs() {
    if (closed) return;
    if (!WS) {
      connectSse();
      return;
    }
    const url = buildWsEndpoint();
    setTransport("connecting");

    let sock;
    try {
      sock = new WS(url);
    } catch {
      failWs();
      return;
    }
    ws = sock;

    sock.onopen = () => {
      if (ws !== sock) return;
      wsFails = 0;
      retryAttempt = 0;
      lastSeq = -1;
      lastResyncAt = -Infinity;
      setTransport("ws");
      replayHelloAndView();
    };
    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      handleInboundFrame(ev.data, { enforceSeq: true });
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
      failWs();
    };
    sock.onerror = () => {
      if (ws !== sock) return;
      ws = null;
      sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
      try {
        sock.close();
      } catch {
        // ignore
      }
      failWs();
    };
  }

  async function sameOriginGetJson(pathOrUrl) {
    const url = assertSameOrigin(pathOrUrl, origin);
    const res = await doFetch(url, {
      method: "GET",
      credentials: "same-origin",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (res && typeof res.url === "string" && res.url.length > 0) {
      assertSameOrigin(res.url, origin);
    }
    if (!res || !res.ok) {
      const code = res ? res.status : 0;
      throw new Error(`HTTP ${code} for ${url}`);
    }
    return res.json();
  }

  return {
    origin,

    assertSameOrigin(url, checkOpts) {
      return assertSameOrigin(url, origin, checkOpts);
    },

    /**
     * Fetches one server-computed Protocol v2 `state` frame via same-origin `GET /api/bootstrap`.
     * @param {object} [view]
     */
    async bootstrap(view = {}) {
      let basePath = "/api/bootstrap";
      if (view && view.endpoint !== undefined && view.endpoint !== null) {
        assertSameOriginApiPath(view.endpoint, origin);
        basePath = view.endpoint;
      }
      if (view && view.url !== undefined && view.url !== null) {
        assertSameOriginApiPath(view.url, origin);
        if (view.endpoint === undefined || view.endpoint === null) {
          basePath = view.url;
        }
      }

      const hasViewSection =
        view &&
        typeof view === "object" &&
        (view.chart !== undefined ||
          view.watchlist !== undefined ||
          view.screener !== undefined ||
          view.heatmap !== undefined);

      let pendingView = null;
      if (hasViewSection) {
        const normalized = normalizeViewPayload(view);
        const check = validateClientMessage(normalized);
        if (!check.ok) {
          throw new Error(`Invalid bootstrap view: ${check.error}`);
        }
        pendingView = normalized;
      }

      const params = buildViewQuery(view);
      const qs = params.toString();
      const target = qs ? `${basePath}${basePath.includes("?") ? "&" : "?"}${qs}` : basePath;
      assertSameOriginApiPath(target, origin);

      const payload = await sameOriginGetJson(target);
      const check = validateServerFrame(payload, { enforceBudget: false });
      if (!check.ok || check.value.type !== "state") {
        const reason = check.ok ? `expected state frame, got ${check.value.type}` : check.error;
        throw new Error(`Invalid bootstrap state frame: ${reason}`);
      }

      if (pendingView) {
        latestView = mergeViewState(latestView, pendingView);
      }
      processValidatedFrame(check.value, { enforceSeq: false });
      return check.value;
    },

    /**
     * Fetches server-merged historical bars via same-origin `GET /api/bars`.
     * @param {string} sym
     * @param {string} tf
     * @param {number|string} [before]
     * @param {number} [limit]
     */
    async loadMoreBars(sym, tf, before, limit) {
      const rawSym = String(sym ?? "").trim();
      if (!rawSym) throw new Error("loadMoreBars requires a symbol");
      if (
        CONTROL_OR_SPACE_RE.test(rawSym) ||
        /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawSym) ||
        rawSym.startsWith("//") ||
        rawSym.includes("\\")
      ) {
        throw makeOriginError(`Invalid symbol parameter: ${rawSym}`);
      }
      const symbol = rawSym.toUpperCase();
      if (!SYMBOL_RE.test(symbol) || symbol.includes("..") || symbol.startsWith("/") || symbol.endsWith("/")) {
        throw new Error(`Invalid symbol parameter: ${symbol}`);
      }

      const timeframe = String(tf ?? "").trim();
      if (!VALID_TF_SET.has(timeframe)) {
        throw new Error(`Invalid timeframe parameter: ${timeframe}`);
      }

      const params = new URLSearchParams();
      params.set("sym", symbol);
      params.set("tf", timeframe);
      if (before !== undefined && before !== null && before !== "") {
        const beforeNum = Number(before);
        if (!Number.isFinite(beforeNum) || beforeNum <= 0) {
          throw new Error(`Invalid before parameter: ${String(before)}`);
        }
        params.set("before", String(beforeNum));
      }
      if (limit !== undefined && limit !== null) {
        const limitNum = Number(limit);
        if (limit === "" || !Number.isSafeInteger(limitNum) || limitNum <= 0) {
          throw new Error(`Invalid limit parameter: ${String(limit)}`);
        }
        params.set("limit", String(limitNum));
      }

      return sameOriginGetJson(`/api/bars?${params.toString()}`);
    },

    /**
     * Opens the single shared `/ws` connection (with `/api/sse` fallback). Idempotent.
     */
    connect() {
      if (ws || es) return;
      closed = false;
      wsFails = 0;
      retryAttempt = 0;
      lastSeq = -1;
      lastResyncAt = -Infinity;
      clearTimer(reconnectTimer);
      reconnectTimer = null;
      connectWs();
    },

    /**
     * Sends a declarative Protocol v2 `view` op over `/ws` (and stores it for reconnect replay).
     * @param {object} view
     */
    setView(view) {
      const msg = normalizeViewPayload(view);
      const check = validateClientMessage(msg);
      if (!check.ok) {
        const err = new Error(`Invalid view: ${check.error}`);
        err.code = check.code;
        throw err;
      }
      latestView = mergeViewState(latestView, msg);
      if (ws && ws.readyState === 1) {
        sendJson(msg);
      } else if (es && !ws) {
        connectSse();
      }
      return msg;
    },

    /**
     * Sends a Protocol v2 heartbeat ping over `/ws`.
     */
    ping() {
      return sendJson({ op: "ping", t: Date.now() });
    },

    /**
     * Subscribes to validated Protocol v2 server frames.
     * High-frequency `bar` and `quotes` frames are coalesced per animation frame.
     * @param {string} frameType
     * @param {(frame: object) => void} cb
     * @returns {() => void}
     */
    on(frameType, cb) {
      if (!VALID_FRAME_TYPES.has(frameType)) {
        throw new Error(`Unsupported Protocol v2 frame type: ${String(frameType)}`);
      }
      if (typeof cb !== "function") {
        throw new Error("Listener callback must be a function");
      }
      const set = listeners.get(frameType);
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    },

    /**
     * Closes active connections, cancels reconnect timers and pending rAF flushes.
     */
    close() {
      closed = true;
      clearTimer(reconnectTimer);
      reconnectTimer = null;
      clearPendingBatches();
      if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        try {
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
      if (es) {
        es.onopen = es.onmessage = es.onerror = null;
        try {
          es.close();
        } catch {
          // ignore
        }
        es = null;
      }
      setTransport("closed");
    },

    /**
     * Latest server-declared provenance (`LIVE | DELAYED | RECONNECTING | CACHED | UNAVAILABLE`) + `asOf`.
     */
    get status() {
      return { ...currentStatus };
    },
  };
}
