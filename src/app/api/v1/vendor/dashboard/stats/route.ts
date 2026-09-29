import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { verifyVendorRequestWithDb } from '@/lib/identity';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export async function GET(request: Request) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "today"; // today, week, month, custom
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    let dateFilter = "";
    const values: any[] = [session.vendorId];

    if (period === "today") {
      dateFilter = "AND DATE(created_at) = CURRENT_DATE";
    } else if (period === "week") {
      dateFilter = "AND created_at >= NOW() - INTERVAL '7 days'";
    } else if (period === "month") {
      dateFilter = "AND created_at >= NOW() - INTERVAL '30 days'";
    } else if (period === "custom" && startDate && endDate) {
      dateFilter = "AND created_at >= $2 AND created_at <= $3";
      values.push(startDate, endDate);
    }

    // Get stats
    const statsResult = await query(
      `SELECT 
        COUNT(*) FILTER (WHERE ${period === "today" ? "DATE(created_at) = CURRENT_DATE" : period === "week" ? "created_at >= NOW() - INTERVAL '7 days'" : period === "month" ? "created_at >= NOW() - INTERVAL '30 days'" : "1=1"}) as orders_count,
        SUM(total) FILTER (WHERE ${period === "today" ? "DATE(created_at) = CURRENT_DATE" : period === "week" ? "created_at >= NOW() - INTERVAL '7 days'" : period === "month" ? "created_at >= NOW() - INTERVAL '30 days'" : "1=1"}) as revenue,
        COUNT(*) FILTER (WHERE status = 'delivered' AND ${period === "today" ? "DATE(created_at) = CURRENT_DATE" : period === "week" ? "created_at >= NOW() - INTERVAL '7 days'" : period === "month" ? "created_at >= NOW() - INTERVAL '30 days'" : "1=1"}) as completed_orders,
        COUNT(*) FILTER (WHERE status = 'cancelled' AND ${period === "today" ? "DATE(created_at) = CURRENT_DATE" : period === "week" ? "created_at >= NOW() - INTERVAL '7 days'" : period === "month" ? "created_at >= NOW() - INTERVAL '30 days'" : "1=1"}) as cancelled_orders,
        COUNT(DISTINCT customer_phone) FILTER (WHERE ${period === "today" ? "DATE(created_at) = CURRENT_DATE" : period === "week" ? "created_at >= NOW() - INTERVAL '7 days'" : period === "month" ? "created_at >= NOW() - INTERVAL '30 days'" : "1=1"}) as unique_customers
       FROM vendor_orders
       WHERE vendor_id = $1`,
      [session.vendorId]
    );

    // Get today's stats
    const todayResult = await query(
      `SELECT 
        COUNT(*) as orders_today,
        COALESCE(SUM(total), 0) as revenue_today,
        COALESCE(AVG(total), 0) as avg_order_value
       FROM vendor_orders
       WHERE vendor_id = $1 AND DATE(created_at) = CURRENT_DATE`,
      [session.vendorId]
    );

    // Get products count
    const productsResult = await query(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_active = TRUE) as active,
        COUNT(*) FILTER (WHERE track_stock = TRUE AND stock_quantity <= 5) as low_stock
       FROM vendor_products
       WHERE vendor_id = $1`,
      [session.vendorId]
    );

    // Get pending orders count
    const pendingResult = await query(
      `SELECT COUNT(*) as pending
       FROM vendor_orders
       WHERE vendor_id = $1 AND status = 'pending'`,
      [session.vendorId]
    );

    // Get last 14 days revenue for chart
    const chartResult = await query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as orders,
        COALESCE(SUM(total), 0) as revenue
       FROM vendor_orders
       WHERE vendor_id = $1 AND created_at >= NOW() - INTERVAL '14 days'
       GROUP BY DATE(created_at)
       ORDER BY date`,
      [session.vendorId]
    );

    const stats = statsResult.rows[0];
    const today = todayResult.rows[0];
    const products = productsResult.rows[0];

    return NextResponse.json({
      stats: {
        period: {
          ordersCount: parseInt(stats.orders_count) || 0,
          revenue: parseFloat(stats.revenue) || 0,
          completedOrders: parseInt(stats.completed_orders) || 0,
          cancelledOrders: parseInt(stats.cancelled_orders) || 0,
          uniqueCustomers: parseInt(stats.unique_customers) || 0,
          avgOrderValue: stats.orders_count > 0 
            ? (parseFloat(stats.revenue) || 0) / parseInt(stats.orders_count) 
            : 0,
        },
        today: {
          ordersCount: parseInt(today.orders_today) || 0,
          revenue: parseFloat(today.revenue_today) || 0,
          avgOrderValue: parseFloat(today.avg_order_value) || 0,
        },
        products: {
          total: parseInt(products.total) || 0,
          active: parseInt(products.active) || 0,
          lowStock: parseInt(products.low_stock) || 0,
        },
        pendingOrders: parseInt(pendingResult.rows[0].pending) || 0,
        chart: chartResult.rows.map((r) => ({
          date: r.date,
          orders: parseInt(r.orders),
          revenue: parseFloat(r.revenue),
        })),
      },
    });
  } catch (error) {
    logError("Dashboard stats error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في جلب الإحصائيات" },
      { status: 500 }
    );
  }
}
