/* ---------- Backtest Lab ----------
   Tests simple rule-based strategies on the candles the app already has for a symbol (the same data as the charts, usually the latest
   ~250 bars), plus a bar-by-bar replay. No look-ahead: signals use a closed bar and fill at the next bar's open; when a bar touches both
   the stop and the target, the stop is assumed first. Results are hypothetical and shown with their limits. */
const BT_STRATS={ema:{name:"EMA cross",p:[["fast","Fast EMA",9,1,200],["slow","Slow EMA",21,2,400]]},rsi:{name:"RSI reversal",p:[["len","RSI length",14,2,100],["lo","Buy below then back above",30,1,50],["hi","Sell above then back below",70,50,99]]},
  brk:{name:"Breakout (N-bar high/low)",p:[["n","Look-back bars",20,2,200]]}};
const BT={res:null,err:"",rp:{i:0,on:false,timer:0},ch:null,ser:null};
function btCfg(){if(!S.bt||typeof S.bt!=="object")S.bt={};const B=S.bt;const d={sym:(S.chart&&S.chart.sym)||"BTCUSDT",tf:"1H",strat:"ema",dir:"both",stopMode:"atr",stopPct:1,atrMult:2,tgtR:2,oppExit:true,bal:10000,riskPct:1,feePct:0.05,speed:4};
  for(const k in d)if(B[k]==null||B[k]==="")B[k]=d[k];if(!B.p||typeof B.p!=="object")B.p={};for(const k in BT_STRATS)BT_STRATS[k].p.forEach(([n,,v])=>{const key=k+"."+n;if(!isFinite(+B.p[key]))B.p[key]=v});return B}
function btP(B,n){return +B.p[B.strat+"."+n]}
/* signals[i] = 1 (long), -1 (short) or 0, known at the close of bar i */
function btSignals(a,B){const c=a.map(x=>x.c),n=a.length,s=new Array(n).fill(0);
  if(B.strat==="ema"){const f=emaArr(c,btP(B,"fast")),sl=emaArr(c,btP(B,"slow")),w=Math.max(btP(B,"fast"),btP(B,"slow"));for(let i=Math.max(1,w);i<n;i++){if(f[i-1]<=sl[i-1]&&f[i]>sl[i])s[i]=1;else if(f[i-1]>=sl[i-1]&&f[i]<sl[i])s[i]=-1}}
  else if(B.strat==="rsi"){const r=rsiArr(c,btP(B,"len")),lo=btP(B,"lo"),hi=btP(B,"hi");for(let i=1;i<n;i++){if(r[i-1]==null||r[i]==null)continue;if(r[i-1]<lo&&r[i]>=lo)s[i]=1;else if(r[i-1]>hi&&r[i]<=hi)s[i]=-1}}
  else if(B.strat==="brk"){const N=btP(B,"n");for(let i=N;i<n;i++){let H=-Infinity,L=Infinity;for(let j=i-N;j<i;j++){H=Math.max(H,a[j].h);L=Math.min(L,a[j].l)}if(a[i].c>H)s[i]=1;else if(a[i].c<L)s[i]=-1}}
  return s}
