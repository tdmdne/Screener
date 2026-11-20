// Safe storage: localStorage/sessionStorage throw SecurityError in sandboxed contexts
const memStore = {};
function getStore(which){
  try{
    const s = which==="session"?sessionStorage:localStorage;
    const k="__scr_probe__";
    s.setItem(k,"1"); s.removeItem(k);
    return s;
  }catch(e){ return null; }
}
const LS = getStore("local");
const SS = getStore("session");
function lsGet(k){ try{ return LS ? LS.getItem(k) : (memStore[k]||null); }catch(e){ return memStore[k]||null; } }
function lsSet(k,v){ try{ if(LS) LS.setItem(k,v); else memStore[k]=v; }catch(e){ memStore[k]=v; } }
function lsRemove(k){ try{ if(LS) LS.removeItem(k); }catch(e){} delete memStore[k]; }
function ssGet(k){ try{ return SS ? SS.getItem(k) : (memStore["ss_"+k]||null); }catch(e){ return memStore["ss_"+k]||null; } }
function ssSet(k,v){ try{ if(SS) SS.setItem(k,v); else memStore["ss_"+k]=v; }catch(e){ memStore["ss_"+k]=v; } }
function ssRemove(k){ try{ if(SS) SS.removeItem(k); }catch(e){} delete memStore["ss_"+k]; }

const TFS=["1s","5s","10s","15s","30s","45s","1m","3m","5m","15m","30m","45m","1H","2H","3H","4H","12H","1D","1W","1M","3M","6M","12M"];
const TF_CAT={SECONDS:["1s","5s","10s","15s","30s","45s"],MINUTES:["1m","3m","5m","15m","30m","45m"],HOURS:["1H","2H","3H","4H","12H"],DAYS:["1D","1W","1M","3M","6M","12M"]};
const TS={"1s":.01,"5s":.02,"10s":.03,"15s":.04,"30s":.05,"45s":.07,"1m":.05,"3m":.08,"5m":.1,"15m":.17,"30m":.24,"45m":.3,"1H":.35,"2H":.5,"3H":.6,"4H":.7,"12H":1.2,"1D":1,"1W":2.2,"1M":4.5,"3M":6,"6M":8,"12M":10};
let SYMS=[];
const MK={ALL:"All",FX:"Forex",FUT:"Futures",STK:"Stocks",CFD:"CFDs",CRY:"Crypto",ETF:"ETFs",IDX:"Indices"};
const TY={price:"Price",vol:"Volume",dv:"Dollar volume",pct:"Percent change",cc:"Candle change",adr:"Average daily range %",mac:"Moving average close",mat:"Moving average trend"};
const DF={price:()=>({}),vol:()=>({per:"7d"}),dv:()=>({per:"7d"}),pct:()=>({tf:"1D"}),cc:()=>({tf:"1H",n:8,mode:"exp",dir:"bull",min:0}),adr:()=>({n:14}),mac:()=>({tf:"1D",ma:"EMA",len:10}),mat:()=>({tfs:["30m","1H","4H","1D"],ma:"EMA",len:10})};
const mk=(id,t,o)=>Object.assign({id,type:t},DF[t](),o||{});
const base=(cols,sort)=>({acct:300000,mult:10,dvOn:false,hideNV:false,mkt:"ALL",dir:"long",sort,cols});
const BI={"Cheat sheet (candle change)":base([mk("price","price"),mk("dv","dv"),mk("c2","cc",{tf:"1D",n:30,mode:"abs"}),mk("c3","cc"),mk("c4","cc",{dir:"bear"})],{id:"c3",dir:-1}),
"Trend grid":base([mk("price","price"),mk("pct1","pct"),mk("t1","mat"),mk("t2","mat",{len:20}),mk("a1","adr")],{id:"pct1",dir:-1}),
"Higher timeframe scan":base([mk("price","price"),mk("dv","dv"),mk("p1","pct",{tf:"1D"}),mk("p2","pct",{tf:"1W"}),mk("c1","cc",{tf:"1D",n:30,mode:"abs"}),mk("c2","cc",{tf:"1D",n:8,mode:"exp"}),mk("t1","mat",{tfs:["1D","1W"],len:20})],{id:"c2",dir:-1})};
const clone=o=>JSON.parse(JSON.stringify(o));
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let _vtSeqId=1;const vtNextId=p=>p+Date.now().toString(36)+((_vtSeqId++).toString(36));
const norm=cols=>cols.filter(c=>c&&TY[c.type]).map(c=>Object.assign({id:vtNextId("c")},DF[c.type](),c));
/* vt: per-user storage. Saved work (scr2, scr2p) lives under keys scoped to the signed-in user (scr2~<hash of the username>).
   Guests and the sign-in screen start from defaults and never read anyone's saved work. */
