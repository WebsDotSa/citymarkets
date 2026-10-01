import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import {
  assertOrderOwnership,
  idempotencyKeyFromQuery,
} from '@/lib/orders';
import { error as logError } from '@/lib/logger';
import {
  ORDER_BASE_COLUMNS,
  ORDER_ADDRESS_COLUMNS,
  ORDER_USER_COLUMNS,
  ORDER_DETAIL_JOINS_WITH_META,
} from '@/lib/orders/sql-fragments';

/**
 * GET /api/v1/orders/[id]
 *
 * Returns order detail for the customer's /orders/track/[id] page.
 * Includes direct-order items + chat metadata when the order is type='direct'.
 *
 * SECURITY (F1): ownership is now a positive proof — either the caller's
 * JWT user_id matches the order's user_id, OR the caller provides the
 * order's `idempotency_key` (query param `key` or `idempotency_key`) for
 * a guest order. The previous check silently skipped guest orders.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await ctx.params;
  const userId = await resolveCustomerUserIdFromRequest(request);
  const url = new URL(request.url);
  const guestKey = idempotencyKeyFromQuery(url);

  const client = await pool.connect();
  try {
    const ord = await client.query(
      `SELECT ${ORDER_BASE_COLUMNS},
              o.tracking_code AS order_number, o.type,
              o.voice_note_url, o.voice_note_duration,
              o.user_id::text as user_id,
              ${ORDER_ADDRESS_COLUMNS},
              ${ORDER_USER_COLUMNS},
              m.delivery_lat, m.delivery_lng, m.delivery_plus_code, m.city, m.district,
              m.customer_edited, m.last_edited_at, m.fee_acknowledged
       ${ORDER_DETAIL_JOINS_WITH_META}
       WHERE o.id = $1
       LIMIT 1`,
      [orderId]
    );
    if (ord.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
    }
    const o = ord.rows[0];

    // SECURITY (F1): positive ownership proof. The previous negative
    // check (`if user_id && user_id !== me`) silently let any caller
    // through on a guest order (user_id IS NULL). Now we require
    // either the JWT-issued user_id to match, or a matching
    // idempotency_key for guest orders.
    const ownership = await assertOrderOwnership({
      orderId,
      userId,
      providedIdempotencyKey: guestKey,
      client,
      select: `id, user_id::text as user_id, status, idempotency_key`,
    });
    if (!ownership.ok) {
      return NextResponse.json(
        { success: false, error: ownership.error },
        { status: ownership.code }
      );
    }

    const items = await client.query(
      `SELECT i.id, i.product_id, p.name_ar, p.image_url, p.price::float,
              i.free_text, i.quantity, i.unit_price::float, i.notes,
              i.resolved_price::float, i.resolved_product_id, i.resolved_at
       FROM direct_order_items i
       LEFT JOIN products p ON p.id = i.product_id
       WHERE i.order_id = $1
       ORDER BY i.created_at ASC`,
      [orderId]
    );

    const chatSummary = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE sender_type IN ('admin','system') AND read_by_customer_at IS NULL) AS unread,
         COUNT(*) AS total
       FROM direct_order_messages
       WHERE order_id = $1`,
      [orderId]
    );

    return NextResponse.json({
      success: true,
      order: {
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        type: o.type,
        subtotal: o.subtotal,
        delivery_fee: o.delivery_fee,
        service_fee: o.service_fee,
        tax: o.tax,
        discount: o.discount,
        total: o.total,
        payment_method: o.payment_method,
        payment_status: o.payment_status,
        notes: o.notes,
        created_at: o.created_at,
        updated_at: o.updated_at,
        scheduled: o.scheduled,
        scheduled_for: o.scheduled_for,
        slot_window: o.slot_window,
        voice_note_url: o.voice_note_url,
        voice_note_duration: o.voice_note_duration,
        address: {
          label: o.address_label,
          text: o.address_text,
          lat: o.address_lat ?? o.delivery_lat,
          lng: o.address_lng ?? o.delivery_lng,
          plus_code: o.address_plus_code ?? o.delivery_plus_code,
          description: o.address_description,
          place_images: o.address_place_images,
          city: o.city,
          district: o.district,
        },
        direct_meta: o.type === 'direct' ? {
          customer_edited: o.customer_edited,
          last_edited_at: o.last_edited_at,
          fee_acknowledged: o.fee_acknowledged,
        } : null,
        customer_name: o.user_name || o.guest_name || null,
        customer_phone: o.user_phone || o.guest_phone || null,
      },
      items: items.rows.map((i) => ({
        id: i.id,
        product_id: i.product_id,
        name_ar: i.name_ar,
        image_url: i.image_url,
        price: i.price,
        free_text: i.free_text,
        quantity: i.quantity,
        unit_price: i.unit_price,
        notes: i.notes,
        resolved_price: i.resolved_price,
        resolved_at: i.resolved_at,
      })),
      chat: {
        unread: parseInt(chatSummary.rows[0].un as string, 10) || 0,
        total: parseInt(chatSummary.rows[0].total as string, 10) || 0,
      },
    });
  } catch (err) {
    logError('order detail GET failed', err);
    return NextResponse.json({ success: false, error: 'تعذر التحميل' }, { status: 500 });
  } finally {
    client.release();
  }
}