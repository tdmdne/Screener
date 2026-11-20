// Mobile QA (touch): 390x844, 360x740 phones and a 768x1024 tablet. Every page and dialog: no page-level horizontal overflow,
// every visible control at least 44x44 (chart canvas overlays and inline text links excepted), all nav pages reachable on the tablet,
// shortcut overlay button hidden on touch, chart pan/pinch by touch, sockets untouched by page switches. Screenshots in shots/m/.
const assert=require("assert");const {launch}=require("./harness");
const PAGES=["workspace","chart","screener","heatmap","calendar","journal","calc","backtest","legal/privacy","legal/cookies","legal/your-data"];
const DLGS=[["alerts","alertsM()"],["settings","setM()"],["templates","tplM()"],["indicators","indM()"],["summary","vtSumM()"],["data","dataM()"]];
function audit(P,sc){return P.evaluate(sc=>{const W=document.documentElement.clientWidth;const root=document.querySelector(sc);if(!root)return{none:1};
  const vis=e=>{const r=e.getBoundingClientRect();if(!r.width||!r.height)return false;const c=getComputedStyle(e);if(c.visibility==="hidden"||c.display==="none")return false;return e.offsetParent!==null||c.position==="fixed"};
  const small=[];root.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role=button],[onclick]').forEach(e=>{if(!vis(e))return;
    if(e.closest("#cv,#vtmini canvas")||e.classList.contains("hmt")||e.classList.contains("mc"))return;
    if(e.tagName==="A"&&e.closest("p,li,dd,td,.lgldoc,.risk")&&!e.closest("nav"))return;
    if(/checkbox|radio/.test(e.type)&&e.closest("label"))return;
    if(e.tagName==="TR"||e.tagName==="TD"||e.tagName==="TH"||e.tagName==="DIV"&&e.querySelector("button,a,input"))return;
    const r=e.getBoundingClientRect();if(r.height<43.5||r.width<43.5)small.push((e.id?"#"+e.id:e.tagName.toLowerCase()+"."+[...e.classList].join("."))+"["+(e.getAttribute("aria-label")||e.textContent||e.value||"").trim().slice(0,16)+"] "+Math.round(r.width)+"x"+Math.round(r.height))});
  return{sw:document.documentElement.scrollWidth,W,small:[...new Set(small)]}},sc)}
