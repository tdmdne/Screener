// TASK-06: starter watchlist, "Clear starter list", and the chart header's "+ Watchlist" / "Locate in Screener".
// Loaded as a module after index.html's inline script, so S, save(), wlAll(), renderWL(), rows(), render(), go()… already exist.
//
// Seeding rules (see AGENTS.md TASK-06):
// - Only when VT_WL_FRESH is true: a guest, or a signed-in account with no saved work (scr2~<hash>) when the page loaded.
//   index.html computes it before boot()'s first save(); this module can't, because boot has already saved by the time it runs.
//   Existing accounts are never seeded or migrated, even if their watchlist is empty.
// - Only when the watchlist is empty and S.wlStarter is unset.
// - S.wlStarter ("seeded" → "done") is saved inside the account's existing scr2~<hash> state, the same way S.legacyNo is.
//   Guests never persist S, so for them it lives in memory only and nothing is written to localStorage.
// "Clear starter list" shows only while the watchlist is still exactly the starter list. Any change marks the starter as "done".
// The chart header's star button called a wlStar() that index.html never defined (ReferenceError); it is defined here.

const STARTER = ["BTCUSDT", "EURUSD", "SPY", "XAUUSD", "NVDA"];
const SEEDED = "seeded";
const DONE = "done";
const LOCATE_FLASH_MS = 1600;
const PAGE_WAIT_FRAMES = 90;

const CSS = `
.vt-wlbtn{white-space:nowrap}
.vt-wlbtn[aria-disabled="true"]{color:var(--mut);cursor:default}
.vt-wl-clear{margin-left:auto}
#t tbody tr.vt-wl-located td{box-shadow:inset 0 0 0 9999px color-mix(in srgb,var(--acc) 10%,transparent)}
#t tbody tr.vt-wl-located td:first-child{box-shadow:inset 3px 0 0 var(--acc),inset 0 0 0 9999px color-mix(in srgb,var(--acc) 10%,transparent)}
`;

let seedChecked = false;

const firstGroup = () => S.wlx.groups[0] || null;
const chartSym = () => (S.chart && S.chart.sym) || "";

function starterUntouched() {
  if (S.wlStarter !== SEEDED) return false;
  const [first, ...rest] = S.wlx.groups;
  return !!first && first.syms.length === STARTER.length && first.syms.every((s, i) => s === STARTER[i]) && rest.every(g => !g.syms.length);
}

function refreshWatchlist() {
  save();
  renderWL();
  wlStarSync();
}

function maybeSeed() {
  if (seedChecked || !BOOTED) return;
  seedChecked = true;
  if (typeof VT_WL_FRESH === "undefined" || !VT_WL_FRESH) return;
  if (S.wlStarter || wlAll().length) return;
  const group = firstGroup();
  if (!group) return;
  group.syms.push(...STARTER);
  S.wlStarter = SEEDED;
  refreshWatchlist();
}

// once the user changes the starter list in any way, it's theirs: stop offering "Clear starter list"
function settleStarterFlag() {
  if (S.wlStarter === SEEDED && !starterUntouched()) {
    S.wlStarter = DONE;
    save();
  }
}

function clearStarter() {
  if (!starterUntouched()) return;
  const group = firstGroup();
  group.syms = group.syms.filter(s => !STARTER.includes(s));
  S.wlStarter = DONE;
  refreshWatchlist();
  toast("Starter list cleared");
  const addBtn = document.querySelector("#wl .wlh .ib");
  if (addBtn) addBtn.focus();
}

function renderClearControl() {
  const head = document.querySelector("#wl .wlh");
  const existing = document.getElementById("vtWlClear");
  if (!starterUntouched()) {
    if (existing) existing.remove();
    return;
  }
  if (!head || existing) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "vtWlClear";
  btn.className = "ib vt-wl-clear";
  btn.textContent = "Clear starter list";
  btn.title = "Remove the starter symbols (" + STARTER.join(", ") + ")";
  btn.addEventListener("click", clearStarter);
  head.appendChild(btn);
}

function addCharted() {
  const sym = chartSym();
  const group = firstGroup();
  if (!sym || !group) return;
  if (wlAll().includes(sym)) {
    toast(sym + " is already in your watchlist");
    return;
  }
  group.syms.push(sym);
  refreshWatchlist();
  toast(sym + " added to your watchlist");
}

// header star: add to the first section, or remove from every section
function toggleCharted() {
  const sym = chartSym();
  const group = firstGroup();
  if (!sym || !group) return;
  if (wlAll().includes(sym)) S.wlx.groups.forEach(g => { g.syms = g.syms.filter(s => s !== sym) });
  else group.syms.push(sym);
  refreshWatchlist();
}

