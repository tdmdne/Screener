// shared/protocol.js — Client/Server WebSocket Protocol v2 schema, frame builders, validators, and budget checks.
// Pure ES module compatible with Node 22+ and Cloudflare Workers (no Node-only imports).

import { isForbiddenSource } from "./market/screener.js";
import { resolveInterval } from "./intervals.js";

export const PROTOCOL_VERSION = 2;

/** Payload size & cardinality budgets (AUDIT.md §3.4 / TASKS.md Task 8). */
export const MAX_LIVE_FRAME_BYTES = 2048;       // 2 KB UTF-8 cap on live delta frames
export const MAX_SCREENER_PAGE_ROWS = 50;       // max rows per screener page frame
export const MAX_STATE_GZIP_BYTES = 153600;     // 150 KB gzipped cap on full state bootstrap
export const MAX_CHART_BARS = 1500;             // max bars in initial chart state (older history paged via HTTP)
export const MAX_WATCHLIST_SYMBOLS = 100;
export const MAX_HEATMAP_TILES = 100;
export const MAX_CLIENT_FRAME_BYTES = 8192;

export const PROVENANCE = Object.freeze({
  LIVE: "LIVE",
  DELAYED: "DELAYED",
  RECONNECTING: "RECONNECTING",
  CACHED: "CACHED",
  UNAVAILABLE: "UNAVAILABLE",
});

export const CLIENT_OPS = Object.freeze(["hello", "view", "ping"]);

export const SERVER_TYPES = Object.freeze([
  "hello",
  "state",
  "bar",
  "ind",
  "vs",
  "quotes",
  "screener",
  "heatmap",
  "status",
  "alert",
  "error",
  "pong",
]);

/** Delta / control frames governed by MAX_LIVE_FRAME_BYTES (2 KB). */
export const LIVE_FRAME_TYPES = Object.freeze([
  "bar",
  "ind",
  "quotes",
  "status",
  "alert",
  "error",
  "pong",
]);

const LIVE_TYPE_SET = new Set(LIVE_FRAME_TYPES);
const SERVER_TYPE_SET = new Set(SERVER_TYPES);
const PROVENANCE_SET = new Set(Object.values(PROVENANCE));
const PRESET_SET = new Set(["P1", "P2", "P3", "P4", "P5"]);
const EVC_SET = new Set(["H", "M", "L"]);
const DIR_SET = new Set(["long", "short"]);
const HM_METRIC_SET = new Set(["chg", "mom", "score"]);
const HM_TF_SET = new Set(["1H", "4H", "1D", "1W", "1h", "4h", "1d", "1w"]);
const HM_SIZE_SET = new Set(["value", "equal"]);
const NATIVE_TF_SET = new Set([
  "1m", "5m", "15m", "30m",
  "1h", "4h", "1d", "1w",
  "1H", "4H", "1D", "1W", "1M",
]);
/** Valid timeframes: the native set plus any custom interval the backend can resample (3m, 45m, 2H, 12H, 2D, 3M ...). */
const VALID_TF_SET = Object.freeze({ has: (tf) => NATIVE_TF_SET.has(tf) || resolveInterval(tf) !== null });

const SYMBOL_RE = /^[A-Z0-9.=^/-]{1,24}$/i;
const encoder = new TextEncoder();

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isPosFinite = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
const isNonNegFinite = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isNonNegInt = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isPosInt = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const isNonEmptyStr = (v, max = 256) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isValidSymbol = (v) => typeof v === "string" && SYMBOL_RE.test(v.trim());

function fail(code, error) {
  return { ok: false, code, error };
}

/**
 * UTF-8 byte length of a serialized frame or raw string.
 * @param {object|string} frameOrStr
 * @returns {number}
 */
export function byteLength(frameOrStr) {
  const str = typeof frameOrStr === "string" ? frameOrStr : JSON.stringify(frameOrStr);
  return encoder.encode(str).byteLength;
}

/**
 * Checks whether a live frame fits within MAX_LIVE_FRAME_BYTES (2 KB).
 * @param {object|string} frame
 * @param {number} [limit=MAX_LIVE_FRAME_BYTES]
 * @returns {{ok:boolean, bytes:number, limit:number, overBy:number}}
 */
export function checkLiveFrameBudget(frame, limit = MAX_LIVE_FRAME_BYTES) {
  const bytes = byteLength(frame);
  return { ok: bytes <= limit, bytes, limit, overBy: Math.max(0, bytes - limit) };
}