function btIso(t){const d=new Date(t*1000);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")+"T"+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")}
function btRun(a,B,sym){if(!a||a.length<30)throw new Error("Not enough candles yet ("+(a?a.length:0)+"); at least 30 are needed.");
  const sig=btSignals(a,B),atr=atrArr(a,14),n=a.length,risk$=B.bal*B.riskPct/100,fee=B.feePct/100,out=[];let pos=null;
  const close=(i,px,why)=>{const q=pos.qty,f=(pos.entry+px)*q*fee;out.push({sym,side:pos.dir>0?"long":"short",entry:pos.entry,exit:px,qty:q,stop:pos.stop0,fees:+f.toFixed(6),open:btIso(a[pos.i].t),close:btIso(a[i].t),why,i0:pos.i,i1:i,tgt:pos.tgt});pos=null};
  for(let i=1;i<n;i++){const b=a[i];let hitIn=false;
    if(pos){const d=pos.dir;/* stop first, then target; gaps fill at the open */
      if(d>0&&b.l<=pos.stop){close(i,b.o<pos.stop?b.o:pos.stop,"stop")}else if(d<0&&b.h>=pos.stop){close(i,b.o>pos.stop?b.o:pos.stop,"stop")}
      else if(pos.tgt!=null&&(d>0?b.h>=pos.tgt:b.l<=pos.tgt)){close(i,d>0?(b.o>pos.tgt?b.o:pos.tgt):(b.o<pos.tgt?b.o:pos.tgt),"target")}}
    hitIn=!pos&&out.length&&out[out.length-1].i1===i;/* a stop/target filled inside this bar: no new entry at this bar's (earlier) open */
    const s=sig[i-1];/* the signal from the previous closed bar acts at this bar's open */
    if(s&&pos&&B.oppExit&&s===-pos.dir&&pos.i<i)close(i,b.o,"opposite signal");
    if(s&&!pos&&!hitIn&&(B.dir==="both"||(B.dir==="long"&&s>0)||(B.dir==="short"&&s<0))){const e=b.o;let dist=B.stopMode==="pct"?e*B.stopPct/100:(atr[i-1]||0)*B.atrMult;if(!(dist>0))continue;
      const qty=risk$/dist;pos={dir:s,entry:e,qty,i,stop:e-s*dist,stop0:e-s*dist,tgt:B.tgtR>0?e+s*dist*B.tgtR:null};
      /* the entry bar itself can hit the stop or target */
      if(s>0&&b.l<=pos.stop)close(i,pos.stop,"stop");else if(s<0&&b.h>=pos.stop)close(i,pos.stop,"stop");else if(pos.tgt!=null&&(s>0?b.h>=pos.tgt:b.l<=pos.tgt))close(i,pos.tgt,"target")}}
  if(pos)close(n-1,a[n-1].c,"end of data");
  const st=jrStats(out),first=a[1].o,last=a[n-1].c;return{trades:out,st,bars:n,from:a[0].t,to:a[n-1].t,hold:(last/first-1),sig}}
