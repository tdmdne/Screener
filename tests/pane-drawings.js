// E-05b: drawings mirrored onto layout panes (same per-symbol drawings, each pane's own timeframe), toggleable,
// read-only overlay, main chart globals restored after each pane paint.
const assert=require("assert");const {launch}=require("./harness");
// count pixels of a given colour on a pane's overlay canvas
const px=(P,sel,rgb)=>P.evaluate(([sel,rgb])=>{const c=document.querySelector(sel+" canvas.vt-pdc");if(!c)return -1;const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;let n=0;
  for(let i=0;i<d.length;i+=4)if(d[i+3]>150&&Math.abs(d[i]-rgb[0])<30&&Math.abs(d[i+1]-rgb[1])<30&&Math.abs(d[i+2]-rgb[2])<30)n++;return n},[sel,rgb]);
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1&&SYMS.some(s=>s[0]==="GBPUSD"));
await P.evaluate(()=>{S.dr={};S.sc.syncSym=true;S.sc.syncTf=false;S.sc.syncDr=true;go("chart");openChart("EURUSD","1H");vtSetLayout(3)});
await P.waitForFunction(()=>VT_LAY.panes.length===2&&VT_LAY.panes.every(p=>p.ch&&p.B),null,{timeout:15000});

// a magenta trend line + horizontal line on EURUSD (main chart data)
await P.evaluate(()=>{const a=G.a,lo=Math.min(...a.slice(-60).map(b=>b.l)),hi=Math.max(...a.slice(-60).map(b=>b.h));
  DL().push({id:1,t:"trend",p:[{t:a[a.length-60].t,y:lo},{t:a[a.length-5].t,y:hi}],c:"#ff00ff",w:3,s:0});
  DL().push({id:2,t:"hline",p:[{t:a[a.length-30].t,y:(lo+hi)/2}],c:"#ff00ff",w:3,s:0});save()});
await P.waitForTimeout(400);
const n0=await px(P,"#sc2 .lay-cell:nth-child(1)","255,0,255".split(",").map(Number));
const n1=await px(P,"#sc2 .lay-cell:nth-child(2)",[255,0,255]);
assert.ok(n0>150&&n1>150,"drawings painted on both panes: "+[n0,n1]);
assert.strictEqual(await P.evaluate(()=>document.querySelector("#sc2 canvas.vt-pdc").style.pointerEvents),"none","read-only overlay");
assert.ok(await P.evaluate(()=>G.a===LIVE["EURUSD|1H"]||G.a.length===LIVE["EURUSD|1H"].length),"main G restored");
assert.ok(await P.evaluate(()=>ch&&MS&&ch!==VT_LAY.panes[0].ch&&MS!==VT_LAY.panes[0].ser),"main ch/MS restored");

// a pane on another symbol shows that symbol's drawings only
await P.evaluate(()=>{S.sc.syncSym=false;S.sc.cells[1].sym="GBPUSD";save();vtLayRender(true)});
await P.waitForFunction(()=>VT_LAY.panes[1]&&VT_LAY.panes[1].sym==="GBPUSD"&&VT_LAY.panes[1].ch&&VT_LAY.panes[1].B,null,{timeout:15000});
await P.waitForTimeout(300);
assert.strictEqual(await px(P,"#sc2 .lay-cell:nth-child(2)",[255,0,255]),0,"GBPUSD pane has no EURUSD drawings");
await P.evaluate(()=>{const B=VT_LAY.panes[1].B.a;S.dr.GBPUSD=[{id:9,t:"hline",p:[{t:B[B.length-10].t,y:B[B.length-10].c}],c:"#00ffff",w:3,s:0}];save()});
await P.waitForTimeout(300);
assert.ok(await px(P,"#sc2 .lay-cell:nth-child(2)",[0,255,255])>100,"GBPUSD pane shows GBPUSD drawing");

// hidden drawings and the toggle
await P.evaluate(()=>{S.dr.EURUSD[0].hide=true;S.dr.EURUSD[1].hide=true});await P.waitForTimeout(250);
assert.strictEqual(await px(P,"#sc2 .lay-cell:nth-child(1)",[255,0,255]),0,"hidden drawings not mirrored");
await P.evaluate(()=>{S.dr.EURUSD.forEach(d=>delete d.hide)});
await P.click('#sc2 .lay-bar label.lay-dr input');await P.waitForTimeout(250);
assert.strictEqual(await P.evaluate(()=>S.sc.syncDr),false);
assert.strictEqual(await px(P,"#sc2 .lay-cell:nth-child(1)",[255,0,255]),0,"toggle off clears panes");
await P.click('#sc2 .lay-bar label.lay-dr input');await P.waitForTimeout(250);
assert.ok(await px(P,"#sc2 .lay-cell:nth-child(1)",[255,0,255])>150,"toggle on again");

// drawing on the main chart still works while panes paint (globals restored)
const box=await P.locator("#dc").boundingBox();await P.evaluate(()=>setTool("hline"));
await P.mouse.click(box.x+box.width*.5,box.y+box.height*.4);
assert.strictEqual(await P.evaluate(()=>DL().filter(d=>d.t==="hline").length),2,"new main-chart drawing");

assert.deepStrictEqual(h.offOrigin,[],"no non-origin requests");
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("pane-drawings: ok");await h.close();
})().catch(e=>{console.error(e);process.exit(1)});
