// ---------- pages + client-side router ----------
// Every page lives in this one document. Switching pages only toggles what's visible (data-page on <html>),
// so WebSockets (BNWS, BNKL, FHWS), LIVE candle caches and timers are never torn down.
const PAGES=[
["workspace","Workspace",'<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="12" y="4" width="9" height="16" rx="1"/>'],
["chart","Supercharts",'<path d="M4 4v16h16"/><path d="M7 15l4-4 3 3 5-6"/>'],
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
  // the chart panel was hidden on the other pages; rebuild it so it sizes to its new space
  const chartWas=prev==="workspace"||prev==="chart";
  if(!initial&&BOOTED&&chartOnPage()&&!chartWas)drawChart();
  const h=PAGE_HOOK[p];if(h&&h.enter){try{h.enter(prev)}catch(e){console.error(e)}}
}
function go(p){if(!PAGE_IDS.includes(p))p="workspace";if(location.hash!=="#/"+p)location.hash="#/"+p;else showPage(p)}
let ROUTER=false;
function routerInit(){if(ROUTER)return;ROUTER=true;
  const nav=document.getElementById("vnav");if(nav)nav.innerHTML=navHTML();
  const saved=lsGet("vt_page")||S.pageView,p=pageOf(location.hash)||(PAGE_IDS.includes(saved)?saved:"workspace");
  if(pageOf(location.hash)!==p)history.replaceState(null,"","#/"+p);
  showPage(p,true);
  addEventListener("hashchange",()=>{const q=pageOf(location.hash);if(q)showPage(q);else history.replaceState(null,"","#/"+(S.pageView||"workspace"))});
}
// placeholder for pages that haven't been built yet
function stubPage(id,title,blurb){PAGE_HOOK[id]=PAGE_HOOK[id]||{enter(){const el=document.getElementById("pv-"+id);if(el&&!el.dataset.built){el.dataset.built=1;el.innerHTML=`<div class="pgw"><div class="pgh"><h2>${title}</h2></div><div class="vcard stub">${blurb}</div></div>`}}}}
