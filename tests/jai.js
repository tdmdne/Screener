// Journal review: local summary (descriptive, nothing sent) and the optional AI review with your own key.
// Checks: no request to any AI host until you tick the disclosure and press Send; exact request shape for OpenAI, Anthropic and a custom
// endpoint (key only in the auth header, no account names, notes only when ticked, the no-advice system prompt); replies shown as plain text
// (HTML in a reply is not rendered) with the AI label and an advice warning; error handling with the local summary as fallback;
// key storage only with Optional preferences + "Remember" (removed when withdrawn, never for guests); legal pages updated; axe; phone.
const assert=require("assert"),fs=require("fs"),path=require("path");const {launch}=require("./harness");
const AXE=fs.readFileSync(path.join(__dirname,"../node_modules/axe-core/axe.min.js"),"utf8");
const axe=async(P,ctx)=>{await P.evaluate(AXE);return P.evaluate(async c=>(await axe.run(c||document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}})).violations.map(v=>v.id+" x"+v.nodes.length+" "+v.nodes[0].target.join(" ")),ctx)};
const ready=P=>P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED);
const seed=()=>{const J=jrCfg();J.accts=[{name:"Secret Prop Co 100k",size:100000,target:8,daily:5,maxdd:10}];J.trades=[];const set=["ORB","Fade","ORB","Pullback"];
  for(let i=0;i<14;i++){const d="2026-11-"+String(2+i).padStart(2,"0");J.trades.push(jrClean({sym:i%3?"ES":"NQ",side:i%4?"long":"short",entry:100,exit:100+((i*7)%5-2),qty:10,pv:5,stop:i%2?98:"",fees:1,open:d+"T09:00",close:d+"T10:00",acct:"Secret Prop Co 100k",setup:set[i%4],tags:i%5===0?"FOMO":"",notes:i===3?"PRIVATE NOTE xyz":""}).t)}save();jrBuild()};
