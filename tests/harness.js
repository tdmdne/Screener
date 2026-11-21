// Test harness: serves index.html locally, mocks CDNs and the unified edge (same-origin /api/* + a protocol-v2 /ws); every non-origin request is blocked and recorded in h.offOrigin.
const http=require("http"),fs=require("fs"),path=require("path");
const {chromium}=require("playwright");
// Server-side indicator maths for the /api/candles?ind= mock: the exact module the Pages Function uses (Tasks 9/11).
const {parseIndicatorList,buildIndicatorSeries}=require("../shared/market/chartIndicators.js");
// Server-side chart transforms (E-10 Renko / Line Break) for /api/candles?type=: same module as the Pages Function.
const {parseChartTransform,applyChartTransform}=require("../shared/market/chartTransforms.js");
const {parseVolumeProfileQuery,volumeProfile}=require("../shared/market/volumeProfile.js");
// /api/vs/run mock (E-12 strategy tester): the same server-side VS engine + backtest as the Pages Function.
const {vsCompute}=require("../shared/vs/index.js");const {vsBacktest}=require("../shared/vs/strategy.js");
const ROOT=path.resolve(__dirname,"..");
function serve(){return new Promise(r=>{const s=http.createServer((q,res)=>{let p=decodeURIComponent(q.url.split("?")[0]);if(p==="/")p="/index.html";const f=path.join(ROOT,p);
if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end();return}
res.writeHead(200,{"content-type":f.endsWith(".html")?"text/html":f.endsWith(".js")?"application/javascript":f.endsWith(".css")?"text/css":"application/json"});fs.createReadStream(f).pipe(res)});s.listen(0,()=>r(s))})}
const FXP={GBPUSD:1.27,EURUSD:1.08,USDJPY:151.2,AUDUSD:0.65};
function genBars(sym,n,step){const fx=FXP[sym];let p=fx||100+(sym.charCodeAt(0)%50),out=[];const vol=fx?0.0012:0.03;const now=Math.floor(Date.now()/1000/step)*step;let seed=sym.split("").reduce((a,c)=>a*31+c.charCodeAt(0),7)>>>0;
const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
for(let i=0;i<n;i++){const o=p,c=o*(1+(rnd()-.5)*vol),h=Math.max(o,c)*(1+rnd()*vol/3),l=Math.min(o,c)*(1-rnd()*vol/3);out.push({t:now-(n-1-i)*step,o:+o.toFixed(5),h:+h.toFixed(5),l:+l.toFixed(5),c:+c.toFixed(5),v:+(1000+rnd()*5000).toFixed(2)});p=c}return out}
const STEPS={"1m":60,"5m":300,"15m":900,"30m":1800,"1H":3600,"4H":14400,"1D":86400,"1W":604800,"1M":2592000,"1h":3600,"4h":14400,"1d":86400,"1w":604800};
const CRY=["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","DOTUSDT","LTCUSDT","TRXUSDT"];
// /api/screener universe rows: [sym, market, price, vol, prec, tick, apiSym, exch, src, id, name, exchange, pct]
const FXU=Object.keys(FXP).map(s=>[s,"FX",FXP[s],0,5,0.00001,s,"",  "td",s,s.slice(0,3)+" / "+s.slice(3),"FOREX",0]);
const UNIVERSE=FXU.concat(CRY.map((s,i)=>[s,"CRY",100+i,1e8/(i+1),2,0.01,s,"BINANCE","bn",s,s.replace(/USDT$/,"")+" / Tether","BINANCE",0]));
// Unified edge mock: the browser's only peer is its own origin. window.__edge.sockets records every /ws socket the page opens
// (the page must never open any other); __edge.push(frame) delivers a protocol-v2 frame exactly as the vektor-market hub would.
const EDGEMOCK=`(()=>{const E={sockets:[],sent:[],seq:0,
  frame(type,body){return Object.assign({v:2,seq:++E.seq,type,asOf:Date.now()},body||{})},
  push(f,ws){const w=ws||E.sockets[E.sockets.length-1];if(!w||w.readyState!==1||!w.onmessage)return false;w.onmessage({data:JSON.stringify(f)});return true},
  quotes(list,ws){return E.push(E.frame("quotes",{quotes:list.map(q=>Object.assign({t:Date.now()},q))}),ws)},
  // candle history as /api/candles would return it for a symbol: n bars ending now, oldest first
  bars(tf,base,n,sym){const step=(typeof STEP!=="undefined"&&STEP[tf])||3600,now=Math.floor(Date.now()/1000/step)*step,out=[];
    const h=String(sym||"").split("").reduce((a,c)=>a+c.charCodeAt(0),0),ph=h%17,amp=0.003*(1+(h%5)/4); // distinct per symbol so rankings have no ties
    for(let i=0;i<n;i++){const o=base*(1+amp*Math.sin((i+ph)/3)),c=base*(1+amp*Math.sin((i+1+ph)/3));out.push({t:now-(n-1-i)*step,o,h:Math.max(o,c)*1.001,l:Math.min(o,c)*.999,c,v:1000+i})}return out},
  status(provenance,feeds,ws){return E.push(E.frame("status",{provenance,feeds:feeds||{}}),ws)}};
window.__edge=E;
class FakeWS{constructor(u){this.url=u;this.readyState=0;E.sockets.push(this);setTimeout(()=>{if(this.readyState===0){this.readyState=1;this.onopen&&this.onopen({});
  setTimeout(()=>{E.push(E.frame("hello",{}),this);E.push(E.frame("status",{provenance:"LIVE",feeds:{binance:"LIVE"}}),this)},0)}},50)}
  send(m){E.sent.push(m)}close(){if(this.readyState===3)return;this.readyState=3;setTimeout(()=>this.onclose&&this.onclose({}),0)}}
FakeWS.OPEN=1;FakeWS.CONNECTING=0;FakeWS.CLOSING=2;FakeWS.CLOSED=3;window.WebSocket=FakeWS})();`;
async function launch(opts={}){
  const srv=await serve(),port=srv.address().port;
  const browser=await chromium.launch();
  const ctx=await browser.newContext(Object.assign({viewport:opts.viewport||{width:1600,height:950},colorScheme:opts.colorScheme||"dark",reducedMotion:opts.reducedMotion||"no-preference"},opts.mobile?{hasTouch:true,isMobile:true,deviceScaleFactor:opts.dsf||1}:{}));
  await ctx.addInitScript(EDGEMOCK);
  await ctx.addInitScript(({mode,state,consent,auth})=>{if(auth!==false&&!localStorage.getItem("scr2a"))localStorage.setItem("scr2a",JSON.stringify({id:"tester"}));
    if(consent!==false&&!localStorage.getItem("__cseed")){localStorage.setItem("__cseed","1");localStorage.setItem("vt_consent",JSON.stringify({v:"1.1",ts:Date.now(),cache:true,method:"test"}))}
    if(state&&!localStorage.getItem("__seeded")){localStorage.setItem("__seeded","1");localStorage.setItem("scr2",JSON.stringify(state))}},{mode:opts.mode,state:opts.state||null,consent:opts.consent,auth:opts.auth});
  const offOrigin=[],candleCalls=[],vsRuns=[]; // candleCalls: query strings of /api/candles?ind= requests (server-indicator path)
  // Opt-in D1 auth mock (`launch({d1:true})`): stateful same-origin /api/auth/{providers,me,login,logout}, mirroring the real
  // Worker contract (login needs a valid email; password "wrong" -> 401). Off by default: with it on, /api/auth/me answers 401 for
  // signed-out visitors, which clears the legacy `scr2a` marker the auth:true suites rely on.
  const d1={session:null,calls:[],users:{}};
  const d1User=email=>({id:"u_"+email,email,username:email.split("@")[0].replace(/[^A-Za-z0-9_]/g,"_"),full_name:email.split("@")[0],role:"user",plan:"free",profile_completed:true,email_verified:true,phone_verified:true});
  const d1Api=(q,route)=>{const m=route.request().method();d1.calls.push(m+" "+q.pathname);const j=(o,status)=>route.fulfill({status:status||200,contentType:"application/json",body:JSON.stringify(o)});
    if(q.pathname==="/api/auth/providers")return j({ok:true,providers:{email:true,google:false,apple:false}});
    if(q.pathname==="/api/auth/me")return d1.session?j({ok:true,user:d1.session}):j({ok:false,error:"Authentication required."},401);
    if(q.pathname==="/api/auth/login"&&m==="POST"){let b={};try{b=JSON.parse(route.request().postData()||"{}")}catch(_e){}
      if(!b.email||!b.password||b.password==="wrong")return j({ok:false,error:"Invalid email or password."},401);
      d1.session=d1.users[b.email]||(d1.users[b.email]=d1User(String(b.email)));return j({ok:true,user:d1.session})}
    if(q.pathname==="/api/auth/logout"&&m==="POST"){d1.session=null;return j({ok:true})}
    return j({ok:false,error:"Not found"},404)};
  await ctx.route("**/*",route=>{const u=route.request().url();
    if(u.startsWith("http://127.0.0.1:"+port+"/config.local.js"))return route.fulfill({contentType:"application/javascript",body:opts.config?"window.VT_CONFIG="+JSON.stringify(opts.config)+";":"/* no local config in tests */"});
    if(u.startsWith("http://127.0.0.1:"+port+"/api/")){const q=new URL(u);const j=o=>route.fulfill({contentType:"application/json",body:JSON.stringify(o)});
      if(opts.d1&&q.pathname.startsWith("/api/auth/"))return d1Api(q,route);
      if(q.pathname==="/api/screener")return j({ok:true,ts:Date.now(),tfs:["1D","1H"],universe:UNIVERSE});
      if(q.pathname==="/api/vs/run"){let b={};try{b=JSON.parse(route.request().postData()||"{}")}catch(e){}vsRuns.push(b);
        const res=vsCompute(b.src||"",Array.isArray(b.bars)?b.bars:[],{inputs:b.inputs||{}});
        if(res.error!==null)return route.fulfill({status:422,contentType:"application/json",body:JSON.stringify({ok:false,error:res.error,line:res.line,col:res.col,hint:res.hint})});
        const o=res.ok;return j({ok:true,name:o.name,overlay:o.overlay,plots:o.plots.map(p=>({title:p.title,color:p.color,v:Array.from(p.v,x=>Number.isFinite(x)?x:null)})),hlines:o.hlines,inputs:o.inputs,
          ...(o.signals&&Object.keys(o.signals).length?{strategy:vsBacktest(b.bars,o.signals,b.strategy||{})}:{})})}
      if(q.pathname==="/api/candles"){const tf=q.searchParams.get("interval")||"1H",bars=genBars(q.searchParams.get("symbol")||"BTCUSDT",250,STEPS[tf]||3600);
        const vpq=parseVolumeProfileQuery(q.searchParams);if(vpq){if(!vpq.ok)return route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({ok:false,error:vpq.error})});
          candleCalls.push(q.search);return j({ok:true,vp:volumeProfile(bars,{rows:vpq.rows,from:vpq.from,to:vpq.to})})}
        const xf=parseChartTransform(q.searchParams);if(xf){if(!xf.ok)return route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({ok:false,error:xf.error})});
          candleCalls.push(q.search);const o=applyChartTransform(bars,xf);return j({ok:true,bars:o.bars,hasMore:false,transform:o.meta})}
        const ind=q.searchParams.getAll("ind");if(!ind.length)return j({ok:true,bars,hasMore:false});
        const p=parseIndicatorList(ind);if(!p.ok)return route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({ok:false,error:p.error})});
        candleCalls.push(q.search);return j({ok:true,bars,hasMore:false,ind:buildIndicatorSeries(bars,p.specs)})}
      return route.fulfill({status:404,contentType:"application/json",body:JSON.stringify({ok:false})})}
    if(u.startsWith("http://127.0.0.1:"+port+"/ws"))return route.abort();
    if(u.startsWith("http://127.0.0.1:"+port))return route.continue();
    const V=f=>fs.existsSync(path.join(__dirname,"vendor",f));
    if(u.includes("lightweight-charts"))return V("lwc.js")?route.fulfill({path:path.join(__dirname,"vendor/lwc.js"),contentType:"application/javascript"}):route.continue();
    if(u.includes("html2canvas"))return V("h2c.js")?route.fulfill({path:path.join(__dirname,"vendor/h2c.js"),contentType:"application/javascript"}):route.continue();
    if(opts.calendar&&/ff_calendar_thisweek/.test(u))return route.fulfill({contentType:"application/json",body:opts.calendar});
    offOrigin.push(u);return route.abort()});
  const page=await ctx.newPage();
  const errors=[],consoleErr=[];
  page.on("pageerror",e=>errors.push(String(e&&e.stack||e)));
  page.on("console",m=>{if(m.type()==="error"){const t=m.text();if(!/Failed to load resource|net::ERR|ERR_FAILED|CORS|blocked/i.test(t))consoleErr.push(t)}});
  const base="http://127.0.0.1:"+port+"/index.html";
  // "/" is the public landing page (no terminal, no /ws); tests that need the terminal open `app`
  const app=base+"#/workspace";
  // The edge client only fetches candles for the active chart (card/heatmap data is server-side, Task 13). Tests that need
  // history for every symbol merge what /api/candles would return: `await h.seedBars("1D",40)`.
  const seedBars=(tf,n)=>page.evaluate(({tf,n})=>{for(const s of SYMS)vtSetServerBars(s[0]+"|"+tf,__edge.bars(tf,s[2]||1,n||40,s[0]));if(typeof render==="function")render()},{tf,n});
  return {browser,ctx,page,errors,consoleErr,offOrigin,candleCalls,vsRuns,seedBars,d1,base,app,close:async()=>{await browser.close();srv.close()}};
}
module.exports={launch,ROOT};
