// ---------- full-app sweep fixes ----------
// 1) Chart load errors: the chart used to sit on "Loading candles…" forever when a feed failed.
//    Now it shows the real error with a Try again button (clears that one error and refetches).
function vtChartErr(cv,msg){if(!cv)return;cv.textContent="";const d=document.createElement("div");d.className="vt-cverr";d.setAttribute("role","alert");
  const p=document.createElement("p");p.textContent="Couldn\u2019t load candles \u2014 "+String(msg).slice(0,160);
  const h=document.createElement("p");h.className="mut";h.textContent=/key/i.test(msg)?"Add a data key under Settings \u203a Data, or pick another symbol.":"The data source may be busy or blocked on this network. Try again, or pick another symbol.";
  const b=document.createElement("button");b.type="button";b.id="vt_cvretry";b.textContent="Try again";b.onclick=()=>vtChartRetry();
  d.append(p,h,b);cv.append(d)}
function vtChartRetry(){const C=S.chart,s=symOf(C.sym);if(!s)return;delete ERR[s[0]+"|"+C.tf];need(s,C.tf,true);drawChart()}
// if the error arrives while the loading skeleton is showing, swap it for the error
setInterval(()=>{try{if(typeof BOOTED==="undefined"||!BOOTED||!chartOnPage()||document.hidden)return;const cv=document.getElementById("cv");if(!cv||!cv.querySelector(".vt-skel"))return;
  const C=S.chart,s=symOf(C.sym);if(s&&ERR[s[0]+"|"+C.tf]&&!candles(s,C.tf))vtChartErr(cv,ERR[s[0]+"|"+C.tf])}catch(e){}},1500);

// 2) Indicators dialog: "My scripts" now lists your saved Vektor Script indicators (Scripts editor)
//    with Add/Remove and Edit, instead of a static list. Icon-only buttons get accessible names.
(function(){if(typeof indM!=="function")return;const base=indM;
  indM=function(tab){base(tab);const box=document.querySelector("#modal .box");if(!box)return;box.classList.add("vt-indm");
    box.querySelectorAll("button").forEach(b=>{if(b.getAttribute("aria-label"))return;const t=b.textContent.trim(),act=b.dataset.act||b.title||"",row=b.closest(".li"),nm=row?(row.querySelector("span")||row).textContent.trim():"";
      if(t==="\u2699"||/setting/i.test(act))b.setAttribute("aria-label","Settings for "+nm);else if(t==="\u2715"||/remove|delete/i.test(act))b.setAttribute("aria-label","Remove "+nm);else if(t==="\u2605"||t==="\u2606"||/fav/i.test(act)){const on=t==="\u2605"||b.classList.contains("on");b.setAttribute("aria-label",(on?"Remove ":"Add ")+nm+(on?" from":" to")+" favourites");b.setAttribute("aria-pressed",on)}});
    if(tab!=="scripts"||typeof vsCfg!=="function")return;const L=document.getElementById("indlist");if(!L)return;L.textContent="";
    const row=(name,note,btns)=>{const r=document.createElement("div");r.className="li vt-indrow";const n=document.createElement("span");n.textContent=name;if(note){const m=document.createElement("small");m.className="mut";m.textContent=" "+note;n.append(m)}const g=document.createElement("span");g.className="vt-indbtns";btns.forEach(x=>g.append(x));r.append(n,g);L.append(r)};
    const btn=(txt,lab,fn,pri)=>{const b=document.createElement("button");b.type="button";b.textContent=txt;if(lab)b.setAttribute("aria-label",lab);if(pri)b.className="pri";b.onclick=fn;return b};
    const list=vsCfg().list;
    list.forEach(sc=>row(sc.name,sc.on?"(on chart)":"",[
      btn(sc.on?"Remove":"Add",(sc.on?"Remove ":"Add ")+sc.name+(sc.on?" from":" to")+" the chart",()=>{if(!sc.on){const a=candles(symOf(S.chart.sym),S.chart.tf),r=a&&a.length?vsCompute(sc,a):null;if(r&&r.err){toast("\u201c"+sc.name+"\u201d has an error. Open it in the editor to fix it.");return}}sc.on=!sc.on;save();vsRedraw();indM("scripts")},!sc.on),
      btn("Edit","Edit "+sc.name+" in the script editor",()=>{closeM();vsM(sc.id)})]));
    if(!list.length){const p=document.createElement("p");p.className="mut";p.textContent="No scripts yet. Write your own indicator, or start from a template, in the script editor.";L.append(p)}
    const add=document.createElement("div");add.className="vt-indnew";add.append(btn("New script\u2026","",()=>{closeM();vsM()}));L.append(add);
    row("Vektor Indicator","(built-in)",[btn("Add","Add Vektor Indicator to the chart",()=>{addVektorIndi();closeM()},true)]);
  }})();

