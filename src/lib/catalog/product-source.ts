// Helpers for reasoning about the canonical product identity in a
// multi-vendor marketplace. See plan: src/lib/types.ts carries the
// canonical constant re-exported here for ergonomic imports.
//
// The codebase is mid-migration from a single-vendor catalog (`products`,
// ~3857 rows owned by City Markets) to a multi-vendor model
// (`vendor_products`, owned by `vendors`). Migration 014 backfilled every
// active legacy product into `vendor_products` under the all-zeros
// pseudo-vendor UUID so that:
//   - migration 036's `products_unified` view can JOIN both tables, and
//   - Slice 3's checkout can split a mixed cart into one parent
//     `orders` row (catalog) + N `vendor_orders` rows per third-party
//     vendor without a UUID collision.
//
// Until migration 039 marks `products` read-only, the two tables hold
// overlapping data. Callers should not branch on "is the product
// vendor-backed?" based on table membership — they should branch on
// `vendor_id === CITY_MARKETS_VENDOR_ID` (or `vendor_id == null`, which
// means "legacy row not yet backfilled").

import { CITY_MARKETS_VENDOR_ID, type Product } from "@/lib/types";

export { CITY_MARKETS_VENDOR_ID };

/**
 * True when the vendor identity belongs to City Markets (legacy catalog
 * pseudo-vendor or any future row we explicitly backfill under this UUID).
 *
 * `null`/`undefined` is treated as City Markets for backwards
 * compatibility — pre-Slice-1 callers that never set `vendor_id` on a
 * Product literal still resolve to the catalog checkout path.
 */
export function isCityMarketsVendor(
  vendorId: string | null | undefined,
): boolean {
  if (!vendorId) return true;
  return vendorId === CITY_MARKETS_VENDOR_ID;
}

/**
 * Canonical cart key. Two products with the same UUID but different
 * vendors must coexist in the cart (e.g. when two vendors both list a
 * product under the same external SKU). String format is stable across
 * the migration; persistable in URL params / localStorage.
 */
export function productCartKey(
  productId: string,
  vendorId: string | null | undefined,
): string {
  return `${vendorId ?? CITY_MARKETS_VENDOR_ID}::${productId}`;
}

/**
 * Reverse helper for cart rows that store the composite key as a single
 * string. Returns the (vendorId, productId) tuple. Always returns a
 * defined `vendorId` (defaults to the City Markets pseudo-vendor when
 * the legacy plain `productId` format is detected).
 */
export function parseProductCartKey(
  key: string,
): { vendorId: string; productId: string } {
  const idx = key.indexOf("::");
  if (idx <= 0) {
    // Legacy single-segment key — treat as City Markets catalog item.
    return { vendorId: CITY_MARKETS_VENDOR_ID, productId: key };
  }
  const vendorId = key.slice(0, idx);
  const productId = key.slice(idx + 2);
  return { vendorId, productId };
}

/**
 * Vendor fields to copy from a Product into a CartItem at add-to-cart
 * time, so the cart UI and checkout can render vendor provenance without
 * re-fetching the product detail page. Returns `null` for legacy
 * catalog rows so the cart context's normaliser can default them to
 * City Markets.
 */
export function vendorFieldsFromProduct(
  product: Pick<Product, "vendor_id" | "vendor_slug" | "vendor_name">,
): { vendor_id: string | null; vendor_slug: string | null; vendor_name: string | null } {
  return {
    vendor_id: product.vendor_id ?? null,
    vendor_slug: product.vendor_slug ?? null,
    vendor_name: product.vendor_name ?? null,
  };
}
