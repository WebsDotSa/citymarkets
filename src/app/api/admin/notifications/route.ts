import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { notificationsQuerySchema } from "@/lib/validation";

import { error as logError } from "@/lib/logger";
import type { AdminAlert } from "@/lib/admin-types";

type NotificationItem = AdminAlert;

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "view_dashboard");
  if (gate instanceof NextResponse) return gate;

  try {
    const { searchParams } = new URL(request.url);
    const parsedQuery = notificationsQuerySchema.safeParse({
      unread: searchParams.get("unread") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });
    if (!parsedQuery.success) {
      const firstIssue = parsedQuery.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || "معاملات غير صالحة" },
        { status: 400 },
      );
    }
    const unreadOnly = parsedQuery.data.unread === "1";
    const limit = parsedQuery.data.limit;

    const items: NotificationItem[] = [];

    // 1. New orders (last 30 days, status pending or confirmed)
    const ordersRes = await query(
      `SELECT o.id, o.status, o.total::float as total, o.payment_method,
              o.created_at,
              COALESCE(o.guest_name, u.name) as customer_name,
              o.guest_phone, u.phone as user_phone
       FROM orders o
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.created_at >= NOW() - INTERVAL '30 days'
       ORDER BY o.created_at DESC
       LIMIT 30`
    );

    for (const row of ordersRes.rows) {
      const created = new Date(row.created_at);
      const isNew = row.status === "pending" || row.status === "confirmed";
      const ageHours = (Date.now() - created.getTime()) / (1000 * 60 * 60);
      // Only show notifications for orders < 7 days old
      if (ageHours > 24 * 7) continue;

      const name = row.customer_name || "عميل";
      const phone = row.guest_phone || row.user_phone || "";

      items.push({
        id: `order-${row.id}`,
        type: "new_order",
        title: isNew
          ? `طلب جديد ${row.status === "pending" ? "بانتظار التأكيد" : "بانتظار التجهيز"}`
          : `تحديث طلب #${String(row.id).slice(0, 8)}`,
        message: `${name} ${phone ? `(${phone}) — ` : ""}الإجمالي ${Number(row.total).toFixed(2)} ر.س · ${row.payment_method || "—"}`,
        link: `/admin/orders/${row.id}`,
        severity: isNew ? "info" : "success",
        created_at: row.created_at,
        is_read: !isNew,
        meta: { orderId: row.id, status: row.status },
      });
    }

    // 2. Low stock alerts (qty <= 5 and > 0)
    const lowStockRes = await query(
      `SELECT id, name_ar, stock_qty, image_url, category_id
       FROM products_unified
       WHERE is_active = true
         AND stock_qty IS NOT NULL
         AND stock_qty > 0
         AND stock_qty <= 5
       ORDER BY stock_qty ASC
       LIMIT 20`
    );

    for (const row of lowStockRes.rows) {
      items.push({
        id: `lowstock-${row.id}`,
        type: "low_stock",
        title: `مخزون منخفض: ${row.name_ar}`,
        message: `تبقى ${row.stock_qty} وحدة فقط في المخزون.`,
        link: `/admin/inventory`,
        severity: "warning",
        created_at: new Date().toISOString(),
        is_read: false,
        meta: { productId: row.id, stock: row.stock_qty },
      });
    }

    // 3. Out of stock (qty = 0)
    const outStockRes = await query(
      `SELECT id, name_ar, stock_qty
       FROM products_unified
       WHERE is_active = true
         AND COALESCE(stock_qty, 0) = 0
       ORDER BY name_ar ASC
       LIMIT 20`
    );

    for (const row of outStockRes.rows) {
      items.push({
        id: `outstock-${row.id}`,
        type: "out_of_stock",
        title: `نفد المخزون: ${row.name_ar}`,
        message: `المنتج غير متاح حالياً للعملاء.`,
        link: `/admin/inventory`,
        severity: "critical",
        created_at: new Date().toISOString(),
        is_read: false,
        meta: { productId: row.id },
      });
    }

    // Sort by created_at desc
    items.sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return tb - ta;
    });

    const filtered = unreadOnly
      ? items.filter((i) => !i.is_read)
      : items;
    const stats = {
      total: items.length,
      unread: items.filter((i) => !i.is_read).length,
      newOrders: items.filter((i) => i.type === "new_order").length,
      lowStock: items.filter((i) => i.type === "low_stock").length,
      outOfStock: items.filter((i) => i.type === "out_of_stock").length,
    };

    return NextResponse.json({
      success: true,
      data: filtered.slice(0, limit),
      stats,
    });
  } catch (error) {
    logError("Notifications API error:", error);
    return NextResponse.json(
      { success: false, error: "فشل جلب الإشعارات" },
      { status: 500 }
    );
  }
}

// Mark as read
export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, "view_dashboard");
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await request.json();
    const { id, markAll } = body as { id?: string; markAll?: boolean };

    // Read-state is currently per-session (computed). Provide a no-op
    // success so the client can update locally. Future: persist a
    // `notifications_read` table keyed by admin_id.
    return NextResponse.json({ success: true, id: id ?? "all", markAll: !!markAll });
  } catch (error) {
    logError("Notifications mark-read error:", error);
    return NextResponse.json({ success: false, error: "فشل" }, { status: 500 });
  }
}
