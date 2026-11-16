const {launch}=require("./harness");const assert=require("assert");
(async()=>{const h=await launch();const P=h.page;await P.goto(h.base+"#/calc");await P.waitForFunction(()=>BOOTED);await P.waitForSelector("#c_lots");
await P.evaluate(()=>{S.calc.rate="";save()});
const fill=async(sel,v)=>{await P.fill(`[data-ck="${sel}"]`,String(v));await P.waitForTimeout(80)};
await fill("acct",100000);await fill("riskPct",0.5);await fill("riskUsd",0);await fill("fxSym","EURUSD");await fill("stopPips",20);
let st=await P.evaluate(()=>({risk:c_risk.textContent,lots:c_lots.textContent,pv:c_pv.textContent}));console.log(JSON.stringify(st));
assert.deepStrictEqual(st,{risk:"$500.00",lots:"2.50",pv:"$10.00"});
await P.selectOption('[data-ck="fut"]',"ES");await fill("stopTicks",16);assert.strictEqual(await P.textContent("#c_cts"),"2");
await P.selectOption('[data-ck="fut"]',"MES");assert.strictEqual(await P.textContent("#c_cts"),"25");
// cross pair with manual quote rate
await fill("fxSym","EURGBP");await fill("rate",1.27);assert.strictEqual(await P.textContent("#c_pv"),"$12.70");
await fill("rate","");
// multi-account totals
await P.waitForTimeout(400);const ma=await P.evaluate(()=>[ma_tr.textContent,ma_tc.textContent]);console.log("multi",ma);assert.strictEqual(ma[0],"$750.00");
// simulator renders
await P.waitForTimeout(500);assert(/Pass rate/.test(await P.textContent("#c_sim")));
// persistence
await P.reload();await P.waitForSelector("#c_lots");assert.strictEqual(await P.inputValue('[data-ck="fxSym"]'),"EURGBP");
await fill("fxSym","EURUSD");await P.waitForTimeout(600);await P.screenshot({path:"shots/07_calc.png",fullPage:false});
console.log("errors",h.errors,"console",h.consoleErr);assert(!h.errors.length&&!h.consoleErr.length);await h.close();console.log("CALC OK")})().catch(e=>{console.error(e);process.exit(1)});
