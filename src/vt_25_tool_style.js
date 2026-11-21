/* Drawings use the active tool style (S.toolDef: last-used colour/width/line style, or the default drawing template)
   from the first click, not only once the drawing is finished. Loaded after every drawing wrapper (vt_18, vt_21) so it
   covers all tools, including three-point ones. Position tools keep their own defaults (posDef). */
const VT_TS=new WeakSet();
function vtApplyToolStyle(d){
  if(!d||VT_TS.has(d))return;VT_TS.add(d);
  if(typeof isPos==="function"&&isPos(d))return;
  const D=S.toolDef&&S.toolDef[d.t];if(!D)return;
  if(D.c)d.c=D.c;if(D.w)d.w=D.w;if(D.s!=null)d.s=D.s;
  for(const k of ["txtCol","txtSize","txtBold","txtItalic"])if(D[k]!=null)d[k]=D[k]}
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
})();
