// ---------- Supercharts: full-width chart, optional second pane (HTF/LTF), right dock ----------
S.sc=Object.assign({panes:1,tfB:"1D",xsync:true,dock:true,secs:{wl:true,al:true,dw:true}},S.sc||{});if(S.sc.secs&&S.sc.secs.ot===undefined)S.sc.secs.ot=true;
const SC={chB:null,serB:null,barsB:null,keyB:"",dw:null,iv:0,retry:0,lock:0,mainHook:null};
const SC_TFS=["5m","15m","1H","4H","1D","1W"];
function scApplyAttr(){document.documentElement.dataset.panes=S.sc.panes===2?"2":"1"}
// candles for any symbol/timeframe as chart bars, built the same way the main chart builds them
// Server bars -> LightweightCharts rows (formatting only; bars arrive bucketed and merged from the backend).
function vtBars(s,tf){const a=candles(s,tf);if(!a||!a.length)return null;const st=STEP[tf]||3600,T=i=>a[i].t;
const D=a.map(x=>({time:x.t,open:x.o,high:x.h,low:x.l,close:x.c}));
return{a,D,T,st}}
function vtChartOpts(tf,extra){const p=pal(),C=S.chart,L=window.LightweightCharts;
return Object.assign({autoSize:true,layout:{background:{type:"solid",color:C.bg==="custom"&&C.bgCol?C.bgCol:p.bg},textColor:C.txtCol||p.tx,fontSize:+C.fs||12},
grid:{vertLines:{visible:C.showGridV!==false,color:C.gridV||p.gr},horzLines:{visible:C.showGridH!==false,color:C.gridH||p.gr}},
crosshair:{mode:L.CrosshairMode.Normal},timeScale:{timeVisible:!/^(1D|1W|1M)$/.test(tf),secondsVisible:false,borderColor:p.gr},rightPriceScale:{borderColor:p.gr,scaleMargins:{top:.1,bottom:.08}}},extra||{})}
function vtCandleOpts(s){const C=S.chart,T0="rgba(0,0,0,0)",h=C.type==="hollow",ps=typeof vtPriceSpec==="function"?vtPriceSpec(s,s&&s[2]):{precision:s&&s[2]!=null&&s[2]<5?5:2,minMove:s&&s[2]!=null&&s[2]<5?0.00001:0.01};
return{upColor:C.showBody&&!h?C.upBody:T0,downColor:C.showBody?C.dnBody:T0,borderVisible:C.showBorder,borderUpColor:C.upBorder,borderDownColor:C.dnBorder,wickVisible:C.showWick,wickUpColor:C.upWick,wickDownColor:C.dnWick,priceFormat:{type:"price",precision:ps.precision,minMove:ps.minMove}}}
// index of the last bar whose time is <= t (binary search); -1 if t is before the first bar
function barAt(times,t){let lo=0,hi=times.length-1;if(hi<0||t<times[0])return -1;while(lo<hi){const m=(lo+hi+1)>>1;if(times[m]<=t)lo=m;else hi=m-1}return lo}
function scKillB(){if(SC.chB){try{SC.chB.remove()}catch(e){}}SC.chB=SC.serB=SC.barsB=SC.indSeries=null;SC.keyB="";clearTimeout(SC.retry)}
function scPaneB(){try{const el=document.getElementById("sc2");if(!el)return;
if(S.pageView!=="chart"||S.sc.panes!==2){scKillB();el.innerHTML="";return}
const s=symOf(S.chart.sym)||SYMS[0];if(!s){el.innerHTML=`<p class="mut vt-skel" role="status">Loading markets\u2026</p>`;return}
const tf=S.sc.tfB;
el.innerHTML=`<div class="sc2h"><b>${esc(s[0])}</b><span class="mut">Pane 2</span><span class="tfs">${SC_TFS.map(t=>`<button class="chip ${t===tf?"on":""}" onclick="scSetTfB('${t}')">${t}</button>`).join("")}</span><span class="sp"></span><label class="chk" style="font-size:12px" title="Move the crosshair on both panes together"><input type="checkbox" ${S.sc.xsync?"checked":""} onchange="S.sc.xsync=this.checked;save()">Sync crosshair</label></div><div id="cvB"></div>`;
scKillB();
const cvBEl=document.getElementById("cvB");if(!cvBEl)return;
const B=vtBars(s,tf);
if(!B){cvBEl.innerHTML=`<p class="mut vt-skel" role="status">Loading ${esc(tf)} candles\u2026</p>`;if(isLive()&&READY)try{need(s,tf,true)}catch(_e){}SC.retry=setTimeout(scPaneB,1500);return}
if(!window.LightweightCharts)return;
const c=LightweightCharts.createChart(cvBEl,vtChartOpts(tf));
const ser=c.addCandlestickSeries(vtCandleOpts(s));ser.setData(B.D);
const indSeriesB=[];if(vtIndMissing(s[0],tf).length)vtEnsureChartInd(s[0],tf);
S.chart.ind.filter(d=>!d.hidden&&(d.t==="ema"||d.t==="sma")).forEach(d=>{try{const l=c.addLineSeries({color:d.col,lineWidth:d.w||2,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});l.setData(vtIndSeriesData(s[0],tf,d,B.a));indSeriesB.push({d,ser:l})}catch(_e){}});
const n=B.D.length;SC._histGuard=1;try{if(c&&typeof c.timeScale==="function")c.timeScale().setVisibleLogicalRange({from:Math.max(0,n-120),to:n+8})}catch(_e){}finally{SC._histGuard=0}
SC.chB=c;SC.serB=ser;SC.barsB=B;SC.indSeries=indSeriesB;SC.keyB=s[0]+"|"+tf;
try{vtPlusAttach(c,ser,cvBEl,()=>S.chart.sym);vtAlertAttach(c,ser,cvBEl,()=>S.chart.sym);vtTouchChart(c)}catch(_e){}
if(typeof vtRenderGapBadge==="function")try{vtRenderGapBadge()}catch(_e){}
try{
  const tsB=c&&typeof c.timeScale==="function"?c.timeScale():null;
  const cvBHost=document.getElementById("cvB");
  if(tsB&&typeof tsB.subscribeVisibleLogicalRangeChange==="function"&&ser&&cvBHost){
    tsB.subscribeVisibleLogicalRangeChange(rg=>{
      try{
        if(!rg||SC._histGuard)return;
        if(!SC||!SC.chB||!SC.serB||!document.getElementById("cvB"))return;
        if(typeof vtCheckHistoryScroll==="function")vtCheckHistoryScroll(s[0],tf,rg);
      }catch(_e){}
    });
  }
}catch(e){console.error("scPaneB range subscription error:",e)}
try{
  c.subscribeCrosshairMove(p=>{if(SC.lock||!S.sc.xsync||!ch||!MS||!G)return;SC.lock=1;try{
    if(!p||p.time==null){ch.clearCrosshairPosition()}else{const i=barAt(G.tt,p.time),bar=p.seriesData&&p.seriesData.get(ser);if(i>=0&&bar)ch.setCrosshairPosition(bar.close,G.tt[i],MS)}}catch(e){}SC.lock=0});
}catch(_e){}
}catch(e){console.error("scPaneB error:",e)}
}
function scSetTfB(t){S.sc.tfB=t;save();scPaneB()}
function scSetPanes(n){S.sc.panes=n;save();scApplyAttr();scDock();scPaneB()}
function scTogDock(){S.sc.dock=!S.sc.dock;save();scDock()}
function scTogSec(k){S.sc.secs[k]=!S.sc.secs[k];save();scDock()}
// main chart -> data window + pane 2 crosshair
function vtAfterDraw(s,a,T){scApplyAttr();vtPlusAttach(ch,MS,document.getElementById("cv"),()=>S.chart.sym);vtAlertAttach(ch,MS,document.getElementById("cv"),()=>S.chart.sym);vtTouchChart(ch);vtPosAttach();
const C=S.chart,inds=C.ind.filter(d=>!d.hidden&&(d.t==="ema"||d.t==="sma"||d.t==="rsi")).map(d=>({d,v:vtIndAligned(s[0],C.tf,d,a)}));
const vol=vols(s,C.tf);
SC.dw={s,a,T,inds,vol,i:a.length-1};scDW();
ch.subscribeCrosshairMove(p=>{const tt=G&&G.tt;if(!tt)return;
  const i=p&&p.time!=null?barAt(tt,p.time):-1;SC.dw.i=i>=0?i:a.length-1;scDW();
  if(SC.lock||!S.sc.xsync||!SC.chB||!SC.serB||!SC.barsB||S.pageView!=="chart")return;SC.lock=1;try{
  if(i<0){SC.chB.clearCrosshairPosition()}else{const bt=SC.barsB.D.map(x=>x.time),j=barAt(bt,tt[i]);if(j>=0)SC.chB.setCrosshairPosition(a[i].c,bt[j],SC.serB)}}catch(e){}SC.lock=0});
if(S.pageView==="chart"&&S.sc.panes===2&&SC.keyB!==s[0]+"|"+S.sc.tfB)scPaneB();
}
function scDW(){const el=document.getElementById("dkdw");if(!el||!SC.dw)return;const{s,a,T,inds,vol}=SC.dw,i=Math.min(SC.dw.i,a.length-1),x=a[i];if(!x){el.innerHTML="";return}
const o=x.o!=null?x.o:i?a[i-1].c:x.c,prev=i?a[i-1].c:null,chg=prev?(x.c/prev-1)*100:null,d=new Date(T(i)*1000);
const f=v=>v==null||!isFinite(v)?"\u2013":fp(v,s);
let h=`<span>Symbol</span><span>${esc(s[0])} \u00b7 ${esc(S.chart.tf)}</span><span>Time</span><span>${d.toISOString().slice(0,16).replace("T"," ")} UTC</span><span>Open</span><span>${f(o)}</span><span>High</span><span>${f(x.h)}</span><span>Low</span><span>${f(x.l)}</span><span>Close</span><span>${f(x.c)}</span><span>Change</span><span class="${chg==null?"":chg<0?"dn":"up"}">${chg==null?"\u2013":(chg>0?"+":"")+chg.toFixed(2)+"%"}</span><span>Volume</span><span>${vol&&vol[i]!=null?fm(vol[i]):"\u2013"}</span>`;
inds.forEach(({d,v})=>{h+=`<span><i class="dwsw" style="background:${esc(d.col)}" aria-hidden="true"></i>${esc(IND[d.t]||d.t)} ${d.len}</span><span>${v[i]==null?"\u2013":d.t==="rsi"?v[i].toFixed(1):fp(v[i],s)}</span>`;const rv=document.querySelector(`#vt_ind_legend .vt-ind-row[data-indid="${CSS.escape(d.id)}"] .vt-ind-val`);if(rv)rv.textContent=v[i]==null?"":d.t==="rsi"?v[i].toFixed(1):fp(v[i],s)});
el.innerHTML=h}
function scDock(){const el=document.getElementById("dock");if(!el)return;
if(S.pageView!=="chart"){el.innerHTML="";return}
const D=S.sc,ic=k=>`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${k}</svg>`;
const P1='<rect x="3" y="4" width="18" height="16" rx="1"/>',P2='<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4v16"/>';
el.className="dock"+(D.dock?"":" shut");
const head=`<div class="dkh"><button class="ibtn ${D.panes===1?"on":""}" title="One chart" onclick="scSetPanes(1)">${ic(P1)}</button><button class="ibtn ${D.panes===2?"on":""}" title="Two charts side by side (e.g. higher + lower timeframe)" onclick="scSetPanes(2)">${ic(P2)}</button>${D.dock?'<span class="sp"></span>':""}<button class="ibtn" title="${D.dock?"Collapse":"Expand"} panel" onclick="scTogDock()">${ic(D.dock?'<path d="M9 6l6 6-6 6"/>':'<path d="M15 6l-6 6 6 6"/>')}</button></div>`;
if(!D.dock){el.innerHTML=head;return}
const sec=(k,t,body,extra)=>`<div class="dks"><div class="dkt"><button type="button" class="dktb" onclick="scTogSec('${k}')" aria-expanded="${!!D.secs[k]}">${D.secs[k]?VT_IC.chevDown:VT_IC.chevRight}<span>${t}</span></button><span class="sp" onclick="scTogSec('${k}')" aria-hidden="true"></span>${extra||""}</div>${D.secs[k]?body:""}</div>`;
el.innerHTML=head+`<div class="dkb">`+sec("wl","Watchlist",`<div id="dkwl"></div>`)+sec("al","Active alerts",`<div id="dkal"></div>`,`<button class="ib" onclick="event.stopPropagation();alertsM()">+ Alert</button>`)+sec("ot","Object tree",`<div class="dkot" id="dkot"></div>`)+sec("dw","Data window",`<div class="dkdw" id="dkdw"></div>`)+`</div>`;
scDockLive();scDW()}
function scRow(n){const d=wlData(n);return`<div class="dkr ${n===S.chart.sym?"sel":""}" data-s="${esc(n)}" onclick="openChart('${esc(n)}')"><b>${esc(n)}</b><span class="dkp">${d.last==null?"\u2026":fp(d.last,n)}</span><span class="dkc ${d.chg==null?"":d.chg<0?"dn":"up"}">${d.chg==null?"\u2026":(d.chg>0?"+":"")+d.chg.toFixed(2)+"%"}</span></div>`}
function scDockLive(){const w=document.getElementById("dkwl");
if(w){const mine=wlAll(),top=PGL.filter(n=>!mine.includes(n)).slice(0,15);
w.innerHTML=(mine.length?mine.map(scRow).join(""):`<div class="dkx mut">Your watchlist is empty. Click the watchlist star on the chart to add symbols.</div>`)+(top.length?`<div class="dkt" style="cursor:default">Screener top</div>`+top.map(scRow).join(""):"")}
const al=document.getElementById("dkal");
if(al){const A=S.alerts||[];al.innerHTML=A.length?A.map((x,i)=>{const s=symOf(x.sym),px=s&&s[2],dist=px?(x.price/px-1)*100:null;
return`<div class="dka"><span style="flex:1;min-width:0;cursor:pointer;display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap" title="Edit alert" onclick="vtAlertEdit(${x.id})"><b>${esc(x.sym)}</b> ${x.dir==="above"?VT_IC.up:x.dir==="below"?VT_IC.dn:VT_IC.upDn} ${esc(x.price)}${dist!=null?` <span class="mut">(${dist>0?"+":""}${dist.toFixed(2)}%)</span>`:""}${x.fired?` <span class="pill b" style="min-width:0">hit</span>`:""}</span>${x.fired?`<button class="ib" onclick="rearmAlert(${i});scDockLive()">Re-arm</button>`:""}<button class="ib x" style="opacity:1" title="Delete" aria-label="Delete alert" onclick="S.alerts.splice(${i},1);save();scDockLive()">${VT_IC.x}</button></div>`}).join(""):`<div class="dkx mut">No alerts. Set one with + Alert or from a horizontal line.</div>`}}
PAGE_HOOK.chart={enter(){scApplyAttr();scDock();scPaneB()},
  leave(){scKillB();const d=document.getElementById("dock");if(d)d.innerHTML="";const b=document.getElementById("sc2");if(b)b.innerHTML="";document.documentElement.dataset.panes="1"}};
