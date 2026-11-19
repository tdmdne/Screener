const {launch}=require("./harness");const assert=require("assert");
(async()=>{const h=await launch();const P=h.page;await P.goto(h.base+"#/workspace");
await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
await P.evaluate(()=>{S.wlx.groups[0].syms=["BTCUSDT","ETHUSDT","SOLUSDT"];S.alerts=[{id:1,sym:"BTCUSDT",price:150,dir:"above",on:true,fired:false}];save();openChart("BTCUSDT","1H")});
await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]);const ws0=await P.evaluate(()=>{window.__b=BNWS.ws;return __WS.length});
await P.click('#vtFeatBtn');await P.click('#vtFeatMenu a[href="#/chart"]');await P.waitForTimeout(500);
await P.click('.dkh button[title^="Two charts"]');await P.waitForFunction(()=>SC.chB,null,{timeout:10000});
let st=await P.evaluate(()=>({panes:document.documentElement.dataset.panes,keyB:SC.keyB,cvB:document.querySelectorAll("#cvB canvas").length>0,wl:document.querySelectorAll("#dkwl .dkr").length,al:document.querySelectorAll("#dkal .dka").length,dw:document.getElementById("dkdw").textContent,cpw:document.getElementById("cp").offsetWidth,b:document.getElementById("sc2").offsetWidth}));
console.log(JSON.stringify(st));assert(st.panes==="2"&&st.keyB==="BTCUSDT|1D"&&st.cvB&&st.wl>=3&&st.al===1&&/Close/.test(st.dw)&&st.cpw>300&&st.b>300);
// crosshair sync main -> pane 2, data window follows crosshair
await P.evaluate(()=>{window.__xs=0;const f=SC.chB.setCrosshairPosition.bind(SC.chB);SC.chB.setCrosshairPosition=(...a)=>{__xs++;return f(...a)}});
const box=await P.locator("#cv").boundingBox();const dw0=await P.textContent("#dkdw");
await P.mouse.move(box.x+box.width*0.3,box.y+box.height*0.5);await P.waitForTimeout(150);await P.mouse.move(box.x+box.width*0.35,box.y+box.height*0.5);await P.waitForTimeout(200);
const xs=await P.evaluate(()=>__xs),dw1=await P.textContent("#dkdw");console.log("sync calls",xs);assert(xs>0);assert.notStrictEqual(dw0,dw1);
await P.screenshot({path:"shots/02_chart.png"});
// pane 2 timeframe + symbol follow
await P.click('.sc2h button:has-text("4H")');await P.waitForFunction(()=>SC.keyB==="BTCUSDT|4H",null,{timeout:10000});
await P.click('#dkwl .dkr:has-text("ETHUSDT")');await P.waitForFunction(()=>S.chart.sym==="ETHUSDT"&&SC.keyB==="ETHUSDT|4H",null,{timeout:10000});
// dock collapse/expand
await P.click('.dkh button[title$="panel"]');assert(await P.evaluate(()=>document.getElementById("dock").classList.contains("shut")));
await P.click('.dkh button[title$="panel"]');assert(!(await P.evaluate(()=>document.getElementById("dock").classList.contains("shut"))));
// persists across reload
await P.reload();await P.waitForFunction(()=>BOOTED);await P.waitForFunction(()=>SC.chB||document.querySelector("#cvB"),null,{timeout:10000});
assert.strictEqual(await P.evaluate(()=>[document.documentElement.dataset.page,document.documentElement.dataset.panes,S.sc.tfB].join()),"chart,2,4H");
// leave tears down only the second pane
await P.click('#vtFeatBtn');await P.click('#vtFeatMenu a[href="#/workspace"]');await P.waitForTimeout(300);
const lv=await P.evaluate(()=>({chB:SC.chB,panes:document.documentElement.dataset.panes,ws:BNWS.ws&&BNWS.ws.readyState}));assert(!lv.chB&&lv.panes==="1"&&lv.ws===1);
await P.click('#vtFeatBtn');await P.click('#vtFeatMenu a[href="#/chart"]');await P.waitForFunction(()=>SC.chB,null,{timeout:10000});
await P.click('.dkh button[title="One chart"]');await P.waitForTimeout(200);assert.strictEqual(await P.evaluate(()=>!!SC.chB),false);
console.log("errors",h.errors,"console",h.consoleErr);assert(!h.errors.length&&!h.consoleErr.length);await h.close();console.log("SUPERCHARTS OK")})().catch(e=>{console.error(e);process.exit(1)});
