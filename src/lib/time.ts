/**
 * Time helpers — extracted from `src/lib/utils.ts` (audit H32).
 *
 * `delay` is the only entry here today. New helpers that operate on
 * time (debounce, throttle, format-relative) belong in this module.
 */

/** Resolves after `ms` milliseconds. Used by retry loops in service code. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
