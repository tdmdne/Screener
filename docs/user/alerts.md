# Alerts

**Alerts** on the chart toolbar opens **Price Alerts**. You can also get to an alert from a horizontal line on the chart.

These are **price-crossing alerts** checked in the browser. Nothing is sent to a Vektor server when an alert fires. Guests who try to add an alert are asked to sign in so the alert can be saved on this device.

## Creating and editing

To add an alert you need a **symbol** and a **price**, and a **condition**:

- **Crossing up** — the price moves from below the level to at or above it
- **Crossing down** — the price moves from above the level to at or below it
- **Crossing** — either direction

The first tick after you add an alert sets a baseline and does not fire. After that, a cross of the level marks the alert as **triggered**. You can **Re-arm** it, **Edit** it, or delete it.

**Edit** lets you change the price and condition (that re-arms the alert and resets the baseline) and add a **message** of up to 300 characters, shown when it fires. The symbol cannot be changed in the edit dialog.

Active alerts can be drawn on Workspace and Supercharts panes.

A log of alerts that have triggered is kept with your settings (the legal storage table describes the last 200). **Today’s session** (the **Today** header button, or **More → Tools** on a phone) counts today’s alerts and lists them with the rest of the day’s summary. See [Workspace and charts](workspace-charts.md#todays-session).

## Notifications and sound

When you add an alert, if the browser has not yet asked, the app requests permission to show desktop notifications. A fired alert shows an on-page toast and, if permission was granted, a notification titled “Vektor Alert”.

An optional **sound** is off by default. It is a short two-note chime generated with the Web Audio API (no audio file is downloaded). Volume can be low, medium or high. Turning the sound on works for the current tab immediately; it is only remembered on this device (`vt_prefs`) if you have allowed **Optional preferences** in the storage banner. Withdrawing that choice deletes the saved preference.

If an alert you expected did not fire, typical causes are: the tab was not open (alerts are checked in this browser, not on a server); the condition never crossed from the last seen price; the alert had already triggered and was not re-armed; or you were in guest mode and the alert was not saved.
