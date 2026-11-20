// ---------- watchlist (your own symbols, separate from the screener list and from presets) ----------
const CUS={};
const guessM=n=>/=X$/.test(n)?"FX":/=F$/.test(n)?"FUT":/^\^/.test(n)?"IDX":/-USD$/.test(n)?"CRY":"STK";
const wlAll=()=>S.wlx.groups.flatMap(g=>g.syms);
// find a symbol by name: the screener universe first, otherwise a custom ticker (loaded from Yahoo by that name)
function symOf(n){const s=SYMS.find(x=>x[0]===n);if(s)return s;if(typeof vtEnsureSym==="function"){const cs=vtEnsureSym(n,false);if(cs)return cs}if(!wlAll().includes(n))return null;
const k=(isLive()?"L":"S")+n;let c=CUS[k];
if(!c)c=CUS[k]=[n,guessM(n),null,0,1,.01,n,"","yf",n,1];
if(isLive()){const d=LIVE[n+"|1D"];if(d&&d.length)c[2]=d[d.length-1].c}
return c}
function wlData(n){const s=symOf(n);if(!s)return{};const d=candles(s,"1D"),L=d&&d.length?d[d.length-1]:null,Pv=d&&d.length>1?d[d.length-2]:null;
const meta=(typeof VT_EDGE_META!=="undefined"&&VT_EDGE_META&&(typeof VT_EDGE_META.get==="function"?VT_EDGE_META.get(n):VT_EDGE_META[n]))||null;
const last=L?L.c:(meta&&meta.last>0?meta.last:(s[2]>0?s[2]:null));
const chg=L&&Pv?(L.c/Pv.c-1)*100:(meta&&typeof meta.pct==="number"&&isFinite(meta.pct)?meta.pct:null);
const vol=L&&L.v?L.v:(meta&&meta.vol>0?meta.vol:(s[3]>0?s[3]:null));
return{last,chg,vol}}
function renderWL(){const el=document.getElementById("wl"),W=S.wlx;if(!el)return;
el.className="wl"+(W.open?"":" shut");
let h=`<div class="wlh"><span class="wlt" onclick="wlTog()">${W.open?VT_IC.chevDown:VT_IC.chevRight} WATCHLIST</span><span class="sp"></span><button class="ib" onclick="wlAddM()">+ Symbol</button><button class="ib" onclick="wlSecM()">+ Section</button>${typeof S.wlStarter==="undefined"&&Array.isArray(W.groups)&&W.groups[0]&&W.groups[0].syms&&W.groups[0].syms.join()==="BTCUSDT,EURUSD,SPY,XAUUSD,NVDA"?`<button type="button" id="vtWlClear" class="ib vt-wl-clear">Clear starter list</button>`:""}</div>`;
if(W.open){h+=`<div class="wlb"><div class="wc"><span>Symbol</span><span>Last</span><span>Chg%</span><span>Vol</span><span></span></div>`;
W.groups.forEach(g=>{h+=`<div class="wg"><span class="wgn" onclick="wlGTog('${g.id}')">${g.open?VT_IC.chevDown:VT_IC.chevRight} ${esc(g.name)}</span><span>${g.syms.length}</span><span class="sp"></span><button class="ib" title="Add a symbol here" aria-label="Add a symbol to ${esc(g.name)}" onclick="wlAddM('${g.id}')">${VT_IC.plus}</button><button class="ib" title="Rename section" aria-label="Rename ${esc(g.name)}" onclick="wlSecM('${g.id}')">${VT_IC.edit}</button><button class="ib" title="Delete section" aria-label="Delete ${esc(g.name)}" onclick="wlDelG('${g.id}')">${VT_IC.x}</button></div>`;
if(g.open){if(!g.syms.length)h+=`<div class="wl-empty mut">No symbols yet. Press + to add some.</div>`;
g.syms.forEach(n=>{const d=wlData(n),q=esc(n);
h+=`<div class="wr ${n===S.chart.sym?"sel":""}" data-s="${q}" onclick="openChart('${q}')"><span class="wn">${q}</span><span class="wv">${d.last==null?"…":fp(d.last)}</span><span class="wv ${d.chg==null?"":d.chg<0?"dn":"up"}">${d.chg==null?"…":(d.chg>0?"+":"")+d.chg.toFixed(2)+"%"}</span><span class="wv mut">${d.vol?fm(d.vol):"–"}</span><button class="ib x" title="Remove" aria-label="Remove ${q}" onclick="event.stopPropagation();wlRm('${g.id}','${q}')">${VT_IC.x}</button></div>`})}});
h+=`</div>`}
el.innerHTML=h}
function wlTog(){S.wlx.open=!S.wlx.open;save();renderWL()}
function wlGTog(id){const g=S.wlx.groups.find(x=>x.id===id);if(g){g.open=!g.open;save();renderWL()}}
function wlRm(gid,n){const g=S.wlx.groups.find(x=>x.id===gid);if(g){g.syms=g.syms.filter(x=>x!==n);save();renderWL();wlStarSync();if(typeof vtSyncWsView==="function")vtSyncWsView()}}
function wlDelG(id){const g=S.wlx.groups.find(x=>x.id===id);if(!g)return;
if(g.syms.length&&!confirm("Delete the section “"+g.name+"” and its "+g.syms.length+" symbol(s)?"))return;
S.wlx.groups=S.wlx.groups.filter(x=>x.id!==id);if(!S.wlx.groups.length)S.wlx=WLD();save();renderWL();wlStarSync();if(typeof vtSyncWsView==="function")vtSyncWsView()}
function wlAddM(gid){const W=S.wlx;
modal(`<h3>Add to watchlist</h3><label>Symbols<input id="wl_s" placeholder="AAPL, MRNA, EURUSD, ES=F" autocomplete="off" autocapitalize="characters" onkeydown="if(event.key==='Enter')wlAdd()"></label><label>Section<select id="wl_g">${W.groups.map(g=>`<option value="${g.id}" ${g.id===gid?"selected":""}>${esc(g.name)}</option>`).join("")}</select></label><p class="mut">Anything already in the screener is matched by name. For other stocks and ETFs just type the ticker. Otherwise use the Yahoo format: ES=F (futures), EURUSD=X (forex), BTC-USD (crypto), ^GSPC (indices). Separate several with commas or spaces.</p><div class="row"><span class="sp"></span><button onclick="closeM()">Cancel</button><button class="pri" onclick="wlAdd()">Add</button></div>`);
setTimeout(()=>{const i=document.getElementById("wl_s");if(i)i.focus()},30)}
function wlAdd(){const g=S.wlx.groups.find(x=>x.id===document.getElementById("wl_g").value)||S.wlx.groups[0],have=new Set(wlAll());
document.getElementById("wl_s").value.toUpperCase().split(/[\s,;]+/).map(x=>x.replace(/[^A-Z0-9.\-=^_]/g,"")).filter(Boolean).forEach(n=>{if(!have.has(n)){have.add(n);g.syms.push(n)}});
save();closeM();render();wlStarSync();if(typeof vtSyncWsView==="function")vtSyncWsView()}
function wlSecM(id){const g=id&&S.wlx.groups.find(x=>x.id===id);
modal(`<h3>${g?"Rename section":"New section"}</h3><label>Name<input id="wl_n" maxlength="30" value="${g?esc(g.name):""}" onkeydown="if(event.key==='Enter')wlSecSave('${id||""}')"></label><div class="row"><span class="sp"></span><button onclick="closeM()">Cancel</button><button class="pri" onclick="wlSecSave('${id||""}')">Save</button></div>`);
setTimeout(()=>{const i=document.getElementById("wl_n");if(i)i.focus()},30)}
function wlSecSave(id){const n=document.getElementById("wl_n").value.trim();if(!n)return;
if(id){const g=S.wlx.groups.find(x=>x.id===id);if(g)g.name=n}else S.wlx.groups.push({id:"g"+Date.now(),name:n,open:true,syms:[]});
save();closeM();renderWL()}
// star button in the chart header: add/remove the charted symbol (goes in the first section)
function mktStatus(){
  const now=new Date();
  const ny=new Date(now.toLocaleString("en-US",{timeZone:"America/New_York"}));
  const day=ny.getDay(),h=ny.getHours(),m=ny.getMinutes();
  const isWeekend=day===0||day===6;
  const openH=9,openM=30,closeH=16,closeM=0;
  const mins=h*60+m,openMins=openH*60+openM,closeMins=closeH*60+closeM;
  const isOpen=!isWeekend&&mins>=openMins&&mins<closeMins;
  const dayNames=["SUN","MON","TUE","WED","THU","FRI","SAT"];
  let closeIn="";
  if(isOpen){const left=closeMins-mins;closeIn=`It'll close in ${Math.floor(left/60)} hours and ${left%60} minutes.`}
  else closeIn="Market is closed.";
  const pct=isOpen?Math.min(100,Math.round((mins-openMins)/(closeMins-openMins)*100)):0;
  modal(`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="width:10px;height:10px;border-radius:50%;background:${isOpen?"#089981":"#787b86"}"></span><b style="color:${isOpen?"#089981":"#787b86"}">${isOpen?"Market open":"Market closed"}</b></div>
<p style="margin:0 0 12px">${isOpen?"All's well — market is open. "+closeIn:closeIn}</p>
<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-size:12px;color:var(--mut)">${dayNames[day]}</span><div style="flex:1;height:6px;background:var(--line);border-radius:3px;position:relative"><div style="width:${pct}%;height:100%;background:#089981;border-radius:3px"></div><div style="position:absolute;left:${pct}%;top:-2px;width:2px;height:10px;background:#131722"></div></div><span style="font-size:12px;color:var(--mut)">17:00</span></div>
<p class="mut" style="font-size:12px;text-align:center;margin:8px 0 16px">Exchange timezone: New York (UTC-5)</p>
<hr style="border:none;border-top:1px solid var(--line);margin:12px 0">
<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="color:#e91e63;display:inline-flex">${VT_IC.pulse}</span><b style="color:#e91e63">Data updates once per second</b></div>
<p style="margin:0 0 12px">This is the limit on the current data sources. Prices may change more often on the exchange.</p>
<button onclick="closeM()" style="background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 16px">Close</button>`);
}
function wlStarSync(){const b=document.getElementById("wst");if(b){const on=wlAll().includes(S.chart.sym);b.innerHTML=on?VT_IC.starOn:VT_IC.starOff;b.setAttribute("aria-pressed",String(on))}}
function srt(id){S.sort=S.sort.id===id?{id,dir:-S.sort.dir}:{id,dir:id==="sym"?1:-1};save();render()}
const MD=document.getElementById("modal");
let ch=null,ch2=null;
function modal(h){MD.innerHTML=`<div class="ov" onclick="if(event.target===this)closeM()"><div class="box">${h}</div></div>`}
function closeM(){MD.innerHTML=""}
let toastT=0;function toast(t){const m=document.getElementById("msg");if(!m)return;m.textContent=t;clearTimeout(toastT);toastT=setTimeout(()=>{m.textContent=""},2200)}
const sel=(k,arr,v,lab)=>`<label>${lab}<select data-k="${k}">${arr.map(a=>{const[x,y]=Array.isArray(a)?a:[a,a];return`<option value="${x}" ${x==v?"selected":""}>${y}</option>`}).join("")}</select></label>`;
const num=(k,v,lab,mn,mx,st)=>`<label>${lab}<input data-k="${k}" data-n="1" type="number" min="${mn}" max="${mx}" step="${st||1}" value="${v}"></label>`;
function form(c){const t=c.type;let h="";
if(t==="vol"||t==="dv")h+=sel("per",[["1d","1 day"],["7d","7-day average"]],c.per,"Period");
if(t==="pct"||t==="cc"||t==="mac")h+=sel("tf",TFS,c.tf,"Timeframe");
if(t==="cc")h+=num("n",c.n,"Lookback (candles)",2,149)+sel("mode",[["abs","Absolute"],["exp","Expansion"]],c.mode,"Type")+sel("dir",[["bull","Bullish"],["bear","Bearish"]],c.dir,"Direction (expansion)")+num("min",c.min,"Show only above (%)",0,1000,.1);
if(t==="adr")h+=num("n",c.n,"Lookback (days)",2,100);
if(t==="mac"||t==="mat")h+=sel("ma",["EMA","SMA"],c.ma,"Type")+sel("len",[10,20,50,100,200],c.len,"Length");
if(t==="mat")h+=`<div class="mut">Timeframes</div><div class="tfs">${TFS.map(x=>`<label class="chk"><input type="checkbox" data-tf="${x}" ${c.tfs.includes(x)?"checked":""}>${x}</label>`).join("")}</div>`;
return h||`<p class="mut">No settings for this column.</p>`}
let ed=null;
function openEd(id){const c=S.cols.find(x=>x.id===id);ed=id;
modal(`<h3>${TY[c.type]}</h3>${form(c)}<div class="row"><button onclick="dupCol()">Duplicate</button><button onclick="delCol()">Delete</button><span class="sp"></span><button onclick="closeM()">Cancel</button><button class="pri" onclick="saveEd()">Save</button></div>`)}
function saveEd(){const c=S.cols.find(x=>x.id===ed);
MD.querySelectorAll("[data-k]").forEach(el=>{const k=el.dataset.k;c[k]=el.dataset.n?(parseFloat(el.value)||0):(isNaN(el.value)?el.value:Number(el.value))});
if(c.type==="mat"){const t=[...MD.querySelectorAll("[data-tf]")].filter(x=>x.checked).map(x=>x.dataset.tf);c.tfs=t.length?t:["1D"]}
if(c.type==="cc")c.n=Math.max(2,Math.min(149,c.n||8));
if(c.type==="adr")c.n=Math.max(2,Math.min(100,c.n||14));
save();closeM();render()}
function dupCol(){const i=S.cols.findIndex(x=>x.id===ed);S.cols.splice(i+1,0,Object.assign(clone(S.cols[i]),{id:"c"+Date.now()}));save();closeM();render()}
function delCol(){S.cols=S.cols.filter(x=>x.id!==ed);save();closeM();render()}
function openCols(){modal(`<h3>Columns</h3><div class="list">${S.cols.map(c=>`<div class="li"><label class="chk"><input type="checkbox" ${c.hide?"":"checked"} onchange="togCol('${c.id}')">${label(c)}</label><button onclick="openEd('${c.id}')" title="Edit column" aria-label="Edit ${esc(label(c))}">${VT_IC.gear}</button></div>`).join("")}</div><div class="row"><select id="addT">${Object.keys(TY).map(k=>`<option value="${k}">${TY[k]}</option>`).join("")}</select><button onclick="addCol()">Add</button></div><div class="row"><span class="sp"></span><button class="pri" onclick="closeM()">Done</button></div>`)}
function togCol(id){const c=S.cols.find(x=>x.id===id);c.hide=!c.hide;save();render()}
function addCol(){const t=document.getElementById("addT").value,c=mk("c"+Date.now(),t);S.cols.push(c);save();render();openEd(c.id)}
const VT_PRESET_GUIDE={
  P1:"Strictest filter — requires full EMA alignment across timeframes plus measurable price expansion.",
  P2:"Strong trend filter — requires EMA alignment together with a directional price change.",
  P3:"Moderate filter — requires a directional price change with partial EMA alignment.",
  P4:"Broad directional filter — includes any ticker showing a directional price change.",
  P5:"Unfiltered scan — displays all available markets in the selected asset class."
};
function vtScrF(){return S.scrF=Object.assign({rsiMin:"",rsiMax:"",ema:"any",rvolMin:"",atrMin:"",atrMax:"",chgMin:"",chgMax:"",pxMin:"",pxMax:"",minScore:"",p1Sound:false},S.scrF||{})}
function vtApplyScrFilters(R){
  const f=vtScrF();
  const hasAny=f.rsiMin!==""||f.rsiMax!==""||f.ema!=="any"||f.rvolMin!==""||f.atrMin!==""||f.atrMax!==""||f.chgMin!==""||f.chgMax!==""||f.pxMin!==""||f.pxMax!==""||f.minScore!=="";
  if(!hasAny)return R;
  const num=v=>v===""||v==null?null:(isFinite(+v)?+v:null);
  const rMin=num(f.rsiMin),rMax=num(f.rsiMax),rvMin=num(f.rvolMin),aMin=num(f.atrMin),aMax=num(f.atrMax),cMin=num(f.chgMin),cMax=num(f.chgMax),pMin=num(f.pxMin),pMax=num(f.pxMax),ms=num(f.minScore);
  const tf=(typeof VT_EVC!=="undefined"&&VT_EVC[S.evcTf||"H"]&&VT_EVC[S.evcTf||"H"].e)||"1H";
  return R.filter(r=>{
    const s=r&&r.s;if(!s)return false;
    const px=+s[2];
    if(pMin!=null&&!(px>=pMin))return false;
    if(pMax!=null&&!(px<=pMax))return false;
    const a=candles(s,tf);
    if((rMin!=null||rMax!=null||f.ema!=="any"||aMin!=null||aMax!=null||rvMin!=null)&&a&&a.length>=20){
      const cl=a.map(x=>x.c);
      if(rMin!=null||rMax!=null){
        const rv=rsiArr(cl,14);const last=rv[rv.length-1];
        if(last==null||(rMin!=null&&last<rMin)||(rMax!=null&&last>rMax))return false;
      }
      if(f.ema!=="any"){
        const e20=emaArr(cl,20),e50=emaArr(cl,50);
        const cL=cl[cl.length-1],v20=e20[e20.length-1],v50=e50[e50.length-1];
        if(f.ema==="bull"&&!(cL>v20&&v20>v50))return false;
        if(f.ema==="bear"&&!(cL<v20&&v20<v50))return false;
      }
      if(aMin!=null||aMax!=null){
        const at=atrArr(a,14);const lv=at[at.length-1];const ap=lv!=null&&px>0?(lv/px)*100:null;
        if(ap==null||(aMin!=null&&ap<aMin)||(aMax!=null&&ap>aMax))return false;
      }
      if(rvMin!=null){
        const vs=a.slice(-20).map(x=>+x.v||0),avg=vs.reduce((p,q)=>p+q,0)/(vs.length||1);
        const curV=+a[a.length-1].v||0;const rvol=avg>0?curV/avg:0;
        if(!(rvol>=rvMin))return false;
      }
    }
    if(cMin!=null||cMax!=null){
      const d1=candles(s,"1D");const chg=d1&&d1.length>1?(d1[d1.length-1].c/d1[d1.length-2].c-1)*100:null;
      if(chg==null||(cMin!=null&&chg<cMin)||(cMax!=null&&chg>cMax))return false;
    }
    if(ms!=null){
      const sc=typeof vektorScore==="function"?vektorScore(s,S.dir||"long",S.evcTf||"H"):null;
      const val=sc&&isFinite(sc.score)?sc.score:null;
      if(val==null||val<ms)return false;
    }
    return true;
  });
}
function scrSetM(){
  const mkts=Object.keys(MK);
  const layouts=[...Object.keys(BI),...Object.keys(P)];
  const f=vtScrF();
  const curPre=S.preset||"P5";
  const allCols=(S.cols||[]);
  modal(`<div class="vt-scrset vt-scrset-pro" role="dialog" aria-modal="true" aria-labelledby="scrset_h">
  <h3 id="scrset_h">Screener Settings &amp; Filter Builder</h3>
  <p class="mut" style="font-size:12.5px">Configure market scope, P1–P5 scan tiers, technical momentum filters, visible columns, and sorting preferences. Rule-based filters on past price data; not investment advice.</p>

  <div class="vt-ss-sec">
    <div class="vt-ss-sh">1. Market, Timeframe &amp; Preset (P1–P5)</div>
    <div class="g2">
      <label>Asset class<select id="ss_mkt">${mkts.map(k=>`<option value="${k}" ${S.mkt===k?"selected":""}>${MK[k]}</option>`).join("")}</select><small class="vt-hint">Choose which asset universe to scan (All, Crypto, Stocks, FX, Futures).</small></label>
      <label>Saved layout<select id="ss_lay"><option value="">Custom layout</option>${layouts.map(n=>`<option value="${esc(n)}" ${S.cur===n?"selected":""}>${esc(n)}</option>`).join("")}</select><small class="vt-hint">Load a built-in or saved column &amp; filter workspace.</small></label>
    </div>
    <div class="g2" style="margin-top:8px">
      <label>Timeframe level (H/M/L)<select id="ss_evc"><option value="H" ${(S.evcTf||"H")==="H"?"selected":""}>H (1H entry · 1D validation)</option><option value="M" ${S.evcTf==="M"?"selected":""}>M (15m entry · 1H validation)</option><option value="L" ${S.evcTf==="L"?"selected":""}>L (1m entry · 15m validation)</option></select><small class="vt-hint">Sets the entry and higher-timeframe candle intervals used for scanning.</small></label>
      <label>Scan direction<select id="ss_dir"><option value="long" ${(S.dir||"long")==="long"?"selected":""}>Long (Bullish alignment)</option><option value="short" ${S.dir==="short"?"selected":""}>Short (Bearish alignment)</option></select><small class="vt-hint">Evaluate EMA alignment and expansion for bullish or bearish setups.</small></label>
    </div>
    <div style="margin-top:8px">
      <label>Strictness tier (P1–P5)<select id="ss_pre" onchange="const g=document.getElementById('ss_pre_guide');if(g)g.textContent=VT_PRESET_GUIDE[this.value]||''">${Object.entries(PRESETS).map(([k,p])=>`<option value="${k}" ${curPre===k?"selected":""}>${k} — ${esc(p.desc)}</option>`).join("")}</select><small class="vt-hint" id="ss_pre_guide">${esc(VT_PRESET_GUIDE[curPre]||"")}</small></label>
    </div>
  </div>

  <div class="vt-ss-sec">
    <div class="vt-ss-sh">2. Technical &amp; Momentum Filters</div>
    <div class="g2">
      <label>RSI (14) range<div class="vt-rng"><input id="ss_rsimin" type="number" min="0" max="100" step="1" placeholder="Min (0)" value="${esc(String(f.rsiMin))}"><input id="ss_rsimax" type="number" min="0" max="100" step="1" placeholder="Max (100)" value="${esc(String(f.rsiMax))}"></div><small class="vt-hint">Filter tickers whose 14-period RSI sits inside this momentum zone.</small></label>
      <label>EMA alignment (20 / 50)<select id="ss_ema"><option value="any" ${f.ema==="any"?"selected":""}>Any alignment</option><option value="bull" ${f.ema==="bull"?"selected":""}>Bullish (Price &gt; EMA 20 &gt; EMA 50)</option><option value="bear" ${f.ema==="bear"?"selected":""}>Bearish (Price &lt; EMA 20 &lt; EMA 50)</option></select><small class="vt-hint">Require price and moving averages to align in the trend direction.</small></label>
    </div>
    <div class="g2" style="margin-top:8px">
      <label>Relative Volume (RVOL) min<input id="ss_rvol" type="number" min="0" step="0.1" placeholder="e.g. 1.5" value="${esc(String(f.rvolMin))}"><small class="vt-hint">Only show instruments trading above their 20-bar average volume.</small></label>
      <label>ATR / Volatility % range<div class="vt-rng"><input id="ss_atrmin" type="number" min="0" step="0.1" placeholder="Min %" value="${esc(String(f.atrMin))}"><input id="ss_atrmax" type="number" min="0" step="0.1" placeholder="Max %" value="${esc(String(f.atrMax))}"></div><small class="vt-hint">Filter by 14-bar average true range as a percentage of price.</small></label>
    </div>
    <div class="g2" style="margin-top:8px">
      <label>24h / Session change %<div class="vt-rng"><input id="ss_chgmin" type="number" step="0.5" placeholder="Min %" value="${esc(String(f.chgMin))}"><input id="ss_chgmax" type="number" step="0.5" placeholder="Max %" value="${esc(String(f.chgMax))}"></div><small class="vt-hint">Focus on instruments moving inside a specific daily percentage band.</small></label>
      <label>Price range ($)<div class="vt-rng"><input id="ss_pxmin" type="number" min="0" step="any" placeholder="Min $" value="${esc(String(f.pxMin))}"><input id="ss_pxmax" type="number" min="0" step="any" placeholder="Max $" value="${esc(String(f.pxMax))}"></div><small class="vt-hint">Exclude instruments below or above your preferred unit price.</small></label>
    </div>
    <div class="g2" style="margin-top:8px">
      <label>Minimum Vektor score (0–100)<input id="ss_mscore" type="number" min="0" max="100" step="1" placeholder="Any" value="${esc(String(f.minScore))}"><small class="vt-hint">Show only tickers meeting or exceeding this rule-based composite score.</small></label>
      <label>Default sort column<select id="ss_sort"><option value="sym" ${S.sort.id==="sym"?"selected":""}>Symbol (A–Z)</option>${allCols.map(c=>`<option value="${esc(c.id)}" ${S.sort.id===c.id?"selected":""}>${esc(label(c))}</option>`).join("")}</select><small class="vt-hint">Choose which metric orders the screener table by default.</small></label>
    </div>
  </div>

  <div class="vt-ss-sec">
    <div class="vt-ss-sh">3. Column Visibility (${allCols.filter(c=>!c.hide).length} of ${allCols.length} shown)</div>
    <small class="vt-hint" style="display:block;margin-bottom:6px">Toggle which data columns appear in the screener table.</small>
    <div class="vt-col-grid">${allCols.map(c=>`<label class="vt-col-chk"><input type="checkbox" data-sscol="${esc(c.id)}" ${c.hide?"":"checked"}><span>${esc(label(c))}</span></label>`).join("")}</div>
  </div>

  <div class="vt-ss-sec">
    <div class="vt-ss-sh">4. Liquidity, Display &amp; Alert Preferences</div>
    <div class="g2">
      <label>Account size ($)<input id="ss_acct" type="number" min="100" step="1000" value="${S.acct||300000}"><small class="vt-hint">Used with the liquidity multiplier to set your minimum dollar-volume cutoff.</small></label>
      <label>Liquidity multiplier (×)<input id="ss_mult" type="number" min="1" step="1" value="${S.mult||10}"><small class="vt-hint">Requires daily dollar volume ≥ Account Size × Multiplier when enabled.</small></label>
    </div>
    <div class="g2" style="margin-top:8px">
      <label>Rows per page (paged mode)<select id="ss_rows">${[20,50,100].map(n=>`<option value="${n}" ${(S.rows||20)===n?"selected":""}>${n} rows</option>`).join("")}</select><small class="vt-hint">Number of tickers shown per page when continuous scrolling is off.</small></label>
      <label style="justify-content:center"><span class="chk" style="margin:0"><input type="checkbox" id="ss_p1snd" ${f.p1Sound?"checked":""}> Play sound on new P1 scan match</span><small class="vt-hint">Plays a subtle chime when a ticker enters tier P1 during live scans.</small></label>
    </div>
    <label class="chk" style="margin-top:6px"><input type="checkbox" id="ss_dv" ${S.dvOn?"checked":""}> Filter by minimum dollar volume ($${((S.acct||300000)*(S.mult||10)).toLocaleString()} cutoff)</label>
    <label class="chk"><input type="checkbox" id="ss_nv" ${S.hideNV?"checked":""}> Hide unquoted / zero-volume tickers</label>
    <label class="chk"><input type="checkbox" id="ss_virt" ${S.virt!==false?"checked":""}> Continuous virtualized scrolling on desktop (uncheck for pagination)</label>
  </div>

  <div class="row" style="flex-wrap:wrap;margin-top:8px">
    <button type="button" onclick="openCols()">Edit Column Formulas</button>
    <button type="button" onclick="closeM();miniToggle()">${S.mini&&S.mini.on?"Switch to Table View":"Switch to Mini-Charts"}</button>
    <button type="button" onclick="saveCur()">Save Layout</button>
    <button type="button" onclick="xfer()">Export / Import</button>
  </div>
  <div class="row" style="margin-top:8px"><button type="button" onclick="S.scrF={};pick('Higher timeframe scan');closeM()">Reset Defaults</button><span class="sp"></span><button type="button" onclick="closeM()">Cancel</button><button type="button" class="pri" onclick="scrSetSave()">Apply Settings</button></div></div>`);
}
function scrSetSave(){
  const g=id=>document.getElementById(id);
  const lay=g("ss_lay").value;
  if(lay&&lay!==S.cur){pick(lay)}
  S.mkt=g("ss_mkt").value||"ALL";
  S.evcTf=g("ss_evc").value||"H";
  S.dir=g("ss_dir").value||"long";
  S.preset=g("ss_pre").value||"P5";
  S.rows=+g("ss_rows").value||20;
  S.acct=Math.max(100,+g("ss_acct").value||300000);
  S.mult=Math.max(1,+g("ss_mult").value||10);
  S.dvOn=!!g("ss_dv").checked;
  S.hideNV=!!g("ss_nv").checked;
  S.virt=!!g("ss_virt").checked;
  const sortId=g("ss_sort")&&g("ss_sort").value;
  if(sortId&&sortId!==S.sort.id)S.sort={id:sortId,dir:sortId==="sym"?1:-1};
  S.scrF={
    rsiMin:(g("ss_rsimin")||{}).value||"",
    rsiMax:(g("ss_rsimax")||{}).value||"",
    ema:(g("ss_ema")||{}).value||"any",
    rvolMin:(g("ss_rvol")||{}).value||"",
    atrMin:(g("ss_atrmin")||{}).value||"",
    atrMax:(g("ss_atrmax")||{}).value||"",
    chgMin:(g("ss_chgmin")||{}).value||"",
    chgMax:(g("ss_chgmax")||{}).value||"",
    pxMin:(g("ss_pxmin")||{}).value||"",
    pxMax:(g("ss_pxmax")||{}).value||"",
    minScore:(g("ss_mscore")||{}).value||"",
    p1Sound:!!(g("ss_p1snd")&&g("ss_p1snd").checked)
  };
  document.querySelectorAll("[data-sscol]").forEach(cb=>{
    const col=(S.cols||[]).find(c=>c.id===cb.dataset.sscol);
    if(col)col.hide=!cb.checked;
  });
  S.page=0;
  save();closeM();render();toast("Screener settings applied");
}
const STEP={"1s":1,"5s":5,"10s":10,"15s":15,"30s":30,"45s":45,"1m":60,"3m":180,"5m":300,"15m":900,"30m":1800,"45m":2700,"1H":3600,"2H":7200,"3H":10800,"4H":14400,"12H":43200,"1D":86400,"1W":604800,"1M":2592000,"3M":7776000,"6M":15552000,"12M":31536000};
const INT={"1s":"1S","5s":"5S","10s":"10S","15s":"15S","30s":"30S","45s":"45S","1m":"1","3m":"3","5m":"5","15m":"15","30m":"30","45m":"45","1H":"60","2H":"120","3H":"180","4H":"240","12H":"720","1D":"D","1W":"W","1M":"M","3M":"3M","6M":"6M","12M":"12M"};
const TVS={EURUSD:"FX:EURUSD",GBPUSD:"FX:GBPUSD",USDJPY:"FX:USDJPY",AUDUSD:"FX:AUDUSD",USDCAD:"FX:USDCAD",NZDUSD:"FX:NZDUSD",ES:"CME_MINI:ES1!",NQ:"CME_MINI:NQ1!",CL:"NYMEX:CL1!",GC:"COMEX:GC1!",ZN:"CBOT:ZN1!","6E":"CME:6E1!",AAPL:"NASDAQ:AAPL",NVDA:"NASDAQ:NVDA",TSLA:"NASDAQ:TSLA",AMD:"NASDAQ:AMD",PLTR:"NASDAQ:PLTR",SMCI:"NASDAQ:SMCI",MARA:"NASDAQ:MARA",SOFI:"NASDAQ:SOFI",US30:"TVC:DJI",DE40:"TVC:DEU40",UK100:"TVC:UKX",BTCUSD:"BITSTAMP:BTCUSD",USOIL:"TVC:USOIL"};
const emaArr=(a,len)=>{if(!Array.isArray(a)||!a.length)return[];const k=2/(len+1);let e=null;return a.map(x=>{if(!isFinite(x))return null;e=e===null?x:x*k+e*(1-k);return e})};
const IND={ema:"EMA",sma:"SMA",bb:"Bollinger Bands",vol:"Volume",rsi:"RSI",atr:"ATR"};
const IL=d=>IND[d.t]+(d.t==="vol"?"":" "+d.len);
const smaArr=(a,n)=>a.map((_,i)=>i<n-1?null:a.slice(i-n+1,i+1).reduce((x,y)=>x+y,0)/n);
const atrArr=(a,n)=>{const tr=a.map((d,i)=>i?Math.max(d.h-d.l,Math.abs(d.h-a[i-1].c),Math.abs(d.l-a[i-1].c)):d.h-d.l);return smaArr(tr,n)};
function rsiArr(a,n){const o=a.map(()=>null);let g=0,l=0;for(let i=1;i<a.length;i++){const d=a[i]-a[i-1],u=Math.max(d,0),w=Math.max(-d,0);
if(i<=n){g+=u/n;l+=w/n}else{g=(g*(n-1)+u)/n;l=(l*(n-1)+w)/n}
if(i>=n)o[i]=l===0?100:100-100/(1+g/l)}return o}
function vols(s,tf){const a=candles(s,tf);return Array.isArray(a)?a.map(x=>x.v||0):[]}
function killCharts(){vtChartMeta=null;[ch,ch2].forEach(c=>{if(c)c.remove()});ch=ch2=null}
function wcagLum(hex){const c=hex.replace("#","");const lin=x=>{const v=parseInt(x,16)/255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*lin(c.slice(0,2))+0.7152*lin(c.slice(2,4))+0.0722*lin(c.slice(4,6))}
function wcagContrast(fg,bg){const l1=wcagLum(fg),l2=wcagLum(bg);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)}
function contrastText(bg){const black="#131722",white="#f4f4f5";return wcagContrast(black,bg)>=wcagContrast(white,bg)?black:white}
function pal(){const cs=getComputedStyle(document.documentElement),v=k=>cs.getPropertyValue(k).trim(),C=S.chart,b=C.bg;
const dk=h=>{const n=parseInt(String(h).slice(1),16);return((n>>16&255)*.299+(n>>8&255)*.587+(n&255)*.114)<128};
const D={bg:"#121316",tx:"#a1a1aa",gr:"#27272a"},Lt={bg:"#ffffff",tx:"#71717a",gr:"#e4e4e7"};
return b==="dark"?D:b==="light"?Lt:b==="custom"?Object.assign({},dk(C.bgCol)?D:Lt,{bg:C.bgCol}):{bg:v("--bg"),tx:v("--mut"),gr:v("--line")}}
function markSel(){document.querySelectorAll("#t tbody tr[data-s],#wl .wr[data-s]").forEach(tr=>tr.classList.toggle("sel",tr.dataset.s===S.chart.sym))}
function openChart(sym,tf){if(typeof vtEnsureSym==="function")vtEnsureSym(sym,true);S.chart.sym=sym;if(tf)S.chart.tf=tf;save();
const _ok=sym+"|"+S.chart.tf;if(typeof isLive==="function"&&isLive()&&typeof vtCanUseEdge==="function"&&vtCanUseEdge()&&LIVE[_ok]&&LIVE[_ok].length&&Date.now()-(LT[_ok]||0)>60000&&typeof vtBackfillChart==="function"){if(typeof vtSetChartGap==="function")vtSetChartGap(sym,S.chart.tf,true);vtBackfillChart(sym,S.chart.tf)}
drawChart();markSel();
if(typeof vtCanUseEdge==="function"&&vtCanUseEdge()&&typeof vtSyncChartFeed==="function"){vtSyncChartFeed(sym,S.chart.tf)}else{const cs=symOf(sym);if(cs&&cs[8]==="bn")bnKlineStart(sym,S.chart.tf);else if(cs&&(cs[1]==="STK"||cs[1]==="ETF"))fhSubscribe(sym)}
const row=document.querySelector(`#t tbody tr[data-s="${sym}"]`);
if(row)row.scrollIntoView({behavior:"smooth",block:"center"});
if(getComputedStyle(document.querySelector(".ws")).gridTemplateColumns.split(" ").length<2)document.getElementById("cp").scrollIntoView({behavior:"smooth",block:"start"})}
let vtLastPlotT={};
function updateLiveBar(sym,tf,incomingBucket){
  if(!ch||!MS||S.chart.sym!==sym||S.chart.tf!==tf)return;
  if(typeof vtIsChartPaused==="function"&&vtIsChartPaused(sym,tf))return;
  const a=candles(symOf(sym),tf);if(!a||!a.length)return;
  const last=a[a.length-1];
  if(!last||!(last.c>0)||!isFinite(last.t))return;
  const step=(typeof STEP!=="undefined"&&STEP[tf])||3600;
  if(incomingBucket!=null&&isFinite(incomingBucket)&&(Math.floor(incomingBucket)-last.t)>step*2){
    if(typeof vtSetChartGap==="function")vtSetChartGap(sym,tf,true);
    if(typeof vtBackfillChart==="function")vtBackfillChart(sym,tf);
    return;
  }
  const k=sym+"|"+tf;
  if(vtLastPlotT[k]&&last.t<vtLastPlotT[k])return;
  vtLastPlotT[k]=last.t;
  const o=last.o!=null?last.o:last.c;
  const bar={time:last.t,open:o,high:Math.max(last.h||o,o,last.c),low:Math.min(last.l||o,o,last.c),close:last.c};
  try{MS.update(bar)}catch(e){}
  const q=document.getElementById("cpx");if(q&&last.c>0){const t=fp(last.c);if(q.textContent!==t){q.textContent=t;if(typeof vtPxWatch==="function")vtPxWatch()}}
}
let vtChartMeta=null,vtHistGuard=0;
function vtBuildChartData(s,tf,C,d1,rawA){
  const st=STEP[tf]||3600,now=Math.floor(Date.now()/1000/st)*st;
  const byT=new Map();
  const src=Array.isArray(rawA)?rawA:[];
  for(let i=0;i<src.length;i++){
    const b=src[i];
    if(!b||!(b.c>0)||!isFinite(b.c))continue;
    const t=b.t!=null&&isFinite(b.t)&&b.t>0?Math.floor(b.t):now-(src.length-1-i)*st;
    byT.set(t,Object.assign({},b,{t}));
  }
  const a=[...byT.values()].sort((x,y)=>x.t-y.t);
  const T=i=>a[i]?a[i].t:now;
  const cl=a.map(x=>x.c);
  const fxo=(s[1]==="FX"||s[1]==="CFD")&&/^(1D|1W|1M)$/.test(tf);
  const D=a.map((x,i)=>{const q=fxo&&i?a[i-1].c:x.o!=null&&isFinite(x.o)?x.o:i?a[i-1].c:x.c;const hi=isFinite(x.h)?x.h:Math.max(q,x.c),lo=isFinite(x.l)?x.l:Math.min(q,x.c);return{time:x.t,open:q,high:Math.max(hi,q,x.c),low:Math.min(lo,q,x.c),close:x.c}});
  const pts=arr=>{
    if(!Array.isArray(arr)||!D.length)return[];
    const out=[];
    const lim=Math.min(arr.length,D.length);
    for(let i=0;i<lim;i++){
      const y=arr[i];
      if(y!=null&&isFinite(y))out.push({time:D[i].time,value:y});
    }
    return out;
  };
  if(C.colorPrev&&D.length>1){
    const prevC=d1&&d1.length>1?d1[d1.length-2].c:D[0].close;
    D.forEach(d=>{if(d.close>=prevC){d.color=C.upBody}else{d.color=C.dnBody}});
  }
  return{a,st,T,cl,pts,D};
}
function vtApplyHistoryPrepend(sym,tf,added){
  try{
    if(!(added>0)||!sym||!tf)return;
    const s=symOf(sym);if(!s)return;
    const a=candles(s,tf);if(!a||!a.length)return;
    if(S&&S.chart&&S.chart.sym===sym&&S.chart.tf===tf&&ch&&document.getElementById("cv")){
      if(typeof VSUI!=="undefined"&&VSUI&&VSUI.ser&&VSUI.ser.length){
        let prevRg=null;try{prevRg=ch.timeScale().getVisibleLogicalRange()}catch(_e){}
        const preserveRange=prevRg&&isFinite(prevRg.from)&&isFinite(prevRg.to)?{from:prevRg.from+added,to:prevRg.to+added}:null;
        drawChart(preserveRange?{preserveRange}:undefined);
      }else if(vtChartMeta&&vtChartMeta.sym===sym&&vtChartMeta.tf===tf&&(vtChartMeta.candleSer||MS)){
        let prevRg=null;try{prevRg=ch.timeScale().getVisibleLogicalRange()}catch(_e){}
        const C=S.chart,d1=candles(s,"1D"),B=vtBuildChartData(s,tf,C,d1,a);
        vtHistGuard=1;
        try{
          if(vtChartMeta.overlaySer){
            if(vtChartMeta.overlayType==="bars")vtChartMeta.overlaySer.setData(B.D);
            else vtChartMeta.overlaySer.setData(B.D.map(x=>({time:x.time,value:x.close})));
          }
          if(vtChartMeta.candleSer)vtChartMeta.candleSer.setData(B.D);
          if(vtChartMeta.prevLine){
            const pc=d1&&d1.length>1?d1[d1.length-2].c:null;
            if(pc)vtChartMeta.prevLine.setData([{time:B.T(0),value:pc},{time:B.T(B.a.length-1),value:pc}]);
          }
          for(const item of vtChartMeta.indSeries){
            if(item.kind==="ema")item.ser.setData(B.pts(emaArr(B.cl,item.d.len)));
            else if(item.kind==="sma")item.ser.setData(B.pts(smaArr(B.cl,item.d.len)));
            else if(item.kind==="bb"){
              const m=smaArr(B.cl,item.d.len),sd=B.cl.map((_,i)=>i<item.d.len-1?null:Math.sqrt(B.cl.slice(i-item.d.len+1,i+1).reduce((q,x)=>q+(x-m[i])**2,0)/item.d.len));
              [1,-1].forEach((g,idx)=>{if(item.sers[idx])item.sers[idx].setData(B.pts(m.map((x,i)=>x==null?null:x+g*2*sd[i])))});
            }else if(item.kind==="vol"){
              item.ser.setData(vols(s,tf).map((x,i)=>({time:B.T(i),value:x,color:(B.D[i].close>=B.D[i].open?C.upBody:C.dnBody)+"66"})));
            }
          }
          if(vtChartMeta.rsiSer){
            const r=C.ind.find(d=>d.t==="rsi");
            if(r)vtChartMeta.rsiSer.setData(B.pts(rsiArr(B.cl,r.len)));
          }
          if(typeof G!=="undefined"&&G){G={a:B.a,st:B.st,tt:B.a.map((_,i)=>B.T(i))}}
          if(typeof SC!=="undefined"&&SC&&SC.dw&&SC.dw.s&&SC.dw.s[0]===sym){
            const inds=C.ind.filter(d=>!d.hidden&&(d.t==="ema"||d.t==="sma"||d.t==="rsi")).map(d=>({d,v:d.t==="ema"?emaArr(B.cl,d.len):d.t==="sma"?smaArr(B.cl,d.len):rsiArr(B.cl,d.len)}));
            SC.dw={s,a:B.a,T:B.T,inds,vol:vols(s,tf),i:Math.min(B.a.length-1,(SC.dw.i||0)+added)};
            if(typeof scDW==="function")scDW();
          }
          if(prevRg&&isFinite(prevRg.from)&&isFinite(prevRg.to)){
            const nextRg={from:prevRg.from+added,to:prevRg.to+added};
            if(ch&&typeof ch.timeScale==="function")ch.timeScale().setVisibleLogicalRange(nextRg);
            if(ch2&&typeof ch2.timeScale==="function")ch2.timeScale().setVisibleLogicalRange(nextRg);
          }
        }catch(e){console.error("vtApplyHistoryPrepend main error:",e)}
        finally{vtHistGuard=0}
      }
    }
    if(typeof SC!=="undefined"&&SC&&SC.chB&&SC.serB&&SC.keyB===sym+"|"+tf&&document.getElementById("cvB")){
      const B2=vtBars(s,tf);
      if(B2){
        let prevRgB=null;try{prevRgB=SC.chB.timeScale().getVisibleLogicalRange()}catch(_e){}
        SC._histGuard=1;
        try{
          SC.serB.setData(B2.D);
          const cl2=B2.a.map(x=>x.c),pts2=arr=>arr.map((y,i)=>y==null?null:{time:B2.T(i),value:y}).filter(Boolean);
          if(Array.isArray(SC.indSeries)){
            for(const it of SC.indSeries){
              it.ser.setData(pts2(it.d.t==="ema"?emaArr(cl2,it.d.len):smaArr(cl2,it.d.len)));
            }
          }
          SC.barsB=B2;
          if(prevRgB&&isFinite(prevRgB.from)&&isFinite(prevRgB.to)){
            SC.chB.timeScale().setVisibleLogicalRange({from:prevRgB.from+added,to:prevRgB.to+added});
          }
        }catch(e){console.error("vtApplyHistoryPrepend paneB error:",e)}
        finally{SC._histGuard=0}
      }
    }
  }catch(e){console.error("vtApplyHistoryPrepend error:",e);vtHistGuard=0;if(typeof SC!=="undefined"&&SC)SC._histGuard=0}
}
const VT_CHART_TYPES=[
  {id:"candles",label:"Candles",ic:'<path d="M7 4v16M17 4v16"/><rect x="5" y="8" width="4" height="8" rx=".6" fill="currentColor"/><rect x="15" y="7" width="4" height="6" rx=".6"/>'},
  {id:"hollow",label:"Hollow Candles",ic:'<path d="M7 4v4M7 16v4M17 4v3M17 13v7"/><rect x="5" y="8" width="4" height="8" rx=".6"/><rect x="15" y="7" width="4" height="6" rx=".6"/>'},
  {id:"bars",label:"OHLC Bars",ic:'<path d="M7 5v14M4 9h3M7 15h3M17 4v16M14 13h3M17 7h3"/>'},
  {id:"line",label:"Line",ic:'<path d="M3 16l5-5 4 3 9-9"/>'},
  {id:"area",label:"Area",ic:'<path d="M3 16l5-5 4 3 9-9v14H3z" fill="currentColor" fill-opacity=".18"/><path d="M3 16l5-5 4 3 9-9"/>'},
  {id:"heikin",label:"Heikin Ashi",ic:'<path d="M7 5v14M17 4v16"/><rect x="5" y="9" width="4" height="6" rx=".8" fill="currentColor"/><rect x="15" y="6" width="4" height="9" rx=".8" fill="currentColor"/>'}
];
function vtToHeikinAshi(D){
  const out=[];
  for(let i=0;i<D.length;i++){
    const b=D[i];
    const hc=(b.open+b.high+b.low+b.close)/4;
    const ho=i===0?(b.open+b.close)/2:(out[i-1].open+out[i-1].close)/2;
    const hh=Math.max(b.high,ho,hc);
    const hl=Math.min(b.low,ho,hc);
    out.push({time:b.time,open:ho,high:hh,low:hl,close:hc});
  }
  return out;
}
function vtChartTypeBtnHTML(cur,fnName,btnId){
  const ct=VT_CHART_TYPES.find(x=>x.id===(cur||"candles"))||VT_CHART_TYPES[0];
  return `<div style="position:relative;display:inline-flex"><button type="button" id="${btnId}" class="vt-ctype-btn" onclick="${fnName}(event)" title="Chart style: ${ct.label}" aria-label="Chart style: ${ct.label}" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ct.ic}</svg><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><div id="${btnId}_menu" class="vt-pop-ov vt-ctype-menu" role="menu" style="display:none"></div></div>`;
}
function vtTogChartTypeMenu(ev){
  if(ev)ev.stopPropagation();
  const btn=document.getElementById("vt_ctype_btn"),m=document.getElementById("vt_ctype_btn_menu");
  if(!btn||!m)return;
  const open=m.style.display==="block";
  if(open){m.style.display="none";btn.setAttribute("aria-expanded","false");return}
  const cur=S.chart.type||"candles";
  m.innerHTML=VT_CHART_TYPES.map(t=>`<button type="button" role="menuitem" class="vt-pop-item vt-ctype-item ${cur===t.id?"on":""}" onclick="vtSetChartType('${t.id}')"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${t.ic}</svg><span>${t.label}</span></button>`).join("");
  const r=btn.getBoundingClientRect();
  m.style.position="fixed";m.style.top=Math.round(r.bottom+6)+"px";m.style.left=Math.max(8,Math.min(window.innerWidth-190,Math.round(r.left)))+"px";
  m.style.display="block";btn.setAttribute("aria-expanded","true");
}
function vtSetChartType(t){
  S.chart.type=t;save();
  const m=document.getElementById("vt_ctype_btn_menu");if(m)m.style.display="none";
  drawChart();
}
function vtSyncUndoBtns(){
  const u=typeof UNDO!=="undefined"&&UNDO.length>0,r=typeof REDO!=="undefined"&&REDO.length>0;
  ["vt_undo_btn","bt_undo_btn"].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=!u});
  ["vt_redo_btn","bt_redo_btn"].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=!r});
}
function drawChart(opts){try{const _opts=opts||{};killCharts();const C=S.chart,cp=document.getElementById("cp");if(!cp)return;
if(!SYMS.length){cp.innerHTML=`<p class="mut vt-skel" role="status">Loading markets…</p>`;return}
let s=symOf(C.sym);if(!s){s=SYMS[0];C.sym=s[0]}
const tv=s[7]||TVS[s[0]]||s[0],hasR=C.ind.some(d=>d.t==="rsi");
const rawCandles=candles(s,C.tf);
const d1=candles(s,"1D"),pc=d1&&d1.length>1?(d1[d1.length-1].c/d1[d1.length-2].c-1)*100:null;
const cpxVal=(rawCandles&&rawCandles.length&&rawCandles[rawCandles.length-1].c!=null)?rawCandles[rawCandles.length-1].c:(d1&&d1.length&&d1[d1.length-1].c!=null?d1[d1.length-1].c:s[2]);
if(cpxVal!=null&&isFinite(cpxVal))s[2]=cpxVal;
const qt=(cpxVal!=null?` <b id="cpx">${fp(cpxVal)}</b>`:"")+(pc!=null?` <span class="pill ${pc<0?"b":""}" style="min-width:0">${pc>0?"+":""}${pc.toFixed(2)}%</span>`:"");
cp.innerHTML=`<div class="cpb"><div class="row top"><button type="button" class="vt-symbtn" onclick="syOpen()" title="Search symbol (start typing or Ctrl+K)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><span>${esc(s[0])}</span><span class="mut" style="font-weight:500">${esc(MK[s[1]]||s[1])}</span></button>${qt}${C.showMktStatus!==false?`<button onclick="mktStatus()" title="Market status" aria-label="Market status" style="background:none;border:none;cursor:pointer">${VT_IC.pulse}</button>`:""}<div style="position:relative">${tfHTML()}</div>${vtChartTypeBtnHTML(C.type,"vtTogChartTypeMenu","vt_ctype_btn")}<button type="button" id="vt_undo_btn" class="vt-ur-btn" onclick="doUndo()" title="Undo drawing (Ctrl+Z)" aria-label="Undo drawing" ${typeof UNDO!=="undefined"&&UNDO.length?"":"disabled"}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg></button><button type="button" id="vt_redo_btn" class="vt-ur-btn" onclick="doRedo()" title="Redo drawing (Ctrl+Y)" aria-label="Redo drawing" ${typeof REDO!=="undefined"&&REDO.length?"":"disabled"}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg></button><span class="sp"></span><button id="wst" class="star" onclick="wlStar()" title="Add to or remove from your watchlist" aria-label="Toggle watchlist">${wlAll().includes(s[0])?VT_IC.starOn:VT_IC.starOff}</button><button onclick="indM()">Indicators</button><button onclick="alertsM()" title="Price alerts">Alerts</button><button onclick="setM()">Settings</button><div style="position:relative"><button type="button" id="vt_chmore_btn" onclick="vtTogChartMore(event)" title="More chart actions (Templates, Scripts, Locate)" aria-label="More chart actions" aria-haspopup="menu"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg></button><div id="vt_chmore" class="vt-pop-ov" style="display:none;position:fixed;background:var(--glass-bg,var(--bg));border:1px solid var(--glass-border,var(--line));border-radius:8px;min-width:196px;z-index:1050;box-shadow:0 16px 40px rgba(0,0,0,.45);padding:4px 0"></div></div><div style="position:relative"><button onclick="snapMenu(event)" title="Snapshot" aria-label="Snapshot">${VT_IC.cam}</button><div id="snapdrop" class="vt-pop-ov" style="display:none;position:fixed;background:var(--glass-bg,var(--bg));border:1px solid var(--glass-border,var(--line));border-radius:8px;min-width:154px;z-index:1050;box-shadow:0 16px 40px rgba(0,0,0,.45);padding:4px 0"><div class="vt-pop-item" style="padding:8px 12px;cursor:pointer" onclick="snapDownload()">Download image</div><div class="vt-pop-item" style="padding:8px 12px;cursor:pointer" onclick="snapCopy()">Copy image</div><div class="vt-pop-item" style="padding:8px 12px;cursor:pointer" onclick="snapOpen()">Open in new tab</div></div></div><button onclick="resetLive()" title="Reset chart view" aria-label="Reset chart view">${VT_IC.refresh}</button></div><div class="cw"><div class="tbar" id="tb">${tbHTML()}</div><div class="cm"><div id="cv"></div>${hasR?`<div id="cv2"></div>`:""}<div id="dsel"></div><div id="vt_favbar_host"></div><div id="timebar" style="display:flex;justify-content:flex-end;align-items:center;min-height:24px;padding:4px 8px;font-size:14px;font-weight:600;color:var(--mut);border-top:1px solid var(--line);background:var(--bg)"></div></div></div><p class="mut">${isLive()?"Live market feed.":"Connecting to market feed…"} Indicators are calculated on these candles.</p></div>`;
const cvEl=document.getElementById("cv");if(!cvEl)return;
if(!window.LightweightCharts){cvEl.innerHTML=`<p class="mut">The chart library didn’t load.</p>`;return}
const p=pal(),L=window.LightweightCharts,T0="rgba(0,0,0,0)";
const TZ_OFF={"ny":-5,"utc":0,"lon":0,"par":1,"ber":1,"tok":9,"sha":8,"sgp":8,"hkg":8,"syd":10,"dub":4,"mos":3,"sao":-3,"chi":-6,"den":-7,"la":-8};
const tzOff=(C.tz&&TZ_OFF[C.tz]!=null)?TZ_OFF[C.tz]:0;
const op=m=>({autoSize:true,handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:true},handleScale:{axisPressedMouseMove:true,mouseWheel:true,pinch:true},
crosshair:{mode:C.xhMode==="magnet"?L.CrosshairMode.Magnet:L.CrosshairMode.Normal,vertLine:{color:C.xhCol||p.tx,style:+C.xhStyle||0,labelVisible:C.xhLabels!==false},horzLine:{color:C.xhCol||p.tx,style:+C.xhStyle||0,labelVisible:C.xhLabels!==false}},
layout:{background:{type:"solid",color:C.bg==="custom"&&C.bgCol?C.bgCol:p.bg},textColor:C.txtCol||p.tx,fontSize:+C.fs||12},
grid:{vertLines:{visible:C.showGridV!==false,color:C.gridV||p.gr},horzLines:{visible:C.showGridH!==false,color:C.gridH||p.gr}},
localization:{timeFormatter:t=>{
  const d=new Date((t+tzOff*3600)*1000);
  const days=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dow=C.dowLabels?days[d.getUTCDay()]+" ":"";
  const dd=d.getUTCDate(),mm=d.getUTCMonth(),yy=String(d.getUTCFullYear()).slice(2);
  let date="";
  if(C.dateFmt==="mdy")date=months[mm]+" "+dd+", '"+yy;
  else if(C.dateFmt==="iso")date=d.getUTCFullYear()+"-"+String(mm+1).padStart(2,"0")+"-"+String(dd).padStart(2,"0");
  else date=dow+dd+" "+months[mm]+" '"+yy;
  let hh=d.getUTCHours(),mi=String(d.getUTCMinutes()).padStart(2,"0");
  if(C.timeFmt==="12"){const ap=hh>=12?"PM":"AM";hh=hh%12||12;return date+" "+hh+":"+mi+" "+ap}
  return date+" "+String(hh).padStart(2,"0")+":"+mi;
}},
timeScale:{timeVisible:C.tf!=="1D",secondsVisible:false,borderVisible:true,borderColor:C.scBorderCol||p.gr},
rightPriceScale:Object.assign({borderVisible:C.scBorder!==false,borderColor:C.scBorderCol||p.gr,visible:C.scalePlace!=="left"},m?{mode:+C.scMode||0,autoScale:C.scAuto!==false,invertScale:!!C.scInv,scaleMargins:{top:0.3,bottom:0.1}}:{}),
leftPriceScale:{visible:C.scalePlace==="left",borderVisible:C.scBorder!==false},
watermark:{visible:C.wm==="show",text:s[0]+", "+C.tf,color:(C.wmCol||"#787882")+"40",fontSize:48,horzAlign:"center",vertAlign:"center"}});
if(!rawCandles||!rawCandles.length){const ek=ERR[s[0]+"|"+C.tf];if(ek&&typeof vtChartErr==="function"){vtChartErr(cvEl,ek);return}cvEl.innerHTML=`<p class="mut vt-skel" role="status">Loading candles…</p>`;try{need(s,C.tf,true)}catch(_e){}return}
ch=L.createChart(cvEl,op(true));
const a=rawCandles,{st,T,cl,pts,D}=vtBuildChartData(s,C.tf,C,d1,a);
const meta={sym:s[0],tf:C.tf,overlaySer:null,overlayType:C.type,candleSer:null,prevLine:null,indSeries:[],rsiSer:null};
const prec=s[2]<10?4:2,pF={type:"price",precision:prec,minMove:s[2]<10?0.0001:0.01};
const so={priceLineVisible:C.pLine,lastValueVisible:C.pLabel,priceLineColor:C.pLineCol||"",priceFormat:pF};
if(C.type==="line"){const os=ch.addLineSeries(Object.assign({color:C.lineCol||"#2962ff",lineWidth:C.lineW||2},so));os.setData(D.map(x=>({time:x.time,value:x.close})));ms(os);meta.overlaySer=os;meta.candleSer=os}
else if(C.type==="area"){const lc=C.lineCol||"#2962ff";const os=ch.addAreaSeries(Object.assign({lineColor:lc,lineWidth:C.lineW||2,topColor:lc+"55",bottomColor:lc+"05"},so));os.setData(D.map(x=>({time:x.time,value:x.close})));ms(os);meta.overlaySer=os;meta.candleSer=os}
else if(C.type==="bars"){const os=ch.addBarSeries(Object.assign({upColor:C.upBody,downColor:C.dnBody},so));os.setData(D);ms(os);meta.overlaySer=os;meta.candleSer=os}
else if(C.type==="heikin"){const cser=ch.addCandlestickSeries(Object.assign({upColor:C.upBody,downColor:C.dnBody,borderVisible:C.showBorder,borderUpColor:C.upBorder,borderDownColor:C.dnBorder,wickVisible:C.showWick,wickUpColor:C.upWick,wickDownColor:C.dnWick},so));cser.setData(vtToHeikinAshi(D));ms(cser);meta.candleSer=cser}
else{const h=C.type==="hollow";const cser=ch.addCandlestickSeries(Object.assign({upColor:C.showBody&&!h?C.upBody:T0,downColor:C.showBody?C.dnBody:T0,borderVisible:C.showBorder,borderUpColor:C.upBorder,borderDownColor:C.dnBorder,wickVisible:C.showWick,wickUpColor:C.upWick,wickDownColor:C.dnWick},so));cser.setData(D);ms(cser);meta.candleSer=cser}
// previous day close line
if(C.prevClose==="line"||C.prevClose==="val"){
  const pc=d1&&d1.length>1?d1[d1.length-2].c:null;
  if(pc){const pl=ch.addLineSeries({color:"#787b86",lineWidth:1,lineStyle:2,priceLineVisible:false,lastValueVisible:C.prevClose==="val",crosshairMarkerVisible:false});pl.setData([{time:T(0),value:pc},{time:T(a.length-1),value:pc}]);meta.prevLine=pl}
}
// plus button on price scale: TradingView-style hover "+" (see vtPlusAttach), attached in vtAfterDraw
const ls=(col,w)=>ch.addLineSeries({color:col,lineWidth:w||2,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
C.ind.filter(d=>!d.hidden&&d.t!=="atr").forEach(d=>{try{
if(d.t==="ema"){const sr=ls(d.col,d.w||2);sr.setData(pts(emaArr(cl,d.len)));meta.indSeries.push({d,kind:"ema",ser:sr})}
else if(d.t==="sma"){const sr=ls(d.col,d.w||2);sr.setData(pts(smaArr(cl,d.len)));meta.indSeries.push({d,kind:"sma",ser:sr})}
else if(d.t==="bb"){const m=smaArr(cl,d.len),sd=cl.map((_,i)=>i<d.len-1?null:Math.sqrt(cl.slice(i-d.len+1,i+1).reduce((q,x)=>q+(x-m[i])**2,0)/d.len));
const bbs=[1,-1].map(g=>{const sr=ls(d.col,1);sr.setData(pts(m.map((x,i)=>x==null?null:x+g*2*sd[i])));return sr});meta.indSeries.push({d,kind:"bb",sers:bbs})}
else if(d.t==="vol"){const vh=ch.addHistogramSeries({priceFormat:{type:"volume"},priceScaleId:"",lastValueVisible:false,priceLineVisible:false});vh.priceScale().applyOptions({scaleMargins:{top:.8,bottom:0}});
vh.setData(vols(s,C.tf).map((x,i)=>({time:T(i),value:x,color:(D[i].close>=D[i].open?C.upBody:C.dnBody)+"66"})));meta.indSeries.push({d,kind:"vol",ser:vh})}}catch(e){console.error("ind error:",e)}});
const cv2El=hasR?document.getElementById("cv2"):null;
if(hasR&&cv2El){try{ch2=L.createChart(cv2El,op(false));const r=C.ind.find(d=>d.t==="rsi"),rs=ch2.addLineSeries({color:r.col,lineWidth:2,priceLineVisible:false,crosshairMarkerVisible:false});rs.setData(pts(rsiArr(cl,r.len)));meta.rsiSer=rs;
[70,30].forEach(v=>rs.createPriceLine({price:v,color:p.tx,lineWidth:1,lineStyle:2,axisLabelVisible:false}));
let busy=0;const sy=(x,y)=>{try{if(!x||!y||typeof x.timeScale!=="function"||typeof y.timeScale!=="function"||!rs||!document.getElementById("cv2"))return;const xts=x.timeScale();if(!xts||typeof xts.subscribeVisibleLogicalRangeChange!=="function")return;xts.subscribeVisibleLogicalRangeChange(rg=>{try{if(rg&&!busy&&typeof y.timeScale==="function"){busy=1;y.timeScale().setVisibleLogicalRange(rg);busy=0}}catch(_e){busy=0}})}catch(_e){}};sy(ch,ch2);sy(ch2,ch)}catch(e){console.error("rsi pane error:",e)}}
vtChartMeta=meta;
const cw=cvEl.clientWidth,nb=cw?Math.max(60,Math.min(Math.max(1,a.length-1),Math.round(cw/7))):110;
const initRange=_opts.preserveRange&&isFinite(_opts.preserveRange.from)&&isFinite(_opts.preserveRange.to)?_opts.preserveRange:{from:a.length-Math.round(nb*0.7),to:a.length+Math.round(nb*0.3)};
vtHistGuard=1;
try{
  if(ch&&typeof ch.timeScale==="function")ch.timeScale().setVisibleLogicalRange(initRange);
  if(ch2&&typeof ch2.timeScale==="function")ch2.timeScale().setVisibleLogicalRange(initRange);
}catch(e){console.error("setVisibleLogicalRange error:",e)}
finally{vtHistGuard=0}
try{
  const tsMain=ch&&typeof ch.timeScale==="function"?ch.timeScale():null;
  const cvHost=document.getElementById("cv");
  const activeSer=meta.candleSer||MS;
  if(tsMain&&typeof tsMain.subscribeVisibleLogicalRangeChange==="function"&&activeSer&&cvHost){
    tsMain.subscribeVisibleLogicalRangeChange(rg=>{
      try{
        if(!rg||vtHistGuard)return;
        if(!ch||!(meta.candleSer||MS)||!document.getElementById("cv"))return;
        if(typeof vtCheckHistoryScroll==="function")vtCheckHistoryScroll(s[0],C.tf,rg);
      }catch(_e){}
    });
  }
}catch(e){console.error("subscribeVisibleLogicalRangeChange error:",e)}
try{if(ch&&typeof ch.priceScale==="function")ch.priceScale("right").applyOptions({autoScale:true})}catch(_e){}
vtLastPlotT[s[0]+"|"+C.tf]=D.length?D[D.length-1].time:0;
try{initDraw(a,T,st)}catch(e){console.error("initDraw error:",e)}
try{if(typeof vtRenderFavBars==="function")vtRenderFavBars()}catch(_e){}
if(typeof vtAfterDraw==="function"){try{vtAfterDraw(s,a,T)}catch(e){console.error(e)}}
if(typeof vtRenderGapBadge==="function"){try{vtRenderGapBadge()}catch(e){}}
if(typeof vtPrefetchAdjacent==="function"){try{vtPrefetchAdjacent(s,C.tf)}catch(e){}}
// TradingView-style collapsible vertical indicator stack with active indicator count pill
if(C.indTitles!==false&&C.ind.length&&cvEl.parentElement){
  try{
    const topPos="6px";
    const leftPad=C.scalePlace==="left"?"72px":"8px";
    const collapsed=!!C.indCollapsed;
    const idv=document.createElement("div");
    idv.id="vt_ind_legend";
    idv.className="vt-ind-legend"+(collapsed?" collapsed":"");
    idv.style.top=topPos;
    idv.style.left=leftPad;
    const rowsHtml=C.ind.map(d=>{
      let valStr="";
      try{
        const vals=d.t==="ema"?emaArr(cl,d.len):d.t==="sma"?smaArr(cl,d.len):d.t==="rsi"?rsiArr(cl,d.len):null;
        if(vals&&vals.length){const lv=vals[vals.length-1];if(lv!=null)valStr=d.t==="rsi"?lv.toFixed(1):fp(lv)}
      }catch(_e){}
      const nm=esc((IND[d.t]||d.t)+(d.len?" "+d.len:""));
      const did=esc(d.id);
      return `<div class="vt-ind-row" data-indid="${did}"><span class="vt-ind-dot" aria-hidden="true" style="background:${d.hidden?"#64748b":esc(d.col)}"></span><span class="vt-ind-name" style="${d.hidden?"opacity:.45":""}">${nm}</span>${valStr?`<b class="vt-ind-val" style="color:${esc(d.col)}">${esc(valStr)}</b>`:`<b class="vt-ind-val" style="color:${esc(d.col)}"></b>`}<span class="vt-ind-acts"><button type="button" onclick="togInd('${did}')" title="${d.hidden?"Show":"Hide"}" aria-label="${d.hidden?"Show":"Hide"} ${nm}">${d.hidden?VT_IC.eyeOff:VT_IC.eyeOn}</button><button type="button" onclick="editInd('${did}')" title="Settings" aria-label="${nm} settings">${VT_IC.gear}</button><button type="button" onclick="rmInd('${did}')" title="Remove" aria-label="Remove ${nm}">${VT_IC.x}</button></span></div>`;
    }).join("");
    const togBtn=`<button type="button" class="vt-ind-tog" id="vt_ind_tog" onclick="togIndStack()" aria-expanded="${!collapsed}" aria-label="${collapsed?"Expand":"Collapse"} ${C.ind.length} chart indicators" title="${collapsed?"Show":"Collapse"} indicators (${C.ind.length})"><span class="vt-ind-cnt">${C.ind.length}</span>${collapsed?VT_IC.chevDown:VT_IC.up}</button>`;
    idv.innerHTML=`<div class="vt-ind-list">${rowsHtml}</div>${togBtn}`;
    idv.addEventListener("contextmenu",e=>{e.preventDefault();cvEl.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:e.clientX,clientY:e.clientY,button:2}))});
    cvEl.parentElement.appendChild(idv);
  }catch(e){console.error("ind legend error:",e)}
}
// ATR display in bottom right
if(C.ind.some(d=>d.t==="atr")&&cvEl.parentElement){
  try{
    const atrInd=C.ind.find(d=>d.t==="atr");
    const atrVal=atrArr(a,atrInd.len||14);
    const lastAtr=atrVal[atrVal.length-1];
    if(lastAtr!=null&&isFinite(lastAtr)){
      const atrEl=document.createElement("div");
      atrEl.style.cssText="position:absolute;bottom:80px;right:60px;background:#000;color:#fff;padding:4px 8px;border-radius:4px;font-size:12px;z-index:5;display:flex;gap:8px";
      atrEl.innerHTML=`<span>ATR</span><b>${lastAtr.toFixed(1)}</b>`;
      cvEl.parentElement.appendChild(atrEl);
    }
  }catch(e){console.error("atr display error:",e)}
}

