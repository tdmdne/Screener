// client/services/dataService.js — the ONLY module that talks to the network for market data.
// It speaks to your own Worker proxy (same origin or PROXY_URL). No third-party URLs, no API keys.
//
//   import { createDataService } from "./client/services/dataService.js";
//   const data = createDataService({ baseUrl: "https://vektor-proxy.<you>.workers.dev" });  // "" = same origin
//   data.onTicks((latest) => { for (const s in latest) updateRow(s, latest[s]); });           // once per frame
//   data.onStatus((st) => setBadge(st));                                                      // "connecting" | "live" | "sse" | "offline"
//   data.subscribe(["EURUSD", "BTCUSDT"]);
//   const bars = await data.getCandles("EURUSD", "1m", 300);                                  // cached + stale-fallback server-side
import { CLIENT_RING_SIZE } from "../../shared/constants.js";
import { createTickGuard, cleanBars, normSymbol } from "../../shared/schema.js";
import { TickRing, createFlusher } from "./tickBuffer.js";

export function createDataService(opts = {}) {
  const base = String(opts.baseUrl ?? "").replace(/\/$/, "");
  const WS = opts.WebSocket || (typeof WebSocket !== "undefined" ? WebSocket : null);
  const ES = opts.EventSource || (typeof EventSource !== "undefined" ? EventSource : null);
  const doFetch = opts.fetch || ((...a) => fetch(...a));
  const guard = createTickGuard();                // second line of defence; the Worker already filters
  const ring = new TickRing(opts.ringSize || CLIENT_RING_SIZE);
  const tickCbs = new Set(), statusCbs = new Set();
  const wanted = new Set();                       // symbols the UI wants; replayed after every reconnect
  const lastCandles = new Map();                  // "SYM|tf" -> bars, client-side stale fallback

  let ws = null, es = null, status = "offline", retry = 0, timer = null, wsFails = 0, closed = false;

  const flusher = createFlusher(ring, (latest, all) => { for (const cb of tickCbs) { try { cb(latest, all); } catch (e) { console.error(e); } } }, opts);

  const setStatus = (s) => { if (s !== status) { status = s; statusCbs.forEach((cb) => cb(s)); } };
  const wsUrl = () => (base ? base.replace(/^http/, "ws") : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`) + "/ws";

  function ingest(msg) {
    if (!msg || msg.type !== "ticks" || !Array.isArray(msg.d)) return;
    for (const raw of msg.d) { const t = guard(raw); if (t) ring.push(t); }
    flusher.schedule();
  }

  function connectWs() {
    if (closed || !WS) return connectSse();
    setStatus("connecting");
    try { ws = new WS(wsUrl()); } catch { return failWs(); }
    ws.onopen = () => { wsFails = 0; retry = 0; setStatus("live"); if (wanted.size) ws.send(JSON.stringify({ op: "sub", symbols: [...wanted] })); };
    ws.onmessage = (e) => { try { ingest(JSON.parse(e.data)); } catch { /* ignore malformed */ } };
    ws.onclose = ws.onerror = () => { if (ws) { ws.onclose = ws.onerror = null; ws = null; failWs(); } };
  }

  function failWs() {
    if (closed) return;
    setStatus("offline");
    if (++wsFails >= 3 && ES) return connectSse();         // WebSockets blocked by a corporate proxy? fall back to SSE
    scheduleReconnect(connectWs);
  }

  function connectSse() {
    if (closed || !ES) return;
    if (es) es.close();
    es = new ES(`${base}/sse?symbols=${encodeURIComponent([...wanted].join(","))}`);
    es.onopen = () => { retry = 0; setStatus("sse"); };
    es.onmessage = (e) => { try { ingest(JSON.parse(e.data)); } catch { /* */ } };
    es.onerror = () => { es.close(); es = null; setStatus("offline"); scheduleReconnect(connectSse); };
  }

  function scheduleReconnect(fn) {
    clearTimeout(timer);
    timer = setTimeout(fn, Math.min(30000, 500 * 2 ** retry++) + Math.random() * 250);   // exponential backoff + jitter
  }

  function sendOp(op, symbols) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ op, symbols })); }

  async function getJson(path, { retries = 1, timeoutMs = 8000 } = {}) {
    let last;
    for (let i = 0; i <= retries; i++) {
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const to = ctl && setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const r = await doFetch(base + path, ctl ? { signal: ctl.signal } : undefined);
        const body = await r.json();
        if (r.ok || (body && Array.isArray(body.bars))) return body;
        last = new Error(body && body.error || `HTTP ${r.status}`);
      } catch (e) { last = e; } finally { if (to) clearTimeout(to); }
      await new Promise((res) => setTimeout(res, 300 * (i + 1)));
    }
    throw last;
  }

  return {
    /** Start the single shared connection (idempotent). Called automatically by subscribe(). */
    connect() { closed = false; if (!ws && !es) connectWs(); },
    close() { closed = true; clearTimeout(timer); flusher.cancel(); if (ws) { ws.onclose = ws.onerror = null; ws.close(); ws = null; } if (es) { es.close(); es = null; } setStatus("offline"); },

    subscribe(symbols) {
      const add = [];
      for (const r of [].concat(symbols)) { const s = normSymbol(r); if (s && !wanted.has(s)) { wanted.add(s); add.push(s); } }
      this.connect();
      if (add.length) { sendOp("sub", add); if (es && !ws) connectSse(); }   // SSE carries its symbol list in the URL
    },
    unsubscribe(symbols) {
      const rm = [];
      for (const r of [].concat(symbols)) { const s = normSymbol(r); if (wanted.delete(s)) rm.push(s); }
      if (rm.length) sendOp("unsub", rm);
    },

    onTicks(cb) { tickCbs.add(cb); return () => tickCbs.delete(cb); },
    onStatus(cb) { statusCbs.add(cb); cb(status); return () => statusCbs.delete(cb); },

    /** Historical bars via the proxy. On failure returns the last good copy (flagged stale) instead of throwing. */
    async getCandles(symbol, tf = "1m", limit = 300) {
      const s = normSymbol(symbol), key = `${s}|${tf}`;
      try {
        const d = await getJson(`/api/candles?symbol=${s}&tf=${tf}&limit=${limit}`);
        const bars = cleanBars(d.bars);
        if (bars.length) lastCandles.set(key, bars);
        return { bars: bars.length ? bars : lastCandles.get(key) || [], stale: d.cache === "STALE" || !bars.length, cache: d.cache };
      } catch (e) {
        if (lastCandles.has(key)) return { bars: lastCandles.get(key), stale: true, cache: "CLIENT", error: String(e.message || e) };
        throw e;
      }
    },
    async getQuote(symbol) { return getJson(`/api/quote?symbol=${normSymbol(symbol)}`); },
    health() { return getJson("/api/health", { retries: 0 }); },

    get status() { return status; },
    get droppedTicks() { return ring.overflow; },
  };
}
