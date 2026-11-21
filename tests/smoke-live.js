// Live UI smoke check against a deployed preview or production (real /ws + hub, signed in as the smoke-test account).
// Usage: node tests/smoke-live.js <baseUrl> [--mobile] [screenshot.png]
//   desktop 1440x900 by default; --mobile = 390x844 touch (the Phase F merge gate runs both, docs/architecture/PHASE_F_CHECKLIST.md)
// Credentials: VT_SMOKE_EMAIL / VT_SMOKE_PASS, else smoke-creds.local.json in the repo root ({ "email", "password" };
// gitignored, never served, never printed). The file is kept between runs.
// Checks: sign-in, live WS, chart bars, multi-pane layout + drawing mirroring (desktop), server alert registration, paper
// account, zero console errors after sign-in, and no overlapping / clipped buttons or horizontal overflow on key views.
const path=require("path");const {chromium}=require("playwright");
const args=process.argv.slice(2),MOBILE=args.includes("--mobile"),pos=args.filter(a=>!a.startsWith("--"));
const base=String(pos[0]||"").replace(/\/+$/,"");if(!/^https:\/\//.test(base)){console.log("usage: node tests/smoke-live.js https://<deployment> [--mobile]");process.exit(2)}
const out=[];const ok=(n,c,d)=>{out.push((c?"PASS ":"FAIL ")+(MOBILE?"[mobile] ":"[desktop] ")+n+(d?" — "+d:""));};
// Cloudflare's injected Web Analytics beacon (not our code) fails CORS on preview hostnames; reported, not counted.
const THIRD_PARTY=/cloudflareinsights\.com|cdn-cgi\/rum|static\.cloudflareinsights/;
(async()=>{const browser=await chromium.launch();
const ctx=await browser.newContext(MOBILE?{viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3}:{viewport:{width:1440,height:900}});const P=await ctx.newPage();
const errors=[],consoleErr=[],thirdParty=[];let signedInAt=0;
P.on("pageerror",e=>errors.push(String(e.message||e)));
P.on("console",m=>{if(m.type()!=="error")return;const t=m.text(),loc=(m.location()&&m.location().url)||"";if(THIRD_PARTY.test(t+" "+loc)){thirdParty.push(t.slice(0,120));return}if(signedInAt)consoleErr.push(t.slice(0,200))});
P.on("requestfailed",r=>{if(THIRD_PARTY.test(r.url()))thirdParty.push("requestfailed "+r.url().slice(0,80))});
const wsIn=[],wsOut=[];P.on("websocket",ws=>{if(!/\/ws(\?|$)/.test(ws.url()))return;ws.on("framesent",f=>wsOut.push(String(f.payload)));ws.on("framereceived",f=>wsIn.push(String(f.payload)))});
await P.goto(base+"/#/chart",{waitUntil:"domcontentloaded"});
let em=process.env.VT_SMOKE_EMAIL,pw=process.env.VT_SMOKE_PASS;
if(!em||!pw){try{const c=JSON.parse(require("fs").readFileSync(path.join(__dirname,"..","smoke-creds.local.json"),"utf8"));em=c.email;pw=c.password}catch(_e){}}
if(!em||!pw){console.log("FAIL no test credentials (VT_SMOKE_EMAIL / VT_SMOKE_PASS or smoke-creds.local.json in the repo root)");process.exit(3)}
await P.waitForSelector("#auId",{state:"visible",timeout:20000});await P.fill("#auId",em);await P.fill("#auPw",pw);await P.click("#auBtn");
const signed=await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&!document.documentElement.classList.contains("locked"),null,{timeout:30000}).then(()=>true,()=>false);
ok("signed in with the test account",signed);if(!signed){console.log(out.join("\n"));await browser.close();process.exit(1)}
em=pw=null;signedInAt=Date.now();
// answer the storage/cookie banner like a user would (it overlays the bottom of the page until answered)
try{await P.waitForSelector("#vcb_rej",{state:"visible",timeout:8000});await P.click("#vcb_rej");await P.waitForSelector("#vcb",{state:"hidden",timeout:5000})}catch(_e){}
// the smoke account's email is unverified: dismiss the verification prompt like a user choosing "Verify later"
try{await P.waitForSelector("#vtVerifyLaterBtn",{state:"visible",timeout:6000});await P.click("#vtVerifyLaterBtn");await P.waitForSelector("#vtVerifyModalOv",{state:"detached",timeout:5000})}catch(_e){}
await P.evaluate(()=>{if(location.hash!=="#/chart")go("chart");openChart("BTCUSDT","1H")});
const wsOk=await P.waitForFunction(()=>VT_EDGE.ws&&VT_EDGE.ws.readyState===1,null,{timeout:30000}).then(()=>true,()=>false);
ok("edge WS open",wsOk);
await P.waitForFunction(()=>ch&&G&&G.a&&G.a.length>30,null,{timeout:45000}).catch(()=>{});
ok("main chart has bars",await P.evaluate(()=>!!(G&&G.a&&G.a.length>30)),await P.evaluate(()=>G&&G.a?G.a.length+" bars":"none"));

// no overlapping / clipped buttons on a view: every visible control whose centre is inside the viewport (and inside its
// scrolling ancestors) must be the topmost element there, and must not stick out of the viewport horizontally
const audit=async view=>{await P.waitForTimeout(700);return P.evaluate(()=>{
  const vw=innerWidth,vh=innerHeight,bad=[];
  const label=e=>(e.getAttribute("aria-label")||e.title||e.textContent||e.id||e.className||"").toString().trim().replace(/\s+/g," ").slice(0,40);
  const clipAnc=e=>{let r={l:0,t:0,r:vw,b:vh};for(let p=e.parentElement;p;p=p.parentElement){const cs=getComputedStyle(p);if(/(auto|scroll|hidden)/.test(cs.overflow+cs.overflowX+cs.overflowY)){const q=p.getBoundingClientRect();r={l:Math.max(r.l,q.left),t:Math.max(r.t,q.top),r:Math.min(r.r,q.right),b:Math.min(r.b,q.bottom)}}}return r};
  for(const e of document.querySelectorAll("button,a[href],[role=button],select,input[type=checkbox]")){
    const r=e.getBoundingClientRect();if(r.width<4||r.height<4)continue;const cs=getComputedStyle(e);if(cs.visibility==="hidden"||cs.display==="none"||+cs.opacity===0)continue;
    if(e.closest("#modal .ov:not(:last-child), [aria-hidden=true], .vt-pdc"))continue;
    const cd=e.closest("details:not([open])");if(cd&&!e.closest("summary"))continue; // inside a closed <details>: not rendered
    // not interactable right now (hover-revealed toolbars): an ancestor is transparent or ignores pointer events
    let hidden=false;for(let p=e;p;p=p.parentElement){const ps=getComputedStyle(p);if(+ps.opacity===0||ps.pointerEvents==="none"||ps.visibility==="hidden"){hidden=true;break}}if(hidden)continue;
    const cx=r.left+r.width/2,cy=r.top+r.height/2,c=clipAnc(e);
    if(cx<c.l||cx>c.r||cy<c.t||cy>c.b||cx<0||cy<0||cx>vw||cy>vh)continue; // scrolled out of view: not a defect
    if(r.right>vw+1||r.left<-1)bad.push("clipped: "+label(e));
    const top=document.elementFromPoint(cx,cy);if(top&&top!==e&&!e.contains(top)&&!top.contains(e)){
      // allow a button covered only by its own label/icon or by an open popover the user just opened
      if(!top.closest(".vt-pop-ov,.vt-cmd-bd,#vt_draw_flyout,.vt-auth-modal-ov,#msg"))bad.push("covered: "+label(e)+" by "+((top.id&&"#"+top.id)||top.className||top.tagName).toString().slice(0,40))}}
  const ov=document.documentElement.scrollWidth>document.documentElement.clientWidth+1;
  return{bad:[...new Set(bad)].slice(0,8),overflow:ov}})};
const answerBanner=async()=>{try{const b=await P.$("#vcb_rej");if(b&&await b.isVisible()){await b.click();await P.waitForSelector("#vcb",{state:"hidden",timeout:4000})}}catch(_e){}};
const auditView=async(name,fn)=>{await P.evaluate(fn);await P.waitForTimeout(400);await answerBanner();const a=await audit(name);ok("layout clean on "+name+" (no overlapping/clipped buttons, no horizontal scroll)",!a.bad.length&&!a.overflow,(a.overflow?"horizontal overflow; ":"")+a.bad.join(" | "))};

if(!MOBILE){
  // multi-pane layout + live pane subscription
  await P.evaluate(()=>{S.sc.syncSym=true;S.sc.syncDr=true;vtSetLayout(4)});
  const panes=await P.waitForFunction(()=>VT_LAY.panes.length===3&&VT_LAY.panes.every(p=>p.ch&&p.B),null,{timeout:45000}).then(()=>true,()=>false);
  ok("4-chart layout renders 3 panes with data",panes,await P.evaluate(()=>VT_LAY.panes.map(p=>p.sym+"|"+p.tf+":"+(p.B?p.B.a.length:0)).join(" ")));
  await P.waitForTimeout(1500);
  ok("view frame carries chart.panes",wsOut.some(m=>{try{const v=JSON.parse(m);return v.op==="view"&&v.chart&&Array.isArray(v.chart.panes)&&v.chart.panes.length===3}catch(e){return false}}));
  // drawing mirrored on panes + toggle
  await P.evaluate(()=>{const a=G.a,lo=Math.min(...a.slice(-50).map(b=>b.l)),hi=Math.max(...a.slice(-50).map(b=>b.h));S.dr.BTCUSDT=(S.dr.BTCUSDT||[]).filter(d=>d.id!==424242);
    S.dr.BTCUSDT.push({id:424242,t:"hline",p:[{t:a[a.length-20].t,y:(lo+hi)/2}],c:"#ff00ff",w:3,s:0});save()});
  await P.waitForTimeout(600);
  const mag=()=>P.evaluate(()=>{const c=document.querySelector("#sc2 .lay-cell canvas.vt-pdc");if(!c)return -1;const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i+3]>150&&d[i]>200&&d[i+1]<60&&d[i+2]>200)n++;return n});
  const m1=await mag();ok("drawing mirrored onto pane",m1>100,m1+" px");
  await P.click("#sc2 .lay-bar label.lay-dr input");await P.waitForTimeout(400);const m2=await mag();
  await P.click("#sc2 .lay-bar label.lay-dr input");await P.waitForTimeout(400);const m3=await mag();
  ok("Drawings toggle off/on",m2===0&&m3>100,m2+" / "+m3);
  await P.evaluate(()=>{S.dr.BTCUSDT=S.dr.BTCUSDT.filter(d=>d.id!==424242);save()});
  await auditView("chart (4-chart layout)",()=>{});
  await P.evaluate(()=>vtSetLayout(1));
}else{
  await P.evaluate(()=>vtSetLayout(4));await P.waitForTimeout(1500);
  ok("phone shows at most one extra pane",await P.evaluate(()=>VT_LAY.panes.length<=1),await P.evaluate(()=>String(VT_LAY.panes.length)));
  await P.evaluate(()=>vtSetLayout(1));
}

