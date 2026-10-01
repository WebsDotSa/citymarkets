import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { pool } from '@/lib/db';
import { fetchPayment, mapMoyasarStatusToDb, isSarCurrency } from '@/lib/payments/moyasar';
import { finalizePaymentEvent } from '@/lib/payments/event-ledger';
import { reconcilePayment } from '@/lib/payments/reconcile-payment';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

/**
 * Constant-time string comparison to prevent timing attacks.
 * Refuses to compare if either input is empty or lengths differ.
 */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

function verifyWebhookAuth(request: NextRequest): boolean {
  const secret = process.env.MOYASAR_WEBHOOK_SECRET?.trim();

  // SECURITY (Pay-C4): never accept webhooks without a configured secret.
  // Previously we returned `NODE_ENV !== 'production'` here, but that meant
  // any staging/dev deployment exposed to the public internet could be
  // hit with forged "Paid" payloads — turning into free loyalty credit.
  // Refuse explicitly unless the dev-only escape hatch
  // ALLOW_INSECURE_WEBHOOK=1 is set (for local ngrok testing only).
  if (!secret) {
    return process.env.ALLOW_INSECURE_WEBHOOK === '1';
  }

  const auth = request.headers.get('authorization');
  const token = auth?.startsWith('Bearer ')
    ? auth.slice(7).trim()
    : request.headers.get('x-webhook-secret');

  if (!token) return false;
  return safeEqual(token, secret);
}

// FIX (P1-4): mapPaymentDbStatus moved to @/lib/payments/moyasar as
// `mapMoyasarStatusToDb` so the canonical webhook and the inline-confirm
// helper share one source of truth. The previous local copy treated
// 'refunded' as 'pending', which stranded the row after a refund event.

