/* ---------- Calendar & News page ----------
   Economic calendar: the Forex Factory weekly feed (nfs.faireconomy.media/ff_calendar_thisweek.json). The feed sends no CORS headers,
   so the browser tries it directly and then through the same public proxies used for Yahoo (PX). Nothing is invented: if every route
   fails, the page says so and shows no events. Headlines: Yahoo Finance RSS for the symbols you pick (titles and links only; open at the
   publisher). Kept in memory only; refreshed while the page is open. */
const CAL_URL="https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const CAL={ev:null,at:0,err:"",busy:false,src:"",timer:0,news:{},newsBusy:{}};
const CAL_IMP=["High","Medium","Low","Holiday"];
function calCfg(){if(!S.cal||typeof S.cal!=="object")S.cal={};const C=S.cal;if(!Array.isArray(C.imp))C.imp=["High","Medium"];if(!Array.isArray(C.ccy))C.ccy=[];if(typeof C.q!=="string")C.q="";if(!Array.isArray(C.news))C.news=[];C.past=C.past!==false;return C}
async function calFetchJSON(u,ms){const routes=[u,...PX.map(f=>f(u))];let last="";for(const r of routes){const ac=new AbortController(),t=setTimeout(()=>ac.abort(),ms||12000);
    try{const res=await fetch(r,{signal:ac.signal,cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer"});if(!res.ok){last="HTTP "+res.status;continue}const txt=await res.text();clearTimeout(t);return{txt,via:r===u?"direct":new URL(r).host}}
    catch(e){last=e.name==="AbortError"?"timed out":"blocked or offline"}finally{clearTimeout(t)}}throw new Error(last||"unavailable")}
/* validate the feed: only well-formed events are kept */
function calParse(txt){let j;try{j=JSON.parse(txt)}catch(e){throw new Error("the feed wasn\u2019t valid JSON")}if(!Array.isArray(j))throw new Error("unexpected feed format");
  const out=[];for(const e of j){if(!e||typeof e.title!=="string"||typeof e.date!=="string")continue;const t=Date.parse(e.date);if(!isFinite(t))continue;
    out.push({t,title:e.title.slice(0,140),ccy:String(e.country||"").toUpperCase().slice(0,4),imp:CAL_IMP.includes(e.impact)?e.impact:"Low",fc:String(e.forecast==null?"":e.forecast).slice(0,24),pv:String(e.previous==null?"":e.previous).slice(0,24),act:String(e.actual==null?"":e.actual).slice(0,24)})}
  return out.sort((a,b)=>a.t-b.t)}
async function calLoad(force){if(CAL.busy)return;if(!force&&CAL.ev&&Date.now()-CAL.at<15*60e3)return;CAL.busy=true;CAL.err="";calRender();
  try{const r=await calFetchJSON(CAL_URL);CAL.ev=calParse(r.txt);CAL.at=Date.now();CAL.src=r.via}catch(e){CAL.err=e.message}finally{CAL.busy=false;calRender()}}
const calDayKey=t=>{const d=new Date(t);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const calTime=t=>{const d=new Date(t);return d.getHours()===0&&d.getMinutes()===0?"All day":d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})};
function calIn(ms){const m=Math.round(ms/60000);if(m<60)return m+" min";const h=Math.floor(m/60);if(h<48)return h+" h "+(m%60)+" min";return Math.round(h/24)+" days"}
function calBuild(){const el=document.getElementById("pv-calendar");if(!el)return;const C=calCfg();
  el.innerHTML=`<div class="pgw cal"><div class="pgh"><h2>Calendar <span class="mut">\u0026</span> News</h2><span class="mut">Scheduled economic releases for this week, in your local time (${esc(Intl.DateTimeFormat().resolvedOptions().timeZone||"local")}), and headlines for symbols you pick.</span></div>
<div class="calgrid"><section class="vcard" aria-labelledby="cal_h"><div class="jrch"><h3 id="cal_h">Economic calendar</h3><span class="sp"></span><span class="mut" id="cal_st" role="status" aria-live="polite"></span><button type="button" id="cal_rf">Refresh</button></div>
<div class="calf" role="group" aria-label="Calendar filters"><div class="seg" role="group" aria-label="Impact">${CAL_IMP.map(k=>`<button type="button" class="calimp i_${k.toLowerCase()}${C.imp.includes(k)?" on":""}" aria-pressed="${C.imp.includes(k)}" data-imp="${k}">${k}</button>`).join("")}</div>
<label class="calq"><span class="vh">Search events</span><input id="cal_q" type="search" placeholder="Search events, e.g. CPI" value="${esc(C.q)}" autocomplete="off"></label>
<label class="chk"><input type="checkbox" id="cal_past"${C.past?" checked":""}> Show past events</label></div>
<div class="calccy" id="cal_ccy" role="group" aria-label="Currencies"></div><div id="cal_next"></div><div id="cal_list"></div>
<p class="cnote">Source: Forex Factory weekly calendar feed (<a href="https://www.forexfactory.com/calendar" target="_blank" rel="noopener noreferrer">forexfactory.com</a>), fetched ${"\u2013"} where your browser blocks it ${"\u2013"} through public proxies. Times and figures can change or be revised; check the official release. Not advice.</p></section>
<section class="vcard" aria-labelledby="news_h"><div class="jrch"><h3 id="news_h">Headlines</h3><span class="sp"></span><button type="button" id="news_rf">Refresh</button></div>
<form class="newsadd" id="news_f"><label><span class="vh">Add a symbol</span><input id="news_sym" list="news_syms" placeholder="Add symbol, e.g. AAPL or BTCUSDT" autocomplete="off"></label><button type="submit">Add</button></form><datalist id="news_syms">${(typeof SYMS!=="undefined"?SYMS:[]).slice(0,500).map(s=>`<option value="${esc(s[0])}">`).join("")}</datalist>
<div class="calccy" id="news_chips"></div><div id="news_list" aria-live="polite" aria-busy="false"></div>
<p class="cnote">Headlines and links from Yahoo Finance RSS. Articles open on the publisher\u2019s site; Vektor doesn\u2019t host or summarise them. Not advice.</p></section></div></div>`;
  const q=id=>document.getElementById(id);
  el.querySelectorAll(".calimp").forEach(b=>b.onclick=()=>{const k=b.dataset.imp,i=C.imp.indexOf(k);if(i>=0)C.imp.splice(i,1);else C.imp.push(k);b.classList.toggle("on",i<0);b.setAttribute("aria-pressed",String(i<0));save();calRender()});
  q("cal_q").oninput=e=>{C.q=e.target.value.slice(0,60);save();calRender()};q("cal_past").onchange=e=>{C.past=e.target.checked;save();calRender()};q("cal_rf").onclick=()=>calLoad(true);
  q("news_f").onsubmit=e=>{e.preventDefault();const v=q("news_sym").value.trim().toUpperCase().replace(/[^A-Z0-9.=^\-]/g,"").slice(0,20);if(!v)return;if(!newsTicker(v)){toast("No headline source for "+v);return}if(!C.news.includes(v)){if(C.news.length>=8)C.news.shift();C.news.push(v);save()}q("news_sym").value="";newsRender();newsLoad(v,true)};
  q("news_rf").onclick=()=>newsSyms().forEach(s=>newsLoad(s,true));
  calRender();calLoad(false);newsRender();newsSyms().forEach(s=>newsLoad(s,false))}
function calRender(){const L=document.getElementById("cal_list");if(!L)return;const C=calCfg(),st=document.getElementById("cal_st"),now=Date.now();
  st.textContent=CAL.busy?"Loading\u2026":CAL.at?"Updated "+new Date(CAL.at).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})+(CAL.src&&CAL.src!=="direct"?" via "+CAL.src:""):"";
  if(!CAL.ev){L.innerHTML=CAL.err?`<div class="calerr"><p class="vsmsg err">Couldn\u2019t load the calendar (${esc(CAL.err)}).</p><p class="mut">No events are shown rather than guessed. The feed or the proxies may be down or blocked on this network; try Refresh in a few minutes.</p></div>`:`<p class="mut vt-skel">Loading this week\u2019s calendar\u2026</p>`;document.getElementById("cal_ccy").innerHTML="";document.getElementById("cal_next").innerHTML="";return}
  const all=[...new Set(CAL.ev.map(e=>e.ccy).filter(Boolean))].sort();const cc=document.getElementById("cal_ccy");
  cc.innerHTML=`<button type="button" class="chip${C.ccy.length?"":" on"}" aria-pressed="${!C.ccy.length}" data-c="">All</button>`+all.map(c=>`<button type="button" class="chip${C.ccy.includes(c)?" on":""}" aria-pressed="${C.ccy.includes(c)}" data-c="${esc(c)}">${esc(c)}</button>`).join("");
  cc.querySelectorAll(".chip").forEach(b=>b.onclick=()=>{const c=b.dataset.c;if(!c)C.ccy=[];else{const i=C.ccy.indexOf(c);if(i>=0)C.ccy.splice(i,1);else C.ccy.push(c)}save();calRender()});
  const qq=C.q.trim().toLowerCase(),ev=CAL.ev.filter(e=>C.imp.includes(e.imp)&&(!C.ccy.length||C.ccy.includes(e.ccy))&&(!qq||e.title.toLowerCase().includes(qq)||e.ccy.toLowerCase()===qq)&&(C.past||e.t>=now-30*60e3));
  const nx=CAL.ev.find(e=>e.imp==="High"&&e.t>now&&(!C.ccy.length||C.ccy.includes(e.ccy)));
  document.getElementById("cal_next").innerHTML=nx?`<div class="calnext"><span class="calb i_high">High</span> Next high-impact: <b>${esc(nx.ccy)} ${esc(nx.title)}</b> in <b>${calIn(nx.t-now)}</b> (${new Date(nx.t).toLocaleString("en-GB",{weekday:"short",hour:"2-digit",minute:"2-digit"})})</div>`:"";
  if(!ev.length){L.innerHTML=`<p class="mut calempty">${CAL.ev.length?"No events match these filters.":"The feed has no events for this week."}</p>`;return}
  const by={};ev.forEach(e=>{(by[calDayKey(e.t)]=by[calDayKey(e.t)]||[]).push(e)});const today=calDayKey(now);
  L.innerHTML=Object.keys(by).map(d=>{const dt=new Date(by[d][0].t);return`<div class="calday${d===today?" today":""}"><h4>${dt.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"short"})}${d===today?" \u00b7 Today":""}</h4><div class="caltw" tabindex="0" role="region" aria-label="Events ${esc(d)}"><table class="ftbl calt"><thead><tr><th class="l">Time</th><th class="l">Cur.</th><th class="l">Impact</th><th class="l">Event</th><th>Actual</th><th>Forecast</th><th>Previous</th></tr></thead><tbody>${by[d].map(e=>
    `<tr class="${e.t<now?"past":""}"><td class="l">${calTime(e.t)}</td><td class="l"><b>${esc(e.ccy)}</b></td><td class="l"><span class="calb i_${e.imp.toLowerCase()}">${e.imp}</span></td><td class="l">${esc(e.title)}</td><td>${esc(e.act)||"\u2013"}</td><td>${esc(e.fc)||"\u2013"}</td><td>${esc(e.pv)||"\u2013"}</td></tr>`).join("")}</tbody></table></div></div>`}).join("")}
