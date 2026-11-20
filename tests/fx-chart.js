// FX chart: sparse /ws quote ticks must build candles with visible bodies, in the browser's live-bar path.
// FX opens each new bar at the previous close (continuous market). Crypto keeps tick-open. Also checks the rendered
// canvas actually contains candle pixels in the up/down colours for an FX chart (not just data).
const assert=require("assert");const {launch}=require("./harness");
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&SYMS.some(s=>s[0]==="GBPUSD")&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1);

for(const [sym,tf] of [["GBPUSD","1m"],["GBPUSD","5m"],["EURUSD","1H"]]){
  await P.evaluate(([s,t])=>openChart(s,t),[sym,tf]);
  await P.waitForFunction(([s,t])=>LIVE[s+"|"+t]&&LIVE[s+"|"+t].length>50,[sym,tf]);
  const r=await P.evaluate(([s,t])=>{const k=s+"|"+t,step=STEP[t],a0=LIVE[k],last=a0[a0.length-1];
    let p=last.c,ts=last.t+step;const startLen=a0.length;
    // one quote per bucket, like a quiet FX feed: every new bar is born from a single tick
    for(let i=0;i<40;i++){p=+(p*(1+Math.sin(i*1.3)*0.0002)).toFixed(5);__edge.quotes([{s,c:p,t:ts+i*step+5}])}
    const a=LIVE[k].slice(startLen-1);let flat=0,linked=0,n=0;
    for(let i=1;i<a.length;i++){const b=a[i];n++;if(b.o===b.h&&b.h===b.l&&b.l===b.c)flat++;if(b.o===a[i-1].c)linked++}
    return{n,flat,linked}},[sym,tf]);
  assert.ok(r.n>=30,sym+" "+tf+" new bars were built: "+JSON.stringify(r));
  assert.ok(r.flat/r.n<0.1,sym+" "+tf+" flat one-tick dashes: "+JSON.stringify(r));
  assert.ok(r.linked/r.n>0.9,sym+" "+tf+" each new FX bar opens at the previous close: "+JSON.stringify(r));
}

// crypto keeps tick-open: a new bar is a point at its first tick, not stitched to the previous close
await P.evaluate(()=>openChart("BTCUSDT","1m"));
await P.waitForFunction(()=>LIVE["BTCUSDT|1m"]&&LIVE["BTCUSDT|1m"].length>50);
const c=await P.evaluate(()=>{const a=LIVE["BTCUSDT|1m"],last=a[a.length-1],px=last.c*1.004;__edge.quotes([{s:"BTCUSDT",c:px,t:last.t+65}]);const b=LIVE["BTCUSDT|1m"].slice(-1)[0];return{o:b.o,px,prev:last.c,t:b.t}});
assert.strictEqual(c.o,c.px,"crypto new bar opens at its first tick: "+JSON.stringify(c));

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