function btBuild(){const el=document.getElementById("pv-backtest");if(!el)return;const B=btCfg();
  const num=(k,lab,step,min,max)=>`<label>${lab}<input type="number" id="bt_${k.replace(".","_")}" data-k="${k}" value="${esc(String(k.includes(".")?B.p[k]:B[k]))}" step="${step||"any"}"${min!=null?` min="${min}"`:""}${max!=null?` max="${max}"`:""} inputmode="decimal"></label>`;
  const sel=(k,lab,opts)=>`<label>${lab}<select id="bt_${k}" data-k="${k}">${opts.map(([v,n])=>`<option value="${v}"${String(B[k])===String(v)?" selected":""}>${esc(n)}</option>`).join("")}</select></label>`;
  el.innerHTML=`<div class="pgw bt"><div class="pgh"><h2>Backtest Lab</h2><span class="mut">Test simple rule-based strategies on the candles loaded for a symbol, then replay them bar by bar. Hypothetical results only.</span></div>
<div class="btgrid"><form class="vcard btform" id="bt_f" novalidate><h3>Strategy</h3><div class="frm">
<label>Symbol<input id="bt_sym" data-k="sym" value="${esc(B.sym)}" list="bt_syms" autocomplete="off"></label><datalist id="bt_syms">${(typeof SYMS!=="undefined"?SYMS:[]).slice(0,500).map(s=>`<option value="${esc(s[0])}">`).join("")}</datalist>
${sel("tf","Timeframe",["15m","1H","4H","1D"].map(x=>[x,x]))}${sel("strat","Rules",Object.keys(BT_STRATS).map(k=>[k,BT_STRATS[k].name]))}
${BT_STRATS[B.strat].p.map(([n,l,,mi,ma])=>num(B.strat+"."+n,l,1,mi,ma)).join("")}
${sel("dir","Direction",[["both","Long and short"],["long","Long only"],["short","Short only"]])}${sel("stopMode","Stop",[["atr","ATR(14) multiple"],["pct","% of entry"]])}
${B.stopMode==="atr"?num("atrMult","ATR multiple",0.1,0.1,20):num("stopPct","Stop %",0.1,0.01,50)}${num("tgtR","Target (R, 0 = none)",0.5,0,20)}
${num("bal","Starting balance ($)",100,1)}${num("riskPct","Risk per trade (%)",0.1,0.01,100)}${num("feePct","Fees per side (%)",0.01,0,5)}</div>
<label class="chk"><input type="checkbox" id="bt_opp"${B.oppExit?" checked":""}> Exit on the opposite signal</label>
<div class="row jrbtns"><button type="submit" class="pri" id="bt_run">Run backtest</button></div><p class="vsmsg err" id="bt_err" role="alert"></p>
<p class="cnote">Signals use closed bars and fill at the next bar\u2019s open. Stops and targets fill at their level (or the open if price gaps past it). If a bar touches both, the stop counts first. Fees apply to both sides; spreads, slippage, funding and liquidity are not modelled.</p></form>
<section class="vcard btres" aria-labelledby="bt_rh"><div class="jrch"><h3 id="bt_rh">Results</h3><span class="sp"></span><span class="mut" id="bt_meta"></span></div><div id="bt_out"><p class="mut">Pick a symbol and rules, then press <b>Run backtest</b>.</p></div></section></div>
<section class="vcard" aria-labelledby="bt_rph"><div class="jrch"><h3 id="bt_rph">Bar replay</h3><span class="sp"></span><span class="mut" id="bt_rpinfo" role="status" aria-live="off"></span></div>
<div class="btrpc" role="group" aria-label="Replay controls"><button type="button" id="bt_rs" aria-label="Back to start">\u23ee</button><button type="button" id="bt_rb" aria-label="Step back one bar">\u25c0</button><button type="button" id="bt_rp" class="pri" aria-label="Play">\u25b6 Play</button><button type="button" id="bt_rf" aria-label="Step forward one bar">\u25b6\u2502</button><button type="button" id="bt_re" aria-label="Jump to the end">\u23ed</button>
<label class="btspd">Speed<select id="bt_spd">${[1,2,4,8,16].map(v=>`<option value="${v}"${+B.speed===v?" selected":""}>${v} bars/s</option>`).join("")}</select></label><input type="range" id="bt_rr" min="1" max="1" value="1" aria-label="Replay position"></div>
<div id="bt_cv" class="btcv"></div><p class="cnote">Replay shows the candles up to the current bar with the backtest\u2019s entries and exits so far. Use the Left and Right arrow keys on the slider to step.</p></section>
<p class="cnote">Backtests are hypothetical, use a short history (the candles loaded for this symbol) and don\u2019t predict future results. Not financial advice.</p></div>`;
  const q=id=>document.getElementById(id),f=q("bt_f");
  f.querySelectorAll("[data-k]").forEach(i=>i.onchange=()=>{const k=i.dataset.k,v=i.type==="number"?+i.value:i.value.trim().toUpperCase();if(k.includes("."))B.p[k]=v;else B[k]=k==="sym"?v:i.type==="number"?v:i.value;save();if(k==="strat"||k==="stopMode")btBuild()});
  q("bt_opp").onchange=e=>{B.oppExit=e.target.checked;save()};
  f.onsubmit=e=>{e.preventDefault();btGo()};
  q("bt_rs").onclick=()=>btSeek(1);q("bt_re").onclick=()=>btSeek(Infinity);q("bt_rb").onclick=()=>btSeek(BT.rp.i-1);q("bt_rf").onclick=()=>btSeek(BT.rp.i+1);q("bt_rp").onclick=btPlay;
  q("bt_spd").onchange=e=>{B.speed=+e.target.value;save();if(BT.rp.on){btStop();btPlay()}};q("bt_rr").oninput=e=>btSeek(+e.target.value);
  if(BT.res)btShow();else btReplayInit()}
function btGo(){const B=btCfg(),er=document.getElementById("bt_err");er.textContent="";btStop();const s=symOf(B.sym);
  if(!s){er.textContent="Unknown symbol \u201c"+B.sym+"\u201d. Pick one from the list.";return}
  if(BT_STRATS[B.strat].p.some(([n,,,mi,ma])=>!(btP(B,n)>=mi&&btP(B,n)<=ma))){er.textContent="Check the rule settings: a value is outside its range.";return}
  if(B.strat==="ema"&&btP(B,"fast")>=btP(B,"slow")){er.textContent="The fast EMA must be shorter than the slow EMA.";return}
  if(!(B.bal>0&&B.riskPct>0&&(B.stopMode==="atr"?B.atrMult>0:B.stopPct>0))){er.textContent="Balance, risk and stop must be above zero.";return}
  const a=candles(s,B.tf);if(!a||a.length<30){if(typeof isLive==="function"&&isLive()&&typeof need==="function")need(s,B.tf,true);er.textContent=a&&a.length?"Only "+a.length+" candles so far; loading more\u2026 try again in a moment.":"Loading "+B.sym+" "+B.tf+" candles\u2026 try again in a moment.";
    clearTimeout(BT.wait);BT.wait=setTimeout(()=>{const b=candles(s,B.tf);if(b&&b.length>=30&&document.getElementById("bt_err")&&/Loading|loading/.test(document.getElementById("bt_err").textContent))btGo()},2500);return}
  try{BT.res=Object.assign(btRun(a.slice(),B,B.sym),{sym:B.sym,tf:B.tf,cfg:JSON.parse(JSON.stringify(B)),sample:typeof isLive==="function"&&!isLive()})}catch(e){er.textContent=e.message;return}
  BT.rp.i=BT.res.bars;btShow()}
