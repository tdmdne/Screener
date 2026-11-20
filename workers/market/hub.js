// workers/market/hub.js — MarketHub Durable Object (SQLite-backed, Hibernation API, Protocol v2).
// Tasks 2, 4, 8, 9:
// - Holds ONE outbound WebSocket to wss://ws.twelvedata.com/v1/quotes/price (key from env.TWELVEDATA_KEY,
//   sent via X-TD-APIKEY header with query-param fallback if CF outbound WS edge requires it — never logged).
// - Sends {"action":"heartbeat"} every 10 s; alarm() every 30 s re-arms and reconnects with exponential
//   backoff if silent > 30 s or closed.
// - Persists desired subscriptions in DO SQLite `subs` and resubscribes on restart; caps at TD_WS_MAX (default 8).
// - Wires upstream ticks -> HubCore.onTick -> CandleBuilder -> MarketStore.upsertBar -> on bar close runs
//   IndicatorTracker + buildScreenerSnapshot -> broadcasts Protocol v2 frames to Hibernation WS clients.
// - Routes: GET /hub/stats, GET /api/bootstrap, GET /api/bars, GET /ws.
import { createAlertEvaluator } from "../../shared/alerts.js";
import { createCandleBuilder, mergeBars, normalizeTf } from "../../shared/market/candles.js";
import {
  computeIndicator,
  createIndicatorTracker,
  indicatorKey,
  normalizeIndicatorConfig,
  toChartPoints,
} from "../../shared/market/indicators.js";
import { buildScreenerSnapshot } from "../../shared/market/screener.js";
import {
  MAX_CHART_BARS,
  MAX_CLIENT_FRAME_BYTES,
  MAX_HEATMAP_TILES,
  MAX_SCREENER_PAGE_ROWS,
  MAX_WATCHLIST_SYMBOLS,
  PROVENANCE,
  makeFrame,
  validateClientMessage,
} from "../../shared/protocol.js";
import { INSTRUMENT_BY_SYMBOL } from "../../shared/instruments.js";
import { normSymbol, toTwelveSymbol } from "../../shared/schema.js";
import { HubCore, tickToQuote } from "./hubCore.js";
import { MAX_HOT_BARS, MarketStore, utcDayKey } from "./store.js";

// Cloudflare outbound WS upgrades use https:// with Upgrade: websocket (connects to wss://).
export const TD_WS_URL = "https://ws.twelvedata.com/v1/quotes/price";
export const HEARTBEAT_MS = 10_000;
export const ALARM_MS = 30_000;
export const SILENCE_TIMEOUT_MS = 30_000;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 60_000;
export const DEFAULT_TD_WS_MAX = 8;
export const LIVE_STALE_MS = 120_000;
export const MAX_BOOTSTRAP_INDICATORS = 24;
export const MIN_INDICATOR_PERIOD = 1;
export const MAX_INDICATOR_PERIOD = 1000;
export const VIEW_COOLDOWN_MS = 500;
export const BOOTSTRAP_RECORDS_TTL_MS = 1_500;
const MAX_SCREENER_CACHE_ENTRIES = 32;

const HUB_TIMEFRAMES = Object.freeze(["1m", "5m", "15m", "30m", "1H", "4H", "1D", "1W"]);
const CAPABILITIES = Object.freeze(["bars", "ind", "screener", "heatmap"]);
const SCREENER_SNAPSHOT_KEY = "screener:latest";
const VALID_PRESETS = new Set(["P1", "P2", "P3", "P4", "P5"]);
const VALID_EVC = new Set(["H", "M", "L"]);
const VALID_HM_METRIC = new Set(["chg", "mom", "score"]);
const VALID_HM_TF = new Set(["1H", "4H", "1D", "1W"]);

/** Generate a globally unique client ID that never collides across DO hibernation restarts. */
function newClientId() {
  return `c-${crypto.randomUUID()}`;
}

/**
 * Parse an indicator spec from Protocol v2 `view.chart.ind` or `/api/bootstrap?ind=...`.
 * Supports strings ("ema:20", "ema20", "bb:20:2", "rsi:14", "vol") and descriptor objects.
 * Enforces `MIN_INDICATOR_PERIOD <= period <= MAX_INDICATOR_PERIOD` (1..1000).
 * @param {string|object} spec
 * @returns {{ id: string, config: { type: string, period: number, mult: number, source: string } } | null}
 */
export function parseIndicatorSpec(spec) {
  if (!spec) return null;
  const checkBounds = (cfg) => {
    if (!Number.isInteger(cfg.period) || cfg.period < MIN_INDICATOR_PERIOD || cfg.period > MAX_INDICATOR_PERIOD) {
      return false;
    }
    return true;
  };
  try {
    if (typeof spec === "string") {
      const s = spec.trim();
      if (!s) return null;
      if (s.toLowerCase() === "vol" || s.toLowerCase() === "volume") {
        const cfg = normalizeIndicatorConfig({ type: "vol" });
        return { id: indicatorKey(cfg), config: cfg };
      }
      const colonParts = s.split(":");
      if (colonParts.length >= 2) {
        const type = colonParts[0];
        const period = Number(colonParts[1]);
        const mult = colonParts[2] !== undefined ? Number(colonParts[2]) : undefined;
        const cfg = normalizeIndicatorConfig({ type, period, mult });
        if (!checkBounds(cfg)) return null;
        return { id: indicatorKey(cfg), config: cfg };
      }
      const m = /^([a-zA-Z]+)(\d+)$/.exec(s);
      if (m) {
        const cfg = normalizeIndicatorConfig({ type: m[1], period: Number(m[2]) });
        if (!checkBounds(cfg)) return null;
        return { id: s.toLowerCase(), config: cfg };
      }
      const cfg = normalizeIndicatorConfig({ type: s });
      if (!checkBounds(cfg)) return null;
      return { id: indicatorKey(cfg), config: cfg };
    }
    if (typeof spec === "object") {
      const cfg = normalizeIndicatorConfig(spec);
      if (!checkBounds(cfg)) return null;
      const id = typeof spec.id === "string" && spec.id.trim() ? spec.id.trim() : indicatorKey(cfg);
      return { id, config: cfg };
    }
  } catch {
    return null;
  }
  return null;
}

/** Convert an OHLCV bar object to the compact Protocol v2 6-tuple `[t, o, h, l, c, v]`. */
function toBarTuple(bar) {
  return [bar.t, bar.o, bar.h, bar.l, bar.c, Number.isFinite(bar.v) ? bar.v : 0];
}

