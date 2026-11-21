/* E-02 Command palette (Ctrl/Cmd+K): one keyboard entry point for symbols, timeframes, chart types,
   drawing tools, pages and settings. Presentation only: every command calls an existing app action.
   No innerHTML with dynamic data (labels come from catalogs and user symbols). */
const VT_CMD={el:null,items:[],sel:0,prevFocus:null,opts:null};
function vtCmdStatic(){
  const C=S.chart,out=[],has=f=>typeof window[f]==="function";
  if(typeof PAGES!=="undefined")for(const p of PAGES)out.push({g:"Go to",l:p[1],k:p[0]+" page",run:()=>go(p[0])});
  for(const t of (S.tfFav||[]).concat(S.tfCustom||[]))out.push({g:"Timeframe",l:t,k:"interval tf "+t,run:()=>{if(!chartOnPage())go("chart");tfPick(t)}});
  if(typeof VT_CHART_TYPES!=="undefined")for(const t of VT_CHART_TYPES)out.push({g:"Chart type",l:t.label,k:"chart type style",run:()=>{if(!chartOnPage())go("chart");vtSetChartType(t.id)}});
  const tools=[["trend","Trend line"],["ray","Ray"],["ext","Extended line"],["hline","Horizontal line"],["hray","Horizontal ray"],["vline","Vertical line"],["arrow","Arrow"],["fib","Fib retracement"],["path","Path"],["curve","Curve"],["rect","Rectangle"],["brush","Brush"],["text","Text"],["note","Note"],["long","Long position"],["short","Short position"],["prange","Price range"],["drange","Date range"],["cross","Crosshair"]];
  for(const [id,l] of tools)out.push({g:"Drawing",l,k:"draw tool "+id,run:()=>{if(!chartOnPage())go("chart");setTool(id)}});
  const scale=(m,l)=>({g:"Price scale",l,k:"scale axis",run:()=>{C.scMode=m;save();drawChart()}});
  out.push(scale(0,"Regular scale"),scale(1,"Logarithmic scale"),scale(2,"Percent scale"),scale(3,"Indexed to 100 scale"));
  if(has("vtCmpOpen"))out.push({g:"Action",l:"Compare symbol…",k:"compare overlay add symbol",run:()=>{if(!chartOnPage())go("chart");setTimeout(vtCmpOpen,0)}});
  if(has("indM"))out.push({g:"Action",l:"Indicators…",k:"add indicator study",run:()=>{if(!chartOnPage())go("chart");indM()}});
  if(has("setM"))out.push({g:"Action",l:"Chart settings…",k:"preferences options",run:()=>{if(!chartOnPage())go("chart");setM()}});
  if(has("togTheme"))out.push({g:"Action",l:"Toggle light/dark theme",k:"theme dark light mode",run:()=>togTheme()});
  if(has("doUndo"))out.push({g:"Action",l:"Undo drawing",k:"undo",run:()=>doUndo()});
  if(has("doRedo"))out.push({g:"Action",l:"Redo drawing",k:"redo",run:()=>doRedo()});
  return out;
}
function vtCmdScore(q,it){const l=it.l.toLowerCase(),k=(it.k||"").toLowerCase(),g=it.g.toLowerCase();
  if(l===q)return 100;if(l.startsWith(q))return 80;if(l.includes(q))return 60;if(k.includes(q)||g.startsWith(q))return 40;
  let i=0;for(const ch of l){if(ch===q[i])i++;if(i===q.length)return 20}return 0}
function vtCmdQuery(raw){
  const q=String(raw||"").trim().toLowerCase(),o=VT_CMD.opts||{};
  if(o.onSymbol){ // symbol picker mode (e.g. Compare): symbols only, Enter hands the symbol to the caller
    const r=typeof vtSearchRank==="function"?(vtSearchRank(q,"All",12)||[]):[];
    return r.map(x=>x.it||x).filter(x=>x&&x.sym&&!(o.exclude||[]).includes(x.sym)).map(x=>({g:"Symbol",l:x.sym,d:x.name&&x.name!==x.sym?x.name:"",run:()=>o.onSymbol(x.sym)}))}
  const stat=vtCmdStatic();
  let syms=[];
  if(typeof vtSearchRank==="function"){const r=vtSearchRank(q,"All",q?8:5)||[];
    syms=r.map(x=>x.it||x).filter(x=>x&&x.sym).map(x=>({g:"Symbol",l:x.sym,d:x.name&&x.name!==x.sym?x.name:"",run:()=>{if(!chartOnPage())go("chart");openChart(x.sym,S.chart.tf)}}))}
  if(!q)return syms.concat(stat.filter(x=>x.g==="Go to"||x.g==="Action"));
  const sc=stat.map(it=>[vtCmdScore(q,it),it]).filter(x=>x[0]>0).sort((a,b)=>b[0]-a[0]).map(x=>x[1]);
  return syms.concat(sc).slice(0,40);
}
function vtCmdRender(){
  const list=VT_CMD.el.querySelector(".vt-cmd-list"),inp=VT_CMD.el.querySelector("input");
  VT_CMD.items=vtCmdQuery(inp.value);if(VT_CMD.sel>=VT_CMD.items.length)VT_CMD.sel=0;
  list.replaceChildren();let last="";
  if(!VT_CMD.items.length){const e=document.createElement("div");e.className="vt-cmd-empty";e.textContent="No matching commands";list.append(e)}
  VT_CMD.items.forEach((it,i)=>{
    if(it.g!==last){last=it.g;const h=document.createElement("div");h.className="vt-cmd-grp";h.setAttribute("role","presentation");h.textContent=it.g;list.append(h)}
    const o=document.createElement("div");o.className="vt-cmd-opt";o.id="vtcmd-"+i;o.setAttribute("role","option");o.setAttribute("aria-selected",String(i===VT_CMD.sel));
    const l=document.createElement("span");l.className="vt-cmd-l";l.textContent=it.l;o.append(l);
    if(it.d){const d=document.createElement("span");d.className="vt-cmd-d";d.textContent=it.d;o.append(d)}
    o.onpointerdown=e=>e.preventDefault();o.onclick=()=>{VT_CMD.sel=i;vtCmdRun()};o.onpointermove=()=>{if(VT_CMD.sel!==i){VT_CMD.sel=i;vtCmdMark()}};
    list.append(o)});
  vtCmdMark();
}
function vtCmdMark(){const list=VT_CMD.el.querySelector(".vt-cmd-list"),inp=VT_CMD.el.querySelector("input");
  list.querySelectorAll(".vt-cmd-opt").forEach(o=>o.setAttribute("aria-selected",String(o.id==="vtcmd-"+VT_CMD.sel)));
  const cur=list.querySelector("#vtcmd-"+VT_CMD.sel);if(cur){inp.setAttribute("aria-activedescendant",cur.id);cur.scrollIntoView({block:"nearest"})}else inp.removeAttribute("aria-activedescendant")}
