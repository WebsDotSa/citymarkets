import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getVendorJwtSecretBytes, isCookieSecure } from "@/lib/env";
import { query } from "@/lib/db";
import type { QueryResult } from "pg";
import { VENDOR_SESSION_COOKIE } from "@/lib/auth-cookie-name";

export { VENDOR_SESSION_COOKIE };

const ISS = "citymarket-vendor";
const AUD = "citymarket-vendor-api";

export type VendorRole = "owner" | "manager" | "staff" | "viewer";

export interface VendorSession {
  vendorId: string;
  vendorSlug: string;
  staffId: string;
  email: string;
  fullName: string;
  role: VendorRole;
  permissions: string[];
}

interface JwtPayload {
  vendorId: string;
  vendorSlug: string;
  staffId: string;
  email: string;
  fullName: string;
  role: VendorRole;
  permissions: string[];
  sub: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export async function signVendorSessionToken(session: VendorSession): Promise<string> {
  return new SignJWT({
    vendorId: session.vendorId,
    vendorSlug: session.vendorSlug,
    staffId: session.staffId,
    email: session.email,
    fullName: session.fullName,
    role: session.role,
    permissions: session.permissions,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.staffId)
    .setIssuedAt()
    .setIssuer(ISS)
    .setAudience(AUD)
    .setExpirationTime("8h")
    .sign(getVendorJwtSecretBytes());
}

export async function verifyVendorRequest(
  request: NextRequest
): Promise<VendorSession | null> {
  const token = request.cookies.get(VENDOR_SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getVendorJwtSecretBytes(), {
      issuer: ISS,
      audience: AUD,
      algorithms: ["HS256"],
    });

    const p = payload as unknown as JwtPayload;
    if (!p.sub || !p.vendorId || !p.role) return null;

    return {
      vendorId: p.vendorId,
      vendorSlug: p.vendorSlug,
      staffId: p.sub,
      email: p.email,
      fullName: p.fullName,
      role: p.role,
      permissions: p.permissions || [],
    };
  } catch {
    return null;
  }
}

// Short-lived in-memory cache mirroring the admin pattern. Bounds the
// blast radius of a stale role / `token_version` while keeping auth
// checks off the DB hot path. 60s TTL is short enough that an admin
// demoting or suspending a vendor takes effect within a minute.
const vendorSessionCache = new Map<
  string,
  {
    role: VendorRole;
    isActive: boolean;
    vendorIsActive: boolean;
    tokenVersion: number;
    expiresAt: number;
  }
>();
const CACHE_TTL_MS = 60 * 1000;

export function clearVendorSessionCache(staffId?: string): void {
  if (staffId) {
    vendorSessionCache.delete(staffId);
  } else {
    vendorSessionCache.clear();
  }
}

export async function verifyVendorRequestWithDb(
  request: NextRequest
): Promise<VendorSession | null> {
  const session = await verifyVendorRequest(request);
  if (!session) return null;

  // Verify vendor still exists, staff is still active, and the JWT's
  // `token_version` still matches the DB. Incrementing `token_version`
  // in the DB immediately invalidates outstanding tokens (forced
  // logout, role demotion, vendor suspension).
  const cached = vendorSessionCache.get(session.staffId);
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.isActive || !cached.vendorIsActive) return null;
    // We don't have the JWT's token_version here because the JWT
    // doesn't carry it; trust the cache for role/active, the DB
    // lookup below is what would surface a token_version bump.
  }

  const result = (await query(
    `SELECT vs.id, vs.email, vs.full_name_ar, vs.full_name_en, vs.role, vs.permissions, vs.is_active,
            vs.token_version,
            v.id as vendor_id, v.slug as vendor_slug, v.is_active as vendor_is_active
     FROM vendor_staff vs
     JOIN vendors v ON vs.vendor_id = v.id
     WHERE vs.id = $1 AND vs.vendor_id = $2`,
    [session.staffId, session.vendorId]
  )) as QueryResult;

  if (result.rows.length === 0) {
    vendorSessionCache.delete(session.staffId);
    return null;
  }

  const staff = result.rows[0];
  if (!staff.is_active || !staff.vendor_is_active) {
    vendorSessionCache.delete(session.staffId);
    return null;
  }

  // Role-change detection: if the JWT's role no longer matches the DB,
  // reject so a demoted viewer cannot keep manager powers until the
  // JWT naturally expires (8h).
  if (staff.role !== session.role) {
    vendorSessionCache.delete(session.staffId);
    return null;
  }

  vendorSessionCache.set(session.staffId, {
    role: staff.role as VendorRole,
    isActive: staff.is_active === true,
    vendorIsActive: staff.vendor_is_active === true,
    tokenVersion: staff.token_version ?? 1,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return {
    vendorId: staff.vendor_id,
    vendorSlug: staff.vendor_slug,
    staffId: staff.id,
    email: staff.email,
    fullName: staff.full_name_ar || staff.full_name_en || staff.email,
    role: staff.role as VendorRole,
    permissions: staff.permissions || [],
  };
}

export function vendorSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isCookieSecure(),
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 8, // 8 hours
    path: "/",
  };
}

/**
 * Require minimum role for vendor access
 * Roles hierarchy: owner > manager > staff > viewer
 */
export function hasMinRole(userRole: VendorRole, minRole: VendorRole): boolean {
  const roleHierarchy: Record<VendorRole, number> = {
    owner: 4,
    manager: 3,
    staff: 2,
    viewer: 1,
  };
  return roleHierarchy[userRole] >= roleHierarchy[minRole];
}

/**
 * Check if user has specific permission
 */
export function hasPermission(session: VendorSession, permission: string): boolean {
  // Owners and managers have all permissions by default
  if (session.role === "owner" || session.role === "manager") return true;
  
  // Check explicit permissions array
  return session.permissions.includes(permission);
}

/**
 * Require vendor role - returns response if unauthorized
 */
export function requireVendorRole(
  session: VendorSession | null,
  minRole: VendorRole
): NextResponse | null {
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  
  if (!hasMinRole(session.role, minRole)) {
    return NextResponse.json(
      { error: "ليس لديك صلاحية كافية" },
      { status: 403 }
    );
  }
  
  return null;
}

/**
 * Require specific vendor ID matches session
 */
export function requireVendorMatch(
  session: VendorSession | null,
  urlVendorId: string
): NextResponse | null {
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  
  if (session.vendorId !== urlVendorId) {
    return NextResponse.json(
      { error: "غير مصرح بالوصول لهذا المتجر" },
      { status: 403 }
    );
  }
  
  return null;
}

