// src/auth_ui.js — Phase 3A: Real D1 Auth, Full Signup Profile, Google & Apple OAuth,
// Profile-Completion Modal, Admin User Table Modal, and One-Time Legacy Cloud Import.
// Presentation only: all authoritative validation, hashing, lockout, OAuth, and RBAC live on the server.
// Zero innerHTML — every node is built with createElement/createElementNS and textContent.

import { validateEmail } from "../shared/emailValidator.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;
const PHONE_E164_RE = /^\+[1-9]\d{6,14}$/;
const DOB_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SAFE_AVATAR_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_AVATAR_CHARS = 128 * 1024;

let activeUser = null;
let providers = { email: false, google: false, apple: false, email_verify: false, phone_verify: false };
let d1AuthLive = false;
let authUiMounted = false;
let currentMode = "signin"; // "signin" | "signup"

function ensureAuthExtraStyles() {
  if (typeof document === "undefined" || document.getElementById("vtVerifyStyles")) return;
  const style = document.createElement("style");
  style.id = "vtVerifyStyles";
  style.textContent = [
    ".vt-terms-row{display:flex;align-items:flex-start;gap:9px;margin:2px 0 4px;padding:9px 11px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:var(--r-sm,8px);font-size:12px;line-height:1.45;color:#e5e7eb;}",
    ".vt-terms-row label{display:inline;margin:0;color:#e5e7eb;font-weight:400;}",
    ".vt-terms-row input[type=\"checkbox\"]{margin:2px 0 0;width:16px;height:16px;min-height:16px;flex-shrink:0;accent-color:#f59e0b;cursor:pointer;}",
    ".vt-terms-row input[aria-invalid=\"true\"]{outline:2px solid var(--r,#ef4444);outline-offset:1px;}",
    ".vt-terms-row a{color:#f59e0b;font-weight:600;text-decoration:underline;text-underline-offset:2px;}",
    ".vt-terms-row a:hover{color:#fbbf24;}",
    "#auth .auth-card .vt-auth-seg,.auth-card.vt-d1-auth .vt-auth-seg{background:#10131b;border:1px solid rgba(255,255,255,0.12);}",
    "#auth .auth-card .vt-auth-tab,.auth-card.vt-d1-auth .vt-auth-tab{background:#161922;color:#c7cdd8;border:1px solid transparent;}",
    "#auth .auth-card .vt-auth-tab:hover:not(.on),.auth-card.vt-d1-auth .vt-auth-tab:hover:not(.on){background:#1c202c;color:#f3f4f6;border-color:rgba(255,255,255,0.14);}",
    "#auth .auth-card .vt-auth-tab.on,.auth-card.vt-d1-auth .vt-auth-tab.on{background:#222736;color:#ffffff;border-color:rgba(245,158,11,0.55);box-shadow:0 1px 4px rgba(0,0,0,0.35);}",
    "#auth .auth-card .vt-pw-rules,.auth-card.vt-d1-auth .vt-pw-rules{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);color:#e5e7eb;}",
    "#auth .auth-card .vt-pw-rules li,.auth-card.vt-d1-auth .vt-pw-rules li{color:#e5e7eb;}",
    "#auth .auth-card .vt-pw-rules li::before,.auth-card.vt-d1-auth .vt-pw-rules li::before{background:rgba(255,255,255,0.34);}",
    "#auth .auth-card .vt-pw-rules li.ok,.auth-card.vt-d1-auth .vt-pw-rules li.ok{color:#4ade80;}",
    "#auth .auth-card .vt-pw-rules li.ok::before,.auth-card.vt-d1-auth .vt-pw-rules li.ok::before{background:#4ade80;}",
    "#auth .auth-card .vt-field>span:first-child,.auth-card.vt-d1-auth .vt-field>span:first-child,#auth .auth-card label{color:#e5e7eb;}",
    "#auth .auth-card input:not([type=\"checkbox\"]),.auth-card.vt-d1-auth input:not([type=\"checkbox\"]){background:#12151e;color:#f3f4f6;border:1px solid rgba(255,255,255,0.16);color-scheme:dark;}",
    "#auth .auth-card input:not([type=\"checkbox\"])::placeholder,.auth-card.vt-d1-auth input:not([type=\"checkbox\"])::placeholder{color:#8b93a6;}",
    "#auth .auth-card input[type=\"date\"],.auth-card.vt-d1-auth input[type=\"date\"],.vt-auth-modal input[type=\"date\"]{color-scheme:dark;}",
    "#auth .auth-card #auBtn,#auth .auth-card #vtSuBtn,.auth-card.vt-d1-auth button.pri{background:#f59e0b;color:#0b0d12;border:1px solid #f59e0b;font-weight:700;opacity:1;}",
    "#auth .auth-card #auBtn:hover:not(:disabled),#auth .auth-card #vtSuBtn:hover:not(:disabled),.auth-card.vt-d1-auth button.pri:hover:not(:disabled){background:#fbbf24;border-color:#fbbf24;color:#0b0d12;}",
    "#auth .auth-card #auBtn:disabled,#auth .auth-card #vtSuBtn:disabled,.auth-card.vt-d1-auth button.pri:disabled{background:#d97706;color:#0b0d12;opacity:0.75;}",
    ".vt-prelaunch-notice{padding:10px 12px;margin:0 0 10px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.38);border-radius:var(--r-sm,8px);color:#fde68a;font-size:12.5px;line-height:1.45;}",
    ".vt-prelaunch-notice[hidden]{display:none !important;}",
    ".vt-prelaunch-home{color:#fbbf24;font-weight:600;text-decoration:underline;text-underline-offset:2px;white-space:nowrap;}",
    ".vt-prelaunch-home:hover{color:#ffffff;}",
    "html[data-vt-live-gate=\"1\"] #auGuest,html[data-vt-live-gate=\"1\"] #auGuestNote,html[data-vt-live-gate=\"1\"] #auForm .auor,html[data-vt-live-gate=\"1\"] #auClose{display:none !important;}",
    ".vt-verify-grid{display:flex;flex-direction:column;gap:12px;margin:12px 0;}",
    ".vt-verify-card{padding:14px;background:var(--bg-0);border:1px solid var(--line-2);border-radius:var(--r-md);display:flex;flex-direction:column;gap:10px;}",
    ".vt-verify-card.is-ok{border-color:color-mix(in srgb,var(--g) 40%,var(--line-2));}",
    ".vt-verify-head{display:flex;align-items:center;justify-content:space-between;gap:10px;}",
    ".vt-verify-title{font-size:13.5px;font-weight:600;color:var(--fg);margin:0;letter-spacing:-0.01em;}",
    ".vt-verify-target{font-size:12px;color:var(--mut);font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);word-break:break-all;}",
    ".vt-otp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
    ".vt-otp-input{width:136px;min-height:40px;padding:7px 10px;background:var(--bg-1);color:var(--fg);border:1px solid var(--line-2);border-radius:var(--r-sm);font-family:var(--mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:16px;font-weight:600;letter-spacing:0.24em;text-align:center;font-variant-numeric:tabular-nums;box-sizing:border-box;}",
    ".vt-otp-input:focus{border-color:var(--acc);outline:none;}",
    ".vt-otp-input[aria-invalid=\"true\"]{border-color:var(--r);}",
    ".vt-otp-send{min-height:40px;padding:0 12px;font-size:12.5px;font-variant-numeric:tabular-nums;white-space:nowrap;}",
    ".vt-otp-verify{min-height:40px;padding:0 14px;font-size:12.5px;white-space:nowrap;}",
    ".vt-verify-msg{font-size:12px;line-height:1.4;min-height:0;}",
    ".vt-verify-msg.err{color:var(--r);}",
    ".vt-verify-msg.ok{color:var(--g);}",
    ".vt-verify-msg.note{color:var(--mut);}",
    ".vt-profile-btn{position:relative;width:32px;height:32px;min-width:32px;min-height:32px;padding:0;border-radius:50%;border:1px solid var(--line-2);background:var(--bg-2,var(--bg-1));color:var(--fg);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:border-color 140ms ease,box-shadow 140ms ease,transform 140ms ease;}",
    ".vt-profile-btn:hover{border-color:var(--acc);box-shadow:0 0 0 2px color-mix(in srgb,var(--acc) 22%,transparent);}",
    ".vt-profile-btn:focus-visible{outline:2px solid var(--acc);outline-offset:2px;}",
    ".vt-avatar-img{width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;}",
    ".vt-avatar-init{font-size:11.5px;font-weight:700;letter-spacing:0.03em;line-height:1;color:var(--fg);user-select:none;text-transform:uppercase;}",
    ".vt-avatar-dot{position:absolute;right:-1px;bottom:-1px;width:9px;height:9px;border-radius:50%;border:1.5px solid var(--bg-1,#0f1218);box-sizing:border-box;pointer-events:none;}",
    ".vt-avatar-dot.is-verified{background:var(--g,#22c55e);}",
    ".vt-avatar-dot.is-pending{background:var(--y,#f59e0b);}",
    ".vt-prof-hero{display:flex;align-items:center;gap:14px;padding:12px;margin:10px 0 14px;background:var(--bg-0);border:1px solid var(--line-1);border-radius:var(--r-md);}",
    ".vt-prof-preview{width:64px;height:64px;min-width:64px;border-radius:50%;border:1px solid var(--line-2);background:var(--bg-2,var(--bg-1));display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;}",
    ".vt-prof-preview .vt-avatar-init{font-size:21px;}",
    ".vt-prof-meta{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;}",
    ".vt-prof-name{font-size:14.5px;font-weight:600;color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".vt-prof-sub{font-size:12px;color:var(--mut);display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
    ".vt-prof-photo-acts{display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;}",
    ".vt-prof-photo-btn{min-height:30px;padding:0 10px;font-size:12px;}",
    ".vt-prof-field-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}",
    ".vt-prof-vbtn{border:none;background:none;padding:0;color:var(--acc);font-size:11.5px;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:2px;}",
    ".vt-prof-vbtn:hover{color:var(--acc-hover);}",
    ".vt-prof-note{font-size:11.5px;color:var(--mut);margin:2px 0 4px;line-height:1.4;}",
    ".vt-prof-acts{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line-1);flex-wrap:wrap;}",
    ".vt-prof-acts-right{display:flex;align-items:center;gap:8px;}",
    ".vt-btn-danger{color:var(--r);border-color:color-mix(in srgb,var(--r) 35%,var(--line-2));}",
    ".vt-btn-danger:hover{background:color-mix(in srgb,var(--r) 12%,transparent);}",
    ".vt-prof-select{width:100%;min-height:38px;padding:7px 10px;background:var(--bg-0);color:var(--fg);border:1px solid var(--line-2);border-radius:var(--r-sm);font-size:13px;font-family:inherit;box-sizing:border-box;cursor:pointer;}",
    ".vt-prof-select:focus{border-color:var(--acc);outline:none;}",
    "@media (max-width:520px){.vt-field-row{grid-template-columns:1fr;}}",
  ].join("\n");
  document.head.append(style);
}

// ---------------------------------------------------------------------------
// Safe DOM Helpers (zero innerHTML)
// ---------------------------------------------------------------------------

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "className") node.className = String(v);
      else if (k === "textContent") node.textContent = String(v);
      else if (k === "dataset" && typeof v === "object") {
        for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = String(dv);
      } else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v === true) {
        node.setAttribute(k, "");
      } else {
        node.setAttribute(k, String(v));
      }
    }
  }
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function svgEl(tag, attrs, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined && v !== null) node.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (child) node.append(child);
  }
  return node;
}

function buildGoogleIcon() {
  return svgEl(
    "svg",
    { width: "17", height: "17", viewBox: "0 0 24 24", "aria-hidden": "true", class: "vt-oauth-ico" },
    svgEl("path", {
      fill: "#4285F4",
      d: "M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.54-5.17 3.54-8.87z",
    }),
    svgEl("path", {
      fill: "#34A853",
      d: "M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.09A12 12 0 0 0 12 24z",
    }),
    svgEl("path", {
      fill: "#FBBC05",
      d: "M5.28 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.99-3.09z",
    }),
    svgEl("path", {
      fill: "#EA4335",
      d: "M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.62l3.99 3.09c.95-2.85 3.6-4.96 6.72-4.96z",
    })
  );
}

