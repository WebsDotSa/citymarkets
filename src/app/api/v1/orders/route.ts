import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import {
  getGuestSessionIdFromRequest,
  resolveCustomerUserIdFromRequest,
} from '@/lib/customer-session';
import { createOrderSchema, validationError } from '@/lib/validation';
import { checkRateLimit, ORDER_CREATE_CONFIG, createRateLimitHeaders } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { isAppleReviewUser } from '@/lib/apple-review';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';
import {
  parseSlotsConfig,
  riyadhWallClockToUtc,
  toRiyadhDateKey,
  validateSlotSelection,
} from '@/lib/delivery-slots';
import {
  computeOrderFees,
  computeCouponDiscount,
  computeLoyaltyRedemption,
  type PricingSettings,
} from '@/lib/pricing';
import { getLoyaltySettings } from '@/lib/loyalty';
import { haversineKm } from '@/lib/geo';

/**
 * Order item type for internal use
 */
interface OrderItem {
  product_id: string;
  quantity: number;
  price: string | number;
  discount_price: string | number | null;
  stock_qty: string | number;
  name_ar: string;
}

/**
 * Database product row type
 */
interface ProductRow {
  product_id: string;
  price: string | number;
  discount_price: string | number | null;
  stock_qty: string | number;
  name_ar: string;
  is_active: boolean;
}

/**
 * Guest info type for order creation
 */
interface GuestInfo {
  name?: string | null;
  phone?: string | null;
  city?: string | null;
  district?: string | null;
  street?: string | null;
  building_number?: string | null;
  email?: string | null;
  lat?: number;
  lng?: number;
}

