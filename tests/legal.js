// Legal pages: every #/legal route renders, footer links work, WebSockets survive, no placeholder/entity leaks, vt_page untouched.
const {launch}=require("./harness");const assert=require("assert");
const DOCS={terms:"Terms of Use",privacy:"Privacy Policy",cookies:"Cookies and Local Storage",risk:"Risk Disclaimer and Not Financial Advice",data:"Data Sources and Attributions",liability:"Disclaimer of Liability",refunds:"Refunds and Cancellation",about:"About and Contact",accessibility:"Accessibility statement","your-data":"Your data"};
(async()=>{const h=await launch();const P=h.page;await P.goto(h.base+"#/workspace");
await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
const ws0=await P.evaluate(()=>{window.__w0=VT_EDGE.ws;return __edge.sockets.length});
// cluttered bottom footer bar removed from terminal; legal hub accessible via Settings dropdown
assert.strictEqual(await P.evaluate(()=>!!document.querySelector("footer.vfoot")),false,"bottom legal footer bar should be removed");
// no draft or solicitor framing on the main app (or later on legal pages)
assert(!(await P.evaluate(()=>document.body.innerText)).includes("DRAFT"));
assert(!(await P.evaluate(()=>document.body.innerText.toLowerCase())).includes("solicitor"));
await P.click('#vtWebSetBtn');await P.click('#vtWebSetMenu a[href="#/legal"]');await P.waitForTimeout(300);
assert.strictEqual(await P.evaluate(()=>document.documentElement.dataset.page),"legal");
for(const [k,t] of Object.entries(DOCS)){await P.evaluate(k=>{location.hash="#/legal/"+k},k);await P.waitForTimeout(250);
  const st=await P.evaluate(()=>{const e=document.getElementById("pv-legal");return{page:document.documentElement.dataset.page,hash:location.hash,vis:e.offsetParent!==null,
    h1:e.querySelector("h1")&&e.querySelector("h1").textContent,on:(e.querySelector("nav a.on")||{}).textContent,txt:e.innerText,ws:!!document.getElementById("cp").offsetParent,ls:localStorage.getItem("vt_page")}});
  assert.strictEqual(st.page,"legal");assert.strictEqual(st.hash,"#/legal/"+k);assert(st.vis&&!st.ws);assert.strictEqual(st.h1,t);
  assert(st.txt.includes("19 November 2026")&&st.txt.includes("Vektor Terminal")&&st.txt.includes("support@vektorterminal.com"));assert(!/&(amp|quot|lt|gt|#\d+);/.test(st.txt),k+" entity text");
  assert(!/\[(?:Effective date|Company legal name|Registered address|Company number|ICO registration number|Account → Billing page|confirm[^\]]*)\]/i.test(st.txt),k+" still has template placeholder");
  assert(!st.txt.includes("workers.dev"),k+" leaks workers.dev URL");
  assert(!st.txt.includes("DRAFT")&&!/solicitor/i.test(st.txt),k+" still has draft or solicitor framing");
  assert(!/template only/i.test(st.txt),k+" still says template only");
  assert(!/S01|S02|S03|S04/.test(st.txt),k+" still mentions S01-S04");
  assert(!/Stripe/.test(st.txt),k+" names Stripe before billing is live");
  assert(!/Elite free trial/i.test(st.txt),k+" mentions non-existent Elite free trial");
  assert(!/Pine Script|Translate Pine/.test(st.txt),k+" mentions Pine translation");
  assert.notStrictEqual(st.ls,"legal");console.log("legal",k,"ok",st.txt.length,"chars");}
// content facts
const pv=await P.evaluate(()=>{location.hash="#/legal/privacy";return new Promise(r=>setTimeout(()=>r(document.getElementById("pv-legal").innerText),250))});
for(const s of ["UK GDPR","Data Protection Act 2018","scr2","scr2a","IndexedDB","api.binance.com","data-api.binance.vision","api.twelvedata.com","same-origin Cloudflare edge market service","feeds.finance.yahoo.com","nfs.faireconomy.media","datafeed.dukascopy.com","Data provided by Twelve Data","Cloudflare D1","PBKDF2-SHA256","HttpOnly","support@vektorterminal.com","United Kingdom (England and Wales)","How requests are routed","Cloudflare Web Analytics","static.cloudflareinsights.com","Umami Cloud"])assert(pv.includes(s),"privacy missing "+s);for(const s of ["ws.finnhub.io","api.polygon.io","api.coingecko.com","cdn.jsdelivr.net","stream.binance.com:9443"])assert(!pv.includes(s),"privacy must not list browser-direct host "+s);
assert(pv.includes("Yahoo Finance RSS")&&pv.includes("/api/news"),"privacy should say Yahoo news RSS is backend-only");
assert(!/Plausible/.test(pv),"privacy mentions a paid analytics tool");
assert(!/prototype/i.test(pv),"privacy still claims prototype sign-in");
const ck=await P.evaluate(()=>{location.hash="#/legal/cookies";return new Promise(r=>setTimeout(()=>r(document.getElementById("pv-legal").innerText),250))});
for(const s of ["HttpOnly","Cloudflare Web Analytics","Umami Cloud","Advertising is not used"])assert(ck.includes(s),"cookies missing "+s);
assert(!/if adopted/.test(ck),"cookies still treats Umami as unadopted");
const rf=await P.evaluate(()=>{location.hash="#/legal/refunds";return new Promise(r=>setTimeout(()=>r(document.getElementById("pv-legal").innerText),250))});
for(const s of ["currently free","Free","Pro Desk","Consumer Rights Act 2015","Consumer Contracts","regulation 36","regulation 37","Model cancellation form","not excluded","14-day cancellation right"])assert(rf.includes(s),"refunds missing "+s);
const tm=await P.evaluate(()=>{location.hash="#/legal/terms";return new Promise(r=>setTimeout(()=>r(document.getElementById("pv-legal").innerText),250))});
for(const s of ["currently free","Free","Pro Desk (Waitlist)","Cloudflare D1","PBKDF2-SHA256","HttpOnly","30 days","not authorised or regulated by the Financial Conduct Authority"])assert(tm.includes(s),"terms missing "+s);
assert(!/prototype/i.test(tm),"terms still claims prototype sign-in");
assert(pv.includes("legitimate interests")&&pv.includes("Art. 15")&&pv.includes("Art. 22")&&pv.includes("Information Commissioner")&&pv.includes("18 and over"),"privacy missing rights or lawful-basis wording");

assert(await P.evaluate(n=>VT_EDGE.ws===__w0&&__edge.sockets.length===n,ws0),"websocket replaced");
// index route + reload deep link
await P.evaluate(()=>{location.hash="#/legal"});await P.waitForTimeout(250);
assert.strictEqual(await P.evaluate(()=>document.querySelectorAll("#pv-legal article li a").length),10);
await P.goto(h.base+"#/legal/cookies");await P.reload();await P.waitForFunction(()=>BOOTED);await P.waitForTimeout(300);
assert.deepStrictEqual(await P.evaluate(()=>[document.documentElement.dataset.page,location.hash,document.querySelector("#pv-legal h1").textContent]),["legal","#/legal/cookies","Cookies and Local Storage"]);
// back to a normal page via nav; WebSockets kept across in-page switches (checked before reload)
await P.click('#vtFeatBtn');await P.click('#vtFeatMenu a[href="#/calc"]');await P.waitForTimeout(300);assert.strictEqual(await P.evaluate(()=>location.hash),"#/calc");
console.log("errors",h.errors,"console",h.consoleErr);assert(!h.errors.length&&!h.consoleErr.length);
assert.deepStrictEqual(h.offOrigin,[],"non-origin requests");await h.close();console.log("LEGAL OK",ws0)})().catch(e=>{console.error(e);process.exit(1)});
