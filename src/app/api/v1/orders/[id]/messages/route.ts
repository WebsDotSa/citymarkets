import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import {
  assertOrderOwnership,
  idempotencyKeyFromBody,
  idempotencyKeyFromQuery,
} from '@/lib/orders';
import { checkRateLimit, ORDER_CREATE_CONFIG, createRateLimitHeaders } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { error as logError } from '@/lib/logger';
import { orderMessagePostSchema as postBodySchema } from '@/lib/validation';

import { validateUuidOrError } from "@/lib/api/uuid-guard";
const MESSAGES_PER_MIN = 30;

/**
 * GET  /api/v1/orders/[id]/messages  → list messages for the customer's order
 * POST /api/v1/orders/[id]/messages  → customer sends a new message
 *
 * SECURITY (F1): both verbs require positive ownership proof via
 * `assertOrderOwnership` (JWT user_id match OR matching
 * idempotency_key). The previous `ensureOrderAccess` allowed any
 * caller through on guest orders.
 */

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await ctx.params;
  const badId = validateUuidOrError(orderId, "معرّف الطلب");
  if (badId) return badId;
  const userId = await resolveCustomerUserIdFromRequest(request);
  const url = new URL(request.url);

  const client = await pool.connect();
  try {
    // SECURITY (F1): positive ownership proof. Guest callers pass the
    // order's idempotency_key via `?key=...` (or `?idempotency_key=...`).
    const ownership = await assertOrderOwnership({
      orderId,
      userId,
      providedIdempotencyKey: idempotencyKeyFromQuery(url),
      client,
    });
    if (!ownership.ok) {
      return NextResponse.json(
        { success: false, error: ownership.error },
        { status: ownership.code }
      );
    }

    const sinceParam = url.searchParams.get('since');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 200);

    const params: unknown[] = [orderId, limit];
    let sinceClause = '';
    if (sinceParam) {
      params.push(sinceParam);
      sinceClause = `AND m.created_at > $3`;
    }

    const res = await client.query(
      `SELECT m.id, m.sender_type, m.sender_user_id::text, m.sender_admin_id::text,
              m.body, m.audio_url, m.audio_duration, m.message_kind,
              m.read_by_customer_at, m.read_by_admin_at, m.created_at,
              au.name as admin_name
       FROM direct_order_messages m
       LEFT JOIN admin_users au ON au.id = m.sender_admin_id
       WHERE m.order_id = $1 ${sinceClause}
       ORDER BY m.created_at ASC
       LIMIT $2`,
      params
    );

    // Mark admin messages as read by customer.
    await client.query(
      `UPDATE direct_order_messages
         SET read_by_customer_at = NOW()
       WHERE order_id = $1
         AND sender_type IN ('admin','system')
         AND read_by_customer_at IS NULL`,
      [orderId]
    );

    return NextResponse.json({
      success: true,
      messages: res.rows.map((r) => ({
        id: r.id,
        sender_type: r.sender_type,
        sender_user_id: r.sender_user_id,
        sender_admin_id: r.sender_admin_id,
        admin_name: r.admin_name,
        body: r.body,
        audio_url: r.audio_url,
        audio_duration: r.audio_duration,
        message_kind: r.message_kind,
        created_at: r.created_at,
      })),
      orderStatus: ownership.status,
    });
  } catch (err) {
    logError('direct messages GET failed', err, { orderId });
    return NextResponse.json({ success: false, error: 'تعذر تحميل الرسائل' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await ctx.params;
  const badId = validateUuidOrError(orderId, "معرّف الطلب");
  if (badId) return badId;
  const userId = await resolveCustomerUserIdFromRequest(request);
  const ip = getClientIp(request);

  const rl = await checkRateLimit(`direct-msg:${ip}`, ORDER_CREATE_CONFIG);
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
  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'بيانات غير صالحة', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;
  if (!data.body && !data.audio_url) {
    return NextResponse.json(
      { success: false, error: 'أرسل نص أو مقطع صوتي' },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    // SECURITY (F1): positive ownership proof. Guest callers pass the
    // order's idempotency_key in the request body.
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

    // Block messages on terminal statuses.
    if (['cancelled', 'delivered', 'returned'].includes(ownership.status)) {
      return NextResponse.json(
        { success: false, error: 'لا يمكن مراسلة هذا الطلب بعد إتمامه' },
        { status: 409 }
      );
    }

    const ins = await client.query(
      `INSERT INTO direct_order_messages
        (order_id, sender_type, sender_user_id, body, audio_url, audio_duration, message_kind)
       VALUES ($1, 'customer', $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [
        orderId,
        userId ?? null,
        data.body ?? null,
        data.audio_url || null,
        data.audio_duration ?? null,
        data.message_kind,
      ]
    );

    // Touch last_edited_at / customer_edited markers (edit flag).
    await client.query(
      `UPDATE direct_order_meta
         SET last_edited_at = NOW(),
             customer_edited = TRUE,
             updated_at = NOW()
       WHERE order_id = $1`,
      [orderId]
    );

    return NextResponse.json(
      {
        success: true,
        id: ins.rows[0].id,
        created_at: ins.rows[0].created_at,
      },
      { status: 201 }
    );
  } catch (err) {
    logError('direct messages POST failed', err, { orderId });
    return NextResponse.json({ success: false, error: 'تعذر إرسال الرسالة' }, { status: 500 });
  } finally {
    client.release();
  }
}