// Router: every page renders, WebSockets and LIVE caches survive page switches, hash + localStorage persist.
const {launch}=require("./harness");const assert=require("assert");
const PAGES=["workspace","chart","screener","heatmap","calendar","journal","calc","backtest"];
(async()=>{const h=await launch();const P=h.page;await P.goto(h.base);
await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
// Home-first routing: "/" opens the Landing Page with Products dropdown and Open Terminal CTA
await P.waitForSelector("#vt-landing-root #vl-open-terminal");
await P.click("#vl-open-terminal");await P.waitForTimeout(300);
assert.strictEqual(await P.evaluate(()=>location.hash),"#/workspace");
await P.evaluate(()=>openChart("BTCUSDT","1H"));await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]);await P.waitForTimeout(800);
const before=await P.evaluate(()=>{window.__ws0=[VT_EDGE.ws];return{n:__edge.sockets.length,rs:__edge.sockets.map(w=>w.readyState),live:Object.keys(LIVE).length}});
for(const p of PAGES){await P.click('#vtFeatBtn');await P.click(`#vtFeatMenu a[href="#/${p}"]`);await P.waitForTimeout(400);
  const st=await P.evaluate(p=>{const r=document.documentElement;const vis=id=>{const e=document.getElementById(id);return !!e&&e.offsetParent!==null};
    return{page:r.dataset.page,hash:location.hash,ls:localStorage.getItem("vt_page"),on:document.querySelector("#vnav a.on").dataset.p,featCur:document.getElementById("vtFeatCur").textContent,
      ws:vis("cp")&&document.getElementById("cp").offsetWidth>0,side:!!document.querySelector(".side").offsetParent,pv:vis("pv-"+p),title:document.title}},p);
  assert.strictEqual(st.page,p);assert.strictEqual(st.hash,"#/"+p);assert.strictEqual(st.ls,p);assert.strictEqual(st.on,p);assert(st.featCur&&st.featCur.length>0);
  if(p==="workspace"){assert(st.ws&&st.side)}else if(p==="chart"){assert(st.ws&&!st.side)}else if(p==="screener"){assert(!st.ws&&st.side)}else{assert(st.pv&&!st.ws&&!st.side,JSON.stringify(st))}
  console.log("page",p,"ok",st.title);
}
const after=await P.evaluate(()=>({n:__edge.sockets.length,rs:__edge.sockets.map(w=>w.readyState),same:VT_EDGE.ws===__ws0[0],live:Object.keys(LIVE).length}));
console.log("ws before",JSON.stringify(before),"after",JSON.stringify(after));
assert.strictEqual(after.n,before.n);assert.deepStrictEqual(after.rs,before.rs);assert(after.same);assert(after.live>=before.live);
// back button
await P.goBack();await P.waitForTimeout(300);assert.strictEqual(await P.evaluate(()=>document.documentElement.dataset.page),"calc");
// reload with explicit hash
await P.goto(h.base+"#/journal");await P.reload();await P.waitForFunction(()=>BOOTED);await P.waitForTimeout(300);
assert.strictEqual(await P.evaluate(()=>document.documentElement.dataset.page),"journal");
// logo -> Home (#/); Open Terminal -> workspace; workspace features still work
await P.click(".vt-brand-h");await P.waitForSelector("#vt-landing-root #vl-open-terminal");
await P.click("#vl-open-terminal");await P.waitForTimeout(400);
assert.strictEqual(await P.evaluate(()=>document.documentElement.dataset.page),"workspace");
const wf=await P.evaluate(async()=>{applyPreset("P5");const n5=document.querySelectorAll("#t tbody tr[data-s]").length;setDir("short");const sh=S.dir;setDir("long");
  openChart("ETHUSDT","1H");await new Promise(r=>setTimeout(r,1500));alertsM();const am=!!document.getElementById("al_px");closeM();
  return{n5,sh,chart:!!ch&&S.chart.sym==="ETHUSDT",am,wl:!!document.querySelector("#wl .wlh")}});
console.log("workspace",JSON.stringify(wf));assert(wf.n5>0&&wf.sh==="short"&&wf.chart&&wf.am&&wf.wl);
// unknown hash falls back
await P.evaluate(()=>{location.hash="#/nope"});await P.waitForTimeout(300);assert.strictEqual(await P.evaluate(()=>location.hash),"#/workspace");
console.log("errors",h.errors,"console",h.consoleErr);assert(!h.errors.length&&!h.consoleErr.length);
assert.deepStrictEqual(h.offOrigin,[],"non-origin requests");await h.close();console.log("ROUTER OK")})().catch(e=>{console.error(e);process.exit(1)});
