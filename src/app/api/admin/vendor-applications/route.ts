/**
 * Admin endpoints for vendor_applications review queue.
 *
 *   GET    /api/admin/vendor-applications
 *     Returns the queue with optional status filter (?status=new|approved|rejected).
 *     Includes a denormalised `has_conflict` flag: TRUE when the applicant
 *     email already owns an ACTIVE vendor (i.e. an approved application
 *     landed) or when an open application with the same email exists.
 *
 *   DELETE /api/admin/vendor-applications?id=<uuid>
 *     Hard delete a CLOSED application (status='approved' or 'rejected').
 *     Open applications can't be deleted; they must be approved/rejected
 *     first so the audit trail stays coherent.
 */
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { logAdminAction } from "@/lib/admin-audit";

import { error as logError } from "@/lib/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const validStatuses = ["new", "approved", "rejected"] as const;
    const statusFilter = validStatuses.includes(status as any)
      ? status
      : null;

    // LEFT JOIN to surface any duplicate open applications per email —
    // we want the admin to know when two applicants somehow slipped past
    // the partial unique index (race condition at submission).
    const result = await query(
      `SELECT
         va.id, va.business_name_ar, va.business_name_en,
         va.vendor_type, va.description_ar, va.description_en,
         va.owner_full_name, va.owner_email, va.owner_phone,
         va.owner_whatsapp, va.address_ar, va.pickup_lat, va.pickup_lng,
         va.city, va.delivery_mode, va.accepts_cod, va.accepts_online_payment,
         va.documents, va.status, va.admin_notes, va.rejection_reason,
         va.reviewed_by, va.reviewed_at, va.approved_vendor_id,
         va.created_at, va.updated_at,
         EXISTS (
           SELECT 1 FROM vendor_staff vs
            WHERE LOWER(vs.email) = LOWER(va.owner_email)
         ) AS owner_already_exists
       FROM vendor_applications va
       ${statusFilter ? "WHERE va.status = $1" : ""}
       ORDER BY
         CASE va.status WHEN 'new' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
         va.created_at DESC
       LIMIT 200`,
      statusFilter ? [statusFilter] : [],
    );

    // Counts for the queue header.
    const counts = await query(
      `SELECT status, COUNT(*)::int AS c
         FROM vendor_applications
        GROUP BY status`,
    );
    const statusMap: Record<string, number> = { new: 0, approved: 0, rejected: 0 };
    for (const row of counts.rows) {
      statusMap[row.status] = row.c;
    }

    return NextResponse.json({
      success: true,
      data: result.rows,
      counts: statusMap,
    });
  } catch (error) {
    logError("admin vendor-applications GET:", error);
    return NextResponse.json(
      { success: false, error: "فشل الجلب" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json(
        { success: false, error: "المعرّف غير صالح" },
        { status: 400 },
      );
    }

    const existing = await query(
      `SELECT status FROM vendor_applications WHERE id = $1`,
      [id],
    );
    if (existing.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "الطلب غير موجود" },
        { status: 404 },
      );
    }
    if (existing.rows[0].status === "new") {
      return NextResponse.json(
        {
          success: false,
          error:
            "لا يمكن حذف طلب قيد المراجعة. ارفضه أو وافق عليه أولاً للحفاظ على سجل التدقيق.",
        },
        { status: 400 },
      );
    }

    await query(`DELETE FROM vendor_applications WHERE id = $1`, [id]);
    await logAdminAction(gate.admin, "vendor_application.delete", {
      entityType: "vendor_application",
      entityId: id,
      request,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("admin vendor-applications DELETE:", error);
    return NextResponse.json(
      { success: false, error: "فشل الحذف" },
      { status: 500 },
    );
  }
}