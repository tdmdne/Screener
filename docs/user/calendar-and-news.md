# Calendar and news

**Calendar** (`#/calendar`) is titled **Calendar &amp; News**. It has two cards: an economic calendar and a headlines list. Data is fetched when this page is open.

## Economic calendar

The calendar is loaded first from the app’s own `/api/calendar` endpoint, which reads this week’s schedule from Forex Factory’s Fair Economy feed (`nfs.faireconomy.media`). If that source is what came back, the status can read **Forex Factory**.

If Forex Factory data is missing, the worker fills in a **built-in template week** (`generateWeeklyMacroSchedule` in `worker.js`) and the API source is `macro-schedule`. The Calendar page then labels the status **Macro calendar**. Those events are typical-looking releases with placeholder figures, not a live official calendar. Do not treat “Macro calendar” rows as real prints or forecasts.

You can:

- Filter by impact: **High**, **Medium**, **Low**, **Holiday**
- Search events (for example CPI, PMI, FOMC)
- Choose a **timezone**: your local zone, UTC, New York (ET), London (UK), Tokyo (JST) or Singapore (SGT)
- Tick **Show past**
- Filter by currency
- **Refresh**

A three-bar impact indicator is shown, and actuals can be highlighted as a beat or miss when those figures are present. A note on the page says the weekly macro schedule is synchronised in 15-minute intervals and that times follow the selected timezone.

If the backend is unavailable, the browser may try the Fair Economy URL through the app’s proxy as a fallback.

## Headlines

**Headlines** are title-and-link items from **Yahoo Finance RSS**, normally requested via `/api/news?symbol=…`. You pick the symbols. Articles open on the publisher’s site, not inside Vektor Terminal. A note on the page states that sourcing. You can refresh the list.

The in-app Data Sources page lists the same two vendors for this screen: Forex Factory (Fair Economy) and Yahoo Finance RSS.
