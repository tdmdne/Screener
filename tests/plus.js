// Price-scale "+" -> alert at that price (fires once on a cross) and horizontal line; Workspace + both Supercharts panes
const {launch}=require("./harness");const assert=require("assert");
(async()=>{const h=await launch();const P=h.page;await P.goto(h.base+"#/workspace");
await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
await P.evaluate(()=>{S.alerts=[];S.dr={};save();openChart("BTCUSDT","1H")});await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]);await P.waitForTimeout(600);
await P.evaluate(()=>{window.__fires=0;const f=fireAlert;window.fireAlert=function(){__fires++;return f.apply(this,arguments)}});
async function viaPlus(hostSel,seriesExpr,item){const box=await P.locator(hostSel).boundingBox();
  const pw=await P.evaluate(e=>eval(e).timeScale().width(),seriesExpr[0]);const y=Math.round(box.height*0.4);
  await P.mouse.move(box.x+pw+15,box.y+y);await P.waitForTimeout(120); // over the price axis
  const plus=P.locator(hostSel+" .vplus");assert(await plus.isVisible(),"plus visible on "+hostSel);
  const pb=await plus.boundingBox();assert(Math.abs(pb.y+9-(box.y+y))<=1.5,"plus at crosshair level");
  const yy=await P.evaluate(sel=>parseFloat(document.querySelector(sel+" .vplus").style.top)+9,hostSel);
  const expect=await P.evaluate(([ser,y])=>{const s=symOf(S.chart.sym);return vtRoundPx(s,eval(ser).coordinateToPrice(y))},[seriesExpr[1],yy]);
  await plus.click();const menu=P.locator(hostSel+" .vpmenu");await menu.waitFor();const txt=await menu.textContent();
  assert(/Add alert at/.test(txt)&&/Draw horizontal line at/.test(txt),txt);
  await menu.locator("div",{hasText:item}).click();await P.waitForTimeout(100);return expect}
// 1) Workspace chart -> alert
let px=await viaPlus("#cv",["ch","MS"],"Add alert");
let al=await P.evaluate(()=>S.alerts.slice(-1)[0]);console.log("workspace alert",JSON.stringify(al),"expected",px);
assert.strictEqual(al.sym,"BTCUSDT");assert.strictEqual(al.price,px);assert.strictEqual(JSON.parse(await P.evaluate(()=>localStorage.getItem(vtSK("scr2")))).alerts.length,1);
await P.evaluate(()=>alertsM());assert((await P.textContent("#modal")).includes(String(px)));await P.evaluate(()=>closeM());
// mocked cross: fires exactly once
const fires=await P.evaluate(p=>{S.alerts.forEach(a=>{a.dir="above"});delete lastPx.ETHX;checkAlerts("BTCUSDT",p-1);checkAlerts("BTCUSDT",p+1);checkAlerts("BTCUSDT",p-1);checkAlerts("BTCUSDT",p+2);return[__fires,S.alerts[0].fired]},px);
console.log("fires",fires);assert.deepStrictEqual(fires,[1,true]);
// 2) Workspace chart -> horizontal line
px=await viaPlus("#cv",["ch","MS"],"Draw horizontal");const hl=await P.evaluate(()=>DL().filter(d=>d.t==="hline").map(d=>d.p[0].y));assert.deepStrictEqual(hl,[px]);
// 3) Supercharts main pane + pane 2
await P.evaluate(()=>{S.sc.panes=2;save()});await P.click('#vtFeatBtn');await P.click('#vtFeatMenu a[href="#/chart"]');await P.waitForFunction(()=>SC.chB,null,{timeout:10000});await P.waitForTimeout(500);
px=await viaPlus("#cv",["ch","MS"],"Add alert");assert.strictEqual(await P.evaluate(()=>S.alerts.slice(-1)[0].price),px);
assert((await P.textContent("#dkal")).includes("BTCUSDT"));
px=await viaPlus("#cvB",["SC.chB","SC.serB"],"Add alert");assert.strictEqual(await P.evaluate(()=>S.alerts.slice(-1)[0].price),px);
await P.waitForTimeout(200);assert.strictEqual(await P.evaluate(()=>document.querySelectorAll("#dkal .dka").length),3);
// menu closes on outside click; plus hides when leaving
await P.locator("#cvB .vplus").click();await P.locator("#cvB .vpmenu").waitFor();await P.screenshot({path:"shots/02b_chart_plus.png"});await P.mouse.click(10,300);assert.strictEqual(await P.locator(".vpmenu").count(),0);
console.log("errors",h.errors,"console",h.consoleErr);assert(!h.errors.length&&!h.consoleErr.length);await h.close();console.log("PLUS OK")})().catch(e=>{console.error(e);process.exit(1)});
