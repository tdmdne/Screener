// Shared device: saved work (charts, drawings, journal, templates, alerts, scripts, layouts) is scoped to the signed-in user;
// guests and other users never see it; the same user gets it back; guest -> sign-in with existing saved work asks first;
// data saved before accounts were separated is claimed by whoever was signed in, or offered (never shown to guests).
// Twelve Data: no built-in key; your own key from Settings > Data is stored only with Optional preferences (never for guests),
// is used for requests, is deleted on withdrawal; without a key nothing is requested and the app degrades with clear errors;
// Binance WebSockets untouched. An owner key in config.local.js (local only) is used in memory, after the user's own key.
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
let e=await P.evaluate(()=>({all:JSON.stringify(S),ks:Object.keys(localStorage),td:vtTdKey(),dk:"key" in S.data,saved:localStorage.getItem(vtSK("scr2"))}));
assert(e.all.includes("LEGACY-WORK")&&!e.ks.includes("scr2")&&!e.ks.includes("vt_legacy")&&e.ks.some(k=>/^scr2~/.test(k)),"auto-claimed "+e.ks);
// a Twelve Data key saved inside settings by an older version moves out of scr2 and, without Optional preferences, stays in memory only
assert.strictEqual(e.td,"myOwnTdKey9");assert(!e.dk&&!e.saved.includes("myOwnTdKey9")&&!e.ks.some(k=>/^vt_tdkey/.test(k)),"key moved out of scr2");
await h.close();

// D) Twelve Data key
h=await launch({auth:false});P=h.page;const td=[];await P.route(/api\.twelvedata\.com/,r=>{td.push(r.request().url());const now=Math.floor(Date.now()/3600e3)*3600;
  r.fulfill({contentType:"application/json",body:JSON.stringify({status:"ok",values:Array.from({length:120},(_,i)=>{const t=new Date((now-i*3600)*1000).toISOString().slice(0,19).replace("T"," ");return{datetime:t,open:"1.08",high:"1.09",low:"1.07",close:"1.085",volume:"0"}})})})});
