// ---------- Screener Pro: full-width table, extra read-only columns, quick filter pills, slide-over chart ----------
S.sx=Object.assign({tf:"1D"},S.sx||{});
const SX={ch:null,sym:"",retry:0};
// strictest preset a market passes (P1 strictest ... P5 everything); uses passesPreset unchanged
function sxTier(s){for(const p of ["P1","P2","P3","P4"])if(passesPreset(s,p))return p;return"P5"}
function sxPct(s){const a=candles(s,"1D");return a&&a.length>1?(a[a.length-1].c/a[a.length-2].c-1)*100:null}
function sxAdr(s){const a=candles(s,"1D");if(!a||a.length<2)return null;const w=a.slice(-14);return w.reduce((x,y)=>x+(y.h-y.l)/y.c,0)/w.length*100}
const SXC=[["Market",s=>`<span class="mut">${esc(MK[s[1]]||s[1])}</span>`],
["1D %",s=>{const v=sxPct(s);return v==null?`<span class="na">\u2026</span>`:`<span class="${v<0?"dn":"up"} num">${v>0?"+":""}${v.toFixed(2)}%</span>`}],
["ADR 14d",s=>{const v=sxAdr(s);return v==null?`<span class="na">\u2026</span>`:`<span class="num">${v.toFixed(2)}%</span>`}],
["Vektor",s=>{if(!evcHas(s))return`<span class="na">…</span>`;const v=scoreMarket(s);return`<span class="sbar"><i><b style="width:${v}%"></b></i><span class="num">${v}</span></span>`}],
["Expansion",s=>{const a=candles(s,"1D");if(!a||a.length<50)return`<span class="na">…</span>`;const r=scoreSymbol(s);return`<span class="num">${Math.round(r.score)}</span> <span class="mut">${esc(r.phase)}</span>`}],
["Tier",s=>{if(!evcHas(s))return`<span class="na">…</span>`;const t=sxTier(s);return`<span class="tier ${t==="P1"?"t1":t==="P2"?"t2":""}">${t}</span>`}]];
function sxAugment(){const t=document.getElementById("t");if(!t)return;const hr=t.querySelector("thead tr");if(!hr||hr.dataset.sx)return;hr.dataset.sx=1;
hr.insertAdjacentHTML("beforeend",SXC.map(([n])=>`<th title="Screener Pro column (read-only)">${n}</th>`).join(""));
t.querySelectorAll("tbody tr[data-s]").forEach(tr=>{const s=symOf(tr.dataset.s);if(!s)return;tr.insertAdjacentHTML("beforeend",SXC.map(([n,f])=>{let v;try{v=f(s)}catch(e){v=`<span class="na">n/a</span>`}return`<td data-l="${n}">${v}</td>`}).join(""))})}
function sxBar(){let b=document.getElementById("sxbar");if(!b){const tw=document.querySelector(".side>.tw");if(!tw)return;b=document.createElement("div");b.id="sxbar";tw.parentNode.insertBefore(b,tw)}
const mk=Object.keys(MK).filter(k=>k==="ALL"||SYMS.some(s=>s[1]===k));
const names=[...Object.keys(BI),...Object.keys(P)];
b.innerHTML=`<span class="sxlbl">Market</span><span class="seg">${mk.map(k=>`<button class="${S.mkt===k?"on":""}" onclick="S.mkt='${k}';S.page=0;save();render()">${MK[k]}</button>`).join("")}</span>`+
(typeof vtVirtOn==="function"&&vtVirtOn()?"":`<span class="sxlbl">Rows</span><span class="seg">${[20,50,100].map(n=>`<button class="${(S.rows||20)===n?"on":""}" onclick="S.rows=${n};S.page=0;save();render()">${n}</button>`).join("")}</span>`)+
`<span class="sp"></span><select id="sxlay" title="Saved screener layouts" onchange="pick(this.value)"><option value="">Layout\u2026</option>${names.map(n=>`<option value="${esc(n)}" ${S.cur===n?"selected":""}>${esc(n)}</option>`).join("")}</select><button onclick="saveCur()" title="Save the current columns and filters">Save</button><button onclick="xfer()" title="Export or import saved layouts">Export</button><button onclick="openCols()">Columns</button><button onclick="scrSetM()" title="Screener settings &amp; filters">Settings</button>`}
function sxSel(){document.querySelectorAll("#t tbody tr[data-s]").forEach(tr=>tr.classList.toggle("sel",tr.dataset.s===SX.sym&&!!document.querySelector("#sxd.open")))}
function sxDrawer(sym){let d=document.getElementById("sxd");if(!d){d=document.createElement("aside");d.id="sxd";d.setAttribute("aria-label","Chart preview");document.body.appendChild(d)}
const s=symOf(sym);if(!s)return;SX.sym=sym;
const sc=scoreSymbol(s),v=scoreMarket(s),pc=sxPct(s),adr=sxAdr(s),t=sxTier(s),inWl=wlAll().includes(sym);
const k=(a,b,c)=>`<div class="kpi"><div class="k">${a}</div><div class="v ${c||""}">${b}</div></div>`;
d.innerHTML=`<div class="sxdh"><b style="font-size:15px">${esc(sym)}</b><span class="mut">${esc(MK[s[1]]||s[1])}</span><b class="num">${s[2]!=null?fp(s[2]):""}</b><span class="sp"></span><button class="ibtn" title="Close (Esc)" aria-label="Close" onclick="sxClose()">${VT_IC.x}</button></div>
<div class="sxdb"><div class="tfs">${["15m","1H","4H","1D","1W"].map(x=>`<button class="chip ${x===S.sx.tf?"on":""}" onclick="S.sx.tf='${x}';save();sxDrawer(SX.sym)">${x}</button>`).join("")}</div><div id="sxc"></div>
<div class="sxst">${k("1D change",pc==null?"\u2013":(pc>0?"+":"")+pc.toFixed(2)+"%",pc==null?"":pc<0?"dn":"up")}${k("Vektor score",v)}${k("Tier",t)}${k("Expansion",Math.round(sc.score))}${k("Phase",esc(sc.phase))}${k("ADR 14d",adr==null?"\u2013":adr.toFixed(2)+"%")}</div>
<div class="row" style="flex-wrap:wrap"><button class="pri" onclick="sxClose();_vtOpenChart(SX.sym);go('chart')">Open in VektorCharts</button><button onclick="sxClose();_vtOpenChart(SX.sym);go('workspace')">Workspace</button><button onclick="sxWl()" style="display:inline-flex;align-items:center;gap:5px">${inWl?VT_IC.starOn+"<span>In watchlist</span>":VT_IC.starOff+"<span>Watchlist</span>"}</button><button onclick="alertsM()">Alert</button></div>
<p class="mut vtna" style="margin:0">Scores use the same formulas as the presets. Tier is the strictest preset (P1 strictest, P5 broadest) this market passes for the current H/M/L level and Long/Short setting. ${VT_NA_TXT} <a href="#/legal/risk">Risk disclaimer</a></p></div>`;
d.classList.add("open");sxSel();sxMini()}
function sxWl(){const g=S.wlx.groups[0];if(!wlAll().includes(SX.sym)){g.syms.push(SX.sym);save();renderWL();wlStarSync();if(typeof vtSyncWsView==="function")vtSyncWsView()}sxDrawer(SX.sym)}
function sxMini(){clearTimeout(SX.retry);if(SX.ch){try{SX.ch.remove()}catch(e){}SX.ch=null}const el=document.getElementById("sxc"),s=symOf(SX.sym);if(!el||!s||!window.LightweightCharts)return;
const B=vtBars(s,S.sx.tf);if(!B){el.innerHTML=`<p class="mut vt-skel" role="status" style="padding:10px">Loading ${esc(S.sx.tf)} candles\u2026</p>`;if(isLive()&&READY)need(s,S.sx.tf,true);SX.retry=setTimeout(()=>{if(document.querySelector("#sxd.open"))sxMini()},1500);return}
el.innerHTML="";const c=LightweightCharts.createChart(el,vtChartOpts(S.sx.tf));const ser=c.addCandlestickSeries(vtCandleOpts(s));ser.setData(B.D);
const cl=B.a.map(x=>x.c);S.chart.ind.filter(x=>!x.hidden&&(x.t==="ema"||x.t==="sma")).forEach(x=>{const l=c.addLineSeries({color:x.col,lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});l.setData((x.t==="ema"?emaArr(cl,x.len):smaArr(cl,x.len)).map((y,i)=>y==null?null:{time:B.T(i),value:y}).filter(Boolean))});
const n=B.D.length;c.timeScale().setVisibleLogicalRange({from:Math.max(0,n-90),to:n+4});SX.ch=c}
function sxClose(){const d=document.getElementById("sxd");if(d)d.classList.remove("open");clearTimeout(SX.retry);if(SX.ch){try{SX.ch.remove()}catch(e){}SX.ch=null}sxSel()}
// hook render/openChart without changing them: Screener Pro only adds to what they already do
const _vtRender=render;render=function(){_vtRender.apply(this,arguments);try{if(S.pageView==="screener"){sxBar();sxAugment();sxSel()}}catch(e){console.error("screener pro render error:",e)}};
const _vtOpenChart=openChart;openChart=function(sym,tf){_vtOpenChart.apply(this,arguments);if(S.pageView==="screener")sxDrawer(sym)};
document.addEventListener("click",e=>{if(S.pageView!=="screener")return;const tr=e.target.closest&&e.target.closest("#t tbody tr[data-s]");if(!tr||e.target.closest("td.sy,button,a,input,select"))return;openChart(tr.dataset.s)});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.querySelector("#sxd.open")&&!MD.innerHTML)sxClose()});
// the list search box was bound to a debounced copy of the original render; rebind it so Pro columns stay
{const q=document.getElementById("q"),rd=deb(()=>render(),200);if(q)q.oninput=e=>{S.q=e.target.value;save();rd()}}
PAGE_HOOK.screener={enter(){render()},leave(){sxClose();setTimeout(render,0)}};
// ---------- sign-in screen, guest mode and the sign-in prompt ----------
// Auth is still LOCAL and MOCK-PLUGGABLE: authSignIn() (above) accepts any name and stores only the name on this device.
// Replace authSignIn() with a real backend call to make it real. Nothing here sends a password anywhere.
// Guests: can chart and screen. Their work lives in memory only (save() is a no-op for guests), so nothing optional is
// written before consent + sign-in. The only guest key is sessionStorage "vt_guest" (the choice itself; gone when the tab closes).
const VT_GUEST_KEY="vt_guest";
let VT_GUEST=false;
function vtIsGuest(){return VT_GUEST}
const VT_RM=()=>!!(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches);
// ---- hero + guest button, built once into the existing auth screen ----
function vtAuthDecor(){const A=document.getElementById("auth"),F=document.getElementById("auForm");if(!A||!F||A.querySelector(".auhero"))return;
  const cv=document.createElement("canvas");cv.id="aubg";cv.setAttribute("aria-hidden","true");A.prepend(cv);
  const H=document.createElement("section");H.className="auhero";H.setAttribute("aria-label","About Vektor Terminal");
  H.innerHTML=`<div class="aukick">Market data terminal</div><h2 class="auhero-title">Multi-market charting,<br><em>screener &amp; replay.</em></h2>
<p>Charts, a multi-market screener, alerts and position planning in one dark workspace. Prices can be delayed; nothing here is investment advice.</p>
<ul><li>Crypto, forex and stocks side by side (coverage depends on the data provider)</li><li>Drawing tools, alerts and long/short planning</li><li>Encrypted cloud accounts — watchlists, drawings &amp; journal sync securely</li></ul>
<div class="autick" id="autick" aria-live="off"></div>`;
  A.insertBefore(H,F);
  const sub=F.querySelector(".auth-sub");if(sub)sub.textContent="Sign in to save alerts, chart templates and settings";
  const note=F.querySelector(".note");if(note){note.className="note augn";note.textContent="Encrypted account authentication — your watchlists, layouts and journal sync securely."}
  const or=document.createElement("div");or.className="auor";or.textContent="or";
  const g=document.createElement("button");g.type="button";g.id="auGuest";g.className="auguest";g.textContent="Continue without signing in";
  const gn=document.createElement("p");gn.className="augn";gn.id="auGuestNote";gn.textContent="Guests can use the charts and screener. Nothing you do as a guest is saved after you close the tab.";
  const btn=document.getElementById("auBtn");btn.after(or,g,gn);g.setAttribute("aria-describedby","auGuestNote");
  const x=document.createElement("button");x.type="button";x.className="auclose";x.id="auClose";x.setAttribute("aria-label","Close sign-in and keep exploring");x.textContent="\u00d7";F.style.position="relative";F.prepend(x);
  x.onclick=vtHideSignIn;g.onclick=vtEnterGuest;
  A.addEventListener("keydown",e=>{if(e.key==="Escape"&&VT_GUEST)vtHideSignIn()})}
// ---- animated backdrop: flowing price lines + drifting particles (static frame when reduced motion is on) ----
const AUBG={raf:0,t:0,lines:[],parts:[]};
function vtNoiseLine(seed,n){let v=0,dv=0;const a=[];let s=seed*9301+49297;const rnd=()=>{s=(s*9301+49297)%233280;return s/233280};
  for(let i=0;i<n;i++){dv=dv*0.92+(rnd()-0.5)*0.9;v+=dv;a.push(v)}return a}
