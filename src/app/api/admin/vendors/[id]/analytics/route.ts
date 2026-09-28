import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-api-auth";
import { error as logError } from "@/lib/logger";
import {
  normalizePeriod,
  getVendorSummary,
  getVendorDailyStats,
  getVendorTopProducts,
} from "@/lib/analytics-queries";
import { query } from "@/lib/db";

/**
 * GET /api/admin/vendors/:id/analytics?period=7d|30d|90d
 *
 * Returns the detail view for a single vendor:
 *   - vendor: name/slug/type/meta
 *   - summary: orders / revenue / AOV / unique customers / cancelled
 *   - daily:  revenue + orders per day
 *   - topProducts: best-selling products from this vendor
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requireAdminApi(request, "view_analytics");
    if (gate instanceof NextResponse) return gate;

    const { id: vendorId } = await params;
    // Cheap UUID guard so we don't waste a DB roundtrip on garbage.
    if (!/^[0-9a-f-]{32,36}$/i.test(vendorId)) {
      return NextResponse.json({ success: false, error: "Invalid vendor id" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const periodDays = normalizePeriod(searchParams.get("period") || "30d");

    const [vendorRes, summary, daily, topProducts] = await Promise.all([
      query(
        `SELECT id, slug, name_ar, name_en, vendor_type, category_slug,
                is_active, is_featured, logo_url, primary_color
           FROM vendors
          WHERE id = $1::uuid`,
        [vendorId]
      ),
      getVendorSummary(vendorId, periodDays),
      getVendorDailyStats(vendorId, periodDays),
      getVendorTopProducts(vendorId, periodDays, 10),
    ]);

    if (vendorRes.rows.length === 0) {
      return NextResponse.json({ success: false, error: "Vendor not found" }, { status: 404 });
    }

    const v = vendorRes.rows[0] as Record<string, string | boolean | null>;

    return NextResponse.json({
      success: true,
      period: `${periodDays}d`,
      generatedAt: new Date().toISOString(),
      vendor: {
        id: v.id,
        slug: v.slug,
        name: v.name_ar,
        nameEn: v.name_en,
        vendorType: v.vendor_type,
        categorySlug: v.category_slug,
        isActive: v.is_active,
        isFeatured: v.is_featured,
        logoUrl: v.logo_url,
        primaryColor: v.primary_color,
      },
      summary,
      daily,
      topProducts,
    });
  } catch (error) {
    logError("Vendor analytics error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch vendor analytics" },
      { status: 500 }
    );
  }
}
