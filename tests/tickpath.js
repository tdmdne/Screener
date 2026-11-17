// End-to-end check of the page's live tick path (edge WebSocket handler): a fake feed is pushed through the real
// handler in the real page. Phantom prints, invalid ticks and simulated ticks on a real chart must never reach a candle,
// and a new 1m candle must open at the previous close.
const { launch } = require("./harness"); const assert = require("assert");
(async () => {
  const h = await launch(); const P = h.page; const errs = []; P.on("pageerror", (e) => errs.push(String(e)));
  await P.goto(h.base); await P.waitForFunction(() => BOOTED && SYMS.some((s) => s[0] === "BTCUSDT")); await P.waitForTimeout(800);
  const r = await P.evaluate(() => {
    // fake the edge socket and drive the page's own onmessage handler
    class FakeWS { constructor() { FakeWS.last = this; this.readyState = 1; } send() {} close() {} }
    window.WebSocket = FakeWS; window.__WS = undefined; VT_EDGE.ws = null; vtWsConnect(); const ws = FakeWS.last;
    const sym = "GBPUSD", row = SYMS.find((x) => x[0] === sym) || (SYMS.push([sym, "FX", 1.3207]), SYMS[SYMS.length - 1]);
    row[1] = "FX"; row[2] = 1.3207; VT_CSRC[sym] = "real";
    const now = Math.floor(Date.now() / 1000), b0 = Math.floor(now / 60) * 60 - 60;
    LIVE[sym + "|1m"] = [{ t: b0 - 60, o: 1.3205, h: 1.3209, l: 1.3203, c: 1.3206, v: 0 }, { t: b0, o: 1.3206, h: 1.3209, l: 1.3204, c: 1.3207, v: 0 }];
    const send = (ticks, source) => ws.onmessage({ data: JSON.stringify({ type: "ticks", source: source || "twelvedata", ticks }) });
    send([{ s: sym, c: 1.3208 }]);                                   // good tick: opens the next minute at the previous close
    const afterGood = JSON.parse(JSON.stringify(LIVE[sym + "|1m"]));
    send([{ s: sym, c: 1.2706 }]);                                   // the phantom
    send([{ s: sym, c: 0 }, { s: sym, c: -5 }, { s: sym, c: "NaN" }, { s: sym }, { s: sym, c: 1.3208, bid: 1.33, ask: 1.32 }]); // invalid
    send([{ s: sym, c: 1.2706 }], "simulator");                      // simulated tick on a real chart
    ws.onmessage({ data: JSON.stringify({ type: "kline", symbol: sym, interval: "1m", bar: { t: b0 + 120, o: 1.2706, h: 1.2714, l: 1.2698, c: 1.2706, v: 5 } }) }); // simulated kline
    send([{ s: sym, c: 1.3209 }]);                                   // next real tick still accepted
    const bars = LIVE[sym + "|1m"];
    return { afterGood, bars: JSON.parse(JSON.stringify(bars)), price: row[2], lo: Math.min(...bars.map((b) => b.l)), hi: Math.max(...bars.map((b) => b.h)), b0, now };
  });
  console.log(JSON.stringify({ afterGood: r.afterGood.slice(-2), last: r.bars[r.bars.length - 1], price: r.price, lo: r.lo, errs }));
  const g = r.afterGood; assert.strictEqual(g.length, 3, "a new 1m bar was opened"); assert.strictEqual(g[2].o, g[1].c, "new bar opens at the previous close");
  assert(r.lo > 1.32, "no phantom low in any bar: " + r.lo); assert(r.hi < 1.321, "no phantom high: " + r.hi);
  assert.strictEqual(r.price, 1.3209, "table price follows only valid ticks"); assert.strictEqual(r.bars.length, 3, "no stray bars from simulated kline");
  assert.strictEqual(r.bars[2].c, 1.3209); assert.deepStrictEqual(errs, []);
  console.log("OK"); process.exit(0);
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
