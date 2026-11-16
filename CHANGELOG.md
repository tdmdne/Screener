# Vektor Terminal changelog

Short dated log of changes to `index.html` (the whole app) and why.

## 2026-11-16
- **Reliability fixes (before the multi-page work).**
  - Alerts: `toast()` pointed at a `#msg` element that didn't exist, so every toast threw. `fireAlert` toasts first, so desktop notifications and the sound never ran. Added the toast element and made `toast` null-safe. Alerts now reuse one AudioContext (browsers cap how many you can open), get checked when polled (non-WebSocket) data arrives as well as on ticks, and show a "triggered" badge with a Re-arm button.
  - Live chart: each Binance ticker message (about once a second) rebuilt the whole chart when a crypto symbol was open. That reset your zoom and pan every second and started a new clock Web Worker each time without stopping the old one. Ticks now update the last bar and header price in place, and the clock worker is stopped on every redraw.
  - Universe: `persistUni()` took its snapshot before the newly loaded Binance/Finnhub/Polygon list was merged in. Because that snapshot is trusted for 6 hours, crypto (and key-based stock lists) could be missing from the screener. The merge now happens before the snapshot.
  - Defined the `--hover` colour that several menus use.
- **Baseline restored byte-for-byte.** `index.html` now matches the owner's attached baseline exactly. Line 361 (`esc` helper) had been mangled to `&amp;quot;` by an upload tool that decodes HTML entities; it is back to `&quot;`. All pushes now go through a method verified to round-trip entities exactly, and every push is checked byte-for-byte against the local file.
