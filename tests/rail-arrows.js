// Left drawing rail: icon keeps its full hit area (click = activate tool); the right-edge arrow strip opens the drawer
// (click or ~300 ms hover) and never overlaps the icon.
const assert=require("assert");const {launch}=require("./harness");
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1);
await P.evaluate(()=>{go("chart");openChart("EURUSD","1H")});await P.waitForSelector('.tbar .vt-rail-grp[data-gid="lines"] .vt-rail-fly');
const geo=await P.evaluate(()=>{const g=document.querySelector('.tbar .vt-rail-grp[data-gid="lines"]'),b=g.querySelector(".vt-rail-btn").getBoundingClientRect(),f=g.querySelector(".vt-rail-fly").getBoundingClientRect();
  // every point across the icon (incl. its right edge) must hit the icon button, not the arrow
  const hits=[0.1,0.5,0.9,0.95].map(fx=>{const el=document.elementFromPoint(b.left+b.width*fx,b.top+b.height/2);return el&&el.closest(".vt-rail-btn")?"btn":el&&el.closest(".vt-rail-fly")?"fly":"other"});
  return{b:[b.left,b.right,b.width],f:[f.left,f.right,f.width,f.height],hits}});
assert.ok(geo.f[0]>=geo.b[1]-0.5,"arrow strip starts after the icon: "+JSON.stringify(geo));
assert.ok(geo.f[2]<=12,"arrow strip is thin: "+geo.f[2]);
assert.deepStrictEqual(geo.hits,["btn","btn","btn","btn"],"whole icon clickable "+JSON.stringify(geo));
// click icon = activate current tool, no drawer
await P.click('.tbar .vt-rail-grp[data-gid="lines"] .vt-rail-btn');
assert.ok(await P.evaluate(()=>TOOL!=="cross"&&!document.getElementById("vt_draw_flyout")),"icon activates tool, drawer closed");
await P.evaluate(()=>setTool("cross"));
// click arrow = drawer
await P.click('.tbar .vt-rail-grp[data-gid="lines"] .vt-rail-fly');
assert.ok(await P.evaluate(()=>{const f=document.getElementById("vt_draw_flyout");return f&&f.dataset.gid==="lines"}),"arrow click opens the drawer");
await P.evaluate(()=>vtCloseDrawFlyout());await P.mouse.move(700,500);
// hover arrow ~300 ms = drawer
await P.hover('.tbar .vt-rail-grp[data-gid="fib"] .vt-rail-fly');await P.waitForTimeout(450);
assert.ok(await P.evaluate(()=>{const f=document.getElementById("vt_draw_flyout");return f&&f.dataset.gid==="fib"}),"hover opens the drawer");
// every group (icon + arrow strip) sits fully inside the rail: nothing clipped by the rail's width
const inside=()=>P.evaluate(()=>{const t=document.querySelector(".tbar").getBoundingClientRect(),bad=[];
  for(const g of document.querySelectorAll(".tbar .vt-rail-grp")){for(const el of g.children){const r=el.getBoundingClientRect();if(!r.width)continue;if(r.left<t.left-0.5||r.right>t.right+0.5)bad.push(g.dataset.gid+":"+el.className+" "+Math.round(r.left)+"-"+Math.round(r.right)+" rail "+Math.round(t.left)+"-"+Math.round(t.right))}}
  return{ui:document.documentElement.dataset.ui,bad}});
let ins=await inside();assert.deepStrictEqual(ins.bad,[],"desktop: groups inside the rail "+JSON.stringify(ins));
assert.deepStrictEqual(h.errors,[],"no page errors");await h.close();
// tablet: the arrow strip is inside the rail and reachable
const h2=await launch({viewport:{width:1024,height:1366},mobile:true});const P2=h2.page;await P2.goto(h2.app);
await P2.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED);await P2.evaluate(()=>{go("chart");openChart("EURUSD","1H")});await P2.waitForSelector(".tbar .vt-rail-grp");
const tab=await P2.evaluate(()=>{const t=document.querySelector(".tbar").getBoundingClientRect(),bad=[];for(const g of document.querySelectorAll(".tbar .vt-rail-grp"))for(const el of g.children){const r=el.getBoundingClientRect();if(r.width&&(r.left<t.left-0.5||r.right>t.right+0.5))bad.push(g.dataset.gid)}return{ui:document.documentElement.dataset.ui,bad}});
assert.deepStrictEqual(tab.bad,[],"tablet/touch: groups inside the rail "+JSON.stringify(tab));
// touch: icons are 44x44, no arrow strip; long-press opens the drawer, a tap activates the tool
const touch=await P2.evaluate(()=>{const g=document.querySelector('.tbar .vt-rail-grp[data-gid="lines"]'),b=g.querySelector(".vt-rail-btn").getBoundingClientRect(),f=g.querySelector(".vt-rail-fly").getBoundingClientRect();return{w:b.width,h:b.height,fly:f.width}});
assert.ok(touch.w>=44&&touch.h>=44&&touch.fly===0,"touch targets "+JSON.stringify(touch));
const bb=await P2.locator('.tbar .vt-rail-grp[data-gid="lines"] .vt-rail-btn').boundingBox();
await P2.touchscreen.tap(bb.x+bb.width/2,bb.y+bb.height/2);
assert.ok(await P2.evaluate(()=>TOOL!=="cross"&&!document.getElementById("vt_draw_flyout")),"tap activates the tool");
await P2.evaluate(()=>setTool("cross"));
const cdp=await P2.context().newCDPSession(P2),pt={x:bb.x+bb.width/2,y:bb.y+bb.height/2};
await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[pt]});await P2.waitForTimeout(650);
await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await P2.waitForTimeout(150);
assert.ok(await P2.evaluate(()=>{const f=document.getElementById("vt_draw_flyout");return f&&f.dataset.gid==="lines"&&TOOL==="cross"}),"long-press opens the drawer without switching tools");
assert.deepStrictEqual(h2.errors,[],"no page errors (tablet)");await h2.close();
console.log("rail-arrows: ok");
})().catch(e=>{console.error(e);process.exit(1)});
