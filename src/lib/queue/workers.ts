/**
 * BullMQ Worker factory — registers handlers for each job type.
 *
 * Called from `scripts/worker.ts` (the existing long-lived process) so
 * the same deployment unit both polls scheduled tasks AND processes
 * queued notifications.
 *
 * Each handler re-fetches the order from the DB (see `./loaders`) so we
 * always process the latest state, never a stale snapshot from enqueue
 * time. The same loaders are also used by the synchronous fallback path
 * in `enqueue.ts` — single source of truth.
 */
import { Worker, type Job } from "bullmq";
import { getRedisConnection } from "./redis";
import { QUEUE_NAMES } from "./queues";
import { loadOrderForNotification, loadPaidSmsArgs } from "./loaders";

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
        const order = await loadOrderForNotification(job.data.orderId);
        if (!order) {
          // Order disappeared between enqueue and processing. Treat as
          // success — re-processing would hit the same null result.
          return { skipped: true, reason: "order-not-found" };
        }
        await notifyAdminNewOrder(order);
        return { notified: true };
      },
      { connection: conn, concurrency: 4 },
    ),

    new Worker(
      QUEUE_NAMES.SEND_ORDER_PAID_SMS,
      async (job: Job<{ orderId: string | number }>) => {
        const { sendOrderPaidConfirmationSms } = await import("@/lib/orders/order-paid-confirm");
        const args = await loadPaidSmsArgs(job.data.orderId);
        if (!args) {
          // Distinguish between order-gone (re-enqueue safe) and no-phone
          // (would re-enqueue forever — drop). The loader returns null
          // in both cases; inspect the row directly for the reason.
          const { pool } = await import("@/lib/db");
          const { rows } = await pool.query<{ id: string | number }>(
            "SELECT id FROM orders WHERE id = $1 LIMIT 1",
            [job.data.orderId],
          );
          if (!rows[0]) return { skipped: true, reason: "order-not-found" };
          return { skipped: true, reason: "no-phone" };
        }
        await sendOrderPaidConfirmationSms(args);
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
