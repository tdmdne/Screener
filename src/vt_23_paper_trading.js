/* E-13 Paper trading on live data. The account (fills, margin, commission, SL/TP) runs in the hub (shared/paper.js);
   this module only sends {op:"paper"} actions over the one WS and renders the `paper` frames it gets back.
   Signed-in users keep their account (and SL/TP keep working) across tabs and with the app closed. */
const VT_PP={acct:null,lines:[],ws:null};
function vtPaperSend(msg){const ws=typeof VT_EDGE!=="undefined"&&VT_EDGE.ws;if(!ws||ws.readyState!==1){if(typeof toast==="function")toast("Not connected to the market feed yet");return false}
  ws.send(JSON.stringify(Object.assign({op:"paper"},msg)));return true}
function vtOnPaperFrame(msg){VT_PP.acct=msg.account||null;
  const e=msg.event;if(e&&e.closed&&typeof toast==="function"){const c=e.closed;toast("Paper "+c.side+" "+c.sym+" closed ("+(c.reason==="stop"?"stop loss":c.reason==="target"?"take profit":"manual")+"): "+(c.pnl>=0?"+":"")+c.pnl.toFixed(2))}
  vtPaperRender();vtPaperLines()}
function vtPpFmt(v){return v==null||!isFinite(v)?"–":(+v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
function vtPpEl(t,c,txt){const e=document.createElement(t);if(c)e.className=c;if(txt!=null)e.textContent=txt;return e}
function vtPaperRender(){
  const box=document.getElementById("dkpp");if(!box)return;box.replaceChildren();const a=VT_PP.acct;
  const sum=vtPpEl("div","pp-sum"),kv=(k,v,cls)=>{const d=vtPpEl("div","pp-kv");d.append(vtPpEl("span","mut",k),vtPpEl("b",cls||"",v));sum.append(d)};
  const sg=v=>v>0?"up":v<0?"dn":"";
  if(a){kv("Balance",vtPpFmt(a.balance));kv("Equity",vtPpFmt(a.equity),sg(a.upnl));kv("Free margin",vtPpFmt(a.freeMargin));kv("Realised",vtPpFmt(a.realized),sg(a.realized))}
  else sum.append(vtPpEl("div","dkx mut","Connecting to your paper account…"));
  // order ticket for the current chart symbol
  const t=vtPpEl("div","pp-ticket"),num=(id,ph,label)=>{const i=vtPpEl("input","pp-in");i.type="number";i.step="any";i.min="0";i.id=id;i.placeholder=ph;i.setAttribute("aria-label",label);return i};
  const q=num("pp_qty","Qty","Quantity"),sl=num("pp_sl","SL","Stop loss price"),tp=num("pp_tp","TP","Take profit price");q.value=String(S.ppQty||1);
  const go=side=>{const qty=+q.value;if(!(qty>0)){toast("Enter a quantity");return}S.ppQty=qty;save();vtPaperSend({action:"order",sym:S.chart.sym,side,qty,sl:sl.value===""?null:+sl.value,tp:tp.value===""?null:+tp.value})};
  const buy=vtPpEl("button","pp-buy","Buy");buy.type="button";buy.onclick=()=>go("long");const sell=vtPpEl("button","pp-sell","Sell");sell.type="button";sell.onclick=()=>go("short");
  t.append(vtPpEl("span","pp-sym",S.chart.sym),q,sl,tp,buy,sell);
  box.append(sum,t);
  if(a&&a.positions.length){const list=vtPpEl("div","pp-pos");
    for(const p of a.positions){const r=vtPpEl("div","pp-row");const x=vtPpEl("button","pp-x","×");x.type="button";x.title="Close position";x.setAttribute("aria-label","Close "+p.side+" "+p.sym);
      x.onclick=()=>vtPaperSend({action:"close",id:p.id});
      r.append(vtPpEl("span","pp-side "+(p.side==="long"?"up":"dn"),p.side==="long"?"L":"S"),vtPpEl("span","pp-s",p.sym+" "+p.qty+" @ "+p.entry),vtPpEl("b",sg(p.upnl),vtPpFmt(p.upnl)),x);list.append(r)}
    box.append(list)}
  const rs=vtPpEl("details","pp-reset"),smy=vtPpEl("summary",null,"Account settings");const bal=num("pp_bal","Balance","Starting balance"),lev=num("pp_lev","Leverage","Leverage"),cm=num("pp_cm","Comm %","Commission % per side");
  if(a){bal.value=String(a.settings.balance);lev.value=String(a.settings.leverage);cm.value=String(a.settings.commissionPct)}
  const rb=vtPpEl("button",null,"Reset account");rb.type="button";rb.onclick=()=>{if(!confirmReset())return;vtPaperSend({action:"reset",balance:+bal.value,leverage:+lev.value,commissionPct:+cm.value})};
  rs.append(smy,bal,lev,cm,rb);box.append(rs);
  if(a&&a.history.length){const h=vtPpEl("div","pp-hist mut",a.stats.trades+" closed trades · win rate "+a.stats.winRate.toFixed(0)+"%");box.append(h)}}
function confirmReset(){const b=document.querySelector("#dkpp .pp-reset button");if(b&&b.dataset.armed!=="1"){b.dataset.armed="1";b.textContent="Click again to reset";setTimeout(()=>{if(b.isConnected){b.dataset.armed="";b.textContent="Reset account"}},3000);return false}return true}
// entry / SL / TP price lines for open positions on the chart symbol (render only)
function vtPaperLines(){if(typeof MS==="undefined"||!MS||typeof MS.createPriceLine!=="function")return;
  for(const l of VT_PP.lines){try{l.s.removePriceLine(l.l)}catch(_e){}}VT_PP.lines=[];const a=VT_PP.acct;if(!a)return;
  for(const p of a.positions.filter(x=>x.sym===S.chart.sym)){const add=(price,color,title)=>{try{VT_PP.lines.push({s:MS,l:MS.createPriceLine({price,color,lineWidth:1,lineStyle:2,axisLabelVisible:true,title})})}catch(_e){}};
    add(p.entry,p.side==="long"?S.chart.upBody:S.chart.dnBody,"Paper "+p.side+" "+p.qty);if(p.sl)add(p.sl,"#f23645","SL");if(p.tp)add(p.tp,"#089981","TP")}}
(function(){
  if(typeof scDock==="function"){const b=scDock;scDock=function(){const r=b.apply(this,arguments);try{
    const body=document.querySelector("#dock .dkb");if(!body)return r;if(S.sc.secs.pp===undefined)S.sc.secs.pp=true;
    const sec=vtPpEl("div","dks"),hd=vtPpEl("div","dkt"),tb=vtPpEl("button","dktb");tb.type="button";tb.setAttribute("aria-expanded",String(!!S.sc.secs.pp));
    const ic=document.createElement("template");ic.innerHTML=S.sc.secs.pp?VT_IC.chevDown:VT_IC.chevRight;tb.append(ic.content,vtPpEl("span",null,"Paper trading"));tb.onclick=()=>scTogSec("pp");
    hd.append(tb);sec.append(hd);if(S.sc.secs.pp){const c=vtPpEl("div","dkpp");c.id="dkpp";sec.append(c)}
    body.prepend(sec);vtPaperRender()}catch(e){console.error(e)}return r}}
  // fetch the account on every (re)connect
  if(typeof vtSendWsViewNow==="function"){const b=vtSendWsViewNow;vtSendWsViewNow=function(){const r=b.apply(this,arguments);try{const ws=VT_EDGE.ws;if(ws&&ws.readyState===1&&ws!==VT_PP.ws){VT_PP.ws=ws;vtPaperSend({action:"get"})}}catch(_e){}return r}}
  if(typeof vtAfterDraw==="function"){const b=vtAfterDraw;vtAfterDraw=function(){const r=b.apply(this,arguments);VT_PP.lines=[];try{vtPaperLines();const t=document.querySelector("#dkpp .pp-sym");if(t)t.textContent=S.chart.sym}catch(_e){}return r}}
  if(typeof vtCmdStatic==="function"){const b=vtCmdStatic;vtCmdStatic=function(){const out=b.apply(this,arguments);
    out.push({g:"Action",l:"Paper trading panel",k:"paper trade demo account buy sell",run:()=>{if(!chartOnPage())go("chart");S.sc.secs.pp=true;S.sc.dock=true;save();scDock();const q=document.getElementById("pp_qty");if(q)q.focus()}});return out}}
})();
