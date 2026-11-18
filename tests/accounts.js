// Shared device: saved work (charts, drawings, journal, templates, alerts, scripts, layouts) is scoped to the signed-in user;
// guests and other users never see it; the same user gets it back; guest -> sign-in with existing saved work asks first;
// data saved before accounts were separated is claimed by whoever was signed in, or offered (never shown to guests).
// Leftover client Twelve Data keys (vt_tdkey~ and a key saved in settings) are deleted on load and never used.
// The browser does not hold or send a Twelve Data key. Binance WebSockets are untouched.
const assert=require("assert");const {launch}=require("./harness");
const booted=P=>P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"),null,{timeout:30000});
const signIn=async(P,id)=>{await P.waitForSelector("#auId",{state:"visible"});await P.waitForTimeout(80);await P.fill("#auId",id);await P.fill("#auPw","pw");
  await Promise.all([P.waitForNavigation({timeout:5000}).catch(()=>null),P.click("#auBtn")]);await booted(P)};
const mine=()=>({uid:VT_UID,dr:JSON.stringify(S.dr||{}),sym:S.chart.sym,up:S.chart.upBody,jr:((S.jr||{}).trades||[]).map(t=>t.note),tpl:((S.tpl||{}).list||[]).map(t=>t.name),al:(S.alerts||[]).map(a=>a.msg),all:JSON.stringify(S)});
const plant=tag=>{S.dr=S.dr||{};S.dr.BTCUSDT=[{id:77,t:"hline",p:[{t:1,y:123.45}],mark:tag}];S.chart.upBody="#123456";jrCfg();S.jr.trades=S.jr.trades||[];S.jr.trades.push({id:"t"+tag,sym:"BTCUSDT",side:"long",entry:1,exit:2,qty:1,date:"2026-11-16",note:tag});
  S.tpl={list:[{id:"tp"+tag,name:tag+" template",cfg:{}}],def:null};S.alerts=[{id:"a"+tag,sym:"BTCUSDT",price:1,msg:tag+" alert"}];S.__who=tag;save();saveP&&saveP()};
