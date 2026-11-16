// ---------- UK GDPR / PECR mechanisms: storage consent banner + log, privacy centre (export, delete, rights requests) ----------
// Template only, not legal advice; have a solicitor review before publishing.
const VT_POLICY_V="1.0";             // bump when the cookie/privacy notice changes materially: everyone is asked again
const VT_CONSENT_MAX_AGE=365*864e5;  // and again after 12 months
let vtOpenMail=u=>{location.href=u};
const VT_DSR_EMAIL=VT_CONTACT_EMAIL;   // request e-mail button target (set in 90_legal.js)
const VT_CK="vt_consent",VT_CL="vt_consent_log";
function vtLS(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
function vtConsent(){try{const c=JSON.parse(vtLS(VT_CK)||"null");if(c&&c.v===VT_POLICY_V&&Date.now()-c.ts<VT_CONSENT_MAX_AGE)return c}catch(e){}return null}
function vtCacheOK(){const c=vtConsent();return !!(c&&c.cache)}
// optional preferences (alert sound and similar extras): only remembered on this device with consent; records made before
// this category existed have no "prefs" field and so count as "no"
function vtPrefsOK(){const c=vtConsent();return !!(c&&c.prefs)}
const VT_PREFS_KEY="vt_prefs";
function vtPrefsClear(){try{localStorage.removeItem(VT_PREFS_KEY);const ks=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(/^vt_(aikey|tdkey)(~|$)/.test(k))ks.push(k)}ks.forEach(k=>localStorage.removeItem(k))}catch(e){}}
function vtConsentLog(){try{const l=JSON.parse(vtLS(VT_CL)||"[]");return Array.isArray(l)?l:[]}catch(e){return[]}}
function vtConsentSet(cache,method,prefs){const rec={v:VT_POLICY_V,ts:Date.now(),cache:!!cache,prefs:prefs==null?method==="accept_all":!!prefs,method};
vtLS(VT_CK,JSON.stringify(rec));const l=vtConsentLog();l.push(rec);vtLS(VT_CL,JSON.stringify(l.slice(-50)));
vtBannerClose();vtCacheApply();if(!rec.prefs)vtPrefsClear();try{document.dispatchEvent(new CustomEvent("vt-consent",{detail:rec}))}catch(e){}if(document.documentElement.dataset.page==="legal"&&typeof legalRender==="function")legalRender();
toast(cache||rec.prefs?"Saved: "+[cache?"market-data cache":"",rec.prefs?"optional preferences":""].filter(Boolean).join(" and ")+" on":"Saved: only strictly necessary storage");return rec}
// non-essential storage gate: the IndexedDB market-data cache is only opened (and so only created) with consent
const _vtIdb=idb;idb=function(){return vtCacheOK()?_vtIdb():Promise.resolve(null)};
function vtIdbDel(name){return new Promise(r=>{try{const q=indexedDB.deleteDatabase(name);q.onsuccess=q.onerror=q.onblocked=()=>r()}catch(e){r()}})}
async function vtCacheApply(){if(vtCacheOK()){if(!IDB&&READY){IDB=await _vtIdb();if(IDB){for(const k in LIVE)DIRTY.add(k);DIRTY.add("@snap");if(BN.list&&BN.list.length)DIRTY.add("@bn");dirtySnap()}}}
else{try{if(IDB)IDB.close()}catch(e){}IDB=null;await vtIdbDel("scr")}}
// ---- banner: Reject and Accept are the same size and style on the first layer; Manage has per-category toggles, off by default
function vtBannerClose(){const b=document.getElementById("vcb");if(b)b.remove()}
function vtBanner(manage){vtBannerClose();const c=vtConsent(),el=document.createElement("div");el.className="vcb";el.id="vcb";
el.setAttribute("role","dialog");el.setAttribute("aria-modal","false");el.setAttribute("aria-labelledby","vcb_t");
el.innerHTML=`<h2 id="vcb_t">Storage on this device</h2>
<p>Vektor Terminal keeps your settings, alerts and sign-in name in your browser because the app can\u2019t work without them. With your permission, it can also keep a <b>market-data cache</b> (IndexedDB) so charts load faster, and remember <b>optional preferences</b> such as the alert sound. There are no cookies, analytics, ads or trackers. You can change your mind at any time with \u201cCookie settings\u201d in the footer. <a href="#/legal/cookies">Cookie notice</a> \u00b7 <a href="#/legal/privacy">Privacy policy</a></p>
${manage?`<div class="cats">
<div class="cat"><input type="checkbox" checked disabled id="vcb_nec" aria-describedby="vcb_nec_d"><label for="vcb_nec"><b>Strictly necessary</b><span class="mut" id="vcb_nec_d">Settings, watchlist, alerts, layouts, sign-in name and this consent record. Needed for the app to work.</span></label><span class="st">Always on</span></div>
<div class="cat"><input type="checkbox" id="vcb_cache" ${c&&c.cache?"checked":""} aria-describedby="vcb_cache_d"><label for="vcb_cache"><b>Market-data cache</b><span class="mut" id="vcb_cache_d">Keeps downloaded price candles and the market list in IndexedDB so the app starts faster and makes fewer requests. Off unless you turn it on.</span></label></div>
<div class="cat"><input type="checkbox" id="vcb_prefs" ${c&&c.prefs?"checked":""} aria-describedby="vcb_prefs_d"><label for="vcb_prefs"><b>Optional preferences</b><span class="mut" id="vcb_prefs_d">Remembers extras you choose, such as the alert sound, in localStorage (<code>vt_prefs</code>), and your Journal AI key if you tick \u201cRemember\u201d (<code>vt_aikey~\u2026</code>) and your own Twelve Data key (<code>vt_tdkey~\u2026</code>). Without it they still work, but only until you close the tab. Off unless you turn it on.</span></label></div>
<div class="cat"><input type="checkbox" disabled id="vcb_an"><label for="vcb_an"><b>Analytics and advertising</b><span class="mut">Not used. There are no analytics, advertising cookies or third-party trackers.</span></label><span class="st">Not used</span></div></div>`:""}
<div class="btns"><button type="button" class="cbtn" id="vcb_rej">Reject all</button><button type="button" class="cbtn" id="vcb_acc">Accept all</button>${manage?`<button type="button" class="cbtn alt" id="vcb_save">Save my choices</button>`:`<button type="button" class="cbtn alt" id="vcb_man">Manage choices</button>`}</div>`;
document.body.appendChild(el);
el.querySelector("#vcb_rej").onclick=()=>vtConsentSet(false,"reject_all");el.querySelector("#vcb_acc").onclick=()=>vtConsentSet(true,"accept_all");
if(manage){el.querySelector("#vcb_save").onclick=()=>vtConsentSet(el.querySelector("#vcb_cache").checked,"custom",el.querySelector("#vcb_prefs").checked);el.querySelector("#vcb_cache").focus()}
else el.querySelector("#vcb_man").onclick=()=>vtBanner(true);
if(manage||!c)setTimeout(()=>{if(!manage){const b=el.querySelector("#vcb_rej");b&&b.focus({preventScroll:true})}},0)}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.getElementById("vcb")&&vtConsent()){vtBannerClose()}});
// ---- legal pages over the sign-in screen (the app is hidden until you sign in, but the notices must stay readable)
function vtLegalModal(k){if(!LEGAL[k])return;vtLegalModalClose();const m=document.createElement("div");m.className="vlm";m.id="vlm";m.setAttribute("role","dialog");m.setAttribute("aria-modal","true");m.setAttribute("aria-label",LEGAL[k][0]);
m.innerHTML=`<div class="box lgldoc"><button type="button" class="x" aria-label="Close" onclick="vtLegalModalClose()">\u2715</button>${LEGAL[k][1]()}</div>`;
m.onclick=e=>{if(e.target===m)vtLegalModalClose()};document.body.appendChild(m);if(LEGAL[k][2])LEGAL[k][2](m.querySelector(".box"));m.querySelector(".x").focus()}
function vtLegalModalClose(){const m=document.getElementById("vlm");if(m)m.remove()}
document.addEventListener("click",e=>{const a=e.target.closest&&e.target.closest('a[href^="#/legal/"]');if(!a)return;
const k=a.getAttribute("href").slice(8);if(document.documentElement.classList.contains("locked")||a.closest(".vlm")){if(LEGAL[k]){e.preventDefault();vtLegalModal(k)}}},true);
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.getElementById("vlm")){e.stopPropagation();vtLegalModalClose()}},true);
// ---- privacy centre helpers
function vtParse(v){try{return JSON.parse(v)}catch(e){return v}}
async function vtIdbExists(){if(IDB)return true;try{if(indexedDB.databases)return(await indexedDB.databases()).some(d=>d.name==="scr")}catch(e){}return false}
async function vtIdbDump(){if(!(await vtIdbExists()))return{};const db=IDB||await _vtIdb();if(!db)return{};
return new Promise(r=>{const out={};try{const q=db.transaction("c").objectStore("c").openCursor();q.onsuccess=()=>{const c=q.result;if(!c){r(out);return}out[c.key]=c.value;c.continue()};q.onerror=()=>r(out)}catch(e){r(out)}})}
/* keys scoped to a different signed-in user (name~<16 hex>) */
function vtOtherAcct(k){const m=/~[0-9a-f]{16}$/.exec(k||"");return !!m&&(typeof VT_SCOPE==="undefined"||m[0]!==VT_SCOPE)}
async function vtInventory(){const ls=[],ss=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);ls.push([vtOtherAcct(k)?k.replace(/~[0-9a-f]{16}$/,"~(another account)"):k,(localStorage.getItem(k)||"").length])}}catch(e){}
try{for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i);ss.push([k,(sessionStorage.getItem(k)||"").length])}}catch(e){}
let idbN=null;if(await vtIdbExists()){const d=await vtIdbDump();idbN=Object.keys(d).length}let cs=0;try{if(window.caches)cs=(await caches.keys()).length}catch(e){}
return{ls,ss,idbN,cs}}
async function vtExportData(inclCache){const out={app:"Vektor Terminal",exported:new Date().toISOString(),policyVersion:VT_POLICY_V,
note:"Everything Vektor Terminal stores in this browser. It may include API keys you saved, so keep this file safe.",localStorage:{},sessionStorage:{}};
try{let other=0;for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(vtOtherAcct(k)){other++;continue}out.localStorage[k]=vtParse(localStorage.getItem(k))}if(other)out.otherAccounts=other+" entr"+(other===1?"y":"ies")+" saved by other accounts on this device were left out"}catch(e){}
try{for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i);out.sessionStorage[k]=vtParse(sessionStorage.getItem(k))}}catch(e){}
out.indexedDB=inclCache?{scr:await vtIdbDump()}:{note:(await vtIdbExists())?"Market-data cache present but not included (tick the box to include it).":"No IndexedDB data."};return out}
function vtDownload(obj,name){const b=new Blob([JSON.stringify(obj,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500)}
// erase everything this app keeps in the browser and disconnect live feeds; the caller reloads afterwards
async function vtWipe(){window.__vtWiped=true;save=function(){};lsSet=function(){};ssSet=function(){};clearTimeout(fl);DIRTY.clear();
for(const o of [BNWS,BNKL,FHWS]){try{if(o.ws){o.ws.onclose=o.ws.onerror=o.ws.onmessage=o.ws.onopen=null;o.ws.close()}o.ws=null;if(o.subs)o.subs.clear()}catch(e){}}
try{if(window.__tbw)window.__tbw.terminate()}catch(e){}
try{if(IDB)IDB.close()}catch(e){}IDB=null;
try{localStorage.clear()}catch(e){}try{sessionStorage.clear()}catch(e){}
let names=["scr"];try{if(indexedDB.databases)names=[...new Set(["scr",...(await indexedDB.databases()).map(d=>d.name).filter(Boolean)])]}catch(e){}
for(const n of names)await vtIdbDel(n);
try{if(window.caches){const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)))}}catch(e){}
return true}
function vtDeleteAsk(){const m=document.createElement("div");m.className="vlm";m.id="vlm";m.setAttribute("role","alertdialog");m.setAttribute("aria-modal","true");m.setAttribute("aria-labelledby","vdel_t");
m.innerHTML=`<div class="box" style="max-width:480px"><h3 id="vdel_t">Delete all your data from this browser?</h3>
<p>This removes your settings, watchlist, alerts, drawings, layouts, saved API keys, sign-in, consent record, the market-data cache and any cached files, and disconnects live prices. It can\u2019t be undone. Data held by third parties (data providers, your broker) isn\u2019t affected.</p>
<label>Type DELETE to confirm<input id="vdel_in" autocomplete="off" aria-describedby="vdel_t"></label>
<div class="row" style="margin-top:10px"><span class="sp"></span><button type="button" id="vdel_no">Cancel</button><button type="button" class="pcdanger" id="vdel_go" disabled>Delete everything</button></div></div>`;
document.body.appendChild(m);const inp=m.querySelector("#vdel_in"),go=m.querySelector("#vdel_go");inp.oninput=()=>{go.disabled=inp.value.trim()!=="DELETE"};
m.querySelector("#vdel_no").onclick=vtLegalModalClose;m.onclick=e=>{if(e.target===m)vtLegalModalClose()};
go.onclick=async()=>{go.disabled=true;go.textContent="Deleting\u2026";await vtWipe();location.replace(location.pathname+location.search)};inp.focus()}
// ---- "Your data" page (privacy centre)
const DSR_TYPES=[["access","Access: a copy of the data you hold about me"],["rectification","Rectification: correct inaccurate data"],["erasure","Erasure: delete my data"],["restriction","Restriction: limit how my data is used"],["objection","Objection: stop processing based on legitimate interests"],["portability","Portability: my data in a machine-readable format"]];
LEGAL["your-data"]=["Your data",()=>`<h1>Your data</h1>${LG_META()}
<p>Most of what Vektor Terminal knows about you lives in this browser, so you can see it, download it and delete it here, straight away. For anything held elsewhere, see the last section.</p>
<h2>What this browser holds</h2><div id="pc_inv" class="mut">Checking\u2026</div>
<h2>Download a copy (access and portability)</h2><p>Downloads everything stored in this browser as one JSON file.</p>
<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="pc_inc"> Include the market-data cache (it can be large, and it\u2019s public price data rather than personal data)</label>
<div class="pcact"><button type="button" class="pri" id="pc_exp">Download my data (JSON)</button></div>
<p class="mut">The file includes any API keys you saved. Keep it somewhere safe.</p>
<h2>Delete all my data</h2><p>Clears localStorage, sessionStorage, IndexedDB and Cache Storage for this site and disconnects live price feeds. You\u2019ll be asked to confirm first.</p>
<div class="pcact"><button type="button" class="pcdanger" id="pc_del">Delete all my data\u2026</button></div>
<h2>Storage consent</h2><p id="pc_cs"></p><div class="pcact"><button type="button" id="pc_cset">Change cookie settings</button><button type="button" id="pc_wd">Withdraw consent</button></div>
<div id="pc_log"></div>
<h2>Requests about data held elsewhere</h2>
<p>This app keeps your data in your browser, not on our servers. Its sign-in is a device-only prototype, so there is no server account. We may still hold some data about you elsewhere, such as hosting logs, emails you\u2019ve sent us, or a server-side account if one is added later. For that data you have the right to <b>access</b>, <b>rectification</b>, <b>erasure</b>, <b>restriction</b>, <b>objection</b> and <b>portability</b>.</p>
<p>Send your request to ${VT_MAIL()}. We\u2019ll reply without undue delay and <b>within one month</b> of receiving it. If a request is complex, or you send several, we can extend that by up to two further months, and we\u2019ll tell you within the first month if we need to. Requests are free in most cases. We may ask you to confirm your identity first. If you\u2019re unhappy with our answer, you can complain to the Information Commissioner\u2019s Office (ico.org.uk).</p>
<div class="pcform"><label>Type of request<select id="dsr_t">${DSR_TYPES.map(t=>`<option value="${t[0]}">${t[1]}</option>`).join("")}</select></label>
<label>Your name<input id="dsr_n" autocomplete="name"></label><label>Your email<input id="dsr_e" type="email" autocomplete="email"></label>
<label style="grid-column:1/-1">Details (optional)<textarea id="dsr_d" maxlength="2000"></textarea></label></div>
<label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="dsr_ok" style="margin-top:3px"> <span>I understand this opens my own email app to send the request to ${VT_MAIL()}, and that my name and email will be used only to handle it, as described in the <a href="#/legal/privacy">Privacy Policy</a>.</span></label>
<div class="pcact"><button type="button" class="pri" id="dsr_go" disabled>Email this request</button><button type="button" id="dsr_cp">Copy request text</button><span class="mut" id="dsr_st"></span></div>`,
async root=>{const $=s=>root.querySelector(s);
const inv=await vtInventory(),row=(k,n)=>`<tr><td><code>${esc(k)}</code></td><td>${n.toLocaleString()} characters</td></tr>`;
$("#pc_inv").innerHTML=`<table class="ftbl"><thead><tr><th>Item</th><th>Size</th></tr></thead><tbody>${inv.ls.map(x=>row("localStorage: "+x[0],x[1])).join("")}${inv.ss.map(x=>row("sessionStorage: "+x[0],x[1])).join("")}
<tr><td>IndexedDB market-data cache</td><td>${inv.idbN==null?"none":inv.idbN+" entries"}</td></tr><tr><td>Cache Storage</td><td>${inv.cs?inv.cs+" caches":"none"}</td></tr></tbody></table>`;
$("#pc_exp").onclick=async()=>{vtDownload(await vtExportData($("#pc_inc").checked),"vektor-terminal-data-"+new Date().toISOString().slice(0,10)+".json");toast("Downloaded your data")};
$("#pc_del").onclick=vtDeleteAsk;$("#pc_cset").onclick=()=>vtBanner(true);$("#pc_wd").onclick=()=>vtConsentSet(false,"withdrawn");
const c=vtConsent();$("#pc_cs").textContent=c?"Current choice: "+(c.cache?"market-data cache on":"strictly necessary storage only")+" (policy version "+c.v+", "+new Date(c.ts).toLocaleString()+").":"You haven\u2019t made a choice yet, so only strictly necessary storage is used.";
const L=vtConsentLog();$("#pc_log").innerHTML=L.length?`<table class="ftbl" aria-label="Consent history"><thead><tr><th>When</th><th>Choice</th><th>How</th><th>Policy version</th></tr></thead><tbody>${L.slice().reverse().map(x=>`<tr><td>${esc(new Date(x.ts).toLocaleString())}</td><td>${x.cache?"Cache on":"Necessary only"}</td><td>${esc(String(x.method||"").replace(/_/g," "))}</td><td>${esc(x.v)}</td></tr>`).join("")}</tbody></table>`:"";
const txt=()=>{const t=DSR_TYPES.find(x=>x[0]===$("#dsr_t").value);return"Data subject request: "+t[1]+"\nName: "+$("#dsr_n").value.trim()+"\nEmail: "+$("#dsr_e").value.trim()+"\nDetails: "+($("#dsr_d").value.trim()||"(none)")+"\nSent: "+new Date().toISOString()};
const upd=()=>{$("#dsr_go").disabled=!($("#dsr_ok").checked&&$("#dsr_e").value.trim())};["#dsr_ok","#dsr_e"].forEach(s=>$(s).addEventListener("input",upd));$("#dsr_ok").addEventListener("change",upd);
$("#dsr_go").onclick=()=>{if(!VT_DSR_EMAIL){$("#dsr_st").textContent="The contact address hasn\u2019t been set up yet. Copy the text and send it to the address above.";return}
  $("#dsr_st").textContent="Opening your email app to send this to "+VT_DSR_EMAIL+". If nothing opens, copy the text and email it yourself.";
  vtOpenMail("mailto:"+VT_DSR_EMAIL+"?subject="+encodeURIComponent("Data subject request ("+$("#dsr_t").value+")")+"\u0026body="+encodeURIComponent(txt()))};
$("#dsr_cp").onclick=async()=>{try{await navigator.clipboard.writeText(txt());$("#dsr_st").textContent="Copied."}catch(e){$("#dsr_st").textContent="Couldn\u2019t copy. Select and copy it manually."}}}];
// footer (built here so every page above is linked) and first-visit banner
vtFooterBuild();
if(!vtConsent())vtBanner(false);
