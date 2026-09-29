import { pool } from '@/lib/db';
import { fetchPayment, toHalalas } from './moyasar';

export interface ConfirmMoyasarPaymentResult {
  success: boolean;
  payment_status?: string;
  order_status?: string;
  error?: string;
}

/** تحقق من دفع ميسر (نموذج MPF) وربطه بالطلب */
export async function confirmMoyasarPaymentForOrder(params: {
  orderId: string;
  paymentId: string;
  userId?: string | null;
}): Promise<ConfirmMoyasarPaymentResult> {
  const { orderId, paymentId, userId } = params;

  const payment = await fetchPayment(paymentId);
  if (!payment.success || !payment.status) {
    return {
      success: false,
      error: payment.error || 'تعذّر التحقق من الدفع',
    };
  }

  const orderResult = await pool.query<{
    id: string;
    user_id: string | null;
    total: string | number;
    payment_status: string | null;
    status: string;
    guest_phone: string | null;
    guest_name: string | null;
  }>(
    `SELECT id, user_id::text, total, payment_status, status, guest_phone, guest_name FROM orders WHERE id = $1`,
    [orderId]
  );

  if (orderResult.rows.length === 0) {
    return { success: false, error: 'الطلب غير موجود' };
  }

  const order = orderResult.rows[0];

  if (userId && order.user_id && order.user_id !== userId) {
    return { success: false, error: 'غير مصرح' };
  }

  const metaOrderId = payment.metadata?.order_id;
  if (metaOrderId && String(metaOrderId) !== String(orderId)) {
    return { success: false, error: 'الدفع لا يطابق هذا الطلب' };
  }

  const expectedHalalas = toHalalas(Number(order.total));
  if (
    payment.amountHalalas != null &&
    payment.amountHalalas !== expectedHalalas
  ) {
    return { success: false, error: 'مبلغ الدفع لا يطابق الطلب' };
  }

  if (payment.currency && payment.currency !== 'SAR') {
    return { success: false, error: 'عملة الدفع غير مدعومة' };
  }

  let paymentStatus = 'pending';
  if (payment.status === 'paid' || payment.status === 'captured') {
    paymentStatus = 'paid';
  } else if (
    payment.status === 'failed' ||
    payment.status === 'voided' ||
    payment.status === 'refunded'
  ) {
    paymentStatus = 'failed';
  }

  await pool.query(
    `UPDATE orders
     SET payment_reference = $1,
         payment_status = $2,
         payment_method = COALESCE(NULLIF(payment_method, ''), 'moyasar')
     WHERE id = $3`,
    [paymentId, paymentStatus, orderId]
  );

  if (paymentStatus === 'paid') {
    await pool.query(
      `UPDATE orders
       SET status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END
       WHERE id = $1`,
      [orderId]
    );
  }

  try {
    await pool.query(
      `INSERT INTO payment_events (order_id, event_type, payload, payment_reference)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [
        orderId,
        `moyasar_${payment.status}`,
        JSON.stringify({
          payment_id: paymentId,
          status: payment.status,
          amount_halalas: payment.amountHalalas,
        }),
        paymentId,
      ]
    );
  } catch {
    /* optional audit */
  }

  const updated = await pool.query<{ status: string; payment_status: string }>(
    `SELECT status, payment_status FROM orders WHERE id = $1`,
    [orderId]
  );

  // Recover any abandoned carts that belong to this customer.
  // Idempotent on retry — the helper uses
  // `intent_order_id <> recovered_order_id` so re-running the same
  // payment confirmation never double-redeems the same snapshot.
  // Best-effort: a snapshot miss should never break the confirmation
  // response back to the caller.
  if (paymentStatus === 'paid') {
    try {
      const { markAbandonedCartRecovered } = await import(
        '@/lib/abandoned-carts'
      );
      const guestPhone =
        order.guest_phone != null && order.guest_phone !== ''
          ? String(order.guest_phone)
          : null;
      const { recovered_count } = await markAbandonedCartRecovered(orderId, {
        user_id: order.user_id,
        guest_phone: guestPhone,
      });

      if (recovered_count > 0) {
        try {
          const { enqueueOrderPaidSms } = await import('@/lib/queue');
          // Worker re-fetches the order + recovered count, so just pass id.
          void enqueueOrderPaidSms(orderId);
        } catch (smsErr) {
          /* helper logs internally; swallow */
        }
      }
    } catch (e) {
      /* helper logs internally; swallow */
    }
  }

  return {
    success: true,
    payment_status: updated.rows[0]?.payment_status || paymentStatus,
    order_status: updated.rows[0]?.status,
  };
}
