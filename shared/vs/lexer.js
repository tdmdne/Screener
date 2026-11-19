// shared/vs/lexer.js — Vektor Script tokenizer, constants, and structured error class.
// Pure ES module, zero Node APIs; compatible with Node 22+ and Cloudflare Workers.
// Semantics match index.html lines 4190-4212.

/** Execution and syntax limits enforced across lexing, parsing, and evaluation. */
export const VS_LIM = Object.freeze({
  src: 20000,
  stmts: 300,
  depth: 40,
  len: 1000,
  plots: 12,
  hlines: 8,
  nodes: 2e6,
});

/** Built-in OHLCV & bar index series identifiers exposed in every script environment. */
export const VS_SERIES = Object.freeze([
  "open",
  "high",
  "low",
  "close",
  "volume",
  "hl2",
  "hlc3",
  "ohlc4",
  "bar_index",
  "time",
]);

/** Named colour palette (null-prototype map so prototype keys never resolve). */
export const VS_COLORS = Object.freeze(
  Object.assign(Object.create(null), {
    blue: "#2962ff",
    red: "#f23645",
    green: "#089981",
    orange: "#fb923c",
    yellow: "#f5c518",
    purple: "#9c27b0",
    teal: "#00897b",
    gray: "#787b86",
    grey: "#787b86",
    white: "#ffffff",
    black: "#131722",
    aqua: "#00bcd4",
    lime: "#76ff03",
    fuchsia: "#e040fb",
    navy: "#1a237e",
    maroon: "#880e4f",
    olive: "#827717",
    silver: "#b2b5be",
  })
);

const VS_KEYWORDS = new Set(["and", "or", "not", "true", "false", "na"]);

/** Safe own-property check that works on null-prototype and ordinary objects. */
export const vsOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Structured Vektor Script error carrying 1-based line/col and a user-facing hint. */
export class VSError extends Error {
  /**
   * @param {string} msg
   * @param {number} [line=0]
   * @param {number} [col=0]
   * @param {string} [hint=""]
   */
  constructor(msg, line, col, hint) {
    super(msg);
    this.name = "VSError";
    this.line = line || 0;
    this.col = col || 0;
    this.hint = hint || "";
  }

  /** @returns {{ error: string, line: number, col: number, hint: string }} */
  toPayload() {
    return {
      error: this.message,
      line: this.line,
      col: this.col,
      hint: this.hint,
    };
  }
}

/**
 * Tokenize Vektor Script source text into a stream ending with an `eof` token.
 * Every token carries `{ t, v, line, col }`.
 *
 * @param {string} src
 * @returns {Array<{ t: string, v: string|number, line: number, col: number }>}
 */
export function vsLex(src) {
  if (typeof src !== "string") {
    throw new VSError("Script must be text", 0, 0, "Pass Vektor Script source as a string.");
  }
  const T = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = src.length;
  const push = (t, v, l, c) => T.push({ t, v, line: l, col: c });

  while (i < n) {
    const ch = src[i];
    const l = line;
    const c = col;

    if (ch === "\n") {
      push("nl", "\n", l, c);
      i++;
      line++;
      col = 1;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      col++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") {
        i++;
        col++;
      }
      continue;
    }
    if (/[0-9.]/.test(ch) && /[0-9]/.test(ch === "." ? src[i + 1] || "" : ch)) {
      let j = i;
      while (j < n && /[0-9.]/.test(src[j])) j++;
      if (src[j] === "e" || src[j] === "E") {
        j++;
        if (src[j] === "+" || src[j] === "-") j++;
        while (j < n && /[0-9]/.test(src[j])) j++;
      }
      const s = src.slice(i, j);
      const v = Number(s);
      if (!isFinite(v)) {
        throw new VSError(
          "\u201c" + s + "\u201d isn\u2019t a valid number",
          l,
          c,
          "Check the number syntax, e.g. 14 or 0.5."
        );
      }
      push("num", v, l, c);
      col += j - i;
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const w = src.slice(i, j);
      push(VS_KEYWORDS.has(w) ? "kw" : "id", w, l, c);
      col += j - i;
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let s = "";
      while (j < n && src[j] !== ch) {
        if (src[j] === "\n") {
          throw new VSError(
            "Text in quotes must end on the same line",
            l,
            c,
            "Add the closing " + ch + "."
          );
        }
        s += src[j];
        j++;
      }
      if (j >= n) {
        throw new VSError("Text in quotes isn\u2019t closed", l, c, "Add the closing " + ch + ".");
      }
      if (s.length > 80) {
        throw new VSError(
          "Text is too long (80 characters max)",
          l,
          c,
          "Shorten the quoted text to 80 characters or fewer."
        );
      }
      push("str", s, l, c);
      col += j - i + 1;
      i = j + 1;
      continue;
    }
    if (ch === "#") {
      const m = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/.exec(src.slice(i, i + 8));
      if (!m) {
        throw new VSError(
          "Colours are written like #2962ff",
          l,
          c,
          "Use 6 hex digits after #, or a name such as blue or red."
        );
      }
      push("color", "#" + m[1].toLowerCase(), l, c);
      col += m[0].length;
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=" || two === ":=") {
      push("op", two === ":=" ? "=" : two, l, c);
      i += 2;
      col += 2;
      continue;
    }
    if ("+-*/%<>=?:(),[];".includes(ch)) {
      push(ch === ";" ? "nl" : "op", ch, l, c);
      i++;
      col++;
      continue;
    }
    if (ch === ".") {
      throw new VSError(
        "\u201c.\u201d isn\u2019t allowed here",
        l,
        c,
        "Vektor Script has no object properties. Call functions directly, e.g. sma(close, 20)."
      );
    }
    throw new VSError(
      "Unexpected character \u201c" + ch + "\u201d",
      l,
      c,
      "Remove the unexpected character."
    );
  }

  push("eof", "", line, col);
  return T;
}