// server alerts registration
const nOut=wsOut.length;
await P.evaluate(()=>{const p=symOf("BTCUSDT")[2]||G.a[G.a.length-1].c;S.alerts=(S.alerts||[]).filter(a=>a.id!==9090909);S.alerts.push({id:9090909,sym:"BTCUSDT",price:+(p*3).toFixed(2),dir:"above",on:true,fired:false});save()});
await P.waitForTimeout(1600);
const sentAlerts=wsOut.slice(nOut).map(m=>{try{return JSON.parse(m)}catch(e){return null}}).filter(v=>v&&v.op==="alerts");
ok("alerts op sent to the hub",sentAlerts.some(v=>v.alerts.some(a=>a.id==="9090909"&&a.condition==="cross_up")));
await P.waitForTimeout(1200);
const errA=wsIn.map(m=>{try{return JSON.parse(m)}catch(e){return null}}).filter(f=>f&&f.type==="error"&&/ALERT/.test(f.code||""));
ok("hub accepted the alert (no INVALID_ALERTS)",errA.length===0,errA.map(e=>e.message).join(" | "));
ok("browser alert check removed",await P.evaluate(()=>typeof checkAlerts==="undefined"));
await P.evaluate(()=>{S.alerts=S.alerts.filter(a=>a.id!==9090909);save()});

