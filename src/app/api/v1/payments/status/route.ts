import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import { getClientIp } from '@/lib/request-ip';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';
import {
  checkRateLimit,
  PAYMENT_STATUS_CONFIG,
  PAYMENT_STATUS_IP_CONFIG,
} from '@/lib/rate-limit';

/** حالة دفع طلب للعميل بعد العودة من ميسر */
export async function GET(request: NextRequest) {
  // BUGFIX (audit 2026-09-29): rate-limit the poll. /checkout/success polls
  // every ~3s; without this cap a malicious/buggy client can hammer the
  // endpoint indefinitely. Two independent buckets (per-user + per-IP)
  // mirror the payment-initiate pattern. IP check runs BEFORE auth so
  // even unauthenticated traffic gets bucketed.
  const clientIp = getClientIp(request);
  const ipLimit = await checkRateLimit(clientIp, PAYMENT_STATUS_IP_CONFIG);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: 'طلبات كثيرة، حاول بعد قليل' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((ipLimit.retryAfterMs ?? 0) / 1000)) },
      }
    );
  }

  // SECURITY (C4 RBAC): previously this endpoint leaked any order's
  // payment status whenever the caller was unauthenticated OR the order
  // belonged to a guest. We now require authentication and refuse to
  // return status for orders the caller does not own.
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  const userLimit = await checkRateLimit(userId, PAYMENT_STATUS_CONFIG);
  if (!userLimit.allowed) {
    return NextResponse.json(
      { error: 'طلبات كثيرة، حاول بعد قليل' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((userLimit.retryAfterMs ?? 0) / 1000)) },
      }
    );
  }

  const orderId = new URL(request.url).searchParams.get('order_id');

  if (!orderId) {
    return NextResponse.json({ error: 'order_id مطلوب' }, { status: 400 });
  }

  try {
    // Single query: fetch the order AND enforce ownership in one shot.
    // The "WHERE user_id = $2" clause makes it impossible to read another
    // user's order — even if the user_id column were null, the row would
    // simply not match.
    const result = await pool.query(
      `SELECT id, status, payment_status, payment_method, payment_reference, total
       FROM orders WHERE id = $1 AND user_id = $2`,
      [orderId, userId]
    );

    if (result.rows.length === 0) {
      // Don't leak whether the order exists vs. isn't owned by caller.
      return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
    }

    // Also fetch line items so the success page can fire a fully
    // populated Meta Pixel Purchase event (content_ids, num_items,
    // content_type=product). Required for Meta conversion tracking.
    //
    // Column names: `order_items` uses `qty` / `unit_price` (not
    // `quantity` / `price`). The earlier query aliased these to the names
    // the client expects, but the SELECT list still uses the DB names.
    const itemsRes = await pool.query(
      `SELECT
         oi.product_id::text AS product_id,
         COALESCE(NULLIF(p.name_ar, ''), NULLIF(p.name_en, ''), 'منتج') AS name,
         oi.qty AS quantity,
         COALESCE(oi.unit_price, 0)::numeric AS price
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1
       ORDER BY oi.id`,
      [orderId]
    );

    const row = result.rows[0] as {
      id: string;
      status: string;
      payment_status: string | null;
      payment_method: string | null;
      total: string | number;
    };

    const total = Number(row.total);
    return NextResponse.json({
      success: true,
      order_id: row.id,
      status: row.status,
      payment_status: row.payment_status || 'pending',
      payment_method: row.payment_method,
      // Server-authoritative total so /checkout/pay can mount the
      // inline form without trusting any client-supplied value.
      total: Number.isFinite(total) ? total : 0,
      // Line items needed by /checkout/success to build the Meta Pixel
      // Purchase event (content_ids, num_items, value, currency).
      items: itemsRes.rows.map((r) => ({
        product_id: String(r.product_id ?? ''),
        name: String(r.name ?? ''),
        quantity: Number(r.quantity ?? 1),
        price: Number(r.price ?? 0),
      })),
    });
  } catch (error) {
    logError('Payment status error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  }
}
