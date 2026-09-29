/**
 * ID generators — extracted from `src/lib/utils.ts` (audit H32).
 *
 * `generateId` is a tiny client-side UUID helper. For server-side
 * Postgres IDs use the DB; for queue idempotency keys use
 * `@/lib/queue` (BullMQ-managed). This is for ad-hoc UI keys only.
 */

// Generate a random ID (simple client-side)
export function generateId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).substring(2, 15);
}