// ---------- price-scale plus button (Workspace chart + both Supercharts panes) ----------
// Hovering the chart or its price axis shows "+" at the crosshair's price, next to the axis.
// Click it for "Add alert at <price>" (through the normal alert engine) and "Draw horizontal line at <price>".
if(S.chart.plusBtn===undefined)S.chart.plusBtn=true;
function vtRoundPx(s,p){const ps=typeof vtPriceSpec==="function"?vtPriceSpec(s,p):{precision:s&&s[2]!=null&&s[2]<5?5:2};return +p.toFixed(ps.precision)}
function vtAddAlertAt(sym,price){const s=symOf(sym),cur=s&&s[2]!=null?s[2]:null;
S.alerts=S.alerts||[];const a={id:Date.now(),sym,price,dir:cur!=null&&price<cur?"below":"above",on:true,fired:false};S.alerts.push(a);save();
toast("Alert: "+sym+" crosses "+a.dir+" "+price);if(typeof scDockLive==="function")scDockLive();
if(typeof Notification!=="undefined"&&Notification.permission==="default"){try{Notification.requestPermission()}catch(e){}}return a}
function vtHlineAt(sym,price){if(S.chart.sym!==sym)return;pushUndo();const t=G&&G.tt&&G.tt.length?G.tt[G.tt.length-1]:Math.floor(Date.now()/1000);
const d={id:Date.now(),t:"hline",p:[{t,y:price}],c:"#2962ff",w:2,s:0};DL().push(d);SELD=d;save();tbRef();toast("Horizontal line at "+price)}
function vtPlusClose(){document.querySelectorAll(".vpmenu").forEach(m=>m.remove())}
function vtPlusAttach(chart,series,host,symFn){if(!chart||!series||!host)return;
if(getComputedStyle(host).position==="static")host.style.position="relative";
const b=document.createElement("button");b.className="vplus";b.type="button";b.textContent="+";b.title="Add alert or line at this price";host.appendChild(b);
let y=null;
const geo=()=>{let pw=0,th=0;try{pw=chart.timeScale().width()}catch(e){}try{th=chart.timeScale().height()}catch(e){}return{pw:pw||host.clientWidth-60,ph:host.clientHeight-(th||26)}};
host.addEventListener("mousemove",e=>{if(e.target===b||S.chart.plusBtn===false){if(S.chart.plusBtn===false)b.style.display="none";return}
  const r=host.getBoundingClientRect(),x=e.clientX-r.left,yy=e.clientY-r.top,g=geo();
  if(yy<0||yy>g.ph||x<0||x>host.clientWidth||series.coordinateToPrice(yy)==null){b.style.display="none";return}
  y=yy;b.style.display="block";b.style.left=(g.pw-21)+"px";b.style.top=(yy-9)+"px"});
// touch has no hover: after a long-press the crosshair is shown, and "+" follows it on the price scale
if(matchMedia("(pointer:coarse)").matches){try{chart.subscribeCrosshairMove(p=>{if(S.chart.plusBtn===false)return;if(!p||!p.point||p.point.y==null){return}const g=geo();if(p.point.y<0||p.point.y>g.ph)return;
  y=p.point.y;b.style.display="block";b.style.left=(g.pw-31)+"px";b.style.top=(y-15)+"px"})}catch(e){}}
host.addEventListener("mouseleave",e=>{if(!e.relatedTarget||!host.contains(e.relatedTarget))b.style.display="none"});
b.addEventListener("mousedown",e=>e.stopPropagation());b.addEventListener("pointerdown",e=>e.stopPropagation());
b.addEventListener("click",e=>{e.stopPropagation();vtPlusClose();if(y==null)return;const sym=symFn(),s=symOf(sym),raw=series.coordinateToPrice(y);if(raw==null||!s)return;
  const price=vtRoundPx(s,raw),m=document.createElement("div");m.className="vpmenu";
  const it=(txt,fn)=>{const d=document.createElement("div");d.textContent=txt;d.onclick=ev=>{ev.stopPropagation();vtPlusClose();fn()};m.appendChild(d)};
  it("Add alert at "+fp(price),()=>vtAddAlertAt(sym,price));
  if(DT.hline)it("Draw horizontal line at "+fp(price),()=>vtHlineAt(sym,price));
  const g=geo();m.style.top=Math.min(y+12,Math.max(0,host.clientHeight-90))+"px";m.style.right=(host.clientWidth-g.pw+4)+"px";host.appendChild(m)});}
