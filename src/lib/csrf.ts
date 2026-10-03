/**
 * CSRF Protection — Synchronizer Token Pattern with HTTPOnly cookie.
 *
 * Security model (P2-2 / 2026-10-03):
 *   The cookie `csrf_token` is now `httpOnly: true` so JavaScript in the
 *   page can no longer read it. The browser still auto-attaches the
 *   cookie on same-site requests (because `sameSite: "strict"`), which
 *   is what allows the server to do a constant-time comparison against
 *   the `x-csrf-token` header the client echoes.
 *
 *   The header is a defense-in-depth echo. The PRIMARY defenses are:
 *     1. `httpOnly: true` — prevents XSS payloads from stealing the
 *        secret cookie value out of `document.cookie`. The token is
 *        material only to the server and the application's own JS
 *        (which obtains it via `GET /api/v1/auth/csrf`, a same-origin
 *        response that the server itself reads the cookie from).
 *     2. `sameSite: "strict"` — prevents the cookie from being
 *        auto-attached to cross-site requests. This is the actual
 *        CSRF gate: a third-party form post can not include the
 *        cookie, so the server comparison can never succeed.
 *
 *   An XSS that can read the header from the DOM can already do
 *   anything the application can do — the point of HTTPOnly is to
 *   prevent the cookie from being exfiltrated for use in a separate
 *   non-DOM context (e.g. CSRF from a server-side script or a
 *   sibling-origin XSS).
 *
 *   The previously-documented Double-Submit Cookie Pattern (where the
 *   JS read it from `document.cookie` and echoed it) was removed
 *   because that cookie visibility was the load-bearing vulnerability:
 *   any XSS could read the token and forge the header.
 *
 * Compatibility (single-instance only):
 *   The token lives only in the HTTPOnly cookie. The new endpoint
 *   `/api/v1/auth/csrf` returns the current value to the client so it
 *   can echo it as a header. There is no separate server-side store.
 *   If we ever scale to multiple Node instances behind a load
 *   balancer, the cookie still works (same value on every node) but
 *   `getOrIssueCsrfToken` and rotation logic would need to move into
 *   Redis. The TODO is captured below — the single-instance design is
 *   correct for the current production topology (one app container).
 *
 *   TODO(security/p5-csrf-httponly): when the app moves to a
 *   horizontally-scaled deployment, move the per-session token into
 *   Redis keyed by `session_id` so a token issued by one instance can
 *   be validated by another. The current cookie-as-state approach is
 *   correct only because every request lands on the same Node
 *   process that minted the cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import { isCookieSecure, isProd } from "@/lib/env";
import { verifyCustomerToken } from '@/lib/identity';
import { warn as logWarn } from "@/lib/logger";

// CSRF cookie + header names live in their own module so the browser-side
// helper (`src/lib/csrf-client.ts`) can import them without dragging the
// `next/headers` server-only dep into the client bundle.
export { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./csrf-constants";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "./csrf-constants";
const CSRF_COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours

/**
 * Generate a cryptographically secure CSRF token
 */
export function generateCsrfToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Get or create CSRF token for the current request.
 *
 * Reads the HTTPOnly cookie. If missing, generates a fresh token and
 * sets the cookie on the supplied response. Returns the token so the
 * caller can include it in a JSON body — this is the channel the
 * client uses to obtain the token for header echoing.
 *
 * Most callers should NOT use this helper; it is reserved for the
 * `/api/v1/auth/csrf` endpoint and any future server-rendered form
 * integration. Per-route validation goes through `validateCsrfToken`.
 */
export async function getOrIssueCsrfToken(
  request: NextRequest,
  response: NextResponse,
): Promise<string> {
  const existingToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  if (existingToken) return existingToken;
  const fresh = generateCsrfToken();
  response.cookies.set(CSRF_COOKIE_NAME, fresh, {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: "strict",
    maxAge: CSRF_COOKIE_MAX_AGE,
    path: "/",
  });
  return fresh;
}

/**
 * Get the existing CSRF token from the cookie store, or generate a
 * fresh one if missing. Used by Server Components / Route Handlers
 * that only need a token value (e.g. embedding it in a server-rendered
 * form field). Does NOT set the cookie — callers that need to set it
 * on a response should use `getOrIssueCsrfToken(request, response)`.
 */
export async function getCsrfToken(): Promise<string> {
  const cookieStore = await cookies();
  const existingToken = cookieStore.get(CSRF_COOKIE_NAME)?.value;
  if (existingToken) return existingToken;
  return generateCsrfToken();
}

