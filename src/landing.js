// src/landing.js — Vektor Terminal Landing, Products Dropdown & Dedicated Feature Pages.
// Pure ES module using strictly createElement / createElementNS + textContent (zero innerHTML, zero inline styles).

const SVG_NS = "http://www.w3.org/2000/svg";
const EMAIL_QUICK_RE = /^[A-Za-z0-9!*+\-=?^_.]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const HOME_HASHES = new Set(["#/landing", "#/waitlist", "#landing", "#waitlist"]);
const PRICING_HASHES = new Set(["#/pricing", "#pricing"]);

const WORKSPACE_TABS = [
  { id: "supercharts", label: "VektorCharts", chrome: "BTC/USDT · 15m · VektorCharts", slug: "supercharts" },
  { id: "screener", label: "Screener", chrome: "P1–P5 Multi-Asset Scanner", slug: "screener" },
  { id: "replay", label: "Bar Replay", chrome: "EUR/USD · 5m · Session Replay", slug: "replay" },
  { id: "journal", label: "Journal", chrome: "Executive Journal & Prop Limits", slug: "journal" },
];

const PRODUCTS = [
  {
    slug: "supercharts",
    name: "VektorCharts",
    shortDesc: "Fast multi-chart layouts with edge-computed indicators and clean drawing tools.",
    chrome: "BTC/USDT · 15m · VektorCharts",
    headline: "VektorCharts built for clarity",
    subhead: "Edge-computed candles, synchronized multi-chart layouts, and crisp drawing tools without browser lag.",
    tierNote: "Free core tier includes 3 charts, 3 indicators, and 3 alerts.",
    highlights: [
      {
        title: "Edge-computed series",
        body: "Candles and indicator overlays are calculated on Cloudflare's edge and delivered straight to the canvas.",
      },
      {
        title: "Synchronized layouts",
        body: "Link symbols and crosshairs across panes so higher-timeframe structure stays in view.",
      },
      {
        title: "Keyboard-first controls",
        body: "Switch tickers, timeframes, and drawing tools from the keyboard without digging through menus.",
      },
    ],
  },
  {
    slug: "screener",
    name: "Multi-Asset Screener",
    shortDesc: "Rank crypto, equities, FX, and metals across P1–P5 scores in one table.",
    chrome: "P1–P5 Multi-Asset Scanner",
    headline: "Multi-asset screening in one table",
    subhead: "Filter crypto, equities, FX, and metals side by side using the P1–P5 scoring matrix.",
    tierNote: "Unlimited P1–P5 screening is included on the Free core tier.",
    highlights: [
      {
        title: "Five-pillar scoring",
        body: "Every instrument is scored across trend, volatility, momentum, structure, and composite strength.",
      },
      {
        title: "Cross-asset coverage",
        body: "Compare crypto pairs, FX majors, metals, and equities inside one ranked workspace.",
      },
      {
        title: "Direct chart handoff",
        body: "Select any row to load that instrument immediately into your active chart layout.",
      },
    ],
  },
  {
    slug: "replay",
    name: "Bar Replay",
    shortDesc: "Step through past sessions candle by candle with simulated bracket orders.",
    chrome: "EUR/USD · 5m · Session Replay",
    headline: "Bar replay without lookahead bias",
    subhead: "Step through historical market sessions candle by candle with bracket orders and R-multiple logging.",
    tierNote: "Unlimited bar replay and backtesting are included on the Free core tier.",
    highlights: [
      {
        title: "Strict bar-by-bar reveal",
        body: "Future candles stay hidden until you step forward, keeping session practice honest.",
      },
      {
        title: "Simulated bracket orders",
        body: "Place entries with stop loss and take profit levels directly on the replay chart.",
      },
      {
        title: "Session breakdown",
        body: "Closed replay trades feed into your win rate, profit factor, and R-multiple log.",
      },
    ],
  },
  {
    slug: "journal",
    name: "Trade Journal",
    shortDesc: "Track equity curves, setup expectancy, and funded-account drawdown limits.",
    chrome: "Executive Journal & Prop Limits",
    headline: "Trade journal and prop guardrails",
    subhead: "Review your equity curve, setup expectancy, and daily drawdown rules in one calm ledger.",
    tierNote: "Unlimited trade journaling is included on the Free core tier.",
    highlights: [
      {
        title: "Funded-account guardrails",
        body: "Monitor daily and trailing drawdown against your prop rules before placing the next order.",
      },
      {
        title: "Daily PnL calendar",
        body: "Spot consistency streaks and losing-day clusters across the month at a glance.",
      },
      {
        title: "Setup expectancy",
        body: "Measure profit factor and average R-multiple by setup tag instead of relying on memory.",
      },
    ],
  },
  {
    slug: "heatmap",
    name: "Market Heatmaps",
    shortDesc: "Read sector rotation and relative strength at a glance across asset classes.",
    chrome: "Multi-Asset Sector Heatmap · 24h",
    headline: "Market heatmaps at a glance",
    subhead: "Track sector rotation, breadth, and relative strength across crypto, equities, metals, and FX.",
    tierNote: "Unlimited market heatmaps are included on the Free core tier.",
    highlights: [
      {
        title: "Weighted sector blocks",
        body: "Tile sizing reflects relative weight so market leaders stand out right away.",
      },
      {
        title: "Calibrated color scale",
        body: "Restrained green and red tones show directional conviction without visual glare.",
      },
      {
        title: "One-click drilldown",
        body: "Move from any active sector block straight into the screener or chart view.",
      },
    ],
  },
  {
    slug: "vektor-script",
    name: "Vektor Script",
    shortDesc: "Run custom indicators and strategies on the edge with deterministic bar output.",
    chrome: "Vektor Script v1 · Edge Sandbox",
    headline: "Deterministic edge scripting",
    subhead: "Write custom indicators and strategies that run on the edge with reproducible bar-by-bar output.",
    tierNote: "Free core tier includes 3 indicators and 3 alerts.",
    highlights: [
      {
        title: "Sandboxed edge runtime",
        body: "Scripts run server-side in isolated workers so your browser stays responsive.",
      },
      {
        title: "No client-side drift",
        body: "Live charts, alerts, and replays evaluate the exact same bar series.",
      },
      {
        title: "Clean strategy output",
        body: "Plot overlays, emit alerts, and inspect deterministic bar logs from one script.",
      },
    ],
  },
];

const PRODUCT_BY_SLUG = new Map(PRODUCTS.map((p) => [p.slug, p]));

// Structural preview fixtures (static UI demonstration, zero external fetches)
const CHART_BARS = [
  [84, 92, 79, 89], [89, 96, 86, 94], [94, 99, 88, 91], [91, 95, 85, 87],
  [87, 94, 84, 93], [93, 102, 91, 100], [100, 106, 97, 103], [103, 108, 98, 99],
  [99, 104, 94, 96], [96, 103, 95, 102], [102, 111, 100, 109], [109, 116, 106, 114],
  [114, 118, 109, 111], [111, 115, 107, 113], [113, 121, 112, 119], [119, 125, 116, 123],
  [123, 128, 118, 120], [120, 124, 115, 118], [118, 126, 117, 125], [125, 132, 123, 130],
  [130, 136, 127, 134], [134, 139, 130, 132], [132, 138, 129, 137], [137, 144, 135, 142],
];

const WATCHLIST_ROWS = [
  { sym: "BTC/USDT", venue: "Binance", price: "94,280.50", chg: "+2.41%", up: true, active: true },
  { sym: "ETH/USDT", venue: "Binance", price: "3,418.20", chg: "+1.84%", up: true },
  { sym: "SOL/USDT", venue: "Binance", price: "214.65", chg: "-0.72%", up: false },
  { sym: "EUR/USD", venue: "FX Spot", price: "1.08420", chg: "+0.18%", up: true },
  { sym: "XAU/USD", venue: "Metals", price: "2,642.80", chg: "+0.64%", up: true },
  { sym: "NVDA", venue: "NASDAQ", price: "142.30", chg: "-0.45%", up: false },
];

const SCREENER_ROWS = [
  { sym: "BTC/USDT", cls: "Crypto", price: "94,280.50", chg: "+2.41%", up: true, p1: "92", p2: "84", p3: "88", p4: "91", p5: "89", sig: "Breakout", tone: "up" },
  { sym: "XAU/USD", cls: "Metals", price: "2,642.80", chg: "+0.64%", up: true, p1: "87", p2: "71", p3: "82", p4: "86", p5: "84", sig: "Trend", tone: "up" },
  { sym: "ETH/USDT", cls: "Crypto", price: "3,418.20", chg: "+1.84%", up: true, p1: "81", p2: "79", p3: "85", p4: "78", p5: "81", sig: "Expansion", tone: "up" },
  { sym: "EUR/USD", cls: "FX", price: "1.08420", chg: "+0.18%", up: true, p1: "64", p2: "52", p3: "61", p4: "68", p5: "62", sig: "Range", tone: "neutral" },
  { sym: "NVDA", cls: "Equity", price: "142.30", chg: "-0.45%", up: false, p1: "58", p2: "69", p3: "47", p4: "54", p5: "56", sig: "Pullback", tone: "neutral" },
  { sym: "SOL/USDT", cls: "Crypto", price: "214.65", chg: "-0.72%", up: false, p1: "41", p2: "74", p3: "38", p4: "44", p5: "46", sig: "Distribution", tone: "down" },
];