document.addEventListener("click",e=>{if(!e.target.closest||!e.target.closest(".vpmenu,.vplus"))vtPlusClose()});
// ---------- active price alerts drawn on charts (Workspace + both Supercharts panes) ----------
// Each active, un-fired alert for the chart's symbol is a dashed price line plus a label (bell + price) on the price scale.
// Click the line or label to edit price / condition / message, or delete; drag to move the price.
// Edits mutate the same alert object (same id), so the alert engine never sees a duplicate.
const VT_AL_COLOR="#ff9800";const VT_COARSE_AL=matchMedia("(pointer:coarse)").matches,VTAL_HIT=VT_COARSE_AL?26:9;
const VT_BELL='<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1z"/></svg>';
function vtAlCond(d){return d==="above"?"Crossing up":d==="below"?"Crossing down":"Crossing"}
let VTAL=[];// [{chart,series,host,symFn,items:Map(id->{pl,lab,hit,k})}]
function vtAlFind(id){const i=(S.alerts||[]).findIndex(a=>a.id===id);return i<0?null:{i,a:S.alerts[i]}}
function vtAlRefresh(){save();if(typeof scDockLive==="function")scDockLive();vtAlTick(true)}
// apply a change to an existing alert; re-arms it and resets the cross baseline when price or condition change
function vtAlUpdate(id,ch){const f=vtAlFind(id);if(!f)return null;const a=f.a,moved=(ch.price!=null&&ch.price!==a.price)||(ch.dir&&ch.dir!==a.dir);
if(ch.price!=null)a.price=ch.price;if(ch.dir)a.dir=ch.dir;if("msg"in ch){if(ch.msg)a.msg=ch.msg;else delete a.msg}
if(moved){a.fired=false;a.on=true;const s=symOf(a.sym);if(s&&s[2]!=null)lastPx[a.sym]=s[2];else delete lastPx[a.sym]}
vtAlRefresh();return a}
function vtAlDelete(id){const f=vtAlFind(id);if(!f)return false;S.alerts.splice(f.i,1);vtAlRefresh();return true}
function vtAlertEdit(id){const f=vtAlFind(id);if(!f){toast("Alert not found");return}const a=f.a;
modal(`<div class="vale"><h3>Edit alert</h3><label>Symbol<input id="vae_sym" disabled></label>
<label>Price<input id="vae_px" type="number" step="any"></label>
<label>Condition<select id="vae_dir"><option value="cross">Crossing</option><option value="above">Crossing up</option><option value="below">Crossing down</option></select></label>
<label>Message (shown when it fires)<textarea id="vae_msg" maxlength="300"></textarea></label>
<div class="row"><button class="del" id="vae_del">Delete</button><span class="sp"></span><button onclick="closeM()">Cancel</button><button class="pri" id="vae_ok">Save</button></div></div>`);
const $=i=>document.getElementById(i);$("vae_sym").value=a.sym;$("vae_px").value=a.price;$("vae_dir").value=a.dir||"cross";$("vae_msg").value=a.msg||"";
$("vae_msg").placeholder=a.sym+" crossed "+a.price;
$("vae_ok").onclick=()=>{const px=+$("vae_px").value;if(!(px>0)){toast("Enter a valid price");return}
  vtAlUpdate(id,{price:px,dir:$("vae_dir").value,msg:$("vae_msg").value.trim()});closeM();toast("Alert updated")};
$("vae_del").onclick=()=>{vtAlDelete(id);closeM();toast("Alert deleted")};
$("vae_px").focus()}
function vtAlertAttach(chart,series,host,symFn){if(!chart||!series||!host)return;
VTAL=VTAL.filter(r=>{if(r.host===host||!r.host.isConnected){r.items.forEach(it=>{it.lab.remove();it.hit.remove()});return false}return true});
if(getComputedStyle(host).position==="static")host.style.position="relative";
const r={chart,series,host,symFn,items:new Map()};VTAL.push(r);vtAlSync(r);vtAlPos(r);vtAlLoop()}
function vtAlGeo(r){let pw=0;try{pw=r.chart.timeScale().width()}catch(e){}return pw||r.host.clientWidth-60}
function vtAlSync(r){const sym=r.symFn(),want=new Map();(S.alerts||[]).forEach(a=>{if(a.sym===sym&&a.on!==false&&!a.fired&&a.price>0)want.set(a.id,a)});
r.items.forEach((it,id)=>{if(!want.has(id)){try{r.series.removePriceLine(it.pl)}catch(e){}it.lab.remove();it.hit.remove();r.items.delete(id)}});
want.forEach((a,id)=>{let it=r.items.get(id);const k=a.price+"|"+a.dir+"|"+(a.msg||"");
  if(!it){let pl;try{pl=r.series.createPriceLine({price:a.price,color:VT_AL_COLOR,lineWidth:1,lineStyle:2,axisLabelVisible:false,title:""})}catch(e){return}
    const lab=document.createElement("div");lab.className="valb";lab.dataset.al=id;const hit=document.createElement("div");hit.className="valh";hit.dataset.al=id;
    r.host.appendChild(hit);r.host.appendChild(lab);it={pl,lab,hit,k:""};r.items.set(id,it);vtAlDrag(r,id,lab);vtAlDrag(r,id,hit)}
  if(it.k!==k&&!it.drag){it.k=k;try{it.pl.applyOptions({price:a.price})}catch(e){}vtAlLabel(it,a.price,a);it.y=null}})}
function vtAlLabel(it,price,a){it.lab.innerHTML=VT_BELL;const t=document.createElement("span");t.textContent=fp(price);it.lab.appendChild(t);
it.lab.title=it.hit.title=vtAlCond(a.dir)+" "+fp(price)+(a.msg?" \u2014 "+a.msg:"")+"\nClick to edit, drag to move"}
function vtAlPos(r){const pw=vtAlGeo(r),w=Math.max(40,r.host.clientWidth-pw);let ph=r.host.clientHeight;try{ph-=r.chart.timeScale().height()}catch(e){}
r.items.forEach((it,id)=>{const a=it.drag?null:vtAlFind(id),price=it.drag?it.dp:a&&a.a.price;const y=price==null?null:r.series.priceToCoordinate(price);
  if(y==null||y<0||y>ph){it.lab.style.display=it.hit.style.display="none";return}
  if(it.y===y&&it.pw===pw&&it.lab.style.display!=="none")return;it.y=y;it.pw=pw;
  it.lab.style.display=it.hit.style.display="";it.lab.style.left=pw+"px";it.lab.style.width=w+"px";it.lab.style.top=(y-(VT_COARSE_AL?12:9))+"px";
  const hh=VTAL_HIT;it.hit.style.height=hh+"px";it.hit.style.width=Math.max(0,pw-(VT_COARSE_AL?40:24))+"px";it.hit.style.top=(y-hh/2)+"px"})}
/* Touch/pen taps open the alert editor on pointerup; the browser then synthesizes a click at the same point, which lands on the
   editor backdrop (.ov closes on target===this) and shuts it instantly. Swallow that one click (capture phase, expires after 500 ms). */
function vtSwallowNextClick(){const h=e=>{e.stopPropagation();e.preventDefault()};document.addEventListener("click",h,{capture:true,once:true});setTimeout(()=>document.removeEventListener("click",h,true),500)}
function vtAlDrag(r,id,el){el.addEventListener("mousedown",e=>e.stopPropagation());
el.addEventListener("pointerdown",e=>{if(e.button)return;e.stopPropagation();e.preventDefault();const it=r.items.get(id),f=vtAlFind(id);if(!it||!f)return;
  const y0=e.clientY,s=symOf(f.a.sym),coarse=e.pointerType&&e.pointerType!=="mouse";let moved=false;try{el.setPointerCapture(e.pointerId)}catch(_){}
  const mv=ev=>{if(!moved&&Math.abs(ev.clientY-y0)<4)return;moved=true;it.drag=true;it.lab.classList.add("drag");it.hit.classList.add("drag");
    const rc=r.host.getBoundingClientRect(),raw=r.series.coordinateToPrice(ev.clientY-rc.top);if(raw==null)return;
    it.dp=vtRoundPx(s,raw);try{it.pl.applyOptions({price:it.dp})}catch(_){}vtAlLabel(it,it.dp,f.a);it.y=null;vtAlPos(r)};
  const up=()=>{el.removeEventListener("pointermove",mv);el.removeEventListener("pointerup",up);el.removeEventListener("pointercancel",up);
    it.lab.classList.remove("drag");it.hit.classList.remove("drag");
    if(moved&&it.drag){it.drag=false;const p=it.dp;it.k="";if(p>0){vtAlUpdate(id,{price:p});toast("Alert moved to "+fp(p))}}else{it.drag=false;if(coarse)vtSwallowNextClick();vtAlertEdit(id)}};
  el.addEventListener("pointermove",mv);el.addEventListener("pointerup",up);el.addEventListener("pointercancel",up)})}
