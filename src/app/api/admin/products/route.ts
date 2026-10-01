import { UUID_RE as UUID_LIKE } from "@/lib/uuid";
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { productInputSchema } from '@/lib/validation';
import { CITY_MARKETS_VENDOR_ID } from '@/lib/types';
import { deleteFromR2, r2KeyFromUrl } from '@/lib/r2';
import { cache } from '@/lib/cache';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';


function idCheck(url: URL) {
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, error: 'المعرّف مطلوب' }, { status: 400 });
  if (!UUID_LIKE.test(id)) return NextResponse.json({ success: false, error: 'المنتج غير موجود' }, { status: 404 });
  return id;
}

// GET /api/admin/products
// Supports: search, category_id, is_active, page, limit
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_products');
  if (gate instanceof NextResponse) return gate;
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.trim() || '';
    const categoryId = searchParams.get('category_id');
    const isActive = searchParams.get('is_active');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    // Build WHERE clause dynamically
    const conditions: string[] = [];
    const params: (string | number | boolean)[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(p.name_ar ILIKE $${paramIndex} OR p.name_en ILIKE $${paramIndex} OR p.barcode ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (categoryId) {
      // category_id is a UUID (categories.id and vendor_products.category_id
      // are both UUID columns). Comparing it to `parseInt(..., 10)` produces
      // NaN, which makes the filter silently return zero products. Pass the
      // raw string so PostgreSQL casts it back to UUID for the comparison.
      conditions.push(`p.category_id = $${paramIndex}::uuid`);
      params.push(categoryId);
      paramIndex++;
    }

    if (isActive !== null && isActive !== undefined) {
      conditions.push(`p.is_active = $${paramIndex}`);
      params.push(isActive === 'true');
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count — Slice 4: read from the unified view so vendor
    // products show up alongside City Markets rows. products_unified
    // exposes the same columns we used to query on `products`, so the
    // SELECT list / WHERE clause stay identical.
    const countResult = await query(
      `SELECT COUNT(*) as total FROM products_unified p ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    // Get paginated data
    const dataParams = [...params, limit, offset];
    const result = await query(
      `SELECT p.id, p.category_id, p.name_ar, p.name_en, p.barcode, p.description,
              p.price::float as price, p.discount_price::float as discount_price,
              p.stock_qty, p.unit, p.is_featured, p.is_active, p.image_url,
              COALESCE(p.images, '{}') as images,
              p.created_at, p.updated_at,
              p.vendor_id, p.vendor_slug, p.vendor_name,
              c.name_ar as category_name, c.slug as category_slug
       FROM products_unified p
       LEFT JOIN categories c ON p.category_id = c.id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      dataParams
    );

    return NextResponse.json({
      success: true,
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'فشل جلب المنتجات' }, { status: 500 });
  }
}

// POST /api/admin/products
export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_products');
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await request.json();
    const parsed = productInputSchema.safeParse({
      ...body,
      stock_qty: body.stock_qty !== undefined ? Number(body.stock_qty) : undefined,
      price: Number(body.price),
      discount_price: body.discount_price != null && body.discount_price !== ''
        ? Number(body.discount_price)
        : null,
    });
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || 'بيانات المنتج غير صالحة' },
        { status: 400 }
      );
    }
    const {
      name_ar, name_en, barcode, description, category_id,
      price, discount_price, stock_qty, unit,
      image_url, images, is_featured, is_active,
    } = parsed.data;

    // Sanitize the gallery — only keep non-empty strings, max 8 items
    const cleanImages: string[] = Array.isArray(images)
      ? images.filter((u: unknown) => typeof u === 'string' && u.trim().length > 0).slice(0, 8)
      : [];

    // Slice 4: admin inserts land in `vendor_products` with
    // vendor_id = CITY_MARKETS_VENDOR_ID. The legacy `products` table
    // is read-only now (migration 039). Field mapping:
    //   stock_qty   → stock_quantity
    //   images[]    → image_urls[]
    //   + new columns from 039b: barcode, unit, is_featured,
    //     image_url, description
    const result = await query(
      `INSERT INTO vendor_products (
         vendor_id, name_ar, name_en, barcode, description, category_id,
         price, discount_price, stock_quantity, track_stock,
         unit, image_url, image_urls, is_featured, is_active
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
       ) RETURNING id`,
      [
        CITY_MARKETS_VENDOR_ID,
        name_ar, name_en || null, barcode || null, description || null,
        category_id, price, discount_price || null,
        stock_qty ?? 0, true, // track_stock defaults to true on catalog rows
        unit || 'حبة',
        image_url || null, cleanImages, !!is_featured, is_active !== false,
      ]
    );

    return NextResponse.json({ success: true, data: { id: result.rows[0].id } });
    // Invalidate product SEO cache so the next `getProductForSeo(id)`
    // returns the freshly-created row. Pattern invalidation is cheap
    // (one in-process Map walk) and avoids shipping stale SEO metadata.
    cache.invalidatePattern('product:seo:');
  } catch (error) {
    logError('Error creating product:', error);
    return NextResponse.json({ success: false, error: 'فشل إنشاء المنتج' }, { status: 500 });
  }
}