function waitForPage(page) {
  return new Promise(resolve => {
    let frames = 0;
    const tick = () => {
      if (document.documentElement.dataset.page === page || ++frames > PAGE_WAIT_FRAMES) resolve();
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

const visibleCols = () => S.cols.filter(c => !c.hide);
const indexIn = sym => rows(visibleCols()).findIndex(o => o.s[0] === sym);

function flashRow(sym) {
  const row = [...document.querySelectorAll("#t tbody tr[data-s]")].find(tr => tr.dataset.s === sym);
  if (!row) return false;
  row.scrollIntoView({ block: "center", inline: "nearest" });
  row.classList.add("vt-wl-located");
  setTimeout(() => row.classList.remove("vt-wl-located"), LOCATE_FLASH_MS);
  return true;
}

async function locateCharted() {
  const sym = chartSym();
  if (!sym) return;
  if (!SYMS.some(s => s[0] === sym)) {
    toast(sym + " isn't in the screener's market list");
    return;
  }
  let note = "";
  if (indexIn(sym) < 0 && (S.q || S.mkt !== "ALL")) {
    const cleared = [];
    if (S.q) {
      S.q = "";
      const box = document.getElementById("q");
      if (box) box.value = "";
      cleared.push("search");
    }
    if (S.mkt !== "ALL") {
      S.mkt = "ALL";
      cleared.push("market filter");
    }
    note = "Cleared the " + cleared.join(" and ") + " to show " + sym;
  }
  if (indexIn(sym) < 0) {
    if (note) { save(); render() }
    toast(sym + " is hidden by the current preset or column filters");
    return;
  }
  go("screener");
  await waitForPage("screener");
  render(); // applies any cleared filter (render resets the page when filters change)
  const i = indexIn(sym);
  if (vtVirtOn()) vtVirtShow(i);
  else {
    S.page = Math.floor(i / (S.rows || 20));
    render();
  }
  save();
  if (typeof sxDrawer === "function") sxDrawer(sym); // the screener's own selection: preview drawer + selected row (as a row click)
  flashRow(sym);
  toast(note || sym + " located in the screener");
}

function makeHeaderButton(id, label, title, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = id;
  btn.className = "vt-wlbtn";
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener("click", onClick);
  return btn;
}

function syncHeader() {
  const add = document.getElementById("vtWlAdd");
  if (!add) return;
  const sym = chartSym();
  const inList = !!sym && wlAll().includes(sym);
  add.textContent = inList ? "✓ In Watchlist" : "+ Watchlist";
  add.setAttribute("aria-disabled", String(inList));
  add.title = inList ? sym + " is in your watchlist" : "Add " + sym + " to your watchlist";
}

function injectHeader() {
  const star = document.querySelector("#cp .cpb .row.top #wst");
  if (star && !document.getElementById("vtWlAdd")) {
    const add = makeHeaderButton("vtWlAdd", "+ Watchlist", "", addCharted);
    const locate = makeHeaderButton("vtWlLocate", "Locate in Screener", "Show this symbol in the screener", locateCharted);
    star.after(add, locate);
  }
  syncHeader();
}

// index.html's a11y layer turns every [onclick] element into role=button, so a watchlist row (which holds its own
// "Remove" button) became a button inside a button (axe nested-interactive). Mark the row as a labelled group and make
// the symbol name the keyboard control; its click bubbles to the row's existing openChart handler.
function fixRowSemantics() {
  document.querySelectorAll("#wl .wr[data-s]").forEach(row => {
    if (row.getAttribute("role") === "group") return;
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", row.dataset.s);
    row.tabIndex = -1;
    const name = row.querySelector(".wn");
    if (!name) return;
    name.setAttribute("role", "button");
    name.tabIndex = 0;
    name.title = "Open chart";
  });
}

function onWatchlistRendered() {
  fixRowSemantics();
  maybeSeed();
  settleStarterFlag();
  renderClearControl();
  syncHeader();
}

function init() {
  if (typeof S === "undefined" || typeof wlAll !== "function" || typeof renderWL !== "function") return;
  const style = document.createElement("style");
  style.id = "vt-wl-starter-css";
  style.textContent = CSS;
  document.head.appendChild(style);
  if (typeof window.wlStar !== "function") window.wlStar = toggleCharted;
  const wl = document.getElementById("wl");
  const cp = document.getElementById("cp");
  if (wl) new MutationObserver(onWatchlistRendered).observe(wl, { childList: true });
  if (cp) new MutationObserver(injectHeader).observe(cp, { childList: true });
  onWatchlistRendered();
  injectHeader();
}

init();