// one light loop: keeps lines in sync with S.alerts (edits from the Alerts dialog, dock, firing) and follows zoom/scroll
let VTAL_RAF=0,VTAL_T=0;
function vtAlTick(force){VTAL=VTAL.filter(r=>{if(r.host.isConnected)return true;r.items.forEach(it=>{it.lab.remove();it.hit.remove()});return false});
VTAL.forEach(r=>{try{if(force)r.items.forEach(it=>it.k="");vtAlSync(r);vtAlPos(r)}catch(e){console.error(e)}})}
function vtAlLoop(){if(VTAL_RAF)return;const f=t=>{VTAL_RAF=0;if(!VTAL.length)return;if(!document.hidden&&t-VTAL_T>60){VTAL_T=t;vtAlTick()}VTAL_RAF=requestAnimationFrame(f)};VTAL_RAF=requestAnimationFrame(f)}
const VT_EVC={H:{e:"1H",v:"1D"},M:{e:"15m",v:"1H"},L:{e:"1m",v:"15m"}};
function evcCfg(){return VT_EVC[S.evcTf||"H"]||VT_EVC.H}
function evcNeedsLoad(){return S.preset&&S.preset!=="P5"||S.pageView==="screener"||S.pageView==="heatmap"}
// true when the candles scoreMarket needs are present
function evcHas(s){const c=evcCfg(),e=candles(s,c.e),v=candles(s,c.v);return!!(e&&e.length>=20&&v&&v.length>=20)}
// <POS>
// Long/short position maths (same definitions as TradingView's public help pages; our own implementation).
// side "long"|"short"; risk in % of account (ru "%") or money (ru "$"); pv = point value; lot = lot size; lev = leverage (0 = no cap).
function posCalc(o){const L=o.side!=="short",E=+o.entry,T=+o.tp,Sx=+o.sl,acct=+o.acct||0,lot=+o.lot||1,pv=+o.pv||1,tick=+o.tick||0.01,prec=o.prec==null?2:+o.prec;
const riskAmt=o.ru==="$"?(+o.risk||0):acct*(+o.risk||0)/100,dist=L?E-Sx:Sx-E,gain=L?T-E:E-T;
let qty=dist>0?riskAmt/(dist*pv)/lot:0;if(+o.lev>0&&E>0)qty=Math.min(qty,acct*o.lev/E*pv/lot);
const f=Math.pow(10,prec);qty=Math.floor(qty*f+1e-9)/f;
const per=pv*lot*qty;
return{riskAmt,qty,rr:dist>0?gain/dist:0,
tpOff:Math.abs(T-E),tpPct:E?Math.abs(T-E)/E*100:0,tpTicks:Math.round(Math.abs(T-E)/tick),
slOff:Math.abs(E-Sx),slPct:E?Math.abs(E-Sx)/E*100:0,slTicks:Math.round(Math.abs(E-Sx)/tick),
pnlTP:gain*per,pnlSL:-dist*per,amtTP:acct+gain*per,amtSL:acct-dist*per,
pnlAt:px=>(L?px-E:E-px)*per}}
// Walk the bars inside the tool's time span: the first bar to touch the target or stop closes it (stop first if one bar touches both).
function posState(bars,side,E,T,Sx,t0,t1){const L=side!=="short";let last=null,n=0;
for(const b of bars){if(b.t<=t0)continue;// entry fills at the close of its bar, so only later bars count
  if(b.t>t1)break;n++;last=b;
  const hitS=L?b.l<=Sx:b.h>=Sx,hitT=L?b.h>=T:b.l<=T;
  if(hitS)return{state:"sl",t:b.t,px:Sx};if(hitT)return{state:"tp",t:b.t,px:T}}
return n?{state:"open",t:last.t,px:last.c}:{state:"none"}}
// </POS>
// ---------- Long / Short position tools: TradingView-like look and interactions, built with our own canvas code ----------
// Data: p[0] = entry (left time), p[1] = target (right time), p[2] = stop (right time). Inputs/style live on the drawing;
// the last values used become the defaults for the next one (S.posDef). Maths: the <POS> block (posCalc / posState).
const POS_DEF0={acct:10000,lot:1,risk:1,ru:"%",lev:0,prec:2,rr:2,tc:"#089981",sc:"#F23645",ec:"#787B86",xc:"#FFFFFF",op:0.2,compact:false,full:false,axis:true,bars:24};
function posDef(){const D=S.posDef||(S.posDef={});for(const k in POS_DEF0)if(D[k]==null)D[k]=POS_DEF0[k];return D}
const isPos=d=>!!d&&(d.t==="long"||d.t==="short");
function posO(d){const D=posDef(),o={};for(const k in POS_DEF0)o[k]=d[k]!=null?d[k]:D[k];if(d.targetCol&&d.tc==null)o.tc=d.targetCol;if(d.stopCol&&d.sc==null)o.sc=d.stopCol;return o}
function posTick(){const s=symOf(S.chart.sym),p=s&&s[2];return p!=null&&p<10?1e-4:0.01}
let VT_SAVE_T=0;function saveSoon(){clearTimeout(VT_SAVE_T);VT_SAVE_T=setTimeout(()=>save(),250)}
function hexA(h,a){h=String(h||"#787b86").replace("#","");if(h.length===3)h=h.split("").map(c=>c+c).join("");const n=parseInt(h.slice(0,6),16);return`rgba(${n>>16&255},${n>>8&255},${n&255},${Math.max(0,Math.min(1,a))})`}
const posMoney=v=>(v<0?"\u2212":"")+Math.abs(v).toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2});
function posCalcD(d){const o=posO(d);return posCalc({side:d.t,entry:d.p[0].y,tp:d.p[1].y,sl:d.p[2].y,acct:o.acct,risk:o.risk,ru:o.ru,lot:o.lot,lev:o.lev,prec:o.prec,pv:1,tick:posTick()})}
let POSB={a:null,n:0,b:[]};
function posBars(){if(!G||!G.a)return[];const a=G.a,n=a.length;if(POSB.a!==a||POSB.n!==n)POSB={a,n,b:a.map((c,i)=>({t:G.tt[i],h:c.h,l:c.l,c:c.c}))};else if(n){const c=a[n-1];POSB.b[n-1]={t:G.tt[n-1],h:c.h,l:c.l,c:c.c}}return POSB.b}
function posState1(d){return posState(posBars(),d.t,d.p[0].y,d.p[1].y,d.p[2].y,d.p[0].t,Math.max(d.p[1].t,d.p[0].t))}
const tx=t=>ch.timeScale().logicalToCoordinate(t2l(t));
function posGeo(d){const a=px(d.p[0]),b=px(d.p[1]),c=px(d.p[2]);if([a.x,a.y,b.x,b.y,c.y].some(v=>v==null))return null;
return{xL:Math.min(a.x,b.x),xR:Math.max(a.x,b.x),yE:a.y,yT:b.y,yS:c.y}}
function posPill(g,lines,cx,y,where,bg,fg,tw){g.font="600 11.5px system-ui,-apple-system,'Segoe UI',sans-serif";const lh=15,w=Math.max(...lines.map(s=>g.measureText(s).width))+14,h=lines.length*lh+6;
let x=Math.round(cx-w/2);x=Math.max(2,Math.min(tw-w-2,x));const top=where==="above"?y-h-5:where==="below"?y+5:y-h/2;
g.fillStyle=bg;g.beginPath();g.roundRect(x,Math.round(top),w,h,4);g.fill();g.fillStyle=fg;g.textAlign="center";g.textBaseline="middle";
lines.forEach((s,i)=>g.fillText(s,x+w/2,top+3+lh/2+i*lh));g.textAlign="left";g.textBaseline="alphabetic"}
let POS_HOV=null;window.__posLbl={};
function posShape(g,d,W,H,sel){const P=posGeo(d);if(!P)return;const o=posO(d),hov=d===POS_HOV,L=d.t==="long";
const {xL,xR,yE,yT,yS}=P,w=Math.max(2,xR-xL),al=o.op*(hov||sel?1.3:1);g.setLineDash([]);
g.fillStyle=hexA(o.tc,al);g.fillRect(xL,Math.min(yE,yT),w,Math.abs(yT-yE));
g.fillStyle=hexA(o.sc,al);g.fillRect(xL,Math.min(yE,yS),w,Math.abs(yS-yE));
const c=posCalcD(d),st=posState1(d);let pnl=null;
if(st.state!=="none"){const xC=Math.min(xR,Math.max(xL,tx(st.t)??xR)),yC=MS.priceToCoordinate(st.px);
  if(yC!=null){pnl=c.pnlAt(st.px);const col=pnl>=0?o.tc:o.sc;g.fillStyle=hexA(col,Math.min(.6,al+.18));g.fillRect(xL,Math.min(yE,yC),Math.max(1,xC-xL),Math.abs(yC-yE));
    g.strokeStyle=o.ec;g.lineWidth=1;g.setLineDash([4,3]);g.beginPath();g.moveTo(xL,yE);g.lineTo(xC,yC);g.stroke();g.setLineDash([])}}
g.strokeStyle=o.ec;g.lineWidth=1;g.beginPath();g.moveTo(xL,Math.round(yE)+.5);g.lineTo(xL+w,Math.round(yE)+.5);g.stroke();
const full=(sel||hov||o.full)&&!(o.compact&&!sel&&!hov),cx=xL+w/2,dec=o.prec;
const top=full?`Target: ${fp(d.p[1].y)} (${c.tpPct.toFixed(2)}%) ${c.tpTicks}, Amount: ${posMoney(c.amtTP)}`:`${fp(d.p[1].y)} (${c.tpPct.toFixed(2)}%)`;
const bot=full?`Stop: ${fp(d.p[2].y)} (${c.slPct.toFixed(2)}%) ${c.slTicks}, Amount: ${posMoney(c.amtSL)}`:`${fp(d.p[2].y)} (${c.slPct.toFixed(2)}%)`;
const closed=st.state==="tp"||st.state==="sl",pl=pnl==null?"":(closed?"Closed P&L: ":"Open P&L: ")+posMoney(pnl)+", ";
const mid=full?[`${pl}Qty: ${c.qty.toFixed(dec)}`,`Risk/Reward Ratio: ${c.rr.toFixed(2)}`]:[`${c.rr.toFixed(2)}`];
posPill(g,[top],cx,yT,yT<yE?"above":"below",o.tc,o.xc,W);posPill(g,[bot],cx,yS,yS<yE?"above":"below",o.sc,o.xc,W);
posPill(g,mid,cx,yE,"center",pnl==null||Math.abs(pnl)<1e-12?o.ec:pnl>0?o.tc:o.sc,o.xc,W);
window.__posLbl[d.id]={top,bot,mid:mid.join(" | "),state:st.state,full};
if(sel&&!d.lock){const R=VT_COARSE?6:4.5;const sq=(x,y)=>{g.fillStyle="#fff";g.strokeStyle="#2962ff";g.lineWidth=1.5;g.fillRect(x-R,y-R,2*R,2*R);g.strokeRect(x-R,y-R,2*R,2*R)};
  sq(xL,yT);sq(xL,yS);sq(xR,yE);g.beginPath();g.arc(xL,yE,R+.5,0,7);g.fillStyle="#fff";g.fill();g.strokeStyle="#2962ff";g.stroke()}}