function vtAuBgInit(){const cv=document.getElementById("aubg");if(!cv)return;
  const C=[["rgba(251,146,60,",0.55],["rgba(34,197,94,",0.28],["rgba(248,113,113,",0.22],["rgba(148,163,184,",0.18],["rgba(251,191,36,",0.2]];
  AUBG.lines=C.map((c,i)=>({c:c[0],a:c[1],pts:vtNoiseLine(i+3,600),y:0.25+i*0.13,sp:0.35+i*0.12,w:i?1.2:2}));
  let ps=4217;const prnd=()=>{ps=(ps*9301+49297)%233280;return ps/233280};
  AUBG.parts=Array.from({length:46},()=>({x:prnd(),y:prnd(),r:0.6+prnd()*1.6,v:0.00012+prnd()*0.0004,a:0.15+prnd()*0.35}));
  vtAuBgFrame();
  vtAuBgLoop()}
function vtAuBgFrame(){const cv=document.getElementById("aubg");if(!cv)return;const dpr=Math.min(2,window.devicePixelRatio||1),W=cv.clientWidth||window.innerWidth||1440,H=cv.clientHeight||window.innerHeight||900;
  if(cv.width!==Math.round(W*dpr)||cv.height!==Math.round(H*dpr)){cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr)}
  const g=cv.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,W,H);
  g.strokeStyle="rgba(255,255,255,0.035)";g.lineWidth=1;for(let x=0;x<W;x+=64){g.beginPath();g.moveTo(x+.5,0);g.lineTo(x+.5,H);g.stroke()}for(let y=0;y<H;y+=64){g.beginPath();g.moveTo(0,y+.5);g.lineTo(W,y+.5);g.stroke()}
  const step=Math.max(6,W/120);
  for(const L of AUBG.lines){const n=L.pts.length,off=AUBG.t*L.sp;g.beginPath();
    for(let x=0,i=0;x<=W+step;x+=step,i++){const k=(i+off)%n,i0=Math.floor(k),f=k-i0,v=L.pts[i0]*(1-f)+L.pts[(i0+1)%n]*f;const y=H*L.y+v*H*0.012;i?g.lineTo(x,y):g.moveTo(x,y)}
    const gr=g.createLinearGradient(0,0,W,0);gr.addColorStop(0,L.c+"0)");gr.addColorStop(0.55,L.c+(L.a*0.6)+")");gr.addColorStop(1,L.c+L.a+")");
    g.strokeStyle=gr;g.lineWidth=L.w;g.stroke()}
  for(const p of AUBG.parts){g.fillStyle="rgba(251,146,60,"+p.a+")";g.beginPath();g.arc(p.x*W,p.y*H,p.r,0,6.283);g.fill()}}
function vtAuBgLoop(){cancelAnimationFrame(AUBG.raf);const rm=VT_RM();
  const tick=()=>{if(!document.documentElement.classList.contains("locked")){AUBG.raf=0;return}
    AUBG.t+=0.06;for(const p of AUBG.parts){p.y-=p.v*16;p.x+=p.v*4;if(p.y<-0.02){p.y=1.02;p.x=(p.x+0.37)%1}if(p.x>1.02)p.x=-0.02}
    vtAuBgFrame();AUBG.raf=requestAnimationFrame(tick)};
  if(rm){vtAuBgFrame();return}AUBG.raf=requestAnimationFrame(tick)}
window.addEventListener("resize",()=>{if(document.documentElement.classList.contains("locked")&&VT_RM())vtAuBgFrame()});
// ---- live ticker snippets: real Binance quotes or nothing (never made up) ----
const AU_TICK=["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT"];
async function vtAuTicker(){const el=document.getElementById("autick");if(!el)return;
  try{const res=await fetch("/api/quote?symbols="+encodeURIComponent(AU_TICK.join(",")));if(!res.ok){el.textContent="";return}
    const j=await res.json();const quotes=(j&&j.quotes)||[];
    const rows=quotes.filter(r=>AU_TICK.includes(r.symbol)&&isFinite(+r.price)&&+r.price>0);if(!rows.length){el.textContent="";return}
    el.textContent="";for(const r of AU_TICK.map(s=>rows.find(x=>x.symbol===s)).filter(Boolean)){const s=document.createElement("span"),b=document.createElement("b");b.textContent=r.symbol.replace(/USDT$/,"");const px=+r.price;s.append(b," "+px.toLocaleString("en-GB",{maximumFractionDigits:px<10?4:2}));
      const pc=+r.pct;if(r.pct!=null&&isFinite(pc)){const c=document.createElement("i");c.style.fontStyle="normal";c.className=pc>=0?"up":"dn";c.textContent=(pc>=0?"+":"\u2212")+Math.abs(pc).toFixed(2)+"%";s.append(" ",c)}el.append(s)}
    const src=document.createElement("span");src.className="src";src.textContent="Live spot, 24h";el.append(src)}
  catch(e){el.textContent=""}}
// ---- guest mode ----
function vtGuestUI(){document.documentElement.classList.toggle("vtguest",VT_GUEST);const b=document.getElementById("lgo");if(!b)return;
  if(VT_GUEST){b.textContent="Sign in";b.title="Sign in to save your work";b.onclick=vtShowSignIn}else{b.textContent="Log out";b.onclick=authSignOut}}
function vtEnterGuest(){VT_GUEST=true;try{ssSet(VT_GUEST_KEY,"1")}catch(e){}
  if(typeof authErr==="function")authErr("");vtGuestUI();
  if(BOOTED){document.documentElement.classList.remove("locked");return}
  authEnter({id:"Guest",guest:true})}
function vtShowSignIn(){vtAuthDecor();document.documentElement.classList.add("locked");closeM();vtAuBgLoop();vtAuTicker();setTimeout(()=>{const i=document.getElementById("auId");if(i)i.focus()},30)}
function vtHideSignIn(){if(!BOOTED)return;document.documentElement.classList.remove("locked");const b=document.getElementById("lgo");if(b)b.focus()}
// signing in from guest mode keeps the session's work and saves it under that account (asks first if the account already has saved work)
const _vtAuthEnter=authEnter;authEnter=function(u){
  if(!(u&&u.guest)){const was=VT_GUEST;VT_GUEST=false;try{ssRemove(VT_GUEST_KEY)}catch(e){}vtGuestUI();
    if(BOOTED){document.documentElement.classList.remove("locked");const b=document.getElementById("lgo");if(b)b.title="Log out ("+u.id+")";document.getElementById("auPw").value="";VT_UID=String(u.id);VT_SCOPE="~"+vtUidHash(u.id);if(was){if(lsGet(vtSK("scr2"))!=null&&typeof vtAcctChoose==="function")vtAcctChoose();else{save();saveP();toast("Signed in \u2014 your work is now saved on this device");if(typeof vtLegacyCheck==="function")setTimeout(vtLegacyCheck,200)}}return}}
  const r=_vtAuthEnter.apply(this,arguments);vtGuestUI();return r};
const _vtSaveG=save;save=function(){if(VT_GUEST)return;return _vtSaveG.apply(this,arguments)};
const _vtAuthInit=authInit;authInit=function(){vtAuthDecor();
  if(!authUser()){let g=null;try{g=ssGet(VT_GUEST_KEY)}catch(e){}if(g==="1"){VT_GUEST=true;vtGuestUI();_vtAuthInit.apply(this,arguments);return authEnter({id:"Guest",guest:true})}
    vtAuBgInit();vtAuTicker()}
  return _vtAuthInit.apply(this,arguments)};
// ---- friendly prompt when a guest tries something that needs an account ----
function vtGate(what){if(!VT_GUEST)return false;
  modal(`<div class="vgate" role="dialog" aria-modal="true" aria-labelledby="vg_h"><h3 id="vg_h">Sign in to save ${esc(what)}</h3><p>You\u2019re exploring as a guest. Sign in to keep ${esc(what)} on this device. Your current charts stay as they are.</p><div class="row"><button id="vg_no" type="button">Keep exploring</button><button id="vg_in" type="button" class="pri">Sign in</button></div></div>`);
  const no=document.getElementById("vg_no"),yes=document.getElementById("vg_in");no.onclick=closeM;yes.onclick=vtShowSignIn;yes.focus();
  const box=MD.querySelector(".ov");box.addEventListener("keydown",e=>{if(e.key==="Escape")closeM();if(e.key==="Tab"){const f=[no,yes],i=f.indexOf(document.activeElement);e.preventDefault();f[(i+(e.shiftKey?f.length-1:1))%f.length].focus()}});
  return true}
