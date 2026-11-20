// Same-origin edge policy (§0): browser never fetches third-party market APIs directly.
// ---------- WebSocket connection health monitor ----------
let FAILOVER={on:false,since:0,lastOk:Date.now(),reason:""};
function markOk(){
  FAILOVER.lastOk=Date.now();
  if(FAILOVER.on){FAILOVER.on=false;FAILOVER.reason="";status();const tag=document.getElementById("tag");if(tag&&isLive())tag.textContent="Live · auto-scan";}
}
function checkFailover(){
  if(!isLive())return;
  const wsUp=typeof VT_EDGE!=="undefined"&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1;
  if(wsUp&&VT_EDGE.wsLastMsgAt>FAILOVER.lastOk)FAILOVER.lastOk=VT_EDGE.wsLastMsgAt;
  const silent=Date.now()-FAILOVER.lastOk;
  if(!wsUp&&silent>15000&&!FAILOVER.on){
    FAILOVER.on=true;FAILOVER.since=Date.now();
    FAILOVER.reason="websocket reconnecting";
    status();
    tick();
  }
}
setInterval(checkFailover,2000);

function setLive(){try{if(SNAP.ok&&Array.isArray(SNAP.uni)&&SNAP.uni.length){SYMS=SNAP.uni.map(s=>{if(!Array.isArray(s)||!s[0])return null;const d=LIVE[s[0]+"|1D"];if(!(s[2]>0)&&d&&d.length&&d[d.length-1].c>0)s[2]=d[d.length-1].c;return s}).filter(Boolean);if(SYMS.length)return}const mk2=(w,p,ps,fb)=>{const d=LIVE[w.n+"|1D"],ok=d&&d.length;const v=ok&&(w.m==="STK"||w.m==="ETF"||w.m==="FUT")?d.slice(-7).reduce((x,y)=>x+y.v,0)/Math.min(7,d.length):0;return[w.n,w.m,ok?d[d.length-1].c:null,v,1,.01,ps,w.tv,p,fb]};
const seen=new Set(),out=[];
const add=arr=>{if(!Array.isArray(arr))return;for(const s of arr){if(!s||!s[0]||seen.has(s[0]))continue;seen.add(s[0]);out.push(s)}};
add(BN.list);
add(FXW.map(w=>mk2(w,"yf",w.td.replace("/","")+"=X",w.td)));
add(YFW.map(w=>mk2(w,"yf",w.td)));
SYMS=out;}catch(e){console.error("setLive error:",e);if(!Array.isArray(SYMS))SYMS=[];}}
function status(){const d=document.getElementById("dst");if(!d)return;if(!isLive()){d.textContent="";d.title="";if(typeof vtRenderGapBadge==="function")vtRenderGapBadge();return}
const lt=Math.max(0,...Object.values(LT)),n=typeof QE!=="undefined"?QE.length:0,ne=Object.keys(ERR).length,e=Object.values(ERR)[0];
const full=(n?"Syncing "+n+" feeds":"")+(ne?" · "+ne+" feed"+(ne===1?"":"s")+" offline ("+e+")":"")+(!n&&(snapOn()||lt)?" · Updated "+ago(snapOn()?SNAP.t:lt):"");
d.title=full.replace(/^\s*·\s*/,"").trim();
let calm="";
if(n>0)calm="Syncing";
else if(snapOn()||lt)calm="Updated "+ago(snapOn()?SNAP.t:lt);
else calm="";
d.textContent=calm;
if(typeof vtRenderGapBadge==="function")vtRenderGapBadge()}
// REST /api/candles is strictly for initial historical candle seeding on chart/timeframe load.
function need(s,tf,front){const k=s[0]+"|"+tf;if(PEND[k]||ERR[k]||(LIVE[k]&&(Date.now()-(LT[k]||0)<ttl(k)||(SN[k]&&snapOn()))))return;if(typeof vtCanUseEdge==="function"&&vtCanUseEdge()){const isActive=(S.chart&&S.chart.sym===s[0]&&S.chart.tf===tf)||(S.pageView==="chart"&&S.sc&&S.sc.panes===2&&S.chart&&S.chart.sym===s[0]&&S.sc.tfB===tf);if(!isActive&&!front)return;PEND[k]=1;front?QE.unshift([s,tf,k]):QE.push([s,tf,k]);pumpEdge();return}}
function retryErr(re){for(const k in ERR)if(!re||re.test(ERR[k]))delete ERR[k];render()}
let IDB=null,READY=false,fl=0;const DIRTY=new Set();
const ago=t=>{const m=Math.round((Date.now()-t)/6e4);return m<1?"just now":m<60?m+" min ago":Math.round(m/60)+" h ago"};
function idb(){return new Promise(res=>{try{const r=indexedDB.open("scr",2);r.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains("c"))db.createObjectStore("c");};r.onsuccess=()=>res(r.result);r.onerror=()=>res(null)}catch(e){res(null)}})}
function persistUni(){
  // rebuild the merged universe first, so the snapshot includes the list that just loaded
  const was=SNAP.ok;SNAP.ok=false;setLive();
  if(!SYMS||!SYMS.length){SNAP.ok=was;return}
  SNAP.uni=SYMS.map(s=>s.slice());
  SNAP.t=Date.now();
  SNAP.ok=true;
  dirtySnap();
}
async function loadCache(){try{IDB=await idb();if(IDB){await new Promise(done=>{const q=IDB.transaction("c").objectStore("c").openCursor();
q.onsuccess=()=>{const c=q.result;if(!c){done();return}const k=c.key,v=c.value;
if(k==="@bn"){BN.list=v.list||[];BN.loaded=Date.now()-v.t<9e5}
else if(k==="@snap"){SNAP.t=v.t||0;SNAP.tfs=v.tfs||[];SNAP.uni=v.uni||[];SNAP.ok=!!SNAP.uni.length}
else{LIVE[k]=v.d;LT[k]=v.t}c.continue()};q.onerror=()=>done()});
// Instant restore: if we have a cached universe, use it immediately
if(SNAP.ok&&SNAP.uni.length){SYMS=SNAP.uni.map(s=>{const d=LIVE[s[0]+"|1D"];if(d&&d.length)s[2]=d[d.length-1].c;return s});}
try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}}}catch(e){}}
function dirty(k){DIRTY.add(k);clearTimeout(fl);fl=setTimeout(flush,2000)}
function dirtySnap(){DIRTY.add("@snap");clearTimeout(fl);fl=setTimeout(flush,2000)}
function flush(){if(!IDB||!DIRTY.size)return;try{const st=IDB.transaction("c","readwrite").objectStore("c");
for(const k of DIRTY){if(k==="@bn")st.put({t:Date.now(),list:BN.list},k);
else if(k==="@snap")st.put({t:SNAP.t,tfs:SNAP.tfs,uni:SNAP.uni},k);
else if(LIVE[k])st.put({t:LT[k],d:LIVE[k]},k)}DIRTY.clear()}catch(e){}}
const SNAP={ok:false,t:0,uni:[],tfs:[],loaded:{}},SN={};
const snapOn=()=>SNAP.ok&&Date.now()-SNAP.t<216e5;
async function snapInit(){try{const r=await fetch("data/manifest.json",{cache:"no-cache"});if(!r.ok)return;const m=await r.json();if(!m.universe||!m.universe.length)return;
if(m.t!==SNAP.t)SNAP.loaded={};
SNAP.t=m.t;SNAP.tfs=m.tfs;SNAP.uni=m.universe.map(u=>[u[0],u[1],u[3],u[4],1,.01,u[6],u[2],u[5]]);SNAP.ok=true;dirtySnap();
const want=new Set(["1D",S.chart.tf]);S.cols.filter(c=>!c.hide).forEach(c=>{if(c.tf)want.add(c.tf);if(c.tfs)c.tfs.forEach(t=>want.add(t))});
await Promise.all([...want].filter(t=>m.tfs.includes(t)).map(snapTf))}catch(e){}}
function snapTf(tf){return SNAP.loaded[tf]||(SNAP.loaded[tf]=(async()=>{try{const r=await fetch(`data/c_${tf}.json?v=${SNAP.t}`);if(!r.ok)return;const j=await r.json();
for(const n in j){const k=n+"|"+tf;if(!LT[k]||LT[k]<SNAP.t){LIVE[k]=j[n].map(x=>({t:x[0],o:x[1],h:x[2],l:x[3],c:x[4],v:x[5]}));LT[k]=SNAP.t;SN[k]=1;dirty(k)}}}catch(e){}})())}
function pgGo(d){S.page+=d;save();render()}
// Initial historical candle seeding for the active chart (live updates stream over Protocol v2 WS)
function kick(){if(!isLive()||!READY)return;
const cs=symOf(S.chart.sym);if(cs){need(cs,S.chart.tf,true);if(S.pageView==="chart"&&S.sc&&S.sc.panes===2&&S.sc.tfB&&S.sc.tfB!==S.chart.tf)need(cs,S.sc.tfB,true)}
status()}
function favM(){
  const groups=S.wlx.groups;
  const opts=groups.map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join("");
  modal(`<h3>Add to Watchlist</h3><label>Select watchlist<select id="fav_grp">${opts}</select></label><label>Or create new<input id="fav_new" placeholder="New watchlist name"></label><div class="row"><span class="sp"></span><button onclick="closeM()">Cancel</button><button class="pri" onclick="favApply()">Apply</button></div>`);
}
function favApply(){
  const newName=document.getElementById("fav_new").value.trim();
  const grpId=document.getElementById("fav_grp").value;
  const sym=S.chart.sym;
  if(newName){
    const id="g"+Date.now();
    S.wlx.groups.push({id,name:newName,syms:[sym],open:true});
  }else if(grpId){
    const g=S.wlx.groups.find(x=>x.id===grpId);
    if(g&&!g.syms.includes(sym))g.syms.push(sym);
  }
  save();closeM();renderWL();if(typeof vtSyncWsView==="function")vtSyncWsView();
}
function dataM(){const D=S.data;modal(`<h3>Data</h3><p class="mut">Unified real-time streaming: all live price updates flow through the backend Twelve Data WebSocket hub over a single same-origin WebSocket connection, keeping charts, watchlists, screeners, and heatmaps synchronized from one normalized source. Dukascopy historical archives remain isolated to offline Backtest Replay.</p><p class="mut">Absolute = |latest close − close N candles ago|. Expansion = move from the lowest low (bullish) or highest high (bearish) of the last N candles to the latest close. Dollar volume = price × 7-day average volume × contract size; FX/CFD volume is tick volume, so it isn’t filtered.</p>
<label>Finnhub key (stocks fallback)<input id="d_fh" value="${esc(D.fhKey||"")}" placeholder="optional · finnhub.io"></label>
<label>Polygon key (stocks fallback)<input id="d_pg" value="${esc(D.polyKey||"")}" placeholder="optional · polygon.io"></label>
<div class="mut">${Object.keys(LIVE).length} candle series loaded · ${Object.keys(ERR).length} failed</div><div class="row"><button onclick="retryErr();closeM()">Retry failed</button><button onclick="dataReset()">Reload data</button><span class="sp"></span><button onclick="closeM()">Cancel</button><button class="pri" onclick="dataSave()">Save</button></div>`)}
function dataSave(){const g=i=>document.getElementById(i);S.data.fhKey=g("d_fh").value.trim();S.data.polyKey=g("d_pg").value.trim();S.data.mode="all";save();closeM();render();drawChart()}
function dataReset(){for(const o of [LIVE,LT,ERR,PEND])for(const k in o)delete o[k];if(typeof QE!=="undefined")QE.length=0;MAC.clear();BN.loaded=false;BN.list=[];BN.err="";BN.host="";BN.pause=0;if(typeof VT_CANDLE_EDGE_CACHE!=="undefined")VT_CANDLE_EDGE_CACHE.clear();if(typeof VT_EDGE!=="undefined"){if(VT_EDGE.hasMoreHistory)VT_EDGE.hasMoreHistory.clear();if(VT_EDGE.historyBackfillInFlight)VT_EDGE.historyBackfillInFlight.clear()}try{lsRemove("scr2c");if(IDB)IDB.transaction("c","readwrite").objectStore("c").clear()}catch(e){}SNAP.loaded={};closeM();render();drawChart();if(typeof edgeScreenerInit==="function")edgeScreenerInit().then(()=>{render();drawChart()})}
let UIM="pc",rz=0;
function applyUI(){S.ui="auto";const w=innerWidth;UIM=w<700?"phone":w<1100?"tablet":"pc";document.documentElement.dataset.ui=UIM;document.documentElement.dataset.split=(UIM==="pc"||(UIM==="tablet"&&w>=900))?"1":"0";document.querySelectorAll(".mode-btn").forEach(b=>b.classList.toggle("on",b.dataset.m===UIM))}
function goHome(){location.hash="#/"}
function setUI(v){S.ui="auto";applyUI();render();drawChart()}
addEventListener("resize",()=>{clearTimeout(rz);rz=setTimeout(()=>{const o=UIM+"|"+document.documentElement.dataset.split;applyUI();if(UIM+"|"+document.documentElement.dataset.split!==o){render();drawChart()}},200)});
function sync(){document.getElementById("q").value=S.q}
function pick(n){if(!n){S.cur="";save();render();return}
const p=BI[n]||P[n];if(!p)return;Object.assign(S,clone(p),{cur:n});S.cols=norm(S.cols);chMig(S.chart);S.chart=Object.assign(clone(CH0),S.chart);sync();save();render();drawChart()}
const snap=()=>clone({acct:S.acct,mult:S.mult,dvOn:S.dvOn,hideNV:S.hideNV,mkt:S.mkt,sort:S.sort,cols:S.cols,chart:S.chart});
function saveCur(){if(S.cur&&P[S.cur]){P[S.cur]=snap();saveP();toast("Saved “"+S.cur+"”")}else saveAs()}
function saveAs(){modal(`<h3>Save preset</h3><label>Name<input id="pn" maxlength="40" value="${S.cur&&P[S.cur]?esc(S.cur):""}"></label><div class="row"><span class="sp"></span><button onclick="closeM()">Cancel</button><button class="pri" onclick="doAs()">Save</button></div>`)}
function doAs(){const n=document.getElementById("pn").value.trim();if(!n||BI[n]){document.getElementById("pn").placeholder="Pick a different name";document.getElementById("pn").value="";return}
P[n]=snap();S.cur=n;saveP();save();closeM();render();toast("Saved “"+n+"”")}
function delP(){if(!S.cur||!P[S.cur])return;if(!arm){arm=true;render();setTimeout(()=>{arm=false;render()},3000);return}
arm=false;delete P[S.cur];S.cur="";saveP();save();render()}
function xfer(){modal(`<h3>Export / import presets</h3><p class="mut">Presets live in this browser only. Copy them from one device and paste them on another.</p><textarea id="xt" rows="7" placeholder="Paste presets text here…"></textarea><div class="row"><button onclick="document.getElementById('xt').value=JSON.stringify(P)">Fill with mine</button><button onclick="imp()">Import</button><span class="sp"></span><button class="pri" onclick="closeM()">Close</button></div><div class="mut" id="xm"></div>`)}
function imp(){const m=document.getElementById("xm");try{const o=JSON.parse(document.getElementById("xt").value);let n=0;
for(const k in o)if(o[k]&&Array.isArray(o[k].cols)&&!BI[k]){P[k]=o[k];n++}
saveP();render();m.textContent="Imported "+n+" preset(s)."}catch(e){m.textContent="Couldn’t read that text."}}
const rDeb=deb(render,200);