function posHandleAt(d,x,y){const P=posGeo(d);if(!P)return null;const R=VT_COARSE?22:9;
const hs=[["tp",P.xL,P.yT],["sl",P.xL,P.yS],["en",P.xL,P.yE],["w",P.xR,P.yE]];let best=null,bd=R;
hs.forEach(([k,hx,hy])=>{const dd=Math.hypot(x-hx,y-hy);if(dd<=bd){bd=dd;best=k}});return best}
function posPlace(t,x,y){const p=snapP(x,y),D=posDef(),H=document.getElementById("cv").clientHeight;
const top=MS.coordinateToPrice(10),bot=MS.coordinateToPrice(H-40),span=Math.abs((top??p.y*1.05)-(bot??p.y*.95))||p.y*.05;
const s=symOf(S.chart.sym),rnd=v=>vtRoundPx(s,v),risk=span*.07,E=rnd(p.y),L=t==="long",tR=l2t(t2l(p.t)+D.bars);
const d={id:Date.now(),t,c:"#787b86",w:1,s:0,p:[{t:p.t,y:E},{t:tR,y:rnd(L?E+risk*D.rr:E-risk*D.rr)},{t:tR,y:rnd(L?E-risk:E+risk)}]};
DRAFT=d;dFin();return d}
function posDrag(d,k,x,y){const u=un(x,y);if(u.y==null||u.t==null)return;const s=symOf(S.chart.sym),tk=posTick(),L=d.t==="long",E=d.p[0].y,py=vtRoundPx(s,u.y);
if(k==="tp")d.p[1].y=L?Math.max(py,E+tk):Math.min(py,E-tk);
else if(k==="sl")d.p[2].y=L?Math.min(py,E-tk):Math.max(py,E+tk);
else if(k==="en"){const lo=Math.min(d.p[1].y,d.p[2].y)+tk,hi=Math.max(d.p[1].y,d.p[2].y)-tk;d.p[0].y=Math.max(lo,Math.min(hi,py));d.p[0].t=Math.min(u.t,d.p[1].t-G.st)}
else if(k==="w"){const t=Math.max(u.t,d.p[0].t+G.st);d.p[1].t=d.p[2].t=t}}
// --- hook into the drawing engine (wrap the global bindings; the original functions stay as they were)
const _vtShape=shape;shape=function(g,d,W,H,sel){if(isPos(d))return posShape(g,d,W,H,sel);return _vtShape.apply(this,arguments)};
const _vtDDown=dDown;dDown=function(e){const[x,y]=xy(e);
if(TOOL==="long"||TOOL==="short"){MX=[x,y];posPlace(TOOL,x,y);return}
if(TOOL==="cross"&&isPos(SELD)&&!SELD.lock){const k=posHandleAt(SELD,x,y);if(k){MX=[x,y];try{e.target.setPointerCapture(e.pointerId)}catch(_){}pushUndo();DRG={d:SELD,pos:k};return}}
const r=_vtDDown.apply(this,arguments);if(DRG&&DRG.d&&DRG.d.lock)DRG=null;return r};
const _vtDPos=dPos;dPos=function(x,y){if(DRG&&DRG.pos){MX=[x,y];posDrag(DRG.d,DRG.pos,x,y);return}return _vtDPos.apply(this,arguments)};
const _vtDUp=dUp;dUp=function(){const g=DRG;const r=_vtDUp.apply(this,arguments);if(g&&isPos(g.d)){const D=posDef(),c=posCalcD(g.d);if(c.rr>0)D.rr=+c.rr.toFixed(2);
  const bars=Math.round(t2l(g.d.p[1].t)-t2l(g.d.p[0].t));if(bars>0)D.bars=bars;save()}return r};
// re-bind the canvas handlers that initDraw captured before these wrappers existed (only matters if a chart was drawn already)
function vtRebindDraw(){const cv=document.getElementById("dc");if(cv){cv.onpointerdown=dDown;cv.onpointermove=dMove;cv.onpointerup=dUp}}
const _vtPaint=paint;paint=function(){_vtPaint();try{posAxis()}catch(e){}};
function posAxis(){const cv=document.getElementById("dc");if(!cv||!ch||HIDD)return;const d=isPos(SELD)?SELD:POS_HOV;if(!isPos(d)||d.hide)return;const o=posO(d);if(!o.axis)return;
const g=cv.getContext("2d"),W=cv.clientWidth,tw=ch.timeScale().width();g.font="600 11px system-ui,sans-serif";g.textBaseline="middle";
[[d.p[1].y,o.tc],[d.p[2].y,o.sc],[d.p[0].y,o.ec]].forEach(([p,col])=>{const y=MS.priceToCoordinate(p);if(y==null)return;g.fillStyle=col;g.beginPath();g.roundRect(tw+1,Math.round(y-9),W-tw-2,18,3);g.fill();g.fillStyle="#fff";g.fillText(fp(p),tw+6,y)});g.textBaseline="alphabetic"}
// --- hover, right-click menu, double-click settings (attached to each new chart)
function vtDrawAt(x,y){return[...DL()].reverse().find(d=>!d.hide&&hit(d,x,y))}
function vtPosAttach(){const host=document.getElementById("cv");if(!host||host._vtpos)return;host._vtpos=1;vtRebindDraw();
const rel=e=>{const r=host.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]};
host.addEventListener("pointermove",e=>{if(TOOL!=="cross"||DRG){return}const[x,y]=rel(e),d=vtDrawAt(x,y);POS_HOV=isPos(d)?d:null;
  const dc=document.getElementById("dc");if(dc&&isPos(SELD)&&!SELD.lock){const k=posHandleAt(SELD,x,y);dc.style.cursor=k==="w"?"ew-resize":k?"ns-resize":"default"}},true);
host.addEventListener("pointerleave",()=>{POS_HOV=null});
host.addEventListener("contextmenu",e=>{const[x,y]=rel(e),d=vtDrawAt(x,y);if(!d&&!DL().some(q=>q.hide))return;e.preventDefault();e.stopPropagation();vtDrawMenu(d,x,y)},true);
host.addEventListener("dblclick",e=>{const[x,y]=rel(e),d=vtDrawAt(x,y);if(!d)return;e.preventDefault();e.stopPropagation();SELD=d;dpe();dsel();drawSetM(isPos(d)?"inputs":"style")},true)}
function vtCloneSel(){if(!SELD)return;pushUndo();const d=JSON.parse(JSON.stringify(SELD));d.id=Date.now();const dt=(G&&G.st||3600)*5;d.p.forEach(p=>p.t+=dt);delete d.lock;DL().push(d);SELD=d;save();tbRef();return d}
function vtDrawMenu(d,x,y){vtPlusClose();const host=document.getElementById("cv"),m=document.createElement("div");m.className="vpmenu";m.setAttribute("role","menu");
const it=(txt,fn)=>{const e=document.createElement("div");e.setAttribute("role","menuitem");e.tabIndex=0;e.textContent=txt;e.onclick=ev=>{ev.stopPropagation();vtPlusClose();fn()};e.onkeydown=ev=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();e.click()}};m.appendChild(e)};
const sep=()=>{const e=document.createElement("div");e.className="sep";m.appendChild(e)};
if(d){SELD=d;POS_HOV=null;dpe();dsel();
  it("Settings\u2026",()=>drawSetM(isPos(d)?"inputs":"style"));sep();it("Clone",vtCloneSel);it(d.lock?"Unlock":"Lock",()=>{d.lock=!d.lock;save();dsel()});
  it("Hide",()=>{d.hide=true;SELD=null;save();tbRef()});sep();it("Delete",delSel)}
