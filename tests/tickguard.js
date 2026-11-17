// Live-data guards: the tick filter in index.html and sanitizeBars in worker.js / server.js.
// Pure-logic test: pulls the real functions out of the source files, so it needs no browser.
// Run: node tests/tickguard.js
const fs = require("fs"), assert = require("assert"), path = require("path");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

function grab(src, start) { // text of a function (or const) starting at `start`, up to its matching close
  const i = src.indexOf(start); assert(i >= 0, "missing: " + start);
  let j = src.indexOf("{", i), d = 0;
  for (let k = j; k < src.length; k++) { const c = src[k]; if (c === "{") d++; else if (c === "}" && !--d) return src.slice(i, k + 1); }
  throw new Error("unbalanced: " + start);
}

// ---- client tick guard (from index.html)
const html = read("index.html");
const clientCode = "const VT_TG={ref:Object.create(null),q:Object.create(null)};\n" + grab(html, "function vtTgRoll(") + "\n" + grab(html, "function vtTickOk(") + "\n" + grab(html, "function vtTgFilter(") + "\n" + grab(html, "function vtBarApply(") + "\nthis.f=vtTgFilter;this.R=VT_TG;this.ok=vtTickOk;this.bar=vtBarApply;";
const STEP = { "1m": 60, "1H": 3600, "1D": 86400, "1W": 604800 };
function newGuard() { const ctx = { LIVE: {} }; new Function("LIVE", "STEP", clientCode).call(ctx, ctx.LIVE, STEP); return ctx; }
// src/94_edge_client.js must carry the identical guard (so regenerating index.html from src can't bring the bug back)
const blockOf = (t) => { const end = "if(a.length>500)a.splice(0,a.length-500);return true}\n", i = t.indexOf("// ---- Live tick guard:"), j = t.indexOf(end, i); assert(i >= 0 && j > i, "guard block missing"); return t.slice(i, j + end.length); };
assert.strictEqual(blockOf(read("src/94_edge_client.js")), blockOf(html), "src/94_edge_client.js guard differs from index.html");

// ---- server bar sanitizer (worker.js, and server.js must carry the identical function)
const wsrc = read("worker.js"), ssrc = read("server.js");
const sanW = grab(wsrc, "function sanitizeBars("), sanS = grab(ssrc, "function sanitizeBars(");
assert.strictEqual(sanW, sanS, "sanitizeBars differs between worker.js and server.js");
const sanitizeBars = new Function("return (" + sanW + ")")();

let n = 0; const ok = (name) => console.log("PASS " + (++n) + " " + name);
const T = (iso) => Date.parse(iso);