document.getElementById("q").oninput=e=>{S.q=e.target.value;save();rDeb()};
// Symbol keyboard navigation: ArrowUp / ArrowDown instantly cycle the chart through the visible screener rows
document.addEventListener("keydown",e=>{
  if(e.key!=="ArrowDown"&&e.key!=="ArrowUp")return;
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  if(MD.innerHTML)return;
  if(!listOnPage())return;
  const ae=document.activeElement;
  if(ae&&/INPUT|SELECT|TEXTAREA/.test(ae.tagName||""))return;
  if(!PGL||!PGL.length)return;
  e.preventDefault();
  e.stopPropagation();
  const dir=e.key==="ArrowDown"?1:-1;
  window._vtNavUntil=Date.now()+800;window._vtNavSig=S._sig+"|"+(S.preset||"");
  let i=PGL.indexOf(S.chart.sym);
  if(i<0)i=dir>0?0:PGL.length-1;
  else i=Math.max(0,Math.min(PGL.length-1,i+dir));
  const next=PGL[i];
  if(next&&next!==S.chart.sym){openChart(next);if(typeof vtVirtShow==="function")vtVirtShow(i)}
},true);
let BOOTED=false;
// the app only starts (and only fetches market data) once someone is signed in
function boot(){if(BOOTED)return;BOOTED=true;
try{if(S.cur&&!BI[S.cur]&&!P[S.cur])S.cur=""}catch(_e){}
for(const fn of [applyUI,routerInit,sync,render,drawChart]){try{fn()}catch(e){console.error("boot step error:",e)}}
Promise.resolve()
  .then(()=>loadCache())
  .catch(e=>console.error("loadCache error:",e))
  .then(()=>{
    READY=true;
    try{render()}catch(e){console.error("post-cache render error:",e)}
    try{drawChart()}catch(e){console.error("post-cache drawChart error:",e)}
    return Promise.resolve(typeof edgeScreenerInit==="function"?edgeScreenerInit().then(ok=>ok||snapInit()):snapInit()).catch(e=>{console.error("screener init error:",e);return false});
  })
  .then(()=>{
    try{render()}catch(e){console.error("post-init render error:",e)}
    try{drawChart()}catch(e){console.error("post-init drawChart error:",e)}
    try{if(typeof vtWsConnect==="function")vtWsConnect()}catch(e){console.error("ws connect error:",e)}
  })
  .catch(e=>console.error("boot async error:",e));
// On tab wake, ensure the single WebSocket connection is active (no REST polling)
document.addEventListener("visibilitychange",()=>{try{if(document.visibilityState==="visible"){const wsUp=typeof VT_EDGE!=="undefined"&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1;if(!wsUp&&typeof vtWsConnect==="function")vtWsConnect()}}catch(_e){}})}

