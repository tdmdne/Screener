// E-04: compare/overlay symbols — picker via the Compare button, history from /api/candles, live bars from hub
// frames (view.chart.cmp), % vs own scale, remove, max 3, persisted. Render only.
const assert=require("assert");const {launch}=require("./harness");
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1&&SYMS.some(s=>s[0]==="GBPUSD"));
await P.evaluate(()=>{S.chart.cmp=[];go("chart");openChart("EURUSD","1H")});
await P.waitForFunction(()=>LIVE["EURUSD|1H"]&&LIVE["EURUSD|1H"].length>50&&ch);

// add via the Compare button + symbol picker
await P.click('button:has-text("Compare")');
assert.strictEqual(await P.getAttribute(".vt-cmd","aria-label"),"Compare symbol");
await P.keyboard.type("GBPUSD");
await P.waitForFunction(()=>[...document.querySelectorAll(".vt-cmd-opt")].some(o=>o.textContent.startsWith("GBPUSD")));
const labels=await P.$$eval(".vt-cmd-grp",e=>e.map(x=>x.textContent));
assert.deepStrictEqual([...new Set(labels)],["Symbol"],"picker shows symbols only");
await P.keyboard.press("Enter");
assert.deepStrictEqual(await P.evaluate(()=>S.chart.cmp.map(x=>x.sym)),["GBPUSD"]);

// history loaded and series drawn; percent mode on the shared right scale
await P.waitForFunction(()=>vtCmpSer.length===1&&document.querySelector(".vt-cmpl"),null,{timeout:15000});
const st=await P.evaluate(()=>{const it=vtCmpSer[0],d=it.ser.data(),a=LIVE["GBPUSD|1H"];return{n:d.length,a:a.length,lastV:d[d.length-1].value,lastC:a[a.length-1].c,mode:ch.priceScale("right").options().mode}});
assert.strictEqual(st.n,st.a,"one point per server bar");
assert.strictEqual(st.lastV,st.lastC,"values are the server closes, untouched");
assert.strictEqual(st.mode,2,"percent scale while comparing");

// the hub is told about the compare symbol
await P.waitForFunction(()=>__edge.sent.some(m=>{try{const v=JSON.parse(m);return v.op==="view"&&v.chart&&Array.isArray(v.chart.cmp)&&v.chart.cmp.includes("GBPUSD")}catch(e){return false}}),null,{timeout:5000});

// live bar frame for the compare symbol updates its series
const lv=await P.evaluate(()=>{const a=LIVE["GBPUSD|1H"],last=a[a.length-1],nb=[last.t+3600,last.c,last.c*1.002,last.c*.999,last.c*1.001,10];
  __edge.push(__edge.frame("bar",{sym:"GBPUSD",tf:"1H",bar:nb,closed:false}));const d=vtCmpSer[0].ser.data();return{t:d[d.length-1].time,v:d[d.length-1].value,nb}});
assert.strictEqual(lv.t,lv.nb[0],"live bar time");assert.strictEqual(lv.v,lv.nb[4],"live bar close");

// own-scale mode
await P.click('.vt-cmpm');
await P.waitForFunction(()=>S.chart.cmpMode==="own"&&vtCmpSer.length===1);
assert.notStrictEqual(await P.evaluate(()=>ch.priceScale("right").options().mode),2,"main scale back to its own mode");
assert.strictEqual(await P.evaluate(()=>vtCmpSer[0].ser.options().priceScaleId),"cmp0");
await P.click('.vt-cmpm');

// max 3, no duplicates, main symbol excluded
await P.evaluate(()=>{vtCmpAdd("GBPUSD");vtCmpAdd("EURUSD");vtCmpAdd("USDJPY");vtCmpAdd("XAUUSD");vtCmpAdd("BTCUSDT")});
assert.deepStrictEqual(await P.evaluate(()=>S.chart.cmp.map(x=>x.sym)),["GBPUSD","USDJPY","XAUUSD"]);
assert.strictEqual(await P.evaluate(()=>new Set(S.chart.cmp.map(x=>x.col)).size),3,"distinct colours");

// remove; persisted across reload
await P.click('button[aria-label="Remove USDJPY from compare"]');
assert.deepStrictEqual(await P.evaluate(()=>S.chart.cmp.map(x=>x.sym)),["GBPUSD","XAUUSD"]);
await P.waitForTimeout(300);await P.reload();
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&ch);
assert.deepStrictEqual(await P.evaluate(()=>S.chart.cmp.map(x=>x.sym)),["GBPUSD","XAUUSD"],"persisted");

// series count never grows on redraws
await P.waitForFunction(()=>vtCmpSer.length===2,null,{timeout:15000});
await P.evaluate(()=>{drawChart();drawChart()});
assert.strictEqual(await P.evaluate(()=>vtCmpSer.length),2,"no duplicate series after redraws");

assert.deepStrictEqual(h.offOrigin,[],"no non-origin requests");
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("compare: ok");await h.close();
})().catch(e=>{console.error(e);process.exit(1)});
