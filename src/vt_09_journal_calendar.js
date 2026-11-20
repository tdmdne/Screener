/* ---------- Journal & Prop Tracker: pure maths (no DOM) ----------
   Trades are entered by the user. P&L = (exit - entry) x quantity x point value x direction - fees,
   unless the user typed the P&L themselves. R = P&L / (|entry - stop| x quantity x point value). */
const JR_SETUP_MAX=40,JR_TRADES_MAX=5000;
function jrNum(v){if(v===""||v==null)return null;const n=typeof v==="number"?v:parseFloat(String(v).replace(/[, $]/g,""));return isFinite(n)?n:null}
function jrPnl(t){const m=jrNum(t.pnl);if(m!=null)return m;const e=jrNum(t.entry),x=jrNum(t.exit),q=jrNum(t.qty);if(e==null||x==null||q==null)return null;
  const pv=jrNum(t.pv)||1,f=jrNum(t.fees)||0,dir=t.side==="short"?-1:1;return (x-e)*q*pv*dir-f}
function jrRisk(t){const e=jrNum(t.entry),s=jrNum(t.stop),q=jrNum(t.qty);if(e==null||s==null||q==null||e===s)return null;return Math.abs(e-s)*q*(jrNum(t.pv)||1)}
function jrR(t){const p=jrPnl(t),r=jrRisk(t);return p==null||!r?null:p/r}
function jrDay(t){const d=String(t.close||t.open||"");return /^\d{4}-\d{2}-\d{2}/.test(d)?d.slice(0,10):null}
function jrSort(a){return a.slice().sort((x,y)=>String(x.close||x.open||"").localeCompare(String(y.close||y.open||"")))}
/* the closed trades with a known P&L, oldest first */
function jrClosed(trades){return jrSort(trades.filter(t=>jrPnl(t)!=null&&jrDay(t)))}
function jrStats(trades){const T=jrClosed(trades),n=T.length;const o={n,wins:0,losses:0,be:0,gw:0,gl:0,net:0,winRate:null,pf:null,avgWin:null,avgLoss:null,exp:null,avgR:null,nR:0,maxDD:0,maxDDPct:null,best:null,worst:null,winStreak:0,lossStreak:0,
  bySetup:{},byDay:{},byWeekday:[0,1,2,3,4,5,6].map(()=>({n:0,net:0})),bySymbol:{},bySide:{long:{n:0,net:0,wins:0},short:{n:0,net:0,wins:0}},curve:[]};
  let eq=0,peak=0,ws=0,ls=0,sumR=0;
  for(const t of T){const p=jrPnl(t),r=jrR(t),d=jrDay(t);o.net+=p;eq+=p;peak=Math.max(peak,eq);o.maxDD=Math.max(o.maxDD,peak-eq);o.curve.push({d,eq,p});
    if(p>0){o.wins++;o.gw+=p;ws++;ls=0}else if(p<0){o.losses++;o.gl+=-p;ls++;ws=0}else{o.be++;ws=0;ls=0}
    o.winStreak=Math.max(o.winStreak,ws);o.lossStreak=Math.max(o.lossStreak,ls);
    if(r!=null){sumR+=r;o.nR++}
    if(!o.best||p>jrPnl(o.best))o.best=t;if(!o.worst||p<jrPnl(o.worst))o.worst=t;
    const tags=(t.setup||"").split(",").map(s=>s.trim()).filter(Boolean);for(const g of(tags.length?tags:["(no setup)"])){const b=o.bySetup[g]||(o.bySetup[g]={n:0,net:0,wins:0,sumR:0,nR:0});b.n++;b.net+=p;if(p>0)b.wins++;if(r!=null){b.sumR+=r;b.nR++}}
    o.byDay[d]=(o.byDay[d]||0)+p;
    const wd=new Date(d+"T12:00:00").getDay();o.byWeekday[wd].n++;o.byWeekday[wd].net+=p;
    const sy=String(t.sym||"").toUpperCase()||"(none)";const bs=o.bySymbol[sy]||(o.bySymbol[sy]={n:0,net:0,wins:0});bs.n++;bs.net+=p;if(p>0)bs.wins++;
    const sd=o.bySide[t.side==="short"?"short":"long"];sd.n++;sd.net+=p;if(p>0)sd.wins++}
  if(n){o.winRate=o.wins/n;o.exp=o.net/n}if(o.wins)o.avgWin=o.gw/o.wins;if(o.losses)o.avgLoss=-o.gl/o.losses;o.pf=o.gl>0?o.gw/o.gl:(o.gw>0?Infinity:null);if(o.nR)o.avgR=sumR/o.nR;
  return o}
