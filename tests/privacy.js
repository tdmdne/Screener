// UK GDPR / PECR mechanisms: consent banner (Reject == Accept), no optional storage before consent, consent log,
// cookie settings / withdraw, privacy centre export + delete-all (with confirmation, disconnects feeds), DSR form gating, legal modal over sign-in.
const {launch}=require("./harness");const assert=require("assert");const fs=require("fs");
const dbs=P=>P.evaluate(async()=>(await indexedDB.databases()).map(d=>d.name));
(async()=>{const h=await launch({consent:false});const P=h.page;await P.goto(h.base);
await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));await P.evaluate(()=>openChart("BTCUSDT","1H"));await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]);await P.waitForTimeout(2600);
// 1) banner on first visit; Reject and Accept identical in size and style
assert(await P.isVisible("#vcb"),"banner");
const st=await P.evaluate(()=>{const g=id=>{const e=document.getElementById(id),c=getComputedStyle(e),r=e.getBoundingClientRect();return[Math.round(r.width),Math.round(r.height),c.backgroundColor,c.color,c.fontSize,c.fontWeight,c.borderColor,e.className]};return[g("vcb_rej"),g("vcb_acc")]});
console.log("buttons",JSON.stringify(st));assert.deepStrictEqual(st[0],st[1]);
assert(!(await dbs(P)).includes("scr"),"no IndexedDB before consent");
await P.screenshot({path:"shots/10_consent_banner.png"});
// manage: optional category off by default
await P.click("#vcb_man");assert.strictEqual(await P.isChecked("#vcb_cache"),false);assert.strictEqual(await P.isChecked("#vcb_nec"),true);
await P.click("#vcb_rej");await P.waitForTimeout(200);assert(!(await P.isVisible("#vcb")));
let c=await P.evaluate(()=>[JSON.parse(localStorage.getItem("vt_consent")),JSON.parse(localStorage.getItem("vt_consent_log"))]);
assert.strictEqual(c[0].cache,false);assert.strictEqual(c[0].v,"1.0");assert(c[0].ts>0);assert.strictEqual(c[1].length,1);assert.strictEqual(c[1][0].method,"reject_all");
await P.waitForTimeout(2500);assert(!(await dbs(P)).includes("scr"),"still no IndexedDB after reject");
// 2) footer "Cookie settings" -> enable cache -> IndexedDB created and filled
await P.click("#vft_ck");await P.check("#vcb_cache");await P.click("#vcb_save");await P.waitForTimeout(2800);
assert((await dbs(P)).includes("scr"),"IndexedDB after consent");
c=await P.evaluate(()=>JSON.parse(localStorage.getItem("vt_consent_log")).map(x=>x.method+":"+x.cache));assert.deepStrictEqual(c,["reject_all:false","custom:true"]);
// 3) privacy centre: inventory, export JSON
await P.evaluate(()=>{location.hash="#/legal/your-data"});await P.waitForTimeout(600);
const inv=await P.textContent("#pc_inv");assert(inv.includes("scr2")&&/\d+ entries/.test(inv),inv);
assert((await P.textContent("#pc_log")).includes("custom"));
const [dl]=await Promise.all([P.waitForEvent("download"),P.click("#pc_exp")]);const f=await dl.path();const J=JSON.parse(fs.readFileSync(f,"utf8"));
assert(J.localStorage.scr2&&J.localStorage.vt_consent_log.length===2&&J.indexedDB.note,"export");console.log("export keys",Object.keys(J.localStorage));
// 4) withdraw -> cache deleted
await P.click("#pc_wd");await P.waitForTimeout(600);assert(!(await dbs(P)).includes("scr"),"withdraw deletes cache");
assert.strictEqual(await P.evaluate(()=>vtConsent().method),"withdrawn");
// 5) DSR form: unticked consent box gates the button; no address configured -> honest message, nothing sent
assert.strictEqual(await P.isChecked("#dsr_ok"),false);assert(await P.isDisabled("#dsr_go"));
await P.fill("#dsr_e","me@example.com");assert(await P.isDisabled("#dsr_go"));await P.check("#dsr_ok");assert(!(await P.isDisabled("#dsr_go")));
await P.evaluate(()=>{vtOpenMail=u=>{window.__mail=u}});await P.click("#dsr_go");const mu=await P.evaluate(()=>window.__mail);assert(mu.startsWith("mailto:vektorhq@proton.me?subject="),mu);assert(/me%40example\.com/.test(mu));assert(/vektorhq@proton\.me/.test(await P.textContent("#dsr_st")));
// 6) delete-all: confirmation needed; wipes everything and disconnects feeds
await P.click("#pc_del");await P.waitForSelector("#vdel_in");assert(await P.isDisabled("#vdel_go"));await P.fill("#vdel_in","delete");assert(await P.isDisabled("#vdel_go"));
await P.click("#vdel_no");assert.strictEqual(await P.$("#vdel_in"),null);
await P.evaluate(()=>{const a=JSON.parse(localStorage.getItem("vt_consent"));vtConsentSet(true,"accept_all")});await P.waitForTimeout(2600);assert((await dbs(P)).includes("scr"));
const w=await P.evaluate(async()=>{const r=await vtWipe();return{r,ls:localStorage.length,ss:sessionStorage.length,ws:[BNWS.ws,BNKL.ws,FHWS.ws].every(x=>!x),rs:__WS.map(x=>x.readyState)}});
console.log("wipe",JSON.stringify(w));assert(w.r&&w.ls===0&&w.ss===0&&w.ws&&w.rs.every(x=>x===3));assert(!(await dbs(P)).includes("scr"));
await P.waitForTimeout(2500);assert.strictEqual(await P.evaluate(()=>localStorage.length),0,"nothing re-written after wipe");
// UI path: type DELETE -> reload, banner back, nothing but the harness login seed
await P.reload();await P.waitForFunction(()=>BOOTED);await P.evaluate(()=>{location.hash="#/legal/your-data"});await P.waitForTimeout(500);
await P.evaluate(()=>{S.__mark="wipe-me";save()});await P.click("#pc_del");await P.fill("#vdel_in","DELETE");
await Promise.all([P.waitForNavigation(),P.click("#vdel_go")]);await P.waitForFunction(()=>typeof BOOTED!=="undefined");await P.waitForTimeout(300);
const after=await P.evaluate(()=>[Object.keys(localStorage),localStorage.getItem("scr2")||""]);console.log("after delete",after[0]);assert(!after[1].includes("wipe-me")&&!after[0].includes("vt_consent")&&!after[0].includes("vt_consent_log"));
assert(await P.isVisible("#vcb"),"banner again after delete");
// 7) legal pages readable over the sign-in screen; Esc closes
await P.evaluate(()=>document.documentElement.classList.add("locked"));await P.click('#vcb a[href="#/legal/cookies"]');await P.waitForSelector("#vlm h1");
assert.strictEqual(await P.textContent("#vlm h1"),"Cookies and Local Storage");await P.keyboard.press("Escape");assert.strictEqual(await P.$("#vlm"),null);
console.log("errors",h.errors,"console",h.consoleErr);assert(!h.errors.length&&!h.consoleErr.length);await h.close();console.log("PRIVACY OK")})().catch(e=>{console.error(e);process.exit(1)});
