// worker/hubCore.js — transport-agnostic multiplexer. No Cloudflare APIs, so it is unit-testable in Node.
//
//   N browser clients ──► refcounted symbol set ──► ONE upstream subscription per symbol
//   upstream tick ──► zero-tolerance guard ──► coalesce (latest per symbol) ──► batched fan-out every HUB_FLUSH_MS
import { HUB_FLUSH_MS, MAX_SYMBOLS_PER_CLIENT, MAX_UPSTREAM_SYMBOLS } from "../shared/constants.js";
import { createTickGuard, normSymbol } from "../shared/schema.js";

export class HubCore {
  /**
   * @param {{subscribe(syms:string[]):void, unsubscribe(syms:string[]):void}} upstream
   * @param {{flushMs?:number, guard?:Function, setTimer?:Function, clearTimer?:Function}} [opts]
   */
  constructor(upstream, opts = {}) {
    this.up = upstream;
    this.flushMs = opts.flushMs ?? HUB_FLUSH_MS;
    this.guard = opts.guard || createTickGuard();
    this.setTimer = opts.setTimer || ((f, ms) => setInterval(f, ms));
    this.clearTimer = opts.clearTimer || ((h) => clearInterval(h));
    this.clients = new Map();   // id -> {send(str), syms:Set<string>}
    this.refs = new Map();      // sym -> number of clients
    this.pending = new Map();   // sym -> latest tick since last flush
    this.last = new Map();      // sym -> last delivered tick (replayed to new subscribers)
    this.timer = null;
    this.stats = { in: 0, dropped: 0, out: 0 };
  }

  addClient(id, send) { this.clients.set(id, { send, syms: new Set() }); this._timer(); }

  removeClient(id) {
    const c = this.clients.get(id);
    if (!c) return;
    this.unsubscribe(id, [...c.syms]);
    this.clients.delete(id);
    if (!this.clients.size) this._timer();
  }

  subscribe(id, symbols) {
    const c = this.clients.get(id);
    if (!c) return { accepted: [], rejected: symbols };
    const accepted = [], rejected = [], fresh = [];
    for (const raw of symbols || []) {
      const s = normSymbol(raw);
      if (!s) continue;
      if (c.syms.has(s)) { accepted.push(s); continue; }
      const over = c.syms.size >= MAX_SYMBOLS_PER_CLIENT || (!this.refs.has(s) && this.refs.size >= MAX_UPSTREAM_SYMBOLS);
      if (over) { rejected.push(s); continue; }
      c.syms.add(s); accepted.push(s);
      const n = (this.refs.get(s) || 0) + 1;
      this.refs.set(s, n);
      if (n === 1) fresh.push(s);
      const l = this.last.get(s);              // instant first paint from last known tick
      if (l) c.send(JSON.stringify({ type: "ticks", d: [l] }));
    }
    if (fresh.length) this.up.subscribe(fresh);
    return { accepted, rejected };
  }

  unsubscribe(id, symbols) {
    const c = this.clients.get(id);
    if (!c) return;
    const gone = [];
    for (const raw of symbols || []) {
      const s = normSymbol(raw);
      if (!c.syms.delete(s)) continue;
      const n = (this.refs.get(s) || 1) - 1;
      if (n <= 0) { this.refs.delete(s); this.pending.delete(s); this.last.delete(s); gone.push(s); }
      else this.refs.set(s, n);
    }
    if (gone.length) this.up.unsubscribe(gone);
  }

  /** Called by upstream connectors for every raw tick. */
  onTick(raw) {
    this.stats.in++;
    const t = this.guard(raw);
    if (!t) { this.stats.dropped++; return; }
    if (!this.refs.has(t.s)) return;
    this.pending.set(t.s, t);   // coalesce: only the newest tick per symbol per flush window
  }

  flush() {
    if (!this.pending.size) return;
    const batch = this.pending; this.pending = new Map();
    for (const [s, t] of batch) this.last.set(s, t);
    for (const c of this.clients.values()) {
      const d = [];
      for (const s of c.syms) { const t = batch.get(s); if (t) d.push(t); }
      if (d.length) { try { c.send(JSON.stringify({ type: "ticks", d })); this.stats.out += d.length; } catch { /* socket closing */ } }
    }
  }

  _timer() {
    if (this.clients.size && !this.timer) this.timer = this.setTimer(() => this.flush(), this.flushMs);
    else if (!this.clients.size && this.timer) { this.clearTimer(this.timer); this.timer = null; }
  }
}
