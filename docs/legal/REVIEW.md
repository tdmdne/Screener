# Legal drafts — review checklist

For Tyler and a solicitor. These in-app pages (`#/legal/*`) are **drafts only**. They are not legal advice and must not be published as final until this list is worked through.

The live wording is in `index.html` (around the “Legal pages” block). Keep `src/90_legal.js` and `src/91_privacy.js` in sync with the same edits. Do not invent company details to fill a placeholder.

Every legal page shows a red **DRAFT** box: “This page is a draft pending review by Tyler or a solicitor before it is published.”

Known facts already filled in (do not replace with guesses):

- Contact email: `vektorhq@proton.me`
- The service is currently free. Nothing is charged until paid plans go live.
- Intended launch prices (still marked `[confirm before launch]`): Pro £11.99/month or £109/year; Elite £24.99/month or £219/year; GBP including 20% VAT.
- Required market-data attribution included in Data Sources, Privacy and Cookies: “Data provided by Twelve Data.”

---

## All pages (header / footer meta)

Shown via the shared header on every legal page, including the `#/legal` index and the sign-in legal modal.

| Placeholder | What’s needed |
| --- | --- |
| `[Effective date]` | The date these pages go live (launch is planned for 1 March 2027). |
| `[Company legal name]` | The registered legal name of the operator. |
| `[Registered address]` | The registered office address. |
| `[Company number]` | Companies House number, if incorporated. |

Also confirm “Registered in England and Wales” on About (`[confirm]`), or replace it if the company is registered elsewhere.

---

## Terms of Use

| Placeholder or `[confirm…]` item | What’s needed |
| --- | --- |
| `[Website URL]` | The public site URL. |
| `[confirm before launch]` (paid-plan prices) | Confirm Pro £11.99/month or £109/year and Elite £24.99/month or £219/year, in GBP including 20% VAT, before launch. The VAT number is still a placeholder, so a solicitor should confirm that “including 20% VAT” is accurate at launch. |
| `[Payment provider, e.g. merchant of record, confirm]` | Name the actual merchant / payment provider once chosen. Do not publish a provider name (including Stripe) until it is confirmed. |
| `[confirm with solicitor: whether any content is a financial promotion under FSMA section 21, and whether an exemption or approved communication is required before launch]` | Solicitor decision. A charting and screening tool with scores, tiers and alerts may still be a financial promotion. |
| `[Company legal name]` and `[Registered address]` (sections 8 and 12) | Same company details as the header. |

Other solicitor checks on this page (no separate placeholder): England and Wales governing law and jurisdiction (including for users elsewhere in the UK); Consumer Rights Act 2015 wording in section 10; age 18 restriction; that the sign-in prototype description stays accurate until a real account system exists.

---

## Privacy Policy

| Placeholder or `[confirm…]` item | What’s needed |
| --- | --- |
| `[Company legal name]`, `[Registered address]`, `[Company number]`, `[ICO registration number]` (controller section) | Legal identity plus ICO registration, or a decision that ICO registration is not required and the line should be changed. |
| `[Hosting provider]` | The organisation that hosts the site. Cloudflare Pages is the intended host in the repo, but this must be confirmed and must not be published as fact until then. |
| `[hosting data processing terms]` | The contract or terms under which the host acts as processor. |
| `[confirm with solicitor: whether the hosting provider (intended, but not yet confirmed, to be Cloudflare) sets its own cookies for security or content delivery, and the applicable cookie and processing terms]` | Confirm from the host’s docs and a solicitor. Until then the policy does **not** state that the host does or does not set cookies. |
| `[confirm with solicitor: controller and processor roles for the /api backend and hosting provider]` (in the shared sources table) | Who is controller vs processor when `/api/*` sees the user’s IP and requested symbols. |
| `[confirm icon origin and licence]` | Confirm that icons are original to this app, or name the licence/source. |
| `[confirm with solicitor: lawful bases, including /api processing and optional preferences]` | Review the Art. 6 table, including the new optional-preferences row and the split between `/api` requests and direct browser requests. |
| `[Hosting log retention period]` | How long hosting logs are kept. |
| `[Correspondence retention period]` | How long rights requests and emails are kept. |
| `[transfer mechanism, e.g. UK adequacy regulations or the UK International Data Transfer Agreement / Addendum]` | The UK transfer tool actually relied on. |
| `[confirm with solicitor: transfer wording for direct browser requests versus /api backend requests]` | Direct browser calls vs transfers made by the backend. |
| `[confirm with solicitor: lawful basis and transfer wording for user-initiated sends to an AI provider]` | Journal AI review (user’s own key, sent from the browser). |

