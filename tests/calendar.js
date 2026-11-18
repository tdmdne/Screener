// Calendar & News: real feed only. Parses the weekly calendar (local times, impact/currency/search filters, next high-impact countdown,
// past events dimmed), rejects malformed rows, shows an honest error with no events when every route fails, headlines from RSS shown as
// text links only (javascript: links dropped, HTML not rendered), symbols persisted, no stub, axe in both themes, phone layout.
const assert=require("assert"),fs=require("fs"),path=require("path");const {launch}=require("./harness");
const AXE=fs.readFileSync(path.join(__dirname,"../node_modules/axe-core/axe.min.js"),"utf8");
const axe=async(P,ctx)=>{await P.evaluate(AXE);return P.evaluate(async c=>(await axe.run(c||document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}})).violations.map(v=>v.id+" x"+v.nodes.length+" "+v.nodes[0].target.join(" ")),ctx)};
const ready=P=>P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED);
const iso=ms=>{const d=new Date(ms);return d.toISOString().replace(".000Z","+00:00")};const now=Date.now(),H=3600e3;
const FEED=JSON.stringify([{title:"CPI m/m",country:"USD",date:iso(now+3*H),impact:"High",forecast:"0.3%",previous:"0.2%"},{title:"Retail Sales m/m",country:"GBP",date:iso(now-5*H),impact:"Medium",forecast:"0.1%",previous:"-0.4%"},
 {title:"Bank Holiday",country:"JPY",date:iso(now+30*H),impact:"Holiday",forecast:"",previous:""},{title:"<img src=x onerror=window.__x=1>",country:"EUR",date:iso(now+6*H),impact:"Low",forecast:"",previous:""},{title:"bad date",country:"USD",date:"nope",impact:"High"},{nope:1}]);
