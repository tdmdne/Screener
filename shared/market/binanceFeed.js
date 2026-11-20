// shared/market/binanceFeed.js — resilient client for the public Binance `!miniTicker@arr` stream.
//
// Why this exists: Binance closes every market-data WebSocket after 24 h, can drop a connection at any time,
// and announces planned maintenance with a `serverShutdown` event. This class owns all of that so the hubs
// only see "rows in" and "health state out":
//   - exponential backoff with jitter (1 s, 2 s, 4 s ... capped at 60 s); the counter resets only after real
//     data arrives on the new socket, so a socket that opens and then goes silent keeps backing off
//   - make-before-break rotation shortly before the 24 h limit (and on `serverShutdown`): the new socket
//     is up and delivering before the old one is closed, so there is no gap
//   - stall watchdog: no frame for STALL_MS (the stream normally ticks every 1 s) forces a reconnect
//   - health states: LIVE (data flowing) / RECONNECTING (connecting or waiting to retry); `onState` fires on change only
//
// Workers-safe: no node: imports. Everything time- or network-related is injectable for deterministic tests.
import { STABLE_RE } from "../instruments.js";

export const BINANCE_MINI_TICKER_URLS = Object.freeze([
  "https://data-stream.binance.vision/ws/!miniTicker@arr",
  "https://stream.binance.com:9443/ws/!miniTicker@arr",
]);

export const BINANCE_BACKOFF_BASE_MS = 1_000;
export const BINANCE_BACKOFF_MAX_MS = 60_000;
/** Binance force-closes at 24 h; rotate at 23 h 50 m so we always choose the moment. */
export const BINANCE_ROTATE_MS = (23 * 60 + 50) * 60_000;
/** The array stream ticks about once a second; 20 s of silence means the socket is dead. */
export const BINANCE_STALL_MS = 20_000;
const WATCHDOG_MS = 5_000;

export const FEED_STATE = Object.freeze({ LIVE: "LIVE", RECONNECTING: "RECONNECTING" });

/** Default connector: Cloudflare outbound WebSocket via fetch() + Upgrade, trying each mirror in order. */
export async function connectBinanceWs(urls = BINANCE_MINI_TICKER_URLS) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { Upgrade: "websocket" } });
      const ws = res && res.webSocket;
      if (!ws) throw new Error(`Binance WS upgrade failed (HTTP ${res && res.status})`);
      if (typeof ws.accept === "function") ws.accept();
      return ws;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Binance WS unreachable");
}

/**
 * @typedef {{s:string,c:number,o:number,h:number,l:number,v:number,q:number,t:number}} MiniTickerRow
 */
export class BinanceMiniTickerFeed {
  /**
   * @param {object} opts
   * @param {(rows: MiniTickerRow[]) => void} opts.onRows  called with accepted rows for every frame
   * @param {(info: {state: string, detail: string, attempt: number, nextRetryMs: number}) => void} [opts.onState]
   * @param {(sym: string) => boolean} [opts.accept]  symbol filter (default: every non-stable `*USDT` pair)
   * @param {() => Promise<any>} [opts.connect]       resolves an accepted WebSocket-like (addEventListener/send/close)
   */
  constructor(opts = {}) {
    this.onRows = typeof opts.onRows === "function" ? opts.onRows : () => {};
    this.onState = typeof opts.onState === "function" ? opts.onState : () => {};
    this.accept = typeof opts.accept === "function" ? opts.accept : (s) => s.endsWith("USDT") && !STABLE_RE.test(s);
    this.connect = typeof opts.connect === "function" ? opts.connect : () => connectBinanceWs();
    this.now = typeof opts.now === "function" ? opts.now : () => Date.now();
    this.setTimeoutFn = opts.setTimeoutFn || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = opts.clearTimeoutFn || ((id) => clearTimeout(id));
    this.random = typeof opts.random === "function" ? opts.random : Math.random;
    this.rotateMs = Number(opts.rotateMs) > 0 ? Number(opts.rotateMs) : BINANCE_ROTATE_MS;
    this.stallMs = Number(opts.stallMs) > 0 ? Number(opts.stallMs) : BINANCE_STALL_MS;

    this.running = false;
    this.state = null; // null until started / after stop()
    this.ws = null;
    this.attempt = 0;
    this.connecting = false;
    this.lastMsgAt = 0;
    this.connectedAt = 0;
    this.reconnectTimer = null;
    this.rotateTimer = null;
    this.watchdogTimer = null;
    this.reconnects = 0; // lifetime counter for diagnostics
    this.rotations = 0;
    this.rotateFailures = 0;
    this.nextRetryAt = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    this._setState(FEED_STATE.RECONNECTING, "connecting");
    this._armWatchdog();
    void this._open("start");
  }

