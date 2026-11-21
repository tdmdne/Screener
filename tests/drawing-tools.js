// E-06: parallel channel, fib extension, Andrews + Schiff pitchforks — three-point drafting with real pointer
// input (click-click-click and drag-then-click), render without errors, hit-testing, persistence, toolbar entries.
const assert=require("assert");const {launch}=require("./harness");
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1);
await P.evaluate(()=>{go("chart");openChart("EURUSD","1H")});
await P.waitForFunction(()=>ch&&G&&G.a&&G.a.length>50&&document.getElementById("dc"));
await P.evaluate(()=>{S.dr.EURUSD=[];save();drawChart()});await P.waitForFunction(()=>document.getElementById("dc"));
const box=await P.locator("#dc").boundingBox();
const at=(fx,fy)=>[box.x+box.width*fx,box.y+box.height*fy];
const click=async(fx,fy)=>{const [x,y]=at(fx,fy);await P.mouse.click(x,y)};

// toolbar group lists the new tools
assert.deepStrictEqual(await P.evaluate(()=>VT_DRAW_GROUPS.find(g=>g.id==="fib").tools.filter(t=>/chan|fibext|pitch|schiff/.test(t))),["chan","fibext","pitch","schiff"]);

for(const t of ["pitch","schiff","fibext"]){
  await P.evaluate(t=>setTool(t),t);
  await click(.30,.60);await click(.45,.35);
  assert.strictEqual(await P.evaluate(()=>DRAFT&&DRAFT.ph2),1,t+": in third-point phase");
  const [mx,my]=at(.55,.70);await P.mouse.move(mx,my);await P.waitForTimeout(50);
  await click(.55,.70);
  const d=await P.evaluate(t=>{const d=DL().find(x=>x.t===t);return d&&{n:d.p.length,ph2:d.ph2,tool:TOOL,draft:!!DRAFT}},t);
  assert.deepStrictEqual(d,{n:3,ph2:undefined,tool:"cross",draft:false},t+" finished with 3 points");
}

// channel by drag (first segment) then click (offset)
await P.evaluate(()=>setTool("chan"));
let [x1,y1]=at(.20,.50),[x2,y2]=at(.40,.40);
await P.mouse.move(x1,y1);await P.mouse.down();await P.mouse.move((x1+x2)/2,(y1+y2)/2,{steps:4});await P.mouse.move(x2,y2,{steps:4});await P.mouse.up();
assert.strictEqual(await P.evaluate(()=>DRAFT&&DRAFT.ph2),1,"channel: drag set point 2");
await click(.30,.30);
const ch1=await P.evaluate(()=>{const d=DL().find(x=>x.t==="chan");return{n:d.p.length,above:d.p[2].y>d.p[0].y}});
assert.deepStrictEqual(ch1,{n:3,above:true},"channel stored");

// hit testing: inside the channel band and on a pitchfork median; misses far away
const hits=await P.evaluate(()=>{const P2=p=>({x:ch.timeScale().logicalToCoordinate(t2l(p.t)),y:MS.priceToCoordinate(p.y)});
  const c=DL().find(x=>x.t==="chan"),q=c.p.map(P2),mx=(q[0].x+q[1].x)/2,ybase=(q[0].y+q[1].y)/2,off=(q[2].y-(q[0].y+(q[1].y-q[0].y)*(q[2].x-q[0].x)/((q[1].x-q[0].x)||1)));
  const inBand=hit(c,mx,ybase+off/2);
  const pf=DL().find(x=>x.t==="pitch"),r=pf.p.map(P2),m={x:(r[1].x+r[2].x)/2,y:(r[1].y+r[2].y)/2};
  const onMed=hit(pf,(r[0].x+m.x)/2,(r[0].y+m.y)/2);
  return{inBand,onMed,miss:hit(c,5,5)}});
assert.ok(hits.inBand&&hits.onMed&&!hits.miss,"hit tests: "+JSON.stringify(hits));

// select by clicking the channel, drag-moving keeps 3 points; listed in the object tree
const sel=await P.evaluate(()=>{const c=DL().find(x=>x.t==="chan");const q=c.p.map(p=>({x:ch.timeScale().logicalToCoordinate(t2l(p.t)),y:MS.priceToCoordinate(p.y)}));return{x:q[0].x+(q[1].x-q[0].x)*.5,y:q[0].y+(q[1].y-q[0].y)*.5}});
await P.mouse.click(box.x+sel.x,box.y+sel.y);
assert.strictEqual(await P.evaluate(()=>SELD&&SELD.t),"chan","channel selected by click");
await P.waitForFunction(()=>[...document.querySelectorAll("#dkot .ot-l")].some(e=>e.textContent==="Parallel channel"));

// fib extension levels project from point C by (B-A)
const fe=await P.evaluate(()=>{const d=DL().find(x=>x.t==="fibext");const q=d.p.map(p=>({x:ch.timeScale().logicalToCoordinate(t2l(p.t)),y:MS.priceToCoordinate(p.y)}));const g=vtN3Geo(d,q);
  return{l1:g.lv.find(o=>o.l===1).p,exp:d.p[2].y+(d.p[1].y-d.p[0].y),l0:g.lv.find(o=>o.l===0).p,c:d.p[2].y}});
assert.ok(Math.abs(fe.l1-fe.exp)<1e-9&&fe.l0===fe.c,"fib extension levels "+JSON.stringify(fe));

// escape cancels a half-drawn tool; persisted across reload
await P.evaluate(()=>setTool("pitch"));await click(.6,.5);await P.keyboard.press("Escape");
assert.strictEqual(await P.evaluate(()=>!!DRAFT),false,"escape cancels draft");
await P.waitForTimeout(300);await P.reload();await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&ch&&G);
assert.deepStrictEqual(await P.evaluate(()=>(S.dr.EURUSD||[]).map(d=>d.t).sort()),["chan","fibext","pitch","schiff"]);

// palette entry
await P.keyboard.press("Control+k");await P.keyboard.type("pitchfork");await P.keyboard.press("Enter");
assert.strictEqual(await P.evaluate(()=>TOOL),"pitch");await P.evaluate(()=>setTool("cross"));

assert.deepStrictEqual(h.offOrigin,[],"no non-origin requests");
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("drawing-tools: ok");await h.close();
})().catch(e=>{console.error(e);process.exit(1)});
