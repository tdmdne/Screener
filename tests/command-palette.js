// E-02: Ctrl/Cmd+K command palette. Keyboard-only flow, ARIA combobox/listbox, runs existing app actions.
const assert=require("assert");const {launch}=require("./harness");
(async()=>{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1);
await P.evaluate(()=>go("chart"));await P.waitForTimeout(300);
const open=()=>P.evaluate(()=>!!document.querySelector(".vt-cmd"));

// opens on Ctrl+K, input focused, Esc closes and returns focus
await P.keyboard.press("Control+k");
assert.ok(await open(),"palette opens");
assert.strictEqual(await P.evaluate(()=>document.activeElement.getAttribute("role")),"combobox","input focused");
assert.strictEqual(await P.getAttribute(".vt-cmd","aria-modal"),"true");
await P.keyboard.press("Escape");
assert.ok(!(await open()),"Esc closes");

// timeframe via keyboard
await P.keyboard.press("Control+k");
await P.keyboard.type("4H");
const first=await P.$eval('.vt-cmd-opt[aria-selected="true"]',e=>e.textContent);
assert.ok(first.includes("4H"),"4H first: "+first);
assert.ok(await P.evaluate(()=>{const i=document.querySelector(".vt-cmd input");return !!document.getElementById(i.getAttribute("aria-activedescendant"))}),"aria-activedescendant points at an option");
await P.keyboard.press("Enter");
assert.ok(!(await open()),"closes after run");
assert.strictEqual(await P.evaluate(()=>S.chart.tf),"4H","timeframe applied");

// symbol
await P.keyboard.press("Control+k");await P.keyboard.type("GBPUSD");
await P.waitForFunction(()=>[...document.querySelectorAll(".vt-cmd-opt")].some(o=>o.textContent.startsWith("GBPUSD")));
await P.keyboard.press("Enter");
assert.strictEqual(await P.evaluate(()=>S.chart.sym),"GBPUSD","symbol opened");

// arrow navigation + drawing tool
await P.keyboard.press("Control+k");await P.keyboard.type("fib retr");
await P.keyboard.press("ArrowDown");await P.keyboard.press("ArrowUp");
await P.keyboard.press("Enter");
assert.strictEqual(await P.evaluate(()=>TOOL),"fib","drawing tool selected");
await P.evaluate(()=>setTool("cross"));

// page navigation from anywhere (palette works off the chart page too)
await P.keyboard.press("Control+k");await P.keyboard.type("journal");await P.keyboard.press("Enter");
await P.waitForFunction(()=>location.hash==="#/journal");
await P.keyboard.press("Control+k");assert.ok(await open(),"opens on a non-chart page");
// Ctrl+K again toggles closed
await P.keyboard.press("Control+k");assert.ok(!(await open()),"Ctrl+K toggles closed");

// empty state + backdrop click closes
await P.keyboard.press("Control+k");await P.keyboard.type("zzzzqqq");
assert.strictEqual(await P.$eval(".vt-cmd-list",e=>e.textContent),"No matching commands");
await P.mouse.click(5,5);assert.ok(!(await open()),"backdrop click closes");

// labels are text, never parsed as HTML
await P.evaluate(()=>{S.tfCustom=(S.tfCustom||[]).concat(['<img src=x onerror="window.__xss=1">'])});
await P.keyboard.press("Control+k");await P.keyboard.type("img");await P.waitForTimeout(100);
assert.ok(!(await P.evaluate(()=>window.__xss||document.querySelector(".vt-cmd img"))),"no HTML injection");
await P.keyboard.press("Escape");

assert.deepStrictEqual(h.offOrigin,[],"no non-origin requests");
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("command-palette: ok");await h.close();
})().catch(e=>{console.error(e);process.exit(1)});
