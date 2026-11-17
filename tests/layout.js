// Desktop layout: the chart fills its panel (also while loading or after an error) and follows window resizes;
// the screener list on desktop is one continuous, virtualised list with sticky headers (no pages),
// keeping sort, search, arrow-key navigation and the "N matches" count;
// phones keep pages. Scoring/filter maths are untouched (same rows, same order as the paged list).
const assert=require("assert"),fs=require("fs"),path=require("path");const {launch}=require("./harness");
const AXE=fs.readFileSync(path.join(__dirname,"../node_modules/axe-core/axe.min.js"),"utf8");
const ready=P=>P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
(async()=>{const h=await launch({viewport:{width:1600,height:900}});const P=h.page;const errs=[];P.on("pageerror",e=>errs.push(e.message));await P.goto(h.base);await ready(P);
// 1) chart height on Workspace and Supercharts
for(const r of ["workspace","chart"]){await P.evaluate(r=>{go(r);openChart("BTCUSDT","1H")},r);await P.waitForFunction(()=>document.querySelector("#cv canvas"),null,{timeout:30000});await P.waitForTimeout(300);
  const m=await P.evaluate(()=>{const c=document.querySelector("#cv").getBoundingClientRect(),p=document.querySelector(".cpb").getBoundingClientRect();return{cv:c.height,panel:p.height,gap:p.bottom-c.bottom}});
  assert(m.cv>=0.6*m.panel&&m.cv>450,r+" chart fills the panel "+JSON.stringify(m));assert(m.gap<140,r+" no big gap under the chart "+JSON.stringify(m))}
// resize: the chart follows the window
const h1=await P.evaluate(()=>document.querySelector("#cv").clientHeight);await P.setViewportSize({width:1600,height:1100});await P.waitForTimeout(500);
const h2=await P.evaluate(()=>[document.querySelector("#cv").clientHeight,document.querySelector("#cv canvas").getBoundingClientRect().height]);
assert(h2[0]>h1+120&&h2[1]>h1,"chart grows with the window "+h1+" -> "+h2);await P.setViewportSize({width:1600,height:900});await P.waitForTimeout(400);
// loading and error states fill the chart area too
await P.evaluate(()=>{VT_TDK.mem="";delete ERR["EURUSD|1H"];openChart("EURUSD","1H")});await P.waitForSelector("#cv .vt-cverr",{timeout:60000});
let f=await P.evaluate(()=>{const c=document.querySelector("#cv").getBoundingClientRect(),e=document.querySelector("#cv>.vt-cverr").getBoundingClientRect();return[c.height,e.height]});
assert(f[1]>=f[0]-2&&f[0]>450,"error state fills the chart "+f);
f=await P.evaluate(()=>{document.getElementById("cv").innerHTML='<p class="mut vt-skel" role="status">Loading candles\u2026</p>';const c=document.querySelector("#cv").getBoundingClientRect(),e=document.querySelector("#cv>.vt-skel").getBoundingClientRect();return[c.height,e.height]});
assert(f[1]>=f[0]-2,"loading skeleton fills the chart "+f);
// 2) continuous screener list
for(const r of ["workspace","screener"]){await P.evaluate(r=>{go(r);applyPreset("P5")},r);await P.waitForTimeout(500);
  const st=()=>P.evaluate(()=>{const w=document.querySelector(".side>.tw"),rs=[...document.querySelectorAll("#t tbody tr[data-s]")];return{n:rows(S.cols.filter(c=>!c.hide)).length,pgl:PGL.length,dom:rs.length,pg:document.getElementById("pg").textContent.trim(),cnt:document.getElementById("cnt").textContent,first:rs[0]&&rs[0].dataset.s,last:rs[rs.length-1]&&rs[rs.length-1].dataset.s,sh:w.scrollHeight,ch:w.clientHeight,sticky:getComputedStyle(document.querySelector("#t th")).position}});
  let s=await st();assert(s.n>100,"enough markets "+s.n);assert.strictEqual(s.pgl,s.n,"every match is in the list");assert(s.dom<s.n&&s.dom>=20,"only nearby rows are drawn "+s.dom);
  assert.strictEqual(s.pg,"","no pager");assert(s.cnt.startsWith(s.n+" match"),"count "+s.cnt);assert.strictEqual(s.sticky,"sticky");assert(s.sh>s.n*25,"scroll height covers every row");
  const oo=await P.evaluate(()=>{render();return[rows(S.cols.filter(c=>!c.hide)).map(r=>r.s[0]),PGL.slice()]});assert.deepStrictEqual(oo[1],oo[0],"same order as the sorted rows");
  // data keeps arriving, so take the order the list holds now when checking the end of it
  const order=oo[1];
  // scroll to the end: last match is drawn and reachable, header still visible
  await P.evaluate(()=>{const w=document.querySelector(".side>.tw");w.scrollTop=w.scrollHeight});await P.waitForTimeout(300);s=await st();assert.strictEqual(s.last,await P.evaluate(()=>PGL[PGL.length-1]),r+" last row reachable");
  const hv=await P.evaluate(()=>{const w=document.querySelector(".side>.tw").getBoundingClientRect(),t=document.querySelector("#t th").getBoundingClientRect();return Math.abs(t.top-w.top)<3});assert(hv,r+" header sticks");
  // middle: rows around the viewport are the right ones
  await P.evaluate(()=>{const w=document.querySelector(".side>.tw");w.scrollTop=w.scrollHeight/2});await P.waitForTimeout(300);
  const mid=await P.evaluate(()=>{const w=document.querySelector(".side>.tw").getBoundingClientRect(),y=w.top+w.height/2,el=document.elementFromPoint(w.left+40,y),tr=el&&el.closest("tr[data-s]");return tr&&{s:tr.dataset.s,i:PGL.indexOf(tr.dataset.s)}});
  assert(mid&&mid.i>20&&mid.i<order.length-20,r+" middle row visible "+JSON.stringify(mid));
  // keyboard: ArrowDown from the last drawn row scrolls the list to keep the selection visible
  await P.evaluate(()=>{const w=document.querySelector(".side>.tw");w.scrollTop=0});await P.waitForTimeout(200);
  await P.evaluate(()=>{openChart(PGL[30])});await P.evaluate(()=>document.activeElement&&document.activeElement.blur());
  for(let k=0;k<40;k++)await P.keyboard.press("ArrowDown");await P.waitForTimeout(400);
  const kv=await P.evaluate(()=>{const tr=document.querySelector(`#t tbody tr[data-s="${CSS.escape(S.chart.sym)}"]`),w=document.querySelector(".side>.tw").getBoundingClientRect();if(!tr)return{sym:S.chart.sym,i:PGL.indexOf(S.chart.sym),drawn:false};const b=tr.getBoundingClientRect();return{sym:S.chart.sym,i:PGL.indexOf(S.chart.sym),drawn:true,inView:b.top>=w.top-1&&b.bottom<=w.bottom+1,sel:tr.classList.contains("sel")}});
  assert(kv.i===70&&kv.drawn&&kv.inView&&kv.sel,r+" arrow keys keep the row in view "+JSON.stringify(kv));
  // search and sort still work and reset to the top
  await P.fill("#q","USDT");await P.waitForTimeout(600);s=await st();assert(s.n>0&&s.n<order.length&&s.pgl===s.n,"search filters the continuous list");
  assert(await P.evaluate(()=>[...document.querySelectorAll("#t tbody tr[data-s]")].every(r=>/USDT/.test(r.dataset.s))));
  assert.strictEqual(await P.evaluate(()=>document.querySelector(".side>.tw").scrollTop),0,"new filter starts at the top");
  await P.fill("#q","");await P.waitForTimeout(600);
  const so=await P.evaluate(()=>{srt("sym");return[S.sort.id,rows(S.cols.filter(c=>!c.hide)).map(r=>r.s[0]).join(),PGL.join()]});
  assert(so[0]==="sym"&&so[1]===so[2],"sort applies to the whole continuous list");
  // click a row opens it on the chart
  const pick=await P.evaluate(()=>document.querySelectorAll("#t tbody tr[data-s]")[3].dataset.s);await P.click(`#t tbody tr[data-s="${pick}"] td.sy`);await P.waitForTimeout(300);
  assert.strictEqual(await P.evaluate(()=>S.chart.sym),pick,"row click selects into the chart");
  // axe on the list
  await P.evaluate(AXE);const v=await P.evaluate(async()=>(await axe.run(document.querySelector(".side>.tw"),{runOnly:{type:"tag",values:["wcag2a","wcag2aa"]}})).violations.map(v=>v.id));assert.deepStrictEqual(v,[],r+" axe "+v)}
await P.screenshot({path:path.join(__dirname,"../shots/desk_screener_continuous.png")});
assert.deepStrictEqual(errs,[]);await h.close();
// 3) phone keeps pages
const m=await launch({viewport:{width:390,height:844},mobile:true,dsf:2});const Q=m.page;await Q.goto(m.base);await ready(Q);await Q.evaluate(()=>{go("screener");applyPreset("P5")});await Q.waitForTimeout(500);
const ph=await Q.evaluate(()=>({virt:vtVirtOn(),drawn:document.querySelectorAll("#t tbody tr[data-s]").length,rows:S.rows||20,pg:!!document.querySelector("#pg button")}));
assert(!ph.virt&&ph.drawn===ph.rows&&ph.pg,"phone keeps pages "+JSON.stringify(ph));await m.close();
console.log("LAYOUT OK");process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});