const JOURNAL_DAYS = [
  { day: "03", val: "+$840", state: "up" },
  { day: "04", val: "+$410", state: "up" },
  { day: "05", val: "-$290", state: "down" },
  { day: "06", val: "+$1,120", state: "up" },
  { day: "07", val: "$0", state: "flat" },
  { day: "10", val: "+$620", state: "up" },
  { day: "11", val: "-$180", state: "down" },
  { day: "12", val: "+$950", state: "up" },
  { day: "13", val: "+$530", state: "up" },
  { day: "14", val: "+$770", state: "up" },
];

const HEATMAP_SECTORS = [
  {
    name: "Crypto Majors",
    span: "vl-hm-sector-wide",
    tiles: [
      { sym: "BTC", chg: "+2.41%", tone: "up-strong", size: "vl-hm-tile-lg" },
      { sym: "ETH", chg: "+1.84%", tone: "up-mid", size: "vl-hm-tile-md" },
      { sym: "SOL", chg: "-0.72%", tone: "down-soft", size: "vl-hm-tile-sm" },
      { sym: "AVAX", chg: "+1.12%", tone: "up-soft", size: "vl-hm-tile-sm" },
    ],
  },
  {
    name: "US Large-Cap Tech",
    span: "vl-hm-sector-wide",
    tiles: [
      { sym: "MSFT", chg: "+0.94%", tone: "up-soft", size: "vl-hm-tile-lg" },
      { sym: "NVDA", chg: "-0.45%", tone: "down-soft", size: "vl-hm-tile-md" },
      { sym: "AAPL", chg: "+0.38%", tone: "up-soft", size: "vl-hm-tile-sm" },
      { sym: "META", chg: "-1.18%", tone: "down-mid", size: "vl-hm-tile-sm" },
    ],
  },
  {
    name: "Metals & Energy",
    span: "vl-hm-sector-half",
    tiles: [
      { sym: "XAU", chg: "+0.64%", tone: "up-soft", size: "vl-hm-tile-md" },
      { sym: "XAG", chg: "+1.42%", tone: "up-mid", size: "vl-hm-tile-sm" },
      { sym: "WTI", chg: "-0.88%", tone: "down-soft", size: "vl-hm-tile-sm" },
    ],
  },
  {
    name: "FX Majors",
    span: "vl-hm-sector-half",
    tiles: [
      { sym: "EUR/USD", chg: "+0.18%", tone: "up-soft", size: "vl-hm-tile-md" },
      { sym: "GBP/USD", chg: "+0.26%", tone: "up-soft", size: "vl-hm-tile-sm" },
      { sym: "USD/JPY", chg: "-0.34%", tone: "down-soft", size: "vl-hm-tile-sm" },
    ],
  },
];

const SCRIPT_LINES = [
  { num: "01", tokens: [{ cls: "vl-tok-kw", t: "indicator" }, { cls: "", t: '("P1 Trend Pullback", overlay=' }, { cls: "vl-tok-lit", t: "true" }, { cls: "", t: ")" }] },
  { num: "02", tokens: [{ cls: "vl-tok-kw", t: "const" }, { cls: "", t: " fast = " }, { cls: "vl-tok-fn", t: "ema" }, { cls: "", t: "(close, " }, { cls: "vl-tok-lit", t: "20" }, { cls: "", t: ")" }] },
  { num: "03", tokens: [{ cls: "vl-tok-kw", t: "const" }, { cls: "", t: " slow = " }, { cls: "vl-tok-fn", t: "ema" }, { cls: "", t: "(close, " }, { cls: "vl-tok-lit", t: "50" }, { cls: "", t: ")" }] },
  { num: "04", tokens: [{ cls: "vl-tok-kw", t: "const" }, { cls: "", t: " trendUp = fast > slow " }, { cls: "vl-tok-kw", t: "and" }, { cls: "", t: " low <= fast" }] },
  { num: "05", tokens: [{ cls: "vl-tok-kw", t: "const" }, { cls: "", t: " entry = trendUp " }, { cls: "vl-tok-kw", t: "and" }, { cls: "", t: " close > open" }] },
  { num: "06", tokens: [{ cls: "vl-tok-fn", t: "plot" }, { cls: "", t: "(fast, color=" }, { cls: "vl-tok-str", t: '"#f59e0b"' }, { cls: "", t: ")" }] },
  { num: "07", tokens: [{ cls: "vl-tok-fn", t: "alertcondition" }, { cls: "", t: "(entry, title=" }, { cls: "vl-tok-str", t: '"Pullback Long"' }, { cls: "", t: ")" }] },
];

// ---------------------------------------------------------------------------
// Pure DOM Helpers (createElement / createElementNS + textContent only)
// ---------------------------------------------------------------------------