export async function POST(request: NextRequest) {
  if (!verifyWebhookAuth(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    // SECURITY (Pay-H): the gateway expects 2xx for "received". But
    // a totally-unparseable body means we can't act on it — return
    // 400 so the gateway retries instead of us silently dropping.
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400 },
    );
  }

  try {
    const invoiceIdRaw = body.id ?? body.payment_id ?? body.invoiceId;
    const invoiceId =
      invoiceIdRaw !== undefined && invoiceIdRaw !== null ? String(invoiceIdRaw) : '';

    // SECURITY (Pay-H): an empty body means the gateway didn't send
    // anything actionable. Return 400 so the gateway will retry rather
    // than silently 200-OK'ing (which masks dropped events).
    if (!invoiceId) {
      return NextResponse.json(
        { error: "missing payment id" },
        { status: 400 },
      );
    }

    const remote = await fetchPayment(invoiceId);
    if (!remote.success) {
      logWarn(`Moyasar fetchPayment failed for payment ${invoiceId}: ${remote.error}`);
      // 502 tells the gateway the upstream lookup failed; gateway will
      // retry. Previously this returned 200 which masked outages.
      return NextResponse.json(
        { error: "payment gateway lookup failed" },
        { status: 502 },
      );
    }

    const paymentDb = mapMoyasarStatusToDb(remote.status ?? '');
    const remoteStatus = remote.status ?? '';

    const client = await pool.connect();
    // Hoisted to outer scope so the post-COMMIT vendor push fan-out
    // can read it without TS narrowing the inner try scope. The inner
    // assignment below is the only place this is written.
    let orderId: string | undefined;
    // Captured inside the transaction so the post-COMMIT fan-out can
    // read it without holding the client connection (client is released
    // by the finally block below). Defaults to false; flipped to true
    // when the parent order was found AND remoteStatus was paid/captured.
    let shouldNotifyVendor = false;
    // W1 fix: also fires post-COMMIT. Previously `enqueueOrderPaidSms`
    // was called inside the transaction (around line 338) so the SMS
    // worker could read DB state before COMMIT propagated; same race
    // pattern that was already fixed for vendor push. Flipped when an
    // abandoned cart was recovered on this payment.
    let shouldEnqueueOrderPaidSms = false;

    try {
      // SECURITY: Wrap per-order processing in a transaction with an
      // advisory lock keyed by the order_id. This prevents the C4 race
      // condition where two concurrent webhook calls for the same invoice
      // both pass the "already awarded?" check and credit loyalty points
      // twice. Released on COMMIT/ROLLBACK.
      await client.query('BEGIN');

      // FIX (P1-5): reconcile-payment is the shared single-source-of-
      // truth used by every gateway webhook. It does the ledger INSERT,
      // advisory lock, parent/child UPDATE, lifecycle flip, loyalty
      // resolve, earn award, and abandoned-cart recovery. Moyasar only
      // adds the per-gateway surface area (signature verify + amount/
      // currency guard + push body variations) above this call.
      const eventType =
        typeof body.type === 'string' && body.type
          ? String(body.type)
          : typeof body.event_type === 'string' && body.event_type
            ? String(body.event_type)
            : 'payment.notification';
      const order = await client.query(
        'SELECT id, status, total, subtotal, catalog_subtotal, user_id, points_redeemed, guest_phone, guest_name FROM orders WHERE payment_reference = $1',
        [invoiceId]
      );

      // Hoisted so the post-processing finalize (payment_events.status)
      // can see the order id even when the original SELECT returned 0 rows.
      orderId = order.rows[0]?.id;

      if (!orderId) {
        // No matching order: still record the event so the ledger
        // captures the gateway attempt. Operators correlate via
        // raw_payload.invoice_id.
        const ledgerResult = await reconcilePayment(client, {
          invoiceId,
          gateway: 'moyasar',
          eventType,
          paymentDb,
          rawBody: body,
          orderRow: {
            id: '',
            total: 0,
            catalog_subtotal: 0,
            user_id: null,
            points_redeemed: 0,
            guest_phone: null,
          },
        });
        await client.query('COMMIT');
        if (ledgerResult.duplicate) {
          return NextResponse.json({ received: true, duplicate: true });
        }
        return NextResponse.json({ received: true });
      }

      const orderRow = order.rows[0];

      // SECURITY (Pay-H): verify the invoice currency is SAR and the
      // paid amount covers the order total before crediting loyalty
      // or marking the order paid. Without this check, a payment made
      // in a weaker currency could be accepted as "Paid" and converted
      // to loyalty at SAR face value. The guards do NOT early-return;
      // they gate the lifecycle flip + loyalty crediting inside
      // reconcilePayment via the `paymentDb` interpretation. Here we
      // downgrade paymentDb to 'pending' when guards fail so the
      // shared helper skips the paid-only branch but still records the
      // event.
      let effectivePaymentDb: 'paid' | 'failed' | 'pending' | 'refunded' = paymentDb;
      if (remoteStatus === 'paid' || remoteStatus === 'captured') {
        const currencyOk = isSarCurrency(remote.currency);
        const amountOk =
          typeof remote.amountHalalas !== 'number' ||
          remote.amountHalalas / 100 + 0.01 >= Number(orderRow.total);
        if (!currencyOk) {
          logWarn(
            `[webhook] order ${orderId} paid in ${remote.currency}, expected SAR — refusing to credit loyalty`,
          );
          effectivePaymentDb = 'pending';
        }
        if (!amountOk) {
          logWarn(
            `[webhook] order ${orderId} paid amount ${(remote.amountHalalas ?? 0) / 100} < total ${orderRow.total} — refusing to credit loyalty`,
          );
          effectivePaymentDb = 'pending';
        }
      }

      const reconcileResult = await reconcilePayment(client, {
        invoiceId,
        gateway: 'moyasar',
        eventType,
        paymentDb: effectivePaymentDb,
        rawBody: body,
        orderRow: {
          id: orderRow.id,
          total: orderRow.total,
          catalog_subtotal: orderRow.catalog_subtotal,
          user_id: orderRow.user_id,
          points_redeemed: orderRow.points_redeemed,
          guest_phone:
            orderRow.guest_phone != null && orderRow.guest_phone !== ''
              ? String(orderRow.guest_phone)
              : null,
        },
      });
      if (reconcileResult.duplicate) {
        logInfo(
          `[webhook] duplicate event ${eventType} for ${invoiceId}; ` +
            `idempotent ack without re-processing order`,
        );
        await client.query('COMMIT');
        return NextResponse.json({ received: true, duplicate: true });
      }

      logInfo(`Order ${orderId} payment_status=${paymentDb} (gateway=${remoteStatus})`);

      // Capture fan-out intent BEFORE COMMIT. The post-COMMIT section
      // below needs this flag to run vendor notify without holding the
      // already-released client connection. Vendor notify is based on
      // the GATEWAY's `remoteStatus` (the source of truth for "did
      // Moyasar confirm this invoice?"), NOT on `effectivePaymentDb`
      // (which gates only the loyalty / lifecycle flip inside the
      // reconcile helper when SAR/amount guards fail).
      shouldNotifyVendor =
        Boolean(orderId) &&
        (remoteStatus === 'paid' || remoteStatus === 'captured');
      shouldEnqueueOrderPaidSms = reconcileResult.recoveredCount > 0;

      // COMMIT inside the try (matches Tamara webhook pattern).
      // Vendor push fan-out happens AFTER this commit + release.
      await client.query('COMMIT');

      // Mark the ledger row as processed for the order we just updated.
      // orderId is in scope from the SELECT above; if no matching order
      // was found, leave order_id NULL and finalize anyway — operators
      // can correlate from raw_payload.invoice_id.
      try {
        await finalizePaymentEvent(client, {
          invoiceId,
          gateway: 'moyasar',
          eventType,
          status: 'processed',
          orderId: orderId as string,
        });
      } catch (finalErr) {
        logError('[event-ledger] finalize failed', finalErr, { invoiceId, orderId });
      }

      // Send push notification to the buyer (if logged in). Fire-and-forget
      // so a slow push endpoint never blocks the webhook.
      try {
        const { sendPushToUser } = await import("@/lib/push");
        if (orderRow.user_id) {
          let title = "تم تحديث حالة طلبك";
          let body = `حالة الطلب #${String(orderId).slice(0, 8)} الآن ${paymentDb}`;
          let url = `/orders`;
          if (remoteStatus === 'paid' || remoteStatus === 'captured') {
            title = "تم الدفع بنجاح ✅";
            body = `طلبك #${String(orderId).slice(0, 8)} مدفوع وجاري التجهيز.`;
            url = `/profile/orders`;
          }
          await sendPushToUser(orderRow.user_id, {
            title,
            body,
            url,
            tag: `order-${orderId}`,
          });
        }
      } catch (pushErr) {
        logError('[push] order status notification failed:', pushErr);
      }
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* noop */ }
      throw e;
    } finally {
      client.release();
    }

    // ---- Post-COMMIT side effects ----
    //
    // Vendor push notification (Gap D closure). Fires only on a successful
    // payment and only once per (vendor, order) pair: the queue is keyed
    // by `vendor:<vendorId>:order:<orderId>` so a webhook replay that
    // re-enqueues hits BullMQ's idempotency guard. Fire-and-forget —
    // never block the gateway ack on push dispatch.
    //
    // FIX (P0-2): this used to run BEFORE COMMIT (the COMMIT was in the
    // `finally` block, after the vendor fan-out in the try body). If
    // COMMIT failed, the vendor would still get a push for a rolled-back
    // transaction; on a fast COMMIT, the worker could read the DB before
    // the COMMIT propagated. Mirrors Tamara webhook's correct pattern.
    if (shouldNotifyVendor && orderId) {
      const orderIdLocal: string = orderId as string;
      try {
        const { enqueueNotifyVendorNewOrder } = await import('@/lib/queue');
        const { loadOrderVendorIds } = await import('@/lib/queue/loaders');
        // Shared loader (same SQL as Tamara webhook; canonical source).
        const vendorIds = await loadOrderVendorIds(orderIdLocal);
        for (const vendorId of vendorIds) {
          // void = fire-and-forget; the helper returns immediately
          // (BullMQ enqueue or Redis-disabled inline fallback).
          void enqueueNotifyVendorNewOrder({
            vendorId,
            orderId: orderIdLocal,
          });
        }
      } catch (notifyErr) {
        logError('[notify-vendor] enqueue failed', notifyErr, { orderId });
      }
    }

    // W1 fix: customer "your abandoned cart recovered" SMS, fired AFTER
    // COMMIT so the worker can't read pre-commit DB state. Same pattern
    // as the vendor fan-out above. Fire-and-forget — never block the
    // gateway ack on SMS dispatch.
    if (shouldEnqueueOrderPaidSms && orderId) {
      const orderIdLocal: string = orderId as string;
      try {
        const { enqueueOrderPaidSms } = await import('@/lib/queue');
        void enqueueOrderPaidSms(orderIdLocal);
      } catch (smsErr) {
        logError('[paid-confirm] sms dispatch failed', smsErr, { orderId: orderIdLocal });
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    logError('Webhook error:', error);
    return NextResponse.json({ received: true });
  }
}

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ status: 'ok', message: 'Payment webhook endpoint (non-production ping)' });
}