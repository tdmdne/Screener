# Legal drafts — review checklist

For Tyler and a solicitor. These in-app pages (`#/legal/*`) are **drafts only**. They are not legal advice and must not be published as final until this list is worked through.

The live wording is in `index.html` (around the “Legal pages” block). Keep `src/90_legal.js` and `src/91_privacy.js` in sync with the same edits. Do not invent company details to fill a placeholder.

Every legal page shows a red **DRAFT** box: “This page is a draft pending review by Tyler or a solicitor before it is published.”

Known facts already filled in (do not replace with guesses):

- Contact email: `vektorhq@proton.me`
- The service is currently free. Nothing is charged until paid plans go live.
- Intended launch prices (still marked `[confirm before launch]`): Pro £11.99/month or £109/year; Elite £24.99/month or £219/year; GBP including 20% VAT.
- Required market-data attribution included in Data Sources, Privacy and Cookies: “Data provided by Twelve Data.”
- The hosted site at https://screener-cso.pages.dev/ serves a Cloudflare Web Analytics beacon (`static.cloudflareinsights.com/beacon.min.js` with `data-cf-beacon`). It is injected at Cloudflare’s edge, not in this repository.
- Umami Cloud (free Hobby plan, cookieless) has been approved as a second analytics provider for aggregate page views, events and UTM signup/campaign measurement. Source: reported by Leo/Bruce, Tyler-approved. Bruce is installing it; the script was not on the live site when this draft was written, so the pages carry `[confirm before publishing: Umami installed and live]`.

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
| `[confirm with solicitor: whether the hosting provider also sets its own cookies for security or content delivery, separate from the cookieless Web Analytics beacon, and the applicable cookie and processing terms]` | Separate from Cloudflare Web Analytics (cookieless, according to Cloudflare’s docs). Until this is confirmed, the policy does **not** state that the host does or does not set other cookies. |
| `[confirm with solicitor: controller and processor roles for the /api backend and hosting provider]` (in the shared sources table) | Who is controller vs processor when `/api/*` sees the user’s IP and requested symbols. |
| `[confirm icon origin and licence]` | Confirm that icons are original to this app, or name the licence/source. |
| `[confirm with solicitor: lawful bases, including /api processing, optional preferences, and Cloudflare Web Analytics and Umami Cloud (legitimate interests / PECR exemption)]` | Review the Art. 6 table, including optional preferences, the `/api` vs direct-request split, and both analytics tools. |
| `[Hosting log retention period]` | How long hosting logs are kept. |
| `[Correspondence retention period]` | How long rights requests and emails are kept. |
| `[transfer mechanism, e.g. UK adequacy regulations or the UK International Data Transfer Agreement / Addendum]` | The UK transfer tool actually relied on. |
| `[confirm with solicitor: transfer wording for direct browser requests versus /api backend requests, and for Cloudflare Web Analytics (which Cloudflare says may be processed at a nearby data centre that may be outside the UK)]` | Direct browser calls, `/api` backend calls, and Cloudflare Web Analytics processing location. |
| `[confirm: Umami Cloud hosting region and DPA]` | Umami Cloud offers US and EU storage regions (selected at account setup). Confirm which region this account uses, complete the DPA, and confirm transfer wording. Umami’s docs say the region applies to analytics storage, and that CDN, security, support and operational logging may involve services outside it. |
| `[confirm with solicitor: lawful basis and transfer wording for user-initiated sends to an AI provider]` | Journal AI review (user’s own key, sent from the browser). |

Also confirm: the sign-in description (password is not stored and is not sent) remains true; bump `VT_POLICY_V` in `src/91_privacy.js` / `index.html` before publishing a changed cookie or privacy notice, so users are asked again.

---

## Cookies and Local Storage

