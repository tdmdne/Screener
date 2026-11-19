// src/data_service.js — Browser-loadable render-only Protocol v2 transport.
// Matches functions/_middleware.js static allowlist (/src/<name>.js) with zero external imports.
// Same-origin HTTP (/api/bootstrap, /api/bars), single /ws with backoff + jitter,
// auto-replay of hello{v:2} + latest view, /api/sse fallback, and rAF frame batching.

export const PROTOCOL_VERSION = 2;

export const MAX_SCREENER_PAGE_ROWS = 50;
export const MAX_CHART_BARS = 1500;
export const MAX_WATCHLIST_SYMBOLS = 100;
export const MAX_HEATMAP_TILES = 100;
export const MAX_CLIENT_FRAME_BYTES = 8192;

export const PROVENANCE = Object.freeze({
  LIVE: "LIVE",
  DELAYED: "DELAYED",
  CACHED: "CACHED",
  UNAVAILABLE: "UNAVAILABLE",
});

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

const VALID_FRAME_TYPES = new Set(SERVER_TYPES);
const PROVENANCE_VALUES = new Set(Object.values(PROVENANCE));
const HTTP_SCHEMES = new Set(["http:", "https:"]);
const WS_SCHEMES = new Set(["ws:", "wss:"]);
const PRESET_SET = new Set(["P1", "P2", "P3", "P4", "P5"]);
const EVC_SET = new Set(["H", "M", "L"]);
const DIR_SET = new Set(["long", "short"]);
const HM_METRIC_SET = new Set(["chg", "mom", "score"]);
const HM_TF_SET = new Set(["1H", "4H", "1D", "1W", "1h", "4h", "1d", "1w"]);
const HM_SIZE_SET = new Set(["value", "equal"]);
const VALID_TF_SET = new Set([
  "1m", "5m", "15m", "30m",
  "1h", "4h", "1d", "1w",
  "1H", "4H", "1D", "1W", "1M",
]);
const SYMBOL_RE = /^[A-Z0-9.=^/-]{1,24}$/i;
const FORBIDDEN_SOURCE_RE = /(^|[+:\s_/-])(sim|simulated|synthetic|mock|fake|demo)($|[+:\s_/-])/i;
const CONTROL_OR_SPACE_RE = /[\u0000-\u0020\u007f]/;
const SENTINEL_ORIGIN = ["https:", "", "same-origin.invalid"].join("/");

const MAX_PENDING_BARS = 256;
const MAX_PENDING_QUOTES = 512;
const DEFAULT_RESYNC_THROTTLE_MS = 2000;

const encoder = new TextEncoder();

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isPosFinite = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
const isNonNegFinite = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isNonNegInt = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isPosInt = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const isNonEmptyStr = (v, max = 256) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isValidSymbol = (v) => typeof v === "string" && SYMBOL_RE.test(v.trim());
const isForbiddenSource = (s) => typeof s !== "string" || !s.trim() || FORBIDDEN_SOURCE_RE.test(s.trim());

function byteLength(frameOrStr) {
  const str = typeof frameOrStr === "string" ? frameOrStr : JSON.stringify(frameOrStr);
  return encoder.encode(str).byteLength;
}

let fallbackJitterCounter = 0;

function cryptoUnitFloat() {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0] / 4294967296;
  }
  fallbackJitterCounter = (fallbackJitterCounter + 1) % 16;
  return (fallbackJitterCounter + 0.5) / 16;
}

function makeOriginError(message) {
  const err = new Error(message);
  err.code = "CROSS_ORIGIN_BLOCKED";
  return err;
}

function getPageOrigin() {
  return typeof globalThis.location === "object" &&
    globalThis.location &&
    typeof globalThis.location.origin === "string" &&
    globalThis.location.origin !== "null"
    ? globalThis.location.origin.trim()
    : "";
}

function normalizeOrigin(rawOrigin, fallbackOrigin = getPageOrigin()) {
  const fallback = typeof fallbackOrigin === "string" ? fallbackOrigin.trim() : "";
  const rawStr = rawOrigin === undefined || rawOrigin === null ? "" : String(rawOrigin).trim();
  // Never allow an empty string to override a valid page/fallback origin.
  const chosen = rawStr || fallback;
  if (!chosen) return "";
  if (CONTROL_OR_SPACE_RE.test(chosen)) {
    throw makeOriginError(`Invalid origin: ${chosen}`);
  }

  let parsed;
  try {
    parsed = new URL(chosen);
  } catch {
    throw makeOriginError(`Invalid origin: ${chosen}`);
  }
  if (!HTTP_SCHEMES.has(parsed.protocol)) {
    throw makeOriginError(`Unsupported origin protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw makeOriginError(`Origin must not include credentials: ${chosen}`);
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw makeOriginError(`Origin must not include a path: ${chosen}`);
  }
  if (parsed.search || parsed.hash) {
    throw makeOriginError(`Origin must not include query or hash: ${chosen}`);
  }
  if (fallback && parsed.origin !== fallback) {
    throw makeOriginError(`Configured origin (${parsed.origin}) does not match page origin (${fallback})`);
  }
  return parsed.origin;
}

/**
 * Validates that `target` resolves strictly to `expectedOrigin`.
 * Rejects control characters, whitespace, embedded credentials, protocol-relative URLs,
 * backslashes, non-HTTP(S)/WS(S) schemes, and any cross-origin host or port.
 *
 * @param {string} target
 * @param {string} expectedOrigin
 * @param {{ ws?: boolean }} [opts]
 * @returns {string}
 */
export function assertSameOrigin(target, expectedOrigin, { ws = false } = {}) {
  if (typeof target !== "string" || target.length === 0) {
    throw makeOriginError("URL must be a non-empty string");
  }
  if (CONTROL_OR_SPACE_RE.test(target)) {
    throw makeOriginError(`URL contains forbidden control or whitespace characters: ${JSON.stringify(target)}`);
  }

  if (target.startsWith("//") || target.includes("\\")) {
    throw makeOriginError(`Cross-origin or unsafe URL rejected: ${target}`);
  }

  const hasScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target);
  if (!expectedOrigin) {
    if (hasScheme) {
      throw makeOriginError(`Absolute URL rejected without matching origin: ${target}`);
    }
    if (!target.startsWith("/")) {
      throw makeOriginError(`Relative path must start with '/': ${target}`);
    }
    let parsed;
    try {
      parsed = new URL(target, SENTINEL_ORIGIN);
    } catch {
      throw makeOriginError(`Malformed relative URL rejected: ${target}`);
    }
    if (parsed.origin !== SENTINEL_ORIGIN || parsed.username || parsed.password) {
      throw makeOriginError(`Cross-origin or unsafe relative URL rejected: ${target}`);
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  let base;
  try {
    base = new URL(expectedOrigin);
  } catch {
    throw makeOriginError(`Invalid expected origin: ${expectedOrigin}`);
  }
  if (!HTTP_SCHEMES.has(base.protocol) || base.username || base.password) {
    throw makeOriginError(`Unsafe expected origin rejected: ${expectedOrigin}`);
  }

  let parsed;
  try {
    parsed = hasScheme ? new URL(target) : new URL(target, base);
  } catch {
    throw makeOriginError(`Malformed URL rejected: ${target}`);
  }

  if (parsed.username || parsed.password) {
    throw makeOriginError(`URL with embedded credentials rejected: ${target}`);
  }

  if (ws) {
    const expectedWsProto = base.protocol === "https:" ? "wss:" : "ws:";
    if (WS_SCHEMES.has(parsed.protocol)) {
      if (parsed.protocol !== expectedWsProto || parsed.host !== base.host) {
        throw makeOriginError(`Cross-origin WebSocket URL rejected: ${target}`);
      }
      return parsed.toString();
    }
    if (HTTP_SCHEMES.has(parsed.protocol)) {
      if (parsed.origin !== base.origin) {
        throw makeOriginError(`Cross-origin WebSocket URL rejected: ${target}`);
      }
      return `${expectedWsProto}//${base.host}${parsed.pathname}${parsed.search}`;
    }
    throw makeOriginError(`Unsupported WebSocket protocol rejected: ${parsed.protocol}`);
  }

  if (!HTTP_SCHEMES.has(parsed.protocol) || parsed.origin !== base.origin) {
    throw makeOriginError(`Cross-origin URL rejected: ${target}`);
  }
  return parsed.toString();
}

