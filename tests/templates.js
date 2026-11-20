// Chart templates: save (with/without symbol), load, rename, default on next load, delete, JSON export/import (sanitised), guest gate, keyboard.
const {launch}=require("./harness");const assert=require("assert");const fs=require("fs");const os=require("os");const path=require("path");
fs.mkdirSync(__dirname+"/../shots/m",{recursive:true});
const ready=async P=>{await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));await P.evaluate(()=>{S.dr={};S.tpl={list:[],def:null};save();openChart("BTCUSDT","1H");go("chart")});await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]&&document.getElementById("tplb"))};
(async()=>{let h=await launch();let P=h.page;await P.goto(h.app);await ready(P);
const ws0=await P.evaluate(()=>__edge.sockets.length);
// set up a distinctive chart: line type, custom colour, an extra indicator, 2 panes, a drawing
await P.evaluate(()=>{S.chart.type="line";S.chart.lineCol="#123456";S.chart.ind.push({id:"i9",t:"sma",len:50,col:"#00ff00"});S.sc.tfB="4H";
  DL().push({id:1,t:"hline",p:[{t:G.a[G.a.length-5].t,y:120}],c:"#ff0000",w:2,s:0});save();scSetPanes(2);drawChart()});
await P.click("#tplb");await P.waitForSelector(".tplm");assert(await P.isVisible(".tple"));
await P.fill("#tpl_name","Mine");await P.click("#tpl_save");await P.waitForSelector(".tpl_ld");
let T=await P.evaluate(()=>S.tpl.list.map(t=>({n:t.name,sym:t.sym,type:t.chart.type,lc:t.chart.lineCol,ind:t.chart.ind.length,panes:t.sc.panes,tfB:t.sc.tfB,dr:t.dr.length,hasSym:"sym" in t.chart})));
assert.deepStrictEqual(T,[{n:"Mine",sym:null,type:"line",lc:"#123456",ind:T[0].ind,panes:2,tfB:"4H",dr:1,hasSym:false}]);
await P.screenshot({path:__dirname+"/../shots/12_templates.png"});
// change everything, then load it back
await P.keyboard.press("Escape");assert(!(await P.$(".tplm")),"Esc closes");
await P.evaluate(()=>{S.chart.type="candle";S.chart.lineCol="#000000";S.chart.ind=S.chart.ind.filter(d=>d.id!=="i9");S.dr.BTCUSDT=[];scSetPanes(1);save();drawChart()});
await P.click("#tplb");await P.click(".tpl_ld");await P.waitForTimeout(300);
let c=await P.evaluate(()=>({type:S.chart.type,lc:S.chart.lineCol,i9:S.chart.ind.some(d=>d.id==="i9"),panes:S.sc.panes,tfB:S.sc.tfB,dr:DL().length,sym:S.chart.sym,b:!!document.getElementById("cvB")&&!!SC.keyB}));
assert.deepStrictEqual(c,{type:"line",lc:"#123456",i9:true,panes:2,tfB:"4H",dr:1,sym:"BTCUSDT",b:c.b});
// a template with the symbol switches symbol on load
await P.evaluate(()=>openChart("ETHUSDT","1H"));await P.waitForFunction(()=>LIVE["ETHUSDT|1H"]);
await P.click("#tplb");await P.fill("#tpl_name","With symbol");await P.check("#tpl_sym");await P.click("#tpl_save");await P.waitForTimeout(100);
await P.evaluate(()=>{closeM();openChart("BTCUSDT","1H")});await P.click("#tplb");await P.locator(".tpl_ld",{hasText:"With symbol"}).click();await P.waitForTimeout(200);
assert.strictEqual(await P.evaluate(()=>S.chart.sym),"ETHUSDT");
// rename (duplicate names get a suffix); Esc in the rename box cancels only the rename
await P.click("#tplb");await P.locator('.tplr',{hasText:"Mine"}).locator(".tpl_rn").click();await P.fill(".tpl_ri","With symbol");await P.keyboard.press("Enter");await P.waitForTimeout(100);
assert.deepStrictEqual(await P.evaluate(()=>S.tpl.list.map(t=>t.name)),["With symbol (2)","With symbol"]);
await P.locator('.tplr').first().locator(".tpl_rn").click();await P.keyboard.press("Escape");assert(await P.$(".tplm"),"Esc in rename keeps the menu");
// Tab stays inside the dialog
for(let i=0;i<20;i++)await P.keyboard.press("Tab");assert(await P.evaluate(()=>!!document.activeElement.closest(".tplm")));
// default star
await P.locator('.tplr').first().locator(".tpl_df").click();await P.waitForTimeout(100);const defId=await P.evaluate(()=>S.tpl.def);assert(defId);
assert(await P.isVisible(".tpld"));
// export
const [dl]=await Promise.all([P.waitForEvent("download"),P.click("#tpl_exp")]);const ex=JSON.parse(fs.readFileSync(await dl.path(),"utf8"));
assert.strictEqual(ex.format,"vektor-chart-templates");assert.strictEqual(ex.templates.length,2);
// import: valid + hostile content (sanitised, rendered as text)
const bad={format:"vektor-chart-templates",v:1,templates:[ex.templates[1],{name:'<img src=x onerror="window.__pwn=1">',sym:"BAD SYM!",chart:{type:"line",evil:{a:1},fn:"x",ind:[{t:"ema",len:5,col:"#fff",x:{y:1}},"junk"]},dr:[{t:"nope",p:[{t:1,y:2}]},{t:"hline",p:[{t:1,y:"x"}]},{t:"hline",p:[{t:1700000000,y:100}],onclick:{}}],toolDef:{trend:{c:"#fff",z:{deep:1}}}},{name:5},"x"]};
const f=path.join(os.tmpdir(),"vt_tpl_import.json");fs.writeFileSync(f,JSON.stringify(bad));
await P.setInputFiles("#tpl_file",f);await P.waitForTimeout(300);
const im=await P.evaluate(()=>({n:S.tpl.list.length,names:S.tpl.list.map(t=>t.name),last:S.tpl.list[S.tpl.list.length-1],pwn:window.__pwn||0,img:!!document.querySelector(".tplm img")}));
assert.strictEqual(im.n,4);assert.strictEqual(im.pwn,0);assert.strictEqual(im.img,false);
assert.strictEqual(im.last.sym,null);assert.strictEqual(im.last.chart.evil,undefined);assert.strictEqual(im.last.chart.ind.length,1);assert.strictEqual(im.last.chart.ind[0].x,undefined);
assert.strictEqual(im.last.dr.length,1);assert.strictEqual(im.last.dr[0].onclick,undefined);assert.deepStrictEqual(im.last.toolDef,{trend:{c:"#fff"}});
assert(im.names.includes("With symbol (3)"),"imported duplicate renamed: "+im.names);
fs.writeFileSync(f,"{not json");await P.setInputFiles("#tpl_file",f);await P.waitForTimeout(200);assert.strictEqual(await P.evaluate(()=>S.tpl.list.length),4);
// default applies its setup (not drawings/symbol) on the next load, the first time Supercharts opens
await P.evaluate(()=>{closeM();S.chart.lineCol="#999999";S.chart.type="candle";save()});
await P.reload();await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));await P.evaluate(()=>{openChart("BTCUSDT","1H");go("chart")});await P.waitForFunction(()=>ch&&document.getElementById("tplb"));await P.waitForTimeout(400);
c=await P.evaluate(()=>({lc:S.chart.lineCol,type:S.chart.type,sym:S.chart.sym}));assert.deepStrictEqual(c,{lc:"#123456",type:"line",sym:c.sym});
// delete (with confirmation); deleting the default clears it
await P.click("#tplb");await P.locator('.tplr',{hasText:"Default"}).locator(".tpl_dl").click();await P.click(".tpl_dy");await P.waitForTimeout(100);
assert.deepStrictEqual(await P.evaluate(()=>({n:S.tpl.list.length,def:S.tpl.def})),{n:3,def:null});
assert.strictEqual(await P.evaluate(()=>__edge.sockets.length>=1),true);
console.log("errors",h.errors,"console",h.consoleErr);assert.deepStrictEqual(h.errors,[]);assert.deepStrictEqual(h.offOrigin,[],"non-origin requests");await h.close();
// guest: the menu opens but saving asks to sign in
h=await launch({auth:false});P=h.page;await P.goto(h.app);await P.click("#auGuest");await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
await P.evaluate(()=>{openChart("BTCUSDT","1H");go("chart")});await P.waitForFunction(()=>document.getElementById("tplb"));
await P.click("#tplb");await P.fill("#tpl_name","G");await P.click("#tpl_save");await P.waitForSelector("#vg_h");assert(/chart templates/.test(await P.textContent("#vg_h")));
assert.strictEqual(await P.evaluate(()=>(S.tpl&&S.tpl.list||[]).length),0);assert.deepStrictEqual(h.offOrigin,[],"non-origin requests");await h.close();
// phone: menu is a bottom sheet with usable targets
h=await launch({viewport:{width:390,height:844},mobile:true});P=h.page;await P.goto(h.app);await ready(P);
await P.evaluate(()=>{S.tpl={list:[tplCapture("Clean candles",false),tplCapture("Scalping 5m",true)],def:null};save()});
await P.locator("#tplb").scrollIntoViewIfNeeded();await P.tap("#tplb");await P.waitForSelector(".tplm");await P.waitForTimeout(400);
const small=await P.evaluate(()=>[...document.querySelectorAll(".tplm button")].filter(b=>b.offsetParent&&b.getBoundingClientRect().height<39.5).map(b=>b.textContent));assert.deepStrictEqual(small,[]);
await P.screenshot({path:__dirname+"/../shots/m/390_templates.png"});
console.log("errors",h.errors,"console",h.consoleErr);assert.deepStrictEqual(h.errors,[]);assert.deepStrictEqual(h.offOrigin,[],"non-origin requests");await h.close();
console.log("TEMPLATES OK")})().catch(e=>{console.error(e);process.exit(1)});