// PUT /api/admin/products?id=xxx
export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_products');
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await request.json();
    const url = new URL(request.url);
    const idCheckResult = idCheck(url);
    if (typeof idCheckResult !== 'string') return idCheckResult;
    const id = idCheckResult;
    const parsed = productInputSchema.safeParse({
      ...body,
      stock_qty: body.stock_qty !== undefined ? Number(body.stock_qty) : undefined,
      price: Number(body.price),
      discount_price: body.discount_price != null && body.discount_price !== ''
        ? Number(body.discount_price)
        : null,
    });
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || 'بيانات المنتج غير صالحة' },
        { status: 400 }
      );
    }
    const {
      name_ar, name_en, barcode, description, category_id,
      price, discount_price, stock_qty, unit,
      image_url, images, is_featured, is_active,
    } = parsed.data;

    const cleanImages: string[] = Array.isArray(images)
      ? images.filter((u: unknown) => typeof u === 'string' && u.trim().length > 0).slice(0, 8)
      : [];

    // Slice 4: admin updates target `vendor_products` for City Markets
    // rows only (vendor_id = CITY_MARKETS_VENDOR_ID). The legacy
    // `products` table is read-only.
    await query(
      `UPDATE vendor_products
          SET name_ar = $1, name_en = $2, barcode = $3, description = $4, category_id = $5,
              price = $6, discount_price = $7, stock_quantity = $8, unit = $9,
              image_url = $10, image_urls = $11, is_featured = $12,
              is_active = $13, updated_at = NOW()
        WHERE id = $14 AND vendor_id = $15`,
      [
        name_ar, name_en || null, barcode || null, description || null,
        category_id, price, discount_price || null,
        stock_qty ?? 0, unit || 'حبة',
        image_url || null, cleanImages, !!is_featured, is_active !== false,
        id, CITY_MARKETS_VENDOR_ID,
      ]
    );

    return NextResponse.json({ success: true });
    // SEO cache invalidation (see POST handler above).
    cache.invalidatePattern('product:seo:');
  } catch (error) {
    logError('Error updating product:', error);
    return NextResponse.json({ success: false, error: 'فشل تحديث المنتج' }, { status: 500 });
  }
}

// DELETE /api/admin/products?id=xxx
export async function DELETE(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_products');
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(request.url);
    const idCheckResult = idCheck(url);
    if (typeof idCheckResult !== 'string') return idCheckResult;
    const id = idCheckResult;

    // Multi-table fallback: products created after Slice 4 live in
    // `vendor_products` (vendor_id = CITY_MARKETS_VENDOR_ID); older
    // rows still live in the legacy `products` table. The admin catalog
    // page reads from `products_unified` which unions both, so a row
    // shown on screen may be in either. Try `vendor_products` first,
    // then fall back to `products` — this keeps both tables intact
    // (each is its own vendor store) while letting the admin delete any
    // visible row regardless of which underlying table holds it.
    const beforeVp = await query<{ image_url: string | null; image_urls: string[] | null }>(
      'SELECT image_url, image_urls FROM vendor_products WHERE id = $1 AND vendor_id = $2',
      [id, CITY_MARKETS_VENDOR_ID]
    );

    let result = await query(
      'DELETE FROM vendor_products WHERE id = $1 AND vendor_id = $2',
      [id, CITY_MARKETS_VENDOR_ID]
    );
    let sourceTable: 'vendor_products' | 'products' = 'vendor_products';
    let orphanedUrls: string[] = [];

    if ((result.rowCount ?? 0) === 0) {
      const beforeLegacy = await query<{ image_url: string | null; images: string[] | null }>(
        'SELECT image_url, images FROM products WHERE id = $1',
        [id]
      );
      result = await query('DELETE FROM products WHERE id = $1', [id]);
      sourceTable = 'products';
      orphanedUrls = [
        ...(beforeLegacy.rows?.[0]?.image_url ? [beforeLegacy.rows[0].image_url] : []),
        ...(Array.isArray(beforeLegacy.rows?.[0]?.images)
          ? beforeLegacy.rows[0].images
          : []),
      ];
    } else {
      orphanedUrls = [
        ...(beforeVp.rows?.[0]?.image_url ? [beforeVp.rows[0].image_url] : []),
        ...(Array.isArray(beforeVp.rows?.[0]?.image_urls)
          ? beforeVp.rows[0].image_urls
          : []),
      ];
    }

    if ((result.rowCount ?? 0) === 0) {
      return NextResponse.json(
        { success: false, error: 'المنتج غير موجود' },
        { status: 404 }
      );
    }

    // R2 cleanup — same dedupe + sequential delete as before.
    const uniqueUrls = Array.from(
      new Set(orphanedUrls.filter((u) => typeof u === 'string' && u.length > 0))
    );

    let r2Cleaned = 0;
    const r2Failures: string[] = [];
    for (const u of uniqueUrls) {
      const key = r2KeyFromUrl(u);
      if (!key) continue;
      try {
        await deleteFromR2(key);
        r2Cleaned += 1;
      } catch (r2Err) {
        r2Failures.push(key);
        logWarn('R2 delete on product removal failed', {
          productId: id,
          key,
          error: r2Err instanceof Error ? r2Err.message : String(r2Err),
        });
      }
    }

    return NextResponse.json({
      success: true,
      deleted: result.rowCount ?? 0,
      source: sourceTable,
      r2Cleaned,
      r2Failed: r2Failures.length,
      r2Failures: r2Failures.length > 0 ? r2Failures : undefined,
    });
    // SEO cache invalidation (see POST handler above).
    cache.invalidatePattern('product:seo:');
  } catch (error) {
    logError('Error deleting product:', error);
    return NextResponse.json({ success: false, error: 'فشل حذف المنتج' }, { status: 500 });
  }
}
