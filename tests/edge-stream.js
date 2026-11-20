// Unified edge stream contract, as the browser tests now see it (replaces the removed browser-side BNWS socket):
//  - the page opens exactly one WebSocket, to its own origin at /ws, and says hello (protocol v2)
//  - it makes no request to any non-origin host
//  - quotes frames from the hub move the price the UI shows (no client maths, the server's number is displayed)
//  - status frames drive the #dst badge: LIVE / RECONNECTING / CACHED, through the real socket
const assert=require("assert");const {launch}=require("./harness");
(async()=>{const h=await launch({viewport:{width:1600,height:900}});const P=h.page;
await P.goto(h.app);
await P.waitForFunction(()=>typeof BOOTED!=="undefined"&&BOOTED&&SYMS.some(s=>s[0]==="BTCUSDT")&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1&&VT_EDGE.wsReady);
const s0=await P.evaluate(()=>({n:__edge.sockets.length,urls:__edge.sockets.map(w=>w.url),sent:__edge.sent.map(m=>{try{return JSON.parse(m).op}catch(e){return "?"}}),same:VT_EDGE.ws===__edge.sockets[0]}));
assert.strictEqual(s0.n,1,"exactly one socket: "+JSON.stringify(s0.urls));
assert.ok(/^ws:\/\/127\.0\.0\.1:\d+\/ws$/.test(s0.urls[0]),"socket is same-origin /ws: "+s0.urls[0]);
assert.ok(s0.same,"VT_EDGE.ws is that socket");
assert.ok(s0.sent.includes("hello"),"client says hello: "+JSON.stringify(s0.sent));

// quotes frame -> displayed price (the number is the server's; the browser only formats it)
const px=await P.evaluate(async()=>{const before=symOf("BTCUSDT")[2];__edge.quotes([{s:"BTCUSDT",c:before*1.02}]);return{before,after:symOf("BTCUSDT")[2]}});
assert.ok(Math.abs(px.after-px.before*1.02)<1e-9,"quotes frame sets the price: "+JSON.stringify(px));

// provenance frames through the socket (same path the hub uses)
const badge=async()=>P.evaluate(()=>{const d=document.getElementById("dst");return{text:d.textContent,feed:d.dataset.feed||null,title:d.title}});
const got={};
await P.evaluate(()=>__edge.status("LIVE",{binance:"LIVE"}));got.live=await badge();
await P.evaluate(()=>__edge.status("RECONNECTING",{binance:"RECONNECTING"}));got.rec=await badge();
await P.evaluate(()=>__edge.push(__edge.frame("state",{status:{provenance:"CACHED",asOf:Date.now(),feeds:{}}})));got.cached=await badge();
assert.deepStrictEqual([got.live,got.rec,got.cached].map(x=>[x.text,x.feed]),[["Live","LIVE"],["Reconnecting…","RECONNECTING"],["Cached","CACHED"]]);
assert.ok(/binance: reconnecting/.test(got.rec.title),"tooltip names the feed that is down: "+got.rec.title);

// reconnect: server drops the socket, the client opens a new one to the same origin and recovers to LIVE
await P.evaluate(()=>{const w=VT_EDGE.ws;w.close()});
await P.waitForFunction(()=>__edge.sockets.length>=2&&VT_EDGE.ws&&VT_EDGE.ws.readyState===1&&VT_EDGE.ws===__edge.sockets[__edge.sockets.length-1],null,{timeout:30000});
const urls=await P.evaluate(()=>__edge.sockets.map(w=>w.url));
assert.ok(urls.every(u=>u===urls[0]),"every reconnect goes to the same /ws: "+JSON.stringify(urls));

assert.deepStrictEqual(h.offOrigin,[],"no request to any non-origin host");
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("edge-stream: ok");await h.close()})().catch(e=>{console.error(e);process.exit(1)});
