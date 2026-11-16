# Tests

Browser and logic checks for `index.html`. They aren't part of the app.

Setup (once): `npm i playwright && npx playwright install chromium`

- `node tests/syntax.js` syntax-checks every inline script.
- `node tests/<name>.js` runs a headless Chromium check. `harness.js` serves the page locally, skips the login gate (pass `auth:false` to see it), mocks Binance REST and all WebSockets, and blocks every other network call, so no real API is used. Other options: `consent:false` (no consent seeded), `mobile` (touch phone), `reducedMotion:"reduce"`.
- Optional: put `lwc.js` (lightweight-charts 4.1.3) and `h2c.js` (html2canvas 1.4.1) in `tests/vendor/` to run fully offline.
- `legal.js`: every `#/legal/<doc>` route renders with its placeholders, the footer links work, deep links survive a reload, WebSockets stay connected and no entity text shows.
- `alertlines.js`: active alerts are drawn as lines with scale labels on all charts, and the click-to-edit (price, condition, message), drag and delete paths work; the custom message shows in the fired toast, and edits never cause duplicate fires.
- `privacy.js`: the consent banner's Reject equals Accept; no IndexedDB before consent; the consent log, cookie settings and withdraw work; export JSON; delete-all with confirmation also disconnects the feeds; the request form is gated; legal pages open over the sign-in screen.
- `mobile.js`: phone layout at 375 and 390px. Checks the tab bar and More sheet, no page overflow, 44px targets, touch pan, pinch, long-press, tapping "+", dragging an alert line, the bottom-sheet editor and touch drawing. `mshots.js WxH` takes phone screenshots.
- `signin.js`: the sign-in screen at desktop and 390px. Checks that the backdrop animates (and stays static with reduced motion), the real ticker snippets, Tab order, guest mode (nothing in localStorage or IndexedDB, survives a reload in the same tab, charts and screener work), the guest prompt for alerts and settings (focus, Tab, Esc), and signing in from guest mode with no reload or new sockets, after which saving starts. It writes `shots/11_signin.png` and `shots/m/390_signin.png`.
- `postool.js`: Long/Short Position tools on desktop and at 390px with touch. Checks click-to-place with the default R:R, exact R:R/Qty/P&L/Amount labels for long and short (open and closed), handle drags (target, stop, entry, width), remembered defaults, the settings dialog (live apply and Cancel), the right-click menu (clone, lock, hide, delete) and a touch drag. It writes `shots/pos_tool_after.png` and `shots/m/390_position*.png`.
- `logic_pos.js`: position maths (quantity from risk, leverage cap, lot size, precision, R:R) and the open/target/stop state, where the stop counts first and the entry bar is excluded.
