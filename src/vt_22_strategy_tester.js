/* E-12 Strategy tester. Scripts declare entry_long/entry_short/exit_long/exit_short(cond); the backtest runs on the
   server (POST /api/vs/run -> shared/vs/strategy.js) and the browser only renders metrics, the trade list, CSV and
   chart markers. Strategy scripts are also checked on the server (the legacy in-browser engine does not know them). */
const VT_ST={last:null,busy:false};
const VT_ST_RE=/\b(entry|exit)_(long|short)\s*\(/;
const VT_ST_MAX_BARS=2500;
function vtStBars(){const s=symOf(S.chart.sym)||SYMS[0],a=(s&&candles(s,S.chart.tf))||[];
  return a.slice(-VT_ST_MAX_BARS).map(b=>({t:b.t,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v||0}))}
async function vtStServerRun(src,inp,strategy){
  const r=await fetch("/api/vs/run",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({src,bars:vtStBars(),inputs:inp||{},sym:S.chart.sym,tf:S.chart.tf,strategy:strategy||{}})});
  let j=null;try{j=await r.json()}catch(_e){}
  if(!j)throw new Error("The strategy service is unavailable. Try again shortly.");return j}
function vtStFmt(v,d){return v==null||!isFinite(v)?"–":(+v).toLocaleString(undefined,{minimumFractionDigits:d??2,maximumFractionDigits:d??2})}
function vtStRender(res){
  const host=document.getElementById("vs_st");if(!host)return;host.replaceChildren();
  const el=(t,c,txt)=>{const e=document.createElement(t);if(c)e.className=c;if(txt!=null)e.textContent=txt;return e};
  if(!res.ok){host.append(el("p","vsmsg err",res.error||"Strategy failed"));return}
  if(!res.strategy){host.append(el("p","vsmsg err","This script has no entry_long / entry_short / exit_long / exit_short signals."));return}
  const m=res.strategy.metrics,grid=el("div","st-grid");
  const cell=(k,v,cls)=>{const c=el("div","st-m"+(cls?" "+cls:""));c.append(el("span","mut",k),el("b",null,v));grid.append(c)};
  const sign=v=>v>0?"up":v<0?"dn":"";
  cell("Net profit",vtStFmt(m.netProfit)+" ("+vtStFmt(m.netProfitPct)+"%)",sign(m.netProfit));
  cell("Trades",String(m.totalTrades));cell("Win rate",vtStFmt(m.winRate,1)+"%");
  cell("Profit factor",m.profitFactor==null?"∞":vtStFmt(m.profitFactor));cell("Max drawdown",vtStFmt(m.maxDrawdown)+" ("+vtStFmt(m.maxDrawdownPct)+"%)","dn");
  cell("Avg trade",vtStFmt(m.avgTrade),sign(m.avgTrade));cell("Largest win",vtStFmt(m.largestWin),"up");cell("Largest loss",vtStFmt(m.largestLoss),"dn");
  cell("Open P&L",vtStFmt(m.openPnl),sign(m.openPnl));
  const bar=el("div","vsrow");const csv=el("button",null,"Export CSV");csv.type="button";csv.onclick=()=>vtStCsv(res.strategy.trades);
  const mk=el("button",null,"Show on chart");mk.type="button";mk.onclick=()=>{closeM();vtStMarkers(res.strategy.trades)};
  bar.append(el("span","mut",res.strategy.trades.length+" closed trades on "+S.chart.sym+" "+S.chart.tf+" (fills at next bar open)"),el("span","sp"),mk,csv);
  const wrap=el("div","st-tw"),tb=el("table","st-t"),hd=el("tr");for(const h of ["#","Side","Entry","Exit","P&L","%","Bars"])hd.append(el("th",null,h));
  const thead=el("thead");thead.append(hd);const tbody=el("tbody");const d=t=>t>1e9?new Date(t*1000).toISOString().slice(0,16).replace("T"," "):String(t);
  res.strategy.trades.slice(-200).forEach((t,i,arr)=>{const r=el("tr");r.append(el("td",null,String(res.strategy.trades.length-arr.length+i+1)),el("td",null,t.side),
    el("td",null,d(t.entryT)+" @ "+t.entryP),el("td",null,d(t.exitT)+" @ "+t.exitP),el("td",sign(t.pnl),vtStFmt(t.pnl)),el("td",sign(t.pnl),vtStFmt(t.pnlPct)),el("td",null,String(t.bars)));tbody.append(r)});
  tb.append(thead,tbody);wrap.append(tb);host.append(el("h4",null,"Strategy tester"),grid,bar,wrap)}
function vtStCsv(trades){
  const iso=t=>t>1e9?new Date(t*1000).toISOString():String(t);
  const lines=["trade,side,entry_time,entry_price,exit_time,exit_price,pnl,pnl_pct,bars,reason",...trades.map((t,i)=>[i+1,t.side,iso(t.entryT),t.entryP,iso(t.exitT),t.exitP,t.pnl,t.pnlPct,t.bars,t.reason].join(","))];
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([lines.join("\n")],{type:"text/csv"}));a.download="strategy-"+S.chart.sym+"-"+S.chart.tf+".csv";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function vtStMarkers(trades){if(typeof MS==="undefined"||!MS||typeof MS.setMarkers!=="function")return;const C=S.chart;
  const mk=[];for(const t of trades.slice(-300)){mk.push({time:t.entryT,position:t.side==="long"?"belowBar":"aboveBar",color:t.side==="long"?C.upBody:C.dnBody,shape:t.side==="long"?"arrowUp":"arrowDown",text:t.side==="long"?"L":"S"});
    mk.push({time:t.exitT,position:t.side==="long"?"aboveBar":"belowBar",color:"#787b86",shape:"circle",text:(t.pnl>=0?"+":"")+vtStFmt(t.pnl)})}
  mk.sort((a,b)=>a.time-b.time);try{MS.setMarkers(mk)}catch(e){console.error(e)}}
async function vtStRun(){
  const ta=document.getElementById("vs_src"),sc=typeof vsGet==="function"&&vsGet(VSUI.sel);if(!ta||!sc||VT_ST.busy)return;
  const host=document.getElementById("vs_st");if(host){host.replaceChildren();const p=document.createElement("p");p.className="mut";p.textContent="Running backtest on the server…";host.append(p)}
  VT_ST.busy=true;try{const qty=+(document.getElementById("st_qty")||{}).value||1,comm=+(document.getElementById("st_comm")||{}).value||0;
    VT_ST.last=await vtStServerRun(ta.value,sc.inp,{qty,commissionPct:comm});vtStRender(VT_ST.last)}
  catch(e){if(host){host.replaceChildren();const p=document.createElement("p");p.className="vsmsg err";p.textContent=e.message;host.append(p)}}finally{VT_ST.busy=false}}
(function(){
  if(typeof vsM==="function"){const b=vsM;vsM=function(){const r=b.apply(this,arguments);try{
    const chk=document.getElementById("vs_chk");if(chk&&!document.getElementById("vs_strat")){
      const btn=document.createElement("button");btn.type="button";btn.id="vs_strat";btn.textContent="Strategy tester";btn.title="Backtest entry_/exit_ signals on this chart (runs on the server)";btn.onclick=vtStRun;
      const qty=document.createElement("input");qty.type="number";qty.id="st_qty";qty.min="0";qty.step="any";qty.value="1";qty.className="st-in";qty.setAttribute("aria-label","Quantity per trade");qty.title="Quantity per trade";
      const cm=document.createElement("input");cm.type="number";cm.id="st_comm";cm.min="0";cm.step="0.01";cm.value="0";cm.className="st-in";cm.setAttribute("aria-label","Commission % per side");cm.title="Commission % per side";
      chk.after(btn,qty,cm);
      const st=document.createElement("div");st.id="vs_st";st.className="vs-st";const inp=document.getElementById("vs_inp");if(inp)inp.after(st)}}catch(e){console.error(e)}return r}}
  // strategy scripts are checked by the server engine (the in-browser one predates entry_/exit_)
  if(typeof vsCheck==="function"){const b=vsCheck;vsCheck=function(show){const ta=document.getElementById("vs_src");
    if(!ta||!VT_ST_RE.test(ta.value))return b.apply(this,arguments);
    const sc=typeof vsGet==="function"&&vsGet(VSUI.sel);
    vtStServerRun(ta.value,sc&&sc.inp,{}).then(j=>{if(j.ok)vsMsg("No errors. Strategy signals found"+(j.strategy?" ("+j.strategy.metrics.totalTrades+" trades on this chart)":"")+".",false);
      else vsMsg((j.line?"Line "+j.line+": ":"")+j.error+(j.hint?" "+j.hint:""),true)}).catch(e=>vsMsg(e.message,true));return true}}
  if(typeof vtCmdStatic==="function"){const b=vtCmdStatic;vtCmdStatic=function(){const out=b.apply(this,arguments);
    out.push({g:"Action",l:"Vektor Script editor / strategy tester",k:"pine script strategy backtest tester code",run:()=>{if(!chartOnPage())go("chart");if(typeof vsM==="function")vsM()}});return out}}
})();