/* ---- Login (UI only) ----
   authSignIn() is a PLACEHOLDER: it accepts any username/email + password and just remembers the name on this device.
   This is not security. To make it real, replace its body with a call to your backend, e.g.
     const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({id,password:pw})});
     return r.ok?{ok:true,user:(await r.json()).user}:{ok:false,error:"Wrong username/email or password."};
   and let the server (not this page) decide who is allowed in. */
const AUTH_KEY="scr2a";
async function authSignIn(id,pw){
  await new Promise(r=>setTimeout(r,350));
  return{ok:true,user:{id}}}
function authUser(){try{const a=lsGet(AUTH_KEY); if(a){const u=JSON.parse(a); if(u&&u.id)return u}}catch(e){} try{const a=ssGet(AUTH_KEY); if(a){const u=JSON.parse(a); if(u&&u.id)return u}}catch(e){} return null}
function authStore(u,keep){authClear();try{if(keep)lsSet(AUTH_KEY,JSON.stringify(u)); else ssSet(AUTH_KEY,JSON.stringify(u))}catch(e){}}
function authClear(){try{lsRemove(AUTH_KEY)}catch(e){}try{ssRemove(AUTH_KEY)}catch(e){}}
function authSignOut(){authClear();location.reload()}
function authEnter(u){
  document.documentElement.classList.remove("locked");
  const b=document.getElementById("lgo");if(b)b.title="Log out ("+u.id+")";
  document.getElementById("auPw").value="";
  boot()}
