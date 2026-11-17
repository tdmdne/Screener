const {launch}=require("./harness");const assert=require("assert");
(async()=>{const h=await launch();const P=h.page;await P.goto(h.base);
await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));await P.evaluate(()=>{S.mkt="CRY";save();render()});await P.waitForTimeout(2500);
// scoring functions are untouched: compare their source with the baseline file
const fs=require("fs");const base=fs.readFileSync(__dirname+"/../baseline.html","utf8");
for(const fn of ["scoreMarket","passesPreset","scoreSymbol"]){const src=await P.evaluate(n=>window[n].toString(),fn);assert(base.includes(src),fn+" changed");}
await P.click('#vnav a[data-p="screener"]');await P.waitForTimeout(600);
let st=await P.evaluate(()=>({th:document.querySelectorAll("#t thead th").length,rows:document.querySelectorAll("#t tbody tr[data-s]").length,pro:document.querySelectorAll("#t tbody td[data-l=Tier]").length,bar:!!document.querySelector("#sxbar").offsetParent,scroll:(()=>{const w=document.querySelector(".side>.tw");return w.scrollWidth-w.clientWidth})()}));
console.log(JSON.stringify(st));assert(st.th>=12&&st.rows>0&&st.pro===st.rows&&st.bar&&st.scroll<=2);
// the Cycle (S01-S04) pills are gone
assert(await P.evaluate(()=>!/Cycle/.test(document.getElementById("sxbar").textContent)&&typeof applySFilter==="undefined"),"no cycle filter");
// desktop: one continuous list, so no Rows-per-page pills and no pager
assert(await P.evaluate(()=>!/Rows/.test(document.getElementById("sxbar").textContent)&&!document.getElementById("pg").textContent.trim()),"desktop list has no pages");
// Pro columns survive the list search box (debounced render)
await P.fill("#q","USDT");await P.waitForTimeout(500);assert(await P.evaluate(()=>document.querySelectorAll("#t td[data-l=Tier]").length>0));await P.fill("#q","");await P.waitForTimeout(400);
await P.waitForFunction(()=>LIVE["ETHUSDT|1H"]&&LIVE["SOLUSDT|1H"],null,{timeout:15000});await P.evaluate(()=>render());await P.waitForTimeout(300);
assert(await P.evaluate(()=>[...document.querySelectorAll("#t td[data-l=Vektor]")].some(td=>/\d/.test(td.textContent))),"Vektor scores computed");
await P.screenshot({path:"shots/03_screener.png"});
// row click -> drawer with mini chart
await P.click('#t tbody tr[data-s="ETHUSDT"] td:nth-child(3)');await P.waitForFunction(()=>SX.ch,null,{timeout:10000});
st=await P.evaluate(()=>({open:document.getElementById("sxd").classList.contains("open"),sym:SX.sym,canv:document.querySelectorAll("#sxc canvas").length,sel:document.querySelector("#t tbody tr.sel")?.dataset.s}));
console.log(JSON.stringify(st));assert(st.open&&st.sym==="ETHUSDT"&&st.canv>0&&st.sel==="ETHUSDT");
await P.waitForTimeout(300);await P.screenshot({path:"shots/03b_screener_drawer.png"});
// arrow key moves through rows and updates drawer
await P.keyboard.press("ArrowDown");await P.waitForTimeout(300);assert.notStrictEqual(await P.evaluate(()=>SX.sym),"ETHUSDT");
await P.keyboard.press("Escape");await P.waitForTimeout(250);assert(!(await P.evaluate(()=>document.getElementById("sxd").classList.contains("open"))));
// open in supercharts from drawer
await P.click('#t tbody tr[data-s="SOLUSDT"] td.sy');await P.waitForTimeout(300);await P.click('#sxd button:has-text("Open in Supercharts")');await P.waitForTimeout(800);
st=await P.evaluate(()=>({page:S.pageView,sym:S.chart.sym,ch:!!ch,drawer:document.getElementById("sxd").classList.contains("open"),pro:document.querySelectorAll("#t td[data-l=Tier]").length}));
console.log(JSON.stringify(st));assert(st.page==="chart"&&st.sym==="SOLUSDT"&&st.ch&&!st.drawer&&st.pro===0);
// layout picker works (built-in layout)
await P.click('#vnav a[data-p="screener"]');await P.waitForTimeout(300);await P.selectOption("#sxlay","Trend grid");await P.waitForTimeout(300);assert.strictEqual(await P.evaluate(()=>S.cur),"Trend grid");
console.log("errors",h.errors,"console",h.consoleErr);assert(!h.errors.length&&!h.consoleErr.length);await h.close();console.log("SCREENER OK")})().catch(e=>{console.error(e);process.exit(1)});
