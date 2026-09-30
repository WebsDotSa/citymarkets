import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { cache } from "@/lib/cache";

import { error as logError } from "@/lib/logger";

/**
 * Storefront categories for a single vendor.
 *
 *   GET /api/v1/vendors/[slug]/categories
 *
 * Returns the categories actually used by this vendor's active
 * products — both global (`vendor_id IS NULL`) and this vendor's own
 * private categories (`vendor_id = $vid`). Categories from other
 * vendors are filtered out by the WHERE clause.
 *
 * Each entry includes a `productCount` so the storefront chip strip
 * can render "X products" badges without an extra round-trip per
 * chip.
 *
 * Cache: 60s under `vendor-storefront:{slug}:categories:v1`. The
 * vendor-side categories route busts this key when categories are
 * mutated (POST / PATCH / DELETE under `/api/v1/vendor/categories`).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;

    const cacheKey = `vendor-storefront:${slug}:categories:v1`;
    const cached = cache.get<{
      categories: Array<{
        id: string;
        name_ar: string;
        name_en: string | null;
        slug: string;
        icon_url: string | null;
        is_private: boolean;
        product_count: number;
        sort_order: number;
      }>;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json({ success: true, data: cached, cached: true });
    }

    // Resolve slug → vendor_id once. If the vendor doesn't exist or is
    // inactive, return 404 so the storefront renders the "not found"
    // state instead of an empty chip strip that misleads the user.
    const vendor = await query<{ id: string }>(
      `SELECT id FROM vendors WHERE slug = $1 AND is_active = TRUE LIMIT 1`,
      [slug],
    );
    if (vendor.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "المتجر غير موجود" },
        { status: 404 },
      );
    }
    const vendorId = vendor.rows[0].id;

    // Categories that have ≥1 active product for this vendor. The
    // WHERE clause scopes to (global OR this vendor's private) so
    // another vendor's private categories never leak through.
    const result = await query<{
      id: string;
      name_ar: string;
      name_en: string | null;
      slug: string;
      icon_url: string | null;
      vendor_id: string | null;
      sort_order: number;
      product_count: string;
    }>(
      `SELECT c.id, c.name_ar, c.name_en, c.slug, c.icon_url,
              c.vendor_id, c.sort_order,
              COUNT(vp.id)::text AS product_count
         FROM categories c
         JOIN vendor_products vp ON vp.category_id = c.id
        WHERE c.is_active = TRUE
          AND vp.is_active = TRUE
          AND vp.vendor_id = $1
          AND (c.vendor_id IS NULL OR c.vendor_id = $1)
        GROUP BY c.id
        ORDER BY c.sort_order ASC, c.name_ar ASC`,
      [vendorId],
    );

    const payload = {
      categories: result.rows.map((r) => ({
        id: r.id,
        name_ar: r.name_ar,
        name_en: r.name_en,
        slug: r.slug,
        icon_url: r.icon_url,
        is_private: r.vendor_id !== null,
        product_count: parseInt(r.product_count, 10) || 0,
        sort_order: r.sort_order,
      })),
    };
    cache.set(cacheKey, payload, 60_000);
    return NextResponse.json({ success: true, data: payload });
  } catch (error) {
    logError("Storefront vendor categories error:", error);
    return NextResponse.json(
      { success: false, error: "فشل جلب الأقسام" },
      { status: 500 },
    );
  }
}
