// shared/vs/runtime.js — Vektor Script server-side evaluator, deterministic cache key, and compute wrapper.
// Pure ES module, zero Node APIs; compatible with Node 22+ and Cloudflare Workers.
// Exact semantics and execution limits (VS_LIM) matching index.html lines 4289-4369.

import { VS_COLORS, VS_LIM, VS_SERIES, VSError, vsOwn } from "./lexer.js";
import { vsParse } from "./parser.js";
import {
  VS_DECL,
  VS_FN,
  vsColor,
  vsErr,
  vsIsS,
  vsMap1,
  vsMap2,
  vsSer,
  vsShift,
  vsSuggest,
} from "./builtins.js";

export { VS_LIM, VSError };

/** Maximum number of bars accepted by vsRun() to bound memory and CPU work. */
export const MAX_VS_BARS = 5000;

const PLOT_PALETTE = ["#2962ff", "#fb923c", "#9c27b0", "#089981", "#f23645"];
const PLOT_STYLES = new Set(["line", "histogram", "area"]);
const WINDOWED_SERIES_BUILTINS = new Set([
  "sma",
  "ema",
  "rma",
  "wma",
  "stdev",
  "highest",
  "lowest",
  "sum",
  "rsi",
  "atr",
]);
const ALWAYS_SERIES_BUILTINS = new Set([
  "sma",
  "ema",
  "rma",
  "wma",
  "stdev",
  "highest",
  "lowest",
  "sum",
  "change",
  "roc",
  "rsi",
  "tr",
  "atr",
  "crossover",
  "crossunder",
  "cum",
]);

const BIN_OPS = Object.assign(Object.create(null), {
  "+": (p, q) => p + q,
  "-": (p, q) => p - q,
  "*": (p, q) => p * q,
  "/": (p, q) => (q === 0 ? NaN : p / q),
  "%": (p, q) => (q === 0 ? NaN : p % q),
  "<": (p, q) => (isNaN(p) || isNaN(q) ? NaN : +(p < q)),
  "<=": (p, q) => (isNaN(p) || isNaN(q) ? NaN : +(p <= q)),
  ">": (p, q) => (isNaN(p) || isNaN(q) ? NaN : +(p > q)),
  ">=": (p, q) => (isNaN(p) || isNaN(q) ? NaN : +(p >= q)),
  "==": (p, q) => (isNaN(p) || isNaN(q) ? NaN : +(p === q)),
  "!=": (p, q) => (isNaN(p) || isNaN(q) ? NaN : +(p !== q)),
  and: (p, q) => +(!!p && !isNaN(p) && !!q && !isNaN(q)),
  or: (p, q) => +((!!p && !isNaN(p)) || (!!q && !isNaN(q))),
});

// ---- Pure-JS synchronous SHA-256 (Workers & Node compatible, zero Node crypto dependency) ----
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const UTF8_ENC = new TextEncoder();