function vtUidHash(id){id=String(id||"").trim().toLowerCase();let a=0x811c9dc5,b=0x9e3779b9;for(let i=0;i<id.length;i++){const c=id.charCodeAt(i);a=Math.imul(a^c,16777619)>>>0;b=Math.imul(b^c,2246822519)>>>0;b=(b^(b>>>13))>>>0}return a.toString(16).padStart(8,"0")+b.toString(16).padStart(8,"0")}
function vtAuthIdRaw(){for(const st of [LS,SS]){try{const r=st&&st.getItem("scr2a");if(r){const o=JSON.parse(r);if(o&&o.id)return String(o.id)}}catch(e){}}return null}
let VT_UID=vtAuthIdRaw(),VT_SCOPE=VT_UID?"~"+vtUidHash(VT_UID):null;
function vtSK(k,scope){const sc=scope===undefined?VT_SCOPE:scope;return sc?k+sc:null}
/* data saved before accounts were separated (unscoped scr2/scr2p): it goes to whoever is signed in when this version first runs;
   if nobody is, it is kept aside (marker vt_legacy) and never shown to guests; whoever signs in later is asked whether it is theirs. */
(function(){try{if(lsGet("scr2")==null&&lsGet("scr2p")==null){lsRemove("vt_legacy");return}if(lsGet("vt_legacy")==null&&VT_SCOPE&&lsGet(vtSK("scr2"))==null){for(const k of ["scr2","scr2p"]){const v=lsGet(k);if(v!=null)lsSet(vtSK(k),v);lsRemove(k)}return}if(lsGet("vt_legacy")==null)lsSet("vt_legacy","1")}catch(e){}})();
let P={},S=Object.assign({q:"",cur:""},clone(BI["Cheat sheet (candle change)"])),arm=false;
if(VT_SCOPE){try{P=JSON.parse(lsGet(vtSK("scr2p"))||"{}")}catch(e){}
try{const x=JSON.parse(lsGet(vtSK("scr2"))||"null");if(x&&Array.isArray(x.cols))S=Object.assign(S,x)}catch(e){}}
const VT_WL_FRESH=!VT_SCOPE||lsGet(vtSK("scr2"))==null; // TASK-06: nothing saved for this account yet (read before boot saves); src/watchlist_starter.js only seeds when true
const WL0=[["EUR/USD","FX","FX:EURUSD"],["GBP/USD","FX","FX:GBPUSD"],["USD/JPY","FX","FX:USDJPY"],["AUD/USD","FX","FX:AUDUSD"],["USD/CAD","FX","FX:USDCAD"],["NZD/USD","FX","FX:NZDUSD"],["AAPL","STK","NASDAQ:AAPL"],["NVDA","STK","NASDAQ:NVDA"],["TSLA","STK","NASDAQ:TSLA"],["AMD","STK","NASDAQ:AMD"],["BTC/USD","CRY","BITSTAMP:BTCUSD"],["ETH/USD","CRY","BITSTAMP:ETHUSD"],["SPY","ETF","AMEX:SPY"],["QQQ","ETF","NASDAQ:QQQ"],["GLD","ETF","AMEX:GLD"],["USO","ETF","AMEX:USO"]].map(([td,m,tv])=>({n:td.replace("/",""),m,td,tv}));
const CH0={type:"candle",tf:"1H",sym:"EURUSD",bg:"auto",bgCol:"#ffffff",
upBody:"#0f9d58",dnBody:"#d93025",upBorder:"#0f9d58",dnBorder:"#d93025",upWick:"#0f9d58",dnWick:"#d93025",
showBody:true,showBorder:true,showWick:true,lineCol:"#0f9d58",lineW:2,
showGridV:true,showGridH:true,gridV:"",gridH:"",txtCol:"",fs:12,
xhMode:"normal",xhStyle:3,xhCol:"",xhLabels:true,
pLine:true,pLabel:true,pLineCol:"",
scMode:0,scAuto:true,scInv:false,scBorder:true,scBorderCol:"",scTop:.1,scBot:.1,
wm:false,wmCol:"",
ind:[{id:"i1",t:"ema",len:10,col:"#f97316"},{id:"i2",t:"ema",len:20,col:"#71717a"}]};
function chMig(c){if(c&&c.up&&c.upBody===undefined){c.upBody=c.upBorder=c.upWick=c.lineCol=c.up;c.dnBody=c.dnBorder=c.dnWick=c.dn;if(c.grid===false)c.showGridV=c.showGridH=false}}
S.cols=norm(S.cols);chMig(S.chart);S.chart=Object.assign(clone(CH0),S.chart||{});S.data=Object.assign({mode:"all",fhKey:"",polyKey:""},S.data||{});S.page=S.page||0;S.tfFav=S.tfFav||["1m","5m","15m","30m","1H","4H","1D","1W","1M"];S.tfCustom=S.tfCustom||[];if(S.data.v!==3){S.data.mode="all";S.data.v=3;Object.assign(S,clone(BI["Higher timeframe scan"]),{cur:"Higher timeframe scan"});S.cols=norm(S.cols)}S.wl=Array.isArray(S.wl)&&S.wl.length?S.wl:clone(WL0);S.alerts=Array.isArray(S.alerts)?S.alerts:[];
const WLD=()=>({open:true,groups:[{id:"g1",name:"Traded",open:true,syms:[]},{id:"g2",name:"Section",open:true,syms:[]}]});
S.wlx=S.wlx&&Array.isArray(S.wlx.groups)&&S.wlx.groups.length?S.wlx:WLD();
function save(){try{if(VT_SCOPE)lsSet(vtSK("scr2"),JSON.stringify(S))}catch(e){}}
function saveP(){try{if(VT_SCOPE)lsSet(vtSK("scr2p"),JSON.stringify(P))}catch(e){}}
const deb=(f,ms)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>f(...a),ms)}};