  stop() {
    this.running = false;
    this._clearTimers();
    const ws = this.ws;
    this.ws = null;
    this.connecting = false;
    if (ws) this._safeClose(ws, 1000, "stop");
    this.state = null;
  }

  /** Cheap health pass for a DO alarm: forces a reconnect on a stalled socket and revives a dead feed. */
  check() {
    if (!this.running) return;
    const now = this.now();
    if (this.ws && this.lastMsgAt > 0 && now - this.lastMsgAt > this.stallMs) {
      this._lost("stalled: no frames");
      return;
    }
    if (!this.ws && !this.connecting && this.reconnectTimer === null) void this._open("check");
  }

  snapshot() {
    return {
      state: this.state,
      attempt: this.attempt,
      reconnects: this.reconnects,
      rotations: this.rotations,
      lastMsgAt: this.lastMsgAt,
      nextRetryMs: this.reconnectTimer !== null ? Math.max(0, this.nextRetryAt - this.now()) : 0,
    };
  }

  // ---- internals -----------------------------------------------------------------------------

  _setState(state, detail) {
    if (this.state === state) return;
    this.state = state;
    try {
      this.onState({
        state,
        detail,
        attempt: this.attempt,
        nextRetryMs: this.reconnectTimer !== null ? Math.max(0, this.nextRetryAt - this.now()) : 0,
      });
    } catch {
      /* a listener must never break the feed */
    }
  }

  _clearTimers() {
    for (const k of ["reconnectTimer", "rotateTimer", "watchdogTimer"]) {
      if (this[k] !== null) {
        this.clearTimeoutFn(this[k]);
        this[k] = null;
      }
    }
  }

  _armWatchdog() {
    if (this.watchdogTimer !== null) this.clearTimeoutFn(this.watchdogTimer);
    this.watchdogTimer = this.setTimeoutFn(() => {
      this.watchdogTimer = null;
      if (!this.running) return;
      this.check();
      this._armWatchdog();
    }, WATCHDOG_MS);
  }

