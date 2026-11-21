// Alerts are evaluated by the hub, never in the browser (AGENTS.md §0; A2/A3 + E-07..E-09 UI).
// The client sends armed alerts as {op:"alerts"}, shows hub `alert` frames, and has no price checking of its own.
const assert=require("assert");const {launch}=require("./harness");
const lastAlertsOp=P=>P.evaluate(()=>{for(let i=__edge.sent.length-1;i>=0;i--){try{const v=JSON.parse(__edge.sent[i]);if(v.op==="alerts")return v.alerts}catch(e){}}return null});
const waitAlertsOp=(P,pred)=>P.waitForFunction(src=>{const f=new Function("a","return ("+src+")(a)");for(let i=__edge.sent.length-1;i>=0;i--){try{const v=JSON.parse(__edge.sent[i]);if(v.op==="alerts")return f(v.alerts)}catch(e){}}return false},pred.toString(),{timeout:5000});
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1&&SYMS.some(s=>s[0]==="BTCUSDT"));
await P.evaluate(()=>{S.alerts=[];save();go("chart");openChart("BTCUSDT","1H")});
await P.waitForFunction(()=>ch&&G&&G.a&&G.a.length>30);

// no browser-side evaluation exists any more
assert.strictEqual(await P.evaluate(()=>typeof checkAlerts),"undefined","checkAlerts removed");

// price alert with an extra AND condition via the dialog -> alerts op
await P.evaluate(()=>alertsM());
await P.fill("#al_sym","BTCUSDT");await P.fill("#al_px","150");await P.selectOption("#al_dir","above");
await P.click("#modal .al-addc");await P.selectOption("#modal .al-cs","below");await P.fill("#modal .al-cv","160");
await P.click('#modal button.pri:has-text("Add alert")');
await waitAlertsOp(P,a=>a.length===1&&a[0].condition==="cross_up"&&a[0].target===150&&a[0].conds&&a[0].conds[0].condition==="below"&&a[0].conds[0].target===160);
const id1=await P.evaluate(()=>S.alerts[0].id);

// ticks never fire alerts in the browser
await P.evaluate(()=>{__edge.quotes([{s:"BTCUSDT",c:149,t:Date.now()}]);__edge.quotes([{s:"BTCUSDT",c:155,t:Date.now()+1000}])});await P.waitForTimeout(200);
assert.strictEqual(await P.evaluate(()=>S.alerts[0].fired),false,"no client-side firing");

// hub alert frame -> fired + toast
await P.evaluate(id=>__edge.push(__edge.frame("alert",{id:String(id),sym:"BTCUSDT",condition:"cross_up 150",price:151,triggeredAt:Date.now()})),id1);
await P.waitForFunction(()=>S.alerts[0].fired===true);
assert.ok(/BTCUSDT/.test(await P.textContent("#msg")),"toast shown");
await waitAlertsOp(P,a=>a.length===0); // fired one-shot alerts are no longer sent

// watchlist alert (one record, every symbol in the list, resets its reference after each fire)
await P.evaluate(()=>{S.wlx.groups[0].syms=["BTCUSDT","ETHUSDT","SOLUSDT"];save();alertsM()});
await P.selectOption("#alw_c","pct_up");await P.fill("#alw_p","3");await P.click('#modal button:has-text("Add watchlist alert")');
await waitAlertsOp(P,a=>a.some(x=>Array.isArray(x.syms)&&x.syms.length===3&&x.condition==="pct_up"&&x.target===3&&x.resetRefOnTrigger===true&&x.mode==="recurring"));
assert.ok(/Watchlist/.test(await P.textContent("#modal")),"listed with a readable description");
await P.evaluate(()=>closeM());
const wlId=await P.evaluate(()=>S.alerts.find(a=>a.syms).id);
await P.evaluate(id=>__edge.push(__edge.frame("alert",{id:String(id),sym:"ETHUSDT",condition:"pct_up >= 3%",price:3100,triggeredAt:Date.now()})),wlId);
await P.waitForFunction(()=>/ETHUSDT/.test(document.getElementById("msg").textContent));
assert.strictEqual(await P.evaluate(()=>S.alerts.find(a=>a.syms).fired),false,"watchlist alert stays armed");
// the alert follows the watchlist's current symbols
await P.evaluate(()=>{S.wlx.groups[0].syms=["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT"];save()});
await waitAlertsOp(P,a=>a.some(x=>Array.isArray(x.syms)&&x.syms.length===4&&x.syms.includes("XRPUSDT")));
// re-arm stamps armedAt so the hub can tell it from a stale resend
await P.evaluate(()=>{const i=S.alerts.findIndex(a=>!a.syms);if(i>=0){rearmAlert(i);closeM()}});
await waitAlertsOp(P,a=>a.some(x=>!x.syms&&x.armedAt>Date.now()-60000));

// drawing alert from a selected trend line, and both lines of a channel
await P.evaluate(()=>{const a=G.a;const d={id:77,t:"trend",p:[{t:a[5].t,y:a[5].c},{t:a[25].t,y:a[25].c}],c:"#2962ff",w:2,s:0};DL().push(d);SELD=d;dpe();dsel()});
await P.click('#dsel button:has-text("Alert")');
await waitAlertsOp(P,a=>a.some(x=>x.line&&x.line.ext==="seg"&&x.condition==="cross"&&x.sym==="BTCUSDT"));
const ln=await P.evaluate(()=>{const a=S.alerts.find(x=>x.drawId===77);return{t1:a.line.t1,t2:a.line.t2,p1:a.line.p1,ok:a.line.t1<1e11}});
assert.ok(ln.ok&&ln.t2>ln.t1,"line anchors are bar times in seconds");
await P.evaluate(()=>{const a=G.a;const d={id:78,t:"chan",p:[{t:a[5].t,y:a[5].c},{t:a[25].t,y:a[25].c},{t:a[15].t,y:a[15].c*1.01}],c:"#2962ff",w:2,s:0};DL().push(d);SELD=d;dpe();dsel()});
await P.click('#dsel button:has-text("Alert")');
assert.strictEqual(await P.evaluate(()=>S.alerts.filter(x=>x.drawId===78).length),2,"channel = two line alerts");

// reconnect resends the armed set
await P.evaluate(()=>{VT_EDGE.ws.close()});
await P.waitForFunction(()=>VT_EDGE.ws&&VT_EDGE.ws.readyState===1,null,{timeout:15000});
await P.waitForFunction(()=>{const s=__edge.sockets[__edge.sockets.length-1];return true});
await waitAlertsOp(P,a=>a.length===5); // re-armed price alert + watchlist + trend + 2 channel lines

assert.deepStrictEqual(h.offOrigin,[],"no non-origin requests");
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("server-alerts: ok");await h.close();
})().catch(e=>{console.error(e);process.exit(1)});
