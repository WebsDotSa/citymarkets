// Admin CRUD for offers. Mirrors the banners/categories patterns:
//  - requireAdminApi('manage_offers') gates every handler
//  - server paginates list, returns target_summary aggregates
//  - POST/PUT run inside a transaction so the master row and its
//    offer_targets always commit together
//  - PUT replaces targets atomically (delete + insert) so editing
//    a scope never leaves orphan rows
//  - Validation is centralised in offerInputSchema

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { offerInputSchema } from "@/lib/validation";
import { cache } from "@/lib/cache";
import { error as logError } from "@/lib/logger";
import { parsePagination } from "@/lib/api/pagination";

function toNumberOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_offers");
  if (gate instanceof NextResponse) return gate;

  try {
    const { searchParams } = new URL(request.url);
    const { limit, page, offset } = parsePagination(searchParams, { defaultLimit: 50 });
    const search = searchParams.get("search")?.trim();
    const isActive = searchParams.get("is_active");
    const isFeatured = searchParams.get("is_featured");
    const expired = searchParams.get("expired");

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(LOWER(o.title_ar) LIKE LOWER($${params.length}) OR LOWER(COALESCE(o.title_en, '')) LIKE LOWER($${params.length}))`,
      );
    }
    if (isActive === "true") conditions.push("o.is_active = TRUE");
    else if (isActive === "false") conditions.push("o.is_active = FALSE");
    if (isFeatured === "true") conditions.push("o.is_featured = TRUE");
    else if (isFeatured === "false") conditions.push("o.is_featured = FALSE");
    if (expired === "true") conditions.push("o.ends_at < NOW()");
    else if (expired === "false") conditions.push("o.ends_at >= NOW()");

    const whereSQL = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const listSQL = `
      SELECT
        o.id, o.title_ar, o.title_en, o.description_ar, o.description_en,
        o.image_url, o.discount_type, o.discount_value::float AS discount_value,
        o.max_discount::float AS max_discount, o.min_order::float AS min_order,
        o.starts_at, o.ends_at, o.is_active, o.is_featured, o.sort_order,
        o.applies_to, o.created_at, o.updated_at,
        (SELECT COUNT(*) FROM offer_targets ot WHERE ot.offer_id = o.id AND ot.target_type = 'product')::int  AS target_product,
        (SELECT COUNT(*) FROM offer_targets ot WHERE ot.offer_id = o.id AND ot.target_type = 'category')::int AS target_category,
        (SELECT COUNT(*) FROM offer_targets ot WHERE ot.offer_id = o.id AND ot.target_type = 'vendor')::int   AS target_vendor,
        EXISTS(SELECT 1 FROM offer_targets ot WHERE ot.offer_id = o.id AND ot.target_type = 'all') AS target_all
      FROM offers o
      ${whereSQL}
      ORDER BY o.is_featured DESC, o.sort_order ASC, o.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const countSQL = `SELECT COUNT(*)::int AS total FROM offers o ${whereSQL}`;

    const [listRes, countRes] = await Promise.all([
      pool.query(listSQL, [...params, limit, offset]),
      pool.query(countSQL, params),
    ]);

    const total = countRes.rows[0]?.total ?? 0;
    const data = listRes.rows.map((row: Record<string, unknown>) => ({
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
      created_at: row.created_at,
      updated_at: row.updated_at,
      target_summary: {
        product: row.target_product,
        category: row.target_category,
        vendor: row.target_vendor,
        all: row.target_all === true,
      },
    }));

    return NextResponse.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logError("GET offers error:", error);
    return NextResponse.json(
      { success: false, error: "فشل جلب العروض" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_offers");
  if (gate instanceof NextResponse) return gate;

  const client = await pool.connect();
  try {
    const body = await request.json();
    const parsed = offerInputSchema.safeParse({
      ...body,
      discount_value: toNumberOrNull(body.discount_value),
      max_discount: toNumberOrNull(body.max_discount),
      min_order: toNumberOrNull(body.min_order),
    });
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || "بيانات العرض غير صالحة" },
        { status: 400 },
      );
    }
    const data = parsed.data;

    await client.query("BEGIN");
    const offerRes = await client.query(
      `INSERT INTO offers
         (title_ar, title_en, description_ar, description_en, image_url,
          discount_type, discount_value, max_discount, min_order,
          starts_at, ends_at, is_active, is_featured, sort_order, applies_to,
          created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz,
               $12, $13, $14, $15,
               $16, $16)
       RETURNING id`,
      [
        data.title_ar,
        data.title_en ?? null,
        data.description_ar ?? null,
        data.description_en ?? null,
        data.image_url,
        data.discount_type,
        data.discount_value,
        data.max_discount ?? null,
        data.min_order ?? null,
        data.starts_at,
        data.ends_at,
        data.is_active !== false,
        data.is_featured === true,
        data.sort_order ?? 0,
        data.applies_to ?? "mixed",
        // created_by / updated_by — admin id from the gate
        (gate as { admin?: { id?: string } }).admin?.id ?? null,
      ],
    );
    const offerId: string = offerRes.rows[0].id;

    for (const t of data.targets) {
      await client.query(
        `INSERT INTO offer_targets (offer_id, target_type, target_id)
         VALUES ($1, $2, $3)`,
        [offerId, t.target_type, t.target_type === "all" ? null : t.target_id ?? null],
      );
    }

    await client.query("COMMIT");
    cache.invalidatePattern("offers:");

    return NextResponse.json({ success: true, data: { id: offerId } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    logError("Create offer error:", error);
    return NextResponse.json(
      { success: false, error: "فشل إنشاء العرض" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
