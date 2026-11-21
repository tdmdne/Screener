// E-12: strategy tester in the Vektor Script editor — backtest runs on the server (/api/vs/run), the browser renders
// metrics, trades, CSV and chart markers; strategy scripts are checked by the server engine.
const assert=require("assert");const {launch}=require("./harness");
const SRC='fast = ema(close, 5)\nslow = ema(close, 20)\nentry_long(crossover(fast, slow))\nexit_long(crossunder(fast, slow))\nplot(fast, "Fast")';
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1&&SYMS.some(s=>s[0]==="BTCUSDT"));
await P.evaluate(()=>{go("chart");openChart("BTCUSDT","1H")});
await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]&&LIVE["BTCUSDT|1H"].length>100);

// open the editor on a new script with strategy code
await P.evaluate(()=>vsM());await P.click("#vs_new");await P.waitForSelector("#vs_src");
await P.fill("#vs_src",SRC);
assert.ok(await P.$("#vs_strat"),"Strategy tester button in the editor");

// Check goes to the server for strategy scripts
const n0=await P.evaluate(()=>0);void n0;
await P.click("#vs_chk");
await P.waitForFunction(()=>/Strategy signals found/.test(document.getElementById("vs_msg").textContent),null,{timeout:10000});
assert.ok(h.vsRuns.length>=1&&h.vsRuns[h.vsRuns.length-1].src.includes("entry_long"),"server check");

// run the tester with quantity + commission
await P.fill("#st_qty","2");await P.fill("#st_comm","0.05");
await P.click("#vs_strat");
await P.waitForSelector("#vs_st .st-grid",{timeout:10000});
const req=h.vsRuns[h.vsRuns.length-1];
assert.deepStrictEqual(req.strategy,{qty:2,commissionPct:0.05},"strategy options sent");
assert.ok(req.bars.length>100&&req.bars.length<=2500&&req.sym==="BTCUSDT"&&req.tf==="1H","bars sent: "+req.bars.length);
const ui=await P.evaluate(()=>({cells:[...document.querySelectorAll("#vs_st .st-m span")].map(e=>e.textContent),rows:document.querySelectorAll("#vs_st .st-t tbody tr").length,
  trades:VT_ST.last.strategy.trades.length,net:VT_ST.last.strategy.metrics.netProfit}));
assert.ok(ui.cells.includes("Net profit")&&ui.cells.includes("Win rate")&&ui.cells.includes("Max drawdown"),"metrics: "+ui.cells);
assert.ok(ui.trades>0&&ui.rows===Math.min(200,ui.trades),"trade rows "+JSON.stringify(ui));

// CSV export
const [dl]=await Promise.all([P.waitForEvent("download"),P.click('#vs_st button:has-text("Export CSV")')]);
const fs=require("fs"),path=await dl.path(),csv=fs.readFileSync(path,"utf8").split("\n");
assert.strictEqual(csv[0],"trade,side,entry_time,entry_price,exit_time,exit_price,pnl,pnl_pct,bars,reason");
assert.strictEqual(csv.length,ui.trades+1);

// markers on the chart (entry + exit per trade)
await P.click('#vs_st button:has-text("Show on chart")');
const mk=await P.evaluate(()=>MS.markers?MS.markers().length:-1);
assert.ok(mk===-1||mk===2*Math.min(300,ui.trades),"markers "+mk);

// server error surfaces with the line number
await P.evaluate(()=>vsM());await P.waitForSelector("#vs_src");
await P.fill("#vs_src","entry_long()\nplot(close)");await P.click("#vs_chk");
await P.waitForFunction(()=>/one condition/.test(document.getElementById("vs_msg").textContent),null,{timeout:10000});

assert.deepStrictEqual(h.offOrigin,[],"no non-origin requests");
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("strategy-tester: ok");await h.close();
})().catch(e=>{console.error(e);process.exit(1)});
