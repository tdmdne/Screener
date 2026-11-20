// shared/market/feedHealth.js — folds per-upstream health into the single provenance the UI badge shows.
//
// Each active upstream (twelvedata, binance) reports one of LIVE / DELAYED / RECONNECTING / UNAVAILABLE.
// Feeds with nothing subscribed are simply left out. The badge state is the worst active feed, so a
// reconnecting crypto stream can never hide behind a healthy FX stream.
import { PROVENANCE } from "../protocol.js";

/**
 * @param {Record<string,string>} feeds   e.g. { twelvedata: "LIVE", binance: "RECONNECTING" } (active feeds only)
 * @param {{hasCache?: boolean}} [opts]   hasCache: the hub holds stored bars it can still serve
 * @returns {string} one of PROVENANCE
 */
export function combineFeedProvenance(feeds, opts = {}) {
  const states = Object.values(feeds || {});
  const hasCache = Boolean(opts.hasCache);
  if (!states.length) return hasCache ? PROVENANCE.CACHED : PROVENANCE.UNAVAILABLE;
  if (states.includes(PROVENANCE.RECONNECTING)) return PROVENANCE.RECONNECTING;
  if (states.includes(PROVENANCE.DELAYED)) return PROVENANCE.DELAYED;
  const live = states.filter((x) => x === PROVENANCE.LIVE).length;
  if (live === states.length) return PROVENANCE.LIVE;
  // some feed is UNAVAILABLE (e.g. no API key): partial coverage if others are live, otherwise cache or nothing
  if (live > 0) return PROVENANCE.DELAYED;
  return hasCache ? PROVENANCE.CACHED : PROVENANCE.UNAVAILABLE;
}
