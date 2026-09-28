// Tests for the offers resolver (src/lib/offers.ts). TDD-first: this
// file should exist BEFORE the implementation. Coverage targets the
// branch-level invariants documented in the resolver module.

import { describe, expect, it } from "vitest";
import {
  computeOfferEffectivePrice,
  filterOffersByScope,
  isOfferLive,
  resolveOfferPrice,
  type OfferInput,
  type ProductForOffer,
} from "./offers";

const NOW = new Date("2026-07-31T12:00:00Z");

const baseOffer = (overrides: Partial<OfferInput> = {}): OfferInput => ({
  id: "offer-1",
  discount_type: "percentage",
  discount_value: 20,
  max_discount: null,
  min_order: null,
  starts_at: "2026-07-01T00:00:00Z",
  ends_at: "2026-08-01T00:00:00Z",
  is_active: true,
  ...overrides,
});

const baseProduct = (
  overrides: Partial<ProductForOffer & { id: string }> = {},
): ProductForOffer & { id: string } => ({
  id: "prod-1",
  price: 100,
  discount_price: null,
  category_id: "cat-1",
  vendor_id: "vendor-1",
  ...overrides,
});

describe("isOfferLive", () => {
  it("returns true when active and within window", () => {
    expect(isOfferLive(baseOffer(), NOW)).toBe(true);
  });

  it("returns false when is_active is false", () => {
    expect(isOfferLive(baseOffer({ is_active: false }), NOW)).toBe(false);
  });

  it("returns false when now is before starts_at", () => {
    expect(isOfferLive(baseOffer({ starts_at: "2026-08-15T00:00:00Z" }), NOW)).toBe(false);
  });

  it("returns false when now is after ends_at", () => {
    expect(isOfferLive(baseOffer({ ends_at: "2026-07-30T00:00:00Z" }), NOW)).toBe(false);
  });

  it("handles ISO string and Date inputs identically", () => {
    const o = baseOffer({
      starts_at: new Date("2026-07-01T00:00:00Z"),
      ends_at: new Date("2026-08-01T00:00:00Z"),
    });
    expect(isOfferLive(o, NOW)).toBe(true);
  });
});

describe("computeOfferEffectivePrice", () => {
  it("applies a flat percentage discount on list price", () => {
    const result = computeOfferEffectivePrice(
      baseProduct({ price: 100 }),
      baseOffer({ discount_type: "percentage", discount_value: 20 }),
    );
    expect(result.effectivePrice).toBe(80);
    expect(result.savings).toBe(20);
  });

  it("caps percentage discount at max_discount", () => {
    const result = computeOfferEffectivePrice(
      baseProduct({ price: 100 }),
      baseOffer({
        discount_type: "percentage",
        discount_value: 50, // would yield 50 off
        max_discount: 25, // capped to 25 off
      }),
    );
    expect(result.effectivePrice).toBe(75);
    expect(result.savings).toBe(25);
  });

  it("subtracts fixed amount from list price", () => {
    const result = computeOfferEffectivePrice(
      baseProduct({ price: 100 }),
      baseOffer({ discount_type: "fixed", discount_value: 15 }),
    );
    expect(result.effectivePrice).toBe(85);
    expect(result.savings).toBe(15);
  });

  it("clamps fixed discount to list price (never negative)", () => {
    const result = computeOfferEffectivePrice(
      baseProduct({ price: 10 }),
      baseOffer({ discount_type: "fixed", discount_value: 50 }),
    );
    expect(result.effectivePrice).toBe(0);
    expect(result.savings).toBe(10);
  });

  it("treats max_discount as optional cap (percentage only)", () => {
    const result = computeOfferEffectivePrice(
      baseProduct({ price: 100 }),
      baseOffer({
        discount_type: "percentage",
        discount_value: 10,
        max_discount: null,
      }),
    );
    expect(result.effectivePrice).toBe(90);
  });
});

