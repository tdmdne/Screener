# Vektor Terminal — Institutional Design Tokens & Style Guide (Toolbox)

Reference palette and motion primitives combining **Apple HIG fluidity & calm** with **Koyfin / Bloomberg / Trade Ideas / FX Replay** precision.

## 1. Surface & Border Tokens (Dark Default)
```css
:root {
  --bg-0: #08090c;                 /* Canvas / deepest background */
  --bg-1: #0f1117;                 /* Chrome, header, docked rails */
  --bg-2: #161922;                 /* Elevated cards, popovers, hover */
  --bg-3: #1e222e;                 /* Active control / selected row */
  --line-1: rgba(255, 255, 255, 0.07);  /* Hairline structural divider */
  --line-2: rgba(255, 255, 255, 0.13);  /* Interactive border / focus */

  --txt-1: #eef1f6;                /* Primary crisp ink */
  --txt-2: #9aa3b2;                /* Secondary labels */
  --txt-3: #636c7e;                /* Muted metadata / placeholders */

  --acc: #f59e0b;                  /* Single institutional amber-gold accent (Bloomberg/Koyfin warmth) */
  --acc-soft: rgba(245, 158, 11, 0.14);
  --up: #10b981;                   /* Restrained institutional emerald */
  --up-soft: rgba(16, 185, 129, 0.14);
  --dn: #ef4444;                   /* Restrained institutional crimson */
  --dn-soft: rgba(239, 68, 68, 0.14);

  --r-sm: 6px;
  --r-md: 8px;
  --r-lg: 12px;
  --ease-apple: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-snap: cubic-bezier(0.2, 0, 0, 1);
  --t-fast: 120ms;
  --t-med: 200ms;
}
```

## 2. Numeric & Table Discipline
- All financial values (`price`, `% chg`, `ADR`, `PnL`, `R:R`, `Win Rate`, `Drawdown`, `Volume`):
  - `font-family: "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace;`
  - `font-variant-numeric: tabular-nums;`
  - `text-align: right;` in tables.

## 3. Spatial Calm Rules
- Desktop header: **single 48px row** (`align-items: center`, zero wrapping down to `1024px`).
- Secondary toolbars: **single 38–40px row** with hairline `1px solid var(--line-1)` bottom border; secondary controls tuck into crisp popovers with `backdrop-filter: blur(12px)`.
- Controls: slim `28–32px` height on desktop (`44px` minimum on `data-ui="phone"`), subtle hover elevation, zero heavy pill borders on every button.
- Custom range sliders (Backtest scrubber): `4px` sleek track + crisp `12px` circular thumb with smooth hover scale (`transform: scale(1.15)`), never default browser blue.