function assertSameOriginApiPath(target, expectedOrigin) {
  const checked = assertSameOrigin(target, expectedOrigin);
  const base = expectedOrigin || SENTINEL_ORIGIN;
  const parsed = new URL(checked, base);
  if (!parsed.pathname.startsWith("/api/")) {
    throw makeOriginError(`Bootstrap endpoint must be under /api/: ${target}`);
  }
  return checked;
}

export function validateClientMessage(input) {
  let msg = input;
  let bytes = 0;

  if (typeof input === "string") {
    bytes = byteLength(input);
    if (bytes > MAX_CLIENT_FRAME_BYTES) {
      return {
        ok: false,
        code: "BUDGET_EXCEEDED",
        error: `Client frame (${bytes}B) exceeds MAX_CLIENT_FRAME_BYTES (${MAX_CLIENT_FRAME_BYTES}B)`,
      };
    }
    try {
      msg = JSON.parse(input);
    } catch {
      return { ok: false, code: "INVALID_JSON", error: "Malformed JSON in client message" };
    }
  } else {
    if (!isPlainObject(msg)) {
      return { ok: false, code: "INVALID_MESSAGE", error: "Client message must be an object" };
    }
    bytes = byteLength(msg);
    if (bytes > MAX_CLIENT_FRAME_BYTES) {
      return {
        ok: false,
        code: "BUDGET_EXCEEDED",
        error: `Client frame (${bytes}B) exceeds MAX_CLIENT_FRAME_BYTES (${MAX_CLIENT_FRAME_BYTES}B)`,
      };
    }
  }

  if (!isPlainObject(msg)) return { ok: false, code: "INVALID_MESSAGE", error: "Client message must be an object" };
  if (msg.op === "hello") {
    if (msg.v !== PROTOCOL_VERSION) return { ok: false, code: "UNSUPPORTED_VERSION", error: "hello.v must equal 2" };
    if (msg.session !== undefined && msg.session !== null && !isNonEmptyStr(msg.session, 128)) {
      return { ok: false, code: "INVALID_HELLO", error: "hello.session must be a non-empty string <= 128 chars" };
    }
    return { ok: true, value: msg, bytes };
  }
  if (msg.op === "ping") {
    if (msg.t !== undefined && !isPosFinite(msg.t)) {
      return { ok: false, code: "INVALID_PING", error: "ping.t must be positive finite" };
    }
    return { ok: true, value: msg, bytes };
  }
  if (msg.op === "view") {
    const hasSection =
      msg.chart !== undefined ||
      msg.watchlist !== undefined ||
      msg.screener !== undefined ||
      msg.heatmap !== undefined;
    if (!hasSection) {
      return { ok: false, code: "INVALID_VIEW", error: "view must specify chart, watchlist, screener, or heatmap" };
    }
    if (msg.chart !== undefined && msg.chart !== null) {
      if (!isPlainObject(msg.chart)) return { ok: false, code: "INVALID_VIEW", error: "view.chart must be an object" };
      if (!isValidSymbol(msg.chart.sym)) return { ok: false, code: "INVALID_VIEW", error: "view.chart.sym is invalid" };
      if (!VALID_TF_SET.has(msg.chart.tf)) return { ok: false, code: "INVALID_VIEW", error: "view.chart.tf is invalid" };
      if (msg.chart.ind !== undefined) {
        if (!Array.isArray(msg.chart.ind) || msg.chart.ind.length > 24) {
          return { ok: false, code: "INVALID_VIEW", error: "view.chart.ind must be an array of at most 24 items" };
        }
        for (let i = 0; i < msg.chart.ind.length; i++) {
          const ind = msg.chart.ind[i];
          if (typeof ind === "string") {
            if (!isNonEmptyStr(ind, 64)) {
              return { ok: false, code: "INVALID_VIEW", error: `view.chart.ind[${i}] must be a non-empty string` };
            }
          } else if (isPlainObject(ind)) {
            if (!isNonEmptyStr(ind.type ?? ind.id, 64)) {
              return { ok: false, code: "INVALID_VIEW", error: `view.chart.ind[${i}] object requires type or id` };
            }
          } else {
            return { ok: false, code: "INVALID_VIEW", error: `view.chart.ind[${i}] must be a string or descriptor object` };
          }
        }
      }
      if (msg.chart.vs !== undefined) {
        if (!Array.isArray(msg.chart.vs) || msg.chart.vs.length > 10) {
          return { ok: false, code: "INVALID_VIEW", error: "view.chart.vs must be an array of at most 10 items" };
        }
        for (let i = 0; i < msg.chart.vs.length; i++) {
          if (!isNonEmptyStr(msg.chart.vs[i], 64)) {
            return { ok: false, code: "INVALID_VIEW", error: `view.chart.vs[${i}] must be a non-empty script ID` };
          }
        }
      }
    }
    if (msg.watchlist !== undefined) {
      if (!Array.isArray(msg.watchlist)) {
        return { ok: false, code: "INVALID_VIEW", error: "view.watchlist must be an array" };
      }
      if (msg.watchlist.length > MAX_WATCHLIST_SYMBOLS) {
        return {
          ok: false,
          code: "BUDGET_EXCEEDED",
          error: `view.watchlist (${msg.watchlist.length}) exceeds MAX_WATCHLIST_SYMBOLS (${MAX_WATCHLIST_SYMBOLS})`,
        };
      }
      for (let i = 0; i < msg.watchlist.length; i++) {
        if (!isValidSymbol(msg.watchlist[i])) {
          return { ok: false, code: "INVALID_VIEW", error: `view.watchlist[${i}] is invalid` };
        }
      }
    }
    if (msg.screener !== undefined && msg.screener !== null) {
      if (!isPlainObject(msg.screener)) return { ok: false, code: "INVALID_VIEW", error: "view.screener must be an object" };
      if (!PRESET_SET.has(msg.screener.preset)) return { ok: false, code: "INVALID_VIEW", error: "view.screener.preset must be P1..P5" };
      if (!isPosInt(msg.screener.page)) return { ok: false, code: "INVALID_VIEW", error: "view.screener.page must be >= 1" };
      if (msg.screener.evcTf !== undefined && !EVC_SET.has(msg.screener.evcTf)) {
        return { ok: false, code: "INVALID_VIEW", error: "view.screener.evcTf must be H|M|L" };
      }
      if (msg.screener.dir !== undefined && !DIR_SET.has(msg.screener.dir)) {
        return { ok: false, code: "INVALID_VIEW", error: "view.screener.dir must be long|short" };
      }
      if (msg.screener.market !== undefined && !isNonEmptyStr(msg.screener.market, 16)) {
        return { ok: false, code: "INVALID_VIEW", error: "view.screener.market must be a non-empty string <= 16 chars" };
      }
      if (msg.screener.query !== undefined && (typeof msg.screener.query !== "string" || msg.screener.query.length > 64)) {
        return { ok: false, code: "INVALID_VIEW", error: "view.screener.query must be a string <= 64 chars" };
      }
      if (msg.screener.pageSize !== undefined && (!isPosInt(msg.screener.pageSize) || msg.screener.pageSize > MAX_SCREENER_PAGE_ROWS)) {
        return { ok: false, code: "BUDGET_EXCEEDED", error: `view.screener.pageSize must be 1..${MAX_SCREENER_PAGE_ROWS}` };
      }
    }
    if (msg.heatmap !== undefined && msg.heatmap !== null) {
      if (!isPlainObject(msg.heatmap)) return { ok: false, code: "INVALID_VIEW", error: "view.heatmap must be an object" };
      if (!HM_METRIC_SET.has(msg.heatmap.metric)) return { ok: false, code: "INVALID_VIEW", error: "view.heatmap.metric must be chg|mom|score" };
      if (msg.heatmap.tf !== undefined && !HM_TF_SET.has(msg.heatmap.tf)) {
        return { ok: false, code: "INVALID_VIEW", error: "view.heatmap.tf is invalid" };
      }
      if (msg.heatmap.n !== undefined && (!isPosInt(msg.heatmap.n) || msg.heatmap.n > MAX_HEATMAP_TILES)) {
        return { ok: false, code: "BUDGET_EXCEEDED", error: `view.heatmap.n must be 1..${MAX_HEATMAP_TILES}` };
      }
      if (msg.heatmap.size !== undefined && !HM_SIZE_SET.has(msg.heatmap.size)) {
        return { ok: false, code: "INVALID_VIEW", error: "view.heatmap.size must be value|equal" };
      }
      if (msg.heatmap.market !== undefined && !isNonEmptyStr(msg.heatmap.market, 16)) {
        return { ok: false, code: "INVALID_VIEW", error: "view.heatmap.market must be a non-empty string <= 16 chars" };
      }
    }
    return { ok: true, value: msg, bytes };
  }
  return { ok: false, code: "UNKNOWN_OP", error: `Unknown op: ${String(msg.op)}` };
}

