// workers/market/hubCore.js — transport-agnostic multiplexer (Protocol v2 + refcounted coalescing).
// Zero Cloudflare APIs so it is unit-testable in Node and reusable inside MarketHub DO.
//
//   N browser clients ──► refcounted symbol set (+ pinned upstream subs) ──► ONE upstream subscription per symbol
//   upstream tick ──► zero-tolerance guard ──► coalesce (latest per symbol) ──► batched fan-out <= 2 KB frames
import {
  HUB_FLUSH_MS,
  MAX_SYMBOLS_PER_CLIENT,
  MAX_UPSTREAM_SYMBOLS,
} from "../../shared/constants.js";
import { createTickGuard, normSymbol } from "../../shared/schema.js";
import {
  PROTOCOL_VERSION,
  PROVENANCE,
  createSequencer,
  makeFrame,
  packQuoteFrames,
} from "../../shared/protocol.js";

/**
 * Converts a normalized Tick into a Protocol v2 quote object.
 * @param {object} tick
 * @param {string} [provenance=PROVENANCE.LIVE]
 * @returns {object}
 */
export function tickToQuote(tick, provenance = PROVENANCE.LIVE) {
  const q = {
    s: tick.s,
    c: tick.c,
    t: tick.t,
    provenance,
  };
  if (tick.bid !== undefined) q.bid = tick.bid;
  if (tick.ask !== undefined) q.ask = tick.ask;
  if (tick.v !== undefined) q.v = tick.v;
  return q;
}

export class HubCore {
  /**
   * @param {{subscribe(syms:string[]):void, unsubscribe(syms:string[]):void}} upstream
   * @param {{
   *   flushMs?: number,
   *   guard?: Function,
   *   setTimer?: Function,
   *   clearTimer?: Function,
   *   maxSymbolsPerClient?: number,
   *   maxUpstreamSymbols?: number,
   *   protocolVersion?: 1 | 2,
   *   provenance?: string,
   *   onFrameSent?: (id: string, seq: number, frame: object) => void,
   * }} [opts]
   */
  constructor(upstream, opts = {}) {
    this.up = upstream;
    this.flushMs = opts.flushMs ?? HUB_FLUSH_MS;
    this.guard = opts.guard || createTickGuard();
    this.setTimer = opts.setTimer || ((f, ms) => setInterval(f, ms));
    this.clearTimer = opts.clearTimer || ((h) => clearInterval(h));
    this.maxSymbolsPerClient = opts.maxSymbolsPerClient ?? MAX_SYMBOLS_PER_CLIENT;
    this.maxUpstreamSymbols = opts.maxUpstreamSymbols ?? MAX_UPSTREAM_SYMBOLS;
    this.protocolVersion = opts.protocolVersion ?? PROTOCOL_VERSION;
    this.provenance = opts.provenance ?? PROVENANCE.LIVE;
    this.onFrameSent = typeof opts.onFrameSent === "function" ? opts.onFrameSent : null;
    this.onEvict = typeof opts.onEvict === "function" ? opts.onEvict : null;
    this.now = typeof opts.now === "function" ? opts.now : () => Date.now();

    this.clients = new Map(); // id -> { id, send(str), syms: Set<string>, seq: Sequencer }
    this.refs = new Map();    // sym -> number of browser clients subscribed
    this.pinned = new Set();  // upstream symbols kept active even with 0 browser clients
    this.lastAccessedAt = new Map(); // sym -> epoch ms last accessed/viewed
    this.pending = new Map(); // sym -> latest tick since last flush
    this.last = new Map();    // sym -> last accepted tick (replayed to new subscribers)
    this.timer = null;
    this.stats = { in: 0, dropped: 0, out: 0 };
  }

  /** Number of unique upstream symbols currently tracked (browser refs ∪ pinned). */
  upstreamCount() {
    let count = this.pinned.size;
    for (const s of this.refs.keys()) {
      if (!this.pinned.has(s)) count += 1;
    }
    return count;
  }

  /** Whether a symbol is already active upstream via refs or pinned set. */
  hasUpstreamSymbol(sym) {
    return this.refs.has(sym) || this.pinned.has(sym);
  }

  /** Sorted list of all active upstream symbols (refs ∪ pinned). */
  activeSymbols() {
    const all = new Set(this.pinned);
    for (const s of this.refs.keys()) all.add(s);
    return [...all].sort();
  }

