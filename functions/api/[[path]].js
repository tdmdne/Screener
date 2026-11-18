// Cloudflare Pages Function catch-all for /api/*
// Delegates all API requests (candles, screener, calendar, news, quote) directly to the worker.js handler with secure secret mapping and CORS headers
import worker from "../../worker.js";

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "Content-Type, Authorization",
      },
    });
  }

  // Ensure secrets / environment bindings are passed correctly from Cloudflare secrets
  const augmentedEnv = {
    ...env,
    TWELVEDATA_KEY: env.TWELVEDATA_KEY || env.TWELVE_DATA_API_KEY || "",
    FINNHUB_API_KEY: env.FINNHUB_API_KEY || env.FINNHUB_KEY || "",
  };

  // Forward to worker.js default fetch handler
  try {
    const res = await worker.fetch(request, augmentedEnv, context);
    const newHeaders = new Headers(res.headers);
    newHeaders.set("access-control-allow-origin", "*");
    newHeaders.set("access-control-allow-methods", "GET, POST, OPTIONS");
    newHeaders.set("access-control-allow-headers", "Content-Type");
    newHeaders.set("access-control-expose-headers", "x-cache, server-timing, cache-control");
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: "API delegation error", message: String(err && err.message || err) }),
      {
        status: 500,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "access-control-allow-origin": "*",
        },
      }
    );
  }
}