if(DL().some(q=>q.hide)){if(d)sep();it("Show hidden drawings",()=>{DL().forEach(q=>delete q.hide);save();tbRef()})}
m.style.left=Math.min(x,host.clientWidth-200)+"px";m.style.top=Math.min(y,host.clientHeight-200)+"px";host.appendChild(m);const f=m.querySelector("[role=menuitem]");if(f)f.focus()}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.querySelector("#cv .vpmenu"))vtPlusClose()});
// --- floating toolbar for a selected position: settings, lock, clone, delete
const _vtDsel=dsel;dsel=function(){const r=_vtDsel.apply(this,arguments);const e=document.getElementById("dsel");if(e&&isPos(SELD)){
e.innerHTML=`<button class="pbtn" onclick="drawSetM('inputs')" aria-label="Position settings" title="Settings">${VT_IC.gear}</button><button class="pbtn" onclick="SELD.lock=!SELD.lock;save();dsel()" aria-label="${SELD.lock?"Unlock":"Lock"}" title="${SELD.lock?"Unlock":"Lock"}">${SELD.lock?VT_IC.lock:VT_IC.unlock}</button><button class="pbtn" onclick="vtCloneSel()" aria-label="Clone" title="Clone"><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="1.5" y="4.5" width="9" height="9" rx="1.5"/><path d="M4.5 2.5v-.2c0-.5.4-.8.8-.8h7.4c.5 0 .8.4.8.8v7.4c0 .5-.4.8-.8.8h-.2"/></svg></button><button class="pbtn" onclick="delSel()" aria-label="Delete" title="Delete">${VT_IC.trash}</button>`}return r};
// --- settings dialog (Inputs / Style / Visibility); every change applies and saves at once, Cancel restores
const _vtDrawSetM=drawSetM;drawSetM=function(tab){if(isPos(SELD))return posSetM(SELD,tab==="style"?"style":tab==="vis"?"vis":"inputs");return _vtDrawSetM.apply(this,arguments)};
function posSetM(d,tab){const o=posO(d),c=posCalcD(d),tk=posTick(),snap=JSON.stringify(d),L=d.t==="long";
const n=(id,v,step)=>`<input id="${id}" type="number" step="${step||"any"}" value="${v}" inputmode="decimal">`;
modal(`<div class="pset"><h3>${L?"Long":"Short"} position</h3><div class="tabs" role="tablist"><button data-t="inputs" onclick="swTab('inputs')">Inputs</button><button data-t="style" onclick="swTab('style')">Style</button><button data-t="vis" onclick="swTab('vis')">Visibility</button></div>
<div class="tp" data-t="inputs"><div class="g2"><label>Account size${n("ps_acct",o.acct)}</label><label>Lot size${n("ps_lot",o.lot)}</label></div>
<div class="g2"><label>Risk<span class="rk">${n("ps_risk",o.risk)}<select id="ps_ru" aria-label="Risk unit"><option value="%" ${o.ru==="%"?"selected":""}>%</option><option value="$" ${o.ru==="$"?"selected":""}>Money</option></select></span></label><label>Leverage (0 = none)${n("ps_lev",o.lev)}</label></div>
<div class="g2"><label>Entry price${n("ps_en",d.p[0].y)}</label><label>Qty precision<select id="ps_prec">${[0,1,2,3,4,5,6,7,8].map(k=>`<option ${k==o.prec?"selected":""}>${k}</option>`).join("")}</select></label></div>
<div class="g3"><span>Profit level</span><label>Ticks${n("ps_tpk",c.tpTicks,1)}</label><label>Price${n("ps_tp",d.p[1].y)}</label></div>
<div class="g3"><span>Stop level</span><label>Ticks${n("ps_slk",c.slTicks,1)}</label><label>Price${n("ps_sl",d.p[2].y)}</label></div>
<div class="ro" id="ps_ro" aria-live="polite"></div></div>
<div class="tp" data-t="style"><div class="cl">Profit colour${colorPicker("ps_tc",o.tc)}</div><div class="cl">Stop colour${colorPicker("ps_sc",o.sc)}</div><div class="cl">Entry line colour${colorPicker("ps_ec",o.ec)}</div><div class="cl">Text colour${colorPicker("ps_xc",o.xc)}</div>
<label>Fill opacity<select id="ps_op">${[.1,.15,.2,.25,.3,.4].map(v=>`<option value="${v}" ${Math.abs(v-o.op)<1e-9?"selected":""}>${Math.round(v*100)}%</option>`).join("")}</select></label>
<label class="chk"><input type="checkbox" id="ps_compact" ${o.compact?"checked":""}> Compact stats</label><label class="chk"><input type="checkbox" id="ps_full" ${o.full?"checked":""}> Always show full stats</label><label class="chk"><input type="checkbox" id="ps_axis" ${o.axis?"checked":""}> Price labels on the scale</label></div>
<div class="tp" data-t="vis"><label class="chk"><input type="checkbox" id="ps_vis" ${d.hide?"":"checked"}> Visible on chart</label><label class="chk"><input type="checkbox" id="ps_lock" ${d.lock?"checked":""}> Locked</label></div>
<div class="row"><span class="sp"></span><button type="button" id="ps_cancel">Cancel</button><button type="button" class="pri" id="ps_ok">Ok</button></div></div>`);
swTab(tab||"inputs");const $=i=>document.getElementById(i),num=i=>parseFloat($(i).value);
const ro=()=>{const c=posCalcD(d);$("ps_ro").textContent=`Qty ${c.qty.toFixed(posO(d).prec)} \u00b7 Risk ${posMoney(c.riskAmt)} \u00b7 R:R ${c.rr.toFixed(2)} \u00b7 Target ${posMoney(c.pnlTP)} \u00b7 Stop ${posMoney(c.pnlSL)}`};
const apply=src=>{const D=posDef();const set=(k,v)=>{if(v==null||(typeof v==="number"&&!isFinite(v)))return;d[k]=v;D[k]=v};
  set("acct",num("ps_acct"));set("lot",num("ps_lot")||1);set("risk",num("ps_risk"));set("ru",$("ps_ru").value);set("lev",num("ps_lev")||0);set("prec",+$("ps_prec").value);
  ["tc","sc","ec","xc"].forEach(k=>set(k,$("ps_"+k).value));set("op",+$("ps_op").value);set("compact",$("ps_compact").checked);set("full",$("ps_full").checked);set("axis",$("ps_axis").checked);
  d.hide=!$("ps_vis").checked;d.lock=$("ps_lock").checked;
  const E=num("ps_en");if(E>0)d.p[0].y=E;const e=d.p[0].y,sg=L?1:-1;
  if(src==="ps_tpk"){const k=num("ps_tpk");if(k>0){d.p[1].y=+(e+sg*k*tk).toFixed(8);$("ps_tp").value=d.p[1].y}}else{const v=num("ps_tp");if(v>0&&(L?v>e:v<e))d.p[1].y=v}
  if(src==="ps_slk"){const k=num("ps_slk");if(k>0){d.p[2].y=+(e-sg*k*tk).toFixed(8);$("ps_sl").value=d.p[2].y}}else{const v=num("ps_sl");if(v>0&&(L?v<e:v>e))d.p[2].y=v}
  const c=posCalcD(d);if(src!=="ps_tpk")$("ps_tpk").value=c.tpTicks;if(src!=="ps_slk")$("ps_slk").value=c.slTicks;if(c.rr>0)D.rr=+c.rr.toFixed(2);ro();saveSoon()};
MD.querySelector(".pset").addEventListener("input",e=>{if(e.target.id)apply(e.target.id)});MD.querySelector(".pset").addEventListener("change",e=>{if(e.target.id)apply(e.target.id)});
MD.querySelector(".pset").addEventListener("vtcolor",()=>apply("color"));ro();
$("ps_ok").onclick=()=>{save();closeM();dsel()};$("ps_cancel").onclick=()=>{const L2=DL(),i=L2.indexOf(d),r=JSON.parse(snap);Object.keys(d).forEach(k=>delete d[k]);Object.assign(d,r);if(i<0)L2.push(d);save();closeM();dsel()};
const f=$("ps_acct");if(f&&tab!=="style")f.focus()}
// colour picks inside our dialogs, and style changes from the floating toolbar, save at once (debounced) and become that tool's default
S.toolDef=S.toolDef||{};
const _vtSelectColor=selectColor;selectColor=function(id,c){const r=_vtSelectColor.apply(this,arguments);
if(/^ps_/.test(id)){const p=document.querySelector(".pset");if(p)p.dispatchEvent(new Event("vtcolor"))}
if(SELD&&(id==="tb_c"||id==="ds_c")&&!isPos(SELD)){(S.toolDef[SELD.t]=S.toolDef[SELD.t]||{}).c=c;saveSoon()}
if(SELD&&(id==="ds_tc"||id==="ds_sc"||id==="ds_txc"))saveSoon();return r};
document.addEventListener("change",e=>{const t=e.target;if(!SELD||!t.closest||!t.closest("#dsel,.ov"))return;if(t.closest(".pset"))return;
if(!isPos(SELD)&&(t.closest("#dsel")||t.id==="ds_s"||t.id==="ds_w")){const D=(S.toolDef[SELD.t]=S.toolDef[SELD.t]||{});if(SELD.s!=null)D.s=SELD.s;if(SELD.w!=null)D.w=SELD.w;if(SELD.c)D.c=SELD.c}saveSoon()});// bubble phase: runs after the control's own onchange has updated SELD
document.addEventListener("input",e=>{const t=e.target;if(SELD&&t.closest&&t.closest(".ov")&&!t.closest(".pset")&&/^ds_/.test(t.id||""))saveSoon()},true);
const _vtDFin=dFin;dFin=function(){const d=DRAFT;if(d&&!isPos(d)){const D=S.toolDef[d.t];if(D){if(D.c)d.c=D.c;if(D.w)d.w=D.w;if(D.s!=null)d.s=D.s}}return _vtDFin.apply(this,arguments)};
// ---------- chart templates (Supercharts) ----------
// A template is the full chart setup: style + indicators + timeframe (S.chart), panes (S.sc), drawings for the symbol,
// drawing-tool and position-tool defaults, and optionally the symbol. Stored in S.tpl = {list:[...], def:id}.
// The default template is applied once per page load when Supercharts is first opened (setup only: no drawings, no symbol change).
// Guests can export/apply nothing they haven't saved; saving, importing, renaming and defaults need sign-in (vtGate).
const TPL_FMT="vektor-chart-templates",TPL_V=1;
function tplS(){S.tpl=S.tpl||{list:[],def:null};S.tpl.list=S.tpl.list||[];return S.tpl}
const tplClone=o=>JSON.parse(JSON.stringify(o));
function tplCapture(name,withSym){const ch=tplClone(S.chart);delete ch.sym;
  return{id:vtNextId("t"),name:String(name).trim().slice(0,60),created:Date.now(),
    sym:withSym?S.chart.sym:null,chart:ch,sc:{panes:S.sc.panes,tfB:S.sc.tfB,xsync:S.sc.xsync},dr:tplClone(DL()),toolDef:tplClone(S.toolDef||{}),posDef:tplClone(S.posDef||{})}}
function tplUniq(n,skip){const L=tplS().list;let b=n||"Template",x=b,i=2;while(L.some(t=>t!==skip&&t.name.toLowerCase()===x.toLowerCase()))x=b+" ("+(i++)+")";return x}
function tplSave(name,withSym){if(vtGate("chart templates"))return null;name=String(name||"").trim();if(!name){toast("Give the template a name");return null}
  const t=tplCapture(tplUniq(name),withSym);tplS().list.push(t);save();toast("Template \u201c"+t.name+"\u201d saved");return t}
