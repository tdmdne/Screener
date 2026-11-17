/* ---------- Calendar & News page ----------
   Economic calendar via server-side cached /api/calendar (Forex Factory feed with live macro-schedule fallback) and browser proxy fallback if offline.
   Timezone-accurate rendering with selectable timezone, 3-bar impact indicator, beat/miss actual highlighting, and Yahoo Finance RSS headlines via /api/news. */
const CAL_URL="https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const CAL={ev:null,at:0,err:"",busy:false,src:"",timer:0,news:{},newsBusy:{}};
const CAL_IMP=["High","Medium","Low","Holiday"];
const CAL_TZ_PRESETS=[["local","Local timezone"],["UTC","UTC"],["America/New_York","New York (ET)"],["Europe/London","London (UK)"],["Asia/Tokyo","Tokyo (JST)"],["Asia/Singapore","Singapore (SGT)"]];
const CAL_X_SVG='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
function calCfg(){if(!S.cal||typeof S.cal!=="object")S.cal={};const C=S.cal;
  if(!Array.isArray(C.imp))C.imp=["High","Medium"];if(!Array.isArray(C.ccy))C.ccy=[];
  if(typeof C.q!=="string")C.q="";if(!Array.isArray(C.news))C.news=[];
  if(typeof C.tz!=="string"||!C.tz)C.tz="local";
  C.past=C.past!==false;return C}
