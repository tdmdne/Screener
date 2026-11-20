// ---------- Legal pages (#/legal, #/legal/<doc>) + footer ----------
// These pages accurately describe what Vektor Terminal does under UK GDPR and PECR.
// Pre-launch operator details: Vektor Terminal, United Kingdom (England and Wales).
const VT_CONTACT_EMAIL="support@vektorterminal.com";
const VT_MAIL=()=>`<a href="mailto:${VT_CONTACT_EMAIL}">${VT_CONTACT_EMAIL}</a>`;
const LG_META=()=>`<p class="meta">Effective date: 19 November 2026 \u00b7 Operated by Vektor Terminal, United Kingdom (England and Wales). Contact: ${VT_MAIL()}.</p>`;
const LG_STORE=`<table class="ftbl"><thead><tr><th>Where</th><th>Key / name</th><th>What it holds</th></tr></thead><tbody>
<tr><td>localStorage</td><td><code>scr2~\u2026</code> (one per account)</td><td>Saved per signed-in account (the key ends with a code made from your username), so someone else who signs in on the same browser, or a guest, does not see it. Your settings: screener columns and filters, watchlist, price alerts and a log of the alerts that triggered (the last 200), chart settings, drawings and the indicator scripts you write or import, your trade journal (trades, notes and prop-account rules you enter), Supercharts and calculator inputs, and the current page.</td></tr>
<tr><td>localStorage</td><td><code>vt_legacy</code></td><td>Only on devices that had work saved before accounts were separated and nobody was signed in when this version first ran: marks that older work (still under <code>scr2</code>/<code>scr2p</code>) as unclaimed. The next person to sign in is asked whether it is theirs; it is never shown to guests.</td></tr>
<tr><td>localStorage</td><td><code>scr2p~\u2026</code> (one per account)</td><td>Screener layouts you save, per signed-in account.</td></tr>
<tr><td>localStorage</td><td><code>vt_page</code></td><td>The last page you had open.</td></tr>
<tr><td>sessionStorage</td><td><code>vt_guest</code></td><td>Only that you chose \u201cContinue without signing in\u201d, so a reload keeps you in guest mode. Cleared when the tab closes. Guests\u2019 charts, drawings and other work are kept in memory only and are not saved.</td></tr><tr><td>localStorage or sessionStorage</td><td><code>scr2a</code></td><td>The username or email you signed in with. localStorage if you tick \u201cKeep me signed in\u201d, otherwise sessionStorage (cleared when the tab closes). Removed when you log out.</td></tr>
<tr><td>localStorage</td><td><code>vt_consent</code>, <code>vt_consent_log</code></td><td>Your storage choices, plus a log of each choice with its date, time and policy version (the last 50), so we can show what you agreed to.</td></tr>
<tr><td>localStorage (only if you allow it and tick \u201cRemember the key\u201d)</td><td><code>vt_aikey~\u2026</code> (one per account)</td><td><b>Optional preferences:</b> the AI provider name and the API key you entered for the Journal AI review. It stays in this browser and is only ever sent to that provider. It is deleted when you untick \u201cRemember\u201d, press \u201cForget key\u201d or withdraw Optional preferences.</td></tr><tr><td>localStorage (only if you allow it)</td><td><code>vt_prefs</code></td><td><b>Optional preferences</b> you turn on, such as the alert sound and its volume. Only written if you allow \u201cOptional preferences\u201d; deleted when you withdraw that choice.</td></tr>
<tr><td>IndexedDB (only if you allow it)</td><td>database <code>scr</code>, store <code>c</code></td><td>The optional <b>market-data cache</b>: price candles, the list of markets and a snapshot of the screener universe, so the app loads faster. It is only created after you accept it in the storage banner, and it is deleted if you withdraw consent.</td></tr></tbody></table>`;
const LG_SOURCES=`<table class="ftbl"><thead><tr><th>Third party</th><th>Addresses contacted</th><th>Used for</th></tr></thead><tbody>
<tr><td>Binance</td><td>Backend only via our same-origin <code>/api/*</code> and <code>/ws</code> endpoints (server contacts <code>data-api.binance.vision</code> / <code>api.binance.com</code>).</td><td>Live crypto spot prices, historical candles, and screener snapshots fetched server-side. The browser does not make direct requests to Binance.</td></tr>
<tr><td>Twelve Data &amp; Yahoo Finance</td><td>Backend only via our same-origin <code>/api/*</code> and <code>/ws</code> endpoints (server contacts <code>api.twelvedata.com</code> when configured and <code>query1.finance.yahoo.com</code>).</td><td>Live quotes and historical candles for forex, stocks, indices, ETFs and futures, fetched server-side. <b>Data provided by Twelve Data</b> where Twelve Data is configured.</td></tr>
<tr><td>Forex Factory (Fair Economy)</td><td>Backend only via our same-origin <code>/api/calendar</code> endpoint (server contacts <code>nfs.faireconomy.media</code>).</td><td>This week\u2019s economic calendar on the Calendar \u0026 News page. If the upstream feed is unavailable, the calendar shows an unavailable notice rather than synthetic events.</td></tr>
<tr><td>Yahoo Finance RSS</td><td>Backend only via our same-origin <code>/api/news</code> endpoint (server contacts <code>feeds.finance.yahoo.com</code>).</td><td>Headline titles and links only, for the symbols you choose on the Calendar \u0026 News page. Articles open on the publisher\u2019s site.</td></tr>
<tr><td>Dukascopy</td><td>Backend only via our same-origin <code>/api/candles?replay=1</code> endpoint (server contacts <code>datafeed.dukascopy.com</code>).</td><td>Historical OHLC candles used for Backtest Replay across forex, metals, indices and commodities. Your browser does not contact Dukascopy directly.</td></tr>
<tr><td>AI provider you choose (only if you use the Journal AI review)</td><td><code>api.openai.com</code>, <code>api.anthropic.com</code>, or the OpenAI-compatible endpoint you enter</td><td>Only when you press Send in the Journal AI review: the journal data shown on screen, sent with your own key. Never contacted otherwise. Your browser sends this directly; Vektor Terminal has no server in between.</td></tr>
<tr><td>Cloudflare Web Analytics</td><td><code>static.cloudflareinsights.com</code> (<code>beacon.min.js</code>) and <code>/cdn-cgi/rum</code></td><td>Cookieless aggregate page views and performance (Core Web Vitals) when served through Cloudflare. Does not use cookies or cross-site tracking. Cloudflare acts as our processor.</td></tr>
</tbody></table>
<p><b>Attributions.</b> Where a vendor requires a credit, or we give one for transparency, the wording is:</p>
<ul>
<li><b>Data provided by <a href="https://twelvedata.com" target="_blank" rel="noopener noreferrer">Twelve Data</a></b> when Twelve Data feeds are active. Twelve Data\u2019s <a href="https://twelvedata.com/terms" target="_blank" rel="noopener noreferrer">terms</a> apply.</li>
<li>Data provided by <a href="https://www.binance.com" target="_blank" rel="noopener noreferrer">Binance</a>. Use of Binance market data is subject to the <a href="https://www.binance.com/en/terms" target="_blank" rel="noopener noreferrer">Binance Terms of Use</a>.</li>
<li>Market data and news headlines via Yahoo Finance are subject to <a href="https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html" target="_blank" rel="noopener noreferrer">Yahoo\u2019s Terms of Service</a>.</li>
<li>Historical replay data provided by <a href="https://www.dukascopy.com" target="_blank" rel="noopener noreferrer">Dukascopy</a> (Dukascopy Datafeed) for Backtest Replay. Dukascopy\u2019s data terms apply.</li>
<li>Economic calendar data is fetched server-side from Fair Economy (<code>nfs.faireconomy.media</code>).</li>
</ul>
<p>None of these providers endorses Vektor Terminal. Their marks are used only to identify the source of data. Charting libraries (TradingView Lightweight Charts and html2canvas) are self-hosted from this origin under <code>/vendor/</code> rather than loaded from third-party CDNs.</p>
<p><b>How requests are routed.</b> All market-data, screener, calendar, news, and account requests go strictly to our same-origin backend endpoints (<code>/api/*</code> and <code>/ws</code>). The server fetches from the upstream providers above so your browser does not expose market requests directly to third-party data vendors. The only optional direct third-party request from the browser is if you explicitly press Send inside the optional Journal AI review with your own AI API key.</p>
<p><b>What is received, and who is the controller.</b> For requests routed through <code>/api/*</code> and <code>/ws</code>, Vektor Terminal is the controller of operational request metadata (such as your IP address and requested path), and Cloudflare acts as our hosting and D1 processor. None of the market-data providers receives your account credentials, alerts, watchlist, or journal entries.</p>
<p><b>Fonts and icons:</b> no web fonts are loaded and there is no Google Fonts, so text uses your device\u2019s system fonts. Icons are inline SVG supplied with this app and drawn for it; they are not loaded from a third-party icon font or icon service.</p>
<p><b>AI:</b> Scores, tiers, phases and the Journal\u2019s local summary come from fixed, rule-based formulas; no artificial intelligence or machine learning is used for them. The only AI feature is the optional <b>Journal AI review</b>. It is off until you use it and works only with your own API key. When you press Send, your browser sends the journal data shown on screen directly to the AI provider you choose (OpenAI, Anthropic or an OpenAI-compatible endpoint you enter). Vektor Terminal has no server in between and receives neither the data nor your key. The provider\u2019s own terms and privacy policy apply. AI replies can be wrong and are not financial advice.</p>`;
const LEGAL={
terms:["Terms of Use",()=>`<h1>Terms of Use</h1>${LG_META()}
<h2>1. About these terms</h2><p>These terms apply to your use of Vektor Terminal (the “Service”) at <a href="https://vektorterminal.com" target="_blank" rel="noopener noreferrer">https://vektorterminal.com</a>. By using the Service you accept them. If you don’t agree, please don’t use it.</p>
<h2>2. What the Service is</h2><p>Vektor Terminal is a browser-based set of market screening, charting, journaling, calculation and back-testing tools. It does not execute trades, hold money, or connect to any brokerage account. It is information and analytical software only.</p>
<h2>3. Not advice and not a regulated activity</h2><p>Nothing in the Service is investment, financial, tax or legal advice, or a personal recommendation to buy, sell, subscribe for, or hold any investment, cryptoasset or contract for difference. Scores, presets, P1 to P5 tiers, phase labels (including Expansion), heatmaps, alerts, session summaries, back-tests, calculators and Journal AI replies come from formulas or from tools you operate on third-party data. They are information only. They do not take account of your circumstances and are not a regulated activity. Vektor Terminal is not authorised or regulated by the Financial Conduct Authority. The Service is not intended as a financial promotion of any particular investment. See the <a href="#/legal/risk">Risk Disclaimer</a>.</p>
<h2>4. Who can use it</h2><p>The Service is for people aged 18 and over. You must be allowed to use services like this where you live. We don’t knowingly collect data from anyone under 18. If you think a child has used the Service, contact us and we’ll delete anything we hold.</p>
<h2>4a. Plans and access</h2><p>Vektor Terminal is currently free to use on the <b>Free</b> core tier (3 charts, 3 indicators, 3 alerts, plus unlimited P1–P5 screening, bar replay, market heatmaps, and trade journal). Nothing is charged today, and no payment card is required.</p>
<p>An optional <b>Pro Desk (Waitlist)</b> tier for expanded multi-chart capacity and higher alert quotas is planned for launch in 2027. Joining the waitlist does not create a paid contract. Full pricing, billing terms, taxes, and cancellation rights will be published and presented clearly before any paid plan is offered. If paid subscriptions are introduced, we will give at least 30 days’ notice before any price change to an active plan. See <a href="#/legal/refunds">Refunds and Cancellation</a> for applicable consumer rights.</p>
<h2>5. Your account and sign-in</h2><p>Vektor Terminal uses Cloudflare D1 account authentication. Passwords are hashed using PBKDF2-SHA256 with per-user salts and are never stored in plain text. Signed-in sessions use secure, <code>HttpOnly</code> session cookies so your watchlists, chart drawings, alerts, layouts, and trade journal can sync to your account across devices. You are responsible for keeping your password confidential and for activity under your account. If you suspect unauthorised access, sign out and contact ${VT_MAIL()}.</p>
<h2>6. Data providers and API keys</h2><p>Market data comes from third parties (see <a href="#/legal/data">Data Sources</a>), and their own terms apply. If you enter your own API keys, you are responsible for keeping them safe and for following the provider’s terms. Keys are stored in your browser and sent to the provider they belong to. The optional Journal AI review sends your data to the AI provider you choose with your own key, under that provider’s terms and at your own cost. Its replies are generated automatically, can be wrong, and are not financial, investment or trading advice.</p>
<h2>7. Acceptable use</h2><p>Don’t misuse the Service. That includes trying to disrupt it, overloading data providers through it, scraping or redistributing third-party data in breach of their terms, or using it for anything unlawful.</p>
<h2>8. Intellectual property</h2><p>The Service, its design and code belong to Vektor Terminal or its licensors. Third-party libraries are used under their own licences (see <a href="#/legal/data">Data Sources and Attributions</a>). Your own notes, journal entries and settings stay yours.</p>
<h2>9. Availability and changes</h2><p>The Service is provided “as is” and “as available”. Features, data sources and these terms may change. We’ll update the effective date when the terms change.</p>
<h2>10. Liability</h2><p>See the <a href="#/legal/liability">Disclaimer of Liability</a>. Nothing in these terms excludes or limits liability that cannot be limited under the law of England and Wales, including for death or personal injury caused by negligence, or for fraud, and nothing affects your statutory rights as a consumer under the Consumer Rights Act 2015 and other applicable law. Those statutory remedies are not excluded.</p>
<h2>11. Law</h2><p>These terms are governed by the law of England and Wales. The courts of England and Wales have jurisdiction, although if you live elsewhere in the UK you may also bring proceedings in your local courts.</p>
<h2>12. Contact</h2><p>Vektor Terminal, United Kingdom (England and Wales). Email: ${VT_MAIL()}.</p>`],
privacy:["Privacy Policy",()=>`<h1>Privacy Policy</h1>${LG_META()}
<p>This policy explains how personal data is handled when you use Vektor Terminal, under the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018. The Privacy and Electronic Communications Regulations 2003 (PECR) also apply to cookies and similar technologies.</p>
<h2>1. Who is responsible</h2><p>The controller is Vektor Terminal, operating in the United Kingdom (England and Wales). Contact: ${VT_MAIL()}.</p>
<h2>2. The short version</h2><ul><li>Signed-in accounts use Cloudflare D1 authentication (<code>PBKDF2-SHA256</code> password hashing and strictly necessary <code>HttpOnly</code> session cookies) and can cloud-sync your watchlists, chart drawings, alerts, layouts, and trade journal. Local browser storage is also used for fast responsiveness and guest sessions.</li><li>We don’t use advertising or tracking cookies, and we don’t sell data. The hosted site uses Cloudflare Web Analytics and Umami Cloud (cookieless aggregate measurement). See the <a href="#/legal/cookies">cookie notice</a>.</li><li>To show prices, market requests route through our same-origin Cloudflare edge market service (<code>/api/*</code> and <code>/ws</code>), and some optional feeds or streams connect directly from your browser. See section 5.</li><li>If you join the Pro Desk waitlist, we store your email address solely to notify you about launch availability.</li></ul>
<h2>3. Sign-in and account sync</h2><p>When you create an account or sign in, your account record (email address, username, profile details, and a salted <code>PBKDF2-SHA256</code> password hash) is stored in Cloudflare D1. Plain-text passwords are never stored. Signing in issues a strictly necessary <code>HttpOnly</code> session cookie so the server can authenticate your requests and cloud-sync your watchlists, drawings, alerts, and trade journal across devices. Logging out invalidates your session and clears the session cookie.</p>
<h2>4. What’s stored on your device</h2>${LG_STORE}<p>Local workspace preferences and caches stay on your device unless you are signed in with cloud sync enabled. Optional user-supplied API keys stay in your browser and are sent only to the provider they belong to (section 5). You can clear local browser data at any time via <a href="#/legal/your-data">Your data</a> or your browser settings. Data → Reload data also empties the market data cache.</p>
<h2>5. Third parties and this site’s backend</h2>${LG_SOURCES}
<h2>6. Website hosting and Cloudflare D1</h2><p>The site, edge API routes (<code>/api/*</code> and <code>/ws</code>), and Cloudflare D1 account database are hosted by Cloudflare (Cloudflare Pages, Workers, and D1). Cloudflare may keep standard server logs (IP address, time, request path) for security and operation, and acts as our processor under Cloudflare’s Data Processing Addendum. The live hosted site also uses Cloudflare Web Analytics, described in section 5, for which Cloudflare acts as our processor. Umami Cloud, also described in section 5, is a separate cookieless analytics processor.</p>
<p>Signed-in accounts use a strictly necessary <code>HttpOnly</code> session cookie for authentication. Cloudflare, as host, may also set strictly necessary security cookies (for example, to mitigate automated abuse). Strictly necessary cookies do not require consent under PECR. Cloudflare Web Analytics and Umami Cloud do not use cookies according to their documentation.</p>
<h2>7. Notifications and sound</h2><p>When you add a price alert, your browser may ask permission to show notifications. Alerts are checked and shown on your device, and nothing is sent to third-party advertisers.</p>
<h2>8. Lawful bases</h2><table class="ftbl"><thead><tr><th>What</th><th>Purpose</th><th>Lawful basis (UK GDPR Art. 6)</th></tr></thead><tbody>
<tr><td>Account credentials (PBKDF2-SHA256 hash), <code>HttpOnly</code> session cookie, and cloud-synced workspace data (watchlists, drawings, alerts, journal)</td><td>Authenticating your account and syncing the workspace you asked to save</td><td>Contract, Art. 6(1)(b). PECR exempts strictly necessary session cookies and storage from consent.</td></tr>
<tr><td>Strictly necessary storage on your device (settings, alerts, consent record)</td><td>Providing the Service you asked to use, and remembering your work on this device</td><td>Contract, Art. 6(1)(b). PECR exempts this storage from consent because it is strictly necessary to provide the service.</td></tr>
<tr><td>Optional market-data cache (IndexedDB)</td><td>Storing candles on your device so charts reload faster</td><td>Consent, Art. 6(1)(a), and PECR regulation 6. Off until you accept it, and you can withdraw at any time.</td></tr>
<tr><td>Optional preferences (alert sound, remembered Journal AI or Twelve Data keys)</td><td>Remembering optional extras you choose</td><td>Consent, Art. 6(1)(a), and PECR regulation 6. Off until you accept them, and you can withdraw at any time.</td></tr>
<tr><td>Consent record and log</td><td>Showing what you agreed to, and when</td><td>Legal obligation, Art. 6(1)(c): recording consent (UK GDPR Art. 7(1)).</td></tr>
<tr><td>Pro Desk waitlist email address</td><td>Notifying you when Pro Desk launches</td><td>Consent, Art. 6(1)(a). You may unsubscribe or request deletion at any time by emailing ${VT_MAIL()}.</td></tr>
<tr><td>Requests your browser sends to this site’s <code>/api/*</code> and <code>/ws</code> endpoints (IP address, symbol and timeframe)</td><td>Returning the prices, news or calendar you asked for</td><td>Contract, Art. 6(1)(b): providing the Service.</td></tr>
<tr><td>Your browser’s direct requests to market-data providers (IP address and request details)</td><td>Delivering prices or calendar data when the request is made directly</td><td>Legitimate interests, Art. 6(1)(f): delivering the data you asked to see. Each provider is an independent controller of that data.</td></tr>
<tr><td>Cloudflare Web Analytics and Umami Cloud (cookieless, aggregate page views, events and, for Umami, UTM parameters)</td><td>Understanding how the site is used and whether it is performing as intended, in aggregate; measuring sign-up and campaign sources. Not used for advertising or to profile you as an individual</td><td>Legitimate interests, Art. 6(1)(f). See the balancing note below.</td></tr>
<tr><td>Hosting and security logs</td><td>Keeping the website secure and working</td><td>Legitimate interests, Art. 6(1)(f).</td></tr>
<tr><td>Rights requests and emails you send us</td><td>Answering you and meeting our legal duties</td><td>Legal obligation, Art. 6(1)(c), and legitimate interests, Art. 6(1)(f).</td></tr>
<tr><td>Journal AI review (optional) — only when you press Send</td><td>Sending the extract you chose to the AI provider you chose, at your request</td><td>We do not receive the payload or your key. Any limited processing on our side in providing the button is at your request, Art. 6(1)(b). The AI provider is an independent controller of what it receives, under its terms and the acknowledgement you give before sending.</td></tr>
</tbody></table>
<p><b>Legitimate interests — analytics balancing note.</b> We have a legitimate interest in understanding, in aggregate, how the Service is used and whether pages load properly, so we can keep it working and improve it. Cloudflare Web Analytics and Umami Cloud are cookieless according to their documentation: they do not store or access cookies or similar identifiers on your device, so PECR regulation 6 (consent for storing or accessing information on a terminal) does not, on that basis, apply to them. The data is limited, is not used for advertising or for profiling you as an individual, and is not combined with your account journal or keys. Retention is limited to the periods in section 9. We consider that these interests are not overridden by your interests or rights. You can use browser tools to block the scripts, and you can object by emailing ${VT_MAIL()}. If a script later stores or accesses information on your device, we will review this basis and may need to ask for consent.</p>
<h2>9. How long data is kept</h2><table class="ftbl"><thead><tr><th>Data</th><th>Kept for</th></tr></thead><tbody>
<tr><td>Account record and cloud-synced workspace data (Cloudflare D1)</td><td>While your account remains active, or until you request deletion via ${VT_MAIL()}.</td></tr>
<tr><td>Session cookie (<code>HttpOnly</code>)</td><td>Until you log out or the session expires.</td></tr>
<tr><td>Local device settings, watchlist, alerts, drawings, layouts, API keys</td><td>On your device until you delete them (<a href="#/legal/your-data">Your data</a> → Delete all my data, or by clearing site data).</td></tr>
<tr><td>Optional market-data cache</td><td>On your device until you turn the cache off, empty it, or clear site data.</td></tr>
<tr><td>Consent log</td><td>The last 50 records on your device, until you delete them.</td></tr>
<tr><td>Pro Desk waitlist email</td><td>Until Pro Desk launch notifications are sent or you ask us to remove it.</td></tr>
<tr><td>Cloudflare Web Analytics</td><td>According to Cloudflare’s published documentation: typically about 7 days for unsampled data, and up to 6 months in the analytics dashboard.</td></tr>
<tr><td>Umami Cloud</td><td>Up to 6 months of aggregate analytics records under Umami’s published retention policy.</td></tr>
<tr><td>Hosting and security logs</td><td>Up to 30 days for operational security and abuse prevention.</td></tr>
<tr><td>Emails and rights requests you send us</td><td>Up to 24 months after resolution, or longer if required by law.</td></tr>
</tbody></table>
<h2>10. International transfers</h2><p>Some of our processors and independent market-data providers may handle personal data outside the UK. Where we transfer personal data outside the UK, we rely on UK adequacy regulations or the UK International Data Transfer Addendum (IDTA) to the EU Standard Contractual Clauses.</p>
<p>Cloudflare may process hosting, D1, or Web Analytics data at nearby edge data centres outside the UK under Cloudflare’s Data Processing Addendum. Umami Cloud processes aggregate analytics under its published DPA. When your browser talks directly to a market-data provider or to an AI provider you choose, that request leaves your device under that provider’s terms; they are independent controllers of the personal data they receive (typically your IP address and the request). We do not control their transfer arrangements.</p>
<h2>11. Your rights</h2><p>Under the UK GDPR you have the following rights, which you can exercise by emailing ${VT_MAIL()} or, for data stored on your device, by using <a href="#/legal/your-data">Your data</a> or your browser controls:</p>
<ul>
<li><b>Access</b> (Art. 15) — to be told whether we process your personal data and to have a copy of it.</li>
<li><b>Rectification</b> (Art. 16) — to have inaccurate personal data corrected.</li>
<li><b>Erasure</b> (Art. 17) — to ask us to delete personal data we hold, in the circumstances the law allows.</li>
<li><b>Restriction</b> (Art. 18) — to ask us to limit how we use your personal data in the circumstances the law allows.</li>
<li><b>Data portability</b> (Art. 20) — to receive personal data you have provided to us, in a structured, commonly used and machine-readable format, and to transmit it where the law allows.</li>
<li><b>Objection</b> (Art. 21) — to object to processing based on legitimate interests, including the cookieless analytics described above. You can also object to any direct marketing; we do not currently use your data for direct marketing.</li>
<li><b>Automated decisions</b> (Art. 22) — not to be subject to a decision based solely on automated processing, including profiling, that produces legal effects concerning you or similarly significantly affects you. We do not make any such decisions. Scores, tiers and phases are rule-based calculations shown as information in the tool; they have no legal or similarly significant effect on you, and they do not decide whether you can use the Service or enter a contract.</li>
<li><b>Withdraw consent</b> — where we rely on consent (the optional cache, optional preferences, or waitlist emails), you can withdraw it at any time via Cookie settings or by emailing ${VT_MAIL()}, without affecting the lawfulness of processing before you withdrew it.</li>
</ul>
<p>You also have the right to complain to the Information Commissioner’s Office (ICO), the UK supervisory authority: <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noopener noreferrer">ico.org.uk/make-a-complaint</a>, or Information Commissioner’s Office, Wycliffe House, Water Lane, Wilmslow, Cheshire SK9 5AF. We would appreciate the chance to address your concern first.</p>
<h2>12. Children</h2><p>The Service is for people aged 18 and over. We do not knowingly collect personal data from children. If you believe a person under 18 has used the Service, contact ${VT_MAIL()} and we will delete anything we hold.</p>
<h2>13. Automated decisions and AI</h2><p>As set out in section 11, we do not use automated decision-making that produces legal or similarly significant effects. The optional Journal AI review is generated by the provider you choose, can be wrong, and is not a decision we take about you.</p>
<h2>14. Changes</h2><p>If we change this policy in a material way, we will update the effective date and, where storage or cookie practices change, bump the policy version so you are asked for your storage choices again. The current policy version for storage choices is shown in Cookie settings.</p>`],
cookies:["Cookies & Local Storage",()=>`<h1>Cookies and Local Storage</h1>${LG_META()}
<h2>Cookies</h2><p>Signed-in accounts use a strictly necessary <code>HttpOnly</code> session cookie issued by our Cloudflare D1 authentication endpoints so your session stays authenticated securely. Cloudflare, which hosts the site, may also set strictly necessary security cookies to operate and protect the site. Strictly necessary cookies do not require consent under PECR. Cloudflare Web Analytics and Umami Cloud do not use cookies, according to their documentation. Advertising is not used.</p>
<h2>Categories</h2><p>Storage on your device falls into these categories, which you can manage in Cookie settings:</p>
<ul>
<li><b>Strictly necessary</b> — authentication session cookie (<code>HttpOnly</code>), workspace settings, alerts, consent record, and similar storage without which the Service cannot work as you asked. This does not require consent.</li>
<li><b>Optional cache</b> — the IndexedDB market-data cache. Off until you consent.</li>
<li><b>Optional preferences</b> — extras such as the alert sound and remembered API keys. Off until you consent.</li>
<li><b>Analytics</b> — Cloudflare Web Analytics and Umami Cloud on the hosted site are cookieless aggregate measurement. They are not a storage category you switch in this banner, because they do not store or access cookies or similar identifiers on your device according to the providers’ documentation. The lawful basis is legitimate interests (see the <a href="#/legal/privacy">Privacy Policy</a>).</li>
</ul>
<h2>Your choice</h2><p>The first time you use the Service, and again if the policy version changes or after 12 months, we ask you to accept or reject optional storage, or to manage categories. Rejecting optional storage does not stop the Service working. You can change your mind at any time via Cookie settings. Withdrawal of consent does not affect processing that already happened.</p>
<h2>Everything stored</h2>${LG_STORE}
<h2>Third parties</h2>${LG_SOURCES}
<h2>Clearing it</h2><p>Use <a href="#/legal/your-data">Your data</a> to export or delete what this app stored locally, or clear this site’s data in your browser. Data → Reload data empties the market-data cache. Logging out invalidates your session cookie and clears local session state.</p>`],
risk:["Risk Disclaimer",()=>`<h1>Risk Disclaimer and Not Financial Advice</h1>${LG_META()}
<h2>High risk</h2><p>Trading contracts for difference (CFDs), foreign exchange (FX) and cryptoassets is high risk. You can lose all of the money you put up, and with leveraged products you can lose more than you deposit. These products are not suitable for everyone. Do not trade with money you cannot afford to lose. Cryptoasset values can be extremely volatile, and some cryptoassets are unregulated in the UK.</p>
<h2>Not financial advice</h2><p>Vektor Terminal provides information and tools only. Nothing on this site, and nothing generated by its scores, presets, P1–P5 tiers, phase labels, heatmaps, alerts, session summaries, calculators, back-tests, replays, journal statistics or Journal AI review, is:</p>
<ul>
<li>a personal recommendation, or advice, to buy, sell, subscribe for, or hold any investment, cryptoasset, CFD or other product;</li>
<li>a suggestion that any particular course of action is suitable for you; or</li>
<li>a substitute for your own research, or for advice from a suitably authorised person.</li>
</ul>
<p>The tools do not consider your personal circumstances, objectives or attitude to risk. You are solely responsible for any decision you take.</p>
<h2>No FCA authorisation and no regulated activity</h2><p>Vektor Terminal is not authorised or regulated by the Financial Conduct Authority. Vektor Terminal does not provide investment advice, arrange or execute deals, hold client money, or operate a trading venue. It does not connect to a brokerage account and it does not place trades. Using the Service is not a regulated activity by us, and nothing here is intended as a financial promotion of any particular investment.</p>
<h2>Past performance and back-tests</h2><p>Past performance is not a reliable indicator of future results. Back-tests, bar replays, Monte Carlo and challenge simulations, and paper results from the position tool are hypothetical. They benefit from hindsight, usually ignore costs such as spreads, commissions, swaps and slippage, and use data that may be incomplete or delayed. Real results will differ, often substantially.</p>
<h2>Prop-firm figures are illustrative</h2><p>Prop-firm drawdown meters, challenge simulations, pass rates and position-size results are illustrations based on the numbers you enter, or on trades you log yourself. Every prop firm has its own rules, and theirs are what count. Check them before you trade. A simulated pass rate is not a prediction that you will pass a challenge.</p>
<h2>Data</h2><p>Prices, calendars and news come from third parties and may be delayed, incomplete or unavailable. See <a href="#/legal/data">Data Sources</a>. You should confirm any figure you rely on with a source you trust.</p>`],
data:["Data Sources",()=>`<h1>Data Sources and Attributions</h1>${LG_META()}
<h2>Market data</h2><p>Live and historical prices, calendars and headlines come from the third parties listed below. Coverage, delay and quality depend on the provider and on whether you have entered your own key. <b>Data provided by <a href="https://twelvedata.com" target="_blank" rel="noopener noreferrer">Twelve Data</a></b> for the forex, stock, index, ETF and futures series that use that provider.</p>
${LG_SOURCES}
<h2>Accuracy and delays</h2><p>Feeds may be delayed or temporarily unavailable. Market data is provided for analytical reference only and should be verified independently before making trading decisions. Vektor Terminal does not fabricate synthetic market prices or synthetic economic calendar events when an upstream feed is unavailable.</p>
<h2>Software</h2><p>The chart uses TradingView Lightweight Charts (Apache-2.0) and html2canvas for chart snapshots. Other code is part of Vektor Terminal.</p>`],
refunds:["Refunds & Cancellation",()=>`<h1>Refunds and Cancellation</h1>${LG_META()}
<p>Vektor Terminal is currently free on the <b>Free</b> core tier (3 charts, 3 indicators, 3 alerts, plus unlimited P1–P5 screening, bar replay, heatmaps, and trade journal). Nothing is charged today, and no payment card is collected for the Free tier or the <b>Pro Desk (Waitlist)</b>.</p>
<h2>Upcoming Pro Desk tier</h2><p>When the optional <b>Pro Desk</b> tier launches, full pricing, currency, applicable taxes, billing period, and renewal terms will be published here and displayed clearly before checkout. There will be no hidden fees or surprise charges. If we change the price of an active paid plan in the future, we will give at least 30 days’ notice by email and in the Service before any new price applies.</p>
<h2>14-day cooling-off period</h2><p>When paid plans launch, UK consumer distance-contract rules under the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013 (the “CCRs”) will apply to both services (regulation 36) and digital content (regulation 37). You will have a 14-day cancellation right from the day a paid contract is entered into, unless you expressly request immediate access and acknowledge how that affects your cancellation right as required by law. Approved reimbursements will be returned without undue delay and within 14 days via the original payment method.</p>
<h2>Model cancellation form</h2><p>When paid plans are live, you may use this form, or any other clear statement, under CCR regulation 32 and Schedule 3, Part B:</p>
<div class="riskbox" role="form" aria-label="Model cancellation form">
<p>To Vektor Terminal, United Kingdom (England and Wales), ${VT_MAIL()}:</p>
<p>I/We hereby give notice that I/We cancel my/our contract for the supply of the following service / digital content: Vektor Terminal Pro Desk subscription.</p>
<p>Ordered on: [date]</p>
<p>Name of consumer(s):</p>
<p>Address of consumer(s):</p>
<p>Signature of consumer(s) (only if this form is notified on paper):</p>
<p>Date:</p>
</div>
<p>Email the completed wording to ${VT_MAIL()}.</p>
<h2>Your statutory rights under the Consumer Rights Act 2015</h2><p>Nothing in these terms or on this page excludes or limits your rights under the Consumer Rights Act 2015. Digital content and services must be as described, fit for a particular purpose made known, and of satisfactory quality (and services must be performed with reasonable care and skill). If they are not, you may be entitled to a repair, replacement, repeat performance, price reduction or refund, as the Act provides. Those remedies are not excluded.</p>`],
about:["About & Contact",()=>`<h1>About and Contact</h1>${LG_META()}
<table class="ftbl"><tbody><tr><td>Operator</td><td>Vektor Terminal</td></tr><tr><td>Jurisdiction</td><td>United Kingdom (England and Wales)</td></tr><tr><td>Platform status</td><td>Free core tier live · Pro Desk (Waitlist)</td></tr>
<tr><td>Email</td><td>${VT_MAIL()}</td></tr></tbody></table>
<p>Vektor Terminal is not authorised or regulated by the Financial Conduct Authority. Vektor Terminal provides information and analytical tools only. It is not investment advice, not a personal recommendation, and not a regulated activity.</p>`],
accessibility:["Accessibility",()=>`<h1>Accessibility statement</h1>${LG_META()}
<p>We want Vektor Terminal to be usable by as many people as possible, and we aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA.</p>
<h2>What you can do</h2><ul><li>Use the top navigation, tables, dialogs and the alert editor with a keyboard. Tab moves between controls, Enter or Space activates them, and Esc closes dialogs.</li><li>See a visible focus outline on every control.</li><li>Choose the dark or light theme, and zoom up to 200%.</li><li>Use the app with reduced motion when your system asks for it.</li></ul>
<h2>Known limitations</h2><ul><li>Price charts are drawn on a canvas, so screen readers can’t read individual candles. The Data Window shows the values under the crosshair as text.</li><li>Some drawing tools need a pointer.</li><li>Third-party data and linked sites aren’t under our control.</li></ul>
<h2>Feedback</h2><p>If something doesn’t work for you, email ${VT_MAIL()}. We aim to reply within 5 working days.</p>
<h2>How we checked</h2><p>This statement was prepared on 19 November 2026 based on internal self-assessment against WCAG 2.2 AA.</p>`],
liability:["Disclaimer of Liability",()=>`<h1>Disclaimer of Liability</h1>${LG_META()}
<p>Vektor Terminal is provided “as is”, with no warranty that it is accurate, complete, available or fit for any purpose, other than any warranty or term that cannot be excluded by law. To the extent the law allows, Vektor Terminal is not liable for any trading losses, lost profits, or decisions made using the Service, its data, scores, alerts, calculators, journal or back-tests. Nor is it liable for an alert that fails to fire, data that is delayed or wrong, or loss of data stored in your browser.</p>
<p>Nothing here excludes or limits liability that cannot be excluded under the law of England and Wales, including for death or personal injury caused by negligence, or for fraud, and nothing affects your statutory rights as a consumer under the Consumer Rights Act 2015 and other applicable law. Those statutory remedies are not excluded.</p>`]};
const LG_ORDER=["terms","privacy","cookies","your-data","risk","data","liability","refunds","about","accessibility"];
function legalDoc(){const m=/^#\/legal\/([a-z-]+)/.exec(location.hash);return m&&LEGAL[m[1]]?m[1]:null}
const LG_DESC={
  terms:"Service scope, acceptable use, subscriptions, and statutory consumer rights.",
  privacy:"UK GDPR lawful bases, data processors, retention windows, and your privacy rights.",
  cookies:"Strictly necessary storage, optional preferences, and browser cache controls.",
  "your-data":"Export or delete your local workspace data and manage privacy requests.",
  risk:"Important risk warning: Vektor Terminal provides tools and data, not financial advice.",
  data:"Market data providers, feeds, attributions, and routing transparency.",
  liability:"Service availability, limitation of liability, and statutory protections.",
  refunds:"Plan pricing, 14-day cancellation rights, trial terms, and refund procedures.",
  about:"Operator details, company registration, and direct contact information.",
  accessibility:"WCAG 2.2 AA commitment, keyboard navigation, and accessibility feedback."
};
function legalRender(){let el=document.getElementById("pv-legal");if(!el)return;const d=legalDoc();
const isPub=typeof BOOTED==="undefined"||!BOOTED||document.documentElement.classList.contains("locked");
const pubBar=isPub?`<div class="lgl-pubbar"><a href="#/">← Back to Home</a><a href="#/signup">Sign in / Create Account</a></div>`:"";
const retHref=isPub?"#/":"#/workspace";
const retTxt=isPub?"← Back to Home":"← Back to Terminal";
const nav=`<nav aria-label="Legal"><div class="lgl-nav-hd"><a href="#/legal" class="lgl-hub-lnk${!d?" on":""}">Legal Hub</a></div>${LG_ORDER.filter(k=>LEGAL[k]).map(k=>`<a href="#/legal/${k}" class="${k===d?"on":""}">${LEGAL[k][0]}</a>`).join("")}<div class="lgl-nav-ft"><button type="button" class="lgl-ck-btn" onclick="vtBanner(true)">Cookie settings</button><a href="${retHref}" class="lgl-ret-lnk">${retTxt}</a></div></nav>`;
const hubBody=`<div class="lgl-hero"><span class="lgl-eyebrow">LEGAL &amp; COMPLIANCE HUB</span><h1>Legal, Privacy &amp; Risk Disclosures</h1><p class="lgl-sub">Clear, transparent policies governing your use of Vektor Terminal, market data attributions, and data protection under UK GDPR.</p></div>${LG_META()}<div class="riskbox"><b>Risk warning:</b> trading CFDs, FX and crypto carries a high risk of losing money. Nothing on this site is financial advice. <a href="#/legal/risk">Read the risk disclaimer</a>.</div><ul class="lgl-grid">${LG_ORDER.filter(k=>LEGAL[k]).map(k=>`<li class="lgl-card"><a href="#/legal/${k}"><b>${LEGAL[k][0]}</b><span class="lgl-desc">${esc(LG_DESC[k]||"")}</span></a></li>`).join("")}</ul>`;
const body=d?`<div class="lgl-crumb"><a href="#/legal">← Legal &amp; Compliance Hub</a></div>`+LEGAL[d][1]():hubBody;
el.innerHTML=`<div class="pgw">${pubBar}<div class="lgl">${nav}<article class="lgldoc vcard">${body}</article></div></div>`;
if(d&&LEGAL[d][2]){try{LEGAL[d][2](el.querySelector("article"))}catch(e){console.error(e)}}
document.title=(d?LEGAL[d][0]:"Legal & Privacy Hub")+" \u00b7 Vektor Terminal";el.scrollTop=0}
PAGE_HOOK.legal={enter:legalRender,sub:legalRender};
function vtFooterBuild(){const w=document.querySelector(".wrap");if(!w)return;
if(!document.getElementById("pv-legal")){const pv=document.createElement("div");pv.className="pv";pv.id="pv-legal";const last=[...w.querySelectorAll(".pv")].pop();if(last)last.after(pv);else w.appendChild(pv)}
const old=w.querySelector("footer.vfoot");if(old)old.remove();}
function vtSyncPublicLegal(){
  const h=String(location.hash||"").trim().toLowerCase();
  if(/^#\/?legal(\/|$)/.test(h)){
    vtFooterBuild();
    document.documentElement.dataset.page="legal";
    legalRender();
  }else if((typeof BOOTED==="undefined"||!BOOTED)&&document.documentElement.dataset.page==="legal"){
    delete document.documentElement.dataset.page;
  }
}
window.addEventListener("hashchange",vtSyncPublicLegal);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",vtSyncPublicLegal,{once:true});else vtSyncPublicLegal();
// ---------- UK GDPR / PECR mechanisms: storage consent banner + log, privacy centre (export, delete, rights requests) ----------
const VT_POLICY_V="1.1";             // bump when the cookie/privacy notice changes materially: everyone is asked again
const VT_CONSENT_MAX_AGE=365*864e5;  // and again after 12 months
let vtOpenMail=u=>{location.href=u};
const VT_DSR_EMAIL=VT_CONTACT_EMAIL;   // request e-mail button target (set in 90_legal.js)
const VT_CK="vt_consent",VT_CL="vt_consent_log";
function vtLS(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
function vtConsent(){try{const c=JSON.parse(vtLS(VT_CK)||"null");if(c&&c.v===VT_POLICY_V&&Date.now()-c.ts<VT_CONSENT_MAX_AGE)return c}catch(e){}return null}
function vtCacheOK(){const c=vtConsent();return !!(c&&c.cache)}
// optional preferences (alert sound and similar extras): only remembered on this device with consent; records made before
// this category existed have no "prefs" field and so count as "no"
function vtPrefsOK(){const c=vtConsent();return !!(c&&c.prefs)}
const VT_PREFS_KEY="vt_prefs";
function vtPrefsClear(){try{localStorage.removeItem(VT_PREFS_KEY);const ks=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(/^vt_aikey(~|$)/.test(k))ks.push(k)}ks.forEach(k=>localStorage.removeItem(k))}catch(e){}}
function vtConsentLog(){try{const l=JSON.parse(vtLS(VT_CL)||"[]");return Array.isArray(l)?l:[]}catch(e){return[]}}
function vtConsentSet(cache,method,prefs){const rec={v:VT_POLICY_V,ts:Date.now(),cache:!!cache,prefs:prefs==null?method==="accept_all":!!prefs,method};
vtLS(VT_CK,JSON.stringify(rec));const l=vtConsentLog();l.push(rec);vtLS(VT_CL,JSON.stringify(l.slice(-50)));
vtBannerClose();vtCacheApply();if(!rec.prefs)vtPrefsClear();try{document.dispatchEvent(new CustomEvent("vt-consent",{detail:rec}))}catch(e){}if(document.documentElement.dataset.page==="legal"&&typeof legalRender==="function")legalRender();
toast(cache||rec.prefs?"Saved: "+[cache?"market-data cache":"",rec.prefs?"optional preferences":""].filter(Boolean).join(" and ")+" on":"Saved: only strictly necessary storage");return rec}
// non-essential storage gate: the IndexedDB market-data cache is only opened (and so only created) with consent
const _vtIdb=idb;idb=function(){return vtCacheOK()?_vtIdb():Promise.resolve(null)};
function vtIdbDel(name){return new Promise(r=>{try{const q=indexedDB.deleteDatabase(name);q.onsuccess=q.onerror=q.onblocked=()=>r()}catch(e){r()}})}
async function vtCacheApply(){if(vtCacheOK()){if(!IDB&&READY){IDB=await _vtIdb();if(IDB){for(const k in LIVE)DIRTY.add(k);DIRTY.add("@snap");if(BN.list&&BN.list.length)DIRTY.add("@bn");dirtySnap()}}}
else{try{if(IDB)IDB.close()}catch(e){}IDB=null;await vtIdbDel("scr")}}
// ---- banner: Reject and Accept are the same size and style on the first layer; Manage has per-category toggles, off by default
function vtBannerClose(){const b=document.getElementById("vcb");if(b)b.remove()}
function vtBanner(manage){vtBannerClose();const c=vtConsent(),el=document.createElement("div");el.className="vcb";el.id="vcb";
el.setAttribute("role","dialog");el.setAttribute("aria-modal","false");el.setAttribute("aria-labelledby","vcb_t");
el.innerHTML=`<h2 id="vcb_t">Storage on this device</h2>
<p>We use essential browser storage for your session and interface preferences. With your permission, we can also keep a <b>market-data cache</b> (IndexedDB) and <b>optional preferences</b> such as alert sound. No third-party ad trackers. <a href="#/legal/cookies">Cookie notice</a> \u00b7 <a href="#/legal/privacy">Privacy policy</a></p>
${manage?`<div class="cats">
<div class="cat"><input type="checkbox" checked disabled id="vcb_nec" aria-describedby="vcb_nec_d"><label for="vcb_nec"><b>Strictly necessary</b><span class="mut" id="vcb_nec_d">Settings, watchlist, alerts, layouts, sign-in name and this consent record. Needed for the app to work.</span></label><span class="st">Always on</span></div>
<div class="cat"><input type="checkbox" id="vcb_cache" ${c&&c.cache?"checked":""} aria-describedby="vcb_cache_d"><label for="vcb_cache"><b>Market-data cache</b><span class="mut" id="vcb_cache_d">Keeps downloaded price candles and the market list in IndexedDB so the app starts faster and makes fewer requests. Off unless you turn it on.</span></label></div>
<div class="cat"><input type="checkbox" id="vcb_prefs" ${c&&c.prefs?"checked":""} aria-describedby="vcb_prefs_d"><label for="vcb_prefs"><b>Optional preferences</b><span class="mut" id="vcb_prefs_d">Remembers extras you choose, such as the alert sound, in localStorage (<code>vt_prefs</code>), and your Journal AI key if you tick \u201cRemember\u201d (<code>vt_aikey~\u2026</code>). Without it they still work, but only until you close the tab. Off unless you turn it on.</span></label></div>
<div class="cat"><input type="checkbox" disabled id="vcb_an"><label for="vcb_an"><b>Analytics and advertising</b><span class="mut">No third-party ad trackers or advertising cookies are used. Essential cookieless hosting telemetry keeps the terminal fast and reliable.</span></label><span class="st">Advertising not used</span></div></div>`:""}
<div class="btns"><button type="button" class="cbtn" id="vcb_rej">Reject all</button><button type="button" class="cbtn" id="vcb_acc">Accept all</button>${manage?`<button type="button" class="cbtn alt" id="vcb_save">Save my choices</button>`:`<button type="button" class="cbtn alt" id="vcb_man">Manage choices</button>`}</div>`;
document.body.appendChild(el);
el.querySelector("#vcb_rej").onclick=()=>vtConsentSet(false,"reject_all");el.querySelector("#vcb_acc").onclick=()=>vtConsentSet(true,"accept_all");
if(manage){el.querySelector("#vcb_save").onclick=()=>vtConsentSet(el.querySelector("#vcb_cache").checked,"custom",el.querySelector("#vcb_prefs").checked);el.querySelector("#vcb_cache").focus()}
else el.querySelector("#vcb_man").onclick=()=>vtBanner(true);
if(manage||!c)setTimeout(()=>{if(!manage){const b=el.querySelector("#vcb_rej");b&&b.focus({preventScroll:true})}},0)}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.getElementById("vcb")&&vtConsent()){vtBannerClose()}});
// ---- legal pages over the sign-in screen (the app is hidden until you sign in, but the notices must stay readable)
function vtLegalModal(k){if(!LEGAL[k])return;vtLegalModalClose();const m=document.createElement("div");m.className="vlm";m.id="vlm";m.setAttribute("role","dialog");m.setAttribute("aria-modal","true");m.setAttribute("aria-label",LEGAL[k][0]);
m.innerHTML=`<div class="box lgldoc"><button type="button" class="x" aria-label="Close" onclick="vtLegalModalClose()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>${LEGAL[k][1]()}</div>`;
m.onclick=e=>{if(e.target===m)vtLegalModalClose()};document.body.appendChild(m);if(LEGAL[k][2])LEGAL[k][2](m.querySelector(".box"));m.querySelector(".x").focus()}
function vtLegalModalClose(){const m=document.getElementById("vlm");if(m)m.remove()}
document.addEventListener("click",e=>{const a=e.target.closest&&e.target.closest('a[href^="#/legal/"]');if(!a)return;
const k=a.getAttribute("href").slice(8);if((document.documentElement.classList.contains("locked")&&a.closest("#vcb"))||a.closest(".vlm")){if(LEGAL[k]){e.preventDefault();vtLegalModal(k)}}},true);
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.getElementById("vlm")){e.stopPropagation();vtLegalModalClose()}},true);
// ---- privacy centre helpers
function vtParse(v){try{return JSON.parse(v)}catch(e){return v}}
async function vtIdbExists(){if(IDB)return true;try{if(indexedDB.databases)return(await indexedDB.databases()).some(d=>d.name==="scr")}catch(e){}return false}
async function vtIdbDump(){if(!(await vtIdbExists()))return{};const db=IDB||await _vtIdb();if(!db)return{};
return new Promise(r=>{const out={};try{const q=db.transaction("c").objectStore("c").openCursor();q.onsuccess=()=>{const c=q.result;if(!c){r(out);return}out[c.key]=c.value;c.continue()};q.onerror=()=>r(out)}catch(e){r(out)}})}
/* keys scoped to a different signed-in user (name~<16 hex>) */
function vtOtherAcct(k){const m=/~[0-9a-f]{16}$/.exec(k||"");return !!m&&(typeof VT_SCOPE==="undefined"||m[0]!==VT_SCOPE)}
async function vtInventory(){const ls=[],ss=[];try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);ls.push([vtOtherAcct(k)?k.replace(/~[0-9a-f]{16}$/,"~(another account)"):k,(localStorage.getItem(k)||"").length])}}catch(e){}
try{for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i);ss.push([k,(sessionStorage.getItem(k)||"").length])}}catch(e){}
let idbN=null;if(await vtIdbExists()){const d=await vtIdbDump();idbN=Object.keys(d).length}let cs=0;try{if(window.caches)cs=(await caches.keys()).length}catch(e){}
return{ls,ss,idbN,cs}}
async function vtExportData(inclCache){const out={app:"Vektor Terminal",exported:new Date().toISOString(),policyVersion:VT_POLICY_V,
note:"Everything Vektor Terminal stores in this browser. It may include API keys you saved, so keep this file safe.",localStorage:{},sessionStorage:{}};
try{let other=0;for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(vtOtherAcct(k)){other++;continue}out.localStorage[k]=vtParse(localStorage.getItem(k))}if(other)out.otherAccounts=other+" entr"+(other===1?"y":"ies")+" saved by other accounts on this device were left out"}catch(e){}
try{for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i);out.sessionStorage[k]=vtParse(sessionStorage.getItem(k))}}catch(e){}
out.indexedDB=inclCache?{scr:await vtIdbDump()}:{note:(await vtIdbExists())?"Market-data cache present but not included (tick the box to include it).":"No IndexedDB data."};return out}
function vtDownload(obj,name){const b=new Blob([JSON.stringify(obj,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500)}
// erase everything this app keeps in the browser and disconnect live feeds; the caller reloads afterwards
async function vtWipe(){window.__vtWiped=true;save=function(){};lsSet=function(){};ssSet=function(){};clearTimeout(fl);DIRTY.clear();
try{if(typeof vtStopAllFeeds==="function")vtStopAllFeeds()}catch(e){}
try{if(window.__tbw)window.__tbw.terminate()}catch(e){}
try{if(IDB)IDB.close()}catch(e){}IDB=null;
try{localStorage.clear()}catch(e){}try{sessionStorage.clear()}catch(e){}
let names=["scr"];try{if(indexedDB.databases)names=[...new Set(["scr",...(await indexedDB.databases()).map(d=>d.name).filter(Boolean)])]}catch(e){}
for(const n of names)await vtIdbDel(n);
try{if(window.caches){const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)))}}catch(e){}
return true}
function vtDeleteAsk(){const m=document.createElement("div");m.className="vlm";m.id="vlm";m.setAttribute("role","alertdialog");m.setAttribute("aria-modal","true");m.setAttribute("aria-labelledby","vdel_t");
m.innerHTML=`<div class="box" style="max-width:480px"><h3 id="vdel_t">Delete all your data from this browser?</h3>
<p>This removes your settings, watchlist, alerts, drawings, layouts, saved API keys, sign-in, consent record, the market-data cache and any cached files, and disconnects live prices. It can\u2019t be undone. Data held by third parties (data providers, your broker) isn\u2019t affected.</p>
<label>Type DELETE to confirm<input id="vdel_in" autocomplete="off" aria-describedby="vdel_t"></label>
<div class="row" style="margin-top:10px"><span class="sp"></span><button type="button" id="vdel_no">Cancel</button><button type="button" class="pcdanger" id="vdel_go" disabled>Delete everything</button></div></div>`;
document.body.appendChild(m);const inp=m.querySelector("#vdel_in"),go=m.querySelector("#vdel_go");inp.oninput=()=>{go.disabled=inp.value.trim()!=="DELETE"};
m.querySelector("#vdel_no").onclick=vtLegalModalClose;m.onclick=e=>{if(e.target===m)vtLegalModalClose()};
go.onclick=async()=>{go.disabled=true;go.textContent="Deleting\u2026";await vtWipe();location.replace(location.pathname+location.search)};inp.focus()}
// ---- "Your data" page (privacy centre)
const DSR_TYPES=[["access","Access: a copy of the data you hold about me"],["rectification","Rectification: correct inaccurate data"],["erasure","Erasure: delete my data"],["restriction","Restriction: limit how my data is used"],["objection","Objection: stop processing based on legitimate interests"],["portability","Portability: my data in a machine-readable format"]];
LEGAL["your-data"]=["Your data",()=>`<h1>Your data</h1>${LG_META()}
<p>Most of what Vektor Terminal knows about you lives in this browser, so you can see it, download it and delete it here, straight away. For anything held elsewhere, see the last section.</p>
<h2>What this browser holds</h2><div id="pc_inv" class="mut">Checking\u2026</div>
<h2>Download a copy (access and portability)</h2><p>Downloads everything stored in this browser as one JSON file.</p>
<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="pc_inc"> Include the market-data cache (it can be large, and it\u2019s public price data rather than personal data)</label>
<div class="pcact"><button type="button" class="pri" id="pc_exp">Download my data (JSON)</button></div>
<p class="mut">The file includes any API keys you saved. Keep it somewhere safe.</p>
<h2>Delete all my data</h2><p>Clears localStorage, sessionStorage, IndexedDB and Cache Storage for this site and disconnects live price feeds. You\u2019ll be asked to confirm first.</p>
<div class="pcact"><button type="button" class="pcdanger" id="pc_del">Delete all my data\u2026</button></div>
<h2>Storage consent</h2><p id="pc_cs"></p><div class="pcact"><button type="button" id="pc_cset">Change cookie settings</button><button type="button" id="pc_wd">Withdraw consent</button></div>
<div id="pc_log"></div>
<h2>Requests about data held elsewhere</h2>
<p>Signed-in accounts use Cloudflare D1 authentication (PBKDF2-SHA256 password hashing and HttpOnly session cookies) and can cloud-sync watchlists, drawings, alerts, and trade journal entries. We may also hold hosting logs, waitlist entries, or emails you\u2019ve sent us. For any personal data held on our servers you have the right to <b>access</b>, <b>rectification</b>, <b>erasure</b>, <b>restriction</b>, <b>objection</b> and <b>portability</b>.</p>
<p>Send your request to ${VT_MAIL()}. We\u2019ll reply without undue delay and <b>within one month</b> of receiving it. If a request is complex, or you send several, we can extend that by up to two further months, and we\u2019ll tell you within the first month if we need to. Requests are free in most cases. We may ask you to confirm your identity first. If you\u2019re unhappy with our answer, you can complain to the Information Commissioner\u2019s Office (ico.org.uk).</p>
<div class="pcform"><label>Type of request<select id="dsr_t">${DSR_TYPES.map(t=>`<option value="${t[0]}">${t[1]}</option>`).join("")}</select></label>
<label>Your name<input id="dsr_n" autocomplete="name"></label><label>Your email<input id="dsr_e" type="email" autocomplete="email"></label>
<label style="grid-column:1/-1">Details (optional)<textarea id="dsr_d" maxlength="2000"></textarea></label></div>
<label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" id="dsr_ok" style="margin-top:3px"> <span>I understand this opens my own email app to send the request to ${VT_MAIL()}, and that my name and email will be used only to handle it, as described in the <a href="#/legal/privacy">Privacy Policy</a>.</span></label>
<div class="pcact"><button type="button" class="pri" id="dsr_go" disabled>Email this request</button><button type="button" id="dsr_cp">Copy request text</button><span class="mut" id="dsr_st"></span></div>`,
async root=>{const $=s=>root.querySelector(s);
const inv=await vtInventory(),row=(k,n)=>`<tr><td><code>${esc(k)}</code></td><td>${n.toLocaleString()} characters</td></tr>`;
$("#pc_inv").innerHTML=`<table class="ftbl"><thead><tr><th>Item</th><th>Size</th></tr></thead><tbody>${inv.ls.map(x=>row("localStorage: "+x[0],x[1])).join("")}${inv.ss.map(x=>row("sessionStorage: "+x[0],x[1])).join("")}
<tr><td>IndexedDB market-data cache</td><td>${inv.idbN==null?"none":inv.idbN+" entries"}</td></tr><tr><td>Cache Storage</td><td>${inv.cs?inv.cs+" caches":"none"}</td></tr></tbody></table>`;
$("#pc_exp").onclick=async()=>{vtDownload(await vtExportData($("#pc_inc").checked),"vektor-terminal-data-"+new Date().toISOString().slice(0,10)+".json");toast("Downloaded your data")};
$("#pc_del").onclick=vtDeleteAsk;$("#pc_cset").onclick=()=>vtBanner(true);$("#pc_wd").onclick=()=>vtConsentSet(false,"withdrawn");
const c=vtConsent();$("#pc_cs").textContent=c?"Current choice: "+(c.cache?"market-data cache on":"strictly necessary storage only")+" (policy version "+c.v+", "+new Date(c.ts).toLocaleString()+").":"You haven\u2019t made a choice yet, so only strictly necessary storage is used.";
const L=vtConsentLog();$("#pc_log").innerHTML=L.length?`<table class="ftbl" aria-label="Consent history"><thead><tr><th>When</th><th>Choice</th><th>How</th><th>Policy version</th></tr></thead><tbody>${L.slice().reverse().map(x=>`<tr><td>${esc(new Date(x.ts).toLocaleString())}</td><td>${x.cache?"Cache on":"Necessary only"}</td><td>${esc(String(x.method||"").replace(/_/g," "))}</td><td>${esc(x.v)}</td></tr>`).join("")}</tbody></table>`:"";
const txt=()=>{const t=DSR_TYPES.find(x=>x[0]===$("#dsr_t").value);return"Data subject request: "+t[1]+"\nName: "+$("#dsr_n").value.trim()+"\nEmail: "+$("#dsr_e").value.trim()+"\nDetails: "+($("#dsr_d").value.trim()||"(none)")+"\nSent: "+new Date().toISOString()};
const upd=()=>{$("#dsr_go").disabled=!($("#dsr_ok").checked&&$("#dsr_e").value.trim())};["#dsr_ok","#dsr_e"].forEach(s=>$(s).addEventListener("input",upd));$("#dsr_ok").addEventListener("change",upd);
$("#dsr_go").onclick=()=>{if(!VT_DSR_EMAIL){$("#dsr_st").textContent="The contact address hasn\u2019t been set up yet. Copy the text and send it to the address above.";return}
  $("#dsr_st").textContent="Opening your email app to send this to "+VT_DSR_EMAIL+". If nothing opens, copy the text and email it yourself.";
  vtOpenMail("mailto:"+VT_DSR_EMAIL+"?subject="+encodeURIComponent("Data subject request ("+$("#dsr_t").value+")")+"\u0026body="+encodeURIComponent(txt()))};
$("#dsr_cp").onclick=async()=>{try{await navigator.clipboard.writeText(txt());$("#dsr_st").textContent="Copied."}catch(e){$("#dsr_st").textContent="Couldn\u2019t copy. Select and copy it manually."}}}];
// footer (built here so every page above is linked) and first-visit banner
vtFooterBuild();
if(!vtConsent())vtBanner(false);
// ---------- accounts on a shared device ----------
// Saved work is scoped per signed-in user (see vtSK/VT_SCOPE in the core). Note: sign-in is still a local prototype with no
// password check, so this separates people who use the same browser; it is not security against someone typing your username.
// One-time hygiene: delete leftover Twelve Data keys previously stored in the browser. Never read, keep, or send them.
(function(){try{for(const store of [localStorage,sessionStorage]){const ks=[];for(let i=0;i<store.length;i++){const k=store.key(i);if(k&&/^vt_tdkey(~|$)/.test(k))ks.push(k)}ks.forEach(k=>store.removeItem(k))}if(typeof S!=="undefined"&&S&&S.data&&("key"in S.data)){delete S.data.key;if(typeof save==="function")save()}}catch(e){}})();
// ---- guest who signs in while the app is running, and already has saved work under that account ----
function vtAcctChoose(){modal(`<div role="dialog" aria-modal="true" aria-labelledby="ac_h"><h3 id="ac_h">You already have saved work</h3><p id="ac_p"></p><div class="row"><button type="button" id="ac_keep">Use this session instead</button><span class="sp"></span><button type="button" class="pri" id="ac_open">Open my saved work</button></div></div>`);
  document.getElementById("ac_p").textContent="This device already has charts, drawings, a journal and other work saved for "+VT_UID+". Open it (this guest session\u2019s changes are dropped), or keep what you have open now and save it over your saved work.";
  document.getElementById("ac_open").onclick=()=>{closeM();location.reload()};
  document.getElementById("ac_keep").onclick=()=>{save();saveP();closeM();toast("Signed in \u2014 this session is now saved as your work")};
  document.getElementById("ac_open").focus()}
