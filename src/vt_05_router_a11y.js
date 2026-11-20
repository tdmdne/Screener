// ==== VT PAGES BEGIN ====
// ---------- neutral "not investment advice" notes next to scores (checklist 5) ----------
// Text only: no scoring maths is touched (scoreMarket / passesPreset / scoreSymbol are unchanged).
const VT_NA_TXT="Scores, tiers (P1\u2013P5) and phases are rule-based calculations on past price data. They don\u2019t predict prices and aren\u2019t investment advice.";
function vtNaNote(){const tw=document.querySelector(".side>.tw");if(!tw||document.getElementById("vtna"))return;
  const p=document.createElement("p");p.id="vtna";p.className="vtna";p.append(VT_NA_TXT+" ");
  const a=document.createElement("a");a.href="#/legal/risk";a.textContent="Risk disclaimer";p.append(a);tw.after(p)}
const _vtRenderNA=render;render=function(){const r=_vtRenderNA.apply(this,arguments);try{vtNaNote()}catch(e){}return r};
// ---------- accessibility layer (checklist 6) ----------
// Generic, additive fixes applied to whatever the app renders (MutationObserver, batched per frame):
//  * clickable non-native elements (inline onclick on div/span/td/h1) get role + tabindex and work with Enter/Space
//  * icon-only buttons and unlabeled form fields get an accessible name (from title / placeholder / nearby text)
//  * every modal() is a labelled dialog: focus moves in, Tab stays inside, Esc closes, focus returns on close
//  * a skip link, one "main" landmark (the visible page), labelled chart regions, visible focus outlines (CSS)
const VT_NATIVE=/^(BUTTON|A|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY|OPTION|DETAILS)$/;
const VT_A11Y={raf:0,prev:null};
const vtTxt=s=>String(s||"").replace(/\s+/g," ").trim();
function vtNameFromBg(x){const c=x.style&&(x.style.background||x.style.backgroundColor);return c?"Colour "+c:""}
function vtA11yFix(root){root=root&&root.querySelectorAll?root:document;
  root.querySelectorAll("[onclick]").forEach(x=>{if(VT_NATIVE.test(x.tagName)||x.classList.contains("ov")||x.closest("svg")||x.closest("[aria-hidden=true]"))return;
    const oc=x.getAttribute("onclick")||"";if(/^\s*event\.stopPropagation\(\)\s*;?\s*$/.test(oc)||/event\.target===this/.test(oc))return;
    if(!x.hasAttribute("role"))x.setAttribute("role",x.tagName==="H1"?"link":"button");if(!x.hasAttribute("tabindex"))x.tabIndex=0;
    if(!vtTxt(x.textContent)&&!x.hasAttribute("aria-label")){const n=x.title||vtNameFromBg(x);if(n)x.setAttribute("aria-label",n)}
    if(x.tagName==="H1"&&!x.hasAttribute("aria-label"))x.setAttribute("aria-label","Vektor Terminal home")});
  root.querySelectorAll("button,a[href],[role=button]").forEach(b=>{if(b.hasAttribute("aria-label")||b.hasAttribute("aria-labelledby"))return;
    const t=vtTxt(b.textContent);if(/[A-Za-z0-9]/.test(t))return;
    const n=b.title||(b.dataset&&b.dataset.tool&&typeof DT==="object"&&DT[b.dataset.tool])||"";if(n)b.setAttribute("aria-label",n)});
  root.querySelectorAll("input:not([type=hidden]),select,textarea").forEach(f=>{if(f.hasAttribute("aria-label")||f.hasAttribute("aria-labelledby")||f.closest("label"))return;
    if(f.id&&document.querySelector('label[for="'+CSS.escape(f.id)+'"]'))return;
    let n=f.placeholder||f.title||"";
    if(!n){let p=f.previousElementSibling;while(p&&!vtTxt(p.textContent))p=p.previousElementSibling;if(p&&!/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(p.tagName))n=vtTxt(p.textContent).slice(0,60)}
    if(!n){const td=f.closest("td"),tb=td&&td.closest("table");if(tb){const i=[...td.parentElement.children].indexOf(td),th=tb.querySelectorAll("thead th")[i];const rh=td.parentElement.querySelector("th,td:first-child");
      if(th)n=vtTxt(th.textContent)+(rh&&rh!==td&&vtTxt(rh.textContent)&&!rh.querySelector("input")?" \u2013 "+vtTxt(rh.textContent):"")}}
    if(!n&&f.parentElement){const c=f.parentElement.cloneNode(true);c.querySelectorAll("input,select,textarea,option,button").forEach(z=>z.remove());n=vtTxt(c.textContent).slice(0,60)}
    if(n)f.setAttribute("aria-label",n)});
  // tables that scroll sideways must be reachable by keyboard
  root.querySelectorAll(".ftbl").forEach(t=>{if(t.scrollWidth>t.clientWidth+1){if(!t.hasAttribute("tabindex"))t.tabIndex=0}else if(t.getAttribute("tabindex")==="0"&&!t.dataset.keep)t.removeAttribute("tabindex")});
  // sortable headers: expose the sort state on the <th>
  document.querySelectorAll("#t thead th").forEach(th=>{const h=th.querySelector("span.h");if(!h)return;const d=h.dataset.dir||(/\u25b2/.test(h.textContent)?"asc":/\u25bc/.test(h.textContent)?"desc":"");th.setAttribute("aria-sort",d==="asc"?"ascending":d==="desc"?"descending":"none")});
  vtA11yLandmarks()}
