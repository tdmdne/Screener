// workers/market/store.js — Durable Object SQLite hot bar store & strict KV write-budget guard (Task 4).
// Works identically against Cloudflare DO `ctx.storage.sql` and an in-memory SQLite mock in Node tests.
//
// Rules enforced:
// - Parameterized SQL queries ONLY (zero string interpolation in SQL).
// - Keeps at most 1,500 hot bars per (sym, tf) in DO SQLite (trim on insert).
// - Strict < 900 KV writes per UTC day (Workers Free cap is 1,000; refuses write #901 / once writes >= 900).
// - KV writes ONLY for:
//     (a) immutable closed history chunks `bars:{sym}:{tf}:{yyyymm}` written once, and
//     (b) bootstrap snapshot `snap:v1` written at most once every 5 minutes (throttled).
import { mergeBars, normalizeTf } from "../../shared/market/candles.js";
import { normalizeBar, normSymbol } from "../../shared/schema.js";

export const MAX_HOT_BARS = 1500;
export const KV_DAILY_WRITE_LIMIT = 900;
export const SNAP_KV_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
export const SNAP_KV_KEY = "snap:v1";

const SNAP_KV_META_KEY = "__meta:snap:v1:kv_at";
const CHUNK_META_PREFIX = "__kv_chunk:";
const YYYYMM_RE = /^\d{6}$/;

/**
 * Returns UTC day key "YYYY-MM-DD" for KV daily budget accounting.
 * @param {number} [nowMs=Date.now()]
 * @returns {string}
 */