/** Build up to `count` UTC YYYYMM strings stepping backward from `beforeSec`. */
function previousMonthKeys(beforeSec, count = 3) {
  const d = new Date(Math.max(0, beforeSec) * 1000);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth() + 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** Serialize an indicator compute result into compact JSON points for `state.chart.ind`. */
function serializeIndicatorSeries(bars, computed) {
  if (computed.type === "bb") {
    return {
      type: "bb",
      middle: toChartPoints(bars, computed.middle),
      upper: toChartPoints(bars, computed.upper),
      lower: toChartPoints(bars, computed.lower),
    };
  }
  return {
    type: computed.type,
    points: toChartPoints(bars, computed.values),
  };
}

export class MarketHub {
  /**
   * @param {DurableObjectState} ctx
   * @param {Record<string, any>} env
   * @param {{
   *   now?: () => number,
   *   openUpstreamWs?: (url: string, init: { headers: Record<string, string>, fallbackUrl: string }) => Promise<WebSocket>,
   *   createWebSocketPair?: () => [WebSocket, WebSocket],
   *   setTimer?: Function,
   *   clearTimer?: Function,
   *   setTimeout?: Function,
   *   clearTimeout?: Function,
   *   jitter?: boolean,
   *   maxBars?: number,
   *   maxUpstreamSymbols?: number,
   *   timeframes?: string[],
   * }} [opts]
   */
  constructor(ctx, env, opts = {}) {
    this.ctx = ctx;
    this.env = env || {};
    this.now = typeof opts.now === "function" ? opts.now : () => Date.now();
    this.maxUpstreamSymbols = Math.max(
      1,
      Number(opts.maxUpstreamSymbols ?? this.env.TD_WS_MAX ?? DEFAULT_TD_WS_MAX) || DEFAULT_TD_WS_MAX
    );
    this.openUpstreamWs =
      typeof opts.openUpstreamWs === "function"
        ? opts.openUpstreamWs
        : this._defaultOpenUpstreamWs.bind(this);
    this.createWebSocketPair =
      typeof opts.createWebSocketPair === "function"
        ? opts.createWebSocketPair
        : () => {
            const pair = new WebSocketPair();
            return Object.values(pair);
          };
    this.setTimer = opts.setTimer || ((fn, ms) => setInterval(fn, ms));
    this.clearTimer = opts.clearTimer || ((h) => clearInterval(h));
    this.setTimeoutFn = opts.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = opts.clearTimeout || ((h) => clearTimeout(h));
    this.jitter = opts.jitter !== undefined ? Boolean(opts.jitter) : true;

    this.store = new MarketStore(ctx.storage.sql, {
      now: this.now,
      maxBars: opts.maxBars ?? MAX_HOT_BARS,
    });
    this.candles = createCandleBuilder({
      timeframes: opts.timeframes || HUB_TIMEFRAMES,
    });
    this.indicators = createIndicatorTracker();
    this.alerts = createAlertEvaluator({
      now: this.now,
    });

    this.core = new HubCore(
      {
        subscribe: (syms) => this._onCoreSubscribe(syms),
        unsubscribe: (syms) => this._onCoreUnsubscribe(syms),
      },
      {
        protocolVersion: 2,
        maxUpstreamSymbols: this.maxUpstreamSymbols,
        now: this.now,
        setTimer: this.setTimer,
        clearTimer: this.clearTimer,
        onFrameSent: (id, seq) => this._persistClientSeq(id, seq),
        onEvict: (sym) => this._onCoreEvict(sym),
      }
    );

    // Single upstream Twelve Data WebSocket state
    this.upWs = null;
    this.upConnecting = false;
    this.upConnected = false;
    this._connectPromise = null;
    this.upReconnects = 0;
    this.retryAttempt = 0;
    this.nextReconnectAt = 0;
    this.lastUpstreamMsgAt = 0;
    this.lastHeartbeatAt = 0;
    this.hbTimer = null;
    this.reconnectTimer = null;

    // Subscription & view tracking
    this.desiredSubs = new Set();     // persisted admin/seed internal symbols (capped at maxUpstreamSymbols)
    this.ephemeralSubs = new Set();   // ephemeral client-view internal symbols (evicted when clients disconnect)
    this.failedUpstreamUntil = new Map(); // internal sym -> epoch ms cooldown after subscribe-status fails
    this.tdToInternal = new Map();    // "EUR/USD" -> "EURUSD"
    this.socketById = new Map();      // clientId -> server WebSocket
    this.clientViews = new Map();     // clientId -> { chart?, watchlist?, screener?, heatmap? }
    this.clientLastViewAt = new Map();// clientId -> last accepted `view` op timestamp (ms)
    this.clientIndicators = new Map();// clientId -> Map<fullIndKey, { sym, tf, config }>
    this.indicatorRefs = new Map();   // fullIndKey -> { count, sym, tf, config }
    this._lastDayVolume = new Map();  // sym -> { day: "YYYY-MM-DD", value: number }
    this._recordsCache = null;        // { at: number, records: Array }
    this._screenerCache = new Map();  // key -> { at: number, snap: object }
    this.barsClosed = 0;
    this._initializing = true;

    // Hibernation auto-response answers {"op":"ping"} without waking the DO.
    if (
      typeof WebSocketRequestResponsePair === "function" &&
      typeof this.ctx.setWebSocketAutoResponse === "function"
    ) {
      this.ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair('{"op":"ping"}', '{"v":2,"seq":0,"type":"pong"}')
      );
    }

    const initWork = async () => {
      try {
        this.store.init();
        const persisted = this.store.getSubs().slice(0, this.maxUpstreamSymbols);
        for (const s of persisted) {
          this.desiredSubs.add(s);
          this.tdToInternal.set(toTwelveSymbol(s), s);
        }
        if (persisted.length) {
          this.core.pinSymbols(persisted);
        }
        this._hydrateHibernatedSockets();
        await this._armAlarm();
      } finally {
        this._initializing = false;
      }
      // Fire upstream WS connection asynchronously via waitUntil — NEVER await external WS inside blockConcurrencyWhile.
      if (this._activeUpstreamCount() > 0 && this.env.TWELVEDATA_KEY) {
        this._scheduleEnsureUpstream();
      }
    };

    if (typeof this.ctx.blockConcurrencyWhile === "function") {
      this._ready = this.ctx.blockConcurrencyWhile(initWork);
    } else {
      this._ready = initWork();
    }
  }

  /** Wait for constructor initialization (useful in tests and before handling requests). */
  ready() {
    return this._ready;
  }

  async _armAlarm() {
    if (this.ctx.storage && typeof this.ctx.storage.setAlarm === "function") {
      await this.ctx.storage.setAlarm(this.now() + ALARM_MS);
    }
  }

  /**
   * Re-attach any browser WebSockets that survived DO hibernation.
   */
  _hydrateHibernatedSockets() {
    if (typeof this.ctx.getWebSockets !== "function") return;
    const sockets = this.ctx.getWebSockets() || [];
    for (const ws of sockets) {
      let att = null;
      try {
        att = typeof ws.deserializeAttachment === "function" ? ws.deserializeAttachment() : null;
      } catch {
        att = null;
      }
      let id = att && typeof att === "object" && att.id ? att.id : null;
      if (!id) {
        id = newClientId();
        att = { ...(att && typeof att === "object" ? att : {}), id, seq: 0, view: {} };
        this._persistAttachment(ws, att);
      }
      const startSeq = att && Number.isSafeInteger(att.seq) ? att.seq : 0;
      const userId = att && typeof att.userId === "string" && att.userId.trim() ? att.userId.trim() : null;
      this.socketById.set(id, ws);
      this.core.addClient(id, (msg) => ws.send(msg), { startSeq, userId });
      if (att && att.view && typeof att.view === "object") {
        this.clientViews.set(id, att.view);
        const syms = this._filterUpstreamSymbolsForClient(id, this._symbolsFromView(att.view));
        if (syms.length) this.core.setClientSymbols(id, syms);
        this._syncClientIndicators(id, att.view);
      }
    }
  }

  /** Total active upstream symbol count (persisted admin subs U ephemeral client subs). */
  _activeUpstreamCount() {
    let count = this.desiredSubs.size;
    for (const s of this.ephemeralSubs) {
      if (!this.desiredSubs.has(s)) count += 1;
    }
    return count;
  }

  /** Sorted list of all currently active upstream symbols (persisted U ephemeral). */
  _activeUpstreamSymbols() {
    const all = new Set(this.desiredSubs);
    for (const s of this.ephemeralSubs) all.add(s);
    return [...all].sort();
  }

  /** Fire `ensureUpstream()` asynchronously via `ctx.waitUntil` without stalling callers. */
  _scheduleEnsureUpstream() {
    if (this._initializing) return;
    if (this._activeUpstreamCount() === 0 || !this.env.TWELVEDATA_KEY) return;
    const work = Promise.resolve()
      .then(() => this.ensureUpstream())
      .catch(() => false);
    if (this.ctx && typeof this.ctx.waitUntil === "function") {
      this.ctx.waitUntil(work);
    }
  }

  /**
   * Default Cloudflare outbound WebSocket connector to Twelve Data.
   * Sends the API key via the `X-TD-APIKEY` header first.
   * If the upstream WS handshake rejects header auth with 401/403 (some Cloudflare/Twelve Data POP
   * combinations require query auth on WebSocket upgrade), falls back to `?apikey=` without ever
   * logging the key or fallback URL.
   */
  async _defaultOpenUpstreamWs(url, { headers, fallbackUrl }) {
    if (!this.env.TWELVEDATA_KEY) {
      throw new Error("TWELVEDATA_KEY not configured");
    }
    let res = await fetch(url, { headers });
    if ((!res.webSocket || res.status === 401 || res.status === 403) && fallbackUrl) {
      res = await fetch(fallbackUrl, { headers: { Upgrade: "websocket" } });
    }
    const ws = res.webSocket;
    if (!ws) {
      throw new Error(`Twelve Data WS upgrade failed (HTTP ${res.status})`);
    }
    if (typeof ws.accept === "function") ws.accept();
    return ws;
  }

  /**
   * Ensure the single upstream Twelve Data WebSocket is connected (deduplicated; never opens >1).
   */
  async ensureUpstream() {
    if (this._activeUpstreamCount() === 0) return false;
    if (this.upWs && this.upConnected) return true;
    if (this._connectPromise) return this._connectPromise;
    if (this.nextReconnectAt > 0 && this.now() < this.nextReconnectAt) return false;
    if (!this.env.TWELVEDATA_KEY) return false;

    this.upConnecting = true;
    const key = String(this.env.TWELVEDATA_KEY);
    const headers = {
      Upgrade: "websocket",
      "X-TD-APIKEY": key,
    };
    const fallbackUrl = `${TD_WS_URL}?apikey=${encodeURIComponent(key)}`;

    this._connectPromise = (async () => {
      try {
        const ws = await this.openUpstreamWs(TD_WS_URL, { headers, fallbackUrl });
        // Guard against a stale connect finishing after another socket already attached
        if (this.upWs && this.upWs !== ws) {
          try {
            ws.close(1000, "duplicate");
          } catch {
            /* ignore */
          }
          return true;
        }
        // Guard against all subscriptions being evicted while connecting
        if (this._activeUpstreamCount() === 0) {
          try {
            ws.close(1000, "idle");
          } catch {
            /* ignore */
          }
          return false;
        }

        this.upWs = ws;
        this.upConnected = true;
        this.lastUpstreamMsgAt = this.now();
        this.retryAttempt = 0;
        this.nextReconnectAt = 0;
        this._clearReconnectTimer();

        ws.addEventListener("message", (evt) => {
          this._onUpstreamMessage(typeof evt.data === "string" ? evt.data : "");
        });

        const onLost = () => {
          if (this.upWs !== ws) return;
          this._teardownUpstreamSocket(false);
          if (this._activeUpstreamCount() > 0) {
            this.upReconnects += 1;
            this._scheduleReconnect();
            this._broadcastStatus(PROVENANCE.DELAYED, "Upstream stream disconnected; reconnecting");
          }
        };
        ws.addEventListener("close", onLost);
        ws.addEventListener("error", onLost);

        this._startHeartbeat();
        this._sendUpstreamSubscribe(this._activeUpstreamSymbols());
        this._broadcastStatus(PROVENANCE.LIVE, "Upstream stream connected");
        return true;
      } catch {
        this.upConnected = false;
        this.upWs = null;
        this.upReconnects += 1;
        this._scheduleReconnect();
        return false;
      } finally {
        this.upConnecting = false;
        this._connectPromise = null;
      }
    })();

    return this._connectPromise;
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.hbTimer = this.setTimer(() => {
      this._sendHeartbeat();
    }, HEARTBEAT_MS);
  }

  _stopHeartbeat() {
    if (this.hbTimer !== null) {
      this.clearTimer(this.hbTimer);
      this.hbTimer = null;
    }
  }

  _clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      this.clearTimeoutFn(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  _sendHeartbeat() {
    if (!this.upWs || !this.upConnected) return false;
    try {
      this.upWs.send('{"action":"heartbeat"}');
      this.lastHeartbeatAt = this.now();
      return true;
    } catch {
      return false;
    }
  }

  _sendUpstreamSubscribe(syms) {
    if (!this.upWs || !this.upConnected || !syms || !syms.length) return;
    const mapped = [];
    for (const raw of syms) {
      const s = normSymbol(raw);
      if (!s) continue;
      const td = toTwelveSymbol(s);
      this.tdToInternal.set(td, s);
      mapped.push(td);
    }
    if (!mapped.length) return;
    try {
      this.upWs.send(JSON.stringify({ action: "subscribe", params: { symbols: mapped.join(",") } }));
    } catch {
      /* alarm reconnect will recover */
    }
  }

  _sendUpstreamUnsubscribe(syms) {
    if (!this.upWs || !this.upConnected || !syms || !syms.length) return;
    const mapped = syms.map(toTwelveSymbol);
    try {
      this.upWs.send(JSON.stringify({ action: "unsubscribe", params: { symbols: mapped.join(",") } }));
    } catch {
      /* ignore */
    }
  }

  _teardownUpstreamSocket(closeWs = true, reason = "reconnect") {
    this._stopHeartbeat();
    const ws = this.upWs;
    this.upWs = null;
    this.upConnected = false;
    if (closeWs && ws) {
      try {
        ws.close(1000, reason);
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Compute exponential backoff delay (1s, 2s, 4s, ..., capped at 60s) and schedule reconnect.
   */
  _scheduleReconnect() {
    const baseDelay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.retryAttempt);
    const jitterMs = this.jitter ? Math.floor(Math.random() * 250) : 0;
    const delay = Math.min(BACKOFF_MAX_MS, baseDelay + jitterMs);
    this.retryAttempt += 1;
    this.nextReconnectAt = this.now() + delay;

    this._clearReconnectTimer();
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      this.ensureUpstream();
    }, delay);
    return delay;
  }

  /**
   * DO Alarm handler (runs every 30 s):
   * - Re-arms next 30 s alarm.
   * - Sends heartbeat when upstream is healthy.
   * - Detects silence > 30 s or closed socket and reconnects with exponential backoff.
   */
  async alarm() {
    await this._ready;
    await this._armAlarm();

    if (this._activeUpstreamCount() === 0) return;
    const now = this.now();

    if (this.upWs && this.upConnected) {
      const silentMs = this.lastUpstreamMsgAt > 0 ? now - this.lastUpstreamMsgAt : 0;
      if (silentMs > SILENCE_TIMEOUT_MS) {
        this._teardownUpstreamSocket(true, "silent-timeout");
        this.upReconnects += 1;
        this._scheduleReconnect();
        this._broadcastStatus(PROVENANCE.DELAYED, "Upstream silent >30s; reconnecting");
        return;
      }
      this._sendHeartbeat();
      return;
    }

    if (now >= this.nextReconnectAt) {
      await this.ensureUpstream();
    }
  }

  /**
   * Persist and subscribe admin/seed upstream symbols up to `TD_WS_MAX` (default 8).
   * Persisted symbols survive DO restarts and browser disconnects; ephemeral client views do NOT.
   * @param {string[]} symbols
   * @returns {{ accepted: string[], rejected: string[] }}
   */
  subscribeUpstream(symbols) {
    const accepted = [];
    const rejected = [];
    const fresh = [];

    for (const raw of symbols || []) {
      const s = normSymbol(raw);
      if (!s) continue;
      if (this.desiredSubs.has(s)) {
        accepted.push(s);
        continue;
      }
      const alreadyEphemeral = this.ephemeralSubs.has(s);
      if (!alreadyEphemeral && this._activeUpstreamCount() >= this.maxUpstreamSymbols) {
        rejected.push(s);
        continue;
      }
      if (this.desiredSubs.size >= this.maxUpstreamSymbols) {
        rejected.push(s);
        continue;
      }
      this.ephemeralSubs.delete(s);
      this.desiredSubs.add(s);
      this.tdToInternal.set(toTwelveSymbol(s), s);
      accepted.push(s);
      fresh.push(s);
    }

    if (fresh.length) {
      this.store.addSubs(fresh);
      // Pinning invokes _onCoreSubscribe for any symbol not already active upstream.
      this.core.pinSymbols(fresh);
      if (!this.upWs || !this.upConnected) {
        this._scheduleEnsureUpstream();
      }
    }

    return { accepted, rejected };
  }

  /** Remove symbols from persisted upstream subscriptions; clears caches if unreferenced by live clients. */
  unsubscribeUpstream(symbols) {
    const removed = [];
    for (const raw of symbols || []) {
      const s = normSymbol(raw);
      if (!s || !this.desiredSubs.delete(s)) continue;
      removed.push(s);
    }
    if (removed.length) {
      this.store.removeSubs(removed);
      this.core.unpinSymbols(removed);
      const fullyGone = [];
      for (const s of removed) {
        if (this.core.refs.has(s)) {
          // Still actively watched by a connected client -> downgrade to ephemeral
          this.ephemeralSubs.add(s);
        } else {
          this.tdToInternal.delete(toTwelveSymbol(s));
          this.candles.clear(s);
          this._lastDayVolume.delete(s);
          fullyGone.push(s);
        }
      }
      if (fullyGone.length) {
        this._sendUpstreamUnsubscribe(fullyGone);
      }
      if (this._activeUpstreamCount() === 0) {
        this._teardownUpstreamSocket(true, "idle");
      }
    }
    return removed;
  }

  _onCoreSubscribe(syms) {
    const toSend = [];
    for (const raw of syms || []) {
      const s = normSymbol(raw);
      if (!s) continue;
      if (!this.desiredSubs.has(s)) {
        // Ephemeral client-driven subscription — never persisted to SQLite `subs`
        this.ephemeralSubs.add(s);
      }
      this.tdToInternal.set(toTwelveSymbol(s), s);
      toSend.push(s);
    }
    if (!toSend.length) return;
    if (this.upWs && this.upConnected) {
      this._sendUpstreamSubscribe(toSend);
    } else if (!this._initializing) {
      this._scheduleEnsureUpstream();
    }
  }

  _onCoreEvict(rawSym) {
    const s = normSymbol(rawSym);
    if (!s) return;
    // Evicted zero-viewer slot: remove from upstream active sets while preserving SQLite bars & core.last cache
    const wasDesired = this.desiredSubs.delete(s);
    const wasEphemeral = this.ephemeralSubs.delete(s);
    if (wasDesired || wasEphemeral) {
      this.tdToInternal.delete(toTwelveSymbol(s).toUpperCase());
      this._sendUpstreamUnsubscribe([s]);
    }
  }

  _onCoreUnsubscribe(syms) {
    const removed = [];
    for (const raw of syms || []) {
      const s = normSymbol(raw);
      if (!s || this.desiredSubs.has(s)) continue;
      if (this.ephemeralSubs.delete(s)) {
        this.tdToInternal.delete(toTwelveSymbol(s).toUpperCase());
        this.candles.clear(s);
        this._lastDayVolume.delete(s);
        removed.push(s);
      }
    }
    if (removed.length) {
      this._sendUpstreamUnsubscribe(removed);
      if (this._activeUpstreamCount() === 0) {
        this._teardownUpstreamSocket(true, "idle");
      }
    }
  }

  /**
   * Convert Twelve Data cumulative `day_volume` into a non-negative per-tick delta (with UTC-day reset),
   * preventing cumulative day volume from being summed repeatedly across intra-bar ticks.
   */
  _extractUpstreamTickVolume(sym, m, tickMs) {
    if (m.day_volume !== undefined && m.day_volume !== null) {
      const dv = Number(m.day_volume);
      if (!Number.isFinite(dv) || dv < 0) return 0;
      const day = utcDayKey(tickMs);
      const prev = this._lastDayVolume.get(sym);
      if (!prev || prev.day !== day) {
        this._lastDayVolume.set(sym, { day, value: dv });
        return 0;
      }
      if (dv <= prev.value) {
        return 0;
      }
      const delta = dv - prev.value;
      prev.value = dv;
      return delta;
    }
    const rawV = m.volume ?? m.v;
    if (rawV !== undefined && rawV !== null) {
      const v = Number(rawV);
      return Number.isFinite(v) && v >= 0 ? v : 0;
    }
    return 0;
  }

  _onUpstreamMessage(rawData) {
    this.lastUpstreamMsgAt = this.now();
    if (!rawData) return;
    let m;
    try {
      m = JSON.parse(rawData);
    } catch {
      return;
    }
    if (!m || typeof m !== "object") return;
    if (m.event === "heartbeat" || m.event === "unsubscribe-status") {
      return;
    }
    if (m.event === "subscribe-status") {
      this._handleUpstreamSubscribeStatus(m);
      return;
    }
    if (m.event === "price" || (m.symbol && (m.price !== undefined || m.c !== undefined))) {
      const tdKey = String(m.symbol || "").trim().toUpperCase();
      const internalSym = this.tdToInternal.get(tdKey) || normSymbol(tdKey);
      if (!internalSym) return;
      const rawT = m.timestamp ?? m.t ?? this.now();
      const numT = Number(rawT);
      const tickMs = Number.isFinite(numT) && numT > 0 ? (numT < 1e12 ? numT * 1000 : numT) : this.now();
      const tickVol = this._extractUpstreamTickVolume(internalSym, m, tickMs);
      this.ingestTick({
        s: internalSym,
        c: m.price ?? m.c,
        t: tickMs,
        bid: m.bid,
        ask: m.ask,
        v: tickVol,
        src: "twelvedata",
      });
    }
  }

  /**
   * Process one upstream tick through tick guard -> CandleBuilder -> SQLite (closed bars only) -> Indicators -> Screener -> WS fan-out.
   */
  ingestTick(rawTick) {
    const tick = this.core.onTick(rawTick, { acceptUnreferenced: true });
    if (!tick) return { accepted: false, tick: null, closed: [], updated: [], alerts: [] };

    const alertTriggers = [];
    const tickAlertRes = this.alerts.evaluateTick(tick);
    if (tickAlertRes.triggers.length > 0) {
      alertTriggers.push(...tickAlertRes.triggers);
      this._broadcastAlerts(tickAlertRes.frames, tickAlertRes.triggers);
    }

    const candleRes = this.candles.onTick(tick);
    if (candleRes.ignored) {
      return { accepted: true, tick, closed: [], updated: [], alerts: alertTriggers };
    }

    for (const evt of candleRes.closed) {
      this.store.upsertBar(evt.sym, evt.tf, evt.bar);
      this.barsClosed += 1;
      this._broadcastBar(evt.sym, evt.tf, evt.bar, true);

      if (evt.tf === "1m") {
        const barAlertRes = this.alerts.evaluateBar(evt.sym, evt.bar, tick.t);
        if (barAlertRes.triggers.length > 0) {
          alertTriggers.push(...barAlertRes.triggers);
          this._broadcastAlerts(barAlertRes.frames, barAlertRes.triggers);
        }
      }

      const deltas = this.indicators.onBarClose(evt.sym, evt.tf, evt.bar);
      if (deltas.length) {
        this._broadcastIndicatorDeltas(evt.sym, evt.tf, deltas);
      }
    }

    for (const evt of candleRes.updated) {
      // Forming/in-progress bars stay in memory (CandleBuilder) — zero SQLite writes per tick.
      this._broadcastBar(evt.sym, evt.tf, evt.bar, false);
    }

    if (candleRes.closed.length > 0) {
      this._invalidateBootstrapCache();
      // Update screener & heatmap snapshot asynchronously (catch rejections so waitUntil never crashes)
      const work = Promise.resolve()
        .then(() => this.refreshScreenerSnapshot())
        .catch(() => null);
      if (this.ctx && typeof this.ctx.waitUntil === "function") {
        this.ctx.waitUntil(work);
      }
    }

    return { accepted: true, tick, closed: candleRes.closed, updated: candleRes.updated, alerts: alertTriggers };
  }

  /**
   * Recompute server-side screener + heatmap snapshot from SQLite real bars,
   * store in SQLite `snapshots`, and attempt throttled KV `snap:v1` publish (5-min throttle, <900/day).
   */
  async refreshScreenerSnapshot(opts = {}) {
    const records = this._buildRealRecords();
    const now = this.now();
    const snap = buildScreenerSnapshot(records, {
      preset: opts.preset || "P5",
      evcTf: opts.evcTf || "H",
      dir: opts.dir || "long",
      page: 1,
      pageSize: MAX_SCREENER_PAGE_ROWS,
      now,
      ...opts,
    });

    this.store.saveSnapshot(SCREENER_SNAPSHOT_KEY, snap, snap.asOf);

    const kvResult = await this.store.writeBootstrapSnapshot(this.env.MARKET_KV, snap, { now });
    return { snapshot: snap, kvResult };
  }

  _buildRealRecords() {
    const syms = this.store.listBarSymbols();
    const records = [];
    for (const sym of syms) {
      const bars = this.store.getBarsByTimeframe(sym, 200);
      const tfs = Object.keys(bars);
      if (!tfs.length) continue;
      const tick = this.core.getLastTick(sym);
      const latest1m = bars["1m"] && bars["1m"].length ? bars["1m"][bars["1m"].length - 1] : null;
      const latest1D = bars["1D"] && bars["1D"].length ? bars["1D"][bars["1D"].length - 1] : null;
      const latestAny = latest1m || latest1D || bars[tfs[0]][bars[tfs[0]].length - 1];
      const price = tick ? tick.c : latestAny.c;
      const volume = tick && tick.v !== undefined ? tick.v : latestAny.v;
      const asOf = tick ? tick.t : latestAny.t * 1000;
      records.push({
        symbol: sym,
        price,
        volume,
        bars,
        source: "twelvedata",
        asOf,
      });
    }
    return records;
  }

  _currentProvenance(hasCachedData) {
    const now = this.now();
    if (this.upConnected && this.lastUpstreamMsgAt > 0 && now - this.lastUpstreamMsgAt <= LIVE_STALE_MS) {
      return PROVENANCE.LIVE;
    }
    if (this.upConnected || (this.lastUpstreamMsgAt > 0 && now - this.lastUpstreamMsgAt > LIVE_STALE_MS)) {
      return PROVENANCE.DELAYED;
    }
    if (hasCachedData) return PROVENANCE.CACHED;
    return PROVENANCE.UNAVAILABLE;
  }

  /** Load closed SQLite history bars for (sym, tf), excluding any open forming bar to avoid double-counting. */
  _getClosedHistoryBars(sym, tf, limit = MAX_CHART_BARS) {
    const hist = this.store.getBars(sym, tf, { limit });
    const openBar = this.candles.getCurrent(sym, tf);
    if (!openBar || !hist.length) return hist;
    let end = hist.length;
    while (end > 0 && hist[end - 1].t >= openBar.t) {
      end -= 1;
    }
    return end === hist.length ? hist : hist.slice(0, end);
  }

  /** Load SQLite closed bars merged with any live in-memory forming candle from CandleBuilder. */
  _getBarsWithForming(sym, tf, limit = MAX_CHART_BARS) {
    const stored = this.store.getBars(sym, tf, { limit });
    const openBar = this.candles.getCurrent(sym, tf);
    if (!openBar) return stored;
    return mergeBars(stored, [openBar], { maxBars: limit });
  }

  /**
   * Reference-count client indicator subscriptions and unregister any stream whose refcount hits 0.
   * Seeds new streams strictly with closed historical bars so `onBarClose()` never double-counts the open bar.
   */
  _syncClientIndicators(clientId, view) {
    const nextInds = new Map();
    if (view && view.chart && view.chart.sym) {
      const sym = normSymbol(view.chart.sym);
      const tf = normalizeTf(view.chart.tf || "1m") || "1m";
      if (sym) {
        const rawList = Array.isArray(view.chart.ind)
          ? view.chart.ind.slice(0, MAX_BOOTSTRAP_INDICATORS)
          : [];
        for (const rawSpec of rawList) {
          const spec = parseIndicatorSpec(rawSpec);
          if (!spec) continue;
          const indKey = indicatorKey(spec.config);
          const fullKey = `${sym}|${tf}|${indKey}`;
          nextInds.set(fullKey, { sym, tf, config: spec.config });
        }
      }
    }

    const prevInds = this.clientIndicators.get(clientId) || new Map();

    // Decrement & unregister indicators no longer referenced by this client
    for (const [fullKey, entry] of prevInds.entries()) {
      if (!nextInds.has(fullKey)) {
        const ref = this.indicatorRefs.get(fullKey);
        if (ref) {
          ref.count -= 1;
          if (ref.count <= 0) {
            this.indicatorRefs.delete(fullKey);
            this.indicators.unregister(entry.sym, entry.tf, entry.config);
          }
        }
      }
    }

    // Increment & register newly requested indicators (seeded from CLOSED bars only)
    for (const [fullKey, entry] of nextInds.entries()) {
      if (!prevInds.has(fullKey)) {
        const ref = this.indicatorRefs.get(fullKey);
        if (ref) {
          ref.count += 1;
        } else {
          this.indicatorRefs.set(fullKey, { count: 1, sym: entry.sym, tf: entry.tf, config: entry.config });
          const closedHist = this._getClosedHistoryBars(entry.sym, entry.tf, MAX_CHART_BARS);
          this.indicators.register(entry.sym, entry.tf, entry.config, closedHist);
        }
      }
    }

    if (nextInds.size > 0) {
      this.clientIndicators.set(clientId, nextInds);
    } else {
      this.clientIndicators.delete(clientId);
    }
  }

  _invalidateBootstrapCache() {
    this._recordsCache = null;
    this._screenerCache.clear();
  }

  _getCachedRealRecords(now) {
    if (
      this._recordsCache &&
      now >= this._recordsCache.at &&
      now - this._recordsCache.at < BOOTSTRAP_RECORDS_TTL_MS
    ) {
      return this._recordsCache.records;
    }
    const records = this._buildRealRecords();
    if (records.length > 0) {
      this._recordsCache = { at: now, records };
    } else {
      this._recordsCache = null;
    }
    return records;
  }

  /**
   * Build one valid Protocol v2 `state` payload from SQLite / KV snapshot (Task 9).
   * Guaranteed <= MAX_CHART_BARS (1,500), <= MAX_SCREENER_PAGE_ROWS (50), <= MAX_HEATMAP_TILES (100).
   */
  async buildBootstrapState(params = {}, seqOrFn = 1) {
    const now = this.now();
    const records = this._getCachedRealRecords(now);
    const hasSqlData = records.length > 0;

    // Screener & Heatmap
    const screenerReq = params.screener || {};
    const preset = VALID_PRESETS.has(screenerReq.preset) ? screenerReq.preset : "P5";
    const evcTf = VALID_EVC.has(screenerReq.evcTf) ? screenerReq.evcTf : "H";
    const dir = screenerReq.dir === "short" ? "short" : "long";
    const market = screenerReq.market || "ALL";
    const query = screenerReq.query || "";
    const page = Math.max(1, Math.floor(Number(screenerReq.page) || 1));
    const pageSize = Math.min(
      MAX_SCREENER_PAGE_ROWS,
      Math.max(1, Math.floor(Number(screenerReq.pageSize) || MAX_SCREENER_PAGE_ROWS))
    );

    const hmReq = params.heatmap || {};
    const hmMetric = VALID_HM_METRIC.has(hmReq.metric) ? hmReq.metric : "chg";
    const hmTf = VALID_HM_TF.has(hmReq.tf) ? hmReq.tf : "1D";
    const hmN = Math.min(MAX_HEATMAP_TILES, Math.max(1, Math.floor(Number(hmReq.n) || 60)));
    const hmSize = hmReq.size === "equal" ? "equal" : "value";

    let snap = null;
    let fromKvFallback = false;

    if (hasSqlData) {
      const hmMarket = hmReq.market || market;
      const cacheKey = `${preset}|${evcTf}|${dir}|${market}|${query}|${page}|${pageSize}|${hmMetric}|${hmTf}|${hmN}|${hmSize}|${hmMarket}`;
      const cachedSnap = this._screenerCache.get(cacheKey);
      if (cachedSnap && now >= cachedSnap.at && now - cachedSnap.at < BOOTSTRAP_RECORDS_TTL_MS) {
        snap = cachedSnap.snap;
      } else {
        snap = buildScreenerSnapshot(records, {
          preset,
          evcTf,
          dir,
          market,
          query,
          page,
          pageSize,
          heatmap: { metric: hmMetric, tf: hmTf, n: hmN, size: hmSize, market: hmMarket },
          now,
        });
        if (this._screenerCache.size >= MAX_SCREENER_CACHE_ENTRIES) {
          this._screenerCache.clear();
        }
        this._screenerCache.set(cacheKey, { at: now, snap });
      }
    } else {
      const sqlSnap = this.store.getSnapshot(SCREENER_SNAPSHOT_KEY);
      if (sqlSnap && sqlSnap.payload && Array.isArray(sqlSnap.payload.rows)) {
        snap = sqlSnap.payload;
      } else {
        const kvSnap = await this.store.readBootstrapSnapshot(this.env.MARKET_KV);
        if (kvSnap && Array.isArray(kvSnap.rows)) {
          snap = kvSnap;
          fromKvFallback = true;
        }
      }
    }

    // Chart section
    let chartPayload;
    if (params.chart && params.chart.sym) {
      const sym = normSymbol(params.chart.sym);
      const tf = normalizeTf(params.chart.tf || "1m") || "1m";
      if (sym) {
        const bars = this._getBarsWithForming(sym, tf, MAX_CHART_BARS);
        const indOut = {};
        const indSpecs = Array.isArray(params.chart.ind)
          ? params.chart.ind.slice(0, MAX_BOOTSTRAP_INDICATORS)
          : [];
        for (const rawSpec of indSpecs) {
          const parsed = parseIndicatorSpec(rawSpec);
          if (!parsed) continue;
          const computed = computeIndicator(bars, parsed.config);
          indOut[parsed.id] = serializeIndicatorSeries(bars, computed);
        }
        chartPayload = {
          sym,
          tf,
          bars: bars.map(toBarTuple),
          ind: indOut,
          vs: [],
        };
      }
    }

    // Watchlist section
    let watchlistPayload;
    if (Array.isArray(params.watchlist)) {
      const wlOut = [];
      const seen = new Set();
      const cap = Math.min(params.watchlist.length, MAX_WATCHLIST_SYMBOLS);
      const prov = this._currentProvenance(hasSqlData || Boolean(snap));
      for (let i = 0; i < cap; i++) {
        const sym = normSymbol(params.watchlist[i]);
        if (!sym || seen.has(sym)) continue;
        seen.add(sym);
        const live = this.core.getLastTick(sym);
        if (live) {
          wlOut.push(tickToQuote(live, prov));
          continue;
        }
        const bars1m = this.store.getBars(sym, "1m", { limit: 1 });
        const bars1D = bars1m.length ? bars1m : this.store.getBars(sym, "1D", { limit: 1 });
        if (bars1D.length) {
          const last = bars1D[bars1D.length - 1];
          wlOut.push({
            s: sym,
            c: last.c,
            t: last.t * 1000,
            v: last.v,
            provenance: PROVENANCE.CACHED,
          });
        }
      }
      watchlistPayload = wlOut;
    }

    const hasAnyData =
      hasSqlData ||
      Boolean(snap && (snap.rows?.length || snap.heatmap?.tiles?.length)) ||
      Boolean(chartPayload && chartPayload.bars.length) ||
      Boolean(watchlistPayload && watchlistPayload.length);

    const provenance = fromKvFallback
      ? PROVENANCE.CACHED
      : this._currentProvenance(hasAnyData);
    const dataAsOf = Math.max(this.lastUpstreamMsgAt || 0, snap?.asOf || 0);
    const asOf = dataAsOf > 0 ? dataAsOf : now;

    const stateBody = {
      status: {
        provenance,
        asOf,
      },
    };

    if (chartPayload) stateBody.chart = chartPayload;
    if (watchlistPayload !== undefined) stateBody.watchlist = watchlistPayload;

    if (snap) {
      stateBody.screener = {
        page: Math.max(1, Number(snap.page) || 1),
        totalPages: Math.max(1, Number(snap.totalPages) || 1),
        total: Math.max(0, Number(snap.total) || 0),
        preset: VALID_PRESETS.has(snap.preset) ? snap.preset : preset,
        asOf: snap.asOf || asOf,
        rows: (snap.rows || []).slice(0, MAX_SCREENER_PAGE_ROWS),
      };
      if (snap.heatmap) {
        stateBody.heatmap = {
          metric: VALID_HM_METRIC.has(snap.heatmap.metric) ? snap.heatmap.metric : hmMetric,
          tf: VALID_HM_TF.has(snap.heatmap.tf) ? snap.heatmap.tf : hmTf,
          range: Number(snap.heatmap.range) > 0 ? Number(snap.heatmap.range) : 1,
          asOf: snap.heatmap.asOf || asOf,
          tiles: (snap.heatmap.tiles || []).slice(0, MAX_HEATMAP_TILES),
        };
      }
    } else {
      stateBody.screener = {
        page: 1,
        totalPages: 1,
        total: 0,
        preset,
        asOf,
        rows: [],
      };
      stateBody.heatmap = {
        metric: hmMetric,
        tf: hmTf,
        range: 1,
        asOf,
        tiles: [],
      };
    }

    const seq = typeof seqOrFn === "function" ? seqOrFn() : seqOrFn;
    return makeFrame("state", stateBody, seq);
  }

  /**
   * Handle `GET /api/bars?sym=SYM&tf=TF&before=T&limit=500` with SQLite hot store + KV chunk paging.
   */
  async handleBarsRoute(url) {
    const sym = normSymbol(url.searchParams.get("sym") || url.searchParams.get("symbol"));
    const tfRaw = url.searchParams.get("tf") || "1m";
    const tf = normalizeTf(tfRaw);
    if (!sym) return Response.json({ ok: false, error: "sym required" }, { status: 400 });
    if (!tf) return Response.json({ ok: false, error: `unsupported tf: ${tfRaw}` }, { status: 400 });

    const limit = Math.min(MAX_HOT_BARS, Math.max(1, Math.floor(Number(url.searchParams.get("limit")) || 500)));
    const beforeRaw = url.searchParams.get("before");
    const before = beforeRaw !== null && beforeRaw !== "" ? Math.floor(Number(beforeRaw)) : undefined;
    if (beforeRaw !== null && beforeRaw !== "" && (!Number.isFinite(before) || before <= 0)) {
      return Response.json({ ok: false, error: "invalid before timestamp" }, { status: 400 });
    }

    let bars = this.store.getBars(sym, tf, { before, limit });
    if (!before) {
      const openBar = this.candles.getCurrent(sym, tf);
      if (openBar) {
        bars = mergeBars(bars, [openBar], { maxBars: limit });
      }
    }
    let usedKv = false;
    let kvHadMore = false;
    const chunkCache = new Map();

    const loadChunk = async (ym) => {
      if (chunkCache.has(ym)) return chunkCache.get(ym);
      const c = await this.store.readHistoryChunk(this.env.MARKET_KV, sym, tf, ym);
      chunkCache.set(ym, c);
      return c;
    };

    // If paging older history beyond SQLite's hot window, merge immutable KV monthly chunks server-side.
    if (before && bars.length < limit && this.env.MARKET_KV) {
      const months = previousMonthKeys(before, 3);
      const kvChunks = [];
      for (const ym of months) {
        const chunk = await loadChunk(ym);
        if (chunk.length) {
          usedKv = true;
          for (const b of chunk) {
            if (b.t < before) kvChunks.push(b);
          }
        }
      }
      if (kvChunks.length) {
        const merged = mergeBars(kvChunks, bars);
        if (merged.length > limit) {
          kvHadMore = true;
          bars = merged.slice(-limit);
        } else {
          bars = merged;
        }
      }
    }

    const oldestT = bars.length ? bars[0].t : null;
    let hasMore = kvHadMore;
    if (!hasMore && oldestT) {
      if (this.store.getBars(sym, tf, { before: oldestT, limit: 1 }).length > 0) {
        hasMore = true;
      } else if (this.env.MARKET_KV) {
        // Check if an immutable KV chunk holds bars strictly older than oldestT.
        const olderMonths = previousMonthKeys(oldestT, 2);
        for (const ym of olderMonths) {
          const chunk = await loadChunk(ym);
          if (chunk.length && chunk[0].t < oldestT) {
            hasMore = true;
            break;
          }
        }
      }
    }
    const provenance = usedKv ? PROVENANCE.CACHED : this._currentProvenance(bars.length > 0);
    const asOf = bars.length ? bars[bars.length - 1].t * 1000 : this.now();

    return Response.json(
      {
        ok: true,
        sym,
        tf,
        bars,
        count: bars.length,
        hasMore,
        provenance,
        asOf,
      },
      { headers: { "Cache-Control": "no-store", "X-Provenance": provenance } }
    );
  }

  /**
   * Handle `GET /api/bootstrap?chart=SYM:tf&wl=...&preset=...`.
   */
  async handleBootstrapRoute(url) {
    const params = {};

    const chartParam = url.searchParams.get("chart");
    if (chartParam) {
      const [rawSym, rawTf] = chartParam.split(":");
      const sym = normSymbol(rawSym);
      const tf = normalizeTf(rawTf || "1m") || "1m";
      if (sym) {
        const indParams = url.searchParams.getAll("ind");
        const ind = indParams
          .flatMap((p) => String(p).split(","))
          .map((s) => s.trim())
          .filter(Boolean);
        if (ind.length > MAX_BOOTSTRAP_INDICATORS) {
          return Response.json(
            { ok: false, error: `too many indicators: max ${MAX_BOOTSTRAP_INDICATORS}` },
            { status: 400 }
          );
        }
        for (const rawSpec of ind) {
          if (!parseIndicatorSpec(rawSpec)) {
            return Response.json(
              {
                ok: false,
                error: `invalid indicator spec (period must be ${MIN_INDICATOR_PERIOD}..${MAX_INDICATOR_PERIOD}): ${rawSpec}`,
              },
              { status: 400 }
            );
          }
        }
        params.chart = { sym, tf, ind };
      }
    }

    const wlParam = url.searchParams.get("wl") || url.searchParams.get("watchlist");
    if (wlParam !== null) {
      params.watchlist = wlParam
        .split(",")
        .map((s) => normSymbol(s))
        .filter(Boolean)
        .slice(0, MAX_WATCHLIST_SYMBOLS);
    }

    const preset = url.searchParams.get("preset") || "P5";
    const evcTf = url.searchParams.get("evcTf") || "H";
    const dir = url.searchParams.get("dir") || "long";
    const market = url.searchParams.get("market") || "ALL";
    const query = url.searchParams.get("query") || "";
    const page = Number(url.searchParams.get("page")) || 1;
    params.screener = { preset, evcTf, dir, market, query, page };

    params.heatmap = {
      metric: url.searchParams.get("hmMetric") || "chg",
      tf: url.searchParams.get("hmTf") || "1D",
      n: Number(url.searchParams.get("hmN")) || 60,
      size: url.searchParams.get("hmSize") || "value",
      market,
    };

    const stateFrame = await this.buildBootstrapState(params, 1);
    return Response.json(stateFrame, {
      headers: {
        "Cache-Control": "no-store",
        "X-Provenance": stateFrame.status.provenance,
      },
    });
  }

  /** Safe diagnostic stats — NEVER exposes API keys or auth headers. */
  getStats() {
    return {
      ok: true,
      clients: this.core.clients.size,
      upstream: {
        connected: this.upConnected,
        connecting: this.upConnecting,
        reconnects: this.upReconnects,
        retryAttempt: this.retryAttempt,
        lastMessageAt: this.lastUpstreamMsgAt,
        lastHeartbeatAt: this.lastHeartbeatAt,
        nextReconnectAt: this.nextReconnectAt,
      },
      symbols: this._activeUpstreamSymbols(),
      persistedSymbols: [...this.desiredSubs].sort(),
      maxUpstreamSymbols: this.maxUpstreamSymbols,
      kvWritesToday: this.store.getKvWritesToday(this.now()),
      kvDailyLimit: this.store.kvDailyLimit,
      ticks: { ...this.core.stats },
      barsClosed: this.barsClosed,
      alertsCount: this.alerts.listAlerts().length,
      now: this.now(),
    };
  }

  async fetch(req) {
    await this._ready;
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/hub/stats" || p === "/stats") {
      return Response.json(this.getStats(), { headers: { "Cache-Control": "no-store" } });
    }
    if (p === "/api/bootstrap") {
      return this.handleBootstrapRoute(url);
    }
    if (p === "/api/bars") {
      return this.handleBarsRoute(url);
    }
    if (p === "/ws") {
      return this._handleWebSocketUpgrade(req);
    }

    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }

  _handleWebSocketUpgrade(req) {
    if ((req.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const [client, server] = this.createWebSocketPair();
    const id = newClientId();

    if (typeof this.ctx.acceptWebSocket === "function") {
      this.ctx.acceptWebSocket(server, [id]);
    } else if (typeof server.accept === "function") {
      server.accept();
    }

    const attachment = { id, seq: 0, view: {}, connectedAt: this.now() };
    this._persistAttachment(server, attachment);

    this.socketById.set(id, server);
    this.clientViews.set(id, {});
    this.core.addClient(id, (payload) => server.send(payload), { startSeq: 0 });

    this._sendToClient(id, "hello", {
      serverTime: this.now(),
      capabilities: [...CAPABILITIES],
    });

    try {
      return new Response(null, { status: 101, webSocket: client });
    } catch {
      // Node undici's Response forbids status 101 (Cloudflare Workers natively supports it).
      return { status: 101, webSocket: client, headers: new Headers() };
    }
  }

  /** Hibernation API inbound browser message handler (Protocol v2). */
  async webSocketMessage(ws, message) {
    await this._ready;
    const att = this._readAttachment(ws);
    const id = att.id;

    if (!this.core.clients.has(id)) {
      this.socketById.set(id, ws);
      this.clientViews.set(id, att.view || {});
      this.core.addClient(id, (payload) => ws.send(payload), { startSeq: att.seq || 0 });
    }

    // Pre-decode frame size guard: reject oversized payloads BEFORE TextDecoder().decode() or JSON.parse().
    let rawSize = 0;
    if (typeof message === "string") {
      rawSize = message.length;
    } else if (message && typeof message.byteLength === "number") {
      rawSize = message.byteLength;
    } else if (message instanceof ArrayBuffer) {
      rawSize = message.byteLength;
    }
    if (rawSize > MAX_CLIENT_FRAME_BYTES) {
      this._sendToClient(id, "error", {
        code: "BUDGET_EXCEEDED",
        message: `Client frame exceeds MAX_CLIENT_FRAME_BYTES (${MAX_CLIENT_FRAME_BYTES}B)`,
        fatal: false,
      });
      return;
    }

    let raw;
    if (typeof message === "string") {
      raw = message;
    } else if (message instanceof ArrayBuffer || ArrayBuffer.isView(message)) {
      raw = new TextDecoder().decode(message);
    } else {
      this._sendToClient(id, "error", {
        code: "INVALID_MESSAGE",
        message: "Unsupported WebSocket message type",
        fatal: false,
      });
      return;
    }

    const parsed = validateClientMessage(raw);
    if (!parsed.ok) {
      this._sendToClient(id, "error", {
        code: parsed.code,
        message: parsed.error,
        fatal: false,
      });
      return;
    }

    const msg = parsed.value;

    if (msg.op === "ping") {
      this._sendToClient(id, "pong", msg.t ? { t: msg.t } : {}, { seq: 0 });
      return;
    }

    if (msg.op === "hello") {
      if (msg.session) att.session = msg.session;
      this._persistAttachment(ws, att);
      const reply = {
        serverTime: this.now(),
        capabilities: [...CAPABILITIES],
      };
      if (msg.session) reply.session = msg.session;
      this._sendToClient(id, "hello", reply);
      return;
    }

    if (msg.op === "view") {
      // Per-client cooldown on `view` updates to prevent DO CPU starvation via rapid state rebuilds.
      const now = this.now();
      const lastViewAt = this.clientLastViewAt.get(id);
      if (lastViewAt !== undefined && now >= lastViewAt && now - lastViewAt < VIEW_COOLDOWN_MS) {
        this._sendToClient(id, "error", {
          code: "RATE_LIMITED",
          message: `View updates are rate-limited (min interval ${VIEW_COOLDOWN_MS}ms)`,
          fatal: false,
        });
        return;
      }

      // Validate indicator specs & period bounds BEFORE mutating view or registering indicators.
      if (msg.chart && Array.isArray(msg.chart.ind)) {
        if (msg.chart.ind.length > MAX_BOOTSTRAP_INDICATORS) {
          this._sendToClient(id, "error", {
            code: "INVALID_INDICATOR",
            message: `Too many indicators (max ${MAX_BOOTSTRAP_INDICATORS})`,
            fatal: false,
          });
          return;
        }
        for (const rawSpec of msg.chart.ind) {
          if (!parseIndicatorSpec(rawSpec)) {
            this._sendToClient(id, "error", {
              code: "INVALID_INDICATOR",
              message: `Invalid indicator spec (period must be ${MIN_INDICATOR_PERIOD}..${MAX_INDICATOR_PERIOD})`,
              fatal: false,
            });
            return;
          }
        }
      }

      this.clientLastViewAt.set(id, now);

      const prevView = this.clientViews.get(id) || att.view || {};
      const nextView = { ...prevView };
      if (msg.chart !== undefined) nextView.chart = msg.chart;
      if (msg.watchlist !== undefined) nextView.watchlist = msg.watchlist;
      if (msg.screener !== undefined) nextView.screener = msg.screener;
      if (msg.heatmap !== undefined) nextView.heatmap = msg.heatmap;

      this.clientViews.set(id, nextView);
      att.view = nextView;

      // Sync ephemeral client subscriptions (unauthenticated clients restricted to known universe) & refcounted indicators
      const desiredSyms = this._filterUpstreamSymbolsForClient(id, this._symbolsFromView(nextView));
      this.core.setClientSymbols(id, desiredSyms);
      this._syncClientIndicators(id, nextView);

      let stateFrame;
      try {
        stateFrame = await this.buildBootstrapState(nextView, 0);
      } catch (err) {
        this._persistAttachment(ws, att);
        this._sendToClient(id, "error", {
          code: "STATE_BUILD_ERROR",
          message: err && err.message ? String(err.message).slice(0, 256) : "Failed to build state",
          fatal: false,
        });
        return;
      }

      stateFrame.seq = this.core.nextSeq(id);
      try {
        ws.send(JSON.stringify(stateFrame));
      } catch {
        /* socket closing */
      }
      att.seq = this.core.currentSeq(id);
      this._persistAttachment(ws, att);
    }
  }

  async webSocketClose(ws) {
    this._cleanupSocket(ws);
  }

  async webSocketError(ws) {
    this._cleanupSocket(ws);
  }

  _cleanupSocket(ws) {
    const att = this._readAttachment(ws);
    if (!att || !att.id) return;
    this._syncClientIndicators(att.id, null);
    this.core.removeClient(att.id);
    this.socketById.delete(att.id);
    this.clientViews.delete(att.id);
    this.clientLastViewAt.delete(att.id);
  }

  /**
   * Whether a symbol is part of the known seeded/configured universe (persisted subs, instrument catalog, or stored bars).
   * Prevents unauthenticated WS clients from exhausting `TD_WS_MAX` upstream slots with arbitrary fake tickers.
   */
  _isKnownSymbol(sym) {
    if (!sym) return false;
    if (this.desiredSubs.has(sym)) return true;
    if (INSTRUMENT_BY_SYMBOL.has(sym)) return true;
    if (this.store.getBarCount(sym, "1m") > 0 || this.store.getBarCount(sym, "1D") > 0) return true;
    return false;
  }

  _isUpstreamRejected(sym) {
    const s = normSymbol(sym);
    if (!s) return false;
    const until = this.failedUpstreamUntil.get(s);
    if (!until) return false;
    if (this.now() >= until) {
      this.failedUpstreamUntil.delete(s);
      return false;
    }
    return true;
  }

  _handleUpstreamSubscribeStatus(m) {
    const ts = this.now();
    if (Array.isArray(m.success)) {
      for (const item of m.success) {
        const rawTd = String(
          typeof item === "string" ? item : (item && (item.symbol || item.s)) || ""
        )
          .trim()
          .toUpperCase();
        if (!rawTd) continue;
        const internal = this.tdToInternal.get(rawTd) || normSymbol(rawTd);
        if (internal) {
          this.tdToInternal.set(rawTd, internal);
          this.failedUpstreamUntil.delete(internal);
        }
      }
    }

    const fails = Array.isArray(m.fails)
      ? m.fails
      : m.status === "error" && m.symbol
        ? [m.symbol]
        : [];
    if (!fails.length) return;

    let releasedAny = false;
    for (const item of fails) {
      const rawTd = String(
        typeof item === "string" ? item : (item && (item.symbol || item.s)) || ""
      )
        .trim()
        .toUpperCase();
      if (!rawTd) continue;
      const internal = this.tdToInternal.get(rawTd) || normSymbol(rawTd);
      if (!internal) continue;
      this.failedUpstreamUntil.set(internal, ts + 600_000);
      const wasDesired = this.desiredSubs.delete(internal);
      const wasEphemeral = this.ephemeralSubs.delete(internal);
      const wasCore = this.core.releaseUpstreamSymbol(internal);
      if (wasDesired) this.store.removeSubs([internal]);
      this.tdToInternal.delete(rawTd);
      this.tdToInternal.delete(toTwelveSymbol(internal).toUpperCase());
      if (wasDesired || wasEphemeral || wasCore) releasedAny = true;
    }

    if (releasedAny) {
      // Immediately backfill released slots from connected clients' waiting views
      for (const [clientId, view] of this.clientViews) {
        if (this._activeUpstreamCount() >= this.maxUpstreamSymbols) break;
        const rawSyms = this._symbolsFromView(view);
        const eligible = this._filterUpstreamSymbolsForClient(clientId, rawSyms);
        if (eligible.length) {
          this.core.subscribe(clientId, eligible);
        }
      }
    }
  }

  /** Filter client view symbols so unauthenticated sockets can only subscribe upstream to known universe symbols. */
  _filterUpstreamSymbolsForClient(clientId, syms) {
    if (!Array.isArray(syms) || syms.length === 0) return [];
    const client = this.core.clients.get(clientId);
    const notRejected = syms.filter((s) => !this._isUpstreamRejected(s));
    if (client && typeof client.userId === "string" && client.userId) {
      return notRejected;
    }
    return notRejected.filter((s) => this._isKnownSymbol(s));
  }

  _symbolsFromView(view) {
    const syms = new Set();
    if (view && view.chart && view.chart.sym) {
      const s = normSymbol(view.chart.sym);
      if (s) syms.add(s);
    }
    if (view && Array.isArray(view.watchlist)) {
      for (const raw of view.watchlist) {
        const s = normSymbol(raw);
        if (s) syms.add(s);
      }
    }
    return [...syms];
  }

  _readAttachment(ws) {
    let att = null;
    try {
      att = typeof ws.deserializeAttachment === "function" ? ws.deserializeAttachment() : null;
    } catch {
      att = null;
    }
    if (att && typeof att === "object" && att.id) return att;
    const id = newClientId();
    const fresh = { id, seq: 0, view: {}, connectedAt: this.now() };
    this._persistAttachment(ws, fresh);
    return fresh;
  }

  _persistAttachment(ws, att) {
    if (typeof ws.serializeAttachment === "function") {
      try {
        ws.serializeAttachment(att);
      } catch {
        /* ignore */
      }
    }
  }

  /** Persist monotonic Protocol v2 sequence number to socket attachment (called on every frame sent, including HubCore.flush). */
  _persistClientSeq(id, seq) {
    const ws = this.socketById.get(id);
    if (!ws) return;
    const att = this._readAttachment(ws);
    if (Number.isSafeInteger(seq) && seq > (att.seq || 0)) {
      att.seq = seq;
      this._persistAttachment(ws, att);
    }
  }

  _sendToClient(id, type, payload, opts = {}) {
    return this.core.sendFrame(id, type, payload, opts);
  }

  _broadcastStatus(provenance, detail) {
    const asOf = this.lastUpstreamMsgAt || this.now();
    for (const id of this.core.clients.keys()) {
      this._sendToClient(id, "status", { provenance, asOf, detail });
    }
  }

  _broadcastBar(sym, tf, bar, closed) {
    const asOf = this.now();
    const tuple = toBarTuple(bar);
    for (const [id, view] of this.clientViews.entries()) {
      if (!view || !view.chart) continue;
      if (normSymbol(view.chart.sym) !== sym) continue;
      if ((normalizeTf(view.chart.tf) || "1m") !== tf) continue;
      this._sendToClient(id, "bar", {
        sym,
        tf,
        bar: tuple,
        closed: Boolean(closed),
        provenance: PROVENANCE.LIVE,
        asOf,
      });
    }
  }

  _broadcastIndicatorDeltas(sym, tf, deltas) {
    for (const [id, view] of this.clientViews.entries()) {
      if (!view || !view.chart) continue;
      if (normSymbol(view.chart.sym) !== sym) continue;
      if ((normalizeTf(view.chart.tf) || "1m") !== tf) continue;
      const wantedKeys = new Map();
      for (const spec of view.chart.ind || []) {
        const parsed = parseIndicatorSpec(spec);
        if (parsed) wantedKeys.set(indicatorKey(parsed.config), parsed.id);
      }
      if (!wantedKeys.size) continue;
      for (const d of deltas) {
        const clientIndId = wantedKeys.get(d.key);
        if (!clientIndId) continue;
        this._sendToClient(id, "ind", {
          sym,
          tf,
          id: clientIndId,
          point: { t: d.t, v: d.value },
        });
      }
    }
  }

  _broadcastAlerts(frames, triggers = []) {
    if (!frames || frames.length === 0 || this.core.clients.size === 0) return;
    for (let i = 0; i < frames.length; i++) {
      const item = frames[i];
      if (!item || typeof item !== "object") continue;
      const frame = item.frame && typeof item.frame === "object" ? item.frame : item;
      const sym = normSymbol(frame.sym);
      const payload = {
        id: frame.id,
        sym: frame.sym,
        condition: frame.condition,
        price: frame.price,
        triggeredAt: frame.triggeredAt,
      };
      if (frame.message !== undefined) {
        payload.message = frame.message;
      }
      // Read owner userId from zipped entry or paired trigger (NEVER placed on wire `payload`).
      const rawOwner = item.userId ?? triggers[i]?.userId ?? frame.userId;
      const ownerUserId = typeof rawOwner === "string" && rawOwner.trim() ? rawOwner.trim() : null;
      for (const [id, client] of this.core.clients.entries()) {
        if (!client || !client.syms || !client.syms.has(sym)) continue;
        // Fail closed: user-owned alerts ONLY deliver to sockets authenticated as that exact owner.
        if (ownerUserId && client.userId !== ownerUserId) continue;
        this._sendToClient(id, "alert", payload);
      }
    }
  }

  /** Cleanly release timers and upstream socket (for tests and graceful teardown). */
  destroy() {
    this._stopHeartbeat();
    this._clearReconnectTimer();
    this._teardownUpstreamSocket(true, "destroy");
    this.core.stop();
  }
}
