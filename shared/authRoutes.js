// shared/authRoutes.js — HTTP route handler for D1 Auth, Sessions, User Data, Admin RBAC, and Google/Apple OAuth.
// Pure Web Fetch API + Web Crypto ES module (Cloudflare Workers + Node 22+). Zero Node-only imports.

import {
  MAX_PAYLOAD_BYTES,
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  base64UrlToBytes,
  buildClearOAuthStateCookie,
  buildClearSessionCookie,
  buildOAuthStateCookie,
  buildSessionCookie,
  bytesToBase64Url,
  completeProfile,
  confirmVerificationCode,
  constantTimeEqual,
  consumeOAuthState,
  createOAuthState,
  createSession,
  decodeUtf8,
  findOrCreateOAuthUser,
  getSessionUser,
  getUserData,
  importLegacyData,
  isEmailVerifyConfigured,
  isPhoneVerifyConfigured,
  listUsersAdmin,
  loginUser,
  parseCookies,
  registerUser,
  revokeSession,
  saveUserData,
  sendVerificationCode,
  setUserRoleOrStatus,
} from "./auth.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

const APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_ISSUER = "https://appleid.apple.com";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Response & Request Helpers
// ---------------------------------------------------------------------------

function applyExtraHeaders(headers, extraHeaders) {
  if (!extraHeaders) return;
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        if (v[i] !== undefined && v[i] !== null) {
          headers.append(k, String(v[i]));
        }
      }
    } else {
      headers.set(k, String(v));
    }
  }
}

function jsonResponse(body, status = 200, extraHeaders = null) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  applyExtraHeaders(headers, extraHeaders);
  return new Response(JSON.stringify(body), { status, headers });
}

function redirectResponse(location, extraHeaders = null) {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  applyExtraHeaders(headers, extraHeaders);
  return new Response(null, { status: 302, headers });
}

function isSecureRequest(url) {
  return url.protocol === "https:";
}

function isAppleCookieSecure(url) {
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    return false;
  }
  return true;
}

function getClientIp(request) {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp.trim();
  const xff = request.headers.get("X-Forwarded-For");
  if (xff) return xff.split(",")[0].trim();
  return null;
}

function getAllowedOrigins(requestUrl, env) {
  const set = new Set([requestUrl.origin]);
  if (env && typeof env.ALLOWED_ORIGINS === "string") {
    const parts = env.ALLOWED_ORIGINS.split(",");
    for (let i = 0; i < parts.length; i++) {
      const raw = parts[i].trim();
      if (!raw) continue;
      try {
        set.add(new URL(raw).origin);
      } catch {
        // Ignore malformed entries
      }
    }
  }
  return set;
}

/**
 * Strict same-origin / ALLOWED_ORIGINS CSRF check for state-changing requests.
 */
export function verifyCsrfOrigin(request, requestUrl, env) {
  if (!STATE_CHANGING_METHODS.has(request.method.toUpperCase())) {
    return { ok: true };
  }

  const secFetchSite = request.headers.get("Sec-Fetch-Site");
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return { ok: false, error: "Cross-site request rejected." };
  }

  const allowed = getAllowedOrigins(requestUrl, env);
  const origin = request.headers.get("Origin");
  if (origin) {
    if (!allowed.has(origin)) {
      return { ok: false, error: "Cross-origin request rejected." };
    }
    return { ok: true };
  }

  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (allowed.has(refOrigin)) return { ok: true };
    } catch {
      // Fall through to reject
    }
    return { ok: false, error: "Cross-origin request rejected." };
  }

  return { ok: false, error: "Missing Origin header." };
}

/**
 * Reads a request body up to maxBytes (default 512 KB), returning 413 on overflow.
 */
export async function readBoundedText(request, maxBytes = MAX_PAYLOAD_BYTES) {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    const parsedLen = Number(contentLength);
    if (Number.isFinite(parsedLen) && parsedLen > maxBytes) {
      return { ok: false, status: 413, error: "Request body too large." };
    }
  }

  if (!request.body) {
    return { ok: true, text: "" };
  }

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        return { ok: false, status: 413, error: "Request body too large." };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: "Unable to read request body." };
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    combined.set(chunks[i], offset);
    offset += chunks[i].byteLength;
  }
  return { ok: true, text: decodeUtf8(combined) };
}

