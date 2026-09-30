import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import {
  assertOrderOwnership,
  idempotencyKeyFromBody,
  idempotencyKeyFromQuery,
  isDirectOrderCustomerEditable,
} from '@/lib/orders';
import { checkRateLimit, ORDER_CREATE_CONFIG, createRateLimitHeaders } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { error as logError } from '@/lib/logger';
import {
  orderItemAddSchema as addItemSchema,
  orderItemUpdateSchema as updateItemSchema,
} from '@/lib/validation';

/**
 * POST /api/v1/orders/[id]/items
 *
 * Customer adds a new line to their direct order. Order must be in
 * status is customer-editable (`isDirectOrderCustomerEditable`: pending or
 * shopping — locked once the driver picks it up).
 *
 * SECURITY (F1): ownership is a positive proof via
 * `assertOrderOwnership`. Guest callers MUST include the order's
 * idempotency_key in the request body.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await ctx.params;
  const userId = await resolveCustomerUserIdFromRequest(request);
  const ip = getClientIp(request);

  const rl = await checkRateLimit(`direct-add-item:${ip}`, ORDER_CREATE_CONFIG);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'تجاوزت الحد المسموح' },
      { status: 429, headers: createRateLimitHeaders(rl) }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'بيانات غير صالحة' }, { status: 400 });
  }
  const parsed = addItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;
  if (!data.product_id && !data.free_text) {
    return NextResponse.json(
      { success: false, error: 'حدد منتج أو اكتب طلبك' },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    // SECURITY (F1): single positive ownership check covers both
    // logged-in and guest paths. We pull `type` here too so we can
    // enforce the direct-only invariant without a second round-trip.
    const ownership = await assertOrderOwnership({
      orderId,
      userId,
      providedIdempotencyKey: idempotencyKeyFromBody(body),
      client,
      select: `id, user_id::text as user_id, status, type, idempotency_key`,
    });
    if (!ownership.ok) {
      return NextResponse.json(
        { success: false, error: ownership.error },
        { status: ownership.code }
      );
    }
    const typeRes = await client.query(
      `SELECT type, status FROM orders WHERE id = $1`,
      [orderId]
    );
    const o = typeRes.rows[0];
    if (o?.type !== 'direct') {
      return NextResponse.json(
        { success: false, error: 'هذا الإجراء للطلبات المباشرة فقط' },
        { status: 400 }
      );
    }
    if (!isDirectOrderCustomerEditable(o.status)) {
      return NextResponse.json(
        { success: false, error: 'لا يمكن تعديل الطلب في هذه المرحلة' },
        { status: 409 }
      );
    }

    const ins = await client.query(
      `INSERT INTO direct_order_items
        (order_id, product_id, free_text, quantity, unit_price, notes)
       VALUES ($1, $2, $3, $4, 0, $5)
       RETURNING id`,
      [orderId, data.product_id ?? null, data.free_text ?? null, data.quantity, data.notes ?? null]
    );

    await client.query(
      `UPDATE direct_order_meta
         SET customer_edited = TRUE, last_edited_at = NOW(), updated_at = NOW()
       WHERE order_id = $1`,
      [orderId]
    );

    // System message in chat.
    await client.query(
      `INSERT INTO direct_order_messages
        (order_id, sender_type, body, message_kind)
       VALUES ($1, 'system', $2, 'system')`,
      [orderId, `أضاف العميل عنصراً جديداً: ${data.free_text || ('منتج #' + (data.product_id || '').slice(0, 8))}`]
    );

    return NextResponse.json(
      { success: true, itemId: ins.rows[0].id },
      { status: 201 }
    );
  } catch (err) {
    logError('add direct item failed', err, { orderId });
    return NextResponse.json({ success: false, error: 'تعذر الإضافة' }, { status: 500 });
  } finally {
    client.release();
  }
}

/**
 * PATCH /api/v1/orders/[id]/items?itemId=...
  */
export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await ctx.params;
  const url = new URL(request.url);
  const itemId = url.searchParams.get('itemId');
  if (!itemId) {
    return NextResponse.json({ success: false, error: 'معرّف العنصر مطلوب' }, { status: 400 });
  }
  const userId = await resolveCustomerUserIdFromRequest(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'بيانات غير صالحة' }, { status: 400 });
  }
  const parsed = updateItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'بيانات غير صالحة' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    // SECURITY (F1): positive ownership proof.
    const ownership = await assertOrderOwnership({
      orderId,
      userId,
      providedIdempotencyKey: idempotencyKeyFromBody(body),
      client,
    });
    if (!ownership.ok) {
      return NextResponse.json(
        { success: false, error: ownership.error },
        { status: ownership.code }
      );
    }
    if (!isDirectOrderCustomerEditable(ownership.status)) {
      return NextResponse.json(
        { success: false, error: 'لا يمكن تعديل الطلب في هذه المرحلة' },
        { status: 409 }
      );
    }
    await client.query(
      `UPDATE direct_order_items
         SET quantity = COALESCE($3, quantity),
             notes = COALESCE($4, notes),
             free_text = COALESCE($5, free_text)
       WHERE id = $1 AND order_id = $2`,
      [itemId, orderId, parsed.data.quantity ?? null, parsed.data.notes ?? null, parsed.data.free_text ?? null]
    );
    await client.query(
      `UPDATE direct_order_meta
         SET customer_edited = TRUE, last_edited_at = NOW(), updated_at = NOW()
       WHERE order_id = $1`,
      [orderId]
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    logError('update direct item failed', err);
    return NextResponse.json({ success: false, error: 'تعذر التحديث' }, { status: 500 });
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/v1/orders/[id]/items?itemId=...
 */
export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await ctx.params;
  const url = new URL(request.url);
  const itemId = url.searchParams.get('itemId');
  if (!itemId) {
    return NextResponse.json({ success: false, error: 'معرّف العنصر مطلوب' }, { status: 400 });
  }
  const userId = await resolveCustomerUserIdFromRequest(request);

  // SECURITY (F1): accept the idempotency_key from the query string
  // (?key=...) for DELETE since clients vary in body support for
  // DELETE. Fall back to body when present.
  let guestKey = idempotencyKeyFromQuery(url);
  if (!guestKey) {
    try {
      const body = await request.clone().json();
      guestKey = idempotencyKeyFromBody(body);
    } catch {
      guestKey = null;
    }
  }
  const client = await pool.connect();
  try {
    const ownership = await assertOrderOwnership({
      orderId,
      userId,
      providedIdempotencyKey: guestKey,
      client,
    });
    if (!ownership.ok) {
      return NextResponse.json(
        { success: false, error: ownership.error },
        { status: ownership.code }
      );
    }
    if (!isDirectOrderCustomerEditable(ownership.status)) {
      return NextResponse.json(
        { success: false, error: 'لا يمكن تعديل الطلب في هذه المرحلة' },
        { status: 409 }
      );
    }
    await client.query(
      `DELETE FROM direct_order_items WHERE id = $1 AND order_id = $2`,
      [itemId, orderId]
    );
    await client.query(
      `UPDATE direct_order_meta
         SET customer_edited = TRUE, last_edited_at = NOW(), updated_at = NOW()
       WHERE order_id = $1`,
      [orderId]
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    logError('delete direct item failed', err);
    return NextResponse.json({ success: false, error: 'تعذر الحذف' }, { status: 500 });
  } finally {
    client.release();
  }
}