// Pages middleware: public static-file ALLOWLIST.
//
// The Pages project has no build step and publishes the repo root, so without
// this every tracked file (AGENTS.md, worker.js, wrangler.toml, .env.example,
// functions/, worker/, tests/ ...) would be downloadable. This middleware uses an
// allowlist, not a denylist: a path is served only if it is on the list below;
// everything else gets a 404. New root files are therefore private by default.
//
// /api and /api/* are passed straight through to functions/api/[[path]].js.
//
// Cost note: Pages middleware is a Pages Function, so each request that reaches
// it counts toward the Workers Free plan's 100,000 requests/day. _routes.json
// excludes (by exact path, never wildcards) the files a page load fetches
// (/, /index.html, favicons, robots.txt, sitemap.xml and the three JS modules
// index.html imports) so those are served directly and do not count. /api/*,
// other src/ files and everything that 404s still run this code. To remove the
// middleware entirely later, switch to a build step that copies the allowlisted
// files into a public/ output directory (needs a Pages build-settings change).

export const PUBLIC_EXACT = new Set([
  "/",
  "/index.html",
  "/robots.txt",
  "/sitemap.xml",
  "/favicon.ico",
  "/favicon.svg",
  "/apple-touch-icon.png",
  // Optional market-data snapshot fetched by index.html (snapInit/snapTf) if published.
  "/data/manifest.json",
]);

export const PUBLIC_PATTERNS = [
  /^\/src\/[A-Za-z0-9_-]+\.(?:js|mjs|css)$/,
  /^\/shared\/[A-Za-z0-9_-]+\.(?:js|mjs)$/,
  /^\/data\/c_[A-Za-z0-9]+\.json$/,
];

const API_RE = /^\/api(?:\/|$)/;

function hasUnsafeChars(p) {
  if (/%2e/i.test(p)) return true;
  if (p.includes("..")) return true;
  if (p.includes("\\")) return true;
  if (p.includes("\0")) return true;
  return false;
}

/**
 * Classify a raw (undecoded) URL pathname.
 * @returns {"api"|true|false} "api" = pass to the API function,
 *   true = public static file, false = 404.
 */
export function isPublicPath(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return false;

  if (API_RE.test(pathname)) {
    if (hasUnsafeChars(pathname)) return false;
    if (pathname.split("/").some((s) => s.startsWith("."))) return false;
    return "api";
  }

  // Static files: no encoding at all, no backslashes/NULs, no empty segments,
  // no ".", "..", or dot-prefixed segments (dotfiles such as /.git, /.env*).
  if (pathname.includes("%") || hasUnsafeChars(pathname)) return false;
  if (pathname !== "/" && pathname.includes("//")) return false;
  const segs = pathname.split("/").slice(1);
  if (pathname !== "/" && segs.some((s) => s === "" || s.startsWith("."))) return false;

  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PATTERNS.some((re) => re.test(pathname));
}

export function notFound() {
  return new Response("Not found\n", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}

export async function onRequest(context) {
  const { pathname } = new URL(context.request.url);
  return isPublicPath(pathname) ? context.next() : notFound();
}