function validateBarShape(bar) {
  if (Array.isArray(bar)) {
    if (bar.length < 5 || bar.length > 6) return "bar tuple must have 5 or 6 elements [t,o,h,l,c,v?]";
    const [t, o, h, l, c, v = 0] = bar;
    if (!isPosFinite(t) || !isPosFinite(o) || !isPosFinite(h) || !isPosFinite(l) || !isPosFinite(c)) {
      return "bar requires positive finite [t,o,h,l,c]";
    }
    if (!isNonNegFinite(v)) return "bar volume must be non-negative finite";
    if (h < Math.max(o, c) || l > Math.min(o, c)) return "bar high/low must bracket open/close";
    return null;
  }
  if (isPlainObject(bar)) {
    const { t, o, h, l, c, v = 0 } = bar;
    if (!isPosFinite(t) || !isPosFinite(o) || !isPosFinite(h) || !isPosFinite(l) || !isPosFinite(c)) {
      return "bar requires positive finite {t,o,h,l,c}";
    }
    if (!isNonNegFinite(v)) return "bar volume must be non-negative finite";
    if (h < Math.max(o, c) || l > Math.min(o, c)) return "bar high/low must bracket open/close";
    return null;
  }
  return "bar must be a tuple [t,o,h,l,c,v] or object {t,o,h,l,c,v}";
}

function validateQuoteShape(q) {
  if (!isPlainObject(q)) return "quote must be an object";
  if (!isValidSymbol(q.s)) return "quote.s is invalid";
  if (!isPosFinite(q.c) || !isPosFinite(q.t)) return "quote.c and quote.t must be positive finite";
  if (q.bid !== undefined && !isPosFinite(q.bid)) return "quote.bid must be positive finite";
  if (q.ask !== undefined && !isPosFinite(q.ask)) return "quote.ask must be positive finite";
  if (q.bid !== undefined && q.ask !== undefined && q.bid > q.ask) return "quote.bid cannot exceed quote.ask";
  if (q.v !== undefined && !isNonNegFinite(q.v)) return "quote.v must be non-negative finite";
  if (q.chgPct !== undefined && (typeof q.chgPct !== "number" || !Number.isFinite(q.chgPct))) {
    return "quote.chgPct must be finite";
  }
  if (q.provenance !== undefined && !PROVENANCE_VALUES.has(q.provenance)) return "quote.provenance is invalid";
  if (q.source !== undefined && isForbiddenSource(q.source)) return "quote.source is forbidden";
  return null;
}