await P.goto(h.base);await signIn(P,"tester");
// no key ships with the app: no 32-hex string in the page hashes to the old built-in key
const hk=await P.evaluate(()=>{const m=document.documentElement.outerHTML.match(/[0-9a-f]{32}/g)||[];return m.filter(x=>vtUidHash(x)===VT_TDK.old).length});assert.strictEqual(hk,0,"no built-in key");
const ws0=await P.evaluate(()=>{window.__w0=BNWS.ws;return __WS.length});
const pump=()=>P.evaluate(()=>{const s=symOf("EURUSD"),k="EURUSD|1H";delete ERR[k];delete PEND[k];delete LIVE[k];PEND[k]=1;QT.push([s,"1H",k]);pumpTD()});
assert.strictEqual(await P.evaluate(()=>vtTdKey()),"");await pump();await P.waitForFunction(()=>/no Twelve Data key/.test(ERR["EURUSD|1H"]||""));assert.strictEqual(td.length,0,"nothing sent without a key");
await P.evaluate(()=>dataM());await P.waitForSelector("#d_k");assert.strictEqual(await P.inputValue("#d_k"),"");let note=await P.textContent("#d_kn");
assert(/No key set/.test(note)&&/until you close the tab/.test(note),note);
// without Optional preferences: works for the tab, not stored
await P.fill("#d_k","tabOnlyKey1");await P.evaluate(()=>dataSave());
assert.deepStrictEqual(await P.evaluate(()=>[vtTdKey(),Object.keys(localStorage).filter(k=>/^vt_tdkey/.test(k)),localStorage.getItem(vtSK("scr2")).includes("tabOnlyKey1")]),["tabOnlyKey1",[],false]);
await pump();await P.waitForFunction(()=>(LIVE["EURUSD|1H"]||[]).length>=100);assert(/apikey=tabOnlyKey1/.test(td[td.length-1]),"key used");
// with Optional preferences: stored for this account only, and deleted on withdrawal
await P.evaluate(()=>vtConsentSet(true,"custom",true));await P.waitForFunction(()=>localStorage.getItem(vtSK("vt_tdkey"))==="tabOnlyKey1");
await P.evaluate(()=>dataM());await P.waitForSelector("#d_kn");assert(/for your account only/.test(await P.textContent("#d_kn")));await P.fill("#d_k","bad key!");await P.evaluate(()=>dataSave());
assert.strictEqual(await P.evaluate(()=>vtTdKey()),"tabOnlyKey1","invalid key refused");
await P.evaluate(()=>{dataM()});await P.fill("#d_k","prefsKey22");await P.evaluate(()=>dataSave());
await P.reload();await booted(P);assert.strictEqual(await P.evaluate(()=>vtTdKey()),"prefsKey22","remembered with consent");
await P.evaluate(()=>vtConsentSet(true,"custom",false));await P.waitForTimeout(100);assert.deepStrictEqual(await P.evaluate(()=>Object.keys(localStorage).filter(k=>/^vt_(td|ai)key/.test(k))),[],"withdrawal deletes it");
await P.reload();await booted(P);assert.strictEqual(await P.evaluate(()=>vtTdKey()),"");
const ws1=await P.evaluate(()=>!!BNWS.ws&&__WS.length>0);assert(ws1,"binance socket up");
// another user doesn't get this user's key
await P.evaluate(()=>vtConsentSet(true,"custom",true));await P.evaluate(()=>{dataM()});await P.fill("#d_k","testerKey3");await P.evaluate(()=>dataSave());
await Promise.all([P.waitForNavigation(),P.click("#lgo")]);await signIn(P,"erin");assert.strictEqual(await P.evaluate(()=>vtTdKey()),"","erin has no key");
// guest: never stored
await Promise.all([P.waitForNavigation(),P.click("#lgo")]);await P.click("#auGuest");await booted(P);await P.evaluate(()=>{dataM()});await P.fill("#d_k","guestKey4");await P.evaluate(()=>dataSave());
assert.deepStrictEqual(await P.evaluate(()=>[vtTdKey(),Object.values(localStorage).filter(v=>v.includes("guestKey4")).length]),["guestKey4",0]);
console.log("D errors",h.errors);assert.deepStrictEqual(h.errors,[]);await h.close();
// F) owner's local config (config.local.js, gitignored): used in memory only, after the user's own key, never stored
h=await launch({config:{twelveDataKey:"cfgKey12345"}});P=h.page;await P.goto(h.base);await booted(P);await P.waitForFunction(()=>!!window.VT_CONFIG);
assert.strictEqual(await P.evaluate(()=>vtTdKey()),"cfgKey12345");await P.evaluate(()=>dataM());await P.waitForSelector("#d_k");
assert.strictEqual(await P.inputValue("#d_k"),"","config key not shown");assert(/config\.local\.js/.test(await P.textContent("#d_kn")));
await P.fill("#d_k","ownKey6789");await P.evaluate(()=>dataSave());assert.strictEqual(await P.evaluate(()=>vtTdKey()),"ownKey6789","own key wins");
assert.strictEqual(await P.evaluate(()=>Object.values(localStorage).concat(Object.values(sessionStorage)).filter(v=>v.includes("cfgKey12345")).length),0,"config key never stored");
console.log("F errors",h.errors);assert.deepStrictEqual(h.errors,[]);await h.close();
// E) legal pages describe it
h=await launch({});P=h.page;await P.goto(h.base);await booted(P);await P.evaluate(()=>{location.hash="#/legal/cookies"});await P.waitForTimeout(500);
const lg=await P.textContent("#pv-legal");for(const s of ["scr2~","scr2p~","vt_tdkey~","vt_aikey~","vt_legacy","no longer ships with a key"])assert(lg.includes(s),"legal mentions "+s);
await h.close();
console.log("ACCOUNTS OK");process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});
