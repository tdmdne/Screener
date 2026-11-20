// Phones (375x812, 390x844, touch): bottom tab bar + More sheet, no horizontal page scroll on any page, 44px targets,
// tables scroll in their own box, touch chart (pan, pinch, long-press crosshair), "+" by tap, alert line drag by touch,
// bottom-sheet editor, drawing tools via pointer events (drag-draw and tap-tap), WebSockets untouched.
const {launch}=require("./harness");const assert=require("assert");
const PAGES=["workspace","chart","screener","heatmap","calendar","journal","calc","backtest"];
async function run(W,H){const h=await launch({viewport:{width:W,height:H},mobile:true});const P=h.page;await P.goto(h.base+"#/workspace");
await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));await P.evaluate(()=>{S.alerts=[];S.dr={};save();openChart("BTCUSDT","1H")});
await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]);await P.waitForTimeout(800);
assert.strictEqual(await P.evaluate(()=>document.documentElement.dataset.ui),"phone");
const ws0=await P.evaluate(()=>{window.__w0=VT_EDGE.ws;return __edge.sockets.length});
// 1) no horizontal page scroll on any page (with the safety clip switched off so real overflow shows)
const pages=[...PAGES,"legal/privacy","legal/your-data"];
for(const p of pages){await P.evaluate(p=>{location.hash="#/"+p},p);await P.waitForTimeout(500);
  const o=await P.evaluate(()=>{const w=document.querySelector(".wrap");w.style.overflowX="visible";const W=document.documentElement.clientWidth,sw=document.documentElement.scrollWidth;
    const bad=[];document.querySelectorAll(".wrap *").forEach(e=>{const r=e.getBoundingClientRect();if(r.width&&r.right>W+1){let a=e.parentElement,inScroll=false;while(a&&a!==w){const c=getComputedStyle(a);if(/(auto|scroll|hidden|clip)/.test(c.overflowX)&&a.getBoundingClientRect().right<=W+1){inScroll=true;break}a=a.parentElement}if(!inScroll)bad.push(e.tagName+"#"+e.id+"."+String(e.className).slice(0,20))}});
    w.style.overflowX="";return{sw,W,bad:bad.slice(0,5)}});
  assert(o.sw<=o.W&&!o.bad.length,p+" overflows "+JSON.stringify(o));}
console.log(W,"no horizontal overflow on",pages.length,"pages");
// legal tables scroll inside their own container
const tb=await P.evaluate(()=>{location.hash="#/legal/privacy";return new Promise(r=>setTimeout(()=>{const t=document.querySelector("#pv-legal .ftbl");const c=getComputedStyle(t);r({ox:c.overflowX,fits:t.getBoundingClientRect().right<=document.documentElement.clientWidth+1})},400))});
assert(tb.ox==="auto"&&tb.fits,JSON.stringify(tb));
// 2) bottom tab bar + More sheet
const nav=await P.evaluate(()=>{const n=document.getElementById("vnav"),r=n.getBoundingClientRect();return{pos:getComputedStyle(n).position,bottom:Math.round(r.bottom),vis:[...n.querySelectorAll("a,button")].filter(a=>a.offsetParent).map(a=>[a.dataset.p||a.id,Math.round(a.getBoundingClientRect().height)])}});
console.log("nav",JSON.stringify(nav));assert.strictEqual(nav.pos,"fixed");assert(Math.abs(nav.bottom-H)<=1);assert.strictEqual(nav.vis.length,5);assert(nav.vis.every(v=>v[1]>=44));
await P.tap("#vnmore");await P.waitForSelector("#vmore");await P.waitForTimeout(300);await P.screenshot({path:`shots/m/${W}_more.png`});
await P.tap('#vmore a[href="#/heatmap"]');await P.waitForTimeout(300);assert.strictEqual(await P.evaluate(()=>document.documentElement.dataset.page),"heatmap");
assert.strictEqual(await P.$("#vmore"),null);assert(await P.evaluate(()=>document.getElementById("vnmore").classList.contains("on")));
await P.tap('#vnav a[data-p="chart"]');await P.waitForTimeout(900);
// 3) 44px targets on the main controls
const small=await P.evaluate(()=>{const sel="header button,header input,#vnav a,#vnav button,.tbar button,.tfs .chip,.cpb .row.top button,.cpb .row.top a.btn";
  return[...document.querySelectorAll(sel)].filter(e=>e.offsetParent&&e.getBoundingClientRect().height<43.5).map(e=>(e.textContent||e.title||e.id).trim().slice(0,12)+":"+Math.round(e.getBoundingClientRect().height))});
