// Screenshots of every page (dark theme) into shots/
const {launch}=require("./harness");const pages=(process.argv[2]||"workspace,chart,screener,heatmap,calendar,journal,calc,backtest").split(",");
(async()=>{const h=await launch({calendar:process.env.CAL?require("fs").readFileSync(process.env.CAL,"utf8"):undefined});const P=h.page;await P.goto(h.base);
await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));await P.evaluate(()=>{S.mkt="CRY";save();render();openChart("BTCUSDT","1H")});
await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]);await P.waitForTimeout(2500);
if(process.env.PREP)await P.evaluate(process.env.PREP);
let i=1;for(const p of pages){await P.evaluate(p=>go(p),p);await P.waitForTimeout(1500);await P.screenshot({path:`shots/${String(i++).padStart(2,"0")}_${p}.png`})}
console.log("errors",h.errors,"console",h.consoleErr);await h.close()})();
