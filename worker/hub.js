// DEPRECATED (Phase A — Task 1/2): Superseded by workers/market/hub.js (`MarketHub` SQLite + Hibernation API).
// Scheduled for removal in Task 20 once Phase B/C cutover is complete. Do not modify.
// worker/hub.js — Durable Object. One instance ("global") holds every browser socket and the upstream feeds.
// Browser protocol (JSON, over WebSocket at /ws or SSE at /sse):
//   client -> {op:"sub", symbols:[..]} | {op:"unsub", symbols:[..]} | {op:"ping"}
//   server -> {type:"hello", v:1} | {type:"subscribed", accepted:[..], rejected:[..]} | {type:"ticks", d:[Tick..]} | {type:"pong"}
import { PROTOCOL, WS_PING_MS } from "../shared/constants.js";
import { HubCore } from "./hubCore.js";
import { Upstream } from "./upstream.js";

let seq = 0;

export class MarketHub {
  constructor(state, env) {
    this.core = new HubCore({ subscribe: (s) => this.up.subscribe(s), unsubscribe: (s) => this.up.unsubscribe(s) });
    this.up = new Upstream(env, (t) => this.core.onTick(t));
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/stats") return Response.json({ clients: this.core.clients.size, symbols: [...this.core.refs.keys()], ...this.core.stats });
    if (url.pathname === "/sse") return this.sse(url, req);
    if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const id = `c${++seq}`;
    this.core.addClient(id, (s) => server.send(s));
    server.send(JSON.stringify({ type: "hello", v: PROTOCOL }));
    const ping = setInterval(() => { try { server.send('{"type":"pong"}'); } catch { /* */ } }, WS_PING_MS);   // keeps idle proxies open
    const done = () => { clearInterval(ping); this.core.removeClient(id); };
    server.addEventListener("message", (e) => this.handle(id, e.data, (s) => server.send(s)));
    server.addEventListener("close", done);
    server.addEventListener("error", done);
    return new Response(null, { status: 101, webSocket: client });
  }

  sse(url, req) {
    const enc = new TextEncoder();
    const id = `s${++seq}`;
    let ctrl, keep;
    const stream = new ReadableStream({
      start: (c) => {
        ctrl = c;
        const send = (s) => c.enqueue(enc.encode(`data: ${s}\n\n`));
        this.core.addClient(id, send);
        send(JSON.stringify({ type: "hello", v: PROTOCOL }));
        const syms = (url.searchParams.get("symbols") || "").split(",").filter(Boolean);
        const r = this.core.subscribe(id, syms);
        send(JSON.stringify({ type: "subscribed", ...r }));
        keep = setInterval(() => { try { c.enqueue(enc.encode(": ka\n\n")); } catch { /* */ } }, WS_PING_MS);
      },
      cancel: () => { clearInterval(keep); this.core.removeClient(id); },
    });
    req.signal && req.signal.addEventListener("abort", () => { clearInterval(keep); this.core.removeClient(id); try { ctrl.close(); } catch { /* */ } });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  }

  handle(id, data, reply) {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m !== "object") return;
    if (m.op === "sub") reply(JSON.stringify({ type: "subscribed", ...this.core.subscribe(id, m.symbols) }));
    else if (m.op === "unsub") this.core.unsubscribe(id, m.symbols);
    else if (m.op === "ping") reply('{"type":"pong"}');
  }
}