function validateStatusObj(s) {
  if (!isPlainObject(s)) return { ok: false, code: "INVALID_STATUS", error: "status must be an object" };
  if (!PROVENANCE_VALUES.has(s.provenance)) {
    return { ok: false, code: "INVALID_STATUS", error: "status.provenance must be LIVE|DELAYED|CACHED|UNAVAILABLE" };
  }
  if (!isPosFinite(s.asOf)) return { ok: false, code: "INVALID_STATUS", error: "status.asOf must be positive finite" };
  if (s.sym !== undefined && !isValidSymbol(s.sym)) {
    return { ok: false, code: "INVALID_STATUS", error: "status.sym is invalid" };
  }
  if (s.detail !== undefined && !isNonEmptyStr(s.detail, 256)) {
    return { ok: false, code: "INVALID_STATUS", error: "status.detail must be a string <= 256 chars" };
  }
  return null;
}

function validateScreenerObj(body) {
  if (!isPlainObject(body)) return { ok: false, code: "INVALID_SCREENER", error: "screener must be an object" };
  if (!isPosInt(body.page) || !isPosInt(body.totalPages) || !isNonNegInt(body.total)) {
    return { ok: false, code: "INVALID_SCREENER", error: "invalid screener pagination" };
  }
  if (!PRESET_SET.has(body.preset) || !isPosFinite(body.asOf) || !Array.isArray(body.rows)) {
    return { ok: false, code: "INVALID_SCREENER", error: "invalid screener fields" };
  }
  if (body.rows.length > MAX_SCREENER_PAGE_ROWS) {
    return { ok: false, code: "BUDGET_EXCEEDED", error: `screener rows exceed ${MAX_SCREENER_PAGE_ROWS}` };
  }
  for (let i = 0; i < body.rows.length; i++) {
    const r = body.rows[i];
    if (!isPlainObject(r) || !isValidSymbol(r.symbol) || !isPosFinite(r.asOf)) {
      return { ok: false, code: "INVALID_SCREENER", error: `screener.rows[${i}] is invalid` };
    }
    if (isForbiddenSource(r.source)) {
      return { ok: false, code: "FORBIDDEN_SOURCE", error: `screener.rows[${i}].source is forbidden` };
    }
  }
  return null;
}

function validateHeatmapObj(body) {
  if (!isPlainObject(body)) return { ok: false, code: "INVALID_HEATMAP", error: "heatmap must be an object" };
  if (!HM_METRIC_SET.has(body.metric)) return { ok: false, code: "INVALID_HEATMAP", error: "heatmap.metric must be chg|mom|score" };
  if (body.tf !== undefined && !HM_TF_SET.has(body.tf)) {
    return { ok: false, code: "INVALID_HEATMAP", error: "heatmap.tf must be 1H|4H|1D|1W" };
  }
  if (body.range !== undefined && !isPosFinite(body.range)) {
    return { ok: false, code: "INVALID_HEATMAP", error: "heatmap.range must be positive finite" };
  }
  if (!isPosFinite(body.asOf) || !Array.isArray(body.tiles)) {
    return { ok: false, code: "INVALID_HEATMAP", error: "invalid heatmap fields" };
  }
  if (body.tiles.length > MAX_HEATMAP_TILES) {
    return { ok: false, code: "BUDGET_EXCEEDED", error: `heatmap tiles exceed ${MAX_HEATMAP_TILES}` };
  }
  for (let i = 0; i < body.tiles.length; i++) {
    const t = body.tiles[i];
    if (!isPlainObject(t) || !isValidSymbol(t.symbol)) {
      return { ok: false, code: "INVALID_HEATMAP", error: `heatmap.tiles[${i}] is invalid` };
    }
    if (t.value !== null && (typeof t.value !== "number" || !Number.isFinite(t.value))) {
      return { ok: false, code: "INVALID_HEATMAP", error: `heatmap.tiles[${i}].value must be finite number or null` };
    }
    if (!isPosFinite(t.weight) || !isPosFinite(t.asOf)) {
      return { ok: false, code: "INVALID_HEATMAP", error: `heatmap.tiles[${i}] is invalid` };
    }
    if (isForbiddenSource(t.source)) {
      return { ok: false, code: "FORBIDDEN_SOURCE", error: `heatmap.tiles[${i}].source is forbidden` };
    }
  }
  return null;
}

