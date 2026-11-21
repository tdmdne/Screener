/* Alerts are evaluated by the hub (AGENTS.md §0, Task 17 / A2-A3); the browser never checks prices.
   - Armed alerts are sent over the one WS as {op:"alerts"} (full replace) whenever they change or the socket reconnects.
     Signed-in sockets: the hub persists them and keeps them running with no tab open.
   - Hub `alert` frames mark one-shot alerts fired and show the toast / notification / sound (fireAlert).
   Alert records keep the existing shape {id,sym,price,dir,on,fired,msg} plus optional:
     line {t1,p1,t2,p2,ext}  (E-07 drawing alert)  · syms [..] + wl name + cond + pct (E-08 watchlist alert)
     conds [{cond,target}]    (E-09 extra AND conditions) · repeat (recurring) */
const VT_AL={key:"",ws:null,timer:0};
const VT_AL_DIR={above:"cross_up",below:"cross_down",cross:"cross"};
function vtAlertToServer(a){
  const d={id:String(a.id),mode:a.repeat?"recurring":"once",armedAt:+a.armedAt||+a.id||0};
  if(a.msg)d.message=String(a.msg).slice(0,256);
  if(Array.isArray(a.syms)){
    // follow the watchlist as it is now (symbols added/removed after the alert was created), falling back to the snapshot
    const G=S.wlx&&Array.isArray(S.wlx.groups)?S.wlx.groups:[],g=G.find(x=>x&&a.wlId!=null&&x.id===a.wlId)||G.find(x=>x&&a.wl&&x.name===a.wl)||null;
    const syms=g&&Array.isArray(g.syms)&&g.syms.length?g.syms:a.syms;
    d.syms=syms.slice(0,100);d.condition=a.cond||"pct_move";d.target=+a.pct;d.resetRefOnTrigger=true;}
  else{d.sym=a.sym;d.condition=a.cond||VT_AL_DIR[a.dir]||"cross";d.target=+a.price;
    if(a.line)d.line={t1:a.line.t1,p1:a.line.p1,t2:a.line.t2,p2:a.line.p2,ext:a.line.ext||"seg"}}
  if(Array.isArray(a.conds)&&a.conds.length)d.conds=a.conds.slice(0,4).map(c=>({condition:c.cond,target:+c.target}));
  return d}
