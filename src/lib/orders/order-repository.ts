/**
 * Canonical SQL for order-adjacent business operations that were previously
 * spelled inline in several route handlers (duplication audit 2026-09-30).
 *
 * Every function takes the caller's `db` (a pooled client inside a
 * transaction, or the pool / `query` helper) so transactional callers stay
 * transactional. Error posture is the caller's choice: admin routes let
 * failures abort the transaction, driver routes wrap in `.catch()`.
 */
import type { QueryResult, QueryResultRow } from "pg";

export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>>;
}

/**
 * `drivers.id` linked to an admin user (role `delivery_driver`), or null.
 * `requireActiveAdmin` additionally requires `admin_users.is_active` — used
 * when an admin ASSIGNS a driver, not when a driver acts on their own queue.
 */
export async function findDriverIdByAdminUser(
  db: Queryable,
  adminUserId: string,
  opts: { requireActiveAdmin?: boolean } = {},
): Promise<string | null> {
  const res = opts.requireActiveAdmin
    ? await db.query<{ id: string }>(
        `SELECT d.id FROM drivers d
           JOIN admin_users au ON au.id = d.admin_user_id
          WHERE au.id = $1 AND au.is_active = true`,
        [adminUserId],
      )
    : await db.query<{ id: string }>(
        `SELECT id FROM drivers WHERE admin_user_id = $1`,
        [adminUserId],
      );
  return (res.rows[0]?.id as string | undefined) ?? null;
}

/**
 * Give back the coupon use consumed at checkout when an order is cancelled.
 * Pair of the `used_count + 1` increment in `checkout/create-checkout.ts`.
 * Never drops below zero.
 */
export async function releaseCouponUseForOrder(
  db: Queryable,
  orderId: string,
): Promise<void> {
  await db.query(
    `UPDATE coupons
        SET used_count = GREATEST(used_count - 1, 0)
      WHERE code = (SELECT coupon_code FROM orders WHERE id = $1)
        AND used_count > 0`,
    [orderId],
  );
}

/**
 * Post a `system` message on a direct order's chat. `adminId` attributes the
 * message to the admin who caused it (status change, driver reassignment).
 */
export async function postDirectOrderSystemMessage(
  db: Queryable,
  args: { orderId: string; body: string; adminId?: string | null },
): Promise<void> {
  if (args.adminId) {
    await db.query(
      `INSERT INTO direct_order_messages
         (order_id, sender_type, sender_admin_id, body, message_kind)
       VALUES ($1, 'system', $2, $3, 'system')`,
      [args.orderId, args.adminId, args.body],
    );
    return;
  }
  await db.query(
    `INSERT INTO direct_order_messages
       (order_id, sender_type, body, message_kind)
     VALUES ($1, 'system', $2, 'system')`,
    [args.orderId, args.body],
  );
}
