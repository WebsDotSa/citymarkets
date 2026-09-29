import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdminApi } from '@/lib/identity';
import { SQL_REVENUE_ELIGIBLE } from '@/lib/orders';
import { fetchInvoiceDetails, isMoyasarConfigured } from "@/lib/payments/moyasar";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "view_payments");
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(request.url);
    const verify = url.searchParams.get("verify") === "1";
    const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 200);

    const result = await query(
      `SELECT o.id, o.status, o.total::float as total, o.payment_method,
              o.payment_reference, o.created_at,
              COALESCE(u.name, o.guest_name) as customer_name,
              COALESCE(u.phone, o.guest_phone) as customer_phone
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.payment_reference IS NOT NULL
         AND COALESCE(LOWER(TRIM(o.payment_method)), '') NOT IN ('cash', 'wallet', '')
       ORDER BY o.created_at DESC
       LIMIT $1`,
      [limit]
    );

    const summary = await query(
      `SELECT
         COUNT(*)::int AS electronic_orders,
         COALESCE(SUM(CASE WHEN ${SQL_REVENUE_ELIGIBLE} THEN o.total ELSE 0 END), 0)::float AS confirmed_paid_revenue
       FROM orders o
       WHERE o.payment_reference IS NOT NULL
         AND COALESCE(LOWER(TRIM(o.payment_method)), '') NOT IN ('cash', 'wallet', '')`
    );

    let rows = result.rows as Record<string, unknown>[];

    if (verify && isMoyasarConfigured()) {
      const verified = await Promise.all(
        rows.slice(0, 30).map(async (row) => {
          const ref = String(row.payment_reference || "");
          if (!ref) return { ...row, moyasar_status: null, moyasar_match: null };
          const inv = await fetchInvoiceDetails(ref);
          const orderTotalHalalas = Math.round(Number(row.total) * 100);
          const amountMatch =
            inv.success &&
            inv.amountHalalas != null &&
            Math.abs(inv.amountHalalas - orderTotalHalalas) <= 1;
          return {
            ...row,
            moyasar_status: inv.status ?? inv.error ?? null,
            moyasar_match: inv.success && inv.status === "paid" && amountMatch ? "ok" : "unknown",
          };
        })
      );
      rows = [...verified, ...rows.slice(30)];
    }

    return NextResponse.json({
      success: true,
      moyasarConfigured: isMoyasarConfigured(),
      summary: summary.rows[0],
      data: rows,
    });
  } catch (error) {
    logError("Admin payments API:", error);
    return NextResponse.json(
      { success: false, error: "فشل جلب تقارير المدفوعات" },
      { status: 500 }
    );
  }
}
