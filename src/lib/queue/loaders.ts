/**
 * Canonical DB loaders for queue notifications.
 *
 * Previously these were private to `enqueue.ts` (used by the synchronous
 * fallback path) AND re-implemented inline inside `workers.ts` (used by
 * the BullMQ async path). The duplication drifted over time and made it
 * easy for the worker to send stale or partial payloads. Centralising
 * here means both paths always see the same SELECT and the same shape.
 *
 * Contract:
 *   - loadOrderForNotification:    orders.id + total + customerName (admin notifier payload)
 *   - loadPaidSmsArgs:             + phone + recovered-from-abandoned count (paid-SMS payload)
 *
 * Both loaders accept `string | number` orderId to match the existing
 * `orderId` types in `enqueue.ts` and `workers.ts`; the type widening is
 * preserved downstream so callers don't need to coerce.
 */
import { pool } from "@/lib/db";

export interface NotifyAdminOrder {
  id: string | number;
  total: number;
  customerName?: string | null;
}

export interface PaidSmsArgs {
  phone: string;
  customer_name?: string | null;
  order_id: string | number;
  total: number;
  recovered_from_abandoned_count?: number;
}

/**
 * Load the order row used by `notifyAdminNewOrder`.
 *
 * SELECT: orders.id, orders.total, orders.guest_name, users.name (LEFT JOIN)
 * Returns null when the order has been deleted between enqueue and
 * processing — callers should treat that as a successful no-op.
 */
export async function loadOrderForNotification(
  orderId: string | number,
): Promise<NotifyAdminOrder | null> {
  const { rows } = await pool.query<{
    id: string | number;
    total: number | string;
    guest_name: string | null;
    customer_name: string | null;
  }>(
    `SELECT o.id, o.total, o.guest_name, u.name AS customer_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
      LIMIT 1`,
    [orderId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    total: Number(row.total),
    customerName: row.guest_name ?? row.customer_name ?? null,
  };
}

/**
 * Load the args used by `sendOrderPaidConfirmationSms`.
 *
 * SELECT: id, total, guest name/phone, user name/phone, abandoned-cart
 * recovery count (COALESCE subquery). Returns null when the order is
 * missing OR when no phone is resolvable (guest + user both blank).
 */
export async function loadPaidSmsArgs(
  orderId: string | number,
): Promise<PaidSmsArgs | null> {
  const { rows } = await pool.query<{
    id: string | number;
    total: number | string;
    guest_name: string | null;
    guest_phone: string | null;
    user_phone: string | null;
    user_name: string | null;
    recovered_count: number | string | null;
  }>(
    `SELECT o.id, o.total, o.guest_name, o.guest_phone,
            u.name AS user_name, u.phone AS user_phone,
            COALESCE((SELECT COUNT(*)::int FROM abandoned_carts ac
                       WHERE ac.recovered_order_id = o.id), 0) AS recovered_count
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
      WHERE o.id = $1
      LIMIT 1`,
    [orderId],
  );
  const row = rows[0];
  if (!row) return null;
  const phone = row.guest_phone ?? row.user_phone ?? null;
  if (!phone) return null;
  return {
    phone,
    customer_name: row.guest_name ?? row.user_name ?? null,
    order_id: row.id,
    total: Number(row.total),
    recovered_from_abandoned_count: Number(row.recovered_count ?? 0),
  };
}

/**
 * Load the list of vendor IDs that participate in a parent order.
 *
 * Replaces the verbatim SELECT + loop that previously lived inline in
 * BOTH `payments/webhook/route.ts` and `payments/tamara/webhook/route.ts`.
 * Both webhooks now iterate this list and call `enqueueNotifyVendorNewOrder`
 * per vendor, with the per-vendor granularity preserved for test assertions.
 *
 * Returns string[] (vendor_id cast to text at the DB layer).
 */
export async function loadOrderVendorIds(
  orderId: string | number,
): Promise<string[]> {
  const { rows } = await pool.query<{ vendor_id: string }>(
    `SELECT vendor_id::text AS vendor_id FROM vendor_orders WHERE parent_order_id = $1`,
    [orderId],
  );
  return rows.map((r) => r.vendor_id);
}