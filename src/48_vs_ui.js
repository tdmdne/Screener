// ---------- Vektor Script: editor, chart plotting, import/export ----------
// Scripts live with your other settings (scr2: S.vs). Enabled scripts are drawn on the main chart (Workspace and
// Supercharts): overlay scripts on the price scale, the others in stacked bands at the bottom of the chart.
const VS_EX=[
 {name:"MACD",src:`indicator("MACD", overlay=false)\nfast = input(12, "Fast length", min=1, max=200)\nslow = input(26, "Slow length", min=1, max=400)\nsignal_len = input(9, "Signal length", min=1, max=100)\nmacd = ema(close, fast) - ema(close, slow)\nsignal = ema(macd, signal_len)\nplot(macd - signal, "Histogram", color=gray, style="histogram")\nplot(macd, "MACD", color=blue)\nplot(signal, "Signal", color=orange)\nhline(0, "Zero")`},
 {name:"RSI with bands",src:`indicator("RSI", overlay=false)\nlen = input(14, "Length", min=2, max=200)\nr = rsi(close, len)\nplot(r, "RSI", color=purple)\nhline(70, "Upper", color=red)\nhline(30, "Lower", color=green)`},
 {name:"Bollinger Bands",src:`indicator("Bollinger Bands", overlay=true)\nlen = input(20, "Length", min=2, max=400)\nmult = input(2, "StdDev", min=0.5, max=5)\nbasis = sma(close, len)\ndev = mult * stdev(close, len)\nplot(basis, "Basis", color=orange)\nplot(basis + dev, "Upper", color=blue, width=1)\nplot(basis - dev, "Lower", color=blue, width=1)`},
 {name:"Stochastic",src:`indicator("Stochastic", overlay=false)\nk_len = input(14, "%K length", min=1, max=200)\nd_len = input(3, "%D smoothing", min=1, max=50)\nlo = lowest(low, k_len)\nhi = highest(high, k_len)\nk = hi - lo == 0 ? 50 : 100 * (close - lo) / (hi - lo)\nd = sma(k, d_len)\nplot(k, "%K", color=blue)\nplot(d, "%D", color=orange)\nhline(80, "Upper")\nhline(20, "Lower")`},
 {name:"EMA cross",src:`indicator("EMA cross", overlay=true)\nfast_len = input(9, "Fast", min=1, max=200)\nslow_len = input(21, "Slow", min=1, max=400)\nfast = ema(close, fast_len)\nslow = ema(close, slow_len)\nplot(fast, "Fast EMA", color=teal)\nplot(slow, "Slow EMA", color=red)`},
 {name:"Keltner channel (ATR)",src:`indicator("Keltner channel", overlay=true)\nlen = input(20, "Length", min=2, max=400)\nmult = input(1.5, "ATR multiple", min=0.1, max=10)\nmid = ema(close, len)\nband = mult * atr(len)\nplot(mid, "Middle", color=gray)\nplot(mid + band, "Upper", color=teal, width=1)\nplot(mid - band, "Lower", color=teal, width=1)`},
 {name:"Rate of change",src:`indicator("Rate of change", overlay=false)\nlen = input(10, "Length", min=1, max=400)\nplot(roc(close, len), "ROC %", color=blue)\nhline(0, "Zero")`},
];
const VS_MAX_SCRIPTS=50,VS_IMPORT_MAX=512*1024;
const VSUI={sel:null,ser:[],errs:{},cache:new Map(),live:0};
function vsCfg(){if(!S.vs||typeof S.vs!=="object"||Array.isArray(S.vs))S.vs={};if(!Array.isArray(S.vs.list))S.vs.list=[];return S.vs}
function vsNew(name,src){const C=vsCfg();if(C.list.length>=VS_MAX_SCRIPTS){toast("You can keep up to "+VS_MAX_SCRIPTS+" scripts");return null}
  const sc={id:"vs"+Date.now().toString(36)+Math.random().toString(36).slice(2,6),name:String(name||"My script").slice(0,60),src:String(src||`indicator("My script", overlay=true)\nplot(ema(close, 20), "EMA 20", color=orange)`).slice(0,VS_LIM.src),on:false,inp:{}};C.list.push(sc);save();return sc}