function buildAppleIcon() {
  return svgEl(
    "svg",
    { width: "17", height: "17", viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": "true", class: "vt-oauth-ico" },
    svgEl("path", {
      d: "M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z",
    })
  );
}

function buildShieldIcon() {
  return svgEl(
    "svg",
    {
      width: "13",
      height: "13",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    },
    svgEl("path", { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" })
  );
}

function safeToast(message) {
  if (typeof window.toast === "function") {
    try {
      window.toast(message);
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Client Convenience Validators (mirroring shared/auth.js for instant UX)
// ---------------------------------------------------------------------------

function normalizePhoneInput(raw) {
  return String(raw || "").trim().replace(/[\s().-]+/g, "");
}

function maxAdultDobIso() {
  const now = new Date();
  const y = now.getUTCFullYear() - 18;
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function checkDobClient(raw) {
  const v = String(raw || "").trim();
  if (!v) return "Date of birth is required.";
  const match = DOB_RE.exec(v);
  if (!match) return "Enter a valid date of birth (YYYY-MM-DD).";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return "Date of birth is not a valid calendar date.";
  }
  const now = new Date();
  let age = now.getUTCFullYear() - year;
  const md = now.getUTCMonth() + 1 - month;
  if (md < 0 || (md === 0 && now.getUTCDate() < day)) age -= 1;
  if (age < 18) return "You must be at least 18 years old.";
  if (age > 120) return "Date of birth is out of valid range.";
  return "";
}

function checkPasswordRules(pw) {
  const s = String(pw || "");
  return {
    len: s.length >= 10 && s.length <= 128,
    upper: /[A-Z]/.test(s),
    lower: /[a-z]/.test(s),
    digit: /[0-9]/.test(s),
  };
}

function formatRetryError(errorMsg, retryAfterHeader) {
  const base = errorMsg || "Too many failed login attempts. Please try again later.";
  const sec = Number(retryAfterHeader);
  if (Number.isFinite(sec) && sec > 0) {
    const mins = Math.max(1, Math.ceil(sec / 60));
    return `${base} Retry in ~${mins} min.`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Same-Origin API Client
// ---------------------------------------------------------------------------

async function apiJson(path, options = {}) {
  const init = {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: Object.assign({ Accept: "application/json" }, options.headers || {}),
  };
  if (options.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const resp = await fetch(path, init);
  let data = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }
  return {
    ok: resp.ok && Boolean(data && data.ok),
    status: resp.status,
    data,
    retryAfter: resp.headers.get("Retry-After"),
  };
}

// ---------------------------------------------------------------------------
// Modal Focus Trap Helper
// ---------------------------------------------------------------------------

function createAccessibleModal({ id, labelledBy, dismissible = true, wide = false, onClose }) {
  const existing = document.getElementById(id);
  if (existing) existing.remove();

  const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const dialog = el("div", {
    className: wide ? "vt-auth-modal vt-auth-modal-wide" : "vt-auth-modal",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": labelledBy,
    tabindex: "-1",
  });

  const overlay = el(
    "div",
    {
      id,
      className: "vt-auth-modal-ov",
      onClick: (ev) => {
        if (dismissible && ev.target === overlay) close();
      },
    },
    dialog
  );

  function close() {
    document.removeEventListener("keydown", onKeyDown, true);
    overlay.remove();
    if (typeof onClose === "function") onClose();
    if (prevFocus && document.contains(prevFocus)) {
      try {
        prevFocus.focus();
      } catch {
        // ignore
      }
    }
  }

  function onKeyDown(ev) {
    if (!document.contains(overlay)) {
      document.removeEventListener("keydown", onKeyDown, true);
      return;
    }
    if (ev.key === "Escape" && dismissible) {
      ev.preventDefault();
      ev.stopPropagation();
      close();
      return;
    }
    if (ev.key === "Tab") {
      const focusables = [
        ...dialog.querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ),
      ].filter((n) => n.offsetParent !== null);
      if (!focusables.length) {
        ev.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (ev.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    }
  }

  document.addEventListener("keydown", onKeyDown, true);
  document.body.append(overlay);

  return { overlay, dialog, close };
}

// ---------------------------------------------------------------------------
// Complete Your Profile Modal (post-OAuth signup when profile_completed === false)
// ---------------------------------------------------------------------------

function openCompleteProfileModal(user) {
  if (document.getElementById("vtCompleteProfileOv")) return;

  const { dialog, close } = createAccessibleModal({
    id: "vtCompleteProfileOv",
    labelledBy: "vtCpTitle",
    dismissible: false,
  });

  const title = el("h2", { id: "vtCpTitle", className: "vt-modal-h", textContent: "Complete your profile" });
  const sub = el("p", {
    className: "vt-modal-sub",
    textContent: `Signed in as ${user.email || "your account"}. Confirm your profile details to enter Vektor Terminal.`,
  });

  const nameInput = el("input", {
    id: "vtCpName",
    name: "full_name",
    type: "text",
    autocomplete: "name",
    placeholder: "Full name",
    value: user.full_name || "",
    required: true,
    "aria-describedby": "vtCpErr",
  });
  const userInput = el("input", {
    id: "vtCpUser",
    name: "username",
    type: "text",
    autocomplete: "username",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "false",
    placeholder: "trader_handle",
    value: user.username || "",
    required: true,
    "aria-describedby": "vtCpErr",
  });
  const dobInput = el("input", {
    id: "vtCpDob",
    name: "dob",
    type: "date",
    autocomplete: "bday",
    max: maxAdultDobIso(),
    value: user.dob || "",
    required: true,
    "aria-describedby": "vtCpErr",
  });
  const phoneInput = el("input", {
    id: "vtCpPhone",
    name: "phone",
    type: "tel",
    autocomplete: "tel",
    placeholder: "+447700900000",
    value: user.phone || "",
    required: true,
    "aria-describedby": "vtCpErr",
  });

  const errEl = el("div", { id: "vtCpErr", className: "auth-err", role: "alert", "aria-live": "polite" });
  const submitBtn = el("button", { type: "submit", id: "vtCpBtn", className: "pri", textContent: "Save and continue" });
  const signOutBtn = el("button", {
    type: "button",
    className: "vt-btn-ghost",
    textContent: "Sign out",
    onClick: () => performRealLogout(),
  });

  const clearErr = () => {
    errEl.textContent = "";
    for (const inp of [nameInput, userInput, dobInput, phoneInput]) {
      inp.removeAttribute("aria-invalid");
    }
  };
  for (const inp of [nameInput, userInput, dobInput, phoneInput]) {
    inp.addEventListener("input", clearErr);
  }

  function showErr(msg, target) {
    errEl.textContent = msg;
    if (target) {
      target.setAttribute("aria-invalid", "true");
      target.focus();
    }
  }

  const form = el(
    "form",
    {
      className: "vt-cp-form",
      novalidate: true,
      onSubmit: async (ev) => {
        ev.preventDefault();
        clearErr();

        const full_name = nameInput.value.trim();
        const username = userInput.value.trim();
        const dob = dobInput.value.trim();
        const phone = normalizePhoneInput(phoneInput.value);

        if (full_name.length < 2 || full_name.length > 100) {
          return showErr("Full name must be between 2 and 100 characters.", nameInput);
        }
        if (!USERNAME_RE.test(username)) {
          return showErr("Username must be 3–24 characters using letters, numbers, and underscores only.", userInput);
        }
        const dobErr = checkDobClient(dob);
        if (dobErr) return showErr(dobErr, dobInput);
        if (!PHONE_E164_RE.test(phone)) {
          return showErr("Enter an international phone number starting with + (e.g. +447700900000).", phoneInput);
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Saving…";
        try {
          const res = await apiJson("/api/auth/complete-profile", {
            method: "POST",
            body: { full_name, username, dob, phone },
          });
          if (!res.ok) {
            showErr((res.data && res.data.error) || "Could not save profile. Please check your details.");
            return;
          }
          activeUser = res.data.user;
          close();
          cleanCompleteProfileQuery();
          safeToast("Profile completed");
          applySignedInSession(activeUser);
        } catch {
          showErr("Could not reach the server. Please try again.");
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = "Save and continue";
        }
      },
    },
    el("label", { className: "vt-field" }, el("span", { textContent: "Full name" }), nameInput),
    el(
      "label",
      { className: "vt-field" },
      el("span", { textContent: "Username" }),
      userInput,
      el("small", { className: "vt-hint", textContent: "3–24 letters, numbers, or underscores" })
    ),
    el(
      "div",
      { className: "vt-field-row" },
      el("label", { className: "vt-field" }, el("span", { textContent: "Date of birth (18+)" }), dobInput),
      el("label", { className: "vt-field" }, el("span", { textContent: "Phone (E.164)" }), phoneInput)
    ),
    errEl,
    el("div", { className: "vt-modal-acts" }, signOutBtn, submitBtn)
  );

  dialog.append(title, sub, form);
  setTimeout(() => {
    if (!nameInput.value.trim()) nameInput.focus();
    else userInput.focus();
  }, 20);
}

function cleanCompleteProfileQuery() {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("complete_profile")) {
      url.searchParams.delete("complete_profile");
      window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Step 2: Verify Email & Phone Modal (6-Digit OTP)
// ---------------------------------------------------------------------------

function openVerificationModal(user) {
  if (!user || !user.id) return;
  if (document.getElementById("vtVerifyModalOv") || document.getElementById("vtCompleteProfileOv")) return;

  ensureAuthExtraStyles();
  const dismissKey = `vt_verify_dismissed_${user.id}`;
  const timers = [];

  function clearTimers() {
    while (timers.length) {
      clearInterval(timers.pop());
    }
  }

  let current = Object.assign({}, user);

  const { dialog, close } = createAccessibleModal({
    id: "vtVerifyModalOv",
    labelledBy: "vtVerifyTitle",
    dismissible: true,
    onClose: () => {
      clearTimers();
      try {
        window.sessionStorage.setItem(dismissKey, "1");
      } catch {
        // ignore
      }
    },
  });

  const title = el("h2", { id: "vtVerifyTitle", className: "vt-modal-h", textContent: "Verify your contact details" });
  const closeBtn = el("button", {
    type: "button",
    className: "vt-modal-close",
    "aria-label": "Close verification dialog",
    textContent: "\u00d7",
    onClick: () => close(),
  });
  const head = el("div", { className: "vt-modal-head" }, title, closeBtn);
  const sub = el("p", {
    className: "vt-modal-sub",
    textContent: "Confirm your email address and phone number with a 6-digit code to secure your account.",
  });

  const footerBtn = el("button", {
    type: "button",
    id: "vtVerifyLaterBtn",
    className: "vt-btn-ghost",
    textContent: "Verify later",
    onClick: () => close(),
  });

  function syncFooterState() {
    if (current.email_verified && current.phone_verified) {
      footerBtn.className = "pri";
      footerBtn.textContent = "Continue to terminal";
      safeToast("Email and phone verified");
    }
  }

  function buildChannelCard({ channel, label, target, initiallyVerified }) {
    let verified = Boolean(initiallyVerified);
    let cooldownLeft = 0;
    let intervalId = null;

    const badge = el("span", {
      id: `vtVerifyBadge_${channel}`,
      className: verified ? "vt-pill vt-pill-ok" : "vt-pill",
      textContent: verified ? "Verified" : "Pending",
    });

    const cardHead = el(
      "div",
      { className: "vt-verify-head" },
      el(
        "div",
        null,
        el("h3", { className: "vt-verify-title", textContent: label }),
        el("div", { className: "vt-verify-target", textContent: target || "Not set" })
      ),
      badge
    );

    const msgEl = el("div", {
      id: `vtVerifyMsg_${channel}`,
      className: "vt-verify-msg",
      role: "alert",
      "aria-live": "polite",
    });

    const codeInput = el("input", {
      id: `vtVerifyCode_${channel}`,
      type: "text",
      inputmode: "numeric",
      autocomplete: "one-time-code",
      maxlength: "6",
      pattern: "[0-9]{6}",
      placeholder: "000000",
      className: "vt-otp-input",
      "aria-label": `${label} 6-digit code`,
      "aria-describedby": `vtVerifyMsg_${channel}`,
    });

    codeInput.addEventListener("input", () => {
      const cleaned = codeInput.value.replace(/\D+/g, "").slice(0, 6);
      if (codeInput.value !== cleaned) codeInput.value = cleaned;
      codeInput.removeAttribute("aria-invalid");
      if (msgEl.classList.contains("err")) {
        msgEl.textContent = "";
        msgEl.className = "vt-verify-msg";
      }
    });

    const sendBtn = el("button", {
      type: "button",
      id: `vtVerifySend_${channel}`,
      className: "vt-btn-ghost vt-otp-send",
      textContent: "Send code",
    });

    const verifyBtn = el("button", {
      type: "button",
      id: `vtVerifyConfirm_${channel}`,
      className: "pri vt-otp-verify",
      textContent: "Verify",
    });

    const controls = el("div", { className: "vt-otp-row" }, sendBtn, codeInput, verifyBtn);
    const card = el("div", { className: verified ? "vt-verify-card is-ok" : "vt-verify-card" }, cardHead);

    function setMsg(text, kind) {
      msgEl.textContent = text;
      msgEl.className = kind ? `vt-verify-msg ${kind}` : "vt-verify-msg";
    }

    function startCooldown(seconds) {
      cooldownLeft = Math.max(1, Math.floor(seconds));
      sendBtn.disabled = true;
      sendBtn.textContent = `Resend in ${cooldownLeft}s`;
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(() => {
        cooldownLeft -= 1;
        if (cooldownLeft <= 0) {
          clearInterval(intervalId);
          intervalId = null;
          sendBtn.disabled = false;
          sendBtn.textContent = "Resend";
        } else {
          sendBtn.textContent = `Resend in ${cooldownLeft}s`;
        }
      }, 1000);
      timers.push(intervalId);
    }

    function markVerified(updatedUser) {
      verified = true;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (updatedUser) {
        current = updatedUser;
        activeUser = updatedUser;
      } else if (channel === "email") {
        current.email_verified = true;
      } else {
        current.phone_verified = true;
      }
      badge.className = "vt-pill vt-pill-ok";
      badge.textContent = "Verified";
      card.classList.add("is-ok");
      controls.remove();
      setMsg("Confirmed.", "ok");
      syncFooterState();
      mountProfileAvatar(activeUser);
    }

    sendBtn.addEventListener("click", async () => {
      if (verified || cooldownLeft > 0) return;
      setMsg("", "");
      sendBtn.disabled = true;
      sendBtn.textContent = "Sending…";
      try {
        const res = await apiJson("/api/auth/verify/send", {
          method: "POST",
          body: { channel },
        });
        if (res.ok) {
          if (res.data && res.data.already_verified) {
            markVerified(null);
            return;
          }
          setMsg("Code sent. Enter the 6-digit code below.", "note");
          startCooldown((res.data && res.data.cooldown_sec) || 60);
          codeInput.focus();
          return;
        }
        if (res.status === 503 && res.data && res.data.code === "PROVIDER_UNCONFIGURED") {
          setMsg("Verification service pending setup", "note");
          sendBtn.disabled = false;
          sendBtn.textContent = "Send code";
          return;
        }
        if (res.status === 429) {
          const wait = Number(res.retryAfter);
          if (Number.isFinite(wait) && wait > 0 && wait <= 120) {
            startCooldown(wait);
          } else {
            sendBtn.disabled = false;
            sendBtn.textContent = "Resend";
          }
          setMsg((res.data && res.data.error) || "Please wait before requesting another code.", "err");
          return;
        }
        sendBtn.disabled = false;
        sendBtn.textContent = "Send code";
        setMsg((res.data && res.data.error) || "Could not send verification code.", "err");
      } catch {
        sendBtn.disabled = false;
        sendBtn.textContent = "Send code";
        setMsg("Could not reach the server. Try again.", "err");
      }
    });

    async function handleVerify() {
      if (verified) return;
      const code = codeInput.value.replace(/\D+/g, "");
      if (!/^\d{6}$/.test(code)) {
        codeInput.setAttribute("aria-invalid", "true");
        codeInput.focus();
        setMsg("Enter the 6-digit verification code.", "err");
        return;
      }
      setMsg("", "");
      verifyBtn.disabled = true;
      verifyBtn.textContent = "Checking…";
      try {
        const res = await apiJson("/api/auth/verify/confirm", {
          method: "POST",
          body: { channel, code },
        });
        if (!res.ok) {
          codeInput.setAttribute("aria-invalid", "true");
          codeInput.focus();
          setMsg((res.data && res.data.error) || "Invalid verification code.", "err");
          return;
        }
        markVerified(res.data && res.data.user ? res.data.user : null);
      } catch {
        setMsg("Could not reach the server. Try again.", "err");
      } finally {
        verifyBtn.disabled = false;
        verifyBtn.textContent = "Verify";
      }
    }

    verifyBtn.addEventListener("click", handleVerify);
    codeInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        handleVerify();
      }
    });

    if (!verified) {
      if (!target) {
        sendBtn.disabled = true;
        verifyBtn.disabled = true;
        codeInput.disabled = true;
        setMsg("Complete your profile to add a phone number first.", "note");
      }
      card.append(controls, msgEl);
    } else {
      card.append(msgEl);
    }

    return card;
  }

  const grid = el(
    "div",
    { className: "vt-verify-grid" },
    buildChannelCard({
      channel: "email",
      label: "Email verification",
      target: current.email,
      initiallyVerified: current.email_verified,
    }),
    buildChannelCard({
      channel: "phone",
      label: "Phone verification",
      target: current.phone,
      initiallyVerified: current.phone_verified,
    })
  );

  const acts = el("div", { className: "vt-modal-acts" }, footerBtn);
  dialog.append(head, sub, grid, acts);
  syncFooterState();
  setTimeout(() => closeBtn.focus(), 20);
}

// ---------------------------------------------------------------------------
// Interface Language & Lightweight i18n (window.VT_I18N)
// ---------------------------------------------------------------------------

const VT_LANG_STORAGE_KEY = "vt_ui_lang";

const VT_LANGUAGES = Object.freeze([
  Object.freeze({ code: "en-GB", label: "English — UK" }),
  Object.freeze({ code: "en-US", label: "English — US" }),
  Object.freeze({ code: "es", label: "Español" }),
  Object.freeze({ code: "fr", label: "Français" }),
  Object.freeze({ code: "de", label: "Deutsch" }),
  Object.freeze({ code: "pt", label: "Português" }),
  Object.freeze({ code: "it", label: "Italiano" }),
  Object.freeze({ code: "nl", label: "Nederlands" }),
  Object.freeze({ code: "ja", label: "日本語" }),
  Object.freeze({ code: "zh-CN", label: "中文 — 简体" }),
  Object.freeze({ code: "ko", label: "한국어" }),
  Object.freeze({ code: "ar", label: "العربية" }),
]);

const VT_LANGUAGE_SET = new Set(VT_LANGUAGES.map((l) => l.code));

const VT_I18N_DICT = Object.freeze({
  "en-GB": {
    account_settings: "Account Settings",
    upload_photo: "Upload photo",
    remove: "Remove",
    full_name: "Full name",
    username: "Username",
    email_address: "Email address",
    phone_e164: "Phone (E.164)",
    interface_language: "Interface Language",
    verified: "Verified",
    verify_email: "Verify email",
    verify_phone: "Verify phone",
    reverify_note: "Changing your email or phone number resets verification status for that channel.",
    sign_out: "Sign out",
    cancel: "Cancel",
    save_changes: "Save changes",
    saving: "Saving…",
    profile_saved: "Profile saved.",
    language_updated: "Interface language updated.",
    nav_screener: "Screener",
    nav_charts: "Charts",
    nav_heatmap: "Heatmap",
    nav_alerts: "Alerts",
    nav_journal: "Journal",
    nav_settings: "Settings",
  },
  "en-US": {
    account_settings: "Account Settings",
    upload_photo: "Upload photo",
    remove: "Remove",
    full_name: "Full name",
    username: "Username",
    email_address: "Email address",
    phone_e164: "Phone (E.164)",
    interface_language: "Interface Language",
    verified: "Verified",
    verify_email: "Verify email",
    verify_phone: "Verify phone",
    reverify_note: "Changing your email or phone number resets verification status for that channel.",
    sign_out: "Sign out",
    cancel: "Cancel",
    save_changes: "Save changes",
    saving: "Saving…",
    profile_saved: "Profile saved.",
    language_updated: "Interface language updated.",
    nav_screener: "Screener",
    nav_charts: "Charts",
    nav_heatmap: "Heatmap",
    nav_alerts: "Alerts",
    nav_journal: "Journal",
    nav_settings: "Settings",
  },
  es: {
    account_settings: "Configuración de cuenta",
    upload_photo: "Subir foto",
    remove: "Eliminar",
    full_name: "Nombre completo",
    username: "Usuario",
    email_address: "Correo electrónico",
    phone_e164: "Teléfono (E.164)",
    interface_language: "Idioma de la interfaz",
    verified: "Verificado",
    verify_email: "Verificar correo",
    verify_phone: "Verificar teléfono",
    reverify_note: "Cambiar tu correo o teléfono restablece la verificación de ese canal.",
    sign_out: "Cerrar sesión",
    cancel: "Cancelar",
    save_changes: "Guardar cambios",
    saving: "Guardando…",
    profile_saved: "Perfil guardado.",
    language_updated: "Idioma de la interfaz actualizado.",
    nav_screener: "Escáner",
    nav_charts: "Gráficos",
    nav_heatmap: "Mapa de calor",
    nav_alerts: "Alertas",
    nav_journal: "Diario",
    nav_settings: "Ajustes",
  },
  fr: {
    account_settings: "Paramètres du compte",
    upload_photo: "Importer une photo",
    remove: "Supprimer",
    full_name: "Nom complet",
    username: "Nom d'utilisateur",
    email_address: "Adresse e-mail",
    phone_e164: "Téléphone (E.164)",
    interface_language: "Langue de l'interface",
    verified: "Vérifié",
    verify_email: "Vérifier l'e-mail",
    verify_phone: "Vérifier le téléphone",
    reverify_note: "Modifier votre e-mail ou téléphone réinitialise la vérification de ce canal.",
    sign_out: "Se déconnecter",
    cancel: "Annuler",
    save_changes: "Enregistrer",
    saving: "Enregistrement…",
    profile_saved: "Profil enregistré.",
    language_updated: "Langue de l'interface mise à jour.",
    nav_screener: "Screener",
    nav_charts: "Graphiques",
    nav_heatmap: "Carte thermique",
    nav_alerts: "Alertes",
    nav_journal: "Journal",
    nav_settings: "Paramètres",
  },
  de: {
    account_settings: "Kontoeinstellungen",
    upload_photo: "Foto hochladen",
    remove: "Entfernen",
    full_name: "Vollständiger Name",
    username: "Benutzername",
    email_address: "E-Mail-Adresse",
    phone_e164: "Telefon (E.164)",
    interface_language: "Sprache der Oberfläche",
    verified: "Verifiziert",
    verify_email: "E-Mail verifizieren",
    verify_phone: "Telefon verifizieren",
    reverify_note: "Das Ändern von E-Mail oder Telefon setzt die Verifizierung für diesen Kanal zurück.",
    sign_out: "Abmelden",
    cancel: "Abbrechen",
    save_changes: "Änderungen speichern",
    saving: "Speichern…",
    profile_saved: "Profil gespeichert.",
    language_updated: "Sprache aktualisiert.",
    nav_screener: "Screener",
    nav_charts: "Charts",
    nav_heatmap: "Heatmap",
    nav_alerts: "Alarme",
    nav_journal: "Journal",
    nav_settings: "Einstellungen",
  },
  pt: {
    account_settings: "Configurações da conta",
    upload_photo: "Enviar foto",
    remove: "Remover",
    full_name: "Nome completo",
    username: "Usuário",
    email_address: "E-mail",
    phone_e164: "Telefone (E.164)",
    interface_language: "Idioma da interface",
    verified: "Verificado",
    verify_email: "Verificar e-mail",
    verify_phone: "Verificar telefone",
    reverify_note: "Alterar seu e-mail ou telefone redefine a verificação desse canal.",
    sign_out: "Sair",
    cancel: "Cancelar",
    save_changes: "Salvar alterações",
    saving: "Salvando…",
    profile_saved: "Perfil salvo.",
    language_updated: "Idioma atualizado.",
    nav_screener: "Screener",
    nav_charts: "Gráficos",
    nav_heatmap: "Mapa de calor",
    nav_alerts: "Alertas",
    nav_journal: "Diário",
    nav_settings: "Configurações",
  },
  it: {
    account_settings: "Impostazioni account",
    upload_photo: "Carica foto",
    remove: "Rimuovi",
    full_name: "Nome completo",
    username: "Nome utente",
    email_address: "Indirizzo e-mail",
    phone_e164: "Telefono (E.164)",
    interface_language: "Lingua dell'interfaccia",
    verified: "Verificato",
    verify_email: "Verifica e-mail",
    verify_phone: "Verifica telefono",
    reverify_note: "Modificare e-mail o telefono reimposta lo stato di verifica per quel canale.",
    sign_out: "Esci",
    cancel: "Annulla",
    save_changes: "Salva modifiche",
    saving: "Salvataggio…",
    profile_saved: "Profilo salvato.",
    language_updated: "Lingua aggiornata.",
    nav_screener: "Screener",
    nav_charts: "Grafici",
    nav_heatmap: "Mappa termica",
    nav_alerts: "Avvisi",
    nav_journal: "Diario",
    nav_settings: "Impostazioni",
  },
  nl: {
    account_settings: "Accountinstellingen",
    upload_photo: "Foto uploaden",
    remove: "Verwijderen",
    full_name: "Volledige naam",
    username: "Gebruikersnaam",
    email_address: "E-mailadres",
    phone_e164: "Telefoon (E.164)",
    interface_language: "Interfacetaal",
    verified: "Geverifieerd",
    verify_email: "E-mail verifiëren",
    verify_phone: "Telefoon verifiëren",
    reverify_note: "Het wijzigen van je e-mail of telefoon reset de verificatie voor dat kanaal.",
    sign_out: "Uitloggen",
    cancel: "Annuleren",
    save_changes: "Wijzigingen opslaan",
    saving: "Opslaan…",
    profile_saved: "Profiel opgeslagen.",
    language_updated: "Interfacetaal bijgewerkt.",
    nav_screener: "Screener",
    nav_charts: "Grafieken",
    nav_heatmap: "Heatmap",
    nav_alerts: "Meldingen",
    nav_journal: "Journaal",
    nav_settings: "Instellingen",
  },
  ja: {
    account_settings: "アカウント設定",
    upload_photo: "写真をアップロード",
    remove: "削除",
    full_name: "氏名",
    username: "ユーザー名",
    email_address: "メールアドレス",
    phone_e164: "電話番号 (E.164)",
    interface_language: "表示言語",
    verified: "認証済み",
    verify_email: "メールを認証",
    verify_phone: "電話を認証",
    reverify_note: "メールまたは電話番号を変更すると、そのチャネルの認証状態がリセットされます。",
    sign_out: "サインアウト",
    cancel: "キャンセル",
    save_changes: "変更を保存",
    saving: "保存中…",
    profile_saved: "プロフィールを保存しました。",
    language_updated: "表示言語を更新しました。",
    nav_screener: "スクリーナー",
    nav_charts: "チャート",
    nav_heatmap: "ヒートマップ",
    nav_alerts: "アラート",
    nav_journal: "トレード記録",
    nav_settings: "設定",
  },
  "zh-CN": {
    account_settings: "账户设置",
    upload_photo: "上传头像",
    remove: "移除",
    full_name: "姓名",
    username: "用户名",
    email_address: "电子邮箱",
    phone_e164: "手机号 (E.164)",
    interface_language: "界面语言",
    verified: "已验证",
    verify_email: "验证邮箱",
    verify_phone: "验证手机",
    reverify_note: "更改邮箱或手机号将重置该通道的验证状态。",
    sign_out: "退出登录",
    cancel: "取消",
    save_changes: "保存更改",
    saving: "保存中…",
    profile_saved: "个人资料已保存。",
    language_updated: "界面语言已更新。",
    nav_screener: "筛选器",
    nav_charts: "图表",
    nav_heatmap: "热力图",
    nav_alerts: "预警",
    nav_journal: "交易日志",
    nav_settings: "设置",
  },
  ko: {
    account_settings: "계정 설정",
    upload_photo: "사진 업로드",
    remove: "제거",
    full_name: "이름",
    username: "사용자 이름",
    email_address: "이메일 주소",
    phone_e164: "전화번호 (E.164)",
    interface_language: "인터페이스 언어",
    verified: "인증됨",
    verify_email: "이메일 인증",
    verify_phone: "전화번호 인증",
    reverify_note: "이메일이나 전화번호를 변경하면 해당 채널의 인증 상태가 초기화됩니다.",
    sign_out: "로그아웃",
    cancel: "취소",
    save_changes: "변경 사항 저장",
    saving: "저장 중…",
    profile_saved: "프로필이 저장되었습니다.",
    language_updated: "언어가 업데이트되었습니다.",
    nav_screener: "스크리너",
    nav_charts: "차트",
    nav_heatmap: "히트맵",
    nav_alerts: "알림",
    nav_journal: "매매일지",
    nav_settings: "설정",
  },
  ar: {
    account_settings: "إعدادات الحساب",
    upload_photo: "تحميل صورة",
    remove: "إزالة",
    full_name: "الاسم الكامل",
    username: "اسم المستخدم",
    email_address: "البريد الإلكتروني",
    phone_e164: "رقم الهاتف (E.164)",
    interface_language: "لغة الواجهة",
    verified: "موثّق",
    verify_email: "توثيق البريد",
    verify_phone: "توثيق الهاتف",
    reverify_note: "يؤدي تغيير البريد الإلكتروني أو رقم الهاتف إلى إعادة تعيين حالة التوثيق لتلك القناة.",
    sign_out: "تسجيل الخروج",
    cancel: "إلغاء",
    save_changes: "حفظ التغييرات",
    saving: "جارٍ الحفظ…",
    profile_saved: "تم حفظ الملف الشخصي.",
    language_updated: "تم تحديث لغة الواجهة.",
    nav_screener: "الماسح",
    nav_charts: "الرسوم البيانية",
    nav_heatmap: "الخريطة الحرارية",
    nav_alerts: "التنبيهات",
    nav_journal: "سجل التداول",
    nav_settings: "الإعدادات",
  },
});

let currentUiLang = "en-GB";

function resolveSupportedLang(raw) {
  if (typeof raw !== "string") return "en-GB";
  const trimmed = raw.trim();
  if (VT_LANGUAGE_SET.has(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  for (const item of VT_LANGUAGES) {
    if (item.code.toLowerCase() === lower) return item.code;
  }
  const base = lower.split("-")[0];
  if (base === "zh") return "zh-CN";
  if (base === "en") return lower.includes("us") ? "en-US" : "en-GB";
  if (VT_LANGUAGE_SET.has(base)) return base;
  return "en-GB";
}

function readStoredUiLang() {
  try {
    const stored = window.localStorage.getItem(VT_LANG_STORAGE_KEY);
    if (stored && VT_LANGUAGE_SET.has(stored)) return stored;
  } catch {
    // ignore storage errors
  }
  if (typeof document !== "undefined" && document.documentElement && document.documentElement.lang) {
    return resolveSupportedLang(document.documentElement.lang);
  }
  return "en-GB";
}

function tUi(key) {
  const table = VT_I18N_DICT[currentUiLang] || VT_I18N_DICT["en-GB"];
  if (table && Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  const fallback = VT_I18N_DICT["en-GB"];
  if (fallback && Object.prototype.hasOwnProperty.call(fallback, key)) return fallback[key];
  return String(key);
}

function syncLanguagePreference(lang) {
  if (!activeUser || !d1AuthLive || typeof fetch !== "function") return;
  apiJson("/api/me/data")
    .then((getRes) => {
      const existing =
        getRes.ok && getRes.data && getRes.data.data && typeof getRes.data.data.preferences === "object"
          ? getRes.data.data.preferences
          : {};
      return apiJson("/api/me/data/preferences", {
        method: "PUT",
        body: Object.assign({}, existing || {}, { lang }),
      });
    })
    .catch(() => {
      // Best-effort preference sync; never block UI.
    });
}

function setUiLang(lang, { sync = true } = {}) {
  const next = resolveSupportedLang(lang);
  currentUiLang = next;
  try {
    window.localStorage.setItem(VT_LANG_STORAGE_KEY, next);
  } catch {
    // ignore storage errors
  }
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = next;
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      window.dispatchEvent(new CustomEvent("vt:langchange", { detail: { lang: next } }));
    } catch {
      // ignore
    }
  }
  if (sync) {
    syncLanguagePreference(next);
  }
  return next;
}

if (typeof window !== "undefined") {
  currentUiLang = readStoredUiLang();
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = currentUiLang;
  }
  try {
    window.dispatchEvent(new CustomEvent("vt:langchange", { detail: { lang: currentUiLang } }));
  } catch {
    // ignore
  }
  window.VT_I18N = Object.freeze({
    getLang: () => currentUiLang,
    setLang: (lang) => setUiLang(lang, { sync: true }),
    t: tUi,
    languages: VT_LANGUAGES,
  });
}

// ---------------------------------------------------------------------------
// Profile Avatar Circle & Account Settings Modal (window.VT_PROFILE_UI)
// ---------------------------------------------------------------------------

function isSafeAvatarDataUri(raw) {
  return typeof raw === "string" && raw.length <= MAX_AVATAR_CHARS && SAFE_AVATAR_RE.test(raw);
}

function getUserInitials(user) {
  if (!user || typeof user !== "object") return "VT";
  const full = typeof user.full_name === "string" ? user.full_name.trim() : "";
  if (full) {
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    if (parts[0].length >= 2) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return parts[0][0].toUpperCase();
  }
  const uname = typeof user.username === "string" ? user.username.trim().replace(/^@+/, "") : "";
  if (uname.length >= 2) return uname.slice(0, 2).toUpperCase();
  const mail = typeof user.email === "string" ? user.email.trim() : "";
  if (mail.length >= 2) return mail.slice(0, 2).toUpperCase();
  return "VT";
}

function resizeAvatarFile(file, size = 160) {
  return new Promise((resolve, reject) => {
    if (!file || typeof file !== "object") {
      reject(new Error("Select an image file."));
      return;
    }
    const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
    if (!allowed.has(file.type)) {
      reject(new Error("Please choose a PNG, JPEG, or WebP image."));
      return;
    }
    if (typeof file.size === "number" && file.size > 10 * 1024 * 1024) {
      reject(new Error("Image file is too large (max 10 MB before resize)."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image file."));
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Canvas image processing is unavailable."));
            return;
          }
          const srcW = img.naturalWidth || img.width || size;
          const srcH = img.naturalHeight || img.height || size;
          const side = Math.min(srcW, srcH);
          const sx = Math.max(0, Math.floor((srcW - side) / 2));
          const sy = Math.max(0, Math.floor((srcH - side) / 2));
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

          let dataUrl = canvas.toDataURL("image/webp", 0.85);
          if (!dataUrl.startsWith("data:image/webp;base64,")) {
            dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          }
          if (dataUrl.length > MAX_AVATAR_CHARS) {
            dataUrl = canvas.toDataURL("image/jpeg", 0.7);
          }
          if (!isSafeAvatarDataUri(dataUrl)) {
            reject(new Error("Resized image exceeds maximum allowed size."));
            return;
          }
          resolve(dataUrl);
        } catch {
          reject(new Error("Could not process profile image."));
        }
      };
      img.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

function renderAvatarVisual(container, user, avatarOverride) {
  container.textContent = "";
  const url = avatarOverride !== undefined ? avatarOverride : user && user.avatar_url;
  if (isSafeAvatarDataUri(url)) {
    container.append(
      el("img", {
        className: "vt-avatar-img",
        src: url,
        alt: (user && (user.full_name || user.username || user.email)) || "Profile avatar",
        draggable: "false",
      })
    );
  } else {
    container.append(el("span", { className: "vt-avatar-init", textContent: getUserInitials(user) }));
  }
}

function unmountProfileAvatar() {
  if (typeof document === "undefined") return;
  const host = document.getElementById("vtProfileBtn");
  if (!host) return;
  if (host.dataset.vtProfileManaged === "dynamic") {
    host.remove();
  } else {
    host.hidden = true;
    host.textContent = "";
  }
}

function mountProfileAvatar(user, targetEl = null) {
  if (typeof document === "undefined") return null;
  if (!user || !user.id) {
    unmountProfileAvatar();
    return null;
  }

  ensureAuthExtraStyles();
  let host = targetEl || document.getElementById("vtProfileBtn");
  let btn = null;

  if (!host) {
    const lgo = document.getElementById("lgo");
    if (!lgo || !lgo.parentNode) return null;
    btn = el("button", {
      id: "vtProfileBtn",
      type: "button",
      className: "vt-profile-btn",
    });
    btn.dataset.vtProfileManaged = "dynamic";
    lgo.parentNode.insertBefore(btn, lgo);
    host = btn;
  } else if (host.tagName === "BUTTON") {
    btn = host;
    btn.classList.add("vt-profile-btn");
    if (!btn.hasAttribute("type")) btn.setAttribute("type", "button");
    btn.hidden = false;
  } else {
    host.hidden = false;
    btn = host.querySelector("button.vt-profile-btn");
    if (!btn) {
      host.textContent = "";
      btn = el("button", { type: "button", className: "vt-profile-btn" });
      host.append(btn);
    }
  }

  if (btn.dataset.vtProfileBound !== "1") {
    btn.dataset.vtProfileBound = "1";
    btn.addEventListener("click", () => {
      if (activeUser) openProfileSettingsModal(activeUser);
    });
  }

  const labelName = user.full_name || user.username || user.email || "Account";
  const fullyVerified = Boolean(user.email_verified && user.phone_verified);
  btn.setAttribute("aria-label", `Account settings (${labelName})`);
  btn.setAttribute("title", fullyVerified ? `${labelName} · Verified` : `${labelName} · Verification pending`);

  renderAvatarVisual(btn, user);
  btn.append(
    el("span", {
      className: fullyVerified ? "vt-avatar-dot is-verified" : "vt-avatar-dot is-pending",
      "aria-hidden": "true",
    })
  );

  return btn;
}

function openProfileSettingsModal(user) {
  const targetUser = user || activeUser;
  if (!targetUser || !targetUser.id) return;
  if (document.getElementById("vtProfileModalOv")) return;

  ensureAuthExtraStyles();
  let current = Object.assign({}, targetUser);
  let stagedAvatar = current.avatar_url ?? null;
  let avatarDirty = false;

  const { dialog, close } = createAccessibleModal({
    id: "vtProfileModalOv",
    labelledBy: "vtProfileTitle",
    dismissible: true,
  });

  const title = el("h2", { id: "vtProfileTitle", className: "vt-modal-h", textContent: tUi("account_settings") });
  const closeBtn = el("button", {
    type: "button",
    className: "vt-modal-close",
    "aria-label": "Close account settings",
    textContent: "\u00d7",
    onClick: () => close(),
  });
  const head = el("div", { className: "vt-modal-head" }, title, closeBtn);

  const previewCircle = el("div", { className: "vt-prof-preview" });
  const heroName = el("div", { className: "vt-prof-name" });
  const heroHandle = el("span");
  const heroPlan = el("span", { className: "vt-pill", textContent: (current.plan || "free").toUpperCase() });
  const heroRole =
    current.role === "admin" ? el("span", { className: "vt-pill vt-pill-acc", textContent: "Admin" }) : null;

  const fileInput = el("input", {
    id: "vtProfAvatarFile",
    type: "file",
    accept: "image/png,image/jpeg,image/webp",
    hidden: true,
    "aria-label": "Upload profile picture",
  });
  const uploadBtn = el("button", {
    type: "button",
    id: "vtProfUploadBtn",
    className: "vt-btn-ghost vt-prof-photo-btn",
    textContent: tUi("upload_photo"),
    onClick: () => fileInput.click(),
  });
  const removePhotoBtn = el("button", {
    type: "button",
    id: "vtProfRemoveBtn",
    className: "vt-btn-ghost vt-prof-photo-btn",
    textContent: tUi("remove"),
    onClick: () => {
      stagedAvatar = null;
      avatarDirty = true;
      syncHero();
      setStatus("Photo removed. Click Save changes to apply.", "note");
    },
  });

  const hero = el(
    "div",
    { className: "vt-prof-hero" },
    previewCircle,
    el(
      "div",
      { className: "vt-prof-meta" },
      heroName,
      el("div", { className: "vt-prof-sub" }, heroHandle, heroPlan, heroRole),
      el("div", { className: "vt-prof-photo-acts" }, uploadBtn, removePhotoBtn, fileInput)
    )
  );

  const nameLabelSpan = el("span", { textContent: tUi("full_name") });
  const userLabelSpan = el("span", { textContent: tUi("username") });
  const emailLabelSpan = el("span", { textContent: tUi("email_address") });
  const phoneLabelSpan = el("span", { textContent: tUi("phone_e164") });
  const langLabelSpan = el("span", { textContent: tUi("interface_language") });
  const reverifyNoteEl = el("p", { className: "vt-prof-note", textContent: tUi("reverify_note") });

  const nameInput = el("input", {
    id: "vtProfName",
    name: "full_name",
    type: "text",
    autocomplete: "name",
    value: current.full_name || "",
    required: true,
    "aria-describedby": "vtProfStatus",
  });
  const userInput = el("input", {
    id: "vtProfUser",
    name: "username",
    type: "text",
    autocomplete: "username",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "false",
    value: current.username || "",
    required: true,
    "aria-describedby": "vtProfStatus",
  });
  const emailInput = el("input", {
    id: "vtProfEmail",
    name: "email",
    type: "email",
    autocomplete: "email",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "false",
    value: current.email || "",
    required: true,
    "aria-describedby": "vtProfStatus",
  });
  const phoneInput = el("input", {
    id: "vtProfPhone",
    name: "phone",
    type: "tel",
    autocomplete: "tel",
    placeholder: "+14155552671",
    value: current.phone || "",
    required: true,
    "aria-describedby": "vtProfStatus",
  });

  const langSelect = el(
    "select",
    {
      id: "vtProfLang",
      name: "lang",
      className: "vt-prof-select",
      "aria-label": tUi("interface_language"),
    },
    ...VT_LANGUAGES.map((item) =>
      el("option", {
        value: item.code,
        textContent: item.label,
        selected: item.code === currentUiLang,
      })
    )
  );
  langSelect.value = currentUiLang;

  const emailBadgeSlot = el("span");
  const phoneBadgeSlot = el("span");
  const statusEl = el("div", {
    id: "vtProfStatus",
    className: "vt-verify-msg",
    role: "alert",
    "aria-live": "polite",
  });

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = kind ? `vt-verify-msg ${kind}` : "vt-verify-msg";
  }

  function renderVerifyBadge(slot, isVerified, channel) {
    slot.textContent = "";
    if (isVerified) {
      slot.append(el("span", { className: "vt-pill vt-pill-ok", textContent: tUi("verified") }));
    } else {
      slot.append(
        el("button", {
          type: "button",
          className: "vt-prof-vbtn",
          textContent: channel === "email" ? tUi("verify_email") : tUi("verify_phone"),
          onClick: () => {
            close();
            if (activeUser) openVerificationModal(activeUser);
          },
        })
      );
    }
  }

  function applyModalTranslations() {
    title.textContent = tUi("account_settings");
    uploadBtn.textContent = tUi("upload_photo");
    removePhotoBtn.textContent = tUi("remove");
    nameLabelSpan.textContent = tUi("full_name");
    userLabelSpan.textContent = tUi("username");
    emailLabelSpan.textContent = tUi("email_address");
    phoneLabelSpan.textContent = tUi("phone_e164");
    langLabelSpan.textContent = tUi("interface_language");
    langSelect.setAttribute("aria-label", tUi("interface_language"));
    reverifyNoteEl.textContent = tUi("reverify_note");
    signOutBtn.textContent = tUi("sign_out");
    cancelBtn.textContent = tUi("cancel");
    if (!saveBtn.disabled) saveBtn.textContent = tUi("save_changes");
    renderVerifyBadge(emailBadgeSlot, Boolean(current.email_verified), "email");
    renderVerifyBadge(phoneBadgeSlot, Boolean(current.phone_verified), "phone");
  }

  function syncHero() {
    renderAvatarVisual(previewCircle, current, stagedAvatar);
    heroName.textContent = current.full_name || current.username || current.email || "Account";
    heroHandle.textContent = current.username ? `@${current.username}` : current.email || "";
    removePhotoBtn.disabled = !stagedAvatar;
    renderVerifyBadge(emailBadgeSlot, Boolean(current.email_verified), "email");
    renderVerifyBadge(phoneBadgeSlot, Boolean(current.phone_verified), "phone");
  }

  langSelect.addEventListener("change", () => {
    setUiLang(langSelect.value, { sync: true });
    applyModalTranslations();
    setStatus(tUi("language_updated"), "ok");
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    setStatus("Processing image…", "note");
    uploadBtn.disabled = true;
    try {
      stagedAvatar = await resizeAvatarFile(file, 160);
      avatarDirty = true;
      syncHero();
      setStatus("Photo ready. Click Save changes to apply.", "note");
    } catch (err) {
      setStatus((err && err.message) || "Could not process image.", "err");
    } finally {
      uploadBtn.disabled = false;
    }
  });

  const formInputs = [nameInput, userInput, emailInput, phoneInput];
  for (const inp of formInputs) {
    inp.addEventListener("input", () => {
      inp.removeAttribute("aria-invalid");
      if (statusEl.classList.contains("err")) setStatus("", "");
    });
  }

  const signOutBtn = el("button", {
    type: "button",
    id: "vtProfSignOutBtn",
    className: "vt-btn-ghost vt-btn-danger",
    textContent: tUi("sign_out"),
    onClick: () => {
      close();
      performRealLogout();
    },
  });
  const cancelBtn = el("button", {
    type: "button",
    className: "vt-btn-ghost",
    textContent: tUi("cancel"),
    onClick: () => close(),
  });
  const saveBtn = el("button", {
    type: "submit",
    id: "vtProfSaveBtn",
    className: "pri",
    textContent: tUi("save_changes"),
  });

  function showFieldErr(msg, target) {
    setStatus(msg, "err");
    if (target) {
      target.setAttribute("aria-invalid", "true");
      target.focus();
    }
  }

  const form = el(
    "form",
    {
      className: "vt-cp-form",
      novalidate: true,
      onSubmit: async (ev) => {
        ev.preventDefault();
        setStatus("", "");
        for (const inp of formInputs) inp.removeAttribute("aria-invalid");

        const full_name = nameInput.value.trim();
        const username = userInput.value.trim();
        const emailRaw = emailInput.value.trim();
        const phone = normalizePhoneInput(phoneInput.value);

        if (full_name.length < 2 || full_name.length > 100) {
          return showFieldErr("Full name must be between 2 and 100 characters.", nameInput);
        }
        if (!USERNAME_RE.test(username)) {
          return showFieldErr("Username must be 3–24 characters using letters, numbers, and underscores only.", userInput);
        }
        const emailCheck = validateEmail(emailRaw);
        if (!emailCheck.ok) {
          return showFieldErr(emailCheck.error, emailInput);
        }
        if (!PHONE_E164_RE.test(phone)) {
          return showFieldErr("Phone must be in international E.164 format (e.g. +14155552671).", phoneInput);
        }

        const payload = {
          full_name,
          username,
          email: emailCheck.email,
          phone,
        };
        if (avatarDirty) {
          payload.avatar_url = stagedAvatar;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = tUi("saving");
        try {
          const res = await apiJson("/api/auth/profile", {
            method: "POST",
            body: payload,
          });
          if (!res.ok) {
            showFieldErr((res.data && res.data.error) || "Could not update profile.");
            return;
          }
          current = res.data.user;
          activeUser = res.data.user;
          stagedAvatar = current.avatar_url ?? null;
          avatarDirty = false;
          syncHero();
          mountProfileAvatar(activeUser);
          setStatus(tUi("profile_saved"), "ok");
          safeToast("Profile updated");
        } catch {
          showFieldErr("Could not reach the server. Please try again.");
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = tUi("save_changes");
        }
      },
    },
    el(
      "div",
      { className: "vt-field-row" },
      el("label", { className: "vt-field" }, nameLabelSpan, nameInput),
      el("label", { className: "vt-field" }, userLabelSpan, userInput)
    ),
    el(
      "label",
      { className: "vt-field" },
      el("div", { className: "vt-prof-field-head" }, emailLabelSpan, emailBadgeSlot),
      emailInput
    ),
    el(
      "label",
      { className: "vt-field" },
      el("div", { className: "vt-prof-field-head" }, phoneLabelSpan, phoneBadgeSlot),
      phoneInput
    ),
    el("label", { className: "vt-field" }, langLabelSpan, langSelect),
    reverifyNoteEl,
    statusEl,
    el(
      "div",
      { className: "vt-prof-acts" },
      signOutBtn,
      el("div", { className: "vt-prof-acts-right" }, cancelBtn, saveBtn)
    )
  );

  syncHero();
  dialog.append(head, hero, form);
  setTimeout(() => closeBtn.focus(), 20);
}

if (typeof window !== "undefined") {
  window.VT_PROFILE_UI = Object.freeze({
    mount: (user, targetEl) => mountProfileAvatar(user || activeUser, targetEl || null),
    unmount: () => unmountProfileAvatar(),
    update: (user) => {
      if (user) activeUser = user;
      return mountProfileAvatar(activeUser);
    },
    openModal: (user) => openProfileSettingsModal(user || activeUser),
    closeModal: () => {
      const ov = document.getElementById("vtProfileModalOv");
      if (ov) ov.remove();
    },
    getUser: () => activeUser,
    getInitials: getUserInitials,
    resizeAvatarFile,
  });
}

// ---------------------------------------------------------------------------
// Admin Badge & User Table Modal (user.role === "admin")
// ---------------------------------------------------------------------------

function mountAdminBadge(user) {
  const existing = document.getElementById("vtAdminBtn");
  if (!user || user.role !== "admin") {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;

  const lgo = document.getElementById("lgo");
  if (!lgo || !lgo.parentNode) return;

  const btn = el(
    "button",
    {
      id: "vtAdminBtn",
      type: "button",
      className: "theme-btn vt-admin-badge",
      title: "Admin: view registered users",
      "aria-label": "Admin users panel",
      onClick: () => openAdminUsersModal(),
    },
    buildShieldIcon(),
    el("span", { textContent: "Admin" })
  );
  lgo.parentNode.insertBefore(btn, lgo);
}

function formatDateShort(ms) {
  if (!Number.isFinite(Number(ms))) return "—";
  try {
    return new Date(Number(ms)).toISOString().slice(0, 10);
  } catch {
    return "—";
  }
}

function openAdminUsersModal() {
  const { dialog, close } = createAccessibleModal({
    id: "vtAdminUsersOv",
    labelledBy: "vtAdminTitle",
    dismissible: true,
    wide: true,
  });

  let activeTab = "users"; // "users" | "waitlist"

  const title = el("h2", { id: "vtAdminTitle", className: "vt-modal-h", textContent: "Admin · Users" });
  const countBadge = el("span", { className: "vt-count-pill", textContent: "Loading…" });
  const tabUsersBtn = el("button", {
    type: "button",
    id: "vtAdminTabUsers",
    className: "vt-btn-ghost on",
    textContent: "Users",
    onClick: () => {
      activeTab = "users";
      title.textContent = "Admin · Users";
      tabUsersBtn.classList.add("on");
      tabWaitlistBtn.classList.remove("on");
      loadUsers();
    },
  });
  const tabWaitlistBtn = el("button", {
    type: "button",
    id: "vtAdminTabWaitlist",
    className: "vt-btn-ghost",
    textContent: "Waitlist",
    onClick: () => {
      activeTab = "waitlist";
      title.textContent = "Admin · Waitlist";
      tabWaitlistBtn.classList.add("on");
      tabUsersBtn.classList.remove("on");
      loadWaitlist();
    },
  });
  const refreshBtn = el("button", {
    type: "button",
    className: "vt-btn-ghost",
    textContent: "Refresh",
    onClick: () => (activeTab === "waitlist" ? loadWaitlist() : loadUsers()),
  });
  const closeBtn = el("button", {
    type: "button",
    className: "vt-modal-close",
    "aria-label": "Close admin users dialog",
    textContent: "\u00d7",
    onClick: () => close(),
  });

  const head = el(
    "div",
    { className: "vt-modal-head" },
    el("div", { className: "vt-modal-title-wrap" }, title, countBadge),
    el("div", { className: "vt-modal-head-acts" }, tabUsersBtn, tabWaitlistBtn, refreshBtn, closeBtn)
  );

  const note = el("p", {
    className: "vt-modal-sub",
    textContent: "Read-only masked directory. Sensitive fields (phone, DOB, password hashes) are omitted server-side.",
  });

  const body = el("div", { className: "vt-admin-body" });
  dialog.append(head, note, body);

  function renderSkeleton() {
    body.textContent = "";
    const sk = el("div", { className: "vt-skel-list", "aria-busy": "true", "aria-label": "Loading users" });
    for (let i = 0; i < 4; i++) {
      sk.append(el("div", { className: "vt-skel-row" }));
    }
    body.append(sk);
  }

  function renderError(msg) {
    body.textContent = "";
    countBadge.textContent = "Error";
    body.append(
      el(
        "div",
        { className: "vt-admin-empty" },
        el("p", { className: "auth-err", textContent: msg }),
        el("button", { type: "button", className: "pri", textContent: "Try again", onClick: () => loadUsers() })
      )
    );
  }

  function renderTable(users) {
    body.textContent = "";
    countBadge.textContent = `${users.length} ${users.length === 1 ? "user" : "users"}`;
    if (!users.length) {
      body.append(el("div", { className: "vt-admin-empty" }, el("p", { textContent: "No users registered yet." })));
      return;
    }

    const thead = el(
      "thead",
      null,
      el(
        "tr",
        null,
        el("th", { scope: "col", textContent: "User" }),
        el("th", { scope: "col", textContent: "Email" }),
        el("th", { scope: "col", textContent: "Role" }),
        el("th", { scope: "col", textContent: "Plan" }),
        el("th", { scope: "col", textContent: "Profile" }),
        el("th", { scope: "col", textContent: "Status" }),
        el("th", { scope: "col", textContent: "Joined" })
      )
    );

    const tbody = el("tbody");
    for (const u of users) {
      const nameWrap = el(
        "div",
        { className: "vt-adm-user" },
        el("span", { className: "vt-adm-name", textContent: u.full_name || "—" }),
        el("span", { className: "vt-adm-handle", textContent: u.username ? `@${u.username}` : "Pending handle" })
      );
      const rolePill = el("span", {
        className: u.role === "admin" ? "vt-pill vt-pill-acc" : "vt-pill",
        textContent: u.role || "user",
      });
      const planPill = el("span", {
        className: "vt-pill",
        textContent: u.plan || "free",
      });
      const profPill = el("span", {
        className: u.profile_completed ? "vt-pill vt-pill-ok" : "vt-pill",
        textContent: u.profile_completed ? "Complete" : "Pending",
      });
      const statusPill = el("span", {
        className: u.disabled_at ? "vt-pill vt-pill-bad" : "vt-pill vt-pill-ok",
        textContent: u.disabled_at ? "Disabled" : "Active",
      });

      tbody.append(
        el(
          "tr",
          null,
          el("td", null, nameWrap),
          el("td", { className: "vt-mono", textContent: u.email || "—" }),
          el("td", null, rolePill),
          el("td", null, planPill),
          el("td", null, profPill),
          el("td", null, statusPill),
          el("td", { className: "vt-mono", textContent: formatDateShort(u.created_at) })
        )
      );
    }

    const wrap = el("div", { className: "vt-admin-tw" }, el("table", { className: "vt-admin-tbl" }, thead, tbody));
    body.append(wrap);
  }

  async function loadUsers() {
    refreshBtn.disabled = true;
    countBadge.textContent = "Loading…";
    renderSkeleton();
    try {
      const res = await apiJson("/api/admin/users?limit=100&offset=0");
      if (!res.ok) {
        renderError((res.data && res.data.error) || "Unable to load users.");
        return;
      }
      renderTable(Array.isArray(res.data.users) ? res.data.users : []);
    } catch {
      renderError("Could not reach the server.");
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function renderWaitlistTable(entries, total) {
    body.textContent = "";
    const count = typeof total === "number" ? total : entries.length;
    countBadge.textContent = `${count} ${count === 1 ? "entry" : "entries"}`;
    if (!entries.length) {
      body.append(el("div", { className: "vt-admin-empty" }, el("p", { textContent: "No waitlist entries yet." })));
      return;
    }

    const thead = el(
      "thead",
      null,
      el(
        "tr",
        null,
        el("th", { scope: "col", textContent: "Email" }),
        el("th", { scope: "col", textContent: "Canonical" }),
        el("th", { scope: "col", textContent: "Source" }),
        el("th", { scope: "col", textContent: "Signed up" })
      )
    );

    const tbody = el("tbody");
    for (const row of entries) {
      const srcPill = el("span", {
        className: "vt-pill",
        textContent: row.source || "landing",
      });
      tbody.append(
        el(
          "tr",
          null,
          el("td", { className: "vt-mono", textContent: row.email || "—" }),
          el("td", { className: "vt-mono", textContent: row.canonical_email || "—" }),
          el("td", null, srcPill),
          el("td", { className: "vt-mono", textContent: formatDateShort(row.created_at) })
        )
      );
    }

    const wrap = el("div", { className: "vt-admin-tw" }, el("table", { className: "vt-admin-tbl" }, thead, tbody));
    body.append(wrap);
  }

  async function loadWaitlist() {
    refreshBtn.disabled = true;
    countBadge.textContent = "Loading…";
    renderSkeleton();
    try {
      const res = await apiJson("/api/admin/waitlist?limit=100&offset=0");
      if (!res.ok) {
        renderError((res.data && res.data.error) || "Unable to load waitlist.");
        return;
      }
      const list = Array.isArray(res.data.entries)
        ? res.data.entries
        : Array.isArray(res.data.waitlist)
          ? res.data.waitlist
          : [];
      renderWaitlistTable(list, res.data.total);
    } catch {
      renderError("Could not reach the server.");
    } finally {
      refreshBtn.disabled = false;
    }
  }

  loadUsers();
  setTimeout(() => closeBtn.focus(), 20);
}

// ---------------------------------------------------------------------------
// One-Time Legacy scr2~* Cloud Migration (POST /api/me/import)
// ---------------------------------------------------------------------------

function findLegacyLocalKeys() {
  const keys = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && /^scr2p?~/.test(k)) {
        keys.push(k);
      }
    }
  } catch {
    return [];
  }
  return keys;
}

function buildImportPayloadFromLocalKeys(keys) {
  let mergedState = null;
  let mergedPresets = null;

  for (const k of keys) {
    let raw;
    try {
      raw = window.localStorage.getItem(k);
    } catch {
      continue;
    }
    if (!raw) continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    if (k.startsWith("scr2p~")) {
      mergedPresets = Object.assign(mergedPresets || {}, parsed);
    } else if (k.startsWith("scr2~")) {
      mergedState = Object.assign(mergedState || {}, parsed);
    }
  }

  const payload = {};
  if (mergedState) {
    if (mergedState.wl || mergedState.wlx) {
      payload.watchlists = { wl: mergedState.wl || [], wlx: mergedState.wlx || null };
    }
    if (Array.isArray(mergedState.alerts) && mergedState.alerts.length) {
      payload.alerts = mergedState.alerts;
    }
    if (mergedState.dr && typeof mergedState.dr === "object" && Object.keys(mergedState.dr).length) {
      payload.drawings = mergedState.dr;
    }
    if (mergedState.vs || mergedState.scripts) {
      payload.scripts = mergedState.vs || mergedState.scripts;
    }
    if (mergedState.jr && typeof mergedState.jr === "object") {
      payload.journal = mergedState.jr;
    }
    const layouts = {};
    if (mergedState.chart) layouts.chart = mergedState.chart;
    if (mergedState.tpl) layouts.tpl = mergedState.tpl;
    if (mergedState.cols) layouts.cols = mergedState.cols;
    if (mergedState.cur) layouts.cur = mergedState.cur;
    if (mergedPresets) layouts.presets = mergedPresets;
    if (Object.keys(layouts).length) {
      payload.layouts = layouts;
    }
  } else if (mergedPresets && Object.keys(mergedPresets).length) {
    payload.layouts = { presets: mergedPresets };
  }

  return payload;
}

function maybeOfferLegacyImport(user) {
  if (!user || !user.id || !user.profile_completed) return;
  if (typeof document !== "undefined" && document.getElementById("vt-landing-root")) return;
  const rawPath = String((typeof window !== "undefined" && window.location && window.location.pathname) || "/")
    .trim()
    .toLowerCase();
  const rawHash = String((typeof window !== "undefined" && window.location && window.location.hash) || "")
    .trim()
    .toLowerCase();
  const isPublicPath =
    rawPath === "/pricing" ||
    rawPath === "/privacy" ||
    rawPath === "/terms" ||
    rawPath === "/risk" ||
    rawPath === "/legal" ||
    rawPath.startsWith("/legal/") ||
    rawPath.startsWith("/features/") ||
    rawPath.startsWith("/products/");
  if (
    isPublicPath ||
    rawHash === "" ||
    rawHash === "#" ||
    rawHash === "#/" ||
    rawHash === "#/home" ||
    rawHash === "#/landing" ||
    rawHash === "#/pricing" ||
    rawHash.startsWith("#/features/") ||
    rawHash.startsWith("#/products/") ||
    rawHash === "#/legal" ||
    rawHash.startsWith("#/legal/") ||
    rawHash === "#legal" ||
    rawHash.startsWith("#legal/")
  ) {
    return;
  }
  const skipKey = `vt_import_skip_${user.id}`;
  try {
    if (window.sessionStorage.getItem(skipKey) === "1") return;
  } catch {
    // ignore
  }

  const legacyKeys = findLegacyLocalKeys();
  if (!legacyKeys.length) return;

  const payload = buildImportPayloadFromLocalKeys(legacyKeys);
  const namespaces = Object.keys(payload);
  if (!namespaces.length) return;

  if (document.getElementById("vtImportModalOv") || document.getElementById("vtCompleteProfileOv")) return;

  const { dialog, close } = createAccessibleModal({
    id: "vtImportModalOv",
    labelledBy: "vtImpTitle",
    dismissible: true,
    onClose: () => {
      try {
        window.sessionStorage.setItem(skipKey, "1");
      } catch {
        // ignore
      }
    },
  });

  const title = el("h2", { id: "vtImpTitle", className: "vt-modal-h", textContent: "Import local workspace" });
  const desc = el("p", {
    className: "vt-modal-sub",
    textContent:
      "We found saved watchlists, alerts, drawings, or layouts stored locally on this device. Import them to your account so they stay synced?",
  });
  const nsList = el(
    "div",
    { className: "vt-imp-tags" },
    ...namespaces.map((ns) => el("span", { className: "vt-pill", textContent: ns }))
  );
  const errEl = el("div", { className: "auth-err", role: "alert", "aria-live": "polite" });

  const skipBtn = el("button", {
    type: "button",
    className: "vt-btn-ghost",
    textContent: "Not now",
    onClick: () => close(),
  });

  const importBtn = el("button", {
    type: "button",
    className: "pri",
    textContent: "Import to account",
    onClick: async () => {
      errEl.textContent = "";
      importBtn.disabled = true;
      importBtn.textContent = "Importing…";
      try {
        const res = await apiJson("/api/me/import", {
          method: "POST",
          body: payload,
        });
        if (!res.ok) {
          errEl.textContent = (res.data && res.data.error) || "Import failed. Your local data was kept untouched.";
          return;
        }
        // Only delete legacy localStorage keys AFTER server 200 acknowledgement (AGENTS.md §3)
        for (const k of legacyKeys) {
          try {
            window.localStorage.removeItem(k);
          } catch {
            // ignore
          }
        }
        close();
        safeToast("Local workspace imported to your account");
      } catch {
        errEl.textContent = "Could not reach the server. Your local data was kept untouched.";
      } finally {
        importBtn.disabled = false;
        importBtn.textContent = "Import to account";
      }
    },
  });

  dialog.append(title, desc, nsList, errEl, el("div", { className: "vt-modal-acts" }, skipBtn, importBtn));
  setTimeout(() => importBtn.focus(), 20);
}

// ---------------------------------------------------------------------------
// Session Hydration & Logout
// ---------------------------------------------------------------------------

function adaptUserForTerminal(user) {
  return {
    id: user.email || user.username || user.id,
    uid: user.id,
    email: user.email,
    username: user.username,
    full_name: user.full_name,
    avatar_url: user.avatar_url ?? null,
    role: user.role,
    plan: user.plan,
    profile_completed: Boolean(user.profile_completed),
    email_verified: Boolean(user.email_verified),
    phone_verified: Boolean(user.phone_verified),
  };
}

function maybeOpenVerificationModal(user) {
  if (!user || !user.id || user.profile_completed === false) return;
  if (user.email_verified && user.phone_verified) return;
  const dismissKey = `vt_verify_dismissed_${user.id}`;
  try {
    if (window.sessionStorage.getItem(dismissKey) === "1") return;
  } catch {
    // ignore
  }
  openVerificationModal(user);
}

function applySignedInSession(user, { forceVerifyModal = false } = {}) {
  activeUser = user;
  const adapted = adaptUserForTerminal(user);

  // Store lightweight display marker in sessionStorage (never secrets/tokens)
  if (typeof window.authStore === "function") {
    try {
      const keep = Boolean(document.getElementById("auRem")?.checked);
      window.authStore({ id: adapted.id }, keep);
    } catch {
      // ignore
    }
  }

  if (typeof window.authEnter === "function") {
    window.authEnter(adapted);
  } else {
    document.documentElement.classList.remove("locked");
  }

  mountAdminBadge(user);
  mountProfileAvatar(user);
  wireRealLogout();
  window.vtOpenVerificationModal = () => {
    if (activeUser) openVerificationModal(activeUser);
  };

  if (user.profile_completed === false) {
    openCompleteProfileModal(user);
  } else {
    cleanCompleteProfileQuery();
    if (!user.email_verified || !user.phone_verified) {
      if (forceVerifyModal) {
        try {
          window.sessionStorage.removeItem(`vt_verify_dismissed_${user.id}`);
        } catch {
          // ignore
        }
        openVerificationModal(user);
      } else {
        setTimeout(() => maybeOpenVerificationModal(user), 250);
      }
    } else {
      setTimeout(() => maybeOfferLegacyImport(user), 350);
    }
  }
}

async function performRealLogout() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  } catch {
    // Proceed with local clear even if offline
  }
  activeUser = null;
  unmountProfileAvatar();
  const adm = document.getElementById("vtAdminBtn");
  if (adm) adm.remove();
  if (typeof window.authClear === "function") {
    try {
      window.authClear();
    } catch {
      // ignore
    }
  }
  window.location.reload();
}

function wireRealLogout() {
  if (!d1AuthLive) return;
  window.authSignOut = performRealLogout;
  const lgo = document.getElementById("lgo");
  if (lgo && !(typeof window.vtIsGuest === "function" && window.vtIsGuest())) {
    lgo.onclick = performRealLogout;
  }
}

// ---------------------------------------------------------------------------
// Enhanced #auth Screen (Sign In / Create Account Segmented Toggle + OAuth)
// ---------------------------------------------------------------------------

function buildOAuthSection() {
  if (!providers.google && !providers.apple) return null;

  const btns = [];
  if (providers.google) {
    btns.push(
      el(
        "a",
        {
          href: "/api/auth/oauth/google",
          className: "vt-oauth-btn vt-oauth-google",
        },
        buildGoogleIcon(),
        el("span", { textContent: "Continue with Google" })
      )
    );
  }
  if (providers.apple) {
    btns.push(
      el(
        "a",
        {
          href: "/api/auth/oauth/apple",
          className: "vt-oauth-btn vt-oauth-apple",
        },
        buildAppleIcon(),
        el("span", { textContent: "Continue with Apple" })
      )
    );
  }

  return el("div", { className: "vt-oauth-group", "aria-label": "Single sign-on providers" }, ...btns);
}

function enhanceAuthScreen() {
  if (authUiMounted) return;
  const form = document.getElementById("auForm");
  const idEl = document.getElementById("auId");
  const pwEl = document.getElementById("auPw");
  const btn = document.getElementById("auBtn");
  const errEl = document.getElementById("auErr");
  if (!form || !idEl || !pwEl || !btn || !errEl) return;

  authUiMounted = true;
  ensureAuthExtraStyles();
  form.classList.add("vt-d1-auth");

  // Update subtitle and prototype note to reflect live D1 Auth
  const sub = form.querySelector(".auth-sub");
  if (sub) sub.textContent = "Sign in to your Vektor Terminal account";

  const idLabel = idEl.closest("label");
  if (idLabel && idLabel.firstChild && idLabel.firstChild.nodeType === Node.TEXT_NODE) {
    idLabel.firstChild.textContent = "Email address\n      ";
  }
  idEl.placeholder = "you@domain.com";
  idEl.setAttribute("autocomplete", "email");

  const protoNote = form.querySelector("p.note");
  if (protoNote) {
    protoNote.textContent = "Protected with HttpOnly session cookies and PBKDF2-SHA256 encryption.";
  }

  // Segmented Sign In / Create Account Toggle
  const tabSignIn = el("button", {
    type: "button",
    id: "vtTabSignIn",
    className: "vt-auth-tab on",
    role: "tab",
    "aria-selected": "true",
    "aria-controls": "vtSignInFields",
    textContent: "Sign In",
  });
  const tabSignUp = el("button", {
    type: "button",
    id: "vtTabSignUp",
    className: "vt-auth-tab",
    role: "tab",
    "aria-selected": "false",
    "aria-controls": "vtSignUpFields",
    textContent: "Create Account",
  });
  const seg = el("div", { className: "vt-auth-seg", role: "tablist", "aria-label": "Account mode" }, tabSignIn, tabSignUp);

  const preLaunchNotice = el(
    "div",
    {
      id: "vtPreLaunchNotice",
      className: "vt-prelaunch-notice",
      role: "status",
      hidden: !isLivePreLaunchHost(),
    },
    el("span", {
      textContent:
        "Pre-Launch Early Access \u2014 Sign in with your invite or admin account, or join the waitlist on the home page. ",
    }),
    el("a", {
      href: "#/",
      className: "vt-prelaunch-home",
      textContent: "Back to home",
    })
  );

  if (sub) sub.after(preLaunchNotice, seg);
  else form.prepend(preLaunchNotice, seg);

  if (isLivePreLaunchHost()) {
    enforceLivePreLaunchGuestGate();
  }

  // Wrap existing sign-in fields into #vtSignInFields without losing element references/IDs
  const signInWrap = el("div", { id: "vtSignInFields", className: "vt-auth-panel", role: "tabpanel" });
  const pwLabel = pwEl.closest("label");
  const remLabel = document.getElementById("auRem")?.closest("label");
  seg.after(signInWrap);
  if (idLabel) signInWrap.append(idLabel);
  if (pwLabel) signInWrap.append(pwLabel);
  if (remLabel) signInWrap.append(remLabel);
  const toSignUpPrompt = el(
    "p",
    { className: "vt-auth-switch mut" },
    "Don\u2019t have an account? ",
    el("button", {
      type: "button",
      id: "vtSwitchToSignUp",
      className: "lnk",
      textContent: "Create an account",
      onClick: () => setMode("signup"),
    })
  );
  signInWrap.append(errEl, btn, toSignUpPrompt);

  // OAuth buttons right after primary button (before "or" / Guest)
  const oauthSection = buildOAuthSection();
  if (oauthSection) {
    signInWrap.after(oauthSection);
  }

  // Build Create Account panel (#vtSignUpFields)
  const suName = el("input", {
    id: "vtSuName",
    name: "full_name",
    type: "text",
    autocomplete: "name",
    placeholder: "Alex Mercer",
    required: true,
    "aria-describedby": "vtSuErr",
  });
  const suUser = el("input", {
    id: "vtSuUser",
    name: "username",
    type: "text",
    autocomplete: "username",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "false",
    placeholder: "alex_mercer",
    required: true,
    "aria-describedby": "vtSuErr",
  });
  const suDob = el("input", {
    id: "vtSuDob",
    name: "dob",
    type: "date",
    autocomplete: "bday",
    max: maxAdultDobIso(),
    required: true,
    "aria-describedby": "vtSuErr",
  });
  const suPhone = el("input", {
    id: "vtSuPhone",
    name: "phone",
    type: "tel",
    autocomplete: "tel",
    placeholder: "+447700900000",
    required: true,
    "aria-describedby": "vtSuErr",
  });
  const suEmail = el("input", {
    id: "vtSuEmail",
    name: "email",
    type: "email",
    autocomplete: "email",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "false",
    placeholder: "you@domain.com",
    required: true,
    "aria-describedby": "vtSuErr",
  });
  const suPw = el("input", {
    id: "vtSuPw",
    name: "new_password",
    type: "password",
    autocomplete: "new-password",
    required: true,
    "aria-describedby": "vtSuPwRules vtSuErr",
  });
  const suPwTog = el("button", {
    type: "button",
    id: "vtSuPwTog",
    className: "pwt",
    "aria-label": "Show password",
    "aria-pressed": "false",
    textContent: "Show",
    onClick: () => {
      const show = suPw.type === "password";
      suPw.type = show ? "text" : "password";
      suPwTog.textContent = show ? "Hide" : "Show";
      suPwTog.setAttribute("aria-pressed", String(show));
      suPwTog.setAttribute("aria-label", show ? "Hide password" : "Show password");
    },
  });

  // Live password strength checklist
  const rLen = el("li", { textContent: "10+ characters" });
  const rUpper = el("li", { textContent: "Uppercase (A–Z)" });
  const rLower = el("li", { textContent: "Lowercase (a–z)" });
  const rDigit = el("li", { textContent: "Number (0–9)" });
  const pwRulesList = el("ul", { id: "vtSuPwRules", className: "vt-pw-rules", "aria-live": "polite" }, rLen, rUpper, rLower, rDigit);

  suPw.addEventListener("input", () => {
    const r = checkPasswordRules(suPw.value);
    rLen.classList.toggle("ok", r.len);
    rUpper.classList.toggle("ok", r.upper);
    rLower.classList.toggle("ok", r.lower);
    rDigit.classList.toggle("ok", r.digit);
  });

  const suTerms = el("input", {
    id: "vtSuTerms",
    name: "terms_accepted",
    type: "checkbox",
    required: true,
    "aria-describedby": "vtSuErr",
  });
  const suTermsWrap = el(
    "div",
    { className: "vt-terms-row" },
    suTerms,
    el(
      "span",
      null,
      el("label", { for: "vtSuTerms", textContent: "I agree to the " }),
      el("a", { href: "#/legal/terms", textContent: "Terms of Service" }),
      " and ",
      el("a", { href: "#/legal/privacy", textContent: "Privacy Policy" })
    )
  );

  const suErr = el("div", { id: "vtSuErr", className: "auth-err", role: "alert", "aria-live": "polite" });
  const suBtn = el("button", { type: "submit", id: "vtSuBtn", className: "pri", textContent: "Create account" });

  const suInputs = [suName, suUser, suDob, suPhone, suEmail, suPw, suTerms];
  const clearSuErr = () => {
    suErr.textContent = "";
    for (const inp of suInputs) inp.removeAttribute("aria-invalid");
  };
  for (const inp of suInputs) {
    inp.addEventListener(inp === suTerms ? "change" : "input", clearSuErr);
  }

  suEmail.addEventListener("blur", () => {
    const v = suEmail.value.trim();
    if (!v) return;
    const chk = validateEmail(v);
    if (!chk.ok) {
      suErr.textContent = chk.error;
      suEmail.setAttribute("aria-invalid", "true");
    }
  });

  const signUpWrap = el(
    "div",
    { id: "vtSignUpFields", className: "vt-auth-panel", role: "tabpanel", hidden: true },
    el(
      "div",
      { className: "vt-field-row" },
      el("label", { className: "vt-field" }, el("span", { textContent: "Full name" }), suName),
      el("label", { className: "vt-field" }, el("span", { textContent: "Username" }), suUser)
    ),
    el(
      "div",
      { className: "vt-field-row" },
      el("label", { className: "vt-field" }, el("span", { textContent: "Date of birth (18+)" }), suDob),
      el("label", { className: "vt-field" }, el("span", { textContent: "Phone (E.164)" }), suPhone)
    ),
    el("label", { className: "vt-field" }, el("span", { textContent: "Email address" }), suEmail),
    el(
      "label",
      { className: "vt-field" },
      el("span", { textContent: "Password" }),
      el("span", { className: "pw" }, suPw, suPwTog)
    ),
    pwRulesList,
    suTermsWrap,
    suErr,
    suBtn,
    el(
      "p",
      { className: "vt-auth-switch mut" },
      "Already have an account? ",
      el("button", {
        type: "button",
        id: "vtSwitchToSignIn",
        className: "lnk",
        textContent: "Sign in",
        onClick: () => setMode("signin"),
      })
    )
  );

  signInWrap.after(signUpWrap);

  function setMode(mode) {
    currentMode = mode;
    const isSignIn = mode === "signin";
    tabSignIn.classList.toggle("on", isSignIn);
    tabSignIn.setAttribute("aria-selected", String(isSignIn));
    tabSignUp.classList.toggle("on", !isSignIn);
    tabSignUp.setAttribute("aria-selected", String(!isSignIn));
    signInWrap.hidden = !isSignIn;
    signUpWrap.hidden = isSignIn;
    if (sub) {
      sub.textContent = isSignIn
        ? "Sign in to your Vektor Terminal account"
        : "Create your institutional terminal account";
    }
    if (isSignIn) {
      clearSuErr();
      idEl.focus();
    } else {
      errEl.textContent = "";
      if (idEl.value && !validateEmail(idEl.value.trim()).ok) {
        idEl.value = "";
        idEl.removeAttribute("aria-invalid");
      }
      suName.focus();
    }
  }

  tabSignIn.addEventListener("click", () => setMode("signin"));
  tabSignUp.addEventListener("click", () => setMode("signup"));

  // Expose direct mode switcher & hash routing for #/signup, #signup, #auth/signup, #/login, #auth
  window.vtSetAuthMode = (mode) => {
    setMode(mode === "signup" ? "signup" : "signin");
  };
  window.vtOpenAuthModal = (mode) => {
    if (typeof window.vtShowSignIn === "function") {
      window.vtShowSignIn();
    } else {
      document.documentElement.classList.add("locked");
    }
    if (mode === "signup" || mode === "signin") {
      setMode(mode);
    }
  };

  function isSignUpRouteHash(rawHash) {
    const h = String(rawHash || "").toLowerCase();
    return (
      h === "#signup" ||
      h === "#/signup" ||
      h === "#register" ||
      h === "#/register" ||
      h === "#auth/signup" ||
      h === "#/auth/signup"
    );
  }

  function isSignInRouteHash(rawHash) {
    const h = String(rawHash || "").toLowerCase();
    return (
      h === "#auth" ||
      h === "#/auth" ||
      h === "#login" ||
      h === "#/login" ||
      h === "#signin" ||
      h === "#/signin" ||
      h === "#auth/signin" ||
      h === "#/auth/signin"
    );
  }

  function syncAuthHashRoute() {
    const h = String(window.location.hash || "").toLowerCase();
    // Never cover legal routes (#/legal, #/legal/*) with the #auth gate
    if (isLegalRouteHash(h)) {
      document.documentElement.classList.remove("locked");
      return;
    }

    const isSignUpHash = isSignUpRouteHash(h);
    const isSignInHash = isSignInRouteHash(h);
    if (isSignUpHash || isSignInHash) {
      if (typeof window.vtShowSignIn === "function") {
        window.vtShowSignIn();
      } else {
        document.documentElement.classList.add("locked");
      }
      if (isLivePreLaunchHost()) {
        hideGuestControls();
        showPreLaunchNotice();
      }
      setMode(isSignUpHash ? "signup" : "signin");
      return;
    }

    if (isLivePreLaunchHost() && !activeUser) {
      if (isTerminalRouteHash(h) || !isPublicPreLaunchHash(h)) {
        redirectToPreLaunchLogin();
        setMode("signin");
        return;
      }
      // Public non-auth landing routes: ensure #auth gate is not blocking the home/pricing/product view
      document.documentElement.classList.remove("locked");
    }
  }

  window.addEventListener("hashchange", syncAuthHashRoute);
  syncAuthHashRoute();

  function showSuError(msg, target) {
    suErr.textContent = msg;
    if (target) {
      target.setAttribute("aria-invalid", "true");
      target.focus();
    }
  }

  function showSiError(msg, target) {
    errEl.textContent = msg;
    idEl.removeAttribute("aria-invalid");
    pwEl.removeAttribute("aria-invalid");
    if (target) {
      target.setAttribute("aria-invalid", "true");
      target.focus();
    }
  }

  async function handleSignInSubmit() {
    const email = idEl.value.trim();
    const password = pwEl.value;
    if (!email) return showSiError("Enter your email address.", idEl);
    const emailCheck = validateEmail(email);
    if (!emailCheck.ok) return showSiError(emailCheck.error, idEl);
    if (!password) return showSiError("Enter your password.", pwEl);

    errEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
      const res = await apiJson("/api/auth/login", {
        method: "POST",
        body: { email: emailCheck.email, password },
      });
      if (!res.ok) {
        const msg =
          res.status === 429
            ? formatRetryError(res.data && res.data.error, res.retryAfter)
            : (res.data && res.data.error) || "Invalid email or password.";
        showSiError(msg, res.status === 429 ? null : pwEl);
        return;
      }
      pwEl.value = "";
      applySignedInSession(res.data.user);
    } catch {
      showSiError("Could not reach the authentication server. Please try again.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  }

  async function handleSignUpSubmit() {
    clearSuErr();
    const full_name = suName.value.trim();
    const username = suUser.value.trim();
    const dob = suDob.value.trim();
    const phone = normalizePhoneInput(suPhone.value);
    const emailRaw = suEmail.value.trim();
    const password = suPw.value;

    if (full_name.length < 2 || full_name.length > 100) {
      return showSuError("Full name must be between 2 and 100 characters.", suName);
    }
    if (!USERNAME_RE.test(username)) {
      return showSuError("Username must be 3–24 characters using letters, numbers, and underscores only.", suUser);
    }
    const dobErr = checkDobClient(dob);
    if (dobErr) return showSuError(dobErr, suDob);
    if (!PHONE_E164_RE.test(phone)) {
      return showSuError("Phone must be in international E.164 format (e.g. +447700900000).", suPhone);
    }
    const emailCheck = validateEmail(emailRaw);
    if (!emailCheck.ok) return showSuError(emailCheck.error, suEmail);

    const pwRules = checkPasswordRules(password);
    if (!pwRules.len || !pwRules.upper || !pwRules.lower || !pwRules.digit) {
      return showSuError("Password must be 10+ characters with uppercase, lowercase, and a number.", suPw);
    }
    if (!suTerms.checked) {
      return showSuError("You must accept the Terms of Service and Privacy Policy to create an account.", suTerms);
    }

    suBtn.disabled = true;
    suBtn.textContent = "Creating account…";
    try {
      const res = await apiJson("/api/auth/register", {
        method: "POST",
        body: { full_name, username, dob, phone, email: emailCheck.email, password, terms_accepted: true },
      });
      if (!res.ok) {
        const msg =
          res.status === 429
            ? formatRetryError(res.data && res.data.error, res.retryAfter)
            : (res.data && res.data.error) || "Could not create account. Check your details and try again.";
        showSuError(msg);
        return;
      }
      suPw.value = "";
      applySignedInSession(res.data.user, { forceVerifyModal: true });
    } catch {
      showSuError("Could not reach the authentication server. Please try again.");
    } finally {
      suBtn.disabled = false;
      suBtn.textContent = "Create account";
    }
  }

  // Override prototype submit handler completely when D1 Auth is live
  form.onsubmit = (ev) => {
    ev.preventDefault();
    if (currentMode === "signup") {
      handleSignUpSubmit();
    } else {
      handleSignInSubmit();
    }
  };

  // Also neutralize prototype authSignIn so nothing can bypass D1 Auth
  window.authSignIn = async (id, pw) => {
    const res = await apiJson("/api/auth/login", {
      method: "POST",
      body: { email: String(id || "").trim(), password: String(pw || "") },
    });
    if (res.ok) return { ok: true, user: adaptUserForTerminal(res.data.user) };
    return {
      ok: false,
      error:
        res.status === 429
          ? formatRetryError(res.data && res.data.error, res.retryAfter)
          : (res.data && res.data.error) || "Invalid email or password.",
    };
  };
}

// ---------------------------------------------------------------------------
// Bootstrap: Probe /api/auth/providers & /api/auth/me
// ---------------------------------------------------------------------------

function normalizeRouteHash(rawHash) {
  return String(rawHash || "").trim().toLowerCase().replace(/\/+$/, "");
}

function isExplicitAuthRouteHash(rawHash) {
  const h = normalizeRouteHash(rawHash);
  return (
    h === "#signup" ||
    h === "#/signup" ||
    h === "#register" ||
    h === "#/register" ||
    h === "#auth/signup" ||
    h === "#/auth/signup" ||
    h === "#auth" ||
    h === "#/auth" ||
    h === "#login" ||
    h === "#/login" ||
    h === "#signin" ||
    h === "#/signin" ||
    h === "#auth/signin" ||
    h === "#/auth/signin"
  );
}

function isLegalRouteHash(rawHash) {
  const h = normalizeRouteHash(rawHash);
  return h === "#legal" || h === "#/legal" || h.startsWith("#legal/") || h.startsWith("#/legal/");
}

function isTerminalRouteHash(rawHash) {
  const h = normalizeRouteHash(rawHash);
  const prefixes = [
    "#workspace",
    "#/workspace",
    "#chart",
    "#/chart",
    "#charts",
    "#/charts",
    "#screener",
    "#/screener",
    "#backtest",
    "#/backtest",
    "#journal",
    "#/journal",
    "#heatmap",
    "#/heatmap",
    "#calendar",
    "#/calendar",
    "#calc",
    "#/calc",
  ];
  return prefixes.some((p) => h === p || h.startsWith(`${p}/`));
}

function isPublicPreLaunchHash(rawHash) {
  const h = normalizeRouteHash(rawHash);
  if (
    h === "" ||
    h === "#" ||
    h === "#/" ||
    h === "#home" ||
    h === "#/home" ||
    h === "#landing" ||
    h === "#/landing" ||
    h === "#waitlist" ||
    h === "#/waitlist" ||
    h === "#pricing" ||
    h === "#/pricing"
  ) {
    return true;
  }
  if (
    h === "#features" ||
    h === "#/features" ||
    h.startsWith("#features/") ||
    h.startsWith("#/features/") ||
    h === "#products" ||
    h === "#/products" ||
    h.startsWith("#products/") ||
    h.startsWith("#/products/")
  ) {
    return true;
  }
  if (isLegalRouteHash(h)) return true;
  if (isExplicitAuthRouteHash(h) || h.startsWith("#auth/") || h.startsWith("#/auth/")) return true;
  return false;
}

function isLocalTestOrigin() {
  if (typeof window === "undefined" || !window.location) return false;
  const h = String(window.location.hostname || "").toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

function isLivePreLaunchHost() {
  if (typeof window === "undefined" || !window.location) return false;
  return !isLocalTestOrigin();
}

function showPreLaunchNotice() {
  if (typeof document === "undefined") return;
  const notice = document.getElementById("vtPreLaunchNotice");
  if (notice) notice.hidden = false;
}

function hideGuestControls() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.vtLiveGate = "1";
  const guestBtn = document.getElementById("auGuest");
  if (guestBtn) {
    guestBtn.hidden = true;
    guestBtn.disabled = true;
    guestBtn.setAttribute("aria-hidden", "true");
    guestBtn.onclick = (ev) => {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      redirectToPreLaunchLogin();
    };
  }
  const guestNote = document.getElementById("auGuestNote");
  if (guestNote) {
    guestNote.hidden = true;
    guestNote.setAttribute("aria-hidden", "true");
  }
  const form = document.getElementById("auForm");
  if (form) {
    const orEl = form.querySelector(".auor");
    if (orEl) orEl.hidden = true;
  }
  const closeBtn = document.getElementById("auClose");
  if (closeBtn) closeBtn.hidden = true;
}

function redirectToPreLaunchLogin() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (isLegalRouteHash(window.location.hash)) {
    document.documentElement.classList.remove("locked");
    return;
  }
  if (normalizeRouteHash(window.location.hash) !== "#/login") {
    window.location.hash = "#/login";
  }
  if (typeof window.vtShowSignIn === "function") {
    window.vtShowSignIn();
  } else {
    document.documentElement.classList.add("locked");
  }
  if (typeof window.vtSetAuthMode === "function") {
    window.vtSetAuthMode("signin");
  }
  hideGuestControls();
  showPreLaunchNotice();
}

let guestGateWired = false;
function enforceLivePreLaunchGuestGate() {
  if (!isLivePreLaunchHost()) return;
  ensureAuthExtraStyles();
  hideGuestControls();
  try {
    window.sessionStorage.removeItem("vt_guest");
  } catch {
    // ignore
  }
  if (guestGateWired) return;
  guestGateWired = true;

  const blockedGuest = () => {
    redirectToPreLaunchLogin();
    return false;
  };
  window.vtEnterGuest = blockedGuest;
  window.authGuest = blockedGuest;

  if (typeof window.vtHideSignIn === "function") {
    const origHide = window.vtHideSignIn;
    window.vtHideSignIn = function () {
      if (!activeUser && isLivePreLaunchHost()) {
        return false;
      }
      return origHide.apply(this, arguments);
    };
  }

  if (typeof window.authEnter === "function") {
    const origEnter = window.authEnter;
    window.authEnter = function (u) {
      if (isLivePreLaunchHost() && !activeUser && (!u || u.guest)) {
        hideGuestControls();
        redirectToPreLaunchLogin();
        return false;
      }
      return origEnter.apply(this, arguments);
    };
  }

  if (typeof window.vtShowSignIn === "function") {
    const origShow = window.vtShowSignIn;
    window.vtShowSignIn = function () {
      const out = origShow.apply(this, arguments);
      hideGuestControls();
      showPreLaunchNotice();
      return out;
    };
  }
}

async function initD1Auth() {
  const isLocal = isLocalTestOrigin();
  if (!isLocal) {
    enforceLivePreLaunchGuestGate();
  }
  let provRes;
  try {
    provRes = await apiJson("/api/auth/providers");
  } catch {
    // Fail closed on any non-localhost origin so live hosts can NEVER accept prototype credentials.
    if (!isLocal || (typeof window !== "undefined" && isExplicitAuthRouteHash(window.location.hash))) {
      enhanceAuthScreen();
      wireRealLogout();
      if (!isLocal) {
        enforceLivePreLaunchGuestGate();
        const curHash = window.location.hash || "";
        if (isLegalRouteHash(curHash)) {
          document.documentElement.classList.remove("locked");
        } else if (isTerminalRouteHash(curHash) || !isPublicPreLaunchHash(curHash)) {
          redirectToPreLaunchLogin();
        }
      }
    }
    return;
  }

  if (!provRes.ok || !provRes.data || !provRes.data.providers || provRes.data.providers.email !== true) {
    // Fail closed on live origins: NEVER fall back to prototype local login when DB is unbound.
    if (!isLocal || (typeof window !== "undefined" && isExplicitAuthRouteHash(window.location.hash))) {
      enhanceAuthScreen();
      wireRealLogout();
      if (!isLocal) {
        enforceLivePreLaunchGuestGate();
        const curHash = window.location.hash || "";
        if (isLegalRouteHash(curHash)) {
          document.documentElement.classList.remove("locked");
        } else if (isTerminalRouteHash(curHash) || !isPublicPreLaunchHash(curHash)) {
          redirectToPreLaunchLogin();
        }
      }
    }
    return;
  }

  d1AuthLive = true;
  providers = {
    email: Boolean(provRes.data.providers.email),
    google: Boolean(provRes.data.providers.google),
    apple: Boolean(provRes.data.providers.apple),
    email_verify: Boolean(provRes.data.providers.email_verify),
    phone_verify: Boolean(provRes.data.providers.phone_verify),
  };

  enhanceAuthScreen();
  wireRealLogout();
  if (!isLocal) {
    enforceLivePreLaunchGuestGate();
  }

  // Check active HttpOnly session cookie
  try {
    const meRes = await apiJson("/api/auth/me");
    if (meRes.ok && meRes.data && meRes.data.user) {
      applySignedInSession(meRes.data.user);
    } else if (meRes.status === 401) {
      const curHash = typeof window !== "undefined" ? window.location.hash || "" : "";
      if (isLegalRouteHash(curHash)) {
        document.documentElement.classList.remove("locked");
        return;
      }
      const explicitAuth = typeof window !== "undefined" && isExplicitAuthRouteHash(curHash);
      if (explicitAuth) {
        if (typeof window.vtShowSignIn === "function") {
          window.vtShowSignIn();
        } else {
          document.documentElement.classList.add("locked");
        }
        if (!isLocal) {
          hideGuestControls();
          showPreLaunchNotice();
        }
      } else if (!isLocal) {
        // Clear any stale pre-D1 local session marker
        if (typeof window.authUser === "function" && window.authUser() && typeof window.authClear === "function") {
          window.authClear();
        }
        if (isTerminalRouteHash(curHash) || !isPublicPreLaunchHash(curHash)) {
          redirectToPreLaunchLogin();
        } else {
          document.documentElement.classList.remove("locked");
        }
      } else if (!(typeof window.vtIsGuest === "function" && window.vtIsGuest())) {
        // Clear any stale pre-D1 local session marker so real server auth is strictly enforced
        if (typeof window.authUser === "function" && window.authUser() && typeof window.authClear === "function") {
          window.authClear();
          document.documentElement.classList.add("locked");
        }
      }
    }
  } catch {
    // Ignore transient network errors; user remains on sign-in or guest screen.
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initD1Auth();
  });
} else {
  initD1Auth();
}
