/**
 * Vendor new-order notification.
 *
 * Closes the Gap D in the production-completion-2026-09-29 audit:
 * the canonical webhooks (Moyasar + Tamara) only fired a buyer push
 * notification. Vendors had no signal that a paid order had arrived
 * except by manually refreshing `/api/v1/vendor/orders`. This module
 * pushes the same webhook payload to every active vendor staff member
 * (owner / manager / staff — not viewer) who has a registered web push
 * subscription.
 *
 * Architecture (matches `notifyAdminNewOrder`):
 *
 *   webhook handler
 *     ↓ (in transaction)
 *     payment_events + orders UPDATE
 *     ↓
 *     enqueueNotifyVendorNewOrder({ vendorId, orderId })  ← fan-out per vendor
 *     ↓
 *     BullMQ NOTIFY_VENDOR_NEW_ORDER queue (with Redis fallback)
 *     ↓
 *     worker re-fetches state → notifyVendorNewOrder(vendorId, orderId)
 *     ↓
 *     sendPushToEndpoint (VAPID web-push) for each subscription
 *
 * Native push (APNs / FCM) is intentionally out of scope here — the
 * senders in src/lib/native-push/senders are stubs per audit D14-impl.
 * When native push becomes production-ready, swap `sendPushToEndpoint`
 * for a dispatcher that selects the right sender per token.
 *
 * Idempotency:
 *   - Worker jobId is `vendor:<vendorId>:order:<orderId>` so a webhook
 *     replay that re-enqueues the same (vendor, order) pair is rejected
 *     by BullMQ.
 *   - The push payload uses `tag: vendor-order-<vendorOrderId>` so the
 *     browser collapses duplicates into a single notification per
 *     order (matches the buyer push behavior).
 */
import { pool } from "@/lib/db";
import { error as logError, info as logInfo } from "@/lib/logger";

export interface NotifyVendorResult {
  /** Total active vendor_staff we attempted to reach. */
  totalStaff: number;
  /** Subscriptions we successfully pushed to. */
  sent: number;
  /** Subscriptions whose send returned a non-OK status (failed / 404 / 410). */
  failed: number;
  /** True when the vendor has zero active staff OR zero subscriptions. */
  skipped: boolean;
  reason?: string;
}

/**
 * Send a "new paid order" push to every active vendor staff member for
 * the given vendor. Best-effort — every endpoint failure is logged but
 * never thrown, so a slow push endpoint never breaks the webhook path.
 *
 * The function re-resolves vendor_staff + subscriptions at call time,
 * never trust the queue's payload, so a vendor who disabled a staff
 * account after the enqueue will not be notified.
 */
export async function notifyVendorNewOrder(args: {
  vendorId: string;
  parentOrderId: string;
}): Promise<NotifyVendorResult> {
  const { vendorId, parentOrderId } = args;
  const client = await pool.connect();
  try {
    // 1. Confirm vendor is still active. If the vendor was disabled
    //    between enqueue and processing, skip — there's no point
    //    pushing to a store that's been paused.
    const vendorRes = await client.query<{ is_active: boolean }>(
      `SELECT is_active FROM vendors WHERE id = $1`,
      [vendorId],
    );
    if (vendorRes.rows.length === 0 || !vendorRes.rows[0]?.is_active) {
      return { totalStaff: 0, sent: 0, failed: 0, skipped: true, reason: "vendor_inactive" };
    }

    // 2. Resolve vendor owner + manager + staff (NOT viewer — viewers
    //    don't act on orders). `is_active = TRUE` filters disabled
    //    accounts so the push doesn't reach a stale subscription.
    const staffRes = await client.query<{
      id: string;
      full_name_ar: string | null;
      full_name_en: string | null;
      email: string | null;
    }>(
      `SELECT id, full_name_ar, full_name_en, email
         FROM vendor_staff
        WHERE vendor_id = $1
          AND is_active = TRUE
          AND role IN ('owner', 'manager', 'staff')`,
      [vendorId],
    );
    const staffIds = staffRes.rows.map((r) => r.id);
    if (staffIds.length === 0) {
      return { totalStaff: 0, sent: 0, failed: 0, skipped: true, reason: "no_active_staff" };
    }

    // 3. Resolve all push subscriptions for those staff IDs. The
    //    push_subscriptions.user_id is nullable for anonymous
    //    subscribers (banners / storefront-level alerts) — those
    //    are out of scope for order notifications.
    const subsRes = await client.query<{
      endpoint: string;
      p256dh: string;
      auth: string;
      user_id: string;
    }>(
      `SELECT endpoint, p256dh, auth, user_id
         FROM push_subscriptions
        WHERE user_id = ANY($1::uuid[])`,
      [staffIds],
    );
    if (subsRes.rows.length === 0) {
      return { totalStaff: staffIds.length, sent: 0, failed: 0, skipped: true, reason: "no_subscriptions" };
    }

    // 4. Load the order summary for the payload title. The order
    //    could have been archived / refunded since the webhook fired —
    //    in that case we still notify but mark the status.
    const orderRes = await client.query<{
      id: string;
      total: string | number;
      payment_status: string;
      status: string;
    }>(
      `SELECT id, total::numeric AS total, payment_status, status
         FROM orders WHERE id = $1`,
      [parentOrderId],
    );
    const order = orderRes.rows[0];
    const orderTotal = order ? Number(order.total).toFixed(2) : "—";
    const tag = `vendor-order-${parentOrderId}`;

    const payload = {
      title: "طلب جديد مدفوع ✅",
      body: `طلب #${parentOrderId.slice(0, 8)} بإجمالي ${orderTotal} ر.س — جاهز للتأكيد.`,
      url: `/vendor/${vendorId}/admin/orders`,
      tag,
    };

    // 5. Lazy import sendPushToEndpoint to keep this module free of the
    //    web-push dependency at import time (matches src/lib/push.ts).
    const { sendPushToEndpoint } = await import("@/lib/push");

    let sent = 0;
    let failed = 0;
    for (const sub of subsRes.rows) {
      try {
        const r = await sendPushToEndpoint(sub.endpoint, sub.p256dh, sub.auth, payload);
        if (r.ok) {
          sent++;
        } else {
          failed++;
          // Prune dead subscriptions (matches src/lib/push.ts:108).
          if (r.statusCode === 404 || r.statusCode === 410) {
            await client.query(
              `DELETE FROM push_subscriptions WHERE endpoint = $1`,
              [sub.endpoint],
            );
          }
        }
      } catch (err) {
        failed++;
        logError("[notify-vendor] push send failed", err, { endpoint: sub.endpoint });
      }
    }

    logInfo(`[notify-vendor] vendor=${vendorId} order=${parentOrderId} sent=${sent} failed=${failed}`);
    return { totalStaff: staffIds.length, sent, failed, skipped: false };
  } catch (err) {
    logError("[notify-vendor] unexpected error", err, { vendorId, parentOrderId });
    return { totalStaff: 0, sent: 0, failed: 0, skipped: true, reason: "error" };
  } finally {
    client.release();
  }
}