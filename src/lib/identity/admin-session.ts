import type { NextRequest } from "next/server";
import { getAdminJwtSecretBytes, isCookieSecure } from "@/lib/env";
import type { AdminRole } from "@/lib/admin-types";
import { ADMIN_SESSION_COOKIE } from "./auth-cookie-name";
import { signJwt, verifyJwt } from "./auth/jwt-helper";

export { ADMIN_SESSION_COOKIE };

const ISS = "citymarket-admin";
const AUD = "citymarket-admin-api";

/**
 * Sign an admin session JWT.
 *
 * SECURITY (PCP-144): the JWT carries a `tokenVersion` claim equal to
 * the row's `admin_users.token_version` at sign time. The DB-backed
 * verify path (`requireAdminApi`) re-reads the row and compares; if
 * `token_version` has been bumped (e.g. password rotation, logout,
 * demotion), the now-stale JWT is rejected. Without this claim the
 * server has no way to know which token_version a given JWT was
 * minted under, and the only mitigation is the 60s role-cache TTL.
 */
export async function signAdminSessionToken(admin: {
  id: string;
  email: string;
  role: AdminRole | string;
  tokenVersion?: number;
}): Promise<string> {
  return signJwt(
    {
      email: admin.email,
      role: admin.role,
      // Default 1 keeps the claim stable for older callers that do
      // not pass a tokenVersion. New callers should always pass the
      // current row value (see the login + promotion paths).
      tokenVersion: admin.tokenVersion ?? 1,
    },
    admin.id,
    {
      issuer: ISS,
      audience: AUD,
      secretBytes: getAdminJwtSecretBytes(),
      expirationTime: "7d",
    },
  );
}

export type VerifiedAdminJwt = {
  id: string;
  email: string;
  role: AdminRole;
  /** Token version the JWT was minted under. Compared against the DB on every request. */
  tokenVersion: number;
};

export async function verifyAdminRequest(
  request: NextRequest
): Promise<VerifiedAdminJwt | null> {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyJwt<{
    email?: unknown;
    role?: unknown;
    tokenVersion?: unknown;
  }>(
    token,
    { issuer: ISS, audience: AUD, secretBytes: getAdminJwtSecretBytes() },
  );
  if (!payload || !payload.sub || !payload.role) return null;
  return {
    id: payload.sub,
    email: typeof payload.email === "string" ? payload.email : "",
    role: payload.role as AdminRole,
    // Default to 1 so a legacy token (no claim) still authenticates
    // until it expires — bumps the row to 1+ on first login post-fix
    // and the next request will be the comparison point.
    tokenVersion:
      typeof payload.tokenVersion === "number" && Number.isFinite(payload.tokenVersion)
        ? payload.tokenVersion
        : 1,
  };
}

export function adminSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: "strict" as const,
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  };
}
