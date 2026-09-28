import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from "@/lib/customer-session";
import { requireAdminApi } from "@/lib/admin-api-auth";
import { error as logError } from "@/lib/logger";

/**
 * GET /api/v1/orders/[id]/timeline
 *
 * Returns the chronological status-change history for a single order,
 * joined to admin_users for the human-readable name + role. Used by the
 * shared <OrderTimeline> component on:
 *   - /orders/[id] (customer-side)
 *   - /admin/orders/[id] (admin-side, since Phase 2)
 *
 * Phase 2 / P2. Moved to /api/v1 namespace for consistency with the rest
 * of the public orders API (P1.2 audit fix).
 *
 * Auth:
 *   - Customer cookie (customer_session)  → must own the order
 *   - Admin/driver cookie (admin_session) → see any order (drivers still get
 *     scoping via `view_delivery_orders`)
 *
 * Returns 404 if the order doesn't exist OR the caller isn't authorized
 * (don't leak existence via 200 vs 403).
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await ctx.params;

  if (!orderId) {
    return NextResponse.json(
      { success: false, error: "معرّف الطلب مطلوب" },
      { status: 400 }
    );
  }

  try {
    const orderRow = await pool.query(
      `SELECT id, user_id FROM orders WHERE id = $1 LIMIT 1`,
      [orderId]
    );
    if (orderRow.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "الطلب غير موجود" },
        { status: 404 }
      );
    }
    const orderUserId = orderRow.rows[0].user_id as string | null;

    // Two-branch auth: customer (owns the order) OR admin/driver.
    const customerUserId = await resolveCustomerUserIdFromRequest(request);
    if (customerUserId && orderUserId === customerUserId) {
      // ok — fall through to the fetch
    } else {
      const adminGate = await requireAdminApi(request, "view_delivery_orders");
      if (adminGate instanceof NextResponse) {
        // Could also be a super_admin without delivery permission. Try the
        // broader gate; surface 404 to avoid leaking existence.
        const broadGate = await requireAdminApi(request, "manage_orders");
        if (broadGate instanceof NextResponse) {
          return NextResponse.json(
            { success: false, error: "غير مصرح" },
            { status: 403 }
          );
        }
      }
    }

    const result = await pool.query(
      `SELECT l.old_status,
              l.new_status,
              l.changed_by_admin_id,
              l.changed_by,
              l.notes,
              l.created_at,
              au.name AS changed_by_name,
              au.role AS changed_by_role
         FROM order_status_logs l
         LEFT JOIN admin_users au ON au.id = l.changed_by_admin_id
        WHERE l.order_id = $1
        ORDER BY l.created_at ASC`,
      [orderId]
    );

    return NextResponse.json({
      success: true,
      timeline: result.rows.map((row) => ({
        old_status: row.old_status,
        new_status: row.new_status,
        changed_by_admin_id: row.changed_by_admin_id,
        changed_by_name: row.changed_by_name ?? null,
        changed_by_role: row.changed_by_role ?? null,
        changed_by_legacy: row.changed_by ?? null,
        notes: row.notes ?? null,
        created_at:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : row.created_at,
      })),
    });
  } catch (e) {
    logError("timeline fetch error", e, { orderId });
    return NextResponse.json(
      { success: false, error: "تعذر جلب سجل الطلب" },
      { status: 500 }
    );
  }
}