export async function readBoundedJson(request, maxBytes = MAX_PAYLOAD_BYTES) {
  const res = await readBoundedText(request, maxBytes);
  if (!res.ok) return res;
  if (!res.text.trim()) {
    return { ok: false, status: 400, error: "Request body is required." };
  }
  try {
    return { ok: true, data: JSON.parse(res.text) };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON body." };
  }
}

// ---------------------------------------------------------------------------
// OAuth Provider Config & JWT / JWKS Verification (Pure Web Crypto)
// ---------------------------------------------------------------------------

export function isGoogleConfigured(env) {
  return Boolean(
    env &&
      typeof env.GOOGLE_CLIENT_ID === "string" &&
      env.GOOGLE_CLIENT_ID.trim() &&
      typeof env.GOOGLE_CLIENT_SECRET === "string" &&
      env.GOOGLE_CLIENT_SECRET.trim()
  );
}

export function isAppleConfigured(env) {
  if (!env || typeof env.APPLE_CLIENT_ID !== "string" || !env.APPLE_CLIENT_ID.trim()) {
    return false;
  }
  if (typeof env.APPLE_CLIENT_SECRET === "string" && env.APPLE_CLIENT_SECRET.trim()) {
    return true;
  }
  return Boolean(
    typeof env.APPLE_TEAM_ID === "string" &&
      env.APPLE_TEAM_ID.trim() &&
      typeof env.APPLE_KEY_ID === "string" &&
      env.APPLE_KEY_ID.trim() &&
      typeof env.APPLE_PRIVATE_KEY === "string" &&
      env.APPLE_PRIVATE_KEY.trim()
  );
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function parseJwtParts(jwt) {
  if (typeof jwt !== "string") return null;
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  const headerBytes = base64UrlToBytes(parts[0]);
  const payloadBytes = base64UrlToBytes(parts[1]);
  const sigBytes = base64UrlToBytes(parts[2]);
  if (!headerBytes || !payloadBytes || !sigBytes) return null;
  try {
    const header = JSON.parse(decodeUtf8(headerBytes));
    const payload = JSON.parse(decodeUtf8(payloadBytes));
    if (!isPlainObject(header) || !isPlainObject(payload)) return null;
    return {
      header,
      payload,
      sigBytes,
      signingInput: `${parts[0]}.${parts[1]}`,
    };
  } catch {
    return null;
  }
}

async function verifyOidcIdToken(idToken, { jwksUrl, expectedAud, expectedIssuers, expectedNonce, nowMs, fetchImpl }) {
  if (typeof expectedNonce !== "string" || !expectedNonce) {
    return { ok: false, error: "Missing expected OIDC nonce." };
  }

  const parsed = parseJwtParts(idToken);
  if (!parsed) return { ok: false, error: "Malformed ID token." };

  const { header, payload, sigBytes, signingInput } = parsed;
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
    return { ok: false, error: "Unsupported ID token algorithm." };
  }

  const nowSec = Math.floor(nowMs / 1000);
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= nowSec - 60) {
    return { ok: false, error: "ID token has expired." };
  }
  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf) || payload.nbf > nowSec + 60) {
      return { ok: false, error: "ID token is not yet valid." };
    }
  }
  if (typeof payload.iss !== "string" || !expectedIssuers.has(payload.iss)) {
    return { ok: false, error: "Invalid ID token issuer." };
  }
  const audMatches =
    payload.aud === expectedAud || (Array.isArray(payload.aud) && payload.aud.includes(expectedAud));
  if (!audMatches) {
    return { ok: false, error: "Invalid ID token audience." };
  }
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== expectedAud) {
    return { ok: false, error: "Invalid ID token authorized party." };
  }
  if (typeof payload.nonce !== "string" || payload.nonce !== expectedNonce) {
    return { ok: false, error: "ID token nonce mismatch." };
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    return { ok: false, error: "ID token missing subject." };
  }

  let jwksResp;
  try {
    jwksResp = await fetchImpl(jwksUrl, { method: "GET" });
  } catch {
    return { ok: false, error: "Unable to verify identity provider keys." };
  }
  if (!jwksResp || !jwksResp.ok) {
    return { ok: false, error: "Unable to verify identity provider keys." };
  }

  let jwks;
  try {
    jwks = await jwksResp.json();
  } catch {
    return { ok: false, error: "Invalid identity provider key response." };
  }
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  const jwk = keys.find(
    (k) =>
      k &&
      k.kid === header.kid &&
      k.kty === "RSA" &&
      (!k.use || k.use === "sig") &&
      (!k.alg || k.alg === "RS256")
  );
  if (!jwk) {
    return { ok: false, error: "Identity provider signing key not found." };
  }

  let validSig = false;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    validSig = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      sigBytes,
      encoder.encode(signingInput)
    );
  } catch {
    return { ok: false, error: "Failed to verify ID token signature." };
  }
  if (!validSig) {
    return { ok: false, error: "Invalid ID token signature." };
  }

  return { ok: true, payload };
}

