// Tasks 9-11: the chart is a dumb terminal. Its history arrives with server-computed indicator series in ONE
// /api/candles?ind= request, live candles are the hub's `bar` frames rendered verbatim, and closed-bar indicator values
// are the hub's `ind` frames. Browser quote ticks never build or reshape candles.
const assert=require("assert");const {launch}=require("./harness");
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT")&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1);

// 1. One request: bars + every indicator the chart shows (default EMA 10/20, plus SMA, BB and RSI added here).
await P.evaluate(()=>{S.chart.ind=[{id:"a",t:"ema",len:10,col:"#f97316"},{id:"b",t:"sma",len:20,col:"#22c55e"},{id:"c",t:"bb",len:20,col:"#64748b"},{id:"d",t:"rsi",len:14,col:"#a855f7"}];save();openChart("ETHUSDT","1H")});
await P.waitForFunction(()=>vtChartMeta&&vtChartMeta.sym==="ETHUSDT"&&vtChartMeta.indSeries.length===3&&vtChartMeta.rsiSer&&vtIndMissing("ETHUSDT","1H").length===0,null,{timeout:10000});
const calls=h.candleCalls.filter(q=>/symbol=ETHUSDT/.test(q)&&/interval=1H/.test(q));
assert.ok(calls.length>=1,"history request carried ind=: "+JSON.stringify(h.candleCalls));
assert.ok(decodeURIComponent(calls[0]).includes("ind=ema:10,sma:20,bb:20:2,rsi:14"),"all specs in one request: "+calls[0]);

// 2. Rendered indicator values are the server's points, not browser maths.
const r=await P.evaluate(()=>{const a=LIVE["ETHUSDT|1H"],last=a[a.length-1];
  const srv=id=>vtIndPoints("ETHUSDT","1H",id).get(last.t);
  const legend=[...document.querySelectorAll("#vt_ind_legend .vt-ind-val")].map(e=>e.textContent);
  return{n:a.length,ema:srv("ema:10"),sma:srv("sma:20"),bb:srv("bb:20:2"),rsi:srv("rsi:14"),legend,emaFp:fp(srv("ema:10"),symOf("ETHUSDT"))}});
assert.ok(r.n>=200,"history loaded: "+r.n);
assert.ok(isFinite(r.ema)&&isFinite(r.sma)&&isFinite(r.rsi)&&r.bb&&r.bb.upper>r.bb.lower,"server series present: "+JSON.stringify(r));
assert.ok(r.legend.includes(r.emaFp),"legend shows the server EMA value: "+JSON.stringify(r));
assert.ok(r.legend.includes(r.rsi.toFixed(1)),"legend shows the server RSI value: "+JSON.stringify(r));

// 3. The WS view asks the hub for the same indicators (view sends are rate-limited to ~550 ms, so wait for the frame).
await P.waitForFunction(()=>{try{const v=JSON.parse(VT_EDGE.wsLastViewKey||"{}");return v.chart&&v.chart.sym==="ETHUSDT"&&Array.isArray(v.chart.ind)&&v.chart.ind.length===4}catch(e){return false}},null,{timeout:5000}).catch(()=>{});
const view=await P.evaluate(()=>JSON.parse(VT_EDGE.wsLastViewKey||"{}"));
assert.deepStrictEqual(view.chart&&view.chart.ind,["ema:10","sma:20","bb:20:2","rsi:14"],"view.chart.ind: "+JSON.stringify(view));

// 4. Quote ticks never touch candles; hub `bar` frames are rendered verbatim (replace forming, append new).
const live=await P.evaluate(()=>{const k="ETHUSDT|1H",a=LIVE[k],last=a[a.length-1],before=JSON.stringify(last),len=a.length;
  __edge.quotes([{s:"ETHUSDT",c:last.c*1.05,t:(last.t+30)*1000}]);
  const afterQuote=JSON.stringify(LIVE[k][LIVE[k].length-1]),lenQ=LIVE[k].length;
  const ws=__edge.sockets[__edge.sockets.length-1];
  __edge.push(__edge.frame("bar",{sym:"ETHUSDT",tf:"1H",bar:[last.t,last.o,last.h*1.01,last.l,last.c*1.002,last.v+5],closed:true}),ws);
  const replaced=LIVE[k][LIVE[k].length-1];
  const nt=last.t+3600;
  __edge.push(__edge.frame("bar",{sym:"ETHUSDT",tf:"1H",bar:[nt,7,9,6,8,1],closed:false}),ws);
  const appended=LIVE[k][LIVE[k].length-1];
  return{before,afterQuote,len,lenQ,replaced,appended,lenB:LIVE[k].length,nt,lastT:last.t,h:last.h*1.01}});
assert.strictEqual(live.afterQuote,live.before,"a quote tick must not modify the forming candle");
assert.strictEqual(live.lenQ,live.len,"a quote tick must not append candles");
assert.strictEqual(live.replaced.t,live.lastT);assert.strictEqual(live.replaced.h,live.h,"server bar replaces the forming bar verbatim");
assert.deepStrictEqual([live.appended.t,live.appended.o,live.appended.h,live.appended.l,live.appended.c],[live.nt,7,9,6,8],"new server bar appended verbatim (no client open/high/low reshaping)");
assert.strictEqual(live.lenB,live.len+1);

// 5. A hub `ind` frame for the closed bar updates the stored point and the legend.
const ind=await P.evaluate(lastT=>{const ws=__edge.sockets[__edge.sockets.length-1];
  __edge.push(__edge.frame("ind",{sym:"ETHUSDT",tf:"1H",id:"ema:10",point:{t:lastT,v:123.456}}),ws);
  __edge.push(__edge.frame("ind",{sym:"ETHUSDT",tf:"1H",id:"bb:20:2",point:{t:lastT,v:{upper:130,middle:125,lower:120}}}),ws);
  return{ema:vtIndPoints("ETHUSDT","1H","ema:10").get(lastT),bb:vtIndPoints("ETHUSDT","1H","bb:20:2").get(lastT),
    legend:[...document.querySelectorAll("#vt_ind_legend .vt-ind-val")].map(e=>e.textContent)}},live.lastT);
assert.strictEqual(ind.ema,123.456);assert.strictEqual(ind.bb.upper,130);
assert.ok(ind.legend.includes(await P.evaluate(()=>fp(123.456,symOf("ETHUSDT")))),"legend follows the ind frame: "+JSON.stringify(ind.legend));

// 6. Adding an indicator fetches it from the server instead of computing it.
const n0=h.candleCalls.length;
await P.evaluate(()=>{S.chart.ind.push({id:"e",t:"ema",len:50,col:"#eab308"});save();drawChart()});
await P.waitForFunction(()=>vtIndMissing("ETHUSDT","1H").length===0&&vtChartMeta.indSeries.length===4,null,{timeout:10000});
assert.ok(h.candleCalls.slice(n0).some(q=>decodeURIComponent(q).includes("ema:50")),"new spec requested from the server");

assert.deepStrictEqual(h.offOrigin,[],"no non-origin requests");
assert.deepStrictEqual(h.errors,[],"no page errors");
assert.deepStrictEqual(h.consoleErr,[],"no console errors");
console.log("server-indicators: ok");await h.close()})().catch(e=>{console.error(e);process.exit(1)});
