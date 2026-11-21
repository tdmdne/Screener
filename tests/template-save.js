// Template menus: one-click "Save" overwrites an existing template (chart + drawing templates); "Save as new" still adds.
const assert=require("assert");const {launch}=require("./harness");
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1);
await P.evaluate(()=>{S.tpl={list:[],def:null};S.drawPre={};S.chart.type="candles";save();go("chart");openChart("EURUSD","1H")});
await P.waitForFunction(()=>ch&&G&&G.a&&G.a.length>30);
// chart template: save as new, change the chart, Save (overwrite) from the row and from the top action
await P.evaluate(()=>tplM());await P.fill("#tpl_name","Desk");
assert.strictEqual(await P.textContent("#tpl_save"),"Save as new");
await P.click("#tpl_save");await P.waitForSelector(".tpl_up");
const id=await P.evaluate(()=>S.tpl.list[0].id);
await P.evaluate(()=>{S.chart.type="line";S.chart.lineCol="#ff00aa";save();tplM()});
await P.click('.tpl_up[aria-label="Save current chart into Desk"]');
let t=await P.evaluate(()=>({n:S.tpl.list.length,id:S.tpl.list[0].id,type:S.tpl.list[0].chart.type,col:S.tpl.list[0].chart.lineCol}));
assert.deepStrictEqual(t,{n:1,id,type:"line",col:"#ff00aa"},"row Save overwrote the same template");
await P.evaluate(()=>{S.chart.type="area";save();tplM()});
assert.ok(/Save .Desk./.test(await P.textContent("#tpl_save_cur")),"top Save names the current template");
await P.click("#tpl_save_cur");
assert.strictEqual(await P.evaluate(()=>S.tpl.list.length===1&&S.tpl.list[0].chart.type),"area","top Save overwrote it");
await P.evaluate(()=>closeM());
// drawing template: save as new from a selected drawing, restyle, Save overwrites
await P.evaluate(()=>{const a=G.a;const d={id:41,t:"trend",p:[{t:a[5].t,y:a[5].c},{t:a[25].t,y:a[25].c}],c:"#2962ff",w:2,s:0};DL().push(d);SELD=d;dpe();dsel();dpM()});
assert.strictEqual(await P.textContent("#dp_save"),"Save as new");
await P.fill("#dp_name","Mine");await P.click("#dp_save");await P.waitForSelector(".dp_up");
await P.evaluate(()=>{closeM();SELD.c="#00ffaa";SELD.w=4;dsel();dpM()});
await P.click('.dp_up[aria-label="Save this drawing\'s style into Mine"]');
assert.deepStrictEqual(await P.evaluate(()=>{const L=S.drawPre.trend;return{n:L.length,c:L[0].c,w:L[0].w,name:L[0].n}}),{n:1,c:"#00ffaa",w:4,name:"Mine"});
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("template-save: ok");await h.close();
})().catch(e=>{console.error(e);process.exit(1)});
