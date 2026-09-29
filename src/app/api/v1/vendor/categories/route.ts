import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireVendorRole } from "@/lib/identity";
import { verifyVendorRequestWithDb } from "@/lib/identity/vendor-auth-with-db";
import { generateSlug } from "@/lib/slug";
import { cache } from "@/lib/cache";

import { error as logError } from "@/lib/logger";

/**
 * Vendor-facing categories CRUD (read + create only).
 *
 * The `categories` table is global — there is no `vendor_id` column
 * and the marketplace does not scope categories per vendor. So the API
 * is intentionally narrow:
 *
 *   GET  /api/v1/vendor/categories  → all active categories (read-only
 *                                     chips for the vendor admin to
 *                                     assign products to).
 *   POST /api/v1/vendor/categories  → manager+ may create a new
 *                                     category (vendor-owned rows still
 *                                     don't exist — the new row is
 *                                     visible to every other vendor
 *                                     and to customers). This matches
 *                                     the operator decision (2026-09-23)
 *                                     to keep the table global.
 *
 * Update / delete are intentionally NOT exposed. Editing or removing a
 * category would silently affect the storefront and other vendors,
 * which we don't want one vendor to do alone.
 */

export async function GET(request: NextRequest) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const cacheKey = "vendor:categories:all:v1";
    const cached = cache.get<unknown[]>(cacheKey);
    if (cached) {
      return NextResponse.json({ success: true, data: cached });
    }

    const result = await query(
      `SELECT id, name_ar, name_en, slug, parent_id, sort_order, is_active
         FROM categories
        WHERE is_active = TRUE
        ORDER BY sort_order ASC, name_ar ASC`,
    );
    cache.set(cacheKey, result.rows, 60_000); // 60s TTL — short to react to admin edits
    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    logError("GET vendor categories error:", error);
    return NextResponse.json(
      { success: false, error: "فشل جلب الأقسام" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    // Only managers and above can create categories. Staff/viewers see
    // a 403 here so accidental POSTs from the wrong role never reach
    // the DB.
    const forbidden = requireVendorRole(session, "manager");
    if (forbidden) return forbidden;

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
      typeof body.nameAr === "string"
        ? body.nameAr
        : typeof body.name_ar === "string"
          ? body.name_ar
          : "";
    if (!nameAr.trim()) {
      return NextResponse.json(
        { success: false, error: "اسم القسم بالعربية مطلوب" },
        { status: 400 },
      );
    }
    const nameEn =
      typeof body.nameEn === "string"
        ? body.nameEn
        : typeof body.name_en === "string"
          ? body.name_en
          : "";

    // Auto-derive the slug from the Arabic name (matches the admin
    // categories POST). If a slug is supplied AND free, keep it;
    // otherwise generate a unique fallback.
    let baseSlug =
      typeof body.slug === "string" && body.slug.trim().length > 0
        ? body.slug.trim()
        : generateSlug(nameAr);
    baseSlug = baseSlug || `cat-${Date.now()}`;

    let candidate = baseSlug;
    let counter = 2;
    while (counter < 100) {
      const check = await query(
        "SELECT id FROM categories WHERE slug = $1 LIMIT 1",
        [candidate],
      );
      if (check.rows.length === 0) break;
      candidate = `${baseSlug}-${counter}`;
      counter++;
    }
    const finalSlug = candidate;

    const inserted = await query<{ id: string }>(
      `INSERT INTO categories (name_ar, name_en, slug, is_active, sort_order)
       VALUES ($1, $2, $3, TRUE, 0)
       RETURNING id`,
      [nameAr.trim(), nameEn.trim() || null, finalSlug],
    );

    // Bust the public categories cache so the new category shows up on
    // the storefront right away (the admin endpoint doesn't always
    // invalidate the public key).
    cache.invalidatePattern("categories:");

    return NextResponse.json({
      success: true,
      data: {
        id: inserted.rows[0]?.id,
        slug: finalSlug,
        name_ar: nameAr.trim(),
        name_en: nameEn.trim() || null,
        is_active: true,
        sort_order: 0,
      },
    });
  } catch (error) {
    logError("POST vendor category error:", error);
    return NextResponse.json(
      { success: false, error: "فشل إنشاء القسم" },
      { status: 500 },
    );
  }
}
