/* ---------- Journal review: local summary + optional AI review with your own API key ----------
   Local summary: rule-based observations computed in the browser; nothing leaves the device.
   AI review (off until you use it): only when you press "Send to <provider>" after ticking the disclosure. The request goes straight
   from your browser to the provider you chose, with your key. Vektor has no server in the middle and never sees the key or the data.
   The key stays in memory for this tab unless you tick "Remember", which needs the Optional preferences choice (vt_aikey). */
/* the remembered key is per signed-in user: vt_aikey~<user hash> */
function jaiKeyName(){return(typeof vtSK==="function"&&vtSK("vt_aikey"))||"vt_aikey"}
const JAI_PROV={openai:{name:"OpenAI",host:"api.openai.com",url:"https://api.openai.com/v1/chat/completions",model:"gpt-4o-mini",terms:"https://openai.com/policies/"},
  anthropic:{name:"Anthropic",host:"api.anthropic.com",url:"https://api.anthropic.com/v1/messages",model:"claude-3-5-haiku-latest",terms:"https://www.anthropic.com/legal"},
  custom:{name:"OpenAI-compatible endpoint",host:"",url:"",model:"",terms:""}};
const JAI={key:"",busy:false,out:null,err:"",mode:"local",ack:false,ctl:null};
function jaiCfg(){const J=jrCfg();if(!J.ai||typeof J.ai!=="object")J.ai={};const A=J.ai;if(!JAI_PROV[A.prov])A.prov="openai";if(typeof A.model!=="string")A.model="";if(typeof A.base!=="string")A.base="";A.notes=!!A.notes;return A}
function jaiStoredKey(){if(typeof vtPrefsOK!=="function"||!vtPrefsOK()||(typeof vtIsGuest==="function"&&vtIsGuest()))return null;try{const o=JSON.parse(localStorage.getItem(jaiKeyName())||"null");return o&&typeof o.k==="string"?o:null}catch(e){return null}}
function jaiForget(){JAI.key="";try{localStorage.removeItem(jaiKeyName())}catch(e){}}
function jaiRemember(on){if(!on){try{localStorage.removeItem(jaiKeyName())}catch(e){}return false}if(typeof vtPrefsOK!=="function"||!vtPrefsOK()||(typeof vtIsGuest==="function"&&vtIsGuest())||!JAI.key)return false;
  try{localStorage.setItem(jaiKeyName(),JSON.stringify({p:jaiCfg().prov,k:JAI.key}));return true}catch(e){return false}}
/* the provider endpoint for the current settings, or an error message */
function jaiEndpoint(){const A=jaiCfg(),P=JAI_PROV[A.prov];if(A.prov!=="custom")return{url:P.url,host:P.host};
  let u;try{u=new URL(A.base.trim())}catch(e){return{err:"Enter the endpoint\u2019s base URL, e.g. https://example.com/v1"}}
  const local=/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);if(u.protocol!=="https:"&&!(u.protocol==="http:"&&local))return{err:"The endpoint must use https:// (http:// only for localhost)"};
  if(u.username||u.password)return{err:"Don\u2019t put credentials in the URL; use the API key field"};
  return{url:u.origin+u.pathname.replace(/\/+$/,"")+"/chat/completions",host:u.host}}
/* ---- what gets sent: aggregated stats plus the most recent closed trades (no account names, notes only if you tick it) */
const JAI_MAX_TRADES=200;
function jaiPayload(T,st){const A=jaiCfg(),f=jrCfg().f,C=jrClosed(T).slice(-JAI_MAX_TRADES);const r2=v=>v==null||!isFinite(v)?null:Math.round(v*100)/100;
  const wd=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return{period:{filter:f.period,side:f.side||"both",setup:f.setup||"all",account_filtered:!!f.acct,from:C.length?jrDay(C[0]):null,to:C.length?jrDay(C[C.length-1]):null},
    summary:{closed_trades:st.n,net_pnl:r2(st.net),win_rate:r2(st.winRate),profit_factor:st.pf===Infinity?"no losses":r2(st.pf),expectancy:r2(st.exp),avg_win:r2(st.avgWin),avg_loss:r2(st.avgLoss),avg_r:r2(st.avgR),trades_with_stop:st.nR,max_drawdown:r2(st.maxDD),longest_win_streak:st.winStreak,longest_loss_streak:st.lossStreak},
    by_setup:Object.entries(st.bySetup).map(([k,b])=>({setup:k,trades:b.n,net:r2(b.net),win_rate:r2(b.wins/b.n),avg_r:b.nR?r2(b.sumR/b.nR):null})),
    by_weekday:st.byWeekday.map((b,i)=>({day:wd[i],trades:b.n,net:r2(b.net)})).filter(x=>x.trades),
    by_side:{long:{trades:st.bySide.long.n,net:r2(st.bySide.long.net)},short:{trades:st.bySide.short.n,net:r2(st.bySide.short.net)}},
    trades:C.map(t=>{const o={closed:t.close,symbol:t.sym,side:t.side,pnl:r2(jrPnl(t)),r:r2(jrR(t)),setup:t.setup||null,tags:t.tags||null};if(t.open)o.opened=t.open;if(A.notes&&t.notes)o.notes=t.notes.slice(0,500);return o}),
    trades_included:C.length,trades_total_in_view:st.n}}
