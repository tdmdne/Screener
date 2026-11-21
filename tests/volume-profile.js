// E-11: volume profile drawn from server rows (/api/candles?vp=): visible-range toggle and fixed-range drawing tool.
const assert=require("assert");const {launch}=require("./harness");
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1&&SYMS.some(s=>s[0]==="BTCUSDT"));
await P.evaluate(()=>{S.dr.BTCUSDT=[];S.chart.vpVis=false;go("chart");openChart("BTCUSDT","1H")});
await P.waitForFunction(()=>ch&&G&&G.a&&G.a.length>50&&document.getElementById("dc"));

// visible range: palette toggle -> server request for the visible window -> rows drawn
await P.keyboard.press("Control+k");await P.keyboard.type("volume profile (visible");await P.keyboard.press("Enter");
assert.strictEqual(await P.evaluate(()=>S.chart.vpVis),true);
await P.waitForFunction(()=>Object.keys(VT_VP.cache).length>0,null,{timeout:10000});
assert.ok(h.candleCalls.some(q=>/vp=24/.test(q)&&/vpFrom=\d+/.test(q)&&/vpTo=\d+/.test(q)),"server profile requested for the visible range: "+h.candleCalls.slice(-3));
const vp=await P.evaluate(()=>{const c=Object.values(VT_VP.cache)[0].vp;return{rows:c.rows.length,total:c.total,poc:c.poc,val:c.val,vah:c.vah}});
assert.ok(vp.rows===24&&vp.total>0&&vp.val<=vp.poc&&vp.poc<=vp.vah,"profile "+JSON.stringify(vp));
// something is painted at the right edge of the plot (orange POC or profile bars)
await P.waitForTimeout(300);
const painted=await P.evaluate(()=>{const c=document.getElementById("dc"),g=c.getContext("2d"),w=c.width,hh=c.height,r=devicePixelRatio||1;
  const tw=(ch.timeScale().width()||c.clientWidth-60)*r,d=g.getImageData(Math.max(0,tw-200*r),0,Math.floor(150*r),hh).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>20)n++;return n});
assert.ok(painted>500,"profile pixels painted: "+painted);
// panning re-requests a different window (debounce-free: keyed by range)
const n0=await P.evaluate(()=>Object.keys(VT_VP.cache).length);
await P.evaluate(()=>{const ts=ch.timeScale(),r=ts.getVisibleLogicalRange();ts.setVisibleLogicalRange({from:r.from-40,to:r.to-40})});
await P.waitForFunction(n0=>Object.keys(VT_VP.cache).length>n0,n0,{timeout:10000});

// fixed range tool: two clicks -> drawing with a server profile for exactly that range
await P.evaluate(()=>vtVpToggle(false));
const box=await P.locator("#dc").boundingBox();
await P.evaluate(()=>setTool("fvp"));
await P.mouse.click(box.x+box.width*.35,box.y+box.height*.5);await P.mouse.click(box.x+box.width*.6,box.y+box.height*.5);
const d=await P.evaluate(()=>{const d=DL().find(x=>x.t==="fvp");return d&&{n:d.p.length,t1:Math.min(d.p[0].t,d.p[1].t),t2:Math.max(d.p[0].t,d.p[1].t),tool:TOOL}});
assert.ok(d&&d.n===2&&d.t2>d.t1&&d.tool==="cross","fixed range drawing "+JSON.stringify(d));
await P.waitForFunction(([a,b])=>Object.keys(VT_VP.cache).some(k=>k.endsWith("|"+Math.floor(a)+"|"+Math.ceil(b))),[d.t1,d.t2],{timeout:10000});
assert.ok(await P.evaluate(()=>!("_vp" in DL().find(x=>x.t==="fvp"))),"no profile data saved into the drawing");
await P.waitForFunction(()=>[...document.querySelectorAll("#dkot .ot-l")].some(e=>e.textContent==="Fixed range volume profile"));

// FX (no volume in the feed): a time-at-price histogram is still drawn, labelled as such
await P.evaluate(()=>{const a=LIVE["BTCUSDT|1H"];void a;openChart("EURUSD","1H");vtVpToggle(true)});
await P.waitForFunction(()=>ch&&G&&G.a&&G.a.length>50&&S.chart.sym==="EURUSD");
await P.waitForFunction(()=>Object.keys(VT_VP.cache).some(k=>k.startsWith("EURUSD|1H|")),null,{timeout:10000});
const fx=await P.evaluate(()=>{const k=Object.keys(VT_VP.cache).find(k=>k.startsWith("EURUSD|1H|"));const v=VT_VP.cache[k].vp;return{basis:v.basis,total:v.total,poc:v.poc,rows:v.rows.filter(r=>r.v>0).length}});
assert.ok(fx.total>0&&fx.rows>5&&fx.poc>0,"FX profile has a histogram: "+JSON.stringify(fx));
await P.waitForTimeout(300);
const fxPx=await P.evaluate(()=>{const c=document.getElementById("dc"),g=c.getContext("2d"),r=devicePixelRatio||1,tw=(ch.timeScale().width()||c.clientWidth-60)*r;const d=g.getImageData(Math.max(0,tw-200*r),0,Math.floor(150*r),c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>20)n++;return n});
assert.ok(fxPx>500,"FX histogram painted: "+fxPx);
await P.evaluate(()=>vtVpToggle(false));

// settings checkbox mirrors the toggle
await P.evaluate(()=>setM("all"));assert.ok(await P.$('input[data-c="vpVis"]'),"settings checkbox");await P.evaluate(()=>closeM());

assert.deepStrictEqual(h.offOrigin,[],"no non-origin requests");
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("volume-profile: ok");await h.close();
})().catch(e=>{console.error(e);process.exit(1)});
