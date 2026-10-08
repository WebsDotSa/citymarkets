import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getVendorJwtSecretBytes, isCookieSecure } from "@/lib/env";
import { VENDOR_SESSION_COOKIE } from "./auth-cookie-name";
import { createRoleCache, type RoleCache } from "./auth/role-cache";
import { signJwt, verifyJwt } from "./auth/jwt-helper";

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
  /**
   * SECURITY (PCP-144): `vendor_staff.token_version` at the time
   * the JWT was minted. The DB-backed auth path
   * (verifyVendorRequestWithDb in vendor-auth-with-db.ts) re-reads
   * the row and compares; if `token_version` has been bumped
   * (logout, password change, role demotion, is_active flip), the
   * now-stale JWT is rejected on the next request. Defaults to 1 so
   * a legacy token (no claim) still authenticates until it expires
   * — the next login post-fix bakes the new claim in, and any
   * subsequent bump invalidates it within one request.
   */
  tokenVersion?: number;
}

export async function signVendorSessionToken(session: VendorSession): Promise<string> {
  return signJwt(
    {
      vendorId: session.vendorId,
      vendorSlug: session.vendorSlug,
      staffId: session.staffId,
      email: session.email,
      fullName: session.fullName,
      role: session.role,
      permissions: session.permissions,
      // Default 1 keeps the claim stable for callers that don't
      // pass a tokenVersion. New callers should always pass the
      // current row value (see the vendor login + staff change
      // routes).
      tokenVersion: session.tokenVersion ?? 1,
    },
    session.staffId,
    {
      issuer: ISS,
      audience: AUD,
      secretBytes: getVendorJwtSecretBytes(),
      expirationTime: "8h",
    },
  );
}

export async function verifyVendorRequest(
  request: NextRequest
): Promise<VendorSession | null> {
  const token = request.cookies.get(VENDOR_SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifyJwt<{
    vendorId?: unknown;
    vendorSlug?: unknown;
    email?: unknown;
    fullName?: unknown;
    role?: unknown;
    permissions?: unknown;
    tokenVersion?: unknown;
  }>(
    token,
    { issuer: ISS, audience: AUD, secretBytes: getVendorJwtSecretBytes() },
  );

  if (!payload || !payload.sub || !payload.vendorId || !payload.role) {
    return null;
  }

  return {
    vendorId: String(payload.vendorId),
    vendorSlug: typeof payload.vendorSlug === "string" ? payload.vendorSlug : "",
    staffId: payload.sub,
    email: typeof payload.email === "string" ? payload.email : "",
    fullName: typeof payload.fullName === "string" ? payload.fullName : "",
    role: payload.role as VendorRole,
    permissions: Array.isArray(payload.permissions)
      ? (payload.permissions as unknown[]).map(String)
      : [],
    tokenVersion:
      typeof payload.tokenVersion === "number" && Number.isFinite(payload.tokenVersion)
        ? payload.tokenVersion
        : 1,
  };
}

interface VendorSessionEntry {
  role: VendorRole;
  isActive: boolean;
  vendorIsActive: boolean;
  tokenVersion: number;
}

// Short-lived in-memory cache mirroring the admin pattern. Bounds the
// blast radius of a stale role / `token_version` while keeping auth
// checks off the DB hot path. The shared `createRoleCache` factory is
// the single source of truth for TTL semantics — see
// src/lib/identity/auth/role-cache.ts.
const vendorSessionCache: RoleCache<VendorSessionEntry> =
  createRoleCache<VendorSessionEntry>();

export function clearVendorSessionCache(staffId?: string): void {
  vendorSessionCache.clear(staffId);
}

// `verifyVendorRequestWithDb` (DB-backed re-verification) lives in
// `vendor-auth-with-db.ts` to keep `@/lib/db` (pg transitively) out of
// this module — the barrel `@/lib/identity` re-exports functions from
// here, and client components transitively pull in the barrel. Import
// the DB-backed variant directly from
// `@/lib/identity/vendor-auth-with-db` when needed.

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

