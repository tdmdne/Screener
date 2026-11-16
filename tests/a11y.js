// Accessibility: axe-core (WCAG 2.1 A/AA rules) on every page, both themes, and the main dialogs; keyboard paths:
// skip link, nav, sortable headers, clickable rows, dialogs (focus in, Tab trapped, Esc closes, focus returns).
const {launch}=require("./harness");const assert=require("assert");const fs=require("fs");const path=require("path");
const AXE=fs.readFileSync(path.join(__dirname,"../node_modules/axe-core/axe.min.js"),"utf8");
const axe=async(P,ctx)=>{await P.evaluate(AXE);return P.evaluate(async c=>(await axe.run(c||document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}})).violations.map(v=>v.id+" x"+v.nodes.length+" "+v.nodes[0].target.join(" ")),ctx)};
const PAGES=["workspace","chart","screener","heatmap","calendar","journal","calc","backtest","legal/privacy","legal/your-data"];
(async()=>{for(const theme of ["dark","light"]){const h=await launch({colorScheme:theme});const P=h.page;await P.goto(h.base);
  await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));await P.evaluate(()=>openChart("BTCUSDT","1H"));
  for(const pg of PAGES){await P.evaluate(p=>{location.hash="#/"+p},pg);await P.waitForTimeout(700);const v=await axe(P);assert.deepStrictEqual(v,[],theme+" "+pg+": "+v.join(" | "))}
  await P.evaluate(()=>{location.hash="#/chart"});await P.waitForTimeout(500);
  for(const f of ["alertsM()","setM()","tplM()","presetInfo()","indM&&indM()"]){await P.evaluate(f);await P.waitForTimeout(250);const v=await axe(P,"#modal");assert.deepStrictEqual(v,[],theme+" "+f+": "+v.join(" | "));await P.evaluate(()=>closeM())}
  console.log(theme,"axe clean");assert.deepStrictEqual(h.errors,[]);await h.close()}
const h=await launch();const P=h.page;await P.goto(h.base);await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
await P.evaluate(()=>{openChart("BTCUSDT","1H");go("workspace")});await P.waitForTimeout(500);
// skip link is the first Tab stop and moves focus to the main landmark
await P.evaluate(()=>document.activeElement&&document.activeElement.blur());await P.keyboard.press("Tab");
assert.strictEqual(await P.evaluate(()=>document.activeElement.className),"vt-skip");await P.keyboard.press("Enter");
assert.strictEqual(await P.evaluate(()=>document.activeElement.getAttribute("role")),"main");assert.strictEqual(await P.evaluate(()=>document.querySelectorAll('[role="main"]').length),1);
// nav by keyboard
await P.focus('#vnav a[data-p="calc"]');await P.keyboard.press("Enter");await P.waitForTimeout(300);assert.strictEqual(await P.evaluate(()=>document.documentElement.dataset.page),"calc");
assert.strictEqual(await P.getAttribute('#vnav a[data-p="calc"]',"aria-current"),"page");await P.evaluate(()=>go("workspace"));await P.waitForTimeout(300);
// sortable header: focusable, Enter sorts, aria-sort exposed
const hd=P.locator("#t thead span.h").first();assert.strictEqual(await hd.getAttribute("role"),"button");await hd.focus();await P.keyboard.press("Enter");await P.waitForTimeout(250);
assert(await P.evaluate(()=>[...document.querySelectorAll("#t thead th")].some(th=>/ascending|descending/.test(th.getAttribute("aria-sort")||""))));
// clickable symbol cell opens the chart with Enter
const cell=P.locator("#t tbody td.sy").nth(1);const sym=(await cell.textContent()).trim().split(" ")[0];await cell.focus();await P.keyboard.press("Enter");await P.waitForTimeout(300);
assert.strictEqual(await P.evaluate(()=>S.chart.sym),sym);
// dialog: focus moves in, Tab stays in, Esc closes and focus returns to the opener
await P.evaluate(()=>go("chart"));await P.waitForTimeout(400);const opener=P.locator('#cp button[onclick="alertsM()"]');await opener.focus();await P.keyboard.press("Enter");await P.waitForSelector("#modal .box");await P.waitForTimeout(50);
assert(await P.evaluate(()=>MD.contains(document.activeElement)));assert.strictEqual(await P.getAttribute("#modal .box","role"),"dialog");
for(let i=0;i<25;i++)await P.keyboard.press("Tab");assert(await P.evaluate(()=>MD.contains(document.activeElement)),"Tab trapped");
for(let i=0;i<5;i++)await P.keyboard.press("Shift+Tab");assert(await P.evaluate(()=>MD.contains(document.activeElement)));
await P.keyboard.press("Escape");assert(!(await P.$("#modal .box")));assert(await P.evaluate(()=>document.activeElement.getAttribute("onclick")==="alertsM()"),"focus returned");
// dock section toggle is a real button with aria-expanded
const dk=P.locator(".dkt .dktb").first();if(await dk.count()){const e0=await dk.getAttribute("aria-expanded");await dk.focus();await P.keyboard.press("Enter");await P.waitForTimeout(150);assert.notStrictEqual(await P.locator(".dkt .dktb").first().getAttribute("aria-expanded"),e0)}
// visible focus outline on a button
await P.locator("#cp button").first().focus();await P.keyboard.press("Shift+Tab");await P.keyboard.press("Tab");
const ol=await P.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle+" "+getComputedStyle(document.activeElement).outlineWidth);assert(/solid 2px/.test(ol),ol);
// icon-only buttons have names
const unnamed=await P.evaluate(()=>[...document.querySelectorAll("button")].filter(b=>b.offsetParent&&!/[A-Za-z0-9]/.test((b.getAttribute("aria-label")||"")+(b.textContent||""))).map(b=>b.outerHTML.slice(0,80)));
assert.deepStrictEqual(unnamed,[]);
console.log("errors",h.errors,"console",h.consoleErr);assert.deepStrictEqual(h.errors,[]);await h.close();
console.log("A11Y OK")})().catch(e=>{console.error(e);process.exit(1)});
