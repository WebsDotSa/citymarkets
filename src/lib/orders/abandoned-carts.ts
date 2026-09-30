/**
 * Abandoned Carts — shared module.
 *
 * Tracks carts that reached checkout but did not complete online payment.
 * Two flows funnel through here:
 *
 *  1. `snapshotAbandonedCartFromOrder` is called from POST /api/v1/checkout
 *     AFTER COMMIT for non-cash/wallet orders (payment_method in
 *     {card, mada, visa, mastercard, amex, applepay, stcpay, moyasar_*,
 *     bank_transfer}). It captures the order's items + the actor
 *     identifier (user_id, or guest_session_id/phone/name) so the
 *     abandonment can be tied back to the customer even when they never
 *     created an account.
 *
 *  2. `markAbandonedCartRecovered` is called from payment-gateway webhooks
 *     AFTER payment_status flips to 'paid'. It looks up any still-open
 *     'abandoned' snapshots for the same actor (excluding the order that
 *     just paid — that snapshot will be created when the customer next
 *     starts a new flow), stamps them with status='recovered' and
 *     recovered_order_id, and returns the count so the caller can use it
 *     in a personalised confirmation message.
 *
 * The table is intentionally permissive about anonymous users: guest
 * identifiers are recorded so the admin /admin/abandoned-carts page can
 * show "this phone number started checkout 3 times and recovered on the
 * 4th". No profile or login is required.
 *
 * Idempotency: a UNIQUE partial index on intent_order_id prevents the
 * same snapshot from being created twice if POST /api/v1/checkout is
 * retried (the orders.idempotency_key UNIQUE catches that scenario
 * upstream, but this index is a backstop).
 */

import { pool } from "@/lib/db";
import { error as logError, info as logInfo } from "@/lib/logger";

/** Single line item as serialized into the abandoned_carts.items JSONB. */
export interface AbandonedCartItem {
  product_id: string;
  name_ar: string;
  quantity: number;
  unit_price: number;
  image_url?: string | null;
  vendor_id?: string | null;
}

export interface AbandonedCartActor {
  user_id?: string | null;
  guest_session_id?: string | null;
  guest_name?: string | null;
  guest_phone?: string | null;
}

export interface AbandonedCartSnapshotInput extends AbandonedCartActor {
  intent_order_id: string;
  items: AbandonedCartItem[];
  subtotal: number;
}

export interface AbandonedCartRecoveryResult {
  recovered_count: number;
  /** The most recent still-unrecovered snapshot, in case the caller wants to mention it. */
  latest_intent_order_id: string | null;
}

/**
 * Snapshot a non-cash/wallet order's items as an "abandoned" cart row.
 *
 * Best-effort: any DB failure is logged at `error` and swallowed — we
 * never want a malformed abandoned-carts row to break the customer's
 * checkout. Idempotent via the UNIQUE partial index on intent_order_id.
 */
export async function snapshotAbandonedCartFromOrder(
  input: AbandonedCartSnapshotInput,
): Promise<void> {
  const {
    user_id,
    guest_session_id,
    guest_name,
    guest_phone,
    intent_order_id,
    items,
    subtotal,
  } = input;

  if (!items || items.length === 0) {
    return;
  }

  const items_count = items.reduce((sum, i) => sum + i.quantity, 0);
  const safeSubtotal = Number.isFinite(subtotal) && subtotal > 0 ? subtotal : 0;

  try {
    await pool.query(
      `INSERT INTO abandoned_carts (
         user_id, guest_session_id, guest_name, guest_phone,
         items_count, subtotal, items, intent_order_id, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'abandoned')
       ON CONFLICT (intent_order_id) DO NOTHING`,
      [
        user_id || null,
        guest_session_id || null,
        guest_name || null,
        guest_phone || null,
        items_count,
        safeSubtotal,
        JSON.stringify(items),
        intent_order_id,
      ],
    );
  } catch (err) {
    logError("abandoned-carts: snapshot insert failed", {
      intent_order_id,
      err: (err as Error)?.message,
    });
  }
}

/**
 * Mark any still-open snapshots for the same actor as recovered.
 *
 * Skips the snapshot whose intent_order_id equals `recovered_order_id`
 * (that row will be inserted by the next /api/v1/orders POST, not by
 * this call). Only flips status, recovered_order_id, and last_seen_at.
 *
 * Returns how many snapshots were recovered and the most recent
 * intent_order_id of a recovered row (or null if none).
 */
export async function markAbandonedCartRecovered(
  recovered_order_id: string,
  actor: AbandonedCartActor,
): Promise<AbandonedCartRecoveryResult> {
  const { user_id, guest_session_id, guest_phone } = actor;

  if (!recovered_order_id) {
    return { recovered_count: 0, latest_intent_order_id: null };
  }

  // We OR-match on user_id (logged-in buyers) and guest_phone (visitors
  // who entered a phone number at checkout). guest_session_id is intentionally
  // not used here — sessions get rotated when a guest signs in, so the user_id
  // link is more durable.
  if (!user_id && !guest_phone) {
    return { recovered_count: 0, latest_intent_order_id: null };
  }

  try {
    const updated = await pool.query<{ id: string; intent_order_id: string }>(
      `UPDATE abandoned_carts
          SET status = 'recovered',
              recovered_order_id = $1,
              last_seen_at = NOW()
        WHERE status = 'abandoned'
          AND intent_order_id <> $1
          AND (
            ($2::uuid IS NOT NULL AND user_id = $2)
            OR ($3::text IS NOT NULL AND guest_phone = $3)
          )
        RETURNING id, intent_order_id`,
      [recovered_order_id, user_id || null, guest_phone || null],
    );

    const recovered_count = updated.rows.length;
    const latest_intent_order_id =
      recovered_count > 0 ? updated.rows[0].intent_order_id : null;

    if (recovered_count > 0) {
      logInfo("abandoned-carts: recovered", {
        recovered_order_id,
        recovered_count,
      });
    }

    return { recovered_count, latest_intent_order_id };
  } catch (err) {
    logError("abandoned-carts: recovery update failed", {
      recovered_order_id,
      err: (err as Error)?.message,
    });
    return { recovered_count: 0, latest_intent_order_id: null };
  }
}

/**
 * Quick lookup — does this order have an abandoned-cart snapshot tied
 * to it? Used by the admin order detail page to render the
 * "أُنشئت من سلة متروكة" badge.
 */
export async function findAbandonedSnapshotByIntentOrder(
  intent_order_id: string,
): Promise<{ id: string; status: string } | null> {
  if (!intent_order_id) return null;

  try {
    const r = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM abandoned_carts WHERE intent_order_id = $1 LIMIT 1`,
      [intent_order_id],
    );
    return r.rows[0] ?? null;
  } catch (err) {
    logError("abandoned-carts: lookup failed", {
      intent_order_id,
      err: (err as Error)?.message,
    });
    return null;
  }
}