async function run(W,H){const h=await launch({viewport:{width:W,height:H},mobile:true});const P=h.page;await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
await P.evaluate(()=>openChart("BTCUSDT","1H"));await P.waitForTimeout(800);
const ui=await P.evaluate(()=>document.documentElement.dataset.ui);assert.strictEqual(ui,W<600?"phone":"tablet");
const ws0=await P.evaluate(()=>(window.__w0=VT_EDGE.ws,__edge.sockets.length));const bad=[];
for(const p of PAGES){await P.evaluate(p=>{location.hash="#/"+p;scrollTo(0,0)},p);await P.waitForTimeout(800);
  const a=await audit(P,"body");if(a.sw>a.W)bad.push(p+" overflow "+a.sw);if(a.small.length)bad.push(p+": "+a.small.join(", "));
  await P.screenshot({path:`shots/m/qa_${W}_${p.replace(/\W/g,"_")}.png`})}
await P.evaluate(()=>{location.hash="#/chart"});await P.waitForTimeout(700);
for(const [n,f] of DLGS){await P.evaluate(f);await P.waitForTimeout(500);const a=await audit(P,"#modal");
  if(a.sw>a.W)bad.push("dlg "+n+" overflow");if(a.small.length)bad.push("dlg "+n+": "+a.small.join(", "));
  const fit=await P.evaluate(()=>{const b=document.querySelector("#modal .box").getBoundingClientRect();return b.left>=-1&&b.right<=innerWidth+1});assert(fit,n+" dialog fits the screen");
  await P.screenshot({path:`shots/m/qa_${W}_dlg_${n}.png`});await P.evaluate(()=>closeM());await P.waitForTimeout(150)}
// sound row inside Alerts
await P.evaluate(()=>alertsM());await P.waitForTimeout(400);assert(await P.evaluate(()=>!!document.querySelector("#snd_on")),"sound row in alerts");await P.evaluate(()=>closeM());
// position tool settings
await P.evaluate(()=>{const s=symOf("BTCUSDT"),a=candles(s,"1H"),n=a.length,E=a[n-10].c;S.dr.BTCUSDT=[{id:5,t:"long",p:[{t:a[n-10].t,y:E},{t:a[n-1].t,y:E*1.05},{t:a[n-1].t,y:E*.97}]}];save();drawChart();posSetM(S.dr.BTCUSDT[0])});
await P.waitForTimeout(450);let a=await audit(P,"#modal");if(a.small.length)bad.push("dlg position: "+a.small.join(", "));await P.screenshot({path:`shots/m/qa_${W}_dlg_position.png`});await P.evaluate(()=>closeM());
// mini charts
await P.evaluate(()=>{location.hash="#/workspace";S.mini.on=true;save();miniSync&&miniSync()});await P.waitForTimeout(900);
a=await audit(P,"body");if(a.sw>a.W)bad.push("mini overflow");if(a.small.length)bad.push("mini: "+a.small.join(", "));await P.screenshot({path:`shots/m/qa_${W}_mini.png`});
await P.evaluate(()=>{S.mini.on=false;save();miniSync&&miniSync()});
// shortcut overlay: footer button hidden on touch; overlay (keyboard only) still fits if opened
assert(await P.evaluate(()=>{const b=document.querySelector("#vft_kb");return !b||!b.offsetParent}),"shortcut button hidden on touch");
await P.evaluate(()=>vtKbOpen());await P.waitForTimeout(400);a=await audit(P,"#modal");if(a.small.length)bad.push("dlg shortcuts: "+a.small.join(", "));await P.evaluate(()=>closeM());
// navigation: phone bottom bar + More sheet reach every page; tablet nav shows every page without sideways scrolling
if(ui==="phone"){await P.evaluate(()=>vtMoreOpen());await P.waitForTimeout(400);a=await audit(P,"#vmore");if(a.small&&a.small.length)bad.push("more: "+a.small.join(", "));
  await P.screenshot({path:`shots/m/qa_${W}_more.png`});const reach=await P.evaluate(()=>{const hs=new Set([...document.querySelectorAll("#vnav a,#vmore a")].map(a=>a.getAttribute("href")));return ["workspace","chart","screener","heatmap","calendar","journal","calc","backtest"].filter(p=>!hs.has("#/"+p))});
  assert.deepStrictEqual(reach,[],"phone nav reaches every page");await P.keyboard.press("Escape");await P.evaluate(()=>{const m=document.querySelector("#vmore");if(m&&m.offsetParent&&window.vtMoreClose)vtMoreClose()})}
else{const n=await P.evaluate(()=>{const v=document.querySelector("#vnav");return{sw:v.scrollWidth,cw:v.clientWidth,hidden:[...v.querySelectorAll("a")].filter(a=>{const r=a.getBoundingClientRect();return r.right>innerWidth||r.left<0}).length}});
  assert(n.sw<=n.cw+1&&n.hidden===0,"tablet nav shows every page "+JSON.stringify(n));
  const cv=await P.evaluate(()=>{location.hash="#/chart";return 0});await P.waitForTimeout(700);
  const t=await P.evaluate(()=>({cv:document.querySelector("#cv").offsetHeight,tb:document.querySelector(".tbar").scrollHeight>document.querySelector(".tbar").clientHeight?"scroll":"fit",tbh:document.querySelector(".tbar").clientHeight}));
  assert(t.cv>=500,"tablet chart is tall "+JSON.stringify(t));assert(t.tbh<=t.cv+80,"tool column no taller than the chart "+JSON.stringify(t))}
// phone chart header starts at the left edge
if(ui==="phone"){await P.evaluate(()=>{location.hash="#/chart"});await P.waitForTimeout(600);const x=await P.evaluate(()=>{const s=document.querySelector("#wst"),r=s.parentElement.getBoundingClientRect();return s.getBoundingClientRect().left-r.left});assert(x<30,"star button left-aligned "+x)}
// touch gestures on the chart
await P.evaluate(()=>{location.hash="#/chart"});await P.waitForTimeout(600);await P.evaluate(()=>document.querySelector("#cv").scrollIntoView({block:"center"}));await P.waitForTimeout(300);
const cdp=await P.context().newCDPSession(P);const touch=(type,pts)=>cdp.send("Input.dispatchTouchEvent",{type,touchPoints:pts.map(([x,y],i)=>({x,y,id:i}))});
const box=await P.locator("#cv").boundingBox();const pw=await P.evaluate(()=>ch.timeScale().width());const cy=box.y+box.height*0.45;
const rng=()=>P.evaluate(()=>{const r=ch.timeScale().getVisibleLogicalRange();return[r.from,r.to]});
let r0=await rng();await touch("touchStart",[[box.x+pw*0.7,cy]]);for(let i=1;i<=8;i++){await touch("touchMove",[[box.x+pw*0.7-i*15,cy]]);await P.waitForTimeout(16)}await touch("touchEnd",[]);await P.waitForTimeout(500);
let r1=await rng();assert(Math.abs(r1[0]-r0[0])>2,"pan moved the chart");
r0=r1;await touch("touchStart",[[box.x+pw*0.45,cy],[box.x+pw*0.55,cy]]);for(let i=1;i<=8;i++){await touch("touchMove",[[box.x+pw*0.45-i*10,cy],[box.x+pw*0.55+i*10,cy]]);await P.waitForTimeout(16)}await touch("touchEnd",[]);await P.waitForTimeout(400);
r1=await rng();assert(r1[1]-r1[0]<(r0[1]-r0[0])*0.9,"pinch zoomed in");await P.screenshot({path:`shots/m/qa_${W}_chart_touch.png`});
// sign-in screen
const ws1=await P.evaluate(n=>VT_EDGE.ws===__w0&&__edge.sockets.length===n,ws0);assert(ws1,"websockets untouched by page switches");
console.log(W+"x"+H,ui,bad.length?bad:"all targets >=44px, no overflow");assert.deepStrictEqual(bad,[]);
assert(!h.errors.length&&!h.consoleErr.length,JSON.stringify([h.errors,h.consoleErr]));await h.close();
const g=await launch({viewport:{width:W,height:H},mobile:true,auth:false});await g.page.goto(g.base);await g.page.waitForTimeout(1200);
const s=await audit(g.page,"body");await g.page.screenshot({path:`shots/m/qa_${W}_signin.png`});assert(s.sw<=s.W&&!s.small.length,"sign-in "+JSON.stringify(s));await g.close()}
(async()=>{await run(390,844);await run(360,740);await run(768,1024);console.log("MOBILE QA OK")})().catch(e=>{console.error(e);process.exit(1)});
