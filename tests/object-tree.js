// E-03: object tree dock section — lists indicators and drawings; select, rename, hide, lock, delete.
const assert=require("assert");const {launch}=require("./harness");
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1);
await P.evaluate(()=>{go("chart");openChart("EURUSD","1H")});
await P.waitForFunction(()=>typeof ch!=="undefined"&&ch&&G&&G.a&&G.a.length>30&&document.getElementById("dkot"));
await P.evaluate(()=>{S.dr.EURUSD=[];S.chart.ind=[];save();drawChart()});
await P.waitForFunction(()=>document.getElementById("dkot")&&/No indicators or drawings/.test(document.getElementById("dkot").textContent));

// add an indicator and two drawings (one with user text that must render as text)
await P.evaluate(()=>{S.chart.ind.push({id:"iT",t:"ema",len:21,col:"#ff9800"});
  const a=G.a;DL().push({id:1,t:"trend",p:[{t:a[5].t,y:a[5].c},{t:a[25].t,y:a[25].c}],c:"#2962ff",w:2,s:0});
  DL().push({id:2,t:"text",p:[{t:a[15].t,y:a[15].c}],txt:'<img src=x onerror="window.__xss=1">hi',c:"#2962ff",w:2,s:0});save();drawChart()});
await P.waitForFunction(()=>document.querySelectorAll('#dkot .ot-r[data-kind="dr"]').length===2&&document.querySelectorAll('#dkot .ot-r[data-kind="ind"]').length===1);
assert.ok(!(await P.evaluate(()=>window.__xss||document.querySelector("#dkot img"))),"drawing text not parsed as HTML");
const rows=await P.$$eval("#dkot .ot-r .ot-l",e=>e.map(x=>x.textContent));
assert.ok(rows[0].startsWith("EMA")||/ema/i.test(rows[0]),"indicator row first: "+rows[0]);
assert.ok(rows.some(r=>r.startsWith("Trend line")),"trend line row: "+rows);

// select from tree
await P.locator('#dkot .ot-r[data-kind="dr"]',{hasText:"Trend line"}).click();
assert.strictEqual(await P.evaluate(()=>SELD&&SELD.id),1,"selected from tree");

// rename (dblclick, Enter)
await P.locator('#dkot .ot-r[data-kind="dr"]',{hasText:"Trend line"}).dblclick();
await P.fill("#dkot .ot-in","Weekly trend");await P.keyboard.press("Enter");
assert.strictEqual(await P.evaluate(()=>DL().find(d=>d.id===1).name),"Weekly trend");
await P.waitForFunction(()=>[...document.querySelectorAll("#dkot .ot-l")].some(e=>e.textContent==="Weekly trend"));

// lock: not hit-testable, deselected
await P.click('#dkot button[aria-label="Lock Weekly trend"]');
assert.deepStrictEqual(await P.evaluate(()=>{const d=DL().find(d=>d.id===1),q=d.p.map(p=>({x:ch.timeScale().logicalToCoordinate(t2l(p.t)),y:MS.priceToCoordinate(p.y)}));return{lock:d.lock,sel:SELD&&SELD.id||null,hit:hit(d,(q[0].x+q[1].x)/2,(q[0].y+q[1].y)/2)}}),{lock:true,sel:null,hit:0});
await P.click('#dkot button[aria-label="Unlock Weekly trend"]');
assert.strictEqual(await P.evaluate(()=>!!DL().find(d=>d.id===1).lock),false,"unlocked");

// hide / show drawing and indicator
await P.click('#dkot button[aria-label="Hide Weekly trend"]');
assert.strictEqual(await P.evaluate(()=>DL().find(d=>d.id===1).hide),true);
await P.click('#dkot button[aria-label="Show Weekly trend"]');
assert.strictEqual(await P.evaluate(()=>DL().find(d=>d.id===1).hide),false);
const indName=await P.$eval('#dkot .ot-r[data-kind="ind"] .ot-l',e=>e.textContent);
await P.click(`#dkot button[aria-label="Hide ${indName}"]`);
assert.strictEqual(await P.evaluate(()=>S.chart.ind[0].hidden),true,"indicator hidden");

// delete drawing (undoable) and indicator
await P.click('#dkot button[aria-label="Delete Weekly trend"]');
assert.strictEqual(await P.evaluate(()=>DL().length),1,"drawing deleted");
await P.evaluate(()=>doUndo());
await P.waitForFunction(()=>DL().length===2);
await P.click(`#dkot button[aria-label="Remove ${indName}"]`);
assert.strictEqual(await P.evaluate(()=>S.chart.ind.length),0,"indicator removed");
assert.strictEqual(await P.evaluate(()=>MD.innerHTML),"","no dialog opened by removing from the tree");

// drawing added on the canvas shows up without a manual refresh
await P.evaluate(()=>{const a=G.a;DL().push({id:3,t:"hline",p:[{t:a[10].t,y:a[10].c}],c:"#2962ff",w:2,s:0});save()});
await P.waitForFunction(()=>document.querySelectorAll('#dkot .ot-r[data-kind="dr"]').length===3);

// collapsible like the other dock sections
await P.click('.dktb:has-text("Object tree")');
assert.ok(!(await P.$("#dkot")),"section collapses");
await P.click('.dktb:has-text("Object tree")');
assert.ok(await P.$("#dkot"),"section expands");

assert.deepStrictEqual(h.offOrigin,[],"no non-origin requests");
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("object-tree: ok");await h.close();
})().catch(e=>{console.error(e);process.exit(1)});
