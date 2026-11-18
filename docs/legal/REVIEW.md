# Tyler sign-off checklist

These in-app pages (`#/legal/*`) are written to stand on their own. Tyler is the reviewer who signs them off before publishing. They describe what the code actually does, under UK GDPR / DPA 2018, PECR, the Consumer Contracts Regulations 2013, the Consumer Rights Act 2015, and (for paid plans at the intended 1 March 2027 launch) the Digital Markets, Competition and Consumers Act 2024 subscription-contract rules.

The live wording is in `index.html` (the “Legal pages” and “UK GDPR” blocks). Keep `src/90_legal.js` and `src/91_privacy.js` in sync with the same edits. **Do not invent company or commercial facts to fill a placeholder.** Leave a highlighted `[…]` until the real fact is known.

Related: `docs/legal/REGULATORY-FLAGS.md` lists product-wording risks (FSMA s.21 / RAO art. 53 / crypto financial promotions). Those flags are for a later product pass; this PR changes legal copy only.

Known facts already filled in (do not replace with guesses):

- Contact email: `vektorhq@proton.me`
- The service is currently free. Nothing is charged until paid plans go live.
- Intended launch prices (still marked `[confirm before launch]`): Pro £11.99/month or £109/year ($14.99/month or $135/year); Elite £24.99/month or £219/year ($29.99/month or $269/year). GBP prices include 20% VAT. USD tax treatment is not stated as fact; it is marked `[confirm: USD tax treatment / merchant of record]`. The currency is shown at checkout.
- At launch, a 7-day free trial is offered on Elite only (card required up front; auto-converts to paid Elite at the end of day 7 unless cancelled). Tyler confirmed (relayed by Bruce, 18 November 2026): one trial per person, checked by card and by email, with plus-tags removed on every domain; if a card has already had a trial, the new trial is cancelled with no charge and Elite is offered without a trial; if someone cancels during the trial, they keep Elite until the trial ends and are never charged.
- Required market-data attribution: “Data provided by Twelve Data,” plus credits and terms links for the other live vendors. Twelve Data prices and candles are fetched server-side via the team’s `vektor-market` Worker (`vektor-market.tdmltd2026.workers.dev`). The browser does not open a WebSocket to `ws.twelvedata.com`. Leftover `vt_tdkey~` helper code remains in `index.html` (see pre-publish checks); the legal storage row was therefore not removed.
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
| `[Payment provider, e.g. merchant of record, confirm]` | The payment provider or merchant of record that will actually take payment. Do not name a provider until that is chosen. It is also named in the Privacy Policy as the processor that supplies the card identifier or fingerprint for trial-eligibility checks. |
| `[confirm: USD tax treatment / merchant of record]` | How USD prices are taxed (for example sales tax, or tax included), and who the merchant of record is for USD. Do not claim a VAT or sales-tax treatment that has not been confirmed. Still open. |
| `[confirm: retention period for trial-eligibility records]` | How long card-identifier/fingerprint and normalised-email records used to enforce one trial per person are kept. |
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

3. **Checkout waiver tick-box (product requirement).** See also “Product requirements for Dex” below. For immediate access during the 14-day cooling-off period (including during an Elite trial), checkout must capture, and keep a record of, the user’s express request to start the service early (CCR regulation 36) and, for digital content, express consent plus an acknowledgement that the right to cancel that digital content will be lost (CCR regulation 37). The legal pages describe this; the product does not yet implement it. Do not offer immediate access without that tick-box and acknowledgement.

4. **Account billing / cancel path.** The pages point at `[Account → Billing page]`. That page (or an equivalent cancel flow that is as easy as sign-up) must exist before paid plans and the Elite trial go live, including confirmation by email, and must work during the trial so that a user who cancels during the trial keeps Elite until the trial ends and is never charged.

5. **Simulated prices.** Legal copy already warns that `/api/candles` may return unlabelled synthetic bars when a live feed is unavailable. The product UI still does not label those bars. Labelling them in the chart is a product change (not this PR) and should be done before launch.