/**
 * Set CSRF cookie on a response. The cookie is HTTPOnly so browser JS
 * cannot read it — see the file-level comment for the security model.
 *
 * Most callers should prefer `getOrIssueCsrfToken` so they can read
 * the same token back and return it to the client; this helper is for
 * the rare case where a Route Handler only needs to mint a cookie
 * (e.g. a refresh path that returns no body).
 */
export function setCsrfCookie(response: NextResponse): NextResponse {
  const token = generateCsrfToken();

  response.cookies.set(CSRF_COOKIE_NAME, token, {
    // SECURITY (P2-2): HTTPOnly now. JS in the page can NOT read this
    // cookie. The server still reads it from `request.cookies` for the
    // header-vs-cookie comparison in `validateCsrfToken`. Cross-site
    // requests can't include the cookie (SameSite=strict), so they
    // can never satisfy the comparison.
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: "strict",
    maxAge: CSRF_COOKIE_MAX_AGE,
    path: "/",
  });

  return response;
}

/**
 * CSRF validation result
 */
export interface CsrfValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate CSRF token from request.
 *
 * Synchronizer Token Pattern: the client sends the cookie's value as
 * the `x-csrf-token` header. The server reads the HTTPOnly cookie
 * (which the browser auto-attached for a same-site request) and
 * compares it to the header with constant-time equality. Cross-site
 * requests can NOT include the cookie (SameSite=strict), so the
 * comparison never succeeds for them.
 *
 * The header is itself defense-in-depth — an XSS that can read the
 * header from the DOM can already do anything the application can do,
 * but at least the cookie value is not exfiltratable from JS for use
 * in a separate non-DOM context (server-side CSRF scripts, sibling
 * origins, etc).
 */
export function validateCsrfToken(request: NextRequest): CsrfValidationResult {
  // Get the cookie token — auto-attached by the browser for same-site
  // requests because the cookie is SameSite=strict. Cross-site requests
  // do NOT include it, which is the primary CSRF defense.
  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;

  // Get the header token — set by trusted application JS via
  // `csrfFetch` after fetching it from `GET /api/v1/auth/csrf`.
  const headerToken = request.headers.get(CSRF_HEADER_NAME);

  // Both tokens must be present
  if (!cookieToken) {
    return {
      valid: false,
      error: "CSRF token not found in cookies",
    };
  }

  if (!headerToken) {
    return {
      valid: false,
      error: "CSRF token not provided in request header",
    };
  }

  // Tokens must match (constant-time comparison to prevent timing attacks)
  if (!timingSafeEqual(cookieToken, headerToken)) {
    return {
      valid: false,
      error: "Invalid CSRF token",
    };
  }

  return { valid: true };
}

const DEFAULT_CSRF_ALLOWED_ORIGINS = [
  "https://citymarkets.sa",
  "https://www.citymarkets.sa",
];

/**
 * Operator-supplied extra CSRF origins. Comma-separated. Same role as
 * `getConfiguredCorsOrigins` — allows staging / partner subdomains
 * without a code change.
 */
export function getConfiguredCsrfOrigins(): string[] {
  return (process.env.CSRF_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function csrfAllowedOrigins(): Set<string> {
  const configured = getConfiguredCsrfOrigins();
  const development = isProd
    ? []
    : [
        "http://localhost:3000",
        "http://localhost:3005",
        "http://localhost:3006",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3005",
        "http://127.0.0.1:3006",
      ];

  return new Set([
    ...DEFAULT_CSRF_ALLOWED_ORIGINS,
    ...configured,
    ...development,
  ]);
}

function isTrustedCsrfOrigin(origin: string): boolean {
  if (origin === "null" || origin.includes(",") || origin.length > 2048) {
    return false;
  }

  try {
    const parsed = new URL(origin);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return false;
    }
    return csrfAllowedOrigins().has(parsed.origin);
  } catch {
    return false;
  }
}

/**
 * Validate a mutating browser request. A trusted browser Origin is
 * authoritative; clients that do not send Origin must provide the existing
 * double-submit cookie/header pair.
 *
 * Native mobile clients (iOS/Android) cannot set the `Origin` header
 * reliably — it's set automatically by the platform. They CAN attach
 * an `Authorization: Bearer <jwt>` header on every request, so we treat
 * a HMAC-verified Bearer token as the canonical CSRF replacement for
 * those callers.
 *
 * SECURITY (F7): Previously this branch returned `{valid:true}` for any
 * `Authorization: Bearer \S+` header without verifying the JWT signature.
 * That made it a trivial CSRF bypass: a request with no Origin and any
 * junk Bearer value passed the CSRF gate. Combined with a guest-only
 * mutating endpoint (no auth required inside the handler), this was a
 * full cross-site mutation vector. We now synchronously verify the JWT
 * with the customer secret before treating the request as CSRF-clean.
 */
export async function validateCsrfRequest(
  request: NextRequest,
): Promise<CsrfValidationResult> {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    return isTrustedCsrfOrigin(origin)
      ? { valid: true }
      : { valid: false, error: "Untrusted request origin" };
  }

  // Native mobile clients don't send Origin. They DO send a Bearer token.
  // SECURITY (F7): we must HMAC-verify the token — the previous regex
  // match was trivially bypassable.
  const auth = request.headers.get("authorization");
  if (auth && /^Bearer\s+\S+/i.test(auth)) {
    return verifyBearerCustomerJwt(auth);
  }

  return validateCsrfToken(request);
}

