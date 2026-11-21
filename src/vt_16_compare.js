/* E-04 Compare/overlay symbols. Up to 3 extra symbols drawn as line series on the main chart.
   History comes from /api/candles (need()); live bars come from the hub, which streams bar frames for
   view.chart.cmp on the chart timeframe. Render only: series values are the server bars' closes.
   Percent mode uses lightweight-charts' Percentage price scale (render transform, no client maths). */
const VT_CMP_MAX=3,VT_CMP_COLS=["#f7a21b","#ab47bc","#26c6da"];
let vtCmpSer=[],vtCmpRetry=0;
function vtCmpList(){const C=S.chart;if(!Array.isArray(C.cmp))C.cmp=[];C.cmp=C.cmp.filter(x=>x&&typeof x.sym==="string"&&x.sym!==C.sym).slice(0,VT_CMP_MAX);return C.cmp}
function vtCmpOpen(){
  const L=vtCmpList();if(L.length>=VT_CMP_MAX){if(typeof toast==="function")toast("Compare is limited to "+VT_CMP_MAX+" symbols");return}
  vtCmdOpen({label:"Compare symbol",placeholder:"Add a symbol to compare…",exclude:[S.chart.sym,...L.map(x=>x.sym)],onSymbol:vtCmpAdd});
}
function vtCmpAdd(sym){
  const L=vtCmpList();sym=String(sym||"").toUpperCase();if(!sym||sym===S.chart.sym||L.some(x=>x.sym===sym)||L.length>=VT_CMP_MAX)return;
  const used=L.map(x=>x.col),col=VT_CMP_COLS.find(c=>!used.includes(c))||VT_CMP_COLS[0];
  L.push({sym,col});if(!S.chart.cmpMode)S.chart.cmpMode="pct";
  if(typeof vtEnsureSym==="function")vtEnsureSym(sym,true);
  save();vtCmpSync();drawChart();
}
function vtCmpRemove(sym){S.chart.cmp=vtCmpList().filter(x=>x.sym!==sym);save();vtCmpSync();drawChart()}
function vtCmpTogMode(){S.chart.cmpMode=S.chart.cmpMode==="own"?"pct":"own";save();drawChart()}
function vtCmpSync(){if(typeof vtSyncWsView==="function")try{vtSyncWsView(true)}catch(_e){}}
function vtCmpData(sym){const k=sym+"|"+S.chart.tf,a=typeof LIVE!=="undefined"&&LIVE[k];return Array.isArray(a)&&a.length?a:null}
function vtCmpRender(){
  vtCmpSer=[];const cv=document.getElementById("cv");if(!cv)return;const old=cv.querySelector(".vt-cmpl");if(old)old.remove();
  const L=vtCmpList();if(!L.length||typeof ch==="undefined"||!ch)return;
  const pct=S.chart.cmpMode!=="own";let missing=false;
  if(pct)try{ch.priceScale("right").applyOptions({mode:2})}catch(_e){}
  L.forEach((c,i)=>{
    const a=vtCmpData(c.sym);
    if(!a){missing=true;const s=typeof symOf==="function"&&(symOf(c.sym)||(typeof vtEnsureSym==="function"&&vtEnsureSym(c.sym,true)));if(s&&typeof need==="function")try{need(s,S.chart.tf,true)}catch(_e){}return}
    try{const ser=ch.addLineSeries({color:c.col,lineWidth:2,priceScaleId:pct?"right":"cmp"+i,lastValueVisible:true,priceLineVisible:false,title:c.sym,crosshairMarkerVisible:false});
      if(!pct)ser.priceScale().applyOptions({visible:false,scaleMargins:{top:.1,bottom:.08}});
      ser.setData(a.map(b=>({time:b.t,value:b.c})));vtCmpSer.push({sym:c.sym,ser,last:a[a.length-1].t})}catch(e){console.error("compare series:",e)}
  });
  // legend: symbol chips with remove, plus the scale mode toggle
  const lg=document.createElement("div");lg.className="vt-cmpl";lg.setAttribute("role","group");lg.setAttribute("aria-label","Compared symbols");
  for(const c of L){const chip=document.createElement("span");chip.className="vt-cmpc";const sw=document.createElement("i");sw.style.background=c.col;
    const nm=document.createElement("span");nm.textContent=c.sym+(vtCmpData(c.sym)?"":" …");
    const x=document.createElement("button");x.type="button";x.textContent="×";x.title="Remove "+c.sym;x.setAttribute("aria-label","Remove "+c.sym+" from compare");x.onclick=e=>{e.stopPropagation();vtCmpRemove(c.sym)};x.onpointerdown=e=>e.stopPropagation();
    chip.append(sw,nm,x);lg.append(chip)}
  const md=document.createElement("button");md.type="button";md.className="vt-cmpm";md.textContent=pct?"%":"Own scale";md.title=pct?"Compared in percent: switch each symbol to its own scale":"Each symbol on its own scale: switch to percent";
  md.setAttribute("aria-label",(pct?"% percent":"Own scale")+" compare mode");md.onclick=e=>{e.stopPropagation();vtCmpTogMode()};md.onpointerdown=e=>e.stopPropagation();lg.append(md);
  cv.append(lg);
  clearTimeout(vtCmpRetry);if(missing)vtCmpRetry=setTimeout(()=>{if(vtCmpList().some(c=>vtCmpData(c.sym))&&typeof drawChart==="function")drawChart();else vtCmpRender()},800);
}
(function(){
  // live: hub bar frames for compare symbols land in LIVE via vtApplyServerBar; mirror the last bar onto the series
  if(typeof vtApplyServerBar==="function"){const b=vtApplyServerBar;vtApplyServerBar=function(sym,tf,raw){const r=b.apply(this,arguments);
    try{if(S.chart.tf===tf){const it=vtCmpSer.find(x=>x.sym===sym);if(it){const a=vtCmpData(sym),l=a&&a[a.length-1];if(l&&l.t>=it.last){it.ser.update({time:l.t,value:l.c});it.last=l.t}}}}catch(_e){}
    return r}}
  // tell the hub which compare symbols this chart wants
  if(typeof vtBuildViewFrame==="function"){const b=vtBuildViewFrame;vtBuildViewFrame=function(){const v=b.apply(this,arguments);
    try{const L=vtCmpList();if(L.length&&v&&v.chart)v.chart.cmp=L.map(x=>x.sym)}catch(_e){}return v}}
  if(typeof vtAfterDraw==="function"){const b=vtAfterDraw;vtAfterDraw=function(){const r=b.apply(this,arguments);try{vtCmpRender()}catch(e){console.error(e)}return r}}
})();
