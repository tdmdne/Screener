/* E-11 Volume Profile. Rows, POC and value area are computed server-side (/api/candles?vp=); the browser only draws.
   - Visible range: S.chart.vpVis; re-requested (debounced) when the visible time range changes; drawn at the right edge.
   - Fixed range: drawing tool "fvp" (two points = time range); drawn inside its range.
   Painted on the drawing canvas after the drawings (wraps paint/shape/hit/dDown/dPos/dUp for "fvp"). */
const VT_VP={cache:{},pend:{},visKey:"",visTimer:0,unsub:null,noVolNote:false};
const VT_VP_ROWS=24,VT_VP_HIT=new WeakMap(); // drawing -> {poc,val,vah} for hit-testing (not saved)
(function(){
  Object.assign(DT,{fvp:"Fixed range volume profile"});
  Object.assign(IC,{fvp:'<path d="M4 4v16"/><path d="M4 6h9M4 9h13M4 12h16M4 15h11M4 18h6"/>'});
  const g=VT_DRAW_GROUPS.find(x=>x.id==="meas");if(g&&!g.tools.includes("fvp"))g.tools.push("fvp");
})();
function vtVpUrl(s,tf,from,to){
  const crypto=typeof vtIsCryptoSym==="function"&&vtIsCryptoSym(s),td=!crypto&&typeof vtToTdSym==="function"?vtToTdSym(s):"";
  const apiSym=crypto?(s[6]||s[0]):(td||s[6]||s[0]);
  return `/api/candles?symbol=${encodeURIComponent(s[0])}&interval=${encodeURIComponent(tf)}&apiSym=${encodeURIComponent(apiSym)}&mkt=${encodeURIComponent(s[1]||"")}&vp=${VT_VP_ROWS}&vpFrom=${Math.floor(from)}&vpTo=${Math.ceil(to)}`}
function vtVpGet(sym,tf,from,to){
  const k=sym+"|"+tf+"|"+Math.floor(from)+"|"+Math.ceil(to),c=VT_VP.cache[k];
  if(c&&Date.now()-c.at<60000)return c.vp;
  if(!VT_VP.pend[k]){const s=symOf(sym);if(s){VT_VP.pend[k]=1;
    fetch(vtVpUrl(s,tf,from,to),{headers:{accept:"application/json"}}).then(r=>r.ok?r.json():null).then(j=>{if(j&&j.ok&&j.vp)VT_VP.cache[k]={at:Date.now(),vp:j.vp}})
      .catch(e=>console.error("volume profile:",e)).finally(()=>{delete VT_VP.pend[k]})}}
  return c?c.vp:null}
// draw rows between x0 and x0 +/- width (dir +1 grows right, -1 grows left from the right edge)
function vtVpDraw(g,vp,x0,width,dir){
  if(!vp||!vp.rows||!vp.rows.length||!vp.total||typeof MS==="undefined"||!MS)return false;
  const max=Math.max(...vp.rows.map(r=>r.v))||1,C=S.chart,up=C.upBody||"#089981",dn=C.dnBody||"#f23645";
  g.save();g.setLineDash([]);
  for(const r of vp.rows){const y1=MS.priceToCoordinate(r.hi),y2=MS.priceToCoordinate(r.lo);if(y1==null||y2==null)continue;
    const h=Math.max(1,Math.abs(y2-y1)-1),y=Math.min(y1,y2),inVa=r.lo>=vp.val-1e-12&&r.hi<=vp.vah+1e-12,wU=width*(r.up/max),wD=width*(r.dn/max);
    g.globalAlpha=inVa?.55:.25;g.fillStyle=up;g.fillRect(dir>0?x0:x0-wU,y,wU,h);g.fillStyle=dn;g.fillRect(dir>0?x0+wU:x0-wU-wD,y,wD,h)}
  const yp=MS.priceToCoordinate(vp.poc);if(yp!=null){g.globalAlpha=.9;g.strokeStyle="#f7a21b";g.lineWidth=1;g.beginPath();g.moveTo(dir>0?x0:x0-width,yp);g.lineTo(dir>0?x0+width:x0,yp);g.stroke()}
  g.restore();return true}
function vtVpVisible(g,tw){
  if(!S.chart.vpVis||typeof ch==="undefined"||!ch)return;
  let r=null;try{r=ch.timeScale().getVisibleRange()}catch(_e){}if(!r)return;
  const vp=vtVpGet(S.chart.sym,S.chart.tf,+r.from,+r.to);
  if(vp&&!vp.total){g.save();g.globalAlpha=.8;g.fillStyle=getComputedStyle(document.documentElement).getPropertyValue("--mut")||"#888";g.font="11px system-ui,sans-serif";g.fillText("Volume profile: no volume data for this market",8,18);g.restore();return}
  vtVpDraw(g,vp,tw-2,Math.min(220,tw*.28),-1)}
