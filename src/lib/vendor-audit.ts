import { query } from "@/lib/db";
import { error as logError } from "@/lib/logger";

/**
 * Write a vendor-side audit record.
 *
 * Mirrors `logAdminAction` (admin-audit.ts) but is scoped to
 * vendor_staff actors and includes `vendor_id` as a first-class
 * column so reports can filter by vendor. We reuse the same
 * `admin_audit_logs` table to avoid duplicating schema — the
 * `actor_type` distinguishes the actor kind (`vendor_staff` vs
 * `admin`).
 */
export interface VendorAuditEvent {
  vendorId: string;
  actorStaffId: string;
  actorEmail?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export async function logVendorAudit(event: VendorAuditEvent): Promise<void> {
  try {
    await query(
      `INSERT INTO admin_audit_logs
         (admin_id, admin_email, admin_name, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        event.actorStaffId,
        event.actorEmail ?? null,
        `vendor:${event.vendorId}`,
        event.action,
        event.targetType ?? null,
        event.targetId ?? null,
        JSON.stringify({
          vendor_id: event.vendorId,
          ...(event.metadata ?? {}),
        }),
      ]
    );
  } catch (e) {
    // Audit writes must never break the calling flow — just log and
    // move on. Same posture as `logAdminAction`.
    logError("vendor_audit_log failed", e, {
      action: event.action,
      vendorId: event.vendorId,
    });
  }
}
