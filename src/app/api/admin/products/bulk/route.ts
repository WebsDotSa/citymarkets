import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { error as logError } from '@/lib/logger';
import { deleteFromR2, r2KeyFromUrl } from '@/lib/r2';
import { CITY_MARKETS_VENDOR_ID } from '@/lib/types';

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request, 'manage_products');
  if (gate instanceof NextResponse) return gate;

  try {
    const body = await request.json();
    const { action, ids, value } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: false, error: 'لم يتم تحديد منتجات' }, { status: 400 });
    }

    const validIds = ids.filter((id: string) => UUID_LIKE.test(id));
    if (validIds.length === 0) {
      return NextResponse.json({ success: false, error: 'معرفات غير صالحة' }, { status: 400 });
    }

    // The admin products dashboard only lists City Markets rows via the
    // products_unified view, so every bulk action must be scoped to
    // CITY_MARKETS_VENDOR_ID — otherwise a forged id vector could touch
    // another vendor's catalog. The singular DELETE/PUT handlers in
    // /api/admin/products/route.ts already enforce this; the bulk endpoint
    // now does too.
    switch (action) {
      case 'delete': {
        // Multi-table fallback: delete from `vendor_products` first, then
        // any leftover ids get deleted from the legacy `products` table.
        // Mirrors the singular handler so admins can delete any row shown
        // on the catalog page regardless of which underlying table holds
        // it.
        const resVp = await query<{ image_url: string | null; image_urls: string[] | null }>(
          `SELECT image_url, image_urls
             FROM vendor_products
            WHERE vendor_id = $1 AND id = ANY($2)`,
          [CITY_MARKETS_VENDOR_ID, validIds],
        );

        const deletedVp = await query(
          `DELETE FROM vendor_products
            WHERE vendor_id = $1 AND id = ANY($2)`,
          [CITY_MARKETS_VENDOR_ID, validIds],
        );

        // Look up any ids that are still present in the legacy `products`
        // table so we can delete them there too. The two tables are kept
        // separate by design (legacy rows predate multi-vendor), so a
        // bulk-delete must touch both to fully remove what the admin sees.
        const resLegacy = await query<{ id: string; image_url: string | null; images: string[] | null }>(
          `SELECT id, image_url, images FROM products WHERE id = ANY($1)`,
          [validIds],
        );
        const legacyIds = resLegacy.rows.map((r) => r.id);

        let deletedLegacyCount = 0;
        if (legacyIds.length > 0) {
          const deletedLegacy = await query(
            `DELETE FROM products WHERE id = ANY($1)`,
            [legacyIds],
          );
          deletedLegacyCount = deletedLegacy.rowCount ?? 0;
        }

        const imagesToDelete = new Set<string>();
        for (const row of resVp.rows) {
          if (row.image_url) imagesToDelete.add(row.image_url);
          if (Array.isArray(row.image_urls)) {
            row.image_urls.forEach((img: string) => imagesToDelete.add(img));
          }
        }
        for (const row of resLegacy.rows) {
          if (row.image_url) imagesToDelete.add(row.image_url);
          if (Array.isArray(row.images)) {
            row.images.forEach((img: string) => imagesToDelete.add(img));
          }
        }

        imagesToDelete.forEach(url => {
          const key = r2KeyFromUrl(url);
          if (key) deleteFromR2(key).catch(() => {});
        });

        const totalDeleted = (deletedVp.rowCount ?? 0) + deletedLegacyCount;
        return NextResponse.json({ success: true, count: totalDeleted });
      }

      case 'update_status': {
        if (value !== 'active' && value !== 'inactive') {
          return NextResponse.json({ success: false, error: 'قيمة غير صالحة للحالة' }, { status: 400 });
        }
        const isActive = value === 'active';
        // Update City Markets vendor_products first, then any ids that
        // exist ONLY in the legacy `products` table. Using NOT EXISTS
        // avoids double-counting rows that live in both tables — the
        // catalog reads from vendor_products for those.
        const resultVp = await query(
          `UPDATE vendor_products
              SET is_active = $1
            WHERE vendor_id = $2 AND id = ANY($3)`,
          [isActive, CITY_MARKETS_VENDOR_ID, validIds],
        );

        const legacyOnly = await query<{ id: string }>(
          `SELECT p.id FROM products p
             WHERE p.id = ANY($1)
               AND NOT EXISTS (
                 SELECT 1 FROM vendor_products vp
                  WHERE vp.id = p.id AND vp.vendor_id = $2
               )`,
          [validIds, CITY_MARKETS_VENDOR_ID],
        );
        const legacyIds = legacyOnly.rows.map((r) => r.id);

        let countLegacy = 0;
        if (legacyIds.length > 0) {
          const resultLegacy = await query(
            `UPDATE products SET is_active = $1 WHERE id = ANY($2)`,
            [isActive, legacyIds],
          );
          countLegacy = resultLegacy.rowCount ?? 0;
        }

        return NextResponse.json({
          success: true,
          count: (resultVp.rowCount ?? 0) + countLegacy,
        });
      }

      case 'update_category': {
        if (!value || !UUID_LIKE.test(value)) {
          return NextResponse.json({ success: false, error: 'قسم غير صالح' }, { status: 400 });
        }
        const resultVp = await query(
          `UPDATE vendor_products
              SET category_id = $1
            WHERE vendor_id = $2 AND id = ANY($3)`,
          [value, CITY_MARKETS_VENDOR_ID, validIds],
        );

        const legacyOnly = await query<{ id: string }>(
          `SELECT p.id FROM products p
             WHERE p.id = ANY($1)
               AND NOT EXISTS (
                 SELECT 1 FROM vendor_products vp
                  WHERE vp.id = p.id AND vp.vendor_id = $2
               )`,
          [validIds, CITY_MARKETS_VENDOR_ID],
        );
        const legacyIds = legacyOnly.rows.map((r) => r.id);

        let countLegacy = 0;
        if (legacyIds.length > 0) {
          const resultLegacy = await query(
            `UPDATE products SET category_id = $1 WHERE id = ANY($2)`,
            [value, legacyIds],
          );
          countLegacy = resultLegacy.rowCount ?? 0;
        }

        return NextResponse.json({
          success: true,
          count: (resultVp.rowCount ?? 0) + countLegacy,
        });
      }

      case 'update_quantity': {
        const qty = parseInt(value, 10);
        if (isNaN(qty) || qty < 0) {
          return NextResponse.json({ success: false, error: 'كمية غير صالحة' }, { status: 400 });
        }
        // vendor_products uses `stock_quantity`; legacy `products` uses
        // `stock_qty`. Touch the live column on each table — the
        // legacyOnly filter prevents double-updating ids present in both.
        const resultVp = await query(
          `UPDATE vendor_products
              SET stock_quantity = $1
            WHERE vendor_id = $2 AND id = ANY($3)`,
          [qty, CITY_MARKETS_VENDOR_ID, validIds],
        );

        const legacyOnly = await query<{ id: string }>(
          `SELECT p.id FROM products p
             WHERE p.id = ANY($1)
               AND NOT EXISTS (
                 SELECT 1 FROM vendor_products vp
                  WHERE vp.id = p.id AND vp.vendor_id = $2
               )`,
          [validIds, CITY_MARKETS_VENDOR_ID],
        );
        const legacyIds = legacyOnly.rows.map((r) => r.id);

        let countLegacy = 0;
        if (legacyIds.length > 0) {
          const resultLegacy = await query(
            `UPDATE products SET stock_qty = $1 WHERE id = ANY($2)`,
            [qty, legacyIds],
          );
          countLegacy = resultLegacy.rowCount ?? 0;
        }

        return NextResponse.json({
          success: true,
          count: (resultVp.rowCount ?? 0) + countLegacy,
        });
      }

      default:
        return NextResponse.json({ success: false, error: 'إجراء غير مدعوم' }, { status: 400 });
    }
  } catch (error) {
    logError('Bulk action error', { error });
    return NextResponse.json({ success: false, error: 'حدث خطأ أثناء العملية' }, { status: 500 });
  }
}