/**
 * Checks whether a screener frame or state.screener respects MAX_SCREENER_PAGE_ROWS (50).
 * @param {object} frame
 * @param {number} [limit=MAX_SCREENER_PAGE_ROWS]
 * @returns {{ok:boolean, rows:number, limit:number, overBy:number}}
 */
export function checkScreenerBudget(frame, limit = MAX_SCREENER_PAGE_ROWS) {
  const rowsArr = Array.isArray(frame?.rows)
    ? frame.rows
    : (Array.isArray(frame?.screener?.rows) ? frame.screener.rows : []);
  const rows = rowsArr.length;
  return { ok: rows <= limit, rows, limit, overBy: Math.max(0, rows - limit) };
}

/**
 * Compresses a `state` frame with gzip (Web Streams CompressionStream — works in Node 22+ & CF Workers)
 * and checks against MAX_STATE_GZIP_BYTES (150 KB).
 * @param {object|string} frame
 * @param {number} [limit=MAX_STATE_GZIP_BYTES]
 * @returns {Promise<{ok:boolean, rawBytes:number, gzipBytes:number, limit:number, overBy:number}>}
 */
export async function checkStateGzipBudget(frame, limit = MAX_STATE_GZIP_BYTES) {
  const str = typeof frame === "string" ? frame : JSON.stringify(frame);
  const raw = encoder.encode(str);
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  const writeDone = writer.write(raw).then(() => writer.close());

  const reader = cs.readable.getReader();
  let gzipBytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) gzipBytes += value.byteLength;
  }
  await writeDone;

  return {
    ok: gzipBytes <= limit,
    rawBytes: raw.byteLength,
    gzipBytes,
    limit,
    overBy: Math.max(0, gzipBytes - limit),
  };
}

/**
 * Monotonic per-connection / per-hub sequence generator.
 * @param {number} [start=0]
 */
export function createSequencer(start = 0) {
  let seq = isNonNegInt(start) ? start : 0;
  return {
    next() {
      seq += 1;
      return seq;
    },
    current() {
      return seq;
    },
    reset(v = 0) {
      seq = isNonNegInt(v) ? v : 0;
    },
  };
}

function validateBarShape(bar) {
  if (Array.isArray(bar)) {
    if (bar.length < 5 || bar.length > 6) return "bar tuple must have 5 or 6 elements [t,o,h,l,c,v?]";
    const [t, o, h, l, c, v = 0] = bar;
    if (!isPosFinite(t) || !isPosFinite(o) || !isPosFinite(h) || !isPosFinite(l) || !isPosFinite(c)) {
      return "bar tuple requires positive finite [t,o,h,l,c]";
    }
    if (!isNonNegFinite(v)) return "bar volume must be non-negative finite";
    if (h < Math.max(o, c) || l > Math.min(o, c)) return "bar high/low must bracket open/close";
    return null;
  }
  if (isPlainObject(bar)) {
    const { t, o, h, l, c, v = 0 } = bar;
    if (!isPosFinite(t) || !isPosFinite(o) || !isPosFinite(h) || !isPosFinite(l) || !isPosFinite(c)) {
      return "bar object requires positive finite {t,o,h,l,c}";
    }
    if (!isNonNegFinite(v)) return "bar volume must be non-negative finite";
    if (h < Math.max(o, c) || l > Math.min(o, c)) return "bar high/low must bracket open/close";
    return null;
  }
  return "bar must be a tuple [t,o,h,l,c,v] or object {t,o,h,l,c,v}";
}

function validateQuoteShape(q) {
  if (!isPlainObject(q)) return "quote must be an object";
  if (!isValidSymbol(q.s)) return "quote.s must be a valid symbol";
  if (!isPosFinite(q.c)) return "quote.c must be a positive finite price";
  if (!isPosFinite(q.t)) return "quote.t must be a positive finite timestamp";
  if (q.bid !== undefined && !isPosFinite(q.bid)) return "quote.bid must be positive finite";
  if (q.ask !== undefined && !isPosFinite(q.ask)) return "quote.ask must be positive finite";
  if (q.bid !== undefined && q.ask !== undefined && q.bid > q.ask) return "quote.bid cannot exceed quote.ask";
  if (q.v !== undefined && !isNonNegFinite(q.v)) return "quote.v must be non-negative finite";
  if (q.chgPct !== undefined && (typeof q.chgPct !== "number" || !Number.isFinite(q.chgPct))) {
    return "quote.chgPct must be finite";
  }
  if (q.provenance !== undefined && !PROVENANCE_SET.has(q.provenance)) {
    return "quote.provenance must be LIVE|DELAYED|RECONNECTING|CACHED|UNAVAILABLE";
  }
  return null;
}