const VT_IC={
  sun:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
  moon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  starOn:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  starOff:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  gear:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.79 1.01 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
  edit:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  x:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  trash:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  lock:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  unlock:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.6"/></svg>',
  cam:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  plus:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  info:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
  sort:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 15l5 5 5-5M7 9l5-5 5 5"/></svg>',
  pulse:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  refresh:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  user:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  chart:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/></svg>',
  eyeOn:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.8 21.8 0 0 1 5.06-6.94"/><path d="M1 1l22 22"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a21.8 21.8 0 0 1-2.88 4.46"/></svg>',
  dl:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  chevDown:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  chevRight:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  chevLeft:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  ext:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  up:'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>',
  dn:'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  upDn:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>'
};
function getEffTheme(){
  if(S.theme==="dark"||S.theme==="light")return S.theme;
  return window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
}
function applyTheme(){
  const eff=getEffTheme();
  document.documentElement.dataset.theme=eff;
  const b=document.getElementById("thm");
  if(b)b.innerHTML=eff==="dark"?VT_IC.moon+"<span>Dark</span>":VT_IC.sun+"<span>Light</span>";
}
function togTheme(){
  S.theme=getEffTheme()==="dark"?"light":"dark";
  save();
  applyTheme();
  drawChart();
}
if(window.matchMedia){
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>{
    if(!S.theme){applyTheme();if(BOOTED)drawChart();}
  });
}

