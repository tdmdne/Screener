/* E-05 Multi-chart layouts: the main chart (full tools) plus up to 7 synced panes, each with its own symbol and
   timeframe. Replaces the old single "pane 2" (scPaneB); pane 0 keeps the SC.chB/serB/barsB/keyB/#cvB contract that
   history paging and crosshair sync already use. Live bars for every pane come from the hub (view.chart.panes).
   Presentation only: panes render server bars and server indicator series; no client maths. */
const VT_LAYOUTS=[1,2,3,4,6,8],VT_PANE_TFS=["1m","5m","15m","30m","1H","4H","1D","1W"];
const VT_LAY={panes:[],sig:"",retry:0};
const VT_LAY_ICONS={1:'<rect x="3" y="4" width="18" height="16" rx="1"/>',2:'<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4v16"/>',
  3:'<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4v16M12 12h9"/>',4:'<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4v16M3 12h18"/>',
  6:'<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M9 4v16M15 4v16M3 12h18"/>',8:'<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M7.5 4v16M12 4v16M16.5 4v16M3 12h18"/>'};
function vtLayInit(){const D=S.sc;
  if(!VT_LAYOUTS.includes(D.layout))D.layout=D.panes===2?2:1;
  // S.sc.panes set directly by older code paths wins: 2 = at least two charts, 1 = one chart
  if(D.panes===2&&D.layout===1)D.layout=2;else if(D.panes===1&&D.layout>1)D.layout=1;
  if(!Array.isArray(D.cells))D.cells=[];
  const defs=[D.tfB||"1D","4H","15m","1W","5m","1H","30m"];
  for(let i=0;i<7;i++){const c=D.cells[i];if(!c||typeof c!=="object")D.cells[i]={sym:null,tf:defs[i]};else if(!c.tf)c.tf=defs[i]}
  if(typeof D.syncSym!=="boolean")D.syncSym=true;if(typeof D.syncTf!=="boolean")D.syncTf=false;
  D.panes=D.layout>1?2:1;
  // S.sc.tfB (pane 2 timeframe in older code, templates) stays the source of truth for pane 0
  if(D.tfB)D.cells[0].tf=D.tfB;else D.tfB=D.cells[0].tf}
function vtLayPhone(){return document.documentElement.dataset.ui==="phone"}
function vtLayCount(){vtLayInit();if(S.pageView!=="chart")return 0;return vtLayPhone()?Math.min(1,S.sc.layout-1):S.sc.layout-1}
function vtPaneSym(i){const c=S.sc.cells[i];return S.sc.syncSym||!c.sym?S.chart.sym:c.sym}
function vtPaneTf(i){return S.sc.syncTf?S.chart.tf:S.sc.cells[i].tf}
function vtLayKill(){for(const p of VT_LAY.panes){try{p.ch.remove()}catch(_e){}clearTimeout(p.retry)}VT_LAY.panes=[];clearTimeout(VT_LAY.retry);
  if(typeof scKillB==="function")scKillB()}
function vtLaySig(n){const p=typeof pal==="function"?pal():{};return JSON.stringify([n,S.sc.syncSym,S.sc.syncTf,S.sc.xsync,p.bg,S.chart.type,S.chart.upBody,S.chart.dnBody,
  Array.from({length:n},(_,i)=>vtPaneSym(i)+"|"+vtPaneTf(i)),(S.chart.ind||[]).filter(d=>!d.hidden&&(d.t==="ema"||d.t==="sma")).map(d=>d.id+d.len+d.col)])}
function vtLayChk(label,key,title){const l=document.createElement("label");l.className="chk";l.title=title;const i=document.createElement("input");i.type="checkbox";i.checked=!!S.sc[key];
  i.onchange=()=>{S.sc[key]=i.checked;save();vtLaySyncWs();vtLayRender(true)};l.append(i,document.createTextNode(label));return l}
