// client/services/tickBuffer.js — fixed-size ring buffer of ticks, drained once per animation frame.
// Producers (the socket) push at any rate; consumers (the UI) see at most one batch per frame,
// so a burst of 10k ticks costs one render, not 10k.

export class TickRing {
  constructor(size = 4096) { this.size = size; this.buf = new Array(size); this.head = 0; this.count = 0; this.overflow = 0; }

  push(t) {
    const i = (this.head + this.count) % this.size;
    if (this.count === this.size) { this.head = (this.head + 1) % this.size; this.overflow++; }  // drop oldest
    else this.count++;
    this.buf[i] = t;
  }

  /** Remove and return everything, oldest first. */
  drain() {
    const out = new Array(this.count);
    for (let i = 0; i < this.count; i++) { const j = (this.head + i) % this.size; out[i] = this.buf[j]; this.buf[j] = undefined; }
    this.head = 0; this.count = 0;
    return out;
  }
}

/**
 * Drains `ring` on requestAnimationFrame and calls onFlush(latestBySymbol, allTicks).
 * Pauses itself when the ring is empty (no idle rAF loop) and falls back to setTimeout where rAF is missing.
 * Hidden tabs: browsers throttle rAF to 0, so the ring keeps the newest ticks and flushes when visible again.
 */
export function createFlusher(ring, onFlush, { raf, caf } = {}) {
  const R = raf || (typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f) => setTimeout(() => f(Date.now()), 16));
  const C = caf || (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout);
  let h = null;
  const run = () => {
    h = null;
    if (!ring.count) return;
    const all = ring.drain();
    const latest = Object.create(null);
    for (const t of all) latest[t.s] = t;   // ring is ordered oldest→newest
    onFlush(latest, all);
  };
  return {
    schedule() { if (h === null) h = R(run); },
    cancel() { if (h !== null) { C(h); h = null; } },
  };
}
