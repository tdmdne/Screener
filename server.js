const http = require("http");
const path = require("path");
const express = require("express");
const WebSocket = require("ws");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const TWELVEDATA_KEY = (process.env.TWELVEDATA_KEY || "").trim();

const STEPS = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1H": 3600,
  "4H": 14400,
  "1D": 86400,
  "1W": 604800,
  "1M": 2592000,
};

const BNI = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1H": "1h",
  "4H": "4h",
  "1D": "1d",
  "1W": "1w",
  "1M": "1M",
};

const TDI = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1H": "1h",
  "4H": "4h",
  "1D": "1day",
  "1W": "1week",
  "1M": "1month",
};

const YI = {
  "1m": ["1m", "5d"],
  "5m": ["5m", "1mo"],
  "15m": ["15m", "1mo"],
  "30m": ["30m", "1mo"],
  "1H": ["60m", "3mo"],
  "4H": ["60m", "6mo"],
  "1D": ["1d", "1y"],
  "1W": ["1wk", "5y"],
  "1M": ["1mo", "max"],
};

const STABLE_RE = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|USDE|XUSD|AEUR|EUR|PYUSD|USD1)USDT$/;

const DUKASCOPY_MAP = {
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
const dukaBlockCache = new Map();

const BASE_INSTRUMENTS = [
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
  { s: "ES=F", m: "FUT", name: "E-mini S&P 500 Futures", ex: "CME", p: 5890, v: 1200000, cs: 50, vf: 0.01, api: "ES=F", td: "ES=F", tv: "CME_MINI:ES1!", pr: "yf" },
  { s: "NQ=F", m: "FUT", name: "E-mini Nasdaq-100 Futures", ex: "CME", p: 20650, v: 600000, cs: 20, vf: 0.013, api: "NQ=F", td: "NQ=F", tv: "CME_MINI:NQ1!", pr: "yf" },
  { s: "YM=F", m: "FUT", name: "E-mini Dow ($5) Futures", ex: "CBOT", p: 43600, v: 180000, cs: 5, vf: 0.009, api: "YM=F", td: "YM=F", tv: "CBOT_MINI:YM1!", pr: "yf" },
  { s: "RTY=F", m: "FUT", name: "E-mini Russell 2000 Futures", ex: "CME", p: 2310, v: 220000, cs: 50, vf: 0.015, api: "RTY=F", td: "RTY=F", tv: "CME_MINI:RTY1!", pr: "yf" },
  { s: "CL=F", m: "FUT", name: "WTI Crude Oil Futures", ex: "NYMEX", p: 71.5, v: 350000, cs: 1000, vf: 0.02, api: "CL=F", td: "CL=F", tv: "NYMEX:CL1!", pr: "yf" },
  { s: "NG=F", m: "FUT", name: "Henry Hub Natural Gas Futures", ex: "NYMEX", p: 2.85, v: 190000, cs: 10000, vf: 0.032, api: "NG=F", td: "NG=F", tv: "NYMEX:NG1!", pr: "yf" },
  { s: "GC=F", m: "FUT", name: "Gold Futures", ex: "COMEX", p: 2685, v: 200000, cs: 100, vf: 0.011, api: "GC=F", td: "GC=F", tv: "COMEX:GC1!", pr: "yf" },
  { s: "SI=F", m: "FUT", name: "Silver Futures", ex: "COMEX", p: 31.5, v: 85000, cs: 5000, vf: 0.018, api: "SI=F", td: "SI=F", tv: "COMEX:SI1!", pr: "yf" },
  { s: "ZN=F", m: "FUT", name: "10-Year T-Note Futures", ex: "CBOT", p: 110.5, v: 1500000, cs: 1000, vf: 0.004, api: "ZN=F", td: "ZN=F", tv: "CBOT:ZN1!", pr: "yf" },
  { s: "6E=F", m: "FUT", name: "Euro FX Futures", ex: "CME", p: 1.086, v: 200000, cs: 125000, vf: 0.005, api: "6E=F", td: "6E=F", tv: "CME:6E1!", pr: "yf" },
  { s: "SPX", m: "IDX", name: "S&P 500 Index", ex: "SP", p: 5875, v: 0, cs: 1, vf: 0.009, api: "^GSPC", td: "SPX", tv: "SP:SPX", pr: "yf" },
  { s: "NASDAQ", m: "IDX", name: "Nasdaq Composite Index", ex: "NASDAQ", p: 18980, v: 0, cs: 1, vf: 0.012, api: "^IXIC", td: "IXIC", tv: "NASDAQ:IXIC", pr: "yf" },
  { s: "DJI", m: "IDX", name: "Dow Jones Industrial Average", ex: "DJ", p: 43520, v: 0, cs: 1, vf: 0.008, api: "^DJI", td: "DJI", tv: "DJ:DJI", pr: "yf" },
  { s: "RUT", m: "IDX", name: "Russell 2000 Index", ex: "TVC", p: 2305, v: 0, cs: 1, vf: 0.014, api: "^RUT", td: "RUT", tv: "TVC:RUT", pr: "yf" },
  { s: "VIX", m: "IDX", name: "CBOE Volatility Index", ex: "CBOE", p: 15.8, v: 0, cs: 1, vf: 0.045, api: "^VIX", td: "VIX", tv: "TVC:VIX", pr: "yf" },
  { s: "DAX", m: "IDX", name: "DAX Performance Index", ex: "XETR", p: 19320, v: 0, cs: 1, vf: 0.01, api: "^GDAXI", td: "DAX", tv: "XETR:DAX", pr: "yf" },
  { s: "FTSE", m: "IDX", name: "FTSE 100 Index", ex: "TVC", p: 8120, v: 0, cs: 1, vf: 0.007, api: "^FTSE", td: "FTSE", tv: "TVC:UKX", pr: "yf" },
  { s: "N225", m: "IDX", name: "Nikkei 225 Index", ex: "TVC", p: 38900, v: 0, cs: 1, vf: 0.012, api: "^N225", td: "N225", tv: "TVC:NI225", pr: "yf" },
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

const BY_SYM = new Map(BASE_INSTRUMENTS.map((x) => [x.s, x]));

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inferMeta(symbol, mktHint, apiHint) {
  const sym = String(symbol || "").trim().toUpperCase();
  const known = BY_SYM.get(sym);
  if (known) return known;
  const isBn = sym.endsWith("USDT") || mktHint === "CRY";
  const isFx = mktHint === "FX" || /^[A-Z]{6}$/.test(sym);
  const isFut = mktHint === "FUT" || sym.endsWith("=F");
  return {
    s: sym,
    m: isBn ? "CRY" : isFx ? "FX" : isFut ? "FUT" : mktHint || "STK",
    name: sym,
    ex: isBn ? "BINANCE" : isFx ? "FX" : isFut ? "CME" : "NASDAQ",
    p: isFx ? 1.12 : isBn ? 42.5 : 100,
    v: isFx ? 0 : 1200000,
    cs: 1,
    vf: isFx ? 0.006 : 0.02,
    api: apiHint || (isFx && !sym.includes("=") ? sym + "=X" : sym),
    td: isFx && sym.length === 6 ? sym.slice(0, 3) + "/" + sym.slice(3) : sym,
    tv: sym,
    pr: isBn ? "bn" : "yf",
  };
}

function generateSyntheticCandles(symbol, interval, limit = 250, liveAnchor = null) {
  const step = STEPS[interval] || 3600;
  const meta = inferMeta(symbol);
  const anchor = liveAnchor && liveAnchor > 0 ? liveAnchor : meta.p || 100;
  const nowBucket = Math.floor(Date.now() / 1000 / step) * step;
  const rnd = makeRng(hashSeed(meta.s + "|" + interval));
  const tfScale = Math.sqrt(step / 86400);
  const volStep = (meta.vf || 0.02) * tfScale;
  const raw = [];
  let price = 100;
  let drift = 0;

  for (let i = 0; i < limit; i++) {
    if (i % 18 === 0) drift = (rnd() - 0.49) * volStep * 0.45;
    const o = price;
    const ret = drift + (rnd() - 0.495) * volStep * 1.4;
    const c = Math.max(0.0001, o * (1 + ret));
    const wick = volStep * (0.3 + rnd() * 0.85);
    const h = Math.max(o, c) * (1 + wick * 0.55);
    const l = Math.max(0.0001, Math.min(o, c) * (1 - wick * 0.55));
    const v = meta.v > 0 ? Math.round(meta.v * (0.45 + rnd() * 1.15) * Math.max(0.08, tfScale)) : Math.round(1000 + rnd() * 5000);
    raw.push({ t: nowBucket - (limit - 1 - i) * step, o, h, l, c, v });
    price = c;
  }

  const scale = anchor / raw[raw.length - 1].c;
  const dec = anchor < 10 ? 5 : anchor < 100 ? 3 : 2;
  const roundP = (x) => Number((x * scale).toFixed(dec));
  return raw.map((b) => ({
    t: b.t,
    o: roundP(b.o),
    h: roundP(b.h),
    l: roundP(b.l),
    c: roundP(b.c),
    v: b.v,
  }));
}

async function fetchWithTimeout(url, opts = {}, ms = 4500) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(id);
  }
}

