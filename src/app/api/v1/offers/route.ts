// GET /api/v1/offers — list currently active, in-window offers for the
// public storefront. Hidden offers (is_active = FALSE) or expired ones
// are filtered out by SQL. Optional `featured=true` narrows to offers
// flagged for the homepage hero carousel.

import { toNumberOrNull, toNumberOrZero } from "@/lib/format";
import type { OfferRow } from "@/lib/catalog/offers";
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { error as logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const featured = searchParams.get("featured") === "true";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
    const offset = (page - 1) * limit;

    const conditions = [
      "o.is_active = TRUE",
      "NOW() BETWEEN o.starts_at AND o.ends_at",
    ];
    const params: (string | number)[] = [];
    if (featured) conditions.push("o.is_featured = TRUE");

    const whereSQL = `WHERE ${conditions.join(" AND ")}`;

    // product_count: distinct products the offer resolves to via any of
    // its targets. Approximate — uses the LATERAL-style LATERAL-friendly
    // EXISTS check from the view, but evaluated per offer at runtime.
    const listSQL = `
      SELECT o.id, o.title_ar, o.title_en, o.description_ar, o.description_en,
             o.image_url, o.discount_type, o.discount_value,
             o.max_discount, o.min_order,
             o.starts_at, o.ends_at, o.is_active, o.is_featured,
             o.sort_order, o.applies_to,
             (
               SELECT COUNT(DISTINCT p.id)
                 FROM offer_targets ot
                 JOIN products_unified_with_offers p
                   ON ( (ot.target_type = 'product'  AND ot.target_id = p.id)
                     OR (ot.target_type = 'category' AND ot.target_id = p.category_id)
                     OR (ot.target_type = 'vendor'   AND ot.target_id = p.vendor_id)
                     OR (ot.target_type = 'all') )
                WHERE ot.offer_id = o.id
             )::int AS product_count
        FROM offers o
        ${whereSQL}
        ORDER BY o.is_featured DESC, o.sort_order ASC, o.ends_at ASC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const countSQL = `SELECT COUNT(*)::int AS total FROM offers o ${whereSQL}`;

    const [listRes, countRes] = await Promise.all([
      pool.query(listSQL, [...params, limit, offset]),
      pool.query(countSQL, params),
    ]);

    const total = countRes.rows[0]?.total ?? 0;
    const data = listRes.rows.map((row: OfferRow) => ({
      id: row.id,
      title_ar: row.title_ar,
      title_en: row.title_en,
      description_ar: row.description_ar,
      description_en: row.description_en,
      image_url: row.image_url,
      discount_type: row.discount_type,
      discount_value: toNumberOrZero(row.discount_value),
      max_discount: toNumberOrNull(row.max_discount),
      min_order: toNumberOrNull(row.min_order),
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      is_active: row.is_active,
      is_featured: row.is_featured,
      sort_order: row.sort_order,
      applies_to: row.applies_to,
      product_count: toNumberOrZero(row.product_count),
    }));

    return NextResponse.json(
      {
        success: true,
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
          "Content-Signal": "ai-train=no, search=yes, ai-input=yes",
        },
      },
    );
  } catch (error) {
    logError("Error fetching offers:", error);
    return NextResponse.json(
      { success: false, error: "فشل تحميل العروض" },
      { status: 500 },
    );
  }
}