const _vtAddAlertG=addAlert;addAlert=function(){if(vtGate("alerts"))return;return _vtAddAlertG.apply(this,arguments)};
const _vtAddAlertAtG=vtAddAlertAt;vtAddAlertAt=function(){if(vtGate("alerts"))return;return _vtAddAlertAtG.apply(this,arguments)};
const _vtSetMG=setM;setM=function(){if(vtGate("your chart settings"))return;return _vtSetMG.apply(this,arguments)};
// <VTC> pure calculator / stats helpers (no DOM; unit-tested in tests/logic.js)
const VTC=(()=>{
const METALS={XAU:{contract:100,pip:0.1},XAG:{contract:5000,pip:0.01}};
// FX / metals contract spec from a 6-letter symbol like EURUSD, USDJPY, XAUUSD
function fxSpec(sym){const s=String(sym||"").toUpperCase().replace(/[^A-Z]/g,"");if(s.length<6)return null;const base=s.slice(0,3),quote=s.slice(3,6);
const m=METALS[base];return{base,quote,contract:m?m.contract:100000,pip:m?m.pip:(quote==="JPY"?0.01:0.0001)}}
// value of one pip for one standard lot, in the account currency (USD). quoteUsd = price of 1 unit of the quote currency in USD
function pipValueUSD(spec,price,quoteUsd){if(!spec)return null;let q=quoteUsd;if(spec.quote==="USD")q=1;else if(spec.base==="USD"&&price>0)q=1/price;
if(!(q>0))return null;return spec.contract*spec.pip*q}
function riskAmount(acct,riskPct,riskUsd){return riskUsd>0?riskUsd:acct*(riskPct||0)/100}
function fxLots(risk,stopPips,pipVal){if(!(risk>0&&stopPips>0&&pipVal>0))return 0;return risk/(stopPips*pipVal)}
const FUT={ES:["E-mini S&P 500",0.25,12.5],MES:["Micro E-mini S&P",0.25,1.25],NQ:["E-mini Nasdaq-100",0.25,5],MNQ:["Micro E-mini Nasdaq",0.25,0.5],
YM:["E-mini Dow",1,5],MYM:["Micro E-mini Dow",1,0.5],RTY:["E-mini Russell 2000",0.1,5],M2K:["Micro Russell 2000",0.1,0.5],
CL:["Crude Oil",0.01,10],MCL:["Micro Crude Oil",0.01,1],NG:["Natural Gas",0.001,10],GC:["Gold",0.1,10],MGC:["Micro Gold",0.1,1],SI:["Silver",0.005,25],HG:["Copper",0.0005,12.5],
ZN:["10-Year T-Note",0.015625,15.625],ZB:["30-Year T-Bond",0.03125,31.25],"6E":["Euro FX",0.00005,6.25],"6B":["British Pound",0.0001,6.25],"6J":["Japanese Yen",0.0000005,6.25],"6A":["Australian Dollar",0.00005,5]};
function futSpec(k){const f=FUT[k];return f?{sym:k,name:f[0],tick:f[1],tickValue:f[2],pointValue:f[2]/f[1]}:null}
// whole contracts you can trade without going over the risk budget
function futContracts(risk,stopTicks,tickValue){if(!(risk>0&&stopTicks>0&&tickValue>0))return 0;return Math.floor(risk/(stopTicks*tickValue)+1e-9)}
// gain needed to get back to break-even after a drawdown (fractions: 0.2 -> 0.25)
function ddRecovery(dd){return dd>=1?Infinity:dd/(1-dd)}
function expectancyR(winRate,rr){return winRate*rr-(1-winRate)}
function rng(seed){let a=seed>>>0;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
// Monte Carlo prop challenge. Each trade risks riskPct of current equity (or of the start balance if fixed), wins rr*risk with prob winRate.
// Fails on daily loss (vs. the day's starting equity) or max drawdown (static from start, or trailing from the equity peak).
function simChallenge(o,seed){const N=o.runs||1000,r=rng(seed||12345);let pass=0,failDD=0,failDay=0,timeout=0;const days=[];
for(let k=0;k<N;k++){let eq=o.acct,peak=o.acct,done=false;
  for(let d=1;d<=o.maxDays&&!done;d++){const dayStart=eq;
    for(let t=0;t<o.tradesPerDay;t++){const risk=(o.fixed?o.acct:eq)*o.riskPct/100;eq+=r()<o.winRate?risk*o.rr:-risk;if(eq>peak)peak=eq;
      const floor=o.trailing?Math.min(peak-o.acct*o.maxDD/100,o.acct):o.acct*(1-o.maxDD/100);
      if(eq<=floor){failDD++;done=true;break}
      if(o.dailyDD>0&&dayStart-eq>=o.acct*o.dailyDD/100){failDay++;done=true;break}
      if(eq>=o.acct*(1+o.target/100)){pass++;days.push(d);done=true;break}}}
  if(!done)timeout++}
days.sort((a,b)=>a-b);return{runs:N,pass:pass/N,failDD:failDD/N,failDay:failDay/N,timeout:timeout/N,medianDays:days.length?days[days.length>>1]:null}}
// journal statistics from closed trades [{pnl, r, date}] in date order
function tradeStats(trades,startBal){const T=trades.filter(t=>isFinite(t.pnl));const n=T.length;const wins=T.filter(t=>t.pnl>0),losses=T.filter(t=>t.pnl<0);
const gw=wins.reduce((a,t)=>a+t.pnl,0),gl=-losses.reduce((a,t)=>a+t.pnl,0),net=gw-gl;
const Rs=T.filter(t=>isFinite(t.r)).map(t=>t.r);let eq=startBal||0,peak=eq,maxDD=0,maxDDpct=0;const curve=[eq],rcurve=[0];let rc=0;
T.forEach(t=>{eq+=t.pnl;curve.push(eq);if(eq>peak)peak=eq;const dd=peak-eq;if(dd>maxDD)maxDD=dd;if(peak>0&&dd/peak>maxDDpct)maxDDpct=dd/peak;rc+=isFinite(t.r)?t.r:0;rcurve.push(rc)});
return{n,wins:wins.length,losses:losses.length,winRate:n?wins.length/n:0,net,grossWin:gw,grossLoss:gl,profitFactor:gl>0?gw/gl:(gw>0?Infinity:0),
expectancy:n?net/n:0,avgWin:wins.length?gw/wins.length:0,avgLoss:losses.length?gl/losses.length:0,avgR:Rs.length?Rs.reduce((a,b)=>a+b,0)/Rs.length:0,
maxDD,maxDDpct,equity:curve,rCurve:rcurve,balance:eq}}
// prop-firm rule usage: today's loss vs daily limit, drawdown vs max (static or trailing from the highest closed balance)
function propStatus(trades,o,today){const T=trades.filter(t=>isFinite(t.pnl));let bal=o.acct,peak=o.acct;T.forEach(t=>{bal+=t.pnl;if(bal>peak)peak=bal});
const dayPnl=T.filter(t=>String(t.date||"").slice(0,10)===today).reduce((a,t)=>a+t.pnl,0);
const dailyLimit=o.acct*o.dailyDD/100,maxLimit=o.acct*o.maxDD/100;
const floor=o.trailing?Math.min(peak-maxLimit,o.acct):o.acct-maxLimit;
return{balance:bal,peak,dayPnl,dailyUsed:dailyLimit>0?Math.max(0,-dayPnl)/dailyLimit:0,dailyLeft:dailyLimit+Math.min(0,dayPnl),
floor,maxUsed:maxLimit>0?Math.min(1,Math.max(0,1-(bal-floor)/maxLimit)):0,
toFloor:bal-floor,targetLeft:o.target>0?o.acct*(1+o.target/100)-bal:null}}
return{fxSpec,pipValueUSD,riskAmount,fxLots,FUT,futSpec,futContracts,ddRecovery,expectancyR,rng,simChallenge,tradeStats,propStatus};
})();
// </VTC>
// ---------- Calculators page ----------
S.calc=Object.assign({acct:S.acct||100000,riskPct:0.5,riskUsd:0,fxSym:"EURUSD",stopPips:20,rate:"",fut:"ES",stopTicks:16,pvSym:"GBPJPY",pvLots:1,pvFut:"NQ",pvCts:1,
accts:[{name:"Account A",size:100000,riskPct:0.5},{name:"Account B",size:50000,riskPct:0.5}],
sim:{target:8,maxDD:10,dailyDD:5,riskPct:1,winRate:45,rr:2,tradesPerDay:2,maxDays:30,trailing:false,fixed:true,runs:2000}},S.calc||{});
const usd=(v,d)=>v==null||!isFinite(v)?"\u2013":(v<0?"-":"")+"$"+Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:d==null?2:d,maximumFractionDigits:d==null?2:d});
const pct=(v,d)=>v==null||!isFinite(v)?"\u2013":(v*100).toFixed(d==null?1:d)+"%";
// latest known price for a symbol from the screener universe or the cache (no invented values)
function vtPx(n){const s=SYMS.find(x=>x[0]===n);if(s&&s[2]!=null)return s[2];for(const tf of ["1m","1H","1D"]){const a=LIVE[n+"|"+tf];if(a&&a.length)return a[a.length-1].c}return null}
function quoteUsdRate(spec){if(!spec)return null;if(spec.quote==="USD")return 1;const a=vtPx(spec.quote+"USD");if(a)return a;const b=vtPx("USD"+spec.quote);return b?1/b:null}
function cget(path){return path.split(".").reduce((o,k)=>o==null?o:o[k],S.calc)}
function cset(path,v){const ks=path.split("."),last=ks.pop();const o=ks.reduce((o,k)=>o[k],S.calc);o[last]=v}
const calcSave=deb(save,400);
function cin(path,label,o){o=o||{};const v=cget(path);
if(o.type==="check")return`<label class="chk"><input type="checkbox" data-ck="${path}" ${v?"checked":""}>${label}</label>`;
if(o.opts)return`<label>${label}<select data-ck="${path}">${o.opts.map(([k,n])=>`<option value="${esc(k)}" ${String(k)===String(v)?"selected":""}>${esc(n)}</option>`).join("")}</select></label>`;
return`<label>${label}<input data-ck="${path}" ${o.text?`type="text"`:`type="number" step="${o.step||"any"}" min="${o.min==null?0:o.min}"`} value="${esc(v==null?"":v)}" ${o.list?`list="${o.list}"`:""} ${o.ph?`placeholder="${esc(o.ph)}"`:""}></label>`}
function calcBuild(){const el=document.getElementById("pv-calc");if(!el)return;
const futOpts=Object.keys(VTC.FUT).map(k=>[k,k+" \u00b7 "+VTC.FUT[k][0]]);
const fxList=[...new Set([...FXW.map(w=>w.n),...(Array.isArray(SYMS)?SYMS:[]).filter(s=>s[1]==="FX").map(s=>s[0])])];
el.innerHTML=`<div class="pgw calc-pg"><div class="pgh"><h2>Calculators</h2><span class="mut">Position sizing, pip/tick values, drawdown recovery, and prop challenge Monte Carlo simulation.</span></div>
<datalist id="fxlist">${fxList.map(n=>`<option value="${n}">`).join("")}</datalist>
<div class="vcard"><h3>Account &amp; Risk Budget</h3><p class="calc-sub">Set your account balance and per-trade risk used across every calculator below.</p><div class="frm">${cin("acct","Account size ($)",{step:1000})}${cin("riskPct","Risk per trade (%)",{step:0.05})}${cin("riskUsd","Or fixed risk ($, overrides %)",{step:10})}</div><p class="cnote">Defaults to the screener's account size (${usd(S.acct,0)}). Risk budget: <b id="c_risk"></b></p></div>
<div class="vgrid">
<div class="vcard"><h3>Forex / metals position size</h3><p class="calc-sub">Calculate exact lot size and units from your stop distance in pips.</p><div class="frm">${cin("fxSym","Pair",{text:1,list:"fxlist"})}${cin("stopPips","Stop loss (pips)",{step:0.1})}${cin("rate","Quote to USD rate",{ph:"auto"})}</div>
<div class="cout"><div class="kpi"><div class="k">Lots</div><div class="v cbig" id="c_lots"></div></div><div class="kpi"><div class="k">Units</div><div class="v" id="c_units"></div></div><div class="kpi"><div class="k">Pip value / lot</div><div class="v" id="c_pv"></div></div><div class="kpi"><div class="k">Risk at stop</div><div class="v" id="c_rk"></div></div></div><p class="cnote" id="c_fxn"></p></div>
<div class="vcard"><h3>Futures contracts</h3><p class="calc-sub">Size CME/micro futures contracts based on tick value and stop ticks.</p><div class="frm">${cin("fut","Contract",{opts:futOpts})}${cin("stopTicks","Stop loss (ticks)",{step:1})}</div>
<div class="cout"><div class="kpi"><div class="k">Contracts</div><div class="v cbig" id="c_cts"></div></div><div class="kpi"><div class="k">Tick / point</div><div class="v" id="c_tk"></div></div><div class="kpi"><div class="k">Stop in points</div><div class="v" id="c_pts"></div></div><div class="kpi"><div class="k">Risk at stop</div><div class="v" id="c_frk"></div></div></div><p class="cnote" id="c_futn"></p></div>
<div class="vcard"><h3>Pip \u0026 tick value</h3><p class="calc-sub">Check USD dollar value per pip, tick, or point for any position size.</p><div class="frm">${cin("pvSym","FX pair",{text:1,list:"fxlist"})}${cin("pvLots","Lots",{step:0.01})}${cin("pvFut","Futures",{opts:futOpts})}${cin("pvCts","Contracts",{step:1})}</div>
<div class="cout"><div class="kpi"><div class="k">Per pip</div><div class="v" id="c_pp"></div></div><div class="kpi"><div class="k">Per 10 pips</div><div class="v" id="c_pp10"></div></div><div class="kpi"><div class="k">Per tick</div><div class="v" id="c_pt"></div></div><div class="kpi"><div class="k">Per point</div><div class="v" id="c_ppt"></div></div></div><p class="cnote" id="c_ppn"></p></div>
<div class="vcard"><h3>Drawdown recovery</h3><p class="calc-sub">Percentage gain and consecutive wins needed to recover from a drawdown.</p><div style="max-height:300px;overflow:auto" tabindex="0" role="region" aria-label="Drawdown recovery table"><table class="ftbl" id="c_rec"></table></div><p class="cnote">Wins needed assumes the challenge simulator's risk % and R:R below, compounding.</p></div>
<div class="vcard wide"><h3>Multiple prop accounts</h3><p class="calc-sub">Allocate FX lots and futures contracts across multiple funded accounts simultaneously.</p><table class="ftbl macc" id="c_macc"></table><div class="row" style="margin-top:8px"><button onclick="S.calc.accts.push({name:'Account '+String.fromCharCode(65+S.calc.accts.length),size:100000,riskPct:S.calc.riskPct});save();calcBuild()">+ Account</button><span class="mut">Uses the FX pair and stop, and the futures contract and stop, from the cards above.</span></div></div>
<div class="vcard wide"><h3>Challenge phase simulator</h3><p class="calc-sub">Estimate pass probability, drawdown risk, and expectancy path across simulated runs.</p><div class="frm">${cin("sim.target","Profit target (%)",{step:0.5})}${cin("sim.maxDD","Max drawdown (%)",{step:0.5})}${cin("sim.dailyDD","Daily loss limit (%)",{step:0.5})}${cin("sim.riskPct","Risk per trade (%)",{step:0.05})}${cin("sim.winRate","Win rate (%)",{step:1})}${cin("sim.rr","Avg reward : risk",{step:0.1})}${cin("sim.tradesPerDay","Trades per day",{step:1,min:1})}${cin("sim.maxDays","Days allowed",{step:1,min:1})}${cin("sim.runs","Simulations",{step:500,min:100})}</div>
<div class="row" style="margin-top:8px;flex-wrap:wrap">${cin("sim.trailing","Trailing drawdown (from equity peak)",{type:"check"})}${cin("sim.fixed","Risk a fixed % of the starting balance",{type:"check"})}</div>
<div class="cout" id="c_sim"></div><table class="ftbl" id="c_comp" style="margin-top:10px"></table><p class="cnote">Monte Carlo with a fixed seed, so the same inputs always give the same result. It's a model of your stats, not a forecast.</p></div>
</div></div>`;
el.querySelectorAll("[data-ck]").forEach(i=>{i.addEventListener(i.type==="checkbox"||i.tagName==="SELECT"?"change":"input",()=>{const p=i.dataset.ck;let v=i.type==="checkbox"?i.checked:i.value;
  if(i.type==="number"||(p==="rate"))v=v===""?"":(+v);if(p==="fxSym"||p==="pvSym")v=String(v).toUpperCase();cset(p,v);calcSave();calcUpdate(p)})});
calcUpdate()}
function calcFx(sym,stop,risk){const spec=VTC.fxSpec(sym),px=spec?vtPx(spec.base+spec.quote):null,auto=quoteUsdRate(spec),rate=S.calc.rate!==""&&+S.calc.rate>0&&sym===S.calc.fxSym?+S.calc.rate:auto;
const pv=VTC.pipValueUSD(spec,px,rate),lots=pv?VTC.fxLots(risk,stop,pv):0;return{spec,px,auto,rate,pv,lots}}
function calcUpdate(changed){const C=S.calc,$=id=>document.getElementById(id),set=(id,v)=>{const e=$(id);if(e)e.textContent=v};
if(!$("c_risk"))return;
const risk=VTC.riskAmount(+C.acct||0,+C.riskPct||0,+C.riskUsd||0);set("c_risk",usd(risk));
const fx=calcFx(C.fxSym,+C.stopPips,risk);
set("c_lots",fx.lots?fx.lots.toFixed(2):"\u2013");set("c_units",fx.spec&&fx.lots?Math.round(fx.lots*fx.spec.contract).toLocaleString("en-US"):"\u2013");set("c_pv",usd(fx.pv));
set("c_rk",fx.pv&&fx.lots?usd(Math.floor(fx.lots*100)/100*fx.pv*C.stopPips):"\u2013");
set("c_fxn",!fx.spec?"Type a 6-letter pair such as EURUSD or XAUUSD.":fx.pv==null?`No live ${fx.spec.quote}/USD rate yet. Enter it in "Quote to USD rate".`:`Pip = ${fx.spec.pip}, contract = ${fx.spec.contract.toLocaleString("en-US")} units${fx.px?`, price ${fp(fx.px)}`:""}${fx.spec.quote!=="USD"&&fx.spec.base!=="USD"?`, ${fx.spec.quote}/USD ${fx.rate.toFixed(5)}${S.calc.rate!==""&&+S.calc.rate>0?" (manual)":" (live)"}`:""}. Round lots down to your broker's step.`);
const fs=VTC.futSpec(C.fut),cts=fs?VTC.futContracts(risk,+C.stopTicks,fs.tickValue):0;
set("c_cts",fs?String(cts):"\u2013");set("c_tk",fs?usd(fs.tickValue)+" / "+usd(fs.pointValue,0):"\u2013");set("c_pts",fs?(+C.stopTicks*fs.tick).toFixed(4).replace(/\.?0+$/,""):"\u2013");
set("c_frk",fs?usd(cts*(+C.stopTicks)*fs.tickValue):"\u2013");
set("c_futn",fs?(cts===0&&risk>0?`One contract risks ${usd(+C.stopTicks*fs.tickValue)}, more than your budget. Try the micro contract or a tighter stop.`:`Tick size ${fs.tick}, tick value ${usd(fs.tickValue)}. Exchange specs. Check your broker's for CFDs.`):"");
const pf=calcFx(C.pvSym,1,0),pp=pf.pv!=null?pf.pv*(+C.pvLots||0):null;set("c_pp",usd(pp));set("c_ppn",pf.spec&&pf.pv==null?`Needs a live ${pf.spec.quote}/USD price (USD${pf.spec.quote} or ${pf.spec.quote}USD), which isn\u2019t loaded yet.`:"");set("c_pp10",pp==null?"\u2013":usd(pp*10));
const pfs=VTC.futSpec(C.pvFut);set("c_pt",pfs?usd(pfs.tickValue*(+C.pvCts||0)):"\u2013");set("c_ppt",pfs?usd(pfs.pointValue*(+C.pvCts||0)):"\u2013");
// drawdown recovery
const sm=C.sim,g=(sm.riskPct/100)*sm.rr;
$("c_rec").innerHTML=`<thead><tr><th class="l">Drawdown</th><th>Gain to recover</th><th>Wins needed</th></tr></thead><tbody>`+[5,10,15,20,25,30,40,50,60,75,90].map(d=>{const f=d/100,need=VTC.ddRecovery(f),w=g>0?Math.ceil(Math.log(1/(1-f))/Math.log(1+g)):null;
return`<tr><td class="l">-${d}%</td><td class="${need>0.5?"dn":""}">+${(need*100).toFixed(1)}%</td><td>${w==null?"\u2013":w}</td></tr>`}).join("")+`</tbody>`;
// multi-account
const ma=$("c_macc");if(ma&&(changed==null||!/^accts/.test(changed))){ma.innerHTML=`<thead><tr><th class="l">Account</th><th>Size ($)</th><th>Risk %</th><th>Risk $</th><th>${esc(C.fxSym)} lots</th><th>${esc(C.fut)} contracts</th><th></th></tr></thead><tbody>`+C.accts.map((a,i)=>`<tr><td class="l"><input data-ma="${i}.name" value="${esc(a.name)}"></td><td><input type="number" data-ma="${i}.size" value="${a.size}"></td><td><input type="number" step="0.05" data-ma="${i}.riskPct" value="${a.riskPct}"></td><td id="ma_r${i}"></td><td id="ma_l${i}"></td><td id="ma_c${i}"></td><td><button class="ib x" style="opacity:1" title="Remove" aria-label="Remove account" onclick="S.calc.accts.splice(${i},1);save();calcBuild()">${VT_IC.x}</button></td></tr>`).join("")+`<tr><td class="l"><b>Total</b></td><td id="ma_ts"></td><td></td><td id="ma_tr"></td><td id="ma_tl"></td><td id="ma_tc"></td><td></td></tr></tbody>`;
  ma.querySelectorAll("[data-ma]").forEach(i=>i.addEventListener("input",()=>{const[k,f]=i.dataset.ma.split(".");C.accts[+k][f]=f==="name"?i.value:+i.value;calcSave();calcUpdate("accts")}))}
let ts=0,tr=0,tl=0,tc=0;C.accts.forEach((a,i)=>{const r=VTC.riskAmount(+a.size||0,+a.riskPct||0,0),l=fx.pv?VTC.fxLots(r,+C.stopPips,fx.pv):0,c=fs?VTC.futContracts(r,+C.stopTicks,fs.tickValue):0;
  ts+=+a.size||0;tr+=r;tl+=l;tc+=c;set("ma_r"+i,usd(r));set("ma_l"+i,fx.pv?l.toFixed(2):"\u2013");set("ma_c"+i,fs?String(c):"\u2013")});
set("ma_ts",usd(ts,0));set("ma_tr",usd(tr));set("ma_tl",fx.pv?tl.toFixed(2):"\u2013");set("ma_tc",String(tc));
// challenge simulator
if(changed==null||/^sim|acct/.test(changed))calcSim()}
const calcSim=deb(()=>{const C=S.calc,sm=C.sim,el=document.getElementById("c_sim");if(!el)return;
const o={acct:+C.acct||100000,target:+sm.target,maxDD:+sm.maxDD,dailyDD:+sm.dailyDD,riskPct:+sm.riskPct,winRate:(+sm.winRate)/100,rr:+sm.rr,tradesPerDay:Math.max(1,Math.round(+sm.tradesPerDay)),maxDays:Math.max(1,Math.round(+sm.maxDays)),trailing:!!sm.trailing,fixed:!!sm.fixed,runs:Math.min(20000,Math.max(100,Math.round(+sm.runs)))};
const r=VTC.simChallenge(o,1234),ex=VTC.expectancyR(o.winRate,o.rr);
const k=(a,b,c)=>`<div class="kpi"><div class="k">${a}</div><div class="v ${c||""}">${b}</div></div>`;
el.innerHTML=k("Pass rate",pct(r.pass),r.pass>=0.5?"up":"dn")+k("Fail: max DD",pct(r.failDD))+k("Fail: daily limit",pct(r.failDay))+k("Out of time",pct(r.timeout))+k("Median days to pass",r.medianDays==null?"\u2013":r.medianDays)+k("Expectancy / trade",(ex>=0?"+":"")+ex.toFixed(2)+"R",ex>=0?"up":"dn");
// deterministic path at expectancy (no variance): balance after N trades
const rows=[5,10,20,30,50,100].map(n=>{let b=o.acct;for(let i=0;i<n;i++)b+=(o.fixed?o.acct:b)*o.riskPct/100*ex;return`<tr><td class="l">${n} trades</td><td>${usd(b,0)}</td><td class="${b>=o.acct?"up":"dn"}">${((b/o.acct-1)*100).toFixed(2)}%</td><td>${b>=o.acct*(1+o.target/100)?"target reached":""}</td></tr>`});
document.getElementById("c_comp").innerHTML=`<thead><tr><th class="l">At expectancy</th><th>Balance</th><th>Return</th><th></th></tr></thead><tbody>${rows.join("")}</tbody>`},250);
PAGE_HOOK.calc={enter(){calcBuild()}};
// ---------- Heatmaps page ----------
// Data plumbing (read-only, no feed changes):
//  * universe  = the screener's own SYMS list (filtered by market, ranked by traded value s[2]*s[3])
//  * values    = % change of the live price s[2] (updated by the existing WebSocket ticks) against the previous bar close
//                of the chosen timeframe, from the same candle store the screener uses (candles(); LIVE + IndexedDB cache +
//                server snapshot), or the momentum read-outs the screener already computes (scoreMarket / scoreSymbol, unchanged)
//  * first load = instant from whatever the cache restored at boot (LIVE/LT/SNAP); missing candles are requested through need()
//  * live      = a 1s refresh while the page is open (reads SYMS prices); only changed tiles are touched
const HM_TFS=["1H","4H","1D","1W"];
const HM_METRICS=[["chg","% change"],["mom","Momentum (signed expansion)"],["score","Vektor score"]];
const HM={timer:0,ro:null,key:"",tiles:new Map(),vals:new Map(),lastPx:new Map(),focus:null,stale:0};
const HM_DEF={mkt:"ALL",tf:"1D",metric:"chg",size:"value",n:(window.matchMedia&&matchMedia("(max-width:640px)").matches?30:60),range:"auto"};
function hmCfg(){const C=S.hm||(S.hm={});for(const k in HM_DEF)if(C[k]==null)C[k]=HM_DEF[k];return C}// fills in place: callers may keep a reference
function hmTradedValue(s){const v=(+s[3]||0)*(+s[2]||0);return isFinite(v)?v:0}
function hmUniverse(){const C=hmCfg();let L=SYMS.filter(s=>s&&s[0]&&(C.mkt==="ALL"||s[1]===C.mkt));
  L=L.slice().sort((a,b)=>hmTradedValue(b)-hmTradedValue(a)||String(a[0]).localeCompare(b[0]));return L.slice(0,C.n)}