function sha256Hex(text) {
  const bytes = UTF8_ENC.encode(text);
  const bitLen = bytes.length * 8;
  const paddedLen = ((bytes.length + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(paddedLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  const hiBits = Math.floor(bitLen / 0x100000000);
  const loBits = bitLen >>> 0;
  view.setUint32(paddedLen - 8, hiBits, false);
  view.setUint32(paddedLen - 4, loBits, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const W = new Uint32Array(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 =
        ((W[i - 15] >>> 7) | (W[i - 15] << 25)) ^
        ((W[i - 15] >>> 18) | (W[i - 15] << 14)) ^
        (W[i - 15] >>> 3);
      const s1 =
        ((W[i - 2] >>> 17) | (W[i - 2] << 15)) ^
        ((W[i - 2] >>> 19) | (W[i - 2] << 13)) ^
        (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => x.toString(16).padStart(8, "0"))
    .join("");
}

/**
 * Canonicalize an inputs dictionary with sorted keys for deterministic hashing.
 * @param {Record<string, unknown> | null | undefined} inputs
 * @returns {Array<[string, unknown]>}
 */
function canonicalizeInputs(inputs) {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return [];
  return Object.keys(inputs)
    .sort()
    .map((k) => [k, inputs[k]]);
}

/**
 * Deterministic cache key for server-side Vektor Script evaluations.
 * Independent of input key insertion order and safe for Workers KV/Cache/Map keys.
 *
 * @param {string} src
 * @param {Record<string, unknown> | null | undefined} inputs
 * @param {string} sym
 * @param {string} tf
 * @param {number | string | null | undefined} lastBarT
 * @returns {string}
 */
export function vsCacheKey(src, inputs, sym, tf, lastBarT) {
  const payload = JSON.stringify([
    typeof src === "string" ? src : "",
    canonicalizeInputs(inputs),
    sym == null ? "" : String(sym),
    tf == null ? "" : String(tf),
    lastBarT == null ? null : Number(lastBarT),
  ]);
  return "vs:v1:" + sha256Hex(payload);
}

/**
 * Lightweight bars fingerprint matching index.html line 4366.
 * @param {Array<{ t?: number, c?: number, h?: number, l?: number }>} bars
 * @returns {string}
 */
export function vsBarsKey(bars) {
  if (!Array.isArray(bars) || !bars.length) return "0|undefined|undefined|undefined|undefined";
  const z = bars[bars.length - 1];
  return bars.length + "|" + (z && z.t) + "|" + (z && z.c) + "|" + (z && z.h) + "|" + (z && z.l);
}

/**
 * Convert any thrown VSError or Error into a JSON-serializable structured payload.
 * @param {unknown} err
 * @returns {{ error: string, line: number, col: number, hint: string }}
 */
export function vsErrorPayload(err) {
  if (err instanceof VSError) return err.toPayload();
  const msg = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
  const line = err && typeof err === "object" && "line" in err ? Number(err.line) || 0 : 0;
  const col = err && typeof err === "object" && "col" in err ? Number(err.col) || 0 : 0;
  const hint = err && typeof err === "object" && "hint" in err && err.hint ? String(err.hint) : "";
  return { error: msg, line, col, hint };
}

/**
 * Format a VSError or error payload into a human-readable single-line message.
 * Matches index.html line 4369.
 * @param {{ message?: string, error?: string, line?: number, col?: number, hint?: string }} e
 * @returns {string}
 */
export function vsFmtErr(e) {
  const msg = e.message ?? e.error ?? "";
  return (
    (e.line ? "Line " + e.line + (e.col ? ", column " + e.col : "") + ": " : "") +
    msg +
    (e.hint ? " " + e.hint : "")
  );
}

/**
 * Execute a Vektor Script against OHLCV bars and optional input overrides.
 *
 * @param {string | Array<object>} src — source text or pre-parsed AST from vsParse()
 * @param {Array<{ o?: number, h: number, l: number, c: number, v?: number, t?: number }>} bars
 * @param {Record<string, number>} [inputVals]
 * @param {{ limits?: Partial<typeof VS_LIM> }} [opts]
 * @returns {{
 *   name: string,
 *   overlay: boolean,
 *   plots: Array<{ title: string, color: string, width: number, style: string, v: Float64Array }>,
 *   hlines: Array<{ v: number, title: string, color: string }>,
 *   inputs: Array<{ title: string, def: number, min: number, max: number, v: number }>
 * }}
 */
export function vsRun(src, bars, inputVals, opts) {
  const lim = opts && opts.limits ? { ...VS_LIM, ...opts.limits } : VS_LIM;
  if (!Array.isArray(bars)) {
    throw new VSError(
      "Bars must be an array",
      0,
      0,
      "Pass OHLCV bars as an array of { o, h, l, c, v, t } objects."
    );
  }
  const maxBars = lim.bars != null ? lim.bars : MAX_VS_BARS;
  if (bars.length > maxBars) {
    throw new VSError(
      "Too many bars (" + maxBars + " max)",
      0,
      0,
      "Pass at most " + maxBars + " bars to Vektor Script."
    );
  }

  const prog = typeof src === "string" ? vsParse(src, lim) : src;
  const n = bars.length;
  const E = Object.create(null);
  const V = Object.create(null);

  const col = (k) => {
    const o = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const b = bars[i];
      const v = b ? b[k] : undefined;
      o[i] = v == null ? NaN : +v;
    }
    return o;
  };

  E.open = col("o");
  E.high = col("h");
  E.low = col("l");
  E.close = col("c");
  E.volume = col("v");
  E.time = col("t");
  for (let i = 0; i < n; i++) {
    if (isNaN(E.open[i])) E.open[i] = i ? E.close[i - 1] : E.close[i];
  }
  E.hl2 = vsMap2(E.high, E.low, (a, b) => (a + b) / 2, n);
  E.hlc3 = new Float64Array(n);
  E.ohlc4 = new Float64Array(n);
  E.bar_index = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    E.hlc3[i] = (E.high[i] + E.low[i] + E.close[i]) / 3;
    E.ohlc4[i] = (E.open[i] + E.high[i] + E.low[i] + E.close[i]) / 4;
    E.bar_index[i] = i;
  }

  const out = { name: "", overlay: true, plots: [], hlines: [], inputs: [] };
  let nodes = 0;
  let evalDepth = 0;
  const iv = inputVals && typeof inputVals === "object" ? inputVals : {};

  const charge = (node, work = 1) => {
    nodes += work;
    if (nodes > lim.nodes) {
      throw vsErr(node, "The script is doing too much work", "Use shorter lengths or fewer steps.");
    }
  };

  const str = (node, what) => {
    const v = ev(node);
    if (typeof v !== "string") {
      throw vsErr(node, what + " must be text in quotes", 'Wrap the text in quotes, e.g. "EMA 20".');
    }
    return v;
  };

  const scal = (node, what) => {
    const v = ev(node);
    if (typeof v !== "number") {
      throw vsErr(node, what + " must be a plain number", "Pass a numeric constant or input().");
    }
    return v;
  };

  function ev(x) {
    if (++evalDepth > lim.depth) {
      throw vsErr(x, "Expression is nested too deeply", "Split it into a few named steps.");
    }
    charge(x, 1);
    let res;
    switch (x.k) {
      case "num":
        res = x.v;
        break;
      case "str":
        res = x.v;
        break;
      case "id": {
        if (vsOwn(V, x.v)) {
          res = V[x.v];
          break;
        }
        if (vsOwn(E, x.v)) {
          res = E[x.v];
          break;
        }
        if (vsOwn(VS_COLORS, x.v)) {
          res = x.v;
          break;
        }
        const sg = vsSuggest(x.v, [...Object.keys(V), ...VS_SERIES, ...Object.keys(VS_FN)]);
        throw vsErr(
          x,
          "Unknown name \u201c" + x.v + "\u201d",
          sg
            ? "Did you mean \u201c" + sg + "\u201d?"
            : "Names must be assigned before use, e.g. fast = ema(close, 12). Built-in series: " +
                VS_SERIES.slice(0, 8).join(", ") +
                "."
        );
      }
      case "neg": {
        const v = ev(x.e);
        if (typeof v === "string") {
          throw vsErr(x, "Can\u2019t negate text", "Unary minus only works on numbers and series.");
        }
        if (vsIsS(v)) charge(x, n);
        res = vsMap1(v, (a) => -a, n);
        break;
      }
      case "not": {
        const v = ev(x.e);
        if (vsIsS(v)) charge(x, n);
        res = vsMap1(v, (a) => (isNaN(a) ? NaN : a ? 0 : 1), n);
        break;
      }
      case "bin": {
        const a = ev(x.a);
        const b = ev(x.b);
        if (typeof a === "string" || typeof b === "string") {
          throw vsErr(
            x,
            "\u201c" + x.op + "\u201d works on numbers and series, not text",
            "Use numeric expressions on both sides of \u201c" + x.op + "\u201d."
          );
        }
        if (vsIsS(a) || vsIsS(b)) charge(x, n);
        res = vsMap2(a, b, BIN_OPS[x.op], n);
        break;
      }
      case "tern": {
        const c = ev(x.c);
        const a = ev(x.a);
        const b = ev(x.b);
        if (!vsIsS(c) && !vsIsS(a) && !vsIsS(b)) {
          res = c && !isNaN(c) ? a : b;
          break;
        }
        charge(x, n);
        const C = vsSer(c, n);
        const A = vsSer(a, n);
        const B = vsSer(b, n);
        const o = new Float64Array(n);
        for (let i = 0; i < n; i++) o[i] = C[i] && !isNaN(C[i]) ? A[i] : B[i];
        res = o;
        break;
      }
      case "hist": {
        const v = ev(x.e);
        const k = ev(x.i);
        if (vsIsS(k)) {
          throw vsErr(
            x,
            "The number in [ ] must be a plain number, e.g. close[1]",
            "Use a constant or input() inside [ ]."
          );
        }
        const kk = Math.round(k);
        if (!(kk >= 0) || kk > lim.len) {
          throw vsErr(
            x,
            "[ ] looks back 0 to " + lim.len + " bars",
            "Use a lookback between 0 and " + lim.len + "."
          );
        }
        if (vsIsS(v)) {
          charge(x, n);
          res = vsShift(v, kk, n);
        } else {
          res = v;
        }
        break;
      }
      case "call":
        res = call(x);
        break;
      default:
        throw vsErr(x, "Unsupported expression", "Check the expression syntax.");
    }
    evalDepth--;
    return res;
  }

  function call(x) {
    const f = x.f;
    if (f === "indicator") {
      if (x.args.length) out.name = str(x.args[0], "The indicator name").slice(0, 60);
      if (x.kw.overlay) out.overlay = !!scal(x.kw.overlay, "overlay");
      for (const k in x.kw) {
        if (k !== "overlay") {
          throw vsErr(
            x,
            "indicator() has no option \u201c" + k + "\u201d",
            "Options: overlay=true or overlay=false."
          );
        }
      }
      return 0;
    }
    if (f === "input") {
      if (!x.args.length) {
        throw vsErr(x, "input() needs a default value", 'e.g. len = input(14, "Length")');
      }
      for (const k in x.kw) {
        if (k !== "min" && k !== "max") {
          throw vsErr(x, "input() has no option \u201c" + k + "\u201d", "Options: min, max.");
        }
      }
      const d = scal(x.args[0], "The default value");
      const t = x.args[1] ? str(x.args[1], "The input title") : "Input " + (out.inputs.length + 1);
      const mn = x.kw.min ? scal(x.kw.min, "min") : -1e12;
      const mx = x.kw.max ? scal(x.kw.max, "max") : 1e12;
      if (mn > mx) {
        throw vsErr(
          x,
          "input(): min cannot be greater than max",
          'Set min <= max, e.g. input(14, "Length", min=1, max=200).'
        );
      }
      let v = vsOwn(iv, t) && iv[t] != null && isFinite(+iv[t]) ? +iv[t] : d;
      v = Math.max(mn, Math.min(mx, v));
      out.inputs.push({ title: t, def: d, min: mn, max: mx, v });
      return v;
    }
    if (f === "plot") {
      if (out.plots.length >= lim.plots) {
        throw vsErr(
          x,
          "Too many plots (" + lim.plots + " max)",
          "Keep at most " + lim.plots + " plot() calls per script."
        );
      }
      if (!x.args.length) {
        throw vsErr(x, "plot() needs a series", 'e.g. plot(ema(close, 20), "EMA")');
      }
      charge(x, n);
      const v = vsSer(ev(x.args[0]), n);
      const title = x.args[1] ? str(x.args[1], "The plot title") : "Plot " + (out.plots.length + 1);
      const color = vsColor(
        x.kw.color
          ? ev(x.kw.color)
          : x.args[2]
            ? ev(x.args[2])
            : PLOT_PALETTE[out.plots.length % PLOT_PALETTE.length],
        x
      );
      const width = x.kw.width
        ? Math.max(1, Math.min(4, Math.round(scal(x.kw.width, "width"))))
        : 2;
      const style = x.kw.style ? str(x.kw.style, "style") : "line";
      if (!PLOT_STYLES.has(style)) {
        throw vsErr(
          x,
          "Unknown plot style \u201c" + style + "\u201d",
          'Use "line", "histogram" or "area".'
        );
      }
      for (const k in x.kw) {
        if (k !== "color" && k !== "width" && k !== "style") {
          throw vsErr(x, "plot() has no option \u201c" + k + "\u201d", "Options: color, width, style.");
        }
      }
      out.plots.push({ title, color, width, style, v });
      return 0;
    }
    if (f === "hline") {
      if (out.hlines.length >= lim.hlines) {
        throw vsErr(
          x,
          "Too many hlines (" + lim.hlines + " max)",
          "Keep at most " + lim.hlines + " hline() calls per script."
        );
      }
      for (const k in x.kw) {
        if (k !== "color") {
          throw vsErr(x, "hline() has no option \u201c" + k + "\u201d", "Options: color.");
        }
      }
      const v = scal(
        x.args[0] || { k: "num", v: NaN, line: x.line, col: x.col },
        "hline() value"
      );
      out.hlines.push({
        v,
        title: x.args[1] ? str(x.args[1], "The line title") : "",
        color: vsColor(x.kw.color ? ev(x.kw.color) : "gray", x),
      });
      return 0;
    }

    const F = vsOwn(VS_FN, f) ? VS_FN[f] : null;
    if (!F) {
      const sg = vsSuggest(f, [...Object.keys(VS_FN), ...VS_DECL]);
      throw vsErr(
        x,
        "Unknown function \u201c" + f + "()\u201d",
        sg ? "Did you mean \u201c" + sg + "()\u201d?" : "See the function list in the help panel."
      );
    }
    const want = Array.isArray(F.a) ? F.a : [F.a, F.a];
    for (const _k in x.kw) {
      throw vsErr(x, f + "() doesn\u2019t take named options", "Write it as " + F.sig + ".");
    }
    if (x.args.length < want[0] || x.args.length > want[1]) {
      throw vsErr(
        x,
        f +
          "() takes " +
          (want[0] === want[1] ? want[0] : want[0] + " or " + want[1]) +
          " value" +
          (want[1] === 1 ? "" : "s") +
          ", got " +
          x.args.length,
        "Write it as " + F.sig + "."
      );
    }
    const A = x.args.map((a) => {
      const v = ev(a);
      if (typeof v === "string") {
        throw vsErr(
          a,
          f + "() works on numbers and series, not text",
          "Pass a number or series to " + f + "()."
        );
      }
      return v;
    });
    if (WINDOWED_SERIES_BUILTINS.has(f)) {
      charge(x, n * 10);
    } else if (ALWAYS_SERIES_BUILTINS.has(f) || A.some(vsIsS)) {
      charge(x, n);
    }
    return F.f(A, n, x, E, lim);
  }

  for (const st of prog) {
    if (st.k === "set") V[st.n] = ev(st.e);
    else ev(st.e);
  }
  if (!out.plots.length && !out.hlines.length) {
    throw new VSError(
      "Nothing to show: add a plot(...) line",
      0,
      0,
      'e.g. plot(ema(close, 20), "EMA 20")'
    );
  }
  return out;
}

/**
 * Run a script safely with optional caching and structured error reporting.
 * Never throws; returns `{ ok, error, line?, col?, hint?, err, key, cached }`.
 *
 * @param {string | { id?: string, src: string, inp?: Record<string, number>, inputs?: Record<string, number> }} script
 * @param {Array<{ o?: number, h: number, l: number, c: number, v?: number, t?: number }>} bars
 * @param {{
 *   inputs?: Record<string, number>,
 *   sym?: string,
 *   tf?: string,
 *   lastBarT?: number,
 *   cache?: Map<string, any>,
 *   limits?: Partial<typeof VS_LIM>,
 * }} [opts]
 */
export function vsCompute(script, bars, opts = {}) {
  const isObj = script && typeof script === "object" && !Array.isArray(script);
  const src = isObj ? script.src : script;
  const inputs = opts.inputs ?? (isObj ? (script.inp ?? script.inputs ?? {}) : {});
  const lastBarT =
    opts.lastBarT !== undefined
      ? opts.lastBarT
      : Array.isArray(bars) && bars.length
        ? bars[bars.length - 1].t
        : null;

  const key =
    opts.sym !== undefined || opts.tf !== undefined
      ? vsCacheKey(src, inputs, opts.sym ?? "", opts.tf ?? "", lastBarT)
      : vsCacheKey(src, inputs, "", vsBarsKey(bars), lastBarT);

  if (opts.cache && typeof opts.cache.get === "function") {
    const hit = opts.cache.get(key);
    if (hit) return { ...hit, cached: true };
  }

  let res;
  try {
    const ok = vsRun(src, bars, inputs, opts);
    res = { ok, error: null, err: null, key, cached: false };
  } catch (e) {
    const payload = vsErrorPayload(e);
    res = {
      ok: null,
      error: payload.error,
      line: payload.line,
      col: payload.col,
      hint: payload.hint,
      err: payload,
      key,
      cached: false,
    };
  }

  if (opts.cache && typeof opts.cache.set === "function") {
    opts.cache.set(key, res);
  }
  return res;
}