assert.deepStrictEqual(small,[],"small targets "+small);
// 4) touch chart: one-finger pan, pinch zoom, long-press crosshair
const cdp=await P.context().newCDPSession(P);const touch=(type,pts)=>cdp.send("Input.dispatchTouchEvent",{type,touchPoints:pts.map(([x,y],i)=>({x,y,id:i}))});
const box=await P.locator("#cv").boundingBox();const pw=await P.evaluate(()=>ch.timeScale().width());const cy=box.y+box.height*0.45;
const rng=()=>P.evaluate(()=>{const r=ch.timeScale().getVisibleLogicalRange();return[r.from,r.to]});
let r0=await rng();await touch("touchStart",[[box.x+pw*0.7,cy]]);for(let i=1;i<=8;i++){await touch("touchMove",[[box.x+pw*0.7-i*15,cy]]);await P.waitForTimeout(16)}await touch("touchEnd",[]);await P.waitForTimeout(500);
let r1=await rng();console.log("pan",r0.map(Math.round),"->",r1.map(Math.round));assert(r1[0]>r0[0]+2,"pan moved the chart");
r0=r1;await touch("touchStart",[[box.x+pw*0.45,cy],[box.x+pw*0.55,cy]]);for(let i=1;i<=8;i++){await touch("touchMove",[[box.x+pw*0.45-i*10,cy],[box.x+pw*0.55+i*10,cy]]);await P.waitForTimeout(16)}await touch("touchEnd",[]);await P.waitForTimeout(400);
r1=await rng();console.log("pinch width",Math.round(r0[1]-r0[0]),"->",Math.round(r1[1]-r1[0]));assert(r1[1]-r1[0]<(r0[1]-r0[0])*0.9,"pinch zoomed in");
// long-press -> crosshair, "+" follows it on the price scale; tap "+" -> add alert
const ly=box.y+box.height*0.35;await touch("touchStart",[[box.x+pw*0.5,ly]]);await P.waitForTimeout(700);await touch("touchEnd",[]);await P.waitForTimeout(300);
const plus=P.locator("#cv .vplus");assert(await plus.isVisible(),"+ visible after long-press");const pb=await plus.boundingBox();assert(pb.height>=29);
const pyy=await P.evaluate(()=>parseFloat(document.querySelector("#cv .vplus").style.top)+15);assert(Math.abs(box.y+pyy-ly)<=2,"+ at crosshair price");
await plus.tap();await P.waitForSelector("#cv .vpmenu");await P.locator("#cv .vpmenu div",{hasText:"Add alert"}).tap();await P.waitForTimeout(300);
const al=await P.evaluate(()=>S.alerts.slice(-1)[0]);const exp=await P.evaluate(y=>vtRoundPx(symOf("BTCUSDT"),MS.coordinateToPrice(y)),pyy);console.log("tap alert",al.price,exp);assert.strictEqual(al.price,exp);
// 5) drag the alert line by touch, then open the editor as a bottom sheet
await P.evaluate(()=>{window.checkAlerts=()=>{}});await P.waitForTimeout(200);
const hb=await P.locator(`#cv .valh[data-al="${al.id}"]`).boundingBox();assert(hb.height>=24);const hx=hb.x+hb.width/2,hy=hb.y+hb.height/2;
await touch("touchStart",[[hx,hy]]);for(let i=1;i<=6;i++){await touch("touchMove",[[hx,hy+i*8]]);await P.waitForTimeout(16)}await touch("touchEnd",[]);await P.waitForTimeout(300);
const moved=await P.evaluate(([id,y])=>({p:S.alerts.find(a=>a.id===id).price,exp:vtRoundPx(symOf("BTCUSDT"),MS.coordinateToPrice(y)),n:S.alerts.length}),[al.id,hy+48-box.y]);
console.log("touch drag",JSON.stringify(moved));assert(moved.n===1&&moved.p<al.price&&Math.abs(moved.p-moved.exp)<=Math.abs(moved.exp)*2e-3);
await P.locator(`#cv .valb[data-al="${al.id}"]`).tap();await P.waitForSelector("#vae_px");await P.waitForTimeout(350);
const sheet=await P.evaluate(()=>{const b=document.querySelector(".ov .box").getBoundingClientRect();return{bottom:Math.round(b.bottom),w:Math.round(b.width)}});
assert(Math.abs(sheet.bottom-H)<=1&&sheet.w>=W-2,"editor is a bottom sheet "+JSON.stringify(sheet));
const onTop=await P.evaluate(()=>{const b=document.getElementById("vae_ok").getBoundingClientRect();const e=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return e&&e.id});assert.strictEqual(onTop,"vae_ok","Save button not covered by the tab bar");await P.screenshot({path:`shots/m/${W}_alert_sheet.png`});await P.evaluate(()=>closeM());
// 6) drawing tools via pointer events: drag-draw and tap-tap both make exactly one trend line with distinct points
await P.tap('.tbar button[data-tool="trend"]');const ax=box.x+pw*0.3,ay=box.y+box.height*0.6,bx=box.x+pw*0.6,by=box.y+box.height*0.4;
await touch("touchStart",[[ax,ay]]);for(let i=1;i<=6;i++){await touch("touchMove",[[ax+(bx-ax)*i/6,ay+(by-ay)*i/6]]);await P.waitForTimeout(16)}await touch("touchEnd",[]);await P.waitForTimeout(200);
let dl=await P.evaluate(()=>DL().filter(d=>d.t==="trend").map(d=>d.p.map(q=>[q.t,+q.y.toFixed(3)])));console.log("drag-draw",JSON.stringify(dl));
assert.strictEqual(dl.length,1);assert(dl[0][0][0]!==dl[0][1][0]&&dl[0][0][1]!==dl[0][1][1]);
await P.tap('.tbar button[data-tool="trend"]');await P.touchscreen.tap(ax,by);await P.waitForTimeout(150);await P.touchscreen.tap(bx,ay);await P.waitForTimeout(200);
dl=await P.evaluate(()=>DL().filter(d=>d.t==="trend").map(d=>d.p.map(q=>[q.t,+q.y.toFixed(3)])));console.log("tap-tap",JSON.stringify(dl[1]));
assert.strictEqual(dl.length,2);assert(dl[1][0][0]!==dl[1][1][0]&&dl[1][0][1]!==dl[1][1][1]);
await P.screenshot({path:`shots/m/${W}_chart_touch.png`});
const ws1=await P.evaluate(n=>VT_EDGE.ws===__w0&&__edge.sockets.length===n,ws0);assert(ws1,"websockets untouched");
console.log("errors",h.errors,"console",h.consoleErr);assert(!h.errors.length&&!h.consoleErr.length);assert.deepStrictEqual(h.offOrigin,[],"non-origin requests");await h.close()}
(async()=>{await run(375,812);await run(390,844);console.log("MOBILE OK")})().catch(e=>{console.error(e);process.exit(1)});
