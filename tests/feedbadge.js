// Feed-health badge (#dst) mirrors the backend's /ws status frames: LIVE / DELAYED / RECONNECTING / CACHED.
// Presentation only: the label is the server's own provenance, nothing is computed in the browser.
const assert=require("assert");const {launch}=require("./harness");
(async()=>{const h=await launch({viewport:{width:1600,height:900}});const P=h.page;
await P.goto(h.base);await P.waitForFunction(()=>typeof vtHandleEdgeWsMessage==="function"&&!!document.getElementById("dst"));
const seq=await P.evaluate(()=>{
  window.isLive=()=>true;const d=document.getElementById("dst");const out=[];
  const send=o=>{vtHandleEdgeWsMessage(JSON.stringify(o));out.push({text:d.textContent,feed:d.dataset.feed||null,title:d.title})};
  const t=Date.now();
  send({v:2,seq:1,type:"status",provenance:"RECONNECTING",asOf:t,detail:"Binance reconnecting",feeds:{twelvedata:"LIVE",binance:"RECONNECTING"}});
  send({v:2,seq:2,type:"status",provenance:"LIVE",asOf:t,feeds:{twelvedata:"LIVE",binance:"LIVE"}});
  send({v:2,seq:3,type:"status",provenance:"DELAYED",asOf:t,feeds:{twelvedata:"DELAYED"}});
  send({v:2,seq:4,type:"state",status:{provenance:"CACHED",asOf:t,feeds:{}}});
  return out});
assert.deepStrictEqual(seq.map(x=>[x.text,x.feed]),[["Reconnecting…","RECONNECTING"],["Live","LIVE"],["Delayed","DELAYED"],["Cached","CACHED"]]);
assert.ok(/binance: reconnecting/.test(seq[0].title),"tooltip lists which feed is down: "+seq[0].title);
assert.ok(/twelvedata: live/.test(seq[1].title)&&/binance: live/.test(seq[1].title));
assert.deepStrictEqual(h.errors,[],"no page errors");
console.log("feedbadge: ok");await h.close()})().catch(e=>{console.error(e);process.exit(1)});