export function validateServerFrame(input) {
  let frame = input;
  if (typeof input === "string") {
    try {
      frame = JSON.parse(input);
    } catch {
      return { ok: false, code: "INVALID_JSON", error: "Malformed JSON in server frame" };
    }
  }
  if (!isPlainObject(frame)) return { ok: false, code: "INVALID_FRAME", error: "Server frame must be an object" };
  if (frame.v !== PROTOCOL_VERSION) return { ok: false, code: "UNSUPPORTED_VERSION", error: "Server frame.v must equal 2" };
  if (!isNonNegInt(frame.seq)) return { ok: false, code: "INVALID_SEQ", error: "Server frame.seq must be a non-negative integer" };
  if (!VALID_FRAME_TYPES.has(frame.type)) return { ok: false, code: "UNKNOWN_TYPE", error: `Unknown frame type: ${String(frame.type)}` };

  switch (frame.type) {
    case "hello":
      if (!isPosFinite(frame.serverTime)) return { ok: false, code: "INVALID_HELLO", error: "hello.serverTime is invalid" };
      if (frame.session !== undefined && !isNonEmptyStr(frame.session, 128)) {
        return { ok: false, code: "INVALID_HELLO", error: "hello.session must be a non-empty string <= 128 chars" };
      }
      if (frame.capabilities !== undefined && (!Array.isArray(frame.capabilities) || !frame.capabilities.every((c) => isNonEmptyStr(c, 64)))) {
        return { ok: false, code: "INVALID_HELLO", error: "hello.capabilities must be an array of strings" };
      }
      return { ok: true, value: frame };
    case "pong":
      if (frame.t !== undefined && !isPosFinite(frame.t)) {
        return { ok: false, code: "INVALID_PONG", error: "pong.t must be positive finite" };
      }
      return { ok: true, value: frame };
    case "status": {
      const err = validateStatusObj(frame);
      return err || { ok: true, value: frame };
    }
    case "bar": {
      if (!isValidSymbol(frame.sym) || !VALID_TF_SET.has(frame.tf)) {
        return { ok: false, code: "INVALID_BAR", error: "bar.sym or bar.tf is invalid" };
      }
      const bErr = validateBarShape(frame.bar);
      if (bErr) return { ok: false, code: "INVALID_BAR", error: bErr };
      if (frame.closed !== undefined && typeof frame.closed !== "boolean") {
        return { ok: false, code: "INVALID_BAR", error: "bar.closed must be boolean" };
      }
      if (frame.provenance !== undefined && !PROVENANCE_VALUES.has(frame.provenance)) {
        return { ok: false, code: "INVALID_BAR", error: "bar.provenance is invalid" };
      }
      if (frame.asOf !== undefined && !isPosFinite(frame.asOf)) {
        return { ok: false, code: "INVALID_BAR", error: "bar.asOf must be a positive timestamp" };
      }
      if (frame.source !== undefined && isForbiddenSource(frame.source)) {
        return { ok: false, code: "FORBIDDEN_SOURCE", error: "bar.source is forbidden" };
      }
      return { ok: true, value: frame };
    }
    case "ind":
      if (!isValidSymbol(frame.sym) || !VALID_TF_SET.has(frame.tf) || !isNonEmptyStr(frame.id, 64)) {
        return { ok: false, code: "INVALID_IND", error: "invalid ind frame" };
      }
      if (frame.point === undefined && !Array.isArray(frame.points)) {
        return { ok: false, code: "INVALID_IND", error: "ind requires point or points" };
      }
      if (frame.reset !== undefined && typeof frame.reset !== "boolean") {
        return { ok: false, code: "INVALID_IND", error: "ind.reset must be boolean" };
      }
      return { ok: true, value: frame };
    case "vs":
      if (!isValidSymbol(frame.sym) || !VALID_TF_SET.has(frame.tf) || !isNonEmptyStr(frame.id, 64)) {
        return { ok: false, code: "INVALID_VS", error: "invalid vs frame" };
      }
      if (frame.error !== undefined) {
        if (!isPlainObject(frame.error) || !isNonEmptyStr(frame.error.message, 512)) {
          return { ok: false, code: "INVALID_VS", error: "vs.error must be an object with non-empty message" };
        }
        if (frame.error.line !== undefined && !isPosInt(frame.error.line)) {
          return { ok: false, code: "INVALID_VS", error: "vs.error.line must be a positive integer" };
        }
        if (frame.error.col !== undefined && !isPosInt(frame.error.col)) {
          return { ok: false, code: "INVALID_VS", error: "vs.error.col must be a positive integer" };
        }
        if (frame.error.hint !== undefined && !isNonEmptyStr(frame.error.hint, 256)) {
          return { ok: false, code: "INVALID_VS", error: "vs.error.hint must be a non-empty string" };
        }
        return { ok: true, value: frame };
      }
      if (!Array.isArray(frame.plots) && !Array.isArray(frame.markers)) {
        return { ok: false, code: "INVALID_VS", error: "vs requires plots, markers, or error" };
      }
      return { ok: true, value: frame };
    case "quotes":
      if (!Array.isArray(frame.quotes) || frame.quotes.length === 0) {
        return { ok: false, code: "INVALID_QUOTES", error: "quotes must be a non-empty array" };
      }
      for (let i = 0; i < frame.quotes.length; i++) {
        const qErr = validateQuoteShape(frame.quotes[i]);
        if (qErr) return { ok: false, code: "INVALID_QUOTES", error: `quotes[${i}]: ${qErr}` };
      }
      return { ok: true, value: frame };
    case "screener": {
      const err = validateScreenerObj(frame);
      return err || { ok: true, value: frame };
    }
    case "heatmap": {
      const err = validateHeatmapObj(frame);
      return err || { ok: true, value: frame };
    }
    case "alert":
      if (!isNonEmptyStr(frame.id, 64) || !isValidSymbol(frame.sym) || !isNonEmptyStr(frame.condition, 128) || !isPosFinite(frame.price) || !isPosFinite(frame.triggeredAt)) {
        return { ok: false, code: "INVALID_ALERT", error: "invalid alert frame" };
      }
      if (frame.message !== undefined && !isNonEmptyStr(frame.message, 256)) {
        return { ok: false, code: "INVALID_ALERT", error: "alert.message must be a non-empty string <= 256 chars" };
      }
      return { ok: true, value: frame };
    case "error":
      if (!isNonEmptyStr(frame.code, 64) || !isNonEmptyStr(frame.message, 512)) {
        return { ok: false, code: "INVALID_ERROR", error: "invalid error frame" };
      }
      if (frame.fatal !== undefined && typeof frame.fatal !== "boolean") {
        return { ok: false, code: "INVALID_ERROR", error: "error.fatal must be boolean" };
      }
      return { ok: true, value: frame };
    case "state": {
      const stErr = validateStatusObj(frame.status);
      if (stErr) return stErr;
      if (frame.chart !== undefined && frame.chart !== null) {
        if (!isPlainObject(frame.chart) || !isValidSymbol(frame.chart.sym) || !VALID_TF_SET.has(frame.chart.tf) || !Array.isArray(frame.chart.bars)) {
          return { ok: false, code: "INVALID_STATE", error: "invalid state.chart" };
        }
        if (frame.chart.source !== undefined && isForbiddenSource(frame.chart.source)) {
          return { ok: false, code: "FORBIDDEN_SOURCE", error: "state.chart.source is forbidden" };
        }
        if (frame.chart.bars.length > MAX_CHART_BARS) {
          return { ok: false, code: "BUDGET_EXCEEDED", error: `state.chart.bars exceeds ${MAX_CHART_BARS}` };
        }
        for (let i = 0; i < frame.chart.bars.length; i++) {
          const bErr = validateBarShape(frame.chart.bars[i]);
          if (bErr) return { ok: false, code: "INVALID_STATE", error: `state.chart.bars[${i}]: ${bErr}` };
        }
      }
      if (frame.watchlist !== undefined) {
        if (!Array.isArray(frame.watchlist)) {
          return { ok: false, code: "INVALID_STATE", error: "state.watchlist must be an array" };
        }
        if (frame.watchlist.length > MAX_WATCHLIST_SYMBOLS) {
          return { ok: false, code: "BUDGET_EXCEEDED", error: `state.watchlist exceeds MAX_WATCHLIST_SYMBOLS (${MAX_WATCHLIST_SYMBOLS})` };
        }
        for (let i = 0; i < frame.watchlist.length; i++) {
          const qErr = validateQuoteShape(frame.watchlist[i]);
          if (qErr) return { ok: false, code: "INVALID_STATE", error: `state.watchlist[${i}]: ${qErr}` };
        }
      }
      if (frame.screener !== undefined && frame.screener !== null) {
        const scErr = validateScreenerObj(frame.screener);
        if (scErr) return scErr;
      }
      if (frame.heatmap !== undefined && frame.heatmap !== null) {
        const hmErr = validateHeatmapObj(frame.heatmap);
        if (hmErr) return hmErr;
      }
      return { ok: true, value: frame };
    }
    default:
      return { ok: false, code: "UNKNOWN_TYPE", error: `Unknown frame type: ${String(frame.type)}` };
  }
}