/* ---- headlines */
function newsSyms(){const C=calCfg();if(C.news.length)return C.news.slice();const d=[];if(S.chart&&S.chart.sym&&newsTicker(S.chart.sym))d.push(S.chart.sym);return d}
function newsTicker(n){n=String(n||"").toUpperCase();if(!n)return null;const y=[...(typeof YFW!=="undefined"?YFW:[]),...(typeof YCR!=="undefined"?YCR:[])].find(w=>w.n===n);if(y)return y.td;
  const m=/^([A-Z0-9]{2,10})(USDT|USDC|USD)$/.exec(n);if(m&&(typeof SYMS==="undefined"||SYMS.some(s=>s[0]===n&&s[1]==="CRY")||/USDT$/.test(n)))return m[1]+"-USD";
  if(/^[A-Z]{6}$/.test(n)&&typeof SYMS!=="undefined"&&SYMS.some(s=>s[0]===n&&s[1]==="FX"))return n+"=X";
  if(/^[A-Z][A-Z0-9.\-]{0,9}$/.test(n))return n;return null}
async function newsLoad(sym,force){const k=newsTicker(sym);if(!k||CAL.newsBusy[sym])return;const c=CAL.news[sym];if(!force&&c&&Date.now()-c.at<10*60e3){newsRender();return}
  CAL.newsBusy[sym]=1;newsRender();try{const r=await calFetchJSON("https://feeds.finance.yahoo.com/rss/2.0/headline?s="+encodeURIComponent(k)+"&region=US&lang=en-US",12000);CAL.news[sym]={at:Date.now(),items:newsParse(r.txt),err:""}}
  catch(e){CAL.news[sym]={at:Date.now(),items:c&&c.items||[],err:e.message}}finally{delete CAL.newsBusy[sym];newsRender()}}
