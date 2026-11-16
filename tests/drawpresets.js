// Drawing templates + instant style persistence: built-in presets for trend/hray/fib/long/short, save-as, default (star),
// debounced auto-save of the last-used style which becomes the tool default, guest gate.
const {launch}=require("./harness");const assert=require("assert");
(async()=>{let h=await launch();let P=h.page;await P.goto(h.base);
await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));await P.evaluate(()=>{S.dr={};S.toolDef={};S.drawPre={};S.posDef={};save();openChart("BTCUSDT","1H");go("chart")});
await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]);await P.waitForTimeout(800);
const box=await P.locator("#cv").boundingBox();const pw=await P.evaluate(()=>ch.timeScale().width());
const draw=async(tool,pts)=>{await P.evaluate(t=>setTool(t),tool);for(const[x,y]of pts){await P.mouse.click(box.x+pw*x,box.y+box.height*y);await P.waitForTimeout(80)}await P.waitForTimeout(150);return P.evaluate(()=>{const d=DL()[DL().length-1];return d&&{id:d.id,t:d.t,c:d.c,w:d.w,s:d.s}})};
// 1) instant style persistence: change width + line type on the floating toolbar -> saved (debounced) and remembered for the next trend line
let d1=await draw("trend",[[0.3,0.3],[0.5,0.4]]);assert.strictEqual(d1.t,"trend");
await P.evaluate(id=>{SELD=DL().find(x=>x.id===id);dpe();dsel()},d1.id);assert(await P.isVisible("#ds_tpl"));
await P.selectOption("#dsel select:not([title])","3");await P.selectOption("#dsel select[title=\"Line type\"]","1");
assert.strictEqual(await P.evaluate(()=>JSON.parse(localStorage.getItem("scr2")).toolDef.trend),undefined,"not saved synchronously (debounced)");
await P.waitForTimeout(450);assert.deepStrictEqual(await P.evaluate(()=>{const t=JSON.parse(localStorage.getItem("scr2")).toolDef.trend;return{w:t.w,s:t.s}}),{w:3,s:1},"saved after the debounce");
let d2=await draw("trend",[[0.3,0.6],[0.5,0.7]]);assert.deepStrictEqual([d2.w,d2.s],[3,1],"new trend line uses the last-used style");
// 2) built-in preset applied to the selection
await P.evaluate(id=>{SELD=DL().find(x=>x.id===id);dpe();dsel()},d2.id);await P.click("#ds_tpl");await P.waitForSelector(".dpm");
const names=await P.locator(".dpm .dp_ap span:not(.mut)").allTextContents();assert.deepStrictEqual(names.slice(0,4),["Blue","Thin grey","Bold orange","Dashed"]);
await P.screenshot({path:__dirname+"/../shots/13_drawing_templates.png"});
await P.locator(".dp_ap",{hasText:"Bold orange"}).click();let s=await P.evaluate(id=>DL().find(x=>x.id===id),d2.id);assert.deepStrictEqual([s.c,s.w,s.s],["#fb923c",3,0]);
// 3) save as + star (default for new drawings)
await P.click("#ds_tpl");await P.fill("#dp_name","Mine");await P.click("#dp_save");await P.waitForTimeout(100);
assert.deepStrictEqual(await P.evaluate(()=>S.drawPre.trend),[{n:"Mine",c:"#fb923c",w:3,s:0}]);assert(await P.isVisible('.dpl[aria-label="Your templates"]'));
await P.locator(".dpl li",{hasText:"Thin grey"}).locator(".dp_df").click();
let d3=await draw("trend",[[0.6,0.3],[0.7,0.35]]);assert.deepStrictEqual([d3.c,d3.w,d3.s],["#787b86",1,0]);
// 4) horizontal ray + fib
let hr=await draw("hray",[[0.4,0.5]]);assert.strictEqual(hr.t,"hray");await P.evaluate(id=>{SELD=DL().find(x=>x.id===id);dpe();dsel()},hr.id);
await P.click("#ds_tpl");await P.locator(".dp_ap",{hasText:"Support"}).click();assert.strictEqual(await P.evaluate(id=>DL().find(x=>x.id===id).c,hr.id),"#089981");
let fb=await draw("fib",[[0.2,0.2],[0.35,0.6]]);assert.strictEqual(fb.t,"fib");await P.evaluate(id=>{SELD=DL().find(x=>x.id===id);dpe();dsel()},fb.id);
await P.click("#ds_tpl");await P.locator(".dp_ap",{hasText:"Gold"}).click();assert.deepStrictEqual(await P.evaluate(id=>{const d=DL().find(x=>x.id===id);return[d.c,d.w]},fb.id),["#f5b301",2]);
// 5) long position: Swing 1:3 sets R:R 3 by moving the target; Conservative as default -> next position 1:1.5, risk 0.5%
let lp=await draw("long",[[0.75,0.5]]);assert.strictEqual(lp.t,"long");await P.evaluate(id=>{SELD=DL().find(x=>x.id===id);dpe();dsel()},lp.id);
await P.click("#ds_tpl");await P.locator(".dp_ap",{hasText:"Swing 1:3"}).click();
let rr=await P.evaluate(id=>{const d=DL().find(x=>x.id===id);return{rr:+posCalcD(d).rr.toFixed(2),risk:d.risk}},lp.id);assert.strictEqual(rr.risk,1);assert(Math.abs(rr.rr-3)<0.02,JSON.stringify(rr));
await P.click("#ds_tpl");await P.locator(".dpl li",{hasText:"Conservative"}).locator(".dp_df").click();
let sp=await draw("short",[[0.85,0.4]]);rr=await P.evaluate(id=>{const d=DL().find(x=>x.id===id);return{rr:+posCalcD(d).rr.toFixed(2),risk:posO(d).risk}},sp.id);assert.deepStrictEqual(rr,{rr:1.5,risk:0.5});
// 6) everything survives a reload
await P.waitForTimeout(400);await P.reload();await P.waitForFunction(()=>BOOTED);
assert.deepStrictEqual(await P.evaluate(()=>({t:S.toolDef.trend.c,pre:S.drawPre.trend.length,rr:S.posDef.rr})),{t:"#787b86",pre:1,rr:1.5});
console.log("errors",h.errors,"console",h.consoleErr);assert.deepStrictEqual(h.errors,[]);await h.close();
// 7) guest: built-ins apply, saving asks to sign in
h=await launch({auth:false});P=h.page;await P.goto(h.base);await P.click("#auGuest");await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
await P.evaluate(()=>{openChart("BTCUSDT","1H");go("chart")});await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]);
await P.evaluate(()=>{const d={id:5,t:"trend",p:[{t:G.a[10].t,y:100},{t:G.a[20].t,y:110}],c:"#2962ff",w:2,s:0};DL().push(d);SELD=d;dpe();dsel()});
await P.click("#ds_tpl");await P.locator(".dp_ap",{hasText:"Dashed"}).click();assert.strictEqual(await P.evaluate(()=>DL()[0].s),1);
await P.click("#ds_tpl");await P.fill("#dp_name","G");await P.click("#dp_save");await P.waitForSelector("#vg_h");assert(/drawing templates/.test(await P.textContent("#vg_h")));
console.log("errors",h.errors,"console",h.consoleErr);assert.deepStrictEqual(h.errors,[]);await h.close();
console.log("DRAWPRESETS OK")})().catch(e=>{console.error(e);process.exit(1)});