function upperSym(sym) {
  return String(sym ?? "").trim().toUpperCase();
}

function normalizeViewPayload(view) {
  if (!view || typeof view !== "object" || Array.isArray(view)) {
    throw new Error("view must be an object");
  }
  const msg = { op: "view" };
  if (view.chart !== undefined) {
    if (view.chart === null) {
      msg.chart = null;
    } else if (typeof view.chart === "object") {
      const ch = {
        sym: upperSym(view.chart.sym),
        tf: String(view.chart.tf ?? "").trim(),
      };
      if (view.chart.ind !== undefined) ch.ind = view.chart.ind;
      if (view.chart.vs !== undefined) ch.vs = view.chart.vs;
      msg.chart = ch;
    } else {
      msg.chart = view.chart;
    }
  }
  if (view.watchlist !== undefined) {
    msg.watchlist = Array.isArray(view.watchlist)
      ? view.watchlist.map(upperSym).filter(Boolean)
      : view.watchlist;
  }
  if (view.screener !== undefined) {
    msg.screener = view.screener === null ? null : { ...view.screener };
  }
  if (view.heatmap !== undefined) {
    msg.heatmap = view.heatmap === null ? null : { ...view.heatmap };
  }
  return msg;
}

function mergeViewState(prev, nextMsg) {
  const merged = prev ? { ...prev } : { op: "view" };
  if (nextMsg.chart !== undefined) merged.chart = nextMsg.chart;
  if (nextMsg.watchlist !== undefined) merged.watchlist = nextMsg.watchlist;
  if (nextMsg.screener !== undefined) merged.screener = nextMsg.screener;
  if (nextMsg.heatmap !== undefined) merged.heatmap = nextMsg.heatmap;
  return merged;
}

function buildViewQuery(view) {
  const params = new URLSearchParams();
  if (!view || typeof view !== "object") return params;

  if (view.chart && typeof view.chart === "object") {
    const sym = upperSym(view.chart.sym);
    const tf = String(view.chart.tf ?? "").trim();
    if (sym && tf) params.set("chart", `${sym}:${tf}`);
    if (Array.isArray(view.chart.ind) && view.chart.ind.length) {
      for (const item of view.chart.ind) {
        params.append("ind", typeof item === "string" ? item : JSON.stringify(item));
      }
    }
    if (Array.isArray(view.chart.vs) && view.chart.vs.length) {
      for (const id of view.chart.vs) {
        params.append("vs", String(id));
      }
    }
  }

  if (Array.isArray(view.watchlist) && view.watchlist.length) {
    const wl = view.watchlist.map(upperSym).filter(Boolean);
    if (wl.length) params.set("wl", wl.join(","));
  }

  if (view.screener && typeof view.screener === "object") {
    if (view.screener.preset) params.set("preset", String(view.screener.preset));
    if (view.screener.page != null) params.set("page", String(view.screener.page));
    if (view.screener.evcTf) params.set("evcTf", String(view.screener.evcTf));
    if (view.screener.dir) params.set("dir", String(view.screener.dir));
    if (view.screener.market) params.set("market", String(view.screener.market));
    if (view.screener.query) params.set("query", String(view.screener.query));
    if (view.screener.pageSize != null) params.set("pageSize", String(view.screener.pageSize));
  }

  if (view.heatmap && typeof view.heatmap === "object") {
    if (view.heatmap.metric) params.set("hmMetric", String(view.heatmap.metric));
    if (view.heatmap.tf) params.set("hmTf", String(view.heatmap.tf));
    if (view.heatmap.n != null) params.set("hmN", String(view.heatmap.n));
    if (view.heatmap.size) params.set("hmSize", String(view.heatmap.size));
    if (view.heatmap.market) params.set("hmMarket", String(view.heatmap.market));
  }

  return params;
}

function getBarTimestamp(bar) {
  if (Array.isArray(bar)) return bar[0];
  if (bar && typeof bar === "object") return bar.t;
  return null;
}

function setBounded(map, key, value, maxEntries) {
  if (map.has(key)) {
    map.delete(key);
  } else if (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, value);
}

/**
 * Browser-loadable render-only Protocol v2 transport bound strictly to a single origin.
 */
