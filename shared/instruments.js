// shared/instruments.js — instrument catalogs shared by server.js (Node, via require) and worker.js (Workers).
// Pure data, no dependencies, no Node APIs. Everything exported is frozen (deeply for nested records).
// Order matters: the screener universe and synthetic tick loops iterate BASE_INSTRUMENTS in this order.

const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v); return Object.freeze(o); };

/** Stablecoin-vs-USDT pairs excluded from the crypto screener universe. */
export const STABLE_RE = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|USDE|XUSD|AEUR|EUR|PYUSD|USD1)USDT$/;

/** Binance REST hosts, tried in order (451 / 5xx -> next mirror). */
export const BINANCE_MIRRORS = Object.freeze([
  "https://data-api.binance.vision",
  "https://api.binance.com",
]);

/** CME/NYMEX/COMEX/CBOT futures root -> Twelve Data spot / ETF proxy symbol. */
export const FUTURES_TO_TWELVEDATA = Object.freeze({
  "NQ=F": "QQQ",
  "ES=F": "SPY",
  "YM=F": "DIA",
  "RTY=F": "IWM",
  "GC=F": "XAU/USD",
  "SI=F": "XAG/USD",
  "CL=F": "WTI/USD",
  "NG=F": "NATGAS/USD",
  "6E=F": "EUR/USD",
  "6B=F": "GBP/USD",
  "6J=F": "USD/JPY",
  "6A=F": "AUD/USD",
  "6C=F": "USD/CAD",
  "6S=F": "USD/CHF",
  "ZN=F": "TLT",
  "ZB=F": "TLT",
  "ZF=F": "IEF",
  "ZT=F": "SHY",
  "BZ=F": "BRENT/USD",
  "HG=F": "COPPER/USD",
  "PL=F": "XPT/USD",
  "PA=F": "XPD/USD",
});

/** Internal symbol -> Dukascopy instrument id + price scale (bi5 integer prices are divided by scale). */
const RAW_DUKASCOPY_MAP = {
  EURUSD: { id: "EURUSD", scale: 100000 },
  GBPUSD: { id: "GBPUSD", scale: 100000 },
  USDJPY: { id: "USDJPY", scale: 1000 },
  USDCHF: { id: "USDCHF", scale: 100000 },
  AUDUSD: { id: "AUDUSD", scale: 100000 },
  USDCAD: { id: "USDCAD", scale: 100000 },
  NZDUSD: { id: "NZDUSD", scale: 100000 },
  EURGBP: { id: "EURGBP", scale: 100000 },
  EURJPY: { id: "EURJPY", scale: 1000 },
  GBPJPY: { id: "GBPJPY", scale: 1000 },
  AUDJPY: { id: "AUDJPY", scale: 1000 },
  EURCHF: { id: "EURCHF", scale: 100000 },
  EURAUD: { id: "EURAUD", scale: 100000 },
  XAUUSD: { id: "XAUUSD", scale: 1000 },
  XAGUSD: { id: "XAGUSD", scale: 1000 },
  SPX: { id: "USA500IDXUSD", scale: 1000 },
  "ES=F": { id: "USA500IDXUSD", scale: 1000 },
  NASDAQ: { id: "USATECHIDXUSD", scale: 1000 },
  "NQ=F": { id: "USATECHIDXUSD", scale: 1000 },
  DJI: { id: "USA30IDXUSD", scale: 1000 },
  "YM=F": { id: "USA30IDXUSD", scale: 1000 },
  DAX: { id: "DEUIDXEUR", scale: 1000 },
  FTSE: { id: "GBRIDXGBP", scale: 1000 },
  "CL=F": { id: "LIGHTCMDUSD", scale: 1000 },
  USOIL: { id: "LIGHTCMDUSD", scale: 1000 },
  "NG=F": { id: "GASCMDUSD", scale: 1000 },
};
export const DUKASCOPY_MAP = deepFreeze(RAW_DUKASCOPY_MAP);

