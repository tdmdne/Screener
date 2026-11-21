// Active tool style (last used / default template) applies from the first click, while the drawing is being created.
const assert=require("assert");const {launch}=require("./harness");
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1);
await P.evaluate(()=>{S.dr.EURUSD=[];S.toolDef={trend:{c:"#00ff00",w:4,s:1},chan:{c:"#ff8800",w:3,s:2}};save();go("chart");openChart("EURUSD","1H")});
await P.waitForFunction(()=>ch&&G&&G.a&&G.a.length>30&&document.getElementById("dc"));
const box=await P.locator("#dc").boundingBox(),at=(x,y)=>[box.x+box.width*x,box.y+box.height*y];
// trend line: press + drag, check the draft mid-drag
await P.evaluate(()=>setTool("trend"));
let [x,y]=at(.3,.6);await P.mouse.move(x,y);await P.mouse.down();[x,y]=at(.45,.4);await P.mouse.move(x,y,{steps:5});
const mid=await P.evaluate(()=>DRAFT&&{c:DRAFT.c,w:DRAFT.w,s:DRAFT.s});
assert.deepStrictEqual(mid,{c:"#00ff00",w:4,s:1},"style applied while dragging");
// pixels of the draft are already green on the canvas
await P.waitForTimeout(100);
const green=await P.evaluate(()=>{const c=document.getElementById("dc"),d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i+1]>200&&d[i]<60&&d[i+2]<60&&d[i+3]>150)n++;return n});
assert.ok(green>50,"draft rendered in the active colour: "+green);
await P.mouse.up();
assert.deepStrictEqual(await P.evaluate(()=>{const d=DL().find(x=>x.t==="trend");return{c:d.c,w:d.w,s:d.s}}),{c:"#00ff00",w:4,s:1});
// three-point tool (channel) too
await P.evaluate(()=>setTool("chan"));[x,y]=at(.5,.5);await P.mouse.click(x,y);
assert.deepStrictEqual(await P.evaluate(()=>DRAFT&&{c:DRAFT.c,w:DRAFT.w,s:DRAFT.s}),{c:"#ff8800",w:3,s:2},"three-point draft styled on first click");
await P.keyboard.press("Escape");
// no style -> engine defaults
await P.evaluate(()=>setTool("ray"));[x,y]=at(.2,.3);await P.mouse.click(x,y);
assert.strictEqual(await P.evaluate(()=>DRAFT&&DRAFT.c),"#2962ff","defaults when no style saved");
await P.keyboard.press("Escape");
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("tool-style: ok");await h.close();
})().catch(e=>{console.error(e);process.exit(1)});
