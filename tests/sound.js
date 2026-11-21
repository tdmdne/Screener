// Alert sound cue: off by default (no audio at all), on for the tab without consent, remembered only with the
// "Optional preferences" consent, deleted on withdrawal; triggered alerts are logged for the session summary.
const {launch}=require("./harness");const assert=require("assert");const fs=require("fs");const path=require("path");
const AXE=fs.readFileSync(path.join(__dirname,"../node_modules/axe-core/axe.min.js"),"utf8");
const axe=async(P,ctx)=>{await P.evaluate(AXE);return P.evaluate(async c=>(await axe.run(c||document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}})).violations.map(v=>v.id+" x"+v.nodes.length+" "+v.nodes[0].target.join(" ")),ctx)};
const ready=async P=>{await P.waitForFunction(()=>BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT"))};
const spy=()=>{window.__osc=0;const A=window.AudioContext;if(A){window.AudioContext=function(){const c=new A();const o=c.createOscillator.bind(c);c.createOscillator=function(){window.__osc++;return o()};return c}}};
// cross an alert level with two ticks from the existing feed handler
const fire=P=>P.evaluate(()=>{const s=symOf("BTCUSDT"),p=s[2],lvl=+(p*1.01).toFixed(4);S.alerts=S.alerts||[];const id=Date.now();S.alerts.push({id,sym:"BTCUSDT",price:lvl,dir:"above",on:true});
  // alerts are evaluated by the hub; it delivers an alert frame
  __edge.push(__edge.frame("alert",{id:String(id),sym:"BTCUSDT",condition:"cross_up",price:p*1.02,triggeredAt:Date.now()}));return lvl});
const st=P=>P.evaluate(()=>({on:VT_PREF.alertSound,saved:localStorage.getItem("vt_prefs"),osc:window.__osc,chimes:window.__vtChimes||0}));
(async()=>{let h=await launch({viewport:{width:1440,height:900}});let P=h.page;await P.addInitScript(spy);await P.goto(h.app);await ready(P);
// 1) default: off, and an alert makes no sound at all
let s=await st(P);assert.deepStrictEqual([s.on,s.saved],[false,null]);
const lvl=await fire(P);await P.waitForTimeout(150);s=await st(P);assert.strictEqual(s.osc,0,"no oscillator when off");
// 2) the alert was logged (sym, level, price, time)
let lg=await P.evaluate(()=>S.alog&&S.alog[S.alog.length-1]);assert(lg&&lg.sym==="BTCUSDT"&&lg.level===lvl&&lg.px>=lvl&&Date.now()-lg.at<5000,JSON.stringify(lg));
// 3) the switch in the Price Alerts dialog; without the preferences consent it lasts for this tab only
await P.evaluate(()=>alertsM());await P.waitForTimeout(150);
assert.strictEqual(await P.isChecked("#snd_on"),false);assert(/^Off/.test(await P.textContent("#snd_note")));
let v=await axe(P,"#modal");assert.deepStrictEqual(v,[],"axe: "+v.join(" | "));
await P.check("#snd_on");await P.waitForTimeout(50);assert(/this tab only/.test(await P.textContent("#snd_note")));
await P.screenshot({path:__dirname+"/../shots/18_alert_sound.png"});
s=await st(P);assert.deepStrictEqual([s.on,s.saved],[true,null],"on, not stored");
await P.click("#snd_test");await P.waitForTimeout(50);assert((await st(P)).osc>=2,"test sound plays");
await P.evaluate(()=>closeM());const o0=(await st(P)).osc;await fire(P);await P.waitForTimeout(150);assert.strictEqual((await st(P)).osc-o0,2,"two-note chime on an alert");
// 4) reload: not remembered
await P.reload();await ready(P);await P.waitForTimeout(100);s=await st(P);assert.deepStrictEqual([s.on,s.saved],[false,null]);
// 5) allow optional preferences -> remembered (and turning it on before consenting is saved once consent is given)
await P.evaluate(()=>{vtSoundSet(true,"low")});assert.strictEqual((await st(P)).saved,null);
await P.evaluate(()=>vtConsentSet(true,"custom",true));s=await st(P);assert.deepStrictEqual(JSON.parse(s.saved),{alertSound:true,alertVol:"low"},"saved after consent");
await P.reload();await ready(P);await P.waitForTimeout(100);s=await st(P);assert.strictEqual(s.on,true,"remembered");
await P.evaluate(()=>alertsM());await P.waitForTimeout(100);assert(/Remembered on this device/.test(await P.textContent("#snd_note")));assert.strictEqual(await P.inputValue("#snd_vol"),"low");await P.evaluate(()=>closeM());
// 6) withdraw -> deleted (still on for this tab), off after reload
await P.evaluate(()=>vtConsentSet(true,"custom",false));s=await st(P);assert.deepStrictEqual([s.on,s.saved],[true,null]);
await P.reload();await ready(P);await P.waitForTimeout(100);assert.strictEqual((await st(P)).on,false);
// 7) banner: the new category is off by default; Accept all turns it on, Reject all turns it off and deletes vt_prefs
await P.evaluate(()=>vtBanner(true));assert.strictEqual(await P.isChecked("#vcb_prefs"),false);v=await axe(P,"#vcb");assert.deepStrictEqual(v,[],"banner axe: "+v.join(" | "));
await P.click("#vcb_acc");let c=await P.evaluate(()=>JSON.parse(localStorage.getItem("vt_consent")));assert.strictEqual(c.prefs,true);
await P.evaluate(()=>vtSoundSet(true));assert((await st(P)).saved);
await P.evaluate(()=>vtBanner(false));await P.click("#vcb_rej");c=await P.evaluate(()=>JSON.parse(localStorage.getItem("vt_consent")));assert.deepStrictEqual([c.cache,c.prefs],[false,false]);assert.strictEqual((await st(P)).saved,null);
// old consent records (no "prefs" field) count as no
await P.evaluate(()=>localStorage.setItem("vt_consent",JSON.stringify({v:"1.0",ts:Date.now(),cache:true,method:"test"})));assert.strictEqual(await P.evaluate(()=>vtPrefsOK()),false);
// 8) the cookie notice lists it
await P.evaluate(()=>go("legal"));await P.evaluate(()=>{location.hash="#/legal/cookies"});await P.waitForTimeout(300);
const t=await P.textContent("#pv-legal");assert(/vt_prefs/.test(t)&&/Optional preferences/.test(t),"cookie notice");
console.log("errors",h.errors);assert.deepStrictEqual(h.errors,[]);assert.deepStrictEqual(h.offOrigin,[],"non-origin requests");await h.close();
console.log("SOUND OK");process.exit(0)})().catch(e=>{console.error(e);process.exit(1)});
