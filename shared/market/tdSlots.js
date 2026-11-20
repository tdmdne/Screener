// shared/market/tdSlots.js — Free-tier-resilient Twelve Data WebSocket slot manager.
// Shared single source of truth for Node (server.js) and Cloudflare Workers (worker.js / MarketHub):
// 1. Strict TD_WS_MAX cap (default 8) with LRU eviction (`lastAccessedAt`) of zero-viewer slots.
// 2. Exact internal <-> Twelve Data symbol mapping (BTCUSDT -> BTC/USD, EURUSD -> EUR/USD).
// 3. Immediate slot release + cooldown on `subscribe-status` `fails` so non-trial symbols never block valid tickers.

import { normSymbol, toTwelveSymbol } from "../schema.js";

export const DEFAULT_TD_WS_MAX = 8;
export const DEFAULT_FAIL_COOLDOWN_MS = 10 * 60 * 1000; // 10 min cooldown for Basic-plan rejected symbols

export class TdSubscriptionManager {
  /**
   * @param {{ maxSlots?: number, failCooldownMs?: number, now?: () => number }} [opts]
   */
  constructor(opts = {}) {
    this.maxSlots = Math.max(1, Number(opts.maxSlots) || DEFAULT_TD_WS_MAX);
    this.failCooldownMs = Math.max(1000, Number(opts.failCooldownMs) || DEFAULT_FAIL_COOLDOWN_MS);
    this.now = typeof opts.now === "function" ? opts.now : () => Date.now();

    /** @type {Map<string, { sym: string, tdSym: string, subscribedAt: number, lastAccessedAt: number }>} */
    this.active = new Map();
    /** @type {Map<string, string>} uppercase Twelve Data symbol ("BTC/USD") -> internal ("BTCUSDT") */
    this.tdToInternal = new Map();
    /** @type {Map<string, number>} internal symbol -> epoch ms until retry allowed */
    this.failedUntil = new Map();
  }

  size() {
    return this.active.size;
  }

  has(rawSym) {
    const s = normSymbol(rawSym);
    return !!s && this.active.has(s);
  }

  getActiveSymbols() {
    return [...this.active.keys()];
  }

  getEntry(rawSym) {
    const s = normSymbol(rawSym);
    return s ? this.active.get(s) || null : null;
  }

  isRejected(rawSym, ts = this.now()) {
    const s = normSymbol(rawSym);
    if (!s) return false;
    const until = this.failedUntil.get(s);
    if (!until) return false;
    if (ts >= until) {
      this.failedUntil.delete(s);
      return false;
    }
    return true;
  }

  /** Touch `lastAccessedAt` for a currently active symbol. */
  touch(rawSym, ts = this.now()) {
    const s = normSymbol(rawSym);
    const entry = s ? this.active.get(s) : null;
    if (entry) entry.lastAccessedAt = ts;
  }

  /** Translate an upstream Twelve Data symbol ("BTC/USD", "EUR/USD") back to internal ("BTCUSDT", "EURUSD"). */
  resolveInternal(rawTdSym) {
    const key = String(rawTdSym || "").trim().toUpperCase();
    if (!key) return "";
    const mapped = this.tdToInternal.get(key);
    if (mapped) return mapped;
    // Check active entries directly in case casing differed
    for (const entry of this.active.values()) {
      if (entry.tdSym.toUpperCase() === key) return entry.sym;
    }
    return normSymbol(key);
  }

  /**
   * Reconcile desired client views against `maxSlots` using LRU eviction of zero-viewer slots.
   *
   * Rules:
   * - Never eagerly evicts warm symbols while `active.size < maxSlots`.
   * - Updates `lastAccessedAt` on every symbol currently viewed or requested.
   * - When a new symbol is requested and `active.size >= maxSlots`, evicts the least-recently-used
   *   (`lastAccessedAt` ascending) active symbol with `viewerCount === 0`, unsubscribing it upstream
   *   and admitting the newly requested symbol.
   * - If all slots currently have active viewers (`viewerCount > 0`), a newly requested active chart
   *   symbol may still displace the least-recently-used non-chart watchlist symbol so the open chart
   *   always streams live ticks; otherwise new symbols are deferred to cached `liveQuotes` / REST snapshots.
   *
   * @param {{
   *   chartSymbols?: Iterable<string>,
   *   requestedSymbols?: Iterable<string>,
   *   activeViewers?: Map<string, number>
   * }} params
   * @returns {{
   *   toUnsubscribe: Array<{ sym: string, tdSym: string }>,
   *   toSubscribe: Array<{ sym: string, tdSym: string }>,
   *   evicted: string[],
   *   deferred: string[]
   * }}
   */
  reconcile({ chartSymbols = [], requestedSymbols = [], activeViewers = new Map() } = {}) {
    const ts = this.now();

    // Normalize viewer counts and chart priority set
    const viewers = new Map();
    for (const [raw, count] of activeViewers instanceof Map ? activeViewers.entries() : Object.entries(activeViewers || {})) {
      const s = normSymbol(raw);
      if (s && Number(count) > 0) viewers.set(s, Number(count));
    }

    const chartSet = new Set();
    for (const raw of chartSymbols) {
      const s = normSymbol(raw);
      if (s) chartSet.add(s);
    }

    // Build deduplicated priority order: active charts first, then remaining requested symbols
    const priority = [];
    const seen = new Set();
    const pushReq = (raw) => {
      const s = normSymbol(raw);
      if (!s || seen.has(s)) return;
      seen.add(s);
      priority.push(s);
    };
    for (const s of chartSet) pushReq(s);
    for (const raw of requestedSymbols) pushReq(raw);

    // Update lastAccessedAt for every currently active symbol that has live viewers or is requested now
    for (const [sym, entry] of this.active) {
      if ((viewers.get(sym) || 0) > 0 || seen.has(sym)) {
        entry.lastAccessedAt = ts;
      }
    }

    const toUnsubscribe = [];
    const toSubscribe = [];
    const evicted = [];
    const deferred = [];

    for (const sym of priority) {
      if (this.active.has(sym)) {
        this.active.get(sym).lastAccessedAt = ts;
        continue;
      }
      if (this.isRejected(sym, ts)) {
        deferred.push(sym);
        continue;
      }

      const tdSym = toTwelveSymbol(sym);
      if (!tdSym) continue;

      if (this.active.size >= this.maxSlots) {
        const victim = this._pickEvictionVictim(viewers, chartSet, chartSet.has(sym));
        if (!victim) {
          deferred.push(sym);
          continue;
        }
        this.active.delete(victim.sym);
        toUnsubscribe.push({ sym: victim.sym, tdSym: victim.tdSym });
        evicted.push(victim.sym);
      }

      const entry = { sym, tdSym, subscribedAt: ts, lastAccessedAt: ts };
      this.active.set(sym, entry);
      this.tdToInternal.set(tdSym.toUpperCase(), sym);
      toSubscribe.push({ sym, tdSym });
    }

    return { toUnsubscribe, toSubscribe, evicted, deferred };
  }