function vtLaySyncWs(){if(typeof vtSyncWsView==="function")try{vtSyncWsView(true)}catch(_e){}}
function vtLayRender(force){try{
  const host=document.getElementById("sc2");if(!host)return;const n=vtLayCount();
  if(n<=0){vtLayKill();VT_LAY.sig="";host.replaceChildren();return}
  const sig=vtLaySig(n);if(!force&&sig===VT_LAY.sig&&VT_LAY.panes.length===n&&VT_LAY.panes.every(p=>p.ch&&document.body.contains(p.el)))return;
  vtLayKill();VT_LAY.sig=sig;host.replaceChildren();
  const bar=document.createElement("div");bar.className="sc2h lay-bar";
  bar.append(vtLayChk("Symbol","syncSym","Every pane shows the main chart's symbol"),vtLayChk("Interval","syncTf","Every pane uses the main chart's timeframe"),vtLayChk("Crosshair","xsync","Move the crosshair on all panes together"));
  const grid=document.createElement("div");grid.className="lay-grid";grid.dataset.n=String(n);host.append(bar,grid);
  for(let i=0;i<n;i++)vtLayPane(grid,i);
}catch(e){console.error("layout render:",e)}}
function vtLayPane(grid,i){
  const sym=vtPaneSym(i),tf=vtPaneTf(i),cell=document.createElement("div");cell.className="lay-cell";
  const hd=document.createElement("div");hd.className="lay-h";
  const sb=document.createElement("button");sb.type="button";sb.className="lay-sym";sb.textContent=sym;sb.title=S.sc.syncSym?"Symbol synced to the main chart (click to choose another)":"Change symbol";sb.setAttribute("aria-label","Pane "+(i+2)+" symbol "+sym);
  sb.onclick=()=>vtCmdOpen({label:"Pane symbol",placeholder:"Symbol for pane "+(i+2)+"…",onSymbol:s=>{S.sc.cells[i].sym=s;S.sc.syncSym=false;if(typeof vtEnsureSym==="function")vtEnsureSym(s,true);save();vtLaySyncWs();vtLayRender(true)}});
  const ts=document.createElement("select");ts.className="lay-tf";ts.setAttribute("aria-label","Pane "+(i+2)+" timeframe");ts.disabled=!!S.sc.syncTf;
  const tfs=VT_PANE_TFS.includes(tf)?VT_PANE_TFS:VT_PANE_TFS.concat([tf]);for(const t of tfs){const o=document.createElement("option");o.value=t;o.textContent=t;o.selected=t===tf;ts.append(o)}
  ts.onchange=()=>{S.sc.cells[i].tf=ts.value;if(i===0)S.sc.tfB=ts.value;save();vtLaySyncWs();vtLayRender(true)};
  const open=document.createElement("button");open.type="button";open.className="lay-open";open.textContent="⤢";open.title="Open in the main chart";open.setAttribute("aria-label","Open "+sym+" "+tf+" in the main chart");
  open.onclick=()=>openChart(sym,tf);
  hd.append(sb,ts,open);const el=document.createElement("div");el.className="lay-cv";el.id=i===0?"cvB":"cvB"+i;cell.append(hd,el);grid.append(cell);
  const s=(typeof symOf==="function"&&symOf(sym))||(typeof vtEnsureSym==="function"&&vtEnsureSym(sym,true));
  const P={i,sym,tf,el,ch:null,ser:null,B:null,ind:[],retry:0};VT_LAY.panes[i]=P;
  if(!s){const m=document.createElement("p");m.className="mut vt-skel";m.setAttribute("role","status");m.textContent="Loading markets…";el.append(m);return}
  const B=typeof vtBars==="function"?vtBars(s,tf):null;
  if(!B){const m=document.createElement("p");m.className="mut vt-skel";m.setAttribute("role","status");m.textContent="Loading "+tf+" candles…";el.append(m);
    if(isLive()&&typeof READY!=="undefined"&&READY)try{need(s,tf,true)}catch(_e){}
    clearTimeout(VT_LAY.retry);VT_LAY.retry=setTimeout(()=>vtLayRender(true),1500);return}
  if(!window.LightweightCharts)return;
  const c=LightweightCharts.createChart(el,vtChartOpts(tf)),ser=c.addCandlestickSeries(vtCandleOpts(s));ser.setData(B.D);
  if(typeof vtIndMissing==="function"&&vtIndMissing(s[0],tf).length)vtEnsureChartInd(s[0],tf);
  (S.chart.ind||[]).filter(d=>!d.hidden&&(d.t==="ema"||d.t==="sma")).forEach(d=>{try{const l=c.addLineSeries({color:d.col,lineWidth:d.w||2,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});l.setData(vtIndSeriesData(s[0],tf,d,B.a));P.ind.push({d,ser:l})}catch(_e){}});
  const n=B.D.length;try{c.timeScale().setVisibleLogicalRange({from:Math.max(0,n-120),to:n+8})}catch(_e){}
  Object.assign(P,{ch:c,ser,B});
  if(i===0){SC.chB=c;SC.serB=ser;SC.barsB=B;SC.indSeries=P.ind;SC.keyB=s[0]+"|"+tf}
  // same chart affordances as the main chart: alert lines + plus button (per-pane symbol), touch, gap badge
  try{vtPlusAttach(c,ser,el,()=>P.sym);vtAlertAttach(c,ser,el,()=>P.sym);vtTouchChart(c)}catch(_e){}
  if(i===0&&typeof vtRenderGapBadge==="function")try{vtRenderGapBadge()}catch(_e){}
  c.subscribeCrosshairMove(p=>{if(SC.lock||!S.sc.xsync)return;SC.lock=1;try{vtLayCross(p&&p.time!=null?p.time:null,P)}catch(_e){}SC.lock=0});
}
// crosshair sync by time across the main chart and every pane (nearest bar at or before t)
function vtLayCross(t,from){
  const put=(c,ser,times,closeAt)=>{if(!c||!ser)return;if(t==null){c.clearCrosshairPosition();return}const j=barAt(times,t);if(j>=0)c.setCrosshairPosition(closeAt(j),times[j],ser)};
  if(from&&typeof ch!=="undefined"&&ch&&MS&&G&&G.tt&&G.a)put(ch,MS,G.tt,j=>G.a[j].c);
  for(const p of VT_LAY.panes)if(p&&p!==from&&p.B)put(p.ch,p.ser,p.B.D.map(x=>x.time),j=>p.B.D[j].close);
}
function vtSetLayout(n){if(!VT_LAYOUTS.includes(n))return;vtLayInit();S.sc.layout=n;S.sc.panes=n>1?2:1;save();if(typeof scApplyAttr==="function")scApplyAttr();
  document.documentElement.dataset.layout=String(n);if(typeof scDock==="function")scDock();vtLaySyncWs();vtLayRender(true)}
