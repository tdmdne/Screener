// Mini-chart mode: toggle, same symbols/order as the table page, values from the candle store, live tick redraws only the
// changed card, interval switch + loading state, opens the chart, persists, phone layout, axe clean, fast, no new sockets.
const {launch}=require("./harness");const assert=require("assert");const fs=require("fs");const path=require("path");
const AXE=fs.readFileSync(path.join(__dirname,"../node_modules/axe-core/axe.min.js"),"utf8");
const axe=async(P,ctx)=>{await P.evaluate(AXE);return P.evaluate(async c=>(await axe.run(c||document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}})).violations.map(v=>v.id+" x"+v.nodes.length+" "+v.nodes[0].target.join(" ")),ctx)};
const ready=async P=>{await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"))};
(async()=>{let h=await launch({viewport:{width:1440,height:900}});let P=h.page;await P.goto(h.app);await ready(P);
await P.evaluate(()=>{window.__ws=__edge.sockets.length;window.__w=VT_EDGE.ws;go("screener");S.mkt="CRY";render()});await P.waitForTimeout(300);
assert.strictEqual(await P.getAttribute("#minib","aria-pressed"),"false");
await P.click("#minib");await P.waitForTimeout(400);
// the edge client only fetches candles for the active chart (card data is server-side, Task 13): merge the history /api/candles would return
await P.evaluate(()=>{for(const s of PGL.slice(0,MINI.lim)){const r=symOf(s);vtSetServerBars(s+"|"+S.mini.tf,__edge.bars(S.mini.tf,r[2],60,s))}miniSync(true)});await P.waitForTimeout(300);
// 1) same symbols, same order as the table page; table hidden
let st=await P.evaluate(()=>({on:document.documentElement.classList.contains("vt-mini"),tHidden:getComputedStyle(document.getElementById("t")).display==="none",cards:[...document.querySelectorAll("#vtmini .mc")].map(b=>b.dataset.s),pgl:PGL.slice(0,MINI.lim),pressed:document.getElementById("minib").getAttribute("aria-pressed")}));
assert(st.on&&st.tHidden&&st.pressed==="true");assert.deepStrictEqual(st.cards,st.pgl);assert(st.cards.length>=5);
// continuous desktop list: cards come in batches; Show more adds the next batch
{const mm=await P.evaluate(()=>({all:PGL.length,lim:MINI.lim,btn:(document.querySelector("#vtmini .mcmore")||{}).textContent||""}));
 if(mm.all>mm.lim){assert(/Show more \(48 of \d+\)/.test(mm.btn),"show more "+mm.btn);await P.click("#vtmini .mcmore");await P.waitForTimeout(300);
  const n=await P.evaluate(()=>document.querySelectorAll("#vtmini .mc").length);assert.strictEqual(n,Math.min(96,mm.all));await P.evaluate(()=>{MINI.lim=48;miniSync(true)})}}
// 2) values: price and change over the shown bars; the canvas is drawn
await P.waitForFunction(()=>document.querySelectorAll("#vtmini .mc:not(.na)").length>=3,null,{timeout:15000});
let chk=await P.evaluate(()=>{miniSync(false);miniFlush();const bad=[];let n=0;document.querySelectorAll("#vtmini .mc:not(.na)").forEach(b=>{const s=symOf(b.dataset.s),B=candles(s,S.mini.tf).slice(-48),pc=(B[B.length-1].c/(B[0].o!=null?B[0].o:B[0].c)-1)*100;n++;
  const exp=(pc>0?"+":pc<0?"\u2212":"")+Math.abs(pc).toFixed(2)+"%";if(b.querySelector(".mcc").textContent!==exp)bad.push(b.dataset.s+" chg "+b.querySelector(".mcc").textContent+" vs "+exp);
  if(b.querySelector(".mcp").textContent!==fp(s[2]))bad.push(b.dataset.s+" px");
  const c=b.querySelector("canvas"),d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;let ink=0;for(let i=3;i<d.length;i+=4)if(d[i])ink++;if(ink<50)bad.push(b.dataset.s+" blank canvas");
  if(!/Opens the chart/.test(b.getAttribute("aria-label")))bad.push(b.dataset.s+" label")});return{n,bad}});
assert.deepStrictEqual(chk.bad,[]);assert(chk.n>=3);
await P.screenshot({path:__dirname+"/../shots/17_minicharts.png"});
// 3) a live tick redraws only that card
const sym=await P.evaluate(()=>document.querySelector("#vtmini .mc:not(.na)").dataset.s);
await P.evaluate(()=>{window.__dr=[];const o=miniDraw;miniDraw=function(el,s){__dr.push(s[0]);return o.apply(this,arguments)}});
/* background loads finishing (e.g. failed forex fetches) can legitimately redraw every card; wait for the queues to settle and retry a busy window */
let dr;for(let tr=0;tr<4;tr++){await P.waitForFunction(()=>QE.length===0&&!Object.keys(PEND).length,null,{timeout:20000}).catch(()=>{});await P.waitForTimeout(300);
const cset=await P.evaluate(s=>{window.__dr=[];const x=symOf(s),c=x[2]*1.02;for(const k in LIVE)if(k.startsWith(s+"|")){const b=LIVE[k][LIVE[k].length-1];if(b){b.c=c;b.h=Math.max(b.h,c)}}
  __edge.quotes([{s,c}]);render();return fp(c)},sym);await P.waitForTimeout(150);
dr=await P.evaluate(s=>({dr:__dr,px:document.querySelector(`#vtmini .mc[data-s="${s}"] .mcp`).textContent,exp:fp(symOf(s)[2])}),sym);dr.set=cset;if(dr.dr.length<=3)break}
assert(dr.dr.includes(sym),"ticked card redrawn");assert(dr.dr.length<=3,"only changed cards redraw: "+dr.dr.join(","));/* the periodic 24h ticker refresh can replace the price between the draw and this read */assert(dr.px===dr.exp||dr.px===dr.set,JSON.stringify({sym,dr}));
// 4) the list changes -> cards follow; 5) interval switch shows loading state and queues candles
await P.evaluate(()=>{S.mkt="ALL";render()});await P.waitForTimeout(200);
st=await P.evaluate(()=>({cards:[...document.querySelectorAll("#vtmini .mc")].map(b=>b.dataset.s),pgl:PGL.slice(0,MINI.lim)}));assert.deepStrictEqual(st.cards,st.pgl);
await P.evaluate(()=>{S.mkt="CRY";render()});
await P.click('#vtmini .minitf button[data-tf="15m"]');await P.waitForTimeout(200);
st=await P.evaluate(()=>({tf:S.mini.tf,pressed:document.querySelector('#vtmini .minitf button[data-tf="15m"]').getAttribute("aria-pressed"),na:document.querySelectorAll("#vtmini .mc.na").length,lbl:(document.querySelector("#vtmini .mc.na .mcw")||{}).textContent||""}));
assert.strictEqual(st.tf,"15m");assert.strictEqual(st.pressed,"true");if(st.na)assert(/Loading 15m candles/.test(st.lbl),st.lbl);
await P.click('#vtmini .minitf button[data-tf="1H"]');await P.waitForTimeout(300);
// 6) a card opens the chart (keyboard)
const tgt=await P.evaluate(()=>document.querySelectorAll("#vtmini .mc")[1].dataset.s);await P.focus(`#vtmini .mc[data-s="${tgt}"]`);await P.keyboard.press("Enter");await P.waitForTimeout(150);
assert.strictEqual(await P.evaluate(()=>S.chart.sym),tgt);
// 7) axe on the grid; 8) cost and sockets
await P.evaluate(()=>go("screener"));await P.waitForTimeout(400);
let v=await axe(P,"#vtmini");assert.deepStrictEqual(v,[],"axe: "+v.join(" | "));
await P.evaluate(()=>{window.__ws=__edge.sockets.length;window.__w=VT_EDGE.ws});
const perf=await P.evaluate(async s=>{const t=[];for(let i=0;i<40;i++){const x=symOf(s);__edge.quotes([{s,c:x[2]*(i%2?1.001:.999)}]);const a=performance.now();render();miniFlush();t.push(performance.now()-a);await new Promise(r=>requestAnimationFrame(r))}t.sort((a,b)=>a-b);return{med:t[20],ws:__edge.sockets.length===__ws&&VT_EDGE.ws===__w}},sym);
console.log("render+mini ms",JSON.stringify(perf));assert(perf.ws,"no new sockets");assert(perf.med<16,"median "+perf.med);
// 9) persists across reload; turning it off restores the table
await P.evaluate(()=>save());await P.reload();await ready(P);await P.evaluate(()=>{go("screener");render()});await P.waitForTimeout(400);
assert.strictEqual(await P.evaluate(()=>!!document.getElementById("vtmini")&&S.mini.on),true,"persists");
await P.click("#minib");await P.waitForTimeout(150);
st=await P.evaluate(()=>({grid:!!document.getElementById("vtmini"),t:getComputedStyle(document.getElementById("t")).display,on:S.mini.on}));assert.deepStrictEqual(st,{grid:false,t:st.t==="none"?"x":st.t,on:false});
console.log("errors",h.errors);assert.deepStrictEqual(h.errors,[]);await h.close();
// 10) light theme axe + phone layout
h=await launch({viewport:{width:1440,height:900},colorScheme:"light"});P=h.page;await P.goto(h.app);await ready(P);await P.evaluate(()=>{go("screener");S.mkt="CRY";miniToggle(true);render()});await P.waitForTimeout(600);
v=await axe(P,"#vtmini");assert.deepStrictEqual(v,[],"light axe: "+v.join(" | "));await h.close();
h=await launch({viewport:{width:390,height:844},mobile:true});P=h.page;await P.goto(h.app);await ready(P);await P.evaluate(()=>{go("screener");S.mkt="CRY";miniToggle(true);render()});await P.waitForTimeout(800);
const ph=await P.evaluate(()=>{const c=[...document.querySelectorAll("#vtmini .mc")].map(b=>b.getBoundingClientRect());return{n:c.length,cols:new Set(c.map(r=>Math.round(r.left))).size,over:c.filter(r=>r.right>innerWidth+1).length,sw:document.documentElement.scrollWidth<=innerWidth+1}});
assert(ph.n>=4&&ph.cols===2&&ph.over===0&&ph.sw,JSON.stringify(ph));
await P.waitForFunction(()=>document.querySelectorAll("#vtmini .mc:not(.na)").length>=4,null,{timeout:15000}).catch(()=>{});
const cw=await P.evaluate(()=>[...document.querySelectorAll("#vtmini .mc")].map(b=>b.querySelector("canvas").getBoundingClientRect().width/b.getBoundingClientRect().width));assert(cw.every(r=>r>0.85),"canvas fills the card: "+cw.map(r=>r.toFixed(2)));
await P.evaluate(()=>document.getElementById("vtmini").scrollIntoView());await P.screenshot({path:__dirname+"/../shots/m/390_minicharts.png"});
assert.deepStrictEqual(h.errors,[]);await h.close();
console.log("MINICHARTS OK");process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});
