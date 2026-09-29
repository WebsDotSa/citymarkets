import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export const dynamic = "force-dynamic";

// GET /api/admin/driver/orders - Get orders for the driver
export async function GET(request: NextRequest) {
  // Require driver role
  const gate = await requireAdminApi(request, "view_delivery_orders");
  if (gate instanceof NextResponse) return gate;

  // SECURITY (RBAC): scope results to this driver's record. A
  // delivery_driver-role admin must only see:
  //   - orders assigned to their own `drivers` row, OR
  //   - orders still unassigned (driver_id IS NULL) that they can pick up
  // Without this filter, every driver would see every delivery order.
  // Lookup the driver record id from drivers.admin_user_id; fall back to
  // "unassigned only" if the linkage is missing.
  const driverRow = await pool.query(
    `SELECT id FROM drivers WHERE admin_user_id = $1`,
    [gate.admin.id],
  );
  const driverId = driverRow.rows[0]?.id as string | undefined;

  const { searchParams } = new URL(request.url);
  // Driver-facing status values: pending (awaiting pickup), on_the_way
  // (driver has the order), delivered, cancelled (failed/abandoned).
  const status = searchParams.get("status");
  const limit = parseInt(searchParams.get("limit") || "50");

  try {
    // Build query based on status filter
    let statusFilter = "";
    const params: any[] = [];

    if (status) {
      statusFilter = "AND o.status = $1";
      params.push(status);
    }

    // Per-driver scoping: include unassigned (driver_id IS NULL) so
    // drivers can pick up work, plus their own assigned orders.
    const scopeFilter = driverId
      ? "AND (o.driver_id = $X OR o.driver_id IS NULL)"
      : "AND o.driver_id IS NULL";
    const scopeParamIdx = params.length + 1;
    const finalScope = scopeFilter.replace("$X", `$${scopeParamIdx}`);
    if (driverId) params.push(driverId);

    // Get orders assigned to this driver or pending assignment
    const query = `
      SELECT
        o.id,
        o.tracking_code as order_number,
        o.status,
        o.driver_id,
        o.total::float as total,
        o.delivery_fee::float as delivery_fee,
        o.payment_method,
        o.payment_status,
        o.created_at,
        o.notes as order_notes,
        u.id as user_id,
        u.name as customer_name,
        u.phone as customer_phone,
        da.address_text,
        da.lat as delivery_lat,
        da.lng as delivery_lng,
        da.label as address_label,
        (
          SELECT json_agg(json_build_object(
            'id', oi.id,
            'name', p.name_ar,
            'quantity', oi.qty,
            'price', oi.unit_price::float
          ))
          FROM order_items oi
          JOIN products_unified p ON oi.product_id = p.id
          WHERE oi.order_id = o.id
        ) as items,
        (
          SELECT COUNT(*)::int
          FROM orders
          WHERE user_id = o.user_id AND status = 'delivered'
        ) as customer_order_count
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN addresses da ON o.address_id = da.id
      WHERE o.status IN ('pending', 'on_the_way', 'delivered', 'cancelled')
        ${statusFilter}
        ${finalScope}
      ORDER BY
        CASE o.status
          WHEN 'on_the_way' THEN 1
          WHEN 'pending' THEN 2
          ELSE 3
        END,
        o.created_at ASC
      LIMIT $${params.length + 1}
    `;

    params.push(limit);

    const result = await pool.query(query, params);

    // Get counts by status (scoped to this driver too).
    const countsResult = await pool.query(
      driverId
        ? `SELECT status, COUNT(*)::int as count
             FROM orders
             WHERE status IN ('pending','on_the_way','delivered','cancelled')
               AND (driver_id = $1 OR driver_id IS NULL)
             GROUP BY status`
        : `SELECT status, COUNT(*)::int as count
             FROM orders
             WHERE status IN ('pending','on_the_way','delivered','cancelled')
               AND driver_id IS NULL
             GROUP BY status`,
      driverId ? [driverId] : [],
    );

    const counts: Record<string, number> = {
      pending: 0,
      on_the_way: 0,
      delivered: 0,
      cancelled: 0,
    };

    countsResult.rows.forEach((row) => {
      counts[row.status] = row.count;
    });

    return NextResponse.json({
      success: true,
      orders: result.rows,
      counts,
    });
  } catch (error) {
    logError("Driver orders error:", error);
    return NextResponse.json(
      { success: false, error: "حدث خطأ في جلب الطلبات" },
      { status: 500 }
    );
  }
}