function btShow(){const R=BT.res,o=document.getElementById("bt_out");if(!o||!R)return;const st=R.st,B=R.cfg;
  document.getElementById("bt_meta").textContent=R.sym+" "+R.tf+" \u00b7 "+R.bars+" bars \u00b7 "+new Date(R.from*1000).toLocaleDateString("en-GB")+" \u2013 "+new Date(R.to*1000).toLocaleDateString("en-GB");
  const k=(l,v,c,t)=>`<div class="kpi"${t?` title="${esc(t)}"`:""}><div class="k">${l}</div><div class="v ${c||""}">${v}</div></div>`;const ret=st.net/B.bal;
  o.innerHTML=(R.sample?`<p class="vsmsg err">Offline sample data: these candles are simulated, so the results mean nothing.</p>`:"")+`<div class="jrkpis">${k("Net result",jrUsd(st.net),jrCls(st.net))+k("Return",(ret>0?"+":"")+(ret*100).toFixed(2)+"%",jrCls(ret),"Net result \u00f7 starting balance")+k("Trades",String(st.n))+k("Win rate",jrPct(st.winRate))+k("Profit factor",jrFx(st.pf))+k("Average R",jrRf(st.avgR))+k("Max drawdown",st.maxDD?"\u2212"+jrAbs(st.maxDD):"$0.00",st.maxDD?"neg":"")+k("Market change",(R.hold>0?"+":"")+(R.hold*100).toFixed(2)+"%",jrCls(R.hold),"Price change from the first possible entry to the last close, for comparison")}</div>
<canvas id="bt_eq" height="180" role="img" aria-label="Backtest equity curve"></canvas>
${st.n<30?`<p class="cnote">Only ${st.n} trade${st.n===1?"":"s"}: too few to judge a strategy.</p>`:""}
<div class="jrch"><h4>Trades</h4><span class="sp"></span><button type="button" id="bt_csv"${st.n?"":" disabled"}>Export CSV</button></div>
<div class="jrtw" tabindex="0" role="region" aria-label="Backtest trades"><table class="ftbl jrt"><thead><tr><th class="l">Entry</th><th class="l">Side</th><th>Entry px</th><th>Exit px</th><th class="l">Exit</th><th class="l">Reason</th><th>P\u0026L</th><th>R</th></tr></thead><tbody>${R.trades.slice().reverse().map(t=>{const p=jrPnl(t),r=jrR(t);return`<tr><td class="l">${esc(t.open.replace("T"," "))}</td><td class="l"><span class="jrside ${t.side}">${t.side==="short"?"Short":"Long"}</span></td><td>${fp(t.entry)}</td><td>${fp(t.exit)}</td><td class="l">${esc(t.close.replace("T"," "))}</td><td class="l">${esc(t.why)}</td><td class="${jrCls(p)}">${jrUsd(p)}</td><td>${jrRf(r)}</td></tr>`}).join("")||`<tr><td class="l mut" colspan="8">No signals in this period.</td></tr>`}</tbody></table></div>`;
  btEq(st,B.bal);const c=document.getElementById("bt_csv");if(c)c.onclick=()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+jrToCsv(R.trades.map(t=>Object.assign({},t,{acct:"Backtest",setup:BT_STRATS[B.strat].name,notes:"Hypothetical backtest: "+t.why})))],{type:"text/csv"}));a.download="vektor-backtest-"+R.sym+"-"+R.tf+".csv";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)};
  btReplayInit()}
