/* TradingView-style "Save" in template menus: overwrite an existing template with the current changes in one click,
   alongside "Save as new". Chart templates remember the one last loaded/saved (S.tpl.cur) for a top "Save" action;
   drawing templates (your own) can be overwritten with the selected drawing's style. Guests stay gated (vtGate). */
function tplUpdate(id){if(typeof vtGate==="function"&&vtGate("chart templates"))return null;
  const T=tplS(),t=T.list.find(x=>x.id===id);if(!t)return null;
  const fresh=tplCapture(t.name,!!t.sym);Object.assign(t,{chart:fresh.chart,sc:fresh.sc,dr:fresh.dr,toolDef:fresh.toolDef,posDef:fresh.posDef,sym:t.sym?S.chart.sym:null,updated:Date.now()});
  T.cur=t.id;save();toast("Template “"+t.name+"” updated");return t}
function dpUpdate(t,i,d){if(typeof vtGate==="function"&&vtGate("drawing templates"))return null;
  const L=dpS(t),old=L[i];if(!old||!d)return null;L[i]=Object.assign({n:old.n},dpPick(d));save();toast("Updated “"+old.n+"”");return L[i]}
function vtTplBtn(cls,label,title,fn){const b=document.createElement("button");b.type="button";b.className=cls;b.textContent="Save";b.title=title;b.setAttribute("aria-label",label);b.onclick=e=>{e.stopPropagation();fn()};return b}
(function(){
  // remember the template the user is working from
  if(typeof tplApply==="function"){const b=tplApply;tplApply=function(t){const r=b.apply(this,arguments);try{if(t&&t.id)tplS().cur=t.id}catch(_e){}return r}}
  if(typeof tplSave==="function"){const b=tplSave;tplSave=function(){const t=b.apply(this,arguments);try{if(t)tplS().cur=t.id}catch(_e){}return t}}
  if(typeof tplM==="function"){const b=tplM;tplM=function(){const r=b.apply(this,arguments);try{
    const box=document.querySelector("#modal .tplm:not(.dpm)");if(!box)return r;const T=tplS();
    box.querySelectorAll(".tplr").forEach(li=>{const id=li.dataset.id,t=T.list.find(x=>x.id===id),acts=li.querySelector(".tpla");if(!t||!acts||acts.querySelector(".tpl_up"))return;
      acts.prepend(vtTplBtn("tpl_up","Save current chart into "+t.name,"Overwrite “"+t.name+"” with the current chart",()=>{if(tplUpdate(id))tplM()}))});
    const sb=box.querySelector("#tpl_save");if(sb)sb.textContent="Save as new";
    const cur=T.cur&&T.list.find(x=>x.id===T.cur),h=box.querySelector("#tpl_h");
    if(cur&&h&&!box.querySelector("#tpl_save_cur")){const q=vtTplBtn("pri tpl-savecur","Save changes to "+cur.name,"Overwrite “"+cur.name+"” with the current chart",()=>{if(tplUpdate(cur.id))tplM()});
      q.id="tpl_save_cur";q.textContent="Save “"+cur.name+"”";h.after(q)}}catch(e){console.error(e)}return r}}
  if(typeof dpM==="function"){const b=dpM;dpM=function(){const d=SELD,r=b.apply(this,arguments);try{
    const box=document.querySelector("#modal .dpm");if(!box||!d)return r;const U=dpS(d.t);
    box.querySelectorAll('.dp_dl').forEach(del=>{const i=+del.dataset.i,p=U[i];if(!p||del.parentElement.querySelector(".dp_up"))return;
      const up=vtTplBtn("dp_up","Save this drawing's style into "+p.n,"Overwrite “"+p.n+"” with the selected drawing’s style",()=>{if(dpUpdate(d.t,i,d))dpM()});up.dataset.i=String(i);del.before(up)});
    const sb=box.querySelector("#dp_save");if(sb)sb.textContent="Save as new"}catch(e){console.error(e)}return r}}
})();