function vtA11yLandmarks(){const pg=document.documentElement.dataset.page||"workspace";
  const main=pg==="workspace"||pg==="chart"||pg==="screener"?document.querySelector(".wrap>.ws"):document.getElementById("pv-"+pg)||document.querySelector('.wrap>.pv[data-pv="'+pg+'"]');
  document.querySelectorAll('.wrap>[role="main"]').forEach(e=>{if(e!==main)e.removeAttribute("role")});
  if(main){if(main.getAttribute("role")!=="main")main.setAttribute("role","main");if(!main.id)main.id="vtmain";if(!main.hasAttribute("tabindex"))main.tabIndex=-1}
  const cv=document.getElementById("cv");if(cv&&S&&S.chart){const l="Price chart, "+S.chart.sym+" "+S.chart.tf;if(cv.getAttribute("aria-label")!==l){cv.setAttribute("role","region");cv.setAttribute("aria-label",l)}}
  const cb=document.getElementById("cvB");if(cb&&S&&S.sc){const l="Second chart pane, "+S.chart.sym+" "+S.sc.tfB;if(cb.getAttribute("aria-label")!==l){cb.setAttribute("role","region");cb.setAttribute("aria-label",l)}}}
function vtA11ySoon(){if(VT_A11Y.raf)return;VT_A11Y.raf=setTimeout(()=>{VT_A11Y.raf=0;try{vtA11yFix(document)}catch(e){console.error(e)}},120)}// batched: live price ticks mutate the DOM often
new MutationObserver(vtA11ySoon).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:["data-page"]});
// Enter / Space activate role=button / role=link elements that aren't native controls
document.addEventListener("keydown",e=>{const t=e.target;if(!t||!t.getAttribute||e.defaultPrevented)return;const r=t.getAttribute("role");
  if((r==="button"||r==="link")&&!VT_NATIVE.test(t.tagName)&&(e.key==="Enter"||(e.key===" "&&r==="button"))){e.preventDefault();t.click()}});
// ---- dialogs ----
const VT_FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
function vtFocusables(root){return[...root.querySelectorAll(VT_FOCUSABLE)].filter(x=>x.offsetParent!==null||x===document.activeElement)}
const _vtModalA=modal;modal=function(){const a=document.activeElement;if(a&&!MD.contains(a)&&a!==document.body)VT_A11Y.prev=a;
  const r=_vtModalA.apply(this,arguments);const box=MD.querySelector(".ov>.box");
  if(box){const inner=box.querySelector('[role="dialog"]');if(!inner){box.setAttribute("role","dialog");box.setAttribute("aria-modal","true");
      const h=box.querySelector("h1,h2,h3,h4");if(h){if(!h.id)h.id="vtdlg_h"+Date.now();box.setAttribute("aria-labelledby",h.id)}else box.setAttribute("aria-label","Dialog")}
    if(!box.hasAttribute("tabindex"))box.tabIndex=-1;
    setTimeout(()=>{if(!MD.contains(document.activeElement)){const f=vtFocusables(box);(f.find(x=>/^(INPUT|SELECT|TEXTAREA)$/.test(x.tagName))||f[0]||box).focus()}},0)}
  vtA11yFix(MD);return r};
const _vtCloseMA=closeM;closeM=function(){const had=!!MD.firstChild;const r=_vtCloseMA.apply(this,arguments);const p=VT_A11Y.prev;
  if(had&&p&&p.isConnected&&!MD.contains(p)&&!document.documentElement.classList.contains("locked")){try{p.focus()}catch(e){}}if(had)VT_A11Y.prev=null;return r};
