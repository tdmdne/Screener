# Tyler sign-off checklist

These in-app pages (`#/legal/*`) are written to stand on their own. Tyler is the reviewer who signs them off before publishing. They describe what the code actually does, under UK GDPR / DPA 2018, PECR, the Consumer Contracts Regulations 2013, the Consumer Rights Act 2015, and (for paid plans at the intended 1 March 2027 launch) the Digital Markets, Competition and Consumers Act 2024 subscription-contract rules.

The live wording is in `index.html` (the “Legal pages” and “UK GDPR” blocks). Keep `src/90_legal.js` and `src/91_privacy.js` in sync with the same edits. **Do not invent company or commercial facts to fill a placeholder.** Leave a highlighted `[…]` until the real fact is known.

Related: `docs/legal/REGULATORY-FLAGS.md` lists product-wording risks (FSMA s.21 / RAO art. 53 / crypto financial promotions). Those flags are for a later product pass; this PR changes legal copy only.

Known facts already filled in (do not replace with guesses):

- Contact email: `vektorhq@proton.me`
- The service is currently free. Nothing is charged until paid plans go live.
- Intended launch prices (still marked `[confirm before launch]`): Pro £11.99/month or £109/year; Elite £24.99/month or £219/year; GBP including 20% VAT.
- Required market-data attribution: “Data provided by Twelve Data,” plus credits and terms links for the other live vendors.
- The hosted site at https://screener-cso.pages.dev/ is on Cloudflare Pages and serves a Cloudflare Web Analytics beacon (`static.cloudflareinsights.com/beacon.min.js` with `data-cf-beacon`), injected at Cloudflare’s edge, not in this repository.
- Umami Cloud (free Hobby plan, cookieless) has been approved as a second analytics provider for aggregate page views, events and UTM signup/campaign measurement. Source: reported by Leo/Bruce, Tyler-approved. Bruce is installing it; confirm it is live before publishing.

Lawful bases, PECR for cookieless analytics (with a short legitimate-interests balancing note), controller/processor roles, CCR regulations 36 and 37 (not a solicitor waiver of digital content — regulation 37 is the digital-content rule; regulation 36 is services), the model cancellation form, and Consumer Rights Act remedies are written into the pages as standard positions. They are no longer marked for a solicitor.

---

## Fact placeholders still to fill

Shown highlighted in the app. Fill the real value, then remove the brackets.

### Every legal page (header)

| Placeholder | What’s needed |
| --- | --- |
| `[Effective date]` | The date these pages go live (launch is planned for 1 March 2027). |
| `[Company legal name]` | The registered legal name of the operator. |
| `[Registered address]` | The registered office address. |
| `[Company number]` | Companies House number, if incorporated. |

### About

| Placeholder | What’s needed |
| --- | --- |
| `England and Wales [confirm]` | Confirm the company is registered in England and Wales, or replace this if it is registered elsewhere. |
| `[VAT number, if registered]` | The VAT number, or “Not VAT registered” if that is the case. “Including 20% VAT” on the prices should only stay if VAT is actually accounted for at launch. |
| `[ICO registration number]` | The ICO registration number, once registered. Register if the ICO’s fee/registration rules apply to this operator. |

### Terms, Refunds, Privacy, Cookies, Data Sources

| Placeholder | What’s needed |
| --- | --- |
| `[Website URL]` | The public site URL. |
| `[confirm before launch]` (prices and renewal reminders) | Confirm Pro / Elite prices, that they include 20% VAT, and the renewal-reminder wording, before launch. |
| `[Payment provider, e.g. merchant of record, confirm]` | The payment provider or merchant of record that will actually take payment. Do not name a provider until that is chosen. |
| `[Account → Billing page]` | The real in-app path (or URL) for cancelling a paid plan, once that page exists. |
| `[confirm: Umami Cloud hosting region and DPA]` | The Umami Cloud region chosen at setup, and that a DPA is in place. |
| `[confirm before publishing: Umami installed and live]` | Confirm the Umami script is on the live hosted site, then remove this marker. |
| `[transfer mechanism, e.g. UK adequacy regulations or the UK International Data Transfer Agreement / Addendum]` | The transfer tool actually used with each processor that handles personal data outside the UK. |
| `[Hosting log retention period]` | How long Cloudflare (or any other host) keeps server or security logs. |
| `[Correspondence retention period]` | How long emails and rights requests are kept. |

### Accessibility

| Placeholder | What’s needed |
| --- | --- |
| `[5 working days]` | The reply-time commitment, or a different figure if you prefer. |
| `[date]` | The date the accessibility statement was prepared. |
| `[self-assessment / third-party audit]` | How it was checked. |
| `[Accessibility audit pending]` | Replace or remove once an assessment has been done. |

---

## Pre-publish checks

1. **Umami is live.** Confirm `cloud.umami.is/script.js` (or the approved snippet) is on the hosted site, then remove `[confirm before publishing: Umami installed and live]` from Privacy, Cookies, Data Sources and the consent banner if it is still there.

2. **Bump `VT_POLICY_V`** in `src/91_privacy.js` and the matching block in `index.html` when these pages first go live, and again after any later material change to storage, cookies or the privacy notice, so every user is asked for their storage choices again.

3. **Checkout waiver tick-box (product requirement).** For immediate access to a paid plan during the 14-day cooling-off period, checkout must capture, and keep a record of, the user’s express request to start the service early (CCR regulation 36) and, for digital content, express consent plus an acknowledgement that the right to cancel that digital content will be lost (CCR regulation 37). The legal pages describe this; the product does not yet implement it. Do not offer immediate access without that tick-box and acknowledgement.

4. **Account billing / cancel path.** The pages point at `[Account → Billing page]`. That page (or an equivalent cancel flow that is as easy as sign-up) must exist before paid plans go live, including confirmation by email.

5. **Simulated prices.** Legal copy already warns that `/api/candles` may return unlabelled synthetic bars when a live feed is unavailable. The product UI still does not label those bars. Labelling them in the chart is a product change (not this PR) and should be done before launch.

6. **Vendor licences (not just attribution).** Attribution is in the Data Sources page. Before launch, confirm the commercial licence actually covers paid use and public display, especially: Twelve Data’s plan and “Data provided by Twelve Data” (with a dofollow link) next to the data, not only on the legal pages; Binance terms on commercial use of market data; CoinGecko API plan and credit; Finnhub and Polygon plans if user keys or a house key are used in a commercial product; Dukascopy historical data (often personal / non-commercial, and some older terms asked for a “Dukascopy Datafeed” credit); Forex Factory / Fair Economy calendar redistribution limits. This is a licence check, not a wording guess.

7. **Financial-promotion flags.** Read `docs/legal/REGULATORY-FLAGS.md` and decide which product-copy mitigations to apply in a separate PR. Legal disclaimers alone may not be enough if the product itself looks like a personal recommendation or a financial promotion (FSMA s.21, RAO art. 53, and the crypto financial-promotion rules).

8. **Fill every remaining `[…]` placeholder** listed above, or the pages will still show highlighted gaps.

9. **Set the effective date and publish.** Once the facts are filled and the checks above are done, the pages are ready for Tyler’s sign-off. There is no solicitor review step.