(async()=>{
// A) two people on one browser
let h=await launch({auth:false});let P=h.page;await P.goto(h.base);
await signIn(P,"alice@example.com");assert.strictEqual(await P.evaluate(()=>VT_UID),"alice@example.com");
await P.evaluate(t=>{const plant=eval("("+t+")");plant("ALICE-SECRET")},plant.toString());
let ks=await P.evaluate(()=>Object.keys(localStorage));assert(ks.some(k=>/^scr2~[0-9a-f]{16}$/.test(k))&&!ks.includes("scr2"),"scoped key "+ks);
// log out -> guest sees none of it
await Promise.all([P.waitForNavigation(),P.click("#lgo")]);await P.waitForSelector("#auGuest",{state:"visible"});await P.click("#auGuest");await booted(P);
let g=await P.evaluate(mine);assert(!g.all.includes("ALICE-SECRET"),"guest sees nothing of alice");assert.notStrictEqual(g.up,"#123456");assert.deepStrictEqual([g.jr,g.tpl,g.al],[[],[],[]]);
await P.reload();await booted(P);g=await P.evaluate(mine);assert(!g.all.includes("ALICE-SECRET"),"still nothing after reload");
// guest signs in as bob (no saved work yet): the guest session becomes bob's, alice's stays separate
await P.evaluate(()=>{S.__who="guest-session";save()});await P.click("#lgo");await signIn(P,"bob");
let b=await P.evaluate(mine);assert.strictEqual(b.uid,"bob");assert(!b.all.includes("ALICE-SECRET")&&b.all.includes("guest-session"),"bob keeps the guest session");
await P.evaluate(()=>{S.__who="BOB-SECRET";save()});
// bob logs out, alice signs in (case and spaces don't matter): her work is back, bob's isn't there
await Promise.all([P.waitForNavigation(),P.click("#lgo")]);await signIn(P," Alice@Example.com ");
let a=await P.evaluate(mine);assert(a.all.includes("ALICE-SECRET")&&!a.all.includes("BOB-SECRET"),"alice gets her own work back");
assert(/ALICE-SECRET/.test(a.dr)&&a.jr.includes("ALICE-SECRET")&&a.tpl.includes("ALICE-SECRET template")&&a.al.includes("ALICE-SECRET alert")&&a.up==="#123456");
// guest -> sign in as alice while her work exists: asked first; "Open my saved work" loads it
await Promise.all([P.waitForNavigation(),P.click("#lgo")]);await P.click("#auGuest");await booted(P);await P.evaluate(()=>{S.__who="guest-2";S.chart.sym="SOLUSDT"});
await P.click("#lgo");await P.waitForSelector("#auId",{state:"visible"});await P.waitForTimeout(80);await P.fill("#auId","alice@example.com");await P.fill("#auPw","pw");await P.click("#auBtn");
await P.waitForSelector("#ac_h");assert(/alice@example.com/.test(await P.textContent("#ac_p")));
await Promise.all([P.waitForNavigation(),P.click("#ac_open")]);await booted(P);a=await P.evaluate(mine);assert(a.all.includes("ALICE-SECRET")&&!a.all.includes("guest-2"),"saved work opened");
// export on Your data only includes this account
const ex=await P.evaluate(async()=>{const o=await vtExportData(false);return{keys:Object.keys(o.localStorage),other:o.otherAccounts||""}});
assert(ex.keys.filter(k=>/^scr2~/.test(k)).length===1&&/other accounts/.test(ex.other),"export scoped "+JSON.stringify(ex));
console.log("A errors",h.errors);assert.deepStrictEqual(h.errors,[]);await h.close();

// B) older unscoped data, nobody signed in: never shown to guests; later sign-ins are asked
const legacy={cols:[{id:"price",type:"price"}],chart:{sym:"XRPUSDT"},__who:"LEGACY-WORK",dr:{BTCUSDT:[{id:5,t:"hline",p:[{t:1,y:9}]}]}};
h=await launch({auth:false,state:legacy});P=h.page;await P.goto(h.base);await P.waitForSelector("#auGuest",{state:"visible"});
assert.strictEqual(await P.evaluate(()=>localStorage.getItem("vt_legacy")),"1");await P.click("#auGuest");await booted(P);
g=await P.evaluate(mine);assert(!g.all.includes("LEGACY-WORK"),"guest never sees older data");
await P.click("#lgo");await signIn(P,"carol");await P.waitForSelector("#lg_h");await P.click("#lg_no");
let c=await P.evaluate(mine);assert(!c.all.includes("LEGACY-WORK"));await P.reload();await booted(P);await P.waitForTimeout(1300);assert(!(await P.$("#lg_h")),"carol isn't asked again");
await Promise.all([P.waitForNavigation(),P.click("#lgo")]);await signIn(P,"dave");await P.waitForSelector("#lg_h");
await Promise.all([P.waitForNavigation(),P.click("#lg_yes")]);await booted(P);
let d=await P.evaluate(()=>({all:JSON.stringify(S),ks:Object.keys(localStorage)}));
assert(d.all.includes("LEGACY-WORK")&&!d.ks.includes("scr2")&&!d.ks.includes("vt_legacy"),"dave imported it "+d.ks);
console.log("B errors",h.errors);assert.deepStrictEqual(h.errors,[]);await h.close();

// C) older data while someone is signed in: it becomes theirs automatically
h=await launch({state:Object.assign({},legacy,{data:{key:"myOwnTdKey9",mode:"all",v:3}})});P=h.page;await P.goto(h.base);await booted(P);
let e=await P.evaluate(()=>({all:JSON.stringify(S),ks:Object.keys(localStorage),dk:"key" in S.data,saved:localStorage.getItem(vtSK("scr2"))}));
assert(e.all.includes("LEGACY-WORK")&&!e.ks.includes("scr2")&&!e.ks.includes("vt_legacy")&&e.ks.some(k=>/^scr2~/.test(k)),"auto-claimed "+e.ks);
// a Twelve Data key saved inside settings by an older version is deleted, not kept in memory or storage
assert(!e.dk&&!e.all.includes("myOwnTdKey9")&&!e.saved.includes("myOwnTdKey9")&&!e.ks.some(k=>/^vt_tdkey/.test(k)),"legacy Twelve Data key dropped");
await h.close();

// D) leftover client Twelve Data keys are deleted; the browser never holds or sends one
h=await launch({auth:false});P=h.page;const td=[],proxy=[];
await P.route(/api\.twelvedata\.com/,r=>{td.push(r.request().url());r.fulfill({status:404,body:""})});
await P.route(/vektor-market\./,r=>{proxy.push(r.request().url());r.fulfill({contentType:"application/json",body:JSON.stringify({status:"error",message:"feed unavailable"})})});
await P.goto(h.base);await signIn(P,"tester");
await P.evaluate(()=>{const n=typeof vtSK==="function"&&vtSK("vt_tdkey")||"vt_tdkey~tester";
  localStorage.setItem(n,"leftoverTdKey1");localStorage.setItem("vt_tdkey~other","leftoverTdKey2");sessionStorage.setItem("vt_tdkey~sess","leftoverTdKey3");
  const raw=localStorage.getItem(vtSK("scr2"));const st=raw?JSON.parse(raw):{};st.data=Object.assign({},st.data,{key:"leftoverTdKey4"});localStorage.setItem(vtSK("scr2"),JSON.stringify(st))});
await P.reload();await booted(P);
const wiped=await P.evaluate(()=>({ks:[...Object.keys(localStorage),...Object.keys(sessionStorage)].filter(k=>/^vt_tdkey/.test(k)),
  vals:[...Object.values(localStorage),...Object.values(sessionStorage),JSON.stringify(S)].some(v=>String(v).includes("leftoverTdKey")),
  dk:!!(S.data&&("key"in S.data)),td:typeof vtTdKey,tdk:typeof VT_TDK,set:typeof vtTdKeySet,cfg:typeof vtCfgTdKey,note:typeof vtTdKeyNote}));
assert.deepStrictEqual(wiped.ks,[],"leftover vt_tdkey keys deleted");
assert(!wiped.vals&&!wiped.dk,"leftover key values not kept");
assert.strictEqual(wiped.td,"undefined");assert.strictEqual(wiped.tdk,"undefined");
assert.strictEqual(wiped.set,"undefined");assert.strictEqual(wiped.cfg,"undefined");assert.strictEqual(wiped.note,"undefined");
assert.strictEqual(td.length,0,"nothing sent to Twelve Data");
assert(proxy.every(u=>!/[?&]apikey=/.test(u)),"no per-user apikey on the market-data URL");
const ws1=await P.evaluate(()=>!!BNWS.ws&&__WS.length>0);assert(ws1,"binance socket up");
console.log("D errors",h.errors);assert.deepStrictEqual(h.errors,[]);await h.close();
// E) legal pages describe it
h=await launch({});P=h.page;await P.goto(h.base);await booted(P);await P.evaluate(()=>{location.hash="#/legal/cookies"});await P.waitForTimeout(500);
const lg=await P.textContent("#pv-legal");for(const s of ["scr2~","scr2p~","vt_aikey~","vt_legacy"])assert(lg.includes(s),"legal mentions "+s);for(const s of ["vt_tdkey~","your own Twelve Data API key"])assert(!lg.includes(s),"legal no longer lists "+s);
await h.close();
console.log("ACCOUNTS OK");process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});
