import { NextRequest, NextResponse } from 'next/server';
import { pool, query } from '@/lib/db';
import {
  resolveCustomerUserIdFromRequest,
  getGuestSessionIdFromRequest,
} from '@/lib/identity';
import { createAddress as createAddressService } from '@/lib/identity/address-service';
import { createRateLimitHeaders, checkRateLimit, ORDER_CREATE_CONFIG } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { error as logError } from '@/lib/logger';
import { BRAND } from '@/lib/brand-theme';
import { directOrderSchema } from '@/lib/validation';
import { isAppleReviewUser } from '@/lib/apple-review';
import { sendOrderConfirmationSms } from '@/lib/twilio-messaging';
import { NON_ELECTRONIC_METHODS } from '@/lib/payments/payment-methods';

/**
 * POST /api/v1/orders/direct
 *
 * Create a "direct order" — the customer picks a delivery address,
 * payment method, notes, optionally records a voice message, and
 * confirms the 4 SAR service fee.
 *
 * Body:
 *   - payment_method: 'mada' | 'visa' | 'mastercard' | 'amex' | 'apple_pay' | 'wallet' | 'bank_transfer'
 *   - notes: optional text (max 700 chars)
 *   - voice_note_url: optional uploaded audio URL
 *   - voice_note_duration: optional seconds
 *   - fee_acknowledged: must be true (4 SAR fee popup confirmation)
 *   - delivery_address: { label, address_text, lat, lng, plus_code, city, district, description, place_images }
 *   - items: optional array of { product_id?, free_text, quantity, notes }
 *
 * Response: { success: true, orderId, orderNumber }
 */

