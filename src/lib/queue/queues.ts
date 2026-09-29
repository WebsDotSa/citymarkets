/**
 * BullMQ Queue factory for the project's critical notifications.
 *
 * Each job type gets its own queue so we can scale workers per concern
 * (e.g., more workers for high-volume `notify-admin-new-order`).
 *
 * Job payloads are intentionally minimal — the worker re-fetches the
 * latest order state from the DB instead of serializing a snapshot at
 * enqueue time. This avoids stale-data bugs if the order is edited
 * between enqueue and processing.
 */
import { Queue, type JobsOptions } from "bullmq";
import { getRedisConnection } from "./redis";

export const QUEUE_NAMES = {
  NOTIFY_ADMIN_NEW_ORDER: "notify-admin-new-order",
  NOTIFY_VENDOR_NEW_ORDER: "notify-vendor-new-order",
  SEND_ORDER_PAID_SMS: "send-order-paid-sms",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const queues: Map<QueueName, Queue> = new Map();

/**
 * Idempotency policy: use `orderId` as the BullMQ `jobId`. If a duplicate
 * enqueue happens (e.g., webhook retry), BullMQ rejects the second job
 * with the same id — preventing double SMS / double admin notification.
 */
function defaultJobOptions(orderId: string | number): JobsOptions {
  return {
    jobId: `order-${orderId}`,
    attempts: 5,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  };
}

export function getQueue(name: QueueName): Queue | null {
  const conn = getRedisConnection();
  if (!conn) return null;
  const cached = queues.get(name);
  if (cached) return cached;
  const queue = new Queue(name, { connection: conn });
  queues.set(name, queue);
  return queue;
}

export function notifyAdminNewOrderJobId(orderId: string | number): string {
  return `order-${orderId}`;
}

export function makeNotifyAdminNewOrderOptions(orderId: string | number): JobsOptions {
  return defaultJobOptions(orderId);
}

/**
 * Vendor new-order job IDs are keyed by `${vendorId}:${orderId}` so a
 * single parent order fanning out to N vendors enqueues N distinct
 * jobs — but the same (vendor, order) pair never fires twice if the
 * webhook replays.
 */
export function notifyVendorNewOrderJobId(args: { vendorId: string; orderId: string | number }): string {
  return `vendor:${args.vendorId}:order:${args.orderId}`;
}

export function makeNotifyVendorNewOrderOptions(args: { vendorId: string; orderId: string | number }): JobsOptions {
  // Same retry/TTL policy as the other queues — vendor push is best-
  // effort but losing it means the vendor misses the order until they
  // manually refresh the dashboard.
  return {
    jobId: notifyVendorNewOrderJobId(args),
    attempts: 5,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  };
}
