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
 * The `categories` table is now vendor-aware as of migration 081:
 *
 *   vendor_id IS NULL  → global category (visible to every vendor and
 *                         every customer)
 *   vendor_id = $vid   → private category scoped to one vendor
 *
 * Endpoints:
 *
 *   GET  /api/v1/vendor/categories  → returns
 *                                     `{ global: Category[], private: Category[] }`
 *                                     so the admin form can render two
 *                                     clearly-separated sections.
 *                                     60s cache.
 *   POST /api/v1/vendor/categories  → manager+ may create a new
 *                                     category. By default the new row
 *                                     is PRIVATE (`vendor_id = current`).
 *                                     Pass `isPrivate: false` to create
 *                                     a global row (visible to all
 *                                     vendors — discouraged; admins are
 *                                     the canonical source of global
 *                                     categories).
 *
 * Update / delete for PRIVATE rows are exposed under
 * `/api/v1/vendor/categories/[id]` so a vendor can rename or remove
 * their own private categories without affecting anyone else.
 *
 * Cache invalidation:
 *   - POST: bust `vendor-storefront:{slug}:categories:` so the
 *           storefront chip strip refreshes.
 *   - POST isPrivate=false: also bust `categories:` so the public
 *           category tree picks up the new global row.
 */

interface CategoryRow {
  id: string;
  name_ar: string;
  name_en: string | null;
  slug: string;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  vendor_id: string | null;
}

const cacheKey = (slug: string) => `vendor:${slug}:categories:v1`;

export async function GET(request: NextRequest) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const key = cacheKey(session.vendorSlug);
    const cached = cache.get<{
      global: CategoryRow[];
      private: CategoryRow[];
    }>(key);
    if (cached) {
      return NextResponse.json({ success: true, data: cached });
    }

    // One round-trip: global + private scoped by vendor_id. Active
    // only — archived categories never appear in the vendor's
    // selector.
    const result = await query<CategoryRow>(
      `SELECT id, name_ar, name_en, slug, parent_id, sort_order,
              is_active, vendor_id
         FROM categories
        WHERE is_active = TRUE
          AND (vendor_id IS NULL OR vendor_id = $1)
        ORDER BY sort_order ASC, name_ar ASC`,
      [session.vendorId],
    );

    const global = result.rows.filter((r) => r.vendor_id === null);
    const privateRows = result.rows.filter(
      (r) => r.vendor_id === session.vendorId,
    );

    const payload = { global, private: privateRows };
    cache.set(key, payload, 60_000); // 60s TTL — short to react to admin edits
    return NextResponse.json({ success: true, data: payload });
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

    // `isPrivate` defaults to TRUE — vendors almost never need to
    // create a global row, and creating one affects every other
    // vendor's storefront. Admins are the canonical source of global
    // categories.
    const isPrivate = body.isPrivate !== false;

    // Auto-derive the slug from the Arabic name (matches the admin
    // categories POST). If a slug is supplied AND free, keep it;
    // otherwise generate a unique fallback.
    let baseSlug =
      typeof body.slug === "string" && body.slug.trim().length > 0
        ? body.slug.trim()
        : generateSlug(nameAr);
    baseSlug = baseSlug || `cat-${Date.now()}`;

    // Slug uniqueness is scoped by `vendor_id`. The migration replaced
    // the global UNIQUE constraint with two partial uniques, so we
    // check the relevant scope only.
    let candidate = baseSlug;
    let counter = 2;
    while (counter < 100) {
      const check = isPrivate
        ? await query(
            `SELECT id FROM categories WHERE vendor_id = $1 AND slug = $2 LIMIT 1`,
            [session.vendorId, candidate],
          )
        : await query(
            `SELECT id FROM categories WHERE vendor_id IS NULL AND slug = $1 LIMIT 1`,
            [candidate],
          );
      if (check.rows.length === 0) break;
      candidate = `${baseSlug}-${counter}`;
      counter++;
    }
    const finalSlug = candidate;

    const inserted = await query<{ id: string }>(
      isPrivate
        ? `INSERT INTO categories
              (name_ar, name_en, slug, is_active, sort_order, vendor_id)
            VALUES ($1, $2, $3, TRUE, 0, $4)
            RETURNING id`
        : `INSERT INTO categories
              (name_ar, name_en, slug, is_active, sort_order, vendor_id)
            VALUES ($1, $2, $3, TRUE, 0, NULL)
            RETURNING id`,
      isPrivate
        ? [nameAr.trim(), nameEn.trim() || null, finalSlug, session.vendorId]
        : [nameAr.trim(), nameEn.trim() || null, finalSlug],
    );

    // Bust the storefront's chip-strip cache for this vendor and the
    // shared categories cache (the latter is required only when the
    // row is global so the public tree refreshes).
    cache.invalidatePattern(
      `vendor-storefront:${session.vendorSlug}:categories:`,
    );
    if (!isPrivate) {
      cache.invalidatePattern("categories:");
    }

    return NextResponse.json({
      success: true,
      data: {
        id: inserted.rows[0]?.id,
        slug: finalSlug,
        name_ar: nameAr.trim(),
        name_en: nameEn.trim() || null,
        is_active: true,
        sort_order: 0,
        vendor_id: isPrivate ? session.vendorId : null,
        isPrivate,
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
