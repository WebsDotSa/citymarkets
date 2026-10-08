/**
 * ID generators — extracted from `src/lib/utils.ts` (audit H32).
 *
 * `generateId` is a tiny client-side UUID helper. For server-side
 * Postgres IDs use the DB; for queue idempotency keys use
 * `@/lib/queue` (BullMQ-managed). This is for ad-hoc UI keys only.
 *
 * Audit 2026-10-04 (refactor/full-repository-consolidation): the
 * `Math.random` fallback was removed — `crypto.getRandomValues` is the
 * minimum acceptable CSPRNG for any key that might be surfaced in
 * cross-domain analytics or shared with the backend.
 */
export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // SECURITY: guard getRandomValues explicitly. The original fallback
  // assumed `crypto` was always defined whenever `crypto.randomUUID`
  // was missing, which is not true in hardened sandboxes / sandboxed
  // iframes where the Web Crypto API is fully absent. Throwing an
  // explicit error matches the pattern in src/lib/ga-events.ts (newEventID)
  // and surfaces the broken environment instead of silently producing
  // undefined or empty idempotency keys.
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("crypto.getRandomValues is required for ID generation");
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
