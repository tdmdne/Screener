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
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("rail-arrows: ok");await h.close();
})().catch(e=>{console.error(e);process.exit(1)});
