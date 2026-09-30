import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { error as logError } from '@/lib/logger';
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import { CITY_MARKETS_VENDOR_ID } from '@/lib/types';
import {
  checkRateLimit,
  createRateLimitHeaders,
  CART_OPERATION_CONFIG,
} from '@/lib/rate-limit';

/**
 * POST /api/v1/wishlist/[productId]/move-to-cart
 *   body: { quantity?: number }   — default 1
 *
 * Atomically moves a wishlist row into the cart:
 *   1. Confirm the row belongs to the caller (otherwise 404 — no
 *      enumeration of other users' wishlists).
 *   2. Confirm the product is still purchasable (active vendor, in
 *      stock when track_stock is true). Mirrors /api/v1/cart POST.
 *   3. INSERT … ON CONFLICT DO UPDATE the cart row (so re-adding an
 *      item that's already in the cart just bumps the quantity).
 *   4. DELETE the wishlist row.
 *   5. COMMIT.
 *
 * Why a dedicated endpoint (instead of the storefront doing
 *   DELETE /wishlist?product_id=… + POST /cart separately)?
 *   - One round-trip vs two.
 *   - One transaction vs two: if the cart INSERT fails (e.g. product
 *     went inactive), the wishlist row stays put — no orphan state
 *     where the item vanished from both sides.
 *   - One CSRF + rate-limit gate instead of two.
 *
 * Phase 3-5 (full-system audit 2026-09-30).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'غير مصرح' },
      { status: 401 },
    );
  }

  const rl = await checkRateLimit(`wishlist:${userId}`, CART_OPERATION_CONFIG);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'تم تجاوز عدد المحاولات، حاول لاحقاً' },
      { status: 429, headers: createRateLimitHeaders(rl) },
    );
  }

  const { productId } = await params;
  if (!productId || !productId.trim()) {
    return NextResponse.json(
      { success: false, error: 'معرّف المنتج مطلوب' },
      { status: 400 },
    );
  }

  // Optional body: { quantity }. Default 1 to match the cart POST.
  // Accept (and ignore) extra fields so a stray body shape doesn't 400.
  let quantity = 1;
  try {
    const body = await request.json().catch(() => ({} as { quantity?: number }));
    if (typeof body?.quantity === 'number' && Number.isFinite(body.quantity)) {
      quantity = Math.max(1, Math.min(99, Math.floor(body.quantity)));
    }
  } catch {
    // Empty body is fine; default quantity applies.
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Step 1: confirm the wishlist row belongs to the caller. DELETE
    // RETURNING gives us the row back atomically; if 0 rows came back,
    // the item wasn't in the caller's wishlist (404).
    const wishlistResult = await client.query(
      `DELETE FROM wishlist_items
        WHERE user_id = $1::uuid AND product_id = $2::uuid
        RETURNING product_id`,
      [userId, productId],
    );
    if (wishlistResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, error: 'المنتج غير موجود في المفضلة' },
        { status: 404, headers: createRateLimitHeaders(rl) },
      );
    }

    // Step 2: validate product + vendor like the cart POST does. We do
    // this AFTER the wishlist delete so a stale wishlist row doesn't
    // survive even when the product is unavailable — the storefront
    // can surface "هذا المنتج لم يعد متاحاً" and the user will see
    // their wishlist item already gone (re-add manually).
    const lookup = await client.query(
      `SELECT p.vendor_id, p.track_stock, p.stock_qty, p.is_active,
              v.is_active AS vendor_active
         FROM products_unified p
         LEFT JOIN vendors v ON v.id = p.vendor_id
        WHERE p.id = $1`,
      [productId],
    );
    if (lookup.rows.length === 0 || !lookup.rows[0].is_active) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, error: 'المنتج غير متوفر' },
        { status: 400, headers: createRateLimitHeaders(rl) },
      );
    }
    const productRow = lookup.rows[0];
    if (productRow.vendor_id && productRow.vendor_active === false) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, error: 'المتجر غير متاح حالياً' },
        { status: 400, headers: createRateLimitHeaders(rl) },
      );
    }
    const stockAware = productRow.track_stock === false || productRow.track_stock === null;
    if (!stockAware && Number(productRow.stock_qty) < quantity) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { success: false, error: 'الكمية المطلوبة غير متوفرة' },
        { status: 400, headers: createRateLimitHeaders(rl) },
      );
    }

    // Step 3: insert (or upsert) the cart row. The ON CONFLICT
    // inference matches the partial unique index from migration 037
    // exactly (see the long comment in src/app/api/v1/cart/route.ts
    // for the SQL reasoning). COALESCE on the conflict target uses
    // the City Markets sentinel UUID so legacy catalog rows (where
    // vendor_id IS NULL) still match the index.
    await client.query(
      `INSERT INTO cart (user_id, product_id, vendor_id, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, product_id, COALESCE(vendor_id, '${CITY_MARKETS_VENDOR_ID}'::uuid))
       WHERE product_id IS NOT NULL
       DO UPDATE SET quantity = cart.quantity + EXCLUDED.quantity,
                     updated_at = NOW()`,
      [userId, productId, productRow.vendor_id ?? null, quantity],
    );

    await client.query('COMMIT');
    return NextResponse.json(
      {
        success: true,
        message: 'تم نقل المنتج إلى السلة',
        product_id: productId,
        quantity,
      },
      { headers: createRateLimitHeaders(rl) },
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    logError('wishlist move-to-cart error', error);
    return NextResponse.json(
      { success: false, error: 'فشل نقل المنتج إلى السلة' },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
