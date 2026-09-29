import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdminApi } from '@/lib/identity';
import { getInventorySettings, setAppSetting } from "@/lib/app-settings";
import { inventorySettingsSchema } from "@/lib/validation";
import { logAdminAction } from "@/lib/admin-audit";

import { error as logError } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_products");
  if (gate instanceof NextResponse) return gate;

  try {
    const settings = await getInventorySettings();
    const threshold = settings.low_stock_threshold;

    const lowStock = await query(
      `SELECT p.id, p.name_ar, p.image_url, p.stock_qty, p.price::float as price,
              p.is_active, c.name_ar as category_name
       FROM products_unified p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.is_active = true
         AND p.stock_qty IS NOT NULL
         AND p.stock_qty > 0
         AND p.stock_qty <= $1
       ORDER BY p.stock_qty ASC, p.name_ar ASC`,
      [threshold]
    );

    const outOfStock = await query(
      `SELECT p.id, p.name_ar, p.image_url, p.stock_qty, p.price::float as price,
              c.name_ar as category_name
       FROM products_unified p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.is_active = true AND COALESCE(p.stock_qty, 0) = 0
       ORDER BY p.name_ar ASC
       LIMIT 100`
    );

    const lowStockCountRes = await query(
      `SELECT COUNT(*)
       FROM products_unified p
       WHERE p.is_active = true
         AND p.stock_qty IS NOT NULL
         AND p.stock_qty > 0
         AND p.stock_qty <= $1`,
      [threshold]
    );

    const outOfStockCountRes = await query(
      `SELECT COUNT(*)
       FROM products_unified p
       WHERE p.is_active = true AND COALESCE(p.stock_qty, 0) = 0`
    );

    return NextResponse.json({
      success: true,
      threshold,
      lowStock: lowStock.rows,
      outOfStock: outOfStock.rows,
      lowStockCount: parseInt(lowStockCountRes.rows[0].count, 10),
      outOfStockCount: parseInt(outOfStockCountRes.rows[0].count, 10),
    });
  } catch (error) {
    logError("inventory GET:", error);
    return NextResponse.json({ success: false, error: "فشل الجلب" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_products");
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await request.json();
    const parsed = inventorySettingsSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || "عتبة المخزون غير صالحة" },
        { status: 400 },
      );
    }
    const threshold = parsed.data.low_stock_threshold;
    await setAppSetting("inventory", { low_stock_threshold: threshold });
    await logAdminAction(gate.admin, "inventory.threshold_update", {
      entityType: "settings",
      entityId: "inventory",
      details: { low_stock_threshold: threshold },
      request,
    });
    return NextResponse.json({ success: true, low_stock_threshold: threshold });
  } catch (error) {
    logError("inventory PUT:", error);
    return NextResponse.json({ success: false, error: "فشل الحفظ" }, { status: 500 });
  }
}