async function fetchBinanceTickers() {
  const hosts = ["https://data-api.binance.vision", "https://api.binance.com"];
  for (const h of hosts) {
    try {
      const r = await fetchWithTimeout(`${h}/api/v3/ticker/24hr`, {}, 3500);
      if (!r.ok) continue;
      const j = await r.json();
      if (!Array.isArray(j)) continue;
      return j
        .filter((x) => x.symbol && x.symbol.endsWith("USDT") && !STABLE_RE.test(x.symbol) && +x.quoteVolume > 0)
        .sort((a, b) => +b.quoteVolume - +a.quoteVolume)
        .slice(0, 120)
        .map((x) => {
          const known = BY_SYM.get(x.symbol);
          return [
            x.symbol,
            "CRY",
            +x.lastPrice,
            +x.volume,
            1,
            0.02,
            x.symbol,
            "BINANCE:" + x.symbol,
            "bn",
            x.symbol.replace("USDT", "/USD"),
            known ? known.name : x.symbol.replace("USDT", "") + " / Tether",
            "BINANCE",
            +x.priceChangePercent || 0,
          ];
        });
    } catch (_e) {}
  }
  return null;
}

function lzmaDecompress(bytes) {
  if (!bytes || bytes.length < 13) return new Uint8Array(0);
  const prop = bytes[0];
  if (prop >= 225) return new Uint8Array(0);
  const lc = prop % 9;
  const rem = (prop / 9) | 0;
  const lp = rem % 5;
  const pb = (rem / 5) | 0;
  const pbMask = (1 << pb) - 1;
  const lpMask = (1 << lp) - 1;

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lo = dv.getUint32(5, true);
  const hi = dv.getUint32(9, true);
  const knownSize = !(lo === 0xffffffff && hi === 0xffffffff);
  const outSize = knownSize ? hi * 4294967296 + lo : 0;
  if (knownSize && (outSize === 0 || outSize > 16 * 1024 * 1024)) {
    return new Uint8Array(0);
  }

  let pos = 13;
  let code = 0;
  let range = 0xffffffff >>> 0;
  for (let i = 0; i < 5; i++) {
    code = ((code << 8) | (pos < bytes.length ? bytes[pos++] : 0)) >>> 0;
  }

  const initProbs = (n) => new Uint16Array(n).fill(1024);
  const decBit = (probs, idx) => {
    const prob = probs[idx];
    const bound = ((range >>> 11) * prob) >>> 0;
    if (code < bound) {
      range = bound;
      probs[idx] = prob + ((2048 - prob) >>> 5);
      if (!(range & 0xff000000)) {
        range = (range << 8) >>> 0;
        code = ((code << 8) | (pos < bytes.length ? bytes[pos++] : 0)) >>> 0;
      }
      return 0;
    }
    range = (range - bound) >>> 0;
    code = (code - bound) >>> 0;
    probs[idx] = prob - (prob >>> 5);
    if (!(range & 0xff000000)) {
      range = (range << 8) >>> 0;
      code = ((code << 8) | (pos < bytes.length ? bytes[pos++] : 0)) >>> 0;
    }
    return 1;
  };
  const decTree = (probs, offset, bits) => {
    let m = 1;
    for (let i = 0; i < bits; i++) m = (m << 1) | decBit(probs, offset + m);
    return m - (1 << bits);
  };
  const decRevTree = (probs, offset, bits) => {
    let m = 1,
      sym = 0;
    for (let i = 0; i < bits; i++) {
      const b = decBit(probs, offset + m);
      m = (m << 1) | b;
      sym |= b << i;
    }
    return sym;
  };
  const decDirect = (bits) => {
    let res = 0;
    for (let i = bits - 1; i >= 0; i--) {
      range >>>= 1;
      const t = (code - range) >>> 31;
      code = (code - (range & (t - 1))) >>> 0;
      res = (res << 1) | (1 - t);
      if (!(range & 0xff000000)) {
        range = (range << 8) >>> 0;
        code = ((code << 8) | (pos < bytes.length ? bytes[pos++] : 0)) >>> 0;
      }
    }
    return res;
  };
  const makeLenDec = () => ({
    choice: initProbs(2),
    low: initProbs(16 << 3),
    mid: initProbs(16 << 3),
    high: initProbs(256),
  });
  const decLen = (ld, posState) => {
    if (decBit(ld.choice, 0) === 0) return decTree(ld.low, posState << 3, 3);
    if (decBit(ld.choice, 1) === 0) return 8 + decTree(ld.mid, posState << 3, 3);
    return 16 + decTree(ld.high, 0, 8);
  };

  const isMatch = initProbs(12 << 4);
  const isRep = initProbs(12);
  const isRepG0 = initProbs(12);
  const isRepG1 = initProbs(12);
  const isRepG2 = initProbs(12);
  const isRep0Long = initProbs(12 << 4);
  const posSlot = initProbs(4 << 6);
  const posDecoders = initProbs(115);
  const alignDec = initProbs(16);
  const litProbs = initProbs(0x300 << (lc + lp));
  const lenDec = makeLenDec();
  const repLenDec = makeLenDec();

  const out = knownSize ? new Uint8Array(outSize) : [];
  let outPos = 0;
  let state = 0;
  let rep0 = 0,
    rep1 = 0,
    rep2 = 0,
    rep3 = 0;
  const getOut = (idx) => out[idx] || 0;
  const pushOut = (v) => {
    if (knownSize) out[outPos++] = v;
    else {
      out.push(v);
      outPos++;
    }
  };

  while (!knownSize ? pos <= bytes.length : outPos < outSize) {
    const posState = outPos & pbMask;
    if (decBit(isMatch, (state << 4) + posState) === 0) {
      const prevByte = outPos > 0 ? getOut(outPos - 1) : 0;
      const litBase = (((outPos & lpMask) << lc) + (prevByte >>> (8 - lc))) * 0x300;
      let sym = 1;
      if (state >= 7) {
        let matchByte = outPos >= rep0 + 1 ? getOut(outPos - rep0 - 1) : 0;
        do {
          const matchBit = (matchByte >>> 7) & 1;
          matchByte <<= 1;
          const bit = decBit(litProbs, litBase + ((1 + matchBit) << 8) + sym);
          sym = (sym << 1) | bit;
          if (matchBit !== bit) break;
        } while (sym < 0x100);
      }
      while (sym < 0x100) sym = (sym << 1) | decBit(litProbs, litBase + sym);
      pushOut(sym - 0x100);
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
    } else {
      let len;
      if (decBit(isRep, state) === 1) {
        if (decBit(isRepG0, state) === 0) {
          if (decBit(isRep0Long, (state << 4) + posState) === 0) {
            state = state < 7 ? 9 : 11;
            pushOut(outPos >= rep0 + 1 ? getOut(outPos - rep0 - 1) : 0);
            continue;
          }
        } else {
          let dist;
          if (decBit(isRepG1, state) === 0) dist = rep1;
          else {
            if (decBit(isRepG2, state) === 0) dist = rep2;
            else {
              dist = rep3;
              rep3 = rep2;
            }
            rep2 = rep1;
          }
          rep1 = rep0;
          rep0 = dist;
        }
        len = 2 + decLen(repLenDec, posState);
        state = state < 7 ? 8 : 11;
      } else {
        rep3 = rep2;
        rep2 = rep1;
        rep1 = rep0;
        len = 2 + decLen(lenDec, posState);
        state = state < 7 ? 7 : 10;
        const lenState = len - 2 < 3 ? len - 2 : 3;
        const ps = decTree(posSlot, lenState << 6, 6);
        if (ps >= 4) {
          const numDirect = (ps >> 1) - 1;
          rep0 = (2 | (ps & 1)) << numDirect;
          if (ps < 14) {
            rep0 += decRevTree(posDecoders, rep0 - ps, numDirect);
          } else {
            rep0 += decDirect(numDirect - 4) << 4;
            rep0 += decRevTree(alignDec, 0, 4);
            if (rep0 === 0xffffffff) break;
          }
        } else {
          rep0 = ps;
        }
      }
      if (rep0 >= outPos) break;
      for (let i = 0; i < len && (!knownSize || outPos < outSize); i++) {
        pushOut(getOut(outPos - rep0 - 1));
      }
    }
    if (!knownSize && outPos > 8 * 1024 * 1024) break;
  }
  return knownSize ? out : new Uint8Array(out);
}

