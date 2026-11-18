// TASK-05: strict email validation on the sign-in form (#auForm / #auId / #auErr in index.html).
// Only active when the "username or email" field contains "@"; plain usernames are left alone.
// - Disallowed characters are flagged instantly while typing.
// - Full structural checks run on blur and submit; once an error is showing it re-checks on every keystroke
//   so it clears the moment the address is fixed.
// - An invalid email blocks submit before index.html's own handler runs.
// This is a client convenience only: any future /api/register or /api/login must call validateEmail server-side.
import { validateEmail, isEmailLike, EMAIL_ALLOWED_CHARS_RE } from "../shared/emailValidator.js";

const FORM_ID = "auForm";
const FIELD_ID = "auId";
const ERR_ID = "auErr";

let shownMessage = ""; // the error this module last put in #auErr ("" = none)

const field = () => document.getElementById(FIELD_ID);

function check(value, { full }) {
  if (!isEmailLike(value)) return { ok: true };
  const result = validateEmail(value);
  if (result.ok || full) return result;
  // While typing, only complain about characters/spaces/length — not about an address that's merely unfinished.
  const trimmed = value.trim();
  const charProblem = /\s/.test(trimmed) || !EMAIL_ALLOWED_CHARS_RE.test(trimmed) || trimmed.length > 254;
  return charProblem ? result : { ok: true };
}

function show(input, message) {
  const err = document.getElementById(ERR_ID);
  if (err) err.textContent = message;
  input.setAttribute("aria-invalid", "true");
  shownMessage = message;
}

// Only undo our own message, never one written by index.html's handler.
function clear(input) {
  if (!shownMessage) return;
  const err = document.getElementById(ERR_ID);
  if (err && err.textContent === shownMessage) {
    err.textContent = "";
    input.removeAttribute("aria-invalid");
  }
  shownMessage = "";
}

function apply(input, full) {
  const result = check(input.value, { full });
  if (result.ok) clear(input);
  else show(input, result.error);
  return result.ok;
}

// Bubble phase on document: runs after index.html's own oninput (which clears #auErr on every keystroke).
document.addEventListener("input", (ev) => {
  const input = field();
  if (!input || ev.target !== input) return;
  apply(input, false); // the inline handler has already cleared #auErr for this keystroke
});

document.addEventListener("focusout", (ev) => {
  const input = field();
  if (!input || ev.target !== input || !input.value.trim()) return;
  apply(input, true);
});

// Capture phase on document: runs before the form's onsubmit regardless of registration order.
document.addEventListener("submit", (ev) => {
  const input = field();
  if (!input || !ev.target || ev.target.id !== FORM_ID) return;
  if (apply(input, true)) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  input.focus();
}, true);
