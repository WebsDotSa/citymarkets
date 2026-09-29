/**
 * Public barrel for the Queue bounded context (Phase 10.8).
 *
 * Encapsulates the BullMQ + Redis machinery so route handlers can write
 * `await enqueueAdminNewOrder(orderId)` without caring about whether the
 * job lands on a durable queue or falls back to a synchronous call.
 *
 * Internal organization:
 *   - redis.ts       — ioredis singleton with graceful Redis-down fallback
 *   - queues.ts      — BullMQ Queue factory + idempotent job options
 *   - enqueue.ts     — public `enqueueAdminNewOrder` / `enqueueOrderPaidSms`
 *   - workers.ts     — Worker factory (registered from scripts/worker.ts)
 */


// ── Public enqueue API ──────────────────────────────────────────────────
export { enqueueAdminNewOrder, enqueueOrderPaidSms } from "./enqueue";

// ── Queue state introspection ───────────────────────────────────────────
export { isQueueEnabled } from "./redis";

// ── Worker registration (called from scripts/worker.ts) ─────────────────
export { registerQueueWorkers, closeQueueWorkers } from "./workers";

// ── Queue names (for ops dashboards / debugging) ────────────────────────
export { QUEUE_NAMES } from "./queues";
