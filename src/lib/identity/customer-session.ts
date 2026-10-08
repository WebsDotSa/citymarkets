/**
 * Customer JWT session — canonical home.
 *
 * Uses `jose` (Edge-safe HS256) for both signing and verifying, so this
 * module can be imported from any runtime (Node, Edge, RSC).
 *
 * Auth sources, in priority order:
 *   1. `Authorization: Bearer *** header — preferred for native mobile
 *      clients (iOS/Android can't reliably set httpOnly cookies from native
 *      networking code). Native clients must store the JWT in the
 *      platform's secure store (Keychain / EncryptedSharedPreferences).
 *   2. `customer_session` httpOnly cookie — set by the web flow
 *      (`POST /api/v1/auth/twilio/verify`).
 *
 * Legacy: an older version of this module had a Supabase `createServerClient`
 * fallback (third auth source). Supabase was removed from the runtime in the
 * 2026-09-30 cleanup, so the fallback was deleted and `resolveCustomerUserIdFromRequest`
 * became an alias for `getCustomerUserIdFromRequest`. If a future login flow
 * needs a third source, prefer extending the JWT verify path rather than
 * reaching for Supabase again.
 */
import type { NextRequest } from "next/server";
import { CUSTOMER_SESSION_COOKIE } from "./auth-cookie-name";
import { getCustomerJwtSecretBytes, isCookieSecure } from "@/lib/env";
import { signJwt, verifyJwt, type VerifyConfig } from "./auth/jwt-helper";
import { createJwtVerifyCache } from "./auth/jwt-verify-cache";

export const COOKIE_NAME = CUSTOMER_SESSION_COOKIE;

/**
 * Extract a Bearer token from the Authorization header. Case-insensitive
 * scheme match. Returns null when the header is missing or malformed.
 */
export function extractBearerToken(request: NextRequest): string | null {
  // Defensive: tests sometimes pass partial mock objects that lack
  // a `.headers` map. Treat those as "no header" and fall through to
  // the cookie path.
  const headers = (request as { headers?: { get?: (key: string) => string | null } }).headers;
  const get = headers?.get;
  if (typeof get !== "function") return null;
  const header = get.call(headers, "authorization");
  if (!header) return null;
  const trimmed = header.trim();
  // A real JWT is at least 30+ chars (header.payload.signature). Anything
  // shorter than 14 chars is not a usable token, so reject the header
  // early before passing it to verifyJwt.
  if (trimmed.length < 14) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(trimmed);
  return match ? match[1] : null;
}

// Issuer/audience claims act as a defense-in-depth cross-issuer isolation
// layer, analogous to the admin/vendor tokens. If a customer JWT were
// ever accidentally signed with the admin secret (or vice versa), the
// mismatched iss/aud would cause verification to fail instead of granting
// the wrong-role access. See `src/lib/identity/auth/jwt-helper.ts` for the
// shared sign/verify mechanics.
const ISS = "citymarket-customer";
const AUD = "citymarket-customer-api";

const customerSecretBytes = (): Uint8Array => getCustomerJwtSecretBytes();

const customerVerifyConfig = (): VerifyConfig => ({
  issuer: ISS,
  audience: AUD,
  secretBytes: customerSecretBytes(),
});

// JWT verify result cache (60s TTL). Caches CustomerJwtPayload (only on
// success) by the token string. Edge-safe (Map + Date.now only). See
// src/lib/identity/auth/jwt-verify-cache.ts for the full safety contract.
const _customerVerifyCache = createJwtVerifyCache<CustomerJwtPayload>();

export type CustomerJwtPayload = {
  userId: string;
  phone: string;
  /**
   * SECURITY (PCP-144): `users.token_version` at the time the JWT
   * was minted. The DB-backed auth path (auth-helpers.ts getServerUser)
   * re-reads the row and compares; if `token_version` has been
   * bumped (logout, password change), the now-stale JWT is rejected.
   * Defaults to 1 so a legacy token (no claim) still authenticates
   * until it expires — the first login post-fix bakes the new claim
   * in, and subsequent bumps invalidate it within one request.
   */
  tokenVersion?: number;
};

export async function signCustomerToken(
  payload: CustomerJwtPayload
): Promise<string> {
  return signJwt(
    {
      userId: payload.userId,
      phone: payload.phone,
      // Default 1 keeps the claim stable for callers that don't pass
      // a tokenVersion. New callers should always pass the current
      // row value (see the twilio-verify login flow).
      tokenVersion: payload.tokenVersion ?? 1,
    },
    payload.userId,
    {
      issuer: ISS,
      audience: AUD,
      secretBytes: customerSecretBytes(),
      expirationTime: "14d",
    },
  );
}

export async function verifyCustomerToken(
  token: string
): Promise<CustomerJwtPayload | null> {
  // Cache hit returns the verified payload directly — same token in the
  // same window skips HMAC entirely.
  const cached = _customerVerifyCache.get(token);
  if (cached !== null) return cached;
  const payload = await verifyJwt<{
    userId?: unknown;
    phone?: unknown;
    tokenVersion?: unknown;
  }>(token, customerVerifyConfig());
  if (!payload) return null;
  const userId = typeof payload.userId === "string" ? payload.userId : null;
  const phone = typeof payload.phone === "string" ? payload.phone : null;
  if (!userId || !phone) return null;
  const tokenVersion =
    typeof payload.tokenVersion === "number" &&
    Number.isFinite(payload.tokenVersion)
      ? payload.tokenVersion
      : 1;
  const result: CustomerJwtPayload = { userId, phone, tokenVersion };
  _customerVerifyCache.set(token, result);
  return result;
}

export function customerSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 14,
    path: "/",
  };
}

/**
 * JWT cookie OR Bearer header. Edge-safe (jose).
 * Use in proxies / RSC / anywhere Supabase cookies should not be read.
 *
 * Bearer token takes priority over the cookie so that mounting a Bearer
 * header on a "private mode" web view does not silently downgrade to a
 * stale cookie. Both are HMAC-verified with the same secret.
 */
export async function getCustomerUserIdFromRequest(
  request: NextRequest
): Promise<string | null> {
  const bearer = extractBearerToken(request);
  const cookieToken = request.cookies.get(COOKIE_NAME)?.value;
  const token = bearer ?? cookieToken;
  if (!token) return null;
  return (await verifyCustomerToken(token))?.userId ?? null;
}

/**
 * JWT cookie OR Bearer header. The full identity resolution path.
 *
 * Use this everywhere you need "who is the caller?" — the previous
 * `resolveCustomerUserIdFromRequest` was an alias for the same JWT-only
 * resolution after the Supabase fallback was removed (2026-09-30).
 *
 * NEVER trust x-user-id headers.
 */
export async function resolveCustomerUserIdFromRequest(
  request: NextRequest
): Promise<string | null> {
  return getCustomerUserIdFromRequest(request);
}

/** Guest cart / checkout session id (client-supplied; not crypto-verified). */
export function getGuestSessionIdFromRequest(
  request: NextRequest
): string | null {
  return (
    request.headers.get("x-session-id") ||
    request.cookies.get("session_id")?.value ||
    null
  );
}
