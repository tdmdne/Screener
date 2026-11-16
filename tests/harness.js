// Test harness: serves index.html locally, mocks CDNs, Binance REST and WebSockets.
const http=require("http"),fs=require("fs"),path=require("path");
const {chromium}=require("playwright");
const ROOT=path.resolve(__dirname,"..");
function serve(){return new Promise(r=>{const s=http.createServer((q,res)=>{let p=decodeURIComponent(q.url.split("?")[0]);if(p==="/")p="/index.html";const f=path.join(ROOT,p);
if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end();return}
res.writeHead(200,{"content-type":f.endsWith(".html")?"text/html":f.endsWith(".js")?"application/javascript":"application/json"});fs.createReadStream(f).pipe(res)});s.listen(0,()=>r(s))})}
function genK(sym,n,step){let p=100+(sym.charCodeAt(0)%50),out=[];const now=Math.floor(Date.now()/1000/step)*step;let seed=sym.split("").reduce((a,c)=>a*31+c.charCodeAt(0),7)>>>0;
const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
for(let i=0;i<n;i++){const o=p,c=o*(1+(rnd()-.48)*.03),h=Math.max(o,c)*(1+rnd()*.01),l=Math.min(o,c)*(1-rnd()*.01);out.push([(now-(n-1-i)*step)*1000,o.toFixed(4),h.toFixed(4),l.toFixed(4),c.toFixed(4),(1000+rnd()*5000).toFixed(2)]);p=c}return out}
const STEPS={"1m":60,"5m":300,"15m":900,"30m":1800,"1h":3600,"4h":14400,"1d":86400,"1w":604800,"1M":2592000};
const CRY=["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT","LINKUSDT","DOTUSDT","LTCUSDT","TRXUSDT"];
const WSMOCK=`(()=>{const ALL=[];window.__WS=ALL;class FakeWS{constructor(u){this.url=u;this.readyState=0;this.sent=[];ALL.push(this);setTimeout(()=>{if(this.readyState===0){this.readyState=1;this.onopen&&this.onopen({})}},50);
if(/!ticker@arr/.test(u))this._iv=setInterval(()=>{if(this.readyState!==1)return;const d=${JSON.stringify(CRY)}.map((s,i)=>({s,c:String(100+i+Math.random()),h:"999999",l:"0.0001"}));this.onmessage&&this.onmessage({data:JSON.stringify(d)})},500)}
send(m){this.sent.push(m)}close(){if(this.readyState===3)return;this.readyState=3;clearInterval(this._iv);setTimeout(()=>this.onclose&&this.onclose({}),0)}}
FakeWS.OPEN=1;window.WebSocket=FakeWS})();`;
async function launch(opts={}){
  const srv=await serve(),port=srv.address().port;
  const browser=await chromium.launch();
  const ctx=await browser.newContext(Object.assign({viewport:opts.viewport||{width:1600,height:950},colorScheme:opts.colorScheme||"dark",reducedMotion:opts.reducedMotion||"no-preference"},opts.mobile?{hasTouch:true,isMobile:true,deviceScaleFactor:opts.dsf||1}:{}));
  await ctx.addInitScript(WSMOCK);
  await ctx.addInitScript(({mode,state,consent,auth})=>{if(auth!==false&&!localStorage.getItem("scr2a"))localStorage.setItem("scr2a",JSON.stringify({id:"tester"}));
    if(consent!==false&&!localStorage.getItem("__cseed")){localStorage.setItem("__cseed","1");localStorage.setItem("vt_consent",JSON.stringify({v:"1.0",ts:Date.now(),cache:true,method:"test"}))}
    if(state&&!localStorage.getItem("__seeded")){localStorage.setItem("__seeded","1");localStorage.setItem("scr2",JSON.stringify(state))}},{mode:opts.mode,state:opts.state||null,consent:opts.consent,auth:opts.auth});
  await ctx.route("**/*",route=>{const u=route.request().url();
    if(u.startsWith("http://127.0.0.1:"+port+"/config.local.js"))return route.fulfill({contentType:"application/javascript",body:opts.config?"window.VT_CONFIG="+JSON.stringify(opts.config)+";":"/* no local config in tests */"});
    if(u.startsWith("http://127.0.0.1:"+port))return route.continue();
    const V=f=>fs.existsSync(path.join(__dirname,"vendor",f));
    if(u.includes("lightweight-charts"))return V("lwc.js")?route.fulfill({path:path.join(__dirname,"vendor/lwc.js"),contentType:"application/javascript"}):route.continue();
    if(u.includes("html2canvas"))return V("h2c.js")?route.fulfill({path:path.join(__dirname,"vendor/h2c.js"),contentType:"application/javascript"}):route.continue();
    if(/binance\.(vision|com)\/api\/v3\/ticker\/24hr/.test(u))return route.fulfill({contentType:"application/json",body:JSON.stringify(CRY.map((s,i)=>({symbol:s,lastPrice:String(100+i),volume:String(1e6/(i+1)),quoteVolume:String(1e8/(i+1))})))});
    if(/binance\.(vision|com)\/api\/v3\/klines/.test(u)){const q=new URL(u).searchParams;return route.fulfill({contentType:"application/json",body:JSON.stringify(genK(q.get("symbol"),250,STEPS[q.get("interval")]||3600))})}
    if(opts.calendar&&/ff_calendar_thisweek/.test(u))return route.fulfill({contentType:"application/json",body:opts.calendar});
    return route.abort()});
  const page=await ctx.newPage();
  const errors=[],consoleErr=[];
  page.on("pageerror",e=>errors.push(String(e&&e.stack||e)));
  page.on("console",m=>{if(m.type()==="error"){const t=m.text();if(!/Failed to load resource|net::ERR|ERR_FAILED|CORS|blocked/i.test(t))consoleErr.push(t)}});
  const base="http://127.0.0.1:"+port+"/index.html";
  return {browser,ctx,page,errors,consoleErr,base,close:async()=>{await browser.close();srv.close()}};
}
module.exports={launch,ROOT};
