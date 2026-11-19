// Active alerts drawn on charts: dashed line + scale label at the right price, click-to-edit (price/condition/message), drag, delete,
// custom message used in the fired toast, no duplicate fires after edits; Workspace + both Supercharts panes; persists on reload.
const {launch}=require("./harness");const assert=require("assert");
(async()=>{const h=await launch();const P=h.page;await P.goto(h.base);
await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
await P.evaluate(()=>{S.alerts=[];save();openChart("BTCUSDT","1H")});await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]);await P.waitForTimeout(600);
await P.evaluate(()=>{window.__fires=0;const f=fireAlert;window.fireAlert=function(){__fires++;return f.apply(this,arguments)};
  // the mock feed jumps around; only the test drives crosses
  const c=checkAlerts;window.__manual=false;window.checkAlerts=function(){if(__manual)return c.apply(this,arguments)}});
const lab=(host,id)=>P.evaluate(([host,id])=>{const e=document.querySelector(`${host} .valb[data-al="${id}"]`);if(!e||e.style.display==="none")return null;
  const ser=host==="#cv"?MS:SC.serB;const a=S.alerts.find(x=>x.id===id);return{top:parseFloat(e.style.top)+9,want:a?ser.priceToCoordinate(a.price):null,txt:e.textContent,price:a&&a.price}},[host,id]);
// 1) line + label render at the alert's price
const px=await P.evaluate(()=>{const B=LIVE["BTCUSDT|1H"],c=B[B.length-1].c||B[B.length-1][4];const lo=MS.coordinateToPrice(ch.timeScale().height()?200:200);return vtRoundPx(symOf("BTCUSDT"),lo)});
const id=await P.evaluate(p=>vtAddAlertAt("BTCUSDT",p).id,px);await P.waitForTimeout(250);
let L=await lab("#cv",id);console.log("label",JSON.stringify(L));assert(L&&Math.abs(L.top-L.want)<=1,"label at price");
assert(L.txt.includes(await P.evaluate(p=>fp(p),px)),"label shows price");
assert.strictEqual(await P.evaluate(id=>document.querySelectorAll(`#cv .valh[data-al="${id}"]`).length,id),1);
// 2) click the label -> editor; change message + condition
await P.click(`#cv .valb[data-al="${id}"]`);await P.waitForSelector("#vae_px");
assert.strictEqual(+(await P.inputValue("#vae_px")),px);
await P.fill("#vae_msg","BTC breakout \u2014 check the 4H");await P.selectOption("#vae_dir","cross");await P.click("#vae_ok");await P.waitForTimeout(150);
let a=await P.evaluate(()=>S.alerts.map(x=>({...x})));assert.strictEqual(a.length,1);assert.strictEqual(a[0].id,id);assert.strictEqual(a[0].msg,"BTC breakout \u2014 check the 4H");assert.strictEqual(a[0].dir,"cross");
assert.strictEqual(JSON.parse(await P.evaluate(()=>localStorage.getItem(vtSK("scr2")))).alerts[0].msg,"BTC breakout \u2014 check the 4H");
await P.evaluate(()=>alertsM());const am=await P.textContent("#modal");assert(am.includes("BTC breakout")&&/crossing/i.test(am),am);await P.evaluate(()=>closeM());
// 3) fire: toast shows the custom message, exactly once; "crossing" fires on a down-cross too; line goes away once fired
const fr=await P.evaluate(p=>{__manual=true;lastPx.BTCUSDT=p+5;checkAlerts("BTCUSDT",p+5);checkAlerts("BTCUSDT",p-1);const t=document.getElementById("msg").textContent;checkAlerts("BTCUSDT",p+3);checkAlerts("BTCUSDT",p-3);__manual=false;return[__fires,t]},px);
console.log("fire",fr);assert.deepStrictEqual(fr,[1,"BTC breakout \u2014 check the 4H"]);await P.waitForTimeout(200);assert.strictEqual(await lab("#cv",id),null,"fired alert line removed");
// 4) editing a fired alert's price re-arms it on the same object; no duplicate fire from the stale baseline
const p2=await P.evaluate(()=>vtRoundPx(symOf("BTCUSDT"),MS.coordinateToPrice(300)));
const f2=await P.evaluate(([id,p2])=>{__manual=true;__fires=0;lastPx.BTCUSDT=p2-50;symOf("BTCUSDT")[2]=p2+10;vtAlUpdate(id,{price:p2});const re=!S.alerts[0].fired;
  checkAlerts("BTCUSDT",p2+12);const n0=__fires;checkAlerts("BTCUSDT",p2-1);checkAlerts("BTCUSDT",p2+1);__manual=false;return[re,n0,__fires,S.alerts.length]},[id,p2]);
