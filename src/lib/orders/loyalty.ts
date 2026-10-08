/**
 * Loyalty system — shared module.
 *
 * Three concerns live here:
 *  1. Settings (`LoyaltySettings`, `getLoyaltySettings`) — runtime-tunable
 *     values stored in `app_settings['loyalty']`. The admin /admin/loyalty
 *     page mutates them; every earn/redeem path reads the latest.
 *  2. Pure math (`computeEarnPoints`) — given a subtotal and settings,
 *     return the number of points to credit. Used by both the webhook and
 *     the admin COD award path so the rate stays in lockstep.
 *  3. DB writers (`awardPointsForOrder`, `resolveRedeemForOrder`) — both
 *     idempotent via UNIQUE(ref_order_id, type) on loyalty_transactions.
 *     The application's two webhook paths (Moyasar + Tamara) and the
 *     admin COD status transition all funnel through here so they share
 *     one implementation of the earn/redeem mechanics.
 *
 * History: prior to this module the earn/redeem SQL was duplicated in
 * three routes. All three sites have been failing silently in production
 * because migration 026 recorded as applied but its partial unique index
 * never satisfied `ON CONFLICT (ref_order_id, type) DO NOTHING`. Migration
 * 046 fixes the index. This module keeps the earn rate at the marketing
 * rate (10 SAR = 1 point → earn_points_per_sar = 0.1) so the /loyalty
 * page and the actual credit stay consistent.
 */

import type { PoolClient } from "pg";
import { error as logError } from "@/lib/logger";
import { getAppSetting } from "@/lib/app-settings";

export interface LoyaltySettings {
  enabled: boolean;
  /** SAR → points. 0.1 means "10 SAR = 1 point earned". */
  earn_points_per_sar: number;
  /** Points → SAR. 0.05 means "1 point = 0.05 SAR" (100pts = 5 SAR). */
  redeem_value_per_point: number;
  /** Minimum bundle the user must redeem in one go. */
  min_redeem_points: number;
  /** Cap on how much of (subtotal − coupon) can be paid with points. */
  max_redeem_percent: number;
}

export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  enabled: true,
  earn_points_per_sar: 0.1,
  redeem_value_per_point: 0.05,
  min_redeem_points: 100,
  max_redeem_percent: 0.5,
};

export async function getLoyaltySettings(): Promise<LoyaltySettings> {
  return getAppSetting<LoyaltySettings>("loyalty", DEFAULT_LOYALTY_SETTINGS);
}

/**
 * Pure: how many points does `catalogSubtotal` SAR earn?
 *
 * `Math.floor` rounds down — partial points don't exist, and we don't want
 * 9.99 SAR earning a phantom point that gets rounded away when written.
 */
export function computeEarnPoints(
  catalogSubtotal: number,
  settings: LoyaltySettings,
): number {
  if (!settings.enabled) return 0;
  if (!Number.isFinite(catalogSubtotal) || catalogSubtotal <= 0) return 0;
  return Math.floor(catalogSubtotal * settings.earn_points_per_sar);
}

interface AwardArgs {
  orderId: string;
  userId: string;
  catalogSubtotal: number;
  settings: LoyaltySettings;
}

interface AwardResult {
  awarded: number;
  duplicate: boolean;
}

/**
 * Idempotent earn: writes one 'earn' row and, on a fresh insert,
 * credits loyalty_points and stamps orders.points_earned.
 *
 * Caller must pass a PoolClient (or any pg client) so this runs inside
 * the same transaction as the parent status change. Returns the number
 * of points actually credited (0 when the earn was already done by a
 * prior webhook/admin retry).
 */
