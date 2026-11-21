// E-10: Renko / Line Break rendered from server bricks (/api/candles?type=) and Baseline render mode.
// The browser never builds bricks; raw live bars never enter a brick series.
const assert=require("assert");const {launch}=require("./harness");
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1);
await P.evaluate(()=>{go("chart");openChart("EURUSD","1H")});
await P.waitForFunction(()=>ch&&LIVE["EURUSD|1H"]&&LIVE["EURUSD|1H"].length>50);

// menu lists the new types
await P.click("#vt_ctype_btn");
const items=await P.$$eval("#vt_ctype_btn_menu .vt-ctype-item",e=>e.map(x=>x.textContent.trim()));
for(const t of ["Baseline","Renko","Line Break"])assert.ok(items.includes(t),"menu has "+t+": "+items);
await P.click('#vt_ctype_btn_menu .vt-ctype-item:has-text("Renko")');

// bricks come from the server request and are rendered verbatim
await P.waitForFunction(()=>VT_XF.data["EURUSD|1H|renko"]&&vtChartMeta&&vtChartMeta.candleSer&&vtChartMeta.candleSer.data().length>0,null,{timeout:10000});
assert.ok(h.candleCalls.some(q=>/type=renko/.test(q)),"renko requested from /api/candles: "+h.candleCalls);
const r=await P.evaluate(()=>{const srv=VT_XF.data["EURUSD|1H|renko"].bars,d=vtChartMeta.candleSer.data();
  return{n:d.length,srv:srv.length,same:d.every((x,i)=>x.time===srv[i].t&&x.open===srv[i].o&&x.close===srv[i].c),box:VT_XF.data["EURUSD|1H|renko"].meta.box,
    noWick:srv.every(b=>b.h===Math.max(b.o,b.c)&&b.l===Math.min(b.o,b.c))}});
assert.ok(r.n>3&&r.n===r.srv&&r.same,"server bricks rendered verbatim "+JSON.stringify(r));
assert.ok(r.box>0&&r.noWick,"renko box and wickless bricks");

// a raw live bar frame does not enter the brick series
const before=await P.evaluate(()=>JSON.stringify(vtChartMeta.candleSer.data().slice(-3)));
await P.evaluate(()=>{const a=LIVE["EURUSD|1H"],l=a[a.length-1];__edge.push(__edge.frame("bar",{sym:"EURUSD",tf:"1H",bar:[l.t+3600,l.c,l.c*1.01,l.c*.99,l.c*1.005,1],closed:false}))});
assert.strictEqual(await P.evaluate(()=>JSON.stringify(vtChartMeta.candleSer.data().slice(-3))),before,"no raw bar in renko series");

// line break
await P.evaluate(()=>vtSetChartType("linebreak"));
await P.waitForFunction(()=>VT_XF.data["EURUSD|1H|linebreak"]&&vtChartMeta.candleSer.data().length>0,null,{timeout:10000});
assert.ok(h.candleCalls.some(q=>/type=linebreak/.test(q)));
assert.strictEqual(await P.evaluate(()=>VT_XF.data["EURUSD|1H|linebreak"].meta.lb),3);

// baseline: one value per server bar (closes, untouched), baseline at the first loaded close
await P.evaluate(()=>vtSetChartType("baseline"));
const b=await P.evaluate(()=>{const d=vtChartMeta.candleSer.data(),a=LIVE["EURUSD|1H"];return{n:d.length,a:a.length,last:d[d.length-1].value,lastC:a[a.length-1].c,base:vtChartMeta.candleSer.options().baseValue.price,first:a[0].c}});
assert.ok(b.n===b.a&&b.last===b.lastC&&b.base===b.first,"baseline "+JSON.stringify(b));

// back to candles; palette has the types
await P.keyboard.press("Control+k");await P.keyboard.type("renko");await P.keyboard.press("Enter");
assert.strictEqual(await P.evaluate(()=>S.chart.type),"renko");
await P.evaluate(()=>vtSetChartType("candles"));
assert.deepStrictEqual(h.offOrigin,[],"no non-origin requests");
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("chart-types: ok");await h.close();
})().catch(e=>{console.error(e);process.exit(1)});
