# STATE: Vektor Terminal (update after every completed step; 1 line each)

**Now (18 Nov 2026, 22:05 GMT):**
- The app is live at screener-cso.pages.dev; launch is 1 March 2027.
- Tyler's **Zero Frontend Logic** mandate is adopted (`AGENTS.md` §0). We're building the backend pipeline from Task 1 (`docs/architecture/TASKS.md`).
- Tests: 37 of 42 pass. 5 real bugs are left: a11y/minicharts labels, mobile `#vnav` overflow, motion, postool.

## Done
- Legacy TASK-01 shared catalogs/normalizer; TASK-06 starter watchlist + ★/+Watchlist/Locate (`143f02a`).
- vektor-market Worker live; the Twelve Data key is server-side only (`936013f`).
- Public-file allowlist: repo internals return 404 (PR #12, `8241661`).
- KB fixes, pricing and Free tier (PRs #9, #10, #11); Free = 3 charts/3 indicators (VS counts)/3 alerts; backtesting, replay, heatmaps and the journal are unlimited.
- PR #8 final UK legal pages merged as `ce4cae4`.
- PR #13 test fixes merged as `c2bea20` (37/42 passing).
- PR #14 Elite trial eligibility in the legal pages + btRun notes (`fb0d608`).
- Backend-mandate audit + backend-first task list + compact AGENTS.md (this PR).

- 18 Nov: AGENTS.md §6 Institutional UI/UX standard + recurring UI Audit phase (TradingView/Tradovate/FX Replay benchmark).

## Elite trial rules (Tyler, confirmed)
- 7 days, Elite only, card upfront, converts to paid after 7 days.
- One trial per person. A card that already had a trial gets no trial and is offered Elite without one.
- Cancelling during the trial keeps Elite until the trial ends, with no charge.
- Emails are normalised by removing `+tags` on every domain before the one-per-person check.

## Next
- Task 1: bring vektor-market into `workers/market/` (Claude Sonnet, after the 00:40 GMT Claude reset).
- First UI Audit pass (Claude Sonnet + Playwright) → `docs/ui/AUDIT-2026-11-19.md`.
- Fix the 5 failing test bugs (Mara).
- Accounts (Dex, legacy TASK-04 = ACC dependency).
- Tyler decisions D1–D8 (`docs/architecture/AUDIT.md` §4): crypto source, Workers Paid, TD Venture timing.
