// Run once (by Tyler): node tests/create-smoke-user.mjs
// One-off: create the dedicated smoke-test account via the live /api/auth/register endpoint (same hashing/validation as
// the app) and save the credentials locally. Never prints the password.
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { fileURLToPath } from "node:url";
const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const scratch = process.argv[2] || "";
const target = join(repoRoot, "smoke-creds.local.json");
if (existsSync(target)) {
  console.log("smoke-creds.local.json already exists; not creating another account");
  process.exit(0);
}
const pick = (set, n) => Array.from(randomBytes(n), (b) => set[b % set.length]).join("");
// 32 chars: guaranteed upper, lower, digit + random alphanumerics
const password = pick("ABCDEFGHJKLMNPQRSTUVWXYZ", 4) + pick("abcdefghijkmnopqrstuvwxyz", 4) + pick("23456789", 4) + pick("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789", 20);
const email = "smoke-bot@vektorterminal.com";
const body = {
  email,
  password,
  full_name: "Smoke Bot",
  username: "smoke_bot",
  dob: "1990-01-01",
  phone: "+447700900123", // Ofcom range reserved for fiction
  terms_accepted: true,
};
const res = await fetch("https://vektorterminal.com/api/auth/register", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://vektorterminal.com" },
  body: JSON.stringify(body),
});
let j = null;
try {
  j = await res.json();
} catch {
  j = null;
}
if (!res.ok || !j || !j.ok) {
  console.log("register failed:", res.status, j && j.error ? j.error : "(no body)");
  process.exit(1);
}
const creds = JSON.stringify({ email, password }, null, 2) + "\n";
writeFileSync(target, creds, { mode: 0o600 });
if (scratch) writeFileSync(join(scratch, "smoke-creds.json"), creds, { mode: 0o600 });
console.log("created", j.user && j.user.email, "id", j.user && j.user.id, "profile_completed", j.user && j.user.profile_completed, "verified", Boolean(j.user && j.user.email_verified_at));
