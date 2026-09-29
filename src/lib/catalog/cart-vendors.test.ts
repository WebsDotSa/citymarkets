import { describe, expect, it } from "vitest";
import {
  cartItemKey,
  computeGroupSubtotal,
  deriveVendorFromProduct,
  effectiveUnitPrice,
  groupCartItems,
  hasMixedVendors,
  lineSubtotal,
  type VendorGroup,
} from "./cart-vendors";
import { CITY_MARKETS_VENDOR_ID } from "./product-source";
import type { CartItem, Product } from "@/lib/types";

const baseProduct = (overrides: Partial<Product> = {}): Product => ({
  id: "11111111-1111-1111-1111-111111111111",
  category_id: "",
  name_ar: "حليب طازج",
  name_en: null,
  barcode: null,
  description: null,
  image_url: null,
  images: [],
  price: 10,
  discount_price: null,
  stock_qty: 100,
  unit: "piece",
  is_featured: false,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const cartItem = (
  product: Product,
  quantity: number,
  vendor?: { vendor_id?: string | null; vendor_slug?: string | null; vendor_name?: string | null },
): CartItem => ({
  product,
  quantity,
  vendor_id: vendor?.vendor_id ?? null,
  vendor_slug: vendor?.vendor_slug ?? null,
  vendor_name: vendor?.vendor_name ?? null,
});

describe("deriveVendorFromProduct", () => {
  it("returns the product's vendor info verbatim when vendor_id is set", () => {
    const result = deriveVendorFromProduct({
      vendor_id: "almarai",
      vendor_slug: "almarai",
      vendor_name: "المراعي",
    });
    expect(result).toEqual({
      vendor_id: "almarai",
      vendor_slug: "almarai",
      vendor_name: "المراعي",
    });
  });

  it("defaults to the City Markets pseudo-vendor when vendor_id is missing", () => {
    const result = deriveVendorFromProduct({});
    expect(result).toEqual({
      vendor_id: CITY_MARKETS_VENDOR_ID,
      vendor_slug: null,
      vendor_name: null,
    });
  });

  it("treats null vendor_id the same as missing", () => {
    const result = deriveVendorFromProduct({
      vendor_id: null,
      vendor_slug: null,
      vendor_name: null,
    });
    expect(result.vendor_id).toBe(CITY_MARKETS_VENDOR_ID);
  });
});

describe("effectiveUnitPrice + lineSubtotal", () => {
  it("returns the list price when no discount is set", () => {
    const item = cartItem(baseProduct({ price: 12, discount_price: null }), 2);
    expect(effectiveUnitPrice(item)).toBe(12);
    expect(lineSubtotal(item)).toBe(24);
  });

  it("returns the discount price when it's cheaper than the list price", () => {
    const item = cartItem(
      baseProduct({ price: 12, discount_price: 9 }),
      3,
    );
    expect(effectiveUnitPrice(item)).toBe(9);
    expect(lineSubtotal(item)).toBe(27);
  });

  it("falls back to list price when discount is set but not actually cheaper", () => {
    // Edge case: legacy data where discount_price == price or > price.
    // Use the cheaper of the two — never over-charge.
    const item = cartItem(
      baseProduct({ price: 10, discount_price: 12 }),
      1,
    );
    expect(effectiveUnitPrice(item)).toBe(10);
  });

  it("uses the active offer price when an offer beats the list price", () => {
    const item = cartItem(
      baseProduct({
        price: 100,
        discount_price: null,
        active_offer: {
          offer_id: "o1",
          title_ar: "عرض 20%",
          discount_type: "percentage",
          discount_value: 20,
          max_discount: null,
          min_order: null,
          starts_at: "2026-01-01T00:00:00Z",
          ends_at: "2027-01-01T00:00:00Z",
        },
      }),
      1,
    );
    expect(effectiveUnitPrice(item)).toBe(80);
  });

  it("keeps the legacy discount when it's still cheaper than the offer", () => {
    const item = cartItem(
      baseProduct({
        price: 100,
        discount_price: 70,
        active_offer: {
          offer_id: "o1",
          title_ar: "عرض 20%",
          discount_type: "percentage",
          discount_value: 20,
          max_discount: null,
          min_order: null,
          starts_at: "2026-01-01T00:00:00Z",
          ends_at: "2027-01-01T00:00:00Z",
        },
      }),
      1,
    );
    expect(effectiveUnitPrice(item)).toBe(70);
  });
});

describe("computeGroupSubtotal", () => {
  it("sums lineSubtotal across all items", () => {
    const items = [
      cartItem(baseProduct({ id: "a", price: 5 }), 2),
      cartItem(baseProduct({ id: "b", price: 3, discount_price: 2 }), 4),
    ];
    expect(computeGroupSubtotal(items)).toBe(5 * 2 + 2 * 4);
  });

  it("returns 0 for an empty group", () => {
    expect(computeGroupSubtotal([])).toBe(0);
  });
});

describe("groupCartItems", () => {
  it("collapses all catalog items into one bucket", () => {
    const p1 = baseProduct({ id: "c1" });
    const p2 = baseProduct({ id: "c2" });
    const items = [cartItem(p1, 1), cartItem(p2, 2)];
    const groups = groupCartItems(items);
    expect(groups.catalogItems).toHaveLength(2);
    expect(groups.vendorGroups).toHaveLength(0);
    expect(groups.subtotal).toBe(10 + 20);
    expect(groups.vendorIds.has(CITY_MARKETS_VENDOR_ID)).toBe(true);
  });

  it("creates one VendorGroup per non-City Markets vendor", () => {
    const p = baseProduct({ id: "v1" });
    const items = [
      cartItem(p, 1, { vendor_id: "vendor-a", vendor_slug: "a", vendor_name: "متجر أ" }),
      cartItem(p, 2, { vendor_id: "vendor-b", vendor_slug: "b", vendor_name: "متجر ب" }),
    ];
    const groups = groupCartItems(items);
    expect(groups.catalogItems).toHaveLength(0);
    expect(groups.vendorGroups).toHaveLength(2);
    expect(groups.vendorGroups.map((g) => g.vendorId).sort()).toEqual(["vendor-a", "vendor-b"]);
  });

  it("aggregates multiple items from the same vendor into one group with summed subtotal", () => {
    const p1 = baseProduct({ id: "x", price: 5 });
    const p2 = baseProduct({ id: "y", price: 3 });
    const items = [
      cartItem(p1, 2, { vendor_id: "v1" }),
      cartItem(p2, 1, { vendor_id: "v1" }),
    ];
    const groups = groupCartItems(items);
    expect(groups.vendorGroups).toHaveLength(1);
    expect(groups.vendorGroups[0].itemCount).toBe(3);
    expect(groups.vendorGroups[0].subtotal).toBe(5 * 2 + 3 * 1);
  });

  it("preserves item order within each group", () => {
    const items = [
      cartItem(baseProduct({ id: "1" }), 1, { vendor_id: "v1" }),
      cartItem(baseProduct({ id: "2" }), 1, { vendor_id: "v1" }),
      cartItem(baseProduct({ id: "3" }), 1, { vendor_id: "v2" }),
    ];
    const groups = groupCartItems(items);
    expect(groups.vendorGroups.find((g) => g.vendorId === "v1")?.items.map((i) => i.product.id)).toEqual(["1", "2"]);
    expect(groups.vendorGroups.find((g) => g.vendorId === "v2")?.items.map((i) => i.product.id)).toEqual(["3"]);
  });

  it("treats items with explicit City Markets vendor as catalog items", () => {
    const items = [
      cartItem(
        baseProduct({ id: "x" }),
        1,
        { vendor_id: CITY_MARKETS_VENDOR_ID, vendor_slug: null, vendor_name: null },
      ),
    ];
    const groups = groupCartItems(items);
    expect(groups.catalogItems).toHaveLength(1);
    expect(groups.vendorGroups).toHaveLength(0);
  });

  it("handles a mixed cart correctly (catalog + 2 vendors)", () => {
    const items = [
      cartItem(baseProduct({ id: "c1" }), 1),
      cartItem(baseProduct({ id: "v1" }), 1, { vendor_id: "vendor-a" }),
      cartItem(baseProduct({ id: "v2" }), 1, { vendor_id: "vendor-b" }),
    ];
    const groups = groupCartItems(items);
    expect(groups.catalogItems).toHaveLength(1);
    expect(groups.vendorGroups).toHaveLength(2);
    expect(groups.vendorIds.size).toBe(3);
  });
});

describe("hasMixedVendors", () => {
  it("returns false for a catalog-only cart", () => {
    const groups = groupCartItems([cartItem(baseProduct(), 1)]);
    expect(hasMixedVendors(groups)).toBe(false);
  });

  it("returns false for a single-vendor cart (no catalog)", () => {
    const groups = groupCartItems([
      cartItem(baseProduct({ id: "v1" }), 1, { vendor_id: "v1" }),
      cartItem(baseProduct({ id: "v2" }), 1, { vendor_id: "v1" }),
    ]);
    expect(hasMixedVendors(groups)).toBe(false);
  });

  it("returns true when catalog + vendor items coexist", () => {
    const groups = groupCartItems([
      cartItem(baseProduct({ id: "c" }), 1),
      cartItem(baseProduct({ id: "v" }), 1, { vendor_id: "v1" }),
    ]);
    expect(hasMixedVendors(groups)).toBe(true);
  });

  it("returns true when 2+ distinct vendors coexist", () => {
    const groups = groupCartItems([
      cartItem(baseProduct({ id: "a" }), 1, { vendor_id: "v1" }),
      cartItem(baseProduct({ id: "b" }), 1, { vendor_id: "v2" }),
    ]);
    expect(hasMixedVendors(groups)).toBe(true);
  });
});

describe("cartItemKey", () => {
  it("uses explicit vendor_id on the item when present", () => {
    const item = cartItem(baseProduct({ id: "p1" }), 1, { vendor_id: "v1" });
    expect(cartItemKey(item)).toBe("v1::p1");
  });

  it("falls back to product.vendor_id when item.vendor_id is null", () => {
    const item = cartItem(
      baseProduct({ id: "p1", vendor_id: "v-from-product" }),
      1,
    );
    expect(cartItemKey(item)).toBe("v-from-product::p1");
  });

  it("prefers item.vendor_id over product.vendor_id when both are set", () => {
    // Defensive: should never happen in practice (the cart context
    // overwrites the item-level field with the product-level one),
    // but if a stale item ever survives, the explicit field wins.
    const item = cartItem(
      baseProduct({ id: "p1", vendor_id: "from-product" }),
      1,
      { vendor_id: "from-item" },
    );
    expect(cartItemKey(item)).toBe("from-item::p1");
  });

  it("disambiguates two products sharing the same UUID across vendors", () => {
    const a = cartItem(baseProduct({ id: "dup" }), 1, { vendor_id: "v1" });
    const b = cartItem(baseProduct({ id: "dup" }), 1, { vendor_id: "v2" });
    expect(cartItemKey(a)).not.toBe(cartItemKey(b));
  });

  it("uses City Markets UUID when neither item nor product has a vendor", () => {
    const item = cartItem(baseProduct({ id: "p1" }), 1);
    expect(cartItemKey(item)).toBe(`${CITY_MARKETS_VENDOR_ID}::p1`);
  });
});

describe("VendorGroup shape contract", () => {
  it("exposes the fields CartV2 and Slice 3 consume", () => {
    const groups = groupCartItems([
      cartItem(baseProduct({ id: "v1", price: 7 }), 2, { vendor_id: "v-a", vendor_slug: "a", vendor_name: "متجر أ" }),
      cartItem(baseProduct({ id: "v2", price: 4 }), 1, { vendor_id: "v-a", vendor_slug: "a", vendor_name: "متجر أ" }),
    ]);
    const g: VendorGroup = groups.vendorGroups[0];
    expect(g).toMatchObject({
      vendorId: "v-a",
      vendorSlug: "a",
      vendorName: "متجر أ",
      isCityMarkets: false,
      itemCount: 3,
      subtotal: 7 * 2 + 4 * 1,
    });
    expect(g.items).toHaveLength(2);
  });
});