let PRI=new Set(); // symbols currently on screen: these get fetched first
let PGL=[]; // symbols in the visible list, in order (used for the arrow-key shortcut)
function candles(s,tf){return (s&&s[0]&&typeof LIVE!=="undefined"&&LIVE[s[0]+"|"+tf])||null}
function cc(s,c){const a=candles(s,c.tf);if(!a||a.length<2)return null;const n=Math.min(c.n,a.length-1,149),last=a[a.length-1].c;
if(c.mode==="abs"){const ref=a[a.length-1-n].c;return ref?Math.abs(last-ref)/ref*100:null}
const w=a.slice(-n);if(c.dir==="bull"){const lo=Math.min(...w.map(x=>x.l));return lo?(last-lo)/lo*100:null}
const hi=Math.max(...w.map(x=>x.h));return hi?(hi-last)/hi*100:null}
// moving averages are the heaviest calculation, so results are cached until the candles change
const MAC=new Map();
function ma(s,tf,ty,len){const a0=candles(s,tf);if(!a0||!a0.length)return null;const k=s[0]+"|"+tf+"|"+ty+len+"|"+a0.length+"|"+(LT[s[0]+"|"+tf]||0),h=MAC.get(k);
if(h!==undefined)return h;
const a=a0.map(x=>x.c);let r;
if(ty==="SMA"){const w=a.slice(-len);r=w.reduce((x,y)=>x+y,0)/w.length}
else{const q=2/(len+1);let e=a[0];for(let i=1;i<a.length;i++)e=a[i]*q+e*(1-q);r=e}
if(MAC.size>30000)MAC.clear();MAC.set(k,r);return r}
const dvOf=s=>s[3]&&s[2]?s[2]*s[3]*s[4]:null;
function calc(s,c){const t=c.type;
if(t==="price")return s[2];
if(t==="vol"||t==="dv"){if(!s[3])return null;const v=s[3];return t==="dv"?(s[2]?v*s[2]*s[4]:null):v}
if(t==="pct"){const a=candles(s,c.tf);if(a&&a.length>=2){const n=a.length;return a[n-2].c?(a[n-1].c-a[n-2].c)/a[n-2].c*100:null}if(c.tf==="1D"&&typeof VT_EDGE_META!=="undefined"){const m=VT_EDGE_META.get(s[0]);if(m&&isFinite(m.pct))return m.pct}return null}
if(t==="cc")return cc(s,c);
if(t==="adr"){const raw=candles(s,"1D");if(!raw||!raw.length)return null;const a=raw.slice(-c.n);return a.reduce((x,y)=>x+(y.c?(y.h-y.l)/y.c:0),0)/a.length*100}
if(t==="mac"){const a=candles(s,c.tf),m=ma(s,c.tf,c.ma,c.len);if(!a||!a.length||!m)return null;return(a[a.length-1].c-m)/m*100}
return null}
const fm=x=>x==null?"n/a":x>=1e9?(x/1e9).toFixed(1)+"B":x>=1e6?(x/1e6).toFixed(1)+"M":(x/1e3).toFixed(0)+"K";
const fp=p=>{if(p===null||p===undefined||p==="")return"–";const n=Number(p);return isFinite(n)?n.toFixed(n<5?4:n<1000?2:1):"–"};
function label(c){const t=c.type;
if(t==="vol"||t==="dv")return(t==="vol"?"Volume":"Dollar vol")+(isLive()?"":" · "+c.per.toUpperCase());
if(t==="pct")return"% change · "+c.tf;
if(t==="cc")return c.n+" candle · "+(c.mode==="abs"?"Absolute":"Exp "+(c.dir==="bull"?"bull":"bear"))+" · "+c.tf;
if(t==="adr")return"ADR % · "+c.n+"d";
if(t==="mac")return"MA close · "+c.ma+" "+c.len+" · "+c.tf;
if(t==="mat")return"MA trend · "+c.ma+" "+c.len+" · "+c.tfs.join(" ");
return TY[t]}
// Cycle score: used by the Expansion column, the chart preview panel and the heatmap momentum metric
function scoreSymbol(s){
  try{
    const a=candles(s,"1D");if(!a||a.length<50)return{score:0,phase:"—",dir:0};
    const cl=a.map(d=>d.c),ema5=emaArr(cl,5),ema10=emaArr(cl,10),ema20=emaArr(cl,20),ema50=emaArr(cl,50);
    const last=a.length-1,c=cl[last];
    const above5=c>ema5[last],above10=c>ema10[last],above20=c>ema20[last],above50=c>ema50[last];
    const aligned=above5&&above10&&above20&&above50;
    const bearAlign=!above5&&!above10&&!above20&&!above50;
    const chg20=((c/cl[Math.max(0,last-20)])-1)*100;
    const vol=a.slice(-20).reduce((s,d)=>s+(d.v||0),0)/20;
    const avgVol=a.slice(-50).reduce((s,d)=>s+(d.v||0),0)/50;
    const volRatio=avgVol>0?vol/avgVol:1;
    let score=0,phase="Neutral",dir=0;
    if(aligned&&chg20>5){score=90+Math.min(chg20,10);phase="Expansion";dir=1}
    else if(aligned&&chg20>0){score=70+chg20;phase="Accumulation";dir=1}
    else if(bearAlign&&chg20<-5){score=90+Math.min(-chg20,10);phase="Distribution";dir=-1}
    else if(bearAlign&&chg20<0){score=70-chg20;phase="Reaccumulation";dir=-1}
    else if(above50&&chg20>0){score=50+chg20;phase="Retracement";dir=1}
    else{score=30;phase="Range"}
    if(volRatio>1.5)score+=10;
    return{score:Math.min(100,score),phase,dir,chg:chg20};
  }catch(e){return{score:0,phase:"—",dir:0}}
}
function rows(vis){
const cut=S.acct*S.mult;
let r=SYMS.filter(s=>{
  if(S.mkt!=="ALL"&&s[1]!==S.mkt)return false;
  if(!s[0].toLowerCase().includes(S.q.toLowerCase()))return false;
  if(S.hideNV&&!(s[3]>0))return false;
  if(S.dvOn){const dv=dvOf(s);if(dv!=null&&dv<cut)return false}
  return true;
});
r=r.map(s=>{const o={s,v:{},sq:{}};vis.forEach(c=>{if(c.type==="mat"){o.sq[c.id]=c.tfs.map(t=>safe(()=>{const a=candles(s,t);return a[a.length-1].c>ma(s,t,c.ma,c.len)}));o.v[c.id]=o.sq[c.id].filter(x=>x===true).length}else o.v[c.id]=safe(()=>calc(s,c))});return o});
r=r.filter(o=>{
for(const c of vis)if(c.type==="cc"&&c.min>0&&o.v[c.id]<c.min)return false;return true});
const id=S.sort.id,d=S.sort.dir,g=o=>id==="sym"?o.s[0]:o.v[id];
r.sort((a,b)=>{const x=g(a),y=g(b);if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;return(x>y?1:x<y?-1:0)*d});
if(S.preset&&PRESETS[S.preset]){
  r=r.filter(o=>passesPreset(o.s,S.preset)).sort((a,b)=>scoreMarket(b.s)-scoreMarket(a.s));
}
return r}
function cell(o,c){const v=o.v[c.id],t=c.type;
if(t==="price")return o.s[2]==null?"…":fp(o.s[2]);
if(t==="vol"||t==="dv")return v==null?`<span class="na">n/a</span>`:(t==="dv"?"$":"")+fm(v);
if(t==="mat")return`<span class="sqs">${o.sq[c.id].map(b=>`<i class="${b===true?"":b===false?"b":"n"}"></i>`).join("")}</span>`;
if(v==null)return`<span class="na">…</span>`;
const bear=(t==="cc"&&c.mode==="exp"&&c.dir==="bear")||((t==="pct"||t==="mac")&&v<0);
return`<span class="pill ${bear?"b":""}">${(t==="pct"||t==="mac")&&v>0?"+":""}${v.toFixed(2)}%</span>`}
const PRESETS={
  P1:{name:"P1",desc:"Strictest filter: full EMA alignment + expansion"},
  P2:{name:"P2",desc:"Strict filter: EMA alignment + positive change"},
  P3:{name:"P3",desc:"Moderate filter: positive change + partial EMA alignment"},
  P4:{name:"P4",desc:"Loose filter: any positive change"},
  P5:{name:"P5",desc:"No filter: all markets"}
};
function scoreMarket(s){
  try{
    const tf=S.evcTf||"H";
    // EVC: H=1H entry/1D validation, M=15m entry/1H validation, L=1m entry/15m validation
    const evc={H:{e:"1H",v:"1D"},M:{e:"15m",v:"1H"},L:{e:"1m",v:"15m"}};
    const cfg=evc[tf]||evc.H;
    const ae=candles(s,cfg.e),av=candles(s,cfg.v);
    if(!ae||ae.length<20||!av||av.length<20)return 0;
    const cle=ae.map(d=>d.c),clv=av.map(d=>d.c);
    const ema5e=emaArr(cle,5),ema10e=emaArr(cle,10),ema20e=emaArr(cle,20);
    const ema5v=emaArr(clv,5),ema10v=emaArr(clv,10),ema20v=emaArr(clv,20);
    const le=ae.length-1,lv=av.length-1;
    const ce=cle[le],cv=clv[lv];
    let score=0;
    // Validation timeframe (higher) - context
    if(cv>ema5v[lv])score+=8;
    if(cv>ema10v[lv])score+=8;
    if(cv>ema20v[lv])score+=10;
    const chgv=((cv/clv[Math.max(0,lv-20)])-1)*100;
    if(chgv>10)score+=15;else if(chgv>5)score+=10;else if(chgv>0)score+=5;
    // Entry timeframe (lower) - momentum
    if(ce>ema5e[le])score+=8;
    if(ce>ema10e[le])score+=8;
    if(ce>ema20e[le])score+=10;
    const chge=((ce/cle[Math.max(0,le-20)])-1)*100;
    if(chge>10)score+=15;else if(chge>5)score+=10;else if(chge>0)score+=5;
    // Alignment bonus
    if(cv>ema5v[lv]&&cv>ema10v[lv]&&cv>ema20v[lv]&&ce>ema5e[le]&&ce>ema10e[le])score+=8;
    return Math.min(100,score);
  }catch(e){return 0}
}
function passesPreset(s,preset){
  try{
    if(preset==="P5")return true;
    const tf=S.evcTf||"H";
    const evc={H:{e:"1H",v:"1D"},M:{e:"15m",v:"1H"},L:{e:"1m",v:"15m"}};
    const cfg=evc[tf]||evc.H;
    const av=candles(s,cfg.v);
    if(!av||av.length<5)return false;
    const clv=av.map(d=>d.c),cv=clv[clv.length-1],lv=clv.length-1;
    const look=Math.min(20,lv);
    const chgv=((cv/clv[lv-look])-1)*100;
    const dir=S.dir||"long";
    const bull=dir==="long";
    const chgOk=bull?chgv>0.3:chgv<-0.3;
    let emaOk=true;
    if(av.length>=20){
      const ema10=emaArr(clv,10),ema20=emaArr(clv,20);
      emaOk=bull?(cv>ema10[lv]&&cv>ema20[lv]):(cv<ema10[lv]&&cv<ema20[lv]);
    }
    let exp=false;
    const ae=candles(s,cfg.e);
    if(ae&&ae.length>=8){
      const cle=ae.map(d=>d.c),ce=cle[cle.length-1];
      const lo=Math.min(...cle.slice(-8)),hi=Math.max(...cle.slice(-8));
      exp=bull?(ce-lo)/Math.max(lo,1e-9)*100>1:(hi-ce)/Math.max(hi,1e-9)*100>1;
    }
    if(preset==="P4")return chgOk;
    if(preset==="P3")return chgOk&&emaOk;
    if(preset==="P2")return chgOk&&emaOk&&(exp||Math.abs(chgv)>2);
    if(preset==="P1")return chgOk&&emaOk&&exp&&Math.abs(chgv)>3;
    return true;
  }catch(e){return false}
}
function renderPresets(){
  const el=document.getElementById("presets");if(!el)return;
  const tf=S.evcTf||"H";
  el.innerHTML=`<span style="margin-right:8px">${["H","M","L"].map(t=>`<button class="preset-btn ${tf===t?"on":""}" onclick="setEvcTf('${t}')">${t}</button>`).join("")}<button onclick="evcInfo()" style="background:none;border:none;cursor:pointer;color:var(--mut);margin-left:2px;display:inline-flex;align-items:center" title="What is H/M/L?" aria-label="What is H/M/L?">${VT_IC.info}</button></span><span style="margin-right:8px"><button class="preset-btn ${(S.dir||"long")==="long"?"on":""}" onclick="setDir('long')" title="Long direction (rising-price conditions)">Long</button><button class="preset-btn ${(S.dir||"long")==="short"?"on":""}" onclick="setDir('short')" title="Short direction (falling-price conditions)">Short</button></span>`+Object.entries(PRESETS).map(([k,p])=>`<button class="preset-btn ${S.preset===k?"on":""}" onclick="applyPreset('${k}')" title="${p.desc}">${p.name}</button>`).join("")+`<button onclick="presetInfo()" style="background:none;border:none;cursor:pointer;color:var(--mut);margin-left:4px;display:inline-flex;align-items:center" title="What are P1-P5?" aria-label="What are P1-P5?">${VT_IC.info}</button><span class="sp"></span><button type="button" class="preset-btn" onclick="openCols()" title="Customize screener columns">Columns</button><button type="button" class="preset-btn" onclick="scrSetM()" title="Screener settings &amp; filters">${VT_IC.gear}</button>`;
}
function setEvcTf(t){S.evcTf=t;S.page=0;save();render()}
function setDir(d){S.dir=d;S.page=0;save();render()}
function presetInfo(){modal(`<h3>Preset levels</h3><div style="line-height:1.6"><p>Presets are filters, from the strictest (P1) to the broadest (P5). Each one checks fixed conditions on recent candles:</p><p><b>P1</b> \u2013 full EMA alignment and price expansion</p><p><b>P2</b> \u2013 EMA alignment and a positive change</p><p><b>P3</b> \u2013 a positive change and partial EMA alignment</p><p><b>P4</b> \u2013 any positive change</p><p><b>P5</b> \u2013 no filter (all markets)</p><p class="mut" style="margin-top:12px">A preset describes how price has moved, using formulas on past data. It doesn\u2019t rank quality, predict future prices or tell you to trade. Not investment advice.</p></div><div class="row"><span class="sp"></span><button onclick="closeM()">Close</button></div>`)}
function evcInfo(){modal(`<h3>Timeframe levels</h3><div style="line-height:1.6"><p><b>H</b> \u2013 entry timeframe 1H, validated on 1D</p><p><b>M</b> \u2013 entry timeframe 15m, validated on 1H</p><p><b>L</b> \u2013 entry timeframe 1m, validated on 15m</p><p class="mut" style="margin-top:12px">The level sets which candles the preset filters and scores are calculated on. Not investment advice.</p></div><div class="row"><span class="sp"></span><button onclick="closeM()">Close</button></div>`)}
  function applyPreset(k){S.preset=k;S.page=0;save();render()}