/* Prop-challenge progress for one account from its closed trades.
   Rules (all optional): target % profit, max daily loss % and max drawdown % of the starting balance (static, or trailing from the
   highest closed balance), minimum trading days. Only closed trades count; open positions are not included. */
function jrProp(acct,trades){const size=jrNum(acct.size)||0,T=jrClosed(trades.filter(t=>(t.acct||"")===(acct.name||"")));
  const pctOf=v=>{const x=jrNum(v);return x!=null&&x>0?size*x/100:null};
  const tgt=pctOf(acct.target),dLim=pctOf(acct.daily),ddLim=pctOf(acct.maxdd);
  let bal=size,peak=size,maxDD=0,breach=null,day=null,dayPnl=0,worstDay=0;const days={};
  for(const t of T){const p=jrPnl(t),d=jrDay(t);if(d!==day){day=d;dayPnl=0}dayPnl+=p;days[d]=(days[d]||0)+p;bal+=p;peak=Math.max(peak,bal);
    const dd=acct.trailing?peak-bal:size-bal;maxDD=Math.max(maxDD,dd);worstDay=Math.min(worstDay,days[d]);
    if(!breach&&dLim!=null&&-days[d]>=dLim-1e-9)breach={rule:"daily",day:d,v:-days[d]};
    if(!breach&&ddLim!=null&&dd>=ddLim-1e-9)breach={rule:"drawdown",day:d,v:dd}}
  const profit=bal-size,nDays=Object.keys(days).length,minDays=jrNum(acct.mindays)||0;
  const today=jrToday(),todayPnl=days[today]||0;
  const ddNow=acct.trailing?peak-bal:Math.max(0,size-bal);
  const passed=!breach&&tgt!=null&&profit>=tgt-1e-9&&nDays>=minDays;
  return{size,bal,profit,peak,tgt,dLim,ddLim,maxDD,ddNow,worstDay,nDays,minDays,todayPnl,breach,passed,n:T.length,
    status:breach?"breached":passed?"passed":"active",
    toTarget:tgt!=null?Math.max(0,tgt-profit):null,
    dailyRoom:dLim!=null?Math.max(0,dLim+Math.min(0,todayPnl)):null,
    ddRoom:ddLim!=null?Math.max(0,ddLim-ddNow):null,
    floor:ddLim!=null?(acct.trailing?peak-ddLim:size-ddLim):null}}
function jrToday(){const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}
/* CSV in our own column layout (export, then re-import or edit in a spreadsheet) */
const JR_COLS=["open","close","sym","side","qty","entry","exit","stop","fees","pv","pnl","acct","setup","tags","notes"];
const JR_HEAD=["date_open","date_close","symbol","side","quantity","entry","exit","stop","fees","point_value","pnl_override","account","setup","tags","notes"];
function jrCsvCell(v){const s=v==null?"":String(v);return /[",\n\r]/.test(s)||/^[=+\-@\t]/.test(s)&&isNaN(+s)?'"'+(/^[=+\-@\t]/.test(s)&&isNaN(+s)?"'":"")+s.replace(/"/g,'""')+'"':s}
function jrToCsv(trades){return [JR_HEAD.join(","),...jrSort(trades).map(t=>JR_COLS.map(k=>jrCsvCell(t[k])).join(","))].join("\r\n")+"\r\n"}
function jrParseCsv(txt){const rows=[];let row=[],cell="",q=false;for(let i=0;i<txt.length;i++){const c=txt[i];
    if(q){if(c==='"'){if(txt[i+1]==='"'){cell+='"';i++}else q=false}else cell+=c}
    else if(c==='"')q=true;else if(c===","){row.push(cell);cell=""}else if(c==="\n"||c==="\r"){if(c==="\r"&&txt[i+1]==="\n")i++;row.push(cell);rows.push(row);row=[];cell=""}else cell+=c}
  if(cell!==""||row.length){row.push(cell);rows.push(row)}return rows.filter(r=>r.some(x=>x.trim()!==""))}