function validateScreenerBody(body) {
  if (!isPlainObject(body)) return fail("INVALID_SCREENER", "screener payload must be an object");
  if (!isPosInt(body.page)) return fail("INVALID_SCREENER", "screener.page must be an integer >= 1");
  if (!isPosInt(body.totalPages)) return fail("INVALID_SCREENER", "screener.totalPages must be an integer >= 1");
  if (!isNonNegInt(body.total)) return fail("INVALID_SCREENER", "screener.total must be an integer >= 0");
  if (!PRESET_SET.has(body.preset)) return fail("INVALID_SCREENER", "screener.preset must be P1..P5");
  if (!isPosFinite(body.asOf)) return fail("INVALID_SCREENER", "screener.asOf must be a positive timestamp");
  if (!Array.isArray(body.rows)) return fail("INVALID_SCREENER", "screener.rows must be an array");
  if (body.rows.length > MAX_SCREENER_PAGE_ROWS) {
    return fail("BUDGET_EXCEEDED", `screener.rows (${body.rows.length}) exceeds MAX_SCREENER_PAGE_ROWS (${MAX_SCREENER_PAGE_ROWS})`);
  }
  for (let i = 0; i < body.rows.length; i++) {
    const r = body.rows[i];
    if (!isPlainObject(r)) return fail("INVALID_SCREENER", `screener.rows[${i}] must be an object`);
    if (!isValidSymbol(r.symbol)) return fail("INVALID_SCREENER", `screener.rows[${i}].symbol is invalid`);
    if (isForbiddenSource(r.source)) {
      return fail("FORBIDDEN_SOURCE", `screener.rows[${i}].source is missing or synthetic (${String(r.source)})`);
    }
    if (!isPosFinite(r.asOf)) return fail("INVALID_SCREENER", `screener.rows[${i}].asOf must be a positive timestamp`);
  }
  return null;
}

function validateHeatmapBody(body) {
  if (!isPlainObject(body)) return fail("INVALID_HEATMAP", "heatmap payload must be an object");
  if (!HM_METRIC_SET.has(body.metric)) return fail("INVALID_HEATMAP", "heatmap.metric must be chg|mom|score");
  if (body.tf !== undefined && !HM_TF_SET.has(body.tf)) return fail("INVALID_HEATMAP", "heatmap.tf must be 1H|4H|1D|1W");
  if (body.range !== undefined && !isPosFinite(body.range)) return fail("INVALID_HEATMAP", "heatmap.range must be positive finite");
  if (!isPosFinite(body.asOf)) return fail("INVALID_HEATMAP", "heatmap.asOf must be a positive timestamp");
  if (!Array.isArray(body.tiles)) return fail("INVALID_HEATMAP", "heatmap.tiles must be an array");
  if (body.tiles.length > MAX_HEATMAP_TILES) {
    return fail("BUDGET_EXCEEDED", `heatmap.tiles (${body.tiles.length}) exceeds MAX_HEATMAP_TILES (${MAX_HEATMAP_TILES})`);
  }
  for (let i = 0; i < body.tiles.length; i++) {
    const t = body.tiles[i];
    if (!isPlainObject(t)) return fail("INVALID_HEATMAP", `heatmap.tiles[${i}] must be an object`);
    if (!isValidSymbol(t.symbol)) return fail("INVALID_HEATMAP", `heatmap.tiles[${i}].symbol is invalid`);
    if (t.value !== null && (typeof t.value !== "number" || !Number.isFinite(t.value))) {
      return fail("INVALID_HEATMAP", `heatmap.tiles[${i}].value must be finite number or null`);
    }
    if (!isPosFinite(t.weight)) return fail("INVALID_HEATMAP", `heatmap.tiles[${i}].weight must be positive finite`);
    if (isForbiddenSource(t.source)) {
      return fail("FORBIDDEN_SOURCE", `heatmap.tiles[${i}].source is missing or synthetic (${String(t.source)})`);
    }
    if (!isPosFinite(t.asOf)) return fail("INVALID_HEATMAP", `heatmap.tiles[${i}].asOf must be a positive timestamp`);
  }
  return null;
}

