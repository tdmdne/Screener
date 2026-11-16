// Long/Short position tools: click-to-place with default R:R, exact labels (R:R, qty, amounts, open/closed P&L) for long and short,
// handle drags (target, stop, entry, width), settings dialog (inputs + style, instant save, remembered defaults, cancel restores),
// right-click menu (settings, clone, lock, hide, delete), axis tags; then touch: 22px handle radius, bottom-sheet settings.
const {launch}=require("./harness");const assert=require("assert");
const money=v=>(v<0?"\u2212":"")+Math.abs(v).toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2});
async function setup(opts){const h=await launch(opts);const P=h.page;await P.goto(h.base);
await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"));await P.evaluate(()=>{S.dr={};S.posDef={};save();openChart("BTCUSDT","1H");go("chart")});
await P.waitForFunction(()=>ch&&LIVE["BTCUSDT|1H"]);await P.waitForTimeout(1200);
await P.evaluate(()=>scrollTo(0,0));await P.locator("#cv").scrollIntoViewIfNeeded();await P.waitForTimeout(200);const box=await P.locator("#cv").boundingBox();const pw=await P.evaluate(()=>ch.timeScale().width());return{h,P,box,pw}}
const lbl=(P,id)=>P.evaluate(id=>window.__posLbl[id],id);
const geo=(P,id)=>P.evaluate(id=>{const d=DL().find(x=>x.id===id);const g=posGeo(d);return{...g,p:d.p.map(q=>({t:q.t,y:q.y}))}},id);
(async()=>{let {h,P,box,pw}=await setup();
// 1) click to place a long in the future (no bars yet -> no P&L), default R:R 2
await P.evaluate(()=>setTool("long"));await P.mouse.click(box.x+pw*0.8,box.y+box.height*0.5);await P.waitForTimeout(250);
let d=await P.evaluate(()=>{const d=DL()[0];return{id:d.id,t:d.t,p:d.p,sel:SELD===d,tool:TOOL}});
assert.strictEqual(d.t,"long");assert(d.sel&&d.tool==="cross");const E=d.p[0].y,T=d.p[1].y,Sl=d.p[2].y;
assert(T>E&&Sl<E,"long: target above, stop below");assert(Math.abs((T-E)/(E-Sl)-2)<0.02,"default R:R 2");
let L=await lbl(P,d.id);const qty=Math.floor(100/(E-Sl)*100+1e-9)/100;
assert.strictEqual(L.top,`Target: ${await P.evaluate(v=>fp(v),T)} (${((T-E)/E*100).toFixed(2)}%) ${Math.round((T-E)/0.01)}, Amount: ${money(10000+(T-E)*qty)}`);
assert.strictEqual(L.bot,`Stop: ${await P.evaluate(v=>fp(v),Sl)} (${((E-Sl)/E*100).toFixed(2)}%) ${Math.round((E-Sl)/0.01)}, Amount: ${money(10000-(E-Sl)*qty)}`);
assert.strictEqual(L.mid,`Qty: ${qty.toFixed(2)} | Risk/Reward Ratio: ${((T-E)/(E-Sl)).toFixed(2)}`);console.log("long labels ok",L.mid);
// 2) drag handles: target up, stop down, width right, entry
let g=await geo(P,d.id);const drag=async(x,y,dx,dy)=>{await P.mouse.move(box.x+x,box.y+y);await P.mouse.down();await P.mouse.move(box.x+x+dx,box.y+y+dy,{steps:5});await P.mouse.up();await P.waitForTimeout(150)};
await drag(g.xL,g.yT,0,-30);let g2=await geo(P,d.id);assert(g2.p[1].y>g.p[1].y&&Math.abs(g2.yT-(g.yT-30))<=2,"target dragged");
await drag(g2.xL,g2.yS,0,20);let g3=await geo(P,d.id);assert(g3.p[2].y<g2.p[2].y,"stop dragged");
await drag(g3.xR,g3.yE,60,0);let g4=await geo(P,d.id);assert(g4.p[1].t>g3.p[1].t&&g4.p[2].t===g4.p[1].t&&Math.abs(g4.xR-(g3.xR+60))<=8,"width dragged");
await drag(g4.xL,g4.yE,0,-10);let g5=await geo(P,d.id);assert(g5.p[0].y>g4.p[0].y&&g5.p[0].y<g5.p[1].y,"entry dragged");
const rrNow=(g5.p[1].y-g5.p[0].y)/(g5.p[0].y-g5.p[2].y);assert((await lbl(P,d.id)).mid.endsWith(rrNow.toFixed(2)));
assert.strictEqual(await P.evaluate(()=>S.posDef.rr),+rrNow.toFixed(2),"last R:R remembered");
assert.strictEqual(JSON.parse(await P.evaluate(()=>localStorage.getItem("scr2"))).dr.BTCUSDT[0].p[1].y,g5.p[1].y,"saved");
// 3) settings dialog: exact prices, risk in money, qty precision 0, style; instant save + defaults; Cancel restores
await P.mouse.dblclick(box.x+(g5.xL+g5.xR)/2,box.y+(g5.yE+g5.yT)/2);await P.waitForSelector("#ps_acct");
await P.fill("#ps_en","100");await P.fill("#ps_tp","112");await P.fill("#ps_sl","96");await P.fill("#ps_acct","50000");await P.selectOption("#ps_ru","$");await P.fill("#ps_risk","400");await P.selectOption("#ps_prec","0");
await P.waitForTimeout(400);
let dd=await P.evaluate(id=>{const d=DL().find(x=>x.id===id);return{p:d.p.map(q=>q.y),acct:d.acct,ru:d.ru,risk:d.risk,prec:d.prec,saved:JSON.parse(localStorage.getItem("scr2")).dr.BTCUSDT[0].acct,def:S.posDef}},d.id);
assert.deepStrictEqual(dd.p,[100,112,96]);assert.strictEqual(dd.saved,50000,"instant save");assert.strictEqual(dd.def.risk,400);assert.strictEqual(dd.def.ru,"$");
assert.strictEqual(await P.inputValue("#ps_tpk"),"1200");await P.fill("#ps_slk","300");await P.waitForTimeout(100);assert.strictEqual(await P.inputValue("#ps_sl"),"97");
await P.click('.tabs button[data-t="style"]');await P.selectOption("#ps_op","0.3");await P.click("#ps_ok");await P.waitForTimeout(150);
L=await lbl(P,d.id);assert.strictEqual(L.mid,"Qty: 133 | Risk/Reward Ratio: 4.00");assert.strictEqual(L.top,"Target: 112.00 (12.00%) 1200, Amount: "+money(50000+12*133));assert.strictEqual(L.bot,"Stop: 97.00 (3.00%) 300, Amount: "+money(50000-3*133));
await P.mouse.dblclick(box.x+(g5.xL+g5.xR)/2,box.y+(await geo(P,d.id)).yE-8);await P.waitForSelector("#ps_acct");await P.fill("#ps_acct","1");await P.click("#ps_cancel");
assert.strictEqual(await P.evaluate(id=>DL().find(x=>x.id===id).acct,d.id),50000,"cancel restores");
// 4) short in the past that hits its target: closed P&L, exact numbers; new tool uses remembered defaults ($400 risk, precision 0)
const sh=await P.evaluate(()=>{const B=posBars(),i=B.length-60;let lo=Infinity;for(let k=i+1;k<=i+20;k++)lo=Math.min(lo,B[k].l);
  const E=B[i].c,Tg=+(Math.max(lo,E*0.9)+0.001).toFixed(2),Sx=+(Math.max(...B.slice(i+1,i+21).map(b=>b.h))+5).toFixed(2);
  setTool("short");const x=ch.timeScale().logicalToCoordinate(i),y=MS.priceToCoordinate(E);const d=posPlace("short",x,y);d.p[0]={t:B[i].t,y:E};d.p[1]={t:B[i+20].t,y:Tg};d.p[2]={t:B[i+20].t,y:Sx};save();
  return{id:d.id,E,Tg,Sx,def:{risk:d.risk,acct:d.acct},st:posState1(d)}});
await P.waitForTimeout(200);L=await lbl(P,sh.id);console.log("short",JSON.stringify(sh.st),L.mid);
const q2=Math.floor(400/(sh.Sx-sh.E)+1e-9);assert.strictEqual(sh.st.state,"tp");
assert.strictEqual(L.mid,`Closed P&L: ${money((sh.E-sh.Tg)*q2)}, Qty: ${q2} | Risk/Reward Ratio: ${((sh.E-sh.Tg)/(sh.Sx-sh.E)).toFixed(2)}`);
// 5) right-click menu: clone, lock (drag ignored), hide + show, delete
const gs=await geo(P,sh.id);await P.mouse.click(box.x+(gs.xL+gs.xR)/2,box.y+(gs.yE+gs.yT)/2,{button:"right"});await P.waitForSelector("#cv .vpmenu");
const items=await P.$$eval("#cv .vpmenu [role=menuitem]",e=>e.map(x=>x.textContent));console.log("menu",items);assert.deepStrictEqual(items.slice(0,5),["Settings\u2026","Clone","Lock","Hide","Delete"]);
await P.click("#cv .vpmenu >> text=Clone");assert.strictEqual(await P.evaluate(()=>DL().length),3);
await P.evaluate(()=>{SELD.lock=true});const before=await P.evaluate(()=>JSON.stringify(SELD.p));const gc=await P.evaluate(()=>posGeo(SELD));await drag(gc.xL,gc.yT,0,-25);assert.strictEqual(await P.evaluate(()=>JSON.stringify(SELD.p)),before,"locked");
await P.mouse.click(box.x+(gc.xL+gc.xR)/2,box.y+(gc.yE+gc.yT)/2,{button:"right"});await P.click("#cv .vpmenu >> text=Hide");assert.strictEqual(await P.evaluate(()=>DL().filter(d=>d.hide).length),1);
await P.mouse.click(box.x+40,box.y+40,{button:"right"});await P.click("#cv .vpmenu >> text=Show hidden drawings");assert.strictEqual(await P.evaluate(()=>DL().filter(d=>d.hide).length),0);
await P.mouse.click(box.x+(gc.xL+gc.xR)/2,box.y+(gc.yE+gc.yT)/2,{button:"right"});await P.click("#cv .vpmenu >> text=Delete");assert.strictEqual(await P.evaluate(()=>DL().length),2);
// 6) axis tags + "after" screenshot with the long selected
await P.evaluate(id=>{SELD=DL().find(x=>x.id===id);dpe();dsel()},d.id);await P.mouse.move(box.x+10,box.y+10);await P.waitForTimeout(300);
const tagPx=await P.evaluate(()=>{const c=document.getElementById("dc"),r=devicePixelRatio,y=MS.priceToCoordinate(SELD.p[1].y),x=ch.timeScale().width()+20;return Array.from(c.getContext("2d").getImageData(x*r,y*r,1,1).data)});
assert(tagPx[3]>200&&tagPx[1]>tagPx[0],"green target tag on the scale "+tagPx);
await P.screenshot({path:"shots/pos_tool_after.png"});
console.log("errors",h.errors,"console",h.consoleErr);assert(!h.errors.length&&!h.consoleErr.length);await h.close();
// 7) touch (390x844): place by tap, 22px handle radius, settings as a bottom sheet
({h,P,box,pw}=await setup({viewport:{width:390,height:844},mobile:true}));
await P.tap('.tbar button[data-tool="short"]');await P.locator("#cv").scrollIntoViewIfNeeded();box=await P.locator("#cv").boundingBox();await P.touchscreen.tap(box.x+pw*0.5,box.y+box.height*0.5);await P.waitForTimeout(250);
const m=await P.evaluate(()=>{const d=DL()[0];return{id:d.id,t:d.t,g:posGeo(d),p:d.p.map(q=>q.y)}});assert.strictEqual(m.t,"short");
const cdp=await P.context().newCDPSession(P);const touch=(type,pts)=>cdp.send("Input.dispatchTouchEvent",{type,touchPoints:pts.map(([x,y],i)=>({x,y,id:i}))});
const sx=box.x+m.g.xL+15,sy=box.y+m.g.yT+12;await touch("touchStart",[[sx,sy]]);for(let i=1;i<=5;i++){await touch("touchMove",[[sx,sy+i*6]]);await P.waitForTimeout(16)}await touch("touchEnd",[]);await P.waitForTimeout(200);
const m2=await P.evaluate(id=>DL().find(x=>x.id===id).p.map(q=>q.y),m.id);console.log("touch target drag",m.p[1],"->",m2[1]);assert(m2[1]<m.p[1]&&m2[0]===m.p[0],"target moved by a touch 19px from the handle");
await P.screenshot({path:"shots/m/390_position.png"});
await P.evaluate(()=>drawSetM());await P.waitForSelector("#ps_acct");await P.waitForTimeout(350);
const sheet=await P.evaluate(()=>{const b=document.querySelector(".ov .box").getBoundingClientRect();return[Math.round(b.bottom),Math.round(b.width)]});assert(Math.abs(sheet[0]-844)<=1&&sheet[1]>=388,"bottom sheet "+sheet);
await P.screenshot({path:"shots/m/390_position_settings.png"});
console.log("errors",h.errors,"console",h.consoleErr);assert(!h.errors.length&&!h.consoleErr.length);await h.close();console.log("POSTOOL OK")})().catch(e=>{console.error(e);process.exit(1)});