Also confirm: the sign-in description (password is not stored and is not sent) remains true; bump `VT_POLICY_V` in `src/91_privacy.js` / `index.html` before publishing a changed cookie or privacy notice, so users are asked again.

---

## Cookies and Local Storage

| Placeholder or `[confirm…]` item | What’s needed |
| --- | --- |
| Shared header details | As above. |
| `[confirm with solicitor: whether the hosting provider (intended, but not yet confirmed, to be Cloudflare) sets its own cookies for security or content delivery]` | Same hosting-cookie question as Privacy. The app’s own code does not set cookies (no `document.cookie`, and `/api/login` is only an unused comment). |
| `[confirm icon origin and licence]` | Appears because this page reuses the shared sources table. |

---

## Your data

No extra placeholders beyond the shared header. Confirm that the export, delete-all, consent withdraw and “email this request” flows still match the live code, and that `vektorhq@proton.me` is the address that will handle rights requests.

---

## Risk Disclaimer and Not Financial Advice

| Placeholder or `[confirm…]` item | What’s needed |
| --- | --- |
| `[Company legal name]` (no FCA authorisation) | Legal name. |
| `[confirm with solicitor: whether any content is a financial promotion under the Financial Services and Markets Act 2000, section 21, and whether an exemption or an authorised-person approval is required before launch]` | Solicitor decision. Wording is also on Terms. |
| Shared header details | As above. |

Factual notes already reflected in the draft (please check they remain true at launch):

- S01–S04 “Cycle” phases were removed on 17 November 2026. The UI now shows phase labels such as Expansion, Accumulation and Range. P1–P5 tiers remain.
- If the backend has no Twelve Data key, `/api/candles` may return synthetic bars for non-crypto symbols, and the chart does not currently label them as simulated. This is separate from “Offline sample data” mode.

---

## Data Sources and Attributions

| Placeholder or `[confirm…]` item | What’s needed |
| --- | --- |
| `[confirm with solicitor: controller and processor roles for the /api backend and hosting provider]` | Same as Privacy. |
| `[confirm icon origin and licence]` | As above. |
| `[confirm with solicitor: how prominently simulated prices must be disclosed in the product and in this notice]` | The legal pages now disclose synthetic `/api/candles` bars. The product UI does not yet label them. |

Required attribution included: **Data provided by Twelve Data.** Keep this wording wherever legal copy lists market-data sources (Data Sources, Privacy and Cookies, via the shared table).

Do **not** describe Yahoo Finance as a price or chart source. The live code uses Yahoo only for RSS headlines (`feeds.finance.yahoo.com`). There is no Yahoo REST price client. `SETUP.md`, `CHANGELOG.md` and the in-app `vtTdKeyNote()` text still say forex and metals load from Yahoo when no Twelve Data key is set; that is outdated and should be fixed in product/docs separately (not in this legal draft).

Do **not** describe Pine Script translation as a live feature. `src/47_vs_engine.js` and `src/48_vs_ui.js` contain a “Translate Pine” helper, but that code is not loaded by the live monolith `index.html`. The legal copy only refers to indicator scripts the user writes or imports.

---

## Disclaimer of Liability

| Placeholder or `[confirm…]` item | What’s needed |
| --- | --- |
| `[Company legal name]` | Legal name. |
| Shared header details | As above. |

Solicitor should review the “as is” wording against the Consumer Rights Act 2015 (already named) and confirm nothing attempts to exclude liability that cannot be excluded.

