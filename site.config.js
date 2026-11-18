/* Public site URL and SEO copy — single source of truth.
 *
 * Canonical, Open Graph, Twitter, JSON-LD and the robots.txt Sitemap
 * line all come from `siteUrl`, which is picked from the flag below
 * via `npm run sync-seo`.
 *
 * useCustomDomain is false until vektorterminal.com exists in DNS and
 * is attached in Cloudflare Pages. The live site URL is therefore
 * https://screener-cso.pages.dev.
 *
 * Cutover, once the domain resolves and is attached:
 *   1. Set `useCustomDomain: true` in this file (keep
 *      customDomain: "https://vektorterminal.com").
 *   2. Run `npm run sync-seo` so robots.txt, sitemap.xml, and the
 *      <!-- vt:seo-start --> … <!-- vt:seo-end --> block in index.html
 *      (canonical, og:url, JSON-LD url, Sitemap line) switch together.
 *   3. Add vektorterminal.com (and www if used) to this Pages project.
 *   4. 301-redirect https://screener-cso.pages.dev (and www, if used) to
 *      https://vektorterminal.com, preserving path and query. Pages has
 *      no built-in host redirect — use a Bulk Redirect rule, or a host
 *      check in a Worker / Pages Function.
 *   5. Keep the pages.dev host out of search results: the 301 is the
 *      primary signal. If a pages.dev or preview URL
 *      (<hash>.screener-cso.pages.dev) must stay reachable without a
 *      redirect, serve X-Robots-Tag: noindex on that host only.
 *      Do not noindex vektorterminal.com.
 *
 * Do not add an og:image path here until a real 1200×630 image exists.
 */
const VT_SITE = {
  customDomain: "https://vektorterminal.com",
  pagesDevUrl: "https://screener-cso.pages.dev",
  useCustomDomain: false,
  name: "Vektor Terminal",
  title: "Vektor Terminal — Every market. One terminal.",
  description: "Charts, a multi-market screener, alerts, journal, heatmaps and backtesting for crypto, forex and stocks. Prices may be delayed. Not investment advice.",
  locale: "en",
  themeColor: "#0e0f12",
};

if (typeof VT_SITE.useCustomDomain !== "boolean") {
  throw new Error("useCustomDomain must be a boolean");
}
VT_SITE.siteUrl = (VT_SITE.useCustomDomain ? VT_SITE.customDomain : VT_SITE.pagesDevUrl).replace(/\/+$/, "");

if (typeof window !== "undefined") window.VT_SITE = VT_SITE;
if (typeof module !== "undefined" && module.exports) module.exports = VT_SITE;
