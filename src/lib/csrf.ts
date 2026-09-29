/**
 * CSRF Protection using Double-Submit Cookie Pattern
 *
 * This provides protection against Cross-Site Request Forgery attacks
 * by requiring a matching token in both a cookie and the request header/body.
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
 * Get or create CSRF token for the current session
 */
export async function getCsrfToken(): Promise<string> {
  const cookieStore = await cookies();
  const existingToken = cookieStore.get(CSRF_COOKIE_NAME)?.value;

  if (existingToken) {
    return existingToken;
  }

  return generateCsrfToken();
}

/**
 * Set CSRF cookie in response
 */
export function setCsrfCookie(response: NextResponse): NextResponse {
  const token = generateCsrfToken();

  response.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // Must be readable by JavaScript for the double-submit pattern
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
 * Validate CSRF token from request
 * Uses the double-submit cookie pattern:
 * 1. Token in cookie (set automatically by browser)
 * 2. Token in header (must be sent by client)
 */
export function validateCsrfToken(request: NextRequest): CsrfValidationResult {
  // Get the cookie token
  const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value;

  // Get the header token
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