(function(){
  // visible-range profile painted every frame with the drawings (cheap: <=200 rows)
  const basePaint=paint;paint=function(){const r=basePaint.apply(this,arguments);try{
    if(!S.chart.vpVis)return r;const cv=document.getElementById("dc");if(!cv||!ch)return r;const g=cv.getContext("2d"),ts=ch.timeScale(),tw=(ts.width&&ts.width())||cv.clientWidth-60;
    g.save();g.beginPath();g.rect(0,0,tw,cv.clientHeight-26);g.clip();vtVpVisible(g,tw);g.restore()}catch(_e){}return r};
  // fixed range tool
  const baseShape=shape;shape=function(g,d,W,H,sel){if(d.t!=="fvp")return baseShape.apply(this,arguments);
    const q=d.p.map(px);if(q.length<2||q.some(o=>o.x==null))return;const x1=Math.min(q[0].x,q[1].x),x2=Math.max(q[0].x,q[1].x);
    g.save();g.strokeStyle=d.c||"#2962ff";g.lineWidth=1;g.setLineDash([3,3]);g.globalAlpha=.6;g.beginPath();g.moveTo(x1,0);g.lineTo(x1,H);g.moveTo(x2,0);g.lineTo(x2,H);g.stroke();g.restore();
    if(d===DRAFT)return;const t1=Math.min(d.p[0].t,d.p[1].t),t2=Math.max(d.p[0].t,d.p[1].t);
    const vp=vtVpGet(S.chart.sym,S.chart.tf,t1,t2);if(vp)VT_VP_HIT.set(d,{poc:vp.poc,val:vp.val,vah:vp.vah});vtVpDraw(g,vp,x1,Math.max(20,(x2-x1)*.7),1)};
  const baseHit=hit;hit=function(d,x,y){if(d.t!=="fvp")return baseHit.apply(this,arguments);if(d.lock||d.hide)return 0;
    const q=d.p.map(px);if(q.length<2||q.some(o=>o.x==null))return 0;const x1=Math.min(q[0].x,q[1].x),x2=Math.max(q[0].x,q[1].x);
    if(Math.abs(x-x1)<7||Math.abs(x-x2)<7)return 1;
    const v=VT_VP_HIT.get(d);if(!v||!MS)return 0;const yh=MS.priceToCoordinate(v.vah),yl=MS.priceToCoordinate(v.val);return x>x1&&x<x2&&yh!=null&&yl!=null&&y>=Math.min(yh,yl)&&y<=Math.max(yh,yl)?1:0};
  const baseDown=dDown;dDown=function(e){if(TOOL!=="fvp")return baseDown.apply(this,arguments);
    const[x,y]=xy(e);MX=[x,y];try{e.target.setPointerCapture(e.pointerId)}catch(_){}const p=snapP(x,y);
    if(!DRAFT){DRAFT={id:Date.now(),t:"fvp",p:[p,{...p}],c:"#2962ff",w:1,s:0,x0:x,y0:y,mv:0};return}
    DRAFT.p[1]=p;dFin()};
  const basePos=dPos;dPos=function(x,y){if(!(DRAFT&&DRAFT.t==="fvp"))return basePos.apply(this,arguments);MX=[x,y];DRAFT.p[1]=snapP(x,y);if(Math.hypot(x-DRAFT.x0,y-DRAFT.y0)>8)DRAFT.mv=1};
  const baseUp=dUp;dUp=function(){if(DRAFT&&DRAFT.t==="fvp"){if(DRAFT.mv)dFin();return}return baseUp.apply(this,arguments)};
  // palette + settings toggle for the visible-range profile
  if(typeof vtCmdStatic==="function"){const b=vtCmdStatic;vtCmdStatic=function(){const out=b.apply(this,arguments);
    out.push({g:"Indicator",l:"Volume profile (visible range)",k:"vpvr volume profile toggle",run:()=>{if(!chartOnPage())go("chart");vtVpToggle()}});
    out.push({g:"Drawing",l:"Fixed range volume profile",k:"draw tool fvp volume profile",run:()=>{if(!chartOnPage())go("chart");setTool("fvp")}});return out}}
})();
function vtVpToggle(on){S.chart.vpVis=on===undefined?!S.chart.vpVis:!!on;save();if(typeof toast==="function")toast("Volume profile (visible range) "+(S.chart.vpVis?"on":"off"))}
