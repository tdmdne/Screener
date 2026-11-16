// Phone screenshots of every page into shots/m/ (args: WxH, page list)
const {launch}=require("./harness");const [W,H]=(process.argv[2]||"375x812").split("x").map(Number);
const pages=(process.argv[3]||"workspace,chart,screener,heatmap,calendar,journal,calc,backtest,legal").split(",");
(async()=>{const h=await launch({viewport:{width:W,height:H},mobile:true});const P=h.page;await P.goto(h.base);
await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));await P.evaluate(()=>{S.mkt="CRY";save();render();openChart("BTCUSDT","1H")});
await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]);await P.waitForTimeout(1500);
for(const p of pages){await P.evaluate(p=>{if(p==="legal")location.hash="#/legal/privacy";else go(p)},p);await P.waitForTimeout(1200);
  const ov=await P.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));console.log(p,JSON.stringify(ov));
  await P.evaluate(()=>scrollTo(0,0));await P.screenshot({path:`shots/m/${W}_${p}.png`,fullPage:!!process.env.FULL})}
console.log("errors",h.errors,"console",h.consoleErr);await h.close()})();