/**
 * Core multi-asset reference catalog (Crypto + Forex + Futures + Indices + Stocks + ETFs + CFDs).
 * s=symbol m=market name ex=exchange p=reference price v=reference volume cs=contract size
 * vf=volatility factor api=Yahoo symbol td=Twelve Data symbol tv=TradingView symbol pr=provider (yf|bn)
 */
const RAW_INSTRUMENTS = [
  // Forex & Metals
  { s: "EURUSD", m: "FX", name: "Euro / US Dollar", ex: "FX", p: 1.085, v: 0, cs: 1, vf: 0.005, api: "EURUSD=X", td: "EUR/USD", tv: "FX:EURUSD", pr: "yf" },
  { s: "GBPUSD", m: "FX", name: "British Pound / US Dollar", ex: "FX", p: 1.271, v: 0, cs: 1, vf: 0.006, api: "GBPUSD=X", td: "GBP/USD", tv: "FX:GBPUSD", pr: "yf" },
  { s: "USDJPY", m: "FX", name: "US Dollar / Japanese Yen", ex: "FX", p: 151.2, v: 0, cs: 1, vf: 0.006, api: "USDJPY=X", td: "USD/JPY", tv: "FX:USDJPY", pr: "yf" },
  { s: "USDCHF", m: "FX", name: "US Dollar / Swiss Franc", ex: "FX", p: 0.881, v: 0, cs: 1, vf: 0.005, api: "USDCHF=X", td: "USD/CHF", tv: "FX:USDCHF", pr: "yf" },
  { s: "AUDUSD", m: "FX", name: "Australian Dollar / US Dollar", ex: "FX", p: 0.654, v: 0, cs: 1, vf: 0.006, api: "AUDUSD=X", td: "AUD/USD", tv: "FX:AUDUSD", pr: "yf" },
  { s: "USDCAD", m: "FX", name: "US Dollar / Canadian Dollar", ex: "FX", p: 1.365, v: 0, cs: 1, vf: 0.005, api: "USDCAD=X", td: "USD/CAD", tv: "FX:USDCAD", pr: "yf" },
  { s: "NZDUSD", m: "FX", name: "New Zealand Dollar / US Dollar", ex: "FX", p: 0.592, v: 0, cs: 1, vf: 0.006, api: "NZDUSD=X", td: "NZD/USD", tv: "FX:NZDUSD", pr: "yf" },
  { s: "EURGBP", m: "FX", name: "Euro / British Pound", ex: "FX", p: 0.854, v: 0, cs: 1, vf: 0.005, api: "EURGBP=X", td: "EUR/GBP", tv: "FX:EURGBP", pr: "yf" },
  { s: "EURJPY", m: "FX", name: "Euro / Japanese Yen", ex: "FX", p: 164.1, v: 0, cs: 1, vf: 0.006, api: "EURJPY=X", td: "EUR/JPY", tv: "FX:EURJPY", pr: "yf" },
  { s: "GBPJPY", m: "FX", name: "British Pound / Japanese Yen", ex: "FX", p: 192.2, v: 0, cs: 1, vf: 0.007, api: "GBPJPY=X", td: "GBP/JPY", tv: "FX:GBPJPY", pr: "yf" },
  { s: "XAUUSD", m: "CFD", name: "Gold Spot / US Dollar", ex: "OANDA", p: 2680, v: 0, cs: 1, vf: 0.011, api: "GC=F", td: "XAU/USD", tv: "OANDA:XAUUSD", pr: "yf" },
  { s: "XAGUSD", m: "CFD", name: "Silver Spot / US Dollar", ex: "OANDA", p: 31.4, v: 0, cs: 1, vf: 0.018, api: "SI=F", td: "XAG/USD", tv: "OANDA:XAGUSD", pr: "yf" },
  // Futures (Mapped to Twelve Data spot/ETF equivalents)
  { s: "ES=F", m: "FUT", name: "E-mini S&P 500 Futures", ex: "CME", p: 5890, v: 1200000, cs: 50, vf: 0.01, api: "ES=F", td: "SPY", tv: "CME_MINI:ES1!", pr: "yf" },
  { s: "NQ=F", m: "FUT", name: "E-mini Nasdaq-100 Futures", ex: "CME", p: 20650, v: 600000, cs: 20, vf: 0.013, api: "NQ=F", td: "QQQ", tv: "CME_MINI:NQ1!", pr: "yf" },
  { s: "YM=F", m: "FUT", name: "E-mini Dow ($5) Futures", ex: "CBOT", p: 43600, v: 180000, cs: 5, vf: 0.009, api: "YM=F", td: "DIA", tv: "CBOT_MINI:YM1!", pr: "yf" },
  { s: "RTY=F", m: "FUT", name: "E-mini Russell 2000 Futures", ex: "CME", p: 2310, v: 220000, cs: 50, vf: 0.015, api: "RTY=F", td: "IWM", tv: "CME_MINI:RTY1!", pr: "yf" },
  { s: "CL=F", m: "FUT", name: "WTI Crude Oil Futures", ex: "NYMEX", p: 71.5, v: 350000, cs: 1000, vf: 0.02, api: "CL=F", td: "WTI/USD", tv: "NYMEX:CL1!", pr: "yf" },
  { s: "NG=F", m: "FUT", name: "Henry Hub Natural Gas Futures", ex: "NYMEX", p: 2.85, v: 190000, cs: 10000, vf: 0.032, api: "NG=F", td: "NATGAS/USD", tv: "NYMEX:NG1!", pr: "yf" },
  { s: "GC=F", m: "FUT", name: "Gold Futures", ex: "COMEX", p: 2685, v: 200000, cs: 100, vf: 0.011, api: "GC=F", td: "XAU/USD", tv: "COMEX:GC1!", pr: "yf" },
  { s: "SI=F", m: "FUT", name: "Silver Futures", ex: "COMEX", p: 31.5, v: 85000, cs: 5000, vf: 0.018, api: "SI=F", td: "XAG/USD", tv: "COMEX:SI1!", pr: "yf" },
  { s: "ZN=F", m: "FUT", name: "10-Year T-Note Futures", ex: "CBOT", p: 110.5, v: 1500000, cs: 1000, vf: 0.004, api: "ZN=F", td: "TLT", tv: "CBOT:ZN1!", pr: "yf" },
  { s: "6E=F", m: "FUT", name: "Euro FX Futures", ex: "CME", p: 1.086, v: 200000, cs: 125000, vf: 0.005, api: "6E=F", td: "EUR/USD", tv: "CME:6E1!", pr: "yf" },
  // Indices
  { s: "SPX", m: "IDX", name: "S&P 500 Index", ex: "SP", p: 5875, v: 0, cs: 1, vf: 0.009, api: "^GSPC", td: "SPX", tv: "SP:SPX", pr: "yf" },
  { s: "NASDAQ", m: "IDX", name: "Nasdaq Composite Index", ex: "NASDAQ", p: 18980, v: 0, cs: 1, vf: 0.012, api: "^IXIC", td: "IXIC", tv: "NASDAQ:IXIC", pr: "yf" },
  { s: "DJI", m: "IDX", name: "Dow Jones Industrial Average", ex: "DJ", p: 43520, v: 0, cs: 1, vf: 0.008, api: "^DJI", td: "DJI", tv: "DJ:DJI", pr: "yf" },
  { s: "RUT", m: "IDX", name: "Russell 2000 Index", ex: "TVC", p: 2305, v: 0, cs: 1, vf: 0.014, api: "^RUT", td: "RUT", tv: "TVC:RUT", pr: "yf" },
  { s: "VIX", m: "IDX", name: "CBOE Volatility Index", ex: "CBOE", p: 15.8, v: 0, cs: 1, vf: 0.045, api: "^VIX", td: "VIX", tv: "TVC:VIX", pr: "yf" },
  { s: "DAX", m: "IDX", name: "DAX Performance Index", ex: "XETR", p: 19320, v: 0, cs: 1, vf: 0.01, api: "^GDAXI", td: "DAX", tv: "XETR:DAX", pr: "yf" },
  { s: "FTSE", m: "IDX", name: "FTSE 100 Index", ex: "TVC", p: 8120, v: 0, cs: 1, vf: 0.007, api: "^FTSE", td: "FTSE", tv: "TVC:UKX", pr: "yf" },
  { s: "N225", m: "IDX", name: "Nikkei 225 Index", ex: "TVC", p: 38900, v: 0, cs: 1, vf: 0.012, api: "^N225", td: "N225", tv: "TVC:NI225", pr: "yf" },
  // ETFs
  { s: "SPY", m: "ETF", name: "SPDR S&P 500 ETF Trust", ex: "NYSE ARCA", p: 586.4, v: 55000000, cs: 1, vf: 0.009, api: "SPY", td: "SPY", tv: "AMEX:SPY", pr: "yf" },
  { s: "QQQ", m: "ETF", name: "Invesco QQQ Trust", ex: "NASDAQ", p: 502.8, v: 42000000, cs: 1, vf: 0.012, api: "QQQ", td: "QQQ", tv: "NASDAQ:QQQ", pr: "yf" },
  { s: "IWM", m: "ETF", name: "iShares Russell 2000 ETF", ex: "NYSE ARCA", p: 229.1, v: 32000000, cs: 1, vf: 0.014, api: "IWM", td: "IWM", tv: "AMEX:IWM", pr: "yf" },
  { s: "DIA", m: "ETF", name: "SPDR Dow Jones Industrial Average ETF", ex: "NYSE ARCA", p: 435.0, v: 4500000, cs: 1, vf: 0.008, api: "DIA", td: "DIA", tv: "AMEX:DIA", pr: "yf" },
  { s: "GLD", m: "ETF", name: "SPDR Gold Shares", ex: "NYSE ARCA", p: 247.5, v: 7800000, cs: 1, vf: 0.011, api: "GLD", td: "GLD", tv: "AMEX:GLD", pr: "yf" },
  { s: "TLT", m: "ETF", name: "iShares 20+ Year Treasury Bond ETF", ex: "NASDAQ", p: 91.2, v: 36000000, cs: 1, vf: 0.011, api: "TLT", td: "TLT", tv: "NASDAQ:TLT", pr: "yf" },
  { s: "SMH", m: "ETF", name: "VanEck Semiconductor ETF", ex: "NASDAQ", p: 248.6, v: 8500000, cs: 1, vf: 0.022, api: "SMH", td: "SMH", tv: "NASDAQ:SMH", pr: "yf" },
  { s: "TQQQ", m: "ETF", name: "ProShares UltraPro QQQ", ex: "NASDAQ", p: 76.4, v: 58000000, cs: 1, vf: 0.036, api: "TQQQ", td: "TQQQ", tv: "NASDAQ:TQQQ", pr: "yf" },
  { s: "SQQQ", m: "ETF", name: "ProShares UltraPro Short QQQ", ex: "NASDAQ", p: 8.15, v: 95000000, cs: 1, vf: 0.036, api: "SQQQ", td: "SQQQ", tv: "NASDAQ:SQQQ", pr: "yf" },
  { s: "QTUM", m: "ETF", name: "Defiance Quantum ETF", ex: "NASDAQ", p: 72.1, v: 620000, cs: 1, vf: 0.018, api: "QTUM", td: "QTUM", tv: "NASDAQ:QTUM", pr: "yf" },
  // Stocks
  { s: "AAPL", m: "STK", name: "Apple Inc.", ex: "NASDAQ", p: 226.4, v: 48000000, cs: 1, vf: 0.016, api: "AAPL", td: "AAPL", tv: "NASDAQ:AAPL", pr: "yf" },
  { s: "MSFT", m: "STK", name: "Microsoft Corporation", ex: "NASDAQ", p: 418.2, v: 21000000, cs: 1, vf: 0.015, api: "MSFT", td: "MSFT", tv: "NASDAQ:MSFT", pr: "yf" },
  { s: "NVDA", m: "STK", name: "NVIDIA Corporation", ex: "NASDAQ", p: 141.8, v: 225000000, cs: 1, vf: 0.03, api: "NVDA", td: "NVDA", tv: "NASDAQ:NVDA", pr: "yf" },
  { s: "AMZN", m: "STK", name: "Amazon.com, Inc.", ex: "NASDAQ", p: 208.5, v: 39000000, cs: 1, vf: 0.019, api: "AMZN", td: "AMZN", tv: "NASDAQ:AMZN", pr: "yf" },
  { s: "GOOGL", m: "STK", name: "Alphabet Inc.", ex: "NASDAQ", p: 176.3, v: 24000000, cs: 1, vf: 0.017, api: "GOOGL", td: "GOOGL", tv: "NASDAQ:GOOGL", pr: "yf" },
  { s: "META", m: "STK", name: "Meta Platforms, Inc.", ex: "NASDAQ", p: 582.1, v: 14000000, cs: 1, vf: 0.022, api: "META", td: "META", tv: "NASDAQ:META", pr: "yf" },
  { s: "TSLA", m: "STK", name: "Tesla, Inc.", ex: "NASDAQ", p: 324.6, v: 82000000, cs: 1, vf: 0.035, api: "TSLA", td: "TSLA", tv: "NASDAQ:TSLA", pr: "yf" },
  { s: "AVGO", m: "STK", name: "Broadcom Inc.", ex: "NASDAQ", p: 174.2, v: 28000000, cs: 1, vf: 0.024, api: "AVGO", td: "AVGO", tv: "NASDAQ:AVGO", pr: "yf" },
  { s: "AMD", m: "STK", name: "Advanced Micro Devices, Inc.", ex: "NASDAQ", p: 148.9, v: 46000000, cs: 1, vf: 0.028, api: "AMD", td: "AMD", tv: "NASDAQ:AMD", pr: "yf" },
  { s: "QCOM", m: "STK", name: "QUALCOMM Incorporated", ex: "NASDAQ", p: 168.4, v: 8200000, cs: 1, vf: 0.022, api: "QCOM", td: "QCOM", tv: "NASDAQ:QCOM", pr: "yf" },
  { s: "QRVO", m: "STK", name: "Qorvo, Inc.", ex: "NASDAQ", p: 74.3, v: 2400000, cs: 1, vf: 0.026, api: "QRVO", td: "QRVO", tv: "NASDAQ:QRVO", pr: "yf" },
  { s: "QS", m: "STK", name: "QuantumScape Corporation", ex: "NYSE", p: 5.45, v: 9800000, cs: 1, vf: 0.042, api: "QS", td: "QS", tv: "NYSE:QS", pr: "yf" },
  { s: "QLYS", m: "STK", name: "Qualys, Inc.", ex: "NASDAQ", p: 146.2, v: 480000, cs: 1, vf: 0.021, api: "QLYS", td: "QLYS", tv: "NASDAQ:QLYS", pr: "yf" },
  { s: "QGEN", m: "STK", name: "QIAGEN N.V.", ex: "NYSE", p: 44.1, v: 1300000, cs: 1, vf: 0.015, api: "QGEN", td: "QGEN", tv: "NYSE:QGEN", pr: "yf" },
  { s: "PLTR", m: "STK", name: "Palantir Technologies Inc.", ex: "NASDAQ", p: 61.8, v: 64000000, cs: 1, vf: 0.038, api: "PLTR", td: "PLTR", tv: "NASDAQ:PLTR", pr: "yf" },
  { s: "NFLX", m: "STK", name: "Netflix, Inc.", ex: "NASDAQ", p: 824.0, v: 3600000, cs: 1, vf: 0.021, api: "NFLX", td: "NFLX", tv: "NASDAQ:NFLX", pr: "yf" },
  { s: "JPM", m: "STK", name: "JPMorgan Chase & Co.", ex: "NYSE", p: 241.5, v: 8500000, cs: 1, vf: 0.014, api: "JPM", td: "JPM", tv: "NYSE:JPM", pr: "yf" },
  { s: "COIN", m: "STK", name: "Coinbase Global, Inc.", ex: "NASDAQ", p: 298.4, v: 14000000, cs: 1, vf: 0.048, api: "COIN", td: "COIN", tv: "NASDAQ:COIN", pr: "yf" },
  { s: "MSTR", m: "STK", name: "MicroStrategy Incorporated", ex: "NASDAQ", p: 368.0, v: 26000000, cs: 1, vf: 0.055, api: "MSTR", td: "MSTR", tv: "NASDAQ:MSTR", pr: "yf" },
  { s: "ARM", m: "STK", name: "Arm Holdings plc", ex: "NASDAQ", p: 144.3, v: 7800000, cs: 1, vf: 0.032, api: "ARM", td: "ARM", tv: "NASDAQ:ARM", pr: "yf" },
  // Crypto fallbacks (overridden / expanded by live Binance 24h tickers)
  { s: "BTCUSDT", m: "CRY", name: "Bitcoin / Tether", ex: "BINANCE", p: 91250, v: 28500, cs: 1, vf: 0.028, api: "BTCUSDT", td: "BTC/USD", tv: "BINANCE:BTCUSDT", pr: "bn" },
  { s: "ETHUSDT", m: "CRY", name: "Ethereum / Tether", ex: "BINANCE", p: 3140, v: 410000, cs: 1, vf: 0.032, api: "ETHUSDT", td: "ETH/USD", tv: "BINANCE:ETHUSDT", pr: "bn" },
  { s: "SOLUSDT", m: "CRY", name: "Solana / Tether", ex: "BINANCE", p: 238.5, v: 4200000, cs: 1, vf: 0.042, api: "SOLUSDT", td: "SOL/USD", tv: "BINANCE:SOLUSDT", pr: "bn" },
  { s: "BNBUSDT", m: "CRY", name: "BNB / Tether", ex: "BINANCE", p: 625.0, v: 420000, cs: 1, vf: 0.025, api: "BNBUSDT", td: "BNB/USD", tv: "BINANCE:BNBUSDT", pr: "bn" },
  { s: "XRPUSDT", m: "CRY", name: "XRP / Tether", ex: "BINANCE", p: 1.12, v: 850000000, cs: 1, vf: 0.045, api: "XRPUSDT", td: "XRP/USD", tv: "BINANCE:XRPUSDT", pr: "bn" },
  { s: "DOGEUSDT", m: "CRY", name: "Dogecoin / Tether", ex: "BINANCE", p: 0.375, v: 2100000000, cs: 1, vf: 0.05, api: "DOGEUSDT", td: "DOGE/USD", tv: "BINANCE:DOGEUSDT", pr: "bn" },
  { s: "ADAUSDT", m: "CRY", name: "Cardano / Tether", ex: "BINANCE", p: 0.74, v: 320000000, cs: 1, vf: 0.04, api: "ADAUSDT", td: "ADA/USD", tv: "BINANCE:ADAUSDT", pr: "bn" },
  { s: "AVAXUSDT", m: "CRY", name: "Avalanche / Tether", ex: "BINANCE", p: 36.2, v: 4800000, cs: 1, vf: 0.042, api: "AVAXUSDT", td: "AVAX/USD", tv: "BINANCE:AVAXUSDT", pr: "bn" },
  { s: "LINKUSDT", m: "CRY", name: "Chainlink / Tether", ex: "BINANCE", p: 14.8, v: 11000000, cs: 1, vf: 0.038, api: "LINKUSDT", td: "LINK/USD", tv: "BINANCE:LINKUSDT", pr: "bn" },
  { s: "QNTUSDT", m: "CRY", name: "Quant / Tether", ex: "BINANCE", p: 84.5, v: 190000, cs: 1, vf: 0.036, api: "QNTUSDT", td: "QNT/USD", tv: "BINANCE:QNTUSDT", pr: "bn" },
];
export const BASE_INSTRUMENTS = deepFreeze(RAW_INSTRUMENTS);

/** Symbol -> catalog record. Treat as read-only. */
export const INSTRUMENT_BY_SYMBOL = new Map(BASE_INSTRUMENTS.map((x) => [x.s, x]));
