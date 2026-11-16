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
    box.querySelectorAll("button").forEach(b=>{if(b.getAttribute("aria-label"))return;const t=b.textContent.trim(),row=b.closest(".li"),nm=row?(row.querySelector("span")||row).textContent.trim():"";
      if(t==="\u2699")b.setAttribute("aria-label","Settings for "+nm);else if(t==="\u2715")b.setAttribute("aria-label","Remove "+nm);else if(t==="\u2605"||t==="\u2606"){b.setAttribute("aria-label",(t==="\u2605"?"Remove ":"Add ")+nm+(t==="\u2605"?" from":" to")+" favourites");b.setAttribute("aria-pressed",t==="\u2605")}});
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
  [["\u2212","Zoom out",()=>zoom(1.25)],["+","Zoom in",()=>zoom(0.8)],["\u2039","Scroll left",()=>scroll(-1)],["\u203a","Scroll right",()=>scroll(1)],["\u21ba","Reset chart view",()=>{ts.resetTimeScale();try{ch.priceScale("right").applyOptions({autoScale:true})}catch(e){}}]]
    .forEach(([t,l,f])=>{const b=document.createElement("button");b.type="button";b.textContent=t;b.title=l;b.setAttribute("aria-label",l);b.onclick=e=>{e.stopPropagation();f()};b.onpointerdown=e=>e.stopPropagation();d.append(b)});
  cv.append(d)}
function vtPaneBtns(){const p=document.getElementById("cv2");if(!p)return;const old=p.querySelector(".vt-paneb");if(old)old.remove();const mode=S.chart.paneBtn||"hover";if(mode==="hide")return;
  const r=S.chart.ind.find(x=>x.t==="rsi");if(!r)return;p.style.position=p.style.position||"relative";
  const d=document.createElement("div");d.className="vt-paneb"+(mode==="always"?" on":"");d.setAttribute("role","toolbar");d.setAttribute("aria-label","RSI pane");
  [["\u2699","RSI settings",()=>editInd(r.id)],["\u25cc","Hide RSI pane",()=>togInd(r.id)],["\u2715","Remove RSI",()=>{rmInd(r.id);closeM()}]]
    .forEach(([t,l,f])=>{const b=document.createElement("button");b.type="button";b.textContent=t;b.title=l;b.setAttribute("aria-label",l);b.onclick=f;d.append(b)});p.append(d)}
function vtFmtVol(v){v=+v;if(!isFinite(v))return"\u2013";const a=Math.abs(v);return a>=1e9?(v/1e9).toFixed(2)+"B":a>=1e6?(v/1e6).toFixed(2)+"M":a>=1e3?(v/1e3).toFixed(2)+"K":v.toFixed(a<10?2:0)}
function vtVolPill(s){const top=document.querySelector("#cp .cpb .row.top");if(!top)return;const old=document.getElementById("vt_vol");if(old)old.remove();if(!S.chart.showVol)return;
  const a=candles(s,S.chart.tf);if(!a||!a.length)return;const el=document.createElement("span");el.id="vt_vol";el.className="mut vt-vol";
  const set=i=>{const z=a[Math.max(0,Math.min(a.length-1,i))];el.textContent="Vol "+(z&&z.v!=null?vtFmtVol(z.v):"\u2013")};set(a.length-1);
  const ref=top.querySelector('button[title="Market status"]')||top.querySelector(":scope>div");top.insertBefore(el,ref||null);
  try{ch.subscribeCrosshairMove(p=>{if(!document.body.contains(el))return;if(p&&p.logical!=null&&p.logical>=0)set(Math.round(p.logical));else set(a.length-1)})}catch(e){}}
function vtTimeCol(){const tb=document.getElementById("timebar");if(!tb)return;const c=S.chart.timeCol;tb.style.color=c&&/^#[0-9a-f]{6}$/i.test(c)&&c.toLowerCase()!=="#131722"?c:""}
(function(){if(typeof vtAfterDraw!=="function")return;const base=vtAfterDraw;vtAfterDraw=function(s,a,T){base(s,a,T);for(const f of [vtNavBtns,vtPaneBtns,()=>vtVolPill(s),vtTimeCol]){try{f()}catch(e){console.error(e)}}}})();
