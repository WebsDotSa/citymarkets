import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { verifyVendorRequestWithDb } from "@/lib/identity/vendor-auth-with-db";
import { error as logError } from '@/lib/logger';
import { ALL_VENDOR_ORDER_STATES } from "@/lib/orders/state-machine";
import { parsePagination } from "@/lib/api/pagination";

export async function GET(request: Request) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const { limit, page, offset } = parsePagination(searchParams, { defaultLimit: 20 });
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    let whereClause = "WHERE vo.vendor_id = $1";
    const values: any[] = [session.vendorId];
    let paramIndex = 2;

    if (status) {
      whereClause += ` AND vo.status = $${paramIndex}`;
      values.push(status);
      paramIndex++;
    }

    if (search) {
      whereClause += ` AND (vo.order_number ILIKE $${paramIndex} OR vo.customer_name ILIKE $${paramIndex} OR vo.customer_phone ILIKE $${paramIndex})`;
      values.push(`%${search}%`);
      paramIndex++;
    }

    if (startDate) {
      whereClause += ` AND vo.created_at >= $${paramIndex}`;
      values.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereClause += ` AND vo.created_at <= $${paramIndex}`;
      values.push(endDate + " 23:59:59");
      paramIndex++;
    }

    const result = await query(
      `SELECT 
        vo.id, vo.order_number, vo.status, vo.payment_status, vo.payment_method,
        vo.customer_name, vo.customer_phone, vo.customer_email,
        vo.address_text, vo.subtotal, vo.delivery_fee, vo.total,
        vo.notes, vo.created_at, vo.updated_at,
        COUNT(voi.id) as items_count
       FROM vendor_orders vo
       LEFT JOIN vendor_order_items voi ON vo.id = voi.order_id
       ${whereClause}
       GROUP BY vo.id
       ORDER BY vo.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as total FROM vendor_orders vo ${whereClause}`,
      values
    );

    // Get status counts
    const statusCounts = await query(
      `SELECT status, COUNT(*) as count
       FROM vendor_orders
       WHERE vendor_id = $1
       GROUP BY status`,
      [session.vendorId]
    );

    const orders = result.rows.map((o) => ({
      id: o.id,
      orderNumber: o.order_number,
      status: o.status,
      paymentStatus: o.payment_status,
      paymentMethod: o.payment_method,
      customerName: o.customer_name,
      customerPhone: o.customer_phone,
      customerEmail: o.customer_email,
      address: o.address_text,
      subtotal: parseFloat(o.subtotal),
      deliveryFee: parseFloat(o.delivery_fee),
      total: parseFloat(o.total),
      notes: o.notes,
      itemsCount: parseInt(o.items_count),
      createdAt: o.created_at,
      updatedAt: o.updated_at,
    }));

    const statusMap: Record<string, number> = {};
    statusCounts.rows.forEach((s) => {
      statusMap[s.status] = parseInt(s.count);
    });

    return NextResponse.json({
      orders,
      pagination: {
        page,
        limit,
        total: parseInt(countResult.rows[0].total),
        totalPages: Math.ceil(parseInt(countResult.rows[0].total) / limit),
      },
      // Derived from `ALL_VENDOR_ORDER_STATES` (audit C15) so adding a new
      // vendor-status key only requires editing the state machine.
      statusCounts: Object.fromEntries(
        ALL_VENDOR_ORDER_STATES.map((s) => [s, statusMap[s] || 0]),
      ),
    });
  } catch (error) {
    logError("Vendor orders error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في جلب الأوردرات" },
      { status: 500 }
    );
  }
}