const JAI_SYS="You review a trader's own journal data to describe patterns in their trading process. Strict rules: do not give financial, investment or trading advice; "+
  "do not recommend buying, selling or holding anything, entries, exits, position sizes or leverage; do not predict prices or markets; do not name instruments to trade. "+
  "Describe only what the data shows (results by setup, weekday, side and tags, streaks, losses compared with wins, missing stops, data gaps), and end with up to three neutral questions the trader could reflect on about their own process and record-keeping. "+
  "If there are fewer than 10 closed trades, say the sample is too small to show reliable patterns. Plain British English, under 250 words, short headings and bullet points, no tables, no markdown links.";
function jaiRequest(payload){const A=jaiCfg(),ep=jaiEndpoint();if(ep.err)throw new Error(ep.err);const model=(A.model||JAI_PROV[A.prov].model||"").trim();if(!model)throw new Error("Enter a model name");
  const user="Here is my trading journal summary as JSON. Describe the patterns as instructed.\n"+JSON.stringify(payload);
  if(A.prov==="anthropic")return{url:ep.url,host:ep.host,model,init:{method:"POST",headers:{"content-type":"application/json","x-api-key":JAI.key,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body:JSON.stringify({model,max_tokens:800,temperature:0.2,system:JAI_SYS,messages:[{role:"user",content:user}]})}};
  return{url:ep.url,host:ep.host,model,init:{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+JAI.key},body:JSON.stringify({model,temperature:0.2,max_tokens:800,messages:[{role:"system",content:JAI_SYS},{role:"user",content:user}]})}}}
function jaiText(j,prov){try{if(prov==="anthropic")return(j.content||[]).filter(c=>c&&c.type==="text").map(c=>c.text).join("\n").trim();const c=j.choices&&j.choices[0];const m=c&&c.message&&c.message.content;return typeof m==="string"?m.trim():Array.isArray(m)?m.map(x=>x&&x.text||"").join("\n").trim():""}catch(e){return""}}
async function jaiSend(T,st){if(JAI.busy)return;const A=jaiCfg();JAI.err="";JAI.out=null;
  if(!JAI.key){JAI.err="Enter your API key first.";jaiCardRender();return}if(!JAI.ack){JAI.err="Tick the box to confirm you want to send this data.";jaiCardRender();return}
  let rq;try{rq=jaiRequest(jaiPayload(T,st))}catch(e){JAI.err=e.message;jaiCardRender();return}
  JAI.busy=true;JAI.ctl=new AbortController();const to=setTimeout(()=>JAI.ctl&&JAI.ctl.abort(),60000);jaiCardRender();
  try{const res=await fetch(rq.url,Object.assign({},rq.init,{signal:JAI.ctl.signal,credentials:"omit",referrerPolicy:"no-referrer",cache:"no-store"}));let j=null;try{j=await res.json()}catch(e){}
    if(!res.ok){const m=j&&(j.error&&(j.error.message||j.error.type)||j.message)||"";throw new Error(res.status===401||res.status===403?"The provider rejected the key ("+res.status+"). Check it and try again.":res.status===429?"The provider says you\u2019ve hit a rate or spending limit (429).":res.status===404?"The provider couldn\u2019t find that model or endpoint (404). Check the model name.":"The provider returned an error ("+res.status+")"+(m?": "+String(m).slice(0,200):"."))}
    const txt=jaiText(j,A.prov);if(!txt)throw new Error("The provider sent back no text.");
    JAI.out={text:txt.slice(0,6000),prov:JAI_PROV[A.prov].name,host:rq.host,model:rq.model,at:new Date(),n:(jrClosed(T).slice(-JAI_MAX_TRADES)).length}}
  catch(e){JAI.err=e.name==="AbortError"?"The request was cancelled or took longer than 60 seconds.":e instanceof TypeError?"Couldn\u2019t reach "+rq.host+". The network, an ad blocker or the provider\u2019s browser (CORS) rules may be blocking it.":e.message}
  finally{clearTimeout(to);JAI.busy=false;JAI.ctl=null;JAI.ack=false;jaiCardRender()}}