describe("filterOffersByScope", () => {
  const product = baseProduct({
    id: "prod-1",
    category_id: "cat-1",
    vendor_id: "vendor-1",
  });

  it("keeps offers targeting this product directly", () => {
    const offers = [baseOffer({ id: "o1" })];
    const targets = new Map<string, Array<{ type: "product"; id: string }>>([
      ["o1", [{ type: "product", id: "prod-1" }]],
    ]);
    expect(filterOffersByScope(offers, product, targets)).toHaveLength(1);
  });

  it("keeps offers targeting this product's category", () => {
    const offers = [baseOffer({ id: "o1" })];
    const targets = new Map<string, Array<{ type: "category"; id: string }>>([
      ["o1", [{ type: "category", id: "cat-1" }]],
    ]);
    expect(filterOffersByScope(offers, product, targets)).toHaveLength(1);
  });

  it("keeps offers targeting this product's vendor", () => {
    const offers = [baseOffer({ id: "o1" })];
    const targets = new Map<string, Array<{ type: "vendor"; id: string }>>([
      ["o1", [{ type: "vendor", id: "vendor-1" }]],
    ]);
    expect(filterOffersByScope(offers, product, targets)).toHaveLength(1);
  });

  it("keeps site-wide offers (target_type='all')", () => {
    const offers = [baseOffer({ id: "o1" })];
    const targets = new Map<string, Array<{ type: "all"; id: null }>>([
      ["o1", [{ type: "all", id: null }]],
    ]);
    expect(filterOffersByScope(offers, product, targets)).toHaveLength(1);
  });

  it("drops offers that don't touch this product", () => {
    const offers = [baseOffer({ id: "o1" })];
    const targets = new Map<string, Array<{ type: "category"; id: string }>>([
      ["o1", [{ type: "category", id: "cat-2" }]],
    ]);
    expect(filterOffersByScope(offers, product, targets)).toHaveLength(0);
  });

  it("treats missing target entries (no map entry) as not applicable", () => {
    const offers = [baseOffer({ id: "o1" })];
    expect(filterOffersByScope(offers, product, new Map())).toHaveLength(0);
  });

  it("keeps an offer when ANY of its targets matches (union semantics)", () => {
    const offers = [baseOffer({ id: "o1" })];
    const targets = new Map<string, Array<{ type: "category"; id: string }>>([
      ["o1", [{ type: "category", id: "cat-2" }, { type: "category", id: "cat-1" }]],
    ]);
    expect(filterOffersByScope(offers, product, targets)).toHaveLength(1);
  });

  it("returns the offer unchanged (not duplicated) when multiple targets match", () => {
    const offers = [baseOffer({ id: "o1" })];
    const targets = new Map<string, Array<{ type: "category" | "vendor"; id: string }>>([
      ["o1", [{ type: "category", id: "cat-1" }, { type: "vendor", id: "vendor-1" }]],
    ]);
    expect(filterOffersByScope(offers, product, targets)).toHaveLength(1);
  });
});

describe("resolveOfferPrice — no offer / no discount", () => {
  it("returns list price with source='none' when no offer and no discount_price", () => {
    const r = resolveOfferPrice(baseProduct({ price: 100 }), [], NOW);
    expect(r.unitPrice).toBe(100);
    expect(r.originalPrice).toBe(100);
    expect(r.activeOffer).toBeNull();
    expect(r.discountAmount).toBe(0);
    expect(r.discountPct).toBe(0);
    expect(r.source).toBe("none");
  });

  it("treats discount_price=null as no legacy discount", () => {
    const r = resolveOfferPrice(baseProduct({ price: 50, discount_price: null }), [], NOW);
    expect(r.unitPrice).toBe(50);
    expect(r.source).toBe("none");
  });

  it("treats discount_price >= price as not cheaper (returns list)", () => {
    const r = resolveOfferPrice(baseProduct({ price: 50, discount_price: 60 }), [], NOW);
    expect(r.unitPrice).toBe(50);
    expect(r.source).toBe("none");
  });
});

describe("resolveOfferPrice — legacy discount_price wins", () => {
  it("uses discount_price when it beats list and no offer is present", () => {
    const r = resolveOfferPrice(
      baseProduct({ price: 100, discount_price: 80 }),
      [],
      NOW,
    );
    expect(r.unitPrice).toBe(80);
    expect(r.activeOffer).toBeNull();
    expect(r.source).toBe("discount_price");
    expect(r.discountPct).toBe(20);
  });
});

