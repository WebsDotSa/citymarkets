import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireVendorRole } from "@/lib/identity";
import { verifyVendorRequestWithDb } from "@/lib/identity/vendor-auth-with-db";
import { cache } from "@/lib/cache";

import { error as logError } from "@/lib/logger";

/**
 * Vendor-private category mutation: rename or delete.
 *
 *   PATCH  /api/v1/vendor/categories/[id]  → rename (name_ar/name_en)
 *   DELETE /api/v1/vendor/categories/[id]  → remove (owner only)
 *
 * Security model:
 *   - Only PRIVATE categories (`vendor_id = current vendor`) can be
 *     mutated. The route reads the row first and rejects with 404 if
 *     it doesn't belong to the current vendor — returning 404 (not
 *     403) prevents vendors from probing for other vendors' category
 *     IDs.
 *   - PATCH is manager+; DELETE is owner-only (mirrors the
 *     `vendor/products/[id]` route). A vendor who accidentally deletes
 *     a category would orphan every product pointing at it — the FK
 *     sets `category_id = NULL` so products stay visible, but it's
 *     still a recoverable mistake we don't want at staff level.
 *
 * Slug immutability: the route never touches `slug`. A vendor's
 * category slug is set at creation and is stable for the lifetime of
 * the row — the storefront's chip strip and any future deep-links
 * rely on that.
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
    const forbidden = requireVendorRole(session, "manager");
    if (forbidden) return forbidden;

    const { id } = await params;
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { success: false, error: "بيانات غير صالحة" },
        { status: 400 },
      );
    }

    const nameAr =
      typeof body.nameAr === "string" || typeof body.name_ar === "string"
        ? String(body.nameAr ?? body.name_ar).trim()
        : null;
    const nameEnRaw =
      typeof body.nameEn === "string" || typeof body.name_en === "string"
        ? String(body.nameEn ?? body.name_en).trim()
        : undefined;

    if (nameAr !== null && !nameAr) {
      return NextResponse.json(
        { success: false, error: "اسم القسم بالعربية مطلوب" },
        { status: 400 },
      );
    }

    // Ownership check: a vendor can only mutate their own private
    // categories. 404 (not 403) on mismatch so a vendor can't probe
    // for foreign category IDs.
    const own = await query(
      `SELECT id FROM categories WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [id, session.vendorId],
    );
    if (own.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "القسم غير موجود" },
        { status: 404 },
      );
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    if (nameAr !== null) {
      updates.push(`name_ar = $${p++}`);
      values.push(nameAr);
    }
    if (nameEnRaw !== undefined) {
      updates.push(`name_en = $${p++}`);
      values.push(nameEnRaw || null);
    }
    if (updates.length === 0) {
      return NextResponse.json(
        { success: false, error: "لا توجد بيانات للتحديث" },
        { status: 400 },
      );
    }

    values.push(id);
    await query(
      `UPDATE categories SET ${updates.join(", ")} WHERE id = $${p}`,
      values,
    );

    cache.invalidatePattern(
      `vendor-storefront:${session.vendorSlug}:categories:`,
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("PATCH vendor category error:", error);
    return NextResponse.json(
      { success: false, error: "فشل تحديث القسم" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
    const forbidden = requireVendorRole(session, "owner");
    if (forbidden) return forbidden;

    const { id } = await params;

    const own = await query(
      `SELECT id FROM categories WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [id, session.vendorId],
    );
    if (own.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "القسم غير موجود" },
        { status: 404 },
      );
    }

    // The vendor_products FK is ON DELETE SET NULL — products stay
    // visible on the storefront, just without a category chip.
    await query(`DELETE FROM categories WHERE id = $1`, [id]);

    cache.invalidatePattern(
      `vendor-storefront:${session.vendorSlug}:categories:`,
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("DELETE vendor category error:", error);
    return NextResponse.json(
      { success: false, error: "فشل حذف القسم" },
      { status: 500 },
    );
  }
}
