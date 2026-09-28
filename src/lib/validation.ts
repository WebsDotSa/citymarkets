/**
 * Backward-compatible barrel.
 *
 * The actual schemas live in `src/lib/validation/<feature>.ts` (split
 * 2026-09-24 to dissolve a 1252-line god file). This module re-exports
 * them so external callers can keep using:
 *
 *   import { createOrderSchema, phoneSchema } from "@/lib/validation";
 *
 * unchanged. New code should prefer importing from a focused sub-module
 * (`@/lib/validation/order`, `@/lib/validation/auth`, …) to avoid
 * pulling the whole validation surface into the bundle.
 *
 * NB: the import path is `./validation/index` (not `./validation`) so
 * the module resolver doesn't pick THIS file as the target — both
 * `validation.ts` and `validation/index.ts` exist, and without an
 * explicit `/index` suffix TS resolves to the file first.
 */
export * from "./validation/index";