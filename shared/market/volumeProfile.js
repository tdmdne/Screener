// shared/market/volumeProfile.js — server-side volume profile (E-11) over a time range of bars.
// Each bar's volume is spread evenly across the price rows its high-low range touches (split into up/down volume by the
// bar's direction). Returns render-ready rows plus point of control and the 70% value area. The browser only draws it.

export const VP_DEFAULT_ROWS = 24;
export const VP_MAX_ROWS = 200;
export const VP_VALUE_AREA = 0.7;

const fin = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * @param {Array<{t:number,o:number,h:number,l:number,c:number,v:number}>} bars
 * @param {{ from?: number, to?: number, rows?: number, valueArea?: number }} [opts]
 * @returns {{ rows: Array<{lo:number,hi:number,v:number,up:number,dn:number}>, poc: number, vah: number, val: number,
 *   total: number, from: number|null, to: number|null, bars: number }}
 */
export function volumeProfile(bars, opts = {}) {
  const rowsN = Number.isInteger(opts.rows) && opts.rows >= 2 && opts.rows <= VP_MAX_ROWS ? opts.rows : VP_DEFAULT_ROWS;
  const vaPct = fin(opts.valueArea) && opts.valueArea > 0 && opts.valueArea < 1 ? opts.valueArea : VP_VALUE_AREA;
  const from = fin(opts.from) ? opts.from : -Infinity;
  const to = fin(opts.to) ? opts.to : Infinity;
  const sel = (Array.isArray(bars) ? bars : []).filter(
    (b) => b && b.t >= from && b.t <= to && fin(b.h) && fin(b.l) && b.h >= b.l && b.l > 0
  );
  const empty = { rows: [], poc: 0, vah: 0, val: 0, total: 0, from: sel.length ? sel[0].t : null, to: sel.length ? sel[sel.length - 1].t : null, bars: sel.length };
  if (!sel.length) return empty;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of sel) {
    if (b.l < lo) lo = b.l;
    if (b.h > hi) hi = b.h;
  }
  if (!(hi > lo)) hi = lo * 1.0001;
  const step = (hi - lo) / rowsN;
  const rows = Array.from({ length: rowsN }, (_, i) => ({ lo: lo + i * step, hi: lo + (i + 1) * step, v: 0, up: 0, dn: 0 }));
  let total = 0;
  // Spot FX feeds (Twelve Data) carry no volume. Then build a time-at-price (TPO-style) profile: every bar counts once
  // across the rows it touches. `basis` tells the client which one it got, so it is never presented as real volume.
  const hasVolume = sel.some((b) => fin(b.v) && b.v > 0);
  const basis = hasVolume ? "volume" : "time";
  for (const b of sel) {
    const vol = hasVolume ? (fin(b.v) && b.v > 0 ? b.v : 0) : 1;
    if (!vol) continue;
    const i0 = Math.max(0, Math.min(rowsN - 1, Math.floor((b.l - lo) / step)));
    const i1 = Math.max(0, Math.min(rowsN - 1, Math.floor((b.h - lo) / step)));
    const share = vol / (i1 - i0 + 1);
    const up = b.c >= b.o;
    for (let i = i0; i <= i1; i++) {
      rows[i].v += share;
      if (up) rows[i].up += share;
      else rows[i].dn += share;
    }
    total += vol;
  }
  if (!total) return { ...empty, rows, bars: sel.length };
  // point of control and value area: grow from the POC row towards the heavier neighbour until vaPct of volume
  let pocI = 0;
  for (let i = 1; i < rowsN; i++) if (rows[i].v > rows[pocI].v) pocI = i;
  let a = pocI;
  let z = pocI;
  let acc = rows[pocI].v;
  while (acc < total * vaPct && (a > 0 || z < rowsN - 1)) {
    const below = a > 0 ? rows[a - 1].v : -1;
    const above = z < rowsN - 1 ? rows[z + 1].v : -1;
    if (above >= below) acc += rows[++z].v;
    else acc += rows[--a].v;
  }
  return {
    rows,
    poc: (rows[pocI].lo + rows[pocI].hi) / 2,
    vah: rows[z].hi,
    val: rows[a].lo,
    total,
    basis,
    from: sel[0].t,
    to: sel[sel.length - 1].t,
    bars: sel.length,
  };
}

/** Parse `vp`, `vpFrom`, `vpTo` query values; null when no profile was asked for. */
export function parseVolumeProfileQuery(params) {
  const raw = params.get("vp");
  if (raw === null) return null;
  const rows = raw === "" || raw === "1" ? VP_DEFAULT_ROWS : Number(raw);
  if (!(Number.isInteger(rows) && rows >= 2 && rows <= VP_MAX_ROWS)) return { ok: false, error: `vp must be an integer 2..${VP_MAX_ROWS}` };
  const f = params.get("vpFrom");
  const t = params.get("vpTo");
  const from = f === null || f === "" ? undefined : Number(f);
  const to = t === null || t === "" ? undefined : Number(t);
  if ((from !== undefined && !(from > 0)) || (to !== undefined && !(to > 0))) return { ok: false, error: "vpFrom / vpTo must be unix seconds" };
  if (from !== undefined && to !== undefined && to < from) return { ok: false, error: "vpTo must be >= vpFrom" };
  return { ok: true, rows, from, to };
}