function vsGet(id){return vsCfg().list.find(x=>x.id===id)||null}
// sanitise one imported script: only the known fields, as plain text/numbers
function vsClean(o){if(!o||typeof o!=="object"||typeof o.src!=="string"||o.src.length>VS_LIM.src)return null;const inp={};
  if(o.inp&&typeof o.inp==="object")for(const k of Object.keys(o.inp).slice(0,30))if(typeof k==="string"&&k.length<=80&&isFinite(+o.inp[k]))inp[k]=+o.inp[k];
  return{name:String(typeof o.name==="string"?o.name:"Imported script").slice(0,60),src:o.src,inp}}
function vsExport(list){const data={format:"vektor-script",version:1,exported:new Date().toISOString(),scripts:list.map(s=>({name:s.name,src:s.src,inp:s.inp||{}}))};
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
  a.download=(list.length===1?list[0].name.replace(/[^A-Za-z0-9_-]+/g,"-").replace(/^-|-$/g,"")||"script":"vektor-scripts")+".vks.json";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);return data}
// accepts our export format, a single {name,src}, or plain script text (.vks/.txt); returns {added, skipped, errors[]}
function vsImportText(txt,fname){const res={added:0,skipped:0,errors:[]};if(typeof txt!=="string"||txt.length>VS_IMPORT_MAX){res.errors.push("File is too large (512 KB max)");return res}
  let items=null;const t=txt.trim();
  if(t.startsWith("{")||t.startsWith("[")){let j;try{j=JSON.parse(t)}catch(e){res.errors.push("This isn\u2019t valid JSON: "+e.message);return res}
    items=Array.isArray(j)?j:j&&Array.isArray(j.scripts)?j.scripts:[j]}else items=[{name:String(fname||"Imported script").replace(/\.(vks|txt)$/i,""),src:txt}];
  for(const it of items.slice(0,VS_MAX_SCRIPTS)){const c=vsClean(it);if(!c){res.skipped++;continue}try{vsParse(c.src)}catch(e){res.errors.push((c.name||"Script")+": line "+e.line+": "+e.message)}
    const sc=vsNew(c.name,c.src);if(!sc){res.skipped++;continue}sc.inp=c.inp;res.added++}
  if(items.length>VS_MAX_SCRIPTS)res.skipped+=items.length-VS_MAX_SCRIPTS;save();return res}
// ---- run on bars (cached by source, inputs and the data)
function vsBarsKey(a){const z=a[a.length-1];return a.length+"|"+(z&&z.t)+"|"+(z&&z.c)+"|"+(z&&z.h)+"|"+(z&&z.l)}
function vsCompute(sc,a){const key=sc.src+"\u0000"+JSON.stringify(sc.inp||{})+"\u0000"+vsBarsKey(a);const c=VSUI.cache.get(sc.id);if(c&&c.key===key)return c.r;
  let r;try{r={ok:vsRun(sc.src,a,sc.inp||{})}}catch(e){r={err:e instanceof VSError?e:new VSError(String(e&&e.message||e))}}VSUI.cache.set(sc.id,{key,r});return r}
function vsFmtErr(e){return(e.line?"Line "+e.line+(e.col?", column "+e.col:"")+": ":"")+e.message+(e.hint?" "+e.hint:"")}
// ---- plotting on the main chart
function vsPlot(s,a,T){VSUI.ser=[];if(typeof ch==="undefined"||!ch||!a||!a.length)return;const on=vsCfg().list.filter(x=>x.on);if(!on.length){vsLegend(on);return}
  const res=on.map(sc=>({sc,r:vsCompute(sc,a)}));const osc=res.filter(x=>x.r.ok&&!x.r.ok.overlay),band=Math.min(.24,.5/Math.max(1,osc.length));
  if(osc.length)try{ch.priceScale("right").applyOptions({scaleMargins:{top:.06,bottom:Math.min(.6,band*osc.length+.04)}})}catch(e){}
  res.forEach(({sc,r})=>{VSUI.errs[sc.id]=r.err||null;if(!r.ok)return;const R=r.ok,j=osc.findIndex(x=>x.sc===sc);
    const scale=R.overlay?"right":"vs_"+sc.id,refs=[];
    R.plots.forEach((p,pi)=>{const o={color:p.color,lineWidth:p.width,priceLineVisible:false,lastValueVisible:!R.overlay,crosshairMarkerVisible:false,priceScaleId:scale,title:""};
      const ser=p.style==="histogram"?ch.addHistogramSeries({color:p.color,priceScaleId:scale,priceLineVisible:false,lastValueVisible:false}):p.style==="area"?ch.addAreaSeries({lineColor:p.color,topColor:p.color+"55",bottomColor:p.color+"05",lineWidth:p.width,priceScaleId:scale,priceLineVisible:false,lastValueVisible:false}):ch.addLineSeries(o);
      if(!R.overlay)try{ch.priceScale(scale).applyOptions({scaleMargins:{top:1-band*(j+1)+.01,bottom:band*j+.01},borderVisible:false})}catch(e){}
      ser.setData(vsPts(p.v,T));refs.push({ser,pi});if(pi===0)R.hlines.forEach(h=>{if(isFinite(h.v))ser.createPriceLine({price:h.v,color:h.color,lineWidth:1,lineStyle:2,axisLabelVisible:false,title:h.title||""})})});
    VSUI.ser.push({sc,refs,key:vsBarsKey(a)})});vsLegend(on)}
