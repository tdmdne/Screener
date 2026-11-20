// shared/constants.js — used by BOTH worker/ and client/ (plain ES module, no deps).

export const ASSET = Object.freeze({ FX: "FX", CRY: "CRY", STK: "STK", IDX: "IDX", FUT: "FUT", OTHER: "OTHER" });

/** Timeframe label -> seconds. */
export const TF_SECONDS = Object.freeze({
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
  "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800,
});

/** Timeframe label -> provider interval strings. */
export const TF_BINANCE = Object.freeze({
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w",
});
export const TF_TWELVE = Object.freeze({
  "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h", "4h": "4h", "1d": "1day", "1w": "1week",
});

/** Wide sanity outlier filter: drops only single-tick spikes > 5% off the last valid price. */
export const HARD_JUMP_PCT = Object.freeze({
  FX: 5, IDX: 5, FUT: 5, OTHER: 5,
  CRY: 5, STK: 5,
});

/** Hub / transport limits. */
export const MAX_SYMBOLS_PER_CLIENT = 50;
export const MAX_UPSTREAM_SYMBOLS = 100;
export const HUB_FLUSH_MS = 100;        // server batches ticks and pushes at most every 100 ms
export const CLIENT_RING_SIZE = 4096;   // ticks held between animation frames
export const WS_PING_MS = 25000;

/** Wire protocol version (bump on breaking changes). */
export const PROTOCOL = 1;