function parseDukascopyBi5(rawBytes, baseEpochSec, scale, refPrice) {
  if (!rawBytes || rawBytes.length < 24) return [];
  const count = Math.floor(rawBytes.length / 24);
  const dv = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
  let adjScale = scale || 100000;
  if (refPrice > 0 && count > 0) {
    const sampleClose = dv.getUint32(8, false);
    if (sampleClose > 0) {
      const candidates = [100000, 10000, 1000, 100, 10, 1];
      let best = adjScale;
      let bestErr = Infinity;
      for (const c of candidates) {
        const err = Math.abs(Math.log10(sampleClose / c / refPrice));
        if (err < bestErr) {
          bestErr = err;
          best = c;
        }
      }
      if (bestErr < 0.8) adjScale = best;
    }
  }
  const bars = [];
  for (let i = 0; i < count; i++) {
    const off = i * 24;
    const tOff = dv.getUint32(off, false);
    const o = dv.getUint32(off + 4, false) / adjScale;
    const c = dv.getUint32(off + 8, false) / adjScale;
    const l = dv.getUint32(off + 12, false) / adjScale;
    const h = dv.getUint32(off + 16, false) / adjScale;
    const v = dv.getFloat32(off + 20, false);
    if (!(c > 0)) continue;
    bars.push({
      t: baseEpochSec + tOff,
      o,
      h: Math.max(o, c, h, l),
      l: Math.min(o, c, h, l),
      c,
      v: isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : 0,
    });
  }
  return bars;
}

