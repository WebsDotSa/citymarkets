import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { verifyVendorRequest } from '@/lib/identity';

import { error as logError } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    // Verify vendor authentication
    const authResult = await verifyVendorRequest(request);
    if (!authResult) {
      return NextResponse.json(
        { error: "غير مصرح بالوصول" },
        { status: 401 }
      );
    }

    const vendorId = authResult.vendorId;

    // Get vendor info
    const vendorResult = await query(
      "SELECT id, name_ar, name_en, slug, vendor_type, logo_url, banner_url FROM vendors WHERE id = $1",
      [vendorId]
    );

    if (vendorResult.rows.length === 0) {
      return NextResponse.json(
        { error: "المتجر غير موجود" },
        { status: 404 }
      );
    }

    const vendor = vendorResult.rows[0];

    // Fan out the six independent stat queries in parallel — saves 5 round-trips
    // vs. the previous sequential waterfall.
    const [
      productsCount,
      activeProductsCount,
      ordersCount,
      pendingOrdersCount,
      todayOrders,
      totalRevenue,
      recentOrders,
      lowStockProducts,
    ] = await Promise.all([
      query(
        "SELECT COUNT(*) as count FROM vendor_products WHERE vendor_id = $1",
        [vendorId]
      ),
      query(
        "SELECT COUNT(*) as count FROM vendor_products WHERE vendor_id = $1 AND is_active = true",
        [vendorId]
      ),
      query(
        "SELECT COUNT(*) as count FROM vendor_orders WHERE vendor_id = $1",
        [vendorId]
      ),
      query(
        "SELECT COUNT(*) as count FROM vendor_orders WHERE vendor_id = $1 AND status = 'pending'",
        [vendorId]
      ),
      query(
        `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
         FROM vendor_orders
         WHERE vendor_id = $1 AND DATE(created_at) = CURRENT_DATE`,
        [vendorId]
      ),
      query(
        `SELECT COALESCE(SUM(total), 0) as total
         FROM vendor_orders
         WHERE vendor_id = $1 AND status != 'cancelled'`,
        [vendorId]
      ),
      query(
        `SELECT id, order_number, customer_name, total, status, created_at
         FROM vendor_orders
         WHERE vendor_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [vendorId]
      ),
      query(
        `SELECT id, name_ar, name_en, stock_quantity, price
         FROM vendor_products
         WHERE vendor_id = $1 AND stock_quantity <= 10 AND stock_quantity > 0
         ORDER BY stock_quantity ASC
         LIMIT 5`,
        [vendorId]
      ),
    ]);

    return NextResponse.json({
      vendor: {
        id: vendor.id,
        name: vendor.name_ar || vendor.name_en,
        slug: vendor.slug,
        type: vendor.vendor_type,
        logo: vendor.logo_url,
        banner: vendor.banner_url,
      },
      stats: {
        products: {
          total: parseInt(productsCount.rows[0].count),
          active: parseInt(activeProductsCount.rows[0].count),
        },
        orders: {
          total: parseInt(ordersCount.rows[0].count),
          pending: parseInt(pendingOrdersCount.rows[0].count),
          today: parseInt(todayOrders.rows[0].count),
          todayRevenue: parseFloat(todayOrders.rows[0].total),
        },
        revenue: {
          total: parseFloat(totalRevenue.rows[0].total),
        },
      },
      recentOrders: recentOrders.rows,
      lowStockProducts: lowStockProducts.rows,
    });
  } catch (error) {
    logError("Dashboard error:", error);
    return NextResponse.json(
      { error: "حدث خطأ أثناء تحميل لوحة التحكم" },
      { status: 500 }
    );
  }
}
