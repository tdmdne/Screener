/* Drawings use the active tool style (S.toolDef: last-used colour/width/line style, or the default drawing template)
   from the first click, not only once the drawing is finished. Loaded after every drawing wrapper (vt_18, vt_21) so it
   covers all tools, including three-point ones. Position tools keep their own defaults (posDef). */
const VT_TS=new WeakSet();
function vtApplyToolStyle(d){
  if(!d||VT_TS.has(d))return;VT_TS.add(d);
  if(typeof isPos==="function"&&isPos(d))return;
  const D=S.toolDef&&S.toolDef[d.t];if(!D)return;
  if(D.c)d.c=D.c;if(D.w)d.w=D.w;if(D.s!=null)d.s=D.s}
(function(){
  if(typeof dDown!=="function")return;
  const b=dDown;dDown=function(){const r=b.apply(this,arguments);try{if(DRAFT)vtApplyToolStyle(DRAFT)}catch(_e){}return r};
})();
// Left rail: hovering the right-edge arrow strip for ~300 ms opens that group's drawer (click still toggles it)
(function(){
  let t=0;
  document.addEventListener("mouseover",e=>{const f=e.target&&e.target.closest&&e.target.closest(".tbar .vt-rail-fly");if(!f)return;clearTimeout(t);
    t=setTimeout(()=>{const g=f.closest(".vt-rail-grp"),open=document.getElementById("vt_draw_flyout");if(!g||!f.matches(":hover"))return;
      if(open&&open.dataset.gid===g.dataset.gid)return;if(typeof vtOpenDrawFlyout==="function")vtOpenDrawFlyout({currentTarget:f,stopPropagation(){},preventDefault(){}},g.dataset.gid)},300)});
  document.addEventListener("mouseout",e=>{if(e.target&&e.target.closest&&e.target.closest(".tbar .vt-rail-fly"))clearTimeout(t)});
  // touch layouts (tablet / phone) have no arrow strip: a ~450 ms long-press on a group's icon opens its drawer
  let lp=0,lpFired=false;
  document.addEventListener("pointerdown",e=>{const b=e.target&&e.target.closest&&e.target.closest(".tbar .vt-rail-grp > .vt-rail-btn");if(!b||e.pointerType==="mouse")return;
    const g=b.parentElement;if(!g.querySelector(".vt-rail-fly"))return;lpFired=false;clearTimeout(lp);
    lp=setTimeout(()=>{lpFired=true;if(typeof vtOpenDrawFlyout==="function")vtOpenDrawFlyout({currentTarget:b,stopPropagation(){},preventDefault(){}},g.dataset.gid)},450)},true);
  for(const ev of ["pointerup","pointercancel","pointerleave"])document.addEventListener(ev,()=>clearTimeout(lp),true);
  // the click that ends a long-press must not also switch tools
  document.addEventListener("click",e=>{if(lpFired&&e.target&&e.target.closest&&e.target.closest(".tbar .vt-rail-btn")){lpFired=false;e.stopPropagation();e.preventDefault()}},true);
  document.addEventListener("contextmenu",e=>{if(e.target&&e.target.closest&&e.target.closest(".tbar .vt-rail-btn"))e.preventDefault()},true);
  // a click on the strip (open/close) cancels a pending hover-open, so a quick hover-click-click never re-opens it
  document.addEventListener("click",e=>{if(e.target&&e.target.closest&&e.target.closest(".tbar .vt-rail-fly"))clearTimeout(t)},true);
})();
