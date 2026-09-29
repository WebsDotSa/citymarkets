/**
 * Canonical vendor order-number generator.
 *
 * Format: `${PREFIX}-${YYYY}-${NNNNNNNNN}` (e.g. `AM-2026-042193847`).
 *
 * Why a single helper:
 *   - The previous codebase had TWO near-identical copies:
 *       1. `src/lib/orders/checkout/create-checkout.ts:541`
 *          — used `Math.random()` + 5 digits. Birthday-paradox
 *            collision risk at scale (the comment in the sibling file
 *            at `vendors/[slug]/orders/route.ts:38-44` spells this out).
 *       2. `src/app/api/v1/vendors/[slug]/orders/route.ts:45`
 *          — fixed it to use `crypto.randomInt()` + 9 digits.
 *     Centralising here closes the collision window for every caller.
 *
 * Why `crypto.randomInt`:
 *   Order numbers are user-visible (printed on receipts, shared in
 *   support chats). Using `Math.random()` makes them predictable and
 *   lets an attacker enumerate every order in a year by trying
 *   10⁵ values. `crypto.randomInt` is a CSPRNG.
 *
 * Why 9 digits:
 *   10⁹ values → expected birthday-paradox collision is ~√(10⁹) ≈
 *   31,623 orders per vendor-year. Realistic vendor order volume per
 *   year is < 10,000, so the collision probability stays negligible.
 *   The previous 5-digit (10⁵) version would collide at ~316 orders/
 *   year — already a risk for any busy vendor.
 *
 * Why "V" fallback for an empty slug:
 *   `String.prototype.slice(0, 2)` of `""` returns `""`. Without a
 *   fallback the generated number would start with `-2026-…` which is
 *   ugly and harder to scan in a list. `"V"` is the canonical prefix
 *   for "vendor (unknown)" in legacy single-vendor order numbers.
 *
 * This is a server-only helper (uses `node:crypto`). Do NOT import
 * from a Client Component — the routes that call it (POST /orders,
 * POST /vendors/[slug]/orders) are server-only by definition.
 */
import { randomInt } from "node:crypto";

export function generateVendorOrderNumber(vendorSlug: string): string {
  const year = new Date().getFullYear();
  // randomInt is exclusive on the upper bound — produces [0, 1_000_000_000).
  const random = randomInt(0, 1_000_000_000).toString().padStart(9, "0");
  const prefix = (vendorSlug ?? "").slice(0, 2).toUpperCase() || "V";
  return `${prefix}-${year}-${random}`;
}
