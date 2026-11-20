// Test harness: serves index.html locally, mocks CDNs and the unified edge (same-origin /api/* + a protocol-v2 /ws); every non-origin request is blocked and recorded in h.offOrigin.
const http=require("http"),fs=require("fs"),path=require("path");
const {chromium}=require("playwright");
const ROOT=path.resolve(__dirname,"..");
function serve(){return new Promise(r=>{const s=http.createServer((q,res)=>{let p=decodeURIComponent(q.url.split("?")[0]);if(p==="/")p="/index.html";const f=path.join(ROOT,p);
if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end();return}
res.writeHead(200,{"content-type":f.endsWith(".html")?"text/html":f.endsWith(".js")?"application/javascript":f.endsWith(".css")?"text/css":"application/json"});fs.createReadStream(f).pipe(res)});s.listen(0,()=>r(s))})}
function genBars(sym,n,step){let p=100+(sym.charCodeAt(0)%50),out=[];const now=Math.floor(Date.now()/1000/step)*step;let seed=sym.split("").reduce((a,c)=>a*31+c.charCodeAt(0),7)>>>0;
const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
for(let i=0;i<n;i++){const o=p,c=o*(1+(rnd()-.48)*.03),h=Math.max(o,c)*(1+rnd()*.01),l=Math.min(o,c)*(1-rnd()*.01);out.push({t:now-(n-1-i)*step,o:+o.toFixed(4),h:+h.toFixed(4),l:+l.toFixed(4),c:+c.toFixed(4),v:+(1000+rnd()*5000).toFixed(2)});p=c}return out}
const STEPS={"1m":60,"5m":300,"15m":900,"30m":1800,"1H":3600,"4H":14400,"1D":86400,"1W":604800,"1M":2592000,"1h":3600,"4h":14400,"1d":86400,"1w":604800};
const CRY=["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","DOTUSDT","LTCUSDT","TRXUSDT"];
// /api/screener universe rows: [sym, market, price, vol, prec, tick, apiSym, exch, src, id, name, exchange, pct]
const UNIVERSE=CRY.map((s,i)=>[s,"CRY",100+i,1e8/(i+1),2,0.01,s,"BINANCE","bn",s,s.replace(/USDT$/,"")+" / Tether","BINANCE",0]);
// Unified edge mock: the browser's only peer is its own origin. window.__edge.sockets records every /ws socket the page opens
// (the page must never open any other); __edge.push(frame) delivers a protocol-v2 frame exactly as the vektor-market hub would.
const EDGEMOCK=`(()=>{const E={sockets:[],sent:[],seq:0,
  frame(type,body){return Object.assign({v:2,seq:++E.seq,type,asOf:Date.now()},body||{})},
  push(f,ws){const w=ws||E.sockets[E.sockets.length-1];if(!w||w.readyState!==1||!w.onmessage)return false;w.onmessage({data:JSON.stringify(f)});return true},
  quotes(list,ws){return E.push(E.frame("quotes",{quotes:list.map(q=>Object.assign({t:Date.now()},q))}),ws)},
  // candle history as /api/candles would return it for a symbol: n bars ending now, oldest first
  bars(tf,base,n){const step=(window.STEP&&window.STEP[tf])||3600,now=Math.floor(Date.now()/1000/step)*step,out=[];
    for(let i=0;i<n;i++){const o=base*(1+0.003*Math.sin(i/3)),c=base*(1+0.003*Math.sin((i+1)/3));out.push({t:now-(n-1-i)*step,o,h:Math.max(o,c)*1.001,l:Math.min(o,c)*.999,c,v:1000+i})}return out},
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
  const offOrigin=[];
  await ctx.route("**/*",route=>{const u=route.request().url();
    if(u.startsWith("http://127.0.0.1:"+port+"/config.local.js"))return route.fulfill({contentType:"application/javascript",body:opts.config?"window.VT_CONFIG="+JSON.stringify(opts.config)+";":"/* no local config in tests */"});
    if(u.startsWith("http://127.0.0.1:"+port+"/api/")){const q=new URL(u);const j=o=>route.fulfill({contentType:"application/json",body:JSON.stringify(o)});
      if(q.pathname==="/api/screener")return j({ok:true,ts:Date.now(),tfs:["1D","1H"],universe:UNIVERSE});
      if(q.pathname==="/api/candles"){const tf=q.searchParams.get("interval")||"1H";return j({ok:true,bars:genBars(q.searchParams.get("symbol")||"BTCUSDT",250,STEPS[tf]||3600),hasMore:false})}
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
  return {browser,ctx,page,errors,consoleErr,offOrigin,base,app,close:async()=>{await browser.close();srv.close()}};
}
module.exports={launch,ROOT};
