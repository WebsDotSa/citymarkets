/**
 * Shared payment reconciliation — used by every payment-gateway webhook
 * (Moyasar, Tamara, …) so the order-state + loyalty + abandoned-cart
 * fan-out stays in one place. Before this helper existed, the Moyasar
 * webhook at `src/app/api/v1/payments/webhook/route.ts` and the Tamara
 * webhook at `src/app/api/v1/payments/tamara/webhook/route.ts` carried
 * near-identical 200-line bodies (advisory lock + lifecycle flip +
 * loyalty resolve + abandoned-cart recovery). This module is the
 * single source of truth.
 *
 * What it does:
 *   1. Records the gateway event in `payment_events` (UNIQUE short-circuit
 *      against replays). On duplicate, finalises the existing ledger row
 *      and returns `{recoveredCount: 0, duplicate: true}` so the caller
 *      can ack 200 immediately.
 *   2. Takes a per-order `pg_advisory_xact_lock` so concurrent callbacks
 *      for the same parent order serialise.
 *   3. Mirrors the gateway's payment_status onto `orders` AND every
 *      `vendor_orders` child, guarded by CASE so a stale 'pending'
 *      callback can never regress a 'paid' / 'failed' terminal state.
 *   4. On paid orders: rolls fulfillment lifecycle forward (pending →
 *      confirmed), resolves the loyalty redeem hold, awards earn
 *      points, and marks the matching abandoned-cart snapshot as
 *      recovered.
 *
 * What it deliberately does NOT do:
 *   - COMMIT (caller owns the transaction lifecycle so the webhook can
 *     wrap the ledger + reconciliation atomically).
 *   - Fire any post-commit side-effects (push notifications, vendor
 *     fan-out, abandoned-cart-recovery SMS). Those happen AFTER COMMIT
 *     in the webhook handler so a slow worker never reads DB state
 *     before COMMIT propagates. See the post-COMMIT block in each
 *     webhook.
 *
 * Caller contract:
 *   - Pass a `PoolClient` that is already inside an open transaction
 *     (`BEGIN` was called by the caller). The helper will issue more
 *     queries against that client.
 *   - The `orderRow` must come from the webhook's own SELECT so the
 *     `total`, `catalog_subtotal`, `points_redeemed`, `user_id`, and
 *     `guest_phone` columns are guaranteed consistent.
 */

import type { PoolClient } from "pg";
import {
  recordPaymentEvent,
  finalizePaymentEvent,
  type PaymentGateway,
} from "@/lib/payments/event-ledger";
import {
  awardPointsForOrder,
  getLoyaltySettings,
  resolveRedeemForOrder,
} from "@/lib/orders/loyalty";
import { error as logError } from "@/lib/logger";

export type PaymentDbStatus = "paid" | "failed" | "pending" | "refunded";

export interface ReconcileOrderRow {
  id: string;
  total: number | string | null;
  catalog_subtotal: number | string | null;
  user_id: string | null;
  points_redeemed: number | string | null;
  guest_phone: string | null;
}

export interface ReconcileArgs {
  invoiceId: string;
  gateway: PaymentGateway;
  eventType: string;
  /** Status the gateway confirmed (or rejected) — already mapped to
   *  the canonical DB enum. */
  paymentDb: PaymentDbStatus;
  /** Full webhook body — stored as `payment_events.raw_payload` for
   *  audit / replay. */
  rawBody: unknown;
  /** Row from the caller's own `SELECT … FROM orders WHERE
   *  payment_reference = $1`. Required so this helper never re-reads
   *  the order outside the caller's lock window. */
  orderRow: ReconcileOrderRow;
}

export interface ReconcileResult {
  /** Number of abandoned-cart snapshots that were marked recovered
   *  during this reconcile. > 0 means the caller should enqueue the
   *  customer-facing "your abandoned cart recovered" SMS AFTER COMMIT. */
  recoveredCount: number;
  /** True when a duplicate ledger INSERT short-circuited the work.
   *  Caller must NOT double-fire side effects in this case. */
  duplicate: boolean;
}