document.addEventListener("keydown",e=>{if(!MD.firstChild||e.defaultPrevented)return;const box=MD.querySelector(".ov>.box");if(!box)return;
  if(e.key==="Escape"){if(e.target.closest&&e.target.closest(".cpop,.vpmenu"))return;e.preventDefault();closeM();return}
  if(e.key==="Tab"){const f=vtFocusables(box);if(!f.length){e.preventDefault();box.focus();return}const a=f[0],z=f[f.length-1],cur=document.activeElement;
    if(!box.contains(cur)){e.preventDefault();a.focus()}else if(e.shiftKey&&(cur===a||cur===box)){e.preventDefault();z.focus()}else if(!e.shiftKey&&cur===z){e.preventDefault();a.focus()}}});
// ---- skip link ----
(function(){const s=document.createElement("a");s.href="#vtmain";s.className="vt-skip";s.textContent="Skip to main content";
  s.addEventListener("click",e=>{e.preventDefault();vtA11yLandmarks();const m=document.querySelector('.wrap>[role="main"]');if(m)m.focus()});
  const w=document.querySelector(".wrap");if(w)w.prepend(s)})();
// the screener table is re-rendered on live ticks: fix it synchronously and keep keyboard focus on the same control
const _vtRenderA=render;render=function(){const a=document.activeElement,t=document.getElementById("t");let key=null;
  if(a&&t&&t.contains(a)){const oc=a.getAttribute("onclick");if(oc)key=oc}
  const r=_vtRenderA.apply(this,arguments);const t2=document.getElementById("t");
  if(t2){vtA11yFix(t2);if(key&&!t2.contains(document.activeElement)){const el=[...t2.querySelectorAll("[onclick]")].find(x=>x.getAttribute("onclick")===key);if(el)el.focus({preventScroll:true})}}
  return r};
// ---------- Motion (calm, sign-in style) ----------
// Page transitions, tick flashes on the screener table / watchlist / chart price, heatmap tile fade-ins (42_heatmap),
// skeleton shimmers on loading placeholders (vt-skel) and dialog/sheet entrances (CSS only).
// Reads the DOM after the normal renders; never touches the feeds or sockets. Nothing moves under reduced motion.
const VT_MO={fl:new Map(),dur:900,last:{},pxv:null,pxt:0};
const vtRM=()=>typeof VT_RM==="function"?VT_RM():!!(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches);
function vtNum(t){if(t==null)return null;t=String(t).replace(/\u2212/g,"-").replace(/,/g,"").trim();const m=t.match(/^[+]?(-?\d+(?:\.\d+)?)\s*([KMBT]?)/i);if(!m)return null;
  return parseFloat(m[1])*({K:1e3,M:1e6,B:1e9,T:1e12}[(m[2]||"").toUpperCase()]||1)}
// snapshot of numeric cells keyed by row symbol + cell index
function vtSnap(rowSel,cellSel){const o={};document.querySelectorAll(rowSel).forEach(r=>{const s=r.dataset.s;if(!s)return;r.querySelectorAll(cellSel).forEach((c,i)=>{o[s+"|"+i]=c.textContent})});return o}
function vtFlashApply(rowSel,cellSel,before,ns){if(vtRM())return 0;const now=performance.now();let n=0;
  document.querySelectorAll(rowSel).forEach(r=>{const s=r.dataset.s;if(!s)return;r.querySelectorAll(cellSel).forEach((c,i)=>{const k=ns+s+"|"+i,t=c.textContent,b=before[s+"|"+i];
    if(b!=null&&b!==t){const x=vtNum(b),y=vtNum(t);if(x!=null&&y!=null&&x!==y){VT_MO.fl.set(k,{t:now,d:y>x?"vt-fu":"vt-fd"});n++}}
    const f=VT_MO.fl.get(k);if(f){const age=now-f.t;if(age>=VT_MO.dur){VT_MO.fl.delete(k);return}
      // the table is rebuilt on every tick, so a running flash is continued with a negative delay instead of restarting
      c.classList.add(f.d);c.style.animationDelay=(-Math.round(age))+"ms"}})});
  if(VT_MO.fl.size>400){for(const [k,f] of VT_MO.fl)if(now-f.t>VT_MO.dur)VT_MO.fl.delete(k)}
  return n}
