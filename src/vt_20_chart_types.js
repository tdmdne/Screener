/* E-10 chart types: Renko and Line Break (bricks/lines built server-side by /api/candles?type=, rendered verbatim)
   and Baseline (a render mode of the server bars). The browser never builds bricks (AGENTS.md §0).
   Live: raw hub bars are not pushed into a brick series; the transformed series is re-fetched at most once a minute
   (the /api/candles cache window), keeping the visible range. */
const VT_XF={data:{},pend:{},timer:0};
const VT_XF_TYPES=new Set(["renko","linebreak","heikin"]);
(function(){
  const icon={renko:'<rect x="4" y="13" width="5" height="5"/><rect x="9" y="8" width="5" height="5"/><rect x="14" y="3" width="5" height="5"/>',
    linebreak:'<rect x="4" y="12" width="4" height="7"/><rect x="10" y="6" width="4" height="10"/><rect x="16" y="9" width="4" height="9"/>',
    baseline:'<path d="M3 12h18" stroke-dasharray="2 2"/><path d="M3 15l4-6 4 3 4-7 6 9"/>'};
  for(const [id,label] of [["baseline","Baseline"],["renko","Renko"],["linebreak","Line Break"]])
    if(!VT_CHART_TYPES.some(t=>t.id===id))VT_CHART_TYPES.push({id,label,ic:icon[id]});
})();
function vtXfKey(sym,tf,type){return sym+"|"+tf+"|"+type}
function vtXfUrl(s,tf,type){
  const crypto=typeof vtIsCryptoSym==="function"&&vtIsCryptoSym(s),td=!crypto&&typeof vtToTdSym==="function"?vtToTdSym(s):"";
  const apiSym=crypto?(s[6]||s[0]):(td||s[6]||s[0]);
  return `/api/candles?symbol=${encodeURIComponent(s[0])}&interval=${encodeURIComponent(tf)}&apiSym=${encodeURIComponent(apiSym)}&mkt=${encodeURIComponent(s[1]||"")}&type=${encodeURIComponent(type)}`}
async function vtXfLoad(s,tf,type){
  const k=vtXfKey(s[0],tf,type);if(VT_XF.pend[k])return;VT_XF.pend[k]=1;
  try{const r=await fetch(vtXfUrl(s,tf,type),{headers:{accept:"application/json"}});const j=r.ok?await r.json():null;
    if(j&&j.ok!==false&&Array.isArray(j.bars)){const prev=VT_XF.data[k];VT_XF.data[k]={bars:j.bars,meta:j.transform||{},at:Date.now()};
      const C=S.chart;if(C.sym===s[0]&&C.tf===tf&&C.type===type){
        const ser=typeof vtChartMeta!=="undefined"&&vtChartMeta&&vtChartMeta.candleSer;
        if(prev&&ser&&typeof ser.setData==="function"){let rg=null;try{rg=ch.timeScale().getVisibleLogicalRange()}catch(_e){}ser.setData(vtXfRows(VT_XF.data[k].bars));if(rg)try{ch.timeScale().setVisibleLogicalRange(rg)}catch(_e){}}
        else drawChart()}}
    else if(typeof toast==="function")toast("Couldn't load "+({renko:"Renko",linebreak:"Line Break",heikin:"Heikin Ashi"}[type]||type)+" data. Try again shortly.");
  }catch(e){console.error("chart transform load:",e)}finally{delete VT_XF.pend[k]}}
function vtXfRows(bars){return bars.map(b=>({time:b.t,open:b.o,high:b.h,low:b.l,close:b.c}))}
// called by drawChart for renko / linebreak: cached rows now, fetch (or refresh after 60 s) in the background
function vtXfSeriesData(s,tf,type){const k=vtXfKey(s[0],tf,type),d=VT_XF.data[k];
  if(!d||Date.now()-d.at>60000)vtXfLoad(s,tf,type);return d?vtXfRows(d.bars):[]}
// Heikin Ashi for bar sets the browser already holds (backtest replay dataset): one POST per dataset, cached
const VT_HA={rows:{},pend:{}};
function vtHaKey(a){return a.length?a.length+"|"+a[0].t+"|"+a[a.length-1].t+"|"+a[a.length-1].c:"0"}
function vtHaFor(a,onReady){const k=vtHaKey(a);if(VT_HA.rows[k])return VT_HA.rows[k];
  if(!VT_HA.pend[k]){VT_HA.pend[k]=1;const bars=a.slice(-5000).map(b=>({t:b.t,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v||0}));
    fetch("/api/chart/transform",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type:"heikin",bars})})
      .then(r=>r.ok?r.json():null).then(j=>{if(j&&j.ok&&Array.isArray(j.bars)){VT_HA.rows[k]=vtXfRows(j.bars);if(typeof onReady==="function")onReady()}else if(typeof toast==="function")toast("Couldn't load Heikin Ashi data. Try again shortly.")})
      .catch(e=>console.error("heikin ashi:",e)).finally(()=>{delete VT_HA.pend[k]})}
  return null}
function vtXfMeta(sym,tf,type){const d=VT_XF.data[vtXfKey(sym,tf,type)];return d?d.meta:null}
(function(){
  // raw live bars must not be written into a brick series
  if(typeof updateLiveBar==="function"){const b=updateLiveBar;updateLiveBar=function(sym,tf){if(VT_XF_TYPES.has(S.chart.type))return;return b.apply(this,arguments)}}
  clearInterval(VT_XF.timer);
  VT_XF.timer=setInterval(()=>{try{const C=S.chart;if(!VT_XF_TYPES.has(C.type)||document.hidden||typeof chartOnPage!=="function"||!chartOnPage())return;
    const s=symOf(C.sym);if(s)vtXfSeriesData(s,C.tf,C.type)}catch(_e){}},15000);
})();