function hmChg(s,tf){const a=candles(s,tf);if(!a||a.length<2)return null;const prev=a[a.length-2].c,px=s[2]!=null&&isFinite(s[2])?+s[2]:a[a.length-1].c;
  if(!(prev>0)||!(px>0))return null;return(px/prev-1)*100}
function hmVal(s){const C=hmCfg();try{if(C.metric==="score"){const v=scoreMarket(s);return typeof v==="number"&&isFinite(v)?v:null}
  if(C.metric==="mom"){const r=scoreSymbol(s);return r&&r.dir?r.dir*r.score:(r&&r.phase!=="\u2014"?0:null)}
  return hmChg(s,C.tf)}catch(e){return null}}
// diverging colour scale (our own palette; dark-terminal friendly, white text stays >= 4.5:1)
const HM_NEU=[42,46,57],HM_UP=[9,110,92],HM_DN=[178,34,47];
function hmRange(vals){const C=hmCfg();if(C.metric==="score")return 50;if(C.range!=="auto")return +C.range;
  const a=vals.filter(v=>v!=null).map(Math.abs).sort((x,y)=>x-y);if(!a.length)return 1;const p=a[Math.floor(a.length*0.9)]||a[a.length-1];return Math.max(0.25,+p.toPrecision(2))}
function hmColor(v,R){if(v==null)return"rgb(32,34,41)";const C=hmCfg();const x=C.metric==="score"?(v-50):v;const t=Math.max(-1,Math.min(1,x/R)),k=Math.pow(Math.abs(t),0.75),T=t>=0?HM_UP:HM_DN;
  return"rgb("+HM_NEU.map((n,i)=>Math.round(n+(T[i]-n)*k)).join(",")+")"}
function hmFmt(v){const C=hmCfg();if(v==null)return"\u2013";if(C.metric==="score")return Math.round(v)+"";if(C.metric==="mom")return(v>0?"+":v<0?"\u2212":"")+Math.round(Math.abs(v));
  return(v>0?"+":v<0?"\u2212":"")+Math.abs(v).toFixed(Math.abs(v)<10?2:1)+"%"}
// squarified treemap (Bruls et al.)
function hmSquarify(items,x,y,w,h){const out=[];let rest=items.filter(i=>i.w>0).slice().sort((a,b)=>b.w-a.w);const tot=rest.reduce((a,b)=>a+b.w,0);if(!tot||w<=0||h<=0)return out;
  const sc=w*h/tot;rest=rest.map(i=>Object.assign({},i,{a:i.w*sc}));
  const worst=(row,len)=>{const s=row.reduce((p,r)=>p+r.a,0),mx=Math.max(...row.map(r=>r.a)),mn=Math.min(...row.map(r=>r.a));return Math.max(len*len*mx/(s*s),s*s/(len*len*mn))};
  let row=[];while(rest.length){const len=Math.min(w,h),c=rest[0];
    if(!row.length||worst(row.concat([c]),len)<=worst(row,len)){row.push(c);rest.shift();continue}
    ({x,y,w,h}=hmLay(row,x,y,w,h,out));row=[]}
  if(row.length)hmLay(row,x,y,w,h,out);return out}
