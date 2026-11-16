// ---------- accounts on a shared device + your own Twelve Data key ----------
// Saved work is scoped per signed-in user (see vtSK/VT_SCOPE in the core). Note: sign-in is still a local prototype with no
// password check, so this separates people who use the same browser; it is not security against someone typing your username.
// Twelve Data: no key ships with the app any more. Your own key is kept in memory for this tab, and saved in this browser
// (vt_tdkey~<your account>) only if you allow Optional preferences and aren't a guest. Without a key, forex and metals load
// from Yahoo only and the Twelve Data backup is off. Binance and Finnhub feeds (and their WebSockets) don't use it.
const VT_TDK={mem:"",old:"7d5c4c6544bf67a4"}; /* hash of the key that used to be built in, so a saved copy of it is dropped */
function vtTdKeyName(){return typeof vtSK==="function"?vtSK("vt_tdkey"):null}
function vtTdCanStore(){return !!vtTdKeyName()&&typeof vtPrefsOK==="function"&&vtPrefsOK()&&!(typeof vtIsGuest==="function"&&vtIsGuest())}
/* optional owner config for local/self-hosted use: config.local.js (gitignored; see config.example.js) is only requested on
   localhost/127.0.0.1/file:, defines window.VT_CONFIG, and its key is used in memory only, after your own key; it is never stored. */
function vtCfgTdKey(){const c=window.VT_CONFIG;const k=c&&typeof c.twelveDataKey==="string"?c.twelveDataKey.trim():"";return /^[A-Za-z0-9_-]{8,128}$/.test(k)?k:""}
(function(){try{if(!(location.protocol==="file:"||/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)))return;const sc=document.createElement("script");sc.src="config.local.js";sc.async=true;sc.onerror=()=>sc.remove();document.head.appendChild(sc)}catch(e){}})();
function vtTdKey(){if(VT_TDK.mem)return VT_TDK.mem;if(vtTdCanStore()){try{const k=localStorage.getItem(vtTdKeyName());if(k)return k}catch(e){}}return vtCfgTdKey()}
function vtTdKeySet(k){k=String(k||"").trim().slice(0,128);if(k&&!/^[A-Za-z0-9_-]+$/.test(k)){toast("That key has characters a Twelve Data key doesn\u2019t use; it wasn\u2019t saved");return false}
  const changed=k!==vtTdKey();VT_TDK.mem=k;const n=vtTdKeyName();
  try{if(n){if(k&&vtTdCanStore())localStorage.setItem(n,k);else localStorage.removeItem(n)}}catch(e){}
  if(changed&&typeof retryErr==="function")retryErr(/Twelve Data|Yahoo busy/);return true}
function vtTdKeyNote(){const has=!!vtTdKey();const g=typeof vtIsGuest==="function"&&vtIsGuest();
  const where=g?"As a guest, the key is kept only until you close the tab.":vtTdCanStore()?"Saved in this browser for your account only, and sent only to Twelve Data.":"Kept only until you close the tab. To remember it, allow Optional preferences in Cookie settings.";
  const own=VT_TDK.mem||(vtTdCanStore()&&(()=>{try{return localStorage.getItem(vtTdKeyName())}catch(e){return""}})());
  return (has?"":"No key set: forex and metals load from Yahoo only and the Twelve Data backup is off. ")+(!own&&vtCfgTdKey()?"Using the key from this computer\u2019s config.local.js (local use only, never stored). ":"")+where}
// a key saved inside your settings by an older version: never keep the old built-in one; move your own key out of scr2
(function(){const D=S.data;if(!D||!("key"in D))return;const k=String(D.key||"").trim();delete D.key;if(k&&vtUidHash(k)!==VT_TDK.old)VT_TDK.mem=k;VT_TDK.migrated=true})();
document.addEventListener("vt-consent",e=>{if(e.detail&&e.detail.prefs&&VT_TDK.mem)vtTdKeySet(VT_TDK.mem)});
// ---- guest who signs in while the app is running, and already has saved work under that account ----
function vtAcctChoose(){modal(`<div role="dialog" aria-modal="true" aria-labelledby="ac_h"><h3 id="ac_h">You already have saved work</h3><p id="ac_p"></p><div class="row"><button type="button" id="ac_keep">Use this session instead</button><span class="sp"></span><button type="button" class="pri" id="ac_open">Open my saved work</button></div></div>`);
  document.getElementById("ac_p").textContent="This device already has charts, drawings, a journal and other work saved for "+VT_UID+". Open it (this guest session\u2019s changes are dropped), or keep what you have open now and save it over your saved work.";
  document.getElementById("ac_open").onclick=()=>{closeM();location.reload()};
  document.getElementById("ac_keep").onclick=()=>{save();saveP();closeM();toast("Signed in \u2014 this session is now saved as your work")};
  document.getElementById("ac_open").focus()}
// ---- data saved before accounts were separated, found by someone who signs in later ----
function vtLegacyCheck(){if(!VT_SCOPE||VT_GUEST||S.legacyNo||lsGet("vt_legacy")==null||lsGet("scr2")==null)return;if(document.getElementById("modal")&&document.querySelector("#modal .box"))return;
  modal(`<div role="dialog" aria-modal="true" aria-labelledby="lg_h"><h3 id="lg_h">Earlier saved work found</h3><p>This device has charts, drawings, a journal and other work saved before each account got its own storage. It may belong to someone else who used this device.</p><p class="mut">Importing replaces the work saved for your account.</p><div class="row"><button type="button" id="lg_no">Not mine</button><span class="sp"></span><button type="button" class="pri" id="lg_yes">Import into my account</button></div></div>`);
  document.getElementById("lg_no").onclick=()=>{S.legacyNo=true;save();closeM()};
  document.getElementById("lg_yes").onclick=()=>{for(const k of ["scr2","scr2p"]){const v=lsGet(k);if(v!=null)lsSet(vtSK(k),v);else lsRemove(vtSK(k));lsRemove(k)}lsRemove("vt_legacy");closeM();location.reload()};
  document.getElementById("lg_no").focus()}
(function(){const b=boot;boot=function(){const r=b.apply(this,arguments);if(VT_TDK.migrated){VT_TDK.migrated=false;save();if(VT_TDK.mem&&!vtTdCanStore())setTimeout(()=>toast("Your Twelve Data key is kept only until you close the tab. Allow Optional preferences to remember it."),1500)}setTimeout(vtLegacyCheck,900);return r}})();