---

## Refunds and Cancellation

These terms apply when paid plans go live. The service is currently free and nothing is charged.

| Placeholder or `[confirm…]` item | What’s needed |
| --- | --- |
| `[confirm before launch]` (plan prices, including on renewals) | Confirm Pro £11.99/month or £109/year and Elite £24.99/month or £219/year, GBP including 20% VAT. |
| `[Payment provider, e.g. merchant of record, confirm]` | As on Terms. Do not name Stripe or any other provider as fact. |
| `[Account → Billing page]` | The actual in-app (or hosted) cancellation path, once it exists. Cancelling must be as easy as signing up. |
| `[confirm with solicitor: whether a future paid plan is a service, digital content, or both, and whether a formal 14-day digital-content waiver will be used]` | Consumer Contracts Regulations 2013 cooling-off, deductions for service already used, and any digital-content waiver. |
| `[VAT number, if registered]` is on About, not this page | Still needed before stating “including 20% VAT” as a final fact. |

---

## About and Contact

| Placeholder | What’s needed |
| --- | --- |
| `[Company legal name]` | Legal name. |
| `[confirm]` (Registered in England and Wales) | Confirm the place of registration. |
| `[Company number]` | Companies House number. |
| `[Registered address]` | Registered office. |
| `[VAT number, if registered]` | VAT number, or a statement that the operator is not VAT-registered. |
| `[ICO registration number]` | ICO number, or a decision to remove this row. |

Email is already `vektorhq@proton.me`.

---

## Accessibility statement

| Placeholder | What’s needed |
| --- | --- |
| `[5 working days]` | The reply-time target you will stand behind. |
| `[date]` | Date this statement was prepared. |
| `[self-assessment / third-party audit]` | How it was checked. |
| `[Accessibility audit pending]` | Replace with the outcome, or leave until an audit is done. |

---

## Code facts used for this draft (for the reviewer)

Checked against `index.html` (the live app), with `server.js` / `worker.js` / `worker/` for backend `/api` behaviour:

- Sign-in is a device-only prototype (`authSignIn` does not call `/api/login`; the password is not stored or sent).
- The app’s own code does not set cookies.
- On http/https, historical candles, screener, calendar and news first go to `/api/*`. Fallbacks: Fair Economy and Yahoo RSS directly from the browser; Binance and Twelve Data REST directly from the browser (user’s own Twelve Data key needed for that candle fallback).
- The browser always talks directly to Binance WebSocket `data-stream.binance.vision:443`, Twelve Data WebSocket `ws.twelvedata.com`, optional Finnhub / Polygon / CoinGecko, Journal AI, and `cdn.jsdelivr.net`.
- Backend may also contact `api1.binance.com` and `stream.binance.com:9443`. Dukascopy (`datafeed.dukascopy.com`) is backend-only, for offline Backtest Replay.
- Yahoo is RSS headlines only.
- Without a Twelve Data key, `/api/candles` may serve synthetic non-crypto bars (`source: "simulator"`), which the chart does not label.
- If the Fair Economy feed fails, the backend may show a generated “macro calendar”.
- Cycle filter S01–S04 was removed on 17 November 2026 (`CHANGELOG.md`, `tests/screener.js`). `scoreSymbol` phase labels are words such as Expansion, not S01–S04.
- The app no longer ships with a built-in Twelve Data key. Users can enter their own in Settings › Data.

Open product issues outside this legal PR (flagged so they are not forgotten):

1. `vtTdKeyNote()`, `SETUP.md` and `CHANGELOG.md` still claim a Yahoo Finance REST price fallback that the code does not implement.
2. Simulated `/api/candles` bars are not labelled in the chart UI.
3. Bump `VT_POLICY_V` when the revised cookie/privacy notice is published.
4. Pine translation must not be documented as live unless and until that `src/` helper is wired into `index.html`.

`ask-claude` and `ask-gemini --project screener` were requested for drafting help on this pass; Claude had hit its 5-hour limit and Gemini returned HTTP 429. Every factual claim above was checked against the code rather than those tools.