export function utcDayKey(nowMs = Date.now()) {
  const d = new Date(Number.isFinite(nowMs) ? nowMs : Date.now());
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Builds the canonical immutable KV history chunk key `bars:{sym}:{tf}:{yyyymm}`.
 * Returns null if inputs are invalid.
 * @param {string} sym
 * @param {string} tf
 * @param {string} yyyymm
 * @returns {string|null}
 */
export function historyChunkKey(sym, tf, yyyymm) {
  const s = normSymbol(sym);
  const normTf = normalizeTf(tf);
  const ym = String(yyyymm || "").trim();
  if (!s || !normTf || !YYYYMM_RE.test(ym)) return null;
  return `bars:${s}:${normTf}:${ym}`;
}

/**
 * Reads all rows from a Cloudflare DO `SqlStorageCursor` or compatible mock cursor.
 * @param {any} cursor
 * @returns {Array<object>}
 */
function cursorRows(cursor) {
  if (!cursor) return [];
  if (typeof cursor.toArray === "function") return cursor.toArray();
  if (Array.isArray(cursor)) return cursor;
  return [...cursor];
}

export class MarketStore {
  /**
   * @param {{ exec(query: string, ...bindings: any[]): any }} sql
   * @param {{
   *   maxBars?: number,
   *   kvDailyLimit?: number,
   *   snapMinIntervalMs?: number,
   *   now?: () => number,
   * }} [opts]
   */
  constructor(sql, opts = {}) {
    if (!sql || typeof sql.exec !== "function") {
      throw new TypeError("MarketStore requires a SQLite storage object with .exec(query, ...bindings)");
    }
    this.sql = sql;
    this.maxBars = Number.isInteger(opts.maxBars) && opts.maxBars > 0 ? opts.maxBars : MAX_HOT_BARS;
    this.kvDailyLimit =
      Number.isInteger(opts.kvDailyLimit) && opts.kvDailyLimit > 0 ? opts.kvDailyLimit : KV_DAILY_WRITE_LIMIT;
    this.snapMinIntervalMs =
      Number.isFinite(opts.snapMinIntervalMs) && opts.snapMinIntervalMs >= 0
        ? opts.snapMinIntervalMs
        : SNAP_KV_MIN_INTERVAL_MS;
    this.now = typeof opts.now === "function" ? opts.now : () => Date.now();
    this._initialized = false;
    this._lastSnapKvAt = 0;
    this._snapKvInFlight = false;
    this._chunkWritesInFlight = new Set();
  }

  /** Idempotently create DO SQLite schema and load persisted throttle metadata. */
  init() {
    if (this._initialized) return;

    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS bars (" +
        "sym TEXT NOT NULL, " +
        "tf TEXT NOT NULL, " +
        "t INTEGER NOT NULL, " +
        "o REAL NOT NULL, " +
        "h REAL NOT NULL, " +
        "l REAL NOT NULL, " +
        "c REAL NOT NULL, " +
        "v REAL NOT NULL, " +
        "PRIMARY KEY (sym, tf, t))"
    );
    this.sql.exec("CREATE TABLE IF NOT EXISTS subs (sym TEXT PRIMARY KEY)");
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS snapshots (" +
        "key TEXT PRIMARY KEY, " +
        "payload TEXT NOT NULL, " +
        "as_of INTEGER NOT NULL)"
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS kv_budget (" +
        "day TEXT PRIMARY KEY, " +
        "writes INTEGER NOT NULL)"
    );
    // Last known Twelve Data quote per symbol: serves screener/watchlist rows outside the live WS slots (no REST, no Yahoo).
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS quote_cache (" +
        "sym TEXT PRIMARY KEY, " +
        "c REAL NOT NULL, " +
        "t INTEGER NOT NULL, " +
        "prev_close REAL, " +
        "chg_pct REAL, " +
        "v REAL, " +
        "src TEXT NOT NULL, " +
        "saved_at INTEGER NOT NULL)"
    );
    // Signed-in users' alert definitions (A3): evaluated by the hub even when no tab is open.
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS user_alerts (" +
        "user_id TEXT PRIMARY KEY, " +
        "defs TEXT NOT NULL, " +
        "updated_at INTEGER NOT NULL)"
    );
    // Alert frames that fired while the owner had no socket open; delivered (then deleted) on their next connect.
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS user_alert_pending (" +
        "user_id TEXT NOT NULL, " +
        "ts INTEGER NOT NULL, " +
        "frame TEXT NOT NULL)"
    );

    this._initialized = true;

    const meta = this.getSnapshot(SNAP_KV_META_KEY);
    if (meta && Number.isFinite(meta.asOf) && meta.asOf > 0) {
      this._lastSnapKvAt = meta.asOf;
    }
  }

  _ensureInit() {
    if (!this._initialized) this.init();
  }

  /**
   * Insert or update a single OHLCV bar for (sym, tf), trimming to the newest `maxBars` (1,500)
   * ONLY when a new bar timestamp is inserted (never on in-place update).
   * Returns the normalized bar, or null if invalid.
   */
  upsertBar(sym, tf, rawBar) {
    this._ensureInit();
    const s = normSymbol(sym);
    const normTf = normalizeTf(tf);
    const bar = normalizeBar(rawBar);
    if (!s || !normTf || !bar) return null;

    const existed =
      cursorRows(
        this.sql.exec(
          "SELECT 1 AS ex FROM bars WHERE sym = ? AND tf = ? AND t = ? LIMIT 1",
          s,
          normTf,
          bar.t
        )
      ).length > 0;

    if (existed) {
      this.sql.exec(
        "UPDATE bars SET o = ?, h = ?, l = ?, c = ?, v = ? WHERE sym = ? AND tf = ? AND t = ?",
        bar.o,
        bar.h,
        bar.l,
        bar.c,
        bar.v,
        s,
        normTf,
        bar.t
      );
    } else {
      this.sql.exec(
        "INSERT INTO bars (sym, tf, t, o, h, l, c, v) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        s,
        normTf,
        bar.t,
        bar.o,
        bar.h,
        bar.l,
        bar.c,
        bar.v
      );
      this._trimBars(s, normTf);
    }
    return bar;
  }

  /**
   * Deduplicate and upsert a batch of bars for (sym, tf), trimming once to `maxBars` (1,500)
   * only if at least one new bar timestamp was inserted.
   * Incoming duplicates by timestamp `t` follow last-wins semantics via `mergeBars`.
   * @returns {number} count of valid unique bars written
   */
  upsertBars(sym, tf, barsList) {
    this._ensureInit();
    const s = normSymbol(sym);
    const normTf = normalizeTf(tf);
    if (!s || !normTf || !Array.isArray(barsList) || barsList.length === 0) return 0;

    const clean = mergeBars([], barsList, { maxBars: this.maxBars });
    let insertedAny = false;
    for (let i = 0; i < clean.length; i++) {
      const b = clean[i];
      const existed =
        cursorRows(
          this.sql.exec(
            "SELECT 1 AS ex FROM bars WHERE sym = ? AND tf = ? AND t = ? LIMIT 1",
            s,
            normTf,
            b.t
          )
        ).length > 0;
      if (existed) {
        this.sql.exec(
          "UPDATE bars SET o = ?, h = ?, l = ?, c = ?, v = ? WHERE sym = ? AND tf = ? AND t = ?",
          b.o,
          b.h,
          b.l,
          b.c,
          b.v,
          s,
          normTf,
          b.t
        );
      } else {
        this.sql.exec(
          "INSERT INTO bars (sym, tf, t, o, h, l, c, v) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          s,
          normTf,
          b.t,
          b.o,
          b.h,
          b.l,
          b.c,
          b.v
        );
        insertedAny = true;
      }
    }
    if (insertedAny) {
      this._trimBars(s, normTf);
    }
    return clean.length;
  }

  _trimBars(sym, tf) {
    const rows = cursorRows(
      this.sql.exec("SELECT COUNT(*) AS cnt FROM bars WHERE sym = ? AND tf = ?", sym, tf)
    );
    const cnt = Number(rows[0]?.cnt || 0);
    const excess = cnt - this.maxBars;
    if (excess > 0) {
      this.sql.exec(
        "DELETE FROM bars WHERE sym = ? AND tf = ? AND t IN (" +
          "SELECT t FROM bars WHERE sym = ? AND tf = ? ORDER BY t ASC LIMIT ?)",
        sym,
        tf,
        sym,
        tf,
        excess
      );
    }
  }

  /**
   * Retrieve bars for (sym, tf) sorted ascending by `t`.
   * Supports cursor paging via `before` (epoch seconds) and `limit` (capped at `maxBars`).
   * @param {string} sym
   * @param {string} tf
   * @param {{ before?: number, limit?: number }} [opts]
   * @returns {Array<{t:number,o:number,h:number,l:number,c:number,v:number}>}
   */
  getBars(sym, tf, opts = {}) {
    this._ensureInit();
    const s = normSymbol(sym);
    const normTf = normalizeTf(tf);
    if (!s || !normTf) return [];

    const limit = Math.min(this.maxBars, Math.max(1, Math.floor(Number(opts.limit) || this.maxBars)));
    const before = opts.before !== undefined && opts.before !== null ? Number(opts.before) : NaN;

    const rows =
      Number.isFinite(before) && before > 0
        ? cursorRows(
            this.sql.exec(
              "SELECT t, o, h, l, c, v FROM bars WHERE sym = ? AND tf = ? AND t < ? ORDER BY t DESC LIMIT ?",
              s,
              normTf,
              Math.floor(before),
              limit
            )
          )
        : cursorRows(
            this.sql.exec(
              "SELECT t, o, h, l, c, v FROM bars WHERE sym = ? AND tf = ? ORDER BY t DESC LIMIT ?",
              s,
              normTf,
              limit
            )
          );

    const out = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[rows.length - 1 - i];
      out[i] = {
        t: Number(r.t),
        o: Number(r.o),
        h: Number(r.h),
        l: Number(r.l),
        c: Number(r.c),
        v: Number(r.v),
      };
    }
    return out;
  }

  /** Number of bars stored for (sym, tf). */
  getBarCount(sym, tf) {
    this._ensureInit();
    const s = normSymbol(sym);
    const normTf = normalizeTf(tf);
    if (!s || !normTf) return 0;
    const rows = cursorRows(
      this.sql.exec("SELECT COUNT(*) AS cnt FROM bars WHERE sym = ? AND tf = ?", s, normTf)
    );
    return Number(rows[0]?.cnt || 0);
  }

  /** Sorted list of all symbols with real bars in DO SQLite. */
  listBarSymbols() {
    this._ensureInit();
    const rows = cursorRows(this.sql.exec("SELECT DISTINCT sym FROM bars ORDER BY sym ASC"));
    return rows.map((r) => String(r.sym));
  }

  /** List all timeframes stored for a symbol. */
  listTimeframesForSymbol(sym) {
    this._ensureInit();
    const s = normSymbol(sym);
    if (!s) return [];
    const rows = cursorRows(
      this.sql.exec("SELECT DISTINCT tf FROM bars WHERE sym = ? ORDER BY tf ASC", s)
    );
    return rows.map((r) => String(r.tf));
  }

  /** Load `{ [tf]: Bar[] }` across all stored timeframes for a symbol (for server-side screener scoring). */
  getBarsByTimeframe(sym, limit = 200) {
    this._ensureInit();
    const s = normSymbol(sym);
    if (!s) return {};
    const tfs = this.listTimeframesForSymbol(s);
    const byTf = {};
    for (const tf of tfs) {
      const bars = this.getBars(s, tf, { limit });
      if (bars.length) byTf[tf] = bars;
    }
    return byTf;
  }

  /** Persisted upstream subscription symbols. */
  getSubs() {
    this._ensureInit();
    const rows = cursorRows(this.sql.exec("SELECT sym FROM subs ORDER BY sym ASC"));
    return rows.map((r) => String(r.sym));
  }

  /** Persist additional upstream subscriptions. */
  addSubs(syms) {
    this._ensureInit();
    const added = [];
    for (const raw of syms || []) {
      const s = normSymbol(raw);
      if (!s) continue;
      this.sql.exec("INSERT OR IGNORE INTO subs (sym) VALUES (?)", s);
      added.push(s);
    }
    return added;
  }

  /** Remove upstream subscriptions. */
  removeSubs(syms) {
    this._ensureInit();
    for (const raw of syms || []) {
      const s = normSymbol(raw);
      if (!s) continue;
      this.sql.exec("DELETE FROM subs WHERE sym = ?", s);
    }
  }

  /** Replace the full persisted upstream subscription set. */
  replaceSubs(syms) {
    this._ensureInit();
    this.sql.exec("DELETE FROM subs");
    return this.addSubs(syms);
  }

  /**
   * Upsert the last known quote for a symbol. Called on WS slot eviction and once per closed 1m bar, never per tick.
   * @param {{ s: string, c: number, t: number, prevClose?: number|null, chgPct?: number|null, v?: number|null, src?: string }} q
   * @returns {boolean}
   */
  saveQuoteCache(q) {
    this._ensureInit();
    const s = normSymbol(q && q.s);
    const c = Number(q && q.c);
    const t = Math.floor(Number(q && q.t));
    if (!s || !(c > 0) || !(t > 0)) return false;
    const num = (x) => (Number.isFinite(Number(x)) && x !== null && x !== undefined ? Number(x) : null);
    this.sql.exec(
      "INSERT OR REPLACE INTO quote_cache (sym, c, t, prev_close, chg_pct, v, src, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      s, c, t, num(q.prevClose), num(q.chgPct), num(q.v), String(q.src || "twelvedata"), Math.floor(this.now())
    );
    return true;
  }

  /**
   * Cached quotes for many symbols (missing symbols are simply absent).
   * @param {string[]} syms
   * @returns {Map<string, { s: string, c: number, t: number, prevClose: number|null, chgPct: number|null, v: number|null, src: string, savedAt: number }>}
   */
  getQuoteCaches(syms) {
    this._ensureInit();
    const out = new Map();
    for (const raw of syms || []) {
      const s = normSymbol(raw);
      if (!s || out.has(s)) continue;
      const rows = cursorRows(this.sql.exec("SELECT * FROM quote_cache WHERE sym = ?", s));
      if (!rows.length) continue;
      const r = rows[0];
      out.set(s, {
        s,
        c: Number(r.c),
        t: Number(r.t),
        prevClose: r.prev_close === null ? null : Number(r.prev_close),
        chgPct: r.chg_pct === null ? null : Number(r.chg_pct),
        v: r.v === null ? null : Number(r.v),
        src: String(r.src),
        savedAt: Number(r.saved_at),
      });
    }
    return out;
  }

  /** Store a JSON snapshot in DO SQLite `snapshots`. */
  saveSnapshot(key, payload, asOf = this.now()) {
    this._ensureInit();
    if (typeof key !== "string" || !key.trim()) return false;
    const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
    const ts = Number.isFinite(asOf) && asOf > 0 ? Math.floor(asOf) : Math.floor(this.now());
    this.sql.exec(
      "INSERT OR REPLACE INTO snapshots (key, payload, as_of) VALUES (?, ?, ?)",
      key.trim(),
      serialized,
      ts
    );
    return true;
  }

  /** A3: replace a user's persisted alert definitions (empty list deletes the row). */
  saveUserAlerts(userId, defs, nowMs) {
    this._ensureInit();
    if (!Array.isArray(defs) || defs.length === 0) {
      this.sql.exec("DELETE FROM user_alerts WHERE user_id = ?", userId);
      return;
    }
    this.sql.exec(
      "INSERT INTO user_alerts (user_id, defs, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET defs = excluded.defs, updated_at = excluded.updated_at",
      userId,
      JSON.stringify(defs),
      nowMs
    );
  }

  /** A3: every user's persisted alert definitions, for re-registering after the DO restarts. */
  listUserAlerts() {
    this._ensureInit();
    const out = [];
    for (const r of this.sql.exec("SELECT user_id, defs FROM user_alerts").toArray()) {
      try {
        const defs = JSON.parse(r.defs);
        if (Array.isArray(defs)) out.push({ userId: r.user_id, defs });
      } catch {
        /* skip a corrupt row rather than failing hub start-up */
      }
    }
    return out;
  }

  /** A3: queue an alert frame for an offline user (keeps the newest `cap` per user). */
  queueUserAlert(userId, frame, nowMs, cap = 50) {
    this._ensureInit();
    this.sql.exec("INSERT INTO user_alert_pending (user_id, ts, frame) VALUES (?, ?, ?)", userId, nowMs, JSON.stringify(frame));
    this.sql.exec(
      "DELETE FROM user_alert_pending WHERE user_id = ? AND rowid NOT IN " +
        "(SELECT rowid FROM user_alert_pending WHERE user_id = ? ORDER BY ts DESC, rowid DESC LIMIT ?)",
      userId,
      userId,
      cap
    );
  }

  /** A3: take (and delete) a user's queued alert frames, oldest first. */
  takeUserAlerts(userId) {
    this._ensureInit();
    const rows = this.sql.exec("SELECT frame FROM user_alert_pending WHERE user_id = ? ORDER BY ts ASC, rowid ASC", userId).toArray();
    this.sql.exec("DELETE FROM user_alert_pending WHERE user_id = ?", userId);
    const out = [];
    for (const r of rows) {
      try {
        out.push(JSON.parse(r.frame));
      } catch {
        /* drop corrupt entries */
      }
    }
    return out;
  }

  /** Retrieve and parse a snapshot from DO SQLite `snapshots`. */
  getSnapshot(key) {
    this._ensureInit();
    if (typeof key !== "string" || !key.trim()) return null;
    const rows = cursorRows(
      this.sql.exec("SELECT key, payload, as_of FROM snapshots WHERE key = ?", key.trim())
    );
    if (!rows.length) return null;
    const row = rows[0];
    let payload = null;
    try {
      payload = JSON.parse(String(row.payload));
    } catch {
      payload = row.payload;
    }
    return {
      key: String(row.key),
      payload,
      asOf: Number(row.as_of),
    };
  }

  /** Number of KV writes recorded so far for the UTC day of `nowMs`. */
  getKvWritesToday(nowMs = this.now()) {
    this._ensureInit();
    const day = utcDayKey(nowMs);
    const rows = cursorRows(this.sql.exec("SELECT writes FROM kv_budget WHERE day = ?", day));
    return rows.length ? Number(rows[0].writes) : 0;
  }

  /**
   * Atomically reserve 1 KV write against the strict `< 900` UTC daily limit.
   * Refuses once `writes >= kvDailyLimit` (so write #901 is rejected).
   */
  consumeKvWrite(nowMs = this.now()) {
    this._ensureInit();
    const day = utcDayKey(nowMs);
    const current = this.getKvWritesToday(nowMs);
    if (current >= this.kvDailyLimit) {
      return {
        ok: false,
        reason: "kv_budget_exhausted",
        day,
        writes: current,
        limit: this.kvDailyLimit,
      };
    }
    const next = current + 1;
    this.sql.exec("INSERT OR REPLACE INTO kv_budget (day, writes) VALUES (?, ?)", day, next);
    return {
      ok: true,
      day,
      writes: next,
      limit: this.kvDailyLimit,
    };
  }

  /**
   * KV Write Path (a): Immutable closed history chunk `bars:{sym}:{tf}:{yyyymm}`, written ONCE.
   * Skips without spending KV budget if already written; refuses if daily KV budget >= 900.
   */
  async writeHistoryChunk(kv, sym, tf, yyyymm, bars, opts = {}) {
    this._ensureInit();
    if (!kv || typeof kv.put !== "function") {
      return { ok: false, reason: "no_kv" };
    }
    const key = historyChunkKey(sym, tf, yyyymm);
    if (!key) return { ok: false, reason: "invalid_key" };

    const clean = mergeBars([], bars);
    if (!clean.length) return { ok: false, reason: "empty_bars", key };

    const metaKey = `${CHUNK_META_PREFIX}${key}`;
    if (this.getSnapshot(metaKey)) {
      return { ok: false, reason: "already_written", key };
    }
    if (this._chunkWritesInFlight.has(key)) {
      return { ok: false, reason: "in_flight", key };
    }

    // Acquire per-chunk in-flight lock synchronously before any await to prevent concurrent duplicate writes.
    this._chunkWritesInFlight.add(key);
    try {
      if (typeof kv.get === "function") {
        const existing = await kv.get(key);
        if (existing !== null && existing !== undefined) {
          this.saveSnapshot(metaKey, { written: true }, opts.now ?? this.now());
          return { ok: false, reason: "already_written", key };
        }
      }

      const nowMs = opts.now ?? this.now();
      const budget = this.consumeKvWrite(nowMs);
      if (!budget.ok) {
        return {
          ok: false,
          reason: "kv_budget_exhausted",
          key,
          writes: budget.writes,
          limit: budget.limit,
        };
      }

      const payload = {
        sym: normSymbol(sym),
        tf: normalizeTf(tf),
        yyyymm: String(yyyymm),
        asOf: nowMs,
        bars: clean,
      };
      await kv.put(key, JSON.stringify(payload));
      this.saveSnapshot(metaKey, { written: true, count: clean.length }, nowMs);
      return { ok: true, key, count: clean.length, writes: budget.writes, limit: budget.limit };
    } finally {
      this._chunkWritesInFlight.delete(key);
    }
  }

  /** Read an immutable history chunk `bars:{sym}:{tf}:{yyyymm}` from KV. */
  async readHistoryChunk(kv, sym, tf, yyyymm) {
    if (!kv || typeof kv.get !== "function") return [];
    const key = historyChunkKey(sym, tf, yyyymm);
    if (!key) return [];
    const raw = await kv.get(key);
    if (!raw) return [];
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return mergeBars([], parsed?.bars || parsed);
    } catch {
      return [];
    }
  }

  /**
   * KV Write Path (b): Bootstrap snapshot `snap:v1`, throttled to at most once every 5 minutes
   * and strictly guarded by the `< 900/day` KV write budget.
   */
  async writeBootstrapSnapshot(kv, payload, opts = {}) {
    this._ensureInit();
    if (!kv || typeof kv.put !== "function") {
      return { ok: false, reason: "no_kv" };
    }
    if (this._snapKvInFlight) {
      return {
        ok: false,
        reason: "in_flight",
        key: SNAP_KV_KEY,
      };
    }
    const nowMs = opts.now ?? this.now();
    const elapsed = nowMs - this._lastSnapKvAt;
    if (this._lastSnapKvAt > 0 && elapsed < this.snapMinIntervalMs) {
      return {
        ok: false,
        reason: "throttled",
        key: SNAP_KV_KEY,
        retryAfterMs: this.snapMinIntervalMs - elapsed,
      };
    }

    const budget = this.consumeKvWrite(nowMs);
    if (!budget.ok) {
      return {
        ok: false,
        reason: "kv_budget_exhausted",
        key: SNAP_KV_KEY,
        writes: budget.writes,
        limit: budget.limit,
      };
    }

    // Update throttle timestamp AND acquire in-flight lock synchronously BEFORE await kv.put(...)
    // to prevent concurrent stampede writes across the async boundary.
    const prevSnapKvAt = this._lastSnapKvAt;
    this._snapKvInFlight = true;
    this._lastSnapKvAt = nowMs;
    try {
      const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
      await kv.put(SNAP_KV_KEY, serialized);
      this.saveSnapshot(SNAP_KV_META_KEY, { publishedAt: nowMs }, nowMs);
      return {
        ok: true,
        key: SNAP_KV_KEY,
        writes: budget.writes,
        limit: budget.limit,
        publishedAt: nowMs,
      };
    } catch (err) {
      this._lastSnapKvAt = prevSnapKvAt;
      throw err;
    } finally {
      this._snapKvInFlight = false;
    }
  }

  /** Read the bootstrap snapshot `snap:v1` from KV (cold-start fallback). */
  async readBootstrapSnapshot(kv) {
    if (!kv || typeof kv.get !== "function") return null;
    const raw = await kv.get(SNAP_KV_KEY);
    if (!raw) return null;
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  }
}
