// Snapshot button: captures the chart (series + drawings + header) and downloads / copies a PNG with a toast.
const assert=require("assert");const {launch}=require("./harness");
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await h.ctx.grantPermissions(["clipboard-read","clipboard-write"],{origin:h.base.replace(/\/$/,"")});
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1);
await P.evaluate(()=>{go("chart");openChart("EURUSD","1H");const a=G&&G.a;void a});
await P.waitForFunction(()=>ch&&G&&G.a&&G.a.length>30&&document.getElementById("dc"));
await P.evaluate(()=>{const a=G.a;DL().push({id:31,t:"hline",p:[{t:a[a.length-10].t,y:a[a.length-10].c}],c:"#ff00ff",w:4,s:0});save()});
await P.waitForTimeout(300);
// canvas content: chart pixels + the magenta drawing + header strip
const info=await P.evaluate(async()=>{const c=await snapCanvas();const g=c.getContext("2d"),d=g.getImageData(0,0,c.width,c.height).data;let mag=0;
  for(let i=0;i<d.length;i+=4)if(d[i]>220&&d[i+1]<60&&d[i+2]>220)mag++;return{w:c.width,h:c.height,cw:document.getElementById("cv").clientWidth,mag}});
assert.ok(info.w>=info.cw&&info.h>100,"snapshot size "+JSON.stringify(info));
assert.ok(info.mag>200,"drawings included in the snapshot: "+info.mag);
// the oscillator pane (RSI) is stacked under the main pane when "Show indicators in snapshot" is on (default)
const h1=await P.evaluate(async()=>(await snapCanvas()).height);
await P.evaluate(()=>{S.chart.ind.push({id:"rsiT",t:"rsi",len:14,col:"#7e57c2"});save();drawChart()});
await P.waitForFunction(()=>typeof ch2!=="undefined"&&ch2,null,{timeout:10000});await P.waitForTimeout(300);
const h2=await P.evaluate(async()=>(await snapCanvas()).height);assert.ok(h2>h1+40,"RSI pane included: "+h1+" -> "+h2);
const h3=await P.evaluate(async()=>{S.chart.snapInd=false;const c=await snapCanvas();S.chart.snapInd=true;return c.height});assert.ok(h3<h2,"setting off: pane left out");
await P.evaluate(()=>{S.chart.ind=S.chart.ind.filter(d=>d.id!=="rsiT");save();drawChart()});
// download via the top-bar button
await P.click('button[aria-label="Snapshot"]');
const [dl]=await Promise.all([P.waitForEvent("download"),P.click('#snapdrop >> text=/Download/i')]);
assert.strictEqual(dl.suggestedFilename(),"EURUSD_1H.png");
const fs=require("fs"),buf=fs.readFileSync(await dl.path());assert.strictEqual(buf.slice(1,4).toString(),"PNG","valid PNG");
await P.waitForFunction(()=>/Snapshot saved/.test(document.getElementById("msg").textContent));
// copy to clipboard
await P.click('button[aria-label="Snapshot"]');await P.click('#snapdrop >> text=/Copy/i');
await P.waitForFunction(()=>/Snapshot copied to clipboard|Snapshot failed/.test(document.getElementById("msg").textContent),null,{timeout:10000});
const msg=await P.textContent("#msg");assert.ok(/copied/.test(msg),"clipboard copy toast: "+msg);
assert.deepStrictEqual(h.offOrigin,[],"no non-origin requests");
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("snapshot: ok");await h.close();
})().catch(e=>{console.error(e);process.exit(1)});
