import type { NextRequest } from "next/server";
import { getAdminJwtSecretBytes, isCookieSecure } from "@/lib/env";
import type { AdminRole } from "@/lib/admin-types";
import { ADMIN_SESSION_COOKIE } from "@/lib/auth-cookie-name";
import { signJwt, verifyJwt } from "@/lib/auth/jwt-helper";

export { ADMIN_SESSION_COOKIE };

const ISS = "citymarket-admin";
const AUD = "citymarket-admin-api";

export async function signAdminSessionToken(admin: {
  id: string;
  email: string;
  role: AdminRole | string;
}): Promise<string> {
  return signJwt(
    { email: admin.email, role: admin.role },
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
};

export async function verifyAdminRequest(
  request: NextRequest
): Promise<VerifiedAdminJwt | null> {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyJwt<{ email?: unknown; role?: unknown }>(
    token,
    { issuer: ISS, audience: AUD, secretBytes: getAdminJwtSecretBytes() },
  );
  if (!payload || !payload.sub || !payload.role) return null;
  return {
    id: payload.sub,
    email: typeof payload.email === "string" ? payload.email : "",
    role: payload.role as AdminRole,
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
