/* ---------- Journal & Prop Tracker page ----------
   Everything here is typed in (or imported from your own CSV) by you. Nothing connects to a broker and nothing is estimated:
   empty journals show empty states. Saved with your other settings (scr2); guests keep it in memory only. */
function jrCfg(){if(!S.jr||typeof S.jr!=="object"||Array.isArray(S.jr))S.jr={};const J=S.jr;
  if(!Array.isArray(J.trades))J.trades=[];if(!Array.isArray(J.accts))J.accts=[];if(!J.f||typeof J.f!=="object")J.f={};
  if(J.f.acct==null)J.f.acct="";if(!J.f.period)J.f.period="all";if(!J.f.side)J.f.side="";if(J.f.setup==null)J.f.setup="";if(!J.month)J.month=jrToday().slice(0,7);return J}
const JRV={sort:"close",dir:-1,page:0};
const jrUsd=(v,d)=>v==null||!isFinite(v)?"\u2013":(v<0?"\u2212":v>0?"+":"")+"$"+Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:d==null?2:d,maximumFractionDigits:d==null?2:d});
const jrAbs=(v,d)=>v==null||!isFinite(v)?"\u2013":"$"+Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:d==null?2:d,maximumFractionDigits:d==null?2:d});
const jrPct=v=>v==null||!isFinite(v)?"\u2013":(v*100).toFixed(1)+"%";
const jrFx=(v,d)=>v==null?"\u2013":v===Infinity?"\u221e":isFinite(v)?v.toFixed(d==null?2:d):"\u2013";
const jrRf=v=>v==null||!isFinite(v)?"\u2013":(v>0?"+":v<0?"\u2212":"")+Math.abs(v).toFixed(2)+"R";
const jrCls=v=>v>0?"pos":v<0?"neg":"";
/* trades matching the filter bar */
function jrFiltered(){const J=jrCfg(),f=J.f,today=jrToday();let from="";
  if(f.period==="week"){const d=new Date();d.setDate(d.getDate()-((d.getDay()+6)%7));from=jrDate(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"))}
  else if(f.period==="month")from=today.slice(0,7)+"-01";else if(f.period==="30"){const d=new Date();d.setDate(d.getDate()-29);from=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
  return J.trades.filter(t=>(!f.acct||(t.acct||"")===f.acct)&&(!f.side||t.side===f.side)&&(!f.setup||(t.setup||"").split(",").map(s=>s.trim()).includes(f.setup))&&(!from||(jrDay(t)||String(t.open||"").slice(0,10))>=from))}
function jrSetups(){const s=new Set();jrCfg().trades.forEach(t=>(t.setup||"").split(",").map(x=>x.trim()).filter(Boolean).forEach(x=>s.add(x)));return[...s].sort()}
function jrAcctNames(){const J=jrCfg(),s=new Set(J.accts.map(a=>a.name));J.trades.forEach(t=>{if(t.acct)s.add(t.acct)});return[...s].sort()}
function jrBuild(){const el=document.getElementById("pv-journal");if(!el)return;const J=jrCfg();
  const opt=(v,n,cur)=>`<option value="${esc(v)}"${String(v)===String(cur)?" selected":""}>${esc(n)}</option>`;
const prevSvg='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  const nextSvg='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
  el.innerHTML=`<div class="pgw jr"><div class="pgh"><h2>Journal <span class="mut">\u0026</span> Prop Tracker</h2><span class="mut">Your own trade record. You enter every trade (or import your CSV); nothing here connects to a broker or places trades.</span><span class="sp"></span>
<div class="jrbtns"><button type="button" class="pri" id="jr_add">+ Add trade</button><button type="button" id="jr_imp">Import CSV\u2026</button><input type="file" id="jr_file" accept=".csv,text/csv" hidden><button type="button" id="jr_exp">Export CSV</button></div></div>
<div class="vcard jrf" role="group" aria-label="Filters"><label>Account<select id="jr_facct">${opt("","All accounts",J.f.acct)}${jrAcctNames().map(n=>opt(n,n,J.f.acct)).join("")}</select></label>
<label>Period<select id="jr_fper">${[["all","All time"],["week","This week"],["month","This month"],["30","Last 30 days"]].map(([v,n])=>opt(v,n,J.f.period)).join("")}</select></label>
<label>Side<select id="jr_fside">${opt("","Long and short",J.f.side)}${opt("long","Long only",J.f.side)}${opt("short","Short only",J.f.side)}</select></label>
<label>Setup<select id="jr_fsetup">${opt("","All setups",J.f.setup)}${jrSetups().map(n=>opt(n,n,J.f.setup)).join("")}</select></label></div>
<div class="jrkpis" id="jr_kpis"></div>
<div class="jrgrid"><div class="vcard jreq"><div class="jrch"><h3>Equity curve</h3><span class="mut" id="jr_eqnote"></span></div><canvas id="jr_eq" height="220" role="img" aria-label="Cumulative profit and loss by closed trade"></canvas></div>
<div class="vcard jrcal"><div class="jrch"><h3>Daily P\u0026L</h3><span class="sp"></span><button type="button" class="ibtn" id="jr_mprev" aria-label="Previous month">${prevSvg}</button><b id="jr_mlab"></b><button type="button" class="ibtn" id="jr_mnext" aria-label="Next month">${nextSvg}</button></div><div id="jr_cal"></div></div></div>
<div class="vcard" id="jr_propc"></div>
<div class="jrgrid"><div class="vcard"><h3>By setup</h3><div class="jrtw" tabindex="0" role="region" aria-label="Results by setup"><table class="ftbl" id="jr_setup"></table></div></div>
<div class="vcard"><h3>By weekday</h3><div id="jr_wd"></div><h3 class="jrh3b">By side</h3><div id="jr_side"></div></div></div>
<div class="vcard" id="jr_aic"></div>
<div class="vcard"><div class="jrch"><h3>Trades</h3><span class="mut" id="jr_cnt"></span></div><div class="jrtw" tabindex="0" role="region" aria-label="Trades"><table class="ftbl jrt" id="jr_tbl"></table></div><div class="jrpg" id="jr_pg"></div></div>
<p class="cnote">Results are calculated from what you entered. Past results don\u2019t predict future ones, and nothing here is financial advice.</p></div>`;
  const q=id=>document.getElementById(id);
  q("jr_add").onclick=()=>jrEdit();q("jr_imp").onclick=()=>q("jr_file").click();q("jr_exp").onclick=jrExport;
  q("jr_file").onchange=e=>{const f=e.target.files&&e.target.files[0];e.target.value="";if(!f)return;if(f.size>5e6){toast("File is too large (5 MB max)");return}const rd=new FileReader();rd.onload=()=>jrImport(String(rd.result));rd.readAsText(f)};
  [["jr_facct","acct"],["jr_fper","period"],["jr_fside","side"],["jr_fsetup","setup"]].forEach(([id,k])=>q(id).onchange=e=>{J.f[k]=e.target.value;JRV.page=0;save();jrRender()});
  q("jr_mprev").onclick=()=>{J.month=jrShiftMonth(J.month,-1);save();jrCal()};q("jr_mnext").onclick=()=>{J.month=jrShiftMonth(J.month,1);save();jrCal()};
  jrRender()}
function jrShiftMonth(m,k){const d=new Date(+m.slice(0,4),+m.slice(5,7)-1+k,1);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")}
function jrRender(){const T=jrFiltered(),st=jrStats(T);const q=id=>document.getElementById(id);if(!q("jr_kpis"))return;
  const k=(lab,val,cls,title)=>`<div class="kpi"${title?` title="${esc(title)}"`:""}><div class="k">${lab}</div><div class="v ${cls||""}">${val}</div></div>`;
  q("jr_kpis").innerHTML=k("Net P\u0026L",jrUsd(st.net),jrCls(st.net))+k("Closed trades",String(st.n))+k("Win rate",jrPct(st.winRate),"","Wins \u00f7 closed trades (break-even counts as not a win)")+k("Profit factor",jrFx(st.pf),"","Gross wins \u00f7 gross losses")+
    k("Expectancy",jrUsd(st.exp),jrCls(st.exp),"Average P\u0026L per closed trade")+k("Average R",jrRf(st.avgR),jrCls(st.avgR),"Only trades with a stop: P\u0026L \u00f7 money at risk ("+st.nR+" trades)")+
    k("Avg win / loss",jrAbs(st.avgWin)+" / "+jrAbs(st.avgLoss))+k("Max drawdown",st.maxDD?"\u2212"+jrAbs(st.maxDD):"$0.00",st.maxDD?"neg":"","Largest fall from a closed-equity peak")+k("Streaks",st.winStreak+"W / "+st.lossStreak+"L","","Longest run of wins / losses");
  jrEq(st);jrCal();jrSetupTbl(st);jrWd(st);jrTable(T);jrProps();if(typeof jaiCard==="function")jaiCard(T,st)}
function jrEq(st){const cv=document.getElementById("jr_eq"),note=document.getElementById("jr_eqnote");if(!cv)return;const w=cv.clientWidth||600,h=220,dpr=window.devicePixelRatio||1;
  cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);cv.style.height=h+"px";const g=cv.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);
  const css=getComputedStyle(document.documentElement),col=n=>css.getPropertyValue(n).trim()||"#888";
  const pts=[0,...st.curve.map(c=>c.eq)];note.textContent=st.n?st.n+" closed trade"+(st.n===1?"":"s"):"";
  if(st.n<1){g.fillStyle=col("--mut");g.font="13px system-ui,sans-serif";g.textAlign="center";g.fillText("No closed trades yet",w/2,h/2);cv.setAttribute("aria-label","Equity curve: no closed trades yet");return}
  const lo=Math.min(...pts),hi=Math.max(...pts),pad=(hi-lo)*.08||1,L=lo-pad,H=hi+pad,X=i=>8+i*(w-64)/Math.max(1,pts.length-1),Y=v=>h-18-(v-L)/(H-L)*(h-30);
  g.strokeStyle=col("--line");g.lineWidth=1;g.setLineDash([3,3]);g.beginPath();g.moveTo(8,Y(0));g.lineTo(w-56,Y(0));g.stroke();g.setLineDash([]);
  g.fillStyle=col("--mut");g.font="11px system-ui,sans-serif";g.textAlign="left";[hi,0,lo].filter((v,i,a)=>a.indexOf(v)===i).forEach(v=>g.fillText(jrUsd(v,0),w-52,Y(v)+4));
  const last=pts[pts.length-1];g.strokeStyle=last>=0?col("--g"):col("--r");g.lineWidth=2;g.beginPath();pts.forEach((v,i)=>i?g.lineTo(X(i),Y(v)):g.moveTo(X(i),Y(v)));g.stroke();
  cv.setAttribute("aria-label","Equity curve: "+st.n+" closed trades, net "+jrUsd(last)+", high "+jrUsd(hi)+", low "+jrUsd(lo))}
function jrCal(){const J=jrCfg(),el=document.getElementById("jr_cal");if(!el)return;const m=J.month,y=+m.slice(0,4),mo=+m.slice(5,7)-1;
  document.getElementById("jr_mlab").textContent=new Date(y,mo,1).toLocaleDateString("en-GB",{month:"long",year:"numeric"});
  const st=jrStats(jrFiltered()),first=new Date(y,mo,1),n=new Date(y,mo+1,0).getDate(),lead=(first.getDay()+6)%7,today=jrToday();let h="",tot=0,days=0;
  ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].forEach(d=>h+=`<div class="jrcd h" aria-hidden="true">${d}</div>`);for(let i=0;i<lead;i++)h+=`<div class="jrcd e"></div>`;
  const mx=Math.max(1,...Object.keys(st.byDay).filter(d=>d.startsWith(m)).map(d=>Math.abs(st.byDay[d])));
  for(let d=1;d<=n;d++){const key=m+"-"+String(d).padStart(2,"0"),v=st.byDay[key];const has=v!=null;if(has){tot+=v;days++}
    const a=has?.15+.4*Math.abs(v)/mx:0;h+=`<div class="jrcd${has?(v>0?" up":v<0?" dn":" fl"):""}${key===today?" td":""}"${has?` style="--a:${a.toFixed(2)}" title="${key}: ${jrUsd(v)}"`:""}><span class="jrdn">${d}</span>${has?`<span class="jrpv">${jrUsd(v,0)}</span>`:""}</div>`}
  el.innerHTML=`<div class="jrcg">${h}</div><p class="cnote">${days?`${days} trading day${days===1?"":"s"} this month \u00b7 net <b class="${jrCls(tot)}">${jrUsd(tot)}</b>`:"No closed trades this month."}</p>`;}
function jrSetupTbl(st){const el=document.getElementById("jr_setup");if(!el)return;const rows=Object.entries(st.bySetup).sort((a,b)=>b[1].net-a[1].net);
  el.innerHTML=rows.length?`<thead><tr><th class="l">Setup</th><th>Trades</th><th>Win rate</th><th>Net</th><th>Avg R</th></tr></thead><tbody>${rows.map(([n,b])=>`<tr><td class="l">${esc(n)}</td><td>${b.n}</td><td>${jrPct(b.wins/b.n)}</td><td class="${jrCls(b.net)}">${jrUsd(b.net)}</td><td>${b.nR?jrRf(b.sumR/b.nR):"\u2013"}</td></tr>`).join("")}</tbody>`:`<tbody><tr><td class="l mut">Tag trades with a setup (e.g. \u201cBreakout\u201d) to compare them here.</td></tr></tbody>`}
function jrWd(st){const el=document.getElementById("jr_wd"),sd=document.getElementById("jr_side");if(!el)return;const order=[1,2,3,4,5,6,0],names=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const mx=Math.max(1,...st.byWeekday.map(b=>Math.abs(b.net)));
  el.innerHTML=`<div class="jrbars">${order.filter(i=>i>=1&&i<=5||st.byWeekday[i].n).map(i=>{const b=st.byWeekday[i];return`<div class="jrbar"><span class="l">${names[i]}</span><span class="tr"><span class="b ${jrCls(b.net)}" style="width:${(Math.abs(b.net)/mx*100).toFixed(1)}%"></span></span><span class="v ${jrCls(b.net)}">${b.n?jrUsd(b.net,0):"\u2013"}</span><span class="n mut">${b.n} trade${b.n===1?"":"s"}</span></div>`}).join("")}</div>`;
  sd.innerHTML=["long","short"].map(k=>{const b=st.bySide[k];return`<div class="jrbar"><span class="l">${k==="long"?"Long":"Short"}</span><span class="v ${jrCls(b.net)}">${b.n?jrUsd(b.net):"\u2013"}</span><span class="n mut">${b.n} trade${b.n===1?"":"s"}${b.n?" \u00b7 "+jrPct(b.wins/b.n)+" wins":""}</span></div>`}).join("")}
const JR_PER=50;
function jrTable(T){const el=document.getElementById("jr_tbl"),cnt=document.getElementById("jr_cnt"),pg=document.getElementById("jr_pg");if(!el)return;
  const key=t=>{const s=JRV.sort;return s==="pnl"?(jrPnl(t)==null?-Infinity:jrPnl(t)):s==="r"?(jrR(t)==null?-Infinity:jrR(t)):s==="sym"?t.sym:String(t.close||t.open||"")};
  const rows=T.slice().sort((a,b)=>{const x=key(a),y=key(b);return(x<y?-1:x>y?1:0)*JRV.dir});const pages=Math.max(1,Math.ceil(rows.length/JR_PER));JRV.page=Math.min(JRV.page,pages-1);
  const vis=rows.slice(JRV.page*JR_PER,(JRV.page+1)*JR_PER),open=T.filter(t=>jrPnl(t)==null).length;
  cnt.textContent=T.length?T.length+" trade"+(T.length===1?"":"s")+(open?" \u00b7 "+open+" open":""):"";
  const upSvg='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-left:3px;vertical-align:-1px"><path d="m18 15-6-6-6 6"/></svg>';
  const dnSvg='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-left:3px;vertical-align:-1px"><path d="m6 9 6 6 6-6"/></svg>';
  const th=(k,n,l)=>`<th${l?' class="l"':""} aria-sort="${JRV.sort===k?(JRV.dir>0?"ascending":"descending"):"none"}"><button type="button" class="jrs" data-k="${k}">${n}${JRV.sort===k?(JRV.dir>0?upSvg:dnSvg):""}</button></th>`;
  if(!T.length){el.innerHTML=`<tbody><tr><td class="l jrempty">${jrCfg().trades.length?"No trades match these filters.":"No trades yet. Use <b>+ Add trade</b> after each trade, or import a CSV."}</td></tr></tbody>`;pg.innerHTML="";return}
  const edSvg='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const xSvg='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  el.innerHTML=`<thead><tr>${th("close","Closed",1)}${th("sym","Symbol",1)}<th class="l">Side</th><th>Qty</th><th>Entry</th><th>Exit</th>${th("pnl","P\u0026L")}${th("r","R")}<th class="l">Setup</th><th class="l">Account</th><th><span class="vh">Actions</span></th></tr></thead><tbody>${vis.map(t=>{const p=jrPnl(t),r=jrR(t);
    return`<tr><td class="l">${esc(t.close?t.close.replace("T"," "):"Open")}</td><td class="l"><b>${esc(t.sym)}</b></td><td class="l"><span class="jrside ${t.side}">${t.side==="short"?"Short":"Long"}</span></td><td>${t.qty==null?"\u2013":esc(String(t.qty))}</td><td>${t.entry==null?"\u2013":esc(String(t.entry))}</td><td>${t.exit==null?"\u2013":esc(String(t.exit))}</td>
<td class="${jrCls(p)}">${p==null?"Open":jrUsd(p)}</td><td>${r==null?"\u2013":jrRf(r)}</td><td class="l">${esc(t.setup||"")}</td><td class="l">${esc(t.acct||"")}</td><td class="jra"><button type="button" class="ibtn" data-ed="${esc(t.id)}" aria-label="Edit ${esc(t.sym)} trade">${edSvg}</button><button type="button" class="ibtn" data-del="${esc(t.id)}" aria-label="Delete ${esc(t.sym)} trade">${xSvg}</button></td></tr>${t.notes?`<tr class="jrn"><td class="l" colspan="11">${esc(t.notes)}</td></tr>`:""}`}).join("")}</tbody>`;
  el.querySelectorAll(".jrs").forEach(b=>b.onclick=()=>{const k=b.dataset.k;if(JRV.sort===k)JRV.dir*=-1;else{JRV.sort=k;JRV.dir=k==="sym"?1:-1}jrTable(jrFiltered())});
  el.querySelectorAll("[data-ed]").forEach(b=>b.onclick=()=>jrEdit(b.dataset.ed));
  el.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{const J=jrCfg(),i=J.trades.findIndex(t=>t.id===b.dataset.del);if(i<0)return;const t=J.trades[i];if(!confirm("Delete the "+t.sym+" trade"+(t.close?" closed "+t.close.replace("T"," "):"")+"?"))return;J.trades.splice(i,1);save();jrRender()});
  const prevSvg='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  const nextSvg='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
  pg.innerHTML=pages>1?`<button type="button" id="jr_pp"${JRV.page?"":" disabled"}>${prevSvg} Newer</button><span class="mut">Page ${JRV.page+1} of ${pages}</span><button type="button" id="jr_pn"${JRV.page<pages-1?"":" disabled"}>Older ${nextSvg}</button>`:"";
  if(pages>1){document.getElementById("jr_pp").onclick=()=>{JRV.page--;jrTable(jrFiltered())};document.getElementById("jr_pn").onclick=()=>{JRV.page++;jrTable(jrFiltered())}}}
