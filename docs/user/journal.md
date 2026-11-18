# Journal

**Journal** (`#/journal`) is a trade log you keep on this device. It does not connect to a broker. Closed-trade statistics are calculated in the browser from the trades you enter.

## Trades

**Add trade** (or edit an existing one) includes:

- Symbol
- Side — Long (buy) or Short (sell)
- Opened and Closed (datetime; leave Closed empty if the trade is still open)
- Quantity (units, lots or contracts)
- Point value ($ per 1.0 move per unit)
- Entry price, Exit price, Stop price
- Fees and commission ($)
- P&amp;L override ($)
- Account, Setup, Tags
- Notes (optional, up to 2,000 characters)

The page can show an **equity curve**, a **Daily P&amp;L** calendar (month-by-month, with previous/next), and breakdowns **by setup**, **by weekday** and **by side**, plus the trade table.

**Import CSV…** and **Export CSV** sit next to **+ Add trade**. Import reads a UTF-8 CSV of the same columns the export writes (symbol, side, dates, prices, fees, account, setup, tags, notes, and so on). Files larger than 5 MB are rejected.

A **local summary** of the trades in view is produced with fixed, rule-based observations in the browser. Nothing leaves the device for that summary. It is descriptive, not advice.

## Prop challenge tracker

**Prop challenge tracker** lets you add a challenge or funded **account** with rules you type in:

- Account name
- Starting balance ($)
- Profit target (%)
- Max daily loss (%)
- Max drawdown
- An option for trailing drawdown
- Minimum days

Trades logged to that account name are checked against those numbers. The app states that figures are based on the closed trades you have logged, and that open positions and your firm’s exact rules may differ. They are illustrations, not a verdict from the prop firm.

## Journal AI review

This is optional and off until you use it.

You choose a provider and enter **your own API key**. The request goes **from your browser to that provider**. Vektor Terminal has no server in the middle and does not receive the key, the journal data or the reply. You pay the provider on your own account, under that provider’s terms.

**Providers built into the form:**

| Choice | Default endpoint | Default model (if you leave the model blank) |
|---|---|---|
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` |
| Anthropic | `https://api.anthropic.com/v1/messages` | `claude-3-5-haiku-latest` |
| OpenAI-compatible endpoint | A base URL you type (for example `https://example.com/v1`) | You must enter a model name |

Nothing is sent until you enter a key, tick the confirmation, and press **Send**. If you skip either step, the app asks you to enter the key or tick the box. A **See exactly what will be sent** disclosure shows the JSON payload before you send it.

**What is sent** (JSON), for up to the last **200** closed trades in the current journal view:

- Filter period, side, setup, whether the view is limited to one account, and the from/to dates
- Summary statistics: count, net P&amp;L, win rate, profit factor, expectancy, average win/loss, average R, trades with a stop, max drawdown, win/loss streaks
- Totals by setup, weekday and side
- Per trade: close date, symbol, side, P&amp;L, R, setup, tags, optional open date
- **Notes are included only if you tick that option**, and then only the first 500 characters
- Account names are not sent

The provider also sees your IP address, as with any direct browser request. The in-app system prompt instructs the model not to give financial or trading advice, not to recommend trades, and only to describe patterns in the data, in plain British English.

Replies are shown as plain text (HTML is not executed), with the provider name and an advice warning. If the request fails, the app falls back to showing the local summary. Requests time out after 60 seconds.

**Remember the key** stores it in `localStorage` under `vt_aikey~…` (per signed-in account) only if **Optional preferences** is allowed in Cookie settings. Guests cannot have the key remembered. **Forget key**, unticking Remember, or withdrawing Optional preferences deletes it. Otherwise the key stays in memory for this tab only.

> TODO (needs Tyler): confirm these default model names should stay documented for users, or whether support should tell people to check the in-app dropdown at the time they use it (providers can rename models).
