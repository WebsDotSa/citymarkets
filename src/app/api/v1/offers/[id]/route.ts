// GET /api/v1/offers/[id] — single active offer detail. Includes the
// raw targets (so the storefront /offers/[id] page can render the
// scope description) and a product_count.

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { error as logError } from "@/lib/logger";

import { validateUuidOrError } from "@/lib/api/uuid-guard";
export const dynamic = "force-dynamic";

interface OfferRow {
  id: string;
  title_ar: string;
  title_en: string | null;
  description_ar: string | null;
  description_en: string | null;
  image_url: string;
  discount_type: "percentage" | "fixed";
  discount_value: string | number;
  max_discount: string | number | null;
  min_order: string | number | null;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  is_featured: boolean;
  sort_order: number;
  applies_to: "catalog" | "vendor" | "mixed";
  product_count: string | number;
}

interface TargetRow {
  id: string;
  target_type: "product" | "category" | "vendor" | "all";
  target_id: string | null;
}

function toNumber(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function toNumberOrZero(v: string | number): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
  const badId = validateUuidOrError(id, "معرّف العرض");
  if (badId) return badId;
    if (!id) {
      return NextResponse.json({ success: false, error: "معرّف العرض مطلوب" }, { status: 400 });
    }

    const offerRes = await pool.query<OfferRow>(
      `SELECT o.id, o.title_ar, o.title_en, o.description_ar, o.description_en,
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
         WHERE o.id = $1
           AND o.is_active = TRUE
           AND NOW() BETWEEN o.starts_at AND o.ends_at
         LIMIT 1`,
      [id],
    );

    if (offerRes.rows.length === 0) {
      return NextResponse.json({ success: false, error: "العرض غير موجود" }, { status: 404 });
    }

    const targetsRes = await pool.query<TargetRow>(
      `SELECT id, target_type, target_id
         FROM offer_targets
        WHERE offer_id = $1
        ORDER BY target_type, target_id`,
      [id],
    );

    const row = offerRes.rows[0];
    return NextResponse.json(
      {
        success: true,
        data: {
          id: row.id,
          title_ar: row.title_ar,
          title_en: row.title_en,
          description_ar: row.description_ar,
          description_en: row.description_en,
          image_url: row.image_url,
          discount_type: row.discount_type,
          discount_value: toNumberOrZero(row.discount_value),
          max_discount: toNumber(row.max_discount),
          min_order: toNumber(row.min_order),
          starts_at: row.starts_at,
          ends_at: row.ends_at,
          is_active: row.is_active,
          is_featured: row.is_featured,
          sort_order: row.sort_order,
          applies_to: row.applies_to,
          product_count: toNumberOrZero(row.product_count),
          targets: targetsRes.rows.map((t) => ({
            id: String(t.id),
            offer_id: id,
            target_type: t.target_type,
            target_id: t.target_id,
          })),
        },
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
        },
      },
    );
  } catch (error) {
    logError("Error fetching offer detail:", error);
    return NextResponse.json(
      { success: false, error: "فشل تحميل العرض" },
      { status: 500 },
    );
  }
}