/* add / edit trade */
function jrEdit(id){const J=jrCfg(),t=id?J.trades.find(x=>x.id===id):null,v=t||{side:"long",acct:J.f.acct||(J.accts[0]&&J.accts[0].name)||"",open:"",close:""};
  const f=(k,lab,o)=>{o=o||{};const val=v[k]==null?"":v[k];return`<label class="${o.cls||""}">${lab}${o.opt?" <span class=\"mut\">(optional)</span>":""}<input id="jre_${k}" ${o.type?`type="${o.type}"`:'type="number" step="any" inputmode="decimal"'} value="${esc(String(val))}"${o.list?` list="${o.list}"`:""}${o.ph?` placeholder="${esc(o.ph)}"`:""}${o.req?" required":""} autocomplete="off"></label>`};
  const xSvg='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  modal(`<div class="jre"><div class="vshd"><h3 id="jre_t">${t?"Edit trade":"Add trade"}</h3><span class="sp"></span><button type="button" class="ibtn" aria-label="Close" onclick="closeM()">${xSvg}</button></div>
<form id="jre_f" novalidate><div class="frm">${f("sym","Symbol",{type:"text",list:"jre_syms",req:1,ph:"e.g. ES, EURUSD, AAPL"})}<label>Side<select id="jre_side"><option value="long"${v.side!=="short"?" selected":""}>Long (buy)</option><option value="short"${v.side==="short"?" selected":""}>Short (sell)</option></select></label>
${f("open","Opened",{type:"datetime-local",opt:1})}${f("close","Closed",{type:"datetime-local",ph:"leave empty if still open"})}
${f("qty","Quantity (units, lots or contracts)")}${f("pv","Point value ($ per 1.0 move per unit)",{opt:1,ph:"1"})}${f("entry","Entry price")}${f("exit","Exit price")}${f("stop","Stop price",{opt:1})}${f("fees","Fees and commission ($)",{opt:1})}
${f("pnl","P\u0026L override ($)",{opt:1,ph:"use if your broker\u2019s figure differs"})}${f("acct","Account",{type:"text",list:"jre_accts",opt:1})}${f("setup","Setup",{type:"text",list:"jre_setups",opt:1,ph:"e.g. Breakout"})}${f("tags","Tags",{type:"text",opt:1,ph:"comma separated, e.g. FOMO, late entry"})}</div>
<label class="jrnotes">Notes <span class="mut">(optional)</span><textarea id="jre_notes" rows="3" maxlength="2000">${esc(v.notes||"")}</textarea></label>
<datalist id="jre_syms">${(typeof SYMS!=="undefined"?SYMS:[]).slice(0,400).map(s=>`<option value="${esc(s[0])}">`).join("")}</datalist><datalist id="jre_accts">${jrAcctNames().map(n=>`<option value="${esc(n)}">`).join("")}</datalist><datalist id="jre_setups">${jrSetups().map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
<p class="cnote" id="jre_calc" role="status" aria-live="polite"></p><p class="vsmsg err" id="jre_err" role="alert"></p>
<div class="row jrbtns"><button type="button" onclick="closeM()">Cancel</button><button type="submit" class="pri">${t?"Save changes":"Add trade"}</button></div></form></div>`);
  const box=MD.querySelector(".box");if(box)box.setAttribute("aria-labelledby","jre_t");
  const read=()=>{const o={id:t&&t.id,side:document.getElementById("jre_side").value,notes:document.getElementById("jre_notes").value};["sym","open","close","qty","pv","entry","exit","stop","fees","pnl","acct","setup","tags"].forEach(k=>o[k]=document.getElementById("jre_"+k).value);return o};
  const live=()=>{const c=jrClean(read()),out=document.getElementById("jre_calc");if(c.err){out.textContent="";return}const p=jrPnl(c.t),r=jrR(c.t),rk=jrRisk(c.t);out.textContent=p==null?(rk?"Risk at stop: "+jrAbs(rk)+". Add an exit price and close date when the trade is closed.":""):"P\u0026L "+jrUsd(p)+(r!=null?" \u00b7 "+jrRf(r):"")+(rk?" \u00b7 risk "+jrAbs(rk):"")};
  MD.querySelectorAll("#jre_f input,#jre_f select").forEach(i=>i.addEventListener("input",live));live();
  document.getElementById("jre_f").onsubmit=e=>{e.preventDefault();const c=jrClean(read()),er=document.getElementById("jre_err");if(c.err){er.textContent="Check the trade: "+c.err+".";return}
    if(!t&&J.trades.length>=JR_TRADES_MAX){er.textContent="The journal holds up to "+JR_TRADES_MAX+" trades. Export and remove old ones first.";return}
    if(t)Object.assign(t,c.t);else J.trades.push(c.t);save();closeM();jrBuild();toast(t?"Trade updated":"Trade added")};
  setTimeout(()=>{const s=document.getElementById("jre_sym");if(s)s.focus()},30)}
function jrExport(){const J=jrCfg();if(!J.trades.length){toast("No trades to export yet");return}const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob(["\ufeff"+jrToCsv(J.trades)],{type:"text/csv"}));a.download="vektor-journal-"+jrToday()+".csv";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
function jrImport(txt){const J=jrCfg(),r=jrFromCsv(txt);const seen=new Set(J.trades.map(t=>[t.sym,t.side,t.open,t.close,t.qty,t.entry,t.exit,t.pnl].join("|")));let add=0,dup=0;
  for(const t of r.trades){const k=[t.sym,t.side,t.open,t.close,t.qty,t.entry,t.exit,t.pnl].join("|");if(seen.has(k)){dup++;continue}if(J.trades.length>=JR_TRADES_MAX)break;seen.add(k);J.trades.push(t);add++}
  save();jrBuild();const msg=(add?"Imported "+add+" trade"+(add===1?"":"s"):"No trades imported")+(dup?", skipped "+dup+" already in the journal":"")+(r.errors.length?". "+r.errors.length+" row"+(r.errors.length===1?"":"s")+" had problems: "+r.errors.slice(0,3).join("; ")+(r.errors.length>3?"\u2026":""):".");
  toast(msg);return{add,dup,errors:r.errors}}
/* prop accounts */
function jrProps(){const el=document.getElementById("jr_propc");if(!el)return;const J=jrCfg();
  const bar=(v,max,cls,lab)=>{const p=max>0?Math.max(0,Math.min(1,v/max)):0;return`<div class="jrpb ${cls}" role="progressbar" aria-label="${esc(lab)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p*100)}"><span style="width:${(p*100).toFixed(1)}%"></span></div>`};
  const edSvg='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const card=a=>{const P=jrProp(a,J.trades),st={breached:["Rule broken","neg"],passed:["Target reached","pos"],active:["In progress",""]}[P.status];
    return`<div class="jrpa"><div class="jrch"><h4>${esc(a.name)}</h4><span class="jrst ${st[1]}">${st[0]}</span><span class="sp"></span><button type="button" class="ibtn" data-pe="${esc(a.name)}" aria-label="Edit ${esc(a.name)} rules">${edSvg}</button></div>
<div class="jrpk"><div><span class="k">Balance</span><b>${jrAbs(P.bal)}</b> <span class="${jrCls(P.profit)}">${jrUsd(P.profit)}</span></div><div><span class="k">Trading days</span><b>${P.nDays}${P.minDays?" / "+P.minDays:""}</b></div><div><span class="k">Today</span><b class="${jrCls(P.todayPnl)}">${jrUsd(P.todayPnl)}</b></div></div>
${P.tgt!=null?`<div class="jrpr"><span>Profit target ${esc(String(a.target))}% (${jrAbs(P.tgt,0)})</span><span>${P.toTarget>0?jrAbs(P.toTarget)+" to go":"reached"}</span></div>${bar(Math.max(0,P.profit),P.tgt,"g","Progress to profit target")}`:""}
${P.dLim!=null?`<div class="jrpr"><span>Daily loss limit ${esc(String(a.daily))}% (${jrAbs(P.dLim,0)})</span><span>${jrAbs(P.dailyRoom)} left today</span></div>${bar(Math.max(0,-P.todayPnl),P.dLim,"r","Today\u2019s loss against the daily limit")}`:""}
${P.ddLim!=null?`<div class="jrpr"><span>Max drawdown ${esc(String(a.maxdd))}% ${a.trailing?"trailing":"static"} (${jrAbs(P.ddLim,0)})</span><span>${jrAbs(P.ddRoom)} left \u00b7 floor ${jrAbs(P.floor)}</span></div>${bar(P.ddNow,P.ddLim,"r","Drawdown against the limit")}`:""}
${P.breach?`<p class="vsmsg err">${P.breach.rule==="daily"?"Daily loss limit":"Drawdown limit"} reached on ${esc(P.breach.day)} (${jrAbs(P.breach.v)}).</p>`:""}
<p class="cnote">${P.n} closed trade${P.n===1?"":"s"} logged to this account. Uses closed trades only; open positions and your firm\u2019s exact rule wording may differ.</p></div>`};
  el.innerHTML=`<div class="jrch"><h3>Prop challenge tracker</h3><span class="sp"></span><button type="button" id="jr_padd">+ Account</button></div>${J.accts.length?`<div class="jrpas">${J.accts.map(card).join("")}</div>`:`<p class="mut">Add your challenge or funded account with its rules (target, daily loss limit, drawdown, minimum days). Trades logged to that account name are checked against the rules.</p>`}`;
  document.getElementById("jr_padd").onclick=()=>jrAcctEdit();el.querySelectorAll("[data-pe]").forEach(b=>b.onclick=()=>jrAcctEdit(b.dataset.pe))}
function jrAcctEdit(name){const J=jrCfg(),a=name?J.accts.find(x=>x.name===name):null,v=a||{name:"",size:100000,target:8,daily:5,maxdd:10,trailing:false,mindays:0};
  const f=(k,lab,o)=>`<label>${lab}<input id="jra_${k}" ${o&&o.text?'type="text" maxlength="40"':'type="number" step="any" min="0" inputmode="decimal"'} value="${esc(String(v[k]==null?"":v[k]))}"></label>`;
  const xSvg='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  modal(`<div class="jre"><div class="vshd"><h3 id="jra_t">${a?"Edit account":"Add prop account"}</h3><span class="sp"></span><button type="button" class="ibtn" aria-label="Close" onclick="closeM()">${xSvg}</button></div>
<form id="jra_f" novalidate><div class="frm">${f("name","Account name",{text:1})}${f("size","Starting balance ($)")}${f("target","Profit target (%)")}${f("daily","Max daily loss (%)")}${f("maxdd","Max drawdown (%)")}${f("mindays","Minimum trading days")}</div>
<label class="chk"><input type="checkbox" id="jra_trailing"${v.trailing?" checked":""}> Trailing drawdown (from the highest closed balance)</label>
<p class="cnote">Leave a rule empty or 0 if your account doesn\u2019t have it. Limits are a % of the starting balance. Check your firm\u2019s rules; they may calculate limits differently (for example including open positions).</p><p class="vsmsg err" id="jra_err" role="alert"></p>
<div class="row jrbtns">${a?`<button type="button" id="jra_del" class="vsdanger">Delete account</button><span class="sp"></span>`:""}<button type="button" onclick="closeM()">Cancel</button><button type="submit" class="pri">${a?"Save":"Add account"}</button></div></form></div>`);
  const box=MD.querySelector(".box");if(box)box.setAttribute("aria-labelledby","jra_t");
  document.getElementById("jra_f").onsubmit=e=>{e.preventDefault();const g=k=>document.getElementById("jra_"+k).value,nm=g("name").trim().slice(0,40),er=document.getElementById("jra_err");
    if(!nm){er.textContent="Give the account a name.";return}if(J.accts.some(x=>x.name===nm&&x!==a)){er.textContent="There is already an account with that name.";return}
    const size=jrNum(g("size"));if(!size||size<=0){er.textContent="Starting balance must be above zero.";return}
    const o={name:nm,size,target:jrNum(g("target")),daily:jrNum(g("daily")),maxdd:jrNum(g("maxdd")),mindays:jrNum(g("mindays")),trailing:document.getElementById("jra_trailing").checked};
    if(a&&a.name!==nm)J.trades.forEach(t=>{if(t.acct===a.name)t.acct=nm});if(a)Object.assign(a,o);else J.accts.push(o);if(a&&J.f.acct===name)J.f.acct=nm;save();closeM();jrBuild()};
  const d=document.getElementById("jra_del");if(d)d.onclick=()=>{if(!confirm("Delete the account \u201c"+a.name+"\u201d? Its trades stay in the journal."))return;J.accts.splice(J.accts.indexOf(a),1);save();closeM();jrBuild()};
  setTimeout(()=>{const s=document.getElementById("jra_name");if(s)s.focus()},30)}
PAGE_HOOK.journal={enter(){jrBuild()},sub(){jrBuild()}};
addEventListener("resize",deb(()=>{if(document.documentElement.dataset.page==="journal")jrRender()},200));
