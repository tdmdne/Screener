// Full-app sweep fixes: chart shows the real load error (not an endless "Loading candles…") with a working Try again;
// Indicators > My scripts lists saved Vektor Script indicators with Add/Remove/Edit and an empty state; icon buttons
// in the Indicators dialog have accessible names; chart Navigation/Pane buttons, status-line Volume and Time colour settings
// now work; routes are case-insensitive and a new page opens at the top; axe in both themes; phone layout.
const assert=require("assert"),fs=require("fs"),path=require("path");const {launch}=require("./harness");
const AXE=fs.readFileSync(path.join(__dirname,"../node_modules/axe-core/axe.min.js"),"utf8");
const axe=async(P,ctx)=>{await P.evaluate(AXE);return P.evaluate(async c=>(await axe.run(c||document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}})).violations.map(v=>v.id+" x"+v.nodes.length+" "+v.nodes[0].target.join(" ")),ctx)};
const ready=P=>P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
(async()=>{for(const theme of ["dark","light"]){const h=await launch({viewport:{width:1440,height:900},colorScheme:theme});const P=h.page;await P.goto(h.base);await ready(P);
// 1) chart error state: EURUSD feeds are blocked in the harness, so its load fails
await P.evaluate(()=>{location.hash="#/chart";openChart("EURUSD","1H")});
await P.waitForSelector("#cv .vt-cverr[role=alert]",{timeout:60000});
let t=await P.textContent("#cv .vt-cverr");assert(/Couldn.t load candles/.test(t)&&/EURUSD/.test(t),"error text "+t);assert(!(await P.$("#cv .vt-skel")));
if(theme==="dark")await P.screenshot({path:path.join(__dirname,"../shots/26_chart_error.png")});
await P.click("#vt_cvretry");await P.waitForSelector("#cv .vt-cverr[role=alert]",{timeout:60000});
// a symbol that loads still draws normally
await P.evaluate(()=>openChart("BTCUSDT","1H"));await P.waitForFunction(()=>!document.querySelector("#cv .vt-cverr")&&!!document.querySelector("#cv canvas"),null,{timeout:30000});
// 2) Indicators > My scripts
await P.evaluate(()=>{vsCfg().list.length=0;save();indM("scripts")});await P.waitForSelector("#indlist");
t=await P.textContent("#indlist");assert(/No scripts yet/.test(t),"empty state "+t);assert(/Vektor Indicator/.test(t));
await P.evaluate(()=>{closeM();vsNew("Sweep EMA",'indicator("Sweep EMA", overlay=true)\nplot(ema(close, 5), "EMA 5", color=orange)');vsNew("Broken",'indicator("Broken", overlay=true)\nplot(nope(close))');indM("scripts")});
const rows=await P.$$eval("#indlist .vt-indrow",r=>r.map(x=>x.textContent));assert(rows.some(x=>/Sweep EMA/.test(x))&&rows.some(x=>/Broken/.test(x)),"rows "+rows);
await P.click('#indlist button[aria-label="Add Sweep EMA to the chart"]');
await P.waitForFunction(()=>vsCfg().list.find(x=>x.name==="Sweep EMA").on===true);
t=await P.textContent("#indlist");assert(/Sweep EMA \(on chart\)/.test(t),"on chart "+t);if(theme==="dark"){await P.waitForTimeout(500);await P.screenshot({path:path.join(__dirname,"../shots/28_my_scripts.png")})}
await P.click('#indlist button[aria-label="Add Broken to the chart"]');await P.waitForTimeout(200);
assert.strictEqual(await P.evaluate(()=>vsCfg().list.find(x=>x.name==="Broken").on),false,"broken script not added");
await P.click('#indlist button[aria-label="Remove Sweep EMA from the chart"]');await P.waitForFunction(()=>vsCfg().list.find(x=>x.name==="Sweep EMA").on===false);
await P.waitForTimeout(600);let v=await axe(P,"#modal");assert.deepStrictEqual(v,[],theme+" my scripts axe: "+v.join(" | "));
await P.click('#indlist button[aria-label="Edit Sweep EMA in the script editor"]');await P.waitForSelector("#vs_src");
assert.strictEqual(await P.inputValue("#vs_name"),"Sweep EMA");await P.evaluate(()=>closeM());
await P.evaluate(()=>{indM("scripts")});await P.click(".vt-indnew button");await P.waitForSelector("#vs_src");await P.evaluate(()=>closeM());
// 3) technicals tab: icon buttons are named, layout has room
await P.evaluate(()=>indM());await P.waitForSelector("#indlist");
const un=await P.evaluate(()=>[...document.querySelectorAll("#modal button")].filter(b=>!(b.getAttribute("aria-label")||b.textContent.trim().replace(/[\u2605\u2606\u2699\u2715]/g,""))).length);assert.strictEqual(un,0,"unnamed icon buttons");
const lab=await P.$$eval("#modal button[aria-label]",b=>b.map(x=>x.getAttribute("aria-label")));assert(lab.some(x=>/^Add Bollinger Bands to favourites$/.test(x)),"fav label "+lab.slice(0,6));assert(lab.some(x=>/^Settings for /.test(x))&&lab.some(x=>/^Remove /.test(x)));
const wrap=await P.evaluate(()=>{const r=[...document.querySelectorAll("#indlist .li")].find(x=>/Bollinger/.test(x.textContent));return r.getBoundingClientRect().height});assert(wrap<60,"Bollinger row height "+wrap);
await P.waitForTimeout(600);if(theme==="dark")await P.screenshot({path:path.join(__dirname,"../shots/27_indicators.png")});
await P.waitForTimeout(600);v=await axe(P,"#modal");assert.deepStrictEqual(v,[],theme+" indicators axe: "+v.join(" | "));await P.evaluate(()=>closeM());
// 4) chart settings that used to do nothing
await P.evaluate(()=>{location.hash="#/chart";openChart("BTCUSDT","1H");S.chart.navBtn="always";save();drawChart()});await P.waitForSelector("#cv .vt-navb.on button");
const rg=()=>P.evaluate(()=>{const r=ch.timeScale().getVisibleLogicalRange();return[r.from,r.to]});
let r0=await rg();await P.click('#cv .vt-navb button[aria-label="Zoom in"]');await P.waitForTimeout(150);let r1=await rg();assert(r1[1]-r1[0]<(r0[1]-r0[0])*0.9,"zoom in "+r0+" -> "+r1);
r0=r1;await P.click('#cv .vt-navb button[aria-label="Scroll left"]');await P.waitForTimeout(150);r1=await rg();assert(r1[0]<r0[0]-1,"scroll left");
await P.click('#cv .vt-navb button[aria-label="Reset chart view"]');await P.waitForTimeout(150);
if(theme==="dark"){await P.evaluate(()=>{S.chart.showVol=true;S.chart.timeCol="#ff7a00";S.chart.ind.push({id:"rsiT",t:"rsi",len:14,col:"#7e57c2"});S.chart.paneBtn="always";save();drawChart()});
  await P.waitForSelector("#vt_vol");assert(/^Vol \d/.test(await P.textContent("#vt_vol")),"vol pill");
  await P.waitForFunction(()=>getComputedStyle(document.getElementById("timebar")).color==="rgb(255, 122, 0)");
  await P.waitForSelector("#cv2 .vt-paneb.on button");await P.waitForTimeout(400);await P.screenshot({path:path.join(__dirname,"../shots/29_chart_buttons.png")});
  await P.click('#cv2 .vt-paneb button[aria-label="Hide RSI pane"]');await P.waitForFunction(()=>S.chart.ind.find(x=>x.id==="rsiT").hidden===true);
  await P.evaluate(()=>{S.chart.ind=S.chart.ind.filter(x=>x.id!=="rsiT");S.chart.showVol=false;S.chart.timeCol="";S.chart.paneBtn="hover";save();drawChart()});await P.waitForFunction(()=>!document.getElementById("vt_vol")&&!document.getElementById("timebar").style.color)}
await P.waitForTimeout(600);v=await axe(P,"#cp");assert.deepStrictEqual(v,[],theme+" chart axe: "+v.join(" | "));
await P.evaluate(()=>{S.chart.navBtn="hide";save();drawChart()});await P.waitForFunction(()=>!!ch);assert.strictEqual(await P.$("#cv .vt-navb"),null,"hidden nav buttons");
await P.evaluate(()=>{S.chart.navBtn="hover";save();drawChart()});await P.waitForSelector("#cv .vt-navb",{state:"attached"});
await P.mouse.move(2,2);await P.waitForFunction(()=>getComputedStyle(document.querySelector("#cv .vt-navb")).opacity==="0");
await P.hover("#cv",{position:{x:200,y:100}});await P.waitForFunction(()=>getComputedStyle(document.querySelector("#cv .vt-navb")).opacity==="1");
// 5) case-insensitive routes; a new page starts at the top
await P.evaluate(()=>{location.hash="#/backtest"});await P.waitForSelector("#bt_f");await P.evaluate(()=>window.scrollTo(0,99999));
// (routes)
await P.evaluate(()=>{location.hash="#/Screener"});await P.waitForFunction(()=>document.documentElement.dataset.page==="screener");assert.strictEqual(await P.evaluate(()=>scrollY),0,"new page at top");
await P.evaluate(()=>{location.hash="#/BACKTEST"});await P.waitForFunction(()=>document.documentElement.dataset.page==="backtest");
console.log(theme,"errors",h.errors);assert.deepStrictEqual(h.errors,[]);await h.close()}
// 6) phone
{const h=await launch({viewport:{width:390,height:844},mobile:true});const P=h.page;await P.goto(h.base);await ready(P);
await P.evaluate(()=>{location.hash="#/chart";openChart("EURUSD","1H")});await P.waitForSelector("#cv .vt-cverr",{timeout:60000});
let r=await P.evaluate(()=>{const b=document.getElementById("vt_cvretry").getBoundingClientRect();return{h:b.height,sw:document.documentElement.scrollWidth,W:innerWidth}});assert(r.h>=44&&r.sw<=r.W,"phone retry "+JSON.stringify(r));
await P.evaluate(()=>{openChart("BTCUSDT","1H");vsNew("Phone EMA",'indicator("Phone EMA", overlay=true)\nplot(ema(close, 5))');indM("scripts")});await P.waitForSelector(".vt-indrow");
r=await P.evaluate(()=>{const W=innerWidth,box=document.querySelector("#modal .box").getBoundingClientRect(),small=[...document.querySelectorAll("#indlist button")].filter(b=>{const q=b.getBoundingClientRect();return q.width&&(q.height<44||q.width<44)}).length;return{W,l:box.left,r:box.right,small,sw:document.documentElement.scrollWidth}});
assert(r.l>=0&&r.r<=r.W&&r.small===0&&r.sw<=r.W,"phone indicators "+JSON.stringify(r));await P.screenshot({path:path.join(__dirname,"../shots/m/sweep_390_indicators.png")});
console.log("phone errors",h.errors);assert.deepStrictEqual(h.errors,[]);await h.close()}
console.log("SWEEP OK");process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});