function tplApply(t,opt){opt=opt||{};if(!t)return;const keep=S.chart.sym;
  for(const k of Object.keys(S.chart))if(k!=="sym"&&!(k in t.chart))delete S.chart[k];
  Object.assign(S.chart,tplClone(t.chart));S.chart.sym=(!opt.setupOnly&&t.sym)?t.sym:keep;
  if(t.sc){S.sc.tfB=t.sc.tfB||S.sc.tfB;S.sc.xsync=t.sc.xsync!==false}
  if(!opt.setupOnly){if(Array.isArray(t.dr)){S.dr=S.dr||{};S.dr[S.chart.sym]=tplClone(t.dr).map((d,i)=>Object.assign(d,{id:Date.now()+i}))}SELD=null;
    if(t.toolDef)S.toolDef=tplClone(t.toolDef);if(t.posDef)S.posDef=tplClone(t.posDef)}
  save();const n=t.sc&&t.sc.panes===2?2:1;
  if(typeof scSetPanes==="function"&&S.sc.panes!==n){S.sc.panes=n;scSetPanes(n)}
  drawChart();if(typeof markSel==="function")markSel();if(!opt.quiet)toast("Template \u201c"+t.name+"\u201d loaded")}
function tplRename(id,name){if(vtGate("chart templates"))return;const t=tplS().list.find(x=>x.id===id);name=String(name||"").trim().slice(0,60);if(!t||!name)return;t.name=tplUniq(name,t);save()}
function tplDelete(id){if(vtGate("chart templates"))return;const T=tplS();T.list=T.list.filter(x=>x.id!==id);if(T.def===id)T.def=null;save()}
function tplSetDef(id){if(vtGate("chart templates"))return;const T=tplS();T.def=T.def===id?null:id;save()}
// ---- JSON export / import (validated + sanitised; unknown keys dropped) ----
function tplExport(ids){const L=tplS().list.filter(t=>!ids||ids.includes(t.id));return{format:TPL_FMT,v:TPL_V,exported:new Date().toISOString(),templates:tplClone(L)}}
const TPL_DT=()=>typeof DT==="object"&&DT?Object.keys(DT):null;
function tplClean(t){if(!t||typeof t!=="object"||typeof t.name!=="string"||!t.chart||typeof t.chart!=="object"||Array.isArray(t.chart))return null;
  const ch={};for(const[k,v]of Object.entries(t.chart)){if(k==="sym")continue;const cur=S.chart[k];
    if(k==="ind"){if(Array.isArray(v))ch.ind=v.filter(d=>d&&typeof d==="object"&&typeof d.t==="string").map(d=>{const o={};for(const[a,b]of Object.entries(d))if(["string","number","boolean"].includes(typeof b))o[a]=b;return o});continue}
    if(["string","number","boolean"].includes(typeof v)&&(cur===undefined||typeof v===typeof cur))ch[k]=v}
  const okT=TPL_DT(),num=x=>typeof x==="number"&&isFinite(x);
  const dr=Array.isArray(t.dr)?t.dr.filter(d=>d&&typeof d.t==="string"&&(!okT||okT.includes(d.t))&&Array.isArray(d.p)&&d.p.every(p=>p&&num(p.t)&&num(p.y))).map(d=>{const o={};for(const[a,b]of Object.entries(d))if(a==="p")o.p=d.p.map(p=>({t:p.t,y:p.y}));else if(["string","number","boolean"].includes(typeof b))o[a]=b;return o}):[];
  const sc=t.sc&&typeof t.sc==="object"?{panes:t.sc.panes===2?2:1,tfB:typeof t.sc.tfB==="string"?t.sc.tfB.slice(0,8):"1D",xsync:t.sc.xsync!==false}:{panes:1,tfB:"1D",xsync:true};
  const flat=o=>{const r={};if(o&&typeof o==="object")for(const[k,v]of Object.entries(o)){if(v&&typeof v==="object"&&!Array.isArray(v)){r[k]={};for(const[a,b]of Object.entries(v))if(["string","number","boolean"].includes(typeof b))r[k][a]=b}else if(["string","number","boolean"].includes(typeof v))r[k]=v}return r};
  return{id:vtNextId("t"),name:t.name.trim().slice(0,60)||"Imported",created:Date.now(),sym:typeof t.sym==="string"&&/^[A-Z0-9.:_\-]{1,20}$/.test(t.sym)?t.sym:null,chart:ch,sc,dr,toolDef:flat(t.toolDef),posDef:flat(t.posDef)}}
function tplImport(text){if(vtGate("chart templates"))return -1;let j;try{j=JSON.parse(text)}catch(e){toast("That file isn\u2019t valid JSON");return 0}
  const arr=j&&j.format===TPL_FMT&&Array.isArray(j.templates)?j.templates:null;if(!arr){toast("That file isn\u2019t a Vektor chart template export");return 0}
  let n=0;for(const raw of arr.slice(0,100)){const t=tplClean(raw);if(!t)continue;t.name=tplUniq(t.name);tplS().list.push(t);n++}
  save();toast(n?"Imported "+n+" template"+(n>1?"s":""):"No usable templates in that file");return n}
// ---- default template: once per page load, on first Supercharts visit (setup only) ----
let TPL_DEF_DONE=false;
function tplMaybeDefault(){if(TPL_DEF_DONE||S.pageView!=="chart")return;TPL_DEF_DONE=true;const T=tplS(),t=T.def&&T.list.find(x=>x.id===T.def);if(t)tplApply(t,{setupOnly:true,quiet:true})}
// ---- menu (modal; a bottom sheet on phones) ----
function tplM(){const T=tplS(),L=T.list;
  const row=t=>`<li class="tplr" data-id="${esc(t.id)}"><button type="button" class="tpl_ld" data-id="${esc(t.id)}" title="Load this template"><span class="tpln">${esc(t.name)}</span>${t.sym?`<span class="tpls">${esc(t.sym)}</span>`:""}${T.def===t.id?'<span class="tpld">Default</span>':""}</button>
<span class="tpla"><button type="button" class="tpl_df${T.def===t.id?" on":""}" data-id="${esc(t.id)}" aria-pressed="${T.def===t.id}" aria-label="${T.def===t.id?"Remove as default":"Set as default"}: ${esc(t.name)}" title="${T.def===t.id?"Remove as default":"Set as default"}">${T.def===t.id?VT_IC.starOn:VT_IC.starOff}</button><button type="button" class="tpl_rn" data-id="${esc(t.id)}" aria-label="Rename ${esc(t.name)}" title="Rename">${VT_IC.edit}</button><button type="button" class="tpl_ex" data-id="${esc(t.id)}" aria-label="Export ${esc(t.name)}" title="Export JSON">${VT_IC.dl}</button><button type="button" class="tpl_dl" data-id="${esc(t.id)}" aria-label="Delete ${esc(t.name)}" title="Delete">${VT_IC.x}</button></span></li>`;
  modal(`<div class="tplm" role="dialog" aria-modal="true" aria-labelledby="tpl_h"><h3 id="tpl_h">Chart templates</h3>
<p class="mut tplhelp">A template saves this chart\u2019s style, indicators, timeframe, panes, drawings and tool defaults. The default (star) sets up VektorCharts each time you open the app.</p>
${L.length?`<ul class="tpll" aria-label="Saved templates">${L.map(row).join("")}</ul>`:`<p class="tple">No templates yet. Save the current chart below.</p>`}
<form class="tplf" id="tpl_form"><label for="tpl_name">Save current chart as</label><div class="tplrow"><input id="tpl_name" maxlength="60" placeholder="e.g. Clean candles + EMAs" autocomplete="off"><button type="submit" class="pri" id="tpl_save">Save</button></div>
<label class="chk"><input type="checkbox" id="tpl_sym"> Include the symbol (${esc(S.chart.sym)})</label></form>
<div class="tplio"><button type="button" id="tpl_exp" ${L.length?"":"disabled"}>Export all (JSON)</button><button type="button" id="tpl_imp">Import JSON\u2026</button><input type="file" id="tpl_file" accept="application/json,.json" hidden><button type="button" id="tpl_close">Close</button></div></div>`);
  const box=MD.querySelector(".tplm"),q=s=>box.querySelector(s);
  q("#tpl_form").onsubmit=e=>{e.preventDefault();if(tplSave(q("#tpl_name").value,q("#tpl_sym").checked))tplM()};
  q("#tpl_close").onclick=closeM;q("#tpl_exp").onclick=()=>vtDownload(tplExport(),"vektor-chart-templates.json");
  q("#tpl_imp").onclick=()=>{if(vtGate("chart templates"))return;q("#tpl_file").click()};
  q("#tpl_file").onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>2e6){toast("That file is too big");return}if(tplImport(await f.text())>0)tplM()};
  box.querySelectorAll(".tpl_ld").forEach(b=>b.onclick=()=>{tplApply(L.find(t=>t.id===b.dataset.id));closeM()});
  box.querySelectorAll(".tpl_df").forEach(b=>b.onclick=()=>{tplSetDef(b.dataset.id);if(!vtIsGuest())tplM()});
  box.querySelectorAll(".tpl_ex").forEach(b=>b.onclick=()=>{const t=L.find(x=>x.id===b.dataset.id);vtDownload(tplExport([t.id]),"vektor-template-"+t.name.replace(/[^a-z0-9]+/gi,"-").toLowerCase()+".json")});
  box.querySelectorAll(".tpl_rn").forEach(b=>b.onclick=()=>{if(vtGate("chart templates"))return;const li=b.closest("li"),t=L.find(x=>x.id===b.dataset.id);
    li.innerHTML=`<form class="tplrow tpl_rf"><input class="tpl_ri" maxlength="60" aria-label="New name for ${esc(t.name)}"><button type="submit" class="pri">Rename</button><button type="button" class="tpl_rc">Cancel</button></form>`;
    const i=li.querySelector("input");i.value=t.name;i.focus();i.select();li.querySelector(".tpl_rc").onclick=()=>tplM();
    li.querySelector("form").onsubmit=e=>{e.preventDefault();tplRename(t.id,i.value);tplM()}});
  box.querySelectorAll(".tpl_dl").forEach(b=>b.onclick=()=>{if(vtGate("chart templates"))return;const li=b.closest("li"),t=L.find(x=>x.id===b.dataset.id);
    li.innerHTML=`<span class="tplq">Delete \u201c${esc(t.name)}\u201d?</span><span class="tpla"><button type="button" class="tpl_dy danger">Delete</button><button type="button" class="tpl_dn">Keep</button></span>`;
    li.querySelector(".tpl_dn").onclick=()=>tplM();li.querySelector(".tpl_dy").onclick=()=>{tplDelete(t.id);tplM()};li.querySelector(".tpl_dn").focus()});
  MD.querySelector(".ov").addEventListener("keydown",e=>{if(e.key==="Escape"&&!e.target.closest(".tpl_rf")){e.preventDefault();closeM()}else if(e.key==="Escape"){e.preventDefault();tplM()}
    if(e.key==="Tab"){const f=[...box.querySelectorAll("button:not([disabled]),input:not([type=file])")].filter(x=>x.offsetParent!==null);if(!f.length)return;const a=f[0],z=f[f.length-1];
      if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus()}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus()}}});
  const first=box.querySelector(".tpl_ld")||q("#tpl_name");first.focus()}
