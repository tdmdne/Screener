// Backtest Lab: no stub; engine checked on hand-built candles (breakout entry at next open, exact 2R target, stop-first when a bar hits both,
// gaps fill at the open, no re-entry on the exit bar, end-of-data exit); no look-ahead (changing later bars never changes earlier trades); ATR/% stops; fees;
// UI run on real cached candles, CSV export, bar replay (seek, markers, play/pause), validation messages, axe in both themes, phone.
const assert=require("assert"),fs=require("fs"),path=require("path");const {launch}=require("./harness");
const AXE=fs.readFileSync(path.join(__dirname,"../node_modules/axe-core/axe.min.js"),"utf8");
const axe=async(P,ctx)=>{await P.evaluate(AXE);return P.evaluate(async c=>(await axe.run(c||document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}})).violations.map(v=>v.id+" x"+v.nodes.length+" "+v.nodes[0].target.join(" ")),ctx)};
const ready=P=>P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
(async()=>{for(const theme of ["dark","light"]){const h=await launch({viewport:{width:1440,height:900},colorScheme:theme,acceptDownloads:true});const P=h.page;await P.goto(h.base);await ready(P);
await P.evaluate(()=>{location.hash="#/backtest"});await P.waitForSelector("#bt_f");
if(theme==="dark"){
assert(!(await P.$("#pv-backtest .stub")));await P.evaluate(()=>need(symOf("BTCUSDT"),"1H",true));await P.waitForFunction(()=>(candles(symOf("BTCUSDT"),"1H")||[]).length>=100);
// 1) engine on hand-built candles
const e=await P.evaluate(()=>{const mk=(t,o,h,l,c)=>({t:t*3600,o,h,l,c,v:1});const flat=k=>Array.from({length:k},(_,i)=>mk(i,100,101,99,100));
  const B={strat:"brk",p:{"brk.n":20},dir:"both",stopMode:"pct",stopPct:1,atrMult:2,tgtR:2,oppExit:false,bal:10000,riskPct:1,feePct:0};
  let a=flat(25);a.push(mk(25,100,103.5,99.5,103));a.push(mk(26,103,104,102.5,103.8));a.push(mk(27,103.8,106,103.5,105.5));for(let i=28;i<40;i++)a.push(mk(i,105,105.5,104.5,105));
  const r1=btRun(a,B,"TEST");const t=r1.trades[0];
  /* both stop and target inside one bar -> stop first */
  let b=flat(25);b.push(mk(25,100,103.5,99.5,103));b.push(mk(26,103,103.2,102.5,103));b.push(mk(27,103,106,101,104));for(let i=28;i<40;i++)b.push(mk(i,104,104.5,103.5,104));const r2=btRun(b,B,"TEST");
  /* gap through the stop -> fills at the open */
  let g=flat(25);g.push(mk(25,100,103.5,99.5,103));g.push(mk(26,103,103.2,102.5,103));g.push(mk(27,100,100.5,99,100));for(let i=28;i<40;i++)g.push(mk(i,100,100.5,99.5,100));const r3=btRun(g,B,"TEST");
  /* no target -> closed at the end of data, with fees */
  const r4=btRun(a,Object.assign({},B,{tgtR:0,feePct:0.1}),"TEST");
  /* no look-ahead: change every bar after 30 and earlier trades stay identical */
  const real=candles(symOf("BTCUSDT"),"1H").slice(),C={strat:"ema",p:{"ema.fast":9,"ema.slow":21},dir:"both",stopMode:"atr",stopPct:1,atrMult:2,tgtR:2,oppExit:true,bal:10000,riskPct:1,feePct:0.05};
  const ra=btRun(real,C,"BTCUSDT"),k=Math.floor(real.length*0.6),mod=real.map((x,i)=>i>k?{t:x.t,o:x.o*1.3,h:x.h*1.5,l:x.l*0.7,c:x.c*0.8,v:x.v}:x),rb=btRun(mod,C,"BTCUSDT");
  const early=r=>JSON.stringify(r.trades.filter(t=>t.i1<=k).map(t=>[t.i0,t.i1,t.side,t.entry,t.exit]));
  return{all:r1.trades.map(x=>[x.side,x.i0,x.i1,x.why]),t1:[t.side,t.entry,+t.exit.toFixed(4),+jrPnl(t).toFixed(6),+jrR(t).toFixed(6),t.why,t.i0,t.i1],t2:[r2.trades[0].why,r2.trades[0].exit],t3:[r3.trades[0].why,r3.trades[0].exit],
    t4:[r4.trades[0].why,r4.trades[0].exit,+r4.trades[0].fees.toFixed(4)],la:[early(ra)===early(rb),ra.trades.filter(t=>t.i1<=k).length],short:(()=>{try{btRun(flat(10),B,"T");return"ran"}catch(x){return x.message}})()}});
assert.deepStrictEqual(e.t1,["long",103,105.06,200,2,"target",26,27],"breakout trade "+JSON.stringify(e.t1));assert.deepStrictEqual(e.all,[["long",26,27,"target"],["long",28,39,"end of data"]],"no re-entry on the exit bar "+JSON.stringify(e.all));
assert.deepStrictEqual(e.t2,["stop",101.97],"stop first");assert.deepStrictEqual(e.t3,["stop",100],"gap fills at open");
assert.strictEqual(e.t4[0],"end of data");assert.strictEqual(e.t4[1],105);assert(Math.abs(e.t4[2]-(103+105)*(100/1.03)*0.001)<1e-3,"fees both sides "+e.t4);
assert(e.la[0],"no look-ahead");assert(e.la[1]>=1,"some early trades to compare");assert(/Not enough candles/.test(e.short));
// 2) validation
await P.selectOption("#bt_strat","ema");await P.waitForSelector("#bt_ema_fast");await P.fill("#bt_ema_fast","30");await P.dispatchEvent("#bt_ema_fast","change");await P.fill("#bt_ema_slow","20");await P.dispatchEvent("#bt_ema_slow","change");
await P.click("#bt_run");assert(/fast EMA must be shorter/.test(await P.textContent("#bt_err")));
await P.fill("#bt_ema_fast","9");await P.dispatchEvent("#bt_ema_fast","change");await P.fill("#bt_ema_slow","21");await P.dispatchEvent("#bt_ema_slow","change");
await P.fill("#bt_sym","NOPE123");await P.dispatchEvent("#bt_sym","change");await P.click("#bt_run");assert(/Unknown symbol/.test(await P.textContent("#bt_err")));
await P.fill("#bt_sym","BTCUSDT");await P.dispatchEvent("#bt_sym","change");
// 3) run in the UI on cached candles
await P.evaluate(()=>need(symOf("BTCUSDT"),"1H",true));await P.waitForFunction(()=>(candles(symOf("BTCUSDT"),"1H")||[]).length>=100);
await P.click("#bt_run");await P.waitForSelector("#bt_out .jrkpis");
const u=await P.evaluate(()=>({n:BT.res.st.n,k:document.querySelectorAll("#bt_out .kpi").length,rows:document.querySelectorAll("#bt_out tbody tr").length,meta:document.getElementById("bt_meta").textContent,net:document.querySelector("#bt_out .kpi .v").textContent,exp:jrUsd(BT.res.st.net)}));
assert(u.n>0,"some trades");assert.strictEqual(u.rows,u.n);assert.strictEqual(u.k,8);assert(/BTCUSDT 1H/.test(u.meta));assert.strictEqual(u.net,u.exp);
const [dl]=await Promise.all([P.waitForEvent("download"),P.click("#bt_csv")]);const csv=fs.readFileSync(await dl.path(),"utf8");assert(/^\ufeffdate_open,date_close,symbol/.test(csv));assert(/Hypothetical backtest/.test(csv));assert.strictEqual(csv.trim().split(/\r?\n/).length,u.n+1);
// 4) replay
const rp=await P.evaluate(()=>{btSeek(30);const a=BT.ser.data?BT.ser.data().length:null;const info=document.getElementById("bt_rpinfo").textContent;return{a,info,i:BT.rp.i,max:+document.getElementById("bt_rr").max}});
assert.strictEqual(rp.i,30);assert(/Bar 30 \/ /.test(rp.info));if(rp.a!=null)assert.strictEqual(rp.a,30);
await P.click("#bt_rp");await P.waitForTimeout(1100);const i2=await P.evaluate(()=>BT.rp.i);assert(i2>=32,"play advances "+i2);await P.click("#bt_rp");const i3=await P.evaluate(()=>BT.rp.i);await P.waitForTimeout(600);assert.strictEqual(await P.evaluate(()=>BT.rp.i),i3,"pause stops");
await P.focus("#bt_rr");await P.keyboard.press("ArrowRight");assert.strictEqual(await P.evaluate(()=>BT.rp.i),i3+1,"keyboard step");
await P.click("#bt_re");assert.strictEqual(await P.evaluate(()=>BT.rp.i),rp.max);
await P.screenshot({path:__dirname+"/../shots/25_backtest.png"});
// leaving the page stops replay, sockets untouched
await P.click("#bt_rs");await P.click("#bt_rp");await P.evaluate(()=>{location.hash="#/workspace"});await P.waitForTimeout(300);assert.strictEqual(await P.evaluate(()=>BT.rp.on),false);
await P.evaluate(()=>{location.hash="#/backtest"});await P.waitForSelector("#bt_out .jrkpis");
}else{await P.fill("#bt_sym","BTCUSDT");await P.dispatchEvent("#bt_sym","change");await P.evaluate(()=>need(symOf(S.bt.sym),S.bt.tf,true));await P.waitForFunction(()=>(candles(symOf(S.bt.sym),S.bt.tf)||[]).length>=100,null,{timeout:60000});await P.click("#bt_run");await P.waitForTimeout(800);await P.waitForSelector("#bt_out .jrkpis")}
await P.waitForTimeout(600);const v=await axe(P,"#pv-backtest");assert.deepStrictEqual(v,[],theme+" backtest axe: "+v.join(" | "));
console.log(theme,"errors",h.errors);assert.deepStrictEqual(h.errors,[]);await h.close()}
{const h=await launch({viewport:{width:390,height:844},mobile:true});const P=h.page;await P.goto(h.base);await ready(P);await P.evaluate(()=>{location.hash="#/backtest";need(symOf("BTCUSDT"),"1H",true)});await P.waitForSelector("#bt_f");
 await P.fill("#bt_sym","BTCUSDT");await P.dispatchEvent("#bt_sym","change");await P.waitForFunction(()=>(candles(symOf("BTCUSDT"),"1H")||[]).length>=100);await P.click("#bt_run");await P.waitForSelector("#bt_out .jrkpis");await P.waitForTimeout(400);
 const ph=await P.evaluate(()=>{const W=document.documentElement.clientWidth;const small=[...document.querySelectorAll("#pv-backtest button,#pv-backtest input,#pv-backtest select")].filter(e=>e.offsetParent&&!(e.type==="checkbox"&&e.closest("label"))).map(e=>{const r=e.getBoundingClientRect();return[e.id||e.className,Math.round(r.width),Math.round(r.height)]}).filter(x=>x[1]<43.5||x[2]<43.5);return{sw:document.documentElement.scrollWidth,W,small}});
 assert(ph.sw<=ph.W,"no sideways scroll "+ph.sw);assert.deepStrictEqual(ph.small,[],"phone targets");await P.screenshot({path:__dirname+"/../shots/m/qa_390_backtest.png",fullPage:true});assert.deepStrictEqual(h.errors,[]);await h.close()}
console.log("BACKTEST OK")})().catch(e=>{console.error(e);process.exit(1)});
