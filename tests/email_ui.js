// TASK-05 sign-in email validation: disallowed characters flag the field instantly and block submit;
// valid emails and plain usernames sign in exactly as before.
const {launch}=require("./harness");const assert=require("assert");
const locked=P=>P.evaluate(()=>document.documentElement.classList.contains("locked"));
const state=P=>P.evaluate(()=>({err:document.getElementById("auErr").textContent,inv:document.getElementById("auId").getAttribute("aria-invalid"),
  ls:localStorage.getItem("scr2a"),ss:sessionStorage.getItem("scr2a"),btn:document.getElementById("auBtn").textContent}));
const open=async()=>{const h=await launch({auth:false,d1:true});await h.page.goto(h.base+"#/login");await h.page.waitForSelector("#auId",{state:"visible"});assert(await locked(h.page));return h};
(async()=>{
// 1) invalid characters: instant error + aria-invalid, submit blocked, existing handler never runs
let h=await open();let P=h.page;
await P.click("#auId");await P.keyboard.type("bad<x@y.com");
let s=await state(P);assert(/character/i.test(s.err),"instant error: "+JSON.stringify(s));assert.strictEqual(s.inv,"true");
assert.strictEqual(await P.evaluate(()=>document.getElementById("auErr").children.length),0,"error is plain text");
await P.fill("#auPw","x");await P.click("#auBtn");await P.waitForTimeout(700);
s=await state(P);assert(await locked(P),"still on sign-in");assert.strictEqual(s.ls,null);assert.strictEqual(s.ss,null);
assert.strictEqual(s.btn,"Sign in","existing handler did not start signing in");assert(/character/i.test(s.err),"error shown after submit: "+s.err);assert.strictEqual(s.inv,"true");
assert.strictEqual(await P.evaluate(()=>document.activeElement.id),"auId","focus returned to the email field");
// Enter key is blocked too
await P.focus("#auPw");await P.keyboard.press("Enter");await P.waitForTimeout(700);assert(await locked(P));assert.strictEqual((await state(P)).ss,null);
// structural problem (passes the old loose regex): a@b.c
await P.fill("#auId","a@b.c");await P.click("#auBtn");await P.waitForTimeout(700);
s=await state(P);assert(await locked(P)&&s.ss===null,"a@b.c blocked");assert(/two letters/.test(s.err),s.err);assert.strictEqual(s.inv,"true");
// fixing the address clears the error instantly
await P.fill("#auId","ann@example.com");s=await state(P);assert.strictEqual(s.err,"");assert.strictEqual(s.inv,null);
// 2) the now-valid email signs in as before
await P.click("#auBtn");await P.waitForFunction(()=>!document.documentElement.classList.contains("locked"));
assert.strictEqual(await P.evaluate(()=>sessionStorage.getItem("scr2a")),JSON.stringify({id:"ann@example.com"}));
console.log("errors",h.errors,"console",h.consoleErr);assert.deepStrictEqual(h.errors,[]);assert.deepStrictEqual(h.consoleErr,[]);await h.close();
// 3) a valid email typed fresh signs in (case preserved, trimmed)
h=await open();P=h.page;await P.fill("#auId","  Ann.B+x@Ex-ample.co.uk ");s=await state(P);assert.strictEqual(s.err,"");
await P.fill("#auPw","x");await P.click("#auBtn");await P.waitForFunction(()=>!document.documentElement.classList.contains("locked"));
assert.strictEqual(await P.evaluate(()=>sessionStorage.getItem("scr2a")),JSON.stringify({id:"Ann.B+x@Ex-ample.co.uk"}));
console.log("errors",h.errors,"console",h.consoleErr);assert.deepStrictEqual(h.errors,[]);assert.deepStrictEqual(h.consoleErr,[]);await h.close();
// 4) gated D1 sign-in is email-only: a plain username (no "@") is refused with a message, nothing is sent and no session is created
h=await open();P=h.page;await P.fill("#auId","trader_01 #main");s=await state(P);assert.strictEqual(s.err,"");assert.strictEqual(s.inv,null);
await P.fill("#auPw","x");await P.click("#auBtn");await P.waitForTimeout(700);
s=await state(P);assert(await locked(P),"plain username does not sign in");assert.strictEqual(s.ss,null);assert.strictEqual(s.ls,null);assert(s.err.length>0,"a message explains why");
assert(!h.d1.calls.some(c=>/^POST \/api\/auth\/login/.test(c)),"no login request for a non-email id");
console.log("errors",h.errors,"console",h.consoleErr);assert.deepStrictEqual(h.errors,[]);assert.deepStrictEqual(h.consoleErr,[]);await h.close();
// 5) an empty form gets the email-only prompt from the gated sign-in handler
h=await open();P=h.page;await P.click("#auBtn");assert(/Enter your email address/.test((await state(P)).err));await h.close();
console.log("EMAIL UI OK")})().catch(e=>{console.error(e);process.exit(1)});
