// shared/market/chartTransforms.js — server-side chart transforms (E-10): Renko bricks and Line Break.
// The browser renders the returned bars verbatim (AGENTS.md §0). Bars in/out: { t (unix s), o, h, l, c, v }.
// Output times are real source-bar times; several bricks completed inside one source bar get t, t+1, t+2 ... seconds so
// the series stays strictly increasing and time-aligned with drawings/indicators.

export const CHART_TRANSFORMS = Object.freeze(["renko", "linebreak"]);
export const DEFAULT_LINE_BREAK = 3;
export const MAX_BRICKS = 5000;

const isPos = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Average true range over the last `n` bars (Wilder-free simple mean); 0 when not enough data. */
export function averageTrueRange(bars, n = 14) {
  if (!Array.isArray(bars) || bars.length < 2) return 0;
  const from = Math.max(1, bars.length - n);
  let sum = 0;
  let k = 0;
  for (let i = from; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].c;
    sum += Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
    k += 1;
  }
  return k ? sum / k : 0;
}

/** Round a positive box size to 3 significant figures so the axis shows clean levels. */
export function niceBox(v) {
  if (!isPos(v)) return 0;
  return Number(v.toPrecision(3));
}

function pushBrick(out, srcT, o, c, v, seen) {
  const n = (seen.get(srcT) || 0);
  seen.set(srcT, n + 1);
  out.push({ t: srcT + n, o, h: Math.max(o, c), l: Math.min(o, c), c, v });
}

/**
 * Renko (close-based, traditional): a brick prints each time the close moves one box beyond the last brick;
 * a reversal needs two boxes. `box` defaults to ATR(14) of the source bars (rounded).
 * @returns {{ bars: object[], box: number }}
 */
export function renkoBricks(bars, opts = {}) {
  if (!Array.isArray(bars) || bars.length === 0) return { bars: [], box: 0 };
  const box = isPos(opts.box) ? opts.box : niceBox(averageTrueRange(bars, 14));
  if (!isPos(box)) return { bars: [], box: 0 };
  const out = [];
  const seen = new Map();
  let base = Math.floor(bars[0].c / box) * box; // brick grid anchored to round multiples of the box
  let dir = 0; // +1 up, -1 down, 0 none yet
  for (const b of bars) {
    if (!isPos(b.c)) continue;
    const vol = Number.isFinite(b.v) ? b.v : 0;
    let guard = 0;
    for (;;) {
      if (out.length >= MAX_BRICKS || guard++ > 1000) break;
      if (dir >= 0 && b.c >= base + box) {
        pushBrick(out, b.t, base, base + box, vol, seen);
        base += box;
        dir = 1;
      } else if (dir <= 0 && b.c <= base - box) {
        pushBrick(out, b.t, base, base - box, vol, seen);
        base -= box;
        dir = -1;
      } else if (dir === 1 && b.c <= base - 2 * box) {
        // reversal from an up brick: new down brick starts one box below the last brick's top
        pushBrick(out, b.t, base - box, base - 2 * box, vol, seen);
        base -= 2 * box;
        dir = -1;
      } else if (dir === -1 && b.c >= base + 2 * box) {
        pushBrick(out, b.t, base + box, base + 2 * box, vol, seen);
        base += 2 * box;
        dir = 1;
      } else break;
    }
  }
  return { bars: out.slice(-MAX_BRICKS), box };
}

/**
 * N-line break (default 3): a new line prints when the close exceeds the previous line's extreme; a reversal must break
 * the extreme of the last `n` lines.
 * @returns {{ bars: object[], n: number }}
 */
export function lineBreak(bars, opts = {}) {
  const n = Number.isInteger(opts.n) && opts.n >= 2 && opts.n <= 5 ? opts.n : DEFAULT_LINE_BREAK;
  if (!Array.isArray(bars) || bars.length === 0) return { bars: [], n };
  const out = [];
  const first = bars.find((b) => isPos(b.c) && isPos(b.o));
  if (!first) return { bars: [], n };
  out.push({ t: first.t, o: first.o, h: Math.max(first.o, first.c), l: Math.min(first.o, first.c), c: first.c, v: first.v || 0 });
  for (const b of bars) {
    if (b.t <= out[out.length - 1].t || !isPos(b.c)) continue;
    const last = out[out.length - 1];
    const up = last.c >= last.o;
    const recent = out.slice(-n);
    const hi = Math.max(...recent.map((x) => x.h));
    const lo = Math.min(...recent.map((x) => x.l));
    let line = null;
    if (up ? b.c > last.c : b.c < last.c) {
      line = { o: last.c, c: b.c }; // continuation
    } else if (up ? b.c < lo : b.c > hi) {
      line = { o: last.o, c: b.c }; // reversal from the far end of the last line
    }
    if (line) out.push({ t: b.t, o: line.o, h: Math.max(line.o, line.c), l: Math.min(line.o, line.c), c: line.c, v: b.v || 0 });
    if (out.length >= MAX_BRICKS) break;
  }
  return { bars: out, n };
}

/**
 * Parse `type`, `box`, `lb` query values. Returns null for a normal (untransformed) request.
 * @returns {null | { ok: true, type: string, box?: number, n?: number } | { ok: false, error: string }}
 */
export function parseChartTransform(params) {
  const type = params.get("type");
  if (type === null || type === "" || type === "candles") return null;
  if (!CHART_TRANSFORMS.includes(type)) return { ok: false, error: `type must be one of ${CHART_TRANSFORMS.join(", ")}` };
  const rawBox = params.get("box");
  const box = rawBox === null || rawBox === "" ? undefined : Number(rawBox);
  if (box !== undefined && !isPos(box)) return { ok: false, error: "box must be a positive number" };
  const rawN = params.get("lb");
  const n = rawN === null || rawN === "" ? undefined : Number(rawN);
  if (n !== undefined && !(Number.isInteger(n) && n >= 2 && n <= 5)) return { ok: false, error: "lb must be an integer 2..5" };
  return { ok: true, type, box, n };
}

/** Apply a parsed transform to source bars. */
export function applyChartTransform(bars, spec) {
  if (spec.type === "renko") {
    const r = renkoBricks(bars, { box: spec.box });
    return { bars: r.bars, meta: { type: "renko", box: r.box } };
  }
  const r = lineBreak(bars, { n: spec.n });
  return { bars: r.bars, meta: { type: "linebreak", lb: r.n } };
}