const RSS=`<?xml version="1.0"?><rss><channel><item><title>Apple &lt;b&gt;earnings&lt;/b&gt; preview</title><link>https://finance.yahoo.com/news/a1</link><pubDate>${new Date(now-H).toUTCString()}</pubDate></item><item><title>Evil</title><link>javascript:alert(1)</link></item></channel></rss>`;
(async()=>{for(const theme of ["dark","light"]){const h=await launch({viewport:{width:1440,height:900},colorScheme:theme,calendar:FEED});const P=h.page;let rssHits=0;
await P.route(/feeds\.finance\.yahoo\.com/,r=>{rssHits++;r.fulfill({contentType:"application/rss+xml",body:RSS,headers:{"access-control-allow-origin":"*"}})});
await P.goto(h.base);await ready(P);await P.evaluate(()=>{S.chart.sym="AAPL";location.hash="#/calendar"});await P.waitForSelector(".calday");
if(theme==="dark"){
let r=await P.evaluate(()=>({stub:!!document.querySelector("#pv-calendar .stub"),rows:[...document.querySelectorAll(".calt tbody tr")].map(t=>t.textContent),next:document.getElementById("cal_next").textContent,img:document.querySelectorAll("#pv-calendar img").length,x:window.__x||0,n:CAL.ev.length}));
assert(!r.stub);assert.strictEqual(r.n,4,"malformed rows dropped");assert.strictEqual(r.rows.length,2,"default filter High+Medium");assert(/CPI m\/m/.test(r.rows.join()));
// calIn formats as "3h 0m" (not "3 h"). #cal_next textContent may also include the High badge ("HighNext…").
assert(/Next high-impact:\s*USD CPI m\/m in \d+h(?:\s*\d+m)?/.test(r.next),r.next);
const t=await P.evaluate(()=>{const e=CAL.ev.find(x=>x.title==="CPI m/m");return calTime(e.t)});const exp=new Date(now+3*H).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});assert.strictEqual(t,exp,"local time");
assert(await P.evaluate(()=>[...document.querySelectorAll(".calt tbody tr")].some(t=>t.classList.contains("past"))),"past dimmed");
await P.click('.calimp[data-imp="Low"]');await P.waitForTimeout(100);r=await P.evaluate(()=>({t:document.getElementById("cal_list").textContent,img:document.querySelectorAll("#cal_list img").length,x:window.__x||0}));
assert(r.t.includes("<img src=x"),"title shown as text");assert.strictEqual(r.img,0);assert.strictEqual(r.x,0);
await P.click('#cal_ccy .chip[data-c="GBP"]');await P.waitForTimeout(100);assert.strictEqual(await P.evaluate(()=>document.querySelectorAll(".calt tbody tr").length),1);
await P.uncheck("#cal_past");await P.waitForTimeout(100);assert(/No events match/.test(await P.textContent("#cal_list")));await P.check("#cal_past");await P.click('#cal_ccy .chip[data-c=""]');
await P.fill("#cal_q","cpi");await P.waitForTimeout(100);assert.strictEqual(await P.evaluate(()=>document.querySelectorAll(".calt tbody tr").length),1);await P.fill("#cal_q","");
// headlines
await P.waitForSelector(".newsl li");r=await P.evaluate(()=>({li:[...document.querySelectorAll(".newsl li")].map(l=>l.textContent),href:[...document.querySelectorAll(".newsl a")].map(a=>[a.href,a.target,a.rel]),b:document.querySelectorAll(".newsl b").length}));
assert.strictEqual(r.li.length,1,"javascript: link dropped");assert(/Apple <b>earnings<\/b> preview/.test(r.li[0]));assert.strictEqual(r.b,0);assert.deepStrictEqual(r.href[0],["https://finance.yahoo.com/news/a1","_blank","noopener noreferrer nofollow"]);
await P.fill("#news_sym","msft");await P.press("#news_sym","Enter");await P.waitForTimeout(400);assert.deepStrictEqual(await P.evaluate(()=>S.cal.news),["MSFT"]);assert(rssHits>=2);
await P.screenshot({path:__dirname+"/../shots/24_calendar.png"});
await P.reload();await ready(P);await P.waitForSelector(".calday");assert.deepStrictEqual(await P.evaluate(()=>S.cal.news),["MSFT"],"persisted");
}
await P.waitForTimeout(600);const v=await axe(P,"#pv-calendar");assert.deepStrictEqual(v,[],theme+" calendar axe: "+v.join(" | "));
console.log(theme,"errors",h.errors);assert.deepStrictEqual(h.errors,[]);await h.close()}
// every route fails -> honest error, no events
{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;await P.goto(h.base);await ready(P);await P.evaluate(()=>{location.hash="#/calendar"});
 await P.waitForSelector(".calerr",{timeout:60000});const t=await P.textContent("#cal_list");
 assert(/Couldn.t load the calendar/.test(t)&&/Try Refresh/.test(t),t);assert.strictEqual(await P.evaluate(()=>document.querySelectorAll(".calt").length),0);await h.close()}
// phone
{const h=await launch({viewport:{width:390,height:844},mobile:true,calendar:FEED});const P=h.page;await P.route(/feeds\.finance\.yahoo\.com/,r=>r.fulfill({contentType:"application/rss+xml",body:RSS}));await P.goto(h.base);await ready(P);
 await P.evaluate(()=>{S.chart.sym="AAPL";location.hash="#/calendar"});await P.waitForSelector(".calday");await P.waitForTimeout(500);
 const ph=await P.evaluate(()=>{const W=document.documentElement.clientWidth;const small=[...document.querySelectorAll("#pv-calendar button,#pv-calendar input,#pv-calendar select,#pv-calendar .newsl a")].filter(e=>e.offsetParent&&!(e.type==="checkbox"&&e.closest("label"))).map(e=>{const r=e.getBoundingClientRect();return[e.id||e.className||e.textContent,Math.round(r.width),Math.round(r.height)]}).filter(x=>x[1]<43.5||x[2]<43.5);return{sw:document.documentElement.scrollWidth,W,small}});
 assert(ph.sw<=ph.W,"no sideways scroll");assert.deepStrictEqual(ph.small,[],"phone targets");await P.screenshot({path:__dirname+"/../shots/m/qa_390_calendar.png",fullPage:true});assert.deepStrictEqual(h.errors,[]);await h.close()}
console.log("CALENDAR OK")})().catch(e=>{console.error(e);process.exit(1)});
