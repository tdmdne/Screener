// shared/vs/parser.js — Vektor Script precedence-climbing parser.
// Pure ES module, zero Node APIs; compatible with Node 22+ and Cloudflare Workers.
// Semantics match index.html lines 4214-4242.

import { VS_LIM, VS_SERIES, VSError, vsLex, vsOwn } from "./lexer.js";
import { VS_DECL, VS_FN } from "./builtins.js";

/** Maximum total AST nodes permitted in a single parsed script (prevents memory/CPU DoS). */
export const MAX_VS_AST_NODES = 4000;

const BIN = [
  ["or"],
  ["and"],
  ["==", "!="],
  ["<", "<=", ">", ">="],
  ["+", "-"],
  ["*", "/", "%"],
];

/**
 * Parse Vektor Script source text into a list of AST statements.
 * Enforces VS_LIM.src, VS_LIM.stmts, VS_LIM.depth (across primary, unary, ternary, binary &
 * postfix history chains), and MAX_VS_AST_NODES.
 *
 * @param {string} src
 * @param {{ src?: number, stmts?: number, depth?: number, astNodes?: number }} [limits=VS_LIM]
 * @returns {Array<object>}
 */
export function vsParse(src, limits = VS_LIM) {
  const lim = limits === VS_LIM ? VS_LIM : { ...VS_LIM, ...limits };
  const maxAstNodes = lim.astNodes != null ? lim.astNodes : MAX_VS_AST_NODES;
  if (typeof src !== "string") {
    throw new VSError("Script must be text", 0, 0, "Pass Vektor Script source as a string.");
  }
  if (src.length > lim.src) {
    throw new VSError(
      "Script is too long (" + lim.src + " characters max)",
      0,
      0,
      "Shorten the script to " + lim.src + " characters or fewer."
    );
  }

  const T = vsLex(src);
  let p = 0;
  let depth = 0;
  let astNodes = 0;
  const pk = () => T[p];
  const nx = () => T[p++];
  const is = (t, v) => T[p].t === t && (v === undefined || T[p].v === v);

  const makeNode = (node) => {
    if (++astNodes > maxAstNodes) {
      throw new VSError(
        "The script is too complex (" + maxAstNodes + " expressions max)",
        node.line,
        node.col,
        "Simplify the script into fewer expressions."
      );
    }
    return node;
  };

  const want = (t, v, hint) => {
    if (!is(t, v)) {
      const k = T[p];
      throw new VSError(
        "Expected \u201c" +
          (v || t) +
          "\u201d" +
          (k.t === "eof"
            ? " before the end of the script"
            : " but found \u201c" + (k.t === "nl" ? "end of line" : k.v) + "\u201d"),
        k.line,
        k.col,
        hint || "Add the missing \u201c" + (v || t) + "\u201d."
      );
    }
    return nx();
  };

  const deep = (k) => {
    if (++depth > lim.depth) {
      throw new VSError(
        "Expression is nested too deeply",
        k.line,
        k.col,
        "Split it into a few named steps."
      );
    }
  };

  function primary() {
    const k = pk();
    deep(k);
    let e;
    if (is("num")) {
      nx();
      e = makeNode({ k: "num", v: k.v, line: k.line, col: k.col });
    } else if (is("str")) {
      nx();
      e = makeNode({ k: "str", v: k.v, line: k.line, col: k.col });
    } else if (is("color")) {
      nx();
      e = makeNode({ k: "str", v: k.v, line: k.line, col: k.col });
    } else if (is("kw", "true") || is("kw", "false")) {
      nx();
      e = makeNode({ k: "num", v: k.v === "true" ? 1 : 0, line: k.line, col: k.col });
    } else if (is("kw", "na")) {
      nx();
      e = makeNode({ k: "num", v: NaN, line: k.line, col: k.col });
    } else if (is("op", "(")) {
      nx();
      e = expr();
      want("op", ")", "Close the parenthesised expression with \u201c)\u201d.");
    } else if (is("id")) {
      nx();
      if (is("op", "(")) {
        nx();
        const args = [];
        const kw = Object.create(null);
        if (!is("op", ")")) {
          for (;;) {
            while (is("nl")) nx();
            if (is("id") && T[p + 1].t === "op" && T[p + 1].v === "=") {
              const nm = nx().v;
              nx();
              kw[nm] = expr();
            } else {
              args.push(expr());
            }
            while (is("nl")) nx();
            if (is("op", ",")) {
              nx();
              continue;
            }
            break;
          }
        }
        want("op", ")", "Close the call to " + k.v + "( with \u201c)\u201d.");
        e = makeNode({ k: "call", f: k.v, args, kw, line: k.line, col: k.col });
      } else {
        e = makeNode({ k: "id", v: k.v, line: k.line, col: k.col });
      }
    } else {
      throw new VSError(
        k.t === "eof"
          ? "The script ends in the middle of an expression"
          : k.t === "nl"
            ? "This line ends in the middle of an expression"
            : "Unexpected \u201c" + k.v + "\u201d",
        k.line,
        k.col,
        k.t === "nl" || k.t === "eof"
          ? "Finish the expression or remove the operator at the end of the line."
          : "Check the expression syntax around \u201c" + k.v + "\u201d."
      );
    }

    let histChain = 0;
    while (is("op", "[")) {
      const b = nx();
      deep(b);
      histChain++;
      const i = expr();
      want("op", "]", "Close the history lookback with \u201c]\u201d.");
      e = makeNode({ k: "hist", e, i, line: b.line, col: b.col });
    }
    depth -= histChain;

    depth--;
    return e;
  }

  function unary() {
    if (is("op", "-")) {
      const k = nx();
      deep(k);
      const e = unary();
      depth--;
      return makeNode({ k: "neg", e, line: k.line, col: k.col });
    }
    if (is("op", "+")) {
      const k = nx();
      deep(k);
      const e = unary();
      depth--;
      return e;
    }
    if (is("kw", "not")) {
      const k = nx();
      deep(k);
      const e = unary();
      depth--;
      return makeNode({ k: "not", e, line: k.line, col: k.col });
    }
    return primary();
  }

  function bin(l) {
    if (l >= BIN.length) return unary();
    let a = bin(l + 1);
    let chain = 0;
    for (;;) {
      const k = pk();
      const op = (k.t === "op" || k.t === "kw") && BIN[l].includes(k.v) ? k.v : null;
      if (!op) {
        depth -= chain;
        return a;
      }
      nx();
      deep(k);
      chain++;
      a = makeNode({ k: "bin", op, a, b: bin(l + 1), line: k.line, col: k.col });
    }
  }

  function expr() {
    const c = bin(0);
    if (is("op", "?")) {
      const k = nx();
      deep(k);
      const a = expr();
      want("op", ":", "Ternary expressions require both ? and :, e.g. cond ? a : b.");
      const b = expr();
      depth--;
      return makeNode({ k: "tern", c, a, b, line: k.line, col: k.col });
    }
    return c;
  }

  const prog = [];
  while (!is("eof")) {
    if (is("nl")) {
      nx();
      continue;
    }
    const k = pk();
    if (prog.length >= lim.stmts) {
      throw new VSError(
        "Too many statements (" + lim.stmts + " max)",
        k.line,
        k.col,
        "Reduce the script to " + lim.stmts + " statements or fewer."
      );
    }
    if (is("id") && T[p + 1].t === "op" && T[p + 1].v === "=") {
      const nm = nx().v;
      nx();
      if (VS_SERIES.includes(nm) || vsOwn(VS_FN, nm) || VS_DECL.includes(nm)) {
        throw new VSError(
          "\u201c" + nm + "\u201d is a built-in name and can\u2019t be reassigned",
          k.line,
          k.col,
          "Pick another name, e.g. my_" + nm + "."
        );
      }
      prog.push(makeNode({ k: "set", n: nm, e: expr(), line: k.line, col: k.col }));
    } else {
      prog.push(makeNode({ k: "do", e: expr(), line: k.line, col: k.col }));
    }

    if (!is("eof") && !is("nl")) {
      const q = pk();
      throw new VSError(
        "Expected a new line after this statement but found \u201c" + q.v + "\u201d",
        q.line,
        q.col,
        "Put each statement on its own line."
      );
    }
  }

  return prog;
}
