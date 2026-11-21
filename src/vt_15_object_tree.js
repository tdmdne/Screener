/* E-03 Object tree: a dock section listing the chart's indicators and the current symbol's drawings,
   with select, rename, hide, lock and delete. Presentation only; state stays in S.chart.ind / S.dr.
   Every label is set with textContent (drawing names and texts are user data). Icons are static VT_IC SVG. */
function vtOtIcon(k){const t=document.createElement("template");t.innerHTML=VT_IC[k]||"";return t.content}
function vtOtBtn(icon,label,on,fn){const b=document.createElement("button");b.type="button";b.className="ot-b"+(on?" on":"");b.title=label;b.setAttribute("aria-label",label);
  if(on!=null)b.setAttribute("aria-pressed",String(!!on));b.append(vtOtIcon(icon));b.onclick=e=>{e.stopPropagation();fn()};return b}
function vtOtName(d){return d.name||(typeof DT!=="undefined"&&DT[d.t])||d.t}
function vtOtRename(row,d){
  const lab=row.querySelector(".ot-l");if(!lab)return;const inp=document.createElement("input");inp.className="ot-in";inp.value=vtOtName(d);inp.maxLength=60;inp.setAttribute("aria-label","Drawing name");
  let done=false;const fin=ok=>{if(done)return;done=true;if(ok){const v=inp.value.trim();if(v&&v!==(DT[d.t]||d.t))d.name=v;else delete d.name;save()}vtObjTree(true)};
  inp.onkeydown=e=>{e.stopPropagation();if(e.key==="Enter")fin(true);else if(e.key==="Escape")fin(false)};inp.onblur=()=>fin(true);
  lab.replaceWith(inp);inp.focus();inp.select()}
function vtOtSig(inds,drs){return JSON.stringify([S.chart&&S.chart.sym,inds.map(d=>[d.id,d.t,d.len,d.col,!!d.hidden]),drs.map(d=>[d.id,d.t,d.name||"",d.txt||"",!!d.hide,!!d.lock])])}
function vtOtMarkSel(box){const drs=box._drs||[];box.querySelectorAll('.ot-r[data-kind="dr"]').forEach(r=>r.classList.toggle("sel",drs[+r.dataset.i]===SELD))}
function vtObjTree(force){
  const box=document.getElementById("dkot");if(!box)return;
  const inds=(S.chart&&S.chart.ind)||[],drs=typeof DL==="function"?DL():[],sig=vtOtSig(inds,drs);
  if(!force&&box._sig===sig&&box._drs===drs){vtOtMarkSel(box);return}
  box._sig=sig;box._drs=drs;box.replaceChildren();
  const head=t=>{const h=document.createElement("div");h.className="ot-h";h.textContent=t;box.append(h)};
  if(!inds.length&&!drs.length){const e=document.createElement("div");e.className="dkx mut";e.textContent="No indicators or drawings on this chart.";box.append(e);return}
  if(inds.length){head("Indicators");
    for(const d of inds){const r=document.createElement("div");r.className="ot-r"+(d.hidden?" off":"");r.dataset.kind="ind";
      const l=document.createElement("span");l.className="ot-l";l.textContent=((typeof IND!=="undefined"&&IND[d.t])||d.t)+(d.len?" "+d.len:"");
      if(d.col){const sw=document.createElement("i");sw.className="ot-sw";sw.style.background=/^#[0-9a-f]{3,8}$/i.test(d.col)?d.col:"";r.append(sw)}
      r.append(l,vtOtBtn(d.hidden?"eyeOff":"eyeOn",(d.hidden?"Show ":"Hide ")+l.textContent,null,()=>togInd(d.id)),vtOtBtn("trash","Remove "+l.textContent,null,()=>{S.chart.ind=S.chart.ind.filter(x=>x.id!==d.id);save();drawChart()}));
      box.append(r)}}
  if(drs.length){head("Drawings");
    drs.slice().reverse().forEach(d=>{const r=document.createElement("div");r.className="ot-r"+(d.hide?" off":"")+(d===SELD?" sel":"");r.dataset.kind="dr";r.dataset.i=String(drs.indexOf(d));r.tabIndex=0;r.setAttribute("role","button");
      const nm=vtOtName(d),l=document.createElement("span");l.className="ot-l";l.textContent=nm;
      if(d.txt&&!d.name){const s=document.createElement("span");s.className="ot-d";s.textContent=String(d.txt).slice(0,40);l.append(" ",s)}
      const sel=()=>{if(d.hide||d.lock)return;SELD=d;if(typeof dpe==="function")dpe();if(typeof dsel==="function")dsel();vtOtMarkSel(box)};
      r.onclick=sel;r.onkeydown=e=>{if(e.target!==r)return;if(e.key==="Enter"||e.key===" "){e.preventDefault();sel()}else if(e.key==="F2"){e.preventDefault();vtOtRename(r,d)}};
      r.ondblclick=e=>{e.preventDefault();vtOtRename(r,d)};
      r.append(l,
        vtOtBtn(d.hide?"eyeOff":"eyeOn",(d.hide?"Show ":"Hide ")+nm,null,()=>{d.hide=!d.hide;if(d.hide&&SELD===d)SELD=null;save();if(typeof dsel==="function")dsel();vtObjTree()}),
        vtOtBtn(d.lock?"lock":"unlock",(d.lock?"Unlock ":"Lock ")+nm,!!d.lock,()=>{d.lock=!d.lock;if(d.lock&&SELD===d)SELD=null;save();if(typeof dsel==="function")dsel();vtObjTree()}),
        vtOtBtn("trash","Delete "+nm,null,()=>{pushUndo();const L=DL(),i=L.indexOf(d);if(i>=0)L.splice(i,1);if(SELD===d)SELD=null;save();if(typeof tbRef==="function")tbRef();if(typeof dsel==="function")dsel();vtObjTree()}));
      box.append(r)})}
}
let VT_OT_RAF=0;function vtObjTreeSoon(){if(VT_OT_RAF)return;VT_OT_RAF=requestAnimationFrame(()=>{VT_OT_RAF=0;const a=document.activeElement;if(a&&a.classList&&a.classList.contains("ot-in"))return;vtObjTree()})}
(function(){
  // re-render whenever chart state is saved (drawings added/moved/deleted, indicators changed) and after each chart draw
  if(typeof save==="function"){const b=save;save=function(){const r=b.apply(this,arguments);vtObjTreeSoon();return r}}
  if(typeof scDock==="function"){const b=scDock;scDock=function(){const r=b.apply(this,arguments);vtObjTree();return r}}
  if(typeof vtAfterDraw==="function"){const b=vtAfterDraw;vtAfterDraw=function(){const r=b.apply(this,arguments);vtObjTreeSoon();return r}}
})();
(function(){if(typeof dsel==="function"){const b=dsel;dsel=function(){const r=b.apply(this,arguments);vtObjTreeSoon();return r}}})();
