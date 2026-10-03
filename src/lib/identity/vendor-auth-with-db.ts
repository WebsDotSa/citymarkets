import "server-only";
import type { NextRequest } from "next/server";
import { query } from "@/lib/db";
import type { QueryResult } from "pg";
import {
  clearVendorSessionCache,
  type VendorRole,
  type VendorSession,
  verifyVendorRequest,
} from "./vendor-auth";
import { createRoleCache, type RoleCache } from "./auth/role-cache";
import { assertTokenVersionMatches } from "./auth/token-version";

// Cache is shared with vendor-auth.ts so a successful DB verification
// also satisfies the lighter `verifyVendorRequest` callers downstream.
interface VendorSessionEntry {
  role: VendorRole;
  isActive: boolean;
  vendorIsActive: boolean;
  tokenVersion: number;
}

const vendorSessionCache: RoleCache<VendorSessionEntry> =
  createRoleCache<VendorSessionEntry>();

/**
 * Server-only verification that re-checks the vendor staff row against
 * the DB. Confirms:
 *   - staff + vendor still exist + are active
 *   - JWT role still matches the DB role (catches mid-session demotion)
 *   - JWT `tokenVersion` claim still matches the DB row (catches
 *     mid-session logout / password rotation / staff disable)
 *
 * SECURITY (PCP-144): token_version is now compared on every request.
 * The JWT carries the row's `token_version` at sign time (see
 * `signVendorSessionToken` in vendor-auth.ts). When a logout, password
 * rotation, or admin-driven disable bumps the DB column, the next
 * request re-reads the row → sees a higher value → returns null →
 * the caller is forced to re-authenticate. The 60s role-cache TTL
 * is no longer the only mitigation.
 */
export async function verifyVendorRequestWithDb(
  request: NextRequest,
): Promise<VendorSession | null> {
  const session = await verifyVendorRequest(request);
  if (!session) return null;

  const cached = vendorSessionCache.get(session.staffId);
  if (cached) {
    if (!cached.isActive || !cached.vendorIsActive) return null;
    // SECURITY (PCP-144): even on a cache hit, the JWT's
    // tokenVersion must match. A bump in the DB column should
    // immediately invalidate this JWT — we do not wait for the
    // cache TTL to expire. Bump paths (logout, staff PUT) clear
    // both caches so this branch is reached with a fresh DB read.
    if (cached.tokenVersion !== (session.tokenVersion ?? 1)) {
      vendorSessionCache.clear(session.staffId);
      clearVendorSessionCache(session.staffId);
      return null;
    }
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

  // SECURITY (PCP-144): compare the DB row's token_version against
  // the JWT's claim. A mismatch means the JWT was issued before the
  // most recent logout / credential rotation and must be rejected.
  // The login + staff PUT paths both bump token_version and clear
  // the cache, so the next request is a cache miss → re-reads the
  // DB → sees the new version → fails this comparison → null.
  // The compare is centralised in assertTokenVersionMatches so the
  // customer / admin / vendor verify paths cannot drift.
  if (
    !assertTokenVersionMatches(
      { tokenVersion: session.tokenVersion },
      staff.token_version,
    )
  ) {
    vendorSessionCache.clear(session.staffId);
    clearVendorSessionCache(session.staffId);
    return null;
  }
  const dbTokenVersion = (staff.token_version ?? 1) as number;

  const entry: VendorSessionEntry = {
    role: staff.role as VendorRole,
    isActive: staff.is_active === true,
    vendorIsActive: staff.vendor_is_active === true,
    tokenVersion: dbTokenVersion,
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
    tokenVersion: dbTokenVersion,
  };
}