function aggregateCandles(bars, targetStep) {
  if (!Array.isArray(bars) || !bars.length) return [];
  if (targetStep <= 60) return bars;
  const buckets = new Map();
  for (const b of bars) {
    const t = Math.floor(b.t / targetStep) * targetStep;
    const cur = buckets.get(t);
    if (!cur) {
      buckets.set(t, { t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 });
    } else {
      if (b.h > cur.h) cur.h = b.h;
      if (b.l < cur.l) cur.l = b.l;
      cur.c = b.c;
      cur.v = Number(((cur.v || 0) + (b.v || 0)).toFixed(2));
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

function sanitizeCandles(bars) {
  if (!Array.isArray(bars) || !bars.length) return [];
  const valid = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (!b || !(b.c > 0) || !(b.o > 0) || !(b.h > 0) || !(b.l > 0) || !isFinite(b.c) || !isFinite(b.o) || !isFinite(b.h) || !isFinite(b.l)) continue;
    let o = +b.o, h = +b.h, l = +b.l, c = +b.c, v = +b.v || 0;
    if (h < Math.max(o, c)) h = Math.max(o, c);
    if (l > Math.min(o, c)) l = Math.min(o, c);
    if (h < l) { const tmp = h; h = l; l = tmp; }
    valid.push({ t: Number(b.t), o, h, l, c, v });
  }
  return valid;
}

async function fetchDukascopyBi5Block(url, baseEpochSec, scale, refPrice, cacheKey, isImmutable) {
  if (isImmutable && dukaBlockCache.has(cacheKey)) {
    return dukaBlockCache.get(cacheKey);
  }
  try {
    const r = await fetchWithTimeout(url, { headers: { "user-agent": "VektorTerminal/1.0" } }, 4500);
    if (!r.ok) return [];
    const ab = await r.arrayBuffer();
    if (!ab || ab.byteLength < 14) return [];
    const raw = lzmaDecompress(new Uint8Array(ab));
    const bars = parseDukascopyBi5(raw, baseEpochSec, scale, refPrice);
    if (bars.length && isImmutable) {
      if (dukaBlockCache.size > 600) dukaBlockCache.clear();
      dukaBlockCache.set(cacheKey, bars);
    }
    return bars;
  } catch (_e) {
    return [];
  }
}

async function fetchDukascopyCandles(rawSym, interval, opts, refPrice) {
  const cfg = DUKASCOPY_MAP[rawSym];
  const step = STEPS[interval];
  if (!cfg || !step) return null;

  const limit = Math.max(60, Math.min(5000, Number(opts.limit) || 500));
  const nowSec = Math.floor(Date.now() / 1000);
  const toSec = opts.to > 0 ? Math.min(nowSec, Number(opts.to)) : nowSec;
  const fromSec = opts.from > 0 ? Number(opts.from) : toSec - limit * step;
  const spanDays = Math.ceil((toSec - fromSec) / 86400);
  const todayUtcStart = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) / 1000);

  let rawBars = [];
  if (step >= 86400) {
    const y0 = new Date(fromSec * 1000).getUTCFullYear();
    const y1 = new Date(toSec * 1000).getUTCFullYear();
    const jobs = [];
    for (let y = y0; y <= y1; y++) {
      const base = Math.floor(Date.UTC(y, 0, 1) / 1000);
      const url = `https://datafeed.dukascopy.com/datafeed/${cfg.id}/${y}/BID_candles_day_1.bi5`;
      jobs.push(fetchDukascopyBi5Block(url, base, cfg.scale, refPrice, `duka:1d:${cfg.id}:${y}`, y < new Date().getUTCFullYear()));
    }
    rawBars = (await Promise.all(jobs)).flat();
  } else if (step >= 3600 || spanDays > 16) {
    const d0 = new Date(fromSec * 1000);
    const d1 = new Date(toSec * 1000);
    let y = Math.max(2007, d0.getUTCFullYear()), m = d0.getUTCMonth();
    const curY = new Date().getUTCFullYear(), curM = new Date().getUTCMonth();
    const endY = Math.min(curY, d1.getUTCFullYear()), endM = d1.getUTCFullYear() > curY ? curM : d1.getUTCMonth();
    const jobs = [];
    let guard = 0;
    const maxMonths = Math.min(360, Math.max(1, (endY - y) * 12 + (endM - m) + 1));
    while ((y < endY || (y === endY && m <= endM)) && guard++ < maxMonths) {
      const mm = String(m).padStart(2, "0");
      const base = Math.floor(Date.UTC(y, m, 1) / 1000);
      const url = `https://datafeed.dukascopy.com/datafeed/${cfg.id}/${y}/${mm}/BID_candles_hour_1.bi5`;
      const imm = y < curY || (y === curY && m < curM);
      jobs.push(fetchDukascopyBi5Block(url, base, cfg.scale, refPrice, `duka:1h:${cfg.id}:${y}-${mm}`, imm));
      if (++m >= 12) { m = 0; y++; }
    }
    rawBars = (await Promise.all(jobs)).flat();
  } else {
    const dayJobs = [];
    const maxDays = Math.min(60, Math.max(2, spanDays + 2));
    const endDay = Math.floor(toSec / 86400) * 86400;
    const startDay = Math.max(endDay - (maxDays - 1) * 86400, Math.floor(fromSec / 86400) * 86400);
    for (let d = startDay; d <= endDay; d += 86400) {
      const dt = new Date(d * 1000);
      if (dt.getUTCDay() === 6) continue;
      const yyyy = dt.getUTCFullYear();
      const mm = String(dt.getUTCMonth()).padStart(2, "0");
      const dd = String(dt.getUTCDate()).padStart(2, "0");
      const url = `https://datafeed.dukascopy.com/datafeed/${cfg.id}/${yyyy}/${mm}/${dd}/BID_candles_min_1.bi5`;
      dayJobs.push(fetchDukascopyBi5Block(url, d, cfg.scale, refPrice, `duka:1m:${cfg.id}:${yyyy}-${mm}-${dd}`, d < todayUtcStart));
    }
    rawBars = (await Promise.all(dayJobs)).flat();
  }

  if (!rawBars.length) return null;
  let out = step > 60 ? aggregateCandles(rawBars, step) : rawBars;
  if (opts.from > 0) out = out.filter((b) => b.t >= opts.from);
  if (opts.to > 0) out = out.filter((b) => b.t <= opts.to);

  // Seamlessly stitch recent/live bar if fetching near live edge
  if (out.length && (!opts.to || opts.to >= nowSec - step * 2) && refPrice > 0) {
    const lastBar = out[out.length - 1];
    const curBucket = Math.floor(nowSec / step) * step;
    if (lastBar.t === curBucket) {
      lastBar.c = refPrice;
      lastBar.h = Math.max(lastBar.h, refPrice);
      lastBar.l = Math.min(lastBar.l, refPrice);
    } else if (lastBar.t < curBucket && curBucket - lastBar.t <= step * 8) {
      out.push({
        t: curBucket,
        o: lastBar.c || refPrice,
        h: Math.max(lastBar.c || refPrice, refPrice),
        l: Math.min(lastBar.c || refPrice, refPrice),
        c: refPrice,
        v: 120
      });
    }
  }

  if (out.length > limit) out = out.slice(-limit);
  return out.length ? out : null;
}

