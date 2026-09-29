import { describe, expect, it } from "vitest";

/**
 * Tests for the cart pricing module (P2-5).
 *
 * Pins the unit-price formula so the cart UI and checkout agree on
 * the final number. The formula mirrors `@/lib/catalog/offers`
 * (which is the canonical resolver used at checkout).
 */

import { cartSubtotal, priceCartRow } from "./pricing";

const NOW = new Date("2026-09-29T12:00:00Z");

function offerRow(overrides: Record<string, unknown> = {}) {
  return {
    product_id: "p-1",
    price: 100,
    discount_price: null,
    quantity: 2,
    active_offer_id: null,
    active_offer_type: null,
    active_offer_value: null,
    active_offer_max_discount: null,
    active_offer_min_order: null,
    active_offer_starts_at: null,
    active_offer_ends_at: null,
    ...overrides,
  };
}

const LIVE = {
  active_offer_starts_at: "2026-01-01T00:00:00Z",
  active_offer_ends_at: "2027-01-01T00:00:00Z",
};

describe("priceCartRow — no offer", () => {
  it("uses list price when no offer and no discount_price", () => {
    const r = priceCartRow(offerRow(), NOW);
    expect(r.unit_price).toBe(100);
    expect(r.line_total).toBe(200);
    expect(r.source).toBe("list");
    expect(r.winning_offer_id).toBeNull();
  });

  it("uses discount_price when cheaper than list", () => {
    const r = priceCartRow(offerRow({ discount_price: 80 }), NOW);
    expect(r.unit_price).toBe(80);
    expect(r.line_total).toBe(160);
    expect(r.source).toBe("discount_price");
  });

  it("ignores discount_price when it's >= list", () => {
    const r = priceCartRow(offerRow({ discount_price: 110 }), NOW);
    expect(r.unit_price).toBe(100);
    expect(r.source).toBe("list");
  });
});

describe("priceCartRow — percentage offer", () => {
  it("applies the percentage offer when strictly cheaper", () => {
    const r = priceCartRow(
      offerRow({
        active_offer_id: "o-1",
        active_offer_type: "percentage",
        active_offer_value: 20,
        ...LIVE,
      }),
      NOW,
    );
    expect(r.unit_price).toBe(80);
    expect(r.line_total).toBe(160);
    expect(r.source).toBe("offer");
    expect(r.winning_offer_id).toBe("o-1");
    expect(r.unit_savings).toBe(20);
  });

  it("caps the percentage discount at max_discount", () => {
    const r = priceCartRow(
      offerRow({
        active_offer_id: "o-2",
        active_offer_type: "percentage",
        active_offer_value: 50,
        active_offer_max_discount: 10,
        ...LIVE,
      }),
      NOW,
    );
    expect(r.unit_price).toBe(90);
    expect(r.unit_savings).toBe(10);
  });
});

describe("priceCartRow — fixed offer", () => {
  it("applies a fixed offer when cheaper than discount_price", () => {
    const r = priceCartRow(
      offerRow({
        price: 100,
        discount_price: 85,
        active_offer_id: "o-3",
        active_offer_type: "fixed",
        active_offer_value: 20,
        ...LIVE,
      }),
      NOW,
    );
    expect(r.unit_price).toBe(80);
    expect(r.source).toBe("offer");
  });

  it("caps the fixed discount at the list price", () => {
    const r = priceCartRow(
      offerRow({
        price: 100,
        active_offer_id: "o-4",
        active_offer_type: "fixed",
        active_offer_value: 200, // larger than list
        ...LIVE,
      }),
      NOW,
    );
    expect(r.unit_price).toBe(0);
    expect(r.line_total).toBe(0);
  });
});

describe("priceCartRow — offer not live", () => {
  it("falls back to discount_price when the offer window has closed", () => {
    const r = priceCartRow(
      offerRow({
        price: 100,
        discount_price: 80,
        active_offer_id: "o-5",
        active_offer_type: "percentage",
        active_offer_value: 50,
        starts_at: "2020-01-01T00:00:00Z",
        ends_at: "2020-12-31T23:59:59Z",
      }),
      NOW,
    );
    expect(r.unit_price).toBe(80);
    expect(r.source).toBe("discount_price");
  });

  it("falls back to list when the offer hasn't started yet", () => {
    const r = priceCartRow(
      offerRow({
        active_offer_id: "o-6",
        active_offer_type: "percentage",
        active_offer_value: 25,
        starts_at: "2030-01-01T00:00:00Z",
        ends_at: "2030-12-31T23:59:59Z",
      }),
      NOW,
    );
    expect(r.unit_price).toBe(100);
    expect(r.source).toBe("list");
  });
});

describe("priceCartRow — quantity handling", () => {
  it("rounds line_total to 2dp", () => {
    const r = priceCartRow(offerRow({ price: 9.99, quantity: 3 }), NOW);
    expect(r.line_total).toBe(29.97);
  });

  it("treats negative quantity as zero", () => {
    const r = priceCartRow(offerRow({ quantity: -1 }), NOW);
    expect(r.line_total).toBe(0);
  });

  it("floors fractional quantities", () => {
    const r = priceCartRow(offerRow({ price: 10, quantity: 2.9 }), NOW);
    expect(r.line_total).toBe(20);
  });
});

describe("cartSubtotal", () => {
  it("sums line_totals across rows", () => {
    const result = cartSubtotal(
      [
        offerRow({ product_id: "p-1", price: 100, quantity: 1 }),
        offerRow({ product_id: "p-2", price: 50, discount_price: 40, quantity: 2 }),
      ],
      NOW,
    );
    expect(result.subtotal).toBe(180); // 100 + 40*2
    expect(result.totalSavings).toBe(20); // (100-100) + (50-40)*2
  });

  it("returns 0 for an empty cart", () => {
    const result = cartSubtotal([], NOW);
    expect(result.subtotal).toBe(0);
    expect(result.totalSavings).toBe(0);
  });
});