export function createThinDataService(opts = {}) {
  const origin = normalizeOrigin(opts.origin);
  const WS = opts.WebSocket !== undefined ? opts.WebSocket : (typeof WebSocket !== "undefined" ? WebSocket : null);
  const ES = opts.EventSource !== undefined ? opts.EventSource : (typeof EventSource !== "undefined" ? EventSource : null);
  const doFetch = opts.fetch || ((...args) => fetch(...args));
  const R =
    opts.raf ||
    (typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (fn) => setTimeout(() => fn(Date.now()), 16));
  const C =
    opts.caf ||
    (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout);
  const setTimer = opts.setTimer || setTimeout;
  const clearTimer = opts.clearTimer || clearTimeout;
  const jitterFn = typeof opts.jitterFn === "function" ? opts.jitterFn : cryptoUnitFloat;
  const nowFn = typeof opts.now === "function" ? opts.now : () => Date.now();

  const maxWsFails = Number.isInteger(opts.maxWsFails) && opts.maxWsFails >= 1 ? opts.maxWsFails : 3;
  const baseBackoffMs = Number.isFinite(opts.baseBackoffMs) && opts.baseBackoffMs >= 0 ? opts.baseBackoffMs : 500;
  const maxBackoffMs = Number.isFinite(opts.maxBackoffMs) && opts.maxBackoffMs >= baseBackoffMs ? opts.maxBackoffMs : 30000;
  const jitterMs = Number.isFinite(opts.jitterMs) && opts.jitterMs >= 0 ? opts.jitterMs : 250;
  const resyncThrottleMs =
    Number.isFinite(opts.resyncThrottleMs) && opts.resyncThrottleMs >= 0
      ? opts.resyncThrottleMs
      : DEFAULT_RESYNC_THROTTLE_MS;
  const sessionToken = typeof opts.session === "string" && opts.session.trim() ? opts.session.trim() : undefined;

  const listeners = new Map();
  for (const t of VALID_FRAME_TYPES) listeners.set(t, new Set());

  let ws = null;
  let es = null;
  let reconnectTimer = null;
  let retryAttempt = 0;
  let wsFails = 0;
  let closed = false;
  let lastSeq = -1;
  let lastResyncAt = -Infinity;
  let latestView = null;

  let currentStatus = {
    provenance: PROVENANCE.UNAVAILABLE,
    asOf: null,
    transport: "idle",
    detail: null,
    sym: null,
  };

  let rafHandle = null;
  const pendingBars = new Map();
  const pendingQuotes = new Map();
  let latestQuoteFrameMeta = null;

  function emit(type, frame) {
    const subs = listeners.get(type);
    if (!subs || subs.size === 0) return;
    for (const cb of subs) {
      try {
        cb(frame);
      } catch (err) {
        if (typeof console !== "undefined" && typeof console.error === "function") {
          console.error(err);
        }
      }
    }
  }

  function updateProvenance(prov, asOf, extra = {}) {
    if (!PROVENANCE_VALUES.has(prov)) return;
    currentStatus = {
      ...currentStatus,
      provenance: prov,
      asOf: typeof asOf === "number" && Number.isFinite(asOf) ? asOf : currentStatus.asOf,
      detail: extra.detail !== undefined ? extra.detail : currentStatus.detail,
      sym: extra.sym !== undefined ? extra.sym : currentStatus.sym,
    };
  }

  function setTransport(transport) {
    if (currentStatus.transport !== transport) {
      currentStatus = { ...currentStatus, transport };
    }
  }

  function flushBatchedFrames() {
    rafHandle = null;

    if (pendingBars.size > 0) {
      const barsToEmit = [...pendingBars.values()];
      pendingBars.clear();
      for (const frame of barsToEmit) {
        emit("bar", frame);
      }
    }

    if (pendingQuotes.size > 0 && latestQuoteFrameMeta) {
      const coalesced = [...pendingQuotes.values()];
      const meta = latestQuoteFrameMeta;
      pendingQuotes.clear();
      latestQuoteFrameMeta = null;
      emit("quotes", {
        v: meta.v,
        seq: meta.seq,
        type: "quotes",
        quotes: coalesced,
      });
    }
  }

  function scheduleFlush() {
    if (rafHandle === null) {
      rafHandle = R(flushBatchedFrames);
    }
  }

  function clearPendingBatches() {
    if (rafHandle !== null) {
      C(rafHandle);
      rafHandle = null;
    }
    pendingBars.clear();
    pendingQuotes.clear();
    latestQuoteFrameMeta = null;
  }

  function sendJson(obj) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function replayHelloAndView() {
    const helloMsg = { op: "hello", v: PROTOCOL_VERSION };
    if (sessionToken) helloMsg.session = sessionToken;
    const hCheck = validateClientMessage(helloMsg);
    if (!hCheck.ok) {
      throw new Error(`Invalid hello message: ${hCheck.error}`);
    }
    sendJson(helloMsg);
    if (latestView) {
      sendJson(latestView);
    }
  }

  function processValidatedFrame(frame, { enforceSeq = true } = {}) {
    if (frame.type !== "pong" && enforceSeq) {
      if (lastSeq >= 0 && frame.seq <= lastSeq) {
        return null;
      }
      const hasGap = lastSeq >= 0 && frame.seq > lastSeq + 1;
      lastSeq = frame.seq;
      if (hasGap && latestView && ws && ws.readyState === 1) {
        const now = nowFn();
        if (now - lastResyncAt >= resyncThrottleMs) {
          lastResyncAt = now;
          sendJson(latestView);
        }
      }
    } else if (frame.type !== "pong" && frame.seq > lastSeq) {
      lastSeq = frame.seq;
    }

    if (frame.type === "state") {
      clearPendingBatches();
      updateProvenance(frame.status.provenance, frame.status.asOf, {
        detail: frame.status.detail ?? null,
        sym: frame.status.sym ?? null,
      });
      emit("state", frame);
      return frame;
    }

    if (frame.type === "status") {
      updateProvenance(frame.provenance, frame.asOf, {
        detail: frame.detail ?? null,
        sym: frame.sym ?? null,
      });
      emit("status", frame);
      return frame;
    }

    if (frame.type === "bar") {
      if (frame.provenance) {
        updateProvenance(frame.provenance, frame.asOf);
      }
      const barT = getBarTimestamp(frame.bar);
      const key = `${frame.sym}|${frame.tf}|${barT}`;
      setBounded(pendingBars, key, frame, MAX_PENDING_BARS);
      scheduleFlush();
      return frame;
    }

    if (frame.type === "quotes") {
      for (const q of frame.quotes) {
        setBounded(pendingQuotes, q.s, q, MAX_PENDING_QUOTES);
      }
      latestQuoteFrameMeta = { v: frame.v, seq: frame.seq };
      scheduleFlush();
      return frame;
    }

    emit(frame.type, frame);
    return frame;
  }

  function handleInboundFrame(raw, { enforceSeq = true } = {}) {
    const check = validateServerFrame(raw);
    if (!check.ok) {
      emit("error", {
        v: PROTOCOL_VERSION,
        seq: Math.max(0, lastSeq),
        type: "error",
        code: check.code,
        message: check.error,
        fatal: false,
      });
      return null;
    }
    return processValidatedFrame(check.value, { enforceSeq });
  }

  function scheduleReconnect(connectFn) {
    if (closed) return;
    clearTimer(reconnectTimer);
    const exp = Math.min(maxBackoffMs, baseBackoffMs * Math.pow(2, retryAttempt));
    retryAttempt += 1;
    const rawJitter = Number(jitterFn());
    const bounded = Number.isFinite(rawJitter) ? Math.min(1, Math.max(0, rawJitter)) : 0;
    const delay = Math.round(exp + bounded * jitterMs);
    setTransport("reconnecting");
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      if (!closed) connectFn();
    }, delay);
  }

  function buildWsEndpoint() {
    return assertSameOrigin("/ws", origin, { ws: true });
  }

  function buildSseEndpoint() {
    const params = buildViewQuery(latestView);
    const qs = params.toString();
    const path = qs ? `/api/sse?${qs}` : "/api/sse";
    return assertSameOrigin(path, origin);
  }

  function connectSse() {
    if (closed || !ES) return;
    if (es) {
      es.onopen = es.onmessage = es.onerror = null;
      try {
        es.close();
      } catch {
        // ignore
      }
      es = null;
    }

    const url = buildSseEndpoint();
    setTransport("connecting");
    try {
      es = new ES(url);
    } catch {
      scheduleReconnect(connectSse);
      return;
    }

    es.onopen = () => {
      retryAttempt = 0;
      lastSeq = -1;
      lastResyncAt = -Infinity;
      setTransport("sse");
    };
    es.onmessage = (ev) => {
      try {
        handleInboundFrame(ev.data, { enforceSeq: true });
      } catch {
        // handled inside handleInboundFrame
      }
    };
    es.onerror = () => {
      if (!es) return;
      const dead = es;
      es = null;
      dead.onopen = dead.onmessage = dead.onerror = null;
      try {
        dead.close();
      } catch {
        // ignore
      }
      scheduleReconnect(connectSse);
    };
  }

  function failWs() {
    if (closed) return;
    wsFails += 1;
    if (wsFails >= maxWsFails && ES) {
      connectSse();
      return;
    }
    scheduleReconnect(connectWs);
  }

  function connectWs() {
    if (closed) return;
    if (!WS) {
      connectSse();
      return;
    }
    const url = buildWsEndpoint();
    setTransport("connecting");

    let sock;
    try {
      sock = new WS(url);
    } catch {
      failWs();
      return;
    }
    ws = sock;

    sock.onopen = () => {
      if (ws !== sock) return;
      wsFails = 0;
      retryAttempt = 0;
      lastSeq = -1;
      lastResyncAt = -Infinity;
      setTransport("ws");
      replayHelloAndView();
    };
    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      handleInboundFrame(ev.data, { enforceSeq: true });
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
      failWs();
    };
    sock.onerror = () => {
      if (ws !== sock) return;
      ws = null;
      sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
      try {
        sock.close();
      } catch {
        // ignore
      }
      failWs();
    };
  }

  async function sameOriginGetJson(pathOrUrl) {
    const url = assertSameOrigin(pathOrUrl, origin);
    const res = await doFetch(url, {
      method: "GET",
      credentials: "same-origin",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (res && typeof res.url === "string" && res.url.length > 0) {
      assertSameOrigin(res.url, origin);
    }
    if (!res || !res.ok) {
      const code = res ? res.status : 0;
      throw new Error(`HTTP ${code} for ${url}`);
    }
    return res.json();
  }

  return {
    origin,

    assertSameOrigin(url, checkOpts) {
      return assertSameOrigin(url, origin, checkOpts);
    },

    async bootstrap(view = {}) {
      let basePath = "/api/bootstrap";
      if (view && view.endpoint !== undefined && view.endpoint !== null) {
        assertSameOriginApiPath(view.endpoint, origin);
        basePath = view.endpoint;
      }
      if (view && view.url !== undefined && view.url !== null) {
        assertSameOriginApiPath(view.url, origin);
        if (view.endpoint === undefined || view.endpoint === null) {
          basePath = view.url;
        }
      }

      const hasViewSection =
        view &&
        typeof view === "object" &&
        (view.chart !== undefined ||
          view.watchlist !== undefined ||
          view.screener !== undefined ||
          view.heatmap !== undefined);

      let pendingView = null;
      if (hasViewSection) {
        const normalized = normalizeViewPayload(view);
        const check = validateClientMessage(normalized);
        if (!check.ok) {
          throw new Error(`Invalid bootstrap view: ${check.error}`);
        }
        pendingView = normalized;
      }

      const params = buildViewQuery(view);
      const qs = params.toString();
      const target = qs ? `${basePath}${basePath.includes("?") ? "&" : "?"}${qs}` : basePath;
      assertSameOriginApiPath(target, origin);

      const payload = await sameOriginGetJson(target);
      const check = validateServerFrame(payload);
      if (!check.ok || check.value.type !== "state") {
        const reason = check.ok ? `expected state frame, got ${check.value.type}` : check.error;
        throw new Error(`Invalid bootstrap state frame: ${reason}`);
      }

      if (pendingView) {
        latestView = mergeViewState(latestView, pendingView);
      }
      processValidatedFrame(check.value, { enforceSeq: false });
      return check.value;
    },

    async loadMoreBars(sym, tf, before, limit) {
      const rawSym = String(sym ?? "").trim();
      if (!rawSym) throw new Error("loadMoreBars requires a symbol");
      if (
        CONTROL_OR_SPACE_RE.test(rawSym) ||
        /^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawSym) ||
        rawSym.startsWith("//") ||
        rawSym.includes("\\")
      ) {
        throw makeOriginError(`Invalid symbol parameter: ${rawSym}`);
      }
      const symbol = rawSym.toUpperCase();
      if (!SYMBOL_RE.test(symbol) || symbol.includes("..") || symbol.startsWith("/") || symbol.endsWith("/")) {
        throw new Error(`Invalid symbol parameter: ${symbol}`);
      }

      const timeframe = String(tf ?? "").trim();
      if (!VALID_TF_SET.has(timeframe)) {
        throw new Error(`Invalid timeframe parameter: ${timeframe}`);
      }

      const params = new URLSearchParams();
      params.set("sym", symbol);
      params.set("tf", timeframe);
      if (before !== undefined && before !== null && before !== "") {
        const beforeNum = Number(before);
        if (!Number.isFinite(beforeNum) || beforeNum <= 0) {
          throw new Error(`Invalid before parameter: ${String(before)}`);
        }
        params.set("before", String(beforeNum));
      }
      if (limit !== undefined && limit !== null) {
        const limitNum = Number(limit);
        if (limit === "" || !Number.isSafeInteger(limitNum) || limitNum <= 0) {
          throw new Error(`Invalid limit parameter: ${String(limit)}`);
        }
        params.set("limit", String(limitNum));
      }

      return sameOriginGetJson(`/api/bars?${params.toString()}`);
    },

    connect() {
      if (ws || es) return;
      closed = false;
      wsFails = 0;
      retryAttempt = 0;
      lastSeq = -1;
      lastResyncAt = -Infinity;
      clearTimer(reconnectTimer);
      reconnectTimer = null;
      connectWs();
    },

    setView(view) {
      const msg = normalizeViewPayload(view);
      const check = validateClientMessage(msg);
      if (!check.ok) {
        const err = new Error(`Invalid view: ${check.error}`);
        err.code = check.code;
        throw err;
      }
      latestView = mergeViewState(latestView, msg);
      if (ws && ws.readyState === 1) {
        sendJson(msg);
      } else if (es && !ws) {
        connectSse();
      }
      return msg;
    },

    ping() {
      return sendJson({ op: "ping", t: Date.now() });
    },

    on(frameType, cb) {
      if (!VALID_FRAME_TYPES.has(frameType)) {
        throw new Error(`Unsupported Protocol v2 frame type: ${String(frameType)}`);
      }
      if (typeof cb !== "function") {
        throw new Error("Listener callback must be a function");
      }
      const set = listeners.get(frameType);
      set.add(cb);
      return () => {
        set.delete(cb);
      };
    },

    close() {
      closed = true;
      clearTimer(reconnectTimer);
      reconnectTimer = null;
      clearPendingBatches();
      if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        try {
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
      if (es) {
        es.onopen = es.onmessage = es.onerror = null;
        try {
          es.close();
        } catch {
          // ignore
        }
        es = null;
      }
      setTransport("closed");
    },

    get status() {
      return { ...currentStatus };
    },
  };
}