async function fetchBinanceCandles(apiSym, interval, opts = {}) {
  const bni = BNI[interval];
  if (!bni) return null;
  const limit = Math.max(10, Math.min(10000, Number(opts.limit) || 250));
  const hosts = ["https://data-api.binance.vision", "https://api.binance.com"];
  const step = STEPS[interval] || 3600;
  let endMs = opts.to > 0 ? Number(opts.to) * 1000 : Date.now();
  const startMs = opts.from > 0 ? Number(opts.from) * 1000 : 0;
  const batches = Math.max(1, Math.min(10, Math.ceil(limit / 1000)));
  const all = [];

  for (let b = 0; b < batches; b++) {
    const chunkLim = Math.min(1000, limit - all.length);
    if (chunkLim <= 0) break;
    let chunk = null;
    for (const h of hosts) {
      try {
        const qs = new URLSearchParams({ symbol: apiSym, interval: bni, limit: String(chunkLim) });
        if (opts.to > 0 || b > 0) qs.set("endTime", String(Math.floor(endMs)));
        if (startMs > 0) qs.set("startTime", String(Math.floor(startMs)));
        const r = await fetchWithTimeout(`${h}/api/v3/klines?${qs}`, {}, 3500);
        if (!r.ok) continue;
        const j = await r.json();
        if (Array.isArray(j) && j.length) {
          chunk = j
            .map((x) => ({ t: Math.floor(x[0] / 1000), o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] }))
            .filter((x) => x.c > 0);
          break;
        }
      } catch (_e) {}
    }
    if (!chunk || !chunk.length) break;
    all.unshift(...chunk);
    endMs = chunk[0].t * 1000 - step * 1000;
    if (chunk.length < chunkLim || (startMs > 0 && endMs < startMs)) break;
  }

  if (!all.length) return null;
  const uniq = new Map();
  for (const bar of all) uniq.set(bar.t, bar);
  let res = [...uniq.values()].sort((a, b) => a.t - b.t);
  if (opts.from > 0) res = res.filter((x) => x.t >= opts.from);
  if (opts.to > 0) res = res.filter((x) => x.t <= opts.to);
  return res.length ? res.slice(-limit) : null;
}

async function fetchTwelveDataCandles(tdSym, interval, opts = {}) {
  const tdi = TDI[interval];
  if (!tdi || !TWELVEDATA_KEY) return null;
  const limit = Math.max(10, Math.min(5000, Number(opts.limit) || 250));
  try {
    const qs = new URLSearchParams({
      symbol: tdSym,
      interval: tdi,
      outputsize: String(limit),
      timezone: "UTC",
      apikey: TWELVEDATA_KEY,
    });
    if (opts.to > 0) {
      qs.set("end_date", new Date(opts.to * 1000).toISOString().slice(0, 19).replace("T", " "));
    }
    const r = await fetchWithTimeout(`https://api.twelvedata.com/time_series?${qs}`, {}, 4500);
    if (!r.ok) return null;
    const j = await r.json();
    if (j.status === "error" || !Array.isArray(j.values) || !j.values.length) return null;
    let res = j.values
      .slice()
      .reverse()
      .map((v) => ({
        t: Math.floor(
          Date.parse(v.datetime.length > 10 ? v.datetime.replace(" ", "T") + "Z" : v.datetime + "T00:00:00Z") / 1000
        ),
        o: +v.open,
        h: +v.high,
        l: +v.low,
        c: +v.close,
        v: +(v.volume || 0),
      }))
      .filter((b) => b.c > 0);
    if (opts.from > 0) res = res.filter((b) => b.t >= opts.from);
    if (opts.to > 0) res = res.filter((b) => b.t <= opts.to);
    return res.length ? res.slice(-limit) : null;
  } catch (_e) {
    return null;
  }
}

async function fetchYahooCandles(apiSym, interval, opts = {}) {
  const spec = YI[interval];
  if (!spec) return null;
  const [iv, defaultRg] = spec;
  const limit = Math.max(10, Math.min(5000, Number(opts.limit) || 250));
  const rg =
    limit > 300 && interval === "1D" ? "5y" :
    limit > 300 && (interval === "1H" || interval === "4H") ? "2y" :
    limit > 300 && interval !== "1m" ? "60d" :
    defaultRg;
  try {
    const url =
      opts.from > 0 && opts.to > 0
        ? `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(apiSym)}?interval=${iv}&period1=${Math.floor(opts.from)}&period2=${Math.floor(opts.to)}`
        : `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(apiSym)}?interval=${iv}&range=${rg}`;
    const r = await fetchWithTimeout(url, { headers: { "user-agent": "VektorTerminal/1.0" } }, 3500);
    if (!r.ok) return null;
    const j = await r.json();
    const res = j && j.chart && j.chart.result && j.chart.result[0];
    if (!res || !Array.isArray(res.timestamp) || !res.indicators || !res.indicators.quote || !res.indicators.quote[0]) {
      return null;
    }
    const q = res.indicators.quote[0];
    const t = res.timestamp;
    let bars = [];
    for (let i = 0; i < t.length; i++) {
      if (q.close[i] != null && q.open[i] != null) {
        bars.push({
          t: t[i],
          o: q.open[i],
          h: q.high[i],
          l: q.low[i],
          c: q.close[i],
          v: q.volume[i] || 0,
        });
      }
    }
    if (interval === "4H") bars = aggregateCandles(bars, 14400);
    if (opts.from > 0) bars = bars.filter((b) => b.t >= opts.from);
    if (opts.to > 0) bars = bars.filter((b) => b.t <= opts.to);
    return bars.length ? bars.slice(-limit) : null;
  } catch (_e) {
    return null;
  }
}

// Local Edge/KV cache parity
let screenerSnapshot = { ts: 0, body: "" };
const candleCache = new Map();
const livePrices = new Map(BASE_INSTRUMENTS.map((x) => [x.s, x.p]));

async function buildScreenerBody() {
  const ts = Date.now();
  const bnRows = await fetchBinanceTickers();
  const seen = new Set();
  const universe = [];

  if (bnRows && bnRows.length) {
    for (const row of bnRows) {
      seen.add(row[0]);
      universe.push(row);
      livePrices.set(row[0], row[2]);
    }
  }

  for (const item of BASE_INSTRUMENTS) {
    if (seen.has(item.s)) continue;
    seen.add(item.s);
    const bars1D = generateSyntheticCandles(item.s, "1D", 35, livePrices.get(item.s) || item.p);
    const last = bars1D[bars1D.length - 1];
    const prev = bars1D[bars1D.length - 2] || last;
    const pct = prev && prev.c ? ((last.c - prev.c) / prev.c) * 100 : 0;
    livePrices.set(item.s, last.c);
    universe.push([
      item.s,
      item.m,
      last.c,
      item.v,
      item.cs,
      item.vf,
      item.api,
      item.tv,
      item.pr,
      item.td,
      item.name,
      item.ex,
      Number(pct.toFixed(2)),
    ]);
  }

  const payload = {
    ok: true,
    ts,
    tfs: ["1D", "1H"],
    source: bnRows && bnRows.length ? "edge+binance" : "edge+sim",
    count: universe.length,
    universe,
  };
  const body = JSON.stringify(payload);
  screenerSnapshot = { ts, body };
  return body;
}