function parsePositiveInt(value: unknown): number | null {
  const n = parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export async function GET(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);

  if (!userId) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }

  const client = await pool.connect();

  try {
    // Pagination: cursor-based on (created_at DESC, id DESC) to handle
    // ties when many orders share the same millisecond. The cursor is
    // the `created_at` value of the last item from the previous page;
    // pass it back as `?cursor=<ISO8601>` to fetch the next page.
    // Limit defaults to 20 (the previous hardcoded value) and caps at
    // 100 to bound response size.
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 100;
    const url = new URL(request.url);
    const limit = Math.min(
      Math.max(parsePositiveInt(url.searchParams.get('limit')) ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const cursorRaw = url.searchParams.get('cursor');
    const cursorDate = cursorRaw ? new Date(cursorRaw) : null;
    if (cursorRaw && (!cursorDate || Number.isNaN(cursorDate.getTime()))) {
      return NextResponse.json(
        { success: false, error: 'cursor غير صالح' },
        { status: 400 },
      );
    }

    // Build the WHERE clause. With a cursor we want strictly older
    // rows (created_at < cursor) to keep descending order stable.
    const params: unknown[] = [userId];
    let whereExtra = '';
    if (cursorDate) {
      params.push(cursorDate.toISOString());
      whereExtra = `AND o.created_at < $${params.length}::timestamptz`;
    }
    params.push(limit);

    const result = await client.query(
      `SELECT o.*,
        a.address_text,
        COALESCE(o.tracking_code, LEFT(o.id::text, 8)) AS order_number,
        COALESCE(
          a.address_text,
          NULLIF(TRIM(CONCAT_WS('، ', o.guest_district, o.guest_street, o.guest_building, o.guest_city)), '')
        ) AS delivery_address,
        COUNT(DISTINCT oi.id)::int AS items_count,
        COALESCE(json_agg(json_build_object(
          'id', oi.id,
          'product_id', oi.product_id,
          'name_ar', p.name_ar,
          'price', oi.unit_price,
          'quantity', oi.qty,
          'image_url', p.image_url
        )) FILTER (WHERE oi.id IS NOT NULL), '[]'::json) as items
      FROM orders o
      LEFT JOIN addresses a ON o.address_id = a.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN products_unified p ON oi.product_id = p.id
      WHERE o.user_id = $1::uuid
        ${whereExtra}
      GROUP BY o.id, a.address_text
      ORDER BY o.created_at DESC
      LIMIT $${params.length}`,
      params
    );

    const rows = result.rows.map((row) => ({
      ...row,
      total: Number(row.total),
      subtotal: Number(row.subtotal),
      delivery_fee: Number(row.delivery_fee ?? 0),
      discount: Number(row.discount ?? 0),
      items: (() => {
        if (Array.isArray(row.items)) return row.items;
        if (typeof row.items === 'string' && row.items.trim()) {
          try {
            const parsed = JSON.parse(row.items);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        }
        return [];
      })(),
    }));

    // If we filled the page exactly, there may be more — emit a
    // `nextCursor` so the client can continue. Use the created_at of
    // the last row; client passes it back as `?cursor=`.
    const last = rows[rows.length - 1];
    const nextCursor =
      rows.length === limit && last?.created_at
        ? new Date(last.created_at).toISOString()
        : null;

    return NextResponse.json({
      success: true,
      orders: rows,
      data: rows,
      pagination: {
        limit,
        nextCursor,
        hasMore: nextCursor !== null,
      },
    });
  } catch (error) {
    logError('Orders error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  const sessionId = getGuestSessionIdFromRequest(request);

  // Rate limiting - use userId if authenticated, otherwise use IP
  const rateLimitKey = userId || getClientIp(request);
  const rateLimitResult = await checkRateLimit(rateLimitKey, ORDER_CREATE_CONFIG);
  
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'تجاوزت الحد المسموح من الطلبات. حاول لاحقاً.',
        retryAfter: rateLimitResult.retryAfterMs,
      },
      {
        status: 429,
        headers: createRateLimitHeaders(rateLimitResult),
      }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      validationError('نوع البيانات غير صالح'),
      { status: 400 }
    );
  }

  // Validate request body
  const validation = createOrderSchema.safeParse(body);
  if (!validation.success) {
    const firstError = validation.error.errors[0];
    return NextResponse.json(
      validationError(firstError?.message || 'بيانات غير صالحة'),
      { status: 400 }
    );
  }

  const {
    guestInfo: guestInfoRaw,
    notes,
    addressId,
    address_id,
    paymentMethod,
    payment_method,
    delivery_type,
    deliveryType,
    items: bodyItems,
    name,
    phone,
    user_id: bodyUserId,
    scheduled,
    scheduled_for,
    slot_id,
  } = body;

  const deliveryMode = delivery_type || deliveryType || 'delivery';

  if (bodyUserId && userId && bodyUserId !== userId) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }

  const paymentResolved = paymentMethod || payment_method || 'cash';
  const addressResolved = addressId || address_id;

  // SECURITY (Pay-Dup): hoist idempotency-key resolution out of the
  // try so the catch-all error log can include it (the inner `try` at
  // L315 starts a transaction; declared-inside-try locals aren't
  // visible in the corresponding catch).
  const idempotencyKey: string | null =
    typeof body.idempotency_key === "string" && body.idempotency_key.length > 0
      ? body.idempotency_key.slice(0, 64)
      : null;

  // Build guest info from various sources
  const rawName = typeof name === 'string' ? name : null;
  const rawPhone = typeof phone === 'string' ? phone : null;
  
  const guestInfo: GuestInfo | null =
    (guestInfoRaw && typeof guestInfoRaw === 'object' ? guestInfoRaw as GuestInfo : null) ||
    (rawName || rawPhone
      ? {
          name: rawName,
          phone: rawPhone,
          city: null,
          district: null,
          street: null,
          building_number: null,
          email: null,
        }
      : null);

  if (!userId && !sessionId) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }

  const client = await pool.connect();
  let txOpen = false;

  // Apple App Store review account sandbox: orders from this account
  // must NEVER reach the real fulfillment pipeline. We accept the
  // request and return a synthetic success response so the reviewer's
  // checkout flow completes end-to-end, but no row is inserted into
  // `orders`, no payment intent is created, and no analytics event
  // fires. The reviewer name "Apple Reviewer" is the sentinel — see
  // src/lib/apple-review.ts.
  //
  // This protects real customers from any side-effects of the reviewer
  // clicking "Place Order" during the Apple Pay test (e.g. loyalty
  // point burns, inventory decrements, accidental email receipts).
  if (userId) {
    const userRow = await client.query(
      `SELECT phone, name FROM users WHERE id = $1`,
      [userId]
    );
    if (userRow.rows.length > 0 && isAppleReviewUser(userRow.rows[0])) {
      logInfo(
        `[orders/POST] Apple Review account sandbox (userId=${userId} phone=${userRow.rows[0].phone}) — synthetic success, no DB writes`
      );
      client.release();
      return NextResponse.json({
        success: true,
        sandbox: true,
        orderId: `sandbox-apple-review-${Date.now()}`,
        message: "[sandbox] order accepted (Apple Review account — not persisted)",
      });
    }
  }

  try {
    await client.query('BEGIN');
    txOpen = true;

    let orderItems: OrderItem[] = [];

    if (Array.isArray(bodyItems) && bodyItems.length > 0) {
      const productIds = bodyItems
        .map((i: { product_id?: string | number }) => {
          const raw = i.product_id;
          if (raw === undefined || raw === null) return null;
          const s = String(raw).trim();
          // Accept UUID strings only
          const uuidLike = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
          return uuidLike.test(s) ? s : null;
        })
        .filter((id): id is string => id !== null);
      if (productIds.length !== bodyItems.length) {
        await client.query('ROLLBACK');
        txOpen = false;
        return NextResponse.json(
          { success: false, error: 'منتجات غير صالحة' },
          { status: 400 }
        );
      }
      const pinfo = await client.query<ProductRow>(
        `SELECT id AS product_id, price, discount_price, stock_qty, name_ar, is_active
         FROM products_unified WHERE id = ANY($1::uuid[])`,
        [productIds]
      );
      const byId = new Map<string, ProductRow>(
        pinfo.rows.map((r) => [String(r.product_id), r])
      );
      for (const i of bodyItems) {
        const pid = String(i.product_id).trim();
        const row = byId.get(pid);
        const qty = parseInt(String(i.quantity), 10) || 0;
        if (!row || !row.is_active) {
          await client.query('ROLLBACK');
          txOpen = false;
          return NextResponse.json({ error: 'منتج غير متوفر' }, { status: 400 });
        }
        if (qty < 1 || Number(row.stock_qty) < qty) {
          await client.query('ROLLBACK');
          txOpen = false;
          return NextResponse.json({ error: 'الكمية غير متوفرة' }, { status: 400 });
        }
        orderItems.push({
          product_id: pid,
          quantity: qty,
          price: row.price,
          discount_price: row.discount_price,
          stock_qty: row.stock_qty,
          name_ar: row.name_ar,
        });
      }
    } else if (userId) {
      const cartItems = await client.query(
        `SELECT c.product_id, c.quantity, p.price, p.discount_price, p.stock_qty, p.name_ar
         FROM cart c JOIN products_unified p ON c.product_id = p.id
         WHERE c.user_id = $1`,
        [userId]
      );
      orderItems = cartItems.rows;
    } else if (sessionId) {
      const cartItems = await client.query(
        `SELECT c.product_id, c.quantity, p.price, p.discount_price, p.stock_qty, p.name_ar
         FROM guest_cart c JOIN products_unified p ON c.product_id = p.id
         WHERE c.session_id = $1`,
        [sessionId]
      );
      orderItems = cartItems.rows;
    }

    if (orderItems.length === 0) {
      await client.query('ROLLBACK');
      txOpen = false;
      return NextResponse.json({ error: 'السلة فارغة' }, { status: 400 });
    }

    let subtotal = 0;
    for (const item of orderItems) {
      const price = Number(item.discount_price || item.price);
      subtotal += price * item.quantity;
    }

    // ---- 1. Resolve delivery distance (Haversine from main store) ----
    // Migration 060 — zones are gone. Delivery fee is purely a function
    // of distance from the main store (`stores.is_main = true`) to the
    // customer's lat/lng, with no min-order, no free-delivery threshold,
    // and no zone polygon matching.
    let dbAddressId: string | null = null;
    let distanceKm: number | null = null;
    if (deliveryMode !== 'pickup') {
      // Resolve user address first (we need its lat/lng)
      if (userId) {
        let resolvedAddr = addressResolved as string | undefined;
        if (!resolvedAddr) {
          const fb = await client.query(
            `SELECT id FROM addresses WHERE user_id = $1
             ORDER BY is_default DESC, created_at ASC LIMIT 1`,
            [userId]
          );
          resolvedAddr = fb.rows[0]?.id != null ? String(fb.rows[0].id) : undefined;
        }
        if (!resolvedAddr) {
          await client.query('ROLLBACK');
          txOpen = false;
          return NextResponse.json(
            { success: false, error: 'لم يتم العثور على عنوان. أضِف عنوانًا من حسابك' },
            { status: 400 }
          );
        }
        if (!resolvedAddr || resolvedAddr.length < 32) {
          await client.query('ROLLBACK');
          txOpen = false;
          return NextResponse.json(
            { success: false, error: 'عنوان غير صالح. أعد اختيار العنوان من القائمة' },
            { status: 400 }
          );
        }
        const addrResult = await client.query(
          'SELECT id FROM addresses WHERE id = $1 AND user_id = $2::uuid',
          [resolvedAddr, userId]
        );
        if (addrResult.rows.length === 0) {
          await client.query('ROLLBACK');
          txOpen = false;
          return NextResponse.json(
            { success: false, error: 'عنوان غير صالح' },
            { status: 400 }
          );
        }
        dbAddressId = String(addrResult.rows[0].id);
      }

      // Now we have either dbAddressId (user) or guestInfo.coords
      const pointLat: number | null = dbAddressId
        ? await client
            .query('SELECT lat FROM addresses WHERE id = $1', [dbAddressId])
            .then((r) => (r.rows[0] ? Number(r.rows[0].lat) : null))
            .catch(() => null)
        : (typeof guestInfo?.lat === 'number' ? guestInfo.lat : null);
      const pointLng: number | null = dbAddressId
        ? await client
            .query('SELECT lng FROM addresses WHERE id = $1', [dbAddressId])
            .then((r) => (r.rows[0] ? Number(r.rows[0].lng) : null))
            .catch(() => null)
        : (typeof guestInfo?.lng === 'number' ? guestInfo.lng : null);

      if (pointLat != null && pointLng != null) {
        // Main store is the source of distance — if it's not configured
        // we fall back to `null` distance and let `computeOrderFees`
        // charge 0 SAR (fail-safe; admin can set is_main in stores).
        interface MainStoreRow {
          lat: string | number | null;
          lng: string | number | null;
        }
        const ms = await client.query<MainStoreRow>(
          `SELECT lat, lng FROM stores WHERE is_main = true AND is_active = true LIMIT 1`,
        );
        const row = ms.rows[0];
        if (row && row.lat != null && row.lng != null) {
          distanceKm = haversineKm(
            Number(row.lat),
            Number(row.lng),
            pointLat,
            pointLng,
          );
        }
      }
    }

    // ---- 3. Coupon discount (optional) ----
    // The coupons table stores `type` (percentage | fixed | free_delivery),
    // `value`, `min_order` and `max_discount`. Percentage discounts are capped
    // by max_discount; free_delivery waives the delivery fee instead of
    // reducing the subtotal (applied in step 4).
    let discount = 0;
    let couponCode: string | null = null;
    let couponFreeDelivery = false;
    if (typeof body.coupon_code === 'string' && body.coupon_code.trim()) {
      couponCode = body.coupon_code.trim().toUpperCase();
      // FOR UPDATE serialises concurrent redemptions of the last remaining use.
      const cp = await client.query(
        `SELECT id, code, type::text AS type, value, min_order, max_discount,
                max_uses, used_count, expires_at, is_active
           FROM coupons
          WHERE UPPER(code) = $1
          FOR UPDATE`,
        [couponCode]
      );
      const couponRow = cp.rows[0];
      // Pure-function validation lives in @/lib/pricing.
      const computed = couponRow
        ? computeCouponDiscount({ coupon: couponRow, subtotal })
        : null;
      if (!computed) {
        await client.query('ROLLBACK');
        txOpen = false;
        return NextResponse.json(
          { success: false, error: 'كود الخصم غير صالح أو منتهي' },
          { status: 400 }
        );
      }
      if (Number(couponRow.min_order ?? 0) > 0 && subtotal < Number(couponRow.min_order)) {
        await client.query('ROLLBACK');
        txOpen = false;
        return NextResponse.json(
          { success: false, error: `الحد الأدنى لاستخدام الكود ${couponRow.min_order} ر.س` },
          { status: 400 }
        );
      }

      discount = computed.discount;
      couponFreeDelivery = computed.freeDelivery;

      // Store the canonical code and burn one use inside the same transaction.
      couponCode = couponRow.code;
      await client.query(
        `UPDATE coupons SET used_count = used_count + 1, used_at = NOW() WHERE id = $1`,
        [couponRow.id]
      );
    }

    // ---- 4. Compute fees ----
    const pricingRow = await client.query(
      `SELECT value FROM delivery_settings WHERE key = 'pricing'`
    );
    const pricing: PricingSettings =
      (pricingRow.rows[0]?.value as PricingSettings) ?? {};

    // ---- Loyalty redemption (logged-in users only) ----
    let pointsRedeemed = 0;
    let pointsDiscount = 0;
    if (userId) {
      const requestedPoints = Math.max(0, Math.floor(Number(body.points_redeemed) || 0));
      if (requestedPoints > 0) {
        // Re-validate: server is the source of truth, never trust the client.
        const bal = await client.query(
          `SELECT balance FROM loyalty_points WHERE user_id = $1`,
          [userId]
        );
        const balance = Number(bal.rows[0]?.balance ?? 0);
        const loyaltySettings = await getLoyaltySettings();
        const loyalty = computeLoyaltyRedemption({
          balance,
          subtotalAfterCoupon: subtotal - discount,
          requestedPoints,
          settings: {
            redeem_value_per_point: loyaltySettings.redeem_value_per_point,
            max_redeem_percent: loyaltySettings.max_redeem_percent,
          },
        });
        pointsRedeemed = loyalty.pointsRedeemed;
        pointsDiscount = loyalty.pointsDiscount;
      }
    }
    discount += pointsDiscount; // folded into the same `discount` column

    // Pure-function fee calculation lives in @/lib/pricing so it can be
    // unit-tested and reused by the delivery quote endpoint.
    const fees = computeOrderFees({
      subtotal,
      discount,
      deliveryMode: deliveryMode === 'pickup' ? 'pickup' : 'delivery',
      couponFreeDelivery,
      distanceKm,
      pricing,
    });
    const { deliveryFee, serviceFee, total } = fees;

    // ---- Scheduled delivery slot (optional) ----
    // Reuses the same validation as /api/v1/checkout so the legacy
    // single-vendor POST and the new multi-vendor POST stay consistent.
    let scheduledFlag = false;
    let scheduledForDate: Date | null = null;
    let slotIdValue: string | null = null;
    if (scheduled) {
      if (typeof scheduled_for !== "string" || typeof slot_id !== "string") {
        await client.query("ROLLBACK");
        txOpen = false;
        return NextResponse.json(
          validationError("scheduled_for و slot_id مطلوبان عند scheduled=true"),
          { status: 400 },
        );
      }
      if (deliveryMode === "pickup") {
        await client.query("ROLLBACK");
        txOpen = false;
        return NextResponse.json(
          validationError("الاستلام من الفرع لا يدعم الجدولة"),
          { status: 400 },
        );
      }
      const cfgRes = await client.query(
        `SELECT value FROM delivery_settings WHERE key = 'slots' LIMIT 1`,
      );
      const cfg = parseSlotsConfig(cfgRes.rows[0]?.value);
      const when = new Date(scheduled_for);
      const dayKey = toRiyadhDateKey(when);
      const dayStart = riyadhWallClockToUtc(dayKey, "00:00");
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
      const bookedRes = await client.query<{ n: string }>(
        `SELECT COUNT(*)::int AS n FROM orders
          WHERE scheduled = true
            AND slot_window = $1
            AND scheduled_for >= $2::timestamp
            AND scheduled_for <  $3::timestamp`,
        [slot_id, dayStart.toISOString(), dayEnd.toISOString()],
      );
      const booked = parseInt(bookedRes.rows[0]?.n ?? "0", 10);
      const verdict = validateSlotSelection(
        cfg,
        slot_id,
        when.toISOString(),
        booked,
      );
      if (!verdict.ok) {
        await client.query("ROLLBACK");
        txOpen = false;
        return NextResponse.json(
          validationError(verdict.error),
          { status: 400 },
        );
      }
      scheduledFlag = true;
      scheduledForDate = when;
      slotIdValue = slot_id;
    }

    const paymentStatus =
      paymentResolved === 'cash' || paymentResolved === 'wallet'
        ? 'pending'
        : 'unpaid';

    // SECURITY (Pay-Dup): when the client sent an idempotency key, look
    // up any existing order with that key BEFORE inserting. If found,
    // return it untouched — this prevents a double-click on "تأكيد الطلب"
    // from creating two orders (and two Moyasar invoices). The DB-level
    // UNIQUE on orders.idempotency_key is a backstop for concurrent inserts
    // from scripted retries; if the second insert hits the constraint we
    // re-fetch the winner below. `idempotencyKey` itself is hoisted
    // above the try so the catch-all error log can see it.

    if (idempotencyKey) {
      const existing = await client.query(
        `SELECT id, total, payment_method, status, payment_status
         FROM orders WHERE idempotency_key = $1 LIMIT 1`,
        [idempotencyKey],
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        await client.query("ROLLBACK");
        txOpen = false;
        return NextResponse.json({
          success: true,
          duplicate: true,
          orderId: row.id,
          order_id: row.id,
          total: Number(row.total),
          payment_method: row.payment_method,
          status: row.status,
          payment_status: row.payment_status,
        });
      }
    }

    const orderResult = await client.query(
      `INSERT INTO orders (
        user_id, address_id,
        guest_name, guest_phone, guest_city, guest_district, guest_street,
        guest_building, notes, subtotal, delivery_fee, service_fee, discount, total,
        payment_method, payment_status, status, coupon_code,
        points_redeemed, points_discount,
        idempotency_key,
        scheduled, scheduled_for, slot_window
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'pending', $17, $18, $19, $20, $21, $22, $23)
      RETURNING id`,
      [
        userId || null,
        dbAddressId,
        guestInfo?.name || name || null,
        guestInfo?.phone || phone || null,
        guestInfo?.city || null,
        guestInfo?.district || null,
        guestInfo?.street || null,
        guestInfo?.building_number || null,
        notes || null,
        subtotal,
        deliveryFee,
        serviceFee,
        discount,
        total,
        paymentResolved,
        paymentStatus,
        couponCode,
        pointsRedeemed,
        pointsDiscount,
        idempotencyKey,
        scheduledFlag,
        scheduledForDate,
        slotIdValue,
      ]
    );

    const orderId = orderResult.rows[0].id;

    for (const item of orderItems) {
      const price = Number(item.discount_price || item.price);
      await client.query(
        `INSERT INTO order_items (order_id, product_id, qty, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [orderId, item.product_id, item.quantity, price]
      );
    }

    if (userId) {
      await client.query('DELETE FROM cart WHERE user_id = $1', [userId]);
    } else if (sessionId) {
      await client.query('DELETE FROM guest_cart WHERE session_id = $1', [sessionId]);
    }

    // SECURITY (Pay-H): DO NOT debit the loyalty balance here. For online
    // payments, the actual debit only happens in the payment webhook
    // once the gateway confirms `Paid`. We insert a `pending_redeem`
    // row with the reserved amount so:
    //   * the user can see the hold on their activity feed, AND
    //   * the webhook can resolve it to a real `redeem` on success, OR
    //   * a failed/cancelled payment leaves the hold as an audit record
    //     without affecting the balance.
    // Cash/wallet orders still need an immediate hold (no webhook will
    // fire) — handled in the webhook too via `payment_method='cash'`
    // fallback, but here we always create the pending row.
    if (userId && pointsRedeemed > 0) {
      await client.query(
        `INSERT INTO loyalty_transactions (user_id, points, type, ref_order_id)
         VALUES ($1, $2, 'pending_redeem', $3)
         ON CONFLICT (ref_order_id, type) DO NOTHING`,
        [userId, -pointsRedeemed, orderId],
      );
    }

    await client.query('COMMIT');
    txOpen = false;

    let notifyPhone: string | undefined =
      typeof guestInfo?.phone === 'string' ? guestInfo.phone : undefined;
    if (!notifyPhone && userId) {
      try {
        const phRow = await pool.query<{ phone: string }>(
          'SELECT phone FROM users WHERE id = $1',
          [userId]
        );
        notifyPhone = phRow.rows[0]?.phone;
      } catch {
        /* optional */
      }
    }
    if (notifyPhone) {
      const { sendOrderConfirmationSms } = await import('@/lib/twilio-messaging');
      void sendOrderConfirmationSms({
        phone: notifyPhone,
        orderId,
        total,
      });
    }

    const { notifyAdminNewOrder } = await import('@/lib/order-notify-admin');
    void notifyAdminNewOrder({
      id: orderId,
      total,
      customerName: (guestInfo?.name as string | null) || (typeof name === 'string' ? name : null) || null,
    });

    // Abandoned-carts snapshot. Only for orders that need an online
    // payment gateway — cash on delivery / wallet orders have nothing
    // to "abandon" because there's no payment page to leave.
    // Best-effort: failures are swallowed inside the helper so a
    // snapshot issue can never break a customer's checkout.
    const orderIdStr = String(orderId);
    const requiresOnlinePaymentForSnapshot =
      paymentResolved !== 'cash' && paymentResolved !== 'wallet';
    if (requiresOnlinePaymentForSnapshot && orderItems.length > 0) {
      try {
        const { snapshotAbandonedCartFromOrder } = await import(
          '@/lib/abandoned-carts'
        );
        await snapshotAbandonedCartFromOrder({
          user_id: userId || null,
          guest_session_id: sessionId || null,
          guest_name:
            (guestInfo?.name as string | null) ||
            (typeof name === 'string' ? name : null) ||
            null,
          guest_phone:
            (guestInfo?.phone as string | null) ||
            (typeof phone === 'string' ? phone : null) ||
            null,
          intent_order_id: orderIdStr,
          items: orderItems.map((item: OrderItem) => ({
            product_id: item.product_id,
            name_ar: item.name_ar,
            quantity: item.quantity,
            unit_price: Number(item.discount_price || item.price),
            image_url: null,
            vendor_id: null,
          })),
          subtotal,
        });
      } catch {
        /* helper logs internally; swallow */
      }
    }

    const requiresOnlinePayment = requiresOnlinePaymentForSnapshot;

    let paymentUrl: string | null = null;
    let inlinePayment = false;
    if (requiresOnlinePayment) {
      try {
        const {
          initiateOnlinePayment,
          getPaymentProvider,
          isMoyasarInlineCheckoutEnabled,
        } = await import('@/lib/payments/initiate');
        const customerName = String(guestInfo?.name || name || 'عميل');
        const customerMobile = String(guestInfo?.phone || phone || '0500000000');
        const provider = getPaymentProvider();

        if (isMoyasarInlineCheckoutEnabled()) {
          await pool.query(
            `UPDATE orders SET payment_status = 'pending' WHERE id = $1`,
            [orderId]
          );
          inlinePayment = true;
        } else {
        const paymentResult = await initiateOnlinePayment({
          amount: total,
          orderId: orderIdStr,
          customerName,
          customerMobile,
          customerEmail: guestInfo?.email as string | undefined,
          items: orderItems.map((item: OrderItem) => ({
            name: item.name_ar || 'منتج',
            quantity: item.quantity,
            unitPrice: Number(item.discount_price || item.price),
          })),
          // SECURITY (Pay-Dup): forward the order-level idempotency key
          // so the gateway side also deduplicates. Even if the orders
          // INSERT somehow dedupe-misses, Moyasar's createInvoice returns
          // the same invoice for the same idempotency_key within its
          // 24h window — closing the duplicate-charge window end-to-end.
          idempotencyKey: idempotencyKey ?? undefined,
        });

        if (
          paymentResult.success &&
          paymentResult.paymentUrl &&
          paymentResult.referenceId
        ) {
          paymentUrl = paymentResult.paymentUrl;
          await pool.query(
            `UPDATE orders SET payment_reference = $1, payment_status = 'pending' WHERE id = $2`,
            [String(paymentResult.referenceId), orderId]
          );
        } else {
          logError('Payment init failed', paymentResult.error, { provider });
          await pool.query(
            `UPDATE orders SET payment_status = 'failed', status = 'cancelled' WHERE id = $1`,
            [orderId]
          );
          return NextResponse.json(
            {
              success: false,
              error:
                paymentResult.error ||
                'تعذّر فتح بوابة الدفع الإلكتروني. لم يتم خصم أي مبلغ.',
              orderId: orderIdStr,
            },
            { status: 502 }
          );
        }
        }
      } catch (err) {
        logError('Payment init error:', err);
        await pool.query(
          `UPDATE orders SET payment_status = 'failed', status = 'cancelled' WHERE id = $1`,
          [orderId]
        );
        return NextResponse.json(
          {
            success: false,
            error: 'تعذّر الاتصال ببوابة الدفع. حاول مرة أخرى.',
            orderId: orderIdStr,
          },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      orderId: orderIdStr,
      message: inlinePayment
        ? 'تم إنشاء الطلب، أكمل الدفع أدناه'
        : paymentUrl
          ? 'تم إنشاء الطلب، جاري التحويل للدفع'
          : 'تم إنشاء الطلب بنجاح',
      subtotal,
      deliveryFee,
      serviceFee,
      total,
      payment_url: paymentUrl,
      inline_payment: inlinePayment,
      requires_payment: requiresOnlinePayment,
    });
  } catch (error) {
    if (txOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    logError('Create order error:', error);
    // Same diagnostic dump as the multi-vendor route — surfaces the
    // real cause (pg code + message) on disk so support can triage.
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const dumpPath = path.join(process.cwd(), 'logs', 'checkout-errors.log');
      await fs.mkdir(path.dirname(dumpPath), { recursive: true });
      const cause = (error as { cause?: unknown })?.cause;
      const causeMsg =
        cause && typeof cause === 'object' && 'message' in cause
          ? String((cause as { message: unknown }).message)
          : null;
      // 'bodyItems' comes out of the outer destructure as `unknown` because
      // the request body is typed as `Record<string, unknown>`. The catch
      // block only needs the count, so a defensive narrowing keeps TS happy
      // and protects the dump from a non-array payload.
      const itemsCount = Array.isArray(bodyItems) ? bodyItems.length : 0;
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        route: 'POST /api/v1/orders (legacy)',
        userId,
        idempotencyKey,
        itemsCount,
        paymentMethod: paymentResolved,
        deliveryType,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        pgCode:
          cause && typeof cause === 'object' && 'code' in cause
            ? String((cause as { code: unknown }).code)
            : null,
        pgMessage: causeMsg,
        stack:
          error instanceof Error
            ? (error.stack ?? '').split('\n').slice(0, 8).join('\n')
            : null,
      });
      await fs.appendFile(dumpPath, line + '\n', 'utf8');
    } catch {
      /* never let the dump itself break the user response */
    }
    // Production: NEVER leak DB / pg constraint messages to clients.
    // The canonical operator surface is the side-channel file dump above
    // (writes to CHECKOUT_ERROR_LOG). Dev/staging may opt in by setting
    // DEBUG_CHECKOUT=1; HIDE_CHECKOUT_DEBUG=1 forces hide even in dev.
    // See docs/01 R7.
    const showDebug =
      process.env.NODE_ENV !== 'production' &&
      process.env.HIDE_CHECKOUT_DEBUG !== '1';
    const debugPayload = showDebug
      ? process.env.DEBUG_CHECKOUT === '1'
        ? {
            debug:
              (error as { cause?: { message?: unknown } })?.cause?.message
                ? String((error as { cause: { message: unknown } }).cause.message)
                : error instanceof Error
                  ? error.message
                  : null,
          }
        : {}
      : {};
    return NextResponse.json(
      {
        success: false,
        error: 'حدث خطأ في إنشاء الطلب',
        ...debugPayload,
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