function validateStatusPayload(s) {
  if (!isPlainObject(s)) return fail("INVALID_STATUS", "status must be an object");
  if (!PROVENANCE_SET.has(s.provenance)) {
    return fail("INVALID_STATUS", "status.provenance must be LIVE|DELAYED|RECONNECTING|CACHED|UNAVAILABLE");
  }
  if (!isPosFinite(s.asOf)) return fail("INVALID_STATUS", "status.asOf must be a positive timestamp");
  if (s.sym !== undefined && !isValidSymbol(s.sym)) return fail("INVALID_STATUS", "status.sym is invalid");
  if (s.detail !== undefined && !isNonEmptyStr(s.detail, 256)) return fail("INVALID_STATUS", "status.detail must be a string <= 256 chars");
  if (s.feeds !== undefined) {
    if (!isPlainObject(s.feeds)) return fail("INVALID_STATUS", "status.feeds must be an object");
    const names = Object.keys(s.feeds);
    if (names.length > 8) return fail("INVALID_STATUS", "status.feeds has too many entries");
    for (const name of names) {
      if (!/^[a-z0-9_-]{1,24}$/i.test(name)) return fail("INVALID_STATUS", "status.feeds key is invalid");
      if (!PROVENANCE_SET.has(s.feeds[name])) return fail("INVALID_STATUS", `status.feeds.${name} must be a provenance state`);
    }
  }
  return null;
}

/**
 * Validates a client → server protocol v2 message (`hello`, `view`, `ping`).
 * Accepts either a parsed object or a raw JSON string.
 * @param {object|string} input
 * @returns {{ok:true, value:object, bytes:number}|{ok:false, code:string, error:string}}
 */