// Pre-warm screener snapshot on boot & every 60s (mirrors Cloudflare 1-minute Cron Trigger)
buildScreenerBody().catch(() => {});
setInterval(() => {
  buildScreenerBody().catch(() => {});
}, 60 * 1000);

app.get("/api/screener", async (_req, res) => {
  const t0 = Date.now();
  try {
    if (screenerSnapshot.body && Date.now() - screenerSnapshot.ts < 65000) {
      res.set({
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=30",
        "X-Cache": "HIT-EDGE",
        "Server-Timing": `edge;dur=${Date.now() - t0}`,
      });
      return res.send(screenerSnapshot.body);
    }
    const body = await buildScreenerBody();
    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=30",
      "X-Cache": "MISS",
      "Server-Timing": `origin;dur=${Date.now() - t0}`,
    });
    return res.send(body);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || "Screener error" });
  }
});

app.get("/api/quote", (req, res) => {
  const raw = String(req.query.symbols || req.query.symbol || "").trim();
  const list = raw ? raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : ["BTCUSDT"];
  const quotes = {};
  const now = Math.floor(Date.now() / 1000);
  for (const s of list) {
    const meta = inferMeta(s);
    const p = livePrices.get(s) || meta.p || 1;
    quotes[s] = {
      s,
      c: p,
      t: now,
      m: meta.m || "STK"
    };
  }
  return res.json({ ok: true, ts: Date.now(), quotes });
});

