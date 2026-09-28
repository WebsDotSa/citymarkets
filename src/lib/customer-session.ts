/**
 * Customer JWT session — canonical home.
 *
 * Uses `jose` (Edge-safe HS256) for both signing and verifying, so this
 * module can be imported from any runtime (Node, Edge, RSC).
 *
 * Auth sources, in priority order:
 *   1. `Authorization: Bearer <jwt>` header — preferred for native mobile
 *      clients (iOS/Android can't reliably set httpOnly cookies from native
 *      networking code). Native clients must store the JWT in the
 *      platform's secure store (Keychain / EncryptedSharedPreferences).
 *   2. `customer_session` httpOnly cookie — set by the web flow
 *      (`POST /api/v1/auth/twilio/verify`).
 *   3. Supabase session (fallback) — only honored when an explicit
 *      Supabase cookie is present.
 */
import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { CUSTOMER_SESSION_COOKIE } from "./auth-cookie-name";
import { getCustomerJwtSecretBytes, getSupabasePublicConfig, isCookieSecure } from "./env";
import { signJwt, verifyJwt, type VerifyConfig } from "@/lib/auth/jwt-helper";

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
// the wrong-role access. See `src/lib/auth/jwt-helper.ts` for the
// shared sign/verify mechanics.
const ISS = "citymarket-customer";
const AUD = "citymarket-customer-api";

const customerSecretBytes = (): Uint8Array => getCustomerJwtSecretBytes();

const customerVerifyConfig = (): VerifyConfig => ({
  issuer: ISS,
  audience: AUD,
  secretBytes: customerSecretBytes(),
});

export type CustomerJwtPayload = {
  userId: string;
  phone: string;
};

export async function signCustomerToken(
  payload: CustomerJwtPayload
): Promise<string> {
  return signJwt(
    { userId: payload.userId, phone: payload.phone },
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
  const payload = await verifyJwt<{ userId?: unknown; phone?: unknown }>(
    token,
    customerVerifyConfig(),
  );
  if (!payload) return null;
  const userId = typeof payload.userId === "string" ? payload.userId : null;
  const phone = typeof payload.phone === "string" ? payload.phone : null;
  if (!userId || !phone) return null;
  return { userId, phone };
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
 * JWT cookie OR Bearer header OR Supabase session fallback.
 * Use in API routes where Supabase OTP is also a valid login path.
 * NEVER trust x-user-id headers.
 */
export async function resolveCustomerUserIdFromRequest(
  request: NextRequest
): Promise<string | null> {
  const fromJwt = await getCustomerUserIdFromRequest(request);
  if (fromJwt) return fromJwt;

  const { url: supabaseUrl, anonKey: supabaseAnon } = getSupabasePublicConfig();
  if (!supabaseUrl || !supabaseAnon) return null;

  const supabase = createServerClient(supabaseUrl, supabaseAnon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll() {
        /* read-only in route handlers */
      },
    },
  });

  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
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