/**
 * Apply the gateway-confirmed payment_status onto the parent order
 * and every Slice 3 `vendor_orders` child. Guarded by CASE so a
 * stale 'pending' callback can never regress a 'paid' / 'failed'
 * terminal state.
 */
async function mirrorPaymentStatus(
  client: PoolClient,
  args: { orderId: string; paymentDb: PaymentDbStatus },
): Promise<void> {
  const { orderId, paymentDb } = args;
  await client.query(
    `UPDATE orders
        SET payment_status = CASE
          WHEN payment_status = 'paid'   THEN 'paid'
          WHEN payment_status = 'failed' AND $1 = 'pending' THEN 'failed'
          ELSE $1
        END,
        updated_at = NOW()
      WHERE id = $2`,
    [paymentDb, orderId],
  );
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
}

/**
 * Roll fulfillment lifecycle forward on a successful payment.
 * Uses CASE so a late 'paid' callback can never regress an
 * already-confirmed/preparing/ready/etc. order back to pending.
 * Mirrors the change onto every `vendor_orders` child.
 *
 * AUDIT (PCP-80): also writes a parent-row `order_status_logs`
 * entry when the parent order actually flips `pending → confirmed`.
 * Replay-safe: the CTE atomically captures the pre-flip status
 * (`old.status`), and the conditional INSERT only writes a log
 * row when `old.status = 'pending'`. A duplicate paid webhook
 * (orders.status already = 'confirmed') produces zero new log
 * rows, so the audit trail stays clean even under gateway
 * retry storms.
 */
async function flipFulfillmentLifecycle(
  client: PoolClient,
  args: { orderId: string; gateway: PaymentGateway; eventType: string },
): Promise<void> {
  const { orderId, gateway, eventType } = args;
  // Atomic CTE: old snapshots pre-update status, upd runs the CASE
  // -guarded UPDATE, audit conditionally INSERTs the order_status_logs
  // row only when the parent actually flipped. Replay webhooks leave
  // old.status = 'confirmed' and the audit INSERT writes zero rows.
  await client.query(
    `WITH old AS (
       SELECT id, status FROM orders WHERE id = $1
     ),
     upd AS (
       UPDATE orders
          SET status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END
        WHERE id = $1
        RETURNING id, status AS new_status
     ),
     audit AS (
       INSERT INTO order_status_logs
         (order_id, old_status, new_status, changed_by, notes)
       SELECT $1, old.status, upd.new_status, 'system:payment_webhook', $2
         FROM upd, old
        WHERE old.status = 'pending'
       RETURNING id
     )
     SELECT
       (SELECT new_status FROM upd) AS new_status,
       (SELECT COUNT(*) FROM audit)::int AS audit_rows_written`,
    [orderId, `${gateway}:${eventType} → parent pending → confirmed`],
  );
  await client.query(
    `UPDATE vendor_orders
        SET status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END
      WHERE parent_order_id = $1`,
    [orderId],
  );
}

/**
 * Award loyalty + resolve redeem hold + mark abandoned-cart snapshot
 * recovered. Best-effort — a single failure (e.g. transient DB error)
 * is logged but does not roll back the parent reconciliation.
 */
