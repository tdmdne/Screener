# Tests

Browser and logic checks for `index.html`. They aren't part of the app.

Setup (once): `npm i playwright && npx playwright install chromium`

- `node tests/syntax.js` syntax-checks every inline script.
- `node tests/<name>.js` runs a headless Chromium check. `harness.js` serves the page locally, skips the login gate, mocks Binance REST and all WebSockets, and blocks every other network call, so no real API is used.
- Optional: put `lwc.js` (lightweight-charts 4.1.3) and `h2c.js` (html2canvas 1.4.1) in `tests/vendor/` to run fully offline.
- `legal.js`: every `#/legal/<doc>` route renders with its placeholders, the footer links work, deep links survive a reload, WebSockets stay connected and no entity text shows.
- `alertlines.js`: active alerts are drawn as lines with scale labels on all charts, and the click-to-edit (price, condition, message), drag and delete paths work; the custom message shows in the fired toast, and edits never cause duplicate fires.
