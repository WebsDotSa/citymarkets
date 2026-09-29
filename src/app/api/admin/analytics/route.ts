import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from '@/lib/identity';
import { error as logError } from "@/lib/logger";
import {
  normalizePeriod,
  getOverviewKpis,
  getOrdersByDay,
  getVisitorsByDay,
  getTopProducts,
  getTopPages,
  getTopCountries,
  getOrdersBreakdown,
  getVendorLeaderboard,
} from "@/lib/analytics-queries";

/**
 * GET /api/admin/analytics?period=7d|30d|90d
 *
 * Returns a single payload that drives the four-tab analytics dashboard:
 *   - overview: KPI cards + order/visitor daily series
 *   - visitors: top pages + top countries
 *   - orders:   by-status + by-payment breakdown
 *   - products: top products
 *   - vendors:  leaderboard (mini, used by the dedicated /admin/vendors/analytics page)
 *
 * All SQL is bound — `periodDays` is integer-validated by the allow-list
 * AND by `make_interval(days => $1::int)` rejecting non-integers at the
 * SQL type layer.
 */
export async function GET(request: NextRequest) {
  try {
    const gate = await requireAdminApi(request, "view_analytics");
    if (gate instanceof NextResponse) return gate;

    const { searchParams } = new URL(request.url);
    const periodDays = normalizePeriod(searchParams.get("period") || "30d");

    const [
      overview,
      ordersByDay,
      visitorsByDay,
      topProducts,
      topPages,
      topCountries,
      breakdown,
      vendors,
    ] = await Promise.all([
      getOverviewKpis(periodDays),
      getOrdersByDay(periodDays),
      getVisitorsByDay(periodDays),
      getTopProducts(periodDays, 10),
      getTopPages(periodDays, 12),
      getTopCountries(periodDays, 8),
      getOrdersBreakdown(periodDays),
      getVendorLeaderboard(periodDays),
    ]);

    // Aggregate status + payment rows into the same shape the UI expects.
    return NextResponse.json({
      success: true,
      period: `${periodDays}d`,
      generatedAt: new Date().toISOString(),
      overview,
      ordersByDay,
      visitorsByDay,
      topPages,
      topCountries,
      topProducts,
      ordersByStatus: breakdown.byStatus,
      paymentBreakdown: breakdown.byPayment,
      vendors,
    });
  } catch (error) {
    logError("Analytics error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}
