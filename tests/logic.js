// Unit tests for the pure helpers inside index.html (the VTC block and, later, backtest/treemap logic)
const fs=require("fs"),vm=require("vm"),assert=require("assert");
const html=fs.readFileSync(__dirname+"/../index.html","utf8");
function block(tag){const a=html.indexOf("// <"+tag+">"),b=html.indexOf("// </"+tag+">");if(a<0||b<0)return null;return html.slice(a,b)}
const ctx={Math,Infinity,isFinite,String,Number,Array,Object};vm.createContext(ctx);
const near=(a,b,e=1e-9)=>assert(Math.abs(a-b)<=e,`${a} != ${b}`);
let n=0;const t=(name,f)=>{f();n++;console.log("ok -",name)};
vm.runInContext(block("VTC")+";this.VTC=VTC",ctx);const V=ctx.VTC;
t("pip value: USD quote",()=>{near(V.pipValueUSD(V.fxSpec("EURUSD"),1.08,null),10)});
t("pip value: USD base (USDJPY 150)",()=>{near(V.pipValueUSD(V.fxSpec("USDJPY"),150,null),100000*0.01/150)});
t("pip value: cross via quote rate (EURGBP, GBPUSD 1.27)",()=>{near(V.pipValueUSD(V.fxSpec("EURGBP"),0.85,1.27),12.7)});
t("pip value: gold, silver",()=>{near(V.pipValueUSD(V.fxSpec("XAUUSD"),2600,null),10);near(V.pipValueUSD(V.fxSpec("XAGUSD"),30,null),50)});
t("pip value: unknown rate -> null",()=>{assert.strictEqual(V.pipValueUSD(V.fxSpec("EURGBP"),0.85,null),null)});
t("lots",()=>{near(V.fxLots(500,20,10),2.5);assert.strictEqual(V.fxLots(500,0,10),0)});
t("risk amount",()=>{near(V.riskAmount(100000,0.5,0),500);near(V.riskAmount(100000,0.5,250),250)});
t("futures contracts round down",()=>{const es=V.futSpec("ES");assert.strictEqual(V.futContracts(1000,16,es.tickValue),5);assert.strictEqual(V.futContracts(999,16,es.tickValue),4);near(es.pointValue,50);near(V.futSpec("NQ").pointValue,20)});
t("drawdown recovery",()=>{near(V.ddRecovery(0.5),1);near(V.ddRecovery(0.2),0.25);assert.strictEqual(V.ddRecovery(1),Infinity)});
t("expectancy",()=>{near(V.expectancyR(0.5,2),0.5);near(V.expectancyR(0.25,2),-0.25)});
const base={acct:100000,target:8,maxDD:10,dailyDD:5,riskPct:1,winRate:0.5,rr:2,tradesPerDay:2,maxDays:30,trailing:false,fixed:true,runs:500};
t("sim: always win passes",()=>{const r=V.simChallenge({...base,winRate:1},1);near(r.pass,1);assert.strictEqual(r.medianDays,2)});
t("sim: always lose hits daily limit first",()=>{const r=V.simChallenge({...base,winRate:0,tradesPerDay:10},1);near(r.failDay,1);near(V.simChallenge({...base,winRate:0},1).failDD,1)});
t("sim: no daily limit -> max DD",()=>{const r=V.simChallenge({...base,winRate:0,dailyDD:0},1);near(r.failDD,1)});
t("sim: deterministic + fractions sum to 1",()=>{const a=V.simChallenge(base,7),b=V.simChallenge(base,7);assert.deepStrictEqual(a,b);near(a.pass+a.failDD+a.failDay+a.timeout,1,1e-9)});
t("trade stats",()=>{const s=V.tradeStats([{pnl:100,r:1},{pnl:-50,r:-0.5},{pnl:200,r:2},{pnl:-50,r:-0.5}],1000);
  near(s.winRate,0.5);near(s.profitFactor,3);near(s.net,200);near(s.expectancy,50);near(s.maxDD,50);near(s.avgR,0.5);assert.deepStrictEqual(Array.from(s.equity),[1000,1100,1050,1250,1200]);near(s.balance,1200)});
t("trade stats: no losses -> PF infinite, empty -> zeros",()=>{assert.strictEqual(V.tradeStats([{pnl:5}],0).profitFactor,Infinity);const e=V.tradeStats([],0);assert.strictEqual(e.n,0);assert.strictEqual(e.winRate,0)});
t("prop status static",()=>{const p=V.propStatus([{pnl:-3000,date:"2026-11-16"}],{acct:100000,maxDD:10,dailyDD:5,trailing:false,target:8},"2026-11-16");
  near(p.dailyUsed,0.6);near(p.balance,97000);near(p.floor,90000);near(p.maxUsed,0.3);near(p.targetLeft,11000)});
t("prop status trailing",()=>{const p=V.propStatus([{pnl:5000,date:"2026-11-15"},{pnl:-3000,date:"2026-11-16"}],{acct:100000,maxDD:10,dailyDD:5,trailing:true,target:8},"2026-11-16");
  near(p.peak,105000);near(p.floor,95000);near(p.maxUsed,0.3);near(p.dailyUsed,0.6)});
t("prop status trailing locks at start balance",()=>{const p=V.propStatus([{pnl:15000,date:"2026-11-15"}],{acct:100000,maxDD:10,dailyDD:5,trailing:true,target:8},"2026-11-16");near(p.floor,100000)});
module.exports={block,ctx,t,near};
if(require.main===module){for(const f of fs.readdirSync(__dirname).filter(f=>/^logic_.*\.js$/.test(f)))require("./"+f);console.log("LOGIC OK")}
