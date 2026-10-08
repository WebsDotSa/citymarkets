/**
 * UUID validation helpers for route handlers.
 *
 * Background:
 *   Before this file existed, every route that took a UUID-shaped
 *   `[id]` param had to inline its own regex. The PCP-101 audit
 *   caught several admin routes missing the guard entirely
 *   (e.g. /api/admin/orders/[id], /api/admin/offers/[id]) which let
 *   "bad-uuid" reach Postgres and crash with 22P02, surfacing as a
 *   generic 500 to the client. Even when a guard was present it was
 *   copy-pasted regex with slightly different shapes.
 *
 *   Centralising the regex here means every route gets the exact
 *   same canonical 8-4-4-4-12 UUID shape, plus a tiny
 *   `validateUuidOrError()` helper that turns a bad UUID into the
 *   standard 400 envelope the rest of the API uses.
 *
 * Reference:
 *   src/middleware.ts — CSRF gate (separate concern).
 *   src/app/api/v1/orders/[id]/route.ts — first adopter of the
 *     regex pattern; copied into multiple files after the audit.
 *   src/app/api/admin/orders/[id]/route.ts — admin mirror.
 *
 * Scope:
 *   This module is intentionally tiny so it can be imported by route
 *   handlers without pulling in the rest of @/lib/validation (which
 *   is Zod-heavy and would slow cold-start of edge handlers).
 */

import { NextResponse } from "next/server";

/**
 * Canonical UUID regex. Matches the 8-4-4-4-12 hex pattern (any case),
 * no version/variant bits checked. Exported so tests and edge cases
 * (e.g. accept-existing-versions) can reuse the exact same predicate
 * without copy-pasting.
 */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates a UUID-shaped string. Returns true for canonical 8-4-4-4-12
 * hex, false otherwise. Empty string and non-strings return false.
 */
export function isValidUuid(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  return UUID_RE.test(value);
}

/**
 * Returns a 400 NextResponse if the value is not a valid UUID, or
 * `null` when validation passes. The Arabic message mirrors the
 * wording in the existing inlined guards so the user-visible surface
 * stays consistent across routes.
 *
 * Usage in a route handler:
 *
 *   const { id: orderId } = await ctx.params;
 *   const badId = validateUuidOrError(orderId, "معرّف الطلب غير صالح");
 *   if (badId) return badId;
 *   // ... rest of handler, safe to use orderId
 *
 * `entityLabel` is the human-facing noun that the user will read
 * (e.g. "الطلب" for orders, "العرض" for offers). The full message
 * becomes "<label> غير صالح" so the response stays grammatical
 * regardless of which resource the route operates on.
 */
export function validateUuidOrError(
  value: unknown,
  entityLabel: string
): NextResponse | null {
  if (isValidUuid(value)) return null;
  return NextResponse.json(
    {
      success: false,
      error: `${entityLabel} غير صالح`,
    },
    { status: 400 }
  );
}