/**
 * Verify a Bearer header holds a real, HMAC-valid customer JWT.
 * Returns `{valid:true}` only when the signature + iss/aud claims check
 * out. Any failure (missing secret, malformed header, bad signature,
 * wrong issuer/audience, expired) returns `{valid:false}` so the
 * caller falls through to the double-submit token check.
 */
async function verifyBearerCustomerJwt(
  authHeader: string,
): Promise<CsrfValidationResult> {
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
  if (!match) {
    return { valid: false, error: "Malformed Authorization header" };
  }
  const token = match[1];
  // Cheap structural reject so we never hand obviously-junk strings to
  // jwtVerify (defense-in-depth — verifyCustomerToken would reject them
  // anyway, but this skips the work).
  if (token.length < 14) {
    return { valid: false, error: "Bearer token too short" };
  }
  try {
    // SECURITY (F7): real HMAC + iss/aud/exp verification via jose.
    // Returns null on any signature/issuer/audience/expiry failure.
    const payload = await verifyCustomerToken(token);
    if (!payload) {
      return { valid: false, error: "Bearer token verification failed" };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: "Bearer token verification failed" };
  }
}

/**
 * SECURITY: constant-time string compare. The previous hand-rolled
 * version bailed early when `a.length !== b.length` — that early return
 * is observable in timing (and even without a stopwatch it leaks the
 * fact that the lengths differ, which lets an attacker confirm a known
 * prefix). We now SHA-256 both inputs first so the byte buffers we hand
 * to `crypto.timingSafeEqual` are always the same size, then do the
 * constant-time compare on the digests.
 *
 * SHA-256 is overkill for collision resistance here — we only need a
 * fixed-length projection so timingSafeEqual can't short-circuit on
 * length — but SHA-256 is available everywhere Node runs and the
 * performance cost is negligible (CSRF validation runs once per
 * mutating request).
 */
function timingSafeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a, "utf8").digest();
  const hashB = createHash("sha256").update(b, "utf8").digest();
  return nodeTimingSafeEqual(hashA, hashB);
}

/**
 * CSRF protection middleware for state-changing operations
 * Returns the response if valid, or an error response if invalid
 */
export function csrfErrorResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "انتهاك أمان - رمز التحقق غير صالح",
      code: "CSRF_ERROR",
    },
    {
      status: 403,
      headers: {
        "X-CSRF-Error": "true",
      },
    },
  );
}

/**
 * List of HTTP methods that require CSRF protection
 */
export const CSRF_REQUIRED_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

/**
 * Check if request method requires CSRF protection
 */
export function requiresCsrfProtection(method: string): boolean {
  return CSRF_REQUIRED_METHODS.includes(method.toUpperCase());
}

/**
 * Middleware helper: Apply CSRF check if method requires it
 * Usage in API routes:
 *
 * export async function POST(request: NextRequest) {
 *   const csrfCheck = applyCsrfProtection(request);
 *   if (csrfCheck) return csrfCheck;
 *   // ... continue with handler
 * }
 */
export async function applyCsrfProtection(
  request: NextRequest,
): Promise<NextResponse | null> {
  if (!requiresCsrfProtection(request.method)) {
    return null;
  }

  const validation = await validateCsrfRequest(request);
  if (!validation.valid) {
    logWarn("CSRF validation failed", {
      reason: validation.error,
      method: request.method,
      url: request.nextUrl.pathname,
    });
    return csrfErrorResponse();
  }

  return null;
}