function el(tag, attrs = null, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "className") {
        node.className = v;
      } else if (k === "text") {
        node.textContent = v;
      } else if (k === "dataset" && typeof v === "object") {
        for (const [dk, dv] of Object.entries(v)) {
          node.dataset[dk] = String(dv);
        }
      } else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v === true) {
        node.setAttribute(k, "");
      } else {
        node.setAttribute(k, String(v));
      }
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === "string" || typeof child === "number") {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

function svgEl(tag, attrs = null, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue;
      node.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === "string" || typeof child === "number") {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

function clearNode(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function buildBrandMark() {
  return svgEl(
    "svg",
    {
      class: "vl-brand-mark",
      width: "24",
      height: "24",
      viewBox: "0 0 24 24",
      fill: "none",
      "aria-hidden": "true",
    },
    svgEl("rect", {
      x: "1",
      y: "1",
      width: "22",
      height: "22",
      rx: "5",
      fill: "#0f141e",
      stroke: "rgba(255,255,255,0.16)",
      "stroke-width": "1",
    }),
    svgEl("path", {
      d: "M6.5 7.2L12 17.4L17.5 7.2",
      stroke: "#f4f6fa",
      "stroke-width": "2",
      "stroke-linecap": "square",
      "stroke-linejoin": "miter",
    }),
    svgEl("line", {
      x1: "12",
      y1: "7",
      x2: "12",
      y2: "11.5",
      stroke: "#9aa4b4",
      "stroke-width": "1.6",
    })
  );
}

function buildChevronSvg() {
  return svgEl(
    "svg",
    {
      class: "vl-chevron",
      width: "12",
      height: "12",
      viewBox: "0 0 12 12",
      fill: "none",
      "aria-hidden": "true",
    },
    svgEl("path", {
      d: "M3 4.5L6 7.5L9 4.5",
      stroke: "currentColor",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    })
  );
}

function buildProductIcon(slug) {
  const base = {
    class: "vl-prod-svg",
    width: "16",
    height: "16",
    viewBox: "0 0 16 16",
    fill: "none",
    "aria-hidden": "true",
  };
  switch (slug) {
    case "supercharts":
      return svgEl(
        "svg",
        base,
        svgEl("line", { x1: "4", y1: "3", x2: "4", y2: "13", stroke: "currentColor", "stroke-width": "1.2" }),
        svgEl("rect", { x: "2.5", y: "5.5", width: "3", height: "4.5", rx: "0.6", fill: "currentColor" }),
        svgEl("line", { x1: "8.5", y1: "2", x2: "8.5", y2: "12", stroke: "currentColor", "stroke-width": "1.2" }),
        svgEl("rect", { x: "7", y: "4", width: "3", height: "5", rx: "0.6", fill: "currentColor" }),
        svgEl("line", { x1: "13", y1: "4", x2: "13", y2: "14", stroke: "currentColor", "stroke-width": "1.2" }),
        svgEl("rect", { x: "11.5", y: "6.5", width: "3", height: "4", rx: "0.6", fill: "currentColor" })
      );
    case "screener":
      return svgEl(
        "svg",
        base,
        svgEl("rect", { x: "2", y: "2.5", width: "12", height: "11", rx: "1.5", stroke: "currentColor", "stroke-width": "1.2" }),
        svgEl("line", { x1: "2", y1: "6", x2: "14", y2: "6", stroke: "currentColor", "stroke-width": "1.2" }),
        svgEl("line", { x1: "6.5", y1: "6", x2: "6.5", y2: "13.5", stroke: "currentColor", "stroke-width": "1.2" }),
        svgEl("line", { x1: "2", y1: "9.8", x2: "14", y2: "9.8", stroke: "currentColor", "stroke-width": "1.1" })
      );
    case "replay":
      return svgEl(
        "svg",
        base,
        svgEl("path", { d: "M3 4.5V11.5", stroke: "currentColor", "stroke-width": "1.4", "stroke-linecap": "round" }),
        svgEl("path", { d: "M6.5 4.2L12.5 8L6.5 11.8V4.2Z", stroke: "currentColor", "stroke-width": "1.3", "stroke-linejoin": "round" })
      );
    case "journal":
      return svgEl(
        "svg",
        base,
        svgEl("rect", { x: "2.5", y: "2", width: "11", height: "12", rx: "1.5", stroke: "currentColor", "stroke-width": "1.2" }),
        svgEl("path", { d: "M5 10.5L7.2 8.2L9.2 9.5L11.5 6.2", stroke: "currentColor", "stroke-width": "1.3", "stroke-linecap": "round", "stroke-linejoin": "round" })
      );
    case "heatmap":
      return svgEl(
        "svg",
        base,
        svgEl("rect", { x: "2", y: "2", width: "6.5", height: "6.5", rx: "1", stroke: "currentColor", "stroke-width": "1.2" }),
        svgEl("rect", { x: "10", y: "2", width: "4", height: "6.5", rx: "1", stroke: "currentColor", "stroke-width": "1.2" }),
        svgEl("rect", { x: "2", y: "10", width: "4", height: "4", rx: "1", stroke: "currentColor", "stroke-width": "1.2" }),
        svgEl("rect", { x: "7.5", y: "10", width: "6.5", height: "4", rx: "1", stroke: "currentColor", "stroke-width": "1.2" })
      );
    case "vektor-script":
    default:
      return svgEl(
        "svg",
        base,
        svgEl("path", { d: "M5.5 4.5L2.5 8L5.5 11.5", stroke: "currentColor", "stroke-width": "1.3", "stroke-linecap": "round", "stroke-linejoin": "round" }),
        svgEl("path", { d: "M10.5 4.5L13.5 8L10.5 11.5", stroke: "currentColor", "stroke-width": "1.3", "stroke-linecap": "round", "stroke-linejoin": "round" }),
        svgEl("line", { x1: "9", y1: "3.5", x2: "7", y2: "12.5", stroke: "currentColor", "stroke-width": "1.2", "stroke-linecap": "round" })
      );
  }
}

// ---------------------------------------------------------------------------
// Route Parser
// ---------------------------------------------------------------------------

function parseLandingRoute(rawHash) {
  const hash = (rawHash || "").trim().toLowerCase();
  if (HOME_HASHES.has(hash)) {
    return { view: "home", section: null };
  }
  if (PRICING_HASHES.has(hash)) {
    return { view: "home", section: "pricing" };
  }
  const match = hash.match(/^#\/?(?:features|products)\/([a-z0-9-]+)$/);
  if (match) {
    const rawSlug = match[1] === "vektorcharts" ? "supercharts" : match[1];
    if (PRODUCT_BY_SLUG.has(rawSlug)) {
      return { view: "feature", slug: rawSlug };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Focused Visual Preview Builders (all 6 core products)
// ---------------------------------------------------------------------------

function buildCandlestickSvg(bars, { splitIndex = null, showOrderLines = false } = {}) {
  const width = 680;
  const height = 320;
  const padL = 14;
  const padR = 58;
  const padT = 18;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const minP = 74;
  const maxP = 148;
  const mapY = (p) => padT + ((maxP - p) / (maxP - minP)) * plotH;
  const stepX = plotW / bars.length;

  const svg = svgEl("svg", {
    class: "vl-chart-svg",
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": showOrderLines ? "Bar replay candlestick chart" : "VektorCharts candlestick chart",
  });

  const levels = [80, 96, 112, 128, 144];
  for (const lv of levels) {
    const y = mapY(lv);
    svg.appendChild(
      svgEl("line", {
        x1: padL,
        y1: y.toFixed(1),
        x2: width - padR,
        y2: y.toFixed(1),
        stroke: "rgba(255,255,255,0.05)",
        "stroke-width": "1",
      })
    );
    svg.appendChild(
      svgEl(
        "text",
        {
          x: width - padR + 8,
          y: (y + 3.5).toFixed(1),
          fill: "#7c879b",
          "font-size": "10",
          "font-family": "JetBrains Mono, monospace",
        },
        showOrderLines ? `1.0${(800 + lv * 2).toString()}` : `${(89000 + lv * 38).toLocaleString("en-US")}`
      )
    );
  }

  const emaPts = bars.map((b, i) => {
    const x = padL + stepX * i + stepX * 0.5;
    const avg = (b[0] + b[3]) * 0.5 - 3;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${mapY(avg).toFixed(1)}`;
  });
  svg.appendChild(
    svgEl("path", {
      d: emaPts.join(" "),
      fill: "none",
      stroke: "rgba(245, 158, 11, 0.78)",
      "stroke-width": "1.5",
    })
  );

  bars.forEach((b, i) => {
    const [o, h, l, c] = b;
    const up = c >= o;
    const cx = padL + stepX * i + stepX * 0.5;
    const candleW = Math.max(6, stepX * 0.52);
    const color = up ? "#10b981" : "#ef4444";
    const dimmed = splitIndex !== null && i > splitIndex;
    const opacity = dimmed ? "0.14" : "1";

    const volH = Math.max(8, (h - l) * 2.2);
    svg.appendChild(
      svgEl("rect", {
        x: (cx - candleW / 2).toFixed(1),
        y: (height - padB - volH).toFixed(1),
        width: candleW.toFixed(1),
        height: volH.toFixed(1),
        fill: up ? "rgba(16, 185, 129, 0.18)" : "rgba(239, 68, 68, 0.16)",
        opacity,
      })
    );

    svg.appendChild(
      svgEl("line", {
        x1: cx.toFixed(1),
        y1: mapY(h).toFixed(1),
        x2: cx.toFixed(1),
        y2: mapY(l).toFixed(1),
        stroke: color,
        "stroke-width": "1.2",
        opacity,
      })
    );

    const topY = mapY(Math.max(o, c));
    const botY = mapY(Math.min(o, c));
    svg.appendChild(
      svgEl("rect", {
        x: (cx - candleW / 2).toFixed(1),
        y: topY.toFixed(1),
        width: candleW.toFixed(1),
        height: Math.max(2, botY - topY).toFixed(1),
        rx: "1",
        fill: color,
        opacity,
      })
    );
  });

  if (splitIndex !== null) {
    const cutX = padL + stepX * (splitIndex + 1);
    svg.appendChild(
      svgEl("line", {
        x1: cutX.toFixed(1),
        y1: padT,
        x2: cutX.toFixed(1),
        y2: height - padB,
        stroke: "#9aa4b4",
        "stroke-width": "1.2",
        "stroke-dasharray": "4 3",
      })
    );
  }

  if (showOrderLines) {
    const tpY = mapY(134);
    const entryY = mapY(112);
    const slY = mapY(101);
    svg.appendChild(
      svgEl("line", { x1: padL, y1: tpY, x2: width - padR, y2: tpY, stroke: "#10b981", "stroke-width": "1", "stroke-dasharray": "3 3" })
    );
    svg.appendChild(
      svgEl("line", { x1: padL, y1: entryY, x2: width - padR, y2: entryY, stroke: "#e2e8f0", "stroke-width": "1" })
    );
    svg.appendChild(
      svgEl("line", { x1: padL, y1: slY, x2: width - padR, y2: slY, stroke: "#ef4444", "stroke-width": "1", "stroke-dasharray": "3 3" })
    );
  }

  return svg;
}

function buildSuperchartsView() {
  const ohlc = el(
    "div",
    { className: "vl-chart-ohlc vl-num" },
    el("span", { text: "O 93,810.0" }),
    el("span", { text: "H 94,412.5" }),
    el("span", { text: "L 93,640.0" }),
    el("span", { className: "vl-up", text: "C 94,280.5 (+2.41%)" })
  );

  const mainPane = el(
    "div",
    { className: "vl-chart-main" },
    el(
      "div",
      { className: "vl-chart-topbar" },
      el(
        "div",
        { className: "vl-chart-symbol" },
        el("span", { className: "vl-chart-ticker", text: "BTC/USDT" }),
        el("span", { className: "vl-chart-tf vl-num", text: "15m · EMA 20 · VOL" })
      ),
      ohlc
    ),
    el("div", { className: "vl-chart-canvas" }, buildCandlestickSvg(CHART_BARS))
  );

  const watchList = el(
    "ul",
    { className: "vl-watch-list" },
    ...WATCHLIST_ROWS.map((row) =>
      el(
        "li",
        { className: row.active ? "vl-watch-row vl-watch-active" : "vl-watch-row" },
        el(
          "div",
          null,
          el("div", { className: "vl-watch-sym", text: row.sym }),
          el("div", { className: "vl-watch-sub", text: row.venue })
        ),
        el(
          "div",
          { className: "vl-watch-right vl-num" },
          el("div", { className: "vl-watch-price", text: row.price }),
          el("div", {
            className: row.up ? "vl-watch-chg vl-up" : "vl-watch-chg vl-down",
            text: row.chg,
          })
        )
      )
    )
  );

  const sidebar = el(
    "aside",
    { className: "vl-chart-sidebar", "aria-label": "Watchlist preview" },
    el("div", { className: "vl-side-head", text: "Watchlist" }),
    watchList
  );

  return el("div", { className: "vl-chart-layout" }, mainPane, sidebar);
}

function buildScreenerView() {
  const thead = el(
    "thead",
    null,
    el(
      "tr",
      null,
      el("th", { text: "Instrument" }),
      el("th", { text: "Last" }),
      el("th", { text: "24h" }),
      el("th", { text: "P1 Trend" }),
      el("th", { text: "P2 Vol" }),
      el("th", { text: "P3 Mom" }),
      el("th", { text: "P4 Struct" }),
      el("th", { text: "P5 Score" }),
      el("th", { text: "State" })
    )
  );

  const tbody = el(
    "tbody",
    null,
    ...SCREENER_ROWS.map((r) =>
      el(
        "tr",
        null,
        el(
          "td",
          null,
          el(
            "span",
            { className: "vl-asset-cell" },
            el("strong", { text: r.sym }),
            el("span", { className: "vl-asset-tag", text: r.cls })
          )
        ),
        el("td", { className: "vl-num", text: r.price }),
        el("td", { className: r.up ? "vl-num vl-up" : "vl-num vl-down", text: r.chg }),
        el("td", { className: "vl-num", text: r.p1 }),
        el("td", { className: "vl-num", text: r.p2 }),
        el("td", { className: "vl-num", text: r.p3 }),
        el("td", { className: "vl-num", text: r.p4 }),
        el("td", { className: "vl-num", text: r.p5 }),
        el(
          "td",
          null,
          el("span", {
            className: `vl-pill vl-pill-${r.tone}`,
            text: r.sig,
          })
        )
      )
    )
  );

  return el("div", { className: "vl-table-wrap" }, el("table", { className: "vl-table" }, thead, tbody));
}

function buildReplayView() {
  const bar = el(
    "div",
    { className: "vl-replay-bar" },
    el(
      "div",
      { className: "vl-replay-controls" },
      el("span", { className: "vl-replay-chip", text: "Step -1" }),
      el("span", { className: "vl-replay-chip vl-replay-chip-active", text: "Playing · 5x" }),
      el("span", { className: "vl-replay-chip", text: "Step +1" })
    ),
    el("span", { className: "vl-num", text: "Session 2026-09-14 · Bar 17 / 24" })
  );

  const kv = (label, value, cls = "") =>
    el(
      "div",
      { className: "vl-kv" },
      el("span", { className: "vl-kv-label", text: label }),
      el("span", { className: `vl-num ${cls}`.trim(), text: value })
    );

  const ticket = el(
    "aside",
    { className: "vl-replay-ticket", "aria-label": "Simulated order ticket" },
    el("div", { className: "vl-side-head vl-side-head-flush", text: "Simulated Position" }),
    kv("Side", "LONG 2.00", "vl-up"),
    kv("Entry", "1.08240"),
    kv("Stop Loss", "1.08020", "vl-down"),
    kv("Take Profit", "1.08768", "vl-up"),
    kv("Open PnL", "+$840.00", "vl-up"),
    kv("R-Multiple", "+2.40R", "vl-up")
  );

  const body = el(
    "div",
    { className: "vl-replay-body" },
    el(
      "div",
      { className: "vl-replay-chart" },
      buildCandlestickSvg(CHART_BARS, { splitIndex: 16, showOrderLines: true })
    ),
    ticket
  );

  return el("div", { className: "vl-replay-layout" }, bar, body);
}

function buildJournalView() {
  const equitySvg = svgEl(
    "svg",
    {
      class: "vl-equity-svg",
      viewBox: "0 0 460 150",
      role: "img",
      "aria-label": "Account equity curve",
    },
    svgEl("line", { x1: "0", y1: "35", x2: "460", y2: "35", stroke: "rgba(255,255,255,0.05)" }),
    svgEl("line", { x1: "0", y1: "80", x2: "460", y2: "80", stroke: "rgba(255,255,255,0.05)" }),
    svgEl("line", { x1: "0", y1: "125", x2: "460", y2: "125", stroke: "rgba(255,255,255,0.05)" }),
    svgEl("path", {
      d: "M 0 128 L 46 116 L 92 121 L 138 98 L 184 92 L 230 101 L 276 74 L 322 62 L 368 68 L 414 40 L 460 22",
      fill: "none",
      stroke: "#10b981",
      "stroke-width": "2",
    })
  );

  const statBox = (label, value, cls = "") =>
    el(
      "div",
      { className: "vl-stat-box" },
      el("div", { className: "vl-stat-label", text: label }),
      el("div", { className: `vl-stat-val vl-num ${cls}`.trim(), text: value })
    );

  const left = el(
    "div",
    { className: "vl-journal-left" },
    el(
      "div",
      { className: "vl-stat-strip" },
      statBox("Net PnL", "+$4,770", "vl-up"),
      statBox("Profit Factor", "2.18"),
      statBox("Expectancy", "+0.42R", "vl-up")
    ),
    equitySvg
  );

  const meter = (label, readout, widthClass) =>
    el(
      "div",
      { className: "vl-meter-group" },
      el(
        "div",
        { className: "vl-meter-head" },
        el("span", { text: label }),
        el("span", { className: "vl-num", text: readout })
      ),
      el(
        "div",
        { className: "vl-meter-track" },
        el("div", { className: `vl-meter-fill ${widthClass}` })
      )
    );

  const calendar = el(
    "div",
    { className: "vl-cal-grid" },
    ...JOURNAL_DAYS.map((d) =>
      el(
        "div",
        {
          className:
            d.state === "up"
              ? "vl-cal-cell vl-cal-up vl-num"
              : d.state === "down"
                ? "vl-cal-cell vl-cal-down vl-num"
                : "vl-cal-cell vl-num",
        },
        el("div", { className: "vl-cal-day", text: d.day }),
        el("div", { text: d.val })
      )
    )
  );

  const right = el(
    "div",
    { className: "vl-journal-right" },
    el("div", { className: "vl-side-head vl-side-head-compact", text: "Prop Account Guardrails" }),
    meter("Daily drawdown", "0.62% / 5.00%", "vl-meter-w-12"),
    meter("Max drawdown", "1.84% / 10.00%", "vl-meter-w-18"),
    el("div", { className: "vl-side-head vl-side-head-spaced", text: "Daily PnL Calendar" }),
    calendar
  );

  return el("div", { className: "vl-journal-layout" }, left, right);
}

function buildHeatmapView() {
  const sectors = HEATMAP_SECTORS.map((sector) =>
    el(
      "div",
      { className: `vl-hm-sector ${sector.span}` },
      el("div", { className: "vl-hm-sector-head", text: sector.name }),
      el(
        "div",
        { className: "vl-hm-tiles" },
        ...sector.tiles.map((tile) =>
          el(
            "div",
            { className: `vl-hm-tile vl-hm-${tile.tone} ${tile.size}` },
            el("span", { className: "vl-hm-sym", text: tile.sym }),
            el("span", { className: "vl-hm-chg vl-num", text: tile.chg })
          )
        )
      )
    )
  );

  return el("div", { className: "vl-hm-grid" }, ...sectors);
}

function buildScriptView() {
  const codeLines = SCRIPT_LINES.map((line) =>
    el(
      "div",
      { className: "vl-code-line" },
      el("span", { className: "vl-code-num vl-num", text: line.num }),
      el(
        "code",
        { className: "vl-code-text vl-num" },
        ...line.tokens.map((tok) => (tok.cls ? el("span", { className: tok.cls, text: tok.t }) : tok.t))
      )
    )
  );

  const editor = el(
    "div",
    { className: "vl-script-editor" },
    el("div", { className: "vl-side-head", text: "trend_pullback.vs" }),
    el("div", { className: "vl-code-body" }, ...codeLines)
  );

  const kv = (label, value, cls = "") =>
    el(
      "div",
      { className: "vl-kv" },
      el("span", { className: "vl-kv-label", text: label }),
      el("span", { className: `vl-num ${cls}`.trim(), text: value })
    );

  const signalSvg = svgEl(
    "svg",
    {
      class: "vl-script-svg",
      viewBox: "0 0 240 84",
      role: "img",
      "aria-label": "Deterministic signal output plot",
    },
    svgEl("line", { x1: "0", y1: "42", x2: "240", y2: "42", stroke: "rgba(255,255,255,0.06)" }),
    svgEl("path", {
      d: "M 0 64 L 30 56 L 60 60 L 90 42 L 120 48 L 150 30 L 180 34 L 210 18 L 240 12",
      fill: "none",
      stroke: "#e2e8f0",
      "stroke-width": "1.8",
    }),
    svgEl("circle", { cx: "90", cy: "42", r: "3.5", fill: "#10b981" }),
    svgEl("circle", { cx: "150", cy: "30", r: "3.5", fill: "#10b981" }),
    svgEl("circle", { cx: "210", cy: "18", r: "3.5", fill: "#10b981" })
  );

  const output = el(
    "aside",
    { className: "vl-script-output", "aria-label": "Edge execution telemetry" },
    el("div", { className: "vl-side-head vl-side-head-flush", text: "Edge Runtime Output" }),
    kv("Execution", "Edge Isolate"),
    kv("Eval Latency", "4.2 ms", "vl-up"),
    kv("Bars Processed", "1,500"),
    kv("Signals Emitted", "3 Long", "vl-up"),
    kv("Lookahead Bias", "0 bars"),
    el("div", { className: "vl-script-plot-wrap" }, signalSvg)
  );

  return el("div", { className: "vl-script-layout" }, editor, output);
}

function renderFeaturePreview(slug) {
  switch (slug) {
    case "screener":
      return buildScreenerView();
    case "replay":
      return buildReplayView();
    case "journal":
      return buildJournalView();
    case "heatmap":
      return buildHeatmapView();
    case "vektor-script":
      return buildScriptView();
    case "supercharts":
    default:
      return buildSuperchartsView();
  }
}

function buildTerminalFrame(chromeTitle, previewNode, { titleElRef = null, stageElRef = null, panelId = null, labelledBy = null } = {}) {
  const titleSpan = el("span", { className: "vl-chrome-title", text: chromeTitle });
  if (titleElRef) titleElRef.current = titleSpan;

  const stageAttrs = { className: "vl-frame-stage" };
  if (panelId) {
    stageAttrs.id = panelId;
    stageAttrs.role = "tabpanel";
  }
  if (labelledBy) {
    stageAttrs["aria-labelledby"] = labelledBy;
  }

  const stage = el("div", stageAttrs, previewNode);
  if (stageElRef) stageElRef.current = stage;

  return el(
    "div",
    { className: "vl-frame" },
    el(
      "div",
      { className: "vl-frame-chrome" },
      el(
        "div",
        { className: "vl-chrome-left" },
        el(
          "span",
          { className: "vl-chrome-dots", "aria-hidden": "true" },
          el("span", { className: "vl-chrome-dot" }),
          el("span", { className: "vl-chrome-dot" }),
          el("span", { className: "vl-chrome-dot" })
        ),
        titleSpan
      ),
      el(
        "div",
        { className: "vl-chrome-meta vl-num" },
        el("span", { text: "EDGE < 300ms" }),
        el("span", { text: "UTC 14:30" })
      )
    ),
    stage
  );
}

// ---------------------------------------------------------------------------
// Reusable Waitlist Form Builder
// ---------------------------------------------------------------------------

function buildWaitlistForm({ idPrefix, source }) {
  let submitting = false;

  const input = el("input", {
    id: `${idPrefix}-email`,
    className: "vl-waitlist-input",
    type: "email",
    name: "email",
    autocomplete: "email",
    inputmode: "email",
    spellcheck: "false",
    required: true,
    placeholder: "name@desk.com",
    "aria-label": "Email address for waitlist",
    "aria-describedby": `${idPrefix}-feedback`,
  });

  const submitBtn = el("button", {
    type: "submit",
    className: "vl-btn vl-btn-primary vl-waitlist-submit",
    text: "Join Waitlist",
  });

  const feedback = el("p", {
    id: `${idPrefix}-feedback`,
    className: "vl-waitlist-feedback",
    role: "status",
    "aria-live": "polite",
  });

  const setFeedback = (state, message) => {
    feedback.dataset.state = state;
    feedback.textContent = message;
  };

  const form = el(
    "form",
    {
      className: "vl-waitlist-form",
      novalidate: true,
      onSubmit: async (event) => {
        event.preventDefault();
        if (submitting) return;

        const raw = input.value.trim();
        if (!raw || !EMAIL_QUICK_RE.test(raw)) {
          setFeedback("error", "Enter a valid email address, like name@desk.com.");
          input.focus();
          return;
        }

        submitting = true;
        submitBtn.disabled = true;
        submitBtn.textContent = "Joining...";
        setFeedback("idle", "");

        try {
          const response = await fetch("/api/waitlist", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: raw, source }),
          });

          let payload = null;
          try {
            payload = await response.json();
          } catch {
            payload = null;
          }

          if (response.ok && payload && payload.ok) {
            setFeedback("success", payload.message || "You're on the waitlist.");
            input.value = "";
          } else if (response.status === 429) {
            setFeedback("error", "Too many attempts. Wait a few minutes and try again.");
          } else {
            setFeedback(
              "error",
              (payload && payload.error) || "Could not join the waitlist. Check your email and try again."
            );
          }
        } catch {
          setFeedback("error", "Network error. Check your connection and try again.");
        } finally {
          submitting = false;
          submitBtn.disabled = false;
          submitBtn.textContent = "Join Waitlist";
        }
      },
    },
    el("div", { className: "vl-waitlist-row" }, input, submitBtn),
    feedback
  );

  return { form, input };
}

// ---------------------------------------------------------------------------
// Public Mount API
// ---------------------------------------------------------------------------

/**
 * Mounts the Vektor Terminal landing, Liquid Glass Products dropdown, and dedicated feature pages.
 * @param {HTMLElement} container
 * @param {{ onSignIn?: () => void, onEnterTerminal?: () => void, isAdmin?: boolean, embedded?: boolean, initialRoute?: { view: string, slug?: string, section?: string | null } }} [options]
 */
export function mountLanding(container, options = {}) {
  if (!container) {
    throw new Error("mountLanding requires a valid container element.");
  }

  let isAdmin = Boolean(options.isAdmin);
  let activeTab = "supercharts";
  let currentRoute = options.initialRoute || { view: "home", section: null };
  let menuOpen = false;
  let hoverCloseTimer = null;

  const adminBarNodes = new Set();
  const authBtnNodes = new Set();
  let activeEmailInput = null;
  let pricingSectionEl = null;

  // Showcase tab refs (when on home view)
  const tabButtons = new Map();
  const showcaseTitleRef = { current: null };
  const showcaseStageRef = { current: null };
  let showcaseExploreLink = null;

  const triggerSignIn = () => {
    if (typeof options.onSignIn === "function") {
      options.onSignIn();
      return;
    }
    if (typeof window !== "undefined") {
      window.location.hash = "#/login";
      if (typeof window.vtOpenAuthModal === "function") {
        window.vtOpenAuthModal("signin");
      }
    }
  };

  const triggerSignUp = () => {
    if (typeof options.onSignUp === "function") {
      options.onSignUp();
      return;
    }
    if (typeof window !== "undefined") {
      window.location.hash = "#/signup";
      if (typeof window.vtOpenAuthModal === "function") {
        window.vtOpenAuthModal("signup");
      }
    }
  };

  const triggerEnterTerminal = () => {
    if (typeof options.onEnterTerminal === "function") {
      options.onEnterTerminal();
      return;
    }
    if (typeof window !== "undefined") {
      window.location.hash = "#charts";
    }
  };

  const navigateHash = (hash) => {
    if (typeof window !== "undefined" && !options.embedded) {
      if (window.location.hash !== hash) {
        window.location.hash = hash;
        return;
      }
    }
    const parsed = parseLandingRoute(hash) || { view: "home", section: null };
    setRoute(parsed);
  };

  const root = el("div", {
    className: options.embedded ? "vl-root vl-embedded" : "vl-root",
    dataset: { surface: "landing" },
  });

  const skipLink = el("a", {
    className: "vl-skip-link",
    href: "#vl-main",
    text: "Skip to content",
  });

  const focusWaitlist = () => {
    closeProductsMenu();
    if (activeEmailInput && activeEmailInput.isConnected) {
      activeEmailInput.scrollIntoView({ behavior: "smooth", block: "center" });
      activeEmailInput.focus({ preventScroll: true });
    }
  };

  const scrollToPricing = () => {
    closeProductsMenu();
    if (currentRoute.view !== "home") {
      navigateHash("#/pricing");
      return;
    }
    if (pricingSectionEl && pricingSectionEl.isConnected) {
      pricingSectionEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // -------------------------------------------------------------------------
  // 1. Minimal Professional Header + Apple Liquid Glass Products Dropdown
  // -------------------------------------------------------------------------
  const menuItems = [];
  const productDropdownWrap = el("div", { className: "vl-dropdown-wrap" });

  const productsTrigger = el(
    "button",
    {
      type: "button",
      id: "vl-products-trigger",
      className: "vl-nav-link vl-products-trigger",
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      "aria-controls": "vl-products-menu",
    },
    el("span", { text: "Products" }),
    buildChevronSvg()
  );

  const productsMenu = el(
    "div",
    {
      id: "vl-products-menu",
      className: "vl-glass-menu",
      role: "menu",
      "aria-labelledby": "vl-products-trigger",
      dataset: { open: "false" },
    },
    el(
      "div",
      { className: "vl-glass-menu-grid" },
      ...PRODUCTS.map((prod) => {
        const item = el(
          "a",
          {
            className: "vl-glass-item",
            href: `#/features/${prod.slug}`,
            role: "menuitem",
            tabindex: "-1",
            dataset: { slug: prod.slug },
            onClick: (e) => {
              e.preventDefault();
              closeProductsMenu();
              navigateHash(`#/features/${prod.slug}`);
            },
          },
          el("span", { className: "vl-glass-icon" }, buildProductIcon(prod.slug)),
          el(
            "span",
            { className: "vl-glass-copy" },
            el("span", { className: "vl-glass-title", text: prod.name }),
            el("span", { className: "vl-glass-desc", text: prod.shortDesc })
          )
        );
        menuItems.push(item);
        return item;
      })
    ),
    el(
      "div",
      { className: "vl-glass-menu-foot" },
      el("span", {
        text: "Free core tier: 3 charts, 3 indicators, 3 alerts · Unlimited screening, replay, heatmaps & journal.",
      })
    )
  );

  function clearHoverTimer() {
    if (hoverCloseTimer !== null) {
      window.clearTimeout(hoverCloseTimer);
      hoverCloseTimer = null;
    }
  }

  function updateMenuActiveState() {
    const activeSlug = currentRoute.view === "feature" ? currentRoute.slug : null;
    for (const item of menuItems) {
      const isCurrent = activeSlug !== null && item.dataset.slug === activeSlug;
      item.classList.toggle("vl-glass-item-active", isCurrent);
      if (isCurrent) {
        item.setAttribute("aria-current", "page");
      } else {
        item.removeAttribute("aria-current");
      }
    }
  }

  function openProductsMenu({ focusFirst = false } = {}) {
    clearHoverTimer();
    if (!menuOpen) {
      menuOpen = true;
      productsTrigger.setAttribute("aria-expanded", "true");
      productsMenu.dataset.open = "true";
      for (const item of menuItems) {
        item.tabIndex = 0;
      }
    }
    if (focusFirst && menuItems[0]) {
      menuItems[0].focus();
    }
  }

  function closeProductsMenu({ returnFocus = false } = {}) {
    clearHoverTimer();
    openedByClick = false;
    if (menuOpen) {
      menuOpen = false;
      productsTrigger.setAttribute("aria-expanded", "false");
      productsMenu.dataset.open = "false";
      for (const item of menuItems) {
        item.tabIndex = -1;
      }
    }
    if (returnFocus) {
      productsTrigger.focus();
    }
  }

  // Track whether menu was opened via hover or explicit click/keyboard
  let openedByClick = false;

  productsTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menuOpen && openedByClick) {
      openedByClick = false;
      closeProductsMenu();
    } else {
      openedByClick = true;
      openProductsMenu();
    }
  });

  productsTrigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openProductsMenu({ focusFirst: true });
    } else if (e.key === "Escape" && menuOpen) {
      e.preventDefault();
      closeProductsMenu({ returnFocus: true });
    }
  });

  productsMenu.addEventListener("keydown", (e) => {
    const idx = menuItems.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      closeProductsMenu({ returnFocus: true });
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = menuItems[(idx + 1 + menuItems.length) % menuItems.length];
      next?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = menuItems[(idx - 1 + menuItems.length) % menuItems.length];
      prev?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      menuItems[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      menuItems[menuItems.length - 1]?.focus();
    } else if (e.key === "Tab") {
      closeProductsMenu();
    }
  });

  // Hover open/close on fine pointers (desktop) with short grace timer
  productDropdownWrap.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch") return;
    openProductsMenu();
  });

  productDropdownWrap.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "touch" || openedByClick) return;
    clearHoverTimer();
    hoverCloseTimer = window.setTimeout(() => {
      closeProductsMenu();
    }, 130);
  });

  const onDocPointerDown = (e) => {
    if (menuOpen && !productDropdownWrap.contains(e.target)) {
      closeProductsMenu();
    }
  };

  const onDocKeyDown = (e) => {
    if (menuOpen && e.key === "Escape") {
      closeProductsMenu({ returnFocus: true });
    }
  };

  document.addEventListener("pointerdown", onDocPointerDown);
  document.addEventListener("keydown", onDocKeyDown);

  productDropdownWrap.appendChild(productsTrigger);
  productDropdownWrap.appendChild(productsMenu);

  const pricingNavLink = el("a", {
    className: "vl-nav-link vl-nav-pricing",
    href: "#/pricing",
    text: "Pricing",
    onClick: (e) => {
      e.preventDefault();
      scrollToPricing();
    },
  });

  const headerAuthBtn = el("button", {
    type: "button",
    className: "vl-btn vl-btn-ghost",
    text: isAdmin ? "Open Terminal" : "Sign in",
    onClick: () => (isAdmin ? triggerEnterTerminal() : triggerSignIn()),
  });
  authBtnNodes.add(headerAuthBtn);

  const headerSignUpBtn = el("button", {
    type: "button",
    className: "vl-btn vl-btn-secondary",
    text: "Create Account",
    onClick: triggerSignUp,
  });

  const headerJoinBtn = el("button", {
    type: "button",
    className: "vl-btn vl-btn-primary",
    text: "Join Waitlist",
    onClick: focusWaitlist,
  });

  const header = el(
    "header",
    { className: "vl-header" },
    el(
      "div",
      { className: "vl-wrap vl-header-inner" },
      el(
        "div",
        { className: "vl-header-left" },
        el(
          "a",
          {
            className: "vl-brand",
            href: "#/landing",
            onClick: (e) => {
              e.preventDefault();
              closeProductsMenu();
              if (currentRoute.view !== "home") {
                navigateHash("#/landing");
              } else {
                root.scrollTo({ top: 0, behavior: "smooth" });
              }
            },
          },
          buildBrandMark(),
          el("span", { text: "Vektor" })
        ),
        el(
          "nav",
          { className: "vl-nav", "aria-label": "Primary navigation" },
          productDropdownWrap,
          pricingNavLink
        )
      ),
      el("div", { className: "vl-header-actions" }, headerAuthBtn, headerSignUpBtn, headerJoinBtn)
    )
  );

  // -------------------------------------------------------------------------
  // 2. Main View Builders (Calm Homepage + 6 Dedicated Feature Pages)
  // -------------------------------------------------------------------------

  const selectTab = (tabId) => {
    const tab = WORKSPACE_TABS.find((t) => t.id === tabId) || WORKSPACE_TABS[0];
    activeTab = tab.id;
    for (const [id, btn] of tabButtons.entries()) {
      const selected = id === activeTab;
      btn.setAttribute("aria-selected", selected ? "true" : "false");
      btn.tabIndex = selected ? 0 : -1;
    }
    if (showcaseTitleRef.current) {
      showcaseTitleRef.current.textContent = tab.chrome;
    }
    if (showcaseStageRef.current) {
      clearNode(showcaseStageRef.current);
      showcaseStageRef.current.setAttribute("aria-labelledby", `vl-tab-${tab.id}`);
      showcaseStageRef.current.appendChild(renderFeaturePreview(tab.id));
    }
    if (showcaseExploreLink) {
      showcaseExploreLink.href = `#/features/${tab.slug}`;
      showcaseExploreLink.textContent = `Explore ${tab.label} →`;
    }
  };

  function buildHomeView() {
    tabButtons.clear();
    adminBarNodes.clear();

    // Band 1: Calm Hero
    const { form: heroForm, input: heroEmailInput } = buildWaitlistForm({
      idPrefix: "vl-waitlist",
      source: "landing",
    });
    heroForm.classList.add("vl-enter-form");
    activeEmailInput = heroEmailInput;

    const heroAdminBar = el(
      "div",
      { className: isAdmin ? "vl-admin-bar" : "vl-admin-bar vl-hidden" },
      el("button", {
        type: "button",
        className: "vl-btn vl-btn-secondary",
        text: "Open Terminal →",
        onClick: triggerEnterTerminal,
      })
    );
    adminBarNodes.add(heroAdminBar);

    const heroSection = el(
      "section",
      { className: "vl-hero", "aria-labelledby": "vl-hero-title" },
      el(
        "div",
        { className: "vl-hero-horizon", "aria-hidden": "true" },
        el("div", { className: "vl-hero-grid" }),
        el("div", { className: "vl-hero-horizon-line" })
      ),
      el(
        "div",
        { className: "vl-wrap vl-hero-inner" },
        el("h1", {
          id: "vl-hero-title",
          className: "vl-hero-title vl-enter-lead",
          text: "Every market. One institutional terminal.",
        }),
        el("p", {
          className: "vl-hero-sub vl-enter-sub",
          text: "Edge-computed charts, P1–P5 screening, bar replay, and trade analytics in one quiet workspace.",
        }),
        heroForm,
        el("p", {
          className: "vl-hero-micro vl-enter-micro",
          text: "Launching 1 March 2027 · Free core tier forever",
        }),
        heroAdminBar
      )
    );

    // Band 2: Focused Workspace Preview
    const segmented = el("div", {
      className: "vl-segmented",
      role: "tablist",
      "aria-label": "Terminal workspaces",
    });

    WORKSPACE_TABS.forEach((tab, idx) => {
      const btn = el("button", {
        type: "button",
        role: "tab",
        id: `vl-tab-${tab.id}`,
        className: "vl-seg-btn",
        "aria-selected": tab.id === activeTab ? "true" : "false",
        "aria-controls": "vl-showcase-panel",
        tabindex: tab.id === activeTab ? "0" : "-1",
        text: tab.label,
        onClick: () => selectTab(tab.id),
        onKeydown: (e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          e.preventDefault();
          const dir = e.key === "ArrowRight" ? 1 : -1;
          const nextIdx = (idx + dir + WORKSPACE_TABS.length) % WORKSPACE_TABS.length;
          const nextTab = WORKSPACE_TABS[nextIdx];
          selectTab(nextTab.id);
          tabButtons.get(nextTab.id)?.focus();
        },
      });
      tabButtons.set(tab.id, btn);
      segmented.appendChild(btn);
    });

    const initialTab = WORKSPACE_TABS.find((t) => t.id === activeTab) || WORKSPACE_TABS[0];
    const frameNode = buildTerminalFrame(initialTab.chrome, renderFeaturePreview(initialTab.id), {
      titleElRef: showcaseTitleRef,
      stageElRef: showcaseStageRef,
      panelId: "vl-showcase-panel",
      labelledBy: `vl-tab-${initialTab.id}`,
    });

    showcaseExploreLink = el("a", {
      className: "vl-text-link",
      href: `#/features/${initialTab.slug}`,
      text: `Explore ${initialTab.label} →`,
      onClick: (e) => {
        e.preventDefault();
        navigateHash(`#/features/${activeTab}`);
      },
    });

    const showcaseSection = el(
      "section",
      { className: "vl-showcase", "aria-labelledby": "vl-showcase-title" },
      el(
        "div",
        { className: "vl-wrap" },
        el(
          "div",
          { className: "vl-section-head" },
          el(
            "div",
            null,
            el("h2", { id: "vl-showcase-title", className: "vl-section-title", text: "Inside the workspace" }),
            el("p", {
              className: "vl-section-desc",
              text: "Charts, screening, replay, and journaling share one layout and one keyboard grammar.",
            })
          ),
          segmented
        ),
        frameNode,
        el("div", { className: "vl-showcase-foot" }, showcaseExploreLink)
      )
    );

    // Band 3: Calm 6-Product Directory (replaces busy metric bento)
    const productCards = PRODUCTS.map((prod) =>
      el(
        "a",
        {
          className: "vl-dir-card",
          href: `#/features/${prod.slug}`,
          onClick: (e) => {
            e.preventDefault();
            navigateHash(`#/features/${prod.slug}`);
          },
        },
        el(
          "div",
          { className: "vl-dir-top" },
          el("span", { className: "vl-dir-icon" }, buildProductIcon(prod.slug)),
          el("h3", { className: "vl-dir-title", text: prod.name })
        ),
        el("p", { className: "vl-dir-desc", text: prod.shortDesc }),
        el("span", { className: "vl-dir-cta", text: "Learn more →" })
      )
    );

    const directorySection = el(
      "section",
      { className: "vl-directory", "aria-labelledby": "vl-directory-title" },
      el(
        "div",
        { className: "vl-wrap" },
        el("h2", { id: "vl-directory-title", className: "vl-section-title", text: "Six focused tools" }),
        el("p", {
          className: "vl-section-desc",
          text: "Open any product below for a closer look at how it works inside Vektor.",
        }),
        el("div", { className: "vl-dir-grid" }, ...productCards)
      )
    );

    // Band 4: Calm Pricing / Free Core Tier
    pricingSectionEl = el(
      "section",
      { id: "vl-pricing", className: "vl-pricing", "aria-labelledby": "vl-pricing-title" },
      el(
        "div",
        { className: "vl-wrap" },
        el("h2", { id: "vl-pricing-title", className: "vl-section-title", text: "Straightforward access" }),
        el("p", {
          className: "vl-section-desc",
          text: "Core research tools stay free forever. Upgrade only when you need more simultaneous layouts and alerts.",
        }),
        el(
          "div",
          { className: "vl-pricing-grid" },
          el(
            "article",
            { className: "vl-tier-card" },
            el(
              "div",
              null,
              el("div", { className: "vl-tier-label", text: "Free Core Tier" }),
              el("div", { className: "vl-tier-price vl-num", text: "$0" }),
              el("p", {
                className: "vl-tier-sub",
                text: "Everything required to screen, replay, and journal daily without a paywall.",
              }),
              el(
                "ul",
                { className: "vl-tier-list" },
                el("li", { text: "3 charts, 3 indicators, and 3 alerts" }),
                el("li", { text: "Unlimited P1–P5 multi-asset screening" }),
                el("li", { text: "Unlimited bar replay and backtesting" }),
                el("li", { text: "Unlimited market heatmaps and trade journal" })
              )
            ),
            el("button", {
              type: "button",
              className: "vl-btn vl-btn-primary vl-tier-btn",
              text: "Join Waitlist",
              onClick: focusWaitlist,
            })
          ),
          el(
            "article",
            { className: "vl-tier-card vl-tier-card-muted" },
            el(
              "div",
              null,
              el("div", { className: "vl-tier-label", text: "Pro Desk" }),
              el("div", { className: "vl-tier-price", text: "Launching 2027" }),
              el("p", {
                className: "vl-tier-sub",
                text: "Built for active multi-screen desks that want expanded workspace capacity.",
              }),
              el(
                "ul",
                { className: "vl-tier-list" },
                el("li", { text: "Expanded multi-chart layouts and indicator slots" }),
                el("li", { text: "Higher real-time alert quotas" }),
                el("li", { text: "Priority edge execution for Vektor Script" }),
                el("li", { text: "Early waitlist members receive launch terms first" })
              )
            ),
            el("button", {
              type: "button",
              className: "vl-btn vl-btn-secondary vl-tier-btn",
              text: "Request Early Access",
              onClick: focusWaitlist,
            })
          )
        )
      )
    );

    return [heroSection, showcaseSection, directorySection, pricingSectionEl];
  }

  function buildFeatureView(slug) {
    tabButtons.clear();
    adminBarNodes.clear();
    pricingSectionEl = null;

    const prod = PRODUCT_BY_SLUG.get(slug) || PRODUCTS[0];

    const breadcrumb = el(
      "nav",
      { className: "vl-breadcrumb", "aria-label": "Breadcrumb" },
      el("a", {
        className: "vl-back-link",
        href: "#/landing",
        text: "← Back to Vektor",
        onClick: (e) => {
          e.preventDefault();
          navigateHash("#/landing");
        },
      }),
      el(
        "span",
        { className: "vl-crumb-trail", "aria-hidden": "true" },
        el("span", { text: "Products" }),
        el("span", { className: "vl-crumb-sep", text: "›" }),
        el("span", { className: "vl-crumb-current", text: prod.name })
      )
    );

    const headerBand = el(
      "div",
      { className: "vl-feat-head" },
      el("h1", { id: "vl-feat-title", className: "vl-feat-title vl-enter-lead", text: prod.headline }),
      el("p", { className: "vl-feat-sub vl-enter-sub", text: prod.subhead }),
      el("p", { className: "vl-feat-tier vl-enter-micro", text: prod.tierNote })
    );

    const previewFrame = el(
      "div",
      { className: "vl-feat-frame" },
      buildTerminalFrame(prod.chrome, renderFeaturePreview(prod.slug))
    );

    const highlights = el(
      "div",
      { className: "vl-feat-highlights" },
      ...prod.highlights.map((h) =>
        el(
          "article",
          { className: "vl-feat-card" },
          el("h2", { className: "vl-feat-card-title", text: h.title }),
          el("p", { className: "vl-feat-card-body", text: h.body })
        )
      )
    );

    const { form: featForm, input: featEmailInput } = buildWaitlistForm({
      idPrefix: `vl-waitlist-${prod.slug}`,
      source: `feature-${prod.slug}`,
    });
    activeEmailInput = featEmailInput;

    const featAdminBar = el(
      "div",
      { className: isAdmin ? "vl-admin-bar" : "vl-admin-bar vl-hidden" },
      el("button", {
        type: "button",
        className: "vl-btn vl-btn-secondary",
        text: "Open Terminal →",
        onClick: triggerEnterTerminal,
      })
    );
    adminBarNodes.add(featAdminBar);

    const ctaBand = el(
      "section",
      { className: "vl-feat-cta", "aria-label": "Waitlist signup" },
      el("h2", { className: "vl-feat-cta-title", text: `Get early access to ${prod.name}` }),
      el("p", {
        className: "vl-feat-cta-sub",
        text: "Free core tier: 3 charts, 3 indicators, 3 alerts; unlimited P1–P5 screening, bar replay, heatmaps, and journal.",
      }),
      featForm,
      featAdminBar
    );

    const section = el(
      "section",
      { className: "vl-feat-page", "aria-labelledby": "vl-feat-title" },
      el("div", { className: "vl-wrap" }, breadcrumb, headerBand, previewFrame, highlights, ctaBand)
    );

    return [section];
  }

  // -------------------------------------------------------------------------
  // 3. Minimal Footer
  // -------------------------------------------------------------------------
  const footerAuthBtn = el("button", {
    type: "button",
    className: "vl-footer-btn",
    text: isAdmin ? "Open Terminal" : "Sign in",
    onClick: () => (isAdmin ? triggerEnterTerminal() : triggerSignIn()),
  });
  authBtnNodes.add(footerAuthBtn);

  const footerSignUpBtn = el("button", {
    type: "button",
    className: "vl-footer-btn",
    text: "Create Account",
    onClick: triggerSignUp,
  });

  const footer = el(
    "footer",
    { className: "vl-footer" },
    el(
      "div",
      { className: "vl-wrap vl-footer-inner" },
      el("span", { text: "Vektor Terminal · Launching 1 March 2027 · Free core tier forever" }),
      el(
        "div",
        { className: "vl-footer-links" },
        el("button", { type: "button", className: "vl-footer-btn", text: "Join Waitlist", onClick: focusWaitlist }),
        footerSignUpBtn,
        footerAuthBtn
      )
    )
  );

  const main = el("main", { id: "vl-main" });

  function renderCurrentRoute() {
    clearNode(main);
    const sections =
      currentRoute.view === "feature" ? buildFeatureView(currentRoute.slug) : buildHomeView();
    for (const s of sections) {
      main.appendChild(s);
    }
    updateMenuActiveState();

    if (currentRoute.view === "home" && currentRoute.section === "pricing" && pricingSectionEl) {
      window.requestAnimationFrame(() => {
        pricingSectionEl?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } else {
      root.scrollTo({ top: 0, behavior: "auto" });
    }
  }

  const setRoute = (nextRoute) => {
    const normalized = nextRoute || { view: "home", section: null };
    const sameView =
      currentRoute.view === normalized.view &&
      currentRoute.slug === normalized.slug &&
      currentRoute.section === normalized.section;
    currentRoute = normalized;
    if (!sameView) {
      renderCurrentRoute();
    } else if (normalized.view === "home" && normalized.section === "pricing" && pricingSectionEl) {
      pricingSectionEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  root.appendChild(skipLink);
  root.appendChild(header);
  root.appendChild(main);
  root.appendChild(footer);

  renderCurrentRoute();

  clearNode(container);
  container.appendChild(root);

  const setAdmin = (nextIsAdmin) => {
    isAdmin = Boolean(nextIsAdmin);
    for (const btn of authBtnNodes) {
      btn.textContent = isAdmin ? "Open Terminal" : "Sign in";
    }
    for (const bar of adminBarNodes) {
      bar.classList.toggle("vl-hidden", !isAdmin);
    }
  };

  const unmount = () => {
    clearHoverTimer();
    document.removeEventListener("pointerdown", onDocPointerDown);
    document.removeEventListener("keydown", onDocKeyDown);
    if (root.parentNode === container) {
      container.removeChild(root);
    }
  };

  return { unmount, setAdmin, selectTab, setRoute };
}

// ---------------------------------------------------------------------------
// Auto-Mount & Pre-Launch Waitlist Gate (with Admin Bypass & Stale-Request Guard)
// ---------------------------------------------------------------------------

let activeMount = null;
let autoContainer = null;
let syncSeq = 0;

function ensureAutoContainer() {
  if (autoContainer && autoContainer.isConnected) return autoContainer;
  let existing = document.getElementById("vt-landing-root");
  if (!existing) {
    existing = document.createElement("div");
    existing.id = "vt-landing-root";
    document.body.appendChild(existing);
  }
  autoContainer = existing;
  return existing;
}

function unmountAutoLanding() {
  if (activeMount) {
    activeMount.unmount();
    activeMount = null;
  }
  if (autoContainer && autoContainer.parentNode) {
    autoContainer.parentNode.removeChild(autoContainer);
  }
  autoContainer = null;
}

async function resolveCurrentUserIsAdmin() {
  if (typeof window === "undefined") return false;
  if (window.__VT_USER && typeof window.__VT_USER === "object") {
    return window.__VT_USER.role === "admin";
  }
  if (window.VT_WAITLIST_GATE !== true) {
    return false;
  }
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!res.ok) return false;
    const data = await res.json();
    if (data && data.ok && data.user) {
      window.__VT_USER = data.user;
      return data.user.role === "admin";
    }
  } catch {
    // Fail closed to waitlist view when gate is active
  }
  return false;
}

async function syncAutoLanding() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const reqId = ++syncSeq;
  const hash = (window.location.hash || "").toLowerCase();
  const parsedRoute = parseLandingRoute(hash);
  const explicitLanding = parsedRoute !== null;
  const authHash =
    hash === "#auth" ||
    hash.startsWith("#auth/") ||
    hash === "#/auth" ||
    hash.startsWith("#/auth/") ||
    hash === "#signup" ||
    hash === "#/signup" ||
    hash === "#register" ||
    hash === "#/register" ||
    hash === "#login" ||
    hash === "#/login" ||
    hash === "#signin" ||
    hash === "#/signin";
  const gateActive = window.VT_WAITLIST_GATE === true;

  // Never cover the auth screen so Sign In / Create Account always renders cleanly
  if (authHash) {
    unmountAutoLanding();
    return;
  }

  const isAdmin = await resolveCurrentUserIsAdmin();
  // Guard against stale in-flight /api/auth/me overwriting a newer navigation (e.g. rapid #auth)
  if (reqId !== syncSeq) return;

  if (explicitLanding || (gateActive && !isAdmin)) {
    const targetRoute = parsedRoute || { view: "home", section: null };
    if (!activeMount) {
      const container = ensureAutoContainer();
      activeMount = mountLanding(container, {
        isAdmin,
        initialRoute: targetRoute,
        onSignIn: () => {
          unmountAutoLanding();
          window.location.hash = "#/login";
          if (typeof window.vtOpenAuthModal === "function") {
            window.vtOpenAuthModal("signin");
          }
        },
        onSignUp: () => {
          unmountAutoLanding();
          window.location.hash = "#/signup";
          if (typeof window.vtOpenAuthModal === "function") {
            window.vtOpenAuthModal("signup");
          }
        },
        onEnterTerminal: () => {
          unmountAutoLanding();
          if (parseLandingRoute(window.location.hash)) {
            window.location.hash = "#charts";
          }
        },
      });
    } else {
      activeMount.setAdmin(isAdmin);
      activeMount.setRoute(targetRoute);
    }
    return;
  }

  unmountAutoLanding();
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const boot = () => {
    syncAutoLanding();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
  window.addEventListener("hashchange", syncAutoLanding);
  window.addEventListener("vt:auth-changed", syncAutoLanding);
}
