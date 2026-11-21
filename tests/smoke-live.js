// Live UI smoke check against a deployed preview or production (real /ws + hub, signed in as the smoke-test account).
// Usage: node tests/smoke-live.js <baseUrl> [screenshot.png]
// Credentials: VT_SMOKE_EMAIL / VT_SMOKE_PASS, else smoke-creds.local.json in the repo root ({ "email", "password" };
// gitignored, never served, never printed). The file is kept between runs.
// Checks: multi-pane layout + live pane view, drawing mirroring toggle, server alert registration, paper trading panel.
const path=require("path");const {chromium}=require("playwright");
const base=String(process.argv[2]||"").replace(/\/+$/,"");if(!/^https:\/\//.test(base)){console.log("usage: node tests/smoke-live.js https://<deployment>");process.exit(2)}const out=[];const ok=(n,c,d)=>{out.push((c?"PASS ":"FAIL ")+n+(d?" — "+d:""));};
(async()=>{const browser=await chromium.launch();const ctx=await browser.newContext({viewport:{width:1440,height:900}});const P=await ctx.newPage();
const errors=[];P.on("pageerror",e=>errors.push(String(e.message||e)));
const wsIn=[],wsOut=[];P.on("websocket",ws=>{if(!/\/ws(\?|$)/.test(ws.url()))return;ws.on("framesent",f=>wsOut.push(String(f.payload)));ws.on("framereceived",f=>wsIn.push(String(f.payload)))});
await P.goto(base+"/#/chart",{waitUntil:"domcontentloaded"});
// sign in with the test account (env vars, or a local creds JSON next to this script); values are never printed
let em=process.env.VT_SMOKE_EMAIL,pw=process.env.VT_SMOKE_PASS;
if(!em||!pw){try{const c=JSON.parse(require("fs").readFileSync(path.join(__dirname,"..","smoke-creds.local.json"),"utf8"));em=c.email;pw=c.password}catch(_e){}}
if(!em||!pw){console.log("FAIL no test credentials (VT_SMOKE_EMAIL / VT_SMOKE_PASS or smoke-creds.local.json in the repo root)");process.exit(3)}
await P.waitForSelector("#auId",{state:"visible",timeout:20000});await P.fill("#auId",em);await P.fill("#auPw",pw);await P.click("#auBtn");
const signed=await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&!document.documentElement.classList.contains("locked"),null,{timeout:30000}).then(()=>true,()=>false);
ok("signed in with the test account",signed);if(!signed){console.log(out.join("\n"));await browser.close();process.exit(1)}
em=pw=null;
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED,null,{timeout:45000});
// the smoke account's email is unverified: dismiss the verification prompt like a user choosing "Verify later"
try{await P.waitForSelector("#vtVerifyLaterBtn",{state:"visible",timeout:6000});await P.click("#vtVerifyLaterBtn");await P.waitForSelector("#vtVerifyModalOv",{state:"detached",timeout:5000})}catch(_e){}
await P.evaluate(()=>{if(location.hash!=="#/chart")go("chart");openChart("BTCUSDT","1H")});
const wsOk=await P.waitForFunction(()=>VT_EDGE.ws&&VT_EDGE.ws.readyState===1,null,{timeout:30000}).then(()=>true,()=>false);
ok("edge WS open",wsOk,wsOk?"":await P.evaluate(()=>JSON.stringify({ws:VT_EDGE.ws?VT_EDGE.ws.readyState:null,canEdge:typeof vtCanUseEdge==="function"?vtCanUseEdge():null,live:typeof isLive==="function"?isLive():null,hash:location.hash})));
await P.waitForFunction(()=>ch&&G&&G.a&&G.a.length>30,null,{timeout:45000}).catch(()=>{});
ok("main chart has bars",await P.evaluate(()=>!!(G&&G.a&&G.a.length>30)),await P.evaluate(()=>G&&G.a?G.a.length+" bars":"none"));

// 1) multi-pane layout + live pane subscription
await P.evaluate(()=>{S.sc.syncSym=true;S.sc.syncDr=true;vtSetLayout(4)});
const panes=await P.waitForFunction(()=>VT_LAY.panes.length===3&&VT_LAY.panes.every(p=>p.ch&&p.B),null,{timeout:45000}).then(()=>true,()=>false);
ok("4-chart layout renders 3 panes with data",panes,await P.evaluate(()=>VT_LAY.panes.map(p=>p.sym+"|"+p.tf+":"+(p.B?p.B.a.length:0)).join(" ")));
await P.waitForTimeout(1500);
ok("view frame carries chart.panes",wsOut.some(m=>{try{const v=JSON.parse(m);return v.op==="view"&&v.chart&&Array.isArray(v.chart.panes)&&v.chart.panes.length===3}catch(e){return false}}));
const err0=wsIn.map(m=>{try{return JSON.parse(m)}catch(e){return null}}).filter(f=>f&&f.type==="error");
ok("hub accepted the view (no INVALID_VIEW)",!err0.some(e=>e.code==="INVALID_VIEW"),err0.map(e=>e.code).join(","));

// 2) drawing mirrored on panes + toggle
await P.evaluate(()=>{const a=G.a,lo=Math.min(...a.slice(-50).map(b=>b.l)),hi=Math.max(...a.slice(-50).map(b=>b.h));S.dr.BTCUSDT=(S.dr.BTCUSDT||[]).filter(d=>d.id!==424242);
  S.dr.BTCUSDT.push({id:424242,t:"hline",p:[{t:a[a.length-20].t,y:(lo+hi)/2}],c:"#ff00ff",w:3,s:0});save()});
await P.waitForTimeout(600);
const mag=()=>P.evaluate(()=>{const c=document.querySelector("#sc2 .lay-cell canvas.vt-pdc");if(!c)return -1;const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i+3]>150&&d[i]>200&&d[i+1]<60&&d[i+2]>200)n++;return n});
const m1=await mag();ok("drawing mirrored onto pane",m1>100,m1+" px");
await P.click("#sc2 .lay-bar label.lay-dr input");await P.waitForTimeout(400);const m2=await mag();
await P.click("#sc2 .lay-bar label.lay-dr input");await P.waitForTimeout(400);const m3=await mag();
ok("Drawings toggle off/on",m2===0&&m3>100,m2+" / "+m3);
await P.evaluate(()=>{S.dr.BTCUSDT=S.dr.BTCUSDT.filter(d=>d.id!==424242);save()});