/* ---- local, rule-based observations (descriptive only) */
function jaiLocal(T,st){const o=[];const n=st.n;if(!n)return["No closed trades in this view yet. Observations appear once trades are logged with a close date and exit or P\u0026L."];
  const $=v=>jrUsd(v);if(n<10)o.push("Small sample: "+n+" closed trade"+(n===1?"":"s")+". Patterns below can change a lot with more trades.");
  o.push("Net "+$(st.net)+" over "+n+" closed trades; "+jrPct(st.winRate)+" winners, profit factor "+jrFx(st.pf)+".");
  if(st.avgWin!=null&&st.avgLoss!=null)o.push("The average win ("+jrAbs(st.avgWin)+") is "+(st.avgWin/Math.abs(st.avgLoss)).toFixed(2)+"\u00d7 the average loss ("+jrAbs(st.avgLoss)+").");
  const S=Object.entries(st.bySetup).filter(([k,b])=>b.n>=3&&k!=="(no setup)").sort((a,b)=>b[1].net-a[1].net);
  if(S.length>=2){const [bn,bb]=S[0],[wn,wb]=S[S.length-1];if(bb.net!==wb.net)o.push("By setup (3+ trades): \u201c"+bn+"\u201d has the highest net ("+$(bb.net)+", "+bb.n+" trades) and \u201c"+wn+"\u201d the lowest ("+$(wb.net)+", "+wb.n+" trades).")}
  const ns=st.bySetup["(no setup)"];if(ns&&ns.n/n>=.3)o.push(Math.round(ns.n/n*100)+"% of trades have no setup tag, so the setup breakdown covers only part of the record.");
  const W=st.byWeekday.map((b,i)=>({i,...b})).filter(b=>b.n>=3).sort((a,b)=>a.net-b.net),wd=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  if(W.length>=2&&W[0].net<0)o.push(wd[W[0].i]+" has the lowest result ("+$(W[0].net)+" over "+W[0].n+" trades).");
  const L=st.bySide.long,Sh=st.bySide.short;if(L.n>=3&&Sh.n>=3)o.push("Long trades: "+$(L.net)+" ("+L.n+"); short trades: "+$(Sh.net)+" ("+Sh.n+").");
  const nostop=n-st.nR;if(nostop/n>=.3)o.push(nostop+" of "+n+" trades have no stop recorded, so R-multiples cover only "+st.nR+" trades.");
  if(st.lossStreak>=3)o.push("Longest run of losses: "+st.lossStreak+" in a row. Longest run of wins: "+st.winStreak+".");
  const tag={};jrClosed(T).forEach(t=>{const p=jrPnl(t);(t.tags||"").split(",").map(x=>x.trim()).filter(Boolean).forEach(g=>{const b=tag[g]||(tag[g]={n:0,net:0});b.n++;b.net+=p})});
  const tg=Object.entries(tag).filter(([k,b])=>b.n>=2).sort((a,b)=>a[1].net-b[1].net);if(tg.length&&tg[0][1].net<0)o.push("Trades tagged \u201c"+tg[0][0]+"\u201d: "+$(tg[0][1].net)+" across "+tg[0][1].n+" trades.");
  const days={};jrClosed(T).forEach(t=>{const d=jrDay(t);days[d]=(days[d]||0)+1});const dv=Object.values(days).sort((a,b)=>a-b),med=dv[Math.floor(dv.length/2)]||0;
  const busy=Object.entries(days).filter(([d,c])=>med&&c>=Math.max(3,med*2));if(busy.length){const net=busy.reduce((s,[d])=>s+st.byDay[d],0);o.push("On "+busy.length+" day"+(busy.length===1?"":"s")+" with at least twice your usual number of trades, the combined result was "+$(net)+".")}
  if(st.maxDD>0)o.push("Largest fall from a closed-equity peak: "+jrAbs(st.maxDD)+".");
  return o}