const tb=document.getElementById("timebar");
if(tb){
  try{
    const tzMap={"ny":"America/New_York","utc":"UTC","lon":"Europe/London","par":"Europe/Paris","ber":"Europe/Berlin","tok":"Asia/Tokyo","sha":"Asia/Shanghai","sgp":"Asia/Singapore","hkg":"Asia/Hong_Kong","syd":"Australia/Sydney","dub":"Asia/Dubai","mos":"Europe/Moscow","sao":"America/Sao_Paulo","chi":"America/Chicago","den":"America/Denver","la":"America/Los_Angeles"};
    const workerCode=`self.onmessage=e=>{const{tz,fmt}=e.data;setInterval(()=>{const now=new Date();const t=now.toLocaleTimeString("en-GB",{hour12:fmt==="12",timeZone:tz,hour:"2-digit",minute:"2-digit",second:"2-digit"});self.postMessage(t)},1000)}`;
    const blob=new Blob([workerCode],{type:"application/javascript"});
    if(window.__tbw){try{window.__tbw.terminate()}catch(e){}}
    const wurl=URL.createObjectURL(blob),worker=new Worker(wurl);URL.revokeObjectURL(wurl);window.__tbw=worker;
    worker.onmessage=e=>{tb.textContent=e.data+" "+(C.tz||"utc").toUpperCase()};
    worker.postMessage({tz:tzMap[C.tz]||"UTC",fmt:C.timeFmt});
    tb.style.cursor="pointer";
    tb.onclick=()=>{const opts=Object.keys(tzMap).map(k=>`<option value="${k}" ${k===(C.tz||"utc")?"selected":""}>${k.toUpperCase()}</option>`).join("");modal(`<h3>Timezone</h3><select id="tz_sel">${opts}</select><div class="row"><span class="sp"></span><button onclick="closeM()">Cancel</button><button class="pri" onclick="S.chart.tz=document.getElementById('tz_sel').value;save();closeM();drawChart()">Apply</button></div>`)};
  }catch(e){console.error("timebar worker error:",e)}
}
}catch(e){console.error("drawChart error:",e)}
}
