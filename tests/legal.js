// Legal pages: every #/legal route renders, footer links work, WebSockets survive, no placeholder/entity leaks, vt_page untouched.
const {launch}=require("./harness");const assert=require("assert");
const DOCS={terms:"Terms of Use",privacy:"Privacy Policy",cookies:"Cookies and Local Storage",risk:"Risk Disclaimer and Not Financial Advice",data:"Data Sources and Attributions",liability:"Disclaimer of Liability",refunds:"Refunds and Cancellation",about:"About and Contact",accessibility:"Accessibility statement","your-data":"Your data"};
(async()=>{const h=await launch();const P=h.page;await P.goto(h.base);
await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
const ws0=await P.evaluate(()=>{window.__w0=BNWS.ws;return __WS.length});
// footer present with one-line risk disclaimer
const ft=await P.evaluate(()=>{const f=document.querySelector("footer.vfoot");return f&&{t:f.textContent,links:[...f.querySelectorAll("a")].map(a=>a.getAttribute("href")),vis:f.offsetParent!==null}});
assert(ft&&ft.vis&&/high risk/.test(ft.t)&&ft.links.includes("#/legal/risk")&&ft.links.length===10,JSON.stringify(ft));
// no draft or solicitor framing on the main app or footer (or later on legal pages)
assert(!(await P.evaluate(()=>document.body.innerText)).includes("DRAFT"));
assert(!(await P.evaluate(()=>document.body.innerText.toLowerCase())).includes("solicitor"));
await P.click('footer.vfoot a[href="#/legal/privacy"]');await P.waitForTimeout(300);
assert.strictEqual(await P.evaluate(()=>document.documentElement.dataset.page),"legal");
for(const [k,t] of Object.entries(DOCS)){await P.evaluate(k=>{location.hash="#/legal/"+k},k);await P.waitForTimeout(250);
  const st=await P.evaluate(()=>{const e=document.getElementById("pv-legal");return{page:document.documentElement.dataset.page,hash:location.hash,vis:e.offsetParent!==null,
    h1:e.querySelector("h1")&&e.querySelector("h1").textContent,on:(e.querySelector("nav a.on")||{}).textContent,txt:e.innerText,ws:!!document.getElementById("cp").offsetParent,ls:localStorage.getItem("vt_page")}});
  assert.strictEqual(st.page,"legal");assert.strictEqual(st.hash,"#/legal/"+k);assert(st.vis&&!st.ws);assert.strictEqual(st.h1,t);
  assert(st.txt.includes("[Effective date]")&&st.txt.includes("[Company legal name]"));assert(!/&(amp|quot|lt|gt|#\d+);/.test(st.txt),k+" entity text");
  assert(!st.txt.includes("DRAFT")&&!/solicitor/i.test(st.txt),k+" still has draft or solicitor framing");
  assert(!/template only/i.test(st.txt),k+" still says template only");
  assert(!/S01|S02|S03|S04/.test(st.txt),k+" still mentions S01-S04");
  if(!["terms","privacy","refunds"].includes(k))assert(!/Stripe/.test(st.txt),k+" names Stripe");
  assert(!/Pine Script|Translate Pine/.test(st.txt),k+" mentions Pine translation");
  assert.notStrictEqual(st.ls,"legal");console.log("legal",k,"ok",st.txt.length,"chars");}
// content facts
const pv=await P.evaluate(()=>{location.hash="#/legal/privacy";return new Promise(r=>setTimeout(()=>r(document.getElementById("pv-legal").innerText),250))});
for(const s of ["UK GDPR","Data Protection Act 2018","scr2","scr2a","IndexedDB","data-stream.binance.vision","stream.binance.com:9443","api.binance.com","api.twelvedata.com","ws.twelvedata.com","vektor-market.tdmltd2026.workers.dev","does not open a WebSocket to Twelve Data","ws.finnhub.io","api.polygon.io","api.coingecko.com","cdn.jsdelivr.net","feeds.finance.yahoo.com","nfs.faireconomy.media","datafeed.dukascopy.com","Data provided by Twelve Data","password is not stored","vektorhq@proton.me","[Registered address]","How requests are routed","Cloudflare Web Analytics","static.cloudflareinsights.com","Umami Cloud","cloud.umami.is","gateway.umami.is","[confirm before publishing: Umami installed and live]","[confirm: Umami Cloud hosting region and DPA]"])assert(pv.includes(s),"privacy missing "+s);
assert(pv.includes("Yahoo is not used as a price"),"privacy should say Yahoo is RSS only");
assert(!/Plausible/.test(pv),"privacy mentions a paid analytics tool");
const ck=await P.evaluate(()=>{location.hash="#/legal/cookies";return new Promise(r=>setTimeout(()=>r(document.getElementById("pv-legal").innerText),250))});
for(const s of ["Cloudflare Web Analytics","Umami Cloud","Advertising is not used","[confirm before publishing: Umami installed and live]","[confirm: Umami Cloud hosting region and DPA]"])assert(ck.includes(s),"cookies missing "+s);
assert(!/if adopted/.test(ck),"cookies still treats Umami as unadopted");
const rf=await P.evaluate(()=>{location.hash="#/legal/refunds";return new Promise(r=>setTimeout(()=>r(document.getElementById("pv-legal").innerText),250))});
for(const s of ["currently free","£11.99","£109","£24.99","£219","$14.99","$135","$29.99","$269","20% VAT","[confirm before launch]","Sold through Link, LLC","Stripe Managed Payments","Link Consumer Terms of Service","Consumer Rights Act 2015","Consumer Contracts","regulation 36","regulation 37","Model cancellation form","not excluded","Free trial","Elite only","end of day 7","one trial per person","13-month","plus-tags are removed","offered Elite without a trial","keep Elite until the trial ends","Part 4, Chapter 2","original payment method through Stripe","14-day cancellation rights"])assert(rf.includes(s),"refunds missing "+s);
assert(!/one trial per person \[confirm\]/.test(rf),"refunds still has trial confirm placeholder");
assert(!/pounds sterling only/i.test(rf)&&!/All prices are in pounds sterling/.test(rf),"refunds still pounds-sterling-only");
assert(!/Chapter 3 of Part 4/.test(rf),"refunds still cites DMCC Chapter 3");
const tm=await P.evaluate(()=>{location.hash="#/legal/terms";return new Promise(r=>setTimeout(()=>r(document.getElementById("pv-legal").innerText),250))});
for(const s of ["currently free","Pro","Elite","£11.99","$14.99","$29.99","[confirm before launch]","Sold through Link, LLC","Stripe Managed Payments","Link Consumer Terms of Service","Stripe, LLC","Stripe Technology Company, Limited","shown at checkout","renew automatically","30 days","not authorised or regulated by the Financial Conduct Authority","Free trial","Elite only","end of day 7","one trial per person","13-month","plus-tags are removed","offered Elite without a trial","keep Elite until the trial ends"])assert(tm.includes(s),"terms missing "+s);
assert(!/one trial per person \[confirm\]/.test(tm),"terms still has trial confirm placeholder");
assert(!/pounds sterling only/i.test(tm)&&!/in pounds sterling including/.test(tm),"terms still pounds-sterling-only");
assert(pv.includes("legitimate interests")&&pv.includes("Art. 15")&&pv.includes("Art. 22")&&pv.includes("Information Commissioner")&&pv.includes("18 and over"),"privacy missing rights or lawful-basis wording");
for(const s of ["card identifier","normalised email","do not store your card number","13 months","independent controller","Sold through Link, LLC","Stripe Privacy Policy","Link Privacy Center","Stripe Data Processing Agreement","Payment Services Regulations 2017"])assert(pv.includes(s),"privacy missing trial-eligibility or Stripe wording "+s);
assert(!pv.includes("[Payment provider, e.g. merchant of record, confirm]")&&!pv.includes("[confirm: USD tax treatment / merchant of record]")&&!pv.includes("[confirm: retention period for trial-eligibility records]"),"privacy still has payment or retention placeholders");
assert(!rf.includes("[Payment provider, e.g. merchant of record, confirm]")&&!rf.includes("[confirm: USD tax treatment / merchant of record]")&&!tm.includes("[Payment provider, e.g. merchant of record, confirm]")&&!tm.includes("[confirm: USD tax treatment / merchant of record]"),"terms or refunds still have payment placeholders");

assert(await P.evaluate(n=>BNWS.ws===__w0&&__WS.length===n,ws0),"websocket replaced");
// index route + reload deep link
await P.evaluate(()=>{location.hash="#/legal"});await P.waitForTimeout(250);
assert.strictEqual(await P.evaluate(()=>document.querySelectorAll("#pv-legal article li a").length),10);
await P.goto(h.base+"#/legal/cookies");await P.reload();await P.waitForFunction(()=>BOOTED);await P.waitForTimeout(300);
assert.deepStrictEqual(await P.evaluate(()=>[document.documentElement.dataset.page,location.hash,document.querySelector("#pv-legal h1").textContent]),["legal","#/legal/cookies","Cookies and Local Storage"]);
// back to a normal page via nav; WebSockets kept across in-page switches (checked before reload)
await P.click('#vtFeatBtn');await P.click('#vtFeatMenu a[href="#/calc"]');await P.waitForTimeout(300);assert.strictEqual(await P.evaluate(()=>location.hash),"#/calc");
console.log("errors",h.errors,"console",h.consoleErr);assert(!h.errors.length&&!h.consoleErr.length);
await h.close();console.log("LEGAL OK",ws0)})().catch(e=>{console.error(e);process.exit(1)});
