// Strict email validation (TASK-05). Pure and dependency-free: runs in Workers, Node and the browser.
// Client: src/auth_email_validation.js. Server: any future /api/register or /api/login MUST call validateEmail too —
// the client check is only a convenience and can be bypassed.

/** Only ASCII letters, digits and ! * + - = ? ^ _ . @ are allowed anywhere in an address. */
export const EMAIL_ALLOWED_CHARS_RE = /^[A-Za-z0-9!*+\-=?^_.@]+$/;

const MAX_TOTAL = 254;
const MAX_LOCAL = 64;
const MAX_LABEL = 63;
const DOMAIN_LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const TLD_RE = /^[A-Za-z]{2,}$/;

const fail = (error) => ({ ok: false, error });

/** True when the string looks like an attempt at an email address (contains "@"). */
export function isEmailLike(str) {
  return typeof str === "string" && str.includes("@");
}

/**
 * Validate an email address.
 * @param {unknown} str
 * @returns {{ok:true,email:string}|{ok:false,error:string}} email is trimmed; case is preserved.
 */
export function validateEmail(str) {
  if (typeof str !== "string") return fail("Enter an email address.");
  const email = str.trim();
  if (!email) return fail("Enter an email address.");
  if (email.length > MAX_TOTAL) return fail(`That email address is too long (max ${MAX_TOTAL} characters).`);
  if (/\s/.test(email)) return fail("Email addresses can’t contain spaces.");
  if (!EMAIL_ALLOWED_CHARS_RE.test(email))
    return fail("That email contains a character that isn’t allowed. Use letters, numbers and ! * + - = ? ^ _ . only.");

  const at = email.indexOf("@");
  if (at === -1 || at !== email.lastIndexOf("@")) return fail("An email address needs exactly one @.");
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (!local) return fail("Add the part before the @.");
  if (local.length > MAX_LOCAL) return fail(`The part before the @ is too long (max ${MAX_LOCAL} characters).`);
  if (local.startsWith(".") || local.endsWith(".") || local.includes(".."))
    return fail("The part before the @ can’t start or end with a dot or have two dots in a row.");

  if (!domain) return fail("Add the domain after the @, like example.com.");
  const labels = domain.split(".");
  if (labels.length < 2) return fail("The domain needs a dot, like example.com.");
  for (const label of labels) {
    if (!label) return fail("The domain has an empty part (check for extra dots).");
    if (label.length > MAX_LABEL || !DOMAIN_LABEL_RE.test(label))
      return fail("The domain can only use letters, numbers and hyphens, and can’t start or end a part with a hyphen.");
  }
  if (!TLD_RE.test(labels[labels.length - 1])) return fail("The domain must end in at least two letters, like .com.");

  return { ok: true, email };
}
