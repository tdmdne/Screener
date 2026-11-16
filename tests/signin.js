// Sign-in screen: animated backdrop (static under reduced motion), real ticker snippets, guest mode,
// the sign-in prompt for guest-only limits, guest work not persisted, sign-in from guest without reload or new sockets.
const {launch}=require("./harness");const assert=require("assert");const fs=require("fs");
fs.mkdirSync(__dirname+"/../shots/m",{recursive:true});
const frame=P=>P.evaluate(()=>document.getElementById("aubg").toDataURL());
(async()=>{
// 1) desktop, no consent yet, not signed in
let h=await launch({auth:false,consent:false});let P=h.page;await P.goto(h.base);
await P.waitForSelector("#auth .auhero h1");assert(await P.evaluate(()=>document.documentElement.classList.contains("locked")));
await P.waitForFunction(()=>document.querySelectorAll("#autick span b").length>=3);
const tk=await P.evaluate(()=>[...document.querySelectorAll("#autick span b")].map(b=>b.textContent));assert.deepStrictEqual(tk.slice(0,3),["BTC","ETH","SOL"]);
const f1=await frame(P);await P.waitForTimeout(400);const f2=await frame(P);assert.notStrictEqual(f1,f2,"backdrop animates");
assert(await P.isVisible("#auGuest"));assert.strictEqual(await P.isChecked("#auRem"),false,"keep-me-signed-in unticked");
// keyboard: Tab order reaches the guest button
await P.focus("#auBtn");await P.keyboard.press("Tab");assert.strictEqual(await P.evaluate(()=>document.activeElement.id),"auGuest");
await P.waitForTimeout(300);await P.screenshot({path:__dirname+"/../shots/11_signin.png"});
// 2) guest: app boots, nothing optional stored
await P.click("#auGuest");await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
const st=await P.evaluate(()=>({lk:Object.keys(localStorage),sk:Object.keys(sessionStorage),g:vtIsGuest(),cls:document.documentElement.classList.contains("vtguest"),lgo:document.getElementById("lgo").textContent,raf:AUBG.raf}));
assert(st.g&&st.cls&&st.lgo==="Sign in",JSON.stringify(st));assert(!st.lk.includes("scr2")&&!st.lk.includes("scr2a"),"no app state in localStorage: "+st.lk);
assert(st.sk.includes("vt_guest"));assert.strictEqual(st.raf,0,"backdrop stops when hidden");
const dbs=await P.evaluate(async()=>indexedDB.databases?(await indexedDB.databases()).map(d=>d.name):[]);assert(!dbs.includes("scr"),"no IDB before consent");
// guests can chart and screen
await P.evaluate(()=>{openChart("BTCUSDT","1H");go("chart")});await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]);
await P.evaluate(()=>go("screener"));await P.waitForTimeout(300);assert(await P.evaluate(()=>document.documentElement.dataset.page==="screener"));
// gate: alerts and settings
const n0=await P.evaluate(()=>(S.alerts||[]).length);await P.evaluate(()=>vtAddAlertAt("BTCUSDT",123));await P.waitForSelector("#vg_h");
assert(/Sign in to save alerts/.test(await P.textContent("#vg_h")));assert.strictEqual(await P.evaluate(()=>(S.alerts||[]).length),n0);
assert.strictEqual(await P.evaluate(()=>document.activeElement.id),"vg_in");await P.keyboard.press("Tab");assert.strictEqual(await P.evaluate(()=>document.activeElement.id),"vg_no");
await P.keyboard.press("Escape");assert(!(await P.$("#vg_h")));
await P.evaluate(()=>setM());await P.waitForSelector("#vg_h");assert(/chart settings/.test(await P.textContent("#vg_h")));await P.click("#vg_no");
// guest work is memory-only
await P.evaluate(()=>{S.__probe=1;save()});assert.strictEqual(await P.evaluate(()=>localStorage.getItem("scr2")),null);
// reload keeps guest mode for the tab
await P.reload();await P.waitForFunction(()=>BOOTED);assert(await P.evaluate(()=>vtIsGuest()&&!document.documentElement.classList.contains("locked")));
// 3) sign in from guest mode: no reload, sockets kept, work saved from now on
await P.evaluate(()=>{openChart("BTCUSDT","1H");window.__ws0=__WS.length;window.__mark=1});await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]);
await P.click("#lgo");await P.waitForSelector("#auId",{state:"visible"});assert(await P.isVisible("#auClose"));
await P.keyboard.press("Escape");assert(!(await P.evaluate(()=>document.documentElement.classList.contains("locked"))));
await P.click("#lgo");await P.fill("#auId","ann@example.com");await P.fill("#auPw","x");await P.click("#auBtn");
await P.waitForFunction(()=>!document.documentElement.classList.contains("locked"));
const s2=await P.evaluate(()=>({mark:window.__mark,ws:__WS.length-__ws0,g:vtIsGuest(),lgo:document.getElementById("lgo").textContent,a:sessionStorage.getItem("scr2a"),la:localStorage.getItem("scr2a"),vg:sessionStorage.getItem("vt_guest"),scr2:!!localStorage.getItem("scr2")}));
assert.deepStrictEqual(s2,{mark:1,ws:0,g:false,lgo:"Log out",a:JSON.stringify({id:"ann@example.com"}),la:null,vg:null,scr2:true});
await P.evaluate(()=>vtAddAlertAt("BTCUSDT",123));assert(!(await P.$("#vg_h")),"no gate once signed in");
console.log("errors",h.errors,"console",h.consoleErr);assert.deepStrictEqual(h.errors,[]);await h.close();
// 4) reduced motion: one static frame, no animation loop
h=await launch({auth:false,reducedMotion:"reduce"});P=h.page;await P.goto(h.base);await P.waitForSelector("#auth .auhero h1");await P.waitForTimeout(200);
const r1=await frame(P);await P.waitForTimeout(400);const r2=await frame(P);assert.strictEqual(r1,r2,"static under reduced motion");assert.strictEqual(await P.evaluate(()=>AUBG.raf),0);
assert(r1.length>5000,"static frame drawn");await h.close();
// 5) phone
h=await launch({auth:false,viewport:{width:390,height:844},mobile:true});P=h.page;await P.goto(h.base);await P.waitForSelector("#auth .auhero h1");
await P.waitForFunction(()=>document.querySelectorAll("#autick span b").length>=3);
const ov=await P.evaluate(()=>{const a=document.getElementById("auth");return a.scrollWidth-a.clientWidth});assert(ov<=1,"no sideways scroll "+ov);
const gb=await P.locator("#auGuest").boundingBox();assert(gb.height>=44);
await P.waitForTimeout(300);await P.screenshot({path:__dirname+"/../shots/m/390_signin.png"});
await P.tap("#auGuest");await P.waitForFunction(()=>BOOTED);assert(await P.evaluate(()=>vtIsGuest()));
console.log("errors",h.errors,"console",h.consoleErr);assert.deepStrictEqual(h.errors,[]);await h.close();
console.log("SIGNIN OK")})().catch(e=>{console.error(e);process.exit(1)});
