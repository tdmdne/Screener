// TASK-05 unit checks: strict email character + structure validation (shared/emailValidator.js).
// Run: node tests/email.test.mjs   (or: bun run test:email)
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateEmail, isEmailLike, EMAIL_ALLOWED_CHARS_RE } from "../shared/emailValidator.js";

let failed = 0;
const ok = (name, f) => { try { f(); console.log("PASS", name); } catch (e) { failed++; console.log("FAIL", name, "-", e.message); } };

const VALID = [
  "a.b+c@ex-ample.co.uk",
  "x!*=?^_@d.io",
  "TEST@EXAMPLE.COM",
  "user-name@sub.domain.com",
  "a@b.co",
];
const INVALID = [
  ["a<b@x.com", "angle bracket <"],
  ["a>b@x.com", "angle bracket >"],
  ["a b@x.com", "inner space"],
  ["a\tb@x.com", "tab"],
  ["<script>@x.com", "script tag"],
  ["a@b", "no dot in domain"],
  ["a@@b.com", "double @"],
  ["a@b@c.com", "two @"],
  ["a@-b.com", "leading hyphen label"],
  ["a@b-.com", "trailing hyphen label"],
  ["a@b..com", "empty domain label"],
  ["a@.b.com", "leading dot domain"],
  [".a@b.com", "leading dot local"],
  ["a.@b.com", "trailing dot local"],
  ["a..b@c.com", "consecutive dots local"],
  ['"a"@b.com', "double quotes"],
  ["a'b@c.com", "single quote"],
  ["a\\b@c.com", "backslash"],
  ["a;b@c.com", "semicolon"],
  ["a,b@c.com", "comma"],
  ["a(b)@c.com", "parentheses"],
  ["a%b@c.com", "percent"],
  ["a&b@c.com", "ampersand"],
  ["a#b@c.com", "hash"],
  ["a$b@c.com", "dollar"],
  ["a@b.c", "1-char TLD"],
  ["a@b.c1", "digit TLD"],
  ["a@b_c.com", "underscore in domain"],
  ["a!@b!.com", "symbol in domain"],
  ["jöhn@example.com", "unicode local"],
  ["a@exämple.com", "unicode domain"],
  ["a\u0000b@c.com", "NUL control char"],
  ["a​b@c.com", "zero-width space"],
  ["@b.com", "empty local"],
  ["a@", "empty domain"],
  ["", "empty"],
  ["a".repeat(65) + "@b.com", "local > 64"],
  ["a@" + "b".repeat(290) + ".com", "300-char total"],
];

ok("valid emails accepted and returned trimmed, case preserved", () => {
  for (const e of VALID) {
    const r = validateEmail(e);
    assert.equal(r.ok, true, e + " -> " + JSON.stringify(r));
    assert.equal(r.email, e, e);
  }
  assert.deepEqual(validateEmail("  TEST@EXAMPLE.COM \n"), { ok: true, email: "TEST@EXAMPLE.COM" });
});

ok("invalid emails rejected with a human-readable error", () => {
  for (const [e, why] of INVALID) {
    const r = validateEmail(e);
    assert.equal(r.ok, false, why + ": " + JSON.stringify(e) + " was accepted");
    assert.equal(typeof r.error, "string", why);
    assert.ok(r.error.length > 5 && /[A-Za-z]/.test(r.error), why + " error text");
    assert.equal("email" in r, false, why + " no email on failure");
  }
});

ok("exactly 254 chars allowed, 255 rejected", () => {
  const dom = "@" + "b".repeat(63) + "." + "c".repeat(63) + "." + "d".repeat(63) + ".com"; // 196 chars
  const at254 = "a".repeat(254 - dom.length) + dom; // 58-char local part
  assert.equal(at254.length, 254);
  assert.equal(validateEmail(at254).ok, true, "254");
  const at255 = "a".repeat(255 - dom.length) + dom;
  assert.equal(at255.length, 255);
  assert.equal(validateEmail(at255).ok, false, "255");
});

ok("non-string input never throws", () => {
  for (const v of [undefined, null, 42, {}, [], true]) assert.equal(validateEmail(v).ok, false, String(v));
});

ok("disallowed-character error names the problem", () => {
  assert.match(validateEmail("a<b@x.com").error, /character/i);
  assert.match(validateEmail("a b@x.com").error, /space|character/i);
});

ok("isEmailLike is true only when the string contains @", () => {
  assert.equal(isEmailLike("ann@example.com"), true);
  assert.equal(isEmailLike("bad<x@y"), true);
  assert.equal(isEmailLike("tester"), false);
  assert.equal(isEmailLike(""), false);
  assert.equal(isEmailLike(undefined), false);
});

ok("EMAIL_ALLOWED_CHARS_RE matches only the allowed set", () => {
  assert.ok(EMAIL_ALLOWED_CHARS_RE instanceof RegExp);
  assert.ok(EMAIL_ALLOWED_CHARS_RE.test("Az09!*+-=?^_.@"));
  for (const c of ["<", ">", " ", '"', "'", "\\", ";", ",", "(", ")", "%", "&", "#", "$", "ö", "\n", "/", "`", "{", "|", "~"])
    assert.equal(EMAIL_ALLOWED_CHARS_RE.test("a" + c + "b"), false, JSON.stringify(c));
});

ok("module is dependency-free (no imports) and uses no DOM/Node globals", () => {
  const src = fs.readFileSync(new URL("../shared/emailValidator.js", import.meta.url), "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
  assert.doesNotMatch(src, /^\s*import\s/m, "no imports");
  assert.doesNotMatch(src, /\b(require|document|window|process|Buffer)\b/, "no environment globals");
});

if (failed) { console.log(`\n${failed} test(s) failed`); process.exit(1); }
console.log("\nEMAIL VALIDATOR OK");
