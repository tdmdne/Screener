/* E-06 Drawing tools: parallel channel, trend-based fib extension, Andrews pitchfork, Schiff pitchfork.
   Three-point tools: place/drag the first two points like a trend line, then a third click sets the offset point.
   Pure screen geometry for rendering and hit-testing (same as the existing drawing tools); no market maths. */
const VT_N3=/^(chan|fibext|pitch|schiff)$/;
const VT_FIBEXT_LV=[0,.618,1,1.272,1.618,2,2.618];
(function(){
  Object.assign(DT,{chan:"Parallel channel",fibext:"Fib extension",pitch:"Pitchfork",schiff:"Schiff pitchfork"});
  Object.assign(IC,{
    chan:'<path d="M3 17L17 5M7 21L21 9"/><circle cx="3" cy="17" r="1.6"/><circle cx="17" cy="5" r="1.6"/>',
    fibext:'<path d="M4 5h16M4 10h16M4 15h16M4 20h16"/><path d="M5 18l5-11 4 6" stroke-dasharray="2 2"/>',
    pitch:'<path d="M3 12L21 12M8 5L21 5M8 19L21 19"/><path d="M3 12L8 5M3 12L8 19"/>',
    schiff:'<path d="M6 12L21 12M9 6L21 6M9 18L21 18"/><path d="M3 15L9 6M6 12L9 18"/>'});
  const g=VT_DRAW_GROUPS.find(x=>x.id==="fib");if(g)for(const t of ["chan","fibext","pitch","schiff"])if(!g.tools.includes(t))g.tools.push(t);
})();
// geometry (screen px)
function vtN3Geo(d,q){const[a,b,c]=q;
  if(d.t==="chan"){const dx=b.x-a.x,dy=b.y-a.y,yOn=x=>a.y+(dx?dy*(x-a.x)/dx:0),off=c?c.y-yOn(c.x):0;
    return{base:[a,b],par:[{x:a.x,y:a.y+off},{x:b.x,y:b.y+off}],mid:[{x:a.x,y:a.y+off/2},{x:b.x,y:b.y+off/2}]}}
  if(d.t==="fibext"){const x1=Math.min(c.x,b.x),x2=Math.max(c.x,b.x)+Math.max(40,Math.abs(b.x-a.x));
    return{x1,x2,lv:VT_FIBEXT_LV.map(l=>({l,y:c.y+(b.y-a.y)*l,p:d.p[2].y+(d.p[1].y-d.p[0].y)*l}))}}
  // pitchforks: median from the pivot through the midpoint of B-C; tines through B and C, all extended forward
  const piv=d.t==="schiff"?{x:(a.x+b.x)/2,y:(a.y+b.y)/2}:a,m={x:(b.x+c.x)/2,y:(b.y+c.y)/2},vx=m.x-piv.x,vy=m.y-piv.y,k=6000/(Math.hypot(vx,vy)||1);
  const fw=p=>({x:p.x+vx*k,y:p.y+vy*k});
  return{piv,m,med:[piv,fw(m)],tb:[b,fw(b)],tc:[c,fw(c)]};
}
(function(){
  const baseHit=hit;hit=function(d,x,y){if(!VT_N3.test(d.t))return baseHit.apply(this,arguments);if(d.lock||d.hide)return 0;
    const q=d.p.map(px);if(q.length<3||q.some(o=>o.x==null||o.y==null))return 0;const n=7,G3=vtN3Geo(d,q);
    if(d.t==="chan"){if(sd(x,y,...G3.base)<n||sd(x,y,...G3.par)<n)return 1;
      const lo=Math.min(G3.base[0].x,G3.base[1].x),hi=Math.max(G3.base[0].x,G3.base[1].x);if(x<lo||x>hi)return 0;
      const t=(x-G3.base[0].x)/((G3.base[1].x-G3.base[0].x)||1),y1=G3.base[0].y+t*(G3.base[1].y-G3.base[0].y),y2=G3.par[0].y+t*(G3.par[1].y-G3.par[0].y);return y>=Math.min(y1,y2)&&y<=Math.max(y1,y2)?1:0}
    if(d.t==="fibext"){if(x<G3.x1-n||x>G3.x2+n)return 0;return G3.lv.some(o=>Math.abs(y-o.y)<n)?1:0}
    return sd(x,y,...G3.med)<n||sd(x,y,...G3.tb)<n||sd(x,y,...G3.tc)<n||sd(x,y,q[1],q[2])<n?1:0};
  const baseShape=shape;shape=function(g,d,W,H,sel){if(!VT_N3.test(d.t))return baseShape.apply(this,arguments);
    const q=d.p.map(px);if(q.some(o=>o.x==null||o.y==null))return;const c=d.c,dash=(LSTYLES[d.s||0]||LSTYLES[0]).d;
    g.lineWidth=d.w;g.strokeStyle=c;g.fillStyle=c;g.font="11px system-ui,sans-serif";g.setLineDash(dash);
    const ln=(p1,p2)=>{g.beginPath();g.moveTo(p1.x,p1.y);g.lineTo(p2.x,p2.y);g.stroke()};
    if(q.length<3||(d===DRAFT&&!d.ph2&&d.t!=="chan")){ln(q[0],q[1]);return} // first segment while drafting
    const G3=vtN3Geo(d,q);
    if(d.t==="chan"){g.globalAlpha=.12;g.beginPath();g.moveTo(G3.base[0].x,G3.base[0].y);g.lineTo(G3.base[1].x,G3.base[1].y);g.lineTo(G3.par[1].x,G3.par[1].y);g.lineTo(G3.par[0].x,G3.par[0].y);g.closePath();g.fill();g.globalAlpha=1;
      ln(...G3.base);ln(...G3.par);g.setLineDash([4,4]);g.lineWidth=1;ln(...G3.mid);return}
    if(d.t==="fibext"){g.save();g.setLineDash([3,3]);g.lineWidth=1;g.globalAlpha=.7;g.beginPath();g.moveTo(q[0].x,q[0].y);g.lineTo(q[1].x,q[1].y);g.lineTo(q[2].x,q[2].y);g.stroke();g.restore();
      for(const o of G3.lv){ln({x:G3.x1,y:o.y},{x:G3.x2,y:o.y});g.fillText(o.l+" ("+fp(o.p)+")",G3.x1+4,o.y-3)}return}
    g.globalAlpha=.08;g.beginPath();g.moveTo(G3.tb[0].x,G3.tb[0].y);g.lineTo(G3.tb[1].x,G3.tb[1].y);g.lineTo(G3.tc[1].x,G3.tc[1].y);g.lineTo(G3.tc[0].x,G3.tc[0].y);g.closePath();g.fill();g.globalAlpha=1;
    ln(...G3.med);ln(...G3.tb);ln(...G3.tc);g.setLineDash([3,3]);g.lineWidth=1;ln(q[1],q[2]);if(d.t==="schiff")ln(q[0],G3.piv)};
  // drafting: point 1 on press, point 2 on release-after-drag or second click, point 3 on the next click
  const baseDown=dDown;dDown=function(e){if(!VT_N3.test(TOOL))return baseDown.apply(this,arguments);
    const[x,y]=xy(e);MX=[x,y];MOD=[e.shiftKey,e.ctrlKey||e.metaKey];try{e.target.setPointerCapture(e.pointerId)}catch(_){}
    if(!DRAFT){const p=snapP(x,y);DRAFT={id:Date.now(),t:TOOL,p:[p,{...p}],c:TOOL==="fibext"?"#787b86":"#2962ff",w:2,s:0,x0:x,y0:y,mv:0};return}
    if(!DRAFT.ph2){DRAFT.p[1]=ptAt(x,y,DRAFT.p[0],DRAFT.t);DRAFT.p[2]={...DRAFT.p[1]};DRAFT.ph2=1;return}
    DRAFT.p[2]=snapP(x,y);delete DRAFT.ph2;dFin()};
  const basePos=dPos;dPos=function(x,y){if(!(DRAFT&&VT_N3.test(DRAFT.t)))return basePos.apply(this,arguments);MX=[x,y];
    if(DRAFT.ph2)DRAFT.p[2]=snapP(x,y);else{DRAFT.p[1]=ptAt(x,y,DRAFT.p[0],DRAFT.t);if(Math.hypot(x-DRAFT.x0,y-DRAFT.y0)>8)DRAFT.mv=1}};
  const baseUp=dUp;dUp=function(){if(!(DRAFT&&VT_N3.test(DRAFT.t)))return baseUp.apply(this,arguments);
    if(!DRAFT.ph2&&DRAFT.mv){DRAFT.p[2]={...DRAFT.p[1]};DRAFT.ph2=1}};
})();
