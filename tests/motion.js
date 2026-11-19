// Motion: page transitions, tick flashes (screener table, chart price), heatmap tile fade-in, skeleton shimmer on loading
// placeholders, dialog/sheet entrances; all off under reduced motion; no new sockets; render cost stays small.
const {launch}=require("./harness");const assert=require("assert");
const ready=async P=>{await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"))};
const anims=(P,sel)=>P.evaluate(s=>{const e=document.querySelector(s);return e?e.getAnimations().map(a=>a.animationName):null},sel);
// a tick as the feeds deliver it: the ticker price plus the forming candle close (the kline stream does the latter)
const tick=(P,sym,f)=>P.evaluate(([sym,f])=>{const s=symOf(sym),c=s[2]*f;for(const k in LIVE)if(k.startsWith(sym+"|")){const b=LIVE[k][LIVE[k].length-1];if(b){b.c=c;b.h=Math.max(b.h,c);b.l=Math.min(b.l,c)}}
  BNWS.ws.onmessage({data:JSON.stringify([{s:sym,c:String(c),h:String(c*1.001),l:String(c*.999)}])});return s[2]},[sym,f]);
(async()=>{let h=await launch({viewport:{width:1440,height:900}});let P=h.page;await P.goto(h.base+"#/workspace");await ready(P);
await P.evaluate(()=>{window.__ws=__WS.length;window.__w=BNWS.ws});
// 1) page transitions
await P.evaluate(()=>go("calc"));await P.waitForTimeout(30);
assert.deepStrictEqual(await anims(P,"#pv-calc"),["vtPageIn"],"calc page enters with vtPageIn");
await P.waitForTimeout(700);assert.strictEqual(await P.evaluate(()=>document.getElementById("pv-calc").classList.contains("vt-pgin")),false,"class cleaned up");
await P.evaluate(()=>go("workspace"));await P.waitForTimeout(30);
assert.deepStrictEqual(await anims(P,".wrap>.ws"),["vtFade"],"workspace fades (no transform on the chart area)");
// 2) tick flash in the screener table, continued across re-renders, then gone
await P.evaluate(()=>{S.mkt="CRY";S.q="";render()});await P.waitForTimeout(200);
const sym=await P.evaluate(()=>{const r=[...document.querySelectorAll("#t tbody tr[data-s]")].find(r=>/USDT$/.test(r.dataset.s));return r&&r.dataset.s});assert(sym,"a crypto row is visible");
await tick(P,sym,1.03);await P.evaluate(()=>render());
let fl=await P.evaluate(s=>[...document.querySelectorAll(`#t tr[data-s="${s}"] td`)].filter(td=>td.classList.contains("vt-fu")||td.classList.contains("vt-fd")).map(td=>td.className),sym);
assert(fl.length>=1&&fl.some(c=>/vt-fu/.test(c)),"price up flashes green: "+JSON.stringify(fl));
await P.waitForTimeout(300);await P.evaluate(()=>render());
const cont=await P.evaluate(s=>{const td=[...document.querySelectorAll(`#t tr[data-s="${s}"] td`)].find(td=>td.classList.contains("vt-fu"));return td?parseInt(td.style.animationDelay):null},sym);
assert(cont!=null&&cont<=-250,"flash continues after a re-render with a negative delay: "+cont);
await P.waitForTimeout(800);await P.evaluate(()=>render());
const old=await P.evaluate(()=>[...document.querySelectorAll("#t .vt-fu,#t .vt-fd")].map(td=>parseInt(td.style.animationDelay)).filter(d=>d<=-900));
assert.deepStrictEqual(old,[],"flashes end after 0.9s (other cells may be flashing from new ticks)");
await tick(P,sym,0.97);await P.evaluate(()=>render());
assert(await P.evaluate(s=>!!document.querySelector(`#t tr[data-s="${s}"] td.vt-fd`),sym),"price down flashes red");
// 3) chart header price flash (feed writes #cpx; we only watch it)
await P.evaluate(()=>openChart("BTCUSDT"));await P.waitForTimeout(400);
await tick(P,"BTCUSDT",1.01);await P.waitForTimeout(400);
assert(await P.evaluate(()=>{const q=document.getElementById("cpx");return !!q&&q.classList.contains("vt-fu")}),"chart price flashes on tick");
// 4) heatmap tiles fade in with a sweep, then the class is removed
await P.evaluate(()=>go("heatmap"));await P.waitForTimeout(40);
const hm=await P.evaluate(()=>{const t=[...document.querySelectorAll(".hmt")];return{n:t.length,vin:t.filter(b=>b.classList.contains("vt-in")).length,names:[...new Set(t.flatMap(b=>b.getAnimations().map(a=>a.animationName)))],delays:new Set(t.map(b=>b.style.getPropertyValue("--d"))).size}});
assert(hm.n>10&&hm.vin===hm.n&&hm.names.includes("vtTileIn")&&hm.delays>3,JSON.stringify(hm));
await P.waitForTimeout(1200);assert.strictEqual(await P.evaluate(()=>document.querySelectorAll(".hmt.vt-in").length),0);
// 5) skeleton shimmer on a loading placeholder
const sk=await P.evaluate(()=>{go("workspace");const cv=document.getElementById("cv");cv.innerHTML='<p class="mut vt-skel" role="status">Loading candles\u2026</p>';const p=document.querySelector("#cv .vt-skel");
  return p?{role:p.getAttribute("role"),txt:p.textContent,anim:getComputedStyle(p,"::before").animationName}:"none"});
assert(sk&&sk!=="none"&&sk.role==="status"&&/Loading/.test(sk.txt)&&sk.anim==="vtShim",JSON.stringify(sk));
// 6) dialog entrance
await P.evaluate(()=>modal("<h3>Test</h3><p>hello</p>"));await P.waitForTimeout(20);
assert.deepStrictEqual(await anims(P,"#md .ov .box")||await anims(P,".ov .box"),["vtDlgIn"]);await P.evaluate(()=>closeM());
// 7) cost: 60 ticks + renders stay fast; no new sockets
await P.evaluate(()=>{go("workspace")});await P.waitForTimeout(500);await P.evaluate(()=>{window.__ws=__WS.length;window.__w=BNWS.ws});
const perf=await P.evaluate(async s=>{const t=[];for(let i=0;i<60;i++){const x=symOf(s);BNWS.ws.onmessage({data:JSON.stringify([{s,c:String(x[2]*(i%2?1.001:.999)),h:String(x[2]*1.01),l:String(x[2]*.99)}])});const a=performance.now();render();t.push(performance.now()-a);await new Promise(r=>requestAnimationFrame(r))}
  t.sort((a,b)=>a-b);return{med:t[30],p95:t[57],ws:__WS.length===__ws&&BNWS.ws===__w}},sym);
console.log("render ms",JSON.stringify(perf));assert(perf.ws,"no new sockets");assert(perf.med<12,"render median "+perf.med);
console.log("errors",h.errors);assert.deepStrictEqual(h.errors,[]);await h.close();
// 8) phone: dialogs come up as sheets
h=await launch({viewport:{width:390,height:844},mobile:true});P=h.page;await P.goto(h.base+"#/workspace");await ready(P);
await P.evaluate(()=>modal("<h3>Test</h3>"));await P.waitForTimeout(20);assert.deepStrictEqual(await anims(P,".ov .box"),["vtSheetIn"]);
assert.deepStrictEqual(h.errors,[]);await h.close();
// 9) reduced motion: nothing animates, no flash classes
h=await launch({viewport:{width:1440,height:900},reducedMotion:"reduce"});P=h.page;await P.goto(h.base+"#/workspace");await ready(P);
await P.evaluate(()=>go("calc"));await P.waitForTimeout(30);
assert.strictEqual(await P.evaluate(()=>document.getElementById("pv-calc").classList.contains("vt-pgin")),false);
await P.evaluate(()=>{go("workspace");S.mkt="CRY";render()});
const s2=await P.evaluate(()=>{const r=[...document.querySelectorAll("#t tbody tr[data-s]")].find(r=>/USDT$/.test(r.dataset.s));return r&&r.dataset.s});
await tick(P,s2,1.05);await P.evaluate(()=>render());
assert.strictEqual(await P.evaluate(()=>document.querySelectorAll("#t .vt-fu,#t .vt-fd").length),0);
await P.evaluate(()=>go("heatmap"));await P.waitForTimeout(40);
assert.strictEqual(await P.evaluate(()=>document.querySelectorAll(".hmt.vt-in").length),0);
await P.evaluate(()=>modal("<h3>Test</h3>"));
const rd=await P.evaluate(()=>parseFloat(getComputedStyle(document.querySelector(".ov .box")).animationDuration));assert(rd<0.01,"dialog duration "+rd);
assert.deepStrictEqual(h.errors,[]);await h.close();
console.log("MOTION OK");process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});
