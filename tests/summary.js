// End-of-day session summary: position-tool P&L recomputed independently from the candles, movers vs previous daily close,
// today's triggered alerts only, export text, empty states, entry points (header, chip, phone More sheet), axe clean.
const {launch}=require("./harness");const assert=require("assert");const fs=require("fs");const path=require("path");
const AXE=fs.readFileSync(path.join(__dirname,"../node_modules/axe-core/axe.min.js"),"utf8");
const axe=async(P,ctx)=>{await P.evaluate(AXE);return P.evaluate(async c=>(await axe.run(c||document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}})).violations.map(v=>v.id+" x"+v.nodes.length+" "+v.nodes[0].target.join(" ")),ctx)};
const ready=async P=>{await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"))};
(async()=>{for(const theme of ["dark","light"]){const h=await launch({viewport:{width:1440,height:900},colorScheme:theme,acceptDownloads:true});const P=h.page;await P.goto(h.base);await ready(P);
await P.evaluate(()=>openChart("BTCUSDT","1H"));await P.waitForFunction(()=>{const a=candles(symOf("BTCUSDT"),"1H");return a&&a.length>30});
// seed: one closed long (target hit today) and one open short, from the real candle store; two alerts (today, yesterday)
const exp=await P.evaluate(()=>{const s=symOf("BTCUSDT"),B=candles(s,"1H"),n=B.length,t0=new Date();t0.setHours(0,0,0,0);
  // pick an entry bar today with at least 4 bars after it
  let i=B.findIndex(b=>b.t*1000>=t0.getTime());if(i<0||i>n-5)i=n-5;const E=B[i].c,after=B.slice(i+1);
  const T=Math.max(...after.map(b=>b.h))*.999,Sx=Math.min(...after.map(b=>b.l))*.5;
  const E2=B[n-3].c,T2=E2*.5,S2=E2*1.5;
  S.dr=S.dr||{};S.dr.BTCUSDT=[{id:1,t:"long",p:[{t:B[i].t,y:E},{t:B[n-1].t,y:T},{t:B[n-1].t,y:Sx}],acct:10000,risk:1,ru:"%",lot:1,lev:0,prec:2},
    {id:2,t:"short",p:[{t:B[n-3].t,y:E2},{t:B[n-1].t+86400,y:T2},{t:B[n-1].t+86400,y:S2}],acct:10000,risk:1,ru:"%",lot:1,lev:0,prec:2}];
  const now=Date.now();S.alog=[{sym:"BTCUSDT",dir:"above",level:101.5,px:101.6,at:now-6e5,msg:"breakout"},{sym:"ETHUSDT",dir:"below",level:90,px:89.9,at:t0.getTime()-3600e3,msg:""}];save();
  // independent expectations: walk the bars, first touch closes (stop first), qty = risk / distance, floored to 2 dp
  let hit=null;for(const b of after){if(b.l<=Sx){hit={st:"sl",t:b.t};break}if(b.h>=T){hit={st:"tp",t:b.t};break}}
  const q1=Math.floor(100/(E-Sx)*100+1e-9)/100,real=(T-E)*q1;const q2=Math.floor(100/(S2-E2)*100+1e-9)/100,unreal=(E2-s[2])*q2;
  const ch=SYMS.map(x=>{const a=candles(x,"1D");return a&&a.length>1&&x[2]!=null?[x[0],(x[2]/a[a.length-2].c-1)*100]:null}).filter(Boolean).sort((a,b)=>b[1]-a[1]);
  return{hit,real,unreal,top:ch[0],bottom:ch[ch.length-1],up:ch.filter(x=>x[1]>0).length,dn:ch.filter(x=>x[1]<0).length,n:ch.length}});
assert.strictEqual(exp.hit&&exp.hit.st,"tp","seeded long hits target");
await P.click("#sumb");await P.waitForTimeout(700);
const sg=v=>(v>0?"+":v<0?"\u2212":"")+Math.abs(v).toFixed(2);
let got=await P.evaluate(()=>({real:document.getElementById("sm_real").textContent,unreal:document.getElementById("sm_unreal").textContent,br:document.getElementById("sm_breadth").textContent,al:document.getElementById("sm_alc").textContent,
  rows:[...document.querySelectorAll(".smt tbody tr")].map(r=>r.textContent),gain:(document.querySelector(".smg ol li")||{}).textContent,role:document.querySelector("#modal .box,.ov .box").getAttribute("role")}));
// the open short is valued at the live price, which can tick between our read and the dialog: allow 1 cent of drift per unit
assert.strictEqual(got.real,sg(exp.real),"realised P&L");assert(Math.abs(parseFloat(got.unreal.replace("\u2212","-"))-exp.unreal)<Math.max(1,Math.abs(exp.unreal)*.02),"open P&L "+got.unreal+" vs "+exp.unreal);
assert.strictEqual(got.br,exp.up+" / "+exp.dn);assert.strictEqual(got.al,"1","only today's alerts");assert.strictEqual(got.rows.length,2);assert(/Target hit/.test(got.rows[0])&&/Open/.test(got.rows[1]));
assert(got.gain.startsWith(exp.top[0].replace(/USDT$/,"")),"top gainer "+got.gain+" vs "+exp.top[0]);assert.strictEqual(got.role,"dialog");
let v=await axe(P,"#modal");assert.deepStrictEqual(v,[],theme+" summary axe: "+v.join(" | "));
if(theme==="dark"){await P.screenshot({path:__dirname+"/../shots/19_session_summary.png"});
  // export text
  const [dl]=await Promise.all([P.waitForEvent("download"),P.click("#sm_dl")]);const txt=fs.readFileSync(await dl.path(),"utf8");
  assert(/session summary/.test(txt)&&/Alerts triggered today: 1/.test(txt)&&/breakout/.test(txt)&&!/ETHUSDT crossed/.test(txt)&&/target hit/.test(txt)&&/not investment advice/.test(txt),txt);
  assert(/^vektor-session-\d{4}-\d\d-\d\d\.txt$/.test(dl.suggestedFilename()));
  // a mover opens its chart
  const ms=await P.evaluate(()=>document.querySelector(".smg .sm_sym").dataset.s);await P.click(".smg .sm_sym");await P.waitForTimeout(200);assert.strictEqual(await P.evaluate(()=>S.chart.sym),ms);
  // empty states: no positions, no alerts today
  await P.evaluate(()=>{S.dr={};S.alog=[];vtSumM()});await P.waitForTimeout(100);
  const e=await P.evaluate(()=>({real:document.getElementById("sm_real").textContent,t:document.querySelector(".smm").textContent}));
  assert.strictEqual(e.real,"\u2013");assert(/No positions closed today or open now/.test(e.t)&&/No alerts triggered today/.test(e.t));await P.evaluate(()=>closeM());
  // a triggered alert from the feed shows up
  await P.evaluate(()=>{const s=symOf("BTCUSDT"),p=s[2];S.alerts=[{id:9,sym:"BTCUSDT",price:+(p*1.01).toFixed(4),dir:"above",on:true}];const t=c=>BNWS.ws.onmessage({data:JSON.stringify([{s:"BTCUSDT",c:String(c),h:String(c),l:String(c)}])});t(p*.999);t(p*1.02);vtSumM()});
  assert.strictEqual(await P.textContent("#sm_alc"),"1","alert from the feed is counted");await P.evaluate(()=>closeM());
  // the evening chip
  await P.evaluate(()=>vtSumChip(true));assert(await P.isVisible("#vtsumchip"));await P.click("#vtsum_open");await P.waitForTimeout(100);assert(await P.evaluate(()=>!!document.querySelector(".smm")&&!document.getElementById("vtsumchip")));
  await P.evaluate(()=>closeM());await P.evaluate(()=>vtSumChip(true));assert(!(await P.isVisible("#vtsumchip").catch(()=>false)),"only once a day")}
console.log(theme,"errors",h.errors);assert.deepStrictEqual(h.errors,[]);await h.close()}
// phone: header button hidden, entry in the More sheet
const h=await launch({viewport:{width:390,height:844},mobile:true});const P=h.page;await P.goto(h.base);await ready(P);
assert.strictEqual(await P.isVisible("#sumb"),false);await P.click("#vnmore");await P.waitForTimeout(200);await P.click("#vm_sum");await P.waitForTimeout(200);
assert(await P.evaluate(()=>!!document.querySelector(".smm")));await P.screenshot({path:__dirname+"/../shots/m/390_session_summary.png"});
const ov=await P.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);assert(ov,"no sideways scroll");
assert.deepStrictEqual(h.errors,[]);await h.close();
console.log("SUMMARY OK");process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});