function hmLay(row,x,y,w,h,out){const s=row.reduce((p,r)=>p+r.a,0);
  if(w>=h){const cw=s/h;let yy=y;for(const r of row){const rh=r.a/cw;out.push(Object.assign(r,{x,y:yy,w:cw,h:rh}));yy+=rh}return{x:x+cw,y,w:w-cw,h}}
  const rh=s/w;let xx=x;for(const r of row){const cw=r.a/rh;out.push(Object.assign(r,{x:xx,y,w:cw,h:rh}));xx+=cw}return{x,y:y+rh,w,h:h-rh}}
function hmLayout(U,W,H){const C=hmCfg(),wt=s=>C.size==="equal"?1:1+Math.pow(Math.log10(1+hmTradedValue(s)),1.6);// log-compressed so one giant market cannot swallow the map
  const groups={};for(const s of U)(groups[s[1]]=groups[s[1]]||[]).push(s);const keys=Object.keys(groups);
  if(keys.length<=1)return{groups:[],tiles:hmSquarify(U.map(s=>({s,w:wt(s)})),0,0,W,H)};
  const sw=k=>groups[k].reduce((a,s)=>a+wt(s),0),tot=keys.reduce((a,k)=>a+sw(k),0)||1;
  /* each market group gets half its area by traded value and half by number of markets, so small groups stay readable */
  const G=hmSquarify(keys.map(k=>({k,w:tot*(0.5*sw(k)/tot+0.5*groups[k].length/U.length)})).sort((a,b)=>b.w-a.w),0,0,W,H),tiles=[];
  for(const g of G){const hd=g.h>60&&g.w>70?18:0;g.hd=hd;tiles.push(...hmSquarify(groups[g.k].map(s=>({s,w:wt(s)})),g.x+1,g.y+hd+1,g.w-2,g.h-hd-2))}
  return{groups:G,tiles}}
// ---- page ----
const HM_LABELS={"6E=F":"EUR","6A=F":"AUD","6B=F":"GBP","6J=F":"JPY","6C=F":"CAD","6S=F":"CHF","6N=F":"NZD","6M=F":"MXN","CL=F":"WTI","BZ=F":"Brent","GC=F":"Gold","SI=F":"Silver","PL=F":"Platinum","PA=F":"Palladium","NG=F":"NatGas","HG=F":"Copper","RB=F":"Gasoline","HO=F":"Heating Oil","ES=F":"S&P 500","NQ=F":"Nasdaq","YM=F":"Dow","RTY=F":"Russell","ZB=F":"30Y Bond","ZN=F":"10Y Note","ZF=F":"5Y Note","ZT=F":"2Y Note","CC=F":"Cocoa","KC=F":"Coffee","SB=F":"Sugar","ZW=F":"Wheat","ZC=F":"Corn","ZS=F":"Soybeans","CT=F":"Cotton","LE=F":"Cattle","HE=F":"Hogs","DX=F":"DXY"};
function hmDisp(sym){const k=String(sym||"");return HM_LABELS[k]||k.replace(/USDT$/,"")}
function hmBuild(){const el=document.getElementById("pv-heatmap");if(!el)return;const C=hmCfg();
  const mk=Object.keys(MK).filter(k=>k==="ALL"||SYMS.some(s=>s[1]===k));
  const seg=(id,label,opts,cur)=>`<div class="hmseg" role="group" aria-label="${label}"><span class="sxlbl">${label}</span>${opts.map(([v,n])=>`<button type="button" class="${String(cur)===String(v)?"on":""}" aria-pressed="${String(cur)===String(v)}" data-hm="${id}" data-v="${esc(v)}">${esc(n)}</button>`).join("")}</div>`;
  el.innerHTML=`<div class="pgw hmw"><div class="pgh"><h2>Heatmaps</h2><span class="hmlive" id="hm_src" aria-live="off"></span><span class="sp"></span><span class="mut hmasof" id="hm_asof"></span></div>
<div class="hmbar">${seg("mkt","Market",mk.map(k=>[k,MK[k]]),C.mkt)}${seg("metric","Colour by",HM_METRICS,C.metric)}${C.metric==="chg"?seg("tf","Change",HM_TFS.map(t=>[t,t]),C.tf):""}
${seg("size","Size",[["value","Traded value"],["equal","Equal"]],C.size)}${seg("n","Markets",[[30,"30"],[60,"60"],[100,"100"]],C.n)}${C.metric==="chg"?seg("range","Scale",[["auto","Auto"],[1,"\u00b11%"],[3,"\u00b13%"],[5,"\u00b15%"],[10,"\u00b110%"]],C.range):""}</div>
<div class="hmstats" id="hm_stats" aria-live="polite"></div>
<div class="hmgrid" id="hm_grid" role="region" aria-label="Market heatmap. Arrow keys move between markets, Enter opens the chart."><div class="vt-skel vt-skel-hm" role="status">Loading market heatmap…</div></div>
<div class="hmfoot"><div class="hmlegend" id="hm_leg" aria-hidden="true"></div><p class="vtna">Colours show ${C.metric==="chg"?"the change of the live price against the previous "+esc(C.tf)+" close":C.metric==="mom"?"the screener\u2019s expansion read-out (green = rising, red = falling)":"the Vektor score (50 = neutral)"}. ${VT_NA_TXT} <a href="#/legal/risk">Risk disclaimer</a></p></div>
<div class="hmtip" id="hm_tip" role="tooltip" hidden></div></div>`;
  el.querySelectorAll("[data-hm]").forEach(b=>b.onclick=()=>{const k=b.dataset.hm,v=b.dataset.v;C[k]=(k==="n"||(k==="range"&&v!=="auto"))?+v:v;save();HM.key="";hmBuild();hmTick(true)});
  const g=document.getElementById("hm_grid");
  g.addEventListener("keydown",hmKeys);
  g.addEventListener("pointerover",e=>{const t=e.target.closest(".hmt");if(t)hmTip(t)});g.addEventListener("pointerleave",()=>hmTip(null));
  g.addEventListener("focusin",e=>{const t=e.target.closest(".hmt");if(t)hmTip(t)});g.addEventListener("focusout",()=>hmTip(null));
  if(HM.ro)HM.ro.disconnect();HM.ro=new ResizeObserver(()=>{HM.key="";hmTick(true)});HM.ro.observe(g);HM.key=""}
function hmKeys(e){const T=[...document.querySelectorAll("#hm_grid .hmt")];const i=T.indexOf(document.activeElement);if(i<0)return;
  let j=null;const r=T[i].getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
  const pick=f=>{let best=null,bd=1e9;T.forEach((t,k)=>{if(k===i)return;const q=t.getBoundingClientRect(),x=q.left+q.width/2,y=q.top+q.height/2,d=f(x-cx,y-cy);if(d!=null&&d<bd){bd=d;best=k}});return best};
  if(e.key==="ArrowRight")j=pick((dx,dy)=>dx>2?dx+Math.abs(dy)*2:null);else if(e.key==="ArrowLeft")j=pick((dx,dy)=>dx<-2?-dx+Math.abs(dy)*2:null);
  else if(e.key==="ArrowDown")j=pick((dx,dy)=>dy>2?dy+Math.abs(dx)*2:null);else if(e.key==="ArrowUp")j=pick((dx,dy)=>dy<-2?-dy+Math.abs(dx)*2:null);
  else if(e.key==="Home")j=0;else if(e.key==="End")j=T.length-1;
  if(j!=null){e.preventDefault();T.forEach(t=>t.tabIndex=-1);T[j].tabIndex=0;T[j].focus()}}
function hmTip(t){const tip=document.getElementById("hm_tip");if(!tip)return;if(!t){tip.hidden=true;return}const s=symOf(t.dataset.s);if(!s){tip.hidden=true;return}
  const row=(a,b)=>`<div><span>${a}</span><b>${b}</b></div>`,pc=tf=>{const v=hmChg(s,tf);return v==null?"\u2013":(v>0?"+":v<0?"\u2212":"")+Math.abs(v).toFixed(2)+"%"};
  let sc="\u2013",tier="\u2013";try{const v=scoreMarket(s);if(typeof v==="number")sc=Math.round(v);tier=sxTier(s)}catch(e){}
  tip.innerHTML=`<div class="hmth"><b>${esc(s[0])}</b><span class="mut">${esc(MK[s[1]]||s[1])}</span></div>${row("Price",s[2]!=null?fp(s[2],s):"\u2013")}${HM_TFS.map(tf=>row(tf+" change",pc(tf))).join("")}${row("Vektor score",sc)}${row("Tier",tier)}${row("Traded value",hmTradedValue(s)?fm(hmTradedValue(s)):"\u2013")}<p class="mut">Enter or click opens the chart.</p>`;
  tip.hidden=false;const g=document.getElementById("hm_grid").getBoundingClientRect(),r=t.getBoundingClientRect(),W=tip.offsetWidth,H=tip.offsetHeight;
  let x=r.right-g.left+8,y=r.top-g.top;if(x+W>g.width)x=Math.max(0,r.left-g.left-W-8);if(y+H>g.height)y=Math.max(0,g.height-H);tip.style.left=x+"px";tip.style.top=(y+document.getElementById("hm_grid").offsetTop)+"px"}
function hmOpen(sym){openChart(sym);go("chart")}
function hmTick(force){const g=document.getElementById("hm_grid");if(!g||document.documentElement.dataset.page!=="heatmap")return;const C=hmCfg();
  const U=hmUniverse(),W=Math.floor(g.clientWidth),H=Math.floor(g.clientHeight);if(W<10||H<10)return;
  const vals=U.map(hmVal),R=hmRange(vals);const key=[W,H,C.mkt,C.metric,C.tf,C.size,C.n,U.map(s=>s[0]).sort().join(",")].join("|");
  if(force||key!==HM.key){HM.key=key;const L=hmLayout(U,W,H);const keep=document.activeElement&&document.activeElement.dataset?document.activeElement.dataset.s:null;
    g.innerHTML=L.groups.map(gr=>`<div class="hmgh" style="left:${gr.x}px;top:${gr.y}px;width:${gr.w}px;height:${gr.h}px"><span>${esc(MK[gr.k]||gr.k)}</span></div>`).join("")+
      L.tiles.map((t,i)=>{const s=t.s,big=t.w>86&&t.h>52,mid=t.w>46&&t.h>28;return`<button type="button" class="hmt${big?" big":mid?"":" tiny"}" data-s="${esc(s[0])}" tabindex="${i===0?0:-1}" style="left:${t.x.toFixed(1)}px;top:${t.y.toFixed(1)}px;width:${Math.max(0,t.w-2).toFixed(1)}px;height:${Math.max(0,t.h-2).toFixed(1)}px"><span class="hn">${esc(hmDisp(s[0]))}</span> <span class="hv"></span>${big?' <span class="hp"></span>':""}</button>`}).join("");
    HM.tiles=new Map([...g.querySelectorAll(".hmt")].map(b=>[b.dataset.s,b]));g.querySelectorAll(".hmt").forEach(b=>b.onclick=()=>hmOpen(b.dataset.s));
    /* fade the new tiles in with a diagonal sweep (08_motion.css); skipped under reduced motion */
    if(!(typeof VT_RM==="function"&&VT_RM())){const sw=W+H||1;L.tiles.forEach(t=>{const b=HM.tiles.get(t.s[0]);if(!b)return;const d=Math.round(Math.min(1,(t.x+t.y)/sw)*260);b.style.setProperty("--d",d+"ms");b.classList.add("vt-in");
      const end=()=>{b.classList.remove("vt-in");b.removeEventListener("animationend",onEnd)};
      const onEnd=ev=>{if(ev.animationName==="vtTileIn")end()};
      b.addEventListener("animationend",onEnd);setTimeout(end,d+480)})}
    if(keep&&HM.tiles.get(keep)){g.querySelectorAll(".hmt").forEach(t=>t.tabIndex=-1);HM.tiles.get(keep).tabIndex=0;HM.tiles.get(keep).focus({preventScroll:true})}HM.lastPx.clear()}
  // paint values (only touch what changed)
  let up=0,dn=0,fl=0,have=[];const rm=VT_RM();
  U.forEach((s,i)=>{const b=HM.tiles.get(s[0]);if(!b)return;const v=vals[i];if(v!=null){have.push([s,v]);if(C.metric==="score"?v>50:v>0)up++;else if(C.metric==="score"?v<50:v<0)dn++;else fl++}
    const bg=hmColor(v,R);if(b.style.background!==bg)b.style.background=bg;
    const tv=hmFmt(v),hv=b.querySelector(".hv");if(hv.textContent!==tv)hv.textContent=tv;b.classList.toggle("na",v==null);
    const hp=b.querySelector(".hp");if(hp){const p=s[2]!=null?fp(s[2],s):"";if(hp.textContent!==p)hp.textContent=p}
    const vis=[hmDisp(s[0]),b.classList.contains("tiny")?"":tv,hp?hp.textContent:""].filter(Boolean).join(" ");
    const lbl=vis+", "+s[0]+", "+(MK[s[1]]||s[1])+", "+(v==null?"no data yet":(C.metric==="chg"?C.tf+" change":C.metric==="mom"?"momentum":"score"));if(b.getAttribute("aria-label")!==lbl)b.setAttribute("aria-label",lbl);
    const lp=HM.lastPx.get(s[0]),px=s[2];if(lp!=null&&px!=null&&px!==lp&&!rm){b.classList.remove("fu","fd");void b.offsetWidth;b.classList.add(px>lp?"fu":"fd")}if(px!=null)HM.lastPx.set(s[0],px)});
  // stats + legend + source badge
  const st=document.getElementById("hm_stats");if(st){const sorted=have.slice().sort((a,b)=>b[1]-a[1]),med=have.length?sorted[Math.floor(sorted.length/2)][1]:null;
    const chip=([s,v])=>`<button type="button" class="hmchip ${(C.metric==="score"?v>=50:v>=0)?"up":"dn"}" data-s="${esc(s[0])}">${esc(hmDisp(s[0]))} <b>${hmFmt(v)}</b></button>`;
    const tot=up+dn+fl||1;const html=`<div class="hmbreadth" title="${up} up, ${dn} down, ${fl} flat"><i class="u" style="width:${up/tot*100}%"></i><i class="f" style="width:${fl/tot*100}%"></i><i class="d" style="width:${dn/tot*100}%"></i></div>
<span><b class="upc">${up}</b> up \u00b7 <b class="dnc">${dn}</b> down${fl?" \u00b7 "+fl+" flat":""}${med!=null?" \u00b7 median "+hmFmt(med):""} \u00b7 ${have.length}/${U.length} with data</span>
<span class="sp"></span>${sorted.length?`<span class="hmgrp"><span class="hml">Top</span>${sorted.slice(0,3).map(chip).join("")}</span><span class="hmgrp"><span class="hml">Bottom</span>${sorted.slice(-3).reverse().map(chip).join("")}</span>`:""}`;
    if(st.dataset.h!==html){st.dataset.h=html;st.innerHTML=html;st.querySelectorAll(".hmchip").forEach(b=>b.onclick=()=>hmOpen(b.dataset.s))}}
  const lg=document.getElementById("hm_leg");if(lg){const lab=C.metric==="score"?["0","50","100"]:C.metric==="mom"?["falling","flat","rising"]:["\u2212"+R+"%","0","+"+R+"%"];const html=`<span>${lab[0]}</span><i style="background:linear-gradient(90deg,${hmColor(C.metric==="score"?0:-R,R)},${hmColor(C.metric==="score"?50:0,R)},${hmColor(C.metric==="score"?100:R,R)})"></i><span>${lab[2]}</span>`;if(lg.dataset.h!==html){lg.dataset.h=html;lg.innerHTML=html}}
  const src=document.getElementById("hm_src"),asof=document.getElementById("hm_asof");if(src){const live=isLive(),ws=typeof VT_EDGE!=="undefined"&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1;
    const tf=C.metric==="mom"?"1D":C.tf;let t=0;for(const s of U){const k=s[0]+"|"+tf;if(LT[k]>t)t=LT[k]}
    if(typeof VT_EDGE!=="undefined"&&VT_EDGE.wsLastMsgAt>t)t=VT_EDGE.wsLastMsgAt;
    const fromCache=t&&t<performance.timeOrigin;/* restored from the IndexedDB cache or snapshot, not fetched in this session */const txt=!live?"Delayed / unavailable":ws?"Live":"Delayed";const cls=!live?"smp":ws?"on":"off";
    if(src.textContent!==txt){src.textContent=txt;src.className="hmlive "+cls}
    if(asof){const a=t?"Updated "+new Date(t).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})+(fromCache?" (cache)":""):"Connecting to live feed\u2026";if(asof.textContent!==a)asof.textContent=a}}}