function authErr(msg,field){
  const e=document.getElementById("auErr");e.textContent=msg||"";
  for(const id of ["auId","auPw"])document.getElementById(id).removeAttribute("aria-invalid");
  if(field){const f=document.getElementById(field);f.setAttribute("aria-invalid","true");f.focus()}}
function authInit(){
  const f=document.getElementById("auForm"),idEl=document.getElementById("auId"),pwEl=document.getElementById("auPw"),btn=document.getElementById("auBtn"),tog=document.getElementById("auTog");
  tog.onclick=()=>{const show=pwEl.type==="password";pwEl.type=show?"text":"password";tog.textContent=show?"Hide":"Show";tog.setAttribute("aria-pressed",show);tog.setAttribute("aria-label",show?"Hide password":"Show password")};
  idEl.oninput=pwEl.oninput=()=>authErr("");
  f.onsubmit=async ev=>{ev.preventDefault();
    const id=idEl.value.trim(),pw=pwEl.value;
    if(!id)return authErr("Enter your username or email.","auId");
    if(id.includes("@")&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id))return authErr("That email address doesn’t look right.","auId");
    if(!pw)return authErr("Enter your password.","auPw");
    authErr("");btn.disabled=true;btn.textContent="Signing in…";
    try{const r=await authSignIn(id,pw);
      if(r&&r.ok){authStore(r.user,document.getElementById("auRem").checked);if(!BOOTED&&!VT_GUEST&&"~"+vtUidHash(r.user.id)!==VT_SCOPE){location.reload();return}authEnter(r.user)}
      else authErr((r&&r.error)||"Couldn’t sign you in. Check your details and try again.","auPw")}
    catch(e){authErr("Couldn’t reach the server. Try again in a moment.")}
    finally{btn.disabled=false;btn.textContent="Sign in"}};
  const u=authUser();
  if(u)authEnter(u);else idEl.focus()}