function render(){
try{
if(isLive()){try{bnwsStart()}catch(e){console.error("bnwsStart error:",e)}try{setLive()}catch(e){console.error("setLive error:",e)}}
if(!Array.isArray(SYMS))SYMS=[];
const vis=S.cols.filter(c=>!c.hide);
if(S.sort.id!=="sym"&&!vis.some(c=>c.id===S.sort.id))S.sort={id:"sym",dir:1};

const ss=document.getElementById("srtsel");if(ss){ss.innerHTML=`<option value="sym">Sort: Symbol</option>`+vis.map(c=>`<option value="${c.id}">Sort: ${esc(label(c))}</option>`).join("");ss.value=S.sort.id}
const mks=document.getElementById("mkts");if(mks){const mkl=Object.keys(MK).filter(k=>k==="ALL"||SYMS.some(s=>s[1]===k)||S.mkt===k);
mks.innerHTML=mkl.map(k=>`<option value="${k}">${MK[k]}</option>`).join("");mks.value=S.mkt}
const o=k=>`<option value="${esc(k)}" ${S.cur===k?"selected":""}>${esc(k)}</option>`;

const ar=id=>S.sort.id===id?(S.sort.dir<0?VT_IC.dn:VT_IC.up):"";
const dirOf=id=>S.sort.id===id?(S.sort.dir<0?"desc":"asc"):"";
let h=`<tr><th><span class="h" data-dir="${dirOf("sym")}" onclick="srt('sym')">Symbol${ar("sym")}</span></th>`;
vis.forEach(c=>{h+=`<th><span class="h" data-dir="${dirOf(c.id)}" onclick="srt('${c.id}')">${label(c)}${ar(c.id)}</span><button class="gear" onclick="openEd('${c.id}')" aria-label="Edit column">${VT_IC.gear}</button></th>`});
const sig=JSON.stringify([S.mkt,S.q,S.acct,S.mult,S.dvOn,S.hideNV,S.sort,S.cols,S.evcTf,S.dir,S.preset,S.virt,S.rows,S.scrF]);if(sig!==S._sig){S.page=0;S._sig=sig}
let R=[];try{R=rows(vis)}catch(e){console.error("rows error:",e);R=[]}
if(typeof vtApplyScrFilters==="function"){try{R=vtApplyScrFilters(R)}catch(e){console.error("scrFilter error:",e)}}
if(window._vtNavUntil&&Date.now()<window._vtNavUntil&&window._vtNavSig===(S._sig+"|"+(S.preset||""))&&PGL&&PGL.length){
  const byS=new Map(R.map(r=>[r&&r.s&&r.s[0],r]));const seen=new Set();const kept=[];
  for(const k of PGL){const x=byS.get(k);if(x){kept.push(x);seen.add(k)}}
  for(const x of R){const k=x&&x.s&&x.s[0];if(k&&!seen.has(k))kept.push(x)}
  if(kept.length===R.length)R=kept;
}
const pages=Math.max(1,Math.ceil(R.length/(S.rows||20)));if(S.page>=pages)S.page=0;let b="";
let VW=null;try{VW=typeof vtVirt==="function"?vtVirt(R.length):null}catch(e){console.error("vtVirt error:",e)}
const PG=VW?R.slice(VW.a,VW.b):R.slice(S.page*(S.rows||20),(S.page+1)*(S.rows||20));PRI=new Set(PG.map(r=>r&&r.s&&r.s[0]).filter(Boolean));
PGL=(VW?R:PG).map(r=>r&&r.s&&r.s[0]).filter(Boolean);
if(!(S.mini&&S.mini.on)){
if(VW&&VW.top)b+=`<tr class="vt-vsp" aria-hidden="true"><td colspan="${vis.length+1}" style="height:${VW.top}px"></td></tr>`;
PG.forEach(r=>{try{if(!r||!r.s||!r.s[0])return;b+=`<tr data-s="${r.s[0]}" class="${r.s[0]===S.chart.sym?"sel":""}"><td class="sy" onclick="openChart('${r.s[0]}')">${r.s[0]} <span class="mut">${r.s[1]}</span></td>`+vis.map(c=>`<td data-l="${esc(label(c))}">${cell(r,c)}</td>`).join("")+"</tr>"}catch(e){console.error("row cell error:",e)}});
if(VW&&VW.bot)b+=`<tr class="vt-vsp" aria-hidden="true"><td colspan="${vis.length+1}" style="height:${VW.bot}px"></td></tr>`;
const tblEl=document.getElementById("t");if(tblEl)tblEl.innerHTML="<thead>"+h+"</tr></thead><tbody>"+b+"</tbody>";
}
const cntEl=document.getElementById("cnt");if(cntEl)cntEl.textContent=R.length+" match"+(R.length===1?"":"es")+" · "+SYMS.length+" markets in the list";
const pgEl=document.getElementById("pg");if(pgEl)pgEl.innerHTML=pages>1&&!VW?`<button onclick="pgGo(-1)" ${S.page?"":"disabled"}>${VT_IC.chevLeft} Prev</button><span class="mut">Page ${S.page+1} of ${pages}</span><button onclick="pgGo(1)" ${S.page<pages-1?"":"disabled"}>Next ${VT_IC.chevRight}</button>`:"";
const tagEl=document.getElementById("tag");if(tagEl)tagEl.textContent=isLive()?"Live · auto-scan":"Feed standby";
try{renderWL()}catch(e){console.error("renderWL error:",e)}
try{renderPresets()}catch(e){console.error("renderPresets error:",e)}
try{kick()}catch(e){console.error("kick error:",e)}
}catch(e){console.error("render error:",e)}
}