PAGE_HOOK.heatmap={enter(){hmBuild();hmTick(true);requestAnimationFrame(()=>hmTick(true));clearInterval(HM.timer);HM.timer=setInterval(()=>{if(document.visibilityState==="visible")hmTick(false)},1000)},
  leave(){clearInterval(HM.timer);HM.timer=0;hmTip(null)}};
// ---------- Keyboard shortcut overlay ("?") ----------
// Lists the shortcuts the app really has (tests/shortcuts.js presses each one and checks it does what the list says).
// Opens with "?" anywhere except while typing, or from the footer button; Esc or "?" closes it.
const VT_MAC=/Mac|iPhone|iPad/.test((navigator.userAgentData&&navigator.userAgentData.platform)||navigator.platform||"");
const VT_KB=[
  {id:"general",t:"Anywhere",rows:[[["?"],"Show or hide this list"],[["Esc"],"Close a dialog, menu or panel"],[["Tab"],"Move between controls; the first Tab offers \u201cSkip to main content\u201d"],[["Enter"],"Activate the focused item (also Space)"]]},
  {id:"list",t:"Screener list (Workspace, Chart, Screener)",pages:["workspace","chart","screener"],rows:[[["Down"],"Next symbol in the list"],[["Up"],"Previous symbol in the list"]]},
  {id:"chart",t:"Chart (Workspace and Chart pages)",pages:["workspace","chart"],rows:[
    [["0\u20139"],"Change interval: type a number, e.g. 15 or 4H"],[["A\u2013Z"],"Search symbol: start typing a name"],
    [["Left","Right"],"Scroll the chart (hold Ctrl for bigger steps)",1],
    [["Ctrl","Z"],"Undo"],[["Ctrl","Y"],"Redo (or Ctrl+Shift+Z)"],[["Ctrl","S"],"Save now"],
    [["Alt","T"],"Trend line"],[["Alt","H"],"Horizontal line"],[["Alt","V"],"Vertical line"],[["Alt","F"],"Fibonacci retracement"],
    [["Alt","R"],"Rectangle"],[["Alt","A"],"Arrow"],[["Alt","N"],"Note"],
    [["Ctrl","Alt","H"],"Hide or show all drawings"],[["Delete"],"Delete the selected drawing (or Backspace)"],[["Esc"],"Cancel drawing and go back to the cursor"]]},
  {id:"heatmap",t:"Heatmaps",pages:["heatmap"],rows:[[["Left","Up","Right","Down"],"Move between markets",1],[["Home"],"First market"],[["End"],"Last market"],[["Enter"],"Open the chart"]]},
];
function vtKbKey(k){if(VT_MAC&&k==="Ctrl")k="Cmd";if(VT_MAC&&k==="Alt")k="Opt";return'<kbd>'+esc(k)+'</kbd>'}
function vtKbOpen(){if(document.querySelector(".kbm"))return vtKbClose();
  const pg=document.documentElement.dataset.page||"workspace";
  const secs=VT_KB.slice().sort((a,b)=>(b.pages&&b.pages.includes(pg)?1:0)-(a.pages&&a.pages.includes(pg)?1:0));
  const sec=s=>`<section class="kbs${s.pages&&s.pages.includes(pg)?" here":""}" aria-labelledby="kb_${s.id}"><h4 id="kb_${s.id}">${esc(s.t)}${s.pages&&s.pages.includes(pg)?' <span class="kbhere">This page</span>':""}</h4><dl>${s.rows.map(([k,d,or])=>`<div class="kbr"><dt>${k.map(vtKbKey).join(or?'<span class="kbp"> / </span>':'<span class="kbp" aria-hidden="true">+</span>')}</dt><dd>${esc(d)}</dd></div>`).join("")}</dl></section>`;
  modal(`<div class="kbm"><div class="kbhd"><h3 id="kb_title">Keyboard shortcuts</h3><span class="sp"></span><button type="button" class="ibtn" id="kb_x" aria-label="Close" onclick="closeM()">${VT_IC.x}</button></div>
<div class="kbg" tabindex="0" role="region" aria-label="Shortcut list">${vtKbCols(secs).map(c=>`<div class="kbc">${c.map(sec).join("")}</div>`).join("")}</div><p class="mut kbft">Shortcuts don\u2019t fire while you type in a field. Press <kbd>?</kbd> to open this list again.</p></div>`);
  const ov=MD.querySelector(".ov");if(ov){ov.classList.add("kbov");const b=ov.querySelector(".box");if(b)b.setAttribute("aria-labelledby","kb_title")}}
// two balanced columns (greedy by row count), keeping the sort order inside each column
function vtKbCols(secs){const c=[[],[]],h=[0,0];for(const x of secs){const i=h[0]<=h[1]?0:1;c[i].push(x);h[i]+=x.rows.length+2}return c}
function vtKbClose(){if(document.querySelector(".kbm"))closeM()}
function vtTyping(t){t=t||document.activeElement;return !!t&&(/INPUT|SELECT|TEXTAREA/.test(t.tagName||"")||t.isContentEditable)}
document.addEventListener("keydown",e=>{if(e.key!=="?"||e.ctrlKey||e.metaKey||e.altKey||e.defaultPrevented)return;if(vtTyping(e.target))return;
  if(MD.innerHTML&&!document.querySelector(".kbm"))return; // another dialog is open
  if(document.documentElement.classList.contains("locked"))return; // sign-in screen
  e.preventDefault();e.stopPropagation();vtKbOpen()},true);
// footer entry point (hidden on touch-only phones)
if(typeof vtFooterBuild==="function"){const _vtKbF=vtFooterBuild;vtFooterBuild=function(){const r=_vtKbF.apply(this,arguments);try{const f=document.querySelector("footer.vfoot");
  if(f&&!document.getElementById("vft_kb")){const b=document.createElement("button");b.type="button";b.className="lnk";b.id="vft_kb";b.textContent="Keyboard shortcuts";b.setAttribute("aria-keyshortcuts","Shift+Slash");b.onclick=vtKbOpen;f.appendChild(b)}}catch(e){}return r}}
// ---------- Mini-chart mode ----------
// A compact grid of small candle charts for the symbols on the current screener page (same filter, sort and paging as
// the table). Uses the existing candle store and live updates; missing candles are queued through need(), a few at a time.
// Only redraws a card when its last bar or price changed. Click / Enter opens the full chart.
const MINI_TFS=["15m","1H","4H","1D"],MINI_N=48;
const MINI={sig:"",cards:new Map(),raf:0,dirty:new Set(),lim:48};
function miniCfg(){if(!S.mini||typeof S.mini!=="object")S.mini={};if(typeof S.mini.on!=="boolean")S.mini.on=false;if(!MINI_TFS.includes(S.mini.tf))S.mini.tf="1H";return S.mini}
function miniToggle(on){const C=miniCfg();C.on=on==null?!C.on:!!on;save();miniApply();if(C.on)miniSync(true);else if(typeof render==="function")render()}
function miniApply(){const C=miniCfg(),tw=document.querySelector(".side>.tw")||document.getElementById("t")&&document.getElementById("t").closest(".tw");
  document.documentElement.classList.toggle("vt-mini",C.on);const b=document.getElementById("minib");if(b){b.setAttribute("aria-pressed",String(C.on));b.classList.toggle("on",C.on)}
  let g=document.getElementById("vtmini");if(C.on&&tw&&!g){g=document.createElement("div");g.id="vtmini";g.className="mini";g.setAttribute("role","region");g.setAttribute("aria-label","Mini charts");tw.appendChild(g);MINI.sig=""}
  if(!C.on&&g){g.remove();MINI.cards.clear();MINI.sig=""}}