function calLocalTZ(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC"}catch(e){return"UTC"}}
function calResolveTZ(C){const z=(C&&C.tz)||"local";const tz=z==="local"?calLocalTZ():z;
  let off="";try{const parts=new Intl.DateTimeFormat("en-US",{timeZone:tz,timeZoneName:"shortOffset"}).formatToParts(new Date());
    const p=parts.find(x=>x.type==="timeZoneName");off=p?p.value.replace("GMT","UTC"):""}catch(e){}
  return{tz,off,label:tz+(off?" ("+off+")":"")}}
function calImpSvg(imp){
  const n=imp==="High"?3:imp==="Medium"?2:imp==="Low"?1:0;
  return`<svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">${[0,1,2].map(i=>`<rect x="${1+i*4.5}" y="${7-i*2.5}" width="3" height="${4+i*2.5}" rx="0.8" fill="${i<n?"currentColor":"var(--line)"}"/>`).join("")}</svg>`}
function calNum(v){const s=String(v||"").replace(/,/g,"").trim();const m=/^([+-]?\d+(?:\.\d+)?)\s*([KMBT%])?$/i.exec(s);if(!m)return null;
  let x=parseFloat(m[1]);if(!isFinite(x))return null;const u=(m[2]||"").toUpperCase();if(u==="K")x*=1e3;else if(u==="M")x*=1e6;else if(u==="B")x*=1e9;else if(u==="T")x*=1e12;return x}
function calActCls(e){if(!e.act||!e.fc)return"";const a=calNum(e.act),f=calNum(e.fc);if(a==null||f==null)return"act-flat";if(Math.abs(a-f)<1e-9)return"act-flat";
  const inv=/unemployment|claimant|jobless|deficit/i.test(e.title);const better=inv?(a<f):(a>f);return better?"act-beat":"act-miss"}
async function calFetchJSON(u,ms){
  const ac=new AbortController(),t=setTimeout(()=>ac.abort(),ms||10000);
  try{
    const res=await fetch(u,{signal:ac.signal,cache:"no-store",credentials:"omit",referrerPolicy:"no-referrer"});
    if(!res.ok)throw new Error("HTTP "+res.status);
    const txt=await res.text();
    return{txt,via:"direct"};
  }catch(e){
    throw new Error(e.name==="AbortError"?"timed out":"unavailable");
  }finally{clearTimeout(t)}
}
function calParse(txt){let j;try{j=JSON.parse(txt)}catch(e){throw new Error("the feed wasn\u2019t valid JSON")}if(!Array.isArray(j))throw new Error("unexpected feed format");
  const out=[];for(const e of j){if(!e||typeof e.title!=="string"||typeof e.date!=="string")continue;const t=Date.parse(e.date);if(!isFinite(t))continue;
    const hasTime=/T\d{2}:\d{2}/.test(e.date)&&!(e.time&&/all\s*day|tentative/i.test(String(e.time)))&&e.impact!=="Holiday";
    out.push({t,hasTime,title:e.title.slice(0,140),ccy:String(e.country||"").toUpperCase().slice(0,4),imp:CAL_IMP.includes(e.impact)?e.impact:"Low",fc:String(e.forecast==null?"":e.forecast).slice(0,24),pv:String(e.previous==null?"":e.previous).slice(0,24),act:String(e.actual==null?"":e.actual).slice(0,24)})}
  return out.sort((a,b)=>a.t-b.t)}
async function calLoad(force){if(CAL.busy)return;if(!force&&CAL.ev&&Date.now()-CAL.at<15*60e3)return;CAL.busy=true;CAL.err="";calRender();
  try{
    if(typeof vtCanUseEdge==="function"?vtCanUseEdge():/^https?:$/.test(location.protocol)){
      const r=await fetch("/api/calendar"+(force?"?force=1":""),{cache:"no-store"});
      if(r.ok){const j=await r.json();if(j&&j.ok&&Array.isArray(j.events)){CAL.ev=j.events.slice().sort((a,b)=>a.t-b.t);CAL.at=Date.now();CAL.src=j.source==="forexfactory"?"Forex Factory":"Macro calendar";return}}
    }
    const r=await calFetchJSON(CAL_URL,10000);CAL.ev=calParse(r.txt);CAL.at=Date.now();CAL.src=r.via;
  }catch(e){if(!CAL.ev)CAL.err=e.message}finally{CAL.busy=false;calRender()}}
function calDayKey(t,tz){try{return new Intl.DateTimeFormat("en-CA",{timeZone:tz||calLocalTZ(),year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(t))}
  catch(e){const d=new Date(t);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}}
function calTime(e,tz){if(e&&e.hasTime===false)return"All day";
  const t=typeof e==="number"?e:e.t;try{return new Intl.DateTimeFormat("en-GB",{timeZone:tz||calLocalTZ(),hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(t))}
  catch(x){return new Date(t).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}}
function calDateFmt(t,tz,opt){try{return new Intl.DateTimeFormat("en-US",Object.assign({timeZone:tz||calLocalTZ()},opt)).format(new Date(t))}catch(e){return new Date(t).toLocaleDateString("en-US",opt)}}
function calIn(ms){if(Math.abs(ms)<5*60000)return"Now";const m=Math.round(ms/60000);if(m<60)return m+"m";const h=Math.floor(m/60);if(h<48)return h+"h "+(m%60)+"m";return Math.round(h/24)+"d "+(h%24)+"h"}
function calBuild(){const el=document.getElementById("pv-calendar");if(!el)return;const C=calCfg(),tzInfo=calResolveTZ(C);
  el.innerHTML=`<div class="pgw cal"><div class="pgh"><h2>Calendar <span class="mut">&amp;</span> News</h2><span class="mut" id="cal_tzsub">Macro releases in ${esc(tzInfo.label)}, plus live headlines for your symbols.</span></div>
<div class="calgrid"><section class="vcard" aria-labelledby="cal_h"><div class="jrch"><h3 id="cal_h">Economic calendar</h3><span class="sp"></span><span class="mut" id="cal_st" role="status" aria-live="polite"></span><button type="button" id="cal_rf">Refresh</button></div>
<div class="calf" role="group" aria-label="Calendar filters"><div class="seg" role="group" aria-label="Impact">${CAL_IMP.map(k=>`<button type="button" class="calimp i_${k.toLowerCase()}${C.imp.includes(k)?" on":""}" aria-pressed="${C.imp.includes(k)}" data-imp="${k}">${calImpSvg(k)}<span>${k}</span></button>`).join("")}</div>
<label class="calq"><span class="vh">Search events</span><input id="cal_q" type="search" placeholder="Search events, e.g. CPI, PMI, FOMC" value="${esc(C.q)}" autocomplete="off"></label>
<label class="caltz"><span>Zone</span><select id="cal_tz">${CAL_TZ_PRESETS.map(([v,n])=>`<option value="${v}"${C.tz===v?" selected":""}>${v==="local"?"Local ("+esc(calLocalTZ())+")":esc(n)}</option>`).join("")}</select></label>
<label class="chk"><input type="checkbox" id="cal_past"${C.past?" checked":""}> Show past</label></div>
<div class="calccy" id="cal_ccy" role="group" aria-label="Currencies"></div><div id="cal_next"></div><div id="cal_list"></div>
<p class="cnote">Weekly macro schedule synchronized in 15-minute intervals. Times adjust dynamically to your selected timezone; actuals update as releases print.</p></section>
<section class="vcard" aria-labelledby="news_h"><div class="jrch"><h3 id="news_h">Headlines</h3><span class="sp"></span><button type="button" id="news_rf">Refresh</button></div>
<form class="newsadd" id="news_f"><label><span class="vh">Add a symbol</span><input id="news_sym" list="news_syms" placeholder="Add symbol, e.g. AAPL or BTCUSDT" autocomplete="off"></label><button type="submit">Add</button></form><datalist id="news_syms">${(typeof SYMS!=="undefined"?SYMS:[]).slice(0,500).map(s=>`<option value="${esc(s[0])}">`).join("")}</datalist>
<div class="calccy" id="news_chips"></div><div id="news_list" aria-live="polite" aria-busy="false"></div>
<p class="cnote">Headlines sourced from Yahoo Finance RSS feeds. Articles open externally on the publisher\u2019s site.</p></section></div></div>`;
  const q=id=>document.getElementById(id);
  el.querySelectorAll(".calimp").forEach(b=>b.onclick=()=>{const k=b.dataset.imp,i=C.imp.indexOf(k);if(i>=0)C.imp.splice(i,1);else C.imp.push(k);b.classList.toggle("on",i<0);b.setAttribute("aria-pressed",String(i<0));save();calRender()});
  q("cal_q").oninput=e=>{C.q=e.target.value.slice(0,60);save();calRender()};
  q("cal_tz").onchange=e=>{C.tz=e.target.value;save();const sub=q("cal_tzsub");if(sub)sub.textContent="Macro releases in "+calResolveTZ(C).label+", plus live headlines for your symbols.";calRender();newsRender()};
  q("cal_past").onchange=e=>{C.past=e.target.checked;save();calRender()};
  q("cal_rf").onclick=()=>calLoad(true);
  q("news_f").onsubmit=e=>{e.preventDefault();const v=q("news_sym").value.trim().toUpperCase().replace(/[^A-Z0-9.=^\-]/g,"").slice(0,20);if(!v)return;if(!newsTicker(v)){toast("No headline source for "+v);return}if(!C.news.includes(v)){if(C.news.length>=8)C.news.shift();C.news.push(v);save()}q("news_sym").value="";newsRender();newsLoad(v,true)};
  q("news_rf").onclick=()=>newsSyms().forEach(s=>newsLoad(s,true));
  calRender();calLoad(false);newsRender();newsSyms().forEach(s=>newsLoad(s,false))}
function calRender(){const L=document.getElementById("cal_list");if(!L)return;const C=calCfg(),tzInfo=calResolveTZ(C),tz=tzInfo.tz,st=document.getElementById("cal_st"),now=Date.now();
  if(st)st.textContent=CAL.busy?"Updating\u2026":CAL.at?"Updated "+calTime(CAL.at,tz)+(CAL.src?" \u00b7 "+CAL.src:""):"";
  if(!CAL.ev){L.innerHTML=CAL.err?`<div class="calerr"><p class="vsmsg err">Couldn\u2019t load the calendar (${esc(CAL.err)}).</p><p class="mut">Try Refresh in a moment.</p></div>`:`<p class="mut vt-skel">Loading this week\u2019s calendar\u2026</p>`;document.getElementById("cal_ccy").innerHTML="";document.getElementById("cal_next").innerHTML="";return}
  const all=[...new Set(CAL.ev.map(e=>e.ccy).filter(Boolean))].sort();const cc=document.getElementById("cal_ccy");
  cc.innerHTML=`<button type="button" class="chip${C.ccy.length?"":" on"}" aria-pressed="${!C.ccy.length}" data-c="">All</button>`+all.map(c=>`<button type="button" class="chip${C.ccy.includes(c)?" on":""}" aria-pressed="${C.ccy.includes(c)}" data-c="${esc(c)}">${esc(c)}</button>`).join("");
  cc.querySelectorAll(".chip").forEach(b=>b.onclick=()=>{const c=b.dataset.c;if(!c)C.ccy=[];else{const i=C.ccy.indexOf(c);if(i>=0)C.ccy.splice(i,1);else C.ccy.push(c)}save();calRender()});
  const qq=C.q.trim().toLowerCase(),ev=CAL.ev.filter(e=>C.imp.includes(e.imp)&&(!C.ccy.length||C.ccy.includes(e.ccy))&&(!qq||e.title.toLowerCase().includes(qq)||e.ccy.toLowerCase()===qq)&&(C.past||e.t>=now-30*60e3));
  const nx=CAL.ev.find(e=>e.imp==="High"&&e.t>now&&(!C.ccy.length||C.ccy.includes(e.ccy)));
  document.getElementById("cal_next").innerHTML=nx?`<div class="calnext"><span class="calimp-tag i_high">${calImpSvg("High")}<span>High</span></span><span>Next high-impact: <b>${esc(nx.ccy)} ${esc(nx.title)}</b> in <b>${calIn(nx.t-now)}</b> <span class="mut">(${calDateFmt(nx.t,tz,{weekday:"short"})} ${calTime(nx,tz)})</span></span></div>`:"";
  if(!ev.length){L.innerHTML=`<p class="mut calempty">${CAL.ev.length?"No events match the active impact, currency, or search filters.":"No scheduled events in this window."}</p>`;return}
  const by={};ev.forEach(e=>{(by[calDayKey(e.t,tz)]=by[calDayKey(e.t,tz)]||[]).push(e)});const today=calDayKey(now,tz);
  const nextId=nx?nx.t+"|"+nx.title:"";
  L.innerHTML=Object.keys(by).sort().map(d=>{const mid=by[d][0].t;const dLabel=calDateFmt(mid,tz,{weekday:"long",month:"short",day:"numeric"});
    return`<div class="calday${d===today?" today":""}"><h4>${esc(dLabel)}${d===today?" \u00b7 Today":""}</h4><div class="caltw" tabindex="0" role="region" aria-label="Events ${esc(d)}"><table class="ftbl calt"><thead><tr><th class="l">Time</th><th class="l">Cur.</th><th class="l">Impact</th><th class="l">Event</th><th>Actual</th><th>Forecast</th><th>Previous</th></tr></thead><tbody>${by[d].map(e=>{
      const isNext=(e.t+"|"+e.title)===nextId;const ac=calActCls(e);
      return`<tr class="${e.t<now?"past":""}${isNext?" next-up":""}"><td class="l">${esc(calTime(e,tz))}</td><td class="l"><b>${esc(e.ccy)}</b></td><td class="l"><span class="calimp-tag i_${e.imp.toLowerCase()}">${calImpSvg(e.imp)}<span>${esc(e.imp)}</span></span></td><td class="l">${esc(e.title)}</td><td class="${ac}">${esc(e.act)||"\u2013"}</td><td>${esc(e.fc)||"\u2013"}</td><td>${esc(e.pv)||"\u2013"}</td></tr>`}).join("")}</tbody></table></div></div>`}).join("")}
/* ---- headlines */
function newsSyms(){const C=calCfg();if(C.news.length)return C.news.slice();const d=[];if(S.chart&&S.chart.sym&&newsTicker(S.chart.sym))d.push(S.chart.sym);return d}
function newsTicker(n){n=String(n||"").toUpperCase();if(!n)return null;const y=[...(typeof YFW!=="undefined"?YFW:[]),...(typeof YCR!=="undefined"?YCR:[])].find(w=>w.n===n);if(y)return y.td;
  const m=/^([A-Z0-9]{2,10})(USDT|USDC|USD)$/.exec(n);if(m&&(typeof SYMS==="undefined"||SYMS.some(s=>s[0]===n&&s[1]==="CRY")||/USDT$/.test(n)))return m[1]+"-USD";
  if(/^[A-Z]{6}$/.test(n)&&typeof SYMS!=="undefined"&&SYMS.some(s=>s[0]===n&&s[1]==="FX"))return n+"=X";
  if(/^[A-Z][A-Z0-9.\-]{0,9}$/.test(n))return n;return null}
async function newsLoad(sym,force){const k=newsTicker(sym);if(!k||CAL.newsBusy[sym])return;const c=CAL.news[sym];if(!force&&c&&Date.now()-c.at<5*60e3){newsRender();return}
  CAL.newsBusy[sym]=1;newsRender();try{
    if(typeof vtCanUseEdge==="function"?vtCanUseEdge():/^https?:$/.test(location.protocol)){
      const r=await fetch("/api/news?symbol="+encodeURIComponent(k),{cache:"no-store"});
      if(r.ok){const j=await r.json();if(j&&j.ok&&Array.isArray(j.items)){CAL.news[sym]={at:Date.now(),items:j.items,err:""};return}}
    }
    const r=await calFetchJSON("https://feeds.finance.yahoo.com/rss/2.0/headline?s="+encodeURIComponent(k)+"&region=US&lang=en-US",10000);CAL.news[sym]={at:Date.now(),items:newsParse(r.txt),err:""}
  }catch(e){CAL.news[sym]={at:Date.now(),items:c&&c.items||[],err:e.message}}finally{delete CAL.newsBusy[sym];newsRender()}}
function newsParse(txt){const doc=new DOMParser().parseFromString(txt,"text/xml");if(doc.querySelector("parsererror"))throw new Error("the feed wasn\u2019t valid RSS");
  return[...doc.querySelectorAll("item")].slice(0,20).map(it=>{const g=s=>{const x=it.querySelector(s);return x?x.textContent.trim():""};let link=g("link");try{const u=new URL(link);link=/^https?:$/.test(u.protocol)?u.href:""}catch(e){link=""}
    const t=Date.parse(g("pubDate"));return{title:g("title").slice(0,200),link,t:isFinite(t)?t:null}}).filter(x=>x.title&&x.link)}
function newsRender(){const L=document.getElementById("news_list"),ch=document.getElementById("news_chips");if(!L)return;const C=calCfg(),tz=calResolveTZ(C).tz,syms=newsSyms();
  ch.innerHTML=syms.map(s=>`<span class="chip on newschip">${esc(s)}${C.news.includes(s)?`<button type="button" class="newsx" data-s="${esc(s)}" aria-label="Remove ${esc(s)}">${CAL_X_SVG}</button>`:""}</span>`).join("");
  ch.querySelectorAll(".newsx").forEach(b=>b.onclick=()=>{C.news=C.news.filter(x=>x!==b.dataset.s);save();newsRender()});
  if(!syms.length){L.innerHTML=`<p class="mut">Add a symbol above to see its latest headlines.</p>`;return}
  const items=[],errs=[];let busy=false;syms.forEach(s=>{const c=CAL.news[s];if(CAL.newsBusy[s])busy=true;if(c){c.items.forEach(i=>items.push(Object.assign({sym:s},i)));if(c.err)errs.push(s+": "+c.err)}});L.setAttribute("aria-busy",String(busy));
  const seen=new Set(),list=items.filter(i=>!seen.has(i.link)&&seen.add(i.link)).sort((a,b)=>(b.t||0)-(a.t||0)).slice(0,30);
  L.innerHTML=(errs.length?`<p class="vsmsg err">Headlines temporarily unavailable for ${esc(errs.join("; "))}.</p>`:"")+(list.length?`<ul class="newsl">${list.map(i=>`<li><a href="${esc(i.link)}" target="_blank" rel="noopener noreferrer nofollow">${esc(i.title)}</a><span class="mut"> \u00b7 ${esc(i.sym)}${i.t?" \u00b7 "+calDateFmt(i.t,tz,{month:"short",day:"numeric"})+" "+calTime(i.t,tz):""}</span></li>`).join("")}</ul>`:busy?`<p class="mut vt-skel">Loading headlines\u2026</p>`:errs.length?"":`<p class="mut">No recent headlines available for ${esc(syms.join(", "))}.</p>`)}
PAGE_HOOK.calendar={enter(){calBuild();clearInterval(CAL.timer);CAL.timer=setInterval(()=>{if(document.visibilityState==="visible"){calLoad(false);calRender()}},60e3)},leave(){clearInterval(CAL.timer)},sub(){calRender()}};
