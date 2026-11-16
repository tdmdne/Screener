// ---------- 98 layout: continuous, virtualised screener list on desktop ----------
// Desktop shows every match in one scrolling list (sticky headers) instead of pages. Only the rows near
// the viewport are in the DOM; spacer rows keep the scroll height right. The list, filters, sort and
// scoring are unchanged: this only decides which slice of the already-sorted rows is drawn.
const VV={rh:36,a:-1,b:-1,n:0,sig:null,raf:0,bound:null};
function vtVirtOn(){const d=document.documentElement.dataset;return d.ui==="pc"&&d.split==="1"&&S.virt!==false}
function vtVirtHead(){const p=document.getElementById("presets"),t=document.querySelector("#t thead");return(p&&p.offsetParent?p.offsetHeight:0)+(t?t.offsetHeight:0)}
function vtVirtRange(w,n){const st=Math.max(0,w.scrollTop-vtVirtHead()),vis=Math.ceil((w.clientHeight||600)/VV.rh)+1,C=20;
const a=Math.min(Math.max(0,Math.floor(st/VV.rh/C)*C-C),Math.max(0,n-1)),b=Math.min(n,a+vis+3*C);return{a,b}}
function vtVirt(n){if(!vtVirtOn())return null;const w=document.querySelector(".side>.tw")||document.querySelector(".tw");if(!w)return null;vtVirtBind(w);
if(VV.sig!==S._sig){VV.sig=S._sig;w.scrollTop=0}
const rs=[...document.querySelectorAll("#t tbody tr[data-s]")];if(rs.length){const h=rs.reduce((t,r)=>t+r.offsetHeight,0)/rs.length;if(h>8)VV.rh=h}
const {a,b}=vtVirtRange(w,n);VV.a=a;VV.b=b;VV.n=n;return{a,b,top:Math.round(a*VV.rh),bot:Math.round((n-b)*VV.rh)}}
function vtVirtBind(w){if(VV.bound===w)return;VV.bound=w;w.addEventListener("scroll",()=>{if(VV.raf)return;VV.raf=requestAnimationFrame(()=>{VV.raf=0;if(!vtVirtOn()||VV.a<0)return;const r=vtVirtRange(w,VV.n);if(r.a!==VV.a||r.b!==VV.b)render()})},{passive:true})}
// keep the keyboard-selected row in view (rows under the sticky header count as hidden)
function vtVirtShow(i){if(!vtVirtOn())return;const w=VV.bound;if(!w)return;const head=vtVirtHead(),th=(document.querySelector("#t thead")||{}).offsetHeight||0,top=head+i*VV.rh;
if(top-th<w.scrollTop)w.scrollTop=Math.max(0,top-th);else if(top+VV.rh>w.scrollTop+w.clientHeight)w.scrollTop=top+VV.rh-w.clientHeight;
const r=vtVirtRange(w,VV.n);if(r.a!==VV.a||r.b!==VV.b)render()}
// switching between phone/tablet and desktop layouts swaps pages <-> continuous list
window.addEventListener("resize",deb(()=>{const on=vtVirtOn();if(on!==VV.was){VV.was=on;if(typeof BOOTED!=="undefined"&&BOOTED)render()}},250));
