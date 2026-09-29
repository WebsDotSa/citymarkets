import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from '@/lib/identity';
import { error as logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Phase 2 / P3a — driver-scoped past-order history.
//
// Returns the calling driver's terminal-status orders (`delivered`,
// `cancelled`) plus `on_the_way` rows so an in-flight delivery still shows
// up. Excludes `pending` (those are unassigned pool orders visible on the
// main /api/admin/driver/orders endpoint, not "history").
//
// Same RBAC scoping pattern as /api/admin/driver/orders:
//   1. requireAdminApi("view_delivery_orders") — driver role required.
//   2. Resolve drivers.id from admin_user_id; orders.driver_id references
//      drivers.id (not admin_users.id), per Phase 1 audit.
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "view_delivery_orders");
  if (gate instanceof NextResponse) return gate;

  const driverRow = await pool.query(
    `SELECT id FROM drivers WHERE admin_user_id = $1`,
    [gate.admin.id],
  );
  const driverId = driverRow.rows[0]?.id as string | undefined;

  if (!driverId) {
    // Driver account exists in admin_users but linkage row is missing.
    // Phase 1 migration 069 should have populated this for every driver;
    // if we hit this branch it's a data-integrity signal worth surfacing.
    return NextResponse.json(
      {
        success: false,
        error: "حساب السائق غير مربوط بسجل التوصيل — يرجى مراجعة الإدارة",
      },
      { status: 412 }, // Precondition Failed — explicit "data missing" signal.
    );
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") || "30", 10) || 30, 100);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);

  try {
    // delivered_at is virtual: orders.delivered_at doesn't exist, so we pull
    // the most recent log row that flipped the order to 'delivered'. NULLS
    // LAST keeps active on_the_way rows at the bottom instead of mixed in.
    const params: unknown[] = [driverId];
    let statusClause = "";
    if (status && ["delivered", "cancelled", "on_the_way"].includes(status)) {
      params.push(status);
      statusClause = `AND o.status = $${params.length}`;
    }

    params.push(limit, offset);

    const sql = `
      SELECT
        o.id,
        o.tracking_code                                                              AS order_number,
        o.status,
        o.total::float                                                               AS total,
        o.delivery_fee::float                                                        AS delivery_fee,
        o.payment_method,
        o.payment_status,
        o.created_at,
        o.driver_id,
        u.name                                                                       AS customer_name,
        u.phone                                                                      AS customer_phone,
        da.label                                                                     AS address_label,
        da.address_text,
        (SELECT MAX(l.created_at)
           FROM order_status_logs l
          WHERE l.order_id = o.id AND l.new_status = 'delivered')                   AS delivered_at,
        (SELECT MAX(l.created_at)
           FROM order_status_logs l
          WHERE l.order_id = o.id AND l.new_status = 'cancelled')                   AS cancelled_at,
        COUNT(*) OVER ()                                                             AS total_count
      FROM orders o
      LEFT JOIN users u     ON u.id = o.user_id
      LEFT JOIN addresses da ON da.id = o.address_id
      WHERE o.driver_id = $1
        AND o.status IN ('delivered', 'cancelled', 'on_the_way')
        ${statusClause}
      ORDER BY
        COALESCE(
          (SELECT MAX(l.created_at) FROM order_status_logs l
            WHERE l.order_id = o.id AND l.new_status IN ('delivered','cancelled')),
          o.updated_at,
          o.created_at
        ) DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const result = await pool.query(sql, params);
    const rows = result.rows;
    const totalCount =
      rows.length > 0 ? Number(rows[0].total_count) : 0;

    return NextResponse.json({
      success: true,
      orders: rows.map((r) => ({
        id: r.id,
        order_number: r.order_number,
        status: r.status,
        total: r.total,
        delivery_fee: r.delivery_fee,
        payment_method: r.payment_method,
        payment_status: r.payment_status,
        created_at:
          r.created_at instanceof Date
            ? r.created_at.toISOString()
            : r.created_at,
        delivered_at:
          r.delivered_at instanceof Date
            ? r.delivered_at.toISOString()
            : r.delivered_at,
        cancelled_at:
          r.cancelled_at instanceof Date
            ? r.cancelled_at.toISOString()
            : r.cancelled_at,
        customer_name: r.customer_name,
        customer_phone: r.customer_phone,
        address_label: r.address_label,
        address_text: r.address_text,
      })),
      pagination: {
        limit,
        offset,
        total: Number(totalCount) || 0,
        has_more: offset + rows.length < (Number(totalCount) || 0),
      },
    });
  } catch (e) {
    logError("Driver history fetch error", e, { driverId });
    return NextResponse.json(
      { success: false, error: "تعذر جلب السجل" },
      { status: 500 }
    );
  }
}
