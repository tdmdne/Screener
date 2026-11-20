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
    // Symbols served by a different upstream (e.g. Binance crypto) never consume Twelve Data slots.
    this.capExempt = typeof opts.capExempt === "function" ? opts.capExempt : () => false;
    this.now = typeof opts.now === "function" ? opts.now : () => Date.now();

    this.clients = new Map(); // id -> { id, send(str), syms: Set<string>, seq: Sequencer }
    this.refs = new Map();    // sym -> number of browser clients subscribed
    this.pinned = new Set();  // upstream symbols kept active even with 0 browser clients
    this.lastAccessedAt = new Map(); // sym -> epoch ms last accessed/viewed
    // Server-side LRU pool of Twelve Data WebSocket slots (capped at maxUpstreamSymbols = TD_WS_MAX). Map order is
    // recency: the first key is the least recently used. Cap-exempt (Binance) symbols never enter the pool.
    this.pool = new Map(); // sym -> epoch ms promoted
    this.pending = new Map(); // sym -> latest tick since last flush
    this.last = new Map();    // sym -> last accepted tick (replayed to new subscribers)
    this.timer = null;
    this.stats = { in: 0, dropped: 0, out: 0 };
  }

  /** Twelve Data WebSocket slots in use (the LRU pool). */
  upstreamCount() {
    return this.pool.size;
  }

  /** Whether ticks for `sym` are being ingested: in the TD LRU pool, or a referenced/pinned cap-exempt symbol. */
  hasUpstreamSymbol(sym) {
    if (this.capExempt(sym)) return this.refs.has(sym) || this.pinned.has(sym);
    return this.pool.has(sym);
  }

  /** Sorted list of all symbols currently streamed (TD pool plus referenced/pinned cap-exempt symbols). */
  activeSymbols() {
    const all = new Set(this.pool.keys());
    for (const s of this.refs.keys()) if (this.capExempt(s)) all.add(s);
    for (const s of this.pinned) if (this.capExempt(s)) all.add(s);
    return [...all].sort();
  }

  /** TD pool symbols from least to most recently used. */
  poolSymbols() {
    return [...this.pool.keys()];
  }

  /**
   * Promote symbols to most-recently-used in the TD WebSocket pool (later entries end up more recent). When the pool
   * is full the least-recently-used symbol is evicted: `onEvict(victim)` runs first (the hub persists its last quote),
   * then the upstream unsubscribe and subscribe frames are sent. Only the last `maxUpstreamSymbols` requested symbols
   * are promoted, so one call never evicts a symbol it just added.
   * @param {string[]} symbols
   * @returns {{ fresh: string[], evicted: string[] }}
   */
  promote(symbols, opts = {}) {
    const want = [];
    for (const raw of symbols || []) {
      const s = normSymbol(raw);
      if (!s || this.capExempt(s)) continue;
      const at = want.indexOf(s);
      if (at >= 0) want.splice(at, 1);
      want.push(s);
    }
    const list = this.maxUpstreamSymbols > 0 ? want.slice(-this.maxUpstreamSymbols) : [];
    const fresh = [];
    const evicted = [];
    const ts = this.now();
    for (const s of list) {
      if (this.pool.has(s)) {
        this.pool.delete(s);
        this.pool.set(s, ts);
        this.lastAccessedAt.set(s, ts);
        continue;
      }
      while (this.pool.size >= this.maxUpstreamSymbols) {
        const victim = this.pool.keys().next().value;
        this.pool.delete(victim);
        this.pending.delete(victim);
        this.lastAccessedAt.delete(victim);
        this.pinned.delete(victim);
        // `this.last` keeps the victim's final tick as an in-memory quote fallback.
        evicted.push(victim);
        if (this.onEvict) {
          try { this.onEvict(victim); } catch {}
        }
      }
      this.pool.set(s, ts);
      this.lastAccessedAt.set(s, ts);
      fresh.push(s);
    }
    if (opts.notify !== false) {
      if (evicted.length) this.up.unsubscribe(evicted);
      if (fresh.length) this.up.subscribe(fresh);
    }
    return { fresh, evicted };
  }

  /**
   * Pin persisted/seed upstream symbols: TD symbols are promoted into the LRU pool (still evictable); cap-exempt ones
   * stay subscribed even with 0 browsers.
   * @param {string[]} symbols
   * @returns {{accepted:string[], rejected:string[]}}
   */
  pinSymbols(symbols) {
    const accepted = [];
    const exemptFresh = [];
    const td = [];
    for (const raw of symbols || []) {
      const s = normSymbol(raw);
      if (!s) continue;
      if (this.capExempt(s)) {
        if (!this.hasUpstreamSymbol(s)) exemptFresh.push(s);
      } else {
        td.push(s);
      }
      this.pinned.add(s);
      accepted.push(s);
    }
    if (exemptFresh.length) this.up.subscribe(exemptFresh);
    if (td.length) this.promote(td);
    return { accepted, rejected: [] };
  }

  /**
   * Unpin symbols. TD symbols stay in the LRU pool until evicted; cap-exempt ones unsubscribe when unreferenced.
   * @param {string[]} symbols
   */
  unpinSymbols(symbols) {
    const gone = [];
    for (const raw of symbols || []) {
      const s = normSymbol(raw);
      if (!s || !this.pinned.delete(s)) continue;
      if (this.capExempt(s) && !this.refs.has(s)) {
        this.pending.delete(s);
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
    if (this.pool.delete(s)) released = true;
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

  /**
   * Subscribe a browser client to symbols (fan-out), given in PRIORITY order (first = chart symbol). Never rejected for
   * the TD cap: Twelve Data symbols are promoted in the server-side LRU pool so the first entry becomes most recently
   * used; they get live ticks while they hold a slot, and outside it the hub serves their cached quote.
   * @param {string} id
   * @param {string[]} symbols
   */
  subscribe(id, symbols) {
    const c = this.clients.get(id);
    if (!c) return { accepted: [], rejected: Array.isArray(symbols) ? [...symbols] : [], evicted: [] };

    const accepted = [];
    const rejected = [];
    const exemptFresh = [];
    const replay = [];
    const td = [];
    const ts = this.now();

    for (const raw of symbols || []) {
      const s = normSymbol(raw);
      if (!s) continue;
      if (!c.syms.has(s)) {
        if (c.syms.size >= this.maxSymbolsPerClient) {
          rejected.push(s);
          continue;
        }
        const alreadyUp = this.hasUpstreamSymbol(s);
        c.syms.add(s);
        this.refs.set(s, (this.refs.get(s) || 0) + 1);
        if (this.capExempt(s) && !alreadyUp) exemptFresh.push(s);
        const lastTick = this.last.get(s);
        if (lastTick) replay.push(lastTick);
      }
      this.lastAccessedAt.set(s, ts);
      accepted.push(s);
      if (!this.capExempt(s)) td.push(s);
    }

    if (replay.length) this._sendTicksToClient(c, replay);
    // One upstream subscribe for everything new (TD slots first, then cap-exempt), as before the LRU pool.
    const { fresh, evicted } = td.length ? this.promote(td.reverse(), { notify: false }) : { fresh: [], evicted: [] };
    if (evicted.length) this.up.unsubscribe(evicted);
    const toSubscribe = [...fresh, ...exemptFresh];
    if (toSubscribe.length) this.up.subscribe(toSubscribe);
    return { accepted, rejected, evicted };
  }

  /**
   * Remove a client's interest. Twelve Data symbols keep their pool slot (and keep streaming into the quote cache)
   * until LRU eviction; cap-exempt symbols unsubscribe once no client references them.
   */
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
        if (this.capExempt(s) && !this.pinned.has(s)) {
          this.pending.delete(s);
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
