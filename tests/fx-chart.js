// FX chart: live candles are the hub's `bar` frames rendered verbatim (Task 11). The hub's candle builder opens each new
// FX bar at the previous close (shared/market/candles.js openMode "auto", covered by tests/fx-candles.test.mjs); the
// browser must keep those opens exactly as sent and never build or reshape a candle from quote ticks.
// Also checks the rendered canvas actually contains candle pixels in the up/down colours for an FX chart.
const assert=require("assert");const {launch}=require("./harness");
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&SYMS.some(s=>s[0]==="GBPUSD")&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1);

for(const [sym,tf] of [["GBPUSD","1m"],["GBPUSD","5m"],["EURUSD","1H"]]){
  await P.evaluate(([s,t])=>openChart(s,t),[sym,tf]);
  await P.waitForFunction(([s,t])=>LIVE[s+"|"+t]&&LIVE[s+"|"+t].length>50,[sym,tf]);
  const r=await P.evaluate(([s,t])=>{const k=s+"|"+t,step=STEP[t],a0=LIVE[k],last=a0[a0.length-1];
    let prev=last.c;const startLen=a0.length,sent=[];
    // a quiet FX feed as the hub emits it: one bar per bucket, opening at the previous close
    for(let i=1;i<=40;i++){const c=+(prev*(1+Math.sin(i*1.3)*0.0002)).toFixed(5),o=prev,bar=[last.t+i*step,o,Math.max(o,c),Math.min(o,c),c,0];
      sent.push(bar);__edge.push(__edge.frame("bar",{sym:s,tf:t,bar,closed:false}));prev=c}
    // quote ticks in between must not touch the series
    __edge.quotes([{s,c:prev*1.01,t:(last.t+40*step+5)*1000}]);
    const got=LIVE[k].slice(startLen).map(b=>[b.t,b.o,b.h,b.l,b.c,b.v]);
    return{sent,got,len:LIVE[k].length,startLen}},[sym,tf]);
  assert.strictEqual(r.len,r.startLen+40,sym+" "+tf+" one candle per server bar frame");
  assert.deepStrictEqual(r.got,r.sent,sym+" "+tf+" server bars rendered verbatim (opens kept at the previous close)");
}

// crypto: whatever open the hub sends is rendered as-is (tick-open in the builder), never stitched by the client
await P.evaluate(()=>openChart("BTCUSDT","1m"));
await P.waitForFunction(()=>LIVE["BTCUSDT|1m"]&&LIVE["BTCUSDT|1m"].length>50);
const c=await P.evaluate(()=>{const a=LIVE["BTCUSDT|1m"],last=a[a.length-1],px=last.c*1.004;
  __edge.push(__edge.frame("bar",{sym:"BTCUSDT",tf:"1m",bar:[last.t+60,px,px,px,px,0],closed:false}));
  const b=LIVE["BTCUSDT|1m"].slice(-1)[0];return{o:b.o,px,prev:last.c,t:b.t}});
assert.strictEqual(c.o,c.px,"crypto server bar keeps its own open: "+JSON.stringify(c));

// rendered chart: an FX candle chart paints coloured bodies (not hairlines): count candle-coloured pixels in the plot
await P.evaluate(()=>openChart("GBPUSD","1H"));
await P.waitForFunction(()=>LIVE["GBPUSD|1H"]&&LIVE["GBPUSD|1H"].length>50);await P.waitForTimeout(900);
const px=await P.evaluate(()=>{const cv=[...document.querySelectorAll("#cv canvas")];let best=0;
  for(const c of cv){try{const g=c.getContext("2d"),w=c.width,hh=c.height,d=g.getImageData(0,0,w,hh).data;let n=0;
    for(let i=0;i<d.length;i+=4){const r=d[i],gr=d[i+1],b=d[i+2],a=d[i+3];if(a>200&&((gr>140&&r<60&&b<110)||(r>190&&gr<70&&b<70)))n++}
    best=Math.max(best,n)}catch(e){}}
  return best});
assert.ok(px>1500,"FX chart paints solid candle bodies (green/red pixels): "+px);
assert.deepStrictEqual(h.offOrigin,[],"no non-origin requests");
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("fx-chart: ok (candle pixels "+px+")");await h.close()})().catch(e=>{console.error(e);process.exit(1)});
