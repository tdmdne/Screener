/* Public site URL and SEO copy — single source of truth.
 *
 * siteUrl is https://vektorterminal.com (no trailing slash). Canonical,
 * Open Graph, Twitter, JSON-LD and the robots.txt Sitemap line all
 * come from this value via `npm run sync-seo`.
 *
 * These search-facing URLs only match the live site once
 * vektorterminal.com is attached in Cloudflare Pages. Until then the
 * app is still served at https://screener-cso.pages.dev.
 *
 * Cutover when the domain is attached:
 *   1. Keep `siteUrl` as https://vektorterminal.com (or update it, then
 *      run `npm run sync-seo` so robots.txt, sitemap.xml, and the
 *      <!-- vt:seo-start --> … <!-- vt:seo-end --> block in index.html
 *      stay in sync).
 *   2. Add vektorterminal.com (and www if used) to this Pages project.
 *   3. 301-redirect https://screener-cso.pages.dev (and www, if used) to
 *      https://vektorterminal.com, preserving path and query. Pages has
 *      no built-in host redirect — use a Bulk Redirect rule, or a host
 *      check in a Worker / Pages Function.
 *   4. Keep the pages.dev host out of search results: the 301 is the
 *      primary signal. If a pages.dev or preview URL
 *      (<hash>.screener-cso.pages.dev) must stay reachable without a
 *      redirect, serve X-Robots-Tag: noindex on that host only.
 *      Do not noindex vektorterminal.com.
 *
 * Do not add an og:image path here until a real 1200×630 image exists.
 */
const VT_SITE = {
  siteUrl: "https://vektorterminal.com",
  name: "Vektor Terminal",
  title: "Vektor Terminal — Every market. One terminal.",
  description: "Charts, a multi-market screener, alerts, journal, heatmaps and backtesting for crypto, forex and stocks. Prices may be delayed. Not investment advice.",
  locale: "en",
  themeColor: "#0e0f12",
};

if (typeof window !== "undefined") window.VT_SITE = VT_SITE;
if (typeof module !== "undefined" && module.exports) module.exports = VT_SITE;