export function validateClientMessage(input) {
  let msg = input;
  let bytes = 0;

  if (typeof input === "string") {
    bytes = byteLength(input);
    if (bytes > MAX_CLIENT_FRAME_BYTES) {
      return fail("BUDGET_EXCEEDED", `Client frame (${bytes}B) exceeds MAX_CLIENT_FRAME_BYTES (${MAX_CLIENT_FRAME_BYTES}B)`);
    }
    try {
      msg = JSON.parse(input);
    } catch {
      return fail("INVALID_JSON", "Malformed JSON in client message");
    }
  } else {
    if (!isPlainObject(msg)) return fail("INVALID_MESSAGE", "Client message must be a JSON object");
    bytes = byteLength(msg);
    if (bytes > MAX_CLIENT_FRAME_BYTES) {
      return fail("BUDGET_EXCEEDED", `Client frame (${bytes}B) exceeds MAX_CLIENT_FRAME_BYTES (${MAX_CLIENT_FRAME_BYTES}B)`);
    }
  }

  if (!isPlainObject(msg)) return fail("INVALID_MESSAGE", "Client message must be an object");

  switch (msg.op) {
    case "hello": {
      if (msg.v !== PROTOCOL_VERSION) {
        return fail("UNSUPPORTED_VERSION", `hello.v must equal ${PROTOCOL_VERSION}`);
      }
      if (msg.session !== undefined && msg.session !== null && !isNonEmptyStr(msg.session, 128)) {
        return fail("INVALID_HELLO", "hello.session must be a non-empty string <= 128 chars");
      }
      return { ok: true, value: msg, bytes };
    }

    case "ping": {
      if (msg.t !== undefined && !isPosFinite(msg.t)) {
        return fail("INVALID_PING", "ping.t must be a positive finite timestamp");
      }
      return { ok: true, value: msg, bytes };
    }

    case "view": {
      const hasSection =
        msg.chart !== undefined ||
        msg.watchlist !== undefined ||
        msg.screener !== undefined ||
        msg.heatmap !== undefined;
      if (!hasSection) {
        return fail("INVALID_VIEW", "view must specify at least one of chart, watchlist, screener, or heatmap");
      }

      if (msg.chart !== undefined && msg.chart !== null) {
        if (!isPlainObject(msg.chart)) return fail("INVALID_VIEW", "view.chart must be an object");
        if (!isValidSymbol(msg.chart.sym)) return fail("INVALID_VIEW", "view.chart.sym must be a valid symbol");
        if (!VALID_TF_SET.has(msg.chart.tf)) return fail("INVALID_VIEW", `view.chart.tf (${msg.chart.tf}) is not a valid timeframe`);
        if (msg.chart.ind !== undefined) {
          if (!Array.isArray(msg.chart.ind) || msg.chart.ind.length > 24) {
            return fail("INVALID_VIEW", "view.chart.ind must be an array of at most 24 indicators");
          }
          for (let i = 0; i < msg.chart.ind.length; i++) {
            const ind = msg.chart.ind[i];
            if (typeof ind === "string") {
              if (!isNonEmptyStr(ind, 64)) return fail("INVALID_VIEW", `view.chart.ind[${i}] must be a non-empty string`);
            } else if (isPlainObject(ind)) {
              if (!isNonEmptyStr(ind.type ?? ind.id, 64)) {
                return fail("INVALID_VIEW", `view.chart.ind[${i}] object requires type or id`);
              }
            } else {
              return fail("INVALID_VIEW", `view.chart.ind[${i}] must be a string or descriptor object`);
            }
          }
        }
        if (msg.chart.vs !== undefined) {
          if (!Array.isArray(msg.chart.vs) || msg.chart.vs.length > 10) {
            return fail("INVALID_VIEW", "view.chart.vs must be an array of at most 10 script IDs");
          }
          for (let i = 0; i < msg.chart.vs.length; i++) {
            if (!isNonEmptyStr(msg.chart.vs[i], 64)) {
              return fail("INVALID_VIEW", `view.chart.vs[${i}] must be a non-empty script ID`);
            }
          }
        }
      }

      if (msg.watchlist !== undefined) {
        if (!Array.isArray(msg.watchlist)) return fail("INVALID_VIEW", "view.watchlist must be an array");
        if (msg.watchlist.length > MAX_WATCHLIST_SYMBOLS) {
          return fail("BUDGET_EXCEEDED", `view.watchlist (${msg.watchlist.length}) exceeds MAX_WATCHLIST_SYMBOLS (${MAX_WATCHLIST_SYMBOLS})`);
        }
        for (let i = 0; i < msg.watchlist.length; i++) {
          if (!isValidSymbol(msg.watchlist[i])) {
            return fail("INVALID_VIEW", `view.watchlist[${i}] is not a valid symbol`);
          }
        }
      }

      if (msg.screener !== undefined && msg.screener !== null) {
        if (!isPlainObject(msg.screener)) return fail("INVALID_VIEW", "view.screener must be an object");
        if (!PRESET_SET.has(msg.screener.preset)) return fail("INVALID_VIEW", "view.screener.preset must be P1..P5");
        if (!isPosInt(msg.screener.page)) return fail("INVALID_VIEW", "view.screener.page must be an integer >= 1");
        if (msg.screener.evcTf !== undefined && !EVC_SET.has(msg.screener.evcTf)) {
          return fail("INVALID_VIEW", "view.screener.evcTf must be H|M|L");
        }
        if (msg.screener.dir !== undefined && !DIR_SET.has(msg.screener.dir)) {
          return fail("INVALID_VIEW", "view.screener.dir must be long|short");
        }
        if (msg.screener.market !== undefined && !isNonEmptyStr(msg.screener.market, 16)) {
          return fail("INVALID_VIEW", "view.screener.market must be a non-empty string <= 16 chars");
        }
        if (msg.screener.query !== undefined && (typeof msg.screener.query !== "string" || msg.screener.query.length > 64)) {
          return fail("INVALID_VIEW", "view.screener.query must be a string <= 64 chars");
        }
        if (msg.screener.pageSize !== undefined && (!isPosInt(msg.screener.pageSize) || msg.screener.pageSize > MAX_SCREENER_PAGE_ROWS)) {
          return fail("BUDGET_EXCEEDED", `view.screener.pageSize must be 1..${MAX_SCREENER_PAGE_ROWS}`);
        }
      }

      if (msg.heatmap !== undefined && msg.heatmap !== null) {
        if (!isPlainObject(msg.heatmap)) return fail("INVALID_VIEW", "view.heatmap must be an object");
        if (!HM_METRIC_SET.has(msg.heatmap.metric)) return fail("INVALID_VIEW", "view.heatmap.metric must be chg|mom|score");
        if (msg.heatmap.tf !== undefined && !HM_TF_SET.has(msg.heatmap.tf)) {
          return fail("INVALID_VIEW", "view.heatmap.tf must be 1H|4H|1D|1W");
        }
        if (msg.heatmap.n !== undefined && (!isPosInt(msg.heatmap.n) || msg.heatmap.n > MAX_HEATMAP_TILES)) {
          return fail("BUDGET_EXCEEDED", `view.heatmap.n must be 1..${MAX_HEATMAP_TILES}`);
        }
        if (msg.heatmap.size !== undefined && !HM_SIZE_SET.has(msg.heatmap.size)) {
          return fail("INVALID_VIEW", "view.heatmap.size must be value|equal");
        }
        if (msg.heatmap.market !== undefined && !isNonEmptyStr(msg.heatmap.market, 16)) {
          return fail("INVALID_VIEW", "view.heatmap.market must be a non-empty string <= 16 chars");
        }
      }

      return { ok: true, value: msg, bytes };
    }

    default:
      return fail("UNKNOWN_OP", `Unknown client op: ${String(msg.op)}`);
  }
}

