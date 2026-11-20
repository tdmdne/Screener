// shared/vs/builtins.js — Vektor Script series primitives and all 29 built-in functions.
// Pure ES module using Float64Array, zero Node APIs; compatible with Node 22+ and Cloudflare Workers.
// Exact numerical and semantic parity with index.html lines 4244-4287.

import { VS_COLORS, VS_LIM, VSError, vsOwn } from "./lexer.js";

/** @param {unknown} x @returns {x is Float64Array} */
export const vsIsS = (x) => x instanceof Float64Array;

/**
 * Create a VSError anchored to an AST node's line/col.
 * @param {{ line?: number, col?: number } | null | undefined} node
 * @param {string} msg
 * @param {string} [hint]
 */
export function vsErr(node, msg, hint) {
  return new VSError(msg, node && node.line, node && node.col, hint);
}

/**
 * Apply a unary numeric transform to a scalar or Float64Array series.
 * @param {number | Float64Array} x
 * @param {(a: number) => number} f
 * @param {number} n
 * @returns {number | Float64Array}
 */
export function vsMap1(x, f, n) {
  if (!vsIsS(x)) return f(x);
  const o = new Float64Array(n);
  for (let i = 0; i < n; i++) o[i] = f(x[i]);
  return o;
}

/**
 * Apply a binary numeric transform across scalars and/or Float64Array series.
 * @param {number | Float64Array} x
 * @param {number | Float64Array} y
 * @param {(a: number, b: number) => number} f
 * @param {number} n
 * @returns {number | Float64Array}
 */
export function vsMap2(x, y, f, n) {
  if (!vsIsS(x) && !vsIsS(y)) return f(x, y);
  const o = new Float64Array(n);
  for (let i = 0; i < n; i++) o[i] = f(vsIsS(x) ? x[i] : x, vsIsS(y) ? y[i] : y);
  return o;
}

/**
 * Coerce a scalar or series into a Float64Array of length `n`.
 * @param {number | Float64Array} x
 * @param {number} n
 * @returns {Float64Array}
 */
export function vsSer(x, n) {
  if (vsIsS(x)) return x;
  const o = new Float64Array(n);
  o.fill(typeof x === "number" ? x : NaN);
  return o;
}

/**
 * Validate and round an integer lookback/period length against VS_LIM.len.
 * @param {number | Float64Array} v
 * @param {string} f
 * @param {{ line?: number, col?: number } | null | undefined} node
 * @param {number} [maxLen=VS_LIM.len]
 * @returns {number}
 */
export function vsLen(v, f, node, maxLen = VS_LIM.len) {
  if (vsIsS(v)) {
    throw vsErr(
      node,
      f + "(): the length must be a number, not a series",
      "Use a number or an input(), e.g. " + f + "(close, 14)."
    );
  }
  const k = Math.round(v);
  if (!(k >= 1)) {
    throw vsErr(
      node,
      f + "(): the length must be 1 or more",
      "Use a positive integer length, e.g. " + f + "(close, 14)."
    );
  }
  if (k > maxLen) {
    throw vsErr(
      node,
      f + "(): the length can be at most " + maxLen,
      "Use a length between 1 and " + maxLen + "."
    );
  }
  return k;
}

/**
 * Simple Moving Average over a Float64Array (resets window on NaN, matching index.html).
 * @param {Float64Array} x
 * @param {number} k
 * @param {number} n
 * @returns {Float64Array}
 */
export function vsSMA(x, k, n) {
  const o = new Float64Array(n).fill(NaN);
  let s = 0;
  let c = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (isNaN(v)) {
      s = 0;
      c = 0;
      continue;
    }
    s += v;
    c++;
    if (c > k) {
      s -= x[i - k];
      c = k;
    }
    if (c === k) o[i] = s / k;
  }
  return o;
}

/**
 * Exponential / Wilder Moving Average seeded with the SMA of the first `k` non-NaN bars.
 * @param {Float64Array} x
 * @param {number} k
 * @param {number} n
 * @param {number} [alpha]
 * @returns {Float64Array}
 */
export function vsEMA(x, k, n, alpha) {
  const a = alpha || 2 / (k + 1);
  const o = new Float64Array(n).fill(NaN);
  let prev = NaN;
  let seed = 0;
  let c = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (isNaN(v)) continue;
    if (isNaN(prev)) {
      seed += v;
      c++;
      if (c === k) {
        prev = seed / k;
        o[i] = prev;
      }
      continue;
    }
    prev = a * v + (1 - a) * prev;
    o[i] = prev;
  }
  return o;
}