export async function awardPointsForOrder(
  client: PoolClient,
  args: AwardArgs,
): Promise<AwardResult> {
  const { orderId, userId, catalogSubtotal, settings } = args;
  const points = computeEarnPoints(catalogSubtotal, settings);
  if (points <= 0) return { awarded: 0, duplicate: false };

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO loyalty_transactions (user_id, points, type, ref_order_id)
     VALUES ($1, $2, 'earn'::loyalty_tx_type_enum, $3)
     ON CONFLICT (ref_order_id, type) DO NOTHING
     RETURNING id`,
    [userId, points, orderId],
  );

  if (inserted.rows.length === 0) {
    return { awarded: 0, duplicate: true };
  }

  await client.query(
    `INSERT INTO loyalty_points (user_id, balance, lifetime_earned)
     VALUES ($1, $2, $2)
     ON CONFLICT (user_id) DO UPDATE
       SET balance = loyalty_points.balance + $2,
           lifetime_earned = loyalty_points.lifetime_earned + $2,
           updated_at = NOW()`,
    [userId, points],
  );
  await client.query(`UPDATE orders SET points_earned = $1 WHERE id = $2`, [
    points,
    orderId,
  ]);

  return { awarded: points, duplicate: false };
}

interface RedeemArgs {
  orderId: string;
  userId: string;
  pointsRedeemed: number;
}

interface RedeemResult {
  debited: number;
  duplicate: boolean;
}

/**
 * Idempotent redeem resolve: converts the pending_redeem hold placed at
 * checkout into a real debit. Safe to call multiple times — only the
 * first call debits the balance.
 *
 * Caller must pass a PoolClient so this runs inside the same transaction
 * as the parent status change.
 */
export async function resolveRedeemForOrder(
  client: PoolClient,
  args: RedeemArgs,
): Promise<RedeemResult> {
  const { orderId, userId, pointsRedeemed } = args;
  const points = Math.floor(pointsRedeemed);
  if (points <= 0) return { debited: 0, duplicate: false };

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO loyalty_transactions (user_id, points, type, ref_order_id)
     VALUES ($1, $2, 'redeem'::loyalty_tx_type_enum, $3)
     ON CONFLICT (ref_order_id, type) DO NOTHING
     RETURNING id`,
    [userId, -points, orderId],
  );

  if (inserted.rows.length === 0) {
    return { debited: 0, duplicate: true };
  }

  // PCP-145: the original code did not inspect the UPDATE's rowCount.
  // If a concurrent order drained the user's balance between the
  // `pending_redeem` hold and this resolve, the WHERE clause `balance
  // >= $1` matches 0 rows, no exception fires, and the function
  // returned `{ debited: points, duplicate: false }` — leaving an
  // orphan `redeem` ledger row whose `loyalty_points.balance` was
  // never debited. The customer effectively paid for this order
  // with points that stayed available for the next order
  // (double-spend).
  //
  // Capture rowCount and throw if 0 rows matched. Throwing lets the
  // caller's transaction ROLLBACK, removing the orphan ledger row,
  // and the outer try/catch in `reconcile-payment.ts` and
  // `maybeCreditLoyaltyOnDelivery` will log the failure to ops.
  const debited = await client.query(
    `UPDATE loyalty_points
        SET balance = balance - $1,
            lifetime_redeemed = lifetime_redeemed + $1,
            updated_at = NOW()
      WHERE user_id = $2 AND balance >= $1`,
    [points, userId],
  );

  if ((debited.rowCount ?? 0) === 0) {
    throw new Error(
      `[loyalty] resolveRedeemForOrder: insufficient balance for user=${userId} ` +
        `(attempted to debit ${points} points; concurrent spend likely). ` +
        `Order=${orderId}. Rolling back orphan redeem ledger row.`,
    );
  }

  return { debited: points, duplicate: false };
}

/**
 * Release a pending_redeem hold when an order is cancelled (P1-7 fix).
 *
 * Background:
 *   At checkout, the redemption path inserts a `pending_redeem` row
 *   in `loyalty_transactions` so the customer can't double-spend
 *   those points. The hold is normally converted to `redeem` on
 *   payment success (idempotent via UNIQUE) — but on cancellation
 *   the row was previously left in place, causing the customer's
 *   "available points" preview to drift downward over time as
 *   cancelled orders accumulated unreleased holds.
 *
 * This helper DELETEs the hold row. Safe to call multiple times
 * (idempotent — second call is a no-op).
 *
 * Caller must pass a PoolClient so this runs inside the same
 * transaction as the parent status change.
 */
export async function releaseRedeemHoldForOrder(
  client: PoolClient,
  args: { orderId: string },
): Promise<{ released: boolean }> {
  const deleted = await client.query(
    `DELETE FROM loyalty_transactions
      WHERE ref_order_id = $1
        AND type = 'pending_redeem'::loyalty_tx_type_enum
      RETURNING id`,
    [args.orderId],
  );
  return { released: (deleted.rowCount ?? 0) > 0 };
}

/**
 * P2-3 (PCP-76.F2): self-contained variant that acquires its OWN
 * connection. Use this from background / post-COMMIT paths where the
 * caller's `PoolClient` is already released and we cannot reuse it.
 *
 * Best-effort: any connection failure is swallowed and surfaced via the
 * logger so it never bubbles up to the caller. This matches the
 * `.catch(() => {})` posture already used at the call sites.
 */
export async function releaseRedeemHoldForOrderSafe(
  pool: import("pg").Pool,
  args: { orderId: string },
): Promise<void> {
  const client = await pool.connect().catch(() => null);
  if (!client) return;
  try {
    await releaseRedeemHoldForOrder(client, args);
  } catch (err) {
    logError("[loyalty] release hold failed (safe)", err, { orderId: args.orderId });
  } finally {
    client.release();
  }
}
