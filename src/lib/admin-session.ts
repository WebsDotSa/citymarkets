import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { getAdminJwtSecretBytes, isCookieSecure } from "@/lib/env";
import type { AdminRole } from "@/lib/admin-types";
import { ADMIN_SESSION_COOKIE } from "@/lib/auth-cookie-name";

export { ADMIN_SESSION_COOKIE };

const ISS = "citymarket-admin";
const AUD = "citymarket-admin-api";

export async function signAdminSessionToken(admin: {
  id: string;
  email: string;
  role: AdminRole | string;
}): Promise<string> {
  return new SignJWT({
    email: admin.email,
    role: admin.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(admin.id)
    .setIssuedAt()
    .setIssuer(ISS)
    .setAudience(AUD)
    .setExpirationTime("7d")
    .sign(getAdminJwtSecretBytes());
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
  try {
    const { payload } = await jwtVerify(token, getAdminJwtSecretBytes(), {
      issuer: ISS,
      audience: AUD,
      algorithms: ["HS256"],
    });
    const id = typeof payload.sub === "string" ? payload.sub : "";
    const email = typeof payload.email === "string" ? payload.email : "";
    const role = typeof payload.role === "string" ? payload.role : "";
    if (!id || !role) return null;
    return { id, email, role: role as AdminRole };
  } catch {
    return null;
  }
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