  /**
   * Pin persisted upstream symbols so they remain subscribed and ingest ticks even when 0 browsers are connected.
   * Respects `maxUpstreamSymbols`.
   * @param {string[]} symbols
   * @returns {{accepted:string[], rejected:string[]}}
   */
  pinSymbols(symbols) {
    const accepted = [];
    const rejected = [];
    const fresh = [];

    for (const raw of symbols || []) {
      const s = normSymbol(raw);
      if (!s) continue;
      if (this.pinned.has(s)) {
        accepted.push(s);
        continue;
      }
      const alreadyUp = this.hasUpstreamSymbol(s);
      if (!alreadyUp && this.upstreamCount() >= this.maxUpstreamSymbols) {
        rejected.push(s);
        continue;
      }
      this.pinned.add(s);
      this.lastAccessedAt.set(s, this.now());
      accepted.push(s);
      if (!alreadyUp) fresh.push(s);
    }

    if (fresh.length) this.up.subscribe(fresh);
    return { accepted, rejected };
  }

  /**
   * Unpin upstream symbols; unsubscribes upstream only if no browser clients still reference them.
   * @param {string[]} symbols
   */
  unpinSymbols(symbols) {
    const gone = [];
    for (const raw of symbols || []) {
      const s = normSymbol(raw);
      if (!s || !this.pinned.delete(s)) continue;
      if (!this.refs.has(s)) {
        this.pending.delete(s);
        this.last.delete(s);
        this.lastAccessedAt.delete(s);
        gone.push(s);
      }
    }
    if (gone.length) this.up.unsubscribe(gone);
  }

  /**
   * Immediately release an upstream symbol slot (e.g. rejected in Twelve Data subscribe-status fails)
   * without discarding its last cached quote fallback.
   * @param {string} rawSym
   */
  releaseUpstreamSymbol(rawSym) {
    const s = normSymbol(rawSym);
    if (!s) return false;
    let released = false;
    if (this.pinned.delete(s)) released = true;
    if (this.refs.delete(s)) released = true;
    this.pending.delete(s);
    this.lastAccessedAt.delete(s);
    for (const c of this.clients.values()) {
      if (c.syms.delete(s)) released = true;
    }
    return released;
  }

  /**
   * Register a browser client connection.
   * @param {string} id
   * @param {(payload:string)=>void} send
   * @param {{startSeq?:number, userId?:string|null}} [opts]
   */
  addClient(id, send, opts = {}) {
    this.clients.set(id, {
      id,
      send,
      syms: new Set(),
      seq: createSequencer(opts.startSeq || 0),
      userId: typeof opts.userId === "string" && opts.userId.trim() ? opts.userId.trim() : null,
    });
    this._timer();
  }

  removeClient(id) {
    const c = this.clients.get(id);
    if (!c) return;
    this.unsubscribe(id, [...c.syms]);
    this.clients.delete(id);
    if (!this.clients.size) this._timer();
  }

  /** Next monotonic Protocol v2 sequence number for a client. */
  nextSeq(id) {
    const c = this.clients.get(id);
    return c ? c.seq.next() : 1;
  }

  /** Current sequence number for a client (useful for Hibernation serializeAttachment). */
  currentSeq(id) {
    const c = this.clients.get(id);
    return c ? c.seq.current() : 0;
  }

  /**
   * Construct and transmit a validated Protocol v2 server frame to a single client.
   * Returns the sent frame or null if the client is missing or sending failed.
   */
  sendFrame(id, type, payload, opts = {}) {
    const c = this.clients.get(id);
    if (!c) return null;
    const seq = opts.seq !== undefined ? opts.seq : (type === "pong" ? 0 : c.seq.next());
    const frame = makeFrame(type, payload, seq, opts);
    try {
      c.send(JSON.stringify(frame));
      if (this.onFrameSent) {
        try {
          this.onFrameSent(id, c.seq.current(), frame);
        } catch {
          /* ignore hook errors */
        }
      }
      return frame;
    } catch {
      return null;
    }
  }

  subscribe(id, symbols) {
    const c = this.clients.get(id);
    if (!c) return { accepted: [], rejected: Array.isArray(symbols) ? [...symbols] : [] };

    const accepted = [];
    const rejected = [];
    const fresh = [];
    const replay = [];

    const ts = this.now();
    const evicted = [];

    for (const raw of symbols || []) {
      const s = normSymbol(raw);
      if (!s) continue;
      if (c.syms.has(s)) {
        this.lastAccessedAt.set(s, ts);
        accepted.push(s);
        continue;
      }
      if (c.syms.size >= this.maxSymbolsPerClient) {
        rejected.push(s);
        continue;
      }
      const alreadyUp = this.hasUpstreamSymbol(s);
      if (!alreadyUp && this.upstreamCount() >= this.maxUpstreamSymbols) {
        // LRU eviction of least-recently-used pinned slot that currently has zero active viewers
        let victim = null;
        let oldestAt = Infinity;
        for (const cand of this.pinned) {
          if ((this.refs.get(cand) || 0) > 0) continue;
          const accessed = this.lastAccessedAt.get(cand) ?? 0;
          if (accessed < oldestAt) {
            oldestAt = accessed;
            victim = cand;
          }
        }
        if (victim) {
          this.pinned.delete(victim);
          this.pending.delete(victim);
          this.lastAccessedAt.delete(victim);
          // Retain `this.last.get(victim)` as cached quote fallback
          evicted.push(victim);
          if (this.onEvict) {
            try { this.onEvict(victim); } catch {}
          }
        } else {
          rejected.push(s);
          continue;
        }
      }
      c.syms.add(s);
      accepted.push(s);
      const n = (this.refs.get(s) || 0) + 1;
      this.refs.set(s, n);
      this.lastAccessedAt.set(s, ts);
      if (!alreadyUp) fresh.push(s);

      const lastTick = this.last.get(s);
      if (lastTick) replay.push(lastTick);
    }

    if (evicted.length) this.up.unsubscribe(evicted);
    if (replay.length) {
      this._sendTicksToClient(c, replay);
    }
    if (fresh.length) this.up.subscribe(fresh);
    return { accepted, rejected, evicted };
  }

