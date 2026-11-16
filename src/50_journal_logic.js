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
function jrClean(t){const side=String(t.side||"").toLowerCase();const o={id:t.id||("t"+Date.now().toString(36)+Math.random().toString(36).slice(2,7)),sym:String(t.sym||"").trim().toUpperCase().slice(0,24),
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
