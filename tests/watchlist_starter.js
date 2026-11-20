// TASK-06: starter watchlist for new accounts/guests, "Clear starter list", and the chart header's
// "+ Watchlist" / "Locate in Screener" buttons (src/watchlist_starter.js).
const {launch}=require("./harness");const assert=require("assert");const fs=require("fs");
fs.mkdirSync(__dirname+"/../shots/m",{recursive:true});
const STARTER=["BTCUSDT","EURUSD","SPY","XAUUSD","NVDA"];
const ready=P=>P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
const wl=P=>P.evaluate(()=>wlAll());
const groups=P=>P.evaluate(()=>JSON.parse(JSON.stringify(S.wlx.groups.map(g=>({id:g.id,name:g.name,syms:g.syms})))));
const saved=P=>P.evaluate(()=>{const v=localStorage.getItem(vtSK("scr2"));return v?JSON.parse(v):null});
const clearBtn=P=>P.evaluate(()=>{const b=document.getElementById("vtWlClear");return b?{vis:!!b.offsetParent,txt:b.textContent}:null});
const addBtn=P=>P.evaluate(()=>{const b=document.getElementById("vtWlAdd");return b?{vis:!!b.offsetParent,txt:b.textContent.trim(),dis:b.getAttribute("aria-disabled")==="true"}:null});
const clean=(h,label)=>{console.log(label,"errors",h.errors,"console",h.consoleErr);assert.deepStrictEqual(h.errors,[],label+" page errors");assert.deepStrictEqual(h.consoleErr,[],label+" console errors")};
(async()=>{
// 1) fresh signed-in account gets the starter list (first section), saved under the account; reload keeps it, no duplicates
let h=await launch();let P=h.page;await P.goto(h.base);await ready(P);
await P.waitForFunction(n=>wlAll().length===n,STARTER.length,{timeout:5000}).catch(()=>{});
assert.deepStrictEqual(await wl(P),STARTER,"starter list seeded");
assert.deepStrictEqual((await groups(P))[0].syms,STARTER,"seeded into the first section");
assert.strictEqual(await P.evaluate(()=>document.querySelectorAll("#wl .wr[data-s]").length),STARTER.length,"starter rows rendered");
let sv=await saved(P);assert(sv&&sv.wlx.groups[0].syms.join()===STARTER.join(),"starter list persisted for the account");
let cb=await clearBtn(P);assert(cb&&cb.vis&&/clear starter list/i.test(cb.txt),"Clear starter list visible: "+JSON.stringify(cb));
// watchlist rows: no interactive control nested in another (axe nested-interactive); Enter on the symbol opens its chart
await P.waitForTimeout(200);
const nest=await P.evaluate(()=>[...document.querySelectorAll('#wl [role="button"],#wl [tabindex="0"]')].filter(x=>x.querySelector("button,[role=button],[tabindex='0']")).map(x=>x.className));
assert.deepStrictEqual(nest,[],"no nested interactive watchlist rows");
await P.focus('#wl .wr[data-s="NVDA"] .wn');await P.keyboard.press("Enter");await P.waitForFunction(()=>S.chart.sym==="NVDA",null,{timeout:3000});
await P.reload();await ready(P);await P.waitForTimeout(300);
assert.deepStrictEqual(await wl(P),STARTER,"reload keeps the starter list without duplicates");
assert((await clearBtn(P)).vis,"Clear starter list still offered while the list is untouched");
// 2) Clear starter list (keyboard): empties it; stays empty after reload; button gone
await P.focus("#vtWlClear");await P.keyboard.press("Enter");await P.waitForTimeout(200);
assert.deepStrictEqual(await wl(P),[],"cleared");assert.strictEqual(await clearBtn(P),null,"button removed after clearing");
await P.reload();await ready(P);await P.waitForTimeout(400);
assert.deepStrictEqual(await wl(P),[],"stays empty after reload (no re-seed)");assert.strictEqual(await clearBtn(P),null);
// 3) + Watchlist on the chart header adds the charted symbol once
await P.evaluate(()=>{openChart("ETHUSDT","1H");go("chart")});await P.waitForFunction(()=>ch&&document.documentElement.dataset.page==="chart");await P.waitForTimeout(200);
let ab=await addBtn(P);assert(ab&&ab.vis&&ab.txt==="+ Watchlist"&&!ab.dis,"+ Watchlist visible: "+JSON.stringify(ab));
const lb=await P.evaluate(()=>{const b=document.getElementById("vtWlLocate");return b?{vis:!!b.offsetParent,txt:b.textContent.trim()}:null});
assert(lb&&lb.vis&&lb.txt==="Locate in Screener","Locate in Screener visible: "+JSON.stringify(lb));
await P.click("#vtWlAdd");await P.waitForTimeout(150);
ab=await addBtn(P);assert(ab.dis&&/In Watchlist/.test(ab.txt),"added state: "+JSON.stringify(ab));
await P.click("#vtWlAdd",{force:true});await P.waitForTimeout(100); // a second click (aria-disabled, still focusable) must not duplicate
assert.strictEqual(await P.evaluate(()=>document.activeElement.id),"vtWlAdd","focus stays on the button");
assert.deepStrictEqual(await wl(P),["ETHUSDT"],"added exactly once");
assert.strictEqual((await saved(P)).wlx.groups[0].syms.filter(s=>s==="ETHUSDT").length,1,"saved once");
// chart symbol change re-evaluates the state; the existing header star now works too
await P.evaluate(()=>openChart("SOLUSDT","1H"));await P.waitForTimeout(200);
ab=await addBtn(P);assert(!ab.dis&&ab.txt==="+ Watchlist","state follows the charted symbol");
await P.click("#wst");await P.waitForTimeout(150);assert.deepStrictEqual(await wl(P),["ETHUSDT","SOLUSDT"],"header star adds");
assert((await addBtn(P)).dis,"+ Watchlist reflects the star");
await P.click("#wst");await P.waitForTimeout(150);assert.deepStrictEqual(await wl(P),["ETHUSDT"],"header star removes");
assert(!(await addBtn(P)).dis,"+ Watchlist re-enabled after removal");
// removing from the watchlist panel re-enables the button
await P.evaluate(()=>openChart("ETHUSDT","1H"));await P.waitForTimeout(150);assert((await addBtn(P)).dis);
await P.evaluate(()=>wlRm(S.wlx.groups[0].id,"ETHUSDT"));await P.waitForTimeout(150);assert(!(await addBtn(P)).dis,"panel removal re-enables");
// 4) Locate in Screener: screener page, row present, selected, in view
await P.evaluate(()=>openChart("SOLUSDT","1H"));await P.waitForTimeout(150);
await P.click("#vtWlLocate");await P.waitForFunction(()=>document.documentElement.dataset.page==="screener");await P.waitForTimeout(400);
const inView=sym=>P.evaluate(sym=>{const tr=document.querySelector(`#t tbody tr[data-s="${sym}"]`);if(!tr)return{found:false};const r=tr.getBoundingClientRect();
  let c=tr.parentElement;while(c&&c!==document.body&&!(c.scrollHeight>c.clientHeight&&/(auto|scroll)/.test(getComputedStyle(c).overflowY)))c=c.parentElement;
  const cr=c&&c!==document.body?c.getBoundingClientRect():{top:0,bottom:innerHeight};
  return{found:true,sel:tr.classList.contains("sel"),vis:r.height>0&&r.top>=cr.top-1&&r.bottom<=Math.min(cr.bottom,innerHeight)+1}},sym);
let lv=await inView("SOLUSDT");assert(lv.found&&lv.sel&&lv.vis,"located row: "+JSON.stringify(lv));
// filtered out by the search box: the search is cleared, the row shown and the user told why
await P.fill("#q","zzzz");await P.waitForTimeout(400);assert(!(await inView("SOLUSDT")).found);
await P.evaluate(()=>{openChart("SOLUSDT","1H");go("chart")});await P.waitForTimeout(300);
await P.click("#vtWlLocate");await P.waitForFunction(()=>document.documentElement.dataset.page==="screener");await P.waitForTimeout(400);
lv=await inView("SOLUSDT");assert(lv.found&&lv.sel&&lv.vis,"located after clearing the search: "+JSON.stringify(lv));
assert.strictEqual(await P.inputValue("#q"),"","search box cleared");assert(/search/i.test(await P.textContent("#msg")),"explains the cleared search: "+await P.textContent("#msg"));
// a deep row (not on the first page) is reached
const deep=await P.evaluate(()=>{const R=rows(S.cols.filter(c=>!c.hide));return R.length>(S.rows||20)?R[R.length-1].s[0]:null});
if(deep){await P.evaluate(d=>{openChart(d,"1H");go("chart")},deep);await P.waitForTimeout(300);await P.click("#vtWlLocate");
  await P.waitForFunction(()=>document.documentElement.dataset.page==="screener");await P.waitForTimeout(400);lv=await inView(deep);assert(lv.found&&lv.sel&&lv.vis,"deep row "+deep+": "+JSON.stringify(lv))}
// not in the screener universe: explained, stays on the chart
await P.evaluate(()=>{openChart("ZZQX","1H");go("chart")});await P.waitForTimeout(300);await P.click("#vtWlLocate");await P.waitForTimeout(300);
assert.strictEqual(await P.evaluate(()=>document.documentElement.dataset.page),"chart","stays on the chart");
assert(/ZZQX/.test(await P.textContent("#msg")),"explains the missing row: "+await P.textContent("#msg"));
await P.evaluate(()=>openChart("BTCUSDT","1H"));
clean(h,"signed-in");
// 5) existing accounts are untouched: a custom watchlist, and a deliberately emptied one
const tpl=await saved(P);delete tpl.wlStarter;
const bob=Object.assign(JSON.parse(JSON.stringify(tpl)),{wlx:{open:true,groups:[{id:"g1",name:"Mine",open:true,syms:["AAPL","TSLA"]},{id:"g9",name:"FX",open:false,syms:["GBPUSD"]}]}});
const carol=Object.assign(JSON.parse(JSON.stringify(tpl)),{wlx:{open:true,groups:[{id:"g1",name:"Traded",open:true,syms:[]},{id:"g2",name:"Section",open:true,syms:[]}]}});
const keys=await P.evaluate(()=>[vtUidHash("bob"),vtUidHash("carol")]);
for(const [who,st,hash] of [["bob",bob,keys[0]],["carol",carol,keys[1]]]){
  await P.evaluate(([who,st,hash])=>{localStorage.setItem("scr2a",JSON.stringify({id:who}));localStorage.setItem("scr2~"+hash,JSON.stringify(st))},[who,st,hash]);
  await P.reload();await ready(P);await P.waitForTimeout(500);
  assert.deepStrictEqual(await P.evaluate(()=>VT_UID),who);
  assert.deepStrictEqual(await groups(P),st.wlx.groups.map(g=>({id:g.id,name:g.name,syms:g.syms})),who+": watchlist untouched");
  assert.strictEqual(await clearBtn(P),null,who+": no Clear starter list");
  const s2=await saved(P);assert.deepStrictEqual(s2.wlx.groups.map(g=>g.syms),st.wlx.groups.map(g=>g.syms),who+": saved watchlist untouched");
  assert(!("wlStarter" in s2),who+": no starter flag written");
  await P.reload();await ready(P);await P.waitForTimeout(300);
  assert.deepStrictEqual((await groups(P)).map(g=>g.syms),st.wlx.groups.map(g=>g.syms),who+": still untouched after reload")}
clean(h,"existing");await h.close();
// 6) guest: starter list in memory only, nothing written to localStorage; Clear works for the session
h=await launch({auth:false,d1:true});P=h.page;await P.goto(h.base+"#/login");await P.waitForSelector("#auGuest",{state:"visible"});
await P.click("#auGuest");await ready(P);await P.waitForFunction(n=>wlAll().length===n,STARTER.length,{timeout:5000}).catch(()=>{});
assert.deepStrictEqual(await wl(P),STARTER,"guest gets the starter list");
const noWrites=async()=>{const ls=await P.evaluate(()=>Object.entries(localStorage));
  assert.deepStrictEqual(ls.filter(([k])=>k.startsWith("scr2")),[],"no scr2* keys for guests");
  assert.deepStrictEqual(ls.filter(([k,v])=>/wlStarter|vtWl|BTCUSDT/.test(k+v)),[],"no starter data in localStorage")};
await noWrites();assert((await clearBtn(P)).vis);
await P.click("#vtWlClear");await P.waitForTimeout(150);assert.deepStrictEqual(await wl(P),[]);await noWrites();
await P.evaluate(()=>{openChart("BTCUSDT","1H");go("chart")});await P.waitForTimeout(300);await P.click("#vtWlAdd");await P.waitForTimeout(100);
assert.deepStrictEqual(await wl(P),["BTCUSDT"]);await noWrites();
clean(h,"guest");await h.close();
// 7) phone 390px: no sideways overflow, 44px targets for the new buttons
h=await launch({viewport:{width:390,height:844},mobile:true});P=h.page;await P.goto(h.base);await ready(P);await P.waitForTimeout(400);
await P.evaluate(()=>{openChart("BTCUSDT","1H");go("chart")});await P.waitForFunction(()=>ch&&document.documentElement.dataset.page==="chart");await P.waitForTimeout(500);
for(const id of ["vtWlAdd","vtWlLocate"]){const el=P.locator("#"+id);await el.scrollIntoViewIfNeeded();const b=await el.boundingBox();assert(b&&b.height>=44&&b.width>=44,id+" 44px: "+JSON.stringify(b))}
let ov=await P.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert(ov<=1,"chart page sideways overflow "+ov);
await P.screenshot({path:__dirname+"/../shots/m/390_watchlist_starter_chart.png"});
assert.deepStrictEqual(await wl(P),STARTER,"phone: starter list still untouched");
await P.evaluate(()=>go("workspace"));await P.waitForTimeout(500); // on phones the watchlist panel is shown on Workspace (hidden on the screener page by existing layout)
const cl=P.locator("#vtWlClear");await cl.scrollIntoViewIfNeeded();assert(await cl.isVisible(),"phone: Clear starter list visible");
const cbb=await cl.boundingBox();assert(cbb.height>=44&&cbb.width>=44,"Clear 44px: "+JSON.stringify(cbb));
ov=await P.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert(ov<=1,"workspace sideways overflow "+ov);
await P.screenshot({path:__dirname+"/../shots/m/390_watchlist_starter_list.png"});
clean(h,"phone");await h.close();
console.log("WATCHLIST STARTER OK")})().catch(e=>{console.error(e);process.exit(1)});