/**
 * Rolling window reducer over a Float64Array; emits NaN whenever any value in the window is NaN.
 * Reuses a single scratch window array to avoid per-bar allocations.
 * @param {Float64Array} x
 * @param {number} k
 * @param {number} n
 * @param {(window: number[]) => number} f
 * @returns {Float64Array}
 */
export function vsWin(x, k, n, f) {
  const o = new Float64Array(n).fill(NaN);
  if (n === 0 || k > n) return o;
  const w = new Array(k);
  for (let i = k - 1; i < n; i++) {
    let ok = true;
    const base = i - k + 1;
    for (let j = 0; j < k; j++) {
      const v = x[base + j];
      if (isNaN(v)) {
        ok = false;
        break;
      }
      w[j] = v;
    }
    if (ok) o[i] = f(w);
  }
  return o;
}

/**
 * O(n) sliding-window sum with NaN window reset and periodic re-sync (zero drift, zero per-bar allocs).
 * @param {Float64Array} x
 * @param {number} k
 * @param {number} n
 * @returns {Float64Array}
 */
export function vsSum(x, k, n) {
  const o = new Float64Array(n);
  if (n === 0 || k > n) {
    o.fill(NaN);
    return o;
  }
  if (k === 1) {
    o.set(x.subarray(0, n));
    return o;
  }
  const resync = Math.max(k * 2, 64);
  let s = 0;
  let c = 0;
  let steps = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (v !== v) {
      s = 0;
      c = 0;
      steps = 0;
      o[i] = NaN;
      continue;
    }
    if (c < k) {
      s += v;
      c++;
      o[i] = c === k ? s : NaN;
    } else if (++steps >= resync || v - v !== 0 || x[i - k] - x[i - k] !== 0) {
      s = 0;
      for (let j = i - k + 1; j <= i; j++) s += x[j];
      steps = 0;
      o[i] = s;
    } else {
      s += v - x[i - k];
      o[i] = s;
    }
  }
  return o;
}

/**
 * O(n) monotonic-deque sliding-window maximum (exact bit-for-bit parity, NaN window reset).
 * @param {Float64Array} x
 * @param {number} k
 * @param {number} n
 * @returns {Float64Array}
 */
export function vsHighest(x, k, n) {
  const o = new Float64Array(n);
  if (n === 0 || k > n) {
    o.fill(NaN);
    return o;
  }
  if (k === 1) {
    o.set(x.subarray(0, n));
    return o;
  }
  const dq = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let lastNaN = -1;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (v !== v) {
      lastNaN = i;
      head = 0;
      tail = 0;
      o[i] = NaN;
      continue;
    }
    while (tail > head && x[dq[tail - 1]] <= v) tail--;
    dq[tail++] = i;
    if (dq[head] <= i - k) head++;
    o[i] = i - lastNaN >= k ? x[dq[head]] : NaN;
  }
  return o;
}

/**
 * O(n) monotonic-deque sliding-window minimum (exact bit-for-bit parity, NaN window reset).
 * @param {Float64Array} x
 * @param {number} k
 * @param {number} n
 * @returns {Float64Array}
 */
export function vsLowest(x, k, n) {
  const o = new Float64Array(n);
  if (n === 0 || k > n) {
    o.fill(NaN);
    return o;
  }
  if (k === 1) {
    o.set(x.subarray(0, n));
    return o;
  }
  const dq = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let lastNaN = -1;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (v !== v) {
      lastNaN = i;
      head = 0;
      tail = 0;
      o[i] = NaN;
      continue;
    }
    while (tail > head && x[dq[tail - 1]] >= v) tail--;
    dq[tail++] = i;
    if (dq[head] <= i - k) head++;
    o[i] = i - lastNaN >= k ? x[dq[head]] : NaN;
  }
  return o;
}

/**
 * O(n) sliding-window linearly weighted moving average with periodic re-sync (NaN window reset).
 * @param {Float64Array} x
 * @param {number} k
 * @param {number} n
 * @returns {Float64Array}
 */
