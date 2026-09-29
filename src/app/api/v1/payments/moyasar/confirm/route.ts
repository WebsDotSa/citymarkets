import { NextRequest, NextResponse } from 'next/server';
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import { confirmMoyasarPaymentForOrder } from '@/lib/payments/moyasar-confirm';
import { isMoyasarInlineConfigured } from '@/lib/payments/moyasar';

/** تأكيد دفع ميسر بعد إتمام النموذج على صفحة checkout */
export async function POST(request: NextRequest) {
  if (!isMoyasarInlineConfigured()) {
    return NextResponse.json(
      { success: false, error: 'الدفع المدمج غير مفعّل' },
      { status: 503 }
    );
  }

  const userId = await resolveCustomerUserIdFromRequest(request);
  const body = await request.json().catch(() => ({}));
  const orderId =
    typeof body.order_id === 'string'
      ? body.order_id
      : typeof body.orderId === 'string'
        ? body.orderId
        : '';
  const paymentId =
    typeof body.payment_id === 'string'
      ? body.payment_id
      : typeof body.paymentId === 'string'
        ? body.paymentId
        : typeof body.id === 'string'
          ? body.id
          : '';

  if (!orderId || !paymentId) {
    return NextResponse.json(
      { success: false, error: 'order_id و payment_id مطلوبان' },
      { status: 400 }
    );
  }

  const result = await confirmMoyasarPaymentForOrder({
    orderId,
    paymentId,
    userId,
  });

  if (!result.success) {
    const status = result.error === 'غير مصرح' ? 403 : 400;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json({
    success: true,
    order_id: orderId,
    payment_status: result.payment_status,
    order_status: result.order_status,
  });
}