function btEq(st,bal){const cv=document.getElementById("bt_eq");if(!cv)return;const w=cv.clientWidth||500,h=180,dpr=window.devicePixelRatio||1;cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);cv.style.height=h+"px";const g=cv.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);
  const css=getComputedStyle(document.documentElement),col=n=>css.getPropertyValue(n).trim()||"#888",pts=[bal,...st.curve.map(c=>bal+c.eq)];if(pts.length<2){g.fillStyle=col("--mut");g.font="13px system-ui,sans-serif";g.textAlign="center";g.fillText("No trades",w/2,h/2);return}
  const lo=Math.min(...pts),hi=Math.max(...pts),pd=(hi-lo)*.08||1,L=lo-pd,H=hi+pd,X=i=>6+i*(w-70)/(pts.length-1),Y=v=>h-14-(v-L)/(H-L)*(h-24);
  g.strokeStyle=col("--line");g.setLineDash([3,3]);g.beginPath();g.moveTo(6,Y(bal));g.lineTo(w-64,Y(bal));g.stroke();g.setLineDash([]);g.fillStyle=col("--mut");g.font="11px system-ui,sans-serif";[hi,lo].forEach(v=>g.fillText("$"+Math.round(v).toLocaleString("en-US"),w-60,Y(v)+4));
  g.strokeStyle=pts[pts.length-1]>=bal?col("--g"):col("--r");g.lineWidth=2;g.beginPath();pts.forEach((v,i)=>i?g.lineTo(X(i),Y(v)):g.moveTo(X(i),Y(v)));g.stroke();cv.setAttribute("aria-label","Backtest equity from $"+bal+" to $"+Math.round(pts[pts.length-1]))}
/* ---- replay */
function btData(){const B=btCfg(),R=BT.res,s=symOf(R?R.sym:B.sym);if(!s||typeof vtBars!=="function")return null;return vtBars(s,R?R.tf:B.tf)}
function btReplayInit(){const host=document.getElementById("bt_cv");if(!host)return;if(BT.ch){try{BT.ch.remove()}catch(e){}BT.ch=null}
  const D=btData(),info=document.getElementById("bt_rpinfo"),rr=document.getElementById("bt_rr");if(!D||!window.LightweightCharts){host.innerHTML=`<p class="mut">${BT.res?"Candles not available for replay yet.":"Run a backtest to replay it here."}</p>`;info.textContent="";return}
  host.innerHTML="";const B=btCfg();BT.ch=LightweightCharts.createChart(host,vtChartOpts(BT.res?BT.res.tf:B.tf));BT.ser=BT.ch.addCandlestickSeries(vtCandleOpts(symOf(BT.res?BT.res.sym:B.sym)));BT.D=D;
  rr.max=String(D.D.length);BT.rp.i=Math.max(1,Math.min(BT.rp.i||D.D.length,D.D.length));btSeek(BT.rp.i)}
function btSeek(i){const D=BT.D;if(!D||!BT.ser)return;i=Math.max(1,Math.min(D.D.length,Math.round(i)||1));BT.rp.i=i;BT.ser.setData(D.D.slice(0,i));
  const R=BT.res,mk=[];if(R&&R.bars===D.D.length)R.trades.forEach(t=>{if(t.i0<i)mk.push({time:D.D[t.i0].time,position:t.side==="long"?"belowBar":"aboveBar",color:t.side==="long"?"#26a69a":"#ef5350",shape:t.side==="long"?"arrowUp":"arrowDown",text:t.side==="long"?"L":"S"});if(t.i1<i)mk.push({time:D.D[t.i1].time,position:t.side==="long"?"aboveBar":"belowBar",color:"#9aa4b2",shape:"circle",text:t.why==="target"?"T":t.why==="stop"?"S":"X"})});
  mk.sort((a,b)=>a.time-b.time);try{BT.ser.setMarkers(mk)}catch(e){}
  const rr=document.getElementById("bt_rr");if(rr){rr.value=String(i);rr.setAttribute("aria-valuetext","Bar "+i+" of "+D.D.length)}
  const z=D.a[i-1],info=document.getElementById("bt_rpinfo");if(info&&z)info.textContent="Bar "+i+" / "+D.D.length+" \u00b7 "+new Date(z.t*1000).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})+" \u00b7 close "+fp(z.c)}
function btPlay(){const b=document.getElementById("bt_rp");if(BT.rp.on){btStop();return}if(!BT.D)return;if(BT.rp.i>=BT.D.D.length)btSeek(1);BT.rp.on=true;if(b){b.textContent="\u23f8 Pause";b.setAttribute("aria-label","Pause")}
  const ms=1000/Math.max(1,+btCfg().speed||4);BT.rp.timer=setInterval(()=>{if(!BT.D||BT.rp.i>=BT.D.D.length){btStop();return}btSeek(BT.rp.i+1)},ms)}
function btStop(){clearInterval(BT.rp.timer);BT.rp.on=false;const b=document.getElementById("bt_rp");if(b){b.textContent="\u25b6 Play";b.setAttribute("aria-label","Play")}}
PAGE_HOOK.backtest={enter(){btBuild()},leave(){btStop()},sub(){}};
addEventListener("resize",deb(()=>{if(document.documentElement.dataset.page==="backtest"&&BT.res)btEq(BT.res.st,BT.res.cfg.bal)},200));
