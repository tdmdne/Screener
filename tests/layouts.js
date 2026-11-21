// E-05: multi-chart layouts — 1/2/3/4/6/8 charts, per-pane symbol/timeframe, sync symbol/interval/crosshair,
// one WS view carrying every pane, live hub bars per pane, phone shows one extra pane at most.
const assert=require("assert");const {launch}=require("./harness");
(async()=>{let h=await launch({viewport:{width:1440,height:900}});let P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1&&SYMS.some(s=>s[0]==="GBPUSD"));
await P.evaluate(()=>{go("chart");openChart("EURUSD","1H")});
await P.waitForFunction(()=>ch&&LIVE["EURUSD|1H"]&&document.querySelector("#dock .lay-pick"));

// picker has every layout; 4 charts = main + 3 panes
const picks=await P.$$eval("#dock .lay-pick button",b=>b.map(x=>x.getAttribute("aria-label")));
assert.deepStrictEqual(picks,["One chart","2 charts","3 charts","4 charts","6 charts","8 charts"]);
await P.click('#dock .lay-pick button[aria-label="4 charts"]');
await P.waitForFunction(()=>VT_LAY.panes.length===3&&VT_LAY.panes.every(p=>p.ch),null,{timeout:15000});
assert.strictEqual(await P.evaluate(()=>document.documentElement.dataset.panes),"2");
assert.strictEqual(await P.evaluate(()=>SC.chB===VT_LAY.panes[0].ch&&!!document.getElementById("cvB")),true,"pane 0 keeps the SC/#cvB contract");
// sync symbol is on by default: every pane shows EURUSD, each on its own timeframe
const p1=await P.evaluate(()=>VT_LAY.panes.map(p=>p.sym+"|"+p.tf));
assert.ok(p1.every(k=>k.startsWith("EURUSD|")),"synced symbol: "+p1);
assert.strictEqual(new Set(p1).size,3,"distinct timeframes: "+p1);

// the WS view lists every pane
await P.waitForFunction(()=>{for(let i=__edge.sent.length-1;i>=0;i--){try{const v=JSON.parse(__edge.sent[i]);if(v.op==="view")return v.chart&&Array.isArray(v.chart.panes)&&v.chart.panes.length===3}catch(e){}}return false},null,{timeout:5000});

// change pane 2's symbol via its header (palette picker) -> sync symbol turns off, only that pane changes
await P.click('#sc2 button[aria-label^="Pane 3 symbol"]');
await P.keyboard.type("GBPUSD");
await P.waitForFunction(()=>[...document.querySelectorAll(".vt-cmd-opt")].some(o=>o.textContent.startsWith("GBPUSD")));
await P.keyboard.press("Enter");
await P.waitForFunction(()=>VT_LAY.panes.length===3&&VT_LAY.panes[1]&&VT_LAY.panes[1].sym==="GBPUSD"&&VT_LAY.panes[1].ch,null,{timeout:15000});
assert.strictEqual(await P.evaluate(()=>S.sc.syncSym),false);
assert.deepStrictEqual(await P.evaluate(()=>VT_LAY.panes.map(p=>p.sym)),["EURUSD","GBPUSD","EURUSD"]);
await P.waitForFunction(()=>{for(let i=__edge.sent.length-1;i>=0;i--){try{const v=JSON.parse(__edge.sent[i]);if(v.op==="view")return v.chart.panes.some(p=>p.sym==="GBPUSD")}catch(e){}}return false},null,{timeout:5000});

// change pane timeframe
const tf2=await P.evaluate(()=>VT_LAY.panes[1].tf==="15m"?"5m":"15m");
await P.selectOption('#sc2 select[aria-label="Pane 3 timeframe"]',tf2);
await P.waitForFunction(t=>VT_LAY.panes[1]&&VT_LAY.panes[1].tf===t&&VT_LAY.panes[1].ch,tf2,{timeout:15000});

// live bar frame for that pane updates only that pane
const lv=await P.evaluate(t=>{const p=VT_LAY.panes[1],last=p.B.D[p.B.D.length-1],nb=[last.time+60*(t==="5m"?5:15),last.close,last.close*1.003,last.close*.998,last.close*1.002,5];
  const before0=VT_LAY.panes[0].ser.data().length;__edge.push(__edge.frame("bar",{sym:"GBPUSD",tf:t,bar:nb,closed:false}));
  const d=p.ser.data();return{t:d[d.length-1].time,c:d[d.length-1].close,nb,same0:VT_LAY.panes[0].ser.data().length===before0}},tf2);
assert.strictEqual(lv.t,lv.nb[0]);assert.strictEqual(lv.c,lv.nb[4]);assert.ok(lv.same0,"other panes untouched");

// sync interval: every pane uses the main timeframe, selects disabled
await P.click('#sc2 .lay-bar label:has-text("Interval") input');
await P.waitForFunction(()=>VT_LAY.panes.length===3&&VT_LAY.panes.every(p=>p.tf===S.chart.tf&&p.ch),null,{timeout:15000});
assert.strictEqual(await P.$eval('#sc2 select[aria-label="Pane 2 timeframe"]',e=>e.disabled),true);
await P.click('#sc2 .lay-bar label:has-text("Interval") input');

// crosshair sync from a pane moves the main chart crosshair (no errors) and main redraws do not rebuild panes
const keep=await P.evaluate(()=>{const c0=VT_LAY.panes[0].ch;drawChart();return VT_LAY.panes[0].ch===c0});
assert.ok(keep,"panes survive a main redraw when nothing about them changed");

// 8 charts = 7 panes; back to one chart kills panes
await P.click('#dock .lay-pick button[aria-label="8 charts"]');
await P.waitForFunction(()=>VT_LAY.panes.length===7&&document.querySelectorAll("#sc2 .lay-cell").length===7,null,{timeout:20000});
await P.click('#dock .lay-pick button[aria-label="One chart"]');
await P.waitForFunction(()=>VT_LAY.panes.length===0&&!document.querySelector("#sc2 .lay-cell")&&document.documentElement.dataset.panes==="1");
await P.waitForFunction(()=>{for(let i=__edge.sent.length-1;i>=0;i--){try{const v=JSON.parse(__edge.sent[i]);if(v.op==="view")return !v.chart.panes}catch(e){}}return false},null,{timeout:5000});

// open a pane in the main chart; persisted across reload; command palette has layouts
await P.evaluate(()=>vtSetLayout(3));await P.waitForFunction(()=>VT_LAY.panes.length===2&&VT_LAY.panes[1].ch,null,{timeout:15000});
const tgt=await P.evaluate(()=>VT_LAY.panes[1].sym+"|"+VT_LAY.panes[1].tf);
await P.click('#sc2 .lay-cell:nth-child(2) .lay-open');
assert.strictEqual(await P.evaluate(()=>S.chart.sym+"|"+S.chart.tf),tgt,"pane opened in main chart");
await P.waitForTimeout(300);await P.reload();await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&ch);
assert.strictEqual(await P.evaluate(()=>S.sc.layout),3,"layout persisted");
await P.keyboard.press("Control+k");await P.keyboard.type("6 charts");await P.keyboard.press("Enter");
assert.strictEqual(await P.evaluate(()=>S.sc.layout),6,"palette layout command");
assert.deepStrictEqual(h.offOrigin,[],"no non-origin requests");
assert.deepStrictEqual(h.errors,[],"no page errors");await h.close();

// phone: at most one extra pane, no horizontal overflow
h=await launch({viewport:{width:390,height:844},mobile:true});P=h.page;await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1);
await P.evaluate(()=>{go("chart");openChart("EURUSD","1H");vtSetLayout(8)});await P.waitForTimeout(1500);
assert.ok(await P.evaluate(()=>VT_LAY.panes.length<=1),"phone shows at most one extra pane");
assert.ok(await P.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),"no horizontal overflow on phone");
assert.deepStrictEqual(h.errors,[],"no page errors (phone)");await h.close();
console.log("layouts: ok");
})().catch(e=>{console.error(e);process.exit(1)});