// ---- toolbar button next to Settings ----
function tplBtn(){const s=document.querySelector('#cp .cpb .row.top button[onclick="setM()"]');if(!s||document.getElementById("tplb"))return;
  const b=document.createElement("button");b.id="tplb";b.type="button";b.className=s.className;b.textContent="Templates";b.title="Chart templates";b.setAttribute("aria-haspopup","dialog");b.onclick=tplM;s.after(b)}
const _vtAfterDrawT=vtAfterDraw;vtAfterDraw=function(){const r=_vtAfterDrawT.apply(this,arguments);try{tplBtn();tplMaybeDefault()}catch(e){console.error(e)}return r};
// ---------- drawing templates (per-tool style presets) ----------
// Built-in presets for trend line, horizontal ray, Fib retracement and long/short position, plus your own saved presets.
// Apply to the selected drawing, save its current style as a preset, or make a preset the tool's default for new drawings.
// User presets live in S.drawPre[tool]; saving them needs sign-in (vtGate) like other templates.
const DP_POS=[{n:"Conservative 1:1.5",rr:1.5,risk:0.5,ru:"%"},{n:"Standard 1:2",rr:2,risk:1,ru:"%"},{n:"Swing 1:3",rr:3,risk:1,ru:"%"}];
const DP_BUILTIN={
  trend:[{n:"Blue",c:"#2962ff",w:2,s:0},{n:"Thin grey",c:"#787b86",w:1,s:0},{n:"Bold orange",c:"#fb923c",w:3,s:0},{n:"Dashed",c:"#2962ff",w:2,s:1}],
  hray:[{n:"Support",c:"#089981",w:2,s:0},{n:"Resistance",c:"#f23645",w:2,s:0},{n:"Dotted level",c:"#787b86",w:1,s:2}],
  fib:[{n:"Classic grey",c:"#787b86",w:1,s:0},{n:"Gold",c:"#f5b301",w:2,s:0},{n:"Dashed blue",c:"#2962ff",w:1,s:1}],
  long:DP_POS,short:DP_POS};
const DP_LINE_K=["c","w","s"],DP_POS_K=["rr","risk","ru","acct","lot","lev","prec","tc","sc","op","compact","full","axis"];
function dpS(t){S.drawPre=S.drawPre||{};return S.drawPre[t]=S.drawPre[t]||[]}
function dpPick(d){const o={};if(isPos(d)){const c=posCalcD(d),O=posO(d);for(const k of DP_POS_K)if(k!=="rr"&&O[k]!=null)o[k]=O[k];if(c.rr>0)o.rr=+c.rr.toFixed(2)}else for(const k of DP_LINE_K)if(d[k]!=null)o[k]=d[k];return o}
function dpApply(d,p){if(!d||!p)return;pushUndo();
  if(isPos(d)){for(const k of DP_POS_K)if(k!=="rr"&&p[k]!=null)d[k]=p[k];
    if(p.rr>0){const E=d.p[0].y,dist=Math.abs(E-d.p[2].y),L=d.t!=="short";d.p[1].y=vtRoundPx(symOf(S.chart.sym),L?E+dist*p.rr:E-dist*p.rr)}}
  else for(const k of DP_LINE_K)if(p[k]!=null)d[k]=p[k];
  save();dsel()}
function dpDefault(t,p){if(isPos({t})){const D=posDef();for(const k of DP_POS_K)if(p[k]!=null)D[k]=p[k]}else{S.toolDef=S.toolDef||{};S.toolDef[t]=Object.assign(S.toolDef[t]||{},Object.fromEntries(DP_LINE_K.filter(k=>p[k]!=null).map(k=>[k,p[k]])))}save();toast("New "+(DT[t]||t).toLowerCase()+"s will use \u201c"+p.n+"\u201d")}
function dpSaveAs(d,name){if(vtGate("drawing templates"))return null;name=String(name||"").trim().slice(0,40);if(!name){toast("Give the template a name");return null}
  const L=dpS(d.t),p=Object.assign({n:name},dpPick(d)),i=L.findIndex(x=>x.n.toLowerCase()===name.toLowerCase());if(i>=0)L[i]=p;else L.push(p);save();toast("Saved \u201c"+name+"\u201d");return p}
function dpDelete(t,name){if(vtGate("drawing templates"))return;S.drawPre[t]=dpS(t).filter(x=>x.n!==name);save()}
function dpSw(p){if(p.rr!=null)return`<span class="dpsw dppos">1:${esc(p.rr)}</span>`;const st=(LSTYLES[p.s||0]||{}).d||[];
  return`<svg class="dpsw" width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><line x1="2" y1="6" x2="32" y2="6" stroke="${esc(p.c||"#2962ff")}" stroke-width="${+p.w||1}" stroke-dasharray="${st.join(" ")}"/></svg>`}
function dpM(){const d=SELD;if(!d||!DP_BUILTIN[d.t])return;const t=d.t,B=DP_BUILTIN[t],U=dpS(t);
  const row=(p,u,i)=>`<li><button type="button" class="dp_ap" data-u="${u?1:0}" data-i="${i}">${dpSw(p)}<span>${esc(p.n)}</span>${p.risk!=null?`<span class="mut">risk ${esc(p.risk)}${esc(p.ru==="%"?"%":"")}</span>`:""}</button><span class="tpla"><button type="button" class="dp_df" data-u="${u?1:0}" data-i="${i}" title="Use for new drawings" aria-label="Use ${esc(p.n)} for new drawings">${VT_IC.starOn}</button>${u?`<button type="button" class="dp_dl" data-i="${i}" title="Delete" aria-label="Delete ${esc(p.n)}">${VT_IC.x}</button>`:""}</span></li>`;
  modal(`<div class="dpm tplm" role="dialog" aria-modal="true" aria-labelledby="dp_h"><h3 id="dp_h">${esc(DT[t]||t)} templates</h3>
<p class="mut tplhelp">Click a template to apply it to the selected drawing. Use the star button to make it the default for new ${esc((DT[t]||t).toLowerCase())}s.</p>
<ul class="tpll dpl" aria-label="Built-in templates">${B.map((p,i)=>row(p,false,i)).join("")}</ul>
${U.length?`<p class="mut dpsub">Your templates</p><ul class="tpll dpl" aria-label="Your templates">${U.map((p,i)=>row(p,true,i)).join("")}</ul>`:""}
<form class="tplf" id="dp_form"><label for="dp_name">Save this drawing\u2019s style as</label><div class="tplrow"><input id="dp_name" maxlength="40" autocomplete="off" placeholder="e.g. My support line"><button type="submit" class="pri" id="dp_save">Save</button></div></form>
<div class="tplio"><button type="button" id="dp_close">Close</button></div></div>`);
  const box=MD.querySelector(".dpm"),get=b=>(b.dataset.u==="1"?U:B)[+b.dataset.i];
  box.querySelectorAll(".dp_ap").forEach(b=>b.onclick=()=>{dpApply(d,get(b));closeM()});
  box.querySelectorAll(".dp_df").forEach(b=>b.onclick=()=>{dpDefault(t,get(b));closeM()});
  box.querySelectorAll(".dp_dl").forEach(b=>b.onclick=()=>{dpDelete(t,U[+b.dataset.i].n);if(!vtIsGuest())dpM()});
  box.querySelector("#dp_form").onsubmit=e=>{e.preventDefault();if(dpSaveAs(d,box.querySelector("#dp_name").value))dpM()};
  box.querySelector("#dp_close").onclick=closeM;
  MD.querySelector(".ov").addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();closeM()}
    if(e.key==="Tab"){const f=[...box.querySelectorAll("button,input")].filter(x=>x.offsetParent!==null),a=f[0],z=f[f.length-1];if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus()}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus()}}});
  box.querySelector(".dp_ap").focus()}
const _vtDselDP=dsel;dsel=function(){const r=_vtDselDP.apply(this,arguments);const e=document.getElementById("dsel");
  if(e&&SELD&&DP_BUILTIN[SELD.t]&&!e.querySelector("#ds_tpl")){const b=document.createElement("button");b.id="ds_tpl";b.type="button";b.title="Drawing templates";b.setAttribute("aria-label","Drawing templates");if(e.querySelector(".pbtn"))b.className="pbtn";
    b.innerHTML='<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="1.5" y="1.5" width="5" height="5" rx="1"/><rect x="8.5" y="1.5" width="5" height="5" rx="1"/><rect x="1.5" y="8.5" width="5" height="5" rx="1"/><path d="M9 11h4M11 9v4"/></svg>';b.onclick=dpM;
    const st=e.querySelector('button[onclick^="drawSetM"]');st?st.before(b):e.append(b)}return r};
