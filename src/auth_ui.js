// src/auth_ui.js — Phase 3A: Real D1 Auth, Full Signup Profile, Google & Apple OAuth,
// Profile-Completion Modal, Admin User Table Modal, and One-Time Legacy Cloud Import.
// Presentation only: all authoritative validation, hashing, lockout, OAuth, and RBAC live on the server.
// Zero innerHTML — every node is built with createElement/createElementNS and textContent.

import { validateEmail } from "../shared/emailValidator.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;
const PHONE_E164_RE = /^\+[1-9]\d{6,14}$/;
const DOB_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

let activeUser = null;
let providers = { email: false, google: false, apple: false };
let d1AuthLive = false;
let authUiMounted = false;
let currentMode = "signin"; // "signin" | "signup"

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
    placeholder: "+44 7700 900000",
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
          return showErr("Enter an international phone number starting with + (e.g. +44 7700 900000).", phoneInput);
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
    role: user.role,
    plan: user.plan,
    profile_completed: Boolean(user.profile_completed),
  };
}

function applySignedInSession(user) {
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
  wireRealLogout();

  if (user.profile_completed === false) {
    openCompleteProfileModal(user);
  } else {
    cleanCompleteProfileQuery();
    setTimeout(() => maybeOfferLegacyImport(user), 350);
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

  if (sub) sub.after(seg);
  else form.prepend(seg);

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
    placeholder: "+44 7700 900000",
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

  const suErr = el("div", { id: "vtSuErr", className: "auth-err", role: "alert", "aria-live": "polite" });
  const suBtn = el("button", { type: "submit", id: "vtSuBtn", className: "pri", textContent: "Create account" });

  const suInputs = [suName, suUser, suDob, suPhone, suEmail, suPw];
  const clearSuErr = () => {
    suErr.textContent = "";
    for (const inp of suInputs) inp.removeAttribute("aria-invalid");
  };
  for (const inp of suInputs) {
    inp.addEventListener("input", clearSuErr);
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
    el("label", { className: "vt-field" }, el("span", { textContent: "Full name" }), suName),
    el("label", { className: "vt-field" }, el("span", { textContent: "Username" }), suUser),
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
    const isSignUpHash = isSignUpRouteHash(h);
    const isSignInHash = isSignInRouteHash(h);
    if (!isSignUpHash && !isSignInHash) return;
    if (typeof window.vtShowSignIn === "function") {
      window.vtShowSignIn();
    } else {
      document.documentElement.classList.add("locked");
    }
    setMode(isSignUpHash ? "signup" : "signin");
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
      return showSuError("Phone must be in international E.164 format (e.g. +44 7700 900000).", suPhone);
    }
    const emailCheck = validateEmail(emailRaw);
    if (!emailCheck.ok) return showSuError(emailCheck.error, suEmail);

    const pwRules = checkPasswordRules(password);
    if (!pwRules.len || !pwRules.upper || !pwRules.lower || !pwRules.digit) {
      return showSuError("Password must be 10+ characters with uppercase, lowercase, and a number.", suPw);
    }

    suBtn.disabled = true;
    suBtn.textContent = "Creating account…";
    try {
      const res = await apiJson("/api/auth/register", {
        method: "POST",
        body: { full_name, username, dob, phone, email: emailCheck.email, password },
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
      applySignedInSession(res.data.user);
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

function isExplicitAuthRouteHash(rawHash) {
  const h = String(rawHash || "").toLowerCase();
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

async function initD1Auth() {
  let provRes;
  try {
    provRes = await apiJson("/api/auth/providers");
  } catch {
    // Offline or static local harness: if user explicitly navigated to #/signup, still mount the signup tabs
    if (typeof window !== "undefined" && isExplicitAuthRouteHash(window.location.hash)) {
      enhanceAuthScreen();
    }
    return;
  }

  if (!provRes.ok || !provRes.data || !provRes.data.providers || provRes.data.providers.email !== true) {
    // 404 / 503 / DB not bound: silently fall back to existing local flow unless user explicitly navigated to #/signup
    if (typeof window !== "undefined" && isExplicitAuthRouteHash(window.location.hash)) {
      enhanceAuthScreen();
    }
    return;
  }

  d1AuthLive = true;
  providers = {
    email: Boolean(provRes.data.providers.email),
    google: Boolean(provRes.data.providers.google),
    apple: Boolean(provRes.data.providers.apple),
  };

  enhanceAuthScreen();
  wireRealLogout();

  // Check active HttpOnly session cookie
  try {
    const meRes = await apiJson("/api/auth/me");
    if (meRes.ok && meRes.data && meRes.data.user) {
      applySignedInSession(meRes.data.user);
    } else if (meRes.status === 401) {
      const explicitAuth = typeof window !== "undefined" && isExplicitAuthRouteHash(window.location.hash);
      if (explicitAuth) {
        if (typeof window.vtShowSignIn === "function") {
          window.vtShowSignIn();
        } else {
          document.documentElement.classList.add("locked");
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