  unsubscribe(id, symbols) {
    const c = this.clients.get(id);
    if (!c) return;
    const gone = [];
    for (const raw of symbols || []) {
      const s = normSymbol(raw);
      if (!c.syms.delete(s)) continue;
      const n = (this.refs.get(s) || 1) - 1;
      if (n <= 0) {
        this.refs.delete(s);
        if (!this.pinned.has(s)) {
          this.pending.delete(s);
          this.last.delete(s);
          gone.push(s);
        }
      } else {
        this.refs.set(s, n);
      }
    }
    if (gone.length) this.up.unsubscribe(gone);
  }

  /**
   * Atomically replaces a client's symbol subscriptions (ideal for Protocol v2 `view` updates).
   * @param {string} id
   * @param {string[]} symbols
   */
  setClientSymbols(id, symbols) {
    const c = this.clients.get(id);
    if (!c) return { accepted: [], rejected: Array.isArray(symbols) ? [...symbols] : [] };
    const nextSet = new Set();
    for (const raw of symbols || []) {
      const s = normSymbol(raw);
      if (s) nextSet.add(s);
    }
    const toRemove = [];
    for (const s of c.syms) {
      if (!nextSet.has(s)) toRemove.push(s);
    }
    if (toRemove.length) this.unsubscribe(id, toRemove);
    return this.subscribe(id, [...nextSet]);
  }

  /**
   * Called by upstream connectors for every raw tick.
   * Returns the accepted normalized tick (or null if dropped or unsubscribed).
   * @param {object} raw
   * @param {{acceptUnreferenced?:boolean}} [opts]
   */
  onTick(raw, opts = {}) {
    this.stats.in += 1;
    const t = this.guard(raw);
    if (!t) {
      this.stats.dropped += 1;
      return null;
    }
    if (!opts.acceptUnreferenced && !this.hasUpstreamSymbol(t.s)) return null;
    this.last.set(t.s, t);
    this.pending.set(t.s, t); // coalesce: only the newest tick per symbol per flush window
    return t;
  }

  /** Latest accepted tick for a symbol, if any. */
  getLastTick(sym) {
    return this.last.get(normSymbol(sym)) || null;
  }

  flush() {
    if (!this.pending.size) return;
    const batch = this.pending;
    this.pending = new Map();
    for (const [s, t] of batch) this.last.set(s, t);

    for (const c of this.clients.values()) {
      const d = [];
      for (const s of c.syms) {
        const t = batch.get(s);
        if (t) d.push(t);
      }
      if (d.length) {
        this._sendTicksToClient(c, d);
      }
    }
  }

  _sendTicksToClient(c, ticks) {
    if (this.protocolVersion === 1) {
      try {
        c.send(JSON.stringify({ type: "ticks", d: ticks }));
        this.stats.out += ticks.length;
      } catch {
        /* socket closing */
      }
      return;
    }

    const quotes = ticks.map((t) => tickToQuote(t, this.provenance));
    const frames = packQuoteFrames(quotes, () => c.seq.next());
    let lastSentFrame = null;
    for (const frame of frames) {
      try {
        c.send(JSON.stringify(frame));
        this.stats.out += frame.quotes.length;
        lastSentFrame = frame;
      } catch {
        /* socket closing */
        break;
      }
    }
    if (lastSentFrame && this.onFrameSent) {
      try {
        this.onFrameSent(c.id, c.seq.current(), lastSentFrame);
      } catch {
        /* ignore hook errors */
      }
    }
  }

  stop() {
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  _timer() {
    if (this.clients.size && !this.timer) {
      this.timer = this.setTimer(() => this.flush(), this.flushMs);
    } else if (!this.clients.size && this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }
}
