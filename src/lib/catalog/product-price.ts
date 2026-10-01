/**
 * Canonical "legacy unit price" rule: `discount_price` when set, else the
 * list `price`, coerced to a finite number (0 on garbage).
 *
 * This is the rule checkout currently CHARGES (`resolve-items.ts`) and the
 * rule the storefront displays. It intentionally does NOT apply live offers:
 * the cart GET route uses `priceCartRow()` (`@/lib/cart/pricing`), which
 * does. That divergence is tracked in
 * docs/audits/2026-09-30-duplication-audit.md (PRICING-1) and must be
 * resolved as a business decision — when it is, change it HERE and every
 * consumer follows.
 *
 * Pure and client-safe (no imports) so both server code and client
 * components can use it.
 */
export interface PriceFields {
  price?: number | string | null;
  discount_price?: number | string | null;
}

export function productUnitPrice(p: PriceFields): number {
  const n = Number(p.discount_price ?? p.price ?? 0);
  return Number.isFinite(n) ? n : 0;
}
