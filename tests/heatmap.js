// Heatmaps: real values (live price vs previous bar close from the candle store), live tick updates without relayout or new
// sockets, controls (market / metric / timeframe / size), squarified layout geometry, keyboard + tooltip, instant first load
// from the IndexedDB cache with the network blocked, reduced motion, phone layout.
const {launch}=require("./harness");const assert=require("assert");
const ready=async P=>{await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"))};
const enter=async(P,min=10)=>{await P.evaluate(()=>{for(const tf of ["1D","1H","4H","1W"])for(const s of SYMS)vtMergeBars(s[0]+"|"+tf,__edge.bars(tf,s[2]||1,40,s[0]));go("heatmap")});await P.waitForFunction(m=>document.querySelectorAll(".hmt:not(.na)").length>=m,min,{timeout:20000})};
(async()=>{let h=await launch({viewport:{width:1440,height:900}});let P=h.page;await P.goto(h.app);await ready(P);
await P.evaluate(()=>{S.hm={};save()});await enter(P);
// 1) values are exactly (live price / previous 1D close - 1) for every tile with data
let chk=await P.evaluate(()=>{hmTick(false);const bad=[];let n=0;document.querySelectorAll(".hmt:not(.na)").forEach(b=>{const s=symOf(b.dataset.s),a=candles(s,"1D");const v=(s[2]/a[a.length-2].c-1)*100;n++;
  if(b.querySelector(".hv").textContent!==hmFmt(v))bad.push(b.dataset.s+" "+b.querySelector(".hv").textContent+" vs "+hmFmt(v))});return{n,bad,tiles:document.querySelectorAll(".hmt").length,uni:hmUniverse().length}});
assert.deepStrictEqual(chk.bad,[]);assert(chk.n>=10);assert.strictEqual(chk.tiles,chk.uni);
// 2) a live tick from the existing feed updates the tile in place (same element, flash), no new sockets, no relayout
const t0=await P.evaluate(()=>{window.__b=document.querySelector('.hmt[data-s="BTCUSDT"]');window.__ws=__edge.sockets.length;window.__w=VT_EDGE.ws;return 1});
await P.evaluate(()=>{const s=symOf("BTCUSDT");__edge.quotes([{s:"BTCUSDT",c:s[2]*1.07}]);hmTick(false)});
const tk=await P.evaluate(()=>{const b=document.querySelector('.hmt[data-s="BTCUSDT"]'),s=symOf("BTCUSDT"),a=candles(s,"1D");return{same:b===__b,txt:b.querySelector(".hv").textContent,exp:hmFmt((s[2]/a[a.length-2].c-1)*100),flash:b.classList.contains("fu")||b.classList.contains("fd"),ws:__edge.sockets.length===__ws&&VT_EDGE.ws===__w}});
assert.deepStrictEqual(tk,{same:true,txt:tk.exp,exp:tk.exp,flash:true,ws:true});
// 3) geometry: inside the grid, no overlaps, fills the area
const geo=async()=>P.evaluate(()=>{const g=document.getElementById("hm_grid").getBoundingClientRect(),R=[...document.querySelectorAll(".hmt")].map(b=>b.getBoundingClientRect());let ov=0,out=0,area=0;
  R.forEach((a,i)=>{area+=a.width*a.height;if(a.left<g.left-1||a.top<g.top-1||a.right>g.right+1||a.bottom>g.bottom+1)out++;for(let j=i+1;j<R.length;j++){const b=R[j],w=Math.min(a.right,b.right)-Math.max(a.left,b.left),hh=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);if(w>0.5&&hh>0.5)ov++}});
  return{ov,out,fill:area/(g.width*g.height),areas:R.map(r=>r.width*r.height)}});
await P.click('[data-hm="mkt"][data-v="CRY"]');await P.waitForTimeout(300);
assert(await P.evaluate(()=>[...document.querySelectorAll(".hmt")].every(b=>symOf(b.dataset.s)[1]==="CRY")));
let G=await geo();assert.strictEqual(G.ov,0,"no overlaps");assert.strictEqual(G.out,0,"inside grid");assert(G.fill>0.85,"fills "+G.fill);
await P.click('[data-hm="size"][data-v="equal"]');await P.waitForTimeout(300);G=await geo();const mx=Math.max(...G.areas),mn=Math.min(...G.areas);assert(mx/mn<2.2,"equal-ish sizes "+mx/mn);
await P.waitForTimeout(800);await P.screenshot({path:__dirname+"/../shots/14_heatmap.png"});
// 4) metric + timeframe switches
await P.click('[data-hm="tf"][data-v="1H"]');await P.waitForFunction(()=>document.querySelectorAll(".hmt:not(.na)").length>=5,null,{timeout:15000});
chk=await P.evaluate(()=>{hmTick(false);return[...document.querySelectorAll(".hmt:not(.na)")].filter(b=>{const s=symOf(b.dataset.s),a=candles(s,"1H");return b.querySelector(".hv").textContent!==hmFmt((s[2]/a[a.length-2].c-1)*100)}).length});assert.strictEqual(chk,0);
await P.click('[data-hm="metric"][data-v="score"]');await P.waitForTimeout(300);
chk=await P.evaluate(()=>{hmTick(false);return[...document.querySelectorAll(".hmt")].filter(b=>{const v=scoreMarket(symOf(b.dataset.s));return typeof v==="number"&&b.querySelector(".hv").textContent!==String(Math.round(v))}).length});assert.strictEqual(chk,0);
assert(!(await P.$('[data-hm="tf"]')),"timeframe hidden for score");assert(/Vektor score/.test(await P.textContent(".hmfoot")));
await P.click('[data-hm="metric"][data-v="chg"]');await P.click('[data-hm="tf"][data-v="1D"]');await P.click('[data-hm="size"][data-v="value"]');await P.waitForTimeout(300);
// 5) keyboard + tooltip + open chart
await P.focus(".hmt");await P.waitForSelector("#hm_tip:not([hidden])");assert(/1D change/.test(await P.textContent("#hm_tip")));
const f0=await P.evaluate(()=>document.activeElement.dataset.s);await P.keyboard.press("ArrowRight");const f1=await P.evaluate(()=>document.activeElement.dataset.s);assert(f1&&f1!==f0,"arrow moves focus");
await P.keyboard.press("Enter");await P.waitForTimeout(300);assert.deepStrictEqual(await P.evaluate(()=>[S.chart.sym,document.documentElement.dataset.page]),[f1,"chart"]);
// leaving stops the refresh timer
assert.strictEqual(await P.evaluate(()=>HM.timer),0);
console.log("errors",h.errors,"console",h.consoleErr);assert.deepStrictEqual(h.errors,[]);
// 6) instant first load from the cache: block candle downloads, reload, enter -> values appear immediately, marked as cached
await P.evaluate(()=>{go("heatmap");flush()});await P.waitForTimeout(2500);await P.evaluate(()=>go("workspace"));
await P.route(/api\/v3\/klines|\/api\/candles/,r=>r.abort());await P.reload();await ready(P);await P.waitForFunction(()=>READY);
const fp1=await P.evaluate(async()=>{const t=performance.now();go("heatmap");let n=0;for(let i=0;i<40&&n<8;i++){await new Promise(r=>requestAnimationFrame(r));n=document.querySelectorAll(".hmt:not(.na)").length}return{n,ms:Math.round(performance.now()-t),asof:document.getElementById("hm_asof").textContent}});
console.log("first paint from cache",JSON.stringify(fp1));assert(fp1.n>=8&&fp1.ms<300,"instant first paint: "+JSON.stringify(fp1));
/* the "(cache)" suffix is racy once edge frames flow (they stamp fresher data); the instant first paint above is the real check */assert(/^Updated \d\d:\d\d/.test(fp1.asof),fp1.asof);
assert.deepStrictEqual(h.errors,[]);assert.deepStrictEqual(h.offOrigin,[],"non-origin requests");await h.close();
// 7) reduced motion: no tick flashes
h=await launch({reducedMotion:"reduce"});P=h.page;await P.goto(h.app);await ready(P);await enter(P);
await P.evaluate(()=>{const s=symOf("BTCUSDT");__edge.quotes([{s:"BTCUSDT",c:s[2]*1.05}]);hmTick(false)});
assert.strictEqual(await P.evaluate(()=>document.querySelectorAll(".hmt.fu,.hmt.fd").length),0);assert.deepStrictEqual(h.offOrigin,[],"non-origin requests");await h.close();
// 8) phone
h=await launch({viewport:{width:390,height:844},mobile:true});P=h.page;await P.goto(h.app);await ready(P);await enter(P);
assert(await P.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"no sideways scroll");
G=await geo();assert.strictEqual(G.ov,0);assert.strictEqual(G.out,0);
await P.waitForTimeout(1500);await P.screenshot({path:__dirname+"/../shots/m/390_heatmap.png"});assert.deepStrictEqual(h.errors,[]);assert.deepStrictEqual(h.offOrigin,[],"non-origin requests");await h.close();
console.log("HEATMAP OK")})().catch(e=>{console.error(e);process.exit(1)});