function miniCols(){const k=document.documentElement.dataset.theme||(window.matchMedia&&matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light");if(MINI._col&&MINI._colKey===k)return MINI._col;const cs=getComputedStyle(document.documentElement),v=n=>cs.getPropertyValue(n).trim();MINI._colKey=k;return MINI._col={g:v("--g")||"#46d38a",r:v("--r")||"#f87171",m:v("--mut")||"#8a8f98",l:v("--line")||"#27272a",acc:v("--acc")||"#fb923c"}}
function miniBars(s,tf){const a=candles(s,tf);return a&&a.length?a.slice(-MINI_N):null}
function miniSync(force){const C=miniCfg();if(!C.on)return;const g=document.getElementById("vtmini");if(!g)return miniApply();
  /* the desktop list is one continuous list, so cards are shown in batches (Show more) rather than all at once */
  const all=(typeof PGL!=="undefined"&&PGL?PGL:[]),syms=all.slice(0,MINI.lim),sig=C.tf+"|"+all.length+"|"+syms.join(",");
  /* same cards in a new order (e.g. a tick re-sorted the list): move them instead of rebuilding and redrawing every card */
  const prevTf=MINI.sig?MINI.sig.split("|")[0]:null,mg=g.querySelector(".minig");
  if(!force&&sig!==MINI.sig&&prevTf===C.tf&&mg&&syms.length===MINI.cards.size&&syms.every(n=>MINI.cards.has(n))){MINI.sig=sig;for(const n of syms)mg.appendChild(MINI.cards.get(n).el)}
  if(force||sig!==MINI.sig){MINI.sig=sig;MINI.cards.clear();
    g.innerHTML=`<div class="minih"><span class="mut">Mini charts \u00b7 last ${MINI_N} bars</span><span class="sp"></span><div class="minitf" role="group" aria-label="Mini chart interval">${MINI_TFS.map(t=>`<button type="button" data-tf="${t}" aria-pressed="${t===C.tf}" class="${t===C.tf?"on":""}">${t}</button>`).join("")}</div></div>`+
      `<div class="minig">${syms.map(n=>`<button type="button" class="mc" data-s="${esc(n)}"><span class="mch"><b class="mcn">${esc(hmDisp(n))}</b> <span class="mcp"></span></span> <canvas aria-hidden="true"></canvas> <span class="mcf"><span class="mcc"></span> <span class="mcw mut"></span></span></button>`).join("")}</div>`+
      (all.length>syms.length?`<button type="button" class="mcmore">Show more (${syms.length} of ${all.length})</button>`:"")+
      (syms.length?"":`<p class="mut" style="padding:10px">No symbols match this list.</p>`);
    g.querySelectorAll(".minitf button").forEach(b=>b.onclick=()=>{miniCfg().tf=b.dataset.tf;save();miniSync(true)});
    {const mm=g.querySelector(".mcmore");if(mm)mm.onclick=()=>{MINI.lim+=48;miniSync(true)}}
    g.querySelectorAll(".mc").forEach(b=>{b.onclick=()=>openChart(b.dataset.s);MINI.cards.set(b.dataset.s,{el:b,k:""})})}
  let asked=0;for(const [n,c] of MINI.cards){const s=symOf(n);if(!s)continue;const B=miniBars(s,C.tf);
    if(!B&&asked<8&&typeof need==="function"&&(typeof isLive!=="function"||isLive())){try{need(s,C.tf,false)}catch(e){}asked++}
    const last=B&&B[B.length-1],k=[B?B.length:0,last&&last.t,last&&last.c,last&&last.h,last&&last.l,s[2],document.documentElement.dataset.theme||""].join("|");
    if(force||k!==c.k){c.k=k;MINI.dirty.add(n)}}
  if(MINI.dirty.size&&!MINI.raf)MINI.raf=requestAnimationFrame(miniFlush)}
function miniFlush(){MINI.raf=0;const C=miniCfg(),col=miniCols();for(const n of MINI.dirty){const c=MINI.cards.get(n),s=symOf(n);if(c&&s)miniDraw(c.el,s,miniBars(s,C.tf),C.tf,col)}MINI.dirty.clear()}
function miniDraw(el,s,B,tf,col){const cv=el.querySelector("canvas"),p=el.querySelector(".mcp"),ch=el.querySelector(".mcc"),w=el.querySelector(".mcw");
  const px=s[2]!=null?s[2]:B&&B.length?B[B.length-1].c:null;p.textContent=px!=null?fp(px):"\u2013";
  const disp=hmDisp(s[0]);
  if(!B||B.length<2){el.classList.add("na");ch.textContent="";w.textContent="Loading "+tf+" candles\u2026";el.setAttribute("aria-label",[disp,p.textContent,w.textContent].filter(Boolean).join(" ")+" ("+s[0]+"). Opens the chart.");const x=cv.getContext("2d");x.clearRect(0,0,cv.width,cv.height);return}
  el.classList.remove("na");
  const first=B[0].o!=null?B[0].o:B[0].c,lastC=B[B.length-1].c,pc=(lastC/first-1)*100;
  ch.textContent=(pc>0?"+":pc<0?"\u2212":"")+Math.abs(pc).toFixed(2)+"%";ch.className="mcc "+(pc>=0?"up":"dn");
  const span=(MINI_N*({"15m":15,"1H":60,"4H":240,"1D":1440}[tf]||60))/60;w.textContent=B.length+" \u00d7 "+tf+(span>=48?" \u00b7 ~"+Math.round(span/24)+"d":" \u00b7 ~"+Math.round(span)+"h");
  el.setAttribute("aria-label",[disp,p.textContent,ch.textContent,w.textContent].filter(Boolean).join(" ")+" ("+s[0]+"). Opens the chart.");
  const dpr=Math.min(2,window.devicePixelRatio||1);
  if(!cv._mw||!cv._mh||!cv.width||!cv.height){cv._mw=cv.clientWidth||140;cv._mh=cv.clientHeight||56}
  const W=cv._mw,H=cv._mh;if(cv.width!==Math.round(W*dpr)||cv.height!==Math.round(H*dpr)){cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr)}
  const x=cv.getContext("2d");x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,W,H);
  let lo=Infinity,hi=-Infinity;for(const b of B){if(b.l<lo)lo=b.l;if(b.h>hi)hi=b.h}if(!(hi>lo)){hi=lo*1.001+1e-9;lo=lo*.999}
  const pad=3,Y=v=>pad+(hi-v)/(hi-lo)*(H-pad*2),n=B.length,step=W/n,bw=Math.max(1,Math.min(6,step*.62));
  // last price guide
  x.strokeStyle=col.acc;x.globalAlpha=.55;x.setLineDash([2,3]);x.beginPath();x.moveTo(0,Math.round(Y(lastC))+.5);x.lineTo(W,Math.round(Y(lastC))+.5);x.stroke();x.setLineDash([]);x.globalAlpha=1;
  for(let i=0;i<n;i++){const b=B[i],o=b.o!=null?b.o:b.c,up=b.c>=o,cx=Math.round(i*step+step/2)+.5;x.strokeStyle=x.fillStyle=up?col.g:col.r;
    x.beginPath();x.moveTo(cx,Y(b.h));x.lineTo(cx,Y(b.l));x.stroke();const y1=Y(Math.max(o,b.c)),y2=Y(Math.min(o,b.c));x.fillRect(Math.round(cx-bw/2),y1,bw,Math.max(1,y2-y1))}}
// hook into the normal render (called on every tick) and keep the toggle in the list toolbar
if(typeof render==="function"){const _miniR=render;render=function(){const r=_miniR.apply(this,arguments);try{miniEnsureBtn();if(miniCfg().on){miniApply();miniSync(false)}}catch(e){console.error(e)}return r}}
function miniEnsureBtn(){if(document.getElementById("minib"))return;const data=document.querySelector('section.ctl button[onclick="scrSetM()"],section.ctl button[onclick="dataM()"]'),ctl=data?data.parentNode:document.getElementById("q")&&document.getElementById("q").parentNode;if(!ctl)return;const b=document.createElement("button");b.type="button";b.id="minib";
  b.title="Mini charts: show the list as small charts";b.setAttribute("aria-label","Mini charts");b.setAttribute("aria-pressed",String(miniCfg().on));
  b.innerHTML='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.5 1.5h5.5v5.5H1.5zM9 1.5h5.5v5.5H9zM1.5 9h5.5v5.5H1.5zM9 9h5.5v5.5H9z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 5.5l1.5-1.5 1 1 1.5-2M10 5.5l1.5-2 1 1 1.5-1.5M2.5 13l1.5-2 1 1 1.5-1.5M10 13l1.5-1 1 .5 1.5-2" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
  b.onclick=()=>miniToggle();if(data)data.after(b);else ctl.appendChild(b);b.classList.toggle("on",miniCfg().on)}
// redraw when the theme or size changes
window.addEventListener("resize",()=>{if(S.mini&&S.mini.on)miniSync(true)});
// ---------- Alert sound cue ----------
// Off by default. Turning it on works straight away for this tab; it's only remembered on this device (localStorage
// "vt_prefs") if "Optional preferences" is allowed in Cookie settings. Withdrawing that choice deletes the saved value.
// The tone is generated with Web Audio (no audio files, nothing downloaded).
const VT_SND_VOL={low:.06,medium:.12,high:.22};
const VT_PREF={alertSound:false,alertVol:"medium"};
function vtPrefsRead(){if(typeof vtPrefsOK!=="function"||!vtPrefsOK())return null;try{const o=JSON.parse(localStorage.getItem(VT_PREFS_KEY)||"null");return o&&typeof o==="object"?o:null}catch(e){return null}}
function vtPrefsWrite(){if(typeof vtPrefsOK!=="function"||!vtPrefsOK())return false;try{localStorage.setItem(VT_PREFS_KEY,JSON.stringify({alertSound:!!VT_PREF.alertSound,alertVol:VT_PREF.alertVol}));return true}catch(e){return false}}
// read after every module has loaded (the consent helpers live in 91_privacy)
setTimeout(()=>{const o=vtPrefsRead();if(o){VT_PREF.alertSound=o.alertSound===true;if(VT_SND_VOL[o.alertVol])VT_PREF.alertVol=o.alertVol}},0);
// returns true when the choice was saved on the device, false when it only lasts for this tab
function vtSoundSet(on,vol){VT_PREF.alertSound=!!on;if(vol&&VT_SND_VOL[vol])VT_PREF.alertVol=vol;return vtPrefsWrite()}
document.addEventListener("vt-consent",e=>{if(e.detail&&e.detail.prefs&&VT_PREF.alertSound)vtPrefsWrite()});
let VT_ACTX=null;
// a soft two-note chime (E5 then A5) with a short fade, quieter than the old fixed beep
function vtChime(vol){try{const C=VT_ACTX||(VT_ACTX=new (window.AudioContext||window.webkitAudioContext)());if(C.state==="suspended")C.resume();const t0=C.currentTime+.01,v=VT_SND_VOL[vol||VT_PREF.alertVol]||.12;
  [[659.25,0],[880,.12]].forEach(([f,d])=>{const o=C.createOscillator(),g=C.createGain();o.type="sine";o.frequency.value=f;o.connect(g);g.connect(C.destination);
    g.gain.setValueAtTime(0,t0+d);g.gain.linearRampToValueAtTime(v,t0+d+.015);g.gain.exponentialRampToValueAtTime(.0001,t0+d+.38);o.start(t0+d);o.stop(t0+d+.4)});
  window.__vtChimes=(window.__vtChimes||0)+1;return true}catch(e){return false}}
function vtAlertSound(){if(!VT_PREF.alertSound)return false;return vtChime()}
// alert history for the session summary: every triggered alert with its time and price (kept with the alerts in scr2)
function vtAlertLog(a,price){if(!Array.isArray(S.alog))S.alog=[];S.alog.push({sym:a.sym,dir:a.dir,level:+a.price,px:+price,at:Date.now(),msg:a.msg?String(a.msg).slice(0,140):""});if(S.alog.length>200)S.alog.splice(0,S.alog.length-200)}
if(typeof fireAlert==="function"){const _vtFA=fireAlert;fireAlert=function(a,price){try{vtAlertLog(a,price);save()}catch(e){}return _vtFA.apply(this,arguments)}}
// the settings row inside the Price Alerts dialog
function vtSoundRow(){const saved=typeof vtPrefsOK==="function"&&vtPrefsOK();
  return`<div class="sndrow" role="group" aria-labelledby="snd_l"><div class="sndh"><b id="snd_l">Alert sound</b><span class="sp"></span>
<label class="sw"><input type="checkbox" id="snd_on" ${VT_PREF.alertSound?"checked":""}><span>Play a sound when an alert triggers</span></label></div>
<div class="sndc"><label for="snd_vol">Volume</label><select id="snd_vol">${Object.keys(VT_SND_VOL).map(k=>`<option value="${k}" ${VT_PREF.alertVol===k?"selected":""}>${k[0].toUpperCase()+k.slice(1)}</option>`).join("")}</select>
<button type="button" id="snd_test">Play test sound</button></div>
<p class="mut sndn" id="snd_note" aria-live="polite">${vtSoundNote(saved)}</p></div>`}
function vtSoundNote(saved){return VT_PREF.alertSound?(saved?"On. Remembered on this device (optional preferences allowed).":"On for this tab only. To remember it, allow \u201cOptional preferences\u201d in Cookie settings."):"Off. No sound plays when an alert triggers."}
function vtSoundWire(){const on=document.getElementById("snd_on");if(!on)return;const vol=document.getElementById("snd_vol"),note=document.getElementById("snd_note");
  const upd=()=>{const saved=vtSoundSet(on.checked,vol.value);note.textContent=vtSoundNote(saved)};
  on.onchange=upd;vol.onchange=upd;document.getElementById("snd_test").onclick=()=>vtChime(vol.value)}