// 3) server alerts registration
const nOut=wsOut.length;
await P.evaluate(()=>{const p=symOf("BTCUSDT")[2]||G.a[G.a.length-1].c;S.alerts=(S.alerts||[]).filter(a=>a.id!==9090909);S.alerts.push({id:9090909,sym:"BTCUSDT",price:+(p*3).toFixed(2),dir:"above",on:true,fired:false});save()});
await P.waitForTimeout(1500);
const sentAlerts=wsOut.slice(nOut).map(m=>{try{return JSON.parse(m)}catch(e){return null}}).filter(v=>v&&v.op==="alerts");
ok("alerts op sent to the hub",sentAlerts.some(v=>v.alerts.some(a=>a.id==="9090909"&&a.condition==="cross_up")));
await P.waitForTimeout(800);
const errA=wsIn.map(m=>{try{return JSON.parse(m)}catch(e){return null}}).filter(f=>f&&f.type==="error"&&/ALERT/.test(f.code||""));
ok("hub accepted the alert (no INVALID_ALERTS)",errA.length===0,errA.map(e=>e.message).join(" | "));
ok("browser alert check removed",await P.evaluate(()=>typeof checkAlerts==="undefined"));
await P.evaluate(()=>{S.alerts=S.alerts.filter(a=>a.id!==9090909);save()});

// 4) paper trading panel
await P.evaluate(()=>{S.sc.secs.pp=true;S.sc.dock=true;save();scDock()});
const pp=await P.waitForFunction(()=>VT_PP.acct&&document.getElementById("dkpp")&&/Balance/.test(document.getElementById("dkpp").textContent),null,{timeout:20000}).then(()=>true,()=>false);
ok("paper account frame received + panel rendered",pp,await P.evaluate(()=>VT_PP.acct?("balance "+VT_PP.acct.balance+", positions "+VT_PP.acct.positions.length):"no account"));
ok("hub capabilities include alerts",wsIn.some(m=>/"type":"hello"/.test(m)&&/"alerts"/.test(m)));

ok("no page errors",errors.length===0,errors.slice(0,3).join(" | "));
await P.screenshot({path:process.argv[3]||path.join(__dirname,"..","shots","smoke-live.png")});
console.log(out.join("\n"));await browser.close();process.exit(out.some(l=>l.startsWith("FAIL"))?1:0);
})().catch(e=>{console.error("SMOKE ERROR",e.message);console.log(out.join("\n"));process.exit(2)});
