import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireVendorRole } from "@/lib/identity";
import { verifyVendorRequestWithDb } from "@/lib/identity/vendor-auth-with-db";
import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
  refunded: [],
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const unauthorized = requireVendorRole(session, "staff");
    if (unauthorized) return unauthorized;

    const { id } = await params;
    const { status, notes } = await request.json();

    if (!status) {
      return NextResponse.json({ error: "الحالة مطلوبة" }, { status: 400 });
    }

    // Get current order
    const orderResult = await query(
      "SELECT id, status FROM vendor_orders WHERE id = $1 AND vendor_id = $2",
      [id, session.vendorId]
    );

    if (orderResult.rows.length === 0) {
      return NextResponse.json({ error: "الأوردر غير موجود" }, { status: 404 });
    }

    const order = orderResult.rows[0];

    // Validate transition
    const allowed = VALID_TRANSITIONS[order.status] || [];
    if (!allowed.includes(status)) {
      return NextResponse.json(
        { error: `لا يمكن تغيير الحالة من ${order.status} إلى ${status}` },
        { status: 400 }
      );
    }

    // Build update
    const updates: string[] = ["status = $1", "updated_at = NOW()"];
    const values: any[] = [status];
    let paramIndex = 2;

    if (status === "confirmed") {
      updates.push("confirmed_at = NOW()");
    } else if (status === "preparing") {
      updates.push("prepared_at = NOW()");
    } else if (status === "delivered") {
      updates.push("delivered_at = NOW()");
    } else if (status === "cancelled") {
      updates.push("cancelled_at = NOW()");
      // Restore stock.
      // After migration 054, `vendor_order_items.product_id` is nullable
      // (ON DELETE SET NULL). When the admin deletes a product, historical
      // order rows have product_id=NULL — we must skip them, otherwise
      // the UPDATE silently affects 0 rows and the restock is lost.
      const itemsResult = await query(
        `SELECT product_id, quantity
         FROM vendor_order_items
         WHERE order_id = $1 AND product_id IS NOT NULL`,
        [id]
      );

      for (const item of itemsResult.rows) {
        await query(
          "UPDATE vendor_products SET stock_quantity = stock_quantity + $1 WHERE id = $2 AND track_stock = TRUE",
          [item.quantity, item.product_id]
        );
      }
    }

    if (notes) {
      updates.push(`notes = COALESCE(notes || ' | ', '') || $${paramIndex}`);
      values.push(notes);
      paramIndex++;
    }

    values.push(id, session.vendorId);

    const result = await query(
      `UPDATE vendor_orders 
       SET ${updates.join(", ")}
       WHERE id = $${paramIndex} AND vendor_id = $${paramIndex + 1}
       RETURNING *`,
      values
    );

    const updated = result.rows[0];

    // Update daily stats
    await updateDailyStats(session.vendorId, status, updated.total);

    return NextResponse.json({
      success: true,
      order: {
        id: updated.id,
        orderNumber: updated.order_number,
        status: updated.status,
        updatedAt: updated.updated_at,
      },
    });
  } catch (error) {
    logError("Update order status error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في تحديث حالة الأوردر" },
      { status: 500 }
    );
  }
}

async function updateDailyStats(vendorId: string, status: string, total: number) {
  const today = new Date().toISOString().split("T")[0];

  if (status === "delivered") {
    await query(
      `INSERT INTO vendor_daily_stats (vendor_id, stat_date, orders_completed, revenue_total)
       VALUES ($1, $2, 1, $3)
       ON CONFLICT (vendor_id, stat_date) 
       DO UPDATE SET 
         orders_completed = vendor_daily_stats.orders_completed + 1,
         revenue_total = vendor_daily_stats.revenue_total + $3`,
      [vendorId, today, total]
    );
  } else if (status === "cancelled") {
    await query(
      `INSERT INTO vendor_daily_stats (vendor_id, stat_date, orders_cancelled)
       VALUES ($1, $2, 1)
       ON CONFLICT (vendor_id, stat_date) 
       DO UPDATE SET orders_cancelled = vendor_daily_stats.orders_cancelled + 1`,
      [vendorId, today]
    );
  }
}