| Placeholder or `[confirm…]` item | What’s needed |
| --- | --- |
| Shared header details | As above. |
| `[confirm with solicitor: whether the hosting provider also sets its own cookies for security or content delivery, separate from this cookieless analytics beacon]` | Same hosting-cookie question as Privacy, kept separate from the analytics beacons. The app’s own code does not set cookies (no `document.cookie`, and `/api/login` is only an unused comment). |
| `[confirm icon origin and licence]` | Appears because this page reuses the shared sources table. |
| Analytics placeholders on this page | See [Analytics](#analytics-cloudflare-web-analytics-and-umami-cloud) below. |


---

## Analytics (Cloudflare Web Analytics and Umami Cloud)

These appear on Privacy, Cookies, Data Sources (shared sources table) and in the consent banner. Advertising is not used. No future paid analytics tool is described.

### Cloudflare Web Analytics (live on the hosted preview)

Verified on https://screener-cso.pages.dev/ : the edge injects `static.cloudflareinsights.com/beacon.min.js` with a `data-cf-beacon` token. This is not in the repo.

Wording is based on Cloudflare’s documentation (data origin and collection, RUM beacon privacy notes, Web Analytics FAQ and the public Web Analytics page), not an independent audit of Cloudflare’s systems:

- Cookieless: no cookies, localStorage, sessionStorage or IndexedDB, according to Cloudflare.
- Used for aggregate page views and performance (including Core Web Vitals), plus dimensions such as referrer, country, device, browser and path.
- No cross-site tracking of individuals across Cloudflare customers’ sites; no fingerprinting of individuals for these analytics; query strings not logged; IP on the beacon request discarded and not stored, according to Cloudflare.
- Cloudflare is described as our processor.

| Placeholder or `[confirm…]` item | What’s needed |
| --- | --- |
| `[confirm with solicitor: legitimate interests / PECR exemption]` | Whether this cookieless beacon can run without a consent toggle (the banner category is disabled and is not an opt-out). |
| `[confirm with solicitor: whether to rely on Cloudflare’s published retention periods]` | Cloudflare’s docs (as at this draft) say unsampled beacon data is kept for 7 days and dashboard data is available for six months. |
| Transfer wording for Cloudflare Web Analytics | Included in the Privacy transfers confirm above. |

### Umami Cloud (approved, not yet confirmed live)

**Source:** reported by Leo/Bruce, Tyler-approved. Approved as the free Hobby plan, cookieless, for aggregate page views, events and UTM parameters on signup/campaign measurement. Bruce is installing it. The script was **not** on the live site when this draft was written, so the copy says the site is “intended to use” Umami Cloud until installation is confirmed.

Wording is based on Umami’s documentation (security/privacy-by-design page, metric definitions, tracker functions, Cloud FAQ, privacy policy and DPA), not an independent audit:

- Standard analytics do not use cookies, do not track visitors across different websites, do not collect names or email addresses, and do not use the data for advertising, according to Umami.
- Page views include hostname, URL, title, referrer, screen size and browser language. Events can include signup events. UTM parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`) are stored with each event.
- IP addresses are processed transiently for approximate location and anonymous visit grouping, but are not stored as a field in standard analytics records; they may appear in operational or security logs, according to Umami.
- Default Cloud script and endpoint: `cloud.umami.is/script.js` and `gateway.umami.is/api/send`.
- Hobby plan production analytics retention is six months, according to Umami’s Cloud FAQ (backups are separate).
- Umami is described as our processor.
- Optional Umami features (session replay, heatmaps, Distinct IDs) are not described as enabled. If any of those are turned on, this notice must be updated before publish.

| Placeholder or `[confirm…]` item | What’s needed |
| --- | --- |
| `[confirm before publishing: Umami installed and live]` | Confirm the script is actually on the hosted site, then this marker can be removed and “intended to use” can be tightened to “uses”. |
| `[confirm: Umami Cloud hosting region and DPA]` | Which Cloud data region (US or EU) this account uses, signed DPA, and transfer wording. Umami’s FAQ says the region applies to analytics storage and that some operational processing may occur outside it. |
| `[confirm with solicitor: legitimate interests / PECR exemption]` | Same consent/exemption question as Cloudflare Web Analytics, for Umami’s cookieless script. |
| `[confirm with solicitor: whether to rely on Umami’s published retention periods]` | Hobby plan six-month production retention, as published. |

Bump `VT_POLICY_V` before publishing this revised cookie/privacy notice so existing users are asked again.

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

The shared sources table now also lists Cloudflare Web Analytics and Umami Cloud (see [Analytics](#analytics-cloudflare-web-analytics-and-umami-cloud)).

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