// ============ tick guard ============
{ // 1. normal drift passes untouched
  const g = newGuard(); let p = 1.3207;
  for (let i = 0; i < 50; i++) { p *= 1 + (i % 2 ? 1 : -1) * 0.00003; assert.deepStrictEqual(g.f("GBPUSD", p, "FX", T("2026-11-17T14:00:00Z") + i * 1000, 1.3207), [p]); }
  ok("normal ticks pass straight through");
}
{ // 2. the reported bug: one isolated print at the seed price (1.2706 vs 1.3207) is never applied
  const g = newGuard(); g.f("GBPUSD", 1.3207, "FX", T("2026-11-17T21:59:00Z"), 1.3207);
  assert.deepStrictEqual(g.f("GBPUSD", 1.2706, "FX", T("2026-11-17T22:00:01Z"), 1.3207), []);
  assert.deepStrictEqual(g.f("GBPUSD", 1.3208, "FX", T("2026-11-17T22:00:02Z"), 1.3207), [1.3208]);
  assert.strictEqual(g.R.ref.GBPUSD, 1.3208, "reference not moved by the bad print");
  ok("isolated 3.9% rollover print is dropped and the next real tick is accepted");
}
{ // 3. real and phantom ticks interleaved: every phantom dropped, every real tick kept
  const g = newGuard(); const out = [];
  g.f("GBPUSD", 1.3207, "FX", T("2026-11-17T21:59:00Z"), 1.3207);
  for (let i = 0; i < 12; i++) { const t = T("2026-11-17T22:00:00Z") + i * 1000; out.push(...g.f("GBPUSD", i % 2 ? 1.2706 + i * 1e-5 : 1.3207 + i * 1e-6, "FX", t, 1.3207)); }
  assert(out.length === 6 && out.every((x) => x > 1.32), "kept " + JSON.stringify(out));
  ok("alternating real/phantom stream: all 6 phantoms dropped, all 6 real ticks kept");
}
{ // 4. a real news move (+0.45%) that holds: delayed by two ticks, then applied in full, in order
  const g = newGuard(); g.f("GBPUSD", 1.3200, "FX", T("2026-11-17T13:29:00Z"), 1.3200); const t0 = T("2026-11-17T13:30:00Z");
  assert.deepStrictEqual(g.f("GBPUSD", 1.3260, "FX", t0, 1.32), []);
  assert.deepStrictEqual(g.f("GBPUSD", 1.3262, "FX", t0 + 1000, 1.32), []);
  assert.deepStrictEqual(g.f("GBPUSD", 1.3258, "FX", t0 + 2000, 1.32), [1.3260, 1.3262, 1.3258]);
  assert.deepStrictEqual(g.f("GBPUSD", 1.3265, "FX", t0 + 3000, 1.32), [1.3265]);
  ok("real macro-news jump is confirmed after 3 ticks and applied with its full high/low path");
}
{ // 5. inside the NY rollover window a +0.3% step needs 4 confirming ticks instead of 3
  const g = newGuard(); g.f("GBPUSD", 1.3200, "FX", T("2026-11-17T21:59:00Z"), 1.3200); const t0 = T("2026-11-17T22:00:00Z");
  for (let i = 0; i < 3; i++) assert.deepStrictEqual(g.f("GBPUSD", 1.3240 + i * 1e-5, "FX", t0 + i * 1000, 1.32), []);
  assert.strictEqual(g.f("GBPUSD", 1.3240, "FX", t0 + 3000, 1.32).length, 4);
  ok("rollover window needs 4 confirming ticks (EST: 22:00 UTC)");
}
{ // 5b. a jump above the hard limit (FX 1.5%) is dropped: 7 steady wrong ticks change nothing, the 8th is a confirmed repricing
  const g = newGuard(); g.f("GBPUSD", 1.3207, "FX", T("2026-11-17T21:59:00Z"), 1.3207); const t0 = T("2026-11-17T22:00:00Z");
  for (let i = 0; i < 7; i++) assert.deepStrictEqual(g.f("GBPUSD", 1.2706 + i * 1e-5, "FX", t0 + i * 1000, 1.32), []);
  assert.strictEqual(g.R.ref.GBPUSD, 1.3207, "reference untouched while dropping");
  assert.strictEqual(g.f("GBPUSD", 1.2706, "FX", t0 + 7000, 1.32).length, 8);
  ok("3.9% jump: dropped for 7 ticks, only a sustained 8-tick repricing gets through (no permanent freeze)");
}
{ // 5c. hard limits per class: crypto 4% needs 3 ticks, 6% needs 8; indices 1.2% needs 3, 2% needs 8
  const run = (mk, base, mv) => { const g = newGuard(); g.f("X", base, mk, 0, base); let n = 0; for (; n < 12; n++) if (g.f("X", base * (1 + mv), mk, 1000 + n * 1000, base).length) return n + 1; return -1; };
  assert.strictEqual(run("CRY", 100, 0.04), 3); assert.strictEqual(run("CRY", 100, 0.06), 8);
  assert.strictEqual(run("IDX", 5000, 0.012), 3); assert.strictEqual(run("IDX", 5000, 0.02), 8);
  assert.strictEqual(run("STK", 100, 0.04), 3); assert.strictEqual(run("STK", 100, 0.06), 8);
  ok("hard limits: FX/indices 1.5%, crypto/stocks 5%");
}
{ // 5d. invalid ticks: zero, negative, NaN, undefined, non-numeric, Infinity, missing symbol, invalid or crossed bid/ask
  const g = newGuard(), bad = [{ s: "A", c: 0 }, { s: "A", c: -1 }, { s: "A", c: NaN }, { s: "A" }, { s: "A", c: undefined }, { s: "A", c: "x" }, { s: "A", c: Infinity },
    { s: "", c: 1 }, { c: 1 }, null, undefined, { s: "A", c: 1, bid: 1.2, ask: 1.1 }, { s: "A", c: 1, bid: 0, ask: 1 }, { s: "A", c: 1, bid: NaN, ask: 1 }, { s: "A", c: 1, bid: 1, ask: -2 }];
  bad.forEach((t, i) => assert.strictEqual(g.ok(t), false, "should reject #" + i + " " + JSON.stringify(t)));
  [{ s: "A", c: 1 }, { s: "A", c: "1.5" }, { s: "A", c: 1, bid: 0.99, ask: 1.01 }, { s: "A", c: 1, bid: 1, ask: 1 }].forEach((t, i) => assert.strictEqual(g.ok(t), true, "should accept #" + i));
  ok("zero/NaN/undefined prices and crossed or invalid bid/ask are rejected, good ticks accepted");
}
{ // 5e. strict candle initialisation: a new bar opens at the previous close, never at the tick; stale ticks never rewrite history
  const g = newGuard(); g.LIVE["X|1m"] = [{ t: 60, o: 1.30, h: 1.31, l: 1.29, c: 1.305, v: 1 }, { t: 120, o: 1.305, h: 1.308, l: 1.30, c: 1.307, v: 1 }];
  assert.strictEqual(g.bar("X", "1m", 1.309, 125), true);
  assert.deepStrictEqual(g.LIVE["X|1m"][1], { t: 120, o: 1.305, h: 1.309, l: 1.30, c: 1.309, v: 1 });
  assert.strictEqual(g.bar("X", "1m", 1.312, 190), true);
  assert.deepStrictEqual(g.LIVE["X|1m"][2], { t: 180, o: 1.309, h: 1.312, l: 1.309, c: 1.312, v: 0 }, "opens at previous close 1.309, not at the tick");
  assert.strictEqual(g.bar("X", "1m", 1.20, 100), false, "stale tick ignored");
  assert.strictEqual(g.LIVE["X|1m"].length, 3);
  assert.strictEqual(g.bar("X", "1m", 1.315, 440), true); // quiet gap of several minutes: one bar on the same grid, still opening at the previous close
  assert.deepStrictEqual(g.LIVE["X|1m"][3], { t: 420, o: 1.312, h: 1.315, l: 1.312, c: 1.315, v: 0 });
  g.LIVE["X|1W"] = [{ t: 0, o: 1, h: 1.1, l: 0.9, c: 1.05, v: 0 }]; assert.strictEqual(g.bar("X", "1W", 1.07, 1000), true); assert.strictEqual(g.LIVE["X|1W"].length, 1);
  assert.strictEqual(g.bar("X", "1W", 1.07, 700000), false, "no calendar guessing for weekly bars"); assert.strictEqual(g.LIVE["X|1W"].length, 1);
  assert.strictEqual(g.bar("X", "9x", 1, 1), false); assert.strictEqual(g.bar("NOPE", "1m", 1, 1), false);
  ok("new candle opens at the previous close, stale ticks ignored, weekly bars never invented");
}
{ // 6. rollover window follows New York time, so it moves with US daylight saving
  const g = newGuard(); const probe = (iso) => { const gg = newGuard(); gg.f("X", 1.3207, "FX", 0, 1.3207); return gg.f("X", 1.3260, "FX", T(iso), 1.3207); };
  // +0.4% sits between the rollover limit (0.07%) and the normal limit (0.15%)? no: both hold it. Use +0.1%: passes outside, held inside.
  const pr = (iso) => { const gg = newGuard(); gg.f("X", 1.3000, "FX", 0, 1.3000); return gg.f("X", 1.3000 * 1.001, "FX", T(iso), 1.3000).length; };
  assert.strictEqual(pr("2026-11-17T22:00:00Z"), 0, "17:00 EST is rollover");
  assert.strictEqual(pr("2026-11-17T21:00:00Z"), 1, "16:00 EST is not");
  assert.strictEqual(pr("2026-07-15T21:00:00Z"), 0, "17:00 EDT is rollover");
  assert.strictEqual(pr("2026-07-15T22:00:00Z"), 1, "18:00 EDT is not");
  ok("rollover window tracks New York 17:00 in both winter and summer time");
}
{ // 7. crypto and stocks use their own limits
  const g = newGuard(); g.f("BTCUSDT", 100000, "CRY", 1, 100000);
  assert.deepStrictEqual(g.f("BTCUSDT", 101500, "CRY", 2, 100000), [101500]);
  assert.deepStrictEqual(g.f("BTCUSDT", 108000, "CRY", 3, 100000), []);
  const h = newGuard(); assert.deepStrictEqual(h.f("AAPL", 188.5, "STK", 1, 187), [188.5]); // +0.8% passes
  assert.deepStrictEqual(h.f("AAPL", 192, "STK", 2, 187), []); // +2.7% in one tick is held until confirmed
  ok("crypto (2%) and stock (1%) limits");
}
{ // 8. with no history and no seed the first tick is accepted
  assert.deepStrictEqual(newGuard().f("EURUSD", 1.1, "FX", 1, 0), [1.1]);
  ok("first tick with no reference is accepted");
}