export function vsWMA(x, k, n) {
  const o = new Float64Array(n);
  if (n === 0 || k > n) {
    o.fill(NaN);
    return o;
  }
  if (k === 1) {
    o.set(x.subarray(0, n));
    return o;
  }
  const d = (k * (k + 1)) / 2;
  const resync = Math.max(k * 2, 64);
  let sum = 0;
  let wsum = 0;
  let c = 0;
  let steps = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (v !== v) {
      sum = 0;
      wsum = 0;
      c = 0;
      steps = 0;
      o[i] = NaN;
      continue;
    }
    if (c < k) {
      c++;
      sum += v;
      wsum += v * c;
      o[i] = c === k ? wsum / d : NaN;
    } else if (++steps >= resync || v - v !== 0 || x[i - k] - x[i - k] !== 0) {
      sum = 0;
      wsum = 0;
      const base = i - k + 1;
      for (let j = 0; j < k; j++) {
        const xj = x[base + j];
        sum += xj;
        wsum += xj * (j + 1);
      }
      steps = 0;
      o[i] = wsum / d;
    } else {
      wsum = wsum - sum + k * v;
      sum = sum - x[i - k] + v;
      o[i] = wsum / d;
    }
  }
  return o;
}

/**
 * O(n) shifted sliding-window population standard deviation with periodic mean re-anchoring.
 * Avoids catastrophic cancellation and per-bar allocations while maintaining NaN window reset.
 * @param {Float64Array} x
 * @param {number} k
 * @param {number} n
 * @returns {Float64Array}
 */
export function vsStdev(x, k, n) {
  const o = new Float64Array(n);
  if (n === 0 || k > n) {
    o.fill(NaN);
    return o;
  }
  if (k === 1) {
    for (let i = 0; i < n; i++) {
      const v = x[i];
      o[i] = v - v === 0 ? 0 : NaN;
    }
    return o;
  }
  const invK = 1 / k;
  const resync = Math.max(k * 2, 64);
  let anchor = 0;
  let su = 0;
  let su2 = 0;
  let c = 0;
  let steps = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    if (v !== v) {
      c = 0;
      su = 0;
      su2 = 0;
      steps = 0;
      o[i] = NaN;
      continue;
    }
    if (c === 0) {
      anchor = v - v === 0 ? v : 0;
      const u = v - anchor;
      su = u;
      su2 = u * u;
      c = 1;
      o[i] = NaN;
    } else if (c < k) {
      const u = v - anchor;
      su += u;
      su2 += u * u;
      c++;
      if (c === k) {
        const meanU = su * invK;
        const variance = su2 * invK - meanU * meanU;
        o[i] = variance !== variance ? NaN : variance > 0 ? Math.sqrt(variance) : 0;
      } else {
        o[i] = NaN;
      }
    } else if (++steps >= resync || v - v !== 0 || x[i - k] - x[i - k] !== 0) {
      const base = i - k + 1;
      let m = 0;
      for (let j = 0; j < k; j++) m += x[base + j];
      m *= invK;
      anchor = m - m === 0 ? m : 0;
      su = 0;
      su2 = 0;
      for (let j = 0; j < k; j++) {
        const u = x[base + j] - anchor;
        su += u;
        su2 += u * u;
      }
      steps = 0;
      const meanU = su * invK;
      const variance = su2 * invK - meanU * meanU;
      o[i] = variance !== variance ? NaN : variance > 0 ? Math.sqrt(variance) : 0;
    } else {
      const uNew = v - anchor;
      const uOld = x[i - k] - anchor;
      su += uNew - uOld;
      su2 += uNew * uNew - uOld * uOld;
      const meanU = su * invK;
      const variance = su2 * invK - meanU * meanU;
      o[i] = variance !== variance ? NaN : variance > 0 ? Math.sqrt(variance) : 0;
    }
  }
  return o;
}

/**
 * Shift a Float64Array forward by `k` bars (leading `k` entries are NaN).
 * @param {Float64Array} x
 * @param {number} k
 * @param {number} n
 * @returns {Float64Array}
 */
export function vsShift(x, k, n) {
  const o = new Float64Array(n).fill(NaN);
  for (let i = k; i < n; i++) o[i] = x[i - k];
  return o;
}

/**
 * All 29 Vektor Script built-in functions (null-prototype map).
 * Matches index.html lines 4255-4282 bit-for-bit.
 */
