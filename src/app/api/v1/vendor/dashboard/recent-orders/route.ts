import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { verifyVendorRequestWithDb } from "@/lib/vendor-auth";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export async function GET(request: Request) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "10");
    const status = searchParams.get("status");

    let whereClause = "WHERE vo.vendor_id = $1";
    const values: any[] = [session.vendorId];

    if (status) {
      whereClause += " AND vo.status = $2";
      values.push(status);
    }

    const result = await query(
      `SELECT 
        vo.id, vo.order_number, vo.status, vo.payment_status, vo.payment_method,
        vo.customer_name, vo.customer_phone, vo.total, vo.created_at,
        COUNT(voi.id) as items_count
       FROM vendor_orders vo
       LEFT JOIN vendor_order_items voi ON vo.id = voi.order_id
       ${whereClause}
       GROUP BY vo.id
       ORDER BY vo.created_at DESC
       LIMIT $${values.length + 1}`,
      [...values, limit]
    );

    const orders = result.rows.map((o) => ({
      id: o.id,
      orderNumber: o.order_number,
      status: o.status,
      paymentStatus: o.payment_status,
      paymentMethod: o.payment_method,
      customerName: o.customer_name,
      customerPhone: o.customer_phone,
      total: parseFloat(o.total),
      itemsCount: parseInt(o.items_count),
      createdAt: o.created_at,
    }));

    return NextResponse.json({ orders });
  } catch (error) {
    logError("Recent orders error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في جلب الأوردرات" },
      { status: 500 }
    );
  }
}