app.get("/api/candles", async (req, res) => {
  const t0 = Date.now();
  const rawSym = String(req.query.symbol || "").trim().toUpperCase();
  const interval = String(req.query.interval || "1H").trim();
  const mktHint = String(req.query.mkt || "").trim().toUpperCase();
  const apiHint = String(req.query.apiSym || "").trim();
  const fromSec = Math.max(0, Math.floor(Number(req.query.from) || 0));
  const toSec = Math.max(0, Math.floor(Number(req.query.to) || 0));
  const limit = Math.max(10, Math.min(5000, Math.floor(Number(req.query.limit) || (fromSec || toSec ? 1500 : 250))));
  const replay = req.query.replay === "1";

  if (!rawSym || !STEPS[interval]) {
    return res.status(400).json({ ok: false, error: "Invalid symbol or interval" });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const step = STEPS[interval];
  const isHistoricalWindow = (toSec > 0 && toSec < nowSec - step * 4) || (fromSec > 0 && !toSec && limit > 250);
  const ttl = isHistoricalWindow && toSec > 0 ? 86400 : interval === "1m" || interval === "5m" ? 60 : 300;
  const cacheKey = `${rawSym}|${interval}|${fromSec}|${toSec}|${limit}|${replay ? 1 : 0}`;
  const cached = candleCache.get(cacheKey);
  if (cached && (isHistoricalWindow || Date.now() - cached.ts < ttl * 1000)) {
    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${ttl}, s-maxage=${ttl}`,
      "X-Cache": "HIT-EDGE",
      "Server-Timing": `edge;dur=${Date.now() - t0}`,
    });
    return res.send(cached.body);
  }

  const meta = inferMeta(rawSym, mktHint, apiHint);
  const opts = { from: fromSec, to: toSec, limit, replay };
  let bars = null;
  let source = "simulator";

  if (meta.pr === "bn" || meta.m === "CRY") {
    bars = await fetchBinanceCandles(meta.api || rawSym, interval, opts);
    if (bars) source = "binance";
  }
  if (!bars && DUKASCOPY_MAP[rawSym] && (replay || fromSec > 0 || toSec > 0 || limit > 250 || meta.m === "FX" || meta.m === "CFD")) {
    bars = await fetchDukascopyCandles(rawSym, interval, opts, livePrices.get(rawSym) || meta.p);
    if (bars) source = "dukascopy";
  }
  if (!bars && TWELVEDATA_KEY) {
    bars = await fetchTwelveDataCandles(meta.td || rawSym, interval, opts);
    if (bars) source = "twelvedata";
  }
  if (!bars) {
    bars = await fetchYahooCandles(meta.api || rawSym, interval, opts);
    if (bars) source = "yahoo";
  }
  if (!bars) {
    const endAnchor = toSec > 0 ? Math.floor(toSec / step) * step : Math.floor(nowSec / step) * step;
    const rawSim = generateSyntheticCandles(rawSym, interval, limit, livePrices.get(rawSym) || meta.p);
    const shift = endAnchor - rawSim[rawSim.length - 1].t;
    bars = shift !== 0 ? rawSim.map((b) => ({ ...b, t: b.t + shift })) : rawSim;
    if (fromSec > 0) bars = bars.filter((b) => b.t >= fromSec);
    if (toSec > 0) bars = bars.filter((b) => b.t <= toSec);
    source = "simulator";
  }

  bars = sanitizeCandles(bars);

  const payload = {
    ok: true,
    symbol: rawSym,
    interval,
    ttl,
    ts: Date.now(),
    source,
    bars,
  };
  const body = JSON.stringify(payload);
  if (candleCache.size > 500) candleCache.clear();
  candleCache.set(cacheKey, { ts: Date.now(), body });

  res.set({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `public, max-age=${ttl}, s-maxage=${ttl}`,
    "X-Cache": "MISS",
    "Server-Timing": `origin;dur=${Date.now() - t0}`,
  });
  return res.send(body);
});

const calendarCache = { ts: 0, body: "" };
const newsCache = new Map();

function generateWeeklyMacroSchedule(nowMs) {
  const now = new Date(nowMs);
  const utcDay = now.getUTCDay();
  const weekStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - utcDay, 0, 0, 0, 0);
  const slots = [
    [0, 23, 50, "JPY", "Medium", "Core Machinery Orders m/m", "1.1%", "-0.4%", "1.4%"],
    [1, 2, 0, "CNY", "Medium", "Industrial Production y/y", "5.5%", "5.4%", "5.8%"],
    [1, 7, 0, "EUR", "Low", "Trade Balance", "14.2B", "13.6B", "15.1B"],
    [1, 13, 30, "USD", "Medium", "Empire State Manufacturing Index", "0.8", "-11.9", "3.2"],
    [1, 13, 30, "CAD", "Medium", "Housing Starts", "242K", "238K", "247K"],
    [2, 0, 30, "AUD", "High", "RBA Monetary Policy Meeting Minutes", "", "", ""],
    [2, 7, 0, "GBP", "High", "Average Earnings Index 3m/y", "4.7%", "4.8%", "4.9%"],
    [2, 7, 0, "GBP", "High", "Claimant Count Change", "18.5K", "27.9K", "16.2K"],
    [2, 10, 0, "EUR", "Medium", "ZEW Economic Sentiment", "16.4", "13.1", "17.8"],
    [2, 13, 30, "CAD", "High", "CPI m/m", "0.3%", "-0.4%", "0.4%"],
    [2, 13, 30, "CAD", "High", "Trimmed CPI y/y", "2.6%", "2.5%", "2.6%"],
    [2, 13, 30, "USD", "Medium", "Building Permits", "1.44M", "1.43M", "1.41M"],
    [3, 7, 0, "GBP", "High", "CPI y/y", "2.2%", "1.7%", "2.3%"],
    [3, 7, 0, "GBP", "Medium", "Core CPI y/y", "3.2%", "3.2%", "3.3%"],
    [3, 13, 30, "USD", "High", "Core Retail Sales m/m", "0.3%", "0.5%", "0.4%"],
    [3, 13, 30, "USD", "High", "Retail Sales m/m", "0.3%", "0.4%", "0.4%"],
    [3, 15, 30, "USD", "Low", "Crude Oil Inventories", "1.2M", "2.1M", "-0.6M"],
    [3, 19, 0, "USD", "High", "FOMC Meeting Minutes", "", "", ""],
    [3, 21, 45, "NZD", "High", "PPI Input q/q", "0.6%", "1.4%", "0.8%"],
    [4, 0, 30, "AUD", "High", "Employment Change", "25.4K", "64.1K", "29.1K"],
    [4, 0, 30, "AUD", "High", "Unemployment Rate", "4.1%", "4.1%", "4.1%"],
    [4, 7, 30, "CHF", "Medium", "Trade Balance", "4.85B", "4.94B", "5.12B"],
    [4, 13, 30, "USD", "High", "Unemployment Claims", "220K", "217K", "215K"],
    [4, 13, 30, "USD", "Medium", "Philly Fed Manufacturing Index", "7.4", "10.3", "6.2"],
    [4, 15, 0, "USD", "Medium", "Existing Home Sales", "3.95M", "3.84M", "3.96M"],
    [4, 23, 30, "JPY", "High", "National Core CPI y/y", "2.2%", "2.4%", "2.3%"],
    [5, 7, 0, "GBP", "Medium", "Retail Sales m/m", "-0.3%", "0.3%", "-0.1%"],
    [5, 8, 30, "EUR", "High", "German Flash Manufacturing PMI", "43.1", "43.0", "43.4"],
    [5, 8, 30, "EUR", "High", "German Flash Services PMI", "51.7", "51.6", "51.2"],
    [5, 9, 30, "GBP", "High", "Flash Manufacturing PMI", "50.1", "49.9", "50.4"],
    [5, 9, 30, "GBP", "High", "Flash Services PMI", "52.1", "52.0", "51.8"],
    [5, 13, 30, "CAD", "High", "Core Retail Sales m/m", "0.4%", "-0.7%", "0.5%"],
    [5, 14, 45, "USD", "High", "Flash Manufacturing PMI", "48.9", "48.5", "49.2"],
    [5, 14, 45, "USD", "High", "Flash Services PMI", "55.2", "55.0", "55.6"],
    [5, 15, 0, "USD", "Medium", "Revised UoM Consumer Sentiment", "73.5", "73.0", "73.2"],
  ];

  return slots
    .map(([dOff, hh, mm, ccy, imp, title, fc, pv, act]) => {
      const t = weekStart + ((dOff * 24 + hh) * 60 + mm) * 60000;
      const released = t <= nowMs - 60000;
      return { t, hasTime: true, title, ccy, imp, fc, pv, act: released ? act : "" };
    })
    .sort((a, b) => a.t - b.t);
}

app.get("/api/calendar", async (req, res) => {
  const t0 = Date.now();
  const force = req.query.force === "1";
  if (!force && calendarCache.body && Date.now() - calendarCache.ts < 900 * 1000) {
    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=900",
      "X-Cache": "HIT-EDGE",
      "Server-Timing": `edge;dur=${Date.now() - t0}`,
    });
    return res.send(calendarCache.body);
  }

  let events = null;
  let source = "macro-schedule";
  try {
    const json = await fetchJSON("https://nfs.faireconomy.media/ff_calendar_thisweek.json", 4500);
    if (Array.isArray(json) && json.length) {
      const impSet = new Set(["High", "Medium", "Low", "Holiday"]);
      events = json
        .filter((e) => e && typeof e.title === "string" && typeof e.date === "string" && isFinite(Date.parse(e.date)))
        .map((e) => {
          const hasTime = /T\d{2}:\d{2}/.test(e.date) && !(e.time && /all\s*day|tentative/i.test(String(e.time))) && e.impact !== "Holiday";
          return {
            t: Date.parse(e.date),
            hasTime,
            title: e.title.slice(0, 140),
            ccy: String(e.country || "").toUpperCase().slice(0, 4),
            imp: impSet.has(e.impact) ? e.impact : "Low",
            fc: String(e.forecast == null ? "" : e.forecast).slice(0, 24),
            pv: String(e.previous == null ? "" : e.previous).slice(0, 24),
            act: String(e.actual == null ? "" : e.actual).slice(0, 24),
          };
        })
        .sort((a, b) => a.t - b.t);
      if (events.length) source = "forexfactory";
    }
  } catch (_e) {}

  if (!events || !events.length) {
    events = generateWeeklyMacroSchedule(Date.now());
    source = "macro-schedule";
  }

  const body = JSON.stringify({ ok: true, source, ts: Date.now(), ttl: 900, events });
  calendarCache.ts = Date.now();
  calendarCache.body = body;
  res.set({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300, s-maxage=900",
    "X-Cache": "MISS",
    "Server-Timing": `origin;dur=${Date.now() - t0}`,
  });
  return res.send(body);
});

function decodeXmlEntities(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .trim();
}

app.get("/api/news", async (req, res) => {
  const t0 = Date.now();
  const sym = String(req.query.symbol || "").trim().toUpperCase().slice(0, 24);
  if (!sym) return res.status(400).json({ ok: false, error: "Missing symbol" });

  const cached = newsCache.get(sym);
  if (cached && Date.now() - cached.ts < 300 * 1000) {
    res.set({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Cache": "HIT-EDGE",
    });
    return res.send(cached.body);
  }

  let items = [];
  let source = "yahoo";
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(sym)}&region=US&lang=en-US`;
    const resp = await fetch(rssUrl, {
      signal: ac.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; VektorTerminal/1.0)", accept: "application/rss+xml, application/xml, text/xml" },
    });
    clearTimeout(timer);
    if (resp.ok) {
      const xml = await resp.text();
      const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const blk of blocks.slice(0, 20)) {
        const titleM = /<title>([\s\S]*?)<\/title>/i.exec(blk);
        const linkM = /<link>([\s\S]*?)<\/link>/i.exec(blk);
        const pubM = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(blk);
        const title = decodeXmlEntities(titleM ? titleM[1] : "").slice(0, 200);
        let link = decodeXmlEntities(linkM ? linkM[1] : "");
        try {
          const parsed = new URL(link);
          link = /^https?:$/.test(parsed.protocol) ? parsed.href : "";
        } catch (_e) {
          link = "";
        }
        const t = pubM ? Date.parse(decodeXmlEntities(pubM[1])) : NaN;
        if (title && link) items.push({ title, link, t: isFinite(t) ? t : null });
      }
    } else {
      source = "unavailable";
    }
  } catch (_e) {
    source = "unavailable";
  }

  const body = JSON.stringify({ ok: true, symbol: sym, source, ts: Date.now(), items });
  newsCache.set(sym, { ts: Date.now(), body });
  res.set({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300, s-maxage=300",
    "X-Cache": "MISS",
    "Server-Timing": `origin;dur=${Date.now() - t0}`,
  });
  return res.send(body);
});