// ---- data saved before accounts were separated, found by someone who signs in later ----
function vtLegacyCheck(){if(!VT_SCOPE||VT_GUEST||S.legacyNo||lsGet("vt_legacy")==null||lsGet("scr2")==null)return;if(document.getElementById("modal")&&document.querySelector("#modal .box"))return;
  modal(`<div role="dialog" aria-modal="true" aria-labelledby="lg_h"><h3 id="lg_h">Earlier saved work found</h3><p>This device has charts, drawings, a journal and other work saved before each account got its own storage. It may belong to someone else who used this device.</p><p class="mut">Importing replaces the work saved for your account.</p><div class="row"><button type="button" id="lg_no">Not mine</button><span class="sp"></span><button type="button" class="pri" id="lg_yes">Import into my account</button></div></div>`);
  document.getElementById("lg_no").onclick=()=>{S.legacyNo=true;save();closeM()};
  document.getElementById("lg_yes").onclick=()=>{for(const k of ["scr2","scr2p"]){const v=lsGet(k);if(v!=null)lsSet(vtSK(k),v);else lsRemove(vtSK(k));lsRemove(k)}lsRemove("vt_legacy");closeM();location.reload()};
  document.getElementById("lg_no").focus()}
(function(){const b=boot;boot=function(){const r=b.apply(this,arguments);try{if(S&&S.data&&("key"in S.data)){delete S.data.key;if(typeof save==="function")save()}}catch(e){}setTimeout(vtLegacyCheck,900);return r}})();
// ---------- phones: bottom tab bar + "More" sheet, touch-friendly charts ----------
const VT_COARSE=matchMedia("(pointer:coarse)").matches;
const VT_MORE_PAGES=["heatmap","calendar","journal","backtest"];
function vtMoreClose(){["vmore","vmbg"].forEach(i=>{const e=document.getElementById(i);if(e)e.remove()});const b=document.getElementById("vnmore");if(b)b.setAttribute("aria-expanded","false")}
function vtMoreOpen(){if(document.getElementById("vmore")){vtMoreClose();return}
const bg=document.createElement("div");bg.className="vmbg";bg.id="vmbg";bg.onclick=vtMoreClose;
const m=document.createElement("div");m.id="vmore";m.setAttribute("role","dialog");m.setAttribute("aria-label","More pages");
const ic=id=>{const p=PAGES.find(x=>x[0]===id);return`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p[2]}</svg>`};
const dst=[(document.getElementById("tag")||{}).textContent,(document.getElementById("dst")||{}).textContent].filter(Boolean).join(" \u00b7 ");
m.innerHTML=`<h3>Pages</h3><div class="grid">${VT_MORE_PAGES.map(id=>`<a href="#/${id}">${ic(id)}${PAGES.find(x=>x[0]===id)[1]}</a>`).join("")}</div>
<h3>Settings &amp; Account</h3><div class="grid"><button type="button" onclick="togTheme();vtMoreClose()">${getEffTheme()==="dark"?"Switch to Light Mode":"Switch to Dark Mode"}</button><button type="button" onclick="scrSetM();vtMoreClose()">Screener Settings</button><button type="button" onclick="setM();vtMoreClose()">Chart Settings</button><button type="button" onclick="${VT_GUEST?"vtShowSignIn()":"authSignOut()"};vtMoreClose()">${VT_GUEST?"Sign In / Create Account":"Log Out"}</button></div>
<h3>Legal and privacy</h3><div class="grid"><a href="#/legal/risk">Risk disclaimer</a><a href="#/legal/privacy">Privacy</a><a href="#/legal/your-data">Your data</a><a href="#/legal">All legal pages</a><button type="button" id="vm_ck">Cookie settings</button></div>
${dst?`<p class="st">${esc(dst)}</p>`:""}`;
document.body.appendChild(bg);document.body.appendChild(m);m.querySelectorAll("a").forEach(a=>a.addEventListener("click",()=>setTimeout(vtMoreClose,0)));
m.querySelector("#vm_ck").onclick=()=>{vtMoreClose();vtBanner(true)};document.getElementById("vnmore").setAttribute("aria-expanded","true");const f=m.querySelector("a");if(f)f.focus({preventScroll:true})}
(function(){const nav=document.getElementById("vnav");if(!nav)return;const add=()=>{if(document.getElementById("vnmore"))return;const b=document.createElement("button");b.type="button";b.className="vnmore";b.id="vnmore";
b.setAttribute("aria-haspopup","dialog");b.setAttribute("aria-expanded","false");
b.innerHTML='<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg><span>More</span>';
b.onclick=vtMoreOpen;nav.appendChild(b)};add();new MutationObserver(add).observe(nav,{childList:true})})();
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.getElementById("vmore"))vtMoreClose()});
window.addEventListener("hashchange",()=>{vtMoreClose();const b=document.getElementById("vnmore");if(b){const p=pageOf(location.hash);b.classList.toggle("on",VT_MORE_PAGES.includes(p)||p==="legal")}});
// touch: one-finger horizontal pan, pinch zoom, long-press crosshair (stays until the next tap); vertical swipes scroll the page on phones
function vtTouchChart(c){if(!c)return;try{c.applyOptions({handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:!(VT_COARSE&&UIM==="phone")},
handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true,axisDoubleClickReset:true},kineticScroll:{touch:true,mouse:false},trackingMode:{exitMode:1}})}catch(e){}}
// ---------- full-app sweep fixes ----------
// 1) Chart load errors: the chart used to sit on "Loading candles…" forever when a feed failed.
//    Now it shows the real error with a Try again button (clears that one error and refetches).
function vtChartErr(cv,msg){if(!cv)return;cv.textContent="";const d=document.createElement("div");d.className="vt-cverr";d.setAttribute("role","alert");
  const p=document.createElement("p");p.textContent="Couldn\u2019t load candles \u2014 "+String(msg).slice(0,160);
  const h=document.createElement("p");h.className="mut";h.textContent=/key/i.test(msg)?"Add a data key under Settings \u203a Data, or pick another symbol.":"The data source may be busy or blocked on this network. Try again, or pick another symbol.";
  const b=document.createElement("button");b.type="button";b.id="vt_cvretry";b.textContent="Try again";b.onclick=()=>vtChartRetry();
  d.append(p,h,b);cv.append(d)}
