// Helpers for splitting a cart into per-vendor groups so the cart UI can
// render vendor provenance and Slice 3's checkout can fan a single cart
// out into N vendor orders + one parent catalog order.
//
// See `src/lib/product-source.ts` for the canonical City Markets UUID and
// the `(vendor_id, product_id)` composite identity helpers. This module
// adds the cart-shaped grouping layer on top.

import {
  CITY_MARKETS_VENDOR_ID,
  isCityMarketsVendor,
  productCartKey,
} from "./product-source";
import { resolveOfferPrice } from "./offers";
import type { CartItem, Product } from "@/lib/types";

/**
 * Vendor metadata attached to a CartItem. Populated by addItem() at the
 * time the item enters the cart so the rest of the cart pipeline
 * (display, checkout) can route / render without re-fetching the
 * product detail page. `null` is treated as City Markets.
 */
export interface CartItemVendorInfo {
  vendor_id: string | null;
  vendor_slug: string | null;
  vendor_name: string | null;
}

/**
 * Derive vendor provenance from a Product. Returns a stable shape that
 * can be stored on the CartItem. Defaults to the City Markets pseudo-
 * vendor when the product has no vendor_id (legacy catalog row).
 */
export function deriveVendorFromProduct(
  product: Pick<Product, "vendor_id" | "vendor_slug" | "vendor_name">,
): CartItemVendorInfo {
  if (product.vendor_id) {
    return {
      vendor_id: product.vendor_id,
      vendor_slug: product.vendor_slug ?? null,
      vendor_name: product.vendor_name ?? null,
    };
  }
  return {
    vendor_id: CITY_MARKETS_VENDOR_ID,
    vendor_slug: null,
    vendor_name: null,
  };
}

/**
 * Single vendor group — items from one vendor + the subtotal computed
 * across those items. CartV2 renders one of these per non-empty group;
 * Slice 3's checkout writes one `vendor_orders` row per group.
 */
export interface VendorGroup {
  vendorId: string;
  vendorSlug: string | null;
  vendorName: string | null;
  isCityMarkets: boolean;
  items: CartItem[];
  subtotal: number;
  itemCount: number;
}

export interface CartGroups {
  /** Items that belong to the City Markets catalog (or legacy rows). */
  catalogItems: CartItem[];
  /** Every non-City Markets vendor present in the cart, in insertion order. */
  vendorGroups: VendorGroup[];
  /** Set of all vendor ids (catalog included) for fast "is mixed cart?" checks. */
  vendorIds: Set<string>;
  /** Grand total across all groups. */
  subtotal: number;
}

/**
 * Effective unit price for a cart item. Routes through the offers
 * resolver so:
 *   1. If the cart payload includes an active offer (`item.product.active_offer`),
 *      its price competes with `discount_price` and the list price.
 *   2. The resolver picks the cheapest of the three for the customer.
 *   3. When no offer is present, the legacy `discount_price` logic kicks
 *      in (so carts that were added before the offers migration stay
 *      priced correctly).
 *
 * The cart API already returns the server-computed `effective_price` on
 * each row; this helper exists for client-side re-validation in case the
 * cart page receives stale `Product` shapes (e.g. legacy localStorage).
 */
export function effectiveUnitPrice(item: CartItem): number {
  const list = Number(item.product.price) || 0;
  const sale = item.product.discount_price != null ? Number(item.product.discount_price) : null;
  const activeOffer = item.product.active_offer;
  const resolved = resolveOfferPrice(
    {
      price: list,
      discount_price: sale,
      category_id: item.product.category_id ?? null,
      vendor_id: item.product.vendor_id ?? null,
    },
    // Map the API's ActiveOfferInfo shape to the resolver's OfferInput
    // (they share every numeric/date field; only the id field name
    // differs — offer_id vs id — and the resolver doesn't actually
    // consume the id here, only in filterOffersByScope).
    activeOffer
      ? [
          {
            id: activeOffer.offer_id,
            discount_type: activeOffer.discount_type,
            discount_value: activeOffer.discount_value,
            max_discount: activeOffer.max_discount,
            min_order: activeOffer.min_order,
            starts_at: activeOffer.starts_at,
            ends_at: activeOffer.ends_at,
            is_active: true,
          },
        ]
      : [],
  );
  // resolveOfferPrice returns unitPrice equal to the list when nothing
  // beats it, which is the exact legacy behaviour we want to preserve.
  return resolved.unitPrice;
}

/** Subtotal of a single cart row (unit price × quantity). */
export function lineSubtotal(item: CartItem): number {
  return effectiveUnitPrice(item) * item.quantity;
}

/** Sum of lineSubtotal across a list. */
export function computeGroupSubtotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + lineSubtotal(item), 0);
}

/**
 * Group cart items by vendor. Catalog items (City Markets + any pre-
 * Slice-2 row whose vendor_id is missing) all collapse into the catalog
 * bucket — they're routed to one parent `orders` row by Slice 3.
 *
 * Order is preserved: items appear in each group in the same order they
 * had in the input array, which keeps CartV2's "most recent at top"
 * invariant intact after the grouping pass.
 */
export function groupCartItems(items: CartItem[]): CartGroups {
  const catalogItems: CartItem[] = [];
  const groupsByVendor = new Map<string, VendorGroup>();
  const vendorIds = new Set<string>();
  let subtotal = 0;

  for (const item of items) {
    const vendorId =
      item.vendor_id ?? item.product.vendor_id ?? CITY_MARKETS_VENDOR_ID;
    const vendorSlug = item.vendor_slug ?? item.product.vendor_slug ?? null;
    const vendorName = item.vendor_name ?? item.product.vendor_name ?? null;
    const line = lineSubtotal(item);
    subtotal += line;
    vendorIds.add(vendorId);

    if (isCityMarketsVendor(vendorId)) {
      catalogItems.push(item);
      continue;
    }

    const existing = groupsByVendor.get(vendorId);
    if (existing) {
      existing.items.push(item);
      existing.subtotal += line;
      existing.itemCount += item.quantity;
    } else {
      groupsByVendor.set(vendorId, {
        vendorId,
        vendorSlug,
        vendorName,
        isCityMarkets: false,
        items: [item],
        subtotal: line,
        itemCount: item.quantity,
      });
    }
  }

  return {
    catalogItems,
    vendorGroups: Array.from(groupsByVendor.values()),
    vendorIds,
    subtotal,
  };
}

/**
 * True when the cart contains items from more than one vendor (catalog
 * + 1+ vendor, or 2+ vendors). Slice 2 uses this to gate the checkout
 * button until the unified checkout endpoint ships.
 */
export function hasMixedVendors(groups: CartGroups): boolean {
  // More than the catalog → already mixed.
  if (groups.vendorGroups.length > 0 && groups.catalogItems.length > 0) {
    return true;
  }
  // Multiple distinct vendor groups (no catalog at all).
  return groups.vendorGroups.length > 1;
}

/**
 * Composite cart identity used by removeItem / updateQuantity so the
 * cart can hold two products that share the same UUID across different
 * vendors. Wraps `productCartKey` from product-source so callers don't
 * have to remember which module the helper lives in.
 */
export { productCartKey };

/**
 * Convenience: composite key for a cart item, preferring the explicit
 * `vendor_id` field on the item and falling back to the product's
 * vendor_id. Returns the legacy single-segment key for items without
 * any vendor info, so localStorage migrations stay backwards
 * compatible.
 */
export function cartItemKey(item: CartItem): string {
  const vendorId = item.vendor_id ?? item.product.vendor_id ?? null;
  return productCartKey(item.product.id, vendorId);
}