6. **Vendor licences (not just attribution).** Attribution is in the Data Sources page. Before launch, confirm the commercial licence actually covers paid use and public display, especially: Twelve Data’s plan and “Data provided by Twelve Data” (with a dofollow link) next to the data, not only on the legal pages; Binance terms on commercial use of market data; CoinGecko API plan and credit; Finnhub and Polygon plans if user keys or a house key are used in a commercial product; Dukascopy historical data (often personal / non-commercial, and some older terms asked for a “Dukascopy Datafeed” credit); Forex Factory / Fair Economy calendar redistribution limits. This is a licence check, not a wording guess.

7. **Financial-promotion flags.** Read `docs/legal/REGULATORY-FLAGS.md` and decide which product-copy mitigations to apply in a separate PR. Legal disclaimers alone may not be enough if the product itself looks like a personal recommendation or a financial promotion (FSMA s.21, RAO art. 53, and the crypto financial-promotion rules).

8. **Leftover Twelve Data key helpers.** TASK-02 routes Twelve Data through the `vektor-market` Worker and removes the Settings key field (`id="d_k"` is gone; `pumpTD` / live prices use `VT_TD_PROXY`). But `index.html` still contains `vtTdKeyName` / `vtTdKey` / `vtTdKeySet`, which read and write `vt_tdkey~` in localStorage, plus a consent listener and a boot migration path. The legal `vt_tdkey~` storage row was therefore **not** removed. Clean up that leftover product code in a separate PR, then drop the row (and the consent-banner mention in `src/91_privacy.js`) if nothing still reads or writes the key.

9. **Re-check DMCC commencement before launch.** As at 18 November 2026, Part 4, Chapter 2 was not yet in force (see the commencement note below). Confirm that the Act chapter and the implementing regulations have actually been made and commenced before paid plans and the Elite trial go live, and update the in-app wording if the final rules differ from the draft.

10. **Fill every remaining `[…]` placeholder** listed above, or the pages will still show highlighted gaps.

11. **Set the effective date and publish.** Once the facts are filled and the checks above are done, the pages are ready for Tyler’s sign-off. There is no solicitor review step.

---

## Free-tier features (do not invent a list on the legal pages)

The in-app Terms, Refunds and other legal pages do **not** currently list Free / Pro / Elite feature limits, and this PR does not add a feature list. Tyler’s confirmed Free-tier spec (relayed by Bruce), for if and when product or legal copy describes plan features, is:

- 3 charts
- full, unrestricted backtesting and bar replay
- heatmaps
- an unlimited journal (no trade cap)
- 3 indicators, with Vektor Script indicators counting toward the 3
- 3 alerts
- live crypto and delayed stocks/FX

If a feature list is added later, it must match this exactly. There must be no journal-trade cap and no statement that the backtester is limited on Free.

---

## DMCC Part 4, Chapter 2 — commencement status (as at 18 November 2026, Europe/London)

The subscription-contract rules sit in **Part 4, Chapter 2** of the Digital Markets, Competition and Consumers Act 2024 (sections 253 to 281), not Chapter 3. An earlier draft of these pages mis-cited the chapter; that is corrected.

**Not in force today.** legislation.gov.uk marks the chapter as prospective. Sections 254 (meaning of “subscription contract”), 259 (reminder content and timing), 264 (right to cancel during cooling-off) and 265 (initial and renewal cooling-off periods) are each noted as “not in force at Royal Assent, see s.339(1)”:

- Chapter: https://www.legislation.gov.uk/ukpga/2024/13/part/4/chapter/2
- s.254: https://www.legislation.gov.uk/ukpga/2024/13/section/254
- s.258 (reminder notices; in force at Royal Assent only for specified, typically regulation-making, purposes — s.339(2)(c)): https://www.legislation.gov.uk/ukpga/2024/13/section/258
- s.259: https://www.legislation.gov.uk/ukpga/2024/13/section/259
- s.264: https://www.legislation.gov.uk/ukpga/2024/13/section/264
- s.265: https://www.legislation.gov.uk/ukpga/2024/13/section/265

