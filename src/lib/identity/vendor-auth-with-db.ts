import "server-only";
import type { NextRequest } from "next/server";
import { query } from "@/lib/db";
import type { QueryResult } from "pg";
import {
  clearVendorSessionCache,
  type VendorRole,
  type VendorSession,
  type VendorSessionEntry,
  verifyVendorRequest,
} from "./vendor-auth";
import { createRoleCache, type RoleCache } from "./auth/role-cache";

// Cache is shared with vendor-auth.ts so a successful DB verification
// also satisfies the lighter `verifyVendorRequest` callers downstream.

const vendorSessionCache: RoleCache<VendorSessionEntry> =
  createRoleCache<VendorSessionEntry>();

/**
 * Server-only verification that re-checks the vendor staff row against
 * the DB. Confirms:
 *   - staff + vendor still exist + are active
 *   - JWT role still matches the DB role (catches mid-session demotion)
 *
 * Token version bumps in the DB still invalidate outstanding JWTs even
 * though we don't carry the version in the JWT — bumping forces a fresh
 * DB lookup on the next request.
 *
 * Imports `@/lib/db` (pg transitively). Kept in its own module so the
 * barrel `@/lib/identity` re-exporting `vendor-auth.ts` does not pull
 * pg into client bundles.
 */
export async function verifyVendorRequestWithDb(
  request: NextRequest,
): Promise<VendorSession | null> {
  const session = await verifyVendorRequest(request);
  if (!session) return null;

  const cached = vendorSessionCache.get(session.staffId);
  if (cached) {
    if (!cached.isActive || !cached.vendorIsActive) return null;
  }

  const result = (await query(
    `SELECT vs.id, vs.email, vs.full_name_ar, vs.full_name_en, vs.role, vs.permissions, vs.is_active,
            vs.token_version,
            v.id as vendor_id, v.slug as vendor_slug, v.is_active as vendor_is_active
     FROM vendor_staff vs
     JOIN vendors v ON vs.vendor_id = v.id
     WHERE vs.id = $1 AND vs.vendor_id = $2`,
    [session.staffId, session.vendorId],
  )) as QueryResult;

  if (result.rows.length === 0) {
    vendorSessionCache.clear(session.staffId);
    clearVendorSessionCache(session.staffId);
    return null;
  }

  const staff = result.rows[0];
  if (!staff.is_active || !staff.vendor_is_active) {
    vendorSessionCache.clear(session.staffId);
    clearVendorSessionCache(session.staffId);
    return null;
  }

  if (staff.role !== session.role) {
    vendorSessionCache.clear(session.staffId);
    clearVendorSessionCache(session.staffId);
    return null;
  }

  const entry: VendorSessionEntry = {
    role: staff.role as VendorRole,
    isActive: staff.is_active === true,
    vendorIsActive: staff.vendor_is_active === true,
    tokenVersion: staff.token_version ?? 1,
  };
  vendorSessionCache.set(session.staffId, entry);

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
