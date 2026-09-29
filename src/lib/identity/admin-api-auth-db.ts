import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { ROLE_PERMISSIONS, type AdminRole } from "@/lib/admin-types";
import { verifyAdminRequest, type VerifiedAdminJwt } from "./admin-session";
import { createRoleCache, type RoleCache } from "./auth/role-cache";

export type { VerifiedAdminJwt as AdminAuthUser };

interface AdminRoleEntry {
  role: AdminRole;
  isActive: boolean;
}

// Short-lived in-memory cache so auth checks don't issue a DB query per
// request. 60s is short enough to bound the impact of a stale role/badge
// while still cheap enough to not require a separate cache store. The
// shared `createRoleCache` factory is the single source of truth for
// TTL semantics — see src/lib/auth/role-cache.ts.
const adminRoleCache: RoleCache<AdminRoleEntry> = createRoleCache<AdminRoleEntry>();

function adminHasPermission(role: AdminRole, permission: string): boolean {
  const list = ROLE_PERMISSIONS[role];
  return Array.isArray(list) && list.includes(permission);
}

function adminUnauthorized(): NextResponse {
  return NextResponse.json(
    { success: false, error: "يجب تسجيل الدخول" },
    { status: 401 },
  );
}

function adminForbidden(): NextResponse {
  return NextResponse.json(
    { success: false, error: "ليست لديك صلاحية لهذا الإجراء" },
    { status: 403 },
  );
}

async function fetchAdminFreshFromDb(id: string): Promise<AdminRoleEntry | null> {
  const cached = adminRoleCache.get(id);
  if (cached) return cached;
  try {
    const result = await pool.query(
      `SELECT role::text AS role, is_active FROM admin_users WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as { role: string; is_active: boolean };
    const entry: AdminRoleEntry = {
      role: row.role as AdminRole,
      isActive: row.is_active === true,
    };
    adminRoleCache.set(id, entry);
    return entry;
  } catch {
    return null;
  }
}

export function clearAdminRoleCache(id?: string): void {
  adminRoleCache.clear(id);
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
  permission?: string,
): Promise<{ admin: VerifiedAdminJwt } | NextResponse> {
  const admin = await verifyAdminRequest(request);
  if (!admin) return adminUnauthorized();

  const fresh = await fetchAdminFreshFromDb(admin.id);
  if (!fresh || !fresh.isActive) {
    clearAdminRoleCache(admin.id);
    return adminUnauthorized();
  }

  if (fresh.role !== admin.role) {
    return adminForbidden();
  }

  if (permission && !adminHasPermission(fresh.role, permission)) {
    return adminForbidden();
  }
  return { admin };
}