// 3) Router: page names are case-insensitive (#/Chart opens Supercharts).
(function(){if(typeof pageOf!=="function")return;const base=pageOf;pageOf=function(h){return base(typeof h==="string"?h.replace(/^(#\/[A-Za-z]+)/,m=>m.toLowerCase()):h)}})();

// 4) Chart settings that were shown but did nothing now work:
//    Scales > Buttons > Navigation (zoom/scroll/reset buttons on the chart) and Pane (buttons on the RSI pane),
//    Status line > Volume (bar volume next to the price), Data modification > Time colour (the clock under the chart).
function vtNavBtns(){const cv=document.getElementById("cv");if(!cv||typeof ch==="undefined"||!ch)return;const old=cv.querySelector(".vt-navb");if(old)old.remove();
  const mode=S.chart.navBtn||"hover";if(mode==="hide")return;const ts=ch.timeScale();
  const zoom=f=>{const r=ts.getVisibleLogicalRange();if(!r)return;const c=r.to,w=Math.max(10,(r.to-r.from)*f);ts.setVisibleLogicalRange({from:c-w,to:c})};
  const scroll=k=>{const r=ts.getVisibleLogicalRange();if(!r)return;const d=(r.to-r.from)*0.25*k;ts.setVisibleLogicalRange({from:r.from+d,to:r.to+d})};
  const d=document.createElement("div");d.className="vt-navb"+(mode==="always"?" on":"");d.setAttribute("role","toolbar");d.setAttribute("aria-label","Chart navigation");
  [['<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',"Zoom out",()=>zoom(1.25)],
   ['<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',"Zoom in",()=>zoom(0.8)],
   ['<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',"Scroll left",()=>scroll(-1)],
   ['<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',"Scroll right",()=>scroll(1)],
   ['<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',"Reset chart view",()=>{if(typeof resetLive==="function")resetLive();else{ts.resetTimeScale();try{ch.priceScale("right").applyOptions({autoScale:true})}catch(e){}}}]]
    .forEach(([ic,l,f])=>{const b=document.createElement("button");b.type="button";b.innerHTML=ic;b.title=l;b.setAttribute("aria-label",l);b.onclick=e=>{e.stopPropagation();f()};b.onpointerdown=e=>e.stopPropagation();d.append(b)});
  cv.append(d)}
function vtPaneBtns(){const p=document.getElementById("cv2");if(!p)return;const old=p.querySelector(".vt-paneb");if(old)old.remove();const mode=S.chart.paneBtn||"hover";if(mode==="hide")return;
  const r=S.chart.ind.find(x=>x.t==="rsi");if(!r)return;p.style.position=p.style.position||"relative";
  const d=document.createElement("div");d.className="vt-paneb"+(mode==="always"?" on":"");d.setAttribute("role","toolbar");d.setAttribute("aria-label","RSI pane");
  [['<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.79 1.01 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',"RSI settings",()=>editInd(r.id)],
   ['<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.8 21.8 0 0 1 5.06-6.94"/><path d="M1 1l22 22"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a21.8 21.8 0 0 1-2.88 4.46"/></svg>',"Hide RSI pane",()=>togInd(r.id)],
   ['<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',"Remove RSI",()=>{rmInd(r.id);closeM()}]]
    .forEach(([ic,l,f])=>{const b=document.createElement("button");b.type="button";b.innerHTML=ic;b.title=l;b.setAttribute("aria-label",l);b.onclick=f;d.append(b)});p.append(d)}
function vtFmtVol(v){v=+v;if(!isFinite(v))return"\u2013";const a=Math.abs(v);return a>=1e9?(v/1e9).toFixed(2)+"B":a>=1e6?(v/1e6).toFixed(2)+"M":a>=1e3?(v/1e3).toFixed(2)+"K":v.toFixed(a<10?2:0)}
function vtVolPill(s){const top=document.querySelector("#cp .cpb .row.top");if(!top)return;const old=document.getElementById("vt_vol");if(old)old.remove();if(!S.chart.showVol)return;
  const a=candles(s,S.chart.tf);if(!a||!a.length)return;const el=document.createElement("span");el.id="vt_vol";el.className="mut vt-vol";
  const set=i=>{const z=a[Math.max(0,Math.min(a.length-1,i))];el.textContent="Vol "+(z&&z.v!=null?vtFmtVol(z.v):"\u2013")};set(a.length-1);
  const ref=top.querySelector('button[title="Market status"]')||top.querySelector(":scope>div");top.insertBefore(el,ref||null);
  try{ch.subscribeCrosshairMove(p=>{if(!document.body.contains(el))return;if(p&&p.logical!=null&&p.logical>=0)set(Math.round(p.logical));else set(a.length-1)})}catch(e){}}
function vtTimeCol(){const c=S.chart.timeCol,ok=c&&/^#[0-9a-f]{6}$/i.test(c)&&c.toLowerCase()!=="#131722"?c:"";const tb=document.getElementById("timebar");if(tb)tb.style.color=ok;const clk=document.getElementById("vt_cv_clock");if(clk)clk.style.color=ok}
const VT_TZ_LIST_SW=[["ny","UTC-5","New York"],["utc","UTC+0","UTC"],["lon","UTC+0","London"],["par","UTC+1","Paris"],["ber","UTC+1","Berlin"],["tok","UTC+9","Tokyo"],["sha","UTC+8","Shanghai"],["sgp","UTC+8","Singapore"],["hkg","UTC+8","Hong Kong"],["syd","UTC+10","Sydney"],["dub","UTC+4","Dubai"],["mos","UTC+3","Moscow"],["sao","UTC-3","Sao Paulo"],["chi","UTC-6","Chicago"],["den","UTC-7","Denver"],["la","UTC-8","Los Angeles"]];
const VT_TZ_IANA_SW={ny:"America/New_York",utc:"UTC",lon:"Europe/London",par:"Europe/Paris",ber:"Europe/Berlin",tok:"Asia/Tokyo",sha:"Asia/Shanghai",sgp:"Asia/Singapore",hkg:"Asia/Hong_Kong",syd:"Australia/Sydney",dub:"Asia/Dubai",mos:"Europe/Moscow",sao:"America/Sao_Paulo",chi:"America/Chicago",den:"America/Denver",la:"America/Los_Angeles"};
function vtFmtClock(tzKey,fmt){const iana=VT_TZ_IANA_SW[tzKey]||"UTC",now=new Date();try{return now.toLocaleTimeString("en-GB",{hour12:fmt==="12",timeZone:iana,hour:"2-digit",minute:"2-digit",second:"2-digit"})}catch(e){return now.toISOString().slice(11,19)}}
function vtFmtTzBadge(tzKey){const hit=VT_TZ_LIST_SW.find(x=>x[0]===tzKey);return hit?hit[1]:"UTC"}
function vtFmtCd(sec,st){sec=Math.max(0,Math.floor(sec));const d=Math.floor(sec/86400),h=Math.floor((sec%86400)/3600),m=Math.floor((sec%3600)/60),s=sec%60,p=v=>String(v).padStart(2,"0");if(d>0)return d+"d "+p(h)+":"+p(m)+":"+p(s);if(st>=3600||h>0)return p(h)+":"+p(m)+":"+p(s);return p(m)+":"+p(s)}
function vtUpdateClockAndCd(){const cv=document.getElementById("cv");if(!cv||typeof ch==="undefined"||!ch)return;
  const C=S.chart,tzKey=C.tz||"utc",tmEl=document.getElementById("vt_cv_time"),bgEl=document.getElementById("vt_tz_btn");
  if(tmEl)tmEl.textContent=vtFmtClock(tzKey,C.timeFmt);
  if(bgEl)bgEl.textContent=vtFmtTzBadge(tzKey);
  const clk=document.getElementById("vt_cv_clock"),pop=document.getElementById("vt_tz_pop"),cd=document.getElementById("vt_bar_cd");
  let pw=0,th=26;try{pw=ch.timeScale().width();th=ch.timeScale().height()||26}catch(e){}
  const leftScale=C.scalePlace==="left",scaleW=pw?Math.max(46,cv.clientWidth-pw):62;
  if(clk){const rx=leftScale?8:(scaleW+8);clk.style.right=rx+"px";clk.style.bottom=(th+6)+"px"}
  if(pop){const rx=leftScale?8:(scaleW+8);pop.style.right=rx+"px";pop.style.bottom=(th+32)+"px"}
  if(cd){const s=symOf(C.sym),a=s&&candles(s,C.tf),st=(typeof STEP!=="undefined"&&STEP[C.tf])||3600;
    if(!a||!a.length){cd.style.display="none";return}
    const nowSec=Math.floor(Date.now()/1000),lastBar=a[a.length-1],lastT=lastBar&&lastBar.t;
    const rem=(lastT&&(nowSec-lastT<st*2)&&(lastT+st>nowSec))?(lastT+st-nowSec):((st-(nowSec%st))%st||st);
    cd.textContent=vtFmtCd(rem,st);cd.style.display="block";
    let y=null;try{if(typeof MS!=="undefined"&&MS&&lastBar)y=MS.priceToCoordinate(lastBar.c)}catch(e){}
    const maxY=Math.max(24,(cv.clientHeight-th-20)),topY=y!=null&&isFinite(y)?Math.max(12,Math.min(maxY,y+12)):Math.max(12,maxY-6);
    cd.style.top=Math.round(topY)+"px";
    if(leftScale){cd.style.left="2px";cd.style.right="";cd.style.minWidth="52px"}
    else{cd.style.left=(pw||cv.clientWidth-scaleW)+2+"px";cd.style.right="2px";cd.style.minWidth="0"}}}
function vtAttachClockAndCd(){const cv=document.getElementById("cv");if(!cv||typeof ch==="undefined"||!ch)return;
  ["vt_cv_clock","vt_tz_pop","vt_bar_cd"].forEach(id=>{const old=document.getElementById(id);if(old)old.remove()});
  const clk=document.createElement("div");clk.id="vt_cv_clock";clk.className="vt-cv-clock";clk.title="Active session timezone (click to change)";
  clk.innerHTML=`<span id="vt_cv_time"></span><button type="button" class="vt-tz-badge" id="vt_tz_btn" aria-haspopup="listbox" aria-label="Select timezone"></button>`;
  const pop=document.createElement("div");pop.id="vt_tz_pop";pop.className="vt-tz-pop";pop.setAttribute("role","listbox");pop.setAttribute("aria-label","Timezone selector");
  pop.innerHTML=VT_TZ_LIST_SW.map(([k,off,nm])=>`<button type="button" class="vt-tz-item${(S.chart.tz||"utc")===k?" on":""}" data-tz="${k}"><span>${nm}</span><span class="mut">${off}</span></button>`).join("");
  const cd=document.createElement("div");cd.id="vt_bar_cd";cd.className="vt-bar-cd";cd.title="Time until current bar closes";
  clk.onpointerdown=e=>e.stopPropagation();pop.onpointerdown=e=>e.stopPropagation();
  clk.onclick=e=>{e.stopPropagation();pop.classList.toggle("open")};
  pop.querySelectorAll(".vt-tz-item").forEach(b=>b.onclick=e=>{e.stopPropagation();S.chart.tz=b.dataset.tz;save();pop.classList.remove("open");drawChart()});
  cv.append(cd,clk,pop);vtTimeCol();vtUpdateClockAndCd()}
document.addEventListener("click",e=>{const p=document.getElementById("vt_tz_pop");if(p&&p.classList.contains("open")&&!e.target.closest("#vt_cv_clock,#vt_tz_pop"))p.classList.remove("open")});
if(!window.__vtClockIv){window.__vtClockIv=setInterval(()=>{if(!document.hidden&&typeof BOOTED!=="undefined"&&BOOTED&&typeof chartOnPage==="function"&&chartOnPage())vtUpdateClockAndCd()},1000)}
(function(){if(typeof vtAfterDraw!=="function")return;const base=vtAfterDraw;vtAfterDraw=function(s,a,T){base(s,a,T);for(const f of [vtNavBtns,vtPaneBtns,()=>vtVolPill(s),vtAttachClockAndCd,vtTimeCol]){try{f()}catch(e){console.error(e)}}}})();