The Digital Markets, Competition and Consumers Act 2024 (Commencement No. 3 and Transitional Provisions) Regulations 2026 (SI 2026/284) brought **Chapter 4** (ADR) into force on 6 April 2026, not Chapter 2: https://www.legislation.gov.uk/uksi/2026/284

No made commencement instrument was found that brings section 254 or the rest of Chapter 2 into force.

**Intended start: 1 January 2027, for new contracts, subject to the draft instruments being made and Chapter 2 actually being commenced.**

- GOV.UK, 9 August 2026 (Prime Minister’s Office): the rules “will now come into force in January 2027” (brought forward from the earlier spring 2027 plan): https://www.gov.uk/government/news/pm-starts-roll-out-of-everyday-fixes-on-the-cost-of-living-ending-rip-off-discounts-and-subscription-traps
- Earlier GOV.UK / DBT notice, 2 April 2026, had said the measures were “expected to be in Spring 2027”: https://www.gov.uk/government/news/consumers-to-save-around-400-million-every-year-from-government-crackdown-on-costly-subscription-traps
- The Consumer Subscription Contracts (Cancellation and Information) Regulations 2026 are still **draft** legislation (not yet made) on legislation.gov.uk. They would come into force on 1 January 2027 and “apply only to a subscription contract entered into on or after section 254 of the DMCCA comes into force”: https://www.legislation.gov.uk/ukdsi/2026/9780348287912
- A related draft consequential-amendments SI is also marked as coming into force on 1 January 2027 and is not yet made: https://www.legislation.gov.uk/ukdsi/2026/9780348287929
- DBT *Draft Guidance on Consumer Subscription Contracts* (October 2026) states that the subscription rules apply to contracts entered into on or after 1 January 2027, that Part 4, Chapter 2 “has been passed by Parliament and received Royal Assent but is not yet in force,” and that the draft regulations “must be approved by Parliament before they can come into force.” It also says that, for subscription contracts the DMCCA covers, those rules **replace** the CCR 2013 requirements on pre-contract information and cooling-off cancellation: https://assets.publishing.service.gov.uk/media/6acf97da2de3184ccf8b814e/subscription-contracts-rules-guidance.pdf

The intended paid-plan launch is 1 March 2027, so if commencement proceeds as announced, Chapter 2 **would** apply to new Elite trials and paid plans. The in-app pages are drafted to comply with the Act and the draft regulations as they stand, and they state the commencement caveat. Re-check before launch (pre-publish check 9).

**CCR 2013 and a 7-day trial (in force now, and still relevant).** Regulations 29(2) and 30(2): for a service or for digital content not on a tangible medium, the 14-day cancellation period begins when the contract is entered into and ends at the end of 14 days after that day. Starting an Elite trial with a card and auto-conversion is entering into that contract, so the CCR clock runs from signup, **not** from conversion. After a 7-day trial converts, the **remainder** of that 14-day CCR period still applies; CCR does not give a fresh 14 days at the first charge. Sources: https://www.legislation.gov.uk/uksi/2013/3134/regulation/29 and https://www.legislation.gov.uk/uksi/2013/3134/regulation/30

**What Chapter 2 adds, if and when it applies.** A 14-day initial cooling-off period from entering into the contract (s.265(1)), and a further 14-day **renewal** cooling-off period beginning on the day the consumer first becomes liable for the paid Elite price after the trial ends (a “relevant renewal” after a concessionary period: s.265(2)–(3)(a), s.264). That is a fresh 14 days from conversion. Reminder notices must be given in respect of that first renewal payment (s.258(3)(a)), in a reasonable period specified in the key pre-contract information, in advance of the last date the consumer can cancel to avoid the charge (s.259(3)–(5)), in writing on a durable medium (draft regulation 34). Traders must also give pre-contract information (s.256 / Schedule 23) and an easy online exit.

---

## Product requirements for Dex

The legal pages describe these duties; the product must actually do them before the Elite trial and paid plans go live. This is a product checklist, not in-app copy.