export const VS_FN = Object.freeze(
  Object.assign(Object.create(null), {
    sma: {
      a: 2,
      sig: "sma(source, length)",
      f: (A, n, c, _E, lim) => vsSMA(vsSer(A[0], n), vsLen(A[1], "sma", c, lim.len), n),
    },
    ema: {
      a: 2,
      sig: "ema(source, length)",
      f: (A, n, c, _E, lim) => vsEMA(vsSer(A[0], n), vsLen(A[1], "ema", c, lim.len), n),
    },
    rma: {
      a: 2,
      sig: "rma(source, length)",
      f: (A, n, c, _E, lim) => {
        const k = vsLen(A[1], "rma", c, lim.len);
        return vsEMA(vsSer(A[0], n), k, n, 1 / k);
      },
    },
    wma: {
      a: 2,
      sig: "wma(source, length)",
      f: (A, n, c, _E, lim) => vsWMA(vsSer(A[0], n), vsLen(A[1], "wma", c, lim.len), n),
    },
    stdev: {
      a: 2,
      sig: "stdev(source, length)",
      f: (A, n, c, _E, lim) => vsStdev(vsSer(A[0], n), vsLen(A[1], "stdev", c, lim.len), n),
    },
    highest: {
      a: 2,
      sig: "highest(source, length)",
      f: (A, n, c, _E, lim) => vsHighest(vsSer(A[0], n), vsLen(A[1], "highest", c, lim.len), n),
    },
    lowest: {
      a: 2,
      sig: "lowest(source, length)",
      f: (A, n, c, _E, lim) => vsLowest(vsSer(A[0], n), vsLen(A[1], "lowest", c, lim.len), n),
    },
    sum: {
      a: 2,
      sig: "sum(source, length)",
      f: (A, n, c, _E, lim) => vsSum(vsSer(A[0], n), vsLen(A[1], "sum", c, lim.len), n),
    },
    change: {
      a: [1, 2],
      sig: "change(source, length = 1)",
      f: (A, n, c, _E, lim) => {
        const x = vsSer(A[0], n);
        const k = A.length > 1 ? vsLen(A[1], "change", c, lim.len) : 1;
        const s = vsShift(x, k, n);
        return vsMap2(x, s, (a, b) => a - b, n);
      },
    },
    roc: {
      a: 2,
      sig: "roc(source, length)",
      f: (A, n, c, _E, lim) => {
        const x = vsSer(A[0], n);
        const s = vsShift(x, vsLen(A[1], "roc", c, lim.len), n);
        return vsMap2(x, s, (a, b) => (b ? (a / b - 1) * 100 : NaN), n);
      },
    },
    rsi: {
      a: 2,
      sig: "rsi(source, length)",
      f: (A, n, c, _E, lim) => {
        const x = vsSer(A[0], n);
        const k = vsLen(A[1], "rsi", c, lim.len);
        const o = new Float64Array(n).fill(NaN);
        let g = 0;
        let l = 0;
        for (let i = 1; i < n; i++) {
          const d = x[i] - x[i - 1];
          const u = Math.max(d, 0);
          const w = Math.max(-d, 0);
          if (i <= k) {
            g += u;
            l += w;
            if (i === k) {
              g /= k;
              l /= k;
              o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
            }
          } else {
            g = (g * (k - 1) + u) / k;
            l = (l * (k - 1) + w) / k;
            o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
          }
        }
        return o;
      },
    },
    tr: {
      a: 0,
      sig: "tr()",
      f: (_A, n, _c, E) => {
        const o = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          o[i] = i
            ? Math.max(
                E.high[i] - E.low[i],
                Math.abs(E.high[i] - E.close[i - 1]),
                Math.abs(E.low[i] - E.close[i - 1])
              )
            : E.high[i] - E.low[i];
        }
        return o;
      },
    },
    atr: {
      a: 1,
      sig: "atr(length)",
      f: (A, n, c, E, lim) => {
        const k = vsLen(A[0], "atr", c, lim.len);
        return vsEMA(VS_FN.tr.f([], n, c, E, lim), k, n, 1 / k);
      },
    },
    crossover: {
      a: 2,
      sig: "crossover(a, b)",
      f: (A, n) => {
        const x = vsSer(A[0], n);
        const y = vsSer(A[1], n);
        const o = new Float64Array(n);
        for (let i = 1; i < n; i++) o[i] = x[i] > y[i] && x[i - 1] <= y[i - 1] ? 1 : 0;
        return o;
      },
    },
    crossunder: {
      a: 2,
      sig: "crossunder(a, b)",
      f: (A, n) => {
        const x = vsSer(A[0], n);
        const y = vsSer(A[1], n);
        const o = new Float64Array(n);
        for (let i = 1; i < n; i++) o[i] = x[i] < y[i] && x[i - 1] >= y[i - 1] ? 1 : 0;
        return o;
      },
    },
    cum: {
      a: 1,
      sig: "cum(source)",
      f: (A, n) => {
        const x = vsSer(A[0], n);
        const o = new Float64Array(n);
        let s = 0;
        for (let i = 0; i < n; i++) {
          if (!isNaN(x[i])) s += x[i];
          o[i] = s;
        }
        return o;
      },
    },
    nz: {
      a: [1, 2],
      sig: "nz(source, replacement = 0)",
      f: (A, n) => vsMap2(A[0], A.length > 1 ? A[1] : 0, (a, b) => (isNaN(a) ? b : a), n),
    },
    abs: { a: 1, sig: "abs(x)", f: (A, n) => vsMap1(A[0], Math.abs, n) },
    sqrt: { a: 1, sig: "sqrt(x)", f: (A, n) => vsMap1(A[0], Math.sqrt, n) },
    log: { a: 1, sig: "log(x)", f: (A, n) => vsMap1(A[0], Math.log, n) },
    exp: { a: 1, sig: "exp(x)", f: (A, n) => vsMap1(A[0], Math.exp, n) },
    round: {
      a: [1, 2],
      sig: "round(x, decimals = 0)",
      f: (A, n) => {
        const d = Math.pow(
          10,
          A.length > 1 && !vsIsS(A[1]) ? Math.max(0, Math.min(10, Math.round(A[1]))) : 0
        );
        return vsMap1(A[0], (v) => Math.round(v * d) / d, n);
      },
    },
    floor: { a: 1, sig: "floor(x)", f: (A, n) => vsMap1(A[0], Math.floor, n) },
    ceil: { a: 1, sig: "ceil(x)", f: (A, n) => vsMap1(A[0], Math.ceil, n) },
    pow: { a: 2, sig: "pow(x, y)", f: (A, n) => vsMap2(A[0], A[1], Math.pow, n) },
    min: {
      a: 2,
      sig: "min(a, b)",
      f: (A, n) => vsMap2(A[0], A[1], (a, b) => (isNaN(a) || isNaN(b) ? NaN : Math.min(a, b)), n),
    },
    max: {
      a: 2,
      sig: "max(a, b)",
      f: (A, n) => vsMap2(A[0], A[1], (a, b) => (isNaN(a) || isNaN(b) ? NaN : Math.max(a, b)), n),
    },
    avg: { a: 2, sig: "avg(a, b)", f: (A, n) => vsMap2(A[0], A[1], (a, b) => (a + b) / 2, n) },
    isna: { a: 1, sig: "isna(x)", f: (A, n) => vsMap1(A[0], (v) => (isNaN(v) ? 1 : 0), n) },
  })
);