console.log("edit+refire",f2);assert.deepStrictEqual(f2,[true,0,1,1]);
// 5) drag the line to move the price (fresh alert)
const p3=await P.evaluate(()=>vtRoundPx(symOf("BTCUSDT"),MS.coordinateToPrice(250)));const id3=await P.evaluate(p=>vtAddAlertAt("BTCUSDT",p).id,p3);await P.waitForTimeout(200);
const hb=await P.locator(`#cv .valh[data-al="${id3}"]`).boundingBox();const cvb=await P.locator("#cv").boundingBox();
await P.mouse.move(hb.x+100,hb.y+hb.height/2);await P.mouse.down();await P.mouse.move(hb.x+100,hb.y+hb.height/2+20,{steps:4});await P.mouse.move(hb.x+100,hb.y+hb.height/2+40,{steps:4});await P.mouse.up();await P.waitForTimeout(200);
const dr=await P.evaluate(([id,y])=>{const a=S.alerts.find(x=>x.id===id);return{price:a.price,exp:vtRoundPx(symOf("BTCUSDT"),MS.coordinateToPrice(y)),n:S.alerts.length,modal:!!document.getElementById("vae_px")}},[id3,hb.y+hb.height/2+40-cvb.y]);
console.log("drag",JSON.stringify(dr));assert(!dr.modal&&dr.n===2&&Math.abs(dr.price-dr.exp)<=Math.abs(dr.exp)*1e-3&&dr.price>p3*0+0&&dr.price<p3,"drag moved price down");
L=await lab("#cv",id3);assert(L&&Math.abs(L.top-L.want)<=1);
// 6) Supercharts: both panes show the line; dock lists it and opens the editor
await P.evaluate(()=>{S.sc.panes=2;save()});await P.click('#vtFeatBtn');await P.click('#vtFeatMenu a[href="#/chart"]');await P.waitForFunction(()=>SC.chB,null,{timeout:10000});await P.waitForTimeout(500);
L=await lab("#cv",id3);if(!L)console.log(await P.evaluate(id=>{const e=document.querySelector(`#cv .valb[data-al="${id}"]`);return JSON.stringify({e:!!e,d:e&&e.style.display,reg:VTAL.map(r=>[r.host.id,r.items.size,r.chart===ch]),y:MS.priceToCoordinate(S.alerts[1].price),h:document.getElementById("cv").clientHeight,a:S.alerts})},id3));assert(L&&Math.abs(L.top-L.want)<=1,"main pane");const LB=await lab("#cvB",id3);console.log("pane2",JSON.stringify(LB));assert(LB&&Math.abs(LB.top-LB.want)<=1,"pane 2");
await P.screenshot({path:"shots/02c_chart_alertlines.png"});
await P.click("#dkal .dka span[title='Edit alert'] >> nth=1");await P.waitForSelector("#vae_px");assert.strictEqual(+(await P.inputValue("#vae_px")),dr.price);await P.evaluate(()=>closeM());
// 7) delete from the editor opened on pane 2: alert and both lines gone
await P.click(`#cvB .valb[data-al="${id3}"]`);await P.waitForSelector("#vae_del");await P.click("#vae_del");await P.waitForTimeout(200);
const del=await P.evaluate(id=>[S.alerts.some(a=>a.id===id),document.querySelectorAll(`[data-al="${id}"]`).length,JSON.parse(localStorage.getItem(vtSK("scr2"))).alerts.length,document.querySelectorAll("#dkal .dka").length],id3);
console.log("delete",del);assert.deepStrictEqual(del,[false,0,1,1]);
// 8) persists across reload: armed alert drawn again with its message
await P.evaluate(id=>{const a=S.alerts.find(x=>x.id===id);a.fired=false;a.msg="kept";save()},id);await P.reload();await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));await P.evaluate(()=>openChart("BTCUSDT","1H"));await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]);
// the mock feed may have crossed it during boot; stop that and re-arm, then check it is drawn from persisted state
assert.strictEqual(await P.evaluate(()=>{window.checkAlerts=()=>{};S.alerts[0].fired=false;return S.alerts[0].msg}),"kept");await P.waitForTimeout(800);
L=await lab("#cv",id);assert(L&&Math.abs(L.top-L.want)<=1,"after reload");assert.strictEqual(await P.evaluate(()=>S.alerts[0].msg),"kept");
assert.strictEqual(await P.evaluate(()=>document.querySelectorAll("#cv .valb").length),1);
console.log("errors",h.errors,"console",h.consoleErr);assert(!h.errors.length&&!h.consoleErr.length);await h.close();console.log("ALERTLINES OK")})().catch(e=>{console.error(e);process.exit(1)});