async function runPaidSideEffects(
  client: PoolClient,
  args: { orderId: string; orderRow: ReconcileOrderRow },
): Promise<{ recoveredCount: number }> {
  const { orderId, orderRow } = args;
  let recoveredCount = 0;

  // SECURITY (Pay-H): resolve any pending_redeem hold into a real
  // debit. The hold was placed at order creation so the user sees a
  // "reservation" on their activity feed but the balance was untouched.
  // Now that payment is confirmed we can safely deduct. Idempotent
  // via UNIQUE(ref_order_id, type='redeem').
  const userId = orderRow.user_id ?? null;
  const redeemPoints = Math.floor(Number(orderRow.points_redeemed ?? 0));
  if (userId && redeemPoints > 0) {
    try {
      await resolveRedeemForOrder(client, {
        orderId,
        userId,
        pointsRedeemed: redeemPoints,
      });
    } catch (redeemErr) {
      logError("[reconcile] loyalty redeem resolve failed", redeemErr, { orderId });
    }
  }

  // Award loyalty points for paid orders with a logged-in user.
  // Catalog subtotal only — Slice 3 policy: vendor orders earn at
  // the vendor's discretion, not the marketplace's.
  const catalogSubtotal = Number(orderRow.catalog_subtotal ?? 0);
  if (userId && catalogSubtotal > 0) {
    try {
      const loyaltySettings = await getLoyaltySettings();
      await awardPointsForOrder(client, {
        orderId,
        userId,
        catalogSubtotal,
        settings: loyaltySettings,
      });
    } catch (earnErr) {
      logError("[reconcile] loyalty earn failed", earnErr, { orderId });
    }
  }

  // Recover any abandoned carts that belong to this customer.
  // Idempotent — re-running on a webhook replay is safe.
  // Best-effort: a snapshot miss should never block the payment.
  try {
    const { markAbandonedCartRecovered } = await import(
      "@/lib/orders/abandoned-carts"
    );
    const guestPhone =
      orderRow.guest_phone != null && orderRow.guest_phone !== ""
        ? String(orderRow.guest_phone)
        : null;
    const { recovered_count } = await markAbandonedCartRecovered(orderId, {
      user_id: userId,
      guest_phone: guestPhone,
    });
    recoveredCount = recovered_count;
  } catch (acErr) {
    logError("[reconcile] abandoned-carts recovery failed", acErr, { orderId });
  }

  return { recoveredCount };
}

/**
 * Reconcile a gateway callback against the parent order. See file
 * header for full contract.
 */
export async function reconcilePayment(
  client: PoolClient,
  args: ReconcileArgs,
): Promise<ReconcileResult> {
  const { invoiceId, gateway, eventType, paymentDb, rawBody, orderRow } = args;
  const orderId = orderRow.id;

  // ---- 1. Record the gateway event in the ledger ----
  // The UNIQUE (invoice_id, gateway, event_type) index turns a
  // gateway replay into a 23505 short-circuit. Mirrors the pattern
  // both webhooks had before this extraction.
  const ledgerResult = await recordPaymentEvent(client, {
    invoiceId,
    gateway,
    eventType,
    raw: rawBody,
  });
  if (ledgerResult === "duplicate") {
    // Finalize so subsequent replays see status='processed' instead of
    // 'received'. orderId is NOT passed — the ledger row already has
    // whatever order_id it had from the original insert (NULL when
    // the original handler never matched an order).
    try {
      await finalizePaymentEvent(client, {
        invoiceId,
        gateway,
        eventType,
        status: "processed",
      });
    } catch (finalErr) {
      logError("[reconcile] duplicate finalize failed", finalErr, {
        invoiceId,
      });
    }
    return { recoveredCount: 0, duplicate: true };
  }

  // ---- 2. Per-order advisory lock so concurrent callbacks for
  //         the same parent order serialise. Released on
  //         COMMIT/ROLLBACK by Postgres. ----
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `order:${orderId}`,
  ]);

  // ---- 3. Mirror payment_status onto parent + every child ----
  await mirrorPaymentStatus(client, { orderId, paymentDb });

  let recoveredCount = 0;
  if (paymentDb === "paid") {
    // ---- 4a. Lifecycle flip ----
    await flipFulfillmentLifecycle(client, { orderId, gateway, eventType });

    // ---- 4b. Loyalty + abandoned-cart recovery ----
    ({ recoveredCount } = await runPaidSideEffects(client, {
      orderId,
      orderRow,
    }));
  }

  return { recoveredCount, duplicate: false };
}