function jrFromCsv(txt){const res={trades:[],errors:[]};if(typeof txt!=="string"||txt.length>5e6){res.errors.push("File is too large (5 MB max)");return res}
  const rows=jrParseCsv(txt.replace(/^\ufeff/,""));if(!rows.length){res.errors.push("The file is empty");return res}
  const head=rows[0].map(h=>h.trim().toLowerCase());const idx=JR_HEAD.map(h=>head.indexOf(h));
  if(idx[JR_HEAD.indexOf("symbol")]<0||idx[JR_HEAD.indexOf("side")]<0){res.errors.push("Missing columns: the first row must include at least symbol and side (export a journal to see the layout)");return res}
  rows.slice(1,1+JR_TRADES_MAX).forEach((r,i)=>{const t={};JR_COLS.forEach((k,j)=>{if(idx[j]>=0)t[k]=String(r[idx[j]]==null?"":r[idx[j]]).trim().replace(/^'(?=[=+\-@\t])/,"")});
    const v=jrClean(t);if(v.err)res.errors.push("Row "+(i+2)+": "+v.err);else res.trades.push(v.t)});return res}
/* validate and normalise one trade (from the form or a file) */
function jrClean(t){const side=String(t.side||"").toLowerCase();const o={id:t.id||vtNextId("t"),sym:String(t.sym||"").trim().toUpperCase().slice(0,24),
    side:side==="short"||side==="sell"||side==="s"?"short":side==="long"||side==="buy"||side==="l"?"long":"",open:jrDate(t.open),close:jrDate(t.close),
    qty:jrNum(t.qty),entry:jrNum(t.entry),exit:jrNum(t.exit),stop:jrNum(t.stop),fees:jrNum(t.fees),pv:jrNum(t.pv),pnl:jrNum(t.pnl),
    acct:String(t.acct||"").trim().slice(0,40),setup:String(t.setup||"").split(",").map(s=>s.trim()).filter(Boolean).slice(0,6).join(", ").slice(0,120),
    tags:String(t.tags||"").split(",").map(s=>s.trim()).filter(Boolean).slice(0,10).join(", ").slice(0,160),notes:String(t.notes||"").slice(0,2000)};
  if(!o.sym)return{err:"symbol is missing"};if(!o.side)return{err:"side must be long or short"};
  if(o.qty!=null&&o.qty<=0)return{err:"quantity must be above zero"};if(o.pv!=null&&o.pv<=0)return{err:"point value must be above zero"};
  if(o.close&&o.open&&o.close<o.open)return{err:"close time is before open time"};
  if(o.pnl==null&&o.exit!=null&&(o.entry==null||o.qty==null))return{err:"entry and quantity are needed to work out the P&L"};
  if(o.exit!=null&&!o.close)return{err:"a closed trade needs a close date"};
  return{t:o}}
function jrDate(v){const s=String(v||"").trim();if(!s)return"";const m=/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);if(!m)return"";const d=new Date(+m[1],+m[2]-1,+m[3]);
  if(d.getFullYear()!==+m[1]||d.getMonth()!==+m[2]-1||d.getDate()!==+m[3])return"";return m[1]+"-"+m[2]+"-"+m[3]+(m[4]?"T"+m[4]+":"+m[5]:"")}
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
  el.innerHTML=`<div class="pgw jr"><div class="pgh"><h2>Journal <span class="mut">\u0026</span> Prop Tracker</h2><span class="mut">Personal trade ledger and prop account rule monitor.</span><span class="sp"></span>
<div class="jrbtns"><button type="button" class="pri" id="jr_add">+ Log trade</button><button type="button" id="jr_imp">Import CSV\u2026</button><input type="file" id="jr_file" accept=".csv,text/csv" hidden><button type="button" id="jr_exp">Export CSV</button></div></div>
<div class="vcard jrf" role="group" aria-label="Filters"><label>Account<select id="jr_facct">${opt("","All accounts",J.f.acct)}${jrAcctNames().map(n=>opt(n,n,J.f.acct)).join("")}</select></label>
<label>Period<select id="jr_fper">${[["all","All time"],["week","This week"],["month","This month"],["30","Last 30 days"]].map(([v,n])=>opt(v,n,J.f.period)).join("")}</select></label>
<label>Side<select id="jr_fside">${opt("","Long and short",J.f.side)}${opt("long","Long only",J.f.side)}${opt("short","Short only",J.f.side)}</select></label>
<label>Setup<select id="jr_fsetup">${opt("","All setups",J.f.setup)}${jrSetups().map(n=>opt(n,n,J.f.setup)).join("")}</select></label></div>
<div class="jrkpis" id="jr_kpis"></div>
<div class="jrgrid"><div class="vcard jreq"><div class="jrch"><h3>Equity curve</h3><span class="mut" id="jr_eqnote"></span></div><canvas id="jr_eq" height="220" role="img" aria-label="Cumulative profit and loss by closed trade"></canvas><div id="jr_eq_empty" class="jr-empty-card" hidden><strong>No closed trades yet</strong><p>Your cumulative equity curve plots automatically as you log closed trades or practice in Bar Replay.</p><div class="jr-empty-acts"><button type="button" class="pri" id="jr_eq_add">+ Log your first trade</button><button type="button" id="jr_eq_imp">Import CSV</button><button type="button" id="jr_eq_bt">Practice in Bar Replay</button></div></div></div>
<div class="vcard jrcal"><div class="jrch"><h3>Daily P\u0026L</h3><span class="sp"></span><button type="button" class="ibtn" id="jr_mprev" aria-label="Previous month">${VT_IC.chevLeft}</button><b id="jr_mlab"></b><button type="button" class="ibtn" id="jr_mnext" aria-label="Next month">${VT_IC.chevRight}</button></div><div id="jr_cal"></div></div></div>
<div class="vcard" id="jr_propc"></div>
<div class="jrgrid"><div class="vcard"><h3>By setup</h3><div class="jrtw" tabindex="0" role="region" aria-label="Results by setup"><table class="ftbl" id="jr_setup"></table></div></div>
<div class="vcard"><h3>By weekday</h3><div id="jr_wd"></div><h3 class="jrh3b">By side</h3><div id="jr_side"></div></div></div>
<div class="vcard" id="jr_aic"></div>
<div class="vcard"><div class="jrch"><h3>Trades</h3><span class="mut" id="jr_cnt"></span></div><div class="jrtw" tabindex="0" role="region" aria-label="Trades"><table class="ftbl jrt" id="jr_tbl"></table></div><div class="jrpg" id="jr_pg"></div></div>
<p class="cnote">Results are calculated from what you entered. Past results don\u2019t predict future ones, and nothing here is financial advice.</p></div>`;
  const q=id=>document.getElementById(id);
  q("jr_add").onclick=()=>jrEdit();q("jr_imp").onclick=()=>q("jr_file").click();q("jr_exp").onclick=jrExport;
  if(q("jr_eq_add"))q("jr_eq_add").onclick=()=>jrEdit();if(q("jr_eq_imp"))q("jr_eq_imp").onclick=()=>q("jr_file").click();if(q("jr_eq_bt"))q("jr_eq_bt").onclick=()=>go("backtest");
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
function jrEq(st){const cv=document.getElementById("jr_eq"),note=document.getElementById("jr_eqnote"),emp=document.getElementById("jr_eq_empty");if(!cv)return;
  note.textContent=st.n?st.n+" closed trade"+(st.n===1?"":"s"):"";
  if(st.n<1){cv.hidden=true;if(emp)emp.hidden=false;cv.setAttribute("aria-label","Equity curve: no closed trades yet");return}
  cv.hidden=false;if(emp)emp.hidden=true;
  const w=cv.clientWidth||600,h=220,dpr=window.devicePixelRatio||1;
  cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);cv.style.height=h+"px";const g=cv.getContext("2d");g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);
  const css=getComputedStyle(document.documentElement),col=n=>css.getPropertyValue(n).trim()||"#888";
  const pts=[0,...st.curve.map(c=>c.eq)];
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
  if(!T.length){const hasAny=jrCfg().trades.length>0;el.innerHTML=`<tbody><tr><td class="l jrempty"><div class="jr-empty-card"><strong>${hasAny?"No matching trades":"No trades yet"}</strong><p>${hasAny?"Adjust the account, period, side, or setup filters to view your recorded trades.":"Log your first trade or import a CSV export to populate your equity curve, daily calendar, and prop rule telemetry."}</p>${hasAny?"":`<div class="jr-empty-acts"><button type="button" class="pri" id="jr_eadd">+ Log trade</button><button type="button" id="jr_eimp">Import CSV</button></div>`}</div></td></tr></tbody>`;pg.innerHTML="";const ea=document.getElementById("jr_eadd"),ei=document.getElementById("jr_eimp");if(ea)ea.onclick=()=>jrEdit();if(ei)ei.onclick=()=>{const f=document.getElementById("jr_file");if(f)f.click()};return}
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
/* ---------- Calendar & News page ----------
   Economic calendar via server-side cached /api/calendar (Forex Factory feed) and Yahoo Finance RSS headlines via /api/news.
   Timezone-accurate rendering with selectable timezone, 3-bar impact indicator, and beat/miss actual highlighting. */
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
    const r=await fetch("/api/calendar"+(force?"?force=1":""),{cache:"no-store"});
    if(!r.ok)throw new Error("HTTP "+r.status);
    const j=await r.json();
    if(j&&j.ok&&Array.isArray(j.events)){CAL.ev=j.events.slice().sort((a,b)=>a.t-b.t);CAL.at=Date.now();CAL.src=j.source==="forexfactory"?"Forex Factory":"Unavailable";return}
    throw new Error("calendar unavailable");
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
function newsTicker(n){n=String(n||"").toUpperCase();if(!n)return null;const y=(typeof YFW!=="undefined"?YFW:[]).find(w=>w.n===n);if(y)return y.td;
  const m=/^([A-Z0-9]{2,10})(USDT|USDC|USD)$/.exec(n);if(m&&(typeof SYMS==="undefined"||SYMS.some(s=>s[0]===n&&s[1]==="CRY")||/USDT$/.test(n)))return m[1]+"-USD";
  if(/^[A-Z]{6}$/.test(n)&&typeof SYMS!=="undefined"&&SYMS.some(s=>s[0]===n&&s[1]==="FX"))return n+"=X";
  if(/^[A-Z][A-Z0-9.\-]{0,9}$/.test(n))return n;return null}
async function newsLoad(sym,force){const k=newsTicker(sym);if(!k||CAL.newsBusy[sym])return;const c=CAL.news[sym];if(!force&&c&&Date.now()-c.at<5*60e3){newsRender();return}
  CAL.newsBusy[sym]=1;newsRender();try{
    const r=await fetch("/api/news?symbol="+encodeURIComponent(k),{cache:"no-store"});
    if(!r.ok)throw new Error("HTTP "+r.status);
    const j=await r.json();
    if(j&&j.ok&&Array.isArray(j.items)){CAL.news[sym]={at:Date.now(),items:j.items,err:""};return}
    throw new Error("headlines unavailable");
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