const DIRECT_SERVICE_FEE_SAR = 4;
const DIRECT_TAX_RATE = 0.15;

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`direct-order:${ip}`, ORDER_CREATE_CONFIG);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'تجاوزت الحد المسموح، حاول لاحقاً' },
      { status: 429, headers: createRateLimitHeaders(rl) }
    );
  }

  const userId = await resolveCustomerUserIdFromRequest(request);

  // SECURITY: Direct orders require login. Guest ordering is removed
  // because the full flow (payment, chat, cleanup) requires auth.
  if (!userId) {
    return NextResponse.json(
      { success: false, error: 'يجب تسجيل الدخول لإنشاء طلب مباشر' },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'بيانات غير صالحة' }, { status: 400 });
  }

  const parsed = directOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  // Idempotency key optional for authed users (dedupes double-taps)
  const idempotencyKey = data.idempotency_key
    ? data.idempotency_key.slice(0, 64)
    : null;

  // P1-10 (full-system audit 2026-09-30): the previous `const apple =
  // false` made this branch unreachable. Mirrors the catalog orders
  // route (`src/app/api/v1/orders/route.ts`) which checks the
  // authenticated user via `isAppleReviewUser` and returns a synthetic
  // sandbox response for Apple's review team. Standardised so both
  // legacy catalog and direct order routes share the same gating.
  //
  // We need the user's name+phone (not just the id) for the gate —
  // `isAppleReviewUser` matches on `name` / `phone`, so a single
  // SELECT runs before pool.connect() to avoid taking a transaction
  // on the sandbox short-circuit.
  if (userId) {
    const userRow = await query<{ name: string | null; phone: string | null }>(
      `SELECT name, phone FROM users WHERE id = $1`,
      [userId],
    );
    if (userRow.rows[0] && isAppleReviewUser(userRow.rows[0])) {
      return NextResponse.json(
        {
          success: true,
          sandbox: true,
          orderId: `sandbox-direct-${Date.now()}`,
          orderNumber: `DR-SBX-${Date.now()}`,
        },
        { status: 200 }
      );
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // SECURITY: idempotency dedupe for authed users.
    // A double-tap on the "تأكيد الطلب" button would otherwise
    // create two orders. Return the existing order if found.
    if (idempotencyKey) {
      const existing = await client.query(
        `SELECT id, tracking_code AS order_number FROM orders
         WHERE idempotency_key = $1
           AND user_id = $2
         LIMIT 1`,
        [idempotencyKey, userId]
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            success: true,
            duplicate: true,
            orderId: existing.rows[0].id,
            orderNumber: existing.rows[0].order_number,
          },
          { status: 200 }
        );
      }
    }

    // 1) Create the address. Direct orders require login, so no guest path.
    //
    // Delegate to the canonical address service which auto-promotes
    // the first address to default (good for one-off direct orders).
    // The service only writes valid columns (label, address_text, lat, lng).
    //
    // Title fallback: the direct-order Zod schema has no `title` field,
    // so we let the service's resolveTitle ladder compute it.
    const addr = data.delivery_address;
    const addrRow = await createAddressService(
      { kind: "user" as const, userId },
      {
      label: addr.label,
      title: null,
      description: typeof addr.description === "string" ? addr.description : null,
      lat: Number(addr.lat),
      lng: Number(addr.lng),
      address_text: addr.address_text,
      place_images: Array.isArray(addr.place_images) ? addr.place_images : [],
    });
    const addressId: string = addrRow.id;

    // 2) Compute totals — direct orders charge the customer ONLY the 4 SAR
    //    service fee + 15% VAT. Items' actual cost is reconciled by the
    //    admin/driver after picking. We capture zero for line items so
    //    the catalog accounting stays clean.
    const serviceFee = DIRECT_SERVICE_FEE_SAR;
    const tax = +(serviceFee * DIRECT_TAX_RATE).toFixed(2);
    const subtotal = 0;
    const deliveryFee = 0;
    const total = +(serviceFee + tax).toFixed(2);

    // 3) Create the order.
    //
    // P1-11 (full-system audit 2026-09-30): mirror the catalog route
    // (`src/app/api/v1/orders/route.ts:680`) — initial `payment_status`
    // is `'unpaid'` for electronic methods (Moyasar card / Apple Pay)
    // so the admin/finance dashboards can distinguish "awaiting
    // gateway" from "manual / no-gateway" without inspecting
    // `payment_method`. Non-electronic methods (wallet / bank_transfer)
    // stay `'pending'` because no gateway call will follow.
    const initialPaymentStatus = NON_ELECTRONIC_METHODS.has(data.payment_method)
      ? 'pending'
      : 'unpaid';
    const orderRes = await client.query(
      `INSERT INTO orders
        (user_id, address_id, status, type,
         subtotal, delivery_fee, service_fee, tax, total,
         payment_method, payment_status, notes,
         voice_note_url, voice_note_duration,
         idempotency_key)
       VALUES ($1, $2, 'pending', 'direct',
               $3, $4, $5, $6, $7,
               $8, $9, $10,
               $11, $12,
               $13)
       RETURNING id, tracking_code AS order_number`,
      [
        userId ?? null,
        addressId,
        subtotal,
        deliveryFee,
        serviceFee,
        tax,
        total,
        data.payment_method,
        initialPaymentStatus,
        data.notes ?? null,
        data.voice_note_url || null,
        data.voice_note_duration ?? null,
        idempotencyKey,
      ]
    );
    const orderId: string = orderRes.rows[0].id;
    const orderNumber: string = orderRes.rows[0].order_number;

    // 4) Insert direct_order_meta (lat/lng for map display + fee ack).
    await client.query(
      `INSERT INTO direct_order_meta
        (order_id, delivery_lat, delivery_lng, delivery_plus_code,
         city, district, fee_acknowledged)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
      [
        orderId,
        addr.lat,
        addr.lng,
        addr.plus_code ?? null,
        addr.city ?? null,
        addr.district ?? null,
      ]
    );

    // 5) Insert direct_order_items (catalog product or free_text).
    for (const it of data.items ?? []) {
      if (!it.product_id && !it.free_text) continue;
      await client.query(
        `INSERT INTO direct_order_items
          (order_id, product_id, free_text, quantity, unit_price, notes)
         VALUES ($1, $2, $3, $4, 0, $5)`,
        [orderId, it.product_id ?? null, it.free_text ?? null, it.quantity, it.notes ?? null]
      );
    }

    // 6) System message: order created.
    await client.query(
      `INSERT INTO direct_order_messages
        (order_id, sender_type, body, message_kind)
       VALUES ($1, 'system', $2, 'system')`,
      [
        orderId,
        `تم استلام طلبك المباشر ${orderNumber} — رسوم الخدمة ${serviceFee.toFixed(2)} ر.س شامل الضريبة`,
      ]
    );

    await client.query('COMMIT');

    // Async post-commit tasks (fire-and-forget):
    // 1) Send customer SMS confirmation
    // 2) Notify admin via WhatsApp
    Promise.all([
      (async () => {
        try {
          const phRow = await query<{ phone: string }>(
            'SELECT phone FROM users WHERE id = $1',
            [userId]
          );
          const notifyPhone = phRow.rows[0]?.phone;
          if (notifyPhone) {
            await sendOrderConfirmationSms({
              phone: notifyPhone,
              orderId,
              total,
            });
          }
        } catch (smsErr) {
          logError('direct-order SMS confirmation failed', smsErr, { orderId });
        }
      })(),
      (async () => {
        try {
          // Fetch customer name for the notification
          const userRow = await query<{ name: string | null }>(
            'SELECT name FROM users WHERE id = $1',
            [userId]
          );
          const customerName = userRow.rows[0]?.name || null;

          // Notify admin via WhatsApp
          const { notifyAdminNewOrder } = await import('@/lib/orders/order-notify-admin');
          await notifyAdminNewOrder({
            id: orderNumber,
            total,
            customerName,
          });
        } catch (adminErr) {
          logError('direct-order admin notification failed', adminErr, { orderId });
        }
      })(),
    ]).catch(() => {
      /* suppress errors, tasks logged individually */
    });

    return NextResponse.json(
      {
        success: true,
        orderId,
        orderNumber,
        serviceFee,
        tax,
        total,
      },
      { status: 201 }
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logError('direct order create failed', err);
    return NextResponse.json(
      { success: false, error: 'تعذر إنشاء الطلب المباشر، حاول لاحقاً' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

/** GET: returns the direct-service-fee config + a sample draft. */
export async function GET(_request: NextRequest) {
  return NextResponse.json({
    success: true,
    fee: DIRECT_SERVICE_FEE_SAR,
    taxRate: DIRECT_TAX_RATE,
    minOrder: 0,
    brand: BRAND.brandGreen,
    notesLimit: 700,
    voiceOptional: true,
  });
}