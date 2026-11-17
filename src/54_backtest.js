/* ---------- Manual Backtest Lab (Interactive Bar Replay) ----------
   Interactive paper-trading replay on historical candles: pick symbol, timeframe & start date/time,
   step backward/forward bar-by-bar or auto-play with speed controls, place manual Long/Short orders
   with Stop Loss & Take Profit, manage open positions, and track live equity, win rate, Avg R:R & trade log. */
const BT_IC={
  start:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="5" x2="6" y2="19"/><polygon points="19 5 9 12 19 19 19 5" fill="currentColor" stroke="none"/></svg>',
  back:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="16 5 6 12 16 19 16 5"/></svg>',
  play:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
  pause:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
  fwd:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 5 15 12 5 19 5 5" fill="currentColor" stroke="none"/><line x1="18" y1="5" x2="18" y2="19"/></svg>',
  end:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 5 15 12 5 19 5 5" fill="currentColor" stroke="none"/><line x1="19" y1="5" x2="19" y2="19"/></svg>'
};
const BT={D:null,sym:"",tf:"",loading:false,wait:0,ch:null,ser:null,plines:[],rp:{i:1,on:false,timer:0},ses:null,kbBound:false};

function btCfg(){
  if(!S.bt||typeof S.bt!=="object")S.bt={};
  const B=S.bt;
  const def={sym:(S.chart&&S.chart.sym)||"BTCUSDT",tf:"1H",bal:10000,riskPct:1,feePct:0.05,speed:2,bracket:"atr2",startAt:""};
  for(const k in def)if(B[k]==null||B[k]==="")B[k]=def[k];
  return B;
}
function btIso(t){
  const d=new Date(t*1000);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")+"T"+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
}
function btRound(px,ref){
  const p=Math.abs(ref||px||1);
  const dec=p<0.1?5:p<10?4:p<100?3:2;
  return Number(px.toFixed(dec));
}
function btNewSession(D,B,startIdx){
  const bars=D?D.a.length:0;
  const i=Math.max(1,Math.min(bars||1,startIdx||Math.max(1,Math.floor((bars||1)*0.5))));
  BT.ses={sym:B.sym,tf:B.tf,startBal:Math.max(1,+B.bal||10000),riskPct:Math.max(0.01,+B.riskPct||1),feePct:Math.max(0,+B.feePct||0),pos:null,trades:[],tradeSeq:0};
  BT.rp.i=i;
  BT.sym=B.sym;BT.tf=B.tf;
}
function btAtrAt(D,idx){
  if(!D||!D.a.length)return 0;
  const end=Math.max(1,Math.min(D.a.length,idx));
  const start=Math.max(1,end-14);
  let sum=0,cnt=0;
  for(let k=start;k<end;k++){
    const b=D.a[k],p=D.a[k-1];
    sum+=Math.max(b.h-b.l,Math.abs(b.h-p.c),Math.abs(b.l-p.c));cnt++;
  }
  return cnt?sum/cnt:(D.a[end-1].h-D.a[end-1].l)||D.a[end-1].c*0.01;
}
function btData(){
  const B=btCfg(),s=symOf(B.sym);
  if(!s||typeof vtBars!=="function")return null;
  return vtBars(s,B.tf);
}
function btFindStartIdx(D,isoStr){
  if(!D||!D.a.length)return 1;
  const n=D.a.length;
  if(!isoStr)return Math.max(1,Math.min(n,Math.floor(n*0.5)));
  const ms=Date.parse(isoStr);
  if(!isFinite(ms))return Math.max(1,Math.min(n,Math.floor(n*0.5)));
  const sec=ms/1000;
  let idx=D.a.findIndex(b=>b.t>=sec);
  if(idx<0)idx=n-1;
  return Math.max(Math.min(n,2),idx+1);
}
async function btFetchIfNeeded(sym,tf,fromSec,toSec){
  const s=symOf(sym);
  if(!s)return null;
  const k=s[0]+"|"+tf;
  let D=vtBars(s,tf);
  const needMore=!D||D.a.length<250||(fromSec&&D.a[0]&&fromSec<D.a[0].t);
  if(needMore&&typeof isLive==="function"&&isLive()){
    if(typeof vtCanUseEdge==="function"&&vtCanUseEdge()&&typeof edgeFetchCandles==="function"){
      try{
        const bars=await edgeFetchCandles(s,tf,{limit:1500,replay:true,from:fromSec,to:toSec});
        if(bars&&bars.length){
          if(typeof vtMergeBars==="function")vtMergeBars(k,bars);
          else{LIVE[k]=bars;LT[k]=Date.now();dirty(k)}
        }
      }catch(e){}
      D=vtBars(s,tf);
      if(D&&D.a.length>=25)return D;
    }
    if(typeof need==="function")need(s,tf,true);
  }
  return vtBars(s,tf);
}
function btOpenPnl(pos,px,feePct){
  if(!pos||!(px>0))return 0;
  const d=pos.side==="long"?1:-1;
  const gross=d*(px-pos.entry)*pos.qty;
  const exitFee=px*pos.qty*(feePct/100);
  return gross-pos.feeIn-exitFee;
}
function btCloseInternal(ses,exitBarIdx,barT,exitPx,why){
  const p=ses.pos;if(!p)return null;
  const feeOut=exitPx*p.qty*(ses.feePct/100);
  const trade={
    id:++ses.tradeSeq,
    sym:ses.sym,
    side:p.side,
    entry:p.entry,
    exit:exitPx,
    qty:p.qty,
    stop:p.sl0!=null?p.sl0:(p.sl!=null?p.sl:null),
    tgt:p.tp!=null?p.tp:null,
    fees:+(p.feeIn+feeOut).toFixed(6),
    open:p.openTime,
    close:btIso(barT),
    why,
    i0:p.openIdx,
    i1:exitBarIdx,
    slCur:p.sl
  };
  ses.trades.push(trade);
  ses.pos=null;
  return trade;
}
function btBracketPrices(side,entry,D,idx,B,customSl,customTp){
  const atr=btAtrAt(D,idx)||entry*0.01;
  const sg=side==="long"?1:-1;
  let sl=isFinite(customSl)&&customSl>0?customSl:null;
  let tp=isFinite(customTp)&&customTp>0?customTp:null;
  if(sl==null&&tp==null&&B.bracket&&B.bracket!=="none"){
    if(B.bracket==="atr2"){sl=btRound(entry-sg*atr,entry);tp=btRound(entry+sg*atr*2,entry)}
    else if(B.bracket==="atr3"){sl=btRound(entry-sg*atr,entry);tp=btRound(entry+sg*atr*3,entry)}
    else if(B.bracket==="pct12"){sl=btRound(entry*(1-sg*0.01),entry);tp=btRound(entry*(1+sg*0.02),entry)}
  }
  return{sl,tp};
}
function btCalcQty(ses,entry,sl,liveEq,D,idx){
  const riskAmt=Math.max(1,liveEq*(ses.riskPct/100));
  const stopDist=sl!=null?Math.abs(entry-sl):(btAtrAt(D,idx)||entry*0.01);
  const safeDist=Math.max(stopDist,entry*0.0005,1e-8);
  const raw=riskAmt/safeDist;
  return raw>=100?Number(raw.toFixed(2)):raw>=1?Number(raw.toFixed(3)):Number(raw.toFixed(5));
}
function btPlaceOrder(side,slOverride,tpOverride){
  const B=btCfg(),D=BT.D,er=document.getElementById("bt_err");
  if(er)er.textContent="";
  if(!D||!BT.ses){if(er)er.textContent="Load a symbol with candle data first.";return false}
  const idx=BT.rp.i,b=D.a[idx-1];if(!b)return false;
  const entry=b.c;
  if(BT.ses.pos){
    if(BT.ses.pos.side===side){if(er)er.textContent="Already in a "+side+" position. Close or Reverse first.";return false}
    btClosePos("reverse");
  }
  const slIn=slOverride!==undefined?slOverride:parseFloat((document.getElementById("bt_sl")||{}).value);
  const tpIn=tpOverride!==undefined?tpOverride:parseFloat((document.getElementById("bt_tp")||{}).value);
  const{sl,tp}=btBracketPrices(side,entry,D,idx,B,slIn,tpIn);
  if(sl!=null&&(side==="long"?sl>=entry:sl<=entry)){
    if(er)er.textContent=(side==="long"?"Long":"Short")+" Stop Loss must be "+(side==="long"?"below":"above")+" entry ("+fp(entry)+").";
    return false;
  }
  if(tp!=null&&(side==="long"?tp<=entry:tp>=entry)){
    if(er)er.textContent=(side==="long"?"Long":"Short")+" Take Profit must be "+(side==="long"?"above":"below")+" entry ("+fp(entry)+").";
    return false;
  }
  const st=btLiveStats();
  const qty=btCalcQty(BT.ses,entry,sl,st.equity,D,idx);
  const feeIn=entry*qty*(BT.ses.feePct/100);
  BT.ses.pos={id:BT.ses.tradeSeq+1,side,entry,qty,sl,sl0:sl,tp,feeIn,openIdx:idx-1,openTime:btIso(b.t)};
  btRefreshAll();
  return true;
}
function btClosePos(why){
  const D=BT.D,ses=BT.ses;
  if(!D||!ses||!ses.pos)return null;
  const k=Math.max(0,Math.min(D.a.length-1,BT.rp.i-1)),b=D.a[k];
  const t=btCloseInternal(ses,k,b.t,b.c,why||"manual");
  btRefreshAll();
  return t;
}
function btReversePos(){
  const ses=BT.ses;if(!ses||!ses.pos)return false;
  const nextSide=ses.pos.side==="long"?"short":"long";
  btClosePos("reverse");
  return btPlaceOrder(nextSide,NaN,NaN);
}
function btUpdateStops(){
  const ses=BT.ses,er=document.getElementById("bt_err");
  if(er)er.textContent="";
  if(!ses||!ses.pos)return false;
  const slV=parseFloat((document.getElementById("bt_sl")||{}).value);
  const tpV=parseFloat((document.getElementById("bt_tp")||{}).value);
  const sl=isFinite(slV)&&slV>0?slV:null;
  const tp=isFinite(tpV)&&tpV>0?tpV:null;
  const p=ses.pos;
  if(sl!=null&&(p.side==="long"?sl>=p.entry:sl<=p.entry)){
    if(er)er.textContent="Stop Loss must stay "+(p.side==="long"?"below":"above")+" entry ("+fp(p.entry)+").";
    return false;
  }
  if(tp!=null&&(p.side==="long"?tp<=p.entry:tp>=p.entry)){
    if(er)er.textContent="Take Profit must stay "+(p.side==="long"?"above":"below")+" entry ("+fp(p.entry)+").";
    return false;
  }
  p.sl=sl;if(p.sl0==null&&sl!=null)p.sl0=sl;p.tp=tp;
  btRefreshAll();
  toast("Updated active position SL / TP");
  return true;
}
function btSeek(next){
  const D=BT.D;if(!D)return;
  const ses=BT.ses||(btNewSession(D,btCfg(),1),BT.ses);
  const prev=BT.rp.i;
  const target=Math.max(1,Math.min(D.D.length,Math.round(next)||1));
  if(target>prev){
    for(let barPos=prev+1;barPos<=target;barPos++){
      const k=barPos-1,b=D.a[k];
      if(ses.pos&&ses.pos.openIdx<k){
        const p=ses.pos,d=p.side==="long"?1:-1;
        if(p.sl!=null&&(d>0?b.l<=p.sl:b.h>=p.sl)){
          const fill=d>0?(b.o<p.sl?b.o:p.sl):(b.o>p.sl?b.o:p.sl);
          btCloseInternal(ses,k,b.t,fill,"stop");
        }else if(p.tp!=null&&(d>0?b.h>=p.tp:b.l<=p.tp)){
          const fill=d>0?(b.o>p.tp?b.o:p.tp):(b.o<p.tp?b.o:p.tp);
          btCloseInternal(ses,k,b.t,fill,"target");
        }
      }
    }
  }else if(target<prev){
    const maxBarIdx=target-1;
    if(ses.pos&&ses.pos.openIdx>maxBarIdx)ses.pos=null;
    const kept=[];
    for(const t of ses.trades){
      if(t.i0>maxBarIdx)continue;
      if(t.i1<=maxBarIdx){kept.push(t);continue}
      if(!ses.pos){
        const feeIn=t.entry*t.qty*(ses.feePct/100);
        ses.pos={id:t.id,side:t.side,entry:t.entry,qty:t.qty,sl:t.slCur!=null?t.slCur:t.stop,sl0:t.stop,tp:t.tgt,feeIn,openIdx:t.i0,openTime:t.open};
      }
    }
    ses.trades=kept;
  }
  BT.rp.i=target;
  btRefreshAll();
}
function btLiveStats(){
  const ses=BT.ses,D=BT.D;
  if(!ses)return{st:jrStats([]),equity:btCfg().bal,realized:0,unrealized:0,ret:0,bal:btCfg().bal};
  const st=jrStats(ses.trades);
  const b=D&&D.a[BT.rp.i-1];
  const unreal=ses.pos&&b?btOpenPnl(ses.pos,b.c,ses.feePct):0;
  const equity=ses.startBal+st.net+unreal;
  return{st,equity,realized:st.net,unrealized:unreal,ret:(equity/ses.startBal)-1,bal:ses.startBal};
}
function btRenderChart(){
  const D=BT.D,ses=BT.ses;if(!D||!BT.ser)return;
  const i=BT.rp.i;
  BT.ser.setData(D.D.slice(0,i));
  BT.plines.forEach(l=>{try{BT.ser.removePriceLine(l)}catch(e){}});
  BT.plines=[];
  const mk=[];
  if(ses){
    ses.trades.forEach(t=>{
      if(t.i0<i)mk.push({time:D.D[t.i0].time,position:t.side==="long"?"belowBar":"aboveBar",color:t.side==="long"?"#089981":"#f23645",shape:t.side==="long"?"arrowUp":"arrowDown",text:t.side==="long"?"L":"S"});
      if(t.i1<i)mk.push({time:D.D[t.i1].time,position:t.side==="long"?"aboveBar":"belowBar",color:t.why==="target"?"#089981":t.why==="stop"?"#f23645":"#9aa4b2",shape:"circle",text:t.why==="target"?"TP":t.why==="stop"?"SL":"X"});
    });
    if(ses.pos&&ses.pos.openIdx<i){
      const p=ses.pos;
      mk.push({time:D.D[p.openIdx].time,position:p.side==="long"?"belowBar":"aboveBar",color:"#fb923c",shape:p.side==="long"?"arrowUp":"arrowDown",text:p.side==="long"?"LONG":"SHORT"});
      try{BT.plines.push(BT.ser.createPriceLine({price:p.entry,color:"#fb923c",lineWidth:2,lineStyle:0,axisLabelVisible:true,title:"Entry"}))}catch(e){}
      if(p.sl!=null)try{BT.plines.push(BT.ser.createPriceLine({price:p.sl,color:"#f23645",lineWidth:1,lineStyle:2,axisLabelVisible:true,title:"SL"}))}catch(e){}
      if(p.tp!=null)try{BT.plines.push(BT.ser.createPriceLine({price:p.tp,color:"#089981",lineWidth:1,lineStyle:2,axisLabelVisible:true,title:"TP"}))}catch(e){}
    }
  }
  mk.sort((a,b)=>a.time-b.time);
  try{BT.ser.setMarkers(mk)}catch(e){}
  const rr=document.getElementById("bt_rr");
  if(rr){rr.max=String(D.D.length);rr.value=String(i);rr.setAttribute("aria-valuetext","Bar "+i+" of "+D.D.length)}
  const z=D.a[i-1],info=document.getElementById("bt_rpinfo"),ohlc=document.getElementById("bt_ohlc");
  if(info&&z)info.textContent="Bar "+i+" / "+D.D.length;
  if(ohlc&&z){
    const dt=new Date(z.t*1000).toLocaleString("en-GB",{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
    ohlc.innerHTML=`<span>${esc(dt)}</span><span>O <b>${fp(z.o)}</b></span><span>H <b>${fp(z.h)}</b></span><span>L <b>${fp(z.l)}</b></span><span>C <b>${fp(z.c)}</b></span><span>ATR(14) <b>${fp(btAtrAt(D,i))}</b></span>`;
  }
}
function btRenderDesk(){
  const desk=document.getElementById("bt_desk");if(!desk)return;
  const D=BT.D,B=btCfg(),ses=BT.ses,cur=D&&D.a[BT.rp.i-1];
  const st=btLiveStats();
  const equityEl=document.getElementById("bt_equity_hdr");
  if(equityEl){equityEl.textContent=jrAbs(st.equity)+" ("+(st.ret>0?"+":"")+(st.ret*100).toFixed(2)+"%)";equityEl.className="v "+jrCls(st.equity-st.bal)}
  const unEl=document.getElementById("bt_unreal_hdr");
  if(unEl){unEl.textContent=ses&&ses.pos?jrUsd(st.unrealized):"\u2013";unEl.className="v "+(ses&&ses.pos?jrCls(st.unrealized):"")}

  const actHost=document.getElementById("bt_poshost");if(!actHost)return;
  if(!D||!cur||!ses){actHost.innerHTML=`<p class="mut">Waiting for market candles\u2026</p>`;return}
  const px=cur.c,atr=btAtrAt(D,BT.rp.i);
  const slInp=document.getElementById("bt_sl"),tpInp=document.getElementById("bt_tp");
  const pos=ses.pos;
  if(pos){
    const rrNow=pos.sl!=null&&pos.tp!=null&&Math.abs(pos.entry-pos.sl)>0?(Math.abs(pos.tp-pos.entry)/Math.abs(pos.entry-pos.sl)).toFixed(2):"n/a";
    if(slInp&&document.activeElement!==slInp)slInp.value=pos.sl!=null?String(pos.sl):"";
    if(tpInp&&document.activeElement!==tpInp)tpInp.value=pos.tp!=null?String(pos.tp):"";
    actHost.innerHTML=`<div class="bt-posbox">
      <div class="bt-poshd"><span class="jrside ${pos.side}">${pos.side==="long"?"LONG":"SHORT"} OPEN</span><b class="${jrCls(st.unrealized)}">${jrUsd(st.unrealized)}</b></div>
      <div class="bt-posg">
        <span>Entry</span><b>${fp(pos.entry)}</b>
        <span>Mark</span><b>${fp(px)}</b>
        <span>Qty</span><b>${esc(String(pos.qty))}</b>
        <span>Planned R:R</span><b>${esc(String(rrNow))}</b>
        <span>Stop Loss</span><b>${pos.sl!=null?fp(pos.sl):"None"}</b>
        <span>Take Profit</span><b>${pos.tp!=null?fp(pos.tp):"None"}</b>
      </div>
      <div class="bt-act">
        <button type="button" id="bt_upd" title="Apply Stop Loss and Take Profit inputs to open trade">Update SL/TP</button>
        <button type="button" id="bt_rev" title="Close and flip direction">Reverse</button>
        <button type="button" id="bt_close" class="pri bt-full">Close Position @ ${fp(px)}</button>
      </div>
    </div>`;
    const u=document.getElementById("bt_upd");if(u)u.onclick=btUpdateStops;
    const r=document.getElementById("bt_rev");if(r)r.onclick=btReversePos;
    const c=document.getElementById("bt_close");if(c)c.onclick=()=>btClosePos("manual");
  }else{
    const slVal=slInp?parseFloat(slInp.value):NaN,tpVal=tpInp?parseFloat(tpInp.value):NaN;
    const slDist=isFinite(slVal)&&slVal>0?Math.abs(px-slVal):B.bracket==="pct12"?px*0.01:B.bracket==="none"?atr:atr;
    const tpDist=isFinite(tpVal)&&tpVal>0?Math.abs(tpVal-px):B.bracket==="atr3"?atr*3:B.bracket==="pct12"?px*0.02:B.bracket==="atr2"?atr*2:0;
    const rrTxt=slDist>0&&tpDist>0?(tpDist/slDist).toFixed(2):"Custom / None";
    const risk$=st.equity*(ses.riskPct/100);
    const estQty=btCalcQty(ses,px,isFinite(slVal)&&slVal>0?slVal:null,st.equity,D,BT.rp.i);
    actHost.innerHTML=`<div class="bt-posbox">
      <div class="bt-posg">
        <span>Current Close</span><b>${fp(px)}</b>
        <span>Risk (${ses.riskPct}%)</span><b>${jrAbs(risk$)}</b>
        <span>Est. Qty</span><b>${esc(String(estQty))}</b>
        <span>Target R:R</span><b>${esc(String(rrTxt))}</b>
      </div>
      <div class="bt-act">
        <button type="button" id="bt_buy" class="bt-buy" title="Shortcut: B">Buy / Long</button>
        <button type="button" id="bt_sell" class="bt-sell" title="Shortcut: S">Sell / Short</button>
      </div>
    </div>`;
    const bBtn=document.getElementById("bt_buy");if(bBtn)bBtn.onclick=()=>btPlaceOrder("long");
    const sBtn=document.getElementById("bt_sell");if(sBtn)sBtn.onclick=()=>btPlaceOrder("short");
  }
}
function btRenderBottom(){
  const o=document.getElementById("bt_out"),meta=document.getElementById("bt_meta");
  if(!o||!BT.ses)return;
  const D=BT.D,ses=BT.ses,res=btLiveStats(),st=res.st;
  if(meta&&D&&D.a.length){
    meta.textContent=ses.sym+" "+ses.tf+" \u00b7 "+D.a.length+" bars \u00b7 "+(typeof isLive==="function"&&!isLive()?"Sample mode":"Live history");
  }
  const k=(l,v,c,t)=>`<div class="kpi"${t?` title="${esc(t)}"`:""}><div class="k">${l}</div><div class="v ${c||""}">${v}</div></div>`;
  const ret=res.ret;
  o.innerHTML=`<div class="jrkpis" style="margin-bottom:12px">${
    k("Live equity",jrAbs(res.equity),jrCls(res.equity-res.bal),"Starting balance + realized P&L + open unrealized P&L")+
    k("Realized net",jrUsd(res.realized),jrCls(res.realized))+
    k("Return",(ret>0?"+":"")+(ret*100).toFixed(2)+"%",jrCls(ret))+
    k("Trades",String(st.n))+
    k("Win rate",jrPct(st.winRate))+
    k("Average R:R",jrRf(st.avgR),jrCls(st.avgR),"Mean R-multiple across closed trades with Stop Loss")+
    k("Profit factor",jrFx(st.pf))+
    k("Max drawdown",st.maxDD?"\u2212"+jrAbs(st.maxDD):"$0.00",st.maxDD?"neg":"")
  }</div>
  <div class="bt-bottom">
    <div class="bt-eqwrap"><div class="jrch"><h4>Equity curve</h4></div><canvas id="bt_eq" height="200" role="img" aria-label="Manual backtest equity curve"></canvas></div>
    <div><div class="jrch"><h4>Trade log</h4><span class="sp"></span><button type="button" id="bt_csv"${st.n?"":" disabled"}>Export CSV</button></div>
    <div class="jrtw" tabindex="0" role="region" aria-label="Manual backtest trades"><table class="ftbl jrt"><thead><tr><th class="l">Opened</th><th class="l">Side</th><th>Qty</th><th>Entry</th><th>SL</th><th>TP</th><th>Exit</th><th class="l">Exit reason</th><th>P\u0026L</th><th>R</th></tr></thead><tbody>${ses.trades.slice().reverse().map(t=>{const p=jrPnl(t),r=jrR(t);return`<tr><td class="l">${esc(t.open.replace("T"," "))}</td><td class="l"><span class="jrside ${t.side}">${t.side==="short"?"Short":"Long"}</span></td><td>${esc(String(t.qty))}</td><td>${fp(t.entry)}</td><td>${t.stop!=null?fp(t.stop):"\u2013"}</td><td>${t.tgt!=null?fp(t.tgt):"\u2013"}</td><td>${fp(t.exit)}</td><td class="l">${esc(t.why)}</td><td class="${jrCls(p)}">${jrUsd(p)}</td><td>${jrRf(r)}</td></tr>`}).join("")||`<tr><td class="l mut" colspan="10">No closed trades yet. Step forward with the replay controls and place Long or Short orders.</td></tr>`}</tbody></table></div></div>
  </div>`;
  btEq(st,ses.startBal,res.equity);
  const csvBtn=document.getElementById("bt_csv");
  if(csvBtn)csvBtn.onclick=()=>{
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob(["\ufeff"+jrToCsv(ses.trades.map(t=>Object.assign({},t,{acct:"Manual Replay",setup:"Manual",notes:"Reason: "+t.why})))],{type:"text/csv"}));
    a.download="vektor-manual-backtest-"+ses.sym+"-"+ses.tf+".csv";
    document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
  };
}
function btEq(st,bal,liveEq){
  const cv=document.getElementById("bt_eq");if(!cv)return;
  const w=cv.clientWidth||440,h=200,dpr=window.devicePixelRatio||1;
  cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);cv.style.height=h+"px";
  const g=cv.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);
  const css=getComputedStyle(document.documentElement),col=n=>css.getPropertyValue(n).trim()||"#888";
  const pts=[bal,...st.curve.map(c=>bal+c.eq)];
  if(liveEq!=null&&(pts.length===1||Math.abs(liveEq-pts[pts.length-1])>0.005))pts.push(liveEq);
  if(pts.length<2){g.fillStyle=col("--mut");g.font="13px system-ui,sans-serif";g.textAlign="center";g.fillText("Place and step trades to plot equity",w/2,h/2);return}
  const lo=Math.min(...pts),hi=Math.max(...pts),pd=(hi-lo)*0.1||Math.max(1,bal*0.01),L=lo-pd,H=hi+pd;
  const X=i=>8+i*(w-74)/(pts.length-1),Y=v=>h-16-(v-L)/(H-L)*(h-28);
  g.strokeStyle=col("--line");g.setLineDash([3,3]);g.beginPath();g.moveTo(8,Y(bal));g.lineTo(w-66,Y(bal));g.stroke();g.setLineDash([]);
  g.fillStyle=col("--mut");g.font="11px system-ui,sans-serif";
  [hi,bal,lo].forEach(v=>g.fillText("$"+Math.round(v).toLocaleString("en-US"),w-62,Y(v)+4));
  g.strokeStyle=pts[pts.length-1]>=bal?col("--g"):col("--r");g.lineWidth=2;
  g.beginPath();pts.forEach((v,i)=>i?g.lineTo(X(i),Y(v)):g.moveTo(X(i),Y(v)));g.stroke();
  cv.setAttribute("aria-label","Equity from $"+Math.round(bal)+" to $"+Math.round(pts[pts.length-1]));
}
function btRefreshAll(){btRenderChart();btRenderDesk();btRenderBottom()}
async function btReplayInit(resetSession){
  const host=document.getElementById("bt_cv"),er=document.getElementById("bt_err");
  if(!host)return;
  if(er)er.textContent="";
  if(BT.ch){try{BT.ch.remove()}catch(e){}BT.ch=null;BT.ser=null;BT.plines=[]}
  const B=btCfg();
  const s=symOf(B.sym);
  if(!s){if(er)er.textContent="Unknown symbol \u201c"+B.sym+"\u201d. Pick a ticker from the list.";host.innerHTML="";return}
  let D=btData();
  const targetSec=B.startAt?Math.floor(Date.parse(B.startAt)/1000):0;
  const needHist=!D||D.a.length<25||(targetSec&&D.a[0]&&targetSec<D.a[0].t);
  if(needHist){
    host.innerHTML=`<p class="mut vt-skel">Loading ${esc(B.sym)} ${esc(B.tf)} historical candles\u2026</p>`;
    const padSec=(STEP[B.tf]||3600)*120;
    D=await btFetchIfNeeded(B.sym,B.tf,targetSec>0?Math.max(0,targetSec-padSec):undefined);
    if(!document.getElementById("bt_cv"))return;
    if(!D||D.a.length<25){
      clearTimeout(BT.wait);
      BT.wait=setTimeout(()=>{if(document.documentElement.dataset.page==="backtest")btReplayInit(resetSession)},2200);
      return;
    }
  }
  BT.D=D;
  const startInp=document.getElementById("bt_start");
  if(startInp){
    const minIso=btIso(D.a[Math.min(D.a.length-1,1)].t),maxIso=btIso(D.a[D.a.length-1].t);
    startInp.min=minIso;startInp.max=maxIso;
    if(!B.startAt||Date.parse(B.startAt)<D.a[0].t*1000||Date.parse(B.startAt)>D.a[D.a.length-1].t*1000){
      const defBar=D.a[Math.min(D.a.length-1,Math.floor(D.a.length*0.5))];
      B.startAt=btIso(defBar.t);save();
    }
    startInp.value=B.startAt;
  }
  if(resetSession||!BT.ses||BT.ses.sym!==B.sym||BT.ses.tf!==B.tf){
    btNewSession(D,B,btFindStartIdx(D,B.startAt));
  }else{
    BT.rp.i=Math.max(1,Math.min(BT.rp.i,D.D.length));
  }
  host.innerHTML="";
  if(!window.LightweightCharts){host.innerHTML=`<p class="mut">Chart library failed to load.</p>`;return}
  BT.ch=LightweightCharts.createChart(host,vtChartOpts(B.tf));
  BT.ser=BT.ch.addCandlestickSeries(vtCandleOpts(s));
  btRefreshAll();
  try{BT.ch.timeScale().fitContent()}catch(e){}
}
function btBuild(){
  const el=document.getElementById("pv-backtest");if(!el)return;
  const B=btCfg();
  const brackets=[["atr2","ATR 1:2"],["atr3","ATR 1:3"],["pct12","1% / 2%"],["none","Manual"]];
  el.innerHTML=`<div class="pgw bt">
    <div class="pgh"><h2>Manual Backtest <span class="mut">Bar Replay</span></h2><span class="mut">Pick a symbol and start time, step bar-by-bar, execute manual Long/Short orders with SL/TP, and track live equity.</span></div>
    <section class="vcard" aria-label="Replay session setup">
      <div class="bt-setup" id="bt_f">
        <label class="bt-symw">Symbol<input id="bt_sym" value="${esc(B.sym)}" list="bt_syms" autocomplete="off"></label>
        <datalist id="bt_syms">${(typeof SYMS!=="undefined"?SYMS:[]).slice(0,500).map(s=>`<option value="${esc(s[0])}">`).join("")}</datalist>
        <label>Timeframe<select id="bt_tf">${["1m","5m","15m","1H","4H","1D"].map(x=>`<option value="${x}"${B.tf===x?" selected":""}>${x}</option>`).join("")}</select></label>
        <label>Start date / time<input id="bt_start" type="datetime-local" value="${esc(B.startAt)}"></label>
        <div class="bt-qpos" role="group" aria-label="Quick start position">
          <button type="button" data-qpos="0.2">20%</button>
          <button type="button" data-qpos="0.5">50%</button>
          <button type="button" data-qpos="0.75">75%</button>
        </div>
        <label>Balance ($)<input id="bt_bal" type="number" step="100" min="100" value="${esc(String(B.bal))}" inputmode="decimal"></label>
        <label>Risk %<input id="bt_risk" type="number" step="0.1" min="0.05" max="100" value="${esc(String(B.riskPct))}" inputmode="decimal"></label>
        <label>Fee / side %<input id="bt_fee" type="number" step="0.01" min="0" max="5" value="${esc(String(B.feePct))}" inputmode="decimal"></label>
        <button type="button" class="pri" id="bt_reset">New replay session</button>
      </div>
      <p class="vsmsg err" id="bt_err" role="alert"></p>
    </section>
    <div class="bt-work">
      <section class="vcard bt-chartcard" aria-labelledby="bt_rph">
        <div class="jrch"><h3 id="bt_rph">Bar replay</h3><span class="sp"></span><span class="mut" id="bt_meta"></span><span class="mut" id="bt_rpinfo" role="status" aria-live="off"></span></div>
        <div class="btrpc" role="group" aria-label="Replay controls">
          <div class="bt-tgrp">
            <button type="button" class="bt-ic" id="bt_rs" title="Jump to start" aria-label="Jump to start">${BT_IC.start}</button>
            <button type="button" class="bt-ic" id="bt_rb" title="Step back 1 bar (Left Arrow)" aria-label="Step back one bar">${BT_IC.back}</button>
            <button type="button" class="bt-ic pri" id="bt_rp" title="Play / Pause (Space)" aria-label="Play">${BT_IC.play}<span>Play</span></button>
            <button type="button" class="bt-ic" id="bt_rf" title="Step forward 1 bar (Right Arrow)" aria-label="Step forward one bar">${BT_IC.fwd}</button>
            <button type="button" class="bt-ic" id="bt_re" title="Jump to end" aria-label="Jump to the end">${BT_IC.end}</button>
          </div>
          <label class="btspd">Speed<select id="bt_spd">${[1,2,4,8,16].map(v=>`<option value="${v}"${+B.speed===v?" selected":""}>${v}x</option>`).join("")}</select></label>
          <input type="range" id="bt_rr" min="1" max="1" value="1" aria-label="Replay position">
        </div>
        <div class="bt-ohlc" id="bt_ohlc"></div>
        <div id="bt_cv" class="btcv"></div>
        <p class="cnote">Shortcuts: Left / Right arrows step bars, Space toggles Play / Pause, B / S place Long / Short orders, X closes active position.</p>
      </section>
      <aside class="vcard bt-desk" id="bt_desk" aria-label="Order execution">
        <div class="jrch"><h3>Order execution</h3><span class="sp"></span><span class="mut">Paper replay</span></div>
        <div class="bt-balbar">
          <div><div class="k">Live equity</div><div class="v" id="bt_equity_hdr">${jrAbs(B.bal)}</div></div>
          <div><div class="k">Open P&amp;L</div><div class="v" id="bt_unreal_hdr">\u2013</div></div>
        </div>
        <div>
          <span class="mut" style="font-size:11.5px;display:block;margin-bottom:4px">SL / TP auto-bracket</span>
          <div class="bt-presets">${brackets.map(([k,n])=>`<button type="button" data-brk="${k}" class="${B.bracket===k?"on":""}">${esc(n)}</button>`).join("")}</div>
        </div>
        <div class="bt-orderf">
          <label>Stop Loss price<input id="bt_sl" type="number" step="any" placeholder="Auto from bracket" inputmode="decimal"></label>
          <label>Take Profit price<input id="bt_tp" type="number" step="any" placeholder="Auto from bracket" inputmode="decimal"></label>
        </div>
        <div id="bt_poshost"></div>
        <p class="cnote">Market orders fill at the visible bar\u2019s Close. When stepping forward, Stops fill before Targets if a bar touches both; gaps fill at the bar Open.</p>
      </aside>
    </div>
    <section class="vcard btres" aria-labelledby="bt_rh">
      <div class="jrch"><h3 id="bt_rh">Performance <span class="mut">&amp;</span> Trade Log</h3></div>
      <div id="bt_out"></div>
    </section>
  </div>`;

  const q=id=>document.getElementById(id);
  q("bt_sym").onchange=e=>{const v=e.target.value.trim().toUpperCase();if(!v)return;B.sym=v;if(typeof vtEnsureSym==="function")vtEnsureSym(v,true);save();btStop();btReplayInit(true)};
  q("bt_tf").onchange=e=>{B.tf=e.target.value;save();btStop();btReplayInit(true)};
  q("bt_start").onchange=async e=>{
    B.startAt=e.target.value;save();btStop();
    const sec=Math.floor(Date.parse(B.startAt)/1000);
    if(BT.D&&isFinite(sec)&&BT.D.a.length&&sec<BT.D.a[0].t){
      const padSec=(STEP[B.tf]||3600)*120;
      const fetched=await btFetchIfNeeded(B.sym,B.tf,Math.max(0,sec-padSec));
      if(fetched)BT.D=fetched;
    }
    if(BT.D){btNewSession(BT.D,B,btFindStartIdx(BT.D,B.startAt));btRefreshAll()}
  };
  el.querySelectorAll("[data-qpos]").forEach(btn=>btn.onclick=()=>{
    if(!BT.D||!BT.D.a.length)return;btStop();
    const idx=Math.max(1,Math.min(BT.D.a.length,Math.round(BT.D.a.length*(+btn.dataset.qpos))));
    B.startAt=btIso(BT.D.a[idx-1].t);save();
    if(q("bt_start"))q("bt_start").value=B.startAt;
    btNewSession(BT.D,B,idx);btRefreshAll();
  });
  q("bt_bal").onchange=e=>{B.bal=Math.max(100,+e.target.value||10000);save();if(BT.ses){BT.ses.startBal=B.bal;btRefreshAll()}};
  q("bt_risk").onchange=e=>{B.riskPct=Math.max(0.05,Math.min(100,+e.target.value||1));save();if(BT.ses){BT.ses.riskPct=B.riskPct;btRefreshAll()}};
  q("bt_fee").onchange=e=>{B.feePct=Math.max(0,+e.target.value||0);save();if(BT.ses){BT.ses.feePct=B.feePct;btRefreshAll()}};
  q("bt_reset").onclick=()=>{btStop();btNewSession(BT.D,B,btFindStartIdx(BT.D,B.startAt));if(q("bt_sl"))q("bt_sl").value="";if(q("bt_tp"))q("bt_tp").value="";btRefreshAll();toast("Replay session reset")};
  q("bt_rs").onclick=()=>{btStop();btSeek(1)};
  q("bt_rb").onclick=()=>{btStop();btSeek(BT.rp.i-1)};
  q("bt_rf").onclick=()=>{btStop();btSeek(BT.rp.i+1)};
  q("bt_re").onclick=()=>{btStop();btSeek(Infinity)};
  q("bt_rp").onclick=btPlay;
  q("bt_spd").onchange=e=>{B.speed=+e.target.value;save();if(BT.rp.on){btStop();btPlay()}};
  q("bt_rr").oninput=e=>{btStop();btSeek(+e.target.value)};
  el.querySelectorAll("[data-brk]").forEach(b=>b.onclick=()=>{
    B.bracket=b.dataset.brk;save();
    el.querySelectorAll("[data-brk]").forEach(x=>x.classList.toggle("on",x===b));
    if(q("bt_sl"))q("bt_sl").value="";if(q("bt_tp"))q("bt_tp").value="";
    btRenderDesk();
  });
  ["bt_sl","bt_tp"].forEach(id=>{const inp=q(id);if(inp)inp.oninput=()=>{if(!BT.ses||!BT.ses.pos)btRenderDesk()}});

  if(!BT.kbBound){
    BT.kbBound=true;
    document.addEventListener("keydown",e=>{
      if(document.documentElement.dataset.page!=="backtest")return;
      if(typeof MD!=="undefined"&&MD&&MD.innerHTML)return;
      if(e.metaKey||e.ctrlKey||e.altKey)return;
      const ae=document.activeElement;
      if(ae&&(/INPUT|SELECT|TEXTAREA/.test(ae.tagName||"")&&ae.type!=="range"||ae.isContentEditable))return;
      if(e.key==="ArrowRight"){e.preventDefault();e.stopPropagation();btStop();btSeek(BT.rp.i+1)}
      else if(e.key==="ArrowLeft"){e.preventDefault();e.stopPropagation();btStop();btSeek(BT.rp.i-1)}
      else if(e.key===" "){e.preventDefault();e.stopPropagation();btPlay()}
      else if((e.key==="b"||e.key==="B")&&BT.ses&&!BT.ses.pos){e.preventDefault();btPlaceOrder("long")}
      else if((e.key==="s"||e.key==="S")&&BT.ses&&!BT.ses.pos){e.preventDefault();btPlaceOrder("short")}
      else if((e.key==="x"||e.key==="X")&&BT.ses&&BT.ses.pos){e.preventDefault();btClosePos("manual")}
    },true);
  }
  btReplayInit(false);
}
function btPlay(){
  const b=document.getElementById("bt_rp");
  if(BT.rp.on){btStop();return}
  if(!BT.D)return;
  if(BT.rp.i>=BT.D.D.length)btSeek(1);
  BT.rp.on=true;
  if(b){b.innerHTML=BT_IC.pause+"<span>Pause</span>";b.setAttribute("aria-label","Pause")}
  const ms=1000/Math.max(1,+btCfg().speed||2);
  BT.rp.timer=setInterval(()=>{
    if(!BT.D||BT.rp.i>=BT.D.D.length){btStop();return}
    btSeek(BT.rp.i+1);
  },ms);
}
function btStop(){
  clearInterval(BT.rp.timer);
  BT.rp.on=false;
  const b=document.getElementById("bt_rp");
  if(b){b.innerHTML=BT_IC.play+"<span>Play</span>";b.setAttribute("aria-label","Play")}
}
PAGE_HOOK.backtest={enter(){btBuild()},leave(){btStop()},sub(){}};
addEventListener("resize",deb(()=>{if(document.documentElement.dataset.page==="backtest"&&BT.ses){const r=btLiveStats();btEq(r.st,r.bal,r.equity)}},200));
