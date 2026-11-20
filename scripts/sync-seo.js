#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const site = require(path.join(root, "site.config.js"));

function required(key) {
  const v = site[key];
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`site.config.js is missing a non-empty ${key}`);
  }
  return v.trim();
}

const SITE_URL = required("siteUrl").replace(/\/+$/, "");
const NAME = required("name");
const TITLE = required("title");
const DESCRIPTION = required("description");
const THEME = required("themeColor");

if (!/^https:\/\/[^/\s]+$/.test(SITE_URL)) {
  throw new Error(`siteUrl must be an https origin with no path, got: ${SITE_URL}`);
}

function xmlEscape(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attrEscape(s) {
  return xmlEscape(s).replace(/'/g, "&#39;");
}

const origin = SITE_URL + "/";
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: NAME,
  url: origin,
  description: DESCRIPTION,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web browser",
  inLanguage: site.locale || "en",
};

const OG_IMAGE = site.ogImage ? SITE_URL + (site.ogImage.startsWith("/") ? site.ogImage : "/" + site.ogImage) : "";

const headBlock =
  "<!-- vt:seo-start -->\n" +
  `<title>${xmlEscape(TITLE)}</title>\n` +
  `<meta name="description" content="${attrEscape(DESCRIPTION)}">\n` +
  `<link rel="canonical" href="${attrEscape(origin)}">\n` +
  `<meta property="og:type" content="website">\n` +
  `<meta property="og:site_name" content="${attrEscape(NAME)}">\n` +
  `<meta property="og:title" content="${attrEscape(TITLE)}">\n` +
  `<meta property="og:description" content="${attrEscape(DESCRIPTION)}">\n` +
  `<meta property="og:url" content="${attrEscape(origin)}">\n` +
  (OG_IMAGE
    ? `<meta property="og:image" content="${attrEscape(OG_IMAGE)}">\n` +
      `<meta property="og:image:width" content="1200">\n` +
      `<meta property="og:image:height" content="630">\n` +
      `<meta name="twitter:card" content="summary_large_image">\n` +
      `<meta name="twitter:image" content="${attrEscape(OG_IMAGE)}">\n`
    : `<meta name="twitter:card" content="summary">\n`) +
  `<meta name="twitter:title" content="${attrEscape(TITLE)}">\n` +
  `<meta name="twitter:description" content="${attrEscape(DESCRIPTION)}">\n` +
  `<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n` +
  `<link rel="icon" href="/favicon.ico" sizes="32x32">\n` +
  `<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n` +
  `<meta name="theme-color" content="${attrEscape(THEME)}">\n` +
  `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>\n` +
  "<!-- vt:seo-end -->";

const robots =
  "User-agent: *\n" +
  "Allow: /\n" +
  "Disallow: /api/\n" +
  "Disallow: /ws\n" +
  "\n" +
  `Sitemap: ${SITE_URL}/sitemap.xml\n`;

const sitemap =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  "  <url>\n" +
  `    <loc>${xmlEscape(origin)}</loc>\n` +
  "    <changefreq>weekly</changefreq>\n" +
  "    <priority>1.0</priority>\n" +
  "  </url>\n" +
  "</urlset>\n";

function writeIfChanged(file, content) {
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (prev === content) return false;
  fs.writeFileSync(file, content);
  return true;
}

const robotsPath = path.join(root, "robots.txt");
const sitemapPath = path.join(root, "sitemap.xml");
const htmlPath = path.join(root, "index.html");
let html = fs.readFileSync(htmlPath, "utf8");

const START = "<!-- vt:seo-start -->";
const END = "<!-- vt:seo-end -->";
const start = html.indexOf(START);
const end = html.indexOf(END);

if (start !== -1 && end !== -1 && end > start) {
  html = html.slice(0, start) + headBlock + html.slice(end + END.length);
} else if (start !== -1 || end !== -1) {
  throw new Error("index.html has a broken vt:seo-start / vt:seo-end pair");
} else {
  const titleRe = /<title>[\s\S]*?<\/title>\s*/i;
  if (!titleRe.test(html)) {
    throw new Error("index.html has no <title> tag to replace with the SEO block");
  }
  html = html.replace(titleRe, headBlock + "\n");
}

const changed = [];
if (writeIfChanged(robotsPath, robots)) changed.push("robots.txt");
if (writeIfChanged(sitemapPath, sitemap)) changed.push("sitemap.xml");
if (writeIfChanged(htmlPath, html)) changed.push("index.html");

if (changed.length) {
  console.log("Updated:", changed.join(", "));
} else {
  console.log("Already in sync with site.config.js");
}