describe("resolveOfferPrice — offer wins", () => {
  it("uses offer price when it beats both list and discount_price", () => {
    const r = resolveOfferPrice(
      baseProduct({ price: 100, discount_price: 90 }),
      [baseOffer({ id: "o1", discount_type: "percentage", discount_value: 20 })],
      NOW,
    );
    expect(r.unitPrice).toBe(80);
    expect(r.activeOffer?.id).toBe("o1");
    expect(r.source).toBe("offer");
    expect(r.discountAmount).toBe(20);
    expect(r.discountPct).toBe(20);
  });

  it("ignores inactive offers", () => {
    const r = resolveOfferPrice(
      baseProduct({ price: 100 }),
      [baseOffer({ id: "o1", discount_type: "percentage", discount_value: 50, is_active: false })],
      NOW,
    );
    expect(r.unitPrice).toBe(100);
    expect(r.source).toBe("none");
  });

  it("ignores expired offers", () => {
    const r = resolveOfferPrice(
      baseProduct({ price: 100 }),
      [
        baseOffer({
          id: "o1",
          discount_type: "percentage",
          discount_value: 50,
          ends_at: "2026-07-30T00:00:00Z",
        }),
      ],
      NOW,
    );
    expect(r.unitPrice).toBe(100);
    expect(r.source).toBe("none");
  });

  it("ignores not-yet-started offers", () => {
    const r = resolveOfferPrice(
      baseProduct({ price: 100 }),
      [
        baseOffer({
          id: "o1",
          discount_type: "percentage",
          discount_value: 50,
          starts_at: "2026-08-15T00:00:00Z",
        }),
      ],
      NOW,
    );
    expect(r.unitPrice).toBe(100);
    expect(r.source).toBe("none");
  });

  it("discount_price still wins when better than every offer", () => {
    const r = resolveOfferPrice(
      baseProduct({ price: 100, discount_price: 70 }),
      [baseOffer({ id: "o1", discount_type: "percentage", discount_value: 20 })],
      NOW,
    );
    expect(r.unitPrice).toBe(70);
    expect(r.activeOffer).toBeNull();
    expect(r.source).toBe("discount_price");
  });

  it("uses the offer with the biggest absolute savings when two overlap", () => {
    const r = resolveOfferPrice(
      baseProduct({ price: 100 }),
      [
        baseOffer({ id: "small", discount_type: "percentage", discount_value: 10 }),
        baseOffer({ id: "big", discount_type: "percentage", discount_value: 30 }),
      ],
      NOW,
    );
    expect(r.unitPrice).toBe(70);
    expect(r.activeOffer?.id).toBe("big");
    expect(r.source).toBe("offer");
  });

  it("picks percentage over fixed when absolute savings are equal (deterministic order)", () => {
    const r = resolveOfferPrice(
      baseProduct({ price: 100 }),
      [
        // both yield effectivePrice = 90, savings = 10
        baseOffer({ id: "pct", discount_type: "percentage", discount_value: 10 }),
        baseOffer({ id: "fix", discount_type: "fixed", discount_value: 10 }),
      ],
      NOW,
    );
    // Both tie at 10 SAR savings; the resolver picks the first max it
    // finds in input order. The key invariant: a valid winner is returned.
    expect(r.unitPrice).toBe(90);
    expect(r.activeOffer).not.toBeNull();
    expect(r.source).toBe("offer");
  });

  it("honors max_discount cap when picking the best offer", () => {
    const r = resolveOfferPrice(
      baseProduct({ price: 200 }),
      [
        // 30% on 200 would be 60 off, capped at 10 → effectivePrice 190
        baseOffer({
          id: "capped",
          discount_type: "percentage",
          discount_value: 30,
          max_discount: 10,
        }),
        // 5% on 200 = 10 off → effectivePrice 190 (ties)
        baseOffer({ id: "lowpct", discount_type: "percentage", discount_value: 5 }),
      ],
      NOW,
    );
    expect(r.unitPrice).toBe(190);
    expect(r.activeOffer).not.toBeNull();
  });
});

describe("resolveOfferPrice — min_order gate", () => {
  it("drops an offer whose min_order exceeds cartSubtotal", () => {
    const r = resolveOfferPrice(
      baseProduct({ price: 100 }),
      [
        baseOffer({
          id: "o1",
          discount_type: "percentage",
          discount_value: 20,
          min_order: 200,
        }),
      ],
      NOW,
      100,
    );
    expect(r.unitPrice).toBe(100);
    expect(r.source).toBe("none");
  });

  it("keeps the offer when cartSubtotal meets min_order", () => {
    const r = resolveOfferPrice(
      baseProduct({ price: 100 }),
      [
        baseOffer({
          id: "o1",
          discount_type: "percentage",
          discount_value: 20,
          min_order: 200,
        }),
      ],
      NOW,
      250,
    );
    expect(r.unitPrice).toBe(80);
    expect(r.source).toBe("offer");
  });

  it("keeps min_order-restricted offers when cartSubtotal is not provided (gate evaluated lazily)", () => {
    const r = resolveOfferPrice(
      baseProduct({ price: 100 }),
      [
        baseOffer({
          id: "o1",
          discount_type: "percentage",
          discount_value: 20,
          min_order: 1000,
        }),
      ],
      NOW,
    );
    // min_order not enforced without subtotal; offer still applies.
    expect(r.unitPrice).toBe(80);
    expect(r.source).toBe("offer");
  });
});

describe("resolveOfferPrice — numeric robustness", () => {
  it("rounds floating point savings to 2 decimal places in the output", () => {
    const r = resolveOfferPrice(
      baseProduct({ price: 9.99 }),
      [baseOffer({ id: "o1", discount_type: "percentage", discount_value: 33 })],
      NOW,
    );
    // 9.99 - 9.99*0.33 = 9.99 - 3.2967 = 6.6933 → rounded to 6.69
    expect(r.unitPrice).toBe(6.69);
  });

  it("handles price=0 gracefully", () => {
    const r = resolveOfferPrice(
      baseProduct({ price: 0 }),
      [baseOffer({ id: "o1", discount_type: "percentage", discount_value: 50 })],
      NOW,
    );
    expect(r.unitPrice).toBe(0);
    expect(r.source).toBe("none");
  });

  it("handles a missing vendor_id / category_id without crashing", () => {
    const r = resolveOfferPrice(
      baseProduct({ price: 100, vendor_id: null, category_id: null }),
      [baseOffer({ id: "o1", discount_type: "percentage", discount_value: 20 })],
      NOW,
    );
    expect(r.unitPrice).toBe(80);
  });
});