(function(){
  vtLayInit();document.documentElement.dataset.layout=String(S.sc.layout);
  // the old single pane entry points now drive the layout
  scPaneB=function(){vtLayRender(false)};
  scSetPanes=function(n){vtSetLayout(n===2?2:1)};
  // dock header: layout picker instead of the 1/2 pane buttons
  if(typeof scDock==="function"){const b=scDock;scDock=function(){const r=b.apply(this,arguments);try{
    const head=document.querySelector("#dock .dkh");if(!head)return r;
    head.querySelectorAll('button[title="One chart"],button[title^="Two charts"]').forEach(x=>x.remove());
    const g=document.createElement("div");g.className="lay-pick";g.setAttribute("role","group");g.setAttribute("aria-label","Chart layout");
    for(const n of VT_LAYOUTS){const x=document.createElement("button");x.type="button";x.className="ibtn"+(S.sc.layout===n?" on":"");x.title=n===1?"One chart":n+" charts";
      x.setAttribute("aria-label",x.title);x.setAttribute("aria-pressed",String(S.sc.layout===n));
      const t=document.createElement("template");t.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">'+VT_LAY_ICONS[n]+"</svg>";
      x.append(t.content);x.onclick=()=>vtSetLayout(n);g.append(x)}
    head.prepend(g)}catch(e){console.error(e)}return r}}
  // main chart crosshair drives panes 2..N too (pane 0 is driven by the existing handler)
  if(typeof vtAfterDraw==="function"){const b=vtAfterDraw;vtAfterDraw=function(){const r=b.apply(this,arguments);
    try{vtLayRender(false);if(typeof ch!=="undefined"&&ch)ch.subscribeCrosshairMove(p=>{if(SC.lock||!S.sc.xsync)return;SC.lock=1;try{const t=p&&p.time!=null?p.time:null;
      for(const q of VT_LAY.panes)if(q&&q.i>0&&q.B){if(t==null)q.ch.clearCrosshairPosition();else{const tm=q.B.D.map(x=>x.time),j=barAt(tm,t);if(j>=0)q.ch.setCrosshairPosition(q.B.D[j].close,tm[j],q.ser)}}}catch(_e){}SC.lock=0})}catch(e){console.error(e)}return r}}
  // live bars for every pane
  if(typeof vtApplyServerBar==="function"){const b=vtApplyServerBar;vtApplyServerBar=function(sym,tf){const r=b.apply(this,arguments);
    try{for(const p of VT_LAY.panes){if(!p||!p.ser||p.sym!==sym||p.tf!==tf)continue;const a=LIVE[sym+"|"+tf],l=a&&a[a.length-1];if(!l)continue;
      const lt=p.B.D.length?p.B.D[p.B.D.length-1].time:0;if(l.t<lt)continue;const row={time:l.t,open:l.o,high:l.h,low:l.l,close:l.c};p.ser.update(row);
      if(l.t===lt)p.B.D[p.B.D.length-1]=row;else p.B.D.push(row)}}catch(_e){}return r}}
  // tell the hub which panes this layout shows
  if(typeof vtBuildViewFrame==="function"){const b=vtBuildViewFrame;vtBuildViewFrame=function(){const v=b.apply(this,arguments);
    try{const n=vtLayCount();if(n>0&&v&&v.chart)v.chart.panes=Array.from({length:n},(_,i)=>({sym:vtPaneSym(i),tf:vtPaneTf(i)}))}catch(_e){}return v}}
  if(typeof vtHasActiveChartMount==="function"){const b=vtHasActiveChartMount;vtHasActiveChartMount=function(sym,tf){return b.apply(this,arguments)||VT_LAY.panes.some(p=>p&&p.ch&&p.sym===sym&&p.tf===tf)}}
  // palette commands
  if(typeof vtCmdStatic==="function"){const b=vtCmdStatic;vtCmdStatic=function(){const out=b.apply(this,arguments);
    for(const n of VT_LAYOUTS)out.push({g:"Layout",l:n===1?"One chart":n+" charts",k:"layout grid multi chart panes",run:()=>{if(!chartOnPage())go("chart");vtSetLayout(n)}});return out}}
})();