/* ---- card on the Journal page */
let JAI_T=[],JAI_ST=null;
function jaiCard(T,st){JAI_T=T;JAI_ST=st;jaiCardRender()}
function jaiCardRender(){const el=document.getElementById("jr_aic");if(!el)return;const A=jaiCfg(),P=JAI_PROV[A.prov],ep=jaiEndpoint(),prefs=typeof vtPrefsOK==="function"&&vtPrefsOK(),guest=typeof vtIsGuest==="function"&&vtIsGuest();
  if(!JAI.key){const s=jaiStoredKey();if(s&&s.p===A.prov)JAI.key=s.k}
  const stored=!!jaiStoredKey(),T=JAI_T,st=JAI_ST||jrStats([]),inc=jrClosed(T).slice(-JAI_MAX_TRADES).length;const tabs=[["local","Local summary"],["ai","AI review (your own key)"]];
  const fe=document.activeElement&&el.contains(document.activeElement)?document.activeElement.id:"";
  el.innerHTML=`<div class="jrch"><h3 id="jai_h">Journal review</h3><div class="seg" role="tablist" aria-labelledby="jai_h">${tabs.map(([k,n])=>`<button type="button" role="tab" id="jai_tab_${k}" aria-selected="${JAI.mode===k}" aria-controls="jai_p" class="${JAI.mode===k?"on":""}" tabindex="${JAI.mode===k?0:-1}">${n}</button>`).join("")}</div></div>
<div id="jai_p" role="tabpanel" aria-labelledby="jai_tab_${JAI.mode}">${JAI.mode==="local"?`<p class="cnote">Worked out in your browser from the trades in this view. Nothing is sent anywhere. These are descriptions of your record, not advice.</p><ul class="jail">${jaiLocal(T,st).map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:
`<div class="jaiw"><div class="frm jaifrm"><label>Provider<select id="jai_prov">${Object.keys(JAI_PROV).map(k=>`<option value="${k}"${k===A.prov?" selected":""}>${esc(JAI_PROV[k].name)}</option>`).join("")}</select></label>
${A.prov==="custom"?`<label>Endpoint base URL<input id="jai_base" type="url" value="${esc(A.base)}" placeholder="https://\u2026/v1" autocomplete="off" spellcheck="false"></label>`:""}
<label>Model<input id="jai_model" value="${esc(A.model)}" placeholder="${esc(P.model||"model name")}" autocomplete="off" spellcheck="false"></label>
<label>API key<input id="jai_key" type="password" value="${esc(JAI.key)}" autocomplete="off" spellcheck="false" placeholder="paste your key"></label></div>
<div class="jaiopts"><label class="chk"><input type="checkbox" id="jai_rem"${stored?" checked":""}${prefs&&!guest?"":" disabled"}> Remember the key on this device</label><span class="mut jaisub">${guest?"Not available in guest mode.":prefs?"Stored in this browser for your account only (<code>vt_aikey~…</code>) until you untick this or withdraw Optional preferences.":"Needs \u201cOptional preferences\u201d in <button type=\"button\" class=\"lnk\" id=\"jai_ck\">Cookie settings</button>. Without it the key is kept only until you close this tab."}</span>
${JAI.key?`<button type="button" class="lnk" id="jai_forget">Forget key</button>`:""}
<label class="chk"><input type="checkbox" id="jai_notes"${A.notes?" checked":""}> Include my trade notes</label></div>
<div class="jaidisc" id="jai_disc"><b>Before you send:</b> pressing Send sends ${inc} closed trade${inc===1?"":"s"} from this view (date, symbol, side, P\u0026L, R, setup and tags${A.notes?", and your notes":""}) plus summary statistics directly from your browser to <b>${esc(ep.host||"the endpoint you enter")}</b>, using your key. Account names aren\u2019t included. Vektor Terminal has no server in between and doesn\u2019t receive your key or this data. ${A.prov!=="custom"?`${esc(P.name)}\u2019s own terms and privacy policy apply (<a href="${esc(P.terms)}" target="_blank" rel="noopener noreferrer">${esc(P.name)} policies</a>), and you pay for the request on your account.`:"The endpoint owner\u2019s terms and privacy policy apply."} The reply is generated by AI: it can be wrong and is not financial advice.
<details class="jaiprev"><summary>See exactly what will be sent</summary><pre id="jai_json" tabindex="0"></pre></details>
<label class="chk"><input type="checkbox" id="jai_ack"${JAI.ack?" checked":""}> I understand and want to send this data to ${esc(ep.host||"this endpoint")}</label></div>
<div class="row jaibtns"><button type="button" class="pri" id="jai_send"${JAI.busy||!inc?" disabled":""}>${JAI.busy?"Waiting for "+esc(P.name)+"\u2026":"Send to "+esc(A.prov==="custom"?(ep.host||"endpoint"):P.name)}</button>${JAI.busy?`<button type="button" id="jai_cancel">Cancel</button>`:""}${!inc?`<span class="mut">Log some closed trades first.</span>`:""}</div>
<div id="jai_msg" role="status" aria-live="polite">${JAI.err?`<p class="vsmsg err">${esc(JAI.err)}</p><p class="cnote">Here is the local summary instead (worked out in your browser):</p><ul class="jail">${jaiLocal(T,st).map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}</div>
<div id="jai_out"></div></div>`}</div>`;
  const q=id=>document.getElementById(id);
  el.querySelectorAll('[role="tab"]').forEach((b,i,all)=>{b.onclick=()=>{JAI.mode=b.id.slice(8);jaiCardRender();q("jai_tab_"+JAI.mode).focus()};b.onkeydown=e=>{if(e.key==="ArrowRight"||e.key==="ArrowLeft"){e.preventDefault();all[(i+(e.key==="ArrowRight"?1:all.length-1))%all.length].click()}}});
  if(JAI.mode==="ai"){
    q("jai_prov").onchange=e=>{A.prov=e.target.value;A.model="";const s=jaiStoredKey();JAI.key=s&&s.p===A.prov?s.k:"";JAI.ack=false;save();jaiCardRender()};
    if(q("jai_base"))q("jai_base").onchange=e=>{A.base=e.target.value.trim().slice(0,300);JAI.ack=false;save();jaiCardRender()};
    q("jai_model").onchange=e=>{A.model=e.target.value.trim().slice(0,120);save();jaiCardRender()};
    q("jai_key").oninput=e=>{JAI.key=e.target.value.trim();if(jaiStoredKey())jaiRemember(true)};
    q("jai_rem").onchange=e=>{const ok=jaiRemember(e.target.checked);if(e.target.checked&&!ok){e.target.checked=false;toast(JAI.key?"Couldn\u2019t save the key":"Enter a key first")}else toast(e.target.checked?"Key remembered on this device":"Key no longer remembered")};
    if(q("jai_ck"))q("jai_ck").onclick=()=>{if(typeof vtBanner==="function")vtBanner(true)};
    if(q("jai_forget"))q("jai_forget").onclick=()=>{jaiForget();toast("Key forgotten");jaiCardRender()};
    q("jai_notes").onchange=e=>{A.notes=e.target.checked;JAI.ack=false;save();jaiCardRender()};
    q("jai_ack").onchange=e=>{JAI.ack=e.target.checked};
    const pv=el.querySelector(".jaiprev");pv.ontoggle=()=>{if(pv.open)q("jai_json").textContent=JSON.stringify(jaiPayload(JAI_T,JAI_ST||jrStats([])),null,2)};
    q("jai_send").onclick=()=>jaiSend(JAI_T,JAI_ST||jrStats([]));if(q("jai_cancel"))q("jai_cancel").onclick=()=>{if(JAI.ctl)JAI.ctl.abort()};
    if(JAI.out)jaiOut(q("jai_out"))}
  if(fe&&q(fe))q(fe).focus()}
/* AI text is shown as plain text only (never as HTML) */
const JAI_ADVICE=/\b(you should (buy|sell|short|go long|go short)|buy (now|the dip)|sell (now|everything)|price target|will (rise|fall|go up|go down|rally|crash)|guaranteed|risk[- ]free)\b/i;
function jaiOut(box){const o=JAI.out;box.innerHTML="";const h=document.createElement("div");h.className="jaiouth";h.textContent="AI-generated by "+o.prov+" ("+o.model+") from "+o.n+" trade"+(o.n===1?"":"s")+" at "+o.at.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})+". It can be wrong. It describes your record and is not financial advice.";box.appendChild(h);
  const body=document.createElement("div");body.className="jaitxt";o.text.split(/\n{1,}/).map(s=>s.trim()).filter(Boolean).forEach(line=>{const m=/^(#{1,4}\s*|[-*\u2022]\s+|\d+[.)]\s+)?(.*)$/.exec(line);const p=document.createElement(m[1]&&/^#/.test(m[1])?"h4":m[1]?"li":"p");p.textContent=m[2].replace(/\*\*(.+?)\*\*/g,"$1");body.appendChild(p)});
  box.appendChild(body);if(JAI_ADVICE.test(o.text)){const w=document.createElement("p");w.className="vsmsg err";w.textContent="Part of this reply reads like a trading instruction or prediction. Vektor asked the AI not to do that; treat it as a description only, not advice.";box.appendChild(w)}
  const cp=document.createElement("button");cp.type="button";cp.textContent="Copy text";cp.onclick=()=>{try{navigator.clipboard.writeText(h.textContent+"\n\n"+o.text);toast("Copied")}catch(e){}};box.appendChild(cp)}
document.addEventListener("vt-consent",e=>{if(!(e.detail&&e.detail.prefs)){try{localStorage.removeItem(jaiKeyName())}catch(x){}}if(document.getElementById("jai_p"))jaiCardRender()});
