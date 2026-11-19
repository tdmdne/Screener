// Desktop Window Manager for Vektor Terminal modals
// Enhances desktop modals (.ov .box, .vt-modal-card, .vt-auth-modal) with smooth
// dragging and 4-way + corner resizing while keeping mobile bottom sheets untouched.

const MODAL_SEL = ".ov .box, .vt-modal-card, .vt-auth-modal";
const INTERACTIVE_SEL = "button, input, select, textarea, a, label, .vt-rh";
const HEADER_SEL = "h3, .jrch, .vt-modal-head";
const DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const MIN_W = 300;
const MIN_H = 200;
const PAD = 8;
const KEEP_VISIBLE = 60;
const TOP_GRAB_PX = 40;

function isDesktop() {
  return document.documentElement.dataset.ui !== "phone" && window.innerWidth >= 640;
}

function clamp(v, lo, hi) {
  return hi < lo ? lo : Math.max(lo, Math.min(hi, v));
}

function suppressNextClick() {
  let active = true;
  const stop = (ev) => {
    if (!active) return;
    active = false;
    ev.stopPropagation();
    ev.preventDefault();
  };
  window.addEventListener("click", stop, true);
  setTimeout(() => {
    active = false;
    window.removeEventListener("click", stop, true);
  }, 50);
}

function pinBox(box) {
  if (box.dataset.vtPinned === "1") return;
  const r = box.getBoundingClientRect();
  box.style.position = "fixed";
  box.style.left = r.left + "px";
  box.style.top = r.top + "px";
  box.style.width = r.width + "px";
  box.style.height = r.height + "px";
  box.style.maxWidth = "none";
  box.style.maxHeight = "none";
  box.style.margin = "0";
  box.style.transform = "none";
  box.style.animation = "none";
  box.style.overflow = "auto";
  box.dataset.vtPinned = "1";
}

function startDrag(box, e) {
  e.preventDefault();
  pinBox(box);
  const startRect = box.getBoundingClientRect();
  const startX = e.clientX;
  const startY = e.clientY;
  let moved = false;

  document.body.classList.add("vt-wm-dragging");

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) moved = true;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minLeft = -(startRect.width - KEEP_VISIBLE);
    const maxLeft = vw - KEEP_VISIBLE;
    const maxTop = vh - KEEP_VISIBLE;
    const nextLeft = clamp(startRect.left + dx, minLeft, maxLeft);
    const nextTop = clamp(startRect.top + dy, 0, maxTop);
    box.style.left = nextLeft + "px";
    box.style.top = nextTop + "px";
  };

  const onEnd = () => {
    document.body.classList.remove("vt-wm-dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    window.removeEventListener("pointercancel", onEnd);
    window.removeEventListener("blur", onEnd);
    if (moved) suppressNextClick();
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd);
  window.addEventListener("pointercancel", onEnd);
  window.addEventListener("blur", onEnd);
}

function startResize(box, dir, e) {
  e.preventDefault();
  e.stopPropagation();
  pinBox(box);
  const startRect = box.getBoundingClientRect();
  const startX = e.clientX;
  const startY = e.clientY;
  let moved = false;

  document.body.classList.add("vt-wm-resizing");

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!moved && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) moved = true;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxW = Math.max(MIN_W, vw - PAD * 2);
    const maxH = Math.max(MIN_H, vh - PAD * 2);

    let left = startRect.left;
    let top = startRect.top;
    let width = startRect.width;
    let height = startRect.height;

    if (dir.includes("e")) {
      const limitW = Math.min(maxW, vw - PAD - startRect.left);
      width = clamp(startRect.width + dx, MIN_W, limitW);
    }
    if (dir.includes("w")) {
      const minLeft = Math.max(PAD, startRect.right - maxW);
      const maxLeft = startRect.right - MIN_W;
      left = clamp(startRect.left + dx, minLeft, maxLeft);
      width = startRect.right - left;
    }
    if (dir.includes("s")) {
      const limitH = Math.min(maxH, vh - PAD - startRect.top);
      height = clamp(startRect.height + dy, MIN_H, limitH);
    }
    if (dir.includes("n")) {
      const minTop = Math.max(PAD, startRect.bottom - maxH);
      const maxTop = startRect.bottom - MIN_H;
      top = clamp(startRect.top + dy, minTop, maxTop);
      height = startRect.bottom - top;
    }

    box.style.left = left + "px";
    box.style.top = top + "px";
    box.style.width = width + "px";
    box.style.height = height + "px";
  };

  const onEnd = () => {
    document.body.classList.remove("vt-wm-resizing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    window.removeEventListener("pointercancel", onEnd);
    window.removeEventListener("blur", onEnd);
    if (moved) suppressNextClick();
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEnd);
  window.addEventListener("pointercancel", onEnd);
  window.addEventListener("blur", onEnd);
}

function enhanceModal(box) {
  if (!box || box.nodeType !== 1 || !isDesktop()) return;
  if (box.dataset.vtWm === "1") return;
  box.dataset.vtWm = "1";

  for (const dir of DIRS) {
    const h = document.createElement("div");
    h.className = "vt-rh";
    h.dataset.dir = dir;
    h.setAttribute("aria-hidden", "true");
    h.addEventListener("pointerdown", (e) => {
      if (!isDesktop() || e.button !== 0) return;
      startResize(box, dir, e);
    });
    box.appendChild(h);
  }

  box.addEventListener("pointerdown", (e) => {
    if (!isDesktop() || e.button !== 0) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest(INTERACTIVE_SEL)) return;

    const r = box.getBoundingClientRect();
    const inHeader = Boolean(t.closest(HEADER_SEL) && box.contains(t.closest(HEADER_SEL)));
    const inTopZone = e.clientY - r.top <= TOP_GRAB_PX;
    if (!inHeader && !inTopZone) return;

    startDrag(box, e);
  });
}

function scanNode(node) {
  if (!node || node.nodeType !== 1) return;
  if (node.matches && node.matches(MODAL_SEL)) enhanceModal(node);
  if (node.querySelectorAll) {
    const list = node.querySelectorAll(MODAL_SEL);
    for (let i = 0; i < list.length; i++) enhanceModal(list[i]);
  }
}

function initWindowManager() {
  if (!document.body) return;
  scanNode(document.body);
  const mo = new MutationObserver((mutations) => {
    if (!isDesktop()) return;
    for (let i = 0; i < mutations.length; i++) {
      const added = mutations[i].addedNodes;
      for (let j = 0; j < added.length; j++) {
        if (added[j].nodeType === 1) scanNode(added[j]);
      }
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initWindowManager, { once: true });
} else {
  initWindowManager();
}
