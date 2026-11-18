#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const site = require(path.join(root, "site.config.js"));
const SITE_URL = site.siteUrl.replace(/\/+$/, "");
const origin = SITE_URL + "/";
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");

assert.match(site.siteUrl, /^https:\/\//, "siteUrl must be https");
assert.doesNotMatch(site.siteUrl, /\/$/, "siteUrl must have no trailing slash");
assert.ok(site.title && site.description && site.name, "title, description, name required");
assert.ok(site.description.length <= 170, "meta description should stay short");

assert.match(robots, /^User-agent: \*\nAllow: \/\nDisallow: \/api\/\nDisallow: \/ws\n/);
assert.equal([...robots.matchAll(/^Sitemap:/gm)].length, 1);
assert.ok(robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`), "robots.txt must reference the sitemap on SITE_URL");
assert.doesNotMatch(robots, /<!DOCTYPE html>/i);

assert.match(sitemap, /<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
assert.ok(sitemap.includes(`<loc>${origin}</loc>`), "sitemap must list the origin URL");
assert.doesNotMatch(sitemap, /#\//, "sitemap must not list hash routes");

const start = html.indexOf("<!-- vt:seo-start -->");
const end = html.indexOf("<!-- vt:seo-end -->");
assert.ok(start !== -1 && end > start, "index.html must contain the vt:seo block");
const block = html.slice(start, end);
assert.ok(block.includes(`<title>${site.title}</title>`));
assert.ok(block.includes(`content="${site.description}"`));
assert.ok(block.includes(`rel="canonical" href="${origin}"`));
assert.ok(block.includes(`property="og:title"`));
assert.ok(block.includes(`property="og:url" content="${origin}"`));
assert.ok(block.includes(`name="twitter:card" content="summary"`));
assert.ok(block.includes('type="application/ld+json"'));
assert.ok(!/property="og:image"/.test(block), "do not reference an og:image until one exists");
assert.ok((html.match(/<title>/gi) || []).length === 1, "exactly one <title> tag");

for (const file of ["favicon.svg", "favicon.ico", "apple-touch-icon.png"]) {
  const p = path.join(root, file);
  assert.ok(fs.existsSync(p) && fs.statSync(p).size > 0, `${file} must exist`);
}

const fav = fs.readFileSync(path.join(root, "favicon.svg"), "utf8");
assert.match(fav, /M2 2 L66 2 L132 120 L161 70 L223 70 L132 234 Z/);
assert.match(fav, /<svg\b/);

console.log("seo checks passed");