function vtCmdRun(){const it=VT_CMD.items[VT_CMD.sel];vtCmdClose();if(it)try{it.run()}catch(e){console.error("command palette:",e)}}
function vtCmdOpen(opts){
  if(VT_CMD.el)return;VT_CMD.opts=opts||null;VT_CMD.prevFocus=document.activeElement;if(typeof vtCloseAllMenus==="function")vtCloseAllMenus();
  const bd=document.createElement("div");bd.className="vt-cmd-bd";bd.onpointerdown=e=>{if(e.target===bd)vtCmdClose()};
  const dlg=document.createElement("div");dlg.className="vt-cmd";dlg.setAttribute("role","dialog");dlg.setAttribute("aria-modal","true");dlg.setAttribute("aria-label",(opts&&opts.label)||"Command palette");
  const inp=document.createElement("input");inp.type="text";inp.placeholder=(opts&&opts.placeholder)||"Search symbols, timeframes, tools, pages…";inp.setAttribute("role","combobox");inp.setAttribute("aria-expanded","true");inp.setAttribute("aria-controls","vt-cmd-list");inp.setAttribute("aria-autocomplete","list");inp.setAttribute("aria-label","Command");inp.autocomplete="off";inp.spellcheck=false;
  const list=document.createElement("div");list.className="vt-cmd-list";list.id="vt-cmd-list";list.setAttribute("role","listbox");
  const hint=document.createElement("div");hint.className="vt-cmd-hint";hint.textContent="↑↓ navigate · Enter run · Esc close";
  dlg.append(inp,list,hint);bd.append(dlg);document.body.append(bd);VT_CMD.el=bd;VT_CMD.sel=0;
  inp.addEventListener("input",()=>{VT_CMD.sel=0;vtCmdRender()});
  inp.addEventListener("keydown",e=>{const n=VT_CMD.items.length;
    if(e.key==="ArrowDown"){e.preventDefault();if(n){VT_CMD.sel=(VT_CMD.sel+1)%n;vtCmdMark()}}
    else if(e.key==="ArrowUp"){e.preventDefault();if(n){VT_CMD.sel=(VT_CMD.sel-1+n)%n;vtCmdMark()}}
    else if(e.key==="Enter"){e.preventDefault();vtCmdRun()}
    else if(e.key==="Escape"){e.preventDefault();e.stopPropagation();vtCmdClose()}
    else if(e.key==="Tab"){e.preventDefault()}}); // focus stays in the dialog (single focusable control)
  vtCmdRender();inp.focus();
}
function vtCmdClose(){if(!VT_CMD.el)return;VT_CMD.el.remove();VT_CMD.el=null;VT_CMD.opts=null;const p=VT_CMD.prevFocus;VT_CMD.prevFocus=null;if(p&&document.body.contains(p)&&typeof p.focus==="function")try{p.focus()}catch(_e){}}
// Capture phase so it wins over the chart-only Ctrl+K (symbol search) handler and works on every page, even inside inputs.
document.addEventListener("keydown",e=>{
  if(!(e.ctrlKey||e.metaKey)||e.altKey||e.shiftKey||String(e.key||"").toLowerCase()!=="k")return;
  if(typeof BOOTED!=="undefined"&&!BOOTED)return;
  const ae=document.activeElement;if(ae&&ae.closest&&ae.closest(".vs-ed,textarea"))return; // leave code editors alone
  e.preventDefault();e.stopImmediatePropagation();VT_CMD.el?vtCmdClose():vtCmdOpen();
},true);
