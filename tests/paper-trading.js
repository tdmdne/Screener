// E-13: paper trading panel — sends {op:"paper"} actions, renders hub `paper` frames (account, positions, lines, toasts).
// The account itself (fills, margin, SL/TP) is the hub's (tests/paper.test.mjs).
const assert=require("assert");const {launch}=require("./harness");
const sentPaper=P=>P.evaluate(()=>__edge.sent.map(m=>{try{return JSON.parse(m)}catch(e){return null}}).filter(v=>v&&v.op==="paper"));
const acct=(over)=>Object.assign({settings:{balance:10000,leverage:1,commissionPct:0.05,currency:"USD"},balance:10000,equity:10000,upnl:0,usedMargin:0,freeMargin:10000,realized:0,positions:[],history:[],stats:{trades:0,winRate:0}},over||{});
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1&&SYMS.some(s=>s[0]==="BTCUSDT"));
await P.evaluate(()=>{S.sc.secs.pp=true;S.sc.dock=true;go("chart");openChart("BTCUSDT","1H")});
await P.waitForFunction(()=>ch&&document.getElementById("dkpp"));

// the account is requested on connect
await P.waitForFunction(()=>__edge.sent.some(m=>/"op":"paper"/.test(m)&&/"action":"get"/.test(m)),null,{timeout:5000});
await P.evaluate(a=>__edge.push(__edge.frame("paper",{account:a})),acct());
await P.waitForFunction(()=>/10,000\.00/.test(document.getElementById("dkpp").textContent));

// order ticket -> order op for the chart symbol with qty / SL / TP
await P.fill("#pp_qty","0.5");await P.fill("#pp_sl","90");await P.fill("#pp_tp","130");
await P.click("#dkpp .pp-buy");
let ops=await sentPaper(P);let o=ops[ops.length-1];
assert.deepStrictEqual({a:o.action,sym:o.sym,side:o.side,qty:o.qty,sl:o.sl,tp:o.tp},{a:"order",sym:"BTCUSDT",side:"long",qty:0.5,sl:90,tp:130});

// hub fills it: position row + price lines on the chart
const px=await P.evaluate(()=>symOf("BTCUSDT")[2]||100);
await P.evaluate(([a])=>__edge.push(__edge.frame("paper",{account:a,event:{action:"order"}})),[acct({balance:9999,equity:10004,upnl:5,positions:[{id:"p1",sym:"BTCUSDT",side:"long",qty:0.5,entry:px,sl:90,tp:130,price:px+10,upnl:5}]})]);
await P.waitForFunction(()=>document.querySelectorAll("#dkpp .pp-row").length===1);
assert.ok(/BTCUSDT 0\.5 @/.test(await P.textContent("#dkpp .pp-row")));
assert.strictEqual(await P.evaluate(()=>VT_PP.lines.length),3,"entry, SL and TP lines");

// close button -> close op; SL fill event -> toast + row gone + lines gone
await P.click('#dkpp button[aria-label="Close long BTCUSDT"]');
ops=await sentPaper(P);assert.deepStrictEqual(ops[ops.length-1],{op:"paper",action:"close",id:"p1"});
await P.evaluate(()=>__edge.push(__edge.frame("paper",{account:{settings:{balance:10000,leverage:1,commissionPct:0.05},balance:9950,equity:9950,upnl:0,usedMargin:0,freeMargin:9950,realized:-50,positions:[],history:[{id:"p1"}],stats:{trades:1,winRate:0}},
  event:{action:"stop",closed:{id:"p1",sym:"BTCUSDT",side:"long",qty:0.5,entry:100,exit:90,reason:"stop",pnl:-5}}})));
await P.waitForFunction(()=>/stop loss/.test(document.getElementById("msg").textContent));
assert.strictEqual(await P.evaluate(()=>document.querySelectorAll("#dkpp .pp-row").length+VT_PP.lines.length),0);

// reset needs a confirming second click
await P.click("#dkpp .pp-reset summary");await P.fill("#pp_bal","25000");await P.fill("#pp_lev","10");
await P.click('#dkpp .pp-reset button');
ops=await sentPaper(P);assert.notStrictEqual(ops[ops.length-1].action,"reset","first click only arms");
await P.click('#dkpp .pp-reset button');
ops=await sentPaper(P);o=ops[ops.length-1];
assert.deepStrictEqual({a:o.action,b:o.balance,l:o.leverage},{a:"reset",b:25000,l:10});

// user text from frames is rendered as text
await P.evaluate(()=>__edge.push(__edge.frame("paper",{account:{settings:{balance:1,leverage:1,commissionPct:0},balance:1,equity:1,upnl:0,usedMargin:0,freeMargin:1,realized:0,
  positions:[{id:"x",sym:'<img src=x onerror="window.__xss=1">',side:"long",qty:1,entry:1,upnl:0}],history:[],stats:{trades:0,winRate:0}}})));
assert.ok(!(await P.evaluate(()=>window.__xss||document.querySelector("#dkpp img"))),"no HTML injection");

assert.deepStrictEqual(h.offOrigin,[],"no non-origin requests");
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("paper-trading: ok");await h.close();
})().catch(e=>{console.error(e);process.exit(1)});
