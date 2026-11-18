// worker/upstream.js — ONE outbound WebSocket per provider, shared by every browser client.
// Outbound WebSockets from a Worker/Durable Object are opened with fetch() + Upgrade header.
import { providerFor, toTwelveSymbol, normSymbol } from "../shared/schema.js";

const BINANCE_WS = ["https://data-stream.binance.vision/ws", "https://stream.binance.com:9443/ws"];

async function openWs(url) {
  const res = await fetch(url, { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`ws upgrade failed (${res.status})`);
  ws.accept();
  return ws;
}

/** Generic reconnecting connection that re-sends subscriptions after every reconnect. */
class Feed {
  constructor(name, { connect, onOpen, onMessage, sub, unsub, onTick }) {
    Object.assign(this, { name, connect, onOpen, onMessage, subMsg: sub, unsubMsg: unsub, onTick });
    this.syms = new Set(); this.ws = null; this.retry = 0; this.timer = null; this.connecting = false;
  }
  add(list) { list.forEach((s) => this.syms.add(s)); this._ensure(); this._send(this.subMsg(list)); }
  remove(list) { list.forEach((s) => this.syms.delete(s)); this._send(this.unsubMsg(list)); if (!this.syms.size) this._close(); }
  _send(m) { if (m && this.ws && this.ws.readyState === 1) try { this.ws.send(typeof m === "string" ? m : JSON.stringify(m)); } catch { /* reconnect handles it */ } }
  _close() { try { this.ws && this.ws.close(1000, "idle"); } catch { /* */ } this.ws = null; clearTimeout(this.timer); }
  async _ensure() {
    if (this.ws || this.connecting || !this.syms.size) return;
    this.connecting = true;
    try {
      const ws = await this.connect();
      this.ws = ws; this.retry = 0;
      ws.addEventListener("message", (e) => { try { this.onMessage(typeof e.data === "string" ? e.data : "", this.onTick); } catch { /* bad frame */ } });
      const lost = () => { if (this.ws === ws) { this.ws = null; this._schedule(); } };
      ws.addEventListener("close", lost); ws.addEventListener("error", lost);
      if (this.syms.size) this._send(this.subMsg([...this.syms]));
      this.onOpen && this.onOpen(ws);
    } catch (e) { this._schedule(); }
    finally { this.connecting = false; }
  }
  _schedule() {
    if (this.timer || !this.syms.size) return;
    const wait = Math.min(30000, 500 * 2 ** this.retry++) + Math.random() * 300;   // exponential backoff + jitter
    this.timer = setTimeout(() => { this.timer = null; this._ensure(); }, wait);
  }
}

export class Upstream {
  constructor(env, onTick) {
    this.td = new Map(); // "EUR/USD" -> internal symbol
    this.binance = new Feed("binance", {
      onTick,
      connect: async () => { let e; for (const u of BINANCE_WS) { try { return await openWs(u); } catch (x) { e = x; } } throw e; },
      sub: (l) => ({ method: "SUBSCRIBE", params: l.map((s) => `${s.toLowerCase()}@trade`), id: 1 }),
      unsub: (l) => ({ method: "UNSUBSCRIBE", params: l.map((s) => `${s.toLowerCase()}@trade`), id: 2 }),
      onMessage: (txt, emit) => {
        const m = JSON.parse(txt);
        if (m && m.e === "trade") emit({ s: m.s, c: m.p, t: m.T, v: m.q, src: "binance" });
      },
    });
    this.twelve = new Feed("twelvedata", {
      onTick,
      connect: async () => {
        if (!env.TWELVEDATA_KEY) throw new Error("TWELVEDATA_KEY not configured");
        return openWs(`https://ws.twelvedata.com/v1/quotes/price?apikey=${env.TWELVEDATA_KEY}`);
      },
      onOpen: (ws) => { this._hb = setInterval(() => { try { ws.send('{"action":"heartbeat"}'); } catch { /* */ } }, 10000); ws.addEventListener("close", () => clearInterval(this._hb)); },
      sub: (l) => ({ action: "subscribe", params: { symbols: l.map(toTwelveSymbol).join(",") } }),
      unsub: (l) => ({ action: "unsubscribe", params: { symbols: l.map(toTwelveSymbol).join(",") } }),
      onMessage: (txt, emit) => {
        const m = JSON.parse(txt);
        if (m.event !== "price") return;
        const s = this.td.get(m.symbol) || normSymbol(m.symbol);
        emit({ s, c: m.price, t: m.timestamp, bid: m.bid, ask: m.ask, src: "twelvedata" });
      },
    });
  }
  subscribe(syms) {
    const b = [], t = [];
    for (const s of syms) { if (providerFor(s) === "binance") b.push(s); else { this.td.set(toTwelveSymbol(s), s); t.push(s); } }
    if (b.length) this.binance.add(b);
    if (t.length) this.twelve.add(t);
  }
  unsubscribe(syms) {
    const b = [], t = [];
    for (const s of syms) { if (providerFor(s) === "binance") b.push(s); else t.push(s); }
    if (b.length) this.binance.remove(b);
    if (t.length) this.twelve.remove(t);
  }
}
