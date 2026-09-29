import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';
import { priceCartRow } from '@/lib/cart/pricing';

import {
  getGuestSessionIdFromRequest,
  resolveCustomerUserIdFromRequest,
} from '@/lib/identity';
import { CITY_MARKETS_VENDOR_ID } from '@/lib/types';
import {
  checkRateLimit,
  createRateLimitHeaders,
  CART_OPERATION_CONFIG,
  GENERAL_API_CONFIG,
} from '@/lib/rate-limit';

async function resolveCartActors(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  const sessionId = getGuestSessionIdFromRequest(request);
  return { userId, sessionId };
}

/**
 * GET the cart with vendor provenance. Reads from the unified
 * `products_unified` view (migration 036) so vendor rows AND legacy
 * catalog rows surface with the same shape. Returns the vendor
 * metadata attached to each row so CartV2 can render per-vendor
 * groupings (Slice 2) and Slice 3's checkout can route the order to
 * the right vendors.
 */
export async function GET(request: NextRequest) {
  const { userId, sessionId } = await resolveCartActors(request);

  if (!userId && !sessionId) {
    return NextResponse.json({ error: 'معلومات غير مكتملة' }, { status: 400 });
  }

  const client = await pool.connect();

  try {
    let q = '';
    let params: string[] = [];

    if (userId) {
      // Slice 2: cart rows are vendor-aware. The vendor_id column was
      // added by migration 037. We LEFT JOIN `vendors` so an inactive
      // vendor surfaces in the response with `vendor_name = null`
      // (the cart context can hide those rows). Slice 5: switched to
      // `products_unified_with_offers` so the cart payload includes
      // the active offer and pre-computed effective price.
      q = `
        SELECT c.id, c.quantity, c.vendor_id,
               p.id as product_id, p.name_ar, p.price, p.discount_price,
               p.image_url, p.stock_qty,
               p.active_offer_id, p.active_offer_title_ar, p.active_offer_type,
               p.active_offer_value::float as active_offer_value,
               p.active_offer_max_discount::float as active_offer_max_discount,
               p.active_offer_min_order::float as active_offer_min_order,
               p.active_offer_starts_at, p.active_offer_ends_at,
               v.name_ar as vendor_name, v.slug as vendor_slug
        FROM cart c
        JOIN products_unified_with_offers p ON c.product_id = p.id
        LEFT JOIN vendors v ON v.id = c.vendor_id
        WHERE c.user_id = $1
      `;
      params = [userId];
    } else if (sessionId) {
      q = `
        SELECT c.id, c.quantity, c.vendor_id,
               p.id as product_id, p.name_ar, p.price, p.discount_price,
               p.image_url, p.stock_qty,
               p.active_offer_id, p.active_offer_title_ar, p.active_offer_type,
               p.active_offer_value::float as active_offer_value,
               p.active_offer_max_discount::float as active_offer_max_discount,
               p.active_offer_min_order::float as active_offer_min_order,
               p.active_offer_starts_at, p.active_offer_ends_at,
               v.name_ar as vendor_name, v.slug as vendor_slug
        FROM guest_cart c
        JOIN products_unified_with_offers p ON c.product_id = p.id
        LEFT JOIN vendors v ON v.id = c.vendor_id
        WHERE c.session_id = $1
      `;
      params = [sessionId];
    }

    const result = await client.query(q, params);

    function toNumOrZero(v: unknown): number {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    function toNumOrNull(v: unknown): number | null {
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }

    const rows = result.rows.map((row) => {
      // Default to City Markets when vendor_id is null (legacy rows
      // pre-dating migration 037) or the vendor has been deactivated
      // (LEFT JOIN → vendor_name = null). The cart UI treats this as
      // a catalog item.
      const vendorId = row.vendor_id ?? CITY_MARKETS_VENDOR_ID;
      const vendorName = row.vendor_name ?? null;
      const vendorSlug = row.vendor_slug ?? null;

      const listPrice = toNumOrZero(row.price);
      const legacySale = toNumOrNull(row.discount_price);

      // P2-5: centralize the unit-price formula in `@/lib/cart/pricing`
      // so the cart GET, the cart UI, and checkout all agree on the
      // final number. The previous inlined formula lived here only.
      const priced = priceCartRow({
        product_id: row.product_id,
        price: listPrice,
        discount_price: legacySale,
        quantity: row.quantity,
        active_offer_id: row.active_offer_id ?? null,
        active_offer_type: row.active_offer_type ?? null,
        active_offer_value: row.active_offer_value ?? null,
        active_offer_max_discount: row.active_offer_max_discount ?? null,
        active_offer_min_order: row.active_offer_min_order ?? null,
        active_offer_starts_at: row.active_offer_starts_at ?? null,
        active_offer_ends_at: row.active_offer_ends_at ?? null,
      });

      // Build the legacy `active_offer` payload for iOS / external
      // consumers. The pricing module only carries an id; the route
      // enriches with the title (from the JOIN).
      const activeOffer = row.active_offer_id
        ? {
            offer_id: row.active_offer_id,
            title_ar: row.active_offer_title_ar ?? '',
            discount_type: row.active_offer_type,
            discount_value: Number(row.active_offer_value) || 0,
            max_discount: legacySale ? null : toNumOrNull(row.active_offer_max_discount),
            min_order: toNumOrNull(row.active_offer_min_order),
            starts_at: row.active_offer_starts_at ?? '',
            ends_at: row.active_offer_ends_at ?? '',
          }
        : null;

      const effectivePrice = priced.unit_price < listPrice ? priced.unit_price : null;

      return {
        id: row.id,
        product_id: row.product_id,
        name_ar: row.name_ar,
        price: listPrice,
        discount_price: legacySale,
        image_url: row.image_url,
        stock_qty: row.stock_qty,
        quantity: row.quantity,
        vendor_id: vendorId,
        vendor_name: vendorName,
        vendor_slug: vendorSlug,
        active_offer: activeOffer,
        effective_price: effectivePrice,
        total: priced.line_total,
      };
    });

    const subtotal = rows.reduce((sum, item) => sum + item.total, 0);

    return NextResponse.json({
      success: true,
      items: rows,
      subtotal,
      count: rows.length,
    });
  } catch (error) {
    logError('Cart error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  } finally {
    client.release();
  }
}

/**
 * POST adds an item to the cart. Slice 2 accepts an optional
 * `vendor_id` so third-party vendor items can be persisted alongside
 * catalog items. The cart row's `vendor_id` column (migration 037)
 * carries the identity forward to Slice 3's checkout.
 *
 * Validation rules:
 *   - product_id MUST exist in `products_unified` (any vendor)
 *   - if vendor_id is supplied, it MUST own the product
 *   - stock check honours the `track_stock` flag from the unified view
 *     so vendors who opt out of stock tracking (fresh produce, bread)
 *     don't get blocked here.
 */
export async function POST(request: NextRequest) {
  const { userId, sessionId } = await resolveCartActors(request);

  // SECURITY (cart-spam): Cart mutations accept guest sessions, so they
  // are fully unauthenticated for the POST path. Apply IP-bucketed rate
  // limit (mirroring auth/twilio/send) — falls back to user bucket when
  // signed in so a single account cannot bypass the IP cap.
  const cartActor = userId ?? sessionId ?? 'anon';
  const cartRl = await checkRateLimit(`cart:${cartActor}`, CART_OPERATION_CONFIG);
  if (!cartRl.allowed) {
    return NextResponse.json(
      { error: 'تم تجاوز عدد المحاولات، حاول لاحقاً' },
      { status: 429, headers: createRateLimitHeaders(cartRl) }
    );
  }

  const { productId, quantity = 1, vendorId } = await request.json();

  if (!productId) {
    return NextResponse.json({ error: 'معلومات غير مكتملة' }, { status: 400 });
  }

  if (!userId && !sessionId) {
    return NextResponse.json({ error: 'معلومات غير مكتملة' }, { status: 400 });
  }

  const client = await pool.connect();

  try {
    // Validate product + vendor ownership in one trip. `products_unified`
    // exposes vendor_id, track_stock, and stock_qty; the JOIN to vendors
    // confirms the vendor is active.
    const lookup = await client.query(
      `SELECT p.vendor_id, p.track_stock, p.stock_qty, p.is_active,
              v.is_active as vendor_active
         FROM products_unified p
         LEFT JOIN vendors v ON v.id = p.vendor_id
        WHERE p.id = $1`,
      [productId]
    );

    if (lookup.rows.length === 0) {
      return NextResponse.json({ error: 'المنتج غير موجود' }, { status: 404 });
    }

    const row = lookup.rows[0];
    if (!row.is_active) {
      return NextResponse.json({ error: 'المنتج غير متوفر' }, { status: 400 });
    }
    // Vendor rows with a vendor_id MUST belong to an active vendor.
    // Catalog rows (vendor_id IS NULL) skip this check.
    if (row.vendor_id && row.vendor_active === false) {
      return NextResponse.json(
        { error: 'المتجر غير متاح حالياً' },
        { status: 400 }
      );
    }
    // Honour `track_stock` — vendors can opt out for items they
    // replenish continuously (bread, fresh produce).
    const stockAware = row.track_stock === false || row.track_stock === null;
    if (stockAware) {
      // no-op — track_stock opt-out
    } else if (Number(row.stock_qty) < quantity) {
      return NextResponse.json({ error: 'الكمية المطلوبة غير متوفرة' }, { status: 400 });
    }

    // Resolve the effective vendor_id. If the caller didn't supply one,
    // default to whatever the product row says (NULL for catalog rows).
    const effectiveVendorId =
      vendorId ?? row.vendor_id ?? null;

    // If the caller passed vendor_id but it doesn't match the product's
    // vendor, reject — prevents cart-row forgery.
    if (vendorId && row.vendor_id && vendorId !== row.vendor_id) {
      return NextResponse.json(
        { error: 'البائع لا يطابق المنتج' },
        { status: 400 }
      );
    }

    // ON CONFLICT uses the vendor-aware partial unique index from
    // migration 037. Two requirements for inference to find it:
    //   1. The COALESCE expression must match the index expression
    //      byte-for-byte (the literal needs `::uuid` so its type lines
    //      up with vendor_id's uuid type — `COALESCE(uuid, text)` is a
    //      type error and Postgres can't infer the index).
    //   2. The index is partial on `product_id IS NOT NULL`; the
    //      inference algorithm only matches a partial index when the
    //      ON CONFLICT clause re-states the predicate. product_id is
    //      NOT NULL on both tables, so the predicate is always true
    //      for any row we'd INSERT — the WHERE clause is just to
    //      satisfy the inference check.
    if (userId) {
      await client.query(
        `INSERT INTO cart (user_id, product_id, vendor_id, quantity)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, product_id, COALESCE(vendor_id, '${CITY_MARKETS_VENDOR_ID}'::uuid))
         WHERE product_id IS NOT NULL
         DO UPDATE SET quantity = cart.quantity + EXCLUDED.quantity`,
        [userId, productId, effectiveVendorId, quantity]
      );
    } else if (sessionId) {
      await client.query(
        `INSERT INTO guest_cart (session_id, product_id, vendor_id, quantity)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (session_id, product_id, COALESCE(vendor_id, '${CITY_MARKETS_VENDOR_ID}'::uuid))
         WHERE product_id IS NOT NULL
         DO UPDATE SET quantity = guest_cart.quantity + EXCLUDED.quantity`,
        [sessionId, productId, effectiveVendorId, quantity]
      );
    }

    return NextResponse.json({
      success: true,
      message: 'تمت الإضافة للسلة',
    });
  } catch (error) {
    logError('Add to cart error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function PUT(request: NextRequest) {
  const { userId, sessionId } = await resolveCartActors(request);

  // SECURITY (cart-spam): PUT quantity mutations also need rate limit.
  const cartActor = userId ?? sessionId ?? 'anon';
  const cartRl = await checkRateLimit(`cart:${cartActor}`, CART_OPERATION_CONFIG);
  if (!cartRl.allowed) {
    return NextResponse.json(
      { error: 'تم تجاوز عدد المحاولات، حاول لاحقاً' },
      { status: 429, headers: createRateLimitHeaders(cartRl) }
    );
  }

  const { itemId, quantity } = await request.json();

  if (!itemId || quantity === undefined) {
    return NextResponse.json({ error: 'معلومات غير مكتملة' }, { status: 400 });
  }

  if (!userId && !sessionId) {
    return NextResponse.json({ error: 'معلومات غير مكتملة' }, { status: 400 });
  }

  const client = await pool.connect();

  try {
    if (quantity <= 0) {
      if (userId) {
        await client.query('DELETE FROM cart WHERE id = $1 AND user_id = $2', [
          itemId,
          userId,
        ]);
      } else if (sessionId) {
        await client.query(
          'DELETE FROM guest_cart WHERE id = $1 AND session_id = $2',
          [itemId, sessionId]
        );
      }
    } else {
      if (userId) {
        await client.query(
          'UPDATE cart SET quantity = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
          [quantity, itemId, userId]
        );
      } else if (sessionId) {
        await client.query(
          'UPDATE guest_cart SET quantity = $1, updated_at = NOW() WHERE id = $2 AND session_id = $3',
          [quantity, itemId, sessionId]
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logError('Update cart error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(request: NextRequest) {
  const { userId, sessionId } = await resolveCartActors(request);

  // SECURITY (cart-spam): DELETE mutations need rate limit too.
  const cartActor = userId ?? sessionId ?? 'anon';
  const cartRl = await checkRateLimit(`cart:${cartActor}`, CART_OPERATION_CONFIG);
  if (!cartRl.allowed) {
    return NextResponse.json(
      { error: 'تم تجاوز عدد المحاولات، حاول لاحقاً' },
      { status: 429, headers: createRateLimitHeaders(cartRl) }
    );
  }

  // A bodyless DELETE means "clear the whole cart" (used by clearCart()
  // after an order is placed), so an unparsable body is not an error.
  const body = await request.json().catch(() => ({} as { itemId?: string }));
  const itemId = body?.itemId;

  if (!userId && !sessionId) {
    return NextResponse.json({ error: 'معلومات غير مكتملة' }, { status: 400 });
  }

  const client = await pool.connect();

  try {
    if (itemId) {
      if (userId) {
        await client.query('DELETE FROM cart WHERE id = $1 AND user_id = $2', [
          itemId,
          userId,
        ]);
      } else if (sessionId) {
        await client.query(
          'DELETE FROM guest_cart WHERE id = $1 AND session_id = $2',
          [itemId, sessionId]
        );
      }
    } else {
      if (userId) {
        await client.query('DELETE FROM cart WHERE user_id = $1', [userId]);
      } else if (sessionId) {
        await client.query('DELETE FROM guest_cart WHERE session_id = $1', [
          sessionId,
        ]);
      }
    }

    return NextResponse.json({ success: true, message: 'تم مسح السلة' });
  } catch (error) {
    logError('Clear cart error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  } finally {
    client.release();
  }
}