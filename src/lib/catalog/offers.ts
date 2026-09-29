// Pure resolver for the Offers feature (Slice 5).
//
// Responsibilities:
//  1. Determine whether an offer is live (active + within its time window).
//  2. Narrow a list of offer candidates to those that touch a given product
//     via any of the polymorphic scopes (product / category / vendor / all).
//  3. Compute the effective price a single offer would yield on a product.
//  4. Pick the best available price across (active offers ∪ legacy
//     discount_price) — biggest absolute savings wins, ties broken by input
//     order.
//
// The module is pure (no I/O). Callers pass the candidate offers and an
// optional `now` so it stays testable. The cart and read endpoints both
// funnel through `resolveOfferPrice`, ensuring the storefront and the
// server agree on what the customer pays.

import type { OfferTargetType } from "@/lib/types";

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

export interface OfferInput {
  id: string;
  discount_type: "percentage" | "fixed";
  discount_value: number;
  /** Optional cap on percentage savings (absolute amount, NOT percent). */
  max_discount: number | null;
  /** Optional minimum cart subtotal required for the offer to apply. */
  min_order: number | null;
  starts_at: string | Date;
  ends_at: string | Date;
  is_active: boolean;
}

export interface ProductForOffer {
  price: number;
  /** Legacy single-value discount. Honored when cheaper than list. */
  discount_price: number | null;
  category_id?: string | null;
  vendor_id?: string | null;
}

export type ResolvedOfferSource = "offer" | "discount_price" | "none";

export interface ResolvedOffer {
  /** Final price the customer pays (after the winning offer or legacy discount). */
  unitPrice: number;
  /** List price before any discount. */
  originalPrice: number;
  /** The winning offer, or null when legacy discount_price or list wins. */
  activeOffer: OfferInput | null;
  /** originalPrice − unitPrice, rounded to 2 decimals. */
  discountAmount: number;
  /** 0..100, rounded to 2 decimals. 0 when no discount applies. */
  discountPct: number;
  /** Where the winning price came from. */
  source: ResolvedOfferSource;
}

/**
 * Compact description of one offer target, used to map an offer id to
 * the set of (type, id) pairs it applies to. The cart / read APIs
 * hydrate this from `offer_targets`.
 */
export interface OfferTargetInfo {
  type: OfferTargetType;
  id: string | null;
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/** Round to 2 decimals, mirroring the DB NUMERIC(10,2) precision. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** True when the offer is currently live per its window + flag. */
export function isOfferLive(o: OfferInput, now: Date): boolean {
  if (!o.is_active) return false;
  const start = o.starts_at instanceof Date ? o.starts_at : new Date(o.starts_at);
  const end = o.ends_at instanceof Date ? o.ends_at : new Date(o.ends_at);
  const t = now.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

/**
 * Compute the effective unit price for ONE offer against ONE product.
 * Returns the price plus the absolute savings versus list. The price
 * is floored at 0 (offers can never make the customer pay negative).
 */
export function computeOfferEffectivePrice(
  product: ProductForOffer,
  offer: OfferInput,
): { effectivePrice: number; savings: number } {
  const list = Math.max(0, Number(product.price) || 0);
  let raw: number;
  if (offer.discount_type === "percentage") {
    const pctOff = (list * offer.discount_value) / 100;
    const cap = offer.max_discount != null ? offer.max_discount : Number.POSITIVE_INFINITY;
    raw = Math.min(pctOff, cap);
  } else {
    raw = Math.min(offer.discount_value, list);
  }
  const savings = Math.min(raw, list);
  return {
    effectivePrice: round2(list - savings),
    savings: round2(savings),
  };
}

/**
 * Narrow `offers` to the subset that touches `product` via at least one
 * of its target rows. Site-wide offers (target_type='all') always pass.
 *
 * `targetsByOfferId` is an external map populated by the caller from the
 * `offer_targets` table. An offer not present in the map is considered
 * inapplicable. This indirection keeps the function pure and easy to test.
 */
export function filterOffersByScope(
  offers: OfferInput[],
  product: ProductForOffer,
  targetsByOfferId: Map<string, OfferTargetInfo[]>,
): OfferInput[] {
  const out: OfferInput[] = [];
  for (const offer of offers) {
    const targets = targetsByOfferId.get(offer.id);
    if (!targets || targets.length === 0) continue;
    const matches = targets.some((t) => {
      if (t.type === "all") return true;
      if (t.type === "product") return t.id === (product as { id?: string }).id;
      if (t.type === "category") return t.id != null && t.id === product.category_id;
      if (t.type === "vendor") return t.id != null && t.id === product.vendor_id;
      return false;
    });
    if (matches) out.push(offer);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Main resolver
// ────────────────────────────────────────────────────────────────────

/**
 * Decide the final price a customer pays for `product`, given a set of
 * offer candidates already narrowed by scope (or an empty array when
 * none apply). The legacy `discount_price` is always considered as a
 * fallback. The function picks the smallest non-negative final price;
 * when two sources tie, the offer wins (offers are more recent
 * configuration and have explicit time bounds).
 *
 * @param cartSubtotal When provided, offers whose `min_order` exceeds
 *   this value are dropped. Pass `null` to skip the gate (the cart
 *   may not yet know the subtotal — the API layer can re-evaluate).
 */
export function resolveOfferPrice(
  product: ProductForOffer,
  offers: OfferInput[],
  now: Date = new Date(),
  cartSubtotal: number | null = null,
): ResolvedOffer {
  const list = round2(Math.max(0, Number(product.price) || 0));

  // Live + min_order-filtered offer candidates.
  const candidates = offers
    .filter((o) => isOfferLive(o, now))
    .filter((o) => {
      if (cartSubtotal == null) return true;
      if (o.min_order == null) return true;
      return cartSubtotal >= o.min_order;
    });

  // Best offer by absolute savings (ties: first wins).
  let bestOffer: OfferInput | null = null;
  let bestOfferSavings = 0;
  let bestOfferPrice = list;
  for (const offer of candidates) {
    const { effectivePrice, savings } = computeOfferEffectivePrice(product, offer);
    if (effectivePrice < bestOfferPrice || (effectivePrice === bestOfferPrice && savings > bestOfferSavings)) {
      bestOffer = offer;
      bestOfferSavings = savings;
      bestOfferPrice = effectivePrice;
    }
  }

  // Legacy discount_price.
  const legacySale =
    product.discount_price != null && product.discount_price < list
      ? round2(product.discount_price)
      : list;

  // Final decision.
  let unitPrice = list;
  let source: ResolvedOfferSource = "none";
  let activeOffer: OfferInput | null = null;
  if (bestOfferPrice < list && bestOfferPrice < legacySale) {
    unitPrice = bestOfferPrice;
    source = "offer";
    activeOffer = bestOffer;
  } else if (legacySale < list) {
    unitPrice = legacySale;
    source = "discount_price";
  } else if (bestOfferPrice < list) {
    // Offer ties legacy sale; prefer the explicit offer per design.
    unitPrice = bestOfferPrice;
    source = "offer";
    activeOffer = bestOffer;
  }

  const discountAmount = round2(Math.max(0, list - unitPrice));
  const discountPct = list > 0 ? round2((discountAmount / list) * 100) : 0;

  return {
    unitPrice,
    originalPrice: list,
    activeOffer,
    discountAmount,
    discountPct,
    source,
  };
}