app.use(
  express.static(__dirname, {
    dotfiles: "ignore",
    index: ["index.html"],
  })
);

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });
const clients = new Map(); // ws -> { subs: Set<string>, interval: string }
let binanceUpstream = null;
let lastBinanceAt = 0;

function broadcastWs(payload) {
  const raw = JSON.stringify(payload);
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(raw);
      } catch (_e) {}
    }
  }
}

function ensureBinanceUpstream() {
  if (binanceUpstream || clients.size === 0) return;
  try {
    const uws = new WebSocket("wss://stream.binance.com:9443/ws/!ticker@arr");
    binanceUpstream = uws;
    uws.on("message", (data) => {
      lastBinanceAt = Date.now();
      try {
        const arr = JSON.parse(String(data));
        if (!Array.isArray(arr)) return;
        const ticks = [];
        for (const t of arr) {
          if (!t.s || !t.s.endsWith("USDT") || STABLE_RE.test(t.s)) continue;
          const c = +t.c;
          if (c > 0) {
            livePrices.set(t.s, c);
            ticks.push({ s: t.s, c, h: +t.h, l: +t.l, v: +t.v });
          }
        }
        if (ticks.length) {
          broadcastWs({ type: "ticks", source: "binance", ticks: ticks.slice(0, 120), ts: Date.now() });
        }
      } catch (_e) {}
    });
    uws.on("close", () => { binanceUpstream = null; });
    uws.on("error", () => {
      try { uws.close(); } catch (_e) {}
      binanceUpstream = null;
    });
  } catch (_e) {
    binanceUpstream = null;
  }
}

wss.on("connection", (ws) => {
  clients.set(ws, { subs: new Set(), interval: "1H" });
  ensureBinanceUpstream();

  ws.send(
    JSON.stringify({
      type: "hello",
      relay: "NodeLocalRelay",
      hibernation: false,
      mode: TWELVEDATA_KEY ? "live+twelvedata" : "live+simulator",
      ts: Date.now(),
    })
  );

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        return;
      }
      if (msg.type === "subscribe") {
        const state = clients.get(ws) || { subs: new Set(), interval: "1H" };
        if (Array.isArray(msg.symbols)) {
          state.subs = new Set(msg.symbols.map((s) => String(s).toUpperCase()));
        } else if (msg.symbol) {
          state.subs.add(String(msg.symbol).toUpperCase());
        }
        if (msg.interval && STEPS[msg.interval]) state.interval = msg.interval;
        clients.set(ws, state);
      }
    } catch (_e) {}
  });

  ws.on("close", () => {
    clients.delete(ws);
    if (clients.size === 0 && binanceUpstream) {
      try { binanceUpstream.close(); } catch (_e) {}
      binanceUpstream = null;
    }
  });
});

// Live tick + multi-timeframe candle simulator fallback loop (active only when clients are connected)
setInterval(() => {
  if (clients.size === 0) return;
  ensureBinanceUpstream();
  const bnSilent = Date.now() - lastBinanceAt > 5000;
  const nowSec = Math.floor(Date.now() / 1000);
  const ticks = [];

  for (const item of BASE_INSTRUMENTS) {
    if (item.m === "CRY" && !bnSilent) continue;
    const prev = livePrices.get(item.s) || item.p;
    const stepPct = (Math.random() - 0.5) * (item.vf || 0.015) * 0.08;
    const dec = prev < 10 ? 5 : prev < 100 ? 3 : 2;
    const next = Number(Math.max(0.0001, prev * (1 + stepPct)).toFixed(dec));
    livePrices.set(item.s, next);
    ticks.push({ s: item.s, c: next });
  }

  const activeSubs = new Map();
  for (const state of clients.values()) {
    for (const sym of state.subs) {
      if (!activeSubs.has(sym)) activeSubs.set(sym, new Set());
      activeSubs.get(sym).add(state.interval || "1H");
    }
  }

  for (const sym of activeSubs.keys()) {
    if (BY_SYM.has(sym)) continue;
    const prev = livePrices.get(sym) || 100;
    const next = Number((prev * (1 + (Math.random() - 0.5) * 0.0012)).toFixed(prev < 10 ? 4 : 2));
    livePrices.set(sym, next);
    ticks.push({ s: sym, c: next });
  }

  if (ticks.length) {
    broadcastWs({ type: "ticks", source: "simulator", ticks, ts: Date.now() });
  }

  for (const [sym, ivs] of activeSubs) {
    const c = livePrices.get(sym);
    if (!c) continue;
    for (const iv of ivs) {
      const step = STEPS[iv] || 3600;
      const bucket = Math.floor(nowSec / step) * step;
      const spread = c * 0.0008;
      broadcastWs({
        type: "kline",
        symbol: sym,
        interval: iv,
        bar: {
          t: bucket,
          o: c,
          h: Number((c + spread).toFixed(c < 10 ? 5 : 2)),
          l: Number(Math.max(0.0001, c - spread).toFixed(c < 10 ? 5 : 2)),
          c,
          v: Math.round(100 + Math.random() * 900),
        },
      });
    }
  }
}, 1000);

server.listen(PORT, HOST, () => {
  console.log(`Vektor Terminal listening on http://${HOST}:${PORT}`);
});