// paper trading account (panel in the dock on desktop)
if(!MOBILE){await P.evaluate(()=>{S.sc.secs.pp=true;S.sc.dock=true;save();scDock()});
  const pp=await P.waitForFunction(()=>VT_PP.acct&&document.getElementById("dkpp")&&/Balance/.test(document.getElementById("dkpp").textContent),null,{timeout:20000}).then(()=>true,()=>false);
  ok("paper account frame received + panel rendered",pp,await P.evaluate(()=>VT_PP.acct?("balance "+VT_PP.acct.balance):"no account"));
}else ok("paper account frame received",await P.waitForFunction(()=>!!VT_PP.acct,null,{timeout:20000}).then(()=>true,()=>false));
ok("hub capabilities include alerts",wsIn.some(m=>/"type":"hello"/.test(m)&&/"alerts"/.test(m)));

// layout audit on the main views
await auditView("chart",()=>{go("chart")});
await auditView("screener",()=>{go("screener")});
await auditView("journal",()=>{go("journal")});
await auditView("backtest setup",()=>{go("backtest")});
await P.evaluate(()=>go("chart"));await P.waitForTimeout(500);

ok("no page errors",errors.length===0,errors.slice(0,3).join(" | "));
ok("zero console errors after sign-in",consoleErr.length===0,consoleErr.slice(0,4).join(" | "));
if(thirdParty.length)out.push("INFO third-party beacon noise (Cloudflare Web Analytics, not counted): "+thirdParty.length+" messages");
await P.screenshot({path:pos[1]||path.join(__dirname,"..","shots",MOBILE?"smoke-live-mobile.png":"smoke-live.png")});
console.log(out.join("\n"));await browser.close();process.exit(out.some(l=>l.startsWith("FAIL"))?1:0);
})().catch(e=>{console.error("SMOKE ERROR",e.message);console.log(out.join("\n"));process.exit(2)});
