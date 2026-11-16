# Vektor Terminal changelog

Short dated log of changes to `index.html` (the whole app) and why.

## 2026-11-16
- **Baseline restored byte-for-byte.** `index.html` now matches the owner's attached baseline exactly. Line 361 (`esc` helper) had been mangled to `&amp;quot;` by an upload tool that decodes HTML entities; it is back to `&quot;`. All pushes now go through a method verified to round-trip entities exactly, and every push is checked byte-for-byte against the local file.