function pemToDerBytes(pem) {
  const b64 = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function resolveAppleClientSecret(env, nowMs) {
  if (typeof env.APPLE_CLIENT_SECRET === "string" && env.APPLE_CLIENT_SECRET.trim()) {
    return env.APPLE_CLIENT_SECRET.trim();
  }
  const nowSec = Math.floor(nowMs / 1000);
  const headerB64 = bytesToBase64Url(
    encoder.encode(JSON.stringify({ alg: "ES256", kid: env.APPLE_KEY_ID, typ: "JWT" }))
  );
  const payloadB64 = bytesToBase64Url(
    encoder.encode(
      JSON.stringify({
        iss: env.APPLE_TEAM_ID,
        iat: nowSec,
        exp: nowSec + 300,
        aud: APPLE_ISSUER,
        sub: env.APPLE_CLIENT_ID,
      })
    )
  );
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDerBytes(env.APPLE_PRIVATE_KEY),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(signingInput)
  );
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

// ---------------------------------------------------------------------------
// Main Auth Router
// ---------------------------------------------------------------------------

/**
 * Handles all /api/auth/*, /api/me/*, and /api/admin/* routes.
 * Returns a Response if matched, or null if the path is not an auth/user/admin route.
 */
export async function handleAuthRequest(request, env, options = {}) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method.toUpperCase();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const nowMs = typeof options.nowMs === "function" ? options.nowMs() : Date.now();
  const secure = isSecureRequest(url);

  const isAuthPath =
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/me/data" ||
    pathname.startsWith("/api/me/data/") ||
    pathname === "/api/me/import" ||
    pathname === "/api/admin/users" ||
    pathname.startsWith("/api/admin/users/");

  if (!isAuthPath) return null;

  // GET /api/auth/providers — works even if DB or OAuth secrets are not configured yet
  if (pathname === "/api/auth/providers") {
    if (method !== "GET") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    const dbReady = Boolean(env && env.DB);
    return jsonResponse({
      ok: true,
      providers: {
        email: dbReady,
        google: dbReady && isGoogleConfigured(env),
        apple: dbReady && isAppleConfigured(env),
        email_verify: dbReady && isEmailVerifyConfigured(env),
        phone_verify: dbReady && isPhoneVerifyConfigured(env),
      },
    });
  }

  // All remaining routes require D1 (env.DB). Never leak binding names in 503.
  if (!env || !env.DB) {
    return jsonResponse({ ok: false, error: "Authentication service is temporarily unavailable." }, 503);
  }
  const db = env.DB;

  // Strict CSRF Origin check on state-changing routes (except Apple's cross-site form_post callback,
  // which is verified by single-use oauth_states CSRF state).
  const isAppleCallback = pathname === "/api/auth/oauth/apple/callback" && method === "POST";
  if (!isAppleCallback && STATE_CHANGING_METHODS.has(method)) {
    const csrf = verifyCsrfOrigin(request, url, env);
    if (!csrf.ok) {
      return jsonResponse({ ok: false, error: csrf.error }, 403);
    }
  }

  const cookies = parseCookies(request.headers.get("Cookie"));
  const sessionToken = cookies[SESSION_COOKIE_NAME] || null;
  const ip = getClientIp(request);
  const ua = request.headers.get("User-Agent");

  // -------------------------------------------------------------------------
  // POST /api/auth/register
  // -------------------------------------------------------------------------
  if (pathname === "/api/auth/register") {
    if (method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    const bodyRes = await readBoundedJson(request);
    if (!bodyRes.ok) return jsonResponse({ ok: false, error: bodyRes.error }, bodyRes.status);

    const res = await registerUser(db, bodyRes.data, { env, ip, ua, nowMs });
    if (!res.ok) return jsonResponse({ ok: false, error: res.error }, res.status);

    return jsonResponse(
      { ok: true, user: res.user },
      201,
      { "Set-Cookie": buildSessionCookie(res.session.token, { secure }) }
    );
  }

  // -------------------------------------------------------------------------
  // POST /api/auth/login
  // -------------------------------------------------------------------------
  if (pathname === "/api/auth/login") {
    if (method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    const bodyRes = await readBoundedJson(request);
    if (!bodyRes.ok) return jsonResponse({ ok: false, error: bodyRes.error }, bodyRes.status);

    const res = await loginUser(db, bodyRes.data, { ip, ua, nowMs });
    if (!res.ok) {
      const headers = res.retryAfterSec ? { "Retry-After": String(res.retryAfterSec) } : null;
      return jsonResponse({ ok: false, error: res.error }, res.status, headers);
    }

    return jsonResponse(
      { ok: true, user: res.user },
      200,
      { "Set-Cookie": buildSessionCookie(res.session.token, { secure }) }
    );
  }

  // -------------------------------------------------------------------------
  // POST /api/auth/logout
  // -------------------------------------------------------------------------
  if (pathname === "/api/auth/logout") {
    if (method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    if (sessionToken) {
      await revokeSession(db, sessionToken);
    }
    return jsonResponse(
      { ok: true },
      200,
      { "Set-Cookie": buildClearSessionCookie({ secure }) }
    );
  }

  // -------------------------------------------------------------------------
  // GET /api/auth/me
  // -------------------------------------------------------------------------
  if (pathname === "/api/auth/me") {
    if (method !== "GET") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    const user = await getSessionUser(db, sessionToken, { nowMs });
    if (!user) return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
    return jsonResponse({ ok: true, user });
  }

  // -------------------------------------------------------------------------
  // POST /api/auth/complete-profile
  // -------------------------------------------------------------------------
  if (pathname === "/api/auth/complete-profile") {
    if (method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    const user = await getSessionUser(db, sessionToken, { nowMs });
    if (!user) return jsonResponse({ ok: false, error: "Unauthorized." }, 401);

    const bodyRes = await readBoundedJson(request);
    if (!bodyRes.ok) return jsonResponse({ ok: false, error: bodyRes.error }, bodyRes.status);

    const res = await completeProfile(db, user.id, bodyRes.data, { nowMs });
    if (!res.ok) return jsonResponse({ ok: false, error: res.error }, res.status);
    return jsonResponse({ ok: true, user: res.user });
  }

  // -------------------------------------------------------------------------
  // POST /api/auth/verify/send
  // -------------------------------------------------------------------------
  if (pathname === "/api/auth/verify/send") {
    if (method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    const user = await getSessionUser(db, sessionToken, { nowMs });
    if (!user) return jsonResponse({ ok: false, error: "Unauthorized." }, 401);

    const bodyRes = await readBoundedJson(request);
    if (!bodyRes.ok) return jsonResponse({ ok: false, error: bodyRes.error }, bodyRes.status);

    const channel = bodyRes.data && typeof bodyRes.data === "object" ? bodyRes.data.channel : null;
    const res = await sendVerificationCode(db, user, channel, {
      env,
      nowMs,
      fetchImpl,
      sendCodeImpl: options.sendCodeImpl,
    });
    if (!res.ok) {
      const headers = res.retryAfterSec ? { "Retry-After": String(res.retryAfterSec) } : null;
      const errBody = { ok: false, error: res.error };
      if (res.code) errBody.code = res.code;
      return jsonResponse(errBody, res.status, headers);
    }
    const okBody = { ok: true, channel: res.channel };
    if (res.already_verified) {
      okBody.already_verified = true;
    } else {
      okBody.expires_at = res.expires_at;
      okBody.cooldown_sec = res.cooldown_sec;
    }
    return jsonResponse(okBody, 200);
  }

  // -------------------------------------------------------------------------
  // POST /api/auth/verify/confirm
  // -------------------------------------------------------------------------
  if (pathname === "/api/auth/verify/confirm") {
    if (method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    const user = await getSessionUser(db, sessionToken, { nowMs });
    if (!user) return jsonResponse({ ok: false, error: "Unauthorized." }, 401);

    const bodyRes = await readBoundedJson(request);
    if (!bodyRes.ok) return jsonResponse({ ok: false, error: bodyRes.error }, bodyRes.status);

    const channel = bodyRes.data && typeof bodyRes.data === "object" ? bodyRes.data.channel : null;
    const code = bodyRes.data && typeof bodyRes.data === "object" ? bodyRes.data.code : null;
    const res = await confirmVerificationCode(db, user.id, channel, code, { nowMs });
    if (!res.ok) return jsonResponse({ ok: false, error: res.error }, res.status);
    return jsonResponse({ ok: true, user: res.user });
  }

  // -------------------------------------------------------------------------
  // GET /api/auth/oauth/google
  // -------------------------------------------------------------------------
  if (pathname === "/api/auth/oauth/google") {
    if (method !== "GET") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    if (!isGoogleConfigured(env)) {
      return jsonResponse({ ok: false, error: "Google sign-in is not configured." }, 503);
    }

    const returnTo = url.searchParams.get("return_to") || "/";
    const stateObj = await createOAuthState(db, { provider: "google", returnTo, nowMs });
    const redirectUri = `${url.origin}/api/auth/oauth/google/callback`;

    const authUrl = new URL(GOOGLE_AUTH_URL);
    authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", stateObj.state);
    authUrl.searchParams.set("nonce", stateObj.nonce);
    authUrl.searchParams.set("code_challenge", stateObj.codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("prompt", "select_account");

    return redirectResponse(authUrl.toString(), {
      "Set-Cookie": buildOAuthStateCookie(stateObj.state, { secure, sameSite: "Lax" }),
    });
  }

  // -------------------------------------------------------------------------
  // GET /api/auth/oauth/google/callback
  // -------------------------------------------------------------------------
  if (pathname === "/api/auth/oauth/google/callback") {
    if (method !== "GET") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    const clearOAuthCookie = buildClearOAuthStateCookie({ secure, sameSite: "Lax" });
    const clearHeaders = { "Set-Cookie": clearOAuthCookie };

    if (!isGoogleConfigured(env)) {
      return jsonResponse({ ok: false, error: "Google sign-in is not configured." }, 503, clearHeaders);
    }

    const oauthErr = url.searchParams.get("error");
    if (oauthErr) {
      return jsonResponse({ ok: false, error: "Google sign-in was cancelled or denied." }, 400, clearHeaders);
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      return jsonResponse({ ok: false, error: "Missing OAuth callback parameters." }, 400, clearHeaders);
    }

    const cookieState = cookies[OAUTH_STATE_COOKIE_NAME] || "";
    if (!cookieState || !constantTimeEqual(cookieState, state)) {
      return jsonResponse({ ok: false, error: "Invalid OAuth state cookie." }, 403, clearHeaders);
    }

    const consumed = await consumeOAuthState(db, state, "google", { nowMs });
    if (!consumed.ok) {
      return jsonResponse({ ok: false, error: consumed.error }, 400, clearHeaders);
    }

    const redirectUri = `${url.origin}/api/auth/oauth/google/callback`;
    let tokenResp;
    try {
      tokenResp = await fetchImpl(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: consumed.pkceVerifier,
        }).toString(),
      });
    } catch {
      return jsonResponse({ ok: false, error: "Failed to exchange Google authorization code." }, 502, clearHeaders);
    }

    if (!tokenResp || !tokenResp.ok) {
      return jsonResponse({ ok: false, error: "Failed to exchange Google authorization code." }, 502, clearHeaders);
    }
    let tokenJson;
    try {
      tokenJson = await tokenResp.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid token response from Google." }, 502, clearHeaders);
    }
    if (!tokenJson || typeof tokenJson.id_token !== "string") {
      return jsonResponse({ ok: false, error: "Invalid token response from Google." }, 502, clearHeaders);
    }

    const verified = await verifyOidcIdToken(tokenJson.id_token, {
      jwksUrl: GOOGLE_JWKS_URL,
      expectedAud: env.GOOGLE_CLIENT_ID,
      expectedIssuers: GOOGLE_ISSUERS,
      expectedNonce: consumed.nonce,
      nowMs,
      fetchImpl,
    });
    if (!verified.ok) {
      return jsonResponse({ ok: false, error: verified.error }, 401, clearHeaders);
    }
    if (verified.payload.email_verified !== true) {
      return jsonResponse({ ok: false, error: "Google email address is not verified." }, 403, clearHeaders);
    }

    const userRes = await findOrCreateOAuthUser(
      db,
      "google",
      {
        providerUserId: verified.payload.sub,
        email: verified.payload.email,
        fullName: verified.payload.name || null,
        emailVerified: true,
      },
      { nowMs }
    );
    if (!userRes.ok) {
      return jsonResponse({ ok: false, error: userRes.error }, userRes.status, clearHeaders);
    }

    const session = await createSession(db, userRes.user.id, { ip, ua, nowMs });
    const destination = userRes.user.profile_completed ? consumed.returnTo : "/?complete_profile=1";
    return redirectResponse(destination, {
      "Set-Cookie": [buildSessionCookie(session.token, { secure }), clearOAuthCookie],
    });
  }

  // -------------------------------------------------------------------------
  // GET /api/auth/oauth/apple
  // -------------------------------------------------------------------------
  if (pathname === "/api/auth/oauth/apple") {
    if (method !== "GET") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    if (!isAppleConfigured(env)) {
      return jsonResponse({ ok: false, error: "Apple sign-in is not configured." }, 503);
    }

    const returnTo = url.searchParams.get("return_to") || "/";
    const stateObj = await createOAuthState(db, { provider: "apple", returnTo, nowMs });
    const redirectUri = `${url.origin}/api/auth/oauth/apple/callback`;
    const appleSecure = isAppleCookieSecure(url);

    const authUrl = new URL(APPLE_AUTH_URL);
    authUrl.searchParams.set("client_id", env.APPLE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("response_mode", "form_post");
    authUrl.searchParams.set("scope", "name email");
    authUrl.searchParams.set("state", stateObj.state);
    authUrl.searchParams.set("nonce", stateObj.nonce);
    authUrl.searchParams.set("code_challenge", stateObj.codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    return redirectResponse(authUrl.toString(), {
      "Set-Cookie": buildOAuthStateCookie(stateObj.state, { secure: appleSecure, sameSite: "None" }),
    });
  }

  // -------------------------------------------------------------------------
  // POST /api/auth/oauth/apple/callback
  // -------------------------------------------------------------------------
  if (pathname === "/api/auth/oauth/apple/callback") {
    if (method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    const appleSecure = isAppleCookieSecure(url);
    const clearOAuthCookie = buildClearOAuthStateCookie({ secure: appleSecure, sameSite: "None" });
    const clearHeaders = { "Set-Cookie": clearOAuthCookie };

    if (!isAppleConfigured(env)) {
      return jsonResponse({ ok: false, error: "Apple sign-in is not configured." }, 503, clearHeaders);
    }

    const bodyRes = await readBoundedText(request);
    if (!bodyRes.ok) return jsonResponse({ ok: false, error: bodyRes.error }, bodyRes.status, clearHeaders);

    const form = new URLSearchParams(bodyRes.text);
    if (form.get("error")) {
      return jsonResponse({ ok: false, error: "Apple sign-in was cancelled or denied." }, 400, clearHeaders);
    }

    const code = form.get("code");
    const state = form.get("state");
    if (!code || !state) {
      return jsonResponse({ ok: false, error: "Missing OAuth callback parameters." }, 400, clearHeaders);
    }

    const cookieState = cookies[OAUTH_STATE_COOKIE_NAME] || "";
    if (!cookieState || !constantTimeEqual(cookieState, state)) {
      return jsonResponse({ ok: false, error: "Invalid OAuth state cookie." }, 403, clearHeaders);
    }

    const consumed = await consumeOAuthState(db, state, "apple", { nowMs });
    if (!consumed.ok) {
      return jsonResponse({ ok: false, error: consumed.error }, 400, clearHeaders);
    }

    let appleFullName = null;
    const rawUserField = form.get("user");
    if (rawUserField) {
      try {
        const parsedUser = JSON.parse(rawUserField);
        const first = typeof parsedUser?.name?.firstName === "string" ? parsedUser.name.firstName.trim() : "";
        const last = typeof parsedUser?.name?.lastName === "string" ? parsedUser.name.lastName.trim() : "";
        const joined = `${first} ${last}`.trim();
        if (joined) appleFullName = joined;
      } catch {
        // Ignore malformed optional user field
      }
    }

    let clientSecret;
    try {
      clientSecret = await resolveAppleClientSecret(env, nowMs);
    } catch {
      return jsonResponse({ ok: false, error: "Failed to sign Apple client credentials." }, 502, clearHeaders);
    }
    const redirectUri = `${url.origin}/api/auth/oauth/apple/callback`;
    let tokenResp;
    try {
      tokenResp = await fetchImpl(APPLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.APPLE_CLIENT_ID,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: consumed.pkceVerifier,
        }).toString(),
      });
    } catch {
      return jsonResponse({ ok: false, error: "Failed to exchange Apple authorization code." }, 502, clearHeaders);
    }

    if (!tokenResp || !tokenResp.ok) {
      return jsonResponse({ ok: false, error: "Failed to exchange Apple authorization code." }, 502, clearHeaders);
    }
    let tokenJson;
    try {
      tokenJson = await tokenResp.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid token response from Apple." }, 502, clearHeaders);
    }
    if (!tokenJson || typeof tokenJson.id_token !== "string") {
      return jsonResponse({ ok: false, error: "Invalid token response from Apple." }, 502, clearHeaders);
    }

    const verified = await verifyOidcIdToken(tokenJson.id_token, {
      jwksUrl: APPLE_JWKS_URL,
      expectedAud: env.APPLE_CLIENT_ID,
      expectedIssuers: new Set([APPLE_ISSUER]),
      expectedNonce: consumed.nonce,
      nowMs,
      fetchImpl,
    });
    if (!verified.ok) {
      return jsonResponse({ ok: false, error: verified.error }, 401, clearHeaders);
    }
    const appleEmailVerified =
      verified.payload.email_verified === true || verified.payload.email_verified === "true";
    if (!appleEmailVerified) {
      return jsonResponse({ ok: false, error: "Apple email address is not verified." }, 403, clearHeaders);
    }

    const userRes = await findOrCreateOAuthUser(
      db,
      "apple",
      {
        providerUserId: verified.payload.sub,
        email: verified.payload.email,
        fullName: appleFullName,
        emailVerified: true,
      },
      { nowMs }
    );
    if (!userRes.ok) {
      return jsonResponse({ ok: false, error: userRes.error }, userRes.status, clearHeaders);
    }

    const session = await createSession(db, userRes.user.id, { ip, ua, nowMs });
    const destination = userRes.user.profile_completed ? consumed.returnTo : "/?complete_profile=1";
    return redirectResponse(destination, {
      "Set-Cookie": [buildSessionCookie(session.token, { secure }), clearOAuthCookie],
    });
  }

  // -------------------------------------------------------------------------
  // GET /api/me/data
  // -------------------------------------------------------------------------
  if (pathname === "/api/me/data") {
    if (method !== "GET") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    const user = await getSessionUser(db, sessionToken, { nowMs });
    if (!user) return jsonResponse({ ok: false, error: "Unauthorized." }, 401);

    const data = await getUserData(db, user.id);
    return jsonResponse({ ok: true, data });
  }

  // -------------------------------------------------------------------------
  // PUT /api/me/data/:namespace
  // -------------------------------------------------------------------------
  if (pathname.startsWith("/api/me/data/")) {
    if (method !== "PUT") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    const user = await getSessionUser(db, sessionToken, { nowMs });
    if (!user) return jsonResponse({ ok: false, error: "Unauthorized." }, 401);

    const rawNamespace = pathname.slice("/api/me/data/".length);
    let namespace;
    try {
      namespace = decodeURIComponent(rawNamespace);
    } catch {
      return jsonResponse({ ok: false, error: "Invalid data namespace." }, 400);
    }
    if (!namespace || namespace.includes("/")) {
      return jsonResponse({ ok: false, error: "Invalid data namespace." }, 400);
    }

    const bodyRes = await readBoundedJson(request);
    if (!bodyRes.ok) return jsonResponse({ ok: false, error: bodyRes.error }, bodyRes.status);

    const res = await saveUserData(db, user.id, namespace, bodyRes.data, { nowMs });
    if (!res.ok) return jsonResponse({ ok: false, error: res.error }, res.status);
    return jsonResponse({ ok: true, namespace: res.namespace, updated_at: res.updated_at });
  }

  // -------------------------------------------------------------------------
  // POST /api/me/import
  // -------------------------------------------------------------------------
  if (pathname === "/api/me/import") {
    if (method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    const user = await getSessionUser(db, sessionToken, { nowMs });
    if (!user) return jsonResponse({ ok: false, error: "Unauthorized." }, 401);

    const bodyRes = await readBoundedJson(request);
    if (!bodyRes.ok) return jsonResponse({ ok: false, error: bodyRes.error }, bodyRes.status);

    const res = await importLegacyData(db, user.id, bodyRes.data, { nowMs });
    if (!res.ok) return jsonResponse({ ok: false, error: res.error }, res.status);
    return jsonResponse({ ok: true, imported: res.imported });
  }

  // -------------------------------------------------------------------------
  // GET /api/admin/users
  // -------------------------------------------------------------------------
  if (pathname === "/api/admin/users") {
    if (method !== "GET") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    const user = await getSessionUser(db, sessionToken, { nowMs });
    if (!user) return jsonResponse({ ok: false, error: "Unauthorized." }, 401);

    const limit = Number(url.searchParams.get("limit") || 50);
    const offset = Number(url.searchParams.get("offset") || 0);
    const res = await listUsersAdmin(db, user, {
      limit: Number.isInteger(limit) ? limit : 50,
      offset: Number.isInteger(offset) ? offset : 0,
    });
    if (!res.ok) return jsonResponse({ ok: false, error: res.error }, res.status);
    return jsonResponse({ ok: true, users: res.users });
  }

  // -------------------------------------------------------------------------
  // POST /api/admin/users/:id
  // -------------------------------------------------------------------------
  if (pathname.startsWith("/api/admin/users/")) {
    if (method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
    const user = await getSessionUser(db, sessionToken, { nowMs });
    if (!user) return jsonResponse({ ok: false, error: "Unauthorized." }, 401);

    let targetId;
    try {
      targetId = decodeURIComponent(pathname.slice("/api/admin/users/".length));
    } catch {
      return jsonResponse({ ok: false, error: "Invalid user ID." }, 400);
    }
    if (!targetId || targetId.includes("/")) {
      return jsonResponse({ ok: false, error: "Invalid user ID." }, 400);
    }

    const bodyRes = await readBoundedJson(request);
    if (!bodyRes.ok) return jsonResponse({ ok: false, error: bodyRes.error }, bodyRes.status);

    const res = await setUserRoleOrStatus(db, user, targetId, bodyRes.data, { nowMs });
    if (!res.ok) return jsonResponse({ ok: false, error: res.error }, res.status);
    return jsonResponse({ ok: true, user: res.user });
  }

  return jsonResponse({ ok: false, error: "Not found." }, 404);
}

export const handleAuthRoute = handleAuthRequest;
