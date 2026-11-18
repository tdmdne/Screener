# Getting started

This page is a short tour of Vektor Terminal as it works today. The app runs entirely in your browser. It does not place trades or connect to a broker.

## Sign-in and guest mode

When you first open the app you see a sign-in card: **Username or email**, **Password**, and **Keep me signed in on this device**.

The sign-in screen is a prototype. It is **not** connected to a server. The app accepts any username or email plus any password, then remembers only the username or email on this device. **The password is not stored and is not sent anywhere.** The card itself says “Prototype: sign-in isn’t connected to a server yet,” and the decorated form adds: “Demo sign-in: accounts aren’t connected to a server yet. Only your username is kept on this device.”

If the username looks like an email (it contains `@`), the app checks that it uses only letters, digits and `! * + - = ? ^ _ . @`, and that the address is structurally valid. Plain usernames are unchanged. This check runs in the browser only.

**Keep me signed in on this device** stores the name in `localStorage` (key `scr2a`) so it survives closing the tab. If you leave that box unticked, the name is kept in `sessionStorage` and is cleared when the tab closes. **Log out** removes it.

Because any password works and nothing is checked on a server, this does not protect your work on a shared computer. Anyone who types the same username can open that username’s locally saved work.

### Guest mode

Under the sign-in button is **Continue without signing in**. The note beneath it says: “Guests can use the charts and screener. Nothing you do as a guest is saved after you close the tab.”

That is accurate: in guest mode the app does not write your settings to `localStorage`. If you try to add an alert or open chart **Settings**, you are asked to sign in to save that work, with the option to keep exploring instead.

A guest who later signs in keeps the current session and, if that username already has saved work on this device, is asked whether to open the saved work or keep the current session and save over it.

Signing in as a guest for this tab is remembered in `sessionStorage` (`vt_guest`) so a reload stays in guest mode until the tab is closed.

> TODO (needs Tyler): whether guest mode and the prototype sign-in (no server, password not stored) will still be the launch behaviour, or will be replaced by a real account system.

## Storage on this device

On a first visit a banner titled **Storage on this device** explains that settings, alerts and the sign-in name are kept in the browser because the app cannot work without them. **Reject all** and **Accept all** are equal choices; **Manage choices** lets you turn optional items on or off (they start off).

- Strictly necessary storage (settings, watchlist, alerts and so on) is always used.
- **Market-data cache** (IndexedDB) and **Optional preferences** (for example the alert sound, or remembering a Twelve Data or Journal AI key) stay off until you accept them.
- Analytics and advertising are labelled **Not used**.

You can change this later with **Cookie settings** in the footer, or from **Your data** in the legal pages. See [Data and settings](data-and-settings.md#storage-and-consent).

## Layout

The top bar has the Vektor Terminal mark, a page switcher, a symbol search box, and buttons for **phone**, **tablet** and **PC** layout. If you do not pick a layout, the app chooses one from the window width: phone below 700px, tablet below 1,100px, otherwise PC.

The pages in the navigation are:

- **Workspace** — watchlist and screener list on the left, chart on the right (on a wide layout)
- **Supercharts** — a full-width chart, with an optional second pane
- **Screener** — a full-width market table
- **Heatmaps**, **Calendar**, **Journal**, **Calculators**, **Backtest**

On a phone, the bottom tab bar shows Workspace, Supercharts, Screener, Calculators and **More**. The More sheet includes:

- **Pages:** Heatmaps, Calendar, Journal and Backtest
- **Tools:** **Today’s session**
- **Legal and privacy:** Risk disclaimer, Privacy, Your data, all legal pages, and **Cookie settings**
- **Layout:** Auto, or Desktop layout
- a short data-status line, when the header has one

The header also has a **Today** button (Today’s session summary) and a dark/light theme toggle. If you have not chosen a theme, the app follows the system colour scheme.

A footer on every page includes a short risk warning and links to the legal pages.

## Your first chart

1. Open **Workspace** (or click a symbol in the list).
2. Use the symbol button on the chart toolbar, or start typing a name, or press **Ctrl+K** (Cmd+K on a Mac), to search. Intervals can be typed as a number (for example `15` or `4H`).
3. Pick a timeframe from the interval control. The app lists intervals from 1 second up to 12 months.
4. **Indicators**, **Alerts**, **Settings**, the camera button (chart snapshot) and the watchlist **star** are on the same toolbar, together with **+ Watchlist** and **Locate in Screener** once that header has loaded. **Scripts** opens the Vektor Script editor. You can also add a **custom interval** from the interval menu.
5. The note under the chart reads “Live data.” or “Sample data.” Indicators are calculated on those candles.

A default Workspace chart includes two EMAs (length 10 and 20). See [Workspace and charts](workspace-charts.md) and [Indicators](indicators.md).

## Watchlist and screener

The left column of Workspace has your **Watchlist** (your own symbols, in sections) and the **screener list** (the market universe, with search, asset-class filter and P1–P5 presets). They are separate. New guests, and accounts with no saved work yet, may see a short **starter list**. See [Watchlists](watchlists.md) and [Screener](screener.md).

## Adding a data key

Open **Data** (next to the list search on Workspace or Screener). You can enter:

- a **Twelve Data** key (your own, from twelvedata.com) for forex, stocks, indices, ETFs and futures
- a **Finnhub** key (optional stocks fallback)
- a **Polygon** key (optional stocks fallback)

Crypto charts use Binance public data and do not need a key. Tick **Offline sample data instead** to use simulated prices rather than live feeds. If you stay in live mode but no Twelve Data key is available to the backend, non-crypto charts may still show generated prices without being labelled as sample data. Details, including leftover “Yahoo” wording you may still see in Data, are in [Data and settings](data-and-settings.md).

## Next steps

- Draw on a chart and learn the shortcuts: [Workspace and charts](workspace-charts.md)
- Write a custom indicator: [Vektor Script](vektor-script.md)
- Log trades: [Journal](journal.md)
