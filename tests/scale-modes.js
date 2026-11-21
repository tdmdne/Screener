// E-01: price scale modes (regular / log / percent / indexed) and the quick auto/log/% toggle.
// Render-only: the mode is a lightweight-charts PriceScaleMode on the right scale; no series is recomputed client-side.
const assert=require("assert");const {launch}=require("./harness");
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1);
await P.evaluate(()=>openChart("EURUSD","1H"));
await P.waitForFunction(()=>LIVE["EURUSD|1H"]&&LIVE["EURUSD|1H"].length>50&&document.querySelector("#cv .vt-scaleb"));
const mode=()=>P.evaluate(()=>ch.priceScale("right").options().mode);
assert.strictEqual(await mode(),0,"regular by default");
const before=await P.evaluate(()=>JSON.stringify(LIVE["EURUSD|1H"].slice(-5)));

await P.click('#cv .vt-scaleb button[aria-label="Logarithmic scale"]');
assert.strictEqual(await mode(),1,"log applied");
assert.strictEqual(await P.getAttribute('#cv .vt-scaleb button[aria-label="Logarithmic scale"]',"aria-pressed"),"true");
await P.click('#cv .vt-scaleb button[aria-label="Percent scale"]');
assert.strictEqual(await mode(),2,"percent applied");
assert.strictEqual(await P.getAttribute('#cv .vt-scaleb button[aria-label="Logarithmic scale"]',"aria-pressed"),"false","only one mode on");
assert.strictEqual(await P.evaluate(()=>S.chart.scMode),2,"saved in chart state");

// survives a redraw (settings are re-applied from S.chart when the chart is rebuilt)
await P.evaluate(()=>openChart("EURUSD","1H"));
await P.waitForFunction(()=>document.querySelector("#cv .vt-scaleb"));
assert.strictEqual(await mode(),2,"mode kept after redraw");
await P.click('#cv .vt-scaleb button[aria-label="Percent scale"]');
assert.strictEqual(await mode(),0,"toggle off returns to regular");

// auto scale toggle
await P.click('#cv .vt-scaleb button[aria-label="Auto scale"]');
assert.strictEqual(await P.evaluate(()=>S.chart.scAuto),false,"auto scale off");
await P.click('#cv .vt-scaleb button[aria-label="Auto scale"]');
assert.strictEqual(await P.evaluate(()=>S.chart.scAuto),true,"auto scale on");

// settings dialog exposes every mode, incl. indexed to 100
await P.evaluate(()=>setM("scales"));
const opts=await P.$$eval('select[data-c="scMode"] option',o=>o.map(x=>x.textContent));
assert.deepStrictEqual(opts,["Regular","Logarithmic","Percent","Indexed to 100"]);
assert.ok(await P.$('input[data-c="scInv"]'),"invert scale option");

assert.strictEqual(await P.evaluate(()=>JSON.stringify(LIVE["EURUSD|1H"].slice(-5))),before,"bars untouched by scale changes");
assert.deepStrictEqual(h.offOrigin,[],"no non-origin requests");
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("scale-modes: ok");await h.close();
})().catch(e=>{console.error(e);process.exit(1)});
