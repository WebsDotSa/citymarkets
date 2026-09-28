import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  ROLE_PERMISSIONS,
  type AdminRole,
} from "@/lib/admin-types";
import { verifyAdminRequest, type VerifiedAdminJwt } from "@/lib/admin-session";
import { pool } from "@/lib/db";

export type { VerifiedAdminJwt as AdminAuthUser };

export function adminUnauthorized() {
  return NextResponse.json(
    { success: false, error: "يجب تسجيل الدخول" },
    { status: 401 }
  );
}

export function adminForbidden() {
  return NextResponse.json(
    { success: false, error: "ليست لديك صلاحية لهذا الإجراء" },
    { status: 403 }
  );
}

export function adminHasPermission(
  role: AdminRole,
  permission: string
): boolean {
  const list = ROLE_PERMISSIONS[role];
  return Array.isArray(list) && list.includes(permission);
}

// Short-lived in-memory cache so auth checks don't issue a DB query per
// request. 60s is short enough to bound the impact of a stale role/badge
// while still cheap enough to not require a separate cache store.
const adminRoleCache = new Map<string, { role: AdminRole; isActive: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 1000;

async function fetchAdminFreshFromDb(id: string): Promise<{ role: AdminRole; isActive: boolean } | null> {
  const cached = adminRoleCache.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    return { role: cached.role, isActive: cached.isActive };
  }
  try {
    const result = await pool.query(
      `SELECT role::text AS role, is_active FROM admin_users WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as { role: string; is_active: boolean };
    const role = row.role as AdminRole;
    const isActive = row.is_active === true;
    adminRoleCache.set(id, { role, isActive, expiresAt: Date.now() + CACHE_TTL_MS });
    return { role, isActive };
  } catch {
    return null;
  }
}

export function clearAdminRoleCache(id?: string): void {
  if (id) {
    adminRoleCache.delete(id);
  } else {
    adminRoleCache.clear();
  }
}

/**
 * Validates admin JWT cookie and optional ROLE_PERMISSIONS key.
 *
 * SECURITY (H1): in addition to verifying the JWT signature, this
 * re-validates the admin's role and active status from the DB. Without
 * this, a demoted admin would still have a valid JWT until natural
 * expiry (up to 7 days). The result is cached for 60s to avoid
 * per-request DB load.
 */
export async function requireAdminApi(
  request: NextRequest,
  permission?: string
): Promise<{ admin: VerifiedAdminJwt } | NextResponse> {
  const admin = await verifyAdminRequest(request);
  if (!admin) return adminUnauthorized();

  // Treat the DB as the source of truth for role + active status.
  const fresh = await fetchAdminFreshFromDb(admin.id);
  if (!fresh || !fresh.isActive) {
    clearAdminRoleCache(admin.id);
    return adminUnauthorized();
  }

  // Reject if the JWT's role no longer matches the DB.
  if (fresh.role !== admin.role) {
    return adminForbidden();
  }

  if (permission && !adminHasPermission(fresh.role, permission)) {
    return adminForbidden();
  }
  return { admin };
}