function vtAlertDefs(){return(S.alerts||[]).filter(a=>a&&a.on!==false&&!a.fired).slice(0,40).map(vtAlertToServer)}
function vtAlertsSync(){try{
  const ws=typeof VT_EDGE!=="undefined"&&VT_EDGE.ws;if(!ws||ws.readyState!==1)return;
  const defs=vtAlertDefs(),key=JSON.stringify(defs);if(ws===VT_AL.ws&&key===VT_AL.key)return;
  ws.send(JSON.stringify({op:"alerts",alerts:defs}));VT_AL.ws=ws;VT_AL.key=key;
}catch(e){console.error("alerts sync:",e)}}
function vtAlertsSyncSoon(){clearTimeout(VT_AL.timer);VT_AL.timer=setTimeout(vtAlertsSync,250)}
// hub `alert` frame: {id, sym, condition, price, triggeredAt, message?}; a watchlist alert reports its own id + the symbol
function vtOnServerAlert(msg){
  const a=(S.alerts||[]).find(x=>String(x.id)===String(msg.id));
  const shown=a?Object.assign({},a,{sym:msg.sym||a.sym}):{id:msg.id,sym:msg.sym,price:msg.price,dir:"cross",msg:msg.message};
  if(a&&!a.repeat&&!Array.isArray(a.syms)){a.fired=true;save()}
  if(!shown.msg&&msg.message)shown.msg=msg.message;
  try{fireAlert(shown,msg.price)}catch(e){console.error(e)}
  if(document.querySelector("#modal h3")&&/Price Alerts/.test(document.querySelector("#modal h3").textContent)&&typeof alertsM==="function")alertsM();
}
(function(){
  if(typeof save==="function"){const b=save;save=function(){const r=b.apply(this,arguments);vtAlertsSyncSoon();return r}}
  // (re)connect: the view frame is sent on every open, so piggy-back the alert set on it
  if(typeof vtSendWsViewNow==="function"){const b=vtSendWsViewNow;vtSendWsViewNow=function(){const r=b.apply(this,arguments);vtAlertsSync();return r}}
})();
// ---------- E-07/E-08/E-09 UI ----------
const VT_AL_CONDS=[["above","Price ≥"],["below","Price ≤"],["pct_up","% up from now"],["pct_down","% down from now"]];
const VT_AL_WLCONDS=[["pct_up","Rises by %"],["pct_down","Falls by %"],["pct_move","Moves by % (either way)"]];
function vtAlDesc(a){
  const extra=Array.isArray(a.conds)&&a.conds.length?" AND "+a.conds.map(c=>((VT_AL_CONDS.find(x=>x[0]===c.cond)||[0,c.cond])[1])+" "+c.target).join(" AND "):"";
  if(Array.isArray(a.syms))return"Watchlist “"+(a.wl||"list")+"” ("+a.syms.length+" symbols): "+((VT_AL_WLCONDS.find(x=>x[0]===a.cond)||[0,a.cond])[1]).toLowerCase()+" "+a.pct+"%"+extra;
  if(a.line)return a.sym+" "+vtAlCond(a.dir).toLowerCase()+" "+(a.lineName||"trend line")+extra;
  return a.sym+" "+vtAlCond(a.dir).toLowerCase()+" "+a.price+extra}
function vtAlEl(tag,props,kids){const e=document.createElement(tag);Object.assign(e,props||{});for(const k of kids||[])e.append(k);return e}
function vtAlSelect(opts,cls,label){const s=vtAlEl("select",{className:cls});s.setAttribute("aria-label",label);for(const [v,t] of opts)s.append(vtAlEl("option",{value:v,textContent:t}));return s}
function vtAlCondRow(){const r=vtAlEl("div",{className:"row al-cond"});const n=vtAlEl("input",{type:"number",step:"any",className:"al-cv"});n.setAttribute("aria-label","Condition value");
  const x=vtAlEl("button",{type:"button",textContent:"×",title:"Remove condition"});x.setAttribute("aria-label","Remove condition");x.onclick=()=>r.remove();
  r.append(vtAlEl("span",{textContent:"AND",className:"mut"}),vtAlSelect(VT_AL_CONDS,"al-cs","Condition"),n,x);return r}
function vtAlReadConds(){return[...document.querySelectorAll("#modal .al-cond")].map(r=>({cond:r.querySelector(".al-cs").value,target:+r.querySelector(".al-cv").value})).filter(c=>c.target>0).slice(0,4)}
function vtAddWatchlistAlert(){
  const g=(S.wlx&&S.wlx.groups||[])[+document.getElementById("alw_g").value],cond=document.getElementById("alw_c").value,pct=+document.getElementById("alw_p").value;
  if(!g||!Array.isArray(g.syms)||!g.syms.length){toast("That watchlist is empty");return}
  if(!(pct>0)){toast("Enter a percentage above 0");return}
  S.alerts=S.alerts||[];S.alerts.push({id:Date.now(),wlId:g.id,wl:String(g.name||"Watchlist"),syms:g.syms.slice(0,100),cond,pct,on:true,fired:false,repeat:true});
  save();toast("Watchlist alert added ("+Math.min(100,g.syms.length)+" symbols)");alertsM()}