/** Names of all 29 built-in functions. */
export const VS_BUILTIN_NAMES = Object.freeze(Object.keys(VS_FN));

/** Declaration directives handled directly by the runtime. */
export const VS_DECL = Object.freeze(["indicator", "input", "plot", "hline"]);

/** Levenshtein edit distance for "Did you mean ...?" hints. */
export function vsLev(a, b) {
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] = Math.min(
        m[i - 1][j] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j - 1] + (a[j - 1] === b[i - 1] ? 0 : 1)
      );
    }
  }
  return m[b.length][a.length];
}

/** Suggest the closest identifier within edit distance < 3. */
export function vsSuggest(w, pool) {
  let best = null;
  let bd = 3;
  const low = w.toLowerCase();
  for (const p of pool) {
    if (Math.abs(low.length - p.length) >= bd) continue;
    const d = vsLev(low, p);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/** Validate and resolve a colour name or hex literal. */
export function vsColor(v, node) {
  if (typeof v !== "string") {
    throw vsErr(
      node,
      "Colours are text like #2962ff or a name like blue",
      "Pass a colour name (e.g. blue) or hex literal (e.g. #2962ff)."
    );
  }
  const s = v.toLowerCase();
  if (vsOwn(VS_COLORS, s)) return VS_COLORS[s];
  if (/^#([0-9a-f]{6}|[0-9a-f]{3})$/.test(s)) return s;
  throw vsErr(
    node,
    "Unknown colour \u201c" + v + "\u201d",
    "Use #rrggbb or one of: " + Object.keys(VS_COLORS).slice(0, 8).join(", ") + "\u2026"
  );
}