async function aiTab(P){await P.click("#jai_tab_ai");await P.waitForSelector("#jai_send")}
(async()=>{
for(const theme of ["dark","light"]){const h=await launch({viewport:{width:1440,height:900},colorScheme:theme});const P=h.page;
const aiReq=[];P.on("request",r=>{if(/openai\.com|anthropic\.com|llm\.example/.test(r.url()))aiReq.push(r)});
let reply={status:200,body:{choices:[{message:{content:"## Patterns\n- **ORB** trades had the best net result.\n- <img src=x onerror=\"window.__pwn=1\"> shown as text\nQuestions to reflect on:\n1. Are stops recorded on every trade?"}}]}},seen=[];
await P.route(/https:\/\/(api\.openai\.com|api\.anthropic\.com|llm\.example\.com)\//,async route=>{const r=route.request();seen.push({url:r.url(),h:r.headers(),b:r.postData()});
  if(reply.abort)return route.abort();await route.fulfill({status:reply.status,contentType:"application/json",headers:{"access-control-allow-origin":"*"},body:JSON.stringify(reply.body)})});
await P.goto(h.base);await ready(P);await P.evaluate(()=>{location.hash="#/journal"});await P.waitForSelector("#jr_aic");await P.evaluate(seed);await P.waitForTimeout(300);
if(theme==="dark"){
// 1) local summary: descriptive, nothing sent
const loc=await P.evaluate(()=>[...document.querySelectorAll("#jai_p .jail li")].map(l=>l.textContent));
assert(loc.length>=4,"local observations "+loc.length);assert(loc.some(x=>/Net [+\u2212]?\$/.test(x)));assert(loc.every(x=>!/\b(should|recommend|buy|sell|must)\b/i.test(x)),"no advice wording: "+loc.join(" | "));
// 2) AI tab: guards before sending
await aiTab(P);let d=await P.textContent("#jai_disc");assert(/14 closed trades/.test(d)&&/api\.openai\.com/.test(d)&&/Account names aren.t included/.test(d)&&/not financial advice/.test(d),"disclosure "+d);
await P.click("#jai_send");assert(/Enter your API key/.test(await P.textContent("#jai_msg")));
await P.fill("#jai_key","sk-test-123");await P.click("#jai_send");assert(/Tick the box/.test(await P.textContent("#jai_msg")));
assert.strictEqual(aiReq.length,0,"nothing sent before confirm");assert(/Local summary instead|local summary instead/i.test(await P.textContent("#jai_msg")),"fallback shown with errors");
// preview equals what is sent
await P.click(".jaiprev summary");await P.waitForFunction(()=>document.getElementById("jai_json").textContent.length>10);const prev=JSON.parse(await P.textContent("#jai_json"));assert.strictEqual(prev.trades.length,14);assert(!JSON.stringify(prev).includes("Secret Prop"),"no account names");assert(!JSON.stringify(prev).includes("PRIVATE NOTE"),"no notes by default");
// 3) OpenAI send
await P.check("#jai_ack");await P.click("#jai_send");await P.waitForSelector("#jai_out .jaitxt");
let s=seen.pop();assert.strictEqual(s.url,"https://api.openai.com/v1/chat/completions");assert.strictEqual(s.h.authorization,"Bearer sk-test-123");
let b=JSON.parse(s.b);assert.strictEqual(b.model,"gpt-4o-mini");assert(/do not give financial, investment or trading advice/.test(b.messages[0].content));assert(!s.b.includes("Secret Prop")&&!s.b.includes("PRIVATE NOTE"));assert(!s.b.includes("sk-test-123"),"key not in body");
assert(!s.h.cookie,"no cookies sent");
let out=await P.evaluate(()=>({t:document.getElementById("jai_out").textContent,img:document.querySelectorAll("#jai_out img").length,pwn:window.__pwn||0,h4:document.querySelectorAll("#jai_out h4").length,li:document.querySelectorAll("#jai_out li").length,ack:document.getElementById("jai_ack").checked}));
assert(/AI-generated by OpenAI \(gpt-4o-mini\) from 14 trades/.test(out.t)&&/not financial advice/.test(out.t));assert.strictEqual(out.img,0);assert.strictEqual(out.pwn,0);assert(/<img src=x/.test(out.t),"HTML shown as text");assert.strictEqual(out.h4,1);assert(out.li>=3);assert.strictEqual(out.ack,false,"confirmation resets after each send");
await P.screenshot({path:__dirname+"/../shots/23_journal_ai.png"});
// notes only when ticked
await P.check("#jai_notes");await P.check("#jai_ack");reply.body={choices:[{message:{content:"You should buy ES now, it will rise."}}]};await P.click("#jai_send");await P.waitForFunction(()=>/reads like a trading instruction/.test(document.getElementById("jai_out").textContent));
s=seen.pop();assert(s.b.includes("PRIVATE NOTE"),"notes included when ticked");await P.uncheck("#jai_notes");
// 4) errors -> message + local fallback
reply={status:401,body:{error:{message:"bad key"}}};await P.check("#jai_ack");await P.click("#jai_send");await P.waitForFunction(()=>/rejected the key/.test(document.getElementById("jai_msg").textContent));
assert(await P.evaluate(()=>document.querySelectorAll("#jai_msg .jail li").length>=4),"local fallback after error");
reply={abort:true};await P.check("#jai_ack");await P.click("#jai_send");await P.waitForFunction(()=>/Couldn.t reach api\.openai\.com/.test(document.getElementById("jai_msg").textContent));
// 5) Anthropic
reply={status:200,body:{content:[{type:"text",text:"Sample too small? No: 14 trades."}]}};await P.selectOption("#jai_prov","anthropic");assert.strictEqual(await P.inputValue("#jai_key"),"","key not carried across providers");
await P.fill("#jai_key","ak-999");await P.check("#jai_ack");await P.click("#jai_send");await P.waitForSelector("#jai_out .jaitxt");s=seen.pop();
assert.strictEqual(s.url,"https://api.anthropic.com/v1/messages");assert.strictEqual(s.h["x-api-key"],"ak-999");assert.strictEqual(s.h["anthropic-dangerous-direct-browser-access"],"true");assert.strictEqual(s.h["anthropic-version"],"2023-06-01");
b=JSON.parse(s.b);assert(/do not give financial/.test(b.system));assert(/14 trades/.test(await P.textContent("#jai_out")));
// 6) custom endpoint: https only, path /chat/completions
await P.selectOption("#jai_prov","custom");await P.fill("#jai_base","http://llm.example.com/v1");await P.press("#jai_base","Tab");await P.fill("#jai_key","ck-1");await P.fill("#jai_model","my-model");await P.press("#jai_model","Tab");
await P.check("#jai_ack");await P.click("#jai_send");assert(/must use https/.test(await P.textContent("#jai_msg")));
reply={status:200,body:{choices:[{message:{content:"ok"}}]}};await P.fill("#jai_base","https://llm.example.com/v1/");await P.press("#jai_base","Tab");await P.fill("#jai_key","ck-1");await P.check("#jai_ack");await P.click("#jai_send");await P.waitForSelector("#jai_out .jaitxt");
s=seen.pop();assert.strictEqual(s.url,"https://llm.example.com/v1/chat/completions");assert.strictEqual(JSON.parse(s.b).model,"my-model");
// 7) key storage: not without Optional preferences
await P.selectOption("#jai_prov","openai");await P.fill("#jai_key","sk-keep");await P.press("#jai_key","Tab");
assert(await P.isDisabled("#jai_rem"),"remember disabled without prefs consent");assert.strictEqual(await P.evaluate(()=>localStorage.getItem("vt_aikey")),null);
await P.evaluate(()=>vtConsentSet(true,"custom",true));await P.waitForTimeout(200);await P.fill("#jai_key","sk-keep");await P.press("#jai_key","Tab");await P.check("#jai_rem");
assert.deepStrictEqual(await P.evaluate(()=>JSON.parse(localStorage.getItem("vt_aikey"))),{p:"openai",k:"sk-keep"});
await P.reload();await ready(P);await P.waitForSelector("#jr_aic");await aiTab(P);assert.strictEqual(await P.inputValue("#jai_key"),"sk-keep","remembered key restored");
await P.evaluate(()=>vtConsentSet(true,"custom",false));await P.waitForTimeout(200);assert.strictEqual(await P.evaluate(()=>localStorage.getItem("vt_aikey")),null,"withdrawing prefs deletes the key");
await P.reload();await ready(P);await P.waitForSelector("#jr_aic");await aiTab(P);assert.strictEqual(await P.inputValue("#jai_key"),"","key gone after withdrawal");
// 8) legal pages
await P.evaluate(()=>{location.hash="#/legal/privacy"});await P.waitForTimeout(500);let lg=await P.textContent("#pv-legal");assert(/Journal AI review \(optional\)/.test(lg)&&!/No AI or machine learning is used/.test(lg));
await P.evaluate(()=>{location.hash="#/legal/cookies"});await P.waitForTimeout(500);lg=await P.textContent("#pv-legal");assert(/vt_aikey/.test(lg));
await P.evaluate(()=>{location.hash="#/legal/data"});await P.waitForTimeout(500);lg=await P.textContent("#pv-legal");assert(/Journal AI review/.test(lg)&&/api\.anthropic\.com/.test(lg)&&!/nothing is sent to any AI service/.test(lg));
await P.evaluate(()=>{location.hash="#/journal"});await P.waitForSelector("#jr_aic");await aiTab(P);
}else{await aiTab(P)}
await P.waitForTimeout(600);let v=await axe(P,"#jr_aic");assert.deepStrictEqual(v,[],theme+" AI card axe: "+v.join(" | "));
await P.click("#jai_tab_local");await P.waitForTimeout(400);v=await axe(P,"#jr_aic");assert.deepStrictEqual(v,[],theme+" local card axe: "+v.join(" | "));
console.log(theme,"errors",h.errors);assert.deepStrictEqual(h.errors,[]);await h.close()}
// guest: never stored
{const h=await launch({viewport:{width:1440,height:900}});const P=h.page;await P.goto(h.base);await ready(P);
 const g=await P.evaluate(()=>typeof vtIsGuest==="function");if(g){await P.evaluate(()=>{vtConsentSet(true,"custom",true);window.VT_GUEST_TEST=1});
 const can=await P.evaluate(()=>{try{VT_GUEST=true}catch(e){return false}return true});if(can){await P.evaluate(()=>{location.hash="#/journal"});await P.waitForSelector("#jr_aic");await P.evaluate(seed);await aiTab(P);
  await P.fill("#jai_key","sk-g");await P.press("#jai_key","Tab");assert(await P.isDisabled("#jai_rem"),"guests can't remember keys");assert.strictEqual(await P.evaluate(()=>jaiRemember(true)),false)}}
 await h.close()}
// phone
{const h=await launch({viewport:{width:390,height:844},mobile:true});const P=h.page;await P.goto(h.base);await ready(P);await P.evaluate(()=>{location.hash="#/journal"});await P.waitForSelector("#jr_aic");await P.evaluate(seed);
 await aiTab(P);await P.evaluate(()=>document.getElementById("jr_aic").scrollIntoView());await P.waitForTimeout(300);
 const ph=await P.evaluate(()=>{const W=document.documentElement.clientWidth;const small=[...document.querySelectorAll("#jr_aic button,#jr_aic select,#jr_aic input,#jr_aic summary")].filter(e=>e.offsetParent).map(e=>{const r=e.getBoundingClientRect();return[e.id||e.className||e.tagName,Math.round(r.width),Math.round(r.height)]}).filter(x=>(x[1]<43.5||x[2]<43.5)&&!/^jai_(rem|notes|ack)$/.test(x[0]));return{sw:document.documentElement.scrollWidth,W,small}});
 assert(ph.sw<=ph.W);assert.deepStrictEqual(ph.small,[],"phone targets");await P.screenshot({path:__dirname+"/../shots/m/qa_390_journal_ai.png"});assert.deepStrictEqual(h.errors,[]);await h.close()}
console.log("JAI OK")})().catch(e=>{console.error(e);process.exit(1)});