function vtChartRetry(){const C=S.chart,s=symOf(C.sym);if(!s)return;delete ERR[s[0]+"|"+C.tf];need(s,C.tf,true);drawChart()}
// if the error arrives while the loading skeleton is showing, swap it for the error
setInterval(()=>{try{if(typeof BOOTED==="undefined"||!BOOTED||!chartOnPage()||document.hidden)return;const cv=document.getElementById("cv");if(!cv||!cv.querySelector(".vt-skel"))return;
  const C=S.chart,s=symOf(C.sym);if(s&&ERR[s[0]+"|"+C.tf]&&!candles(s,C.tf))vtChartErr(cv,ERR[s[0]+"|"+C.tf])}catch(e){}},1500);

// 2) Indicators dialog: "My scripts" now lists your saved Vektor Script indicators (Scripts editor)
//    with Add/Remove and Edit, instead of a static list. Icon-only buttons get accessible names.
(function(){if(typeof indM!=="function")return;const base=indM;
  indM=function(tab){base(tab);const box=document.querySelector("#modal .box");if(!box)return;box.classList.add("vt-indm");
    box.querySelectorAll("button").forEach(b=>{if(b.getAttribute("aria-label"))return;const t=b.textContent.trim(),act=b.dataset.act||b.title||"",row=b.closest(".li"),nm=row?(row.querySelector("span")||row).textContent.trim():"";
      if(t==="\u2699"||/setting/i.test(act))b.setAttribute("aria-label","Settings for "+nm);else if(t==="\u2715"||/remove|delete/i.test(act))b.setAttribute("aria-label","Remove "+nm);else if(t==="\u2605"||t==="\u2606"||/fav/i.test(act)){const on=t==="\u2605"||b.classList.contains("on");b.setAttribute("aria-label",(on?"Remove ":"Add ")+nm+(on?" from":" to")+" favourites");b.setAttribute("aria-pressed",on)}});
    if(tab!=="scripts"||typeof vsCfg!=="function")return;const L=document.getElementById("indlist");if(!L)return;L.textContent="";
    const row=(name,note,btns)=>{const r=document.createElement("div");r.className="li vt-indrow";const n=document.createElement("span");n.textContent=name;if(note){const m=document.createElement("small");m.className="mut";m.textContent=" "+note;n.append(m)}const g=document.createElement("span");g.className="vt-indbtns";btns.forEach(x=>g.append(x));r.append(n,g);L.append(r)};
    const btn=(txt,lab,fn,pri)=>{const b=document.createElement("button");b.type="button";b.textContent=txt;if(lab)b.setAttribute("aria-label",lab);if(pri)b.className="pri";b.onclick=fn;return b};
    const list=vsCfg().list;
    list.forEach(sc=>row(sc.name,sc.on?"(on chart)":"",[
      btn(sc.on?"Remove":"Add",(sc.on?"Remove ":"Add ")+sc.name+(sc.on?" from":" to")+" the chart",()=>{if(!sc.on){const a=candles(symOf(S.chart.sym),S.chart.tf),r=a&&a.length?vsCompute(sc,a):null;if(r&&r.err){toast("\u201c"+sc.name+"\u201d has an error. Open it in the editor to fix it.");return}}sc.on=!sc.on;save();vsRedraw();indM("scripts")},!sc.on),
      btn("Edit","Edit "+sc.name+" in the script editor",()=>{closeM();vsM(sc.id)})]));
    if(!list.length){const p=document.createElement("p");p.className="mut";p.textContent="No scripts yet. Write your own indicator, or start from a template, in the script editor.";L.append(p)}
    const add=document.createElement("div");add.className="vt-indnew";add.append(btn("New script\u2026","",()=>{closeM();vsM()}));L.append(add);
    row("Vektor Indicator","(built-in)",[btn("Add","Add Vektor Indicator to the chart",()=>{addVektorIndi();closeM()},true)]);
  }})();

