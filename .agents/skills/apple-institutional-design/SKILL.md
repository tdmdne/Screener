---
name: apple-institutional-design
description: >-
  Audits and elevates Vektor Terminal UI (code and Playwright screenshots) against
  Apple Human Interface Guidelines craft (spatial calm, fluid physics/motion, <100ms
  latency, crisp typography, wayfinding, accessibility) fused with institutional
  trading-terminal precision (Koyfin, Bloomberg, Trade Ideas, TradingView, FX Replay).
---

# Apple × Institutional Trading Terminal Design Skill

Use this skill to audit any screen, modal, toolbar, table, chart, or mobile layout in `tdmdne/Screener` (via code + Playwright screenshots at `1440×900` desktop and `375×812` phone), diagnose every flaw ruthlessly, fix it, and re-audit until **zero High/Medium findings** remain.

## The 6 Audit Pillars (Score 0–10 Each; Ship Threshold ≥ 9/10)

### 1. Spatial Calm & Hierarchy (Zero Busyness)
- **Rule:** Institutional tools NEVER make the screen feel busy. Every element must earn its pixels.
- **Checks:**
  - Maximum 1 primary header bar (`≤ 48px` desktop) + 1 slim context toolbar (`≤ 40px`). Never stack 3–4 control rows above a chart, screener, or heatmap.
  - Eliminate duplicate controls (never show both a dropdown AND pill row for the same filter).
  - Flatten nested cards-inside-cards; enforce `inner-radius = outer-radius - padding`.
  - Above-the-fold rule:
    - **Supercharts:** ≥ 75% desktop / ≥ 60% phone viewport is candlesticks.
    - **Screener:** live data rows visible immediately above the fold on both desktop and phone.
    - **Backtest/Replay:** FX Replay-style chart-first cockpit; session setup collapses into a slim top pill once active.
    - **Journal:** executive 2-tier hierarchy (hero KPI strip + equity curve + clean ledger); zero dead black empty voids.
    - **Heatmap:** uncluttered treemap dominates viewport; hide/de-emphasize unquoted `-` tiles by default.

### 2. Color, Surface & Contrast (WCAG AA + Restraint)
- **Palette discipline:**
  - Obsidian 3-tier dark surface scale: `--bg-0: #090a0d` (canvas), `--bg-1: #111318` (chrome/panels), `--bg-2: #181b22` (elevated/hover).
  - Crisp 1px hairline dividers (`rgba(255,255,255,0.07)` dark / `rgba(15,23,42,0.08)` light).
  - **One cohesive primary accent** (`--acc`); kill clashing hardcoded blues (`#2962ff`) and browser-default blue range sliders.
  - **Glassy + Draggable + 4-Way Resizable Desktop Modals:** Desktop modals & settings popups use frosted obsidian/paper glass (`backdrop-filter: blur(20px) saturate(160%)`, hairline border, subtle inner highlight) and are draggable via header + 4-way/corner resizable via `src/window_manager.js` (mobile sheets remain untouched).
  - Semantic green/red reserved strictly for price deltas, PnL, and active buy/sell order direction.
  - Minimum WCAG AA contrast (`4.5:1` body, `3:1` large/UI components) across Dark AND Light themes.

### 3. Typography & Numeric Precision
- **Every price, tick, percentage, volume, PnL, ratio, and KPI MUST use:**
  - `font-variant-numeric: tabular-nums;`
  - Monospace numeric stack (`JetBrains Mono`, `SF Mono`, `ui-monospace`, monospace)
  - Right-alignment inside table columns and numeric strips so decimal points never jitter.
- **Clean labels:** Never expose raw vendor tickers (`6A=F`, `CL=F`, `BZ=F`) or raw network errors (`Loading 354 left · 1 failed`) in primary chrome.

### 4. Motion, Physics & Gestures (Apple Standard)
- **Easing:** Use crisp Apple-grade deceleration curves (`cubic-bezier(0.22, 1, 0.36, 1)` for entrances/sheets, `cubic-bezier(0.2, 0, 0, 1)` for micro-interactions; 140–220ms).
- **Purposeful only:** Smooth hover/press feedback, tactile chart/slider scrubbers, crisp tick flash (`vt-fu`/`vt-fd`), fluid bottom sheets on touch devices. Zero decorative blobs or forever-looping gimmicks.
- **Reduced motion:** Respect `@media (prefers-reduced-motion: reduce)` strictly (all animations/flashes disabled).

### 5. Response Latency & Zero Frontend Logic (§0)
- Feedback `< 100 ms` on every click, hover, tab switch, and keyboard shortcut (`⌘K`, arrows, Esc).
- Explicit skeleton/shimmer loading states, clean empty states with actionable CTAs, and human-readable error banners.
- **Non-negotiable:** Presentation only! Never introduce client-side market data fetching, candle merging, indicator calculation, or synthetic data to "make UI look full".

### 6. Wayfinding, Accessibility & Mobile Precision
- Unmistakable active navigation state, clear keyboard focus rings (`:focus-visible`), valid `aria-label` matching visible text (`label-content-name-mismatch = 0`).
- Zero horizontal overflow on phone (`375×812`, `390×844`) even with safety clip removed.
- Touch targets `≥ 44px` on mobile controls; zero fixed-nav overlaps over content.

## Audit Output Format
Every audit saves screenshots (`1440×900` + `375×812`) and reports:
1. Pillar scores (0–10) per screen
2. Exact DOM/telemetry metrics (overflow, overlaps, missing `tabular-nums`, console errors, non-origin egress)
3. Prioritized High/Medium defects with exact file paths, selectors, and line ranges
4. Pass/Fail verdict against the ship threshold (0 High/Medium defects, all pillars ≥ 9/10)