// ============ bar sanitizer ============
function series(n, t0, step, base, rng) { // quiet 1m-style bars
  const b = []; let p = base;
  for (let i = 0; i < n; i++) { const o = p, c = p + (i % 3 - 1) * rng * 0.3; b.push({ t: t0 + i * step, o, h: Math.max(o, c) + rng * 0.4, l: Math.min(o, c) - rng * 0.4, c, v: 100 }); p = c; }
  return b;
}
{ // 9. the reported candle: a bar at 21:57 UTC (16:57 NY) opens at 1.3207 and closes at 1.2706
  const t0 = T("2026-11-17T21:30:00Z") / 1000, bars = series(60, t0, 60, 1.3207, 0.0004);
  const i = 27; bars[i] = { t: bars[i].t, o: bars[i].o, h: bars[i].h, l: 1.2700, c: 1.2706, v: 100 };
  const out = sanitizeBars(bars, "FX");
  const lowest = Math.min(...out.map((b) => b.l)), prev = Math.min(...bars.filter((_, k) => k !== i).map((b) => b.l));
  assert(lowest > prev - 0.003, "lowest low after clean: " + lowest + " vs normal " + prev);
  assert(Math.abs(out[i].c - bars[i - 1].c) < 0.003, "close pulled back: " + out[i].c);
  assert.strictEqual(out.length, bars.length);
  ok("phantom 1.2700-1.3207 rollover candle is clamped back to the neighbours' range");
}
{ // 10. a real news candle (not at rollover) that keeps going is never touched
  const t0 = T("2026-11-17T13:20:00Z") / 1000, bars = series(40, t0, 60, 1.3200, 0.0004);
  const i = 10, base = bars[i - 1].c;
  const news = [[base, base + 0.0090, base - 0.0002, base + 0.0085], [base + 0.0085, base + 0.0150, base + 0.0080, base + 0.0140], [base + 0.0140, base + 0.0160, base + 0.0120, base + 0.0130]];
  news.forEach(([o, h, l, c], k) => { bars[i + k] = { t: bars[i + k].t, o, h, l, c, v: 900 }; });
  for (let k = i + 3; k < bars.length; k++) { const d = bars[k].c - bars[k - 1].c; /* keep following the new level */ }
  let p = bars[i + 2].c; for (let k = i + 3; k < bars.length; k++) { const o = p, c = p + (k % 3 - 1) * 0.0001; bars[k] = { t: bars[k].t, o, h: Math.max(o, c) + 0.0002, l: Math.min(o, c) - 0.0002, c, v: 100 }; p = c; }
  assert.deepStrictEqual(sanitizeBars(bars, "FX"), bars);
  ok("multi-bar +110 pip news move is left byte-identical");
}
{ // 11. a real news wick that reverses (+80 pips, 0.6%) outside the rollover window is kept
  const t0 = T("2026-11-17T13:20:00Z") / 1000, bars = series(40, t0, 60, 1.3200, 0.0004);
  bars[15] = { ...bars[15], h: bars[14].c + 0.0080, c: bars[14].c + 0.0004 };
  assert.deepStrictEqual(sanitizeBars(bars, "FX"), bars);
  ok("genuine news wick that reverses is kept outside the rollover window");
}
{ // 12. but a gross 3.9% print is removed even outside the window
  const t0 = T("2026-11-17T13:20:00Z") / 1000, bars = series(40, t0, 60, 1.3200, 0.0004);
  bars[15] = { ...bars[15], l: 1.2700, c: 1.2706 };
  const out = sanitizeBars(bars, "FX"); assert(out[15].l > 1.31 && out[15].c > 1.31, JSON.stringify(out[15]));
  ok("gross bad print is removed at any time of day");
}
{ // 13. only the same ~15-minute window is strict: a 20-pip wick at 14:00 UTC is kept, at the rollover it is clamped
  const mk = (iso) => { const b = series(40, T(iso) / 1000 - 15 * 60, 60, 1.3200, 0.0004); b[15] = { ...b[15], h: b[14].c + 0.0020 }; return sanitizeBars(b, "FX")[15].h - b[14].c; };
  assert(mk("2026-11-17T14:00:00Z") > 0.0019, "kept at 14:00");
  assert(mk("2026-11-17T22:00:00Z") < 0.0015, "clamped at rollover");
  ok("20-pip wick: kept at 14:00 UTC, clamped at the 17:00 NY rollover");
}
{ // 14. edges, short series, other markets, no mutation
  const b = series(3, 1700000000, 60, 1.3, 0.0004); assert.strictEqual(sanitizeBars(b, "FX"), b);
  const c = series(30, 1700000000, 60, 100, 0.3); c[12] = { ...c[12], h: 160 }; const o = sanitizeBars(c, "STK"); assert(o[12].h < 110);
  const d = series(30, 1700000000, 60, 1.3, 0.0004), before = JSON.stringify(d); sanitizeBars(d, "FX"); assert.strictEqual(JSON.stringify(d), before);
  const e = series(30, 1700000000, 60, 1.3, 0.0004); e[0] = { ...e[0], l: 0.5 }; e[29] = { ...e[29], h: 3 }; assert.deepStrictEqual(sanitizeBars(e, "FX")[0], e[0]);
  ok("short series, stocks, first/last bar and input immutability");
}
console.log("\nAll " + n + " checks passed");