// 3) Router: page names are case-insensitive (#/Chart opens Supercharts).
(function(){if(typeof pageOf!=="function")return;const base=pageOf;pageOf=function(h){return base(typeof h==="string"?h.replace(/^(#\/[A-Za-z]+)/,m=>m.toLowerCase()):h)}})();

// 4) Chart settings that were shown but did nothing now work:
//    Scales > Buttons > Navigation (zoom/scroll/reset buttons on the chart) and Pane (buttons on the RSI pane),
//    Status line > Volume (bar volume next to the price), Data modification > Time colour (the clock under the chart).
function vtNavBtns(){try{const cv=document.getElementById("cv");if(!cv||typeof ch==="undefined"||!ch||typeof ch.timeScale!=="function")return;const old=cv.querySelector(".vt-navb");if(old)old.remove();
  const mode=S.chart.navBtn||"hover";if(mode==="hide")return;const ts=ch.timeScale();
  const zoom=f=>{try{const r=ts.getVisibleLogicalRange();if(!r)return;const c=r.to,w=Math.max(10,(r.to-r.from)*f);ts.setVisibleLogicalRange({from:c-w,to:c})}catch(_e){}};
  const scroll=k=>{try{const r=ts.getVisibleLogicalRange();if(!r)return;const d=(r.to-r.from)*0.25*k;ts.setVisibleLogicalRange({from:r.from+d,to:r.to+d})}catch(_e){}};
  const d=document.createElement("div");d.className="vt-navb"+(mode==="always"?" on":"");d.setAttribute("role","toolbar");d.setAttribute("aria-label","Chart navigation");
  [['<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',"Zoom out",()=>zoom(1.25)],
   ['<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',"Zoom in",()=>zoom(0.8)],
   ['<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',"Scroll left",()=>scroll(-1)],
   ['<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',"Scroll right",()=>scroll(1)],
   ['<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',"Reset chart view",()=>{try{ts.resetTimeScale();ch.priceScale("right").applyOptions({autoScale:true})}catch(e){}}]]
    .forEach(([ic,l,f])=>{const b=document.createElement("button");b.type="button";b.innerHTML=ic;b.title=l;b.setAttribute("aria-label",l);b.onclick=e=>{e.stopPropagation();f()};b.onpointerdown=e=>e.stopPropagation();d.append(b)});
  cv.append(d)}catch(e){console.error("vtNavBtns error:",e)}}
function vtPaneBtns(){const p=document.getElementById("cv2");if(!p)return;const old=p.querySelector(".vt-paneb");if(old)old.remove();const mode=S.chart.paneBtn||"hover";if(mode==="hide")return;
  const r=S.chart.ind.find(x=>x.t==="rsi");if(!r)return;p.style.position=p.style.position||"relative";
  const d=document.createElement("div");d.className="vt-paneb"+(mode==="always"?" on":"");d.setAttribute("role","toolbar");d.setAttribute("aria-label","RSI pane");
  [['<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.79 1.01 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',"RSI settings",()=>editInd(r.id)],
   ['<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.8 21.8 0 0 1 5.06-6.94"/><path d="M1 1l22 22"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a21.8 21.8 0 0 1-2.88 4.46"/></svg>',"Hide RSI pane",()=>togInd(r.id)],
   ['<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',"Remove RSI",()=>{rmInd(r.id);closeM()}]]
    .forEach(([ic,l,f])=>{const b=document.createElement("button");b.type="button";b.innerHTML=ic;b.title=l;b.setAttribute("aria-label",l);b.onclick=f;d.append(b)});p.append(d)}
function vtFmtVol(v){v=+v;if(!isFinite(v))return"\u2013";const a=Math.abs(v);return a>=1e9?(v/1e9).toFixed(2)+"B":a>=1e6?(v/1e6).toFixed(2)+"M":a>=1e3?(v/1e3).toFixed(2)+"K":v.toFixed(a<10?2:0)}
function vtVolPill(s){const top=document.querySelector("#cp .cpb .row.top");if(!top)return;const old=document.getElementById("vt_vol");if(old)old.remove();if(!S.chart.showVol)return;
  const a=candles(s,S.chart.tf);if(!a||!a.length)return;const el=document.createElement("span");el.id="vt_vol";el.className="mut vt-vol";
  const set=i=>{const z=a[Math.max(0,Math.min(a.length-1,i))];el.textContent="Vol "+(z&&z.v!=null?vtFmtVol(z.v):"\u2013")};set(a.length-1);
  const ref=top.querySelector('button[title="Market status"]')||top.querySelector(":scope>div");top.insertBefore(el,ref||null);
  try{ch.subscribeCrosshairMove(p=>{if(!document.body.contains(el))return;if(p&&p.logical!=null&&p.logical>=0)set(Math.round(p.logical));else set(a.length-1)})}catch(e){}}
function vtTimeCol(){const tb=document.getElementById("timebar");if(!tb)return;const c=S.chart.timeCol;tb.style.color=c&&/^#[0-9a-f]{6}$/i.test(c)&&c.toLowerCase()!=="#131722"?c:""}
(function(){if(typeof vtAfterDraw!=="function")return;const base=vtAfterDraw;vtAfterDraw=function(s,a,T){base(s,a,T);for(const f of [vtNavBtns,vtPaneBtns,()=>vtVolPill(s),vtTimeCol]){try{f()}catch(e){console.error(e)}}}})();
// ---------- 98 layout: continuous, virtualised screener list on desktop ----------
// Desktop shows every match in one scrolling list (sticky headers) instead of pages. Only the rows near
// the viewport are in the DOM; spacer rows keep the scroll height right. The list, filters, sort and
// scoring are unchanged: this only decides which slice of the already-sorted rows is drawn.
const VV={rh:36,a:-1,b:-1,n:0,sig:null,raf:0,bound:null};
function vtVirtOn(){const d=document.documentElement.dataset;return d.ui==="pc"&&d.split==="1"&&S.virt!==false}
function vtVirtHead(){const p=document.getElementById("presets"),t=document.querySelector("#t thead");return(p&&p.offsetParent?p.offsetHeight:0)+(t?t.offsetHeight:0)}
function vtVirtRange(w,n){const st=Math.max(0,w.scrollTop-vtVirtHead()),vis=Math.ceil((w.clientHeight||600)/VV.rh)+1,C=20;
const a=Math.min(Math.max(0,Math.floor(st/VV.rh/C)*C-C),Math.max(0,n-1)),b=Math.min(n,a+vis+3*C);return{a,b}}
function vtVirt(n){if(!vtVirtOn())return null;const w=document.querySelector(".side>.tw")||document.querySelector(".tw");if(!w)return null;vtVirtBind(w);
if(VV.sig!==S._sig){VV.sig=S._sig;w.scrollTop=0}
const rs=[...document.querySelectorAll("#t tbody tr[data-s]")];if(rs.length){const h=rs.reduce((t,r)=>t+r.offsetHeight,0)/rs.length;if(h>8)VV.rh=h}
const {a,b}=vtVirtRange(w,n);VV.a=a;VV.b=b;VV.n=n;return{a,b,top:Math.round(a*VV.rh),bot:Math.round((n-b)*VV.rh)}}
function vtVirtBind(w){if(VV.bound===w)return;VV.bound=w;w.addEventListener("scroll",()=>{if(VV.raf)return;VV.raf=requestAnimationFrame(()=>{VV.raf=0;if(!vtVirtOn()||VV.a<0)return;const r=vtVirtRange(w,VV.n);if(r.a!==VV.a||r.b!==VV.b)render()})},{passive:true})}
// keep the keyboard-selected row in view (rows under the sticky header count as hidden)
function vtVirtShow(i){if(!vtVirtOn())return;const w=VV.bound;if(!w)return;const head=vtVirtHead(),th=(document.querySelector("#t thead")||{}).offsetHeight||0,top=head+i*VV.rh;
if(top-th<w.scrollTop)w.scrollTop=Math.max(0,top-th);else if(top+VV.rh>w.scrollTop+w.clientHeight)w.scrollTop=top+VV.rh-w.clientHeight;
const r=vtVirtRange(w,VV.n);if(r.a!==VV.a||r.b!==VV.b)render()}
// switching between phone/tablet and desktop layouts swaps pages <-> continuous list
window.addEventListener("resize",deb(()=>{const on=vtVirtOn();if(on!==VV.was){VV.was=on;if(typeof BOOTED!=="undefined"&&BOOTED)render()}},250));
/* No placeholder pages remain; stubPage() is kept for future pages. */
