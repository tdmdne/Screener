const {launch}=require("./harness");const assert=require("assert");
(async()=>{const h=await launch();const P=h.page;await P.goto(h.base);await P.waitForTimeout(3000);
await P.evaluate(()=>openChart("BTCUSDT","1H"));await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]&&!PEND["BTCUSDT|1H"]);await P.waitForTimeout(1500);
const r=await P.evaluate(async()=>{const c0=ch;S.alerts=[{id:1,sym:"ETHUSDT",price:101.5,dir:"above",on:true,fired:false}];
vtOnServerAlert({type:"alert",id:"1",sym:"ETHUSDT",condition:"cross_up 101.5",price:102,triggeredAt:Date.now()}); // hub alert frame handler (alerts are never evaluated in the browser)
const fired=S.alerts[0].fired,msg=document.getElementById("msg").textContent;
await new Promise(r=>setTimeout(r,2000));return{fired,msg,sameChart:ch===c0&&!!ch,toastOk:(()=>{try{toast("x");return true}catch(e){return false}})()}});
console.log(JSON.stringify(r));assert(r.fired&&/ETHUSDT crossed above/.test(r.msg)&&r.sameChart&&r.toastOk);
await P.evaluate(()=>goHome());await P.waitForTimeout(300);
console.log("errors",h.errors,"console",h.consoleErr);assert(!h.errors.length&&!h.consoleErr.length);await h.close();console.log("RELIABILITY OK")})().catch(e=>{console.error(e);process.exit(1)});
