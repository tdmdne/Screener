// ---------- price alerts ----------
function alertsM(prefill){
  const sym=S.chart.sym||"";
  const price=prefill&&prefill.price?prefill.price:"";
  const dir=prefill&&prefill.dir?prefill.dir:"above";
  const list=(S.alerts||[]).map((a,i)=>`<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--line)"><span>${esc(a.sym)} ${vtAlCond(a.dir).toLowerCase()} ${a.price}${a.msg?` <span class="mut">\u201c${esc(a.msg)}\u201d</span>`:""}${a.fired?` <span class="pill b" style="min-width:0">triggered</span>`:""}</span><span class="sp"></span>${a.fired?`<button onclick="rearmAlert(${i})" title="Arm this alert again">Re-arm</button>`:""}<button onclick="vtAlertEdit(${a.id})" title="Edit price, condition or message">Edit</button><button onclick="rmAlert(${i})" aria-label="Delete alert" title="Delete">${VT_IC.x}</button></div>`).join("")||`<p class="mut">No alerts yet.</p>`;
  modal(`<h3>Price Alerts</h3>
  <label>Symbol<input id="al_sym" value="${esc(sym)}"></label>
  <label>Price<input id="al_px" type="number" step="any" value="${price}"></label>
  <label>Condition<select id="al_dir"><option value="above" ${dir==="above"?"selected":""}>Crossing up</option><option value="below" ${dir==="below"?"selected":""}>Crossing down</option><option value="cross" ${dir==="cross"?"selected":""}>Crossing</option></select></label>
  <div class="row"><span class="sp"></span><button onclick="closeM()">Cancel</button><button class="pri" onclick="addAlert()">Add alert</button></div>
  <div style="margin-top:12px;max-height:200px;overflow:auto">${list}</div>`);
}
function addAlert(){
  const sym=document.getElementById("al_sym").value.trim().toUpperCase();
  const price=+document.getElementById("al_px").value;
  const dir=document.getElementById("al_dir").value;
  if(!sym||!price){toast("Need symbol and price");return}
  S.alerts=S.alerts||[];
  S.alerts.push({id:Date.now(),sym,price,dir,on:true,fired:false});
  save();closeM();toast("Alert added");
  if(typeof Notification!=="undefined"&&Notification.permission==="default")Notification.requestPermission();
}
function rmAlert(i){S.alerts.splice(i,1);save();alertsM()}
function rearmAlert(i){const a=S.alerts[i];if(a){a.fired=false;a.on=true;delete lastPx[a.sym];save()}alertsM()}
function alertFromHline(price){alertsM({price,dir:"above"})}
let lastPx={};
function checkAlerts(sym,price){
  if(!S.alerts||!S.alerts.length||!price)return;
  const prev=lastPx[sym];
  lastPx[sym]=price;
  if(prev==null)return;
  S.alerts.forEach(a=>{
    if(!a.on||a.fired||a.sym!==sym)return;
    const up=prev<a.price&&price>=a.price,dn=prev>a.price&&price<=a.price;
    const cross=a.dir==="above"?up:a.dir==="below"?dn:(up||dn);
    if(cross){a.fired=true;save();fireAlert(a,price)}
  });
}
function fireAlert(a,price){
  const msg=a.msg?String(a.msg):a.sym+" crossed "+(a.dir==="cross"?"":a.dir+" ")+a.price+" ("+price+")";
  toast(msg);
  try{if(typeof Notification!=="undefined"&&Notification.permission==="granted")new Notification("Vektor Alert",{body:msg})}catch(e){}
  // sound cue: off by default, turned on in the Price Alerts dialog (45_sound.js)
  try{if(typeof vtAlertSound==="function")vtAlertSound()}catch(e){}
}
// ---------- drawing tools (left toolbar like TradingView; drawings are saved per symbol) ----------
let MS=null,TOOL="cross",MAG=false,LOCKD=false,HIDD=false,SELD=null,DRAFT=null,DRG=null,G=null,MX=null,MOD=[false,false]; // MOD = [shift held, ctrl/cmd held]
const ms=x=>(MS=x),N2=/^(trend|ray|ext|rect|fib|long|short|arrow|prange|drange)$/;
const DT={cross:"Cursor",trend:"Trend line",ray:"Ray",ext:"Extended line",hline:"Horizontal line",hray:"Horizontal ray",vline:"Vertical line",rect:"Rectangle",fib:"Fib retracement",long:"Long position",short:"Short position",text:"Text",note:"Note",arrow:"Arrow",path:"Path",curve:"Curve",brush:"Brush",prange:"Price Range",drange:"Date Range"};
const LSTYLES=[{n:"Solid",d:[]},{n:"Dashed",d:[6,4]},{n:"Dotted",d:[2,3]},{n:"Dash-dot",d:[8,4,2,4]},{n:"Sparse dotted",d:[1,4]}];
const IC={cross:'<path d="M12 4v16M4 12h16"/>',trend:'<path d="M5 19L19 5"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/>',ray:'<path d="M5 19L21 3"/><circle cx="5" cy="19" r="2"/>',ext:'<path d="M3 21L21 3"/><circle cx="9" cy="15" r="2"/><circle cx="15" cy="9" r="2"/>',hline:'<path d="M3 12h18"/><circle cx="12" cy="12" r="2"/>',hray:'<path d="M5 12h16"/><circle cx="5" cy="12" r="2"/>',vline:'<path d="M12 3v18"/><circle cx="12" cy="12" r="2"/>',rect:'<rect x="4" y="6" width="16" height="12" rx="1"/>',fib:'<path d="M4 5h16M4 10h16M4 15h16M4 20h16"/>',long:'<rect x="5" y="4" width="14" height="8" fill="currentColor" fill-opacity=".3"/><rect x="5" y="12" width="14" height="8"/>',short:'<rect x="5" y="4" width="14" height="8"/><rect x="5" y="12" width="14" height="8" fill="currentColor" fill-opacity=".3"/>',text:'<path d="M6 6h12M12 6v13"/>',note:'<path d="M4 6h16v10H8l-4 4V6z"/>',arrow:'<path d="M5 19L19 5M19 5h-6M19 5v6"/>',path:'<path d="M4 18l5-6 4 3 7-9"/>',curve:'<path d="M4 16c4-8 12-8 16 0"/>',brush:'<path d="M4 20c2-4 4-8 6-10s4-2 6 0 2 6 4 10"/><path d="M14 6l4-4"/>',prange:'<path d="M4 8h16M4 16h16M12 8v8"/>',drange:'<path d="M8 4v16M16 4v16M8 12h8"/>',magnet:'<path d="M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z"/>',lock:'<rect x="6" y="11" width="12" height="9" rx="1"/><path d="M9 11V8a3 3 0 016 0v3"/>',eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',trash:'<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>'};
const VT_DRAW_GROUPS=[
  {id:"cursor",name:"Cursors",tools:["cross"]},
  {id:"lines",name:"Trend Lines & Rays",tools:["trend","ray","ext","hline","hray","vline","arrow"]},
  {id:"fib",name:"Fib & Channels",tools:["fib","path","curve"]},
  {id:"shapes",name:"Shapes & Brush",tools:["rect","brush"]},
  {id:"text",name:"Text & Annotations",tools:["text","note"]},
  {id:"pos",name:"Long / Short Position",tools:["long","short"]},
  {id:"meas",name:"Measure & Range",tools:["prange","drange"]}
];
const VT_TOOL_SHORT={cross:"Esc",trend:"Alt+T",hline:"Alt+H",vline:"Alt+V",fib:"Alt+F",rect:"Alt+R",long:"Alt+L",short:"Alt+S",text:"Alt+X"};
S.favTools=Array.isArray(S.favTools)&&S.favTools.length?S.favTools:["trend","hline","fib","rect","long","short"];
if(typeof S.favBarOn!=="boolean")S.favBarOn=true;
S.groupTool=S.groupTool||{};
const TG=VT_DRAW_GROUPS.map(g=>g.tools);
const DL=()=>{S.dr=S.dr||{};return S.dr[S.chart.sym]=S.dr[S.chart.sym]||[]};
function vtGroupCur(g){
  if(g.tools.includes(TOOL))return TOOL;
  const saved=S.groupTool&&S.groupTool[g.id];
  return saved&&g.tools.includes(saved)?saved:g.tools[0];
}
function tbHTML(){
  const util=(k,t,on,fn)=>`<button type="button" class="vt-rail-btn ${on?"on":""}" data-tool="${k}" title="${t}" aria-label="${t}" onclick="${fn}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg></button>`;
  const grpHTML=VT_DRAW_GROUPS.map(g=>{
    const cur=vtGroupCur(g);
    const active=g.tools.includes(TOOL);
    const multi=g.tools.length>1;
    return `<div class="vt-rail-grp" data-gid="${g.id}"><button type="button" class="vt-rail-btn ${active?"on":""}" data-tool="${cur}" title="${DT[cur]}${VT_TOOL_SHORT[cur]?" ("+VT_TOOL_SHORT[cur]+")":""}" aria-label="${DT[cur]}" onclick="setTool('${cur}')"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[cur]}</svg></button>${multi?`<button type="button" class="vt-rail-fly" title="More ${g.name}" aria-label="More ${g.name}" onclick="vtOpenDrawFlyout(event,'${g.id}')">▸</button>`:""}</div>`;
  }).join("");
  const starBtn=`<button type="button" class="vt-rail-star ${S.favBarOn?"on":""}" data-fav-toggle="1" title="${S.favBarOn?"Hide":"Show"} favourite drawing tools bar" aria-label="${S.favBarOn?"Hide":"Show"} favourite drawing tools" aria-pressed="${S.favBarOn?"true":"false"}" onclick="vtToggleFavBar()"><svg viewBox="0 0 24 24" width="17" height="17" fill="${S.favBarOn?"currentColor":"none"}" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></button>`;
  return grpHTML+"<hr>"+util("magnet","Magnet mode (or hold Ctrl)",MAG,"togT('MAG')")+util("lock","Lock all drawings",LOCKD,"togT('LOCKD')")+util("eye","Hide all drawings",HIDD,"togT('HIDD')")+util("trash","Remove all drawings",0,"clrD()")+"<div class=\"vt-rail-sp\"></div>"+starBtn;
}
function vtCloseDrawFlyout(){const f=document.getElementById("vt_draw_flyout");if(f)f.remove()}
function vtOpenDrawFlyout(ev,gid){
  if(ev){ev.stopPropagation();ev.preventDefault()}
  const existing=document.getElementById("vt_draw_flyout");
  if(existing&&existing.dataset.gid===gid){existing.remove();return}
  vtCloseDrawFlyout();
  const g=VT_DRAW_GROUPS.find(x=>x.id===gid);if(!g)return;
  const btn=ev&&ev.currentTarget?ev.currentTarget.closest(".vt-rail-grp"):null;
  const r=btn?btn.getBoundingClientRect():{right:54,top:120};
  const pop=document.createElement("div");
  pop.id="vt_draw_flyout";pop.className="vt-draw-flyout";pop.dataset.gid=gid;pop.setAttribute("role","menu");
  pop.style.left=Math.min(window.innerWidth-248,Math.round(r.right+6))+"px";
  pop.style.top=Math.max(52,Math.min(window.innerHeight-280,Math.round(r.top)))+"px";
  pop.innerHTML=`<div class="vt-df-hd">${esc(g.name)}</div>`+g.tools.map(k=>{
    const fav=(S.favTools||[]).includes(k);
    const sc=VT_TOOL_SHORT[k]||"";
    return `<div class="vt-df-row ${TOOL===k?"on":""}"><button type="button" class="vt-df-pick" role="menuitem" onclick="vtPickGroupTool('${gid}','${k}')"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg><span>${esc(DT[k]||k)}</span>${sc?`<kbd>${sc}</kbd>`:""}</button><button type="button" class="vt-df-star ${fav?"on":""}" title="${fav?"Remove from":"Add to"} favourites" aria-label="${fav?"Unfavourite":"Favourite"} ${esc(DT[k]||k)}" onclick="vtToggleFavTool(event,'${k}','${gid}')">★</button></div>`;
  }).join("");
  document.body.appendChild(pop);
}
function vtPickGroupTool(gid,k){
  S.groupTool=S.groupTool||{};S.groupTool[gid]=k;save();
  vtCloseDrawFlyout();setTool(k);
}
function vtToggleFavTool(ev,k,gid){
  if(ev)ev.stopPropagation();
  S.favTools=Array.isArray(S.favTools)?S.favTools:[];
  const i=S.favTools.indexOf(k);
  if(i>=0)S.favTools.splice(i,1);else S.favTools.push(k);
  save();vtRenderFavBars();
  if(gid){vtCloseDrawFlyout();const grp=document.querySelector(`.vt-rail-grp[data-gid="${gid}"] .vt-rail-fly`);if(grp)vtOpenDrawFlyout({currentTarget:grp,stopPropagation(){},preventDefault(){}},gid)}
}
function vtToggleFavBar(){
  S.favBarOn=!S.favBarOn;save();tbRef();vtRenderFavBars();
}
function vtRenderFavBars(){
  const hosts=[document.getElementById("vt_favbar_host"),document.getElementById("bt_favbar_host")].filter(Boolean);
  hosts.forEach(host=>{
    if(!S.favBarOn||!S.favTools||!S.favTools.length){host.innerHTML="";return}
    const pos=S.favBarPos||{x:null,y:10};
    const style=pos.x!=null?`left:${pos.x}px;top:${pos.y}px;transform:none`:`left:50%;top:${pos.y}px;transform:translateX(-50%)`;
    host.innerHTML=`<div class="vt-favbar" role="toolbar" aria-label="Favourite drawing tools" style="${style}"><span class="vt-fav-drag" title="Drag toolbar" aria-hidden="true">⋮⋮</span>${S.favTools.filter(k=>IC[k]).map(k=>`<button type="button" class="vt-fav-btn ${TOOL===k?"on":""}" data-tool="${k}" title="${esc(DT[k]||k)}" aria-label="${esc(DT[k]||k)}" onclick="setTool('${k}')"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k]}</svg></button>`).join("")}</div>`;
    const bar=host.querySelector(".vt-favbar"),handle=host.querySelector(".vt-fav-drag");
    if(bar&&handle){
      handle.onpointerdown=e=>{
        e.preventDefault();e.stopPropagation();
        const pr=host.parentElement.getBoundingClientRect(),br=bar.getBoundingClientRect();
        const ox=e.clientX-br.left,oy=e.clientY-br.top;
        handle.setPointerCapture&&handle.setPointerCapture(e.pointerId);
        const mv=ev=>{
          const nx=Math.max(6,Math.min(pr.width-br.width-6,Math.round(ev.clientX-pr.left-ox)));
          const ny=Math.max(6,Math.min(pr.height-br.height-6,Math.round(ev.clientY-pr.top-oy)));
          bar.style.left=nx+"px";bar.style.top=ny+"px";bar.style.transform="none";
          S.favBarPos={x:nx,y:ny};
        };
        const up=()=>{window.removeEventListener("pointermove",mv);window.removeEventListener("pointerup",up);save()};
        window.addEventListener("pointermove",mv);window.addEventListener("pointerup",up);
      };
    }
  });
}
let dragTool=null;
function toolDrag(e,k){dragTool=k;e.dataTransfer.setData("text",k)}
function toolOver(e,k){e.preventDefault();if(dragTool&&dragTool!==k)e.currentTarget.style.boxShadow="inset 0 0 0 2px #2962ff"}
function toolLeave(e){e.currentTarget.style.boxShadow=""}
function toolDrop(e,target){e.preventDefault();e.currentTarget.style.boxShadow="";if(!dragTool||dragTool===target)return;
const all=TG.flat();const fi=all.indexOf(dragTool),ti=all.indexOf(target);
if(fi<0||ti<0)return;all.splice(fi,1);all.splice(ti,0,dragTool);
TG.length=0;let g=[];all.forEach((k,i)=>{g.push(k);if(g.length>=8||i===all.length-1){TG.push(g);g=[]}});
S.toolOrder=TG.flat();save();tbRef()}
const TVCOLORS=["#ffffff","#f5f5f5","#e0e0e0","#bdbdbd","#9e9e9e","#757575","#424242","#212121","#000000",
"#ffebee","#ffcdd2","#ef9a9a","#e57373","#ef5350","#f44336","#e53935","#d32f2f","#c62828","#b71c1c",
"#fff3e0","#ffe0b2","#ffcc80","#ffb74d","#ffa726","#ff9800","#fb8c00","#f57c00","#ef6c00","#e65100",
"#fffde7","#fff9c4","#fff59d","#fff176","#ffee58","#ffeb3b","#fdd835","#fbc02d","#f9a825","#f57f17",
"#e8f5e9","#c8e6c9","#a5d6a7","#81c784","#66bb6a","#4caf50","#43a047","#388e3c","#2e7d32","#1b5e20",
"#e0f7fa","#b2ebf2","#80deea","#4dd0e1","#26c6da","#00bcd4","#00acc1","#0097a7","#00838f","#006064",
"#e3f2fd","#bbdefb","#90caf9","#64b5f6","#42a5f5","#2196f3","#1e88e5","#1976d2","#1565c0","#0d47a1",
"#f3e5f5","#e1bee7","#ce93d8","#ba68c8","#ab47bc","#9c27b0","#8e24aa","#7b1fa2","#6a1b9a","#4a148c",
"#fce4ec","#f8bbd0","#f48fb1","#f06292","#ec407a","#e91e63","#d81b60","#c2185b","#ad1457","#880e4f"];
S.customColors=S.customColors||[];
function colorPicker(id,val,cb){
  const hex=val||"#000000";
  return `<div style="position:relative;display:inline-block"><div id="${id}_sw" style="width:24px;height:24px;background:${hex};border:1px solid var(--line);border-radius:4px;cursor:pointer" onclick="showColorPop('${id}')"></div><input type="hidden" id="${id}" data-c="${id}" value="${hex}"></div>`;
}
function showColorPop(id){
  let pop=document.getElementById("cpop");
  if(pop)pop.remove();
  const grid=TVCOLORS.map(c=>`<div style="width:20px;height:20px;background:${c};cursor:pointer;border-radius:3px" onclick="selectColor('${id}','${c}')"></div>`).join("");
  const customs=S.customColors.map(c=>`<div style="width:20px;height:20px;background:${c};cursor:pointer;border-radius:3px" onclick="selectColor('${id}','${c}')"></div>`).join("");
  pop=document.createElement("div");pop.id="cpop";
  pop.style.cssText="position:fixed;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;z-index:1000;box-shadow:0 4px 16px rgba(0,0,0,.2)";
  pop.innerHTML=`<div style="display:grid;grid-template-columns:repeat(10,1fr);gap:3px">${grid}</div><div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line);display:flex;gap:4px;flex-wrap:wrap;align-items:center">${customs}<div style="width:20px;height:20px;border:1px dashed var(--mut);border-radius:3px;cursor:pointer;display:flex;align-items:center;justify-content:center" onclick="addCustomColor('${id}')">+</div></div>`;
  const sw=document.getElementById(id+"_sw");
  const r=sw.getBoundingClientRect();
  pop.style.left=r.left+"px";pop.style.top=(r.bottom+4)+"px";
  document.body.appendChild(pop);
  setTimeout(()=>document.addEventListener("click",closeColorPop,{once:true}),10);
}
function closeColorPop(e){const p=document.getElementById("cpop");if(p&&!p.contains(e.target))p.remove()}
function selectColor(id,c){const inp=document.getElementById(id);if(inp)inp.value=c;const sw=document.getElementById(id+"_sw");if(sw)sw.style.background=c;const pop=document.getElementById("cpop");if(pop)pop.remove();if(SELD){if(id==="ds_c"||id==="tb_c")SELD.c=c;if(id==="ds_tc")SELD.targetCol=c;if(id==="ds_sc")SELD.stopCol=c;if(id==="ds_txc")SELD.txtCol=c}if(id==="ed_col"){const ind=S.chart.ind.find(x=>x.id===document.getElementById("ed_id")?.value);if(ind){ind.col=c;save();drawChart()}}}
function addVektorIndi(){
  const inds=[
    {t:"ema",len:5,col:"#9c27b0"},
    {t:"ema",len:10,col:"#2196f3"},
    {t:"ema",len:20,col:"#ff9800"},
    {t:"sma",len:50,col:"#4caf50"},
    {t:"sma",len:200,col:"#f44336"},
    {t:"atr",len:14,col:"#787b86"}
  ];
  inds.forEach(d=>{
    if(!S.chart.ind.find(x=>x.t===d.t&&x.len===d.len))
      S.chart.ind.push({id:vtNextId("i"),...d});
  });
  save();closeM();drawChart();
}
function inputDialog(title,placeholder,cb){
  modal(`<h3>${title}</h3><input id="inp_val" placeholder="${placeholder||""}" style="width:100%;padding:8px;font-size:14px" autofocus><div class="row" style="margin-top:12px"><span class="sp"></span><button onclick="closeM()">Cancel</button><button class="pri" id="inp_ok">OK</button></div>`);
  setTimeout(()=>{document.getElementById("inp_val").focus();document.getElementById("inp_ok").onclick=()=>{const v=document.getElementById("inp_val").value;closeM();if(cb)cb(v)}},50);
}
function addCustomColor(id){inputDialog("Custom color","#ff0000",function(c){if(c&&/^#[0-9a-f]{6}$/i.test(c)){S.customColors.push(c);save();selectColor(id,c)}})}
function snapMenu(ev){
  const d=document.getElementById("snapdrop");if(!d)return;
  if(d.style.display==="block"){d.style.display="none";return}
  const btn=ev&&ev.currentTarget||d.previousElementSibling;
  if(btn){
    const r=btn.getBoundingClientRect();
    d.style.position="fixed";
    d.style.top=Math.round(r.bottom+6)+"px";
    d.style.left=Math.max(8,Math.min(window.innerWidth-160,Math.round(r.right-150)))+"px";
    d.style.right="auto";
  }
  d.style.display="block";
}
function vtTogChartMore(ev){
  if(ev)ev.stopPropagation();
  const d=document.getElementById("vt_chmore");if(!d)return;
  if(d.style.display==="block"){d.style.display="none";return}
  const btn=ev&&ev.currentTarget||document.getElementById("vt_chmore_btn");
  if(btn){
    const r=btn.getBoundingClientRect();
    d.style.position="fixed";
    d.style.top=Math.round(r.bottom+6)+"px";
    d.style.left=Math.max(8,Math.min(window.innerWidth-210,Math.round(r.right-200)))+"px";
    d.style.right="auto";
  }
  const sym=(S.chart&&S.chart.sym)||"";
  const inWl=!!sym&&wlAll().includes(sym);
  d.innerHTML=`<div class="vt-pop-item" style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px" onclick="document.getElementById('vt_chmore').style.display='none';tplM()"><span>Chart Templates</span><span class="mut" style="font-size:11px">Save / Load</span></div>`+
  `<div class="vt-pop-item" style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px" onclick="document.getElementById('vt_chmore').style.display='none';if(typeof vsM==='function')vsM()"><span>Vektor Script Editor</span><span class="mut" style="font-size:11px">Custom code</span></div>`+
  `<div class="vt-pop-item" style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px" onclick="document.getElementById('vt_chmore').style.display='none';const b=document.getElementById('vtWlAdd');if(b)b.click();else wlStar()"><span>${inWl?"✓ In Watchlist":"Add to Watchlist"}</span><span class="mut" style="font-size:11px">${esc(sym)}</span></div>`+
  `<div class="vt-pop-item" style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px" onclick="document.getElementById('vt_chmore').style.display='none';const b=document.getElementById('vtWlLocate');if(b)b.click();else go('screener')"><span>Locate in Screener</span><span class="mut" style="font-size:11px">Jump to row</span></div>`+
  `<div class="vt-pop-item" style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px" onclick="document.getElementById('vt_chmore').style.display='none';scrSetM()"><span>Screener Settings</span><span class="mut" style="font-size:11px">P1–P5</span></div>`;
  d.style.display="block";
}
function snapCanvas(){return new Promise(r=>{const cm=document.querySelector(".cm"),bs=document.getElementById("bs"),ind=document.getElementById("indbar");if(bs)bs.style.visibility="hidden";if(!S.chart.snapInd&&ind)ind.style.visibility="hidden";html2canvas(cm,{backgroundColor:null,scale:2}).then(c=>{if(bs)bs.style.visibility="";if(ind)ind.style.visibility="";r(c)})})}
async function snapDownload(){document.getElementById("snapdrop").style.display="none";const c=await snapCanvas();const a=document.createElement("a");a.download=S.chart.sym+"_"+S.chart.tf+".png";a.href=c.toDataURL();a.click()}
async function snapCopy(){document.getElementById("snapdrop").style.display="none";const c=await snapCanvas();c.toBlob(b=>navigator.clipboard.write([new ClipboardItem({"image/png":b})]))}
async function snapOpen(){document.getElementById("snapdrop").style.display="none";const c=await snapCanvas();c.toBlob(b=>{const u=URL.createObjectURL(b);window.open(u)})}
function resetLive(){
  try{
    const cvEl=document.getElementById("cv");
    if(!ch||!cvEl||typeof ch.timeScale!=="function")return;
    const a=candles(symOf(S.chart.sym),S.chart.tf);
    if(!a||!a.length)return;
    const cw=cvEl.clientWidth,nb=cw?Math.round(cw/7):110;
    ch.timeScale().setVisibleLogicalRange({from:a.length-Math.round(nb*0.7),to:a.length+Math.round(nb*0.3)});
    ch.priceScale("right").applyOptions({autoScale:true,scaleMargins:{top:0.3,bottom:0.1}});
  }catch(e){console.error("resetLive error:",e)}
}
function setTool(t){TOOL=t;DRAFT=null;tbRef();vtRenderFavBars()}
function tbRef(){const e=document.getElementById("tb");if(e)e.innerHTML=tbHTML();const bt=document.getElementById("bt_tb");if(bt)bt.innerHTML=tbHTML();dpe();dsel();vtSyncUndoBtns();vtRenderFavBars()}
function tfStar(t){const i=S.tfFav.indexOf(t);if(i>=0)S.tfFav.splice(i,1);else S.tfFav.push(t);save();drawChart()}
function tfPick(t){S.chart.tf=t;save();drawChart();if(typeof vtCanUseEdge==="function"&&vtCanUseEdge()&&typeof vtSyncChartFeed==="function"&&S.chart.sym)vtSyncChartFeed(S.chart.sym,t);const m=document.getElementById("tfm");if(m)m.style.display="none"}
function tfMenu(ev){const m=document.getElementById("tfm");if(!m)return;if(m.style.display==="block"){m.style.display="none";return}const btn=ev&&ev.currentTarget||m.previousElementSibling;if(btn){const r=btn.getBoundingClientRect();m.style.position="fixed";m.style.top=Math.round(r.bottom+6)+"px";m.style.left=Math.max(8,Math.min(window.innerWidth-210,Math.round(r.left)))+"px";m.style.maxHeight=Math.max(200,window.innerHeight-r.bottom-24)+"px"}m.style.display="block"}
function tfCustomM(){
  modal(`<h3>Add custom interval</h3><div class="row"><input type="number" id="tc_n" min="1" value="1" style="width:80px"><select id="tc_u"><option value="s">seconds</option><option value="m" selected>minutes</option><option value="H">hours</option><option value="D">days</option><option value="W">weeks</option><option value="M">months</option></select></div><div class="row"><span class="sp"></span><button onclick="closeM()">Cancel</button><button class="pri" onclick="tfCustomAdd()">Add</button></div>`);
}
function tfCustomAdd(){
  const n=+document.getElementById("tc_n").value||1,u=document.getElementById("tc_u").value;
  const label=n+u;
  if(!S.tfCustom.find(c=>c.label===label))S.tfCustom.push({n,u,label});
  if(!S.tfFav.includes(label))S.tfFav.push(label);
  // register step and interval so the chart can use it
  const mult={s:1,m:60,H:3600,D:86400,W:604800,M:2592000};
  STEP[label]=n*mult[u];INT[label]=label;TS[label]=TS[label]||0.5;
  save();closeM();drawChart();
}
function tfCustomDel(label){
  S.tfCustom=S.tfCustom.filter(c=>c.label!==label);
  S.tfFav=S.tfFav.filter(t=>t!==label);
  save();drawChart();
}
function tfHTML(){const fav=S.tfFav||[],C=S.chart,custom=S.tfCustom||[];
let h=`<div class="tfs tfb">${fav.map(t=>`<button class="chip ${t===C.tf?"on":""}" onclick="tfPick('${t}')">${t}</button>`).join("")}<button class="chip" onclick="tfMenu(event)" title="All timeframes" aria-label="All timeframes">${VT_IC.chevDown}</button></div>`;
h+=`<div id="tfm" class="vt-pop-ov" style="display:none;position:fixed;background:var(--glass-bg,var(--bg));border:1px solid var(--glass-border,var(--line));border-radius:8px;z-index:1050;max-height:400px;overflow:auto;min-width:196px;box-shadow:0 18px 44px rgba(0,0,0,.45);padding:4px 0">`;
h+=`<div style="padding:6px 12px;cursor:pointer;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:6px" onclick="tfCustomM()">${VT_IC.plus}<span>Add custom interval…</span></div>`;
if(custom.length){h+=`<div style="padding:6px 12px 2px;font-size:11px;color:var(--mut);font-weight:600">CUSTOM</div>`;custom.forEach(c=>{const on=fav.includes(c.label);h+=`<div style="display:flex;align-items:center;gap:6px;padding:5px 12px;cursor:pointer" onclick="tfPick('${c.label}')"><span style="flex:1">${c.label}</span><span onclick="event.stopPropagation();tfCustomDel('${c.label}')" title="Delete" style="cursor:pointer;display:inline-flex">${VT_IC.trash}</span><span onclick="event.stopPropagation();tfStar('${c.label}')" style="cursor:pointer;display:inline-flex">${on?VT_IC.starOn:VT_IC.starOff}</span></div>`})}
for(const[cat,arr]of Object.entries(TF_CAT)){
  h+=`<div style="padding:6px 12px 2px;font-size:11px;color:var(--mut);font-weight:600">${cat}</div>`;
  arr.forEach(t=>{const on=fav.includes(t);h+=`<div style="display:flex;align-items:center;padding:5px 12px;cursor:pointer" onclick="tfPick('${t}')"><span style="flex:1">${t}</span><span onclick="event.stopPropagation();tfStar('${t}')" style="cursor:pointer;display:inline-flex">${on?VT_IC.starOn:VT_IC.starOff}</span></div>`});
}
h+=`</div>`;
return h}
function togT(k){if(k==="MAG")MAG=!MAG;else if(k==="LOCKD"){LOCKD=!LOCKD;SELD=null}else HIDD=!HIDD;tbRef()}
function clrD(){if(DL().length&&confirm("Remove all drawings on "+S.chart.sym+"?")){pushUndo();S.dr[S.chart.sym]=[];SELD=null;save();tbRef()}}
let UNDO=[],REDO=[];
function pushUndo(){UNDO.push(JSON.stringify(S.dr||{}));if(UNDO.length>50)UNDO.shift();REDO=[];vtSyncUndoBtns()}
function doUndo(){if(!UNDO.length)return;REDO.push(JSON.stringify(S.dr||{}));S.dr=JSON.parse(UNDO.pop());SELD=null;save();tbRef();vtSyncUndoBtns()}
function doRedo(){if(!REDO.length)return;UNDO.push(JSON.stringify(S.dr||{}));S.dr=JSON.parse(REDO.pop());SELD=null;save();tbRef();vtSyncUndoBtns()}
document.addEventListener("keydown",e=>{
  const ae=document.activeElement;
  if(ae&&(/INPUT|SELECT|TEXTAREA/.test(ae.tagName||"")||ae.isContentEditable))return;
  if((e.ctrlKey||e.metaKey)&&!e.altKey){
    const k=String(e.key||"").toLowerCase();
    if(k==="z"&&!e.shiftKey){if(UNDO.length){e.preventDefault();doUndo()}}
    else if(k==="y"||(k==="z"&&e.shiftKey)){if(REDO.length){e.preventDefault();doRedo()}}
  }
});
function delSel(){if(SELD){pushUndo();const L=DL(),i=L.indexOf(SELD);if(i>=0)L.splice(i,1);SELD=null;save();tbRef()}}
function dpe(){const c=document.getElementById("dc");if(c){c.style.pointerEvents=(TOOL!=="cross"||SELD||DRAFT)&&!HIDD?"auto":"none";c.style.cursor=TOOL!=="cross"?"crosshair":"default"}}
function dsel(){const e=document.getElementById("dsel");if(!e)return;if(!SELD){e.style.display="none";return}
e.style.display="flex";e.innerHTML=`${colorPicker("tb_c",SELD.c)}<select title="Line type" onchange="SELD.s=+this.value">${LSTYLES.map((st,i)=>`<option value="${i}" ${i==(SELD.s||0)?"selected":""}>${st.n}</option>`).join("")}</select><select onchange="SELD.w=+this.value">${[1,2,3,4].map(w=>`<option ${w==SELD.w?"selected":""}>${w}</option>`).join("")}</select>${(SELD.t==="hline"||SELD.t==="hray")?`<button onclick="alertFromHline(SELD.p[0].y)" title="Set price alert">Alert</button>`:""}<button onclick="drawSetM()" title="Settings" aria-label="Settings">${VT_IC.gear}</button><button onclick="delSel()" title="Delete" aria-label="Delete">${VT_IC.trash}</button>`}
// time <-> x and price <-> y (times are stored, so drawings follow the chart across timeframes)
function t2l(t){const tt=G.tt,n=tt.length-1,st=G.st;if(t<=tt[0])return(t-tt[0])/st;if(t>=tt[n])return n+(t-tt[n])/st;let lo=0,hi=n;while(hi-lo>1){const m=(lo+hi)>>1;if(tt[m]>t)hi=m;else lo=m}return lo+(t-tt[lo])/(tt[hi]-tt[lo])}
function l2t(l){const tt=G.tt,n=tt.length-1,st=G.st;if(l<=0)return tt[0]+l*st;if(l>=n)return tt[n]+(l-n)*st;const i=Math.floor(l);return tt[i]+(l-i)*(tt[i+1]-tt[i])}
const px=p=>({x:ch.timeScale().logicalToCoordinate(t2l(p.t)),y:MS.priceToCoordinate(p.y)});
const un=(x,y)=>({t:l2t(ch.timeScale().coordinateToLogical(x)),y:MS.coordinateToPrice(y)});
function snapP(x,y){const p=un(x,y);if(!MAG&&!MOD[1])return p;const l=Math.round(ch.timeScale().coordinateToLogical(x)),c=G.a[l];if(!c)return p;
let best=null,bd=MOD[1]?1e9:24,o=c.o!=null?c.o:c.c;[c.h,c.l,Math.max(o,c.c),Math.min(o,c.c)].forEach(v=>{const yy=MS.priceToCoordinate(v);if(yy!=null&&Math.abs(yy-y)<bd){bd=Math.abs(yy-y);best=v}});if(best!=null){p.y=best;p.t=G.tt[l]}return p}
function ptAt(x,y,anc,t){if(MOD[0]&&anc){const a=px(anc);if(a.x!=null){let dx=x-a.x,dy=y-a.y,h=0,v=0;
if(t==="rect"){const m=Math.max(Math.abs(dx),Math.abs(dy));x=a.x+Math.sign(dx||1)*m;y=a.y+Math.sign(dy||1)*m}
else if(t==="trend"||t==="ray"||t==="ext"||t==="fib"){const ax=Math.abs(dx),ay=Math.abs(dy);if(ay<ax*.4142){y=a.y;h=1}else if(ax<ay*.4142){x=a.x;v=1}else{const m=(ax+ay)/2;x=a.x+Math.sign(dx||1)*m;y=a.y+Math.sign(dy||1)*m}}
const r=un(x,y);if(h)r.y=anc.y;if(v)r.t=anc.t;return r}}return snapP(x,y)}
function ends(d,q){const[a,b]=q,dx=b.x-a.x,dy=b.y-a.y,k=6000/(Math.hypot(dx,dy)||1);return d.t==="trend"?[a,b]:d.t==="ray"?[a,{x:a.x+dx*k,y:a.y+dy*k}]:[{x:a.x-dx*k,y:a.y-dy*k},{x:a.x+dx*k,y:a.y+dy*k}]}
function sd(x,y,a,b){const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy||1,t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/l));return Math.hypot(x-a.x-t*dx,y-a.y-t*dy)}
function hit(d,x,y){if(d.lock||d.hide)return 0;const q=d.p.map(px);if(q.some(o=>o.x==null||o.y==null))return 0;const t=d.t,a=q[0],n=7;
if(t==="hline")return Math.abs(y-a.y)<n;if(t==="hray")return Math.abs(y-a.y)<n&&x>a.x-n;if(t==="vline")return Math.abs(x-a.x)<n;
if(t==="text")return Math.abs(x-a.x)<60&&Math.abs(y-a.y)<14;
if(t==="note"){
  const txt=d.txt||"Note",tw=12*txt.length*0.6+16;
  const bp=q[1]||{x:a.x+40,y:a.y-40};
  const bx=bp.x,by=bp.y,bw=tw,bh=22;
  if(Math.hypot(x-a.x,y-a.y)<12)return 1; // anchor
  if(x>=bx&&x<=bx+bw&&y>=by&&y<=by+bh)return 2; // box (return 2 so we know it's the box)
  return 0;
}
if(t==="trend"||t==="ray"||t==="ext"||t==="arrow"){const[e,f]=ends(d,q);return sd(x,y,e,f)<n}
if(t==="prange"||t==="drange"){
  const xs=q.map(o=>o.x),ys=q.map(o=>o.y);
  return x>Math.min(...xs)-8&&x<Math.max(...xs)+8&&y>Math.min(...ys)-8&&y<Math.max(...ys)+8;
}
const xs=q.map(o=>o.x),ys=q.map(o=>o.y);return x>Math.min(...xs)-n&&x<Math.max(...xs)+n&&y>Math.min(...ys)-n&&y<Math.max(...ys)+n}
function shape(g,d,W,H,sel){const q=d.p.map(px);if(q.some(o=>o.x==null||o.y==null))return;const t=d.t,a=q[0],b=q[1],c=d.c;
g.lineWidth=d.w;g.strokeStyle=c;g.fillStyle=c;g.font="12px system-ui,sans-serif";g.setLineDash((LSTYLES[d.s||0]||LSTYLES[0]).d);
const ln=(x1,y1,x2,y2)=>{g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y2);g.stroke()};
const tag=(s,x,y,bg)=>{const w=g.measureText(s).width+10;g.fillStyle=bg||c;g.fillRect(x,y-9,w,18);g.fillStyle="#fff";g.fillText(s,x+5,y+4)};
if(t==="trend"||t==="ray"||t==="ext"){const[e,f]=ends(d,q);ln(e.x,e.y,f.x,f.y)}
else if(t==="hline"){ln(0,a.y,W,a.y);tag(fp(d.p[0].y),W-66,a.y)}
else if(t==="hray")ln(a.x,a.y,W,a.y);
else if(t==="vline")ln(a.x,0,a.x,H);
else if(t==="brush"&&q.length>1){g.beginPath();g.moveTo(q[0].x,q[0].y);for(let i=1;i<q.length;i++)g.lineTo(q[i].x,q[i].y);g.stroke()}
else if(t==="rect"){g.globalAlpha=.15;g.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);g.globalAlpha=1;g.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y)}
else if(t==="fib"){const pa=d.p[0].y,pb=d.p[1].y,x1=Math.min(a.x,b.x),x2=Math.max(a.x,b.x);
[0,.236,.382,.5,.618,.786,1].forEach(lv=>{const yy=b.y+(a.y-b.y)*lv;ln(x1,yy,x2,yy);g.fillStyle=c;g.fillText(lv+" ("+fp(pb+(pa-pb)*lv)+")",x1+4,yy-3)})}
else if(t==="long"||t==="short"){
  const e=d.p[0].y,tp=d.p[1].y,sl=d.p[2].y;
  const x1=Math.min(a.x,b.x),w=Math.max(80,Math.abs(b.x-a.x));
  const yT=b.y,yS=q[2]?q[2].y:a.y+(t==="long"?30:-30);
  const gr=d.targetCol||"#089981",rd=d.stopCol||"#f23645",txc=d.txtCol||"#787b86";
  const isLong=t==="long";
  // Profit zone (green)
  g.globalAlpha=.15;g.fillStyle=gr;g.fillRect(x1,Math.min(a.y,yT),w,Math.abs(yT-a.y));
  // Stop zone (red)
  g.fillStyle=rd;g.fillRect(x1,Math.min(a.y,yS),w,Math.abs(yS-a.y));g.globalAlpha=1;
  // Entry line
  g.strokeStyle="#787b86";g.lineWidth=1;ln(x1,a.y,x1+w,a.y);
  // Labels
  g.font="11px system-ui,sans-serif";
  const tpPct=((tp-e)/e*100).toFixed(2),slPct=((sl-e)/e*100).toFixed(2);
  const rr=(Math.abs(tp-e)/(Math.abs(e-sl)||1)).toFixed(2);
  // Target label
  g.fillStyle=gr;g.fillText("Target "+fp(tp)+" ("+tpPct+"%)",x1+4,yT<(a.y)?yT+14:yT-4);
  // Stop label
  g.fillStyle=rd;g.fillText("Stop "+fp(sl)+" ("+slPct+"%)",x1+4,yS<(a.y)?yS+14:yS-4);
  // R/R in middle
  g.fillStyle=txc;g.fillText("R/R "+rr,x1+w/2-16,a.y-4);
}
else if(t==="text"){if(!d.txt)return;g.font="14px system-ui,sans-serif";g.fillStyle=d.txtCol||d.c||contrastText(pal().bg||"#fff");g.fillText(d.txt,a.x,a.y+4)}
else if(t==="arrow"){
  const[e,f]=q;
  // TradingView-style open arrowhead
  const ang=Math.atan2(f.y-e.y,f.x-e.x),ah=14,aw=0.45;
  g.beginPath();g.moveTo(e.x,e.y);g.lineTo(f.x,f.y);g.stroke();
  g.beginPath();g.moveTo(f.x,f.y);
  g.lineTo(f.x-ah*Math.cos(ang-aw),f.y-ah*Math.sin(ang-aw));
  g.moveTo(f.x,f.y);
  g.lineTo(f.x-ah*Math.cos(ang+aw),f.y-ah*Math.sin(ang+aw));
  g.stroke();
}
else if(t==="note"){
  const txt=d.txt||"Note";
  g.font="12px system-ui,sans-serif";
  const tw=g.measureText(txt).width,bw=tw+16,bh=22;
  // box position: second point if set, otherwise default offset
  const bp=q[1]||{x:a.x+40,y:a.y-40};
  const bx=bp.x,by=bp.y;
  g.fillStyle="#ffffff";g.strokeStyle="#d1d4dc";g.lineWidth=1;
  g.beginPath();g.roundRect(bx,by,bw,bh,4);g.fill();g.stroke();
  g.strokeStyle="#787b86";g.lineWidth=1;
  g.beginPath();g.moveTo(a.x,a.y);g.lineTo(bx+8,by+bh);g.stroke();
  g.fillStyle="#131722";g.beginPath();g.arc(a.x,a.y,2.5,0,7);g.fill();
  g.fillStyle="#131722";g.fillText(txt,bx+8,by+15);
}
else if(t==="prange"){
  // Price Range — horizontal levels with shaded area, price diff and %
  const y1=Math.min(a.y,b.y),y2=Math.max(a.y,b.y),x1=Math.min(a.x,b.x),x2=Math.max(a.x,b.x);
  const midX=(x1+x2)/2;
  g.globalAlpha=.12;g.fillStyle="#2962ff";g.fillRect(x1,y1,x2-x1,y2-y1);g.globalAlpha=1;
  g.strokeStyle="#2962ff";g.lineWidth=1;ln(x1,y1,x2,y1);ln(x1,y2,x2,y2);
  g.setLineDash([3,3]);ln(midX,y1,midX,y2);g.setLineDash((LSTYLES[d.s||0]||LSTYLES[0]).d);
  const p1=d.p[0].y,p2=d.p[1].y,diff=Math.abs(p2-p1),pct=p1?Math.abs((p2/p1-1)*100):0;
  const lbl=fp(diff)+" ("+pct.toFixed(2)+"%)";
  g.font="12px system-ui,sans-serif";const lw=g.measureText(lbl).width;
  g.fillStyle="#ffffff";g.fillRect(midX-lw/2-4,(y1+y2)/2-8,lw+8,16);
  g.fillStyle="#2962ff";g.fillText(lbl,midX-lw/2,(y1+y2)/2+4);
}
else if(t==="drange"){
  // Date Range — two vertical lines with bar count
  const x1=Math.min(a.x,b.x),x2=Math.max(a.x,b.x);
  g.globalAlpha=.08;g.fillStyle="#2962ff";g.fillRect(x1,0,x2-x1,H);g.globalAlpha=1;
  g.strokeStyle="#2962ff";g.lineWidth=1;ln(x1,0,x1,H);ln(x2,0,x2,H);
  const bars=Math.abs(Math.round((d.p[1].t-d.p[0].t)/G.st));
  const lbl=bars+" bars";
  g.font="12px system-ui,sans-serif";const lw=g.measureText(lbl).width;
  const my=(a.y+b.y)/2;
  g.fillStyle="#ffffff";g.fillRect((x1+x2)/2-lw/2-4,my-8,lw+8,16);
  g.fillStyle="#2962ff";g.fillText(lbl,(x1+x2)/2-lw/2,my+4);
}
// optional text label — middle breaks the line; other alignments sit near a continuous line
if(d.txt&&t!=="text"&&t!=="note"){
  const fs=d.txtSize||12,bold=d.txtBold?"bold ":"",italic=d.txtItalic?"italic ":"";
  g.font=italic+bold+fs+"px system-ui,sans-serif";
  const m=g.measureText(d.txt),tw=m.width,th=fs,pad=4;
  const va=d.txtVA||"top",ha=d.txtHA||"right";
  const isLine=t==="trend"||t==="ray"||t==="ext"||t==="hline"||t==="hray"||t==="vline";
  let tx,ty,gap=null;
  if(isLine){
    // use the actual drawn extent of the line, not just the stored points
    let minX,maxX,minY,maxY;
    if(t==="hline"){minX=0;maxX=W;minY=maxY=a.y}
    else if(t==="hray"){minX=a.x;maxX=W;minY=maxY=a.y}
    else if(t==="vline"){minY=0;maxY=H;minX=maxX=a.x}
    else{
      const xs=q.map(o=>o.x),ys=q.map(o=>o.y);
      minX=Math.min(...xs);maxX=Math.max(...xs);minY=Math.min(...ys);maxY=Math.max(...ys);
    }
    const midX=(minX+maxX)/2,midY=(minY+maxY)/2;
    if(t==="vline"){
      // vertical line: VA moves along the line, HA offsets sideways
      if(va==="top")ty=minY+22; // extra space so text isn't cut off at the top edge
      else if(va==="bottom")ty=maxY-th-pad;
      else ty=midY+th/3;
      if(ha==="left")tx=a.x-tw-pad;
      else if(ha==="right")tx=a.x+pad;
      else tx=a.x-tw/2;
    }else{
      if(ha==="left")tx=minX;
      else if(ha==="right")tx=maxX-tw;
      else tx=midX-tw/2;
      if(va==="top")ty=midY-th-pad;
      else if(va==="bottom")ty=midY+th+pad;
      else ty=midY+th/3; // middle
    }
    // only middle creates a gap in the line
    if(va==="middle"){
      gap={x:tx-pad,w:tw+pad*2,y:ty-th/2};
    }
  }else{
    const xs=q.map(o=>o.x),ys=q.map(o=>o.y);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const midX=(minX+maxX)/2,midY=(minY+maxY)/2;
    if(ha==="left")tx=minX;
    else if(ha==="center")tx=midX-tw/2;
    else tx=maxX-tw;
    if(va==="top")ty=minY-pad;
    else if(va==="middle")ty=midY+th/3;
    else ty=maxY+th+pad;
  }
  // break the line only for middle (all line tools)
  if(gap&&(t==="trend"||t==="ray"||t==="ext"||t==="hline"||t==="hray"||t==="vline")){
    g.save();
    g.globalCompositeOperation="destination-out";
    g.fillStyle="#000";
    if(t==="vline"){
      // vertical line: cut a horizontal gap across the line
      g.fillRect(gap.x-2,gap.y,tw+pad*2,th+4);
    }else{
      g.fillRect(gap.x,gap.y-2,gap.w,th+4);
    }
    g.restore();
  }
  g.fillStyle=d.txtCol||c;
  g.fillText(d.txt,tx,ty);
}
if(sel){g.setLineDash([]);q.forEach(o=>{g.beginPath();g.arc(o.x,o.y,5,0,7);g.fillStyle="#fff";g.fill();g.lineWidth=2;g.strokeStyle=c;g.stroke()})}}
function paint(){const cv=document.getElementById("dc");if(!cv||!ch||!G)return;const W=cv.clientWidth,H=cv.clientHeight,r=devicePixelRatio||1;
if(cv.width!==Math.round(W*r)||cv.height!==Math.round(H*r)){cv.width=Math.round(W*r);cv.height=Math.round(H*r)}
const g=cv.getContext("2d"),ts=ch.timeScale(),tw=(ts.width&&ts.width())||W-60;g.setTransform(r,0,0,r,0,0);g.clearRect(0,0,W,H);if(HIDD)return;
g.save();g.beginPath();g.rect(0,0,tw,H-26);g.clip();
DL().concat(DRAFT?[DRAFT]:[]).forEach(d=>{if(!d.hide)shape(g,d,tw,H,d===SELD)});
// ghost preview removed with path tool
if(TOOL!=="cross"&&MX){g.strokeStyle="#787b86";g.lineWidth=1;g.setLineDash([4,4]);g.beginPath();g.moveTo(MX[0],0);g.lineTo(MX[0],H);g.moveTo(0,MX[1]);g.lineTo(tw,MX[1]);g.stroke();if(MAG||MOD[1]){const o=px(snapP(MX[0],MX[1]));if(o.x!=null){g.setLineDash([]);g.beginPath();g.arc(o.x,o.y,5,0,7);g.strokeStyle="#f97316";g.lineWidth=2;g.stroke()}}}
g.restore()}
const xy=e=>{const r=e.currentTarget.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]};
function fixPos(d){if(d.t==="long"||d.t==="short")d.p[2]={t:d.p[1].t,y:d.p[0].y-(d.p[1].y-d.p[0].y)/2}}
function dFin(){
  const d=DRAFT;DRAFT=null;delete d.x0;delete d.y0;delete d.mv;delete d._lt;
  pushUndo();
  DL().push(d);SELD=d;
  if(!LOCKD)TOOL="cross";
  save();tbRef()
}
function dDown(e){const[x,y]=xy(e);MX=[x,y];MOD=[e.shiftKey,e.ctrlKey||e.metaKey];try{e.target.setPointerCapture(e.pointerId)}catch(_){}
if(TOOL!=="cross"){const p=snapP(x,y);
if(DRAFT){
  DRAFT.p[1]=ptAt(x,y,DRAFT.p[0],DRAFT.t);fixPos(DRAFT);dFin();return
}
const d={id:Date.now(),t:TOOL,p:[p],c:TOOL==="fib"?"#787b86":"#2962ff",w:2,s:0};
if(TOOL==="note"){const dd=d;inputDialog("Note text","",v=>{if(!v)return;dd.txt=v;dd.txtCol=contrastText(pal().bg||"#fff");DRAFT=dd;dFin()});return}
if(TOOL==="brush"){d.p=[p];DRAFT=d;return}
if(N2.test(TOOL)){
  d.p.push({...p});
  if(TOOL==="curve"){
    // control point offset so the curve is visible by default
    const mid={t:(p.t+p.t)/2,y:p.y};
    d.p=[p,mid,{...p}];
  }
  if(TOOL==="long"||TOOL==="short")d.p.push({...p});
  d.x0=x;d.y0=y;d.mv=0;DRAFT=d;fixPos(d)
}
else{if(TOOL==="text"||TOOL==="note"){const dd=d;inputDialog(TOOL==="note"?"Note text":"Text","",v=>{if(!v)return;dd.txt=v;dd.txtCol=contrastText(pal().bg||"#fff");DRAFT=dd;dFin()});return}DRAFT=d;dFin()}return}
if(SELD){const q=SELD.p.map(px),i=q.findIndex(o=>o.x!=null&&Math.hypot(o.x-x,o.y-y)<14);
if(i>=0){DRG={d:SELD,i};return}
if(SELD.t==="note"){
  const h=hit(SELD,x,y);
  if(h===2){DRG={d:SELD,i:1};return} // drag box
  if(h===1){DRG={d:SELD,i:0};return} // drag anchor
}
if(hit(SELD,x,y)){DRG={d:SELD,i:-1,o:un(x,y),c:clone(SELD.p)};return}}
const d=[...DL()].reverse().find(d=>hit(d,x,y));SELD=d||null;if(d)DRG={d,i:-1,o:un(x,y),c:clone(d.p)};dpe();dsel()}
function dMove(e){const[x,y]=xy(e);MOD=[e.shiftKey,e.ctrlKey||e.metaKey];
if(DRAFT&&DRAFT.t==="brush"&&TOOL==="brush"){const p=snapP(x,y);if(p.t!=null&&p.y!=null)DRAFT.p.push(p);return}
dPos(x,y)}
function dPos(x,y){MX=[x,y];
if(DRAFT&&DRAFT.p.length>1){DRAFT.p[1]=ptAt(x,y,DRAFT.p[0],DRAFT.t);fixPos(DRAFT);if(Math.hypot(x-DRAFT.x0,y-DRAFT.y0)>8)DRAFT.mv=1}
if(DRG){const d=DRG.d,p=DRG.i>=0&&d.p.length===2?ptAt(x,y,d.p[1-DRG.i],d.t):snapP(x,y);
if(DRG.i>=0){d.p[DRG.i]=p;if(d.t==="long"||d.t==="short"){if(DRG.i===1)d.p[2]={t:p.t,y:d.p[2].y};if(DRG.i===2)d.p[2]={t:d.p[1].t,y:p.y}}}
else{const u=un(x,y),dt=u.t-DRG.o.t,dy=u.y-DRG.o.y;d.p=DRG.c.map(q=>({t:q.t+dt,y:q.y+dy}))}}}
function dUp(){if(DRAFT&&(DRAFT.mv||DRAFT.t==="brush"))dFin();if(DRG){DRG=null;save()}}
function initDraw(a,T,st){G={a,st,tt:a.map((_,i)=>T(i))};if(SELD&&!DL().includes(SELD))SELD=null;DRAFT=null;DRG=null;
const host=document.getElementById("cv"),cv=document.createElement("canvas");cv.id="dc";cv.style.cssText="position:absolute;left:0;top:0;width:100%;height:100%;z-index:6;touch-action:none";host.appendChild(cv);
cv.onpointerdown=dDown;cv.onpointermove=dMove;cv.onpointerup=dUp;
// touch goes through the pointer handlers above (touch-action:none); separate touch handlers made one tap count twice
cv.addEventListener("pointercancel",dUp);
cv.oncontextmenu=e=>{e.preventDefault();if(LOCKD){TOOL="cross";DRAFT=null;tbRef()}};
host.addEventListener("pointerdown",e=>{host._d=[e.clientX,e.clientY]},true);
host.addEventListener("pointerup",e=>{if(!host._d||TOOL!=="cross"||LOCKD||HIDD||Math.hypot(e.clientX-host._d[0],e.clientY-host._d[1])>5)return;
const r=host.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,d=[...DL()].reverse().find(d=>hit(d,x,y));if(d&&d!==SELD){SELD=d;dpe();dsel()}});
dpe();dsel();const my=ch;(function f(){if(ch!==my||!document.getElementById("dc"))return;paint();requestAnimationFrame(f)})()}
const kmod=e=>{const m=[e.shiftKey,e.ctrlKey||e.metaKey];if(m[0]!==MOD[0]||m[1]!==MOD[1]){MOD=m;if(MX&&(DRAFT||DRG))dPos(MX[0],MX[1])}};
document.addEventListener("click",e=>{if(!e.target.closest("#tfm")&&!e.target.closest(".tfb")){const m=document.getElementById("tfm");if(m)m.style.display="none"}if(!e.target.closest("#snapdrop")&&!e.target.closest('[onclick^="snapMenu"]')){const sd=document.getElementById("snapdrop");if(sd)sd.style.display="none"}if(!e.target.closest("#vt_chmore")&&!e.target.closest("#vt_chmore_btn")){const cm=document.getElementById("vt_chmore");if(cm)cm.style.display="none"}if(!e.target.closest("#vt_draw_flyout")&&!e.target.closest(".vt-rail-fly")){vtCloseDrawFlyout()}if(!e.target.closest(".vt-ctype-menu")&&!e.target.closest(".vt-ctype-btn")){document.querySelectorAll(".vt-ctype-menu").forEach(x=>x.style.display="none");document.querySelectorAll(".vt-ctype-btn").forEach(b=>b.setAttribute("aria-expanded","false"))}});
let TFBUF="";
function tfUnitName(u){return{s:"second",m:"minute",H:"hour",D:"day",W:"week",M:"month"}[u]||"minute"}
function tfShow(){
  const label=tfFromType(TFBUF);
  let preview="";
  if(label){const m=label.match(/^(\d+)([smHDWM])$/);if(m)preview=m[1]+" "+tfUnitName(m[2])+(+m[1]>1?"s":"")}
  let h=document.getElementById("tfpop");
  if(!h){h=document.createElement("div");h.id="tfpop";h.style.cssText="position:absolute;bottom:40px;left:50%;transform:translateX(-50%);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px 16px;z-index:30;box-shadow:0 4px 16px rgba(0,0,0,.25);text-align:center;min-width:140px";
  const cv=document.getElementById("cv");if(cv&&cv.parentElement)cv.parentElement.appendChild(h);else document.body.appendChild(h)}
  h.innerHTML=`<div style="font-weight:600;margin-bottom:6px">Change interval</div><input id="tf_in" value="${TFBUF}" style="font-size:18px;text-align:center;padding:8px;width:100px;border:2px solid var(--acc);border-radius:6px" oninput="TFBUF=this.value;tfPrev()" onkeydown="if(event.key==='Enter')tfConfirm();if(event.key==='Escape')tfCancel()"><div id="tf_prev" class="mut" style="margin-top:4px;font-size:13px">${preview}</div>`;
  h.style.display="block";
  setTimeout(()=>{const i=document.getElementById("tf_in");if(i){i.focus();i.setSelectionRange(i.value.length,i.value.length)}},30);
}
function tfCancel(){TFBUF="";const h=document.getElementById("tfpop");if(h)h.style.display="none"}
function tfConfirm(){const label=tfFromType(TFBUF);tfCancel();if(label)tfGo(label)}
function tfPrev(){const label=tfFromType(TFBUF);const el=document.getElementById("tf_prev");if(!el)return;if(label){const m=label.match(/^(\d+)([smHDWM])$/);el.textContent=m?m[1]+" "+tfUnitName(m[2])+(+m[1]>1?"s":""):""}else el.textContent=""}
function tfFromType(s){
  s=(s||"").trim();if(!s)return null;
  const m=s.match(/^(\d+)\s*([smhdMwW])?$/i);
  if(!m)return null;
  const n=+m[1];
  let unit="m";
  if(m[2]){const c=m[2].toLowerCase();if(m[2]==="M")unit="M";else{const map={s:"s",m:"m",h:"H",d:"D",w:"W"};unit=map[c]||"m"}}
  return n+unit;
}
function tfGo(label){
  if(!label)return;
  if(TFS.includes(label)||(S.tfCustom||[]).some(c=>c.label===label)){tfPick(label);return}
  const m=label.match(/^(\d+)([smHDWM])$/);
  if(!m)return;
  const n=+m[1],u=m[2];
  S.tfCustom=S.tfCustom||[];
  if(!S.tfCustom.find(c=>c.label===label))S.tfCustom.push({n,u,label});
  if(!S.tfFav.includes(label))S.tfFav.push(label);
  const mult={s:1,m:60,H:3600,D:86400,W:604800,M:2592000};
  STEP[label]=n*(mult[u]||60);INT[label]=label;TS[label]=TS[label]||0.5;
  save();tfPick(label);
}
let SYBUF="";
document.addEventListener("keydown",e=>{if(/INPUT|SELECT|TEXTAREA/.test((document.activeElement||{}).tagName||"")||MD.innerHTML)return;
if(!chartOnPage())return; // chart shortcuts only where a chart is on screen
const ctrl=e.ctrlKey||e.metaKey,alt=e.altKey,sh=e.shiftKey;
// Ctrl+K: the global command palette (src/vt_14_command_palette.js) captures it first; this is a fallback
if(ctrl&&!alt&&e.key.toLowerCase()==="k"){e.preventDefault();if(typeof syOpen==="function")syOpen();return}
// start interval popup on first digit
if(!ctrl&&!alt&&/^[0-9]$/.test(e.key)){TFBUF=e.key;tfShow();return}
// start symbol search on first letter
if(!ctrl&&!alt&&/^[a-zA-Z]$/.test(e.key)){SYBUF=e.key.toUpperCase();syShow();return}
// Undo / Redo
if(ctrl&&e.key==="z"&&!sh){e.preventDefault();doUndo();return}
if(ctrl&&(e.key==="y"||(e.key==="z"&&sh))){e.preventDefault();doRedo();return}
// Save
if(ctrl&&e.key==="s"){e.preventDefault();save();return}
// Hide all drawings
if(ctrl&&alt&&(e.key==="h"||e.key==="H")){e.preventDefault();HIDD=!HIDD;tbRef();return}
// Drawing tool shortcuts
if(alt&&!ctrl){
  const map={t:"trend",h:"hline",v:"vline",f:"fib",r:"rect",a:"arrow",n:"note"};
  if(map[e.key.toLowerCase()]){e.preventDefault();setTool(map[e.key.toLowerCase()]);return}
}
// Escape
if(e.key==="Escape"){DRAFT=null;setTool("cross");return}
// Delete selected
if((e.key==="Delete"||e.key==="Backspace")&&SELD){e.preventDefault();delSel();return}
// Arrow Left/Right pan the chart; Up/Down are reserved for symbol navigation
if((e.key==="ArrowLeft"||e.key==="ArrowRight")&&ch){
  e.preventDefault();
  const ts=ch.timeScale(),r=ts.getVisibleLogicalRange();
  if(!r)return;
  const step=(r.to-r.from)*(ctrl?0.2:0.05)*(e.key==="ArrowLeft"?-1:1);
  ts.setVisibleLogicalRange({from:r.from+step,to:r.to+step});
  return
}
});
function drawSetM(tab){
  if(!SELD)return;
  const d=SELD,t=d.t||"trend";
  const o=(arr,v)=>arr.map(([k,n])=>`<option value="${k}" ${String(v)===String(k)?"selected":""}>${n}</option>`).join("");
  const tabs=[["style","Style"],["text","Text"],["coords","Coordinates"],["vis","Visibility"]];
  const isPos=t==="long"||t==="short";
  const styleTab=`<div class="tp" data-t="style">
${isPos?`<label>Target colour${colorPicker("ds_tc",d.targetCol||"#089981")}</label>
<label>Stop colour${colorPicker("ds_sc",d.stopCol||"#f23645")}</label>`:`<label>Tool colour${colorPicker("ds_c",d.c||"#2962ff")}</label>`}
<label>Text colour${colorPicker("ds_txc",d.txtCol||"#787b86")}</label>
<label>Line type<select id="ds_s" onchange="SELD.s=+this.value">${LSTYLES.map((st,i)=>`<option value="${i}" ${i==(d.s||0)?"selected":""}>${st.n}</option>`).join("")}</select></label>
<label>Line width<select id="ds_w" onchange="SELD.w=+this.value">${[1,2,3,4].map(w=>`<option value="${w}" ${w==(d.w||2)?"selected":""}>${w}</option>`).join("")}</select></label></div>`;
  const textTab=`<div class="tp" data-t="text"><div class="row">${colorPicker("ds_tc",d.txtCol||d.c||"#2962ff")}<select id="ds_ts" onchange="SELD.txtSize=+this.value">${[10,12,14,16,18,20,24].map(s=>`<option ${s==(d.txtSize||12)?"selected":""}>${s}</option>`).join("")}</select><button type="button" id="ds_tb" class="${d.txtBold?"on":""}" onclick="this.classList.toggle('on');SELD.txtBold=this.classList.contains('on')">B</button><button type="button" id="ds_ti" class="${d.txtItalic?"on":""}" onclick="this.classList.toggle('on');SELD.txtItalic=this.classList.contains('on')">I</button></div>
<textarea id="ds_txt" rows="4" placeholder="Add text" oninput="SELD.txt=this.value">${d.txt||""}</textarea>
<div class="row"><span>Text alignment</span><select id="ds_va" onchange="SELD.txtVA=this.value">${o([["top","Top"],["middle","Middle"],["bottom","Bottom"]],d.txtVA||"top")}</select><select id="ds_ha" onchange="SELD.txtHA=this.value">${o([["left","Left"],["center","Center"],["right","Right"]],d.txtHA||"right")}</select></div></div>`;
  const coordsTab=`<div class="tp" data-t="coords"><p class="mut">Points (price)</p>${(d.p||[]).map((p,i)=>`<label>Point ${i+1}<input type="number" step="any" value="${p.y}" readonly></label>`).join("")}</div>`;
  const visTab=`<div class="tp" data-t="vis"><label class="chk"><input type="checkbox" id="ds_vis" ${d.hide?"":"checked"}>Visible on chart</label></div>`;
  modal(`<h3>${DT[t]||"Drawing"}</h3><div class="tabs">${tabs.map(([k,n])=>`<button data-t="${k}" onclick="swTab('${k}')">${n}</button>`).join("")}</div>${styleTab}${textTab}${coordsTab}${visTab}<div class="row"><span class="sp"></span><button onclick="closeM()">Cancel</button><button class="pri" onclick="save();closeM()">Ok</button></div>`);
  swTab(typeof tab==="string"?tab:"text");
}
function drawSetSave(){
  if(!SELD)return;
  const g=id=>document.getElementById(id);
  SELD.c=g("ds_c").value;
  SELD.s=+g("ds_s").value;
  SELD.w=+g("ds_w").value;
  SELD.txt=g("ds_txt").value.trim();
  SELD.txtCol=g("ds_tc").value;
  SELD.txtSize=+g("ds_ts").value||12;
  SELD.txtBold=g("ds_tb").classList.contains("on");
  SELD.txtItalic=g("ds_ti").classList.contains("on");
  SELD.txtVA=g("ds_va").value;
  SELD.txtHA=g("ds_ha").value;
  SELD.hide=!g("ds_vis").checked;
  save();closeM();dsel();
}
function setM(tab){const C=S.chart,p=pal();
const o=(arr,v)=>arr.map(([k,n])=>`<option value="${k}" ${String(v)===String(k)?"selected":""}>${n}</option>`).join("");
const ck=(k,l)=>`<label class="chk"><input type="checkbox" data-c="${k}" ${C[k]?"checked":""}>${l}</label>`;
const co=(k,d)=>colorPicker(k,C[k]||d||"#000000");
const sl=(k,l,arr)=>`<label>${l}<select data-c="${k}">${o(arr,C[k])}</select></label>`;
const nu=(k,l,mn,mx,st)=>`<label>${l}<input type="number" data-c="${k}" min="${mn}" max="${mx}" step="${st}" value="${C[k]}"></label>`;
const cr=(c,l,a,b)=>`<div class="csr">${c?ck(c,l):`<span>${l}</span>`}<span class="sp"></span>${a}${b||""}</div>`;
const tp=(t,h)=>`<div class="tp" data-t="${t}" style="display:none">${h}</div>`;
const sec=s=>`<div class="mut" style="margin:12px 0 6px;font-size:11px;font-weight:600;letter-spacing:.04em">${s}</div>`;
modal(`<h3>Settings</h3><div class="tabs">${[["sym","Symbol"],["status","Status line"],["scales","Scales and lines"],["can","Canvas"],["feat","Features"],["ui","Interface"]].map(([t,n])=>`<button data-t="${t}" onclick="swTab('${t}')">${n}</button>`).join("")}</div>`
+tp("sym",sec("CANDLES")
+ck("colorPrev","Color bars based on previous close")
+cr("showBody","Body",co("upBody"),co("dnBody"))
+cr("showBorder","Borders",co("upBorder"),co("dnBorder"))
+cr("showWick","Wick",co("upWick"),co("dnWick"))
+sec("DATA MODIFICATION")
+sl("tz","Timezone",[["ny","(UTC-5) New York"],["utc","UTC"],["lon","(UTC+0) London"],["par","(UTC+1) Paris"],["ber","(UTC+1) Berlin"],["tok","(UTC+9) Tokyo"],["sha","(UTC+8) Shanghai"],["sgp","(UTC+8) Singapore"],["hkg","(UTC+8) Hong Kong"],["syd","(UTC+10) Sydney"],["dub","(UTC+4) Dubai"],["mos","(UTC+3) Moscow"],["sao","(UTC-3) São Paulo"],["chi","(UTC-6) Chicago"],["den","(UTC-7) Denver"],["la","(UTC-8) Los Angeles"]])
+cr(0,"Time colour",co("timeCol","#131722")))
+tp("status",sec("INSTRUMENT")
+ck("showMktStatus","Open market status")
+ck("showVol","Volume")
+sec("INDICATORS")
+ck("indTitles","Indicator titles"))
+tp("scales",sl("scalePlace","Scales placement",[["auto","Auto"],["left","Left"],["right","Right"]])
+sl("scMode","Price scale",[["0","Regular"],["1","Logarithmic"],["2","Percent"],["3","Indexed to 100"]])
+ck("scAuto","Auto scale")
+ck("scInv","Invert scale")
+ck("plusBtn","Plus button")
+sec("TIME SCALE")
+ck("dowLabels","Day of week on labels")
+sl("dateFmt","Date format",[["dmy","Mon 29 Sep '97"],["mdy","Sep 29, 1997"],["iso","1997-09-29"]])
+sl("timeFmt","Time hours format",[["24","24-hours"],["12","12-hours"]]))
+tp("can",sec("CHART BASIC STYLES")
+sl("bg","Background",[["auto","Match app theme"],["dark","Dark"],["light","Light"],["custom","Custom"]])
+cr(0,"Custom background",co("bgCol"))
+cr("showGridV","Vertical grid lines",co("gridV",p.gr))
+cr("showGridH","Horizontal grid lines",co("gridH",p.gr))
+cr(0,"Crosshair",co("xhCol",p.tx))
+sl("xhStyle","Crosshair style",[[0,"Solid"],[1,"Dotted"],[2,"Dashed"],[3,"Large dashed"],[4,"Sparse dotted"]])
+sl("wm","Watermark",[["hide","Hidden"],["show","Visible"]])
+sec("SCALES")
+cr(0,"Text",co("txtCol",p.tx))
+nu("fs","Text size",8,20,1)
+sec("BUTTONS")
+sl("navBtn","Navigation",[["hover","Visible on mouse over"],["always","Always visible"],["hide","Hidden"]])
+sl("paneBtn","Pane",[["hover","Visible on mouse over"],["always","Always visible"],["hide","Hidden"]]))
+tp("feat",sec("SNAPSHOT")+ck("snapInd","Show indicators in snapshot"))
+tp("ui",`<div class="mut" style="margin-bottom:8px">Keyboard shortcuts</div>
<table style="width:100%;font-size:13px;border-collapse:collapse">
<tr><td style="padding:4px 8px 4px 0;color:var(--mut)">Undo</td><td><kbd>Ctrl</kbd>+<kbd>Z</kbd></td></tr>
<tr><td style="padding:4px 8px 4px 0;color:var(--mut)">Redo</td><td><kbd>Ctrl</kbd>+<kbd>Y</kbd></td></tr>
<tr><td style="padding:4px 8px 4px 0;color:var(--mut)">Save</td><td><kbd>Ctrl</kbd>+<kbd>S</kbd></td></tr>
<tr><td style="padding:4px 8px 4px 0;color:var(--mut)">Hide all drawings</td><td><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd></td></tr>
<tr><td style="padding:4px 8px 4px 0;color:var(--mut)">Trend line</td><td><kbd>Alt</kbd>+<kbd>T</kbd></td></tr>
<tr><td style="padding:4px 8px 4px 0;color:var(--mut)">Horizontal line</td><td><kbd>Alt</kbd>+<kbd>H</kbd></td></tr>
<tr><td style="padding:4px 8px 4px 0;color:var(--mut)">Vertical line</td><td><kbd>Alt</kbd>+<kbd>V</kbd></td></tr>
<tr><td style="padding:4px 8px 4px 0;color:var(--mut)">Fib retracement</td><td><kbd>Alt</kbd>+<kbd>F</kbd></td></tr>
<tr><td style="padding:4px 8px 4px 0;color:var(--mut)">Cancel / crosshair</td><td><kbd>Esc</kbd></td></tr>
<tr><td style="padding:4px 8px 4px 0;color:var(--mut)">Delete selected</td><td><kbd>Delete</kbd></td></tr>
<tr><td style="padding:4px 8px 4px 0;color:var(--mut)">Previous / next symbol</td><td>Up / Down</td></tr>
<tr><td style="padding:4px 8px 4px 0;color:var(--mut)">Pan chart</td><td>Left / Right</td></tr>
</table>`)
+`<div class="row"><button onclick="setReset()">Reset</button><span class="sp"></span><button onclick="closeM()">Cancel</button><button class="pri" onclick="setSave()">Ok</button></div>`);
swTab(typeof tab==="string"?tab:"sym")}
function swTab(t){MD.querySelectorAll(".tp").forEach(e=>e.style.display=e.dataset.t===t?"flex":"none");MD.querySelectorAll(".tabs button").forEach(b=>b.classList.toggle("on",b.dataset.t===t))}
function setReset(){const C=S.chart;S.chart=Object.assign(clone(CH0),{sym:C.sym,tf:C.tf,ind:C.ind});save();closeM();drawChart()}
function setSave(){const C=S.chart;MD.querySelectorAll("[data-c]").forEach(el=>{const k=el.dataset.c;
if(el.type==="checkbox")C[k]=el.checked;
else if(el.type==="color")C[k]=el.value;
else if(typeof C[k]==="number")C[k]=parseFloat(el.value)||0;
else C[k]=el.value});
save();closeM();drawChart()}
function indM(tab){const C=S.chart;tab=tab||"tech";
S.indFav=S.indFav||[];
const fav=S.indFav,scripts=S.indScripts||[];
const sidebar=`<div class="vt-indside" style="width:160px;border-right:1px solid var(--line);padding-right:12px">
<div style="font-size:11px;color:var(--mut);margin:8px 0">PERSONAL</div>
<div style="padding:6px 8px;cursor:pointer;border-radius:4px;display:flex;align-items:center;gap:6px;${tab==="fav"?"background:var(--card)":""}" onclick="indM('fav')">${VT_IC.starOn}<span>Favorites</span></div>
<div style="padding:6px 8px;cursor:pointer;border-radius:4px;display:flex;align-items:center;gap:6px;${tab==="scripts"?"background:var(--card)":""}" onclick="indM('scripts')">${VT_IC.user}<span>My scripts</span></div>
<div style="font-size:11px;color:var(--mut);margin:12px 0 8px">BUILT-IN</div>
<div style="padding:6px 8px;cursor:pointer;border-radius:4px;display:flex;align-items:center;gap:6px;${tab==="tech"?"background:var(--card)":""}" onclick="indM('tech')">${VT_IC.chart}<span>Technicals</span></div>
</div>`;
let list="";
if(tab==="fav"){
  list=fav.length?fav.map(k=>`<div class="li" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)"><span>${IND[k]||k}</span><span><button onclick="document.getElementById('in_t').value='${k}';addInd()" style="background:#2962ff;color:#fff;border:none;padding:2px 8px;border-radius:4px;cursor:pointer">Add</button><button data-act="fav" class="on" aria-pressed="true" aria-label="Remove ${esc(IND[k]||k)} from favourites" onclick="togFav('${k}')" style="background:none;border:none;cursor:pointer;margin-left:4px">${VT_IC.starOn}</button></span></div>`).join(""):`<p class="mut">No favourites yet. Click the star next to an indicator.</p>`;
}else if(tab==="scripts"){
  list=`<div class="li" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)"><span>Vektor Indicator</span><button onclick="addVektorIndi();closeM()" style="background:#2962ff;color:#fff;border:none;padding:2px 8px;border-radius:4px;cursor:pointer">Add</button></div>`;
  list+=scripts.length?scripts.map(s=>`<div class="li" style="padding:8px 0;border-bottom:1px solid var(--line)">${s.name}</div>`).join(""):"";
}else{
  list=Object.keys(IND).map(k=>`<div class="li" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)"><span>${IND[k]}</span><span><button onclick="document.getElementById('in_t').value='${k}';addInd()" style="background:#2962ff;color:#fff;border:none;padding:2px 8px;border-radius:4px;cursor:pointer">Add</button><button data-act="fav" class="${fav.includes(k)?"on":""}" aria-pressed="${fav.includes(k)}" aria-label="${fav.includes(k)?"Remove ":"Add "}${esc(IND[k])}${fav.includes(k)?" from":" to"} favourites" onclick="togFav('${k}')" style="background:none;border:none;cursor:pointer;margin-left:4px">${fav.includes(k)?VT_IC.starOn:VT_IC.starOff}</button></span></div>`).join("");
}
modal(`<h3>Indicators</h3>
<div class="vt-indflex" style="display:flex;gap:16px">
${sidebar}
<div style="flex:1;min-width:0">
<input type="search" placeholder="Search" style="width:100%;margin-bottom:12px" oninput="indSearch(this.value)">
<div id="indlist" class="list" style="max-height:300px;overflow-y:auto">${list}</div>
<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
<div class="mut" style="margin-bottom:8px">Active (${C.ind.length})</div>
${C.ind.length?C.ind.map(d=>`<div class="li" style="display:flex;justify-content:space-between;align-items:center;padding:4px 0"><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${d.col}"></i> ${IL(d)}</span><span><button data-act="settings" aria-label="Settings for ${esc(IL(d))}" onclick="editInd('${d.id}')" style="background:none;border:none;cursor:pointer">${VT_IC.gear}</button><button data-act="remove" aria-label="Remove ${esc(IL(d))}" onclick="rmInd('${d.id}')" style="background:none;border:none;cursor:pointer;color:#f23645">${VT_IC.x}</button></span></div>`).join(""):`<p class="mut">None added.</p>`}
</div>
</div>
</div>
<select id="in_t" style="display:none">${Object.keys(IND).map(k=>`<option value="${k}">${IND[k]}</option>`).join("")}</select>
<input id="in_l" type="hidden" value="20"><input id="in_c" type="hidden" value="#f97316">
<div class="row"><span class="sp"></span><button class="pri" onclick="closeM()">Done</button></div>`)}
function togFav(k){S.indFav=S.indFav||[];const i=S.indFav.indexOf(k);if(i>=0)S.indFav.splice(i,1);else S.indFav.push(k);save();indM()}
function indSearch(q){const list=document.getElementById("indlist");if(!list)return;const items=list.querySelectorAll(".li");items.forEach(el=>{el.style.display=el.textContent.toLowerCase().includes(q.toLowerCase())?"":"none"})}
function addInd(){const g=i=>document.getElementById(i).value;S.chart.ind.push({id:"i"+Date.now(),t:g("in_t"),len:Math.max(2,Math.min(200,parseInt(g("in_l"))||20)),col:g("in_c")});save();drawChart();indM()}
function rmInd(id){S.chart.ind=S.chart.ind.filter(d=>d.id!==id);save();drawChart();indM()}
function togInd(id){const d=S.chart.ind.find(x=>x.id===id);if(d){d.hidden=!d.hidden;save();drawChart()}}
function togIndStack(){S.chart.indCollapsed=!S.chart.indCollapsed;save();const leg=document.getElementById("vt_ind_legend"),btn=document.getElementById("vt_ind_tog");if(leg&&btn){const col=!!S.chart.indCollapsed;leg.classList.toggle("collapsed",col);btn.setAttribute("aria-expanded",String(!col));btn.setAttribute("aria-label",(col?"Expand ":"Collapse ")+S.chart.ind.length+" chart indicators");btn.title=(col?"Show":"Collapse")+" indicators ("+S.chart.ind.length+")";btn.innerHTML=`<span class="vt-ind-cnt">${S.chart.ind.length}</span>`+(col?VT_IC.chevDown:VT_IC.up)}else drawChart()}
function editInd(id){const d=S.chart.ind.find(x=>x.id===id);if(!d)return;modal(`<h3>${IND[d.t]||d.t} settings</h3><input type="hidden" id="ed_id" value="${id}"><div class="row"><label>Length<input type="number" id="ed_len" value="${d.len||20}" min="2" max="200" style="width:80px" oninput="const d=S.chart.ind.find(x=>x.id==='${id}');if(d)d.len=+this.value;drawChart()"></label><label>Width<select id="ed_w" onchange="const d=S.chart.ind.find(x=>x.id==='${id}');if(d){d.w=+this.value;drawChart()}">${[1,2,3,4].map(w=>`<option ${w==(d.w||2)?"selected":""}>${w}</option>`).join("")}</select></label><label>Colour${colorPicker("ed_col",d.col)}</label></div><div class="row"><span class="sp"></span><button onclick="closeM()">Done</button></div>`)}
// Symbol search functions are defined in 95_symbol_search.js below
const LIVE={},LT={},ERR={},PEND={};
const ttl=k=>/\|(1D|1W|1M)$/.test(k)?216e5:9e5;
const safe=f=>{try{const x=f();return x===true||x===false?x:Number.isFinite(x)?x:null}catch(e){return null}};

const FXW=[["EUR/USD","FX","FX:EURUSD"],["GBP/USD","FX","FX:GBPUSD"],["USD/JPY","FX","FX:USDJPY"],["USD/CHF","FX","FX:USDCHF"],["AUD/USD","FX","FX:AUDUSD"],["USD/CAD","FX","FX:USDCAD"],["NZD/USD","FX","FX:NZDUSD"],["EUR/GBP","FX","FX:EURGBP"],["EUR/JPY","FX","FX:EURJPY"],["EUR/CHF","FX","FX:EURCHF"],["EUR/AUD","FX","FX:EURAUD"],["EUR/CAD","FX","FX:EURCAD"],["EUR/NZD","FX","FX:EURNZD"],["GBP/JPY","FX","FX:GBPJPY"],["GBP/CHF","FX","FX:GBPCHF"],["GBP/AUD","FX","FX:GBPAUD"],["GBP/CAD","FX","FX:GBPCAD"],["GBP/NZD","FX","FX:GBPNZD"],["AUD/JPY","FX","FX:AUDJPY"],["AUD/CHF","FX","FX:AUDCHF"],["AUD/CAD","FX","FX:AUDCAD"],["AUD/NZD","FX","FX:AUDNZD"],["CAD/JPY","FX","FX:CADJPY"],["CAD/CHF","FX","FX:CADCHF"],["CHF/JPY","FX","FX:CHFJPY"],["NZD/JPY","FX","FX:NZDJPY"],["NZD/CHF","FX","FX:NZDCHF"],["NZD/CAD","FX","FX:NZDCAD"],["USD/MXN","FX","FX:USDMXN"],["USD/ZAR","FX","FX:USDZAR"],["USD/TRY","FX","FX:USDTRY"],["USD/SEK","FX","FX:USDSEK"],["USD/NOK","FX","FX:USDNOK"],["USD/DKK","FX","FX:USDDKK"],["USD/PLN","FX","FX:USDPLN"],["USD/HUF","FX","FX:USDHUF"],["USD/CZK","FX","FX:USDCZK"],["USD/SGD","FX","FX:USDSGD"],["USD/HKD","FX","FX:USDHKD"],["USD/CNH","FX","FX:USDCNH"],["USD/ILS","FX","FX:USDILS"],["EUR/SEK","FX","FX:EURSEK"],["EUR/NOK","FX","FX:EURNOK"],["EUR/PLN","FX","FX:EURPLN"],["EUR/TRY","FX","FX:EURTRY"],["EUR/HUF","FX","FX:EURHUF"],["XAU/USD","CFD","OANDA:XAUUSD"],["XAG/USD","CFD","OANDA:XAGUSD"]].map(([td,m,tv])=>({n:td.replace("/",""),m,td,tv}));
const isLive=()=>S.data.mode!=="sample";
const BN={list:[],loaded:false,busy:false,err:"",host:"",pause:0};
const FUT_TD_MAP={"NQ=F":"QQQ","ES=F":"SPY","YM=F":"DIA","RTY=F":"IWM","GC=F":"XAU/USD","SI=F":"XAG/USD","CL=F":"WTI/USD","NG=F":"NATGAS/USD","6E=F":"EUR/USD","6B=F":"GBP/USD","6J=F":"USD/JPY","6A=F":"AUD/USD","6C=F":"USD/CAD","6S=F":"USD/CHF","ZN=F":"TLT","ZB=F":"TLT","ZF=F":"IEF","ZT=F":"SHY","BZ=F":"BRENT/USD","HG=F":"COPPER/USD","PL=F":"XPT/USD","PA=F":"XPD/USD"};
const YFW=[...("ES NQ YM RTY CL BZ NG GC SI HG PL ZB ZN ZF ZT ZC ZS ZW KC SB CC CT 6E 6B 6J 6A 6C 6S").split(" ").map(n=>({n:n+"=F",m:"FUT",td:FUT_TD_MAP[n+"=F"]||"",tv:n+"1!"})),
...[["SPX","^GSPC","SP:SPX"],["NASDAQ","^IXIC","NASDAQ:IXIC"],["DJI","^DJI","DJ:DJI"],["RUT","^RUT","TVC:RUT"],["VIX","^VIX","TVC:VIX"],["FTSE","^FTSE","TVC:UKX"],["DAX","^GDAXI","XETR:DAX"],["CAC40","^FCHI","TVC:CAC40"],["STOXX50","^STOXX50E","TVC:SX5E"],["N225","^N225","TVC:NI225"],["HSI","^HSI","TVC:HSI"],["ASX200","^AXJO","ASX:XJO"],["KOSPI","^KS11","TVC:KOSPI"],["SENSEX","^BSESN","BSE:SENSEX"],["TSX","^GSPTSE","TSX:TSX"]].map(([n,td,tv])=>({n,m:"IDX",td,tv})),
...("AAPL MSFT NVDA AMZN GOOGL META TSLA AVGO BRK-B LLY JPM V UNH XOM MA COST HD PG JNJ ABBV NFLX BAC CRM ORCL CVX WMT KO MRK AMD PEP TMO ADBE LIN ACN MCD CSCO ABT DIS TXN WFC INTU QCOM GE IBM CAT AMGN VZ DHR PM AMAT NOW ISRG UBER GS BKNG SPGI RTX NEE LOW T HON UNP PFE AXP BLK ELV PLTR COP SYK TJX MU LRCX ADI BA COIN MSTR SMCI MARA RIOT SOFI HOOD SHOP SNOW CRWD PANW DDOG NET ARM ASML TSM BABA PDD F GM NIO RIVN LCID AAL DAL UAL CCL NCLH FCX NEM AMC GME RBLX U PYPL INTC MRVL ON ABNB DASH ROKU ZM").split(" ").map(n=>({n:n.replace("-",""),m:"STK",td:n,tv:""})),
...("SPY QQQ IWM DIA GLD SLV USO UNG TLT XLE XLF XLK XLV XLY XLP XLI XLU XLB ARKK SMH SOXL TQQQ SQQQ").split(" ").map(n=>({n,m:"ETF",td:n,tv:""}))];
let tk=0;const tick=()=>{if(!tk)tk=setTimeout(()=>{tk=0;render()},300)};
const fin=(s,tf)=>{const fd=LIVE[s[0]+"|"+tf];if(fd&&fd.length)checkAlerts(s[0],fd[fd.length-1].c);tick();if(S.chart.sym===s[0]&&S.chart.tf===tf)drawChart()};
const E=(m,soft)=>{const e=Error(m);e.soft=soft;return e};
