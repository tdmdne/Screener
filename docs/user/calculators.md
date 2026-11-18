# Calculators

**Calculators** (`#/calc`) is a page of seven tools. They use figures you type, and (where needed) a latest known price already in the screener or candle cache. They do not place orders. Results are illustrations, not broker tickets or prop-firm decisions.

The seven headings in the app are:

1. **Account** — account-level inputs used by the other tools (for example account size and risk). Defaults in the code include an account size of 100,000 and a risk of 0.5%.
2. **Forex / metals position size** — position size in lots for a forex or metals pair, from a stop in pips and the account risk. Metals recognised from a six-letter symbol are XAU and XAG (contract sizes 100 and 5,000, pip sizes 0.1 and 0.01). Other six-letter FX symbols use a 100,000 contract and a 0.0001 pip, or 0.01 if the quote is JPY.
3. **Futures contracts** — a contract count from a stop in ticks (the default example is ES with a 16-tick stop). The contract list in the app is: ES, MES, NQ, MNQ, YM, MYM, RTY, M2K, CL, MCL, NG, GC, MGC, SI, HG, ZN, ZB, 6E, 6B, 6J and 6A, each with its tick size and tick value (for example ES is 0.25 / $12.50; MES is 0.25 / $1.25).
4. **Pip &amp; tick value** — value per pip (or per 10 pips) and related size figures for a chosen symbol and lot or contract count.
5. **Drawdown recovery** — how much gain would be needed to recover a given drawdown.
6. **Multiple prop accounts** — the same style of risk/size math across more than one account (the page starts with two example accounts).
7. **Challenge phase simulator** — a repeated simulation of a prop-style challenge, using inputs such as profit target, max drawdown, daily drawdown, risk per trade, win rate, reward:risk, trades per day, maximum days, and optional trailing or fixed drawdown. The default run count in the code is 2,000.

Inputs you change are saved with your other settings on this device (when you are signed in).

Use the **Journal** prop-challenge tracker if you want to compare logged trades against rules; that is a separate page.
