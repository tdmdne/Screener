// shared/vs/index.js — Barrel export for the server-side Vektor Script engine.

export { VS_LIM, VS_SERIES, VS_COLORS, VSError, vsOwn, vsLex } from "./lexer.js";
export { MAX_VS_AST_NODES, vsParse } from "./parser.js";
export {
  VS_FN,
  VS_BUILTIN_NAMES,
  VS_DECL,
  vsIsS,
  vsErr,
  vsMap1,
  vsMap2,
  vsSer,
  vsLen,
  vsSMA,
  vsEMA,
  vsSum,
  vsHighest,
  vsLowest,
  vsWMA,
  vsStdev,
  vsWin,
  vsShift,
  vsLev,
  vsSuggest,
  vsColor,
} from "./builtins.js";
export {
  MAX_VS_BARS,
  vsRun,
  vsCompute,
  vsCacheKey,
  vsBarsKey,
  vsErrorPayload,
  vsFmtErr,
} from "./runtime.js";
