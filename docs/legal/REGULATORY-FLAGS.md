# Regulatory flags (product wording)

Internal note for Tyler. This is not legal advice and is not shown in the app.

Vektor Terminal is a UK-based information and tools product. The legal pages state that it is not investment advice, not a personal recommendation, not FCA-authorised, and not intended as a financial promotion of any particular investment. That intended position needs to stay true of the **product itself**. Disclaimers help, but they do not cure wording that looks like advice or a promotion.

This review is of the live monolith `index.html` (and the Journal AI prompt inlined there; the same prompt also lives in `src/52_jai.js`). Line numbers are from this branch at the time of writing and point at product features, not at the legal pages. **This PR does not change product behaviour or UI copy**, except the legal pages themselves.

## The tests in short

- **FSMA 2000 s.21** — a financial promotion is an invitation or inducement to engage in investment activity, communicated in the course of business, unless an exemption applies or an authorised person approves it. Cryptoasset promotions have additional FCA rules.
- **Regulated Activities Order 2001 art. 53** — advising on investments is a regulated activity where a recommendation, or advice, is given to a person in their capacity as an investor (or potential investor) and is presented as suitable for that person, or based on a consideration of their circumstances (a “personal recommendation”).
- Generic, purely factual information, and rule-based calculations clearly described as such, are less likely to be advice. Rankings, “best”, “signal”, “buy”/“sell”, and an AI review of a person’s own trades are more likely to be read as a recommendation or as a promotion, especially without a nearby qualifier.

`VT_NA_TXT` (index.html:2950) already says scores, P1–P5 tiers and phases “don’t predict prices and aren’t investment advice.” It is reused on the screener, heatmap and session summary. That is useful, but it does not cover every surface below.

---

## 1. P1–P5 presets, Vektor score and tier

- **Location:** `index.html` — `PRESETS` at 1350–1356; `presetInfo()` at 1428; `scoreMarket()` from 1358; `sxTier()` at 3588; preview panel “Vektor score” / “Tier” at 3613–3615; heatmap tooltip “Vektor score” / “Tier” at 3922–3923.
- **Risk:** “P1” (strictest) through “P5” (broadest), a numeric “Vektor score”, and a “tier” for the strictest preset a market “passes” can be read as a quality ranking or as a suggestion of which markets to trade. `presetInfo()` already says a preset “doesn’t rank quality, predict future prices or tell you to trade. Not investment advice.” The score function still ranks the screener (`sort` by `scoreMarket`, around 1344).
- **Mitigation:** Keep the existing `presetInfo` / `VT_NA_TXT` language next to every score and tier, including the heatmap tooltip and any export. Avoid “passes”, “quality”, “strongest” or “best” in labels. If the default sort stays by score, add a short “sorted by a rule-based score, not a recommendation” note in the screener header, not only in the footer.

## 2. “Expansion”, momentum and phase labels

- **Location:** `index.html` — `scoreSymbol()` at 1307–1326 (`phase` values: Expansion, Accumulation, Distribution, Reaccumulation, Retracement, Range, Neutral); Expansion column at 3595; preview panel “Expansion” / “Phase” at 3613; heatmap metric “Momentum (signed expansion)” at 3857 and colour copy at 3905 (“green = rising, red = falling”).
- **Risk:** Labels such as Expansion and Accumulation are terms traders often treat as a cycle “read” or a cue to enter. A signed momentum colour scale can look like a buy/sell heat map.
- **Mitigation:** Keep the definition already used in the sample-mode footnote (1110) and Data modal (2833) next to the column and heatmap: Expansion is a calculation on the last N candles, not a forecast. Prefer “phase label” over any wording that sounds like a regime call. Do not add arrows, “enter” or “setup” language to the phase cell.

## 3. Heatmap rankings

- **Location:** `index.html` — Heatmaps page from 3848; metrics at 3857; grid and colour description at 3900–3905; tooltip with score and tier at 3922–3923.
- **Risk:** A colour-ranked map of “Vektor score” or “momentum” can be read as a list of markets to favour or avoid, which edges toward an invitation to trade those names (s.21) even if no one market is named in marketing.
- **Mitigation:** The footer already includes `VT_NA_TXT` and a link to the risk disclaimer (3905). Keep that visible on first paint (not only after a metric change). Do not title the page or a share/export as “best opportunities” or similar. Consider a default metric of “% change” rather than score.

## 4. “Buy”, “sell”, “signal”, “setup”, “best”

- **Location:** Decorative chart **BUY / SELL** buttons at `index.html` 1745–1748, toggled by `C.showBuySell` and the “Buy/sell buttons” checkbox at 2399. They are painted on the chart and have no trade-execution handler in this file. Journal “setup” is a user-entered tag on a trade (for example the Journal AI payload at 4763). “Top gainers” / “Top losers” appear in the session summary at 4145–4146 and 4128–4129. No product string was found that says “buy now”, “sell now”, or “signal to trade” in the live UI, other than the legal risk page (which already says scores are not signals to trade) and the leftover word “signals” that this PR removes from legal copy.
- **Risk:** BUY/SELL buttons in the same style as a dealing platform are a high-visibility inducement risk, even if they do nothing. A user-typed “setup” name is the user’s own label, which is lower risk if the app does not generate setup names. “Top gainers” is market-move reporting; risk rises if it is styled as a trade list.
- **Mitigation:** In a product PR, either remove the BUY/SELL buttons, or clearly label them as non-functional (or wire them only through a regulated broker with the right warnings). Do not add app-generated “setup” or “signal” names. Keep “Top gainers/losers” as a description of past % change, with the existing `VT_NA_TXT` line (already at 4148).

## 5. Alerts session summary

