import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { fetchInvoiceDetails } from '@/lib/payments/moyasar';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

const SAR_CURRENCY = 'SAR';

/**
 * إشعار ميسر عند دفع الفاتورة (POST من خوادم ميسر)
 * https://docs.moyasar.com/guides/invoices/creating-invoices/
 *
 * Security measures (C2 hardening):
 * 1. Verifies invoice status AND amount by fetching from Moyasar API
 *    (does NOT trust callback body)
 * 2. Looks up the order by `payment_reference = invoiceId` — the value we
 *    stored at payment initiation. The callback's `metadata.order_id` is
 *    NEVER trusted (it's attacker-controlled).
 * 3. Verifies the verified invoice amount matches the order total
 *    to prevent underpayment attacks where an attacker reuses a paid
 *    invoice ID to mark a smaller order as paid.
 * 4. Idempotent processing (safe to retry).
 */
export async function POST(request: NextRequest) {
  let invoiceId: string | undefined;
  try {
    const body = await request.json();
    const invoice = body as { id?: string };
    invoiceId = invoice.id;

    // Always respond 200 to prevent Moyasar from retrying, but ignore
    // callbacks that don't carry a valid invoice id.
    if (!invoiceId || typeof invoiceId !== 'string') {
      return NextResponse.json({ received: true }, { status: 200 });
    }

    // Verify the invoice exists and fetch its REAL status + amount from Moyasar.
    // This prevents attackers from spoofing payment status.
    const verified = await fetchInvoiceDetails(invoiceId);
    if (!verified.success || !verified.status) {
      logWarn('Moyasar callback: could not verify invoice', { invoiceId, error: verified.error });
      // Still return 200 to prevent retries, but log for monitoring
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const status = verified.status;
    let paymentStatus = 'pending';
    if (status === 'paid') paymentStatus = 'paid';
    else if (
      status === 'failed' ||
      status === 'expired' ||
      status === 'canceled'
    ) {
      paymentStatus = 'failed';
    }

    // SECURITY: Look up the order by the invoice ID we stored at initiation
    // (`payment_reference`). The callback's `metadata.order_id` is NEVER used
    // as the source of truth — it is attacker-controlled.
    const owner = await pool.query(
      `SELECT id::text AS id, total::numeric AS total,
              payment_status, status
       FROM orders WHERE payment_reference = $1`,
      [invoiceId]
    );

    if (owner.rows.length === 0) {
      // No matching order — log and ignore. Returning 200 to prevent retries.
      logWarn('Moyasar callback: no order for invoice', { invoiceId });
      return NextResponse.json({ received: true }, { status: 200 });
    }

    const order = owner.rows[0];
    const orderId = order.id;
    const orderTotal = Number(order.total);

    // SECURITY: Verify the verified invoice amount matches the order total.
    // Prevents an attacker from re-using a paid invoice ID to mark a smaller
    // order as paid.
    if (status === 'paid') {
      if (!Number.isFinite(verified.amountHalalas)) {
        logWarn('Moyasar callback: missing amount on verified invoice', { invoiceId });
        return NextResponse.json({ received: true }, { status: 200 });
      }
      const expectedHalalas = Math.round(orderTotal * 100);
      if (verified.amountHalalas !== expectedHalalas) {
        logError(
          'Moyasar callback: amount mismatch for order',
          undefined,
          {
            orderId,
            invoiceId,
            expectedHalalas,
            gotHalalas: verified.amountHalalas,
          },
        );
        // Do NOT mark this order as paid. Return 200 so Moyasar doesn't retry.
        return NextResponse.json({ received: true }, { status: 200 });
      }
    }

    // Idempotent update — safe to call multiple times.
    await pool.query(
      `UPDATE orders
       SET payment_status = $1,
           payment_method = COALESCE(payment_method, 'moyasar')
       WHERE id = $2 AND payment_reference = $3`,
      [paymentStatus, orderId, invoiceId]
    );

    // Only roll order status forward to 'confirmed' on successful payment,
    // and only when the order is still in 'pending' (never regress).
    if (status === 'paid') {
      await pool.query(
        `UPDATE orders
         SET status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END
         WHERE id = $1 AND payment_reference = $2`,
        [orderId, invoiceId]
      );
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    logError('Moyasar callback error', error, { invoiceId });
    // Always return 200 to prevent Moyasar retry storms
    return NextResponse.json({ received: true }, { status: 200 });
  }
}