if(typeof alertsM==="function"){const _vtAM=alertsM;alertsM=function(){const r=_vtAM.apply(this,arguments);try{const box=MD.querySelector(".box");if(box&&!box.querySelector(".sndrow")){const d=document.createElement("div");d.innerHTML=vtSoundRow();const row=box.querySelector(".row");(row?row.parentNode:box).insertBefore(d.firstElementChild,row?row.nextSibling:null);vtSoundWire()}}catch(e){console.error(e)}return r}}
// ---------- End-of-day session summary ----------
// Built only from data the app already has: position-tool drawings (long/short) with their own risk settings and the
// candle store, live prices vs the previous daily close (same definition as the heatmap and the "% change 1D" column),
// and the log of alerts that triggered (S.alog). Nothing is estimated or filled in; empty sections say so.
const SUM={chipDay:""};
function vtDayStart(d){d=d||new Date();return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime()}
function vtTZ(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||"local time"}catch(e){return"local time"}}
function vtChg1D(s){if(!s||s[2]==null)return null;const a=candles(s,"1D");if(!a||a.length<2)return null;const p=a[a.length-2].c;return p?(s[2]/p-1)*100:null}
function vtPosBars(s){for(const tf of ["1m","5m","15m","1H","4H","1D"]){const a=candles(s,tf);if(a&&a.length)return{tf,a}}return null}
function vtSumPositions(t0){const out=[];const now=Date.now()/1000;
  for(const sym in (S.dr||{})){const L=S.dr[sym];if(!Array.isArray(L))continue;const s=symOf(sym);
    for(const d of L){if(!d||(d.t!=="long"&&d.t!=="short")||!d.p||d.p.length<3)continue;
      const E=+d.p[0].y,T=+d.p[1].y,Sx=+d.p[2].y,te=+d.p[0].t,tend=Math.max(+d.p[1].t||te,te);if(!(E>0)||!(te<=now))continue;
      const o=typeof posO==="function"?posO(d):{acct:1e4,risk:1,ru:"%",lot:1,lev:0,prec:2};
      const c=posCalc({side:d.t,entry:E,tp:T,sl:Sx,acct:o.acct,risk:o.risk,ru:o.ru,lot:o.lot,lev:o.lev,prec:o.prec,pv:1,tick:s&&s[2]<10?1e-4:.01});
      const B=s&&vtPosBars(s);const st=B?posState(B.a,d.t,E,T,Sx,te,tend):{state:"none"};
      let pnl=null,kind="";if(st.state==="tp"){pnl=c.pnlTP;kind="closed"}else if(st.state==="sl"){pnl=c.pnlSL;kind="closed"}else if(st.state==="open"&&tend*1000>=Date.now()-6e4){const px=s&&s[2]!=null?s[2]:st.px;pnl=c.pnlAt(px);kind="open"}
      // only what belongs to today: closed today, or still open now
      if(kind==="closed"&&st.t*1000<t0)continue;if(!kind)continue;
      out.push({sym,side:d.t,entry:E,tp:T,sl:Sx,state:st.state,at:st.t*1000,qty:c.qty,pnl,kind,tf:B&&B.tf})}}
  return out}
function vtSumData(){const t0=vtDayStart(),live=typeof isLive==="function"&&isLive();
  const ch=[];for(const s of SYMS){const v=vtChg1D(s);if(v!=null&&isFinite(v))ch.push([s,v])}ch.sort((a,b)=>b[1]-a[1]);
  const up=ch.filter(x=>x[1]>0).length,dn=ch.filter(x=>x[1]<0).length;
  const wl=[];((S.wlx&&S.wlx.groups)||[]).forEach(g=>g.syms.forEach(n=>{const s=symOf(n),v=vtChg1D(s);if(v!=null&&!wl.some(x=>x[0][0]===n))wl.push([s,v])}));wl.sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
  const al=(S.alog||[]).filter(a=>a&&a.at>=t0).sort((a,b)=>a.at-b.at);
  const pos=vtSumPositions(t0),closed=pos.filter(p=>p.kind==="closed"),open=pos.filter(p=>p.kind==="open");
  const sum=a=>a.reduce((x,p)=>x+(p.pnl||0),0);
  return{t0,now:Date.now(),live,total:SYMS.length,withData:ch.length,gain:ch.slice(0,5).filter(x=>x[1]>0),lose:ch.slice(-5).reverse().filter(x=>x[1]<0),up,dn,wl:wl.slice(0,8),al,closed,open,real:sum(closed),unreal:sum(open),wins:closed.filter(p=>p.pnl>0).length}}
const vtSgn=v=>(v>0?"+":v<0?"\u2212":"")+Math.abs(v).toFixed(2);
const vtPct=v=>vtSgn(v)+"%";
const vtHM=t=>new Date(t).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});
function vtSumText(D){const L=[],day=new Date(D.t0).toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  L.push("Vektor Terminal \u2013 session summary","Day: "+day+" (since 00:00, "+vtTZ()+"), generated "+vtHM(D.now),"Prices: "+(D.live?"live and delayed market feeds":"feed unavailable"),"");
  L.push("Position tool (paper positions from your long/short drawings)");if(!D.closed.length&&!D.open.length)L.push("  No positions closed today or open now.");
  D.closed.forEach(p=>L.push("  "+p.sym+" "+p.side+" "+(p.state==="tp"?"target hit":"stop hit")+" "+vtHM(p.at)+": "+vtSgn(p.pnl)));D.open.forEach(p=>L.push("  "+p.sym+" "+p.side+" open: "+vtSgn(p.pnl)));
  if(D.closed.length||D.open.length)L.push("  Closed today: "+vtSgn(D.real)+" ("+D.wins+" of "+D.closed.length+" at target)   Open now: "+vtSgn(D.unreal));L.push("");
  L.push("Markets ("+D.withData+" of "+D.total+" with daily candles): "+D.up+" up, "+D.dn+" down");
  L.push("  Top gainers: "+(D.gain.map(([s,v])=>s[0]+" "+vtPct(v)).join(", ")||"none"));L.push("  Top losers: "+(D.lose.map(([s,v])=>s[0]+" "+vtPct(v)).join(", ")||"none"));
  if(D.wl.length)L.push("  Watchlist: "+D.wl.map(([s,v])=>s[0]+" "+vtPct(v)).join(", "));L.push("");
  L.push("Alerts triggered today: "+D.al.length);D.al.forEach(a=>L.push("  "+vtHM(a.at)+" "+a.sym+" "+(a.dir==="below"?"crossed down through":a.dir==="above"?"crossed up through":"crossed")+" "+a.level+" (price "+a.px+")"+(a.msg?" \u2013 "+a.msg:"")));
  L.push("","Rule-based figures from past prices; not investment advice.");return L.join("\n")}
function vtSumM(){const D=vtSumData();SUM.last=D;const day=new Date(D.t0).toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",year:"numeric"});
  const mv=([s,v])=>`<li><button type="button" class="lnk sm_sym" data-s="${esc(s[0])}">${esc(String(s[0]).replace(/USDT$/,""))}</button><span class="mut">${esc(MK[s[1]]||s[1])}</span><b class="${v>=0?"up":"dn"}">${vtPct(v)}</b></li>`;
  const posRow=p=>`<tr><td>${esc(p.sym)}</td><td>${p.side==="long"?"Long":"Short"}</td><td>${p.kind==="open"?"Open":p.state==="tp"?"Target hit "+vtHM(p.at):"Stop hit "+vtHM(p.at)}</td><td class="num">${fp(p.entry)}</td><td class="num ${p.pnl>=0?"up":"dn"}">${vtSgn(p.pnl)}</td></tr>`;
  const hasPos=D.closed.length||D.open.length;
  modal(`<div class="smm"><div class="smhd"><div><h3 id="sm_t">Today\u2019s session</h3><p class="mut">${esc(day)} \u00b7 since 00:00 (${esc(vtTZ())}) \u00b7 updated ${vtHM(D.now)}</p></div><span class="sp"></span><button type="button" class="ibtn" aria-label="Close" onclick="closeM()">${VT_IC.x}</button></div>
${D.live?"":`<p class="smwarn" role="note">Feed unavailable: live market prices are currently not connected.</p>`}
<div class="smk">
<div class="smc"><span class="mut">Closed today (position tool)</span><b class="${D.real>=0?"up":"dn"}" id="sm_real">${hasPos?vtSgn(D.real):"\u2013"}</b><span class="mut">${D.closed.length?D.wins+" of "+D.closed.length+" at target":"no positions closed"}</span></div>
<div class="smc"><span class="mut">Open now</span><b class="${D.unreal>=0?"up":"dn"}" id="sm_unreal">${D.open.length?vtSgn(D.unreal):"\u2013"}</b><span class="mut">${D.open.length} open</span></div>
<div class="smc"><span class="mut">Markets up / down</span><b id="sm_breadth">${D.up} / ${D.dn}</b><span class="mut">${D.withData} of ${D.total} with daily candles</span></div>
<div class="smc"><span class="mut">Alerts triggered</span><b id="sm_alc">${D.al.length}</b><span class="mut">today</span></div></div>
<section class="sms"><h4>Positions</h4>${hasPos?`<div class="smtw" tabindex="0" role="region" aria-label="Positions"><table class="smt"><thead><tr><th>Symbol</th><th>Side</th><th>Status</th><th class="num">Entry</th><th class="num">P\u0026L</th></tr></thead><tbody>${D.closed.map(posRow).join("")}${D.open.map(posRow).join("")}</tbody></table></div><p class="mut smn">Paper results of your long/short position drawings, using each drawing\u2019s own account and risk settings. Not trades with a broker.</p>`:`<p class="mut">No positions closed today or open now. Long/short position drawings on your charts are totalled here.</p>`}</section>
<section class="sms smg"><div><h4>Top gainers</h4>${D.gain.length?`<ol class="sml">${D.gain.map(mv).join("")}</ol>`:`<p class="mut">None yet.</p>`}</div><div><h4>Top losers</h4>${D.lose.length?`<ol class="sml">${D.lose.map(mv).join("")}</ol>`:`<p class="mut">None yet.</p>`}</div>
${D.wl.length?`<div><h4>Your watchlist</h4><ol class="sml">${D.wl.map(mv).join("")}</ol></div>`:""}</section>
<section class="sms"><h4>Alerts triggered today</h4>${D.al.length?`<ul class="sma">${D.al.map(a=>`<li><span class="mut">${vtHM(a.at)}</span><b>${esc(a.sym)}</b><span>${a.dir==="below"?"crossed down through":a.dir==="above"?"crossed up through":"crossed"} ${esc(String(a.level))}</span><span class="mut">price ${esc(String(a.px))}</span>${a.msg?`<span class="mut">\u201c${esc(a.msg)}\u201d</span>`:""}</li>`).join("")}</ul>`:`<p class="mut">No alerts triggered today.</p>`}</section>
<p class="vtna smna">Change = live price against the previous daily close, the same as the heatmap and the \u201c% change 1D\u201d column. ${VT_NA_TXT}</p>
<div class="row"><span class="sp"></span><button type="button" id="sm_copy">Copy as text</button><button type="button" id="sm_dl">Download .txt</button><button type="button" class="pri" onclick="closeM()">Close</button></div></div>`);
  const box=MD.querySelector(".box");if(box)box.setAttribute("aria-labelledby","sm_t");
  MD.querySelectorAll(".sm_sym").forEach(b=>b.onclick=()=>{closeM();go("workspace");openChart(b.dataset.s)});
  document.getElementById("sm_copy").onclick=async()=>{const t=vtSumText(D);try{await navigator.clipboard.writeText(t);toast("Summary copied")}catch(e){toast("Couldn\u2019t copy; use Download instead")}};
  document.getElementById("sm_dl").onclick=()=>{const t=vtSumText(D),a=document.createElement("a");a.href=URL.createObjectURL(new Blob([t],{type:"text/plain"}));a.download="vektor-session-"+new Date(D.t0).toISOString().slice(0,10)+".txt";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}}
// entry points: a header button (desktop/tablet), the phone "More" sheet, and a one-off chip after 21:00 local time
function vtSumBtn(){if(document.getElementById("sumb"))return;const t=document.getElementById("thm");if(!t)return;const b=document.createElement("button");b.type="button";b.id="sumb";b.className="theme-btn";b.title="Today\u2019s session summary";b.textContent="Today";b.onclick=vtSumM;t.before(b)}
vtSumBtn();
if(typeof vtMoreOpen==="function"){const _vtSMo=vtMoreOpen;vtMoreOpen=function(){const r=_vtSMo.apply(this,arguments);try{const m=document.getElementById("vmore");if(m&&!m.querySelector("#vm_sum")){const h=document.createElement("h3");h.textContent="Tools";const g=document.createElement("div");g.className="grid";
  g.innerHTML='<button type="button" id="vm_sum">Today\u2019s session</button>';const pg=m.querySelector(".grid");(pg?pg.nextSibling:null)?m.insertBefore(h,pg.nextSibling):m.appendChild(h);h.after(g);g.querySelector("#vm_sum").onclick=()=>{vtMoreClose();vtSumM()}}}catch(e){}return r}}
function vtSumChip(force){const now=new Date(),key=now.toDateString();if(SUM.chipDay===key||(!force&&now.getHours()<21))return; /* once per day; "force" only skips the 21:00 check */if(document.getElementById("vtsumchip")||document.documentElement.classList.contains("locked"))return;SUM.chipDay=key;
  const c=document.createElement("div");c.id="vtsumchip";c.className="vtsumchip";c.setAttribute("role","status");
  c.innerHTML='<span>Today\u2019s session summary is ready.</span><button type="button" class="pri" id="vtsum_open">Open</button><button type="button" class="ibtn" id="vtsum_x" aria-label="Dismiss">'+VT_IC.x+'</button>';document.body.appendChild(c);
  let timer=0;
  const dismiss=()=>{clearTimeout(timer);c.remove()};
  const armTimer=()=>{clearTimeout(timer);timer=setTimeout(dismiss,6000)};
  c.addEventListener("mouseenter",()=>clearTimeout(timer));
  c.addEventListener("focusin",()=>clearTimeout(timer));
  c.addEventListener("mouseleave",armTimer);
  c.addEventListener("focusout",armTimer);
  armTimer();
  c.querySelector("#vtsum_open").onclick=()=>{dismiss();vtSumM()};c.querySelector("#vtsum_x").onclick=dismiss}
setInterval(()=>{if(!document.hidden&&typeof BOOTED!=="undefined"&&BOOTED)vtSumChip(false)},60000);