- **Location:** `index.html` 4091–4161 — `vtSumText`, `vtSumM`, header “Today” button, and the 21:00 chip “Today’s session summary is ready.” Paper P&amp;L of long/short drawings, “Closed today”, “Open now”, top gainers/losers, watchlist moves, and alerts triggered. Qualifiers: “Paper results of your long/short position drawings… Not trades with a broker” (4144); “Rule-based figures from past prices; not investment advice” (4131); `VT_NA_TXT` (4148).
- **Risk:** A daily recap of P&amp;L, “wins”, and top movers can look like a trading performance report or an implicit prompt to act on the movers. If a user forwards the downloaded `.txt` (4134, 4153–4154), it can travel without the on-screen disclaimer.
- **Mitigation:** Keep the paper-trading and not-advice lines in the modal **and** at the top of the copied/downloaded text (the text file already ends with a short not-advice line; moving that sentence to the top, and adding “not a recommendation”, would be stronger). Avoid “wins”, “session result” or “you should have” language. Do not auto-suggest opening the top gainers.

## 6. Journal AI review

- **Location:** `index.html` — system prompt `JAI_SYS` at 4708–4711 (same text in `src/52_jai.js` at 34–37); disclosure at 4763; output header at 4787; pattern warning `JAI_ADVICE` at 4786–4787. The prompt already forbids financial, investment or trading advice, buy/sell/hold recommendations, entries, exits, size, leverage, price predictions, and naming instruments to trade. It asks for patterns and up to three “neutral questions”. A regex flags some advice-like replies and shows a warning, but it is narrow (for example it would miss “consider going long” or “I would tighten the stop”).
- **Risk:** The model is reviewing **that user’s** journal. A reply that then suggests what to do next is much closer to a personal recommendation (RAO art. 53) than a generic score. The app cannot guarantee the model will obey the prompt. Vektor does not see the payload, but it still provides the feature and the prompt.
- **Mitigation (prompt guardrail, for a product PR):** Tighten `JAI_SYS` to also forbid implied next trades (“consider”, “next time you should”, position-size or symbol suggestions) and to say that if asked for advice it must refuse. Widen `JAI_ADVICE` accordingly. Keep the on-screen “not financial advice” header on every reply. Do not offer Journal AI as “coaching”, “signals”, or “trade review that tells you what to do”. Optional: a persistent “this is a description of your record, not a recommendation” footer under the output, not only in the header.

## 7. Prop-challenge and back-test performance figures

- **Location:** Calculators — intro at 3793 (“Risk, position size and prop-challenge maths. Prices come from the live feed; nothing here places trades.”); drawdown recovery at 3803; Challenge phase simulator at 3805–3806 and 3743 (“Monte Carlo prop challenge”). Journal “Prop challenge tracker” at 4469–4470 and 4655–4662, including pass/fail against target, daily loss and drawdown. Manual Backtest Bar Replay heading at 5349: “step bar-by-bar, execute manual Long/Short orders with SL/TP, and track live equity.”
- **Risk:** Pass rates, equity curves and “orders” language can be read as a performance representation or as simulated dealing. Hypothetical results are a classic promotion risk if they imply that a user will pass a challenge or that a method works. The legal Risk page already says past performance is not a reliable indicator and that prop-firm figures are illustrative; that text is not next to the calculators or the backtest header.
- **Mitigation:** Surface a short “hypothetical / not a prediction / costs usually ignored / not a trade with a broker” line on the Calculators page, the challenge tracker, and the Backtest header (5349 currently says “execute manual Long/Short orders… track live equity”, which is easy to misread). Prefer “paper orders in this replay” over “execute orders”. Do not market pass rates. The legal Risk page should stay linked from those pages.

## 8. Landing / sign-in marketing copy

- **Location:** `index.html` `vtAuthDecor()` at 3645–3648. Headline: “Every market. One terminal.” Kick line: “Market data terminal.” Body: “Charts, a multi-market screener, alerts and position planning in one dark workspace. Prices can be delayed; nothing here is investment advice.” Bullet: “Drawing tools, alerts and long/short planning.”
- **Risk:** “Every market” is a broad claim (coverage depends on the provider, which the first bullet already qualifies). “Position planning” and “long/short planning” can sound like trade recommendations or dealing services, especially next to a sign-in screen. The “not investment advice” clause in the same paragraph is helpful.
- **Mitigation:** Soften “Every market” if coverage is limited. Prefer “paper position planning” or “chart planning tools” over “position planning”. Keep the not-advice sentence in the hero, not only in the footer. Do not add testimonials, profit claims, “win rate”, or “beat the market” copy to this screen or to any later marketing site. Crypto-specific advertising would also need to meet the FCA’s crypto financial-promotion rules if it invites someone to invest in cryptoassets.

---

## Already in better shape (for context)

- Screener, heatmap and session-summary footers reuse `VT_NA_TXT` and link to `#/legal/risk`.
- `presetInfo()` and `evcInfo()` (1428–1429) already say “Not investment advice.”
- Journal local summary: “These are descriptions of your record, not advice.”
- Footer risk warning is always visible on the main app.
- The app does not place live broker orders; calculators say “nothing here places trades.”

These reduce risk; they do not remove the flags above.

## Suggested order of work (separate product PR)

1. Relabel or remove the decorative BUY/SELL buttons (highest visual risk).
2. Tighten Journal AI prompt + detection regex, and keep a visible not-recommendation line on the output.
3. Put a short hypothetical-results / paper-trading note on Backtest, Calculators and the prop tracker.
4. Soften landing “position planning” / “Every market” if needed.
5. Make sure score, tier, phase and heatmap surfaces all keep `VT_NA_TXT` (or equivalent) in view, including exports.
