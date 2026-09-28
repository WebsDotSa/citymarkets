import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { createInvoice } from '@/lib/payments/moyasar';
import { resolveCustomerUserIdFromRequest } from '@/lib/customer-session';
import {
  checkRateLimit,
  PAYMENT_INITIATE_CONFIG,
  PAYMENT_INITIATE_IP_CONFIG,
  createRateLimitHeaders,
} from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

function rateLimitResponse(
  result: { retryAfterMs?: number; remaining: number; resetAt: number },
  message: string,
  by: 'user' | 'ip'
) {
  const response = NextResponse.json(
    {
      error: message,
      retryAfter: Math.ceil((result.retryAfterMs || 0) / 1000),
    },
    { status: 429 }
  );
  Object.entries(createRateLimitHeaders(result as any)).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  response.headers.set('X-RateLimit-By', by);
  return response;
}

export async function POST(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
  }

  // Per-user cap first: each call creates a paid gateway invoice, so
  // unlimited calls would burn provider quota and accrue fees. Distinct
  // bucket from the IP limit (different keyPrefix) so the two never
  // collapse into one.
  const userLimit = await checkRateLimit(userId, PAYMENT_INITIATE_CONFIG);
  if (!userLimit.allowed) {
    return rateLimitResponse(
      userLimit,
      'تم تجاوز عدد محاولات الدفع. انتظر قليلاً ثم أعد المحاولة',
      'user'
    );
  }

  const clientIp = getClientIp(request);
  const ipLimit = await checkRateLimit(clientIp, PAYMENT_INITIATE_IP_CONFIG);
  if (!ipLimit.allowed) {
    return rateLimitResponse(
      ipLimit,
      'تم تجاوز عدد محاولات الدفع من هذا الجهاز. انتظر قليلاً ثم أعد المحاولة',
      'ip'
    );
  }

  const { orderId, customerName, customerMobile, customerEmail, idempotencyKey } = await request.json();

  if (!orderId || !customerName || !customerMobile) {
    return NextResponse.json({ error: 'معلومات غير مكتملة' }, { status: 400 });
  }

  const client = await pool.connect();

  try {
    // SECURITY: Load the order's authoritative total from the DB.
    // Never trust a client-supplied payment amount — preventing the underpayment
    // attack where a customer submits a tiny `amount` and pays less than the order total.
    const owner = await client.query(
      `SELECT user_id::text, total::numeric AS total, payment_status, status
       FROM orders WHERE id = $1`,
      [orderId]
    );

    if (owner.rows.length === 0) {
      return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
    }
    if (String(owner.rows[0].user_id) !== userId) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }
    if (owner.rows[0].payment_status === 'paid') {
      return NextResponse.json({ error: 'تم دفع الطلب مسبقاً' }, { status: 409 });
    }

    const serverTotal = Number(owner.rows[0].total);
    if (!Number.isFinite(serverTotal) || serverTotal <= 0) {
      return NextResponse.json({ error: 'إجمالي الطلب غير صالح' }, { status: 400 });
    }

    const paymentResult = await createInvoice({
      amount: serverTotal,
      orderId,
      description: `طلب سيتي ماركت #${orderId.slice(-8)}`,
      customerName,
      idempotencyKey: typeof idempotencyKey === 'string' && idempotencyKey.length > 0
        ? idempotencyKey
        : undefined,
    });

    if (!paymentResult.success) {
      return NextResponse.json({ error: paymentResult.error }, { status: 500 });
    }

    await client.query(
      `UPDATE orders SET payment_method = 'moyasar', payment_reference = $1 WHERE id = $2`,
      [paymentResult.invoiceId, orderId]
    );

    return NextResponse.json({
      success: true,
      paymentUrl: paymentResult.paymentUrl,
      invoiceId: paymentResult.invoiceId,
    });
  } catch (error) {
    logError('Payment error:', error);
    return NextResponse.json({ error: 'حدث خطأ' }, { status: 500 });
  } finally {
    client.release();
  }
}