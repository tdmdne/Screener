export async function onRequest(context) {
  const url = new URL(context.request.url);
  let symbol = url.searchParams.get("symbol");
  const interval = url.searchParams.get("interval") || "1d";
  const range = url.searchParams.get("range") || "2y";

  if (!symbol) {
    return new Response(JSON.stringify({ error: "Missing symbol parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Automatically append '=X' for forex tickers like EURUSD if missing
  const cleanSym = symbol.trim().toUpperCase();
  if (/^[A-Z]{6}$/.test(cleanSym) && !cleanSym.includes("=")) {
    symbol = cleanSym + "=X";
  }

  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;

  try {
    const response = await fetch(yahooUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      }
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `Yahoo HTTP ${response.status}` }), {
        status: response.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
