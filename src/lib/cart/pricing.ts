/**
 * Cart pricing — server-side line-total computation (P2-5).
 *
 * Why this exists:
 *   The cart UI previously computed subtotals client-side using only
 *   `price` and `discount_price` — it ignored `active_offer_*`. The
 *   cart GET route returned the offer metadata but didn't apply it.
 *   The result was a cart total that drifted from what checkout
 *   charged: a customer sees 100 SAR, checkout charges 80 SAR, or
 *   vice versa.
 *
 *   This module centralises the line-price formula so the cart GET
 *   route and the cart UI agree on the number.
 *
 * Design:
 *   - Wraps `@/lib/catalog/offers` (the canonical offer resolver)
 *     instead of reimplementing the formula. If the offer rules
 *     change, only that module changes; this file stays a thin
 *     cart-row adapter.
 *   - Pure functions, no DB access. The route already hydrates cart
 *     rows with all the fields we need; this module just maps them
 *     to a price.
 *   - Returns numbers (not strings) so callers can sum them without
 *     re-parsing.
 *
 * Out of scope (intentional):
 *   - Delivery fee / tax / coupon math stays where it is — those
 *     have their own modules.
 *   - The cart UI's subtotal hook still runs client-side for the
 *     optimistic update path; it MUST be replaced with the server
 *     value once the route returns enriched rows (separate
 *     follow-up).
 */

import {
  computeOfferEffectivePrice,
  isOfferLive,
  round2,
  type ProductForOffer,
} from "@/lib/catalog/offers";
import type { OfferDiscountType } from "@/lib/types";

/** A minimal cart-row payload for pricing. The route hydrates these. */
export interface CartPricingRow {
  product_id: string;
  /** List price (SAR). */
  price: number;
  /** Legacy sale price; null/undefined when no discount. */
  discount_price: number | null;
  quantity: number;
  /** Active offer — only present when the route joins
   *  `products_unified_with_offers` (the production cart GET does). */
  active_offer_id?: string | null;
  active_offer_type?: OfferDiscountType | null;
  active_offer_value?: number | null;
  active_offer_max_discount?: number | null;
  active_offer_min_order?: number | null;
  active_offer_starts_at?: string | null;
  active_offer_ends_at?: string | null;
}

export interface PricedCartRow extends CartPricingRow {
  /** The unit price the customer pays (after offer / discount). */
  unit_price: number;
  /** The price before any offer / discount — kept so the UI can show
   *  the strikethrough. Same as `price`. */
  list_unit_price: number;
  /** Savings per unit (0 when no offer applies). */
  unit_savings: number;
  /** `unit_price * quantity`. */
  line_total: number;
  /** Whether the price came from offer / discount_price / list. */
  source: "offer" | "discount_price" | "list";
  /** The offer id that won (null when source !== "offer"). */
  winning_offer_id: string | null;
}

interface OfferLike {
  id: string;
  discount_type: OfferDiscountType;
  discount_value: number;
  max_discount: number | null;
  min_order: number | null;
  starts_at: Date | string;
  ends_at: Date | string;
  is_active: boolean;
}

/** Convert a hydrated cart row's offer fields into an OfferLike. */
function rowToOffer(row: CartPricingRow): OfferLike | null {
  if (!row.active_offer_id) return null;
  if (
    row.active_offer_type == null ||
    row.active_offer_value == null ||
    row.active_offer_starts_at == null ||
    row.active_offer_ends_at == null
  ) {
    return null;
  }
  return {
    id: row.active_offer_id,
    discount_type: row.active_offer_type,
    discount_value: Number(row.active_offer_value),
    max_discount:
      row.active_offer_max_discount != null
        ? Number(row.active_offer_max_discount)
        : null,
    min_order:
      row.active_offer_min_order != null
        ? Number(row.active_offer_min_order)
        : null,
    starts_at: row.active_offer_starts_at,
    ends_at: row.active_offer_ends_at,
    // The route already filtered to live offers at JOIN time.
    is_active: true,
  };
}

/**
 * Decide the unit price for ONE cart row. Mirrors the offer-resolver
 * formula in `@/lib/catalog/offers.resolveOfferPrice` but operates on
 * the row shape that the cart route emits (not a full Offer[]).
 */
export function priceCartRow(
  row: CartPricingRow,
  now: Date = new Date(),
): PricedCartRow {
  const list = round2(Math.max(0, Number(row.price) || 0));
  const legacy =
    row.discount_price != null && Number(row.discount_price) < list
      ? round2(Number(row.discount_price))
      : list;

  const offer = rowToOffer(row);
  let offerPrice = list;
  let offerSavings = 0;
  let offerId: string | null = null;

  if (offer && isOfferLive(offer, now)) {
    // `computeOfferEffectivePrice` takes a `ProductForOffer` shape;
    // we synthesise one from the row's list price + offer id so we
    // don't pull in the catalog Product type.
    const syntheticProduct: ProductForOffer = {
      price: row.price,
      discount_price: row.discount_price,
    };
    const computed = computeOfferEffectivePrice(syntheticProduct, offer);
    offerPrice = computed.effectivePrice;
    offerSavings = computed.savings;
    offerId = offer.id;
  }

  // Decision: offer wins over discount_price when strictly cheaper;
  // ties go to the offer (offers are explicit time-bound config).
  let unitPrice = list;
  let source: PricedCartRow["source"] = "list";
  if (offerPrice < list && offerPrice < legacy) {
    unitPrice = offerPrice;
    source = "offer";
  } else if (legacy < list) {
    unitPrice = legacy;
    source = "discount_price";
  } else if (offerPrice < list) {
    unitPrice = offerPrice;
    source = "offer";
  }

  const qty = Math.max(0, Math.floor(Number(row.quantity) || 0));
  const unitSavings = round2(list - unitPrice);

  return {
    ...row,
    list_unit_price: list,
    unit_price: unitPrice,
    unit_savings: unitSavings,
    line_total: round2(unitPrice * qty),
    source,
    winning_offer_id: source === "offer" ? offerId : null,
  };
}

/**
 * Compute the cart subtotal across many rows. Rounded to 2 dp to
 * avoid floating-point drift in the displayed total.
 */
export function cartSubtotal(rows: CartPricingRow[], now: Date = new Date()): {
  subtotal: number;
  totalSavings: number;
  priced: PricedCartRow[];
} {
  const priced = rows.map((r) => priceCartRow(r, now));
  const subtotal = round2(priced.reduce((s, r) => s + r.line_total, 0));
  const totalSavings = round2(priced.reduce((s, r) => s + r.unit_savings * Math.max(0, Math.floor(Number(r.quantity) || 0)), 0));
  return { subtotal, totalSavings, priced };
}
