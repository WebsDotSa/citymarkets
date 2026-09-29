/**
 * Enqueue helpers for critical order notifications.
 *
 * These are the public API the route handlers call. They:
 *   1. Try to enqueue the job to BullMQ (durable, retried, async).
 *   2. On Redis failure / missing REDIS_URL, fall back to running the
 *      notification function directly with `void` (fire-and-forget).
 *
 * Net effect on callers:
 *   - Async path: response returns immediately; worker processes later.
 *   - Sync fallback: same behavior as before the refactor.
 *   - In both cases, the request is not blocked on the slow side
 *     (Twilio, WhatsApp click-to-chat, etc.).
 */
import { getQueue, QUEUE_NAMES, makeNotifyAdminNewOrderOptions, makeNotifyVendorNewOrderOptions } from "./queues";
import { isQueueEnabled } from "./redis";

interface EnqueueResult {
  /** True if the job was placed on the queue; false if it ran synchronously. */
  queued: boolean;
  jobId: string;
}

/**
 * Enqueue a "new order" notification to the admin channel
 * (WhatsApp click-to-chat or push, per `getNotificationSettings()`).
 *
 * @param orderId - the order's primary key. The worker re-fetches the order
 *                  and computes the message at processing time.
 */
export async function enqueueAdminNewOrder(orderId: string | number): Promise<EnqueueResult> {
  const jobId = `order-${orderId}`;
  if (!isQueueEnabled()) {
    // Fallback: run inline. Fire-and-forget; same as the pre-queue behavior.
    void runNotifyAdminNewOrder(orderId);
    return { queued: false, jobId };
  }
  const queue = getQueue(QUEUE_NAMES.NOTIFY_ADMIN_NEW_ORDER);
  if (!queue) {
    void runNotifyAdminNewOrder(orderId);
    return { queued: false, jobId };
  }
  await queue.add("notify", { orderId }, makeNotifyAdminNewOrderOptions(orderId));
  return { queued: true, jobId };
}

/**
 * Enqueue an "order paid" SMS confirmation to the customer.
 *
 * The worker re-fetches the order + address + recovered-abandoned count
 * and composes the SMS body via `buildOrderPaidConfirmationBody`.
 */
export async function enqueueOrderPaidSms(orderId: string | number): Promise<EnqueueResult> {
  const jobId = `order-${orderId}`;
  if (!isQueueEnabled()) {
    void runSendOrderPaidSms(orderId);
    return { queued: false, jobId };
  }
  const queue = getQueue(QUEUE_NAMES.SEND_ORDER_PAID_SMS);
  if (!queue) {
    void runSendOrderPaidSms(orderId);
    return { queued: false, jobId };
  }
  await queue.add("sms", { orderId }, makeNotifyAdminNewOrderOptions(orderId));
  return { queued: true, jobId };
}

/**
 * Enqueue a "new paid order" push notification for every active staff
 * member of the given vendor. Closes Gap D from the production-completion
 * audit — vendors used to learn about new orders only by refreshing the
 * dashboard.
 *
 * The fan-out is per-vendor: a multi-vendor order calls this once per
 * child vendor_order. Each (vendorId, orderId) pair becomes a distinct
 * BullMQ job, idempotent on the `vendor:<vendorId>:order:<orderId>`
 * key (see `makeNotifyVendorNewOrderOptions`) so a webhook replay never
 * double-notifies the same vendor for the same order.
 *
 * Falls back to inline execution when Redis is unavailable (matches the
 * admin-notify and order-paid-SMS fallback pattern).
 */
export async function enqueueNotifyVendorNewOrder(args: {
  vendorId: string;
  orderId: string | number;
}): Promise<EnqueueResult> {
  const jobId = `vendor:${args.vendorId}:order:${args.orderId}`;
  if (!isQueueEnabled()) {
    void runNotifyVendorNewOrder(args);
    return { queued: false, jobId };
  }
  const queue = getQueue(QUEUE_NAMES.NOTIFY_VENDOR_NEW_ORDER);
  if (!queue) {
    void runNotifyVendorNewOrder(args);
    return { queued: false, jobId };
  }
  await queue.add(
    "notify",
    { vendorId: args.vendorId, orderId: args.orderId },
    makeNotifyVendorNewOrderOptions(args),
  );
  return { queued: true, jobId };
}

// ── Fallback direct-call paths (used when Redis is unavailable) ─────────

async function runNotifyAdminNewOrder(orderId: string | number): Promise<void> {
  try {
    const order = await loadOrderForNotification(orderId);
    if (!order) return;
    const { notifyAdminNewOrder } = await import("@/lib/orders/order-notify-admin");
    await notifyAdminNewOrder(order);
  } catch {
    /* helper logs internally; swallow */
  }
}

async function runSendOrderPaidSms(orderId: string | number): Promise<void> {
  try {
    const args = await loadPaidSmsArgs(orderId);
    if (!args) return;
    const { sendOrderPaidConfirmationSms } = await import("@/lib/orders/order-paid-confirm");
    await sendOrderPaidConfirmationSms(args);
  } catch {
    /* helper logs internally; swallow */
  }
}

async function runNotifyVendorNewOrder(args: {
  vendorId: string;
  orderId: string | number;
}): Promise<void> {
  try {
    const { notifyVendorNewOrder } = await import("@/lib/orders/notify-vendor");
    await notifyVendorNewOrder({
      vendorId: args.vendorId,
      parentOrderId: String(args.orderId),
    });
  } catch {
    /* helper logs internally; swallow */
  }
}

// ── DB loaders used by both worker handlers and fallback paths ──────────

interface NotifyAdminOrder {
  id: string | number;
  total: number;
  customerName?: string | null;
}

async function loadOrderForNotification(orderId: string | number): Promise<NotifyAdminOrder | null> {
  const { pool } = await import("@/lib/db");
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

async function loadPaidSmsArgs(orderId: string | number): Promise<{
  phone: string | null;
  customer_name?: string | null;
  order_id: string | number;
  total: number;
  recovered_from_abandoned_count?: number;
} | null> {
  const { pool } = await import("@/lib/db");
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
