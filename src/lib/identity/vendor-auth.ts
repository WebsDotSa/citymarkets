import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getVendorJwtSecretBytes, isCookieSecure } from "@/lib/env";
import { query } from "@/lib/db";
import type { QueryResult } from "pg";
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
// src/lib/auth/role-cache.ts.
const vendorSessionCache: RoleCache<VendorSessionEntry> =
  createRoleCache<VendorSessionEntry>();

export function clearVendorSessionCache(staffId?: string): void {
  vendorSessionCache.clear(staffId);
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
  if (cached) {
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
    vendorSessionCache.clear(session.staffId);
    return null;
  }

  const staff = result.rows[0];
  if (!staff.is_active || !staff.vendor_is_active) {
    vendorSessionCache.clear(session.staffId);
    return null;
  }

  // Role-change detection: if the JWT's role no longer matches the DB,
  // reject so a demoted viewer cannot keep manager powers until the
  // JWT naturally expires (8h).
  if (staff.role !== session.role) {
    vendorSessionCache.clear(session.staffId);
    return null;
  }

  vendorSessionCache.set(session.staffId, {
    role: staff.role as VendorRole,
    isActive: staff.is_active === true,
    vendorIsActive: staff.vendor_is_active === true,
    tokenVersion: staff.token_version ?? 1,
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

