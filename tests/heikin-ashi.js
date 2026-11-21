// Heikin Ashi is computed server-side only (shared/market/chartTransforms.js heikinAshi) and renders identically on
// the live chart (/api/candles?type=heikin) and in backtest replay (POST /api/chart/transform, sliced per bar).
const assert=require("assert");const {launch}=require("./harness");
const {heikinAshi}=require("../shared/market/chartTransforms.js");
const near=(a,b)=>Math.abs(a-b)<1e-9;
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1&&SYMS.some(s=>s[0]==="BTCUSDT"));
assert.strictEqual(await P.evaluate(()=>typeof vtToHeikinAshi),"undefined","no browser Heikin Ashi maths");

// live chart
await P.evaluate(()=>{go("chart");openChart("BTCUSDT","1H");vtSetChartType("heikin")});
await P.waitForFunction(()=>VT_XF.data["BTCUSDT|1H|heikin"]&&vtChartMeta&&vtChartMeta.candleSer&&vtChartMeta.candleSer.data().length>50,null,{timeout:15000});
assert.ok(h.candleCalls.some(q=>/type=heikin/.test(q)),"requested from /api/candles");
const live=await P.evaluate(()=>({rows:vtChartMeta.candleSer.data().map(r=>[r.time,r.open,r.high,r.low,r.close]),src:LIVE["BTCUSDT|1H"].map(b=>({t:b.t,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v}))}));
const want=heikinAshi(live.src).bars;
assert.strictEqual(live.rows.length,want.length,"one HA bar per server bar");
assert.ok(live.rows.every((r,i)=>r[0]===want[i].t&&near(r[1],want[i].o)&&near(r[2],want[i].h)&&near(r[3],want[i].l)&&near(r[4],want[i].c)),"live chart HA = server heikinAshi of the same bars");
// raw live bars never enter the HA series
const before=await P.evaluate(()=>JSON.stringify(vtChartMeta.candleSer.data().slice(-2)));
await P.evaluate(()=>{const a=LIVE["BTCUSDT|1H"],l=a[a.length-1];__edge.push(__edge.frame("bar",{sym:"BTCUSDT",tf:"1H",bar:[l.t,l.o,l.h*1.01,l.l,l.c*1.005,1],closed:false}))});
assert.strictEqual(await P.evaluate(()=>JSON.stringify(vtChartMeta.candleSer.data().slice(-2))),before,"no raw bar written into the HA series");
await P.evaluate(()=>vtSetChartType("candles"));

// backtest replay
await P.evaluate(()=>{location.hash="#/backtest"});await P.waitForSelector("#bt_setup_page #bt_f");
await P.evaluate(()=>need(symOf("BTCUSDT"),"1H",true));await P.waitForFunction(()=>(candles(symOf("BTCUSDT"),"1H")||[]).length>=100);
await P.fill("#bt_sym","BTCUSDT");await P.dispatchEvent("#bt_sym","change");
await P.click("#bt_start_session");
await P.waitForFunction(()=>!document.getElementById("bt_session_page").hidden&&BT.D&&BT.D.a.length>=25&&BT.ses&&BT.ser,null,{timeout:30000});
await P.evaluate(()=>{btSetChartType("heikin");btSeek(Math.min(BT.D.a.length-1,60))});
await P.waitForFunction(()=>BT.ser.data().length>10,null,{timeout:10000});
assert.ok(h.candleCalls.some(q=>/^POST transform heikin/.test(q)),"backtest asked the server: "+h.candleCalls.slice(-2));
const bt=await P.evaluate(()=>({rows:BT.ser.data().map(r=>[r.time,r.open,r.high,r.low,r.close]),i:BT.rp.i,src:BT.D.a.map(b=>({t:b.t,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v||0}))}));
const full=heikinAshi(bt.src).bars,slice=full.slice(0,bt.i);
assert.strictEqual(bt.rows.length,slice.length,"replay shows bars up to the cursor");
assert.ok(bt.rows.every((r,k)=>r[0]===slice[k].t&&near(r[1],slice[k].o)&&near(r[4],slice[k].c)&&near(r[2],slice[k].h)&&near(r[3],slice[k].l)),"backtest HA = server heikinAshi, sliced");
// stepping forward reveals the next HA bar exactly
await P.evaluate(()=>btSeek(BT.rp.i+3));
const step=await P.evaluate(()=>({n:BT.ser.data().length,last:BT.ser.data().slice(-1)[0],i:BT.rp.i}));
assert.ok(step.n===step.i&&near(step.last.close,full[step.i-1].c),"stepping reveals the same server HA bar");

assert.deepStrictEqual(h.offOrigin,[],"no non-origin requests");
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("heikin-ashi: ok");await h.close();
})().catch(e=>{console.error(e);process.exit(1)});