function newsParse(txt){const doc=new DOMParser().parseFromString(txt,"text/xml");if(doc.querySelector("parsererror"))throw new Error("the feed wasn\u2019t valid RSS");
  return[...doc.querySelectorAll("item")].slice(0,20).map(it=>{const g=s=>{const x=it.querySelector(s);return x?x.textContent.trim():""};let link=g("link");try{const u=new URL(link);link=/^https?:$/.test(u.protocol)?u.href:""}catch(e){link=""}
    const t=Date.parse(g("pubDate"));return{title:g("title").slice(0,200),link,t:isFinite(t)?t:null}}).filter(x=>x.title&&x.link)}
function newsRender(){const L=document.getElementById("news_list"),ch=document.getElementById("news_chips");if(!L)return;const C=calCfg(),syms=newsSyms();
  ch.innerHTML=syms.map(s=>`<span class="chip on newschip">${esc(s)}${C.news.includes(s)?`<button type="button" class="newsx" data-s="${esc(s)}" aria-label="Remove ${esc(s)}">\u2715</button>`:""}</span>`).join("");
  ch.querySelectorAll(".newsx").forEach(b=>b.onclick=()=>{C.news=C.news.filter(x=>x!==b.dataset.s);save();newsRender()});
  if(!syms.length){L.innerHTML=`<p class="mut">Add a symbol above to see its latest headlines.</p>`;return}
  const items=[],errs=[];let busy=false;syms.forEach(s=>{const c=CAL.news[s];if(CAL.newsBusy[s])busy=true;if(c){c.items.forEach(i=>items.push(Object.assign({sym:s},i)));if(c.err)errs.push(s+": "+c.err)}});L.setAttribute("aria-busy",String(busy));
  const seen=new Set(),list=items.filter(i=>!seen.has(i.link)&&seen.add(i.link)).sort((a,b)=>(b.t||0)-(a.t||0)).slice(0,30);
  L.innerHTML=(errs.length?`<p class="vsmsg err">Couldn\u2019t load headlines for ${esc(errs.join("; "))}.</p>`:"")+(list.length?`<ul class="newsl">${list.map(i=>`<li><a href="${esc(i.link)}" target="_blank" rel="noopener noreferrer nofollow">${esc(i.title)}</a><span class="mut"> \u00b7 ${esc(i.sym)}${i.t?" \u00b7 "+new Date(i.t).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):""}</span></li>`).join("")}</ul>`:busy?`<p class="mut vt-skel">Loading headlines\u2026</p>`:errs.length?"":`<p class="mut">No recent headlines for these symbols.</p>`)}
PAGE_HOOK.calendar={enter(){calBuild();clearInterval(CAL.timer);CAL.timer=setInterval(()=>{if(document.visibilityState==="visible"){calLoad(false);calRender()}},60e3)},leave(){clearInterval(CAL.timer)},sub(){calRender()}};
