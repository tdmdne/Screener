// ---------- accounts on a shared device ----------
// Saved work is scoped per signed-in user (see vtSK/VT_SCOPE in the core). Note: sign-in is still a local prototype with no
// password check, so this separates people who use the same browser; it is not security against someone typing your username.
// One-time hygiene: delete leftover Twelve Data keys previously stored in the browser. Never read, keep, or send them.
(function(){try{for(const store of [localStorage,sessionStorage]){const ks=[];for(let i=0;i<store.length;i++){const k=store.key(i);if(k&&/^vt_tdkey(~|$)/.test(k))ks.push(k)}ks.forEach(k=>store.removeItem(k))}if(typeof S!=="undefined"&&S&&S.data&&("key"in S.data)){delete S.data.key;if(typeof save==="function")save()}}catch(e){}})();
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
(function(){const b=boot;boot=function(){const r=b.apply(this,arguments);try{if(S&&S.data&&("key"in S.data)){delete S.data.key;if(typeof save==="function")save()}}catch(e){}setTimeout(vtLegacyCheck,900);return r}})();