/**
 * Validates a server → client protocol v2 frame against schema, sequence monotonicity,
 * zero-simulation rules, and payload budgets.
 * @param {object|string} input
 * @param {{lastSeq?:number, enforceBudget?:boolean}} [opts]
 * @returns {{ok:true, value:object, bytes:number}|{ok:false, code:string, error:string}}
 */
export function validateServerFrame(input, opts = {}) {
  let frame = input;
  let bytes = 0;

  if (typeof input === "string") {
    bytes = byteLength(input);
    try {
      frame = JSON.parse(input);
    } catch {
      return fail("INVALID_JSON", "Malformed JSON in server frame");
    }
  } else {
    if (!isPlainObject(frame)) return fail("INVALID_FRAME", "Server frame must be an object");
    bytes = byteLength(frame);
  }

  if (!isPlainObject(frame)) return fail("INVALID_FRAME", "Server frame must be an object");
  if (frame.v !== PROTOCOL_VERSION) {
    return fail("UNSUPPORTED_VERSION", `Server frame.v must equal ${PROTOCOL_VERSION}`);
  }
  if (!isNonNegInt(frame.seq)) {
    return fail("INVALID_SEQ", "Server frame.seq must be a non-negative safe integer");
  }
  if (opts.lastSeq !== undefined && opts.lastSeq !== null) {
    if (frame.seq <= opts.lastSeq) {
      return fail("NON_MONOTONIC_SEQ", `Server frame.seq (${frame.seq}) must be > lastSeq (${opts.lastSeq})`);
    }
  }
  if (!SERVER_TYPE_SET.has(frame.type)) {
    return fail("UNKNOWN_TYPE", `Unknown server frame type: ${String(frame.type)}`);
  }

  const enforceBudget = opts.enforceBudget !== false;
  if (enforceBudget && LIVE_TYPE_SET.has(frame.type) && bytes > MAX_LIVE_FRAME_BYTES) {
    return fail(
      "BUDGET_EXCEEDED",
      `Live frame '${frame.type}' (${bytes}B) exceeds MAX_LIVE_FRAME_BYTES (${MAX_LIVE_FRAME_BYTES}B)`
    );
  }

  switch (frame.type) {
    case "hello": {
      if (!isPosFinite(frame.serverTime)) return fail("INVALID_HELLO", "hello.serverTime must be positive finite");
      if (frame.session !== undefined && !isNonEmptyStr(frame.session, 128)) {
        return fail("INVALID_HELLO", "hello.session must be a non-empty string <= 128 chars");
      }
      if (frame.capabilities !== undefined && (!Array.isArray(frame.capabilities) || !frame.capabilities.every((c) => isNonEmptyStr(c, 64)))) {
        return fail("INVALID_HELLO", "hello.capabilities must be an array of strings");
      }
      return { ok: true, value: frame, bytes };
    }

    case "pong": {
      if (frame.t !== undefined && !isPosFinite(frame.t)) {
        return fail("INVALID_PONG", "pong.t must be positive finite");
      }
      return { ok: true, value: frame, bytes };
    }

    case "status": {
      const err = validateStatusPayload(frame);
      if (err) return err;
      return { ok: true, value: frame, bytes };
    }

    case "bar": {
      if (!isValidSymbol(frame.sym)) return fail("INVALID_BAR", "bar.sym must be a valid symbol");
      if (!VALID_TF_SET.has(frame.tf)) return fail("INVALID_BAR", "bar.tf must be a valid timeframe");
      const barErr = validateBarShape(frame.bar);
      if (barErr) return fail("INVALID_BAR", barErr);
      if (frame.closed !== undefined && typeof frame.closed !== "boolean") {
        return fail("INVALID_BAR", "bar.closed must be boolean");
      }
      if (frame.provenance !== undefined && !PROVENANCE_SET.has(frame.provenance)) {
        return fail("INVALID_BAR", "bar.provenance must be LIVE|DELAYED|RECONNECTING|CACHED|UNAVAILABLE");
      }
      if (frame.asOf !== undefined && !isPosFinite(frame.asOf)) {
        return fail("INVALID_BAR", "bar.asOf must be a positive timestamp");
      }
      return { ok: true, value: frame, bytes };
    }

    case "ind": {
      if (!isValidSymbol(frame.sym)) return fail("INVALID_IND", "ind.sym must be a valid symbol");
      if (!VALID_TF_SET.has(frame.tf)) return fail("INVALID_IND", "ind.tf must be a valid timeframe");
      if (!isNonEmptyStr(frame.id, 64)) return fail("INVALID_IND", "ind.id must be a non-empty string");
      if (frame.point === undefined && !Array.isArray(frame.points)) {
        return fail("INVALID_IND", "ind must include point or points");
      }
      if (frame.reset !== undefined && typeof frame.reset !== "boolean") {
        return fail("INVALID_IND", "ind.reset must be boolean");
      }
      return { ok: true, value: frame, bytes };
    }

    case "vs": {
      if (!isValidSymbol(frame.sym)) return fail("INVALID_VS", "vs.sym must be a valid symbol");
      if (!VALID_TF_SET.has(frame.tf)) return fail("INVALID_VS", "vs.tf must be a valid timeframe");
      if (!isNonEmptyStr(frame.id, 64)) return fail("INVALID_VS", "vs.id must be a non-empty string");
      if (frame.error !== undefined) {
        if (!isPlainObject(frame.error) || !isNonEmptyStr(frame.error.message, 512)) {
          return fail("INVALID_VS", "vs.error must be an object with non-empty message");
        }
        if (frame.error.line !== undefined && !isPosInt(frame.error.line)) {
          return fail("INVALID_VS", "vs.error.line must be a positive integer");
        }
        if (frame.error.col !== undefined && !isPosInt(frame.error.col)) {
          return fail("INVALID_VS", "vs.error.col must be a positive integer");
        }
        if (frame.error.hint !== undefined && !isNonEmptyStr(frame.error.hint, 256)) {
          return fail("INVALID_VS", "vs.error.hint must be a non-empty string");
        }
        return { ok: true, value: frame, bytes };
      }
      if (!Array.isArray(frame.plots) && !Array.isArray(frame.markers)) {
        return fail("INVALID_VS", "vs frame must contain plots, markers, or error");
      }
      return { ok: true, value: frame, bytes };
    }

    case "quotes": {
      if (!Array.isArray(frame.quotes) || frame.quotes.length === 0) {
        return fail("INVALID_QUOTES", "quotes.quotes must be a non-empty array");
      }
      for (let i = 0; i < frame.quotes.length; i++) {
        const qErr = validateQuoteShape(frame.quotes[i]);
        if (qErr) return fail("INVALID_QUOTES", `quotes[${i}]: ${qErr}`);
      }
      return { ok: true, value: frame, bytes };
    }

    case "screener": {
      const err = validateScreenerBody(frame);
      if (err) return err;
      return { ok: true, value: frame, bytes };
    }

    case "heatmap": {
      const err = validateHeatmapBody(frame);
      if (err) return err;
      return { ok: true, value: frame, bytes };
    }

    case "alert": {
      if (!isNonEmptyStr(frame.id, 64)) return fail("INVALID_ALERT", "alert.id must be a non-empty string");
      if (!isValidSymbol(frame.sym)) return fail("INVALID_ALERT", "alert.sym must be a valid symbol");
      if (!isNonEmptyStr(frame.condition, 128)) return fail("INVALID_ALERT", "alert.condition must be a non-empty string");
      if (!isPosFinite(frame.price)) return fail("INVALID_ALERT", "alert.price must be positive finite");
      if (!isPosFinite(frame.triggeredAt)) return fail("INVALID_ALERT", "alert.triggeredAt must be positive finite");
      if (frame.message !== undefined && !isNonEmptyStr(frame.message, 256)) {
        return fail("INVALID_ALERT", "alert.message must be a non-empty string <= 256 chars");
      }
      return { ok: true, value: frame, bytes };
    }

    case "error": {
      if (!isNonEmptyStr(frame.code, 64)) return fail("INVALID_ERROR", "error.code must be a non-empty string");
      if (!isNonEmptyStr(frame.message, 512)) return fail("INVALID_ERROR", "error.message must be a non-empty string");
      if (frame.fatal !== undefined && typeof frame.fatal !== "boolean") {
        return fail("INVALID_ERROR", "error.fatal must be boolean");
      }
      return { ok: true, value: frame, bytes };
    }

    case "state": {
      const stErr = validateStatusPayload(frame.status);
      if (stErr) return stErr;

      if (frame.chart !== undefined && frame.chart !== null) {
        if (!isPlainObject(frame.chart)) return fail("INVALID_STATE", "state.chart must be an object");
        if (!isValidSymbol(frame.chart.sym)) return fail("INVALID_STATE", "state.chart.sym must be a valid symbol");
        if (!VALID_TF_SET.has(frame.chart.tf)) return fail("INVALID_STATE", "state.chart.tf must be a valid timeframe");
        if (!Array.isArray(frame.chart.bars)) return fail("INVALID_STATE", "state.chart.bars must be an array");
        if (frame.chart.bars.length > MAX_CHART_BARS) {
          return fail("BUDGET_EXCEEDED", `state.chart.bars (${frame.chart.bars.length}) exceeds MAX_CHART_BARS (${MAX_CHART_BARS})`);
        }
        for (let i = 0; i < frame.chart.bars.length; i++) {
          const bErr = validateBarShape(frame.chart.bars[i]);
          if (bErr) return fail("INVALID_STATE", `state.chart.bars[${i}]: ${bErr}`);
        }
      }

      if (frame.watchlist !== undefined) {
        if (!Array.isArray(frame.watchlist)) return fail("INVALID_STATE", "state.watchlist must be an array");
        if (frame.watchlist.length > MAX_WATCHLIST_SYMBOLS) {
          return fail("BUDGET_EXCEEDED", `state.watchlist exceeds MAX_WATCHLIST_SYMBOLS (${MAX_WATCHLIST_SYMBOLS})`);
        }
        for (let i = 0; i < frame.watchlist.length; i++) {
          const qErr = validateQuoteShape(frame.watchlist[i]);
          if (qErr) return fail("INVALID_STATE", `state.watchlist[${i}]: ${qErr}`);
        }
      }

      if (frame.screener !== undefined && frame.screener !== null) {
        const scErr = validateScreenerBody(frame.screener);
        if (scErr) return scErr;
      }

      if (frame.heatmap !== undefined && frame.heatmap !== null) {
        const hmErr = validateHeatmapBody(frame.heatmap);
        if (hmErr) return hmErr;
      }

      return { ok: true, value: frame, bytes };
    }

    default:
      return fail("UNKNOWN_TYPE", `Unknown server frame type: ${String(frame.type)}`);
  }
}

