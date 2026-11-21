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
const BT={D:null,sym:"",tf:"",loading:false,wait:0,ch:null,ser:null,plines:[],rp:{i:1,on:false,timer:0},ses:null,kbBound:false,tab:"history"};

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
          if(typeof vtSetServerBars==="function")vtSetServerBars(k,bars);
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
function btMoveStopBE(){
  const ses=BT.ses,er=document.getElementById("bt_err");
  if(er)er.textContent="";
  if(!ses||!ses.pos)return false;
  ses.pos.sl=ses.pos.entry;
  const slInp=document.getElementById("bt_sl");
  if(slInp)slInp.value=String(ses.pos.entry);
  btRefreshAll();
  toast("Moved Stop Loss to Break-Even ("+fp(ses.pos.entry)+")");
  return true;
}
function btPartialClose(frac){
  const D=BT.D,ses=BT.ses;
  if(!D||!ses||!ses.pos)return false;
  const p=ses.pos,k=Math.max(0,Math.min(D.a.length-1,BT.rp.i-1)),b=D.a[k];
  const partQty=p.qty>=100?Number((p.qty*frac).toFixed(2)):p.qty>=1?Number((p.qty*frac).toFixed(3)):Number((p.qty*frac).toFixed(5));
  if(!(partQty>0)||partQty>=p.qty)return btClosePos("manual");
  const feePartIn=p.feeIn*frac,feePartOut=b.c*partQty*(ses.feePct/100);
  ses.trades.push({
    id:++ses.tradeSeq,
    sym:ses.sym,
    side:p.side,
    entry:p.entry,
    exit:b.c,
    qty:partQty,
    stop:p.sl0!=null?p.sl0:p.sl,
    tgt:p.tp,
    fees:+(feePartIn+feePartOut).toFixed(6),
    open:p.openTime,
    close:btIso(b.t),
    why:"partial",
    i0:p.openIdx,
    i1:k,
    slCur:p.sl
  });
  p.qty=p.qty>=100?Number((p.qty-partQty).toFixed(2)):p.qty>=1?Number((p.qty-partQty).toFixed(3)):Number((p.qty-partQty).toFixed(5));
  p.feeIn=Math.max(0,p.feeIn-feePartIn);
  btRefreshAll();
  toast("Closed "+Math.round(frac*100)+"% ("+partQty+") @ "+fp(b.c));
  return true;
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
  const sl=D.D.slice(0,i);
  const ct=BT.chartType||"candles";
  if(ct==="line"||ct==="area")BT.ser.setData(sl.map(x=>({time:x.time,value:x.close})));
  else if(ct==="heikin"){const ha=typeof vtHaFor==="function"?vtHaFor(D.a,()=>{if(BT.D===D)btRenderChart()}):null;BT.ser.setData(ha?ha.slice(0,Math.max(0,i-(D.a.length-ha.length))):[])} // rows cover the dataset's last <=5000 bars
  else BT.ser.setData(sl);
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
  if(rr){
    rr.max=String(D.D.length);
    rr.value=String(i);
    rr.setAttribute("aria-valuetext","Bar "+i+" of "+D.D.length);
    const pct=D.D.length>1?((i-1)/(D.D.length-1))*100:100;
    rr.style.setProperty("--bt-prog",pct.toFixed(2)+"%");
  }
  const z=D.a[i-1],info=document.getElementById("bt_rpinfo"),ohlc=document.getElementById("bt_ohlc");
  if(info&&z){
    const dtShort=new Date(z.t*1000).toLocaleString("en-GB",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
    info.textContent="Bar "+i+" / "+D.D.length+" \u00b7 "+dtShort;
  }
  const winEl=document.getElementById("bt_win"),sumEl=document.getElementById("bt_sum");
  if(winEl&&D.a.length){
    const dFmt=ts=>new Date(ts*1000).toLocaleDateString("en-GB",{month:"short",day:"numeric",year:"2-digit"});
    winEl.textContent=D.a.length+" bars \u00b7 "+dFmt(D.a[0].t)+" \u2013 "+dFmt(D.a[D.a.length-1].t);
  }
  if(sumEl&&ses){
    sumEl.textContent=ses.sym+" \u00b7 "+ses.tf+" \u00b7 "+jrAbs(ses.startBal)+" \u00b7 "+ses.riskPct+"% risk";
  }
  if(ohlc&&z){
    const dt=new Date(z.t*1000).toLocaleString("en-GB",{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
    ohlc.innerHTML=`<span>${esc(dt)}</span><span>O <b>${fp(z.o)}</b></span><span>H <b>${fp(z.h)}</b></span><span>L <b>${fp(z.l)}</b></span><span>C <b>${fp(z.c)}</b></span><span>ATR <b>${fp(btAtrAt(D,i))}</b></span>`;
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
  const hEq=document.getElementById("bt_hdr_eq");
  if(hEq){hEq.textContent=jrAbs(st.equity);hEq.className="bt-stat-v "+jrCls(st.equity-st.bal)}
  const hPnl=document.getElementById("bt_hdr_pnl");
  if(hPnl){hPnl.textContent=ses&&ses.pos?jrUsd(st.unrealized):"$0.00";hPnl.className="bt-stat-v "+(ses&&ses.pos?jrCls(st.unrealized):"")}
  const hWr=document.getElementById("bt_hdr_wr");
  if(hWr){hWr.textContent=st.st.n?jrPct(st.st.winRate):"\u2013"}
  const bBal=document.getElementById("bt_bar_bal");
  if(bBal){bBal.textContent=jrAbs(st.equity)}
  const bPnl=document.getElementById("bt_bar_pnl");
  if(bPnl){bPnl.textContent=ses&&ses.pos?jrUsd(st.unrealized):"$0.00";bPnl.className="bt-bar-v "+(ses&&ses.pos?jrCls(st.unrealized):"")}
  const tSym=document.getElementById("bt_top_sym");if(tSym)tSym.textContent=B.sym;
  const tTf=document.getElementById("bt_tf_s");if(tTf)tTf.value=B.tf;
  document.querySelectorAll("#pv-backtest [data-qrisk]").forEach(btn=>{btn.classList.toggle("on",Math.abs((+btn.dataset.qrisk)-B.riskPct)<0.001)});

  const actHost=document.getElementById("bt_poshost");if(!actHost)return;
  if(!D||!cur||!ses){actHost.innerHTML=`<div class="vt-skel-list" role="status" aria-label="Waiting for market candles"><div class="vt-skel-row" aria-hidden="true"></div><div class="vt-skel-row" aria-hidden="true"></div></div>`;return}
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
        <button type="button" id="bt_be" title="Move Stop Loss to Entry Price (Break-Even)">Move SL to BE</button>
        <button type="button" id="bt_half" title="Take 50% partial profit at current bar close">Close 50%</button>
        <button type="button" id="bt_rev" title="Close and flip direction">Reverse</button>
        <button type="button" id="bt_close" class="pri bt-full">Close Position @ ${fp(px)}</button>
      </div>
    </div>`;
    const u=document.getElementById("bt_upd");if(u)u.onclick=btUpdateStops;
    const be=document.getElementById("bt_be");if(be)be.onclick=btMoveStopBE;
    const hf=document.getElementById("bt_half");if(hf)hf.onclick=()=>btPartialClose(0.5);
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
function btSetTab(tab){
  BT.tab=tab==="positions"||tab==="equity"?tab:"history";
  const tabs=document.querySelectorAll("#bt_tabs [data-bttab]");
  tabs.forEach(b=>{
    const on=b.dataset.bttab===BT.tab;
    b.classList.toggle("on",on);
    b.setAttribute("aria-selected",String(on));
  });
  const map={positions:"bt_pane_pos",history:"bt_pane_hist",equity:"bt_pane_eq"};
  for(const k in map){
    const p=document.getElementById(map[k]);
    if(p)p.hidden=k!==BT.tab;
  }
  if(BT.tab==="equity"&&BT.ses){
    const res=btLiveStats();
    btEq(res.st,BT.ses.startBal,res.equity);
  }
}
function btRenderBottom(){
  const o=document.getElementById("bt_out"),meta=document.getElementById("bt_meta");
  if(!o||!BT.ses)return;
  const D=BT.D,ses=BT.ses,res=btLiveStats(),st=res.st;
  if(meta&&D&&D.a.length){
    meta.textContent=ses.sym+" "+ses.tf+" \u00b7 "+D.a.length+" bars \u00b7 "+(typeof isLive==="function"&&!isLive()?"Sample mode":"Live history");
  }
  const posCnt=document.getElementById("bt_cnt_pos"),histCnt=document.getElementById("bt_cnt_hist");
  if(posCnt)posCnt.textContent=ses.pos?"1":"0";
  if(histCnt)histCnt.textContent=String(st.n);
  const k=(l,v,c,t)=>`<div class="kpi"${t?` title="${esc(t)}"`:""}><div class="k">${l}</div><div class="v ${c||""}">${v}</div></div>`;
  const ret=res.ret;
  const cur=D&&D.a[BT.rp.i-1],px=cur?cur.c:0,p=ses.pos;
  const posHtml=p?`<div class="bt-posrow">
    <div class="bt-posrow-cell"><span class="k">Side</span><span class="jrside ${p.side}">${p.side==="long"?"LONG":"SHORT"}</span></div>
    <div class="bt-posrow-cell"><span class="k">Entry</span><b>${fp(p.entry)}</b></div>
    <div class="bt-posrow-cell"><span class="k">Mark</span><b>${fp(px)}</b></div>
    <div class="bt-posrow-cell"><span class="k">Qty</span><b>${esc(String(p.qty))}</b></div>
    <div class="bt-posrow-cell"><span class="k">Stop Loss</span><b>${p.sl!=null?fp(p.sl):"\u2013"}</b></div>
    <div class="bt-posrow-cell"><span class="k">Take Profit</span><b>${p.tp!=null?fp(p.tp):"\u2013"}</b></div>
    <div class="bt-posrow-cell"><span class="k">Unrealized</span><b class="${jrCls(res.unrealized)}">${jrUsd(res.unrealized)}</b></div>
    <div class="bt-posrow-act"><button type="button" id="bt_pane_close" class="pri">Close @ ${fp(px)}</button></div>
  </div>`:`<div class="bt-empty">No open position. Execute Buy / Long (B) or Sell / Short (S) from the Order Ticket.</div>`;
  const tradeRows=ses.trades.slice().reverse().map(t=>{const pn=jrPnl(t),r=jrR(t);return`<tr><td class="l">${esc(t.open.replace("T"," "))}</td><td class="l"><span class="jrside ${t.side}">${t.side==="short"?"Short":"Long"}</span></td><td>${esc(String(t.qty))}</td><td>${fp(t.entry)}</td><td>${t.stop!=null?fp(t.stop):"\u2013"}</td><td>${t.tgt!=null?fp(t.tgt):"\u2013"}</td><td>${fp(t.exit)}</td><td class="l">${esc(t.why)}</td><td class="${jrCls(pn)}">${jrUsd(pn)}</td><td>${jrRf(r)}</td></tr>`}).join("");
  o.innerHTML=`<div class="jrkpis bt-kpis">${
    k("Live equity",jrAbs(res.equity),jrCls(res.equity-res.bal),"Starting balance + realized P&L + open unrealized P&L")+
    k("Realized net",jrUsd(res.realized),jrCls(res.realized))+
    k("Return",(ret>0?"+":"")+(ret*100).toFixed(2)+"%",jrCls(ret))+
    k("Trades",String(st.n))+
    k("Win rate",jrPct(st.winRate))+
    k("Average R:R",jrRf(st.avgR),jrCls(st.avgR),"Mean R-multiple across closed trades with Stop Loss")+
    k("Profit factor",jrFx(st.pf))+
    k("Max drawdown",st.maxDD?"\u2212"+jrAbs(st.maxDD):"$0.00",st.maxDD?"neg":"")
  }</div>
  <div id="bt_pane_pos" class="bt-pane" role="tabpanel" aria-labelledby="bt_tab_pos"${BT.tab==="positions"?"":" hidden"}>${posHtml}</div>
  <div id="bt_pane_hist" class="bt-pane" role="tabpanel" aria-labelledby="bt_tab_hist"${BT.tab==="history"?"":" hidden"}>
    <div class="jrtw" tabindex="0" role="region" aria-label="Manual backtest trades"><table class="ftbl jrt"><thead><tr><th class="l">Opened</th><th class="l">Side</th><th>Qty</th><th>Entry</th><th>SL</th><th>TP</th><th>Exit</th><th class="l">Exit reason</th><th>P\u0026L</th><th>R</th></tr></thead><tbody>${tradeRows}</tbody></table></div>
    ${st.n?"":`<div class="bt-empty">No closed trades yet. Step forward with the replay controls and place Long or Short orders.</div>`}
  </div>
  <div id="bt_pane_eq" class="bt-pane" role="tabpanel" aria-labelledby="bt_tab_eq"${BT.tab==="equity"?"":" hidden"}>
    <div class="bt-eqwrap"><canvas id="bt_eq" height="210" role="img" aria-label="Manual backtest equity curve"></canvas></div>
  </div>`;
  const pClose=document.getElementById("bt_pane_close");
  if(pClose)pClose.onclick=()=>btClosePos("manual");
  btEq(st,ses.startBal,res.equity);
  const csvBtn=document.getElementById("bt_csv");
  if(csvBtn){
    csvBtn.disabled=!st.n;
    csvBtn.onclick=()=>{
      const a=document.createElement("a");
      a.href=URL.createObjectURL(new Blob(["\ufeff"+jrToCsv(ses.trades.map(t=>Object.assign({},t,{acct:"Manual Replay",setup:"Manual",notes:"Reason: "+t.why})))],{type:"text/csv"}));
      a.download="vektor-manual-backtest-"+ses.sym+"-"+ses.tf+".csv";
      document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
    };
  }
}
function btEq(st,bal,liveEq){
  const cv=document.getElementById("bt_eq");if(!cv)return;
  const w=cv.clientWidth||440,h=210,dpr=window.devicePixelRatio||1;
  cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);cv.style.height=h+"px";
  const g=cv.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);
  const css=getComputedStyle(document.documentElement),col=n=>css.getPropertyValue(n).trim()||"#888";
  const pts=[bal,...st.curve.map(c=>bal+c.eq)];
  if(liveEq!=null&&(pts.length===1||Math.abs(liveEq-pts[pts.length-1])>0.005))pts.push(liveEq);
  if(pts.length<2){g.fillStyle=col("--mut");g.font="12.5px system-ui,sans-serif";g.textAlign="center";g.fillText("Place and step trades to plot equity curve",w/2,h/2);return}
  const lo=Math.min(...pts),hi=Math.max(...pts),pd=(hi-lo)*0.12||Math.max(1,bal*0.01),L=lo-pd,H=hi+pd;
  const X=i=>8+i*(w-78)/(pts.length-1),Y=v=>h-18-(v-L)/(H-L)*(h-32);
  g.strokeStyle=col("--line");g.setLineDash([3,3]);g.beginPath();g.moveTo(8,Y(bal));g.lineTo(w-70,Y(bal));g.stroke();g.setLineDash([]);
  g.fillStyle=col("--mut");g.font="11px ui-monospace,SFMono-Regular,Menlo,monospace";
  [hi,bal,lo].forEach(v=>g.fillText("$"+Math.round(v).toLocaleString("en-US"),w-66,Y(v)+4));
  const up=pts[pts.length-1]>=bal,stroke=up?col("--g"):col("--r");
  g.beginPath();
  pts.forEach((v,i)=>i?g.lineTo(X(i),Y(v)):g.moveTo(X(i),Y(v)));
  g.strokeStyle=stroke;g.lineWidth=2;g.stroke();
  g.lineTo(X(pts.length-1),h-18);g.lineTo(X(0),h-18);g.closePath();
  g.fillStyle=up?"rgba(16,185,129,0.09)":"rgba(244,63,94,0.09)";g.fill();
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
    host.innerHTML=`<p class="mut vt-skel" role="status">Loading ${esc(B.sym)} ${esc(B.tf)} historical candles\u2026</p>`;
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
  const ct=B.chartType||BT.chartType||"candles";BT.chartType=ct;
  const co=vtCandleOpts(s);
  if(ct==="line")BT.ser=BT.ch.addLineSeries({color:"#2962ff",lineWidth:2});
  else if(ct==="area")BT.ser=BT.ch.addAreaSeries({lineColor:"#2962ff",lineWidth:2,topColor:"rgba(41,98,255,0.28)",bottomColor:"rgba(41,98,255,0.02)"});
  else if(ct==="bars")BT.ser=BT.ch.addBarSeries({upColor:co.upColor||"#10b981",downColor:co.downColor||"#f43f5e"});
  else if(ct==="hollow")BT.ser=BT.ch.addCandlestickSeries(Object.assign({},co,{upColor:"rgba(0,0,0,0)"}));
  else BT.ser=BT.ch.addCandlestickSeries(co);
  btRefreshAll();
  try{BT.ch.timeScale().fitContent()}catch(e){}
}
function btTogChartTypeMenu(ev){
  if(ev)ev.stopPropagation();
  const btn=document.getElementById("bt_ctype_btn"),m=document.getElementById("bt_ctype_btn_menu");
  if(!btn||!m)return;
  const open=m.style.display==="block";
  if(open){m.style.display="none";btn.setAttribute("aria-expanded","false");return}
  const cur=BT.chartType||btCfg().chartType||"candles";
  m.innerHTML=VT_CHART_TYPES.map(t=>`<button type="button" role="menuitem" class="vt-pop-item vt-ctype-item ${cur===t.id?"on":""}" onclick="btSetChartType('${t.id}')"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${t.ic}</svg><span>${t.label}</span></button>`).join("");
  const r=btn.getBoundingClientRect();
  m.style.position="fixed";m.style.top=Math.round(r.bottom+6)+"px";m.style.left=Math.max(8,Math.min(window.innerWidth-190,Math.round(r.left)))+"px";
  m.style.display="block";btn.setAttribute("aria-expanded","true");
}
function btSetChartType(t){
  const B=btCfg();B.chartType=t;BT.chartType=t;save();
  const m=document.getElementById("bt_ctype_btn_menu");if(m)m.style.display="none";
  const btn=document.getElementById("bt_ctype_btn");
  const ct=VT_CHART_TYPES.find(x=>x.id===t)||VT_CHART_TYPES[0];
  if(btn)btn.innerHTML=`<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ct.ic}</svg><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`;
  btReplayInit(false);
}
function btSetPage(mode){
  BT.page=mode==="session"?"session":"setup";
  const p1=document.getElementById("bt_setup_page"),p2=document.getElementById("bt_session_page");
  if(p1)p1.hidden=BT.page==="session";
  if(p2)p2.hidden=BT.page!=="session";
  if(BT.page==="session"){
    const tb=document.getElementById("bt_tb");if(tb)tb.innerHTML=tbHTML();
    if(typeof vtRenderFavBars==="function")vtRenderFavBars();
    if(typeof vtSyncUndoBtns==="function")vtSyncUndoBtns();
    setTimeout(()=>{if(BT.ch&&BT.D){try{BT.ch.timeScale().fitContent()}catch(_e){}}},60);
  }else{
    btStop();
  }
}
function btToggleDrawer(tab){
  const dr=document.getElementById("bt_drawer");if(!dr)return;
  if(tab&&!dr.hidden&&BT.tab===tab){dr.hidden=true;return}
  dr.hidden=false;
  if(tab)btSetTab(tab);
}
function btBuild(){
  const el=document.getElementById("pv-backtest");if(!el)return;
  const B=btCfg();
  if(!B.leverage||B.leverage>30)B.leverage=30;
  if(!B.endAt)B.endAt="";
  if(!BT.page)BT.page="setup";
  const brackets=[["atr2","ATR 1:2"],["atr3","ATR 1:3"],["pct12","1% / 2%"],["none","Manual"]];
  const qSyms=[["GBP/USD","GBPUSD"],["EUR/USD","EURUSD"],["XAU/USD","XAUUSD"],["BTC/USD","BTCUSDT"],["SPY","SPY"],["AAPL","AAPL"]];
  const bals=[1000,10000,50000,100000];
  const levs=[1,5,10,20,30];
  const tfs=["1m","5m","15m","1H","4H","1D"];
  el.innerHTML=`<div class="pgw bt bt-2page">
    <section id="bt_setup_page" class="bt-setup-page" aria-label="Backtest session setup"${BT.page==="session"?" hidden":""}>
      <div class="bt-wiz-card vcard">
        <div class="bt-wiz-hd">
          <span class="bt-wiz-eyebrow">VEKTOR BACKTEST LAB</span>
          <h2>Configure Replay Session</h2>
          <p class="mut">Select your instrument, historical window, account size, and leverage to launch the full-screen trading cockpit.</p>
        </div>
        <div class="bt-wiz-grid" id="bt_f">
          <div class="bt-wiz-sec bt-wiz-full">
            <label for="bt_sym">Asset / Symbol</label>
            <input id="bt_sym" value="${esc(B.sym)}" list="bt_syms" autocomplete="off" placeholder="Search symbol (e.g. BTCUSDT, EURUSD, AAPL)">
            <datalist id="bt_syms">${(typeof SYMS!=="undefined"?SYMS:[]).slice(0,500).map(s=>`<option value="${esc(s[0])}">`).join("")}</datalist>
            <div class="bt-chips" role="group" aria-label="Quick symbol presets">
              ${qSyms.map(([lbl,sym])=>`<button type="button" class="bt-chip ${B.sym===sym?"on":""}" data-qsym="${sym}">${lbl}</button>`).join("")}
            </div>
          </div>
          <div class="bt-wiz-sec">
            <label for="bt_start">Start Date</label>
            <input id="bt_start" type="datetime-local" value="${esc(B.startAt)}">
          </div>
          <div class="bt-wiz-sec">
            <label for="bt_end">End Date (optional)</label>
            <input id="bt_end" type="datetime-local" value="${esc(B.endAt||"")}">
          </div>
          <div class="bt-wiz-sec bt-wiz-full">
            <label for="bt_tf">Timeframe</label>
            <div class="bt-tf-row">
              <select id="bt_tf" class="bt-tf-sel">${tfs.map(x=>`<option value="${x}"${B.tf===x?" selected":""}>${x}</option>`).join("")}</select>
              <div class="bt-chips" role="group" aria-label="Timeframe presets">
                ${tfs.map(x=>`<button type="button" class="bt-chip ${B.tf===x?"on":""}" data-qtf="${x}">${x}</button>`).join("")}
              </div>
            </div>
          </div>
          <div class="bt-wiz-sec bt-wiz-full">
            <label for="bt_bal">Account Size ($)</label>
            <div class="bt-bal-row">
              <input id="bt_bal" type="number" step="100" min="100" value="${esc(String(B.bal))}" inputmode="decimal">
              <div class="bt-chips" role="group" aria-label="Account size presets">
                ${bals.map(v=>`<button type="button" class="bt-chip ${+B.bal===v?"on":""}" data-qbal="${v}">$${v.toLocaleString()}</button>`).join("")}
              </div>
            </div>
          </div>
          <div class="bt-wiz-sec bt-wiz-full">
            <span class="bt-sublbl">Leverage</span>
            <div class="bt-chips" role="group" aria-label="Leverage presets">
              ${levs.map(v=>`<button type="button" class="bt-chip ${+B.leverage===v?"on":""}" data-qlev="${v}">1:${v}</button>`).join("")}
            </div>
          </div>
          <div class="bt-wiz-sec">
            <label for="bt_risk">Risk per Trade (%)</label>
            <input id="bt_risk" type="number" step="0.1" min="0.05" max="100" value="${esc(String(B.riskPct))}" inputmode="decimal">
          </div>
          <div class="bt-wiz-sec">
            <label for="bt_fee">Commission / Fee (%)</label>
            <input id="bt_fee" type="number" step="0.01" min="0" max="5" value="${esc(String(B.feePct))}" inputmode="decimal">
          </div>
        </div>
        <p class="vsmsg err" id="bt_err" role="alert"></p>
        <div class="bt-wiz-foot">
          <button type="button" id="bt_reset">Reset Defaults</button>
          <span class="sp"></span>
          <button type="button" class="pri bt-start-cta" id="bt_start_session">Start Backtest Session →</button>
        </div>
      </div>
    </section>

    <section id="bt_session_page" class="bt-session-page" aria-label="Backtest chart cockpit"${BT.page==="session"?"":" hidden"}>
      <div class="bt-topbar" role="toolbar" aria-label="Backtest chart toolbar">
        <div class="bt-tb-left">
          <button type="button" class="bt-sym-pill" id="bt_top_sym_btn" onclick="btSetPage('setup')" title="Change symbol or session settings"><b id="bt_top_sym">${esc(B.sym)}</b></button>
          <select id="bt_tf_s" class="bt-tb-sel" aria-label="Replay timeframe">${tfs.map(x=>`<option value="${x}"${B.tf===x?" selected":""}>${x}</option>`).join("")}</select>
          ${vtChartTypeBtnHTML(B.chartType||"candles","btTogChartTypeMenu","bt_ctype_btn")}
          <button type="button" class="bt-tb-btn" onclick="indM()" title="Indicators"><i>fx</i> Indicators</button>
          <button type="button" class="bt-tb-btn pri-soft" id="bt_open_pos_btn" title="Open or manage position">Open Position</button>
          <button type="button" class="bt-tb-btn" id="bt_quick_place_btn" title="Quick market Buy / Sell">Quick Place</button>
          <button type="button" class="bt-tb-btn" id="bt_goto_btn" title="Jump to bar position">Go To</button>
          <button type="button" class="bt-tb-btn" id="bt_rs" title="Rewind to start" aria-label="Rewind to start">⏮ Rewind</button>
          <button type="button" id="bt_undo_btn" class="vt-ur-btn" onclick="doUndo()" title="Undo drawing (Ctrl+Z)" aria-label="Undo drawing" disabled><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button>
          <button type="button" id="bt_redo_btn" class="vt-ur-btn" onclick="doRedo()" title="Redo drawing (Ctrl+Y)" aria-label="Redo drawing" disabled><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg></button>
        </div>
        <div class="bt-tb-right">
          <button type="button" class="bt-tb-btn" id="bt_save_btn" title="Save &amp; export session CSV">Save</button>
          <button type="button" class="bt-tb-btn" onclick="setM()" title="Chart settings" aria-label="Chart settings">${VT_IC.gear}</button>
          <button type="button" class="bt-tb-btn" id="bt_fs_btn" title="Toggle fullscreen" aria-label="Toggle fullscreen">⛶ Fullscreen</button>
        </div>
      </div>

      <div class="bt-stage">
        <div class="tbar bt-rail" id="bt_tb" aria-label="Drawing tools">${tbHTML()}</div>
        <div class="bt-canvas-wrap">
          <div class="bt-ohlc-bar"><div class="bt-ohlc" id="bt_ohlc"></div><span class="mut bt-meta" id="bt_meta"></span></div>
          <div id="bt_favbar_host"></div>
          <div class="bt-rp-pill" id="bt_rp_pill" role="group" aria-label="Replay playback controls">
            <span class="bt-pill-drag" id="bt_rp_drag" title="Drag playback controls" aria-hidden="true">⋮⋮</span>
            <label class="bt-spd-wrap" aria-label="Replay speed"><select id="bt_spd">${[1,2,4,8,16].map(v=>`<option value="${v}"${+B.speed===v?" selected":""}>${v}x</option>`).join("")}</select></label>
            <button type="button" class="bt-ic" id="bt_rb" title="Step back 1 bar (Left Arrow)" aria-label="Step back one bar">${BT_IC.back}</button>
            <button type="button" class="bt-ic pri" id="bt_rp" title="Play / Pause (Space)" aria-label="Play">${BT_IC.play}</button>
            <button type="button" class="bt-ic" id="bt_rf" title="Step forward 1 bar (Right Arrow)" aria-label="Step forward one bar">${BT_IC.fwd}</button>
            <button type="button" class="bt-ic" id="bt_re" title="Jump to end" aria-label="Jump to the end">${BT_IC.end}</button>
            <input type="range" id="bt_rr" min="1" max="1" value="1" aria-label="Replay position">
            <span class="mut bt-rpinfo" id="bt_rpinfo" role="status" aria-live="off"></span>
          </div>
          <div id="bt_quick_pill" class="bt-quick-pill" hidden>
            <button type="button" class="bt-buy" onclick="btPlaceOrder('long')">Buy Market</button>
            <button type="button" class="bt-sell" onclick="btPlaceOrder('short')">Sell Market</button>
            <button type="button" class="bt-qp-x" onclick="document.getElementById('bt_quick_pill').hidden=true" aria-label="Close quick place">×</button>
          </div>
          <div id="bt_cv" class="btcv"><p class="mut vt-skel" role="status">Loading replay chart\u2026</p></div>
          <aside class="vcard bt-desk bt-desk-pop" id="bt_desk" aria-label="Order ticket" hidden>
            <div class="jrch"><h3>Order Ticket</h3><span class="sp"></span><span class="vt-pill">1:${esc(String(B.leverage))}</span><button type="button" class="bt-desk-x" onclick="document.getElementById('bt_desk').hidden=true" aria-label="Close order ticket">×</button></div>
            <div class="bt-balbar">
              <div><div class="k">Equity</div><div class="v" id="bt_equity_hdr">${jrAbs(B.bal)}</div></div>
              <div><div class="k">Open P&amp;L</div><div class="v" id="bt_unreal_hdr">\u2013</div></div>
            </div>
            <div>
              <span class="bt-sublbl">Risk per trade</span>
              <div class="bt-qpos bt-risk-pills" role="group" aria-label="Quick risk preset">
                <button type="button" data-qrisk="0.5" class="${Math.abs(B.riskPct-0.5)<0.001?"on":""}">0.5%</button>
                <button type="button" data-qrisk="1" class="${Math.abs(B.riskPct-1)<0.001?"on":""}">1%</button>
                <button type="button" data-qrisk="2" class="${Math.abs(B.riskPct-2)<0.001?"on":""}">2%</button>
              </div>
            </div>
            <div>
              <span class="bt-sublbl">SL / TP bracket</span>
              <div class="bt-presets">${brackets.map(([k,n])=>`<button type="button" data-brk="${k}" class="${B.bracket===k?"on":""}">${esc(n)}</button>`).join("")}</div>
            </div>
            <div class="bt-orderf">
              <label>Stop Loss<input id="bt_sl" type="number" step="any" placeholder="Auto" inputmode="decimal"></label>
              <label>Take Profit<input id="bt_tp" type="number" step="any" placeholder="Auto" inputmode="decimal"></label>
            </div>
            <div id="bt_poshost"></div>
          </aside>
        </div>
      </div>

      <section class="vcard btres bt-drawer" id="bt_drawer" aria-labelledby="bt_rh" hidden>
        <div class="jrch">
          <h3 id="bt_rh">Session Drawer</h3>
          <div class="seg" id="bt_tabs" role="tablist" aria-label="Backtest views">
            <button type="button" id="bt_tab_pos" data-bttab="positions" role="tab" aria-selected="${BT.tab==="positions"}" class="${BT.tab==="positions"?"on":""}" onclick="btSetTab('positions')">Active Position (<span id="bt_cnt_pos">0</span>)</button>
            <button type="button" id="bt_tab_hist" data-bttab="history" role="tab" aria-selected="${BT.tab==="history"}" class="${BT.tab==="history"?"on":""}" onclick="btSetTab('history')">Trade History (<span id="bt_cnt_hist">0</span>)</button>
            <button type="button" id="bt_tab_eq" data-bttab="equity" role="tab" aria-selected="${BT.tab==="equity"}" class="${BT.tab==="equity"?"on":""}" onclick="btSetTab('equity')">Equity Curve</button>
          </div>
          <span class="sp"></span>
          <button type="button" id="bt_csv" disabled title="Export replay trades to CSV">Export CSV</button>
          <button type="button" class="bt-desk-x" onclick="document.getElementById('bt_drawer').hidden=true" aria-label="Close session drawer">×</button>
        </div>
        <div id="bt_out"></div>
      </section>

      <div class="bt-statusbar" role="status" aria-label="Backtest session status bar">
        <div class="bt-sb-left">
          <svg width="26" height="16" viewBox="-6 -4 412 246" fill="none" aria-hidden="true"><path d="M2 2 L66 2 L132 120 L161 70 L223 70 L132 234 Z" fill="currentColor"/><path d="M198 2 L398 2 L371 50 L306 51 L306 233 L253 233 L253 74 L266 51 L172 50 Z" fill="currentColor"/></svg>
          <span class="bt-sb-brand">VEKTOR</span>
        </div>
        <div class="bt-sb-right">
          <button type="button" class="bt-sb-ic" onclick="btToggleDrawer('positions')" title="Active Positions" aria-label="Toggle Active Positions drawer"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/></svg></button>
          <button type="button" class="bt-sb-ic" onclick="btToggleDrawer('history')" title="Trade History" aria-label="Toggle Trade History drawer"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></button>
          <button type="button" class="bt-sb-ic" onclick="btToggleDrawer('equity')" title="Equity Curve" aria-label="Toggle Equity Curve drawer"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/></svg></button>
          <span class="bt-sb-stat">Balance: <b id="bt_bar_bal">${jrAbs(B.bal)}</b></span>
          <span class="bt-sb-stat">Open Profit/Loss: <b id="bt_bar_pnl" class="bt-bar-v">$0.00</b></span>
          <button type="button" class="bt-exit-btn" id="bt_exit_session">Exit Session</button>
        </div>
      </div>
    </section>
  </div>`;

  const q=id=>document.getElementById(id);
  q("bt_sym").onchange=e=>{const v=e.target.value.trim().toUpperCase();if(!v)return;B.sym=v;if(typeof vtEnsureSym==="function")vtEnsureSym(v,true);save();el.querySelectorAll("[data-qsym]").forEach(x=>x.classList.toggle("on",x.dataset.qsym===v));btStop();btReplayInit(true)};
  el.querySelectorAll("[data-qsym]").forEach(btn=>btn.onclick=()=>{
    const v=btn.dataset.qsym;q("bt_sym").value=v;B.sym=v;if(typeof vtEnsureSym==="function")vtEnsureSym(v,true);save();
    el.querySelectorAll("[data-qsym]").forEach(x=>x.classList.toggle("on",x===btn));btStop();btReplayInit(true);
  });
  q("bt_tf").onchange=e=>{B.tf=e.target.value;if(q("bt_tf_s"))q("bt_tf_s").value=B.tf;el.querySelectorAll("[data-qtf]").forEach(x=>x.classList.toggle("on",x.dataset.qtf===B.tf));save();btStop();btReplayInit(true)};
  q("bt_tf_s").onchange=e=>{B.tf=e.target.value;if(q("bt_tf"))q("bt_tf").value=B.tf;el.querySelectorAll("[data-qtf]").forEach(x=>x.classList.toggle("on",x.dataset.qtf===B.tf));save();btStop();btReplayInit(true)};
  el.querySelectorAll("[data-qtf]").forEach(btn=>btn.onclick=()=>{
    const v=btn.dataset.qtf;B.tf=v;if(q("bt_tf"))q("bt_tf").value=v;if(q("bt_tf_s"))q("bt_tf_s").value=v;
    el.querySelectorAll("[data-qtf]").forEach(x=>x.classList.toggle("on",x===btn));save();btStop();btReplayInit(true);
  });
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
  q("bt_end").onchange=e=>{B.endAt=e.target.value;save()};
  q("bt_bal").onchange=e=>{B.bal=Math.max(100,+e.target.value||10000);el.querySelectorAll("[data-qbal]").forEach(x=>x.classList.toggle("on",+x.dataset.qbal===B.bal));save();if(BT.ses){BT.ses.startBal=B.bal;btRefreshAll()}};
  el.querySelectorAll("[data-qbal]").forEach(btn=>btn.onclick=()=>{
    const v=+btn.dataset.qbal;B.bal=v;if(q("bt_bal"))q("bt_bal").value=String(v);
    el.querySelectorAll("[data-qbal]").forEach(x=>x.classList.toggle("on",x===btn));save();if(BT.ses){BT.ses.startBal=v;btRefreshAll()}
  });
  el.querySelectorAll("[data-qlev]").forEach(btn=>btn.onclick=()=>{
    const v=+btn.dataset.qlev;B.leverage=v;el.querySelectorAll("[data-qlev]").forEach(x=>x.classList.toggle("on",x===btn));save();
  });
  q("bt_risk").onchange=e=>{B.riskPct=Math.max(0.05,Math.min(100,+e.target.value||1));save();if(BT.ses){BT.ses.riskPct=B.riskPct;btRefreshAll()}};
  el.querySelectorAll("[data-qrisk]").forEach(btn=>btn.onclick=()=>{
    const r=+btn.dataset.qrisk||1;B.riskPct=r;if(q("bt_risk"))q("bt_risk").value=String(r);save();if(BT.ses){BT.ses.riskPct=r;btRefreshAll()}
  });
  q("bt_fee").onchange=e=>{B.feePct=Math.max(0,+e.target.value||0);save();if(BT.ses){BT.ses.feePct=B.feePct;btRefreshAll()}};
  q("bt_reset").onclick=()=>{btStop();btNewSession(BT.D,B,btFindStartIdx(BT.D,B.startAt));if(q("bt_sl"))q("bt_sl").value="";if(q("bt_tp"))q("bt_tp").value="";btRefreshAll();toast("Replay session reset")};
  q("bt_start_session").onclick=async()=>{
    const v=(q("bt_sym").value||"").trim().toUpperCase();
    if(v){B.sym=v;if(typeof vtEnsureSym==="function")vtEnsureSym(v,true);save()}
    btSetPage("session");
    await btReplayInit(true);
  };
  q("bt_exit_session").onclick=()=>{btSetPage("setup")};
  q("bt_open_pos_btn").onclick=()=>{const d=q("bt_desk");if(d)d.hidden=!d.hidden};
  q("bt_quick_place_btn").onclick=()=>{const qp=q("bt_quick_pill");if(qp)qp.hidden=!qp.hidden};
  q("bt_goto_btn").onclick=()=>{if(!BT.D||!BT.D.a.length)return;btStop();const mid=Math.max(1,Math.floor(BT.D.a.length*0.5));btSeek(mid);toast("Jumped to 50% of replay window")};
  q("bt_save_btn").onclick=()=>{const c=q("bt_csv");if(c&&!c.disabled)c.click();else toast("Session state saved")};
  q("bt_fs_btn").onclick=()=>{const sp=q("bt_session_page");if(!sp)return;if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});else sp.requestFullscreen&&sp.requestFullscreen().catch(()=>{})};
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
  // Draggable Replay Playback Pill
  const pill=q("bt_rp_pill"),pdrag=q("bt_rp_drag");
  if(pill&&pdrag){
    pdrag.onpointerdown=e=>{
      e.preventDefault();
      const pr=pill.parentElement.getBoundingClientRect(),br=pill.getBoundingClientRect();
      const ox=e.clientX-br.left,oy=e.clientY-br.top;
      const mv=ev=>{
        const nx=Math.max(6,Math.min(pr.width-br.width-6,Math.round(ev.clientX-pr.left-ox)));
        const ny=Math.max(6,Math.min(pr.height-br.height-6,Math.round(ev.clientY-pr.top-oy)));
        pill.style.left=nx+"px";pill.style.top=ny+"px";pill.style.right="auto";
      };
      const up=()=>{window.removeEventListener("pointermove",mv);window.removeEventListener("pointerup",up)};
      window.addEventListener("pointermove",mv);window.addEventListener("pointerup",up);
    };
  }

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
