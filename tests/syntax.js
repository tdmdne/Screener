// Syntax-checks every inline JavaScript <script> in index.html
// and every local src/*.js script loaded by index.html.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const re = /<script(\b[^>]*)>([\s\S]*?)<\/script>/gi;
let m, inlineCount = 0, extCount = 0, bad = 0;

while ((m = re.exec(html))) {
  const attrs = m[1] || "";
  if (/\btype\s*=\s*["']?(application\/ld\+json|application\/json|importmap)/i.test(attrs)) continue;
  const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
  if (srcMatch) {
    const src = srcMatch[1];
    if (/^(https?:|\/\/)/i.test(src) || !src.endsWith(".js") || src.startsWith("vendor/")) continue;
    const filePath = path.join(root, src.replace(/^\/+/, ""));
    if (!fs.existsSync(filePath)) {
      bad++;
      console.error("Missing script:", src);
      continue;
    }
    extCount++;
    try {
      const code = fs.readFileSync(filePath, "utf8");
      if (!/\btype\s*=\s*["']?module["']?/i.test(attrs)) {
        new vm.Script(code, { filename: src });
      }
    } catch (e) {
      bad++;
      console.error("External script", src, e.message);
    }
    continue;
  }
  inlineCount++;
  try {
    new vm.Script(m[2], { filename: "inline" + inlineCount + ".js" });
  } catch (e) {
    bad++;
    console.error("Inline script", inlineCount, e.message);
  }
}

console.log(`${inlineCount} inline script(s), ${extCount} external script(s), ${bad} with syntax errors`);
process.exit(bad ? 1 : 0);
