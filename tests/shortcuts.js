// Keyboard shortcut overlay: "?" opens/closes it (not while typing, not over another dialog, not on the sign-in screen),
// it is an accessible dialog (axe clean, focus in, Esc, focus return), the current page's section comes first, the footer
// button opens it, and every listed chart / list / heatmap shortcut really does what the list says.
const {launch}=require("./harness");const assert=require("assert");const fs=require("fs");const path=require("path");
const AXE=fs.readFileSync(path.join(__dirname,"../node_modules/axe-core/axe.min.js"),"utf8");
const axe=async(P,ctx)=>{await P.evaluate(AXE);return P.evaluate(async c=>(await axe.run(c||document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}})).violations.map(v=>v.id+" x"+v.nodes.length+" "+v.nodes[0].target.join(" ")),ctx)};
const ready=async P=>{await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"))};
const open=P=>P.evaluate(()=>!!document.querySelector(".kbm"));
(async()=>{for(const theme of ["dark","light"]){const h=await launch({viewport:{width:1440,height:900},colorScheme:theme});const P=h.page;await P.goto(h.base);await ready(P);
await P.evaluate(()=>openChart("BTCUSDT","1H"));await P.waitForTimeout(300);
// 1) "?" opens, it is a labelled dialog with focus inside; the chart section is marked as this page and comes first
await P.focus("body");await P.keyboard.press("Shift+Slash");await P.waitForTimeout(150);
let st=await P.evaluate(()=>{const b=document.querySelector("#modal .box")||document.querySelector(".ov .box");return{open:!!document.querySelector(".kbm"),role:b&&b.getAttribute("role"),lab:b&&b.getAttribute("aria-labelledby"),
  focusIn:!!(document.activeElement&&document.activeElement.closest(".ov")),first:document.querySelector(".kbs").id||document.querySelector(".kbs h4").textContent,here:[...document.querySelectorAll(".kbs.here h4")].map(h=>h.firstChild.textContent.trim())}});
assert.strictEqual(st.open,true);assert.strictEqual(st.role,"dialog");assert.strictEqual(st.lab,"kb_title");assert(st.focusIn,"focus moves into the dialog");
assert(/Screener list|Chart/.test(st.first),st.first);assert.deepStrictEqual(st.here.sort(),["Chart (Workspace and Chart pages)","Screener list (Workspace, Chart, Screener)"]);
const v=await axe(P,"#modal");assert.deepStrictEqual(v,[],theme+" overlay: "+v.join(" | "));
if(theme==="dark")await P.screenshot({path:__dirname+"/../shots/16_shortcuts.png"});
// "?" again closes it; Esc also closes it
await P.keyboard.press("Shift+Slash");await P.waitForTimeout(100);assert.strictEqual(await open(P),false,"? toggles closed");
await P.keyboard.press("Shift+Slash");await P.waitForTimeout(100);await P.keyboard.press("Escape");await P.waitForTimeout(100);assert.strictEqual(await open(P),false,"Esc closes");
// 2) not while typing, not over another dialog
await P.focus("#sq");await P.keyboard.press("Shift+Slash");await P.waitForTimeout(100);assert.strictEqual(await open(P),false,"ignored while typing");
assert.strictEqual(await P.inputValue("#sq"),"?","the ? is typed into the field");await P.fill("#sq","");await P.evaluate(()=>document.activeElement.blur());
await P.evaluate(()=>setM());await P.waitForTimeout(100);await P.keyboard.press("Shift+Slash");await P.waitForTimeout(100);
assert.strictEqual(await open(P),false,"not over another dialog");await P.evaluate(()=>closeM());
// 3) footer button opens it, focus returns to the button on close
await P.focus("#vft_kb");await P.keyboard.press("Enter");await P.waitForTimeout(150);assert.strictEqual(await open(P),true,"footer button");
await P.keyboard.press("Escape");await P.waitForTimeout(150);assert.strictEqual(await P.evaluate(()=>document.activeElement&&document.activeElement.id),"vft_kb","focus returns");
await P.evaluate(()=>document.activeElement.blur());
if(theme==="light"){assert.deepStrictEqual(h.errors,[]);await h.close();continue}
// 4) the listed shortcuts do what the list says
const tool=async k=>{await P.keyboard.press(k);await P.waitForTimeout(40);return P.evaluate(()=>TOOL)};
for(const [k,t] of [["Alt+t","trend"],["Alt+h","hline"],["Alt+v","vline"],["Alt+f","fib"],["Alt+g","rect"],["Alt+a","arrow"],["Alt+n","note"]]){assert.strictEqual(await tool(k),t,k);await P.keyboard.press("Escape");assert.strictEqual(await P.evaluate(()=>TOOL),"cross","Esc back to cursor")}
await P.keyboard.press("Alt+r");await P.waitForTimeout(60);assert.strictEqual(await P.evaluate(()=>TOOL),"cross","Alt+R resets chart view without changing tool");
const hid=await P.evaluate(()=>HIDD);await P.keyboard.press("Control+Alt+h");assert.strictEqual(await P.evaluate(()=>HIDD),!hid,"Ctrl+Alt+H hides drawings");await P.keyboard.press("Control+Alt+h");
await P.keyboard.press("1");await P.waitForTimeout(60);assert(await P.evaluate(()=>{const e=document.getElementById("tfpop");return !!e&&e.style.display!=="none"&&TFBUF==="1"}),"digit opens interval box");
await P.keyboard.press("Escape");await P.waitForTimeout(60);
await P.keyboard.press("e");await P.waitForTimeout(60);assert(await P.evaluate(()=>{const e=document.getElementById("sypop");return !!e&&e.style.display!=="none"&&SYBUF==="E"}),"letter opens symbol search");
await P.keyboard.press("Escape");await P.waitForTimeout(60);
const sv=await P.evaluate(()=>{window.__sv=0;const o=save;save=function(){window.__sv++;return o.apply(this,arguments)};return 1});await P.keyboard.press("Control+s");assert(await P.evaluate(()=>__sv>0),"Ctrl+S saves");
const pgl=await P.evaluate(()=>{render();return[PGL.slice(0,3),S.chart.sym]});await P.evaluate(s=>openChart(s),pgl[0][0]);await P.waitForTimeout(80);
await P.keyboard.press("ArrowDown");await P.waitForTimeout(80);assert.strictEqual(await P.evaluate(()=>S.chart.sym),pgl[0][1],"Down = next symbol");
await P.keyboard.press("ArrowUp");await P.waitForTimeout(80);assert.strictEqual(await P.evaluate(()=>S.chart.sym),pgl[0][0],"Up = previous symbol");
// heatmap: Home/End/Enter
await P.evaluate(()=>go("heatmap"));await P.waitForFunction(()=>document.querySelectorAll(".hmt").length>5);await P.waitForTimeout(300);
await P.focus(".hmt[tabindex='0']");await P.keyboard.press("End");let a=await P.evaluate(()=>{const t=[...document.querySelectorAll(".hmt")];return t.indexOf(document.activeElement)===t.length-1});assert(a,"End = last market");
await P.keyboard.press("Home");a=await P.evaluate(()=>document.activeElement===document.querySelector(".hmt"));assert(a,"Home = first market");
const want=await P.evaluate(()=>document.activeElement.dataset.s);await P.keyboard.press("Enter");await P.waitForTimeout(200);assert.strictEqual(await P.evaluate(()=>S.chart.sym),want,"Enter opens the chart");
// heatmap page: the heatmap section is first
await P.evaluate(()=>go("heatmap"));await P.waitForTimeout(200);await P.evaluate(()=>document.activeElement&&document.activeElement.blur());await P.keyboard.press("Shift+Slash");await P.waitForTimeout(100);
assert.strictEqual(await P.evaluate(()=>document.querySelector(".kbs h4").firstChild.textContent.trim()),"Heatmaps");await P.keyboard.press("Escape");
console.log("errors",h.errors);assert.deepStrictEqual(h.errors,[]);await h.close()}
// 5) sign-in screen: "?" does nothing
const h=await launch({auth:false});const P=h.page;await P.goto(h.base);await P.waitForTimeout(500);await P.evaluate(()=>document.activeElement&&document.activeElement.blur());
await P.keyboard.press("Shift+Slash");await P.waitForTimeout(100);assert.strictEqual(await open(P),false,"not on the sign-in screen");await h.close();
console.log("SHORTCUTS OK");process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});
