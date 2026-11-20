// worker/cors.js — CORS + response helpers.

/** Comma-separated ALLOWED_ORIGINS env var; "*" (default) allows any. Wildcard subdomains: "*.pages.dev". */
export function allowedOrigin(req, env) {
  const origin = req.headers.get("Origin");
  const list = String(env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.includes("*")) return origin || "*";
  if (!origin) return null;
  const host = (() => { try { return new URL(origin).host; } catch { return ""; } })();
  for (const rule of list) {
    if (rule === origin) return origin;
    if (rule.startsWith("*.") && host.endsWith(rule.slice(1))) return origin;
  }
  return null;
}

export function corsHeaders(req, env) {
  const o = allowedOrigin(req, env);
  const h = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (o) h["Access-Control-Allow-Origin"] = o;
  return h;
}

export function withCors(res, req, env) {
  // WebSocket upgrade responses are immutable and don't need CORS.
  if (res.status === 101) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(corsHeaders(req, env))) out.headers.set(k, v);
  return out;
}

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}
