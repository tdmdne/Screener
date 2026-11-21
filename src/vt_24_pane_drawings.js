/* E-05b Drawings mirrored onto layout panes. Drawings are stored per symbol with time/price anchors (S.dr[sym]), so
   each pane redraws its own symbol's drawings with the same renderer as the main chart (shape()), on a read-only
   overlay canvas. While painting a pane, the globals the renderer reads (ch, MS, G) point at that pane's chart, then
   are restored in the same synchronous call. Toggle: "Drawings" in the layout bar (S.sc.syncDr, default on).
   Editing stays on the main chart; panes only display. */
const VT_PD={raf:0,skip:new Set(["fvp"])}; // fixed-range volume profile needs a per-symbol server profile: main chart only
function vtPdCanvas(p){let c=p.el.querySelector("canvas.vt-pdc");if(!c){c=document.createElement("canvas");c.className="vt-pdc";c.setAttribute("aria-hidden","true");
  c.style.cssText="position:absolute;left:0;top:0;width:100%;height:100%;z-index:6;pointer-events:none";p.el.append(c)}return c}
function vtPdPaintPane(p){
  const c=vtPdCanvas(p),W=c.clientWidth,H=c.clientHeight,r=devicePixelRatio||1;if(!W||!H)return;
  // 60fps budget: repaint only when something visible changed (pan/zoom, price scale, size, drawings, an active drag)
  const raw=(S.dr||{})[p.sym]||[];let rg=null,py=null;try{rg=p.ch.timeScale().getVisibleLogicalRange();const a=p.B.a,l=a&&a[a.length-1];py=l?p.ser.priceToCoordinate(l.c):null}catch(_e){}
  const sig=[W,H,r,rg&&rg.from,rg&&rg.to,py,S.sc.syncDr,HIDD,raw.length,DRG?Date.now():0,raw.length?JSON.stringify(raw[raw.length-1].p)+raw.reduce((n,d)=>n+(d.hide?1:0)+(d.p?d.p.length:0),0):"",p.B&&p.B.a&&p.B.a.length].join("|");
  if(p._pdSig===sig)return;p._pdSig=sig;
  if(c.width!==Math.round(W*r)||c.height!==Math.round(H*r)){c.width=Math.round(W*r);c.height=Math.round(H*r)}
  const g=c.getContext("2d");g.setTransform(r,0,0,r,0,0);g.clearRect(0,0,W,H);
  if(S.sc.syncDr===false||HIDD||!p.B||!p.B.a||!p.B.a.length)return;
  const list=raw.filter(d=>d&&!d.hide&&!VT_PD.skip.has(d.t)&&Array.isArray(d.p)&&d.p.length);if(!list.length)return;
  const tw=(p.ch.timeScale().width&&p.ch.timeScale().width())||W-60;
  const sv={ch,MS,G};
  try{ch=p.ch;MS=p.ser;G={a:p.B.a,st:p.B.st||STEP[p.tf]||3600,tt:p.B.a.map(x=>x.t)};
    g.save();g.beginPath();g.rect(0,0,tw,H-26);g.clip();
    for(const d of list){try{shape(g,d,tw,H,false)}catch(_e){}}
    g.restore();
  }finally{ch=sv.ch;MS=sv.MS;G=sv.G}}
function vtPdLoop(){VT_PD.raf=0;const panes=(typeof VT_LAY!=="undefined"?VT_LAY.panes:[]).filter(p=>p&&p.ch&&p.ser&&document.body.contains(p.el));
  if(!panes.length)return;if(!document.hidden)for(const p of panes){try{vtPdPaintPane(p)}catch(e){console.error("pane drawings:",e)}}
  VT_PD.raf=requestAnimationFrame(vtPdLoop)}
function vtPdStart(){if(!VT_PD.raf)VT_PD.raf=requestAnimationFrame(vtPdLoop)}
(function(){
  if(typeof S!=="undefined"&&S.sc&&typeof S.sc.syncDr!=="boolean")S.sc.syncDr=true;
  // (re)start the loop whenever the layout renders panes; add the toggle to the layout bar
  if(typeof vtLayRender==="function"){const b=vtLayRender;vtLayRender=function(){const r=b.apply(this,arguments);try{
    const bar=document.querySelector("#sc2 .lay-bar");if(bar&&!bar.querySelector(".lay-dr")){
      const l=document.createElement("label");l.className="chk lay-dr";l.title="Show each symbol's drawings on the panes";const i=document.createElement("input");i.type="checkbox";i.checked=S.sc.syncDr!==false;
      i.onchange=()=>{S.sc.syncDr=i.checked;save()};l.append(i,document.createTextNode("Drawings"));bar.append(l)}
    vtPdStart()}catch(e){console.error(e)}return r}}
})();
