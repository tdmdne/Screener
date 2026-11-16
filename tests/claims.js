// Checklist 5: no unsupported claims in the UI copy, a neutral not-advice note next to scores, scoring maths byte-identical
// to the baseline, BUY/SELL buttons untouched.
const {launch}=require("./harness");const assert=require("assert");const path=require("path");const {hashes,BASE}=require("./scorefns");
const R=path.join(__dirname,"..");
assert.deepStrictEqual(hashes(R+"/index.html"),BASE,"scoring functions must be unchanged");
const BAD=/\b(best (markets?|quality)|is the best|guarantee[ds]?|proven|high[- ]probability|can't lose|sure win|winning trades)\b|stronger market cycles|accumulation\/manipulation/i;
(async()=>{const h=await launch();const P=h.page;await P.goto(h.base);await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));
await P.evaluate(()=>go("workspace"));await P.waitForSelector("#vtna");
const na=await P.textContent("#vtna");assert(/aren.t investment advice/.test(na)&&/past price data/.test(na),na);
assert.strictEqual(await P.getAttribute("#vtna a","href"),"#/legal/risk");
// presets: neutral titles + info dialog
const titles=await P.$$eval("#presets .preset-btn",b=>b.map(x=>x.title).join(" | "));assert(!BAD.test(titles),titles);assert(/Strictest filter/.test(titles));
await P.evaluate(()=>presetInfo());let m=await P.textContent("#modal");assert(!BAD.test(m),m);assert(/Not investment advice/.test(m));
await P.evaluate(()=>{closeM();evcInfo()});m=await P.textContent("#modal");
const evc=await P.evaluate(()=>VT_EVC);for(const k of ["H","M","L"])assert(m.includes(`${k} \u2013 entry timeframe ${evc[k].e}, validated on ${evc[k].v}`),"evcInfo matches the code: "+m);
await P.evaluate(()=>closeM());
// screener page + drawer note
await P.evaluate(()=>go("screener"));await P.waitForTimeout(300);assert(await P.isVisible("#vtna"));
await P.evaluate(()=>sxDrawer("BTCUSDT"));const dn=await P.textContent("#sxd .vtna");assert(/aren.t investment advice/.test(dn)&&/P1 strictest/.test(dn),dn);
// whole visible UI (app + sign-in hero) free of the flagged phrases
const all=await P.evaluate(()=>document.body.innerText);assert(!BAD.test(all),(all.match(BAD)||[])[0]);
// BUY/SELL buttons untouched
assert(/SELL<\/button><button[^>]*>BUY<\/button>/.test(require("fs").readFileSync(R+"/index.html","utf8")));
console.log("errors",h.errors,"console",h.consoleErr);assert.deepStrictEqual(h.errors,[]);await h.close();
const h2=await launch({auth:false});const Q=h2.page;await Q.goto(h2.base);await Q.waitForSelector(".auhero h1");const hero=await Q.textContent(".auhero");
assert(!BAD.test(hero)&&/investment advice/.test(hero),hero);await h2.close();
console.log("CLAIMS OK")})().catch(e=>{console.error(e);process.exit(1)});
