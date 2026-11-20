// TASK-01 unit checks: shared catalogs, interval maps and symbol normalizer.
// Run: node tests/shared.test.mjs   (or: bun run test:shared)
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { INTERVAL_SECONDS, BINANCE_INTERVALS, TWELVEDATA_INTERVALS, YAHOO_INTERVALS } from "../shared/intervals.js";
import { BASE_INSTRUMENTS, INSTRUMENT_BY_SYMBOL, DUKASCOPY_MAP, FUTURES_TO_TWELVEDATA, BINANCE_MIRRORS, STABLE_RE } from "../shared/instruments.js";
import { normalizeSymbol, resolveTdSymbol, inferMeta } from "../shared/symbolNormalizer.js";
import { normSymbol } from "../shared/schema.js";
import { TF_SECONDS, TF_BINANCE, TF_TWELVE } from "../shared/constants.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (f) => fs.readFileSync(root + f, "utf8");
let failed = 0;
const ok = (name, f) => Promise.resolve().then(f).then(() => console.log("PASS", name), (e) => { failed++; console.log("FAIL", name, "-", e.message); });

await ok("normalizeSymbol binance: BTCUSD / BTC/USD / BTC-USD / btcusdt / ' BTCUSDT ' -> BTCUSDT", () => {
  for (const s of ["BTCUSD", "BTC/USD", "BTC-USD", "BTCUSDT", "btcusdt", " BTCUSDT ", "btc_usdt", "BTC/USDT", "BINANCE:BTCUSDT"])
    assert.equal(normalizeSymbol(s, "binance"), "BTCUSDT", s);
  assert.equal(normalizeSymbol("eth-usd", "bn"), "ETHUSDT");
});
await ok("normalizeSymbol binance keeps other stable/crypto quotes intact", () => {
  assert.equal(normalizeSymbol("BTCFDUSD", "binance"), "BTCFDUSD");
  assert.equal(normalizeSymbol("ETH/BUSD", "binance"), "ETHBUSD");
  assert.equal(normalizeSymbol("ETH/BTC", "binance"), "ETHBTC");
  assert.equal(normalizeSymbol("SOLUSDC", "binance"), "SOLUSDC");
});
await ok("normalizeSymbol FX: EURUSD <-> EUR/USD", () => {
  for (const s of ["EURUSD", "EUR/USD", "eur-usd", " eurusd "]) {
    assert.equal(normalizeSymbol(s, "twelvedata"), "EUR/USD", s);
    assert.equal(normalizeSymbol(s), "EURUSD", s);
    assert.equal(normalizeSymbol(s, "fx"), "EURUSD", s);
  }
  assert.equal(normalizeSymbol("XAUUSD", "td"), "XAU/USD");
  assert.equal(normalizeSymbol("AAPL", "twelvedata"), "AAPL");
});
await ok("normalizeSymbol twelvedata maps futures via FUTURES_TO_TWELVEDATA; internal keeps =F / ^ tickers", () => {
  assert.equal(normalizeSymbol("es=f", "twelvedata"), "SPY");
  assert.equal(normalizeSymbol("ZZ=F", "twelvedata"), "");
  assert.equal(normalizeSymbol("es=f"), "ES=F");
  assert.equal(normalizeSymbol("^gspc"), "^GSPC");
});
await ok("normalizeSymbol is total + deterministic, and matches schema.normSymbol for plain symbols", () => {
  for (const bad of [undefined, null, "", "   "]) assert.equal(normalizeSymbol(bad, "binance"), "");
  for (const s of ["aapl", "brk.b", "EUR/USD", "btc-usdt", "SPX"]) assert.equal(normalizeSymbol(s), normSymbol(s), s);
  assert.equal(normalizeSymbol("BTC/USD", "binance"), normalizeSymbol("BTC/USD", "binance"));
});
await ok("resolveTdSymbol + inferMeta keep legacy behaviour", () => {
  assert.equal(resolveTdSymbol("NQ=F"), "QQQ");
  assert.equal(resolveTdSymbol("XAU/USD", "XAUUSD"), "XAUUSD"); // legacy quirk: non-futures return the fallback
  assert.equal(inferMeta("XAUUSD").td, "XAUUSD");                // ...so known spot symbols keep their internal td (pinned, unchanged)
  assert.equal(resolveTdSymbol("", "X"), "X");
  assert.equal(resolveTdSymbol("ZZ=F"), "");
  assert.equal(inferMeta("ES=F").td, "SPY");
  assert.equal(inferMeta("eurusd").name, "Euro / US Dollar");
  const u = inferMeta("GBPCHF");
  assert.equal(u.m, "FX"); assert.equal(u.td, "GBPCHF"); assert.equal(u.api, "GBPCHF=X"); // legacy: td not slashed (use normalizeSymbol(_, "twelvedata"))
  assert.equal(inferMeta("PEPEUSDT").pr, "bn");
});
await ok("interval maps: same keys/values as the legacy backend blocks; agree with shared/constants.js", () => {
  const keys = ["1m", "5m", "15m", "30m", "1H", "4H", "1D", "1W", "1M"];
  for (const m of [INTERVAL_SECONDS, BINANCE_INTERVALS, TWELVEDATA_INTERVALS, YAHOO_INTERVALS]) { assert.deepEqual(Object.keys(m), keys); assert.ok(Object.isFrozen(m)); }
  assert.deepEqual(Object.values(INTERVAL_SECONDS), [60, 300, 900, 1800, 3600, 14400, 86400, 604800, 2592000]);
  assert.equal(BINANCE_INTERVALS["1M"], "1M"); assert.equal(TWELVEDATA_INTERVALS["1D"], "1day");
  assert.deepEqual(YAHOO_INTERVALS["4H"], ["60m", "6mo"]); assert.ok(Object.isFrozen(YAHOO_INTERVALS["4H"]));
  // shared/constants.js (worker/ proxy) uses lowercase labels; the values must never drift apart.
  for (const [lc, uc] of [["1m", "1m"], ["5m", "5m"], ["15m", "15m"], ["30m", "30m"], ["1h", "1H"], ["4h", "4H"], ["1d", "1D"], ["1w", "1W"]]) {
    assert.equal(TF_SECONDS[lc], INTERVAL_SECONDS[uc], lc);
    assert.equal(TF_BINANCE[lc], BINANCE_INTERVALS[uc], lc);
    assert.equal(TF_TWELVE[lc], TWELVEDATA_INTERVALS[uc], lc);
  }
});
await ok("instrument catalog: 70 entries, legacy order, frozen, indexed", () => {
  assert.equal(BASE_INSTRUMENTS.length, 70);
  assert.equal(BASE_INSTRUMENTS[0].s, "EURUSD"); assert.equal(BASE_INSTRUMENTS[69].s, "QNTUSDT");
  assert.ok(Object.isFrozen(BASE_INSTRUMENTS) && Object.isFrozen(BASE_INSTRUMENTS[0]));
  assert.equal(INSTRUMENT_BY_SYMBOL.size, 70); assert.equal(INSTRUMENT_BY_SYMBOL.get("NVDA").td, "NVDA");
  assert.equal(Object.keys(DUKASCOPY_MAP).length, 26); assert.deepEqual(DUKASCOPY_MAP.USDJPY, { id: "USDJPY", scale: 1000 });
  assert.ok(Object.isFrozen(DUKASCOPY_MAP.USDJPY));
  assert.equal(Object.keys(FUTURES_TO_TWELVEDATA).length, 22);
  // api-gcp first: the only Binance REST host that answers Cloudflare egress (others 403; see tests/crypto-binance-only).
  assert.deepEqual([...BINANCE_MIRRORS], ["https://api-gcp.binance.com", "https://data-api.binance.vision", "https://api.binance.com"]);
  assert.ok(STABLE_RE.test("USDCUSDT") && !STABLE_RE.test("BTCUSDT"));
});
await ok("server.js and worker.js import catalogs from shared/ (no literal copies left)", () => {
  const blocks = ["const STEPS = {", "const BNI = {", "const TDI = {", "const YI = {", "const STABLE_RE = /", "const BINANCE_MIRRORS = [", "const FUTURES_TO_TWELVEDATA = {", "const DUKASCOPY_MAP = {", "const BASE_INSTRUMENTS = [", "function resolveTdSymbol(", "function inferMeta("];
  for (const f of ["server.js", "worker.js"]) {
    const src = read(f);
    for (const b of blocks) assert.ok(!src.includes(b), `${f} still defines ${b}`);
  }
  assert.match(read("worker.js"), /from "\.\/shared\/instruments\.js"/);
  assert.match(read("worker.js"), /from "\.\/shared\/intervals\.js"/);
  assert.match(read("worker.js"), /from "\.\/shared\/symbolNormalizer\.js"/);
  assert.match(read("server.js"), /require\("\.\/shared\/instruments\.js"\)/);
  assert.match(read("server.js"), /require\("\.\/shared\/intervals\.js"\)/);
  assert.match(read("server.js"), /require\("\.\/shared\/symbolNormalizer\.js"\)/);
});
await ok("shared modules are Workers-safe (no node: / require / process)", () => {
  for (const f of ["shared/instruments.js", "shared/intervals.js", "shared/symbolNormalizer.js"]) {
    const src = read(f);
    assert.ok(!/from\s+["']node:|require\(|process\./.test(src), f);
  }
});
await ok("CommonJS can require() the shared ESM modules (server.js path)", () => {
  const req = createRequire(import.meta.url);
  assert.equal(req("../shared/symbolNormalizer.js").normalizeSymbol("BTC-USD", "binance"), "BTCUSDT");
  assert.equal(req("../shared/intervals.js").INTERVAL_SECONDS["1H"], 3600);
});

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exitCode = failed ? 1 : 0;
