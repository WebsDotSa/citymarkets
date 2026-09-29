import { pool } from '@/lib/db';
import {
  fetchPayment,
  mapMoyasarStatusToDb,
  isSarCurrency,
  toHalalas,
} from './moyasar';
import {
  recordPaymentEvent,
  finalizePaymentEvent,
} from './event-ledger';

export interface ConfirmMoyasarPaymentResult {
  success: boolean;
  payment_status?: string;
  order_status?: string;
  error?: string;
  /**
   * True when this call hit the payment_events UNIQUE (invoice_id,
   * gateway, event_type) index and short-circuited — no order mutation.
   * Mirrors the `duplicate` flag returned by the canonical webhooks.
   */
  duplicate?: boolean;
}

/**
 * Load the canonical (status, payment_status) tuple for an order.
 *
 * P3-2 (duplicate SQL loader): three call sites in this file used
 * to issue the same `SELECT status, payment_status FROM orders WHERE
 * id = $1` query inline. Centralising it here means a future schema
 * change (e.g. moving to a read replica, splitting read/write pools)
 * touches one function instead of three.
 */
async function fetchOrderStatuses(orderId: string): Promise<{
  status: string;
  payment_status: string;
}> {
  const result = await pool.query<{ status: string; payment_status: string }>(
    `SELECT status, payment_status FROM orders WHERE id = $1`,
    [orderId],
  );
  return result.rows[0] ?? { status: "unknown", payment_status: "unknown" };
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

  if (payment.currency && !isSarCurrency(payment.currency)) {
    return { success: false, error: 'عملة الدفع غير مدعومة' };
  }

  // FIX (P1-2/3/4): use the shared mapping helper so the canonical
  // webhook and this inline-confirm path agree on every status. The
  // previous inline mapping classified 'refunded' as 'pending' here
  // while the webhook classified it as 'failed' — the same payment
  // could land in two different payment_status states depending on
  // which path confirmed it. The helper also collapses the
  // case-sensitivity mismatch the old code had.
  const paymentStatus = mapMoyasarStatusToDb(payment.status);

  // Wrap payment mutation in a transaction so the payment_events ledger
  // row is atomic with the orders UPDATE — same pattern as the canonical
  // /api/v1/payments/webhook and /api/v1/payments/tamara/webhook handlers.
  //
  // Bug F: previously the function wrote to payment_events with a direct
  // INSERT using columns (order_id, event_type, payload, payment_reference)
  // that did NOT match the canonical ledger shape (invoice_id, gateway,
  // event_type, raw_payload). The UNIQUE (invoice_id, gateway, event_type)
  // index never saw these rows, so a double-fire of /confirm produced
  // duplicate payment_events rows with no idempotency guarantee.
  //
  // By calling recordPaymentEvent(client, ...) FIRST, any retry / replay
  // short-circuits on the UNIQUE index — mirroring the webhook contract.
  const client = await pool.connect();
  let recoveredCount = 0;
  try {
    await client.query('BEGIN');

    // 1. Ledger INSERT FIRST (idempotency guard)
    const eventType = `moyasar.${payment.status || 'notification'}`;
    const ledgerResult = await recordPaymentEvent(client, {
      invoiceId: paymentId,
      gateway: 'moyasar',
      eventType,
      raw: {
        payment_id: paymentId,
        status: payment.status,
        amount_halalas: payment.amountHalalas,
      },
    });
    if (ledgerResult === 'duplicate') {
      // Idempotent ack — payment_events already records this event.
      await client.query('COMMIT');
      const updated = await fetchOrderStatuses(orderId);
      return {
        success: true,
        payment_status: updated.payment_status || paymentStatus,
        order_status: updated.status,
        duplicate: true,
      };
    }

    // 2. Order UPDATE — never regress, matches the CASE-guarded pattern
    //    used by both webhooks.
    await client.query(
      `UPDATE orders
       SET payment_reference = $1,
           payment_status = CASE
             WHEN payment_status = 'paid'   THEN 'paid'
             WHEN payment_status = 'failed' AND $2 = 'pending' THEN 'failed'
             ELSE $2
           END,
           payment_method = COALESCE(NULLIF(payment_method, ''), 'moyasar'),
           updated_at = NOW()
       WHERE id = $3`,
      [paymentId, paymentStatus, orderId]
    );

    if (paymentStatus === 'paid') {
      // Lifecycle: roll status forward but never go backwards.
      // Mirrors the Tamara webhook invariant (never set to 'paid').
      await client.query(
        `UPDATE orders
         SET status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END
         WHERE id = $1`,
        [orderId]
      );
    }

    await client.query('COMMIT');

    // 3. Finalize the ledger row post-COMMIT (mirrors webhook pattern).
    try {
      await finalizePaymentEvent(client, {
        invoiceId: paymentId,
        gateway: 'moyasar',
        eventType,
        status: 'processed',
        orderId,
      });
    } catch {
      /* ledger finalize is best-effort; a failed finalize leaves the row
         at status='received' and a subsequent replay will re-run. */
    }
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }

  const updated = await fetchOrderStatuses(orderId);

  // Recover any abandoned carts that belong to this customer.
  // Idempotent on retry — the helper uses
  // `intent_order_id <> recovered_order_id` so re-running the same
  // payment confirmation never double-redeems the same snapshot.
  // Best-effort: a snapshot miss should never break the confirmation
  // response back to the caller.
  if (paymentStatus === 'paid') {
    try {
      const { markAbandonedCartRecovered } = await import('@/lib/orders/abandoned-carts');
      const guestPhone =
        order.guest_phone != null && order.guest_phone !== ''
          ? String(order.guest_phone)
          : null;
      const { recovered_count } = await markAbandonedCartRecovered(orderId, {
        user_id: order.user_id,
        guest_phone: guestPhone,
      });
      recoveredCount = recovered_count;

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
    payment_status: updated.payment_status || paymentStatus,
    order_status: updated.status,
  };
}