  _safeClose(ws, code, reason) {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  _backoffDelay() {
    const base = Math.min(BINANCE_BACKOFF_MAX_MS, BINANCE_BACKOFF_BASE_MS * 2 ** this.attempt);
    const jitter = Math.floor(this.random() * 250);
    return Math.min(BINANCE_BACKOFF_MAX_MS, base + jitter);
  }

  _scheduleReconnect(detail) {
    if (!this.running || this.reconnectTimer !== null) return;
    const delay = this._backoffDelay();
    this.attempt += 1;
    this.reconnects += 1;
    this.nextRetryAt = this.now() + delay;
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      void this._open("retry");
    }, delay);
    // state change AFTER the timer is armed so listeners see nextRetryMs
    this._setState(FEED_STATE.RECONNECTING, detail);
  }

  /** The current socket is gone or unusable: drop it and back off. */
  _lost(reason) {
    const ws = this.ws;
    this.ws = null;
    if (this.rotateTimer !== null) {
      this.clearTimeoutFn(this.rotateTimer);
      this.rotateTimer = null;
    }
    if (ws) this._safeClose(ws, 1000, "lost");
    this._scheduleReconnect(reason);
  }

  /**
   * Open a socket. For rotation (`rotate: true`) the old socket stays live until the new one delivers data.
   */
  async _open(reason, { rotate = false } = {}) {
    if (!this.running || this.connecting) return;
    if (!rotate && this.ws) return;
    this.connecting = true;
    let ws;
    try {
      ws = await this.connect();
    } catch {
      this.connecting = false;
      if (!this.running) return;
      if (rotate) {
        // keep serving from the old socket; try the rotation again shortly
        this.rotateTimer = this.setTimeoutFn(() => {
          this.rotateTimer = null;
          void this._open("rotate-retry", { rotate: true });
        }, Math.min(BINANCE_BACKOFF_MAX_MS, BINANCE_BACKOFF_BASE_MS * 2 ** Math.min(this.rotateFailures, 6)));
        this.rotateFailures += 1;
        return;
      }
      this._scheduleReconnect("connect failed");
      return;
    }
    this.connecting = false;
    if (!this.running) {
      this._safeClose(ws, 1000, "stopped");
      return;
    }

    const previous = rotate ? this.ws : null;
    let delivered = false;
    this.connectedAt = this.now();
    if (!rotate) {
      this.ws = ws;
      this.lastMsgAt = this.connectedAt; // grace period: stall clock starts at connect
    }

    ws.addEventListener("message", (evt) => {
      if (!this.running) return;
      if (!delivered) {
        delivered = true;
        if (rotate) {
          // make-before-break: the new socket is delivering, retire the old one
          const old = this.ws;
          this.ws = ws;
          this.rotations += 1;
          if (old && old !== ws) this._safeClose(old, 1000, "rotated");
        }
        this.attempt = 0; // healthy: first real data resets the backoff
        this.rotateFailures = 0;
        this._armRotation();
        this._setState(FEED_STATE.LIVE, rotate ? `rotated (${reason})` : "stream live");
      }
      if (this.ws !== ws) return; // stale socket
      this.lastMsgAt = this.now();
      this._handleFrame(typeof evt.data === "string" ? evt.data : "");
    });
    const onGone = () => {
      if (this.ws !== ws) return; // old or superseded socket: ignore
      this._lost("socket closed");
    };
    ws.addEventListener("close", onGone);
    ws.addEventListener("error", onGone);

    if (rotate && previous) {
      // If the replacement never delivers, the stall watchdog on the old socket still protects us; also bound the wait.
      this.setTimeoutFn(() => {
        if (!delivered && this.running) {
          this._safeClose(ws, 1000, "rotate-timeout");
        }
      }, this.stallMs);
    }
  }

  _armRotation() {
    if (this.rotateTimer !== null) this.clearTimeoutFn(this.rotateTimer);
    this.rotateTimer = this.setTimeoutFn(() => {
      this.rotateTimer = null;
      void this._open("24h-rotation", { rotate: true });
    }, this.rotateMs);
  }

  _handleFrame(text) {
    if (!text) return;
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    if (Array.isArray(m)) {
      const rows = [];
      const t = this.now();
      for (const r of m) {
        if (!r || typeof r.s !== "string") continue;
        const s = r.s.toUpperCase();
        if (!this.accept(s)) continue;
        const c = Number(r.c);
        if (!(c > 0)) continue;
        rows.push({ s, c, o: Number(r.o), h: Number(r.h), l: Number(r.l), v: Number(r.v), q: Number(r.q), t });
      }
      if (rows.length) {
        try {
          this.onRows(rows);
        } catch {
          /* consumer errors must not tear down the socket */
        }
      }
      return;
    }
    if (m && typeof m === "object" && m.e === "serverShutdown") {
      // Planned maintenance notice: move to a fresh connection now, without penalty.
      void this._open("serverShutdown", { rotate: true });
    }
  }
}
