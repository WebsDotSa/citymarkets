import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { error as logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Phase 2 / P3b — driver-scoped earnings aggregation.
//
// What this surfaces:
//   - counts/sums of delivered orders in the chosen window
//   - delivery_fee collected (the per-order fee that's earmarked as the
//     driver's compensation in this marketplace model)
//   - cash vs electronic split (uses the same `payment_method NOT IN
//     ('cash','wallet','')` rule as /api/admin/analytics)
//   - per-day series for the chart
//
// RBAC + scoping mirrors /api/admin/driver/orders (Phase 2 / P3a).
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "view_delivery_orders");
  if (gate instanceof NextResponse) return gate;

  const driverRow = await pool.query(
    `SELECT id FROM drivers WHERE admin_user_id = $1`,
    [gate.admin.id],
  );
  const driverId = driverRow.rows[0]?.id as string | undefined;

  if (!driverId) {
    return NextResponse.json(
      {
        success: false,
        error: "حساب السائق غير مربوط بسجل التوصيل — يرجى مراجعة الإدارة",
      },
      { status: 412 },
    );
  }

  const { searchParams } = new URL(request.url);
  const periodParam = Number(searchParams.get("period"));
  // Allow-list: 7d / 30d / 90d. Anything else falls back to 30.
  const periodDays: 7 | 30 | 90 =
    periodParam === 7 || periodParam === 30 || periodParam === 90
      ? (periodParam as 7 | 30 | 90)
      : 30;

  try {
    // Two-query approach: one CTE for totals, one for the daily series.
    // Cleaner than a single query with FILTER + LATERAL gymnastics, and
    // still O(rows-in-window).
    const totalsRes = await pool.query(
      `WITH base AS (
        SELECT
          o.total,
          o.delivery_fee,
          o.payment_method,
          o.status
        FROM orders o
        WHERE o.driver_id = $1
          AND COALESCE(
            (SELECT MAX(l.created_at) FROM order_status_logs l
              WHERE l.order_id = o.id AND l.new_status = 'delivered'),
            o.updated_at,
            o.created_at
          ) >= NOW() - make_interval(days => $2::int)
      )
      SELECT
        COUNT(*) FILTER (WHERE status = 'delivered')::int                                            AS deliveries,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int                                            AS cancellations,
        COUNT(*)::int                                                                                 AS handled_total,
        COALESCE(SUM(total) FILTER (WHERE status = 'delivered'), 0)::float                           AS gross_revenue,
        COALESCE(SUM(delivery_fee) FILTER (WHERE status = 'delivered'), 0)::float                   AS delivery_fees,
        COALESCE(SUM(total) FILTER (
          WHERE status = 'delivered'
            AND COALESCE(LOWER(TRIM(payment_method)), '') IN ('cash','wallet')
        ), 0)::float                                                                                  AS cod_amount,
        COUNT(*) FILTER (
          WHERE status = 'delivered'
            AND COALESCE(LOWER(TRIM(payment_method)), '') IN ('cash','wallet')
        )::int                                                                                        AS cod_count,
        COALESCE(SUM(total) FILTER (
          WHERE status = 'delivered'
            AND COALESCE(LOWER(TRIM(payment_method)), '') NOT IN ('cash','wallet','')
        ), 0)::float                                                                                  AS online_amount,
        COUNT(*) FILTER (
          WHERE status = 'delivered'
            AND COALESCE(LOWER(TRIM(payment_method)), '') NOT IN ('cash','wallet','')
        )::int                                                                                        AS online_count
      FROM base`,
      [driverId, periodDays],
    );

    const dailyRes = await pool.query(
      `WITH base AS (
        SELECT
          o.total,
          o.status,
          COALESCE(
            (SELECT MAX(l.created_at) FROM order_status_logs l
              WHERE l.order_id = o.id AND l.new_status = 'delivered'),
            o.updated_at,
            o.created_at
          ) AS effective_at
        FROM orders o
        WHERE o.driver_id = $1
          AND COALESCE(
            (SELECT MAX(l.created_at) FROM order_status_logs l
              WHERE l.order_id = o.id AND l.new_status = 'delivered'),
            o.updated_at,
            o.created_at
          ) >= NOW() - make_interval(days => $2::int)
      )
      SELECT DATE(effective_at)                              AS day,
             COUNT(*)::int                                    AS deliveries,
             COALESCE(SUM(total), 0)::float                   AS revenue
      FROM base
      WHERE status = 'delivered'
      GROUP BY DATE(effective_at)
      ORDER BY DATE(effective_at)`,
      [driverId, periodDays],
    );

    const t = totalsRes.rows[0] as {
      deliveries: number;
      cancellations: number;
      handled_total: number;
      gross_revenue: number;
      delivery_fees: number;
      cod_amount: number;
      cod_count: number;
      online_amount: number;
      online_count: number;
    };

    const deliveries = Number(t.deliveries) || 0;
    const cancellations = Number(t.cancellations) || 0;
    const handledTotal = Number(t.handled_total) || 0;
    const grossRevenue = Number(t.gross_revenue) || 0;
    const deliveryFees = Number(t.delivery_fees) || 0;
    const codAmount = Number(t.cod_amount) || 0;
    const codCount = Number(t.cod_count) || 0;
    const onlineAmount = Number(t.online_amount) || 0;
    const onlineCount = Number(t.online_count) || 0;
    const avgOrderValue = deliveries > 0 ? grossRevenue / deliveries : 0;
    const successRate =
      handledTotal > 0 ? (deliveries / handledTotal) * 100 : 0;

    const daily = dailyRes.rows.map((r) => ({
      day:
        r.day instanceof Date
          ? r.day.toISOString().slice(0, 10)
          : String(r.day),
      deliveries: Number(r.deliveries) || 0,
      revenue: Number(r.revenue) || 0,
    }));

    return NextResponse.json({
      success: true,
      period: periodDays,
      totals: {
        deliveries,
        cancellations,
        handled_total: handledTotal,
        gross_revenue: grossRevenue,
        delivery_fees: deliveryFees,
        cod_revenue: codAmount,
        online_revenue: onlineAmount,
        avg_order_value: avgOrderValue,
        success_rate: successRate,
      },
      by_payment_method: {
        cod: { count: codCount, amount: codAmount },
        online: { count: onlineCount, amount: onlineAmount },
      },
      daily,
    });
  } catch (e) {
    logError("Driver earnings fetch error", e, { driverId, periodDays });
    return NextResponse.json(
      { success: false, error: "تعذر جلب الأرباح" },
      { status: 500 }
    );
  }
}
