// Admin single offer endpoint — GET / PUT / DELETE for the [id] route.
// Mirrors the categories/[id] shape: PUT replaces targets inside the
// same transaction so the offer row and its scope rows stay in sync.

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { offerInputSchema } from "@/lib/validation";
import { cache } from "@/lib/cache";
import { error as logError } from "@/lib/logger";

// Module-scoped UUID validator. P2-9 (PCP-101 audit): we used to let
// "bad-uuid" reach Postgres and bubble up as a 22P02 (invalid input
// syntax for type uuid), which the route mapper then surfaced as a
// generic 500 ("فشل جلب العرض"). Pre-validate and return 400 with a
// clear Arabic message instead.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toNumberOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNumberOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminApi(_request, "manage_offers");
  if (gate instanceof NextResponse) return gate;

  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ success: false, error: "المعرّف مطلوب" }, { status: 400 });
    }
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ success: false, error: "معرّف العرض غير صالح" }, { status: 400 });
    }

    const offerRes = await pool.query(
      `SELECT id, title_ar, title_en, description_ar, description_en,
              image_url, discount_type, discount_value::float AS discount_value,
              max_discount::float AS max_discount, min_order::float AS min_order,
              starts_at, ends_at, is_active, is_featured, sort_order,
              applies_to, created_at, updated_at
         FROM offers WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (offerRes.rows.length === 0) {
      return NextResponse.json({ success: false, error: "العرض غير موجود" }, { status: 404 });
    }

    const targetsRes = await pool.query(
      `SELECT id, target_type, target_id FROM offer_targets
        WHERE offer_id = $1 ORDER BY target_type, target_id`,
      [id],
    );

    const row = offerRes.rows[0];
    return NextResponse.json({
      success: true,
      data: {
        ...row,
        discount_value: toNumberOrZero(row.discount_value),
        max_discount: toNumberOrNull(row.max_discount),
        min_order: toNumberOrNull(row.min_order),
        targets: targetsRes.rows.map((t: Record<string, unknown>) => ({
          id: String(t.id),
          offer_id: id,
          target_type: t.target_type,
          target_id: t.target_id,
        })),
      },
    });
  } catch (error) {
    logError("GET offer error:", error);
    return NextResponse.json(
      { success: false, error: "فشل جلب العرض" },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminApi(request, "manage_offers");
  if (gate instanceof NextResponse) return gate;

  const client = await pool.connect();
  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ success: false, error: "المعرّف مطلوب" }, { status: 400 });
    }
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ success: false, error: "معرّف العرض غير صالح" }, { status: 400 });
    }

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
    const updateRes = await client.query(
      `UPDATE offers
          SET title_ar = $1, title_en = $2,
              description_ar = $3, description_en = $4,
              image_url = $5,
              discount_type = $6, discount_value = $7,
              max_discount = $8, min_order = $9,
              starts_at = $10::timestamptz, ends_at = $11::timestamptz,
              is_active = $12, is_featured = $13, sort_order = $14,
              applies_to = $15, updated_by = $16
        WHERE id = $17
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
        (gate as { admin?: { id?: string } }).admin?.id ?? null,
        id,
      ],
    );
    if (updateRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "العرض غير موجود" }, { status: 404 });
    }

    // Replace-all targets atomically.
    await client.query("DELETE FROM offer_targets WHERE offer_id = $1", [id]);
    for (const t of data.targets) {
      await client.query(
        `INSERT INTO offer_targets (offer_id, target_type, target_id)
         VALUES ($1, $2, $3)`,
        [id, t.target_type, t.target_type === "all" ? null : t.target_id ?? null],
      );
    }

    await client.query("COMMIT");
    cache.invalidatePattern("offers:");
    return NextResponse.json({ success: true, data: { id } });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    logError("Update offer error:", error);
    return NextResponse.json(
      { success: false, error: "فشل تحديث العرض" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminApi(request, "manage_offers");
  if (gate instanceof NextResponse) return gate;

  try {
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ success: false, error: "المعرّف مطلوب" }, { status: 400 });
    }
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ success: false, error: "معرّف العرض غير صالح" }, { status: 400 });
    }
    const result = await pool.query("DELETE FROM offers WHERE id = $1 RETURNING id", [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: "العرض غير موجود" }, { status: 404 });
    }
    cache.invalidatePattern("offers:");
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("Delete offer error:", error);
    return NextResponse.json(
      { success: false, error: "فشل حذف العرض" },
      { status: 500 },
    );
  }
}
