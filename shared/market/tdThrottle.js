// shared/market/tdThrottle.js — hard budget for Twelve Data WebSocket subscribe/unsubscribe events.
// Twelve Data allows ~100 subscription events per minute per connection; every symbol in a subscribe or unsubscribe
// message is counted as one event here (conservative). A token bucket (default 80/min) guarantees the ceiling however
// fast users click; anything over budget waits in a queue where opposite actions cancel out (A subscribed then dropped
// before it was ever sent costs nothing). Fan-out to browser sockets is unaffected (one upstream stream per symbol).

export const TD_EVENTS_PER_MIN = 80;

/**
 * @param {{ capacity?: number, perMinute?: number, now?: () => number }} [opts]
 */
export function createTdThrottle(opts = {}) {
  const capacity = Number.isFinite(opts.capacity) && opts.capacity > 0 ? opts.capacity : TD_EVENTS_PER_MIN;
  const perMs = (Number.isFinite(opts.perMinute) && opts.perMinute > 0 ? opts.perMinute : capacity) / 60000;
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  let tokens = capacity;
  let at = now();
  const live = new Set(); // subscribed upstream (as far as we have sent)
  const pendSub = new Set();
  const pendUnsub = new Set();

  function refill() {
    const t = now();
    if (t > at) {
      tokens = Math.min(capacity, tokens + (t - at) * perMs);
      at = t;
    }
  }

  function enqueue(kind, syms) {
    for (const s of syms || []) {
      if (!s) continue;
      if (kind === "subscribe") {
        if (pendUnsub.delete(s)) continue; // still live upstream: cancel the queued unsubscribe
        if (!live.has(s)) pendSub.add(s);
      } else {
        if (pendSub.delete(s)) continue; // never sent: cancel the queued subscribe
        if (live.has(s)) pendUnsub.add(s);
      }
    }
  }

  /** Release what the budget allows right now (subscribes first: they serve viewers). */
  function take() {
    refill();
    const subscribe = [];
    const unsubscribe = [];
    for (const s of [...pendSub]) {
      if (tokens < 1) break;
      tokens -= 1;
      pendSub.delete(s);
      live.add(s);
      subscribe.push(s);
    }
    for (const s of [...pendUnsub]) {
      if (tokens < 1) break;
      tokens -= 1;
      pendUnsub.delete(s);
      live.delete(s);
      unsubscribe.push(s);
    }
    return { subscribe, unsubscribe };
  }

  /** ms until the next queued event can go out (null when nothing is queued). */
  function waitMs() {
    if (!pendSub.size && !pendUnsub.size) return null;
    refill();
    return tokens >= 1 ? 0 : Math.ceil((1 - tokens) / perMs);
  }

  /** New upstream connection: nothing is live and the queue is rebuilt by the caller's resubscribe. */
  function reset() {
    live.clear();
    pendSub.clear();
    pendUnsub.clear();
  }

  return {
    enqueue,
    take,
    waitMs,
    reset,
    stats: () => ({ tokens: Math.floor(tokens), capacity, queued: pendSub.size + pendUnsub.size, live: live.size }),
  };
}