function vsPts(v,T){const o=[];for(let i=0;i<v.length;i++){const y=v[i];if(isFinite(y))o.push({time:T(i),value:y})}return o}
// small legend at the bottom-left of the chart: one chip per active script (errors shown there too)
function vsLegend(on){const host=document.getElementById("cv");if(!host)return;let L=document.getElementById("vsleg");if(!on.length){if(L)L.remove();return}
  if(!L||!host.parentElement.contains(L)){L=document.createElement("div");L.id="vsleg";L.className="vsleg";host.parentElement.appendChild(L)}
  const warnSvg='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:4px"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>';
  L.innerHTML=on.map(sc=>{const e=VSUI.errs[sc.id];return`<button type="button" class="vschip${e?" err":""}" data-id="${esc(sc.id)}" title="${e?esc(vsFmtErr(e)):"Edit script"}">${e?warnSvg:""}${esc(sc.name)}</button>`}).join("");
  L.querySelectorAll(".vschip").forEach(b=>b.onclick=()=>vsM(b.dataset.id))}
// live: recompute when the last bar changes and update only the last points
setInterval(()=>{if(document.hidden||!VSUI.ser.length||typeof ch==="undefined"||!ch)return;const s=symOf(S.chart.sym);if(!s)return;const a=candles(s,S.chart.tf);if(!a||!a.length)return;const k=vsBarsKey(a);
  for(const e of VSUI.ser){if(e.key===k)continue;const prevLen=+e.key.split("|")[0];if(a.length!==prevLen){if(typeof drawChart==="function")drawChart();return}
    e.key=k;const r=vsCompute(e.sc,a);if(!r.ok)continue;const st=STEP[S.chart.tf]||3600,z=a[a.length-1],t=z.t||Math.floor(Date.now()/1000/st)*st;
    e.refs.forEach(({ser,pi})=>{const v=r.ok.plots[pi]&&r.ok.plots[pi].v[a.length-1];if(isFinite(v))try{ser.update({time:t,value:v})}catch(x){}})}},1000);
if(typeof vtAfterDraw==="function"){const _vsAD=vtAfterDraw;vtAfterDraw=function(s,a,T){const r=_vsAD.apply(this,arguments);try{vsBtn();vsPlot(s,a,T)}catch(e){console.error(e)}return r}}
function vsBtn(){const s=document.querySelector('#cp .cpb .row.top button[onclick="setM()"]');if(!s||document.getElementById("vsb"))return;
  const b=document.createElement("button");b.id="vsb";b.type="button";b.className=s.className;b.textContent="Scripts";b.title="Custom indicator scripts";b.setAttribute("aria-haspopup","dialog");b.onclick=()=>vsM();(document.getElementById("tplb")||s).after(b)}
