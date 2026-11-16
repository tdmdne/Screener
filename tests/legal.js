// Legal pages: every #/legal route renders, footer links work, WebSockets survive, no placeholder/entity leaks, vt_page untouched.
const {launch}=require("./harness");const assert=require("assert");
const DOCS={terms:"Terms of Use",privacy:"Privacy Policy",cookies:"Cookies and Local Storage",risk:"Risk Disclaimer and Not Financial Advice",data:"Data Sources and Attributions",liability:"Disclaimer of Liability"};
(async()=>{const h=await launch();const P=h.page;await P.goto(h.base);
await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
const ws0=await P.evaluate(()=>{window.__w0=BNWS.ws;return __WS.length});
// footer present with one-line risk disclaimer
const ft=await P.evaluate(()=>{const f=document.querySelector("footer.vfoot");return f&&{t:f.textContent,links:[...f.querySelectorAll("a")].map(a=>a.getAttribute("href")),vis:f.offsetParent!==null}});
assert(ft&&ft.vis&&/high risk/.test(ft.t)&&ft.links.includes("#/legal/risk")&&ft.links.length===6,JSON.stringify(ft));
// the solicitor-review note lives in the source only
assert(!(await P.evaluate(()=>document.body.innerText)).includes("solicitor"));
await P.click('footer.vfoot a[href="#/legal/privacy"]');await P.waitForTimeout(300);
assert.strictEqual(await P.evaluate(()=>document.documentElement.dataset.page),"legal");
for(const [k,t] of Object.entries(DOCS)){await P.evaluate(k=>{location.hash="#/legal/"+k},k);await P.waitForTimeout(250);
  const st=await P.evaluate(()=>{const e=document.getElementById("pv-legal");return{page:document.documentElement.dataset.page,hash:location.hash,vis:e.offsetParent!==null,
    h1:e.querySelector("h1")&&e.querySelector("h1").textContent,on:(e.querySelector("nav a.on")||{}).textContent,txt:e.innerText,ws:!!document.getElementById("cp").offsetParent,ls:localStorage.getItem("vt_page")}});
  assert.strictEqual(st.page,"legal");assert.strictEqual(st.hash,"#/legal/"+k);assert(st.vis&&!st.ws);assert.strictEqual(st.h1,t);
  assert(st.txt.includes("[Effective date]")&&st.txt.includes("[Company legal name]"));assert(!/&(amp|quot|lt|gt|#\d+);/.test(st.txt),k+" entity text");
  assert.notStrictEqual(st.ls,"legal");console.log("legal",k,"ok",st.txt.length,"chars");}
// content facts
const pv=await P.evaluate(()=>{location.hash="#/legal/privacy";return new Promise(r=>setTimeout(()=>r(document.getElementById("pv-legal").innerText),250))});
for(const s of ["UK GDPR","Data Protection Act 2018","scr2","scr2a","IndexedDB","stream.binance.com","corsproxy.io","api.twelvedata.com","ws.finnhub.io","api.polygon.io","api.coingecko.com","cdn.jsdelivr.net","password is not stored","[Contact email]","[Registered address]"])assert(pv.includes(s),"privacy missing "+s);
assert(await P.evaluate(n=>BNWS.ws===__w0&&__WS.length===n,ws0),"websocket replaced");
// index route + reload deep link
await P.evaluate(()=>{location.hash="#/legal"});await P.waitForTimeout(250);
assert.strictEqual(await P.evaluate(()=>document.querySelectorAll("#pv-legal article li a").length),6);
await P.goto(h.base+"#/legal/cookies");await P.reload();await P.waitForFunction(()=>BOOTED);await P.waitForTimeout(300);
assert.deepStrictEqual(await P.evaluate(()=>[document.documentElement.dataset.page,location.hash,document.querySelector("#pv-legal h1").textContent]),["legal","#/legal/cookies","Cookies and Local Storage"]);
// back to a normal page via nav; WebSockets kept across in-page switches (checked before reload)
await P.click('#vnav a[data-p="calc"]');await P.waitForTimeout(300);assert.strictEqual(await P.evaluate(()=>location.hash),"#/calc");
console.log("errors",h.errors,"console",h.consoleErr);assert(!h.errors.length&&!h.consoleErr.length);
await h.close();console.log("LEGAL OK",ws0)})().catch(e=>{console.error(e);process.exit(1)});
