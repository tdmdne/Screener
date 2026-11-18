// worker/cache.js — in-memory TTL cache with stale-on-error and in-flight de-duplication.
// Lives per Worker isolate: it is a best-effort shield, not durable storage.

export class MemoryCache {
  constructor(max = 500) { this.max = max; this.m = new Map(); this.inflight = new Map(); }

  _get(key) {
    const e = this.m.get(key);
    if (!e) return null;
    this.m.delete(key); this.m.set(key, e); // LRU touch
    return e;
  }
  set(key, value, ttlMs, staleMs = 6 * 3600_000) {
    const now = Date.now();
    this.m.set(key, { value, fresh: now + ttlMs, stale: now + ttlMs + staleMs, at: now });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value);
  }

  /**
   * Return {value, state:"HIT"|"MISS"|"STALE", ageMs}.
   * - fresh entry: served directly
   * - otherwise `loader()` runs (concurrent callers share one promise)
   * - if the loader throws and a stale entry exists, the stale value is served instead of an error
   */
  async wrap(key, ttlMs, loader, { staleMs } = {}) {
    const now = Date.now();
    const e = this._get(key);
    if (e && e.fresh > now) return { value: e.value, state: "HIT", ageMs: now - e.at };
    let p = this.inflight.get(key);
    if (!p) {
      p = loader().then(
        (v) => { this.set(key, v, ttlMs, staleMs); return v; },
      ).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    try {
      const value = await p;
      return { value, state: "MISS", ageMs: 0 };
    } catch (err) {
      const s = this.m.get(key);
      if (s && s.stale > Date.now()) return { value: s.value, state: "STALE", ageMs: Date.now() - s.at, error: String(err && err.message || err) };
      throw err;
    }
  }
}