// ---- editor
function vsHelpHTML(){return`<details class="vshelp"><summary>Language help</summary><div class="vshb">
<p><b>Lines:</b> <code>name = expression</code>, or a call such as <code>plot(...)</code>. <code>//</code> starts a comment.</p>
<p><b>Declare:</b> <code>indicator("Name", overlay=true)</code> (overlay=false draws in its own band), <code>input(14, "Length", min=1, max=200)</code>, <code>plot(series, "Title", color=blue, width=2, style="line" | "histogram" | "area")</code>, <code>hline(70, "Upper", color=red)</code>.</p>
<p><b>Series:</b> ${VS_SERIES.map(x=>`<code>${x}</code>`).join(" ")}. <b>Past values:</b> <code>close[1]</code> is the previous bar.</p>
<p><b>Operators:</b> <code>+ - * / %</code>, <code>${esc("< <= > >= == !=")}</code>, <code>and or not</code>, <code>condition ? a : b</code>. <code>na</code> is a missing value.</p>
<p><b>Functions:</b> ${Object.keys(VS_FN).map(k=>`<code title="${esc(VS_FN[k].sig)}">${esc(VS_FN[k].sig)}</code>`).join(" ")}</p>
<p><b>Colours:</b> <code>#2962ff</code> or ${Object.keys(VS_COLORS).map(c=>`<code>${c}</code>`).join(" ")}</p>
<p class="mut">Scripts run inside the app\u2019s own interpreter. They can only read the chart\u2019s candles and draw lines; they can\u2019t open pages, send data or read storage. Results are calculations on past prices, not advice.</p></div></details>`}
function vsM(id){const C=vsCfg();if(id&&vsGet(id))VSUI.sel=id;if(!VSUI.sel||!vsGet(VSUI.sel))VSUI.sel=C.list[0]?C.list[0].id:null;const sc=VSUI.sel?vsGet(VSUI.sel):null;
  const li=x=>`<li><button type="button" class="vsli${x.id===VSUI.sel?" on":""}" data-id="${esc(x.id)}" aria-current="${x.id===VSUI.sel}">${x.on?'<span class="vsdot" aria-hidden="true"></span>':""}${esc(x.name)}${x.on?'<span class="vh">(on chart)</span>':""}</button></li>`;
  const xSvg='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  modal(`<div class="vsm"><div class="vshd"><h3 id="vs_t">Indicator scripts</h3><span class="mut">Vektor Script</span><span class="sp"></span><button type="button" class="ibtn" aria-label="Close" onclick="closeM()">${xSvg}</button></div>
<div class="vsbody"><aside class="vsside"><h4>My scripts</h4>${C.list.length?`<ul class="vsl">${C.list.map(li).join("")}</ul>`:`<p class="mut">None yet. Start from an example or a blank script.</p>`}
<div class="vsbtns"><button type="button" id="vs_new">New</button><button type="button" id="vs_imp">Import\u2026</button><input type="file" id="vs_file" accept=".json,.vks,.txt,application/json,text/plain" hidden>${C.list.length?`<button type="button" id="vs_expall">Export all</button>`:""}</div>
<h4>Examples</h4><ul class="vsl">${VS_EX.map((x,i)=>`<li><button type="button" class="vsex" data-i="${i}" title="Add a copy to My scripts">${esc(x.name)}</button></li>`).join("")}</ul></aside>
<section class="vsmain">${sc?`<div class="vsrow"><label class="vsname">Name<input id="vs_name" maxlength="60" value="${esc(sc.name)}" autocomplete="off"></label>
<button type="button" id="vs_tog" class="${sc.on?"":"pri"}" aria-pressed="${!!sc.on}">${sc.on?"Remove from chart":"Add to chart"}</button></div>
<div class="vsed"><pre class="vsgut" id="vs_gut" aria-hidden="true"></pre><textarea id="vs_src" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="Script source" aria-describedby="vs_msg">${esc(sc.src)}</textarea></div>
<div id="vs_msg" class="vsmsg" role="status" aria-live="polite"></div><div id="vs_inp" class="vsinp"></div>
<div class="vsrow"><button type="button" id="vs_chk">Check</button><button type="button" id="vs_save" class="pri">Save</button><button type="button" id="vs_pine" title="Auto-translate Pine Script v5/v6 to Vektor Script">Translate Pine</button><span class="sp"></span><button type="button" id="vs_dup">Duplicate</button><button type="button" id="vs_exp">Export</button><button type="button" id="vs_del" class="vsdanger">Delete</button></div>`
: `<div class="vsempty"><p>Write your own indicators in a small, safe language and draw them on the chart.</p><p class="mut">Pick an example on the left to get started, or create a blank script.</p></div>`}
${vsHelpHTML()}</section></div></div>`);
  const box=MD.querySelector(".box");if(box)box.setAttribute("aria-labelledby","vs_t");const q=s=>document.getElementById(s);
  MD.querySelectorAll(".vsli").forEach(b=>b.onclick=()=>{vsStash();vsM(b.dataset.id)});
  MD.querySelectorAll(".vsex").forEach(b=>b.onclick=()=>{vsStash();const x=VS_EX[+b.dataset.i],n=vsNew(x.name,x.src);if(n){vsM(n.id);vsCheck(true)}});
  q("vs_new").onclick=()=>{vsStash();const n=vsNew("My script");if(n)vsM(n.id)};
  q("vs_imp").onclick=()=>q("vs_file").click();
  q("vs_file").onchange=e=>{const f=e.target.files&&e.target.files[0];if(!f)return;if(f.size>VS_IMPORT_MAX){vsMsg("File is too large (512 KB max)",true);return}
    const rd=new FileReader();rd.onload=()=>{const r=vsImportText(String(rd.result),f.name);const last=vsCfg().list[vsCfg().list.length-1];if(r.added)vsM(last.id);
      vsMsg(r.added?"Imported "+r.added+" script"+(r.added===1?"":"s")+(r.skipped?", skipped "+r.skipped:"")+(r.errors.length?". Check: "+r.errors.join("; "):"."):"Nothing imported. "+(r.errors.join("; ")||"The file has no scripts."),!r.added||r.errors.length>0)};rd.readAsText(f)};
  if(q("vs_expall"))q("vs_expall").onclick=()=>{vsStash();vsExport(vsCfg().list)};
  if(!sc){vsFocus();return}
  const ta=q("vs_src"),gut=q("vs_gut");const lines=()=>{const n=ta.value.split("\n").length;let h="";for(let i=1;i<=n;i++)h+=i+"\n";gut.textContent=h};lines();
  ta.addEventListener("input",()=>{lines();clearTimeout(VSUI.t);VSUI.t=setTimeout(()=>vsCheck(false),500)});ta.addEventListener("scroll",()=>{gut.scrollTop=ta.scrollTop});
  ta.addEventListener("keydown",e=>{if(e.key==="Tab"&&!e.shiftKey&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!VSUI.tabOut){e.preventDefault();const a=ta.selectionStart,b=ta.selectionEnd;ta.setRangeText("  ",a,b,"end");lines()}
    else if(e.key==="Escape"){VSUI.tabOut=true;setTimeout(()=>VSUI.tabOut=false,1500)}
    else if((e.ctrlKey||e.metaKey)&&e.key==="s"){e.preventDefault();e.stopPropagation();vsSave()}
    else if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();vsCheck(true)}});
  q("vs_chk").onclick=()=>vsCheck(true);q("vs_save").onclick=()=>vsSave();
  if(q("vs_pine"))q("vs_pine").onclick=()=>{if(ta){ta.value=vsTranspilePine(ta.value);lines();vsCheck(true);vsMsg("Translated Pine Script to Vektor Script.")}};
  q("vs_tog").onclick=()=>{vsSave(true);const c=vsCheck(true);if(!sc.on&&!c){vsMsg("Fix the error above before adding it to the chart.",true);return}sc.on=!sc.on;save();vsRedraw();vsM(sc.id);vsMsg(sc.on?"Added to the chart.":"Removed from the chart.")};
  q("vs_dup").onclick=()=>{vsSave(true);const n=vsNew(sc.name+" (copy)",sc.src);if(n){n.inp=Object.assign({},sc.inp);save();vsM(n.id)}};
  q("vs_exp").onclick=()=>{vsSave(true);vsExport([sc])};
  q("vs_del").onclick=()=>{if(!confirm("Delete \u201c"+sc.name+"\u201d?"))return;const L=vsCfg().list,i=L.indexOf(sc);if(i>=0)L.splice(i,1);VSUI.cache.delete(sc.id);VSUI.sel=null;save();if(sc.on)vsRedraw();vsM()};
  q("vs_name").addEventListener("change",()=>vsSave(true));
  vsCheck(false);vsFocus()}
function vsFocus(){const f=document.getElementById("vs_src")||MD.querySelector(".vsex");if(f)f.focus({preventScroll:true})}
function vsStash(){const ta=document.getElementById("vs_src"),sc=VSUI.sel&&vsGet(VSUI.sel);if(ta&&sc&&ta.value!==sc.src){sc.src=ta.value.slice(0,VS_LIM.src);save()}}
function vsSave(quiet){const sc=vsGet(VSUI.sel);if(!sc)return;const ta=document.getElementById("vs_src"),nm=document.getElementById("vs_name");
  if(ta)sc.src=ta.value.slice(0,VS_LIM.src);if(nm&&nm.value.trim())sc.name=nm.value.trim().slice(0,60);save();VSUI.cache.delete(sc.id);
  if(sc.on)vsRedraw();clearTimeout(VSUI.t);if(!quiet){const ok=vsCheck(true);if(ok)vsMsg("Saved."+(sc.on?" The chart is updated.":""));else{const m=document.getElementById("vs_msg");if(m)m.insertBefore(document.createTextNode("Saved, but there is an error. "),m.firstChild)}const b=MD.querySelector('.vsli[data-id="'+sc.id+'"]');if(b)b.childNodes.forEach(n=>{if(n.nodeType===3)n.textContent=sc.name})}}
function vsRedraw(){if(typeof drawChart==="function"&&typeof chartOnPage==="function"&&chartOnPage())drawChart()}
function vsMsg(t,err){const m=document.getElementById("vs_msg");if(!m)return;m.className="vsmsg"+(err?" err":" ok");m.textContent=t}
// check the editor text against the current chart's candles; shows the error with a "Go to line" button, or the inputs and last values
function vsCheck(show,keepInputs){const ta=document.getElementById("vs_src"),sc=vsGet(VSUI.sel);if(!ta||!sc)return false;const s=symOf(S.chart.sym)||SYMS[0];const a=(s&&candles(s,S.chart.tf))||[];
  const bars=a.length?a:Array.from({length:60},(_,i)=>({t:i*60,o:100,h:101,l:99,c:100+Math.sin(i/5),v:1}));
  let r;try{r=vsRun(ta.value,bars,sc.inp||{})}catch(e){const er=e instanceof VSError?e:new VSError(String(e&&e.message||e));const m=document.getElementById("vs_msg");
    m.className="vsmsg err";m.textContent="";const sp=document.createElement("span");sp.textContent=vsFmtErr(er);m.appendChild(sp);
    if(er.line){const b=document.createElement("button");b.type="button";b.className="lnk";b.textContent="Go to line "+er.line;b.onclick=()=>vsGoto(er.line,er.col);m.appendChild(b)}
    document.getElementById("vs_inp").innerHTML="";return false}
  const last=r.plots.map(p=>{let v=NaN;for(let i=p.v.length-1;i>=0;i--)if(isFinite(p.v[i])){v=p.v[i];break}return esc(p.title)+" "+(isFinite(v)?(Math.abs(v)>=1000?v.toFixed(0):v.toFixed(Math.abs(v)<1?4:2)):"\u2013")});
  if(show||document.getElementById("vs_msg").classList.contains("err"))vsMsg("No errors. "+r.plots.length+" plot"+(r.plots.length===1?"":"s")+(r.hlines.length?", "+r.hlines.length+" line"+(r.hlines.length===1?"":"s"):"")+", "+(r.overlay?"drawn over the price":"drawn in its own band")+". Last values"+(a.length?" on "+S.chart.sym+" "+S.chart.tf:" (sample bars)")+": "+last.join(", ")+".");
  const box=document.getElementById("vs_inp");if(keepInputs&&box.querySelector("input"))return true;box.innerHTML=r.inputs.length?`<fieldset><legend>Inputs</legend>${r.inputs.map((x,i)=>`<label>${esc(x.title)}<input type="number" step="any" data-t="${esc(x.title)}" value="${x.v}" ${x.min>-1e12?`min="${x.min}"`:""} ${x.max<1e12?`max="${x.max}"`:""}></label>`).join("")}</fieldset>`:"";
  box.querySelectorAll("input").forEach(inp=>inp.onchange=()=>{const v=+inp.value;if(!isFinite(v))return;sc.inp=sc.inp||{};sc.inp[inp.dataset.t]=v;save();VSUI.cache.delete(sc.id);if(sc.on)vsRedraw();vsCheck(true,true)});return true}
function vsGoto(line,col){const ta=document.getElementById("vs_src");if(!ta)return;const L=ta.value.split("\n");let p=0;for(let i=0;i<line-1&&i<L.length;i++)p+=L[i].length+1;p+=Math.max(0,(col||1)-1);
  ta.focus();ta.setSelectionRange(p,Math.min(ta.value.length,p+Math.max(1,(L[line-1]||"").length-(col||1)+1)));const lh=parseFloat(getComputedStyle(ta).lineHeight)||18;ta.scrollTop=Math.max(0,(line-3)*lh)}
