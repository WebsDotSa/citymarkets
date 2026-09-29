/**
 * BullMQ Worker factory — registers handlers for each job type.
 *
 * Called from `scripts/worker.ts` (the existing long-lived process) so
 * the same deployment unit both polls scheduled tasks AND processes
 * queued notifications.
 *
 * Each handler re-fetches the order from the DB (see `enqueue.ts`
 * loaders) so we always process the latest state, never a stale
 * snapshot from enqueue time.
 */
import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "./redis";
import { QUEUE_NAMES } from "./queues";

let registered: Worker[] = [];

export interface RegisterResult {
  queues: number;
  workers: number;
  redisEnabled: boolean;
}

export function registerQueueWorkers(): RegisterResult {
  const conn = getRedisConnection();
  if (!conn) {
    return { queues: 0, workers: 0, redisEnabled: false };
  }
  if (registered.length > 0) {
    return { queues: registered.length, workers: registered.length, redisEnabled: true };
  }

  registered = [
    new Worker(
      QUEUE_NAMES.NOTIFY_ADMIN_NEW_ORDER,
      async (job: Job<{ orderId: string | number }>) => {
        const { notifyAdminNewOrder } = await import("@/lib/orders/order-notify-admin");
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
          [job.data.orderId],
        );
        const row = rows[0];
        if (!row) {
          // Order disappeared between enqueue and processing. Treat as
          // success — re-processing would hit the same null result.
          return { skipped: true, reason: "order-not-found" };
        }
        await notifyAdminNewOrder({
          id: row.id,
          total: Number(row.total),
          customerName: row.guest_name ?? row.customer_name ?? null,
        });
        return { notified: true };
      },
      { connection: conn, concurrency: 4 },
    ),

    new Worker(
      QUEUE_NAMES.SEND_ORDER_PAID_SMS,
      async (job: Job<{ orderId: string | number }>) => {
        const { sendOrderPaidConfirmationSms } = await import("@/lib/orders/order-paid-confirm");
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
          [job.data.orderId],
        );
        const row = rows[0];
        if (!row) {
          return { skipped: true, reason: "order-not-found" };
        }
        const phone = row.guest_phone ?? row.user_phone ?? null;
        if (!phone) {
          return { skipped: true, reason: "no-phone" };
        }
        await sendOrderPaidConfirmationSms({
          phone,
          customer_name: row.guest_name ?? row.user_name ?? null,
          order_id: row.id,
          total: Number(row.total),
          recovered_from_abandoned_count: Number(row.recovered_count ?? 0),
        });
        return { sent: true };
      },
      { connection: conn, concurrency: 4 },
    ),

    new Worker(
      QUEUE_NAMES.NOTIFY_VENDOR_NEW_ORDER,
      async (job: Job<{ vendorId: string; orderId: string | number }>) => {
        const { notifyVendorNewOrder } = await import("@/lib/orders/notify-vendor");
        const result = await notifyVendorNewOrder({
          vendorId: job.data.vendorId,
          parentOrderId: String(job.data.orderId),
        });
        return result;
      },
      { connection: conn, concurrency: 4 },
    ),
  ];

  return { queues: registered.length, workers: registered.length, redisEnabled: true };
}

export async function closeQueueWorkers(): Promise<void> {
  await Promise.all(registered.map((w) => w.close()));
  registered = [];
}

/** Test-only reset. */
export function __resetWorkersForTests(): void {
  registered = [];
}