/**
 * Constructs a versioned server → client frame (`v: 2`, `seq`, `type`, ...payload).
 * Validates by default and throws an Error if schema or budget checks fail.
 * @param {string} type
 * @param {object} payload
 * @param {number} seq
 * @param {{validate?:boolean, enforceBudget?:boolean}} [opts]
 * @returns {object}
 */
export function makeFrame(type, payload, seq, opts = {}) {
  const frame = Object.assign({ v: PROTOCOL_VERSION, seq, type }, payload || {});
  if (opts.validate !== false) {
    const res = validateServerFrame(frame, { enforceBudget: opts.enforceBudget });
    if (!res.ok) {
      const err = new Error(`[protocol v${PROTOCOL_VERSION}] ${res.code}: ${res.error}`);
      err.code = res.code;
      throw err;
    }
  }
  return frame;
}

/**
 * Packs a list of coalesced quotes into one or more valid `quotes` frames, each strictly <= maxBytes.
 * Guarantees fan-out broadcasts never exceed MAX_LIVE_FRAME_BYTES even when many symbols update at once.
 * @param {Array<object>} quotes
 * @param {() => number} nextSeq
 * @param {number} [maxBytes=MAX_LIVE_FRAME_BYTES]
 * @returns {Array<object>}
 */
export function packQuoteFrames(quotes, nextSeq, maxBytes = MAX_LIVE_FRAME_BYTES) {
  if (!Array.isArray(quotes) || quotes.length === 0) return [];
  const frames = [];
  let bucket = [];

  for (const q of quotes) {
    const candidate = bucket.concat(q);
    const probe = { v: PROTOCOL_VERSION, seq: 999999999, type: "quotes", quotes: candidate };
    if (byteLength(probe) <= maxBytes) {
      bucket = candidate;
      continue;
    }
    if (bucket.length > 0) {
      frames.push(makeFrame("quotes", { quotes: bucket }, nextSeq()));
      bucket = [q];
    } else {
      // Even a single quote exceeds budget — let makeFrame reject it cleanly.
      frames.push(makeFrame("quotes", { quotes: [q] }, nextSeq()));
    }
  }

  if (bucket.length > 0) {
    frames.push(makeFrame("quotes", { quotes: bucket }, nextSeq()));
  }
  return frames;
}
