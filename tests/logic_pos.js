// unit tests for the <POS> block (long/short position maths)
const {block,ctx,t,near}=require("./logic");const vm=require("vm");
vm.runInContext(block("POS")+";this.POS={posCalc,posState}",ctx);const P=ctx.POS;
{
t("long: qty, R:R, amounts",()=>{const r=P.posCalc({side:"long",entry:100,tp:110,sl:95,acct:10000,risk:1,ru:"%",lot:1,pv:1,prec:2,tick:0.01});
  near(r.riskAmt,100);near(r.qty,20);near(r.rr,2);near(r.amtTP,10200);near(r.amtSL,9900);near(r.tpPct,10);near(r.slPct,5);near(r.tpTicks,1000);near(r.slTicks,500);near(r.pnlAt(103),60)});
t("short mirrors long",()=>{const r=P.posCalc({side:"short",entry:100,tp:90,sl:105,acct:10000,risk:100,ru:"$",prec:2});
  near(r.qty,20);near(r.rr,2);near(r.amtTP,10200);near(r.amtSL,9900);near(r.pnlAt(97),60);near(r.pnlAt(102),-40)});
t("leverage caps qty; lot size and precision",()=>{near(P.posCalc({side:"long",entry:100,tp:110,sl:95,acct:1000,risk:10,ru:"%",lev:1,prec:2}).qty,10);
  near(P.posCalc({side:"long",entry:100,tp:110,sl:95,acct:10000,risk:1,ru:"%",lot:3,prec:2}).qty,6.66);
  near(P.posCalc({side:"long",entry:100,tp:110,sl:95,acct:10000,risk:1,ru:"%",lot:3,prec:0}).qty,6)});
t("state: open / target / stop / stop-first",()=>{const B=[{t:1,h:101,l:99,c:100},{t:2,h:104,l:98,c:103},{t:3,h:111,l:102,c:110}];
  const a=P.posState(B,"long",100,110,95,1,2);if(a.state!=="open"||a.px!==103)throw Error(JSON.stringify(a));
  const b=P.posState(B,"long",100,110,95,1,9);if(b.state!=="tp"||b.t!==3)throw Error(JSON.stringify(b));
  const c=P.posState([{t:1,h:112,l:94,c:100}],"long",100,110,95,0,9);if(c.state!=="sl")throw Error(JSON.stringify(c));
  const d=P.posState(B,"short",100,90,103.5,1,9);if(d.state!=="sl"||d.t!==2)throw Error(JSON.stringify(d));
  if(P.posState(B,"long",100,110,95,5,9).state!=="none")throw Error("none");
  if(P.posState(B,"long",100,101,99,1,1).state!=="none")throw Error("entry bar must not count")})};