1. **Checkout wording and position.** Before the user starts an Elite trial or a paid plan, checkout must show, clearly and immediately (not only in a footer or a linked document): that this is an Elite 7-day free trial (if that is what they are starting); that a card is required up front; that unless they cancel before the trial ends, it auto-converts to paid Elite at the end of day 7; the amount of the first charge; the currency; the billing period chosen (monthly or yearly); that GBP prices include 20% VAT; and that USD prices are plus any applicable taxes, once that treatment is confirmed. This is key pre-contract information under DMCC s.256 and Schedule 23, and equivalent CCR information until Chapter 2 applies.

2. **Explicit trial-end date at checkout.** Show the calendar date (and time, with time zone) on which the trial ends and the first charge will be taken — not only “after 7 days.”

3. **Confirmation on a durable medium.** After signup, send a confirmation email (or other durable medium) repeating the trial-end date, the amount, currency and billing period of the first charge, how to cancel, and the cooling-off rights. Keep a copy.

4. **Pre-charge reminder emails and timing.** Before an Elite trial converts, send a reminder notice in writing on a durable medium (email is fine if it can be kept). The purpose — that a charge is about to be taken unless they cancel — must be readily apparent (for example, in the subject line). The timing must be the reasonable period specified in the key pre-contract information, in advance of the last date they can cancel to avoid the charge (DMCC s.258(3)(a) and s.259(3)–(5)). The Act does not fix a number of days; it requires a period that is reasonable for informing the consumer and letting them cancel. For a 7-day trial that window is short: disclose the exact reminder timing at checkout, and do not leave it so late that a reasonable person could not cancel in time. A further reminder is required before later renewals (every six months on a monthly plan; extra earlier notice before a 12-month or longer renewal — s.258, s.259(6)–(8)).

5. **Cooling-off notice on conversion.** When Chapter 2 applies, give a cooling-off notice at the start of the renewal cooling-off period (the day the first paid-Elite charge becomes due), on a durable medium, so the user knows they have 14 days from conversion to cancel under s.264–265.

6. **Cancel button / online cancel route.** Cancellation must be as easy as sign-up, including during the trial and after conversion: an online control on `[Account → Billing page]` (or equivalent), without requiring a phone call. If the user cancels during the trial, they **keep Elite until the trial ends** and are **never charged**. Confirm cancellation by email. The model cancellation form in the Refunds page must also be honoured if sent to `vektorhq@proton.me`.

7. **Cooling-off waiver tick-box.** If immediate access to Elite (trial or paid) starts during a cooling-off period, checkout must include an unticked-by-default tick-box for the express request to start the service (CCR reg. 36) and, for digital content, express consent plus acknowledgement that the digital-content cancellation right will be lost (CCR reg. 37). Do not start supply early without it. Record what was ticked and when.

8. **Records.** Keep records of: the pre-contract information shown, the trial-end date displayed, the price, currency and billing period chosen, the waiver tick-box state, the confirmation and reminder and cooling-off notices sent (and when), cancellations, and trial-eligibility checks (normalised email and card identifier or fingerprint, with the retention period once confirmed). These are needed to show compliance, to enforce one trial per person, and to handle refunds.

9. **Normalised-email and card-fingerprint checks.** Enforce one trial per person by (a) a normalised email, with plus-tags removed on every domain so `name+x@domain` counts as `name@domain`, and (b) a card identifier or fingerprint supplied by the payment provider. Do not store card numbers. Apply both checks before a trial starts.

10. **Auto-cancel-and-offer flow.** If the card has already been used for a trial, cancel the new trial with no charge and offer Elite without a trial (paid Elite at the chosen price and billing period, with the usual cooling-off and checkout information).

11. **Access until trial end after cancellation.** If the user cancels during the trial, keep Elite access until the original trial end date and never take a charge. Do not cut off access immediately on cancel, and do not convert the trial to a paid plan.

The legal pages already describe the trial, the first charge at the end of day 7, trial cancellation (including remaining access until the trial ends), the one-trial eligibility rules, the CCR remainder after conversion, and the intended DMCC renewal cooling-off right. They cannot make the product compliant on their own.