function vtAlertFromDrawing(d){
  if(!d||!Array.isArray(d.p)||d.p.length<2)return;
  const ext=d.t==="trend"||d.t==="chan"?"seg":d.t==="ray"?"ray":"line",mk=(p1,p2,name)=>({id:Date.now()+Math.floor(Math.random()*1000),sym:S.chart.sym,dir:"cross",price:+p1.y,
    line:{t1:p1.t,p1:+p1.y,t2:p2.t,p2:+p2.y,ext},lineName:name,drawId:d.id,on:true,fired:false});
  S.alerts=S.alerts||[];
  if(d.t==="chan"&&d.p[2]){ // both channel boundaries (the parallel is offset by the third point at the same times)
    const a=d.p[0],b=d.p[1],c=d.p[2],yOn=a.t===b.t?a.y:a.y+(b.y-a.y)*(c.t-a.t)/(b.t-a.t),off=c.y-yOn;
    S.alerts.push(mk(a,b,"channel line"));S.alerts.push(Object.assign(mk({t:a.t,y:a.y+off},{t:b.t,y:b.y+off},"channel line"),{id:Date.now()+1000+Math.floor(Math.random()*1000),line:{t1:a.t,p1:a.y+off,t2:b.t,p2:b.y+off,ext:"seg"}}));
  }else S.alerts.push(mk(d.p[0],d.p[1],"trend line"));
  save();toast("Alert set on the "+(d.t==="chan"?"channel (both lines)":"trend line"));
  if(typeof Notification!=="undefined"&&Notification.permission==="default")Notification.requestPermission()}
(function(){
  if(typeof dsel==="function"){const b=dsel;dsel=function(){const r=b.apply(this,arguments);try{
    const e=document.getElementById("dsel");if(e&&SELD&&/^(trend|ray|ext|chan)$/.test(SELD.t)&&SELD.p&&SELD.p.length>=2){
      const d=SELD,btn=vtAlEl("button",{type:"button",textContent:"Alert",title:"Alert when price crosses this "+(d.t==="chan"?"channel":"line")});btn.onclick=()=>vtAlertFromDrawing(d);
      e.insertBefore(btn,e.querySelector('button[title="Settings"]'))}}catch(_e){}return r}}
  if(typeof alertsM==="function"){const b=alertsM;alertsM=function(){const r=b.apply(this,arguments);try{
    const m=document.getElementById("modal"),btnRow=m&&m.querySelector("#al_dir")&&m.querySelector("#al_dir").closest("label").nextElementSibling;if(!btnRow)return r;
    const add=vtAlEl("button",{type:"button",textContent:"+ AND condition",className:"al-addc"});add.onclick=()=>{if(m.querySelectorAll(".al-cond").length<4)btnRow.before(vtAlCondRow())};
    btnRow.prepend(add);
    const groups=(S.wlx&&S.wlx.groups)||[];if(groups.length){
      const gs=vtAlSelect(groups.map((g,i)=>[String(i),(g.name||"Watchlist")+" ("+((g.syms||[]).length)+")"]),"","Watchlist");gs.id="alw_g";
      const cs=vtAlSelect(VT_AL_WLCONDS,"","Watchlist condition");cs.id="alw_c";const pc=vtAlEl("input",{type:"number",step:"any",min:"0",id:"alw_p",placeholder:"%"});pc.setAttribute("aria-label","Percent");
      const go=vtAlEl("button",{type:"button",textContent:"Add watchlist alert"});go.onclick=vtAddWatchlistAlert;
      const sec=vtAlEl("div",{className:"al-wl"},[vtAlEl("h4",{textContent:"Watchlist alert"}),vtAlEl("p",{className:"mut",textContent:"One alert for every symbol in a list; counts as one alert."}),vtAlEl("div",{className:"row"},[gs,cs,pc,go])]);
      btnRow.after(sec)}}catch(e){console.error(e)}return r}}
  if(typeof addAlert==="function"){const b=addAlert;addAlert=function(){const conds=vtAlReadConds(),n=(S.alerts||[]).length;const r=b.apply(this,arguments);
    if(conds.length&&(S.alerts||[]).length>n){S.alerts[S.alerts.length-1].conds=conds;save()}return r}}
})();