  /**
   * Pick the best eviction victim when `active.size >= maxSlots`.
   * 1. Always prefers symbols with 0 active viewers, ordered by oldest `lastAccessedAt` (LRU).
   * 2. Only if zero-viewer pool is empty AND the incoming request is an active chart symbol,
   *    allows displacing a non-chart watchlist symbol with lowest viewer count, then oldest `lastAccessedAt`.
   */
  _pickEvictionVictim(viewers, chartSet, incomingIsChart) {
    const zeroViewerCandidates = [];
    const passiveCandidates = [];

    for (const entry of this.active.values()) {
      const vCount = viewers.get(entry.sym) || 0;
      if (vCount === 0) {
        zeroViewerCandidates.push(entry);
      } else if (incomingIsChart && !chartSet.has(entry.sym)) {
        passiveCandidates.push({ entry, vCount });
      }
    }

    if (zeroViewerCandidates.length > 0) {
      zeroViewerCandidates.sort(
        (a, b) => a.lastAccessedAt - b.lastAccessedAt || a.subscribedAt - b.subscribedAt
      );
      return zeroViewerCandidates[0];
    }

    if (passiveCandidates.length > 0) {
      passiveCandidates.sort(
        (a, b) =>
          a.vCount - b.vCount ||
          a.entry.lastAccessedAt - b.entry.lastAccessedAt ||
          a.entry.subscribedAt - b.entry.subscribedAt
      );
      return passiveCandidates[0].entry;
    }

    return null;
  }

  /**
   * Process Twelve Data `subscribe-status` event.
   * Immediately releases any slot present in `fails` and places it in cooldown so
   * non-trial symbols on the Basic plan never block valid trial tickers.
   *
   * @param {object} msg
   * @returns {{ released: string[], succeeded: string[] }}
   */
  handleSubscribeStatus(msg) {
    const released = [];
    const succeeded = [];
    if (!msg || typeof msg !== "object") return { released, succeeded };

    const ts = this.now();

    if (Array.isArray(msg.success)) {
      for (const item of msg.success) {
        const rawTd = String(
          typeof item === "string" ? item : (item && (item.symbol || item.s)) || ""
        )
          .trim()
          .toUpperCase();
        if (!rawTd) continue;
        const internal = this.resolveInternal(rawTd);
        if (internal) {
          this.tdToInternal.set(rawTd, internal);
          this.failedUntil.delete(internal);
          succeeded.push(internal);
        }
      }
    }

    const fails = [];
    if (Array.isArray(msg.fails)) {
      for (const item of msg.fails) fails.push(item);
    } else if (msg.status === "error" && msg.symbol) {
      fails.push(msg.symbol);
    }

    for (const item of fails) {
      const rawTd = String(
        typeof item === "string" ? item : (item && (item.symbol || item.s)) || ""
      )
        .trim()
        .toUpperCase();
      if (!rawTd) continue;

      const internal = this.resolveInternal(rawTd);
      let removedSym = "";

      if (internal && this.active.delete(internal)) {
        removedSym = internal;
      } else {
        for (const [sym, entry] of this.active) {
          if (entry.tdSym.toUpperCase() === rawTd) {
            this.active.delete(sym);
            removedSym = sym;
            break;
          }
        }
      }

      const keyToBlock = removedSym || internal;
      if (keyToBlock) {
        this.failedUntil.set(keyToBlock, ts + this.failCooldownMs);
        released.push(keyToBlock);
      }
    }

    return { released, succeeded };
  }

  /** Reset active upstream tracking on socket teardown/reconnect. */
  resetActive({ clearFailures = false } = {}) {
    this.active.clear();
    if (clearFailures) this.failedUntil.clear();
  }
}