if(typeof render==="function"){const _vtMoR=render;render=function(){if(typeof S!=="undefined"&&S.mini&&S.mini.on)return _vtMoR.apply(this,arguments);const b=vtSnap("#t tbody tr[data-s]","td");const r=_vtMoR.apply(this,arguments);try{vtFlashApply("#t tbody tr[data-s]","td",b,"t:")}catch(e){}return r}}
if(typeof renderWL==="function"){const _vtMoW=renderWL;renderWL=function(){const b=vtSnap("#wl .wr[data-s]",".wv");const r=_vtMoW.apply(this,arguments);try{vtFlashApply("#wl .wr[data-s]",".wv",b,"w:")}catch(e){}return r}}
// the chart header price is written by the feed handler; watch its text cheaply instead of touching the feed
function vtPxWatch(){const q=document.getElementById("cpx");if(!q){VT_MO.pxv=null;VT_MO.pxel=null;return}const t=q.textContent,key=(typeof S!=="undefined"&&S.chart?S.chart.sym:"")+"|";
  if(VT_MO.pxel!==q||VT_MO.pxk!==key){VT_MO.pxel=q;VT_MO.pxv=t;VT_MO.pxk=key;VT_MO.pxt=0;VT_MO.pxp=0;return}
  if(VT_MO.pxv!=null&&t!==VT_MO.pxv&&!vtRM()){const x=vtNum(VT_MO.pxv),y=vtNum(t);if(x!=null&&y!=null&&x!==y){const now=performance.now(),dir=y>x?"vt-fu":"vt-fd",pct=Math.abs(y-x)/Math.max(Math.abs(x),1e-9);const hold=(now-(VT_MO.pxt||0))<450&&!q.classList.contains(dir)&&(VT_MO.pxp||0)>=0.0099&&(VT_MO.pxp||0)<0.05;if(!hold){q.classList.remove("vt-fu","vt-fd");void q.offsetWidth;q.classList.add(dir);VT_MO.pxt=now;VT_MO.pxp=pct}}}
  VT_MO.pxv=t;VT_MO.pxk=key}
// page transitions
function vtPageEl(p){return p==="workspace"||p==="chart"||p==="screener"?document.querySelector(".wrap>.ws"):document.getElementById("pv-"+p)||document.querySelector('.wrap>.pv[data-pv="'+p+'"]')}
function vtPageAnim(p){const el=vtPageEl(p);if(!el||vtRM())return;const ws=el.classList.contains("ws"),c=ws?"vt-pgfade":"vt-pgin";
  el.classList.remove("vt-pgin","vt-pgfade");void el.offsetWidth;el.classList.add(c);
  const done=()=>{el.classList.remove(c);el.removeEventListener("animationend",done)};el.addEventListener("animationend",done);setTimeout(done,600)}
if(typeof showPage==="function"){const _vtMoP=showPage;showPage=function(p,initial){const prev=document.documentElement.dataset.page;const r=_vtMoP.apply(this,arguments);
  try{const now=document.documentElement.dataset.page;if(!initial&&now&&now!==prev)vtPageAnim(now)}catch(e){}return r}}
