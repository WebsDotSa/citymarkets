/**
 * Redis connection singleton for the queue domain.
 *
 * Uses `ioredis` because BullMQ requires it. Reads `REDIS_URL` from env
 * (same env var as `src/lib/rate-limit.ts` so operators configure one URL).
 *
 * Graceful fallback: when `REDIS_URL` is unset or the connection fails,
 * `getRedisConnection()` returns `null` and the enqueue helpers fall back
 * to direct (synchronous) execution. This keeps dev mode + smoke tests
 * working without Redis.
 */
import IORedis, { type Redis as IORedisInstance } from "ioredis";
import { warn } from "@/lib/logger";

let cached: IORedisInstance | null = null;
let connectionAttempted = false;
let connectionFailed = false;

export function getRedisConnection(): IORedisInstance | null {
  if (connectionFailed) return null;
  if (cached) return cached;
  if (connectionAttempted) return null;
  connectionAttempted = true;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    cached = new IORedis(url, {
      maxRetriesPerRequest: null, // BullMQ requires this for blocking commands
      enableReadyCheck: false,
      lazyConnect: false,
    });
    cached.on("error", (err) => {
      // First error marks the connection as failed so we don't spam logs.
      if (!connectionFailed) {
        connectionFailed = true;
        // Audit I39: routed through the canonical logger. The original
        // `console.warn` bypassed the LOG_LEVEL gate and would fire
        // once-per-process in production if Redis blipped.
        warn("[queue] Redis connection failed, enqueue helpers will run synchronously", { reason: err.message });
        cached?.disconnect();
        cached = null;
      }
    });
    return cached;
  } catch (err) {
    connectionFailed = true;
    return null;
  }
}

export function isQueueEnabled(): boolean {
  return getRedisConnection() !== null;
}

/**
 * Test-only reset. Vitest uses this to clear the singleton between
 * `it` blocks; production code never calls this.
 */
export function __resetRedisForTests(): void {
  cached?.disconnect();
  cached = null;
  connectionAttempted = false;
  connectionFailed = false;
}
