// Journal & Prop Tracker: real page (no stub), empty states with no invented data, add/edit/delete through the form with validation,
// P&L / R / stats checked against hand-worked numbers, filters, daily calendar, prop rules (target, daily loss breach, trailing drawdown),
// CSV export -> import round trip with duplicate skipping and formula-injection guard, persistence, phone layout, axe in both themes.
const assert=require("assert"),fs=require("fs"),path=require("path");const {launch}=require("./harness");
const AXE=fs.readFileSync(path.join(__dirname,"../node_modules/axe-core/axe.min.js"),"utf8");
const axe=async(P,ctx)=>{await P.evaluate(AXE);return P.evaluate(async c=>(await axe.run(c||document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}})).violations.map(v=>v.id+" x"+v.nodes.length+" "+v.nodes[0].target.join(" ")),ctx)};
const ready=P=>P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED);
async function addTrade(P,o){await P.click("#jr_add");await P.waitForSelector("#jre_f");await P.waitForFunction(()=>document.activeElement&&/^jr[ea]_(sym|name)$/.test(document.activeElement.id));for(const [k,v] of Object.entries(o)){if(k==="side")await P.selectOption("#jre_side",v);else await P.fill("#jre_"+k,String(v))}await P.click('#jre_f button[type="submit"]');await P.waitForFunction(()=>!document.getElementById("jre_f"));await P.waitForTimeout(350)}
(async()=>{for(const theme of ["dark","light"]){const h=await launch({viewport:{width:1440,height:900},colorScheme:theme,acceptDownloads:true});const P=h.page;await P.goto(h.base);await ready(P);
const ws0=await P.evaluate(()=>(window.__w0=BNWS.ws,__WS.length));
await P.evaluate(()=>{location.hash="#/journal"});await P.waitForSelector("#jr_kpis");
if(theme==="dark"){
// 1) empty state: no stub, no invented numbers
let e=await P.evaluate(()=>({stub:!!document.querySelector("#pv-journal .stub"),tbl:document.getElementById("jr_tbl").textContent,kpi:document.getElementById("jr_kpis").textContent,cal:document.querySelector("#jr_cal .cnote").textContent,prop:document.getElementById("jr_propc").textContent}));
assert(!e.stub);assert(/No trades yet/.test(e.tbl));assert(/Net P&L\$0\.00/.test(e.kpi)&&/Closed trades0/.test(e.kpi),"empty KPIs "+e.kpi);assert(/No closed trades this month/.test(e.cal));assert(/Add your challenge/.test(e.prop));
// 2) form validation then adds
await P.click("#jr_add");await P.waitForSelector("#jre_f");await P.waitForFunction(()=>document.activeElement&&/^jr[ea]_(sym|name)$/.test(document.activeElement.id));await P.click('#jre_f button[type="submit"]');assert(/symbol is missing/.test(await P.textContent("#jre_err")));
await P.fill("#jre_sym","es");await P.fill("#jre_qty","2");await P.fill("#jre_entry","5000");await P.fill("#jre_exit","5010");await P.fill("#jre_pv","50");await P.fill("#jre_stop","4995");await P.fill("#jre_fees","4");await P.fill("#jre_close","2026-11-02T10:00");await P.fill("#jre_open","2026-11-02T09:30");
assert.strictEqual(await P.textContent("#jre_calc"),"P&L +$996.00 \u00b7 +1.99R \u00b7 risk $500.00","live preview");
await P.fill("#jre_acct","Eval 10k");await P.fill("#jre_setup","ORB");await P.click('#jre_f button[type="submit"]');await P.waitForFunction(()=>!document.getElementById("jre_f"));await P.waitForTimeout(350);
await addTrade(P,{sym:"NQ",side:"short",qty:1,entry:18000,exit:18020,pv:20,fees:2,stop:18010,open:"2026-11-03T09:00",close:"2026-11-03T10:00",acct:"Eval 10k",setup:"Fade",tags:"FOMO"});
await addTrade(P,{sym:"EURUSD",pnl:-150,open:"2026-11-03T14:00",close:"2026-11-03T15:00",acct:"Eval 10k",notes:"Moved stop"});
await addTrade(P,{sym:"CL",qty:1,entry:70,pv:1000,stop:69.5,open:"2026-11-04T09:00"});
let k=await P.evaluate(()=>{const v=[...document.querySelectorAll("#jr_kpis .kpi")].map(x=>x.querySelector(".v").textContent);return{v,cnt:document.getElementById("jr_cnt").textContent,rows:document.querySelectorAll("#jr_tbl tbody tr:not(.jrn)").length}});
assert.deepStrictEqual(k.v.slice(0,5),["+$444.00","3","33.3%","1.80","+$148.00"],"KPIs "+k.v);assert.strictEqual(k.v[5],"\u22120.01R");assert.strictEqual(k.v[7],"\u2212$552.00");assert.strictEqual(k.cnt,"4 trades \u00b7 1 open");assert.strictEqual(k.rows,4);
// 3) filters
await P.selectOption("#jr_fside","short");await P.waitForTimeout(100);assert.strictEqual(await P.evaluate(()=>document.querySelector("#jr_kpis .v").textContent),"\u2212$402.00");
await P.selectOption("#jr_fside","");await P.selectOption("#jr_fsetup","ORB");await P.waitForTimeout(100);assert.strictEqual(await P.evaluate(()=>document.querySelector("#jr_kpis .v").textContent),"+$996.00");await P.selectOption("#jr_fsetup","");
// 4) calendar month with values
await P.evaluate(()=>{S.jr.month="2026-11";save();jrCal()});const cal=await P.evaluate(()=>[...document.querySelectorAll("#jr_cal .jrcd.up,#jr_cal .jrcd.dn")].map(c=>c.textContent));
assert.deepStrictEqual(cal,["2+$996","3\u2212$552"]);
// 5) prop account: daily loss breach on 3 Nov (-552 >= 5% of 10k)
await P.click("#jr_padd");await P.waitForFunction(()=>document.activeElement&&/^jr[ea]_(sym|name)$/.test(document.activeElement.id));await P.fill("#jra_name","Eval 10k");await P.fill("#jra_size","10000");await P.fill("#jra_target","10");await P.fill("#jra_daily","5");await P.fill("#jra_maxdd","10");await P.fill("#jra_mindays","2");await P.click('#jra_f button[type="submit"]');await P.waitForFunction(()=>!document.getElementById("jra_f"));await P.waitForTimeout(350);
let pr=await P.textContent("#jr_propc");assert(/Rule broken/.test(pr)&&/Daily loss limit reached on 2026-11-03 \(\$552\.00\)/.test(pr),"prop "+pr);assert(/\$10,444\.00/.test(pr)&&/\$556\.00 to go/.test(pr));
// trailing drawdown maths in the pure function
const tr=await P.evaluate(()=>jrProp({name:"T",size:1000,maxdd:5,trailing:true},[{acct:"T",sym:"A",side:"long",pnl:100,close:"2026-01-01T10:00"},{acct:"T",sym:"A",side:"long",pnl:-40,close:"2026-01-02T10:00"},{acct:"T",sym:"A",side:"long",pnl:-15,close:"2026-01-03T10:00"}]));
assert.strictEqual(tr.peak,1100);assert.strictEqual(tr.ddNow,55);assert.strictEqual(tr.status,"breached");assert.strictEqual(tr.floor,1050);
// 6) edit + delete
const id=await P.evaluate(()=>{const c=S.jr.trades.find(t=>t.sym==="CL");if(!c)throw new Error("no CL: "+JSON.stringify(S.jr.trades.map(t=>[t.sym,t.side,t.qty,t.entry,t.exit,t.close])));return c.id});await P.click(`[data-ed="${id}"]`);await P.waitForFunction(()=>document.activeElement&&/^jr[ea]_(sym|name)$/.test(document.activeElement.id));await P.fill("#jre_exit","70.5");await P.fill("#jre_close","2026-11-04T11:00");await P.click('#jre_f button[type="submit"]');await P.waitForFunction(()=>!document.getElementById("jre_f"));await P.waitForTimeout(350);
assert.strictEqual(await P.evaluate(()=>jrPnl(S.jr.trades.find(t=>t.sym==="CL"))),500);
P.once("dialog",d=>d.accept());await P.click(`[data-del="${id}"]`);await P.waitForTimeout(200);assert.strictEqual(await P.evaluate(()=>S.jr.trades.length),3);
// 7) CSV export/import round trip, duplicates skipped, injection guarded
await P.evaluate(()=>{S.jr.trades[0].notes="=HYPERLINK(\"x\")";save()});
const [dl]=await Promise.all([P.waitForEvent("download"),P.click("#jr_exp")]);const csv=fs.readFileSync(await dl.path(),"utf8");
assert(/^\ufeffdate_open,date_close,symbol,side/.test(csv));assert(csv.includes("\"'=HYPERLINK(\"\"x\"\")\""),"formula cell neutralised");
let im=await P.evaluate(t=>jrImport(t),csv);assert.deepStrictEqual([im.add,im.dup],[0,3]);
im=await P.evaluate(t=>{S.jr.trades=[];return jrImport(t)},csv);assert.strictEqual(im.add,3);assert.strictEqual(await P.evaluate(()=>S.jr.trades.find(t=>t.notes.startsWith("=")).notes),"=HYPERLINK(\"x\")");
assert.strictEqual(await P.evaluate(()=>jrStats(S.jr.trades).net),444);
im=await P.evaluate(()=>jrImport("symbol,side,quantity,entry,exit,date_close\nES,sideways,1,1,2,2026-01-01\n,long,1,1,2,2026-01-01\nES,long,1,1,2,2026-02-30"));assert.strictEqual(im.add,0);assert.strictEqual(im.errors.length,3);
// 8) persistence
await P.reload();await ready(P);await P.waitForSelector("#jr_kpis");assert.strictEqual(await P.evaluate(()=>document.querySelector("#jr_kpis .v").textContent),"+$444.00");
await P.screenshot({path:__dirname+"/../shots/22_journal.png"});
}else{await P.evaluate(()=>{const J=jrCfg();J.accts.push({name:"A",size:10000,target:8,daily:5,maxdd:10});J.trades.push(jrClean({sym:"ES",side:"long",entry:1,exit:2,qty:10,close:"2026-11-02T10:00",acct:"A",setup:"ORB"}).t);save();jrBuild()})}
await P.waitForTimeout(600);let v=await axe(P,"#pv-journal");assert.deepStrictEqual(v,[],theme+" journal axe: "+v.join(" | "));
await P.click("#jr_add");await P.waitForTimeout(600);v=await axe(P,"#modal");assert.deepStrictEqual(v,[],theme+" trade form axe: "+v.join(" | "));await P.keyboard.press("Escape");
const ws1=await P.evaluate(n=>BNWS.ws===__w0&&__WS.length===n,ws0).catch(()=>true);
console.log(theme,"errors",h.errors);assert.deepStrictEqual(h.errors,[]);await h.close()}
// phone
const h=await launch({viewport:{width:390,height:844},mobile:true});const P=h.page;await P.goto(h.base);await ready(P);
await P.evaluate(()=>{location.hash="#/journal";const J=jrCfg();J.accts.push({name:"A",size:10000,target:8,daily:5,maxdd:10});for(let i=1;i<=6;i++)J.trades.push(jrClean({sym:"ES",side:i%2?"long":"short",entry:100,exit:100+(i%3-1)*2,qty:10,pv:5,close:"2026-11-0"+i+"T10:00",acct:"A",setup:i%2?"ORB":"Fade"}).t);save();jrBuild()});
await P.waitForTimeout(500);
const ph=await P.evaluate(()=>{const W=document.documentElement.clientWidth;const small=[...document.querySelectorAll("#pv-journal button,#pv-journal select,#pv-journal input")].filter(e=>e.offsetParent&&e.type!=="file").map(e=>{const r=e.getBoundingClientRect();return[e.id||e.className||e.textContent,Math.round(r.width),Math.round(r.height)]}).filter(x=>x[1]<43.5||x[2]<43.5);return{sw:document.documentElement.scrollWidth,W,small}});
assert(ph.sw<=ph.W,"phone no sideways scroll");assert.deepStrictEqual(ph.small,[],"phone targets");await P.screenshot({path:__dirname+"/../shots/m/qa_390_journal_full.png"});
await P.click("#jr_add");await P.waitForTimeout(400);const fit=await P.evaluate(()=>{const b=document.querySelector("#modal .box").getBoundingClientRect();return b.left>=-1&&b.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth});assert(fit,"form fits");
await P.screenshot({path:__dirname+"/../shots/m/qa_390_journal_form.png"});assert.deepStrictEqual(h.errors,[]);await h.close();console.log("JOURNAL OK")})().catch(e=>{console.error(e);process.exit(1)});