// ---------- pages + client-side router ----------
// Every page lives in this one document. Switching pages only toggles what's visible (data-page on <html>),
// so the unified WebSocket (VT_EDGE.ws), LIVE candle caches and state are never torn down.
const PAGES=[
["workspace","Workspace",'<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="12" y="4" width="9" height="16" rx="1"/>'],
["chart","VektorCharts",'<path d="M4 4v16h16"/><path d="M7 15l4-4 3 3 5-6"/>'],
["screener","Screener",'<path d="M3 5h18l-7 8v6l-4-2v-4z"/>'],
["heatmap","Heatmaps",'<rect x="3" y="3" width="10" height="11" rx="1"/><rect x="15" y="3" width="6" height="7" rx="1"/><rect x="15" y="12" width="6" height="9" rx="1"/><rect x="3" y="16" width="10" height="5" rx="1"/>'],
["calendar","Calendar",'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'],
["journal","Journal",'<path d="M6 3h11a2 2 0 012 2v16H8a2 2 0 01-2-2z"/><path d="M10 8h5M10 12h5"/>'],
["calc","Calculators",'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h1M12 12h1M16 12h0M8 16h1M12 16h1M15 15v3"/>'],
["backtest","Backtest",'<path d="M3 12a9 9 0 109-9"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/>']];
const HIDDEN_PAGES={legal:"Legal"}; // routable, but not tabs in the nav
const PAGE_IDS=[...PAGES.map(p=>p[0]),...Object.keys(HIDDEN_PAGES)];
const PAGE_HOOK={}; // page id -> {enter(), leave()}; each page registers its own
function chartOnPage(){const p=S.pageView||"workspace";return p==="workspace"||p==="chart"}
function listOnPage(){const p=S.pageView||"workspace";return p==="workspace"||p==="chart"||p==="screener"}
function pageOf(h){const m=/^#\/([a-z]+)/.exec(h||"");return m&&PAGE_IDS.includes(m[1])?m[1]:null}
function navHTML(){return PAGES.map(([id,n,ic])=>`<a href="#/${id}" data-p="${id}" title="${n}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ic}</svg><span>${n}</span></a>`).join("")}
function showPage(p,initial){
  if(!PAGE_IDS.includes(p))p="workspace";
  const root=document.documentElement,prev=root.dataset.page||"";
  if(prev===p&&!initial){const hs=PAGE_HOOK[p];if(hs&&hs.sub){try{hs.sub()}catch(e){console.error(e)}}return}
  const ph=PAGE_HOOK[prev];if(ph&&ph.leave){try{ph.leave(p)}catch(e){console.error(e)}}
  S.pageView=p;if(!HIDDEN_PAGES[p])lsSet("vt_page",p);save();
  root.dataset.page=p;
  if(!initial&&prev&&prev!==p){try{window.scrollTo(0,0)}catch(e){}} /* vt: new page starts at the top (a long page no longer leaves the next one scrolled off-screen) */
  document.querySelectorAll("#vnav a").forEach(a=>{const on=a.dataset.p===p;a.classList.toggle("on",on);if(on)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")});
  const t=PAGES.find(x=>x[0]===p);document.title=(p==="workspace"?"":(t?t[1]:HIDDEN_PAGES[p])+" \u00b7 ")+"Vektor Terminal";
  const fc=document.getElementById("vtFeatCur");if(fc)fc.textContent=t?t[1]:(HIDDEN_PAGES[p]||"Workspace");
  if(typeof vtCloseAllMenus==="function")vtCloseAllMenus();
  // the chart panel was hidden on the other pages; rebuild it so it sizes to its new space
  const chartWas=prev==="workspace"||prev==="chart";
  if(!initial&&BOOTED&&chartOnPage()&&!chartWas)drawChart();
  const h=PAGE_HOOK[p];if(h&&h.enter){try{h.enter(prev)}catch(e){console.error(e)}}
}
function go(p){if(!PAGE_IDS.includes(p))p="workspace";if(location.hash!=="#/"+p)location.hash="#/"+p;else showPage(p)}
const VT_FEAT_DESC={
  workspace:"Dual-pane screener + chart command desk",
  chart:"Multi-pane charts, drawings & Vektor Script",
  screener:"Multi-asset scanner with P1–P5 tiers",
  heatmap:"Weighted sector rotation & breadth map",
  calendar:"Macro economic releases & live headlines",
  journal:"Trade ledger, equity curve & prop rules",
  calc:"FX, futures & prop challenge calculators",
  backtest:"FX Replay-style bar-by-bar trading cockpit"
};
function vtCloseAllMenus(){
  ["vtFeatMenu","vtWebSetMenu"].forEach(id=>{const m=document.getElementById(id);if(m)m.classList.remove("open")});
  ["vtFeatBtn","vtWebSetBtn"].forEach(id=>{const b=document.getElementById(id);if(b)b.setAttribute("aria-expanded","false")});
}
function vtPosDropdown(btn,menu,rightAlign){
  if(!btn||!menu)return;
  const r=btn.getBoundingClientRect();
  menu.style.top=Math.round(r.bottom+6)+"px";
  if(rightAlign){
    menu.style.right=Math.max(8,Math.round(window.innerWidth-r.right))+"px";
    menu.style.left="auto";
  }else{
    menu.style.left=Math.max(8,Math.min(window.innerWidth-340,Math.round(r.left)))+"px";
    menu.style.right="auto";
  }
}
function vtIsExternalHash(raw){
  const h=String(raw||"").trim().toLowerCase();
  if(!h||h==="#"||h==="#/"||h==="#/home"||h==="#/landing"||h==="#/waitlist"||h==="#/pricing"||h==="#landing"||h==="#waitlist"||h==="#pricing")return true;
  if(/^#\/?(features|products)\/[a-z0-9-]+$/.test(h))return true;
  if(/^#\/?(auth|login|signin|signup|register)(\/|$)/.test(h))return true;
  return false;
}
function vtSyncProfileAvatar(){
  const iniEl=document.getElementById("vtAvatarInit"),btn=document.getElementById("vtProfileBtn");
  const u=(typeof window!=="undefined"&&window.__VT_USER)||null;
  const isG=typeof vtIsGuest==="function"&&vtIsGuest();
  let label="VT",title="Profile & Account";
  if(u&&(u.name||u.email)){
    const src=String(u.name||u.email).trim();
    const parts=src.split(/[\s@._-]+/).filter(Boolean);
    label=(parts.length>=2?parts[0][0]+parts[1][0]:src.slice(0,2)).toUpperCase();
    title="Account: "+src;
  }else if(!isG&&typeof VT_UID==="string"&&VT_UID){
    label=VT_UID.slice(0,2).toUpperCase();
    title="Account: "+VT_UID;
  }else{
    label="G";
    title="Guest session — Sign in";
  }
  if(iniEl)iniEl.textContent=label;
  if(btn){btn.title=title;btn.setAttribute("aria-label",label+" — "+title)}
}
function vtOpenProfileModal(){
  const isG=typeof vtIsGuest==="function"&&vtIsGuest();
  const u=(typeof window!=="undefined"&&window.__VT_USER)||null;
  const uid=(u&&(u.email||u.name))||(isG?"Guest session":(VT_UID||"Signed in"));
  const role=u&&u.role?u.role:(isG?"guest":"member");
  modal(`<div class="vt-prof-modal" role="dialog" aria-modal="true" aria-labelledby="vt_prof_h">
    <h3 id="vt_prof_h">Account &amp; Profile</h3>
    <div class="vt-prof-card">
      <div class="vt-prof-av" aria-hidden="true">${esc((document.getElementById("vtAvatarInit")||{}).textContent||"VT")}</div>
      <div class="vt-prof-meta"><b>${esc(uid)}</b><span class="mut">Role: ${esc(role)} · Free core tier</span></div>
    </div>
    <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px">
      ${isG?`<button type="button" class="pri" onclick="closeM();if(typeof vtOpenAuthModal==='function')vtOpenAuthModal('signin');else location.hash='#/login'">Sign In</button><button type="button" onclick="closeM();if(typeof vtOpenAuthModal==='function')vtOpenAuthModal('signup');else location.hash='#/signup'">Create Account</button>`:`<button type="button" onclick="closeM();location.hash='#/legal/your-data'">Your Data &amp; Privacy</button><button type="button" class="danger" onclick="closeM();authSignOut()">Log Out</button>`}
      <span class="sp"></span>
      <button type="button" onclick="closeM()">Close</button>
    </div>
  </div>`);
}
function vtTogGridlines(){
  const on=!(S.chart.showGridV!==false||S.chart.showGridH!==false);
  S.chart.showGridV=on;S.chart.showGridH=on;save();drawChart();vtTogSetMenu();vtTogSetMenu();
}
function vtTogMagnetPref(){
  S.chart.xhMode=S.chart.xhMode==="magnet"?"normal":"magnet";
  MAG=S.chart.xhMode==="magnet";save();drawChart();tbRef();vtTogSetMenu();vtTogSetMenu();
}
function vtTogDensity(){
  S.density=S.density==="compact"?"comfortable":"compact";
  document.documentElement.dataset.density=S.density;
  save();vtTogSetMenu();vtTogSetMenu();
}
function vtTogAlertSound(){
  S.alertSound=S.alertSound===false?true:false;
  save();toast("Alert sound "+(S.alertSound?"enabled":"muted"));vtTogSetMenu();vtTogSetMenu();
}
function vtTogAlertLines(){
  S.chart.showAlertLines=S.chart.showAlertLines===false?true:false;
  save();drawChart();vtTogSetMenu();vtTogSetMenu();
}
function vtTogAutoSave(){
  S.autoSave=S.autoSave===false?true:false;
  save();toast("Auto-save layout "+(S.autoSave?"enabled":"paused"));vtTogSetMenu();vtTogSetMenu();
}
function vtTogFeatMenu(ev){
  if(ev)ev.stopPropagation();
  const m=document.getElementById("vtFeatMenu"),b=document.getElementById("vtFeatBtn");
  if(!m||!b)return;
  const wasOpen=m.classList.contains("open");
  vtCloseAllMenus();
  if(wasOpen)return;
  const cur=S.pageView||"workspace";
  m.innerHTML=`<div class="vt-dd-sec">TERMINAL WORKSPACES</div><div class="vt-dd-grid">`+PAGES.map(([id,n,ic])=>`<a href="#/${id}" data-p="${id}" role="menuitem" class="vt-dd-item ${cur===id?"on":""}"${cur===id?' aria-current="page"':""} onclick="vtCloseAllMenus()"><span class="vt-dd-ic"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ic}</svg></span><span class="vt-dd-txt"><b>${esc(n)}</b><small>${esc(VT_FEAT_DESC[id]||"")}</small></span></a>`).join("")+`</div><div class="vt-dd-sec">PRODUCT OVERVIEWS</div><div class="vt-dd-overviews"><a href="#/features/supercharts" role="menuitem" class="vt-dd-sub" onclick="vtCloseAllMenus()">VektorCharts</a><a href="#/features/screener" role="menuitem" class="vt-dd-sub" onclick="vtCloseAllMenus()">Screener</a><a href="#/features/replay" role="menuitem" class="vt-dd-sub" onclick="vtCloseAllMenus()">Bar Replay</a><a href="#/features/journal" role="menuitem" class="vt-dd-sub" onclick="vtCloseAllMenus()">Journal</a><a href="#/features/heatmaps" role="menuitem" class="vt-dd-sub" onclick="vtCloseAllMenus()">Heatmaps</a><a href="#/features/script" role="menuitem" class="vt-dd-sub" onclick="vtCloseAllMenus()">Vektor Script</a></div><div class="vt-dd-foot"><a href="#/" role="menuitem" class="vt-dd-sub" onclick="vtCloseAllMenus()">← Home</a><button type="button" role="menuitem" class="vt-dd-sub" onclick="vtCloseAllMenus();syOpen()">Symbol Search (Ctrl+K)</button><a href="#/pricing" role="menuitem" class="vt-dd-sub" onclick="vtCloseAllMenus()">Pricing</a></div>`;
  vtPosDropdown(b,m,false);
  m.classList.add("open");
  b.setAttribute("aria-expanded","true");
}
function vtTogSetMenu(ev){
  if(ev)ev.stopPropagation();
  const m=document.getElementById("vtWebSetMenu"),b=document.getElementById("vtWebSetBtn");
  if(!m||!b)return;
  const wasOpen=m.classList.contains("open");
  vtCloseAllMenus();
  if(wasOpen)return;
  const eff=getEffTheme();
  const isG=typeof vtIsGuest==="function"&&vtIsGuest();
  const isAdm=!!(typeof window!=="undefined"&&window.__VT_USER&&window.__VT_USER.role==="admin");
  const uid=isG?"Guest session":(VT_UID||"Signed in");
  const gridOn=S.chart.showGridV!==false||S.chart.showGridH!==false;
  const magOn=S.chart.xhMode==="magnet"||MAG;
  const dens=S.density==="compact"?"Compact":"Comfortable";
  const sndOn=S.alertSound!==false;
  const alOn=S.chart.showAlertLines!==false;
  const autoOn=S.autoSave!==false;
  m.innerHTML=`<div class="vt-dd-sec">APPEARANCE</div>
  <button type="button" role="menuitem" id="vtSetThemeBtn" class="vt-dd-row" onclick="togTheme();vtTogSetMenu();vtTogSetMenu()"><span>Theme: <b>${eff==="dark"?"Dark":"Light"}</b></span><span class="vt-dd-pill">${eff==="dark"?"Switch to Light":"Switch to Dark"}</span></button>
  <button type="button" role="menuitem" class="vt-dd-row" onclick="vtTogGridlines()"><span>Chart Gridlines</span><span class="vt-dd-pill ${gridOn?"on":""}">${gridOn?"On":"Off"}</span></button>
  <button type="button" role="menuitem" class="vt-dd-row" onclick="vtTogMagnetPref()"><span>Crosshair Magnet</span><span class="vt-dd-pill ${magOn?"on":""}">${magOn?"On":"Off"}</span></button>
  <button type="button" role="menuitem" class="vt-dd-row" onclick="vtTogDensity()"><span>Interface Density</span><span class="vt-dd-pill">${dens}</span></button>
  <div class="vt-dd-sec">TRADING &amp; ALERTS</div>
  <button type="button" role="menuitem" class="vt-dd-row" onclick="vtTogAlertSound()"><span>Sound Notifications</span><span class="vt-dd-pill ${sndOn?"on":""}">${sndOn?"On":"Muted"}</span></button>
  <button type="button" role="menuitem" class="vt-dd-row" onclick="vtTogAlertLines()"><span>Price Alert Lines</span><span class="vt-dd-pill ${alOn?"on":""}">${alOn?"Visible":"Hidden"}</span></button>
  <button type="button" role="menuitem" class="vt-dd-row" onclick="vtTogAutoSave()"><span>Auto-Save Layout</span><span class="vt-dd-pill ${autoOn?"on":""}">${autoOn?"On":"Off"}</span></button>
  <button type="button" role="menuitem" class="vt-dd-row" onclick="vtCloseAllMenus();scrSetM()"><span>Screener Settings &amp; Filters</span><span class="mut">P1–P5</span></button>
  <div class="vt-dd-sec">NAVIGATION &amp; HELP</div>
  <button type="button" role="menuitem" class="vt-dd-row" onclick="vtCloseAllMenus();if(typeof vtKbOpen==='function')vtKbOpen()"><span>Keyboard Shortcuts</span><span class="mut">?</span></button>
  <a href="#/features/supercharts" role="menuitem" class="vt-dd-row" onclick="vtCloseAllMenus()"><span>Knowledge Base &amp; Docs</span><span class="mut">Guides</span></a>
  <a href="#/legal" role="menuitem" class="vt-dd-row" onclick="vtCloseAllMenus()"><span>Legal &amp; Privacy Hub</span><span class="mut">Terms · Risk</span></a>
  ${isAdm?`<button type="button" role="menuitem" class="vt-dd-row" onclick="vtCloseAllMenus();const ab=document.getElementById('vtAdminBtn');if(ab)ab.click()"><span>Admin Panel</span><span class="vt-dd-pill on">Admin</span></button>`:""}
  <div class="vt-dd-sec">ACCOUNT (${esc(uid)})</div>
  <button type="button" role="menuitem" class="vt-dd-row" onclick="vtCloseAllMenus();const pb=document.getElementById('vtProfileBtn');if(pb)pb.click()"><span>Profile Settings</span><span class="mut">Account</span></button>
  ${isG?`<button type="button" role="menuitem" class="vt-dd-row pri" onclick="vtCloseAllMenus();if(typeof vtOpenAuthModal==='function')vtOpenAuthModal('signin');else vtShowSignIn()"><span>Sign In to Account</span></button>
  <button type="button" role="menuitem" class="vt-dd-row" onclick="vtCloseAllMenus();if(typeof vtOpenAuthModal==='function')vtOpenAuthModal('signup');else{location.hash='#/signup';vtShowSignIn()}"><span>Create New Account</span><span class="vt-dd-pill">Free</span></button>`
  :`<button type="button" role="menuitem" class="vt-dd-row danger" onclick="vtCloseAllMenus();authSignOut()"><span>Log Out</span></button>`}`;
  vtPosDropdown(b,m,true);
  m.classList.add("open");
  b.setAttribute("aria-expanded","true");
}
document.addEventListener("click",e=>{if(!e.target.closest||!e.target.closest(".vt-dd-wrap"))vtCloseAllMenus()});
document.addEventListener("keydown",e=>{if(e.key==="Escape")vtCloseAllMenus()});
window.addEventListener("vt:auth-changed",()=>{try{vtSyncProfileAvatar()}catch(_e){}});
let ROUTER=false;
function routerInit(){if(ROUTER)return;ROUTER=true;
  const nav=document.getElementById("vnav");if(nav)nav.innerHTML=navHTML();
  if(S.density)document.documentElement.dataset.density=S.density;
  vtSyncProfileAvatar();
  const saved=lsGet("vt_page")||S.pageView;
  const isExt=vtIsExternalHash(location.hash);
  const p=pageOf(location.hash)||(PAGE_IDS.includes(saved)?saved:"workspace");
  if(!isExt&&pageOf(location.hash)!==p)history.replaceState(null,"","#/"+p);
  showPage(p,true);
  addEventListener("hashchange",()=>{
    if(vtIsExternalHash(location.hash))return;
    const q=pageOf(location.hash);
    if(q)showPage(q);
    else history.replaceState(null,"","#/"+(S.pageView||"workspace"));
    /* boot() skips the edge socket on public/auth routes (#/login, landing); entering a terminal route from one must open it (idempotent, still the single same-origin /ws) */
    try{if(q&&typeof vtWsConnect==="function"&&typeof VT_EDGE!=="undefined"&&!VT_EDGE.ws)vtWsConnect()}catch(e){console.error("ws connect error:",e)}
  });
}
// placeholder for pages that haven't been built yet
function stubPage(id,title,blurb){PAGE_HOOK[id]=PAGE_HOOK[id]||{enter(){const el=document.getElementById("pv-"+id);if(el&&!el.dataset.built){el.dataset.built=1;el.innerHTML=`<div class="pgw"><div class="pgh"><h2>${title}</h2></div><div class="vcard stub">${blurb}</div></div>`}}}}
