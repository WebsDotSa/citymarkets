import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { pool } from '@/lib/db';
import { fetchPayment, mapMoyasarStatusToDb, isSarCurrency } from '@/lib/payments/moyasar';
import { awardPointsForOrder, getLoyaltySettings, resolveRedeemForOrder } from '@/lib/orders/loyalty';
import {
  recordPaymentEvent,
  finalizePaymentEvent,
} from '@/lib/payments/event-ledger';

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

    try {
      // SECURITY: Wrap per-order processing in a transaction with an
      // advisory lock keyed by the order_id. This prevents the C4 race
      // condition where two concurrent webhook calls for the same invoice
      // both pass the "already awarded?" check and credit loyalty points
      // twice. Released on COMMIT/ROLLBACK.
      await client.query('BEGIN');

      // payment_events ledger (migration 073) — INSERT first so any
      // gateway replay hits the UNIQUE (invoice_id, gateway, event_type)
      // index and short-circuits the rest of the work. Atomic with the
      // order updates via the surrounding transaction: if the order
      // mutation rolls back, the ledger row rolls back too and a fresh
      // replay gets to insert again. See docs/04-PAYMENTS-AND-CHECKOUT.md
      // and src/lib/payments/event-ledger.ts.
      const eventType =
        typeof body.type === 'string' && body.type
          ? String(body.type)
          : typeof body.event_type === 'string' && body.event_type
            ? String(body.event_type)
            : 'payment.notification';
      const ledgerResult = await recordPaymentEvent(client, {
        invoiceId,
        gateway: 'moyasar',
        eventType,
        raw: body,
      });
      if (ledgerResult === 'duplicate') {
        logInfo(
          `[webhook] duplicate event ${eventType} for ${invoiceId}; ` +
            `idempotent ack without re-processing order`,
        );
        // FIX (P1-5): finalize the ledger row so subsequent replays do
        // not see status='received' forever. orderId is intentionally
        // NOT passed — we short-circuited before the SELECT. The schema
        // allows order_id NULL (operators correlate from
        // raw_payload.invoice_id).
        try {
          await finalizePaymentEvent(client, {
            invoiceId,
            gateway: 'moyasar',
            eventType,
            status: 'processed',
          });
        } catch (finalErr) {
          logError('[event-ledger] duplicate finalize failed', finalErr, { invoiceId });
        }
        await client.query('COMMIT');
        return NextResponse.json({ received: true, duplicate: true });
      }
      const order = await client.query(
        'SELECT id, status, total, subtotal, catalog_subtotal, user_id, points_redeemed, guest_phone, guest_name FROM orders WHERE payment_reference = $1',
        [invoiceId]
      );

      // Hoisted so the post-processing finalize (payment_events.status)
      // can see the order id even when the original SELECT returned 0 rows.
      orderId = order.rows[0]?.id;

      if (orderId) {

        // Per-order advisory lock so concurrent callbacks for the same order
        // serialize. Released on COMMIT/ROLLBACK.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `order:${orderId}`,
        ]);

        await client.query(
          // SECURITY (Payment-H): never regress a Paid/Failed order back
          // to Pending. The webhook can fire multiple times with stale
          // payloads (network retries, queue replays) and we don't want a
          // late "Pending" callback to overwrite a successful payment.
          // The COALESCE on the CASE keeps the more terminal status:
          //   paid   > failed   > pending
          // `updated_at` is also bumped so ops can see the last activity.
          `UPDATE orders
           SET payment_status = CASE
             WHEN payment_status = 'paid'   THEN 'paid'
             WHEN payment_status = 'failed' AND $1 = 'pending' THEN 'failed'
             ELSE $1
           END,
           updated_at = NOW()
           WHERE id = $2`,
          [paymentDb, orderId]
        );

        // Slice 3 fan-out: when the parent's payment_status changes,
        // mirror the same value onto every vendor_orders child. The
        // same CASE-guard prevents regression. The same advisory lock
        // above serializes this so a sibling latency window can't
        // split the parent from its children.
        await client.query(
          `UPDATE vendor_orders
              SET payment_status = CASE
                WHEN payment_status = 'paid'   THEN 'paid'
                WHEN payment_status = 'failed' AND $1 = 'pending' THEN 'failed'
                ELSE $1
              END,
              updated_at = NOW()
            WHERE parent_order_id = $2`,
          [paymentDb, orderId],
        );

        if (remoteStatus === 'paid' || remoteStatus === 'captured') {
          // SECURITY (Pay-H): verify the invoice currency is SAR and the
          // paid amount covers the order total before crediting loyalty
          // or marking the order paid. Without this check, a payment
          // made in a weaker currency could be accepted as "Paid" and
          // converted to loyalty at SAR face value.
          //
          // FIX (P0-3): guards do NOT early-return. They gate the
          // lifecycle flip + loyalty crediting via `guardsOk`; the
          // payment_status was already written above (gateway confirmed).
          // finalizePaymentEvent still runs so the ledger reflects truth,
          // and a replay short-circuited by the UNIQUE index sees the
          // ledger already at status='processed' (P1-5 covers the
          // duplicate-branch finalize explicitly).
          const orderRow = order.rows[0];
          const orderTotal = Number(orderRow.total);

          const currencyOk = isSarCurrency(remote.currency);
          const amountOk =
            typeof remote.amountHalalas !== "number" ||
            remote.amountHalalas / 100 + 0.01 >= orderTotal;

          if (!currencyOk) {
            logWarn(
              `[webhook] order ${orderId} paid in ${remote.currency}, expected SAR — refusing to credit loyalty`,
            );
          }
          if (!amountOk) {
            logWarn(
              `[webhook] order ${orderId} paid amount ${(remote.amountHalalas ?? 0) / 100} < total ${orderTotal} — refusing to credit loyalty`,
            );
          }
          const guardsOk = currencyOk && amountOk;

          if (guardsOk) {
            // Roll lifecycle forward: payment confirmed → 'confirmed'.
          // NEVER set the fulfillment lifecycle to 'paid' — 'paid' is a
          // payment_status only (matches the Tamara webhook invariant at
          // src/app/api/v1/payments/tamara/webhook/route.ts:226-237).
          // We use CASE so a late 'paid' webhook can never regress an
          // already-confirmed/preparing/ready/etc. order back to pending.
          await client.query(
            `UPDATE orders
                SET status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END
              WHERE id = $1`,
            [orderId]
          );

          // Slice 3 fan-out: mirror the same lifecycle flip onto every
          // child vendor_order. Same CASE-guard as the parent — never
          // set fulfillment to 'paid'.
          await client.query(
            `UPDATE vendor_orders
                SET status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END
              WHERE parent_order_id = $1`,
            [orderId]
          );

          // SECURITY (Pay-H): resolve any pending_redeem hold into a
          // real debit. The hold was placed at order creation so the
          // user sees a "reservation" on their activity feed but the
          // balance was untouched. Now that payment is confirmed we
          // can safely deduct. Idempotent via the ON CONFLICT on
          // (ref_order_id, type='redeem') — see src/lib/loyalty.ts.
          if (orderRow.user_id && Number(orderRow.points_redeemed) > 0) {
            try {
              await resolveRedeemForOrder(client, {
                orderId,
                userId: orderRow.user_id,
                pointsRedeemed: Number(orderRow.points_redeemed),
              });
            } catch (redeemErr) {
              logError('[loyalty] redeem resolve failed for order', redeemErr, { orderId });
            }
          }

          // Award loyalty points for paid orders with a logged-in user.
          // Rate (e.g. 10 SAR = 1 point) and earn gating come from
          // app_settings['loyalty'], read via getLoyaltySettings().
          // Catalog subtotal only — Slice 3 policy: vendor orders earn
          // at the vendor's discretion, not the marketplace's.
          //
          // Idempotency relies on UNIQUE(ref_order_id, type) on
          // loyalty_transactions (see migration 046). The INSERT ...
          // ON CONFLICT DO NOTHING pattern is atomic.
          if (orderRow.user_id && Number(orderRow.catalog_subtotal) > 0) {
            try {
              const loyaltySettings = await getLoyaltySettings();
              await awardPointsForOrder(client, {
                orderId,
                userId: orderRow.user_id,
                catalogSubtotal: Number(orderRow.catalog_subtotal),
                settings: loyaltySettings,
              });
            } catch (lpErr) {
              logError('[loyalty] earn failed for order', lpErr, { orderId });
            }
          }
          } // end if (guardsOk)

          // Recover any abandoned carts that belong to this customer.
          // Idempotent — the helper uses intent_order_id <> recovered_order_id
          // so re-running this branch on a webhook replay is safe.
          // Best-effort: a snapshot miss should never block the payment.
          try {
            const { markAbandonedCartRecovered } = await import('@/lib/orders/abandoned-carts');
            const guestPhone =
              orderRow.guest_phone != null && orderRow.guest_phone !== ''
                ? String(orderRow.guest_phone)
                : null;
            const { recovered_count } = await markAbandonedCartRecovered(
              orderId,
              {
                user_id: orderRow.user_id || null,
                guest_phone: guestPhone,
              },
            );
            // Stash the count on a fire-and-forget SMS so the customer
            // hears about it once payment is confirmed by the gateway.
            if (recovered_count > 0) {
              try {
                const { enqueueOrderPaidSms } = await import('@/lib/queue');
                // Worker re-fetches the order + address + recovered count,
                // so we only need the orderId here.
                void enqueueOrderPaidSms(orderId);
              } catch (smsErr) {
                logError('[paid-confirm] sms dispatch failed', smsErr, { orderId });
              }
            }
          } catch (acErr) {
            logError('[abandoned-carts] recovery failed', acErr, { orderId });
          }
        }

        logInfo(`Order ${orderId} payment_status=${paymentDb} (gateway=${remoteStatus})`);

        // Send push notification to the buyer (if logged in). Fire-and-forget
        // so a slow push endpoint never blocks the webhook.
        try {
          const { sendPushToUser } = await import("@/lib/push");
          const orderInfo = order.rows[0];
          if (orderInfo?.user_id) {
            let title = "تم تحديث حالة طلبك";
            let body = `حالة الطلب #${String(orderId).slice(0, 8)} الآن ${paymentDb}`;
            let url = `/orders`;
            if (remoteStatus === 'paid' || remoteStatus === 'captured') {
              title = "تم الدفع بنجاح ✅";
              body = `طلبك #${String(orderId).slice(0, 8)} مدفوع وجاري التجهيز.`;
              url = `/profile/orders`;
            }
            await sendPushToUser(orderInfo.user_id, {
              title,
              body,
              url,
              tag: `order-${orderId}`,
            });
          }
        } catch (pushErr) {
          logError('[push] order status notification failed:', pushErr);
        }
      }

      // Mark the ledger row as processed for the order we just updated.
      // orderId is in scope from the SELECT above; if no matching order
      // was found, leave order_id NULL and finalize anyway — operators
      // can correlate from raw_payload.invoice_id.
      if (typeof orderId === 'string') {
        try {
          await finalizePaymentEvent(client, {
            invoiceId,
            gateway: 'moyasar',
            eventType,
            status: 'processed',
            orderId,
          });
        } catch (finalErr) {
          logError('[event-ledger] finalize failed', finalErr, { invoiceId, orderId });
        }
      }

      // Capture fan-out intent BEFORE COMMIT. The post-COMMIT section
      // below needs this flag to run vendor notify without holding the
      // already-released client connection.
      shouldNotifyVendor = Boolean(
        orderId &&
          (remoteStatus === 'paid' || remoteStatus === 'captured'),
      );

      // COMMIT inside the try (matches Tamara webhook pattern).
      // Vendor push fan-out happens AFTER this commit + release.
      await client.query('COMMIT');
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