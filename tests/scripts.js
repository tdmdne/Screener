// Vektor Script (custom indicators): the interpreter never reaches eval/Function/globals, rejects unsafe or runaway scripts with
// line/column errors and suggestions, matches the app's own SMA/EMA/RSI maths, runs every built-in example, plots on the chart
// (overlay and own-band), updates live, imports/exports safely, persists, works on a phone, axe clean in both themes, sockets untouched.
const assert=require("assert"),fs=require("fs"),path=require("path");const {launch}=require("./harness");
const AXE=fs.readFileSync(path.join(__dirname,"../node_modules/axe-core/axe.min.js"),"utf8");
const axe=async(P,ctx)=>{await P.evaluate(AXE);return P.evaluate(async c=>(await axe.run(c||document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}})).violations.map(v=>v.id+" x"+v.nodes.length+" "+v.nodes[0].target.join(" ")),ctx)};
const ready=P=>P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
(async()=>{for(const theme of ["dark","light"]){const h=await launch({viewport:{width:1440,height:900},colorScheme:theme,acceptDownloads:true});const P=h.page;await P.goto(h.base);await ready(P);
await P.evaluate(()=>openChart("BTCUSDT","1H"));await P.waitForFunction(()=>LIVE["BTCUSDT|1H"]&&LIVE["BTCUSDT|1H"].length>100);await P.waitForTimeout(400);
const ws0=await P.evaluate(()=>(window.__w0=BNWS.ws,__WS.length));
if(theme==="dark"){
// 1) sandbox: spy on every dynamic-code door, then run hostile scripts
const sb=await P.evaluate(()=>{const hits=[];const oe=window.eval,OF=window.Function,ost=window.setTimeout;
  window.eval=function(){hits.push("eval");return oe.apply(this,arguments)};
  const FF=function(){hits.push("Function");return OF.apply(this,arguments)};window.Function=FF;const pc=Object.getOwnPropertyDescriptor(OF.prototype,"constructor");Object.defineProperty(OF.prototype,"constructor",{value:FF,configurable:true,writable:true});
  window.setTimeout=function(f){if(typeof f==="string")hits.push("setTimeout-string");return ost.apply(this,arguments)};
  const keys0=new Set(Object.keys(window));const bars=candles(symOf("BTCUSDT"),"1H");
  const bad=['x = constructor','x = __proto__','x = window','x = this','x = alert("hi")','plot(close.constructor)','x = toString','x = hasOwnProperty','x = globalThis','x = document','x = fetch("https://example.com")','x = localStorage','eval("1")','x = Function("return 1")',
    'x = sma(close, 1e9)','x = close[100000]','x = '+"(".repeat(500)+"1"+")".repeat(500),'a'.repeat(30000),'x = '+Array(400).fill("1").join(" + "),Array(400).fill("x = 1").join("\n"),
    'x = ema(close,)','plot(close, color=nocolor)','x = "unterminated','x = 1 +','indicator("x", overlay=true, foo=1)','x = emaa(close, 3)'];
  const res=bad.map(src=>{try{vsRun(src,bars,{});return{src:src.slice(0,40),ok:true}}catch(e){return{src:src.slice(0,40),vs:e instanceof VSError,msg:e.message,line:e.line,col:e.col,hint:e.hint}}});
  const added=Object.keys(window).filter(k=>!keys0.has(k));
  window.eval=oe;window.Function=OF;Object.defineProperty(OF.prototype,"constructor",pc);window.setTimeout=ost;
  return{hits,res,added,proto:Object.prototype.polluted===undefined&&({}).constructor===Object}});
assert.deepStrictEqual(sb.hits,[],"no eval/Function/string timers: "+sb.hits);assert.deepStrictEqual(sb.added,[],"no new globals");assert(sb.proto,"Object prototype untouched");
for(const r of sb.res){assert(!r.ok,"rejected: "+r.src);assert(r.vs,"VSError for: "+r.src+" got "+r.msg)}
const sug=sb.res.find(r=>r.src.startsWith("x = emaa"));assert(/ema/.test(sug.hint)&&sug.line===1&&sug.col>0,"suggestion "+JSON.stringify(sug));
const multi=await P.evaluate(()=>{try{vsRun('indicator("t")\nfast = ema(close, 12)\nplot(fats, "x")',candles(symOf("BTCUSDT"),"1H"),{})}catch(e){return[e.line,e.col,e.hint]}});
assert.strictEqual(multi[0],3);assert.strictEqual(multi[1],6);assert(/fast/.test(multi[2]),"suggests fast");
// 2) maths parity with the app's indicators
const par=await P.evaluate(()=>{const a=candles(symOf("BTCUSDT"),"1H"),c=a.map(x=>x.c),n=a.length;
  const r=vsRun('s = sma(close, 20)\ne = ema(close, 12)\nr = rsi(close, 14)\nplot(s,"s")\nplot(e,"e")\nplot(r,"r")',a,{});const [S1,E1,R1]=r.plots.map(p=>p.v);
  const s2=smaArr(c,20),e2=emaArr(c,12),r2=rsiArr(c,14);let ds=0,de=0,dr=0,cnt=0;
  for(let i=0;i<n;i++){if(s2[i]!=null){ds=Math.max(ds,Math.abs(S1[i]-s2[i])/s2[i]);cnt++}if(i>=n-60)de=Math.max(de,Math.abs(E1[i]-e2[i])/e2[i]);if(r2[i]!=null&&i>=60)dr=Math.max(dr,Math.abs(R1[i]-r2[i]))}
  return{ds,de,dr,cnt,n}});
assert(par.cnt>100&&par.ds<1e-9,"SMA matches "+JSON.stringify(par));assert(par.de<1e-6,"EMA matches (after warm-up) "+JSON.stringify(par));assert(par.dr<1e-6,"RSI matches "+JSON.stringify(par));
// 3) every example runs with plots and finite last values
const ex=await P.evaluate(()=>VS_EX.map(x=>{try{const r=vsRun(x.src,candles(symOf("BTCUSDT"),"1H"),{});return{n:x.name,p:r.plots.length,fin:r.plots.every(p=>isFinite(p.v[p.v.length-1])),ov:r.overlay}}catch(e){return{n:x.name,err:e.message}}}));
for(const e of ex){assert(!e.err&&e.p>0&&e.fin,"example "+JSON.stringify(e))}
// 4) import/export: sanitised, size-limited, bad JSON reported
const imp=await P.evaluate(()=>{const n0=vsCfg().list.length;const r1=vsImportText(JSON.stringify({format:"vektor-script",scripts:[{name:"<img src=x onerror=alert(1)>",src:'plot(sma(close, 5), "five")',inp:{"Length":5,"__proto__":7,evil:"js"},on:true,id:"hack"}]}));
  const sc=vsCfg().list[vsCfg().list.length-1];const r2=vsImportText("{not json");const r3=vsImportText("x".repeat(600*1024));const r4=vsImportText('plot(close, "c")',"plain.vks");
  const r5=vsImportText(JSON.stringify([{name:"bad",src:"x = = 1"}]));
  return{r1,r2,r3,r4,r5,n:vsCfg().list.length-n0,name:sc.name,on:sc.on,id:sc.id!=="hack",inp:Object.keys(sc.inp),plain:vsCfg().list.find(x=>x.name==="plain")!=null}});
assert.strictEqual(imp.r1.added,1);assert.strictEqual(imp.on,false,"imported scripts start off the chart");assert(imp.id,"own id");assert.deepStrictEqual(imp.inp,["Length"],"only numeric inputs kept");
assert(imp.r2.errors.length&&!imp.r2.added);assert(imp.r3.errors.length&&!imp.r3.added);assert(imp.plain&&imp.r4.added===1);assert(imp.r5.added===1&&imp.r5.errors.length===1,"bad script imported with a warning");
const [dl]=await Promise.all([P.waitForEvent("download"),P.evaluate(()=>vsExport(vsCfg().list.slice(-2)))]);const exj=JSON.parse(fs.readFileSync(await dl.path(),"utf8"));
assert.strictEqual(exj.format,"vektor-script");assert.strictEqual(exj.scripts.length,2);assert(/\.vks\.json$/.test(dl.suggestedFilename()));
await P.evaluate(()=>{S.vs.list=[];save()});
// 5) editor UI: example -> chart (own band), errors with Go to line, inputs, live update
await P.click("#vsb");await P.waitForSelector(".vsm");await P.click('.vsex[data-i="0"]');await P.waitForSelector("#vs_src");
let msg=await P.textContent("#vs_msg");assert(/No errors/.test(msg),"example checks clean: "+msg);
assert.strictEqual(await P.locator("#vs_inp input").count(),3,"MACD inputs shown");
const nser0=await P.evaluate(()=>VSUI.ser.length);await P.click("#vs_tog");await P.waitForTimeout(500);
let st=await P.evaluate(()=>({ser:VSUI.ser.length,refs:VSUI.ser[0]&&VSUI.ser[0].refs.length,leg:[...document.querySelectorAll("#vsleg .vschip")].map(b=>b.textContent),saved:JSON.parse(localStorage.getItem(vtSK("scr2"))).vs.list[0].on}));
assert.strictEqual(nser0,0);assert.strictEqual(st.ser,1);assert(st.refs>=3,"MACD draws 3 series");assert.deepStrictEqual(st.leg,["MACD"]);assert.strictEqual(st.saved,true,"persisted");
// edit an input -> recompute
await P.fill('#vs_inp input >> nth=0','5');await P.dispatchEvent('#vs_inp input >> nth=0','change');await P.waitForTimeout(300);
assert.strictEqual(await P.evaluate(()=>S.vs.list[0].inp["Fast length"]),5);
// error: type a typo, see line/col and jump
await P.fill("#vs_src",'indicator("Bad")\nx = sma(clos, 10)\nplot(x)');await P.click("#vs_chk");msg=await P.textContent("#vs_msg");
assert(/Line 2, column 9/.test(msg)&&/close/.test(msg),"error message: "+msg);await P.click("#vs_msg button");
const sel=await P.evaluate(()=>{const t=document.getElementById("vs_src");return t.value.slice(0,t.selectionStart).split("\n").length});assert.strictEqual(sel,2,"Go to line moves the caret");
await P.click("#vs_save");msg=await P.textContent("#vs_msg");assert(/^Saved, but there is an error/.test(msg)&&/Line 2/.test(msg),"save msg: "+msg);
st=await P.evaluate(()=>({chip:document.querySelector("#vsleg .vschip").className}));assert(/err/.test(st.chip),"legend shows the error");
// restore and add an overlay script too
await P.fill("#vs_src",await P.evaluate(()=>VS_EX[0].src));await P.click("#vs_save");await P.click('.vsex[data-i="2"]');await P.waitForTimeout(200);await P.click("#vs_tog");await P.waitForTimeout(500);
st=await P.evaluate(()=>({ser:VSUI.ser.length,leg:document.querySelectorAll("#vsleg .vschip").length}));assert.strictEqual(st.ser,2);assert.strictEqual(st.leg,2);
// live: a tick moves the last value without a full redraw
const lv=await P.evaluate(async()=>{const e=VSUI.ser.find(x=>x.sc.name==="Bollinger Bands"),ser=e.refs[0].ser;const k=LIVE["BTCUSDT|1H"],z=k[k.length-1];const before=ser.data?null:0;
  const nz=z.c*1.05;z.c=nz;z.h=Math.max(z.h,nz);await new Promise(r=>setTimeout(r,1300));return e.key.endsWith(String(z.l))&&e.key.includes(String(nz))});
assert(lv,"live update re-keyed the script");
await P.keyboard.press("Escape");
}
// 6) axe on the editor (both themes)
await P.evaluate(()=>{if(!S.vs||!S.vs.list||!S.vs.list.length){const n=vsNew(VS_EX[1].name,VS_EX[1].src)}});
await P.evaluate(()=>vsM());await P.waitForSelector("#vs_src");await P.waitForTimeout(700);
let v=await axe(P,"#modal");assert.deepStrictEqual(v,[],theme+" scripts axe: "+v.join(" | "));
if(theme==="dark")await P.screenshot({path:__dirname+"/../shots/20_scripts_editor.png"});
await P.evaluate(()=>closeM());await P.waitForTimeout(300);if(theme==="dark")await P.screenshot({path:__dirname+"/../shots/21_scripts_chart.png"});
const ws1=await P.evaluate(n=>BNWS.ws===__w0&&__WS.length===n,ws0);assert(ws1,"sockets untouched");
console.log(theme,"errors",h.errors);assert.deepStrictEqual(h.errors,[]);await h.close()}
// 7) phone: editor fits, 44px targets, no sideways scroll
const h=await launch({viewport:{width:390,height:844},mobile:true});const P=h.page;await P.goto(h.base);await ready(P);
await P.evaluate(()=>{openChart("BTCUSDT","1H");const n=vsNew(VS_EX[0].name,VS_EX[0].src);n.on=true;save()});await P.waitForTimeout(900);
assert(await P.isVisible("#vsb"),"Scripts button on phone");await P.click("#vsb");await P.waitForSelector("#vs_src");await P.waitForTimeout(500);
const ph=await P.evaluate(()=>{const W=document.documentElement.clientWidth,b=document.querySelector("#modal .box").getBoundingClientRect();const small=[...document.querySelectorAll("#modal button,#modal input,#modal textarea,#modal summary,#vsleg .vschip")].filter(e=>e.offsetParent&&e.type!=="file").map(e=>{const r=e.getBoundingClientRect();return[e.id||e.className||e.tagName,Math.round(r.width),Math.round(r.height)]}).filter(x=>x[1]<43.5||x[2]<43.5);
  return{sw:document.documentElement.scrollWidth,W,fit:b.left>=-1&&b.right<=W+1,small}});
assert(ph.sw<=ph.W&&ph.fit,"phone fit "+JSON.stringify(ph));assert.deepStrictEqual(ph.small,[],"phone 44px targets");await P.screenshot({path:__dirname+"/../shots/m/qa_390_scripts.png"});
await P.evaluate(()=>closeM());await P.waitForTimeout(300);await P.screenshot({path:__dirname+"/../shots/m/qa_390_scripts_chart.png"});
assert.deepStrictEqual(h.errors,[]);await h.close();console.log("SCRIPTS OK")})().catch(e=>{console.error(e);process.exit(1)});
