import type { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { error as logError } from "@/lib/logger";
import type { VerifiedAdminJwt } from '@/lib/identity';
import { getClientIp } from "@/lib/request-ip";

export async function logAdminAction(
  admin: VerifiedAdminJwt | { id: string; email: string; name?: string },
  action: string,
  options?: {
    entityType?: string;
    entityId?: string | number;
    details?: Record<string, unknown>;
    request?: NextRequest;
  }
): Promise<void> {
  try {
    const ip = options?.request ? getClientIp(options.request) : null;

    await query(
      `INSERT INTO admin_audit_logs (admin_id, admin_email, admin_name, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        admin.id,
        admin.email,
        "name" in admin && admin.name ? admin.name : null,
        action,
        options?.entityType ?? null,
        options?.entityId != null ? String(options.entityId) : null,
        JSON.stringify(options?.details ?? {}),
        ip,
      ]
    );
  } catch (e) {
    logError("admin_audit_log failed", e, { action, adminId: admin.id });
  }
}
