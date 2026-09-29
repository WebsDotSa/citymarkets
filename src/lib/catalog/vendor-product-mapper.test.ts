import { describe, expect, it } from "vitest";
import {
  vendorProductToCartProduct,
  type VendorStorefrontProductInput,
} from "./vendor-product-mapper";
import { CITY_MARKETS_VENDOR_ID } from "./product-source";

const baseInput: VendorStorefrontProductInput = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "حليب طازج",
  nameEn: "Fresh Milk",
  description: "حليب كامل الدسم 1 لتر",
  images: ["/uploads/milk.jpg", "/uploads/milk-2.jpg"],
  price: 9.5,
  discountPrice: 7.5,
  stock: 12,
  inStock: true,
};

const baseVendor = {
  vendorId: "almarai-vendor-id",
  vendorSlug: "almarai",
  vendorName: "المراعي",
};

describe("vendorProductToCartProduct", () => {
  it("maps every field of the vendor storefront shape to the canonical Product", () => {
    const result = vendorProductToCartProduct(baseInput, baseVendor);

    expect(result.id).toBe(baseInput.id);
    expect(result.name_ar).toBe(baseInput.name);
    expect(result.name_en).toBe(baseInput.nameEn);
    expect(result.description).toBe(baseInput.description);
    expect(result.image_url).toBe(baseInput.images?.[0]);
    expect(result.images).toEqual(baseInput.images);
    expect(result.price).toBe(baseInput.price);
    expect(result.discount_price).toBe(baseInput.discountPrice);
    expect(result.stock_qty).toBe(baseInput.stock);
    expect(result.is_active).toBe(baseInput.inStock);
  });

  it("attaches vendor provenance so the cart UI and checkout can route the order", () => {
    const result = vendorProductToCartProduct(baseInput, baseVendor);
    // Typed — no Record<string, string|undefined> cast. These are the
    // canonical fields the multi-vendor cart (Slice 2) and checkout
    // (Slice 3) read from.
    expect(result.vendor_id).toBe(baseVendor.vendorId);
    expect(result.vendor_slug).toBe(baseVendor.vendorSlug);
    expect(result.vendor_name).toBe(baseVendor.vendorName);
  });

  it("synthesises a vendor:<slug> category fallback so CartV2 keeps rendering", () => {
    // CartV2 reads `category_name` to render the per-row label.
    // Vendor products don't have a real category mapping, so we set a
    // synthetic one tagged with the vendor slug. The vendor badge in
    // product-card.tsx supersedes this label visually.
    const result = vendorProductToCartProduct(baseInput, baseVendor);
    expect(result.category_slug).toBe(baseVendor.vendorSlug);
    expect(result.category_name).toBe(`vendor:${baseVendor.vendorSlug}`);
  });

  it("treats City Markets vendors as catalog items (no synthetic label leakage)", () => {
    const result = vendorProductToCartProduct(baseInput, {
      ...baseVendor,
      vendorId: CITY_MARKETS_VENDOR_ID,
      vendorSlug: "city-markets",
    });
    expect(result.vendor_id).toBe(CITY_MARKETS_VENDOR_ID);
    expect(result.category_name).toBe("vendor:city-markets");
  });

  it("handles missing optional fields without crashing", () => {
    const minimal: VendorStorefrontProductInput = {
      id: "22222222-2222-2222-2222-222222222222",
      name: "خبز عربي",
      price: 3,
      inStock: true,
    };
    const result = vendorProductToCartProduct(minimal, baseVendor);
    expect(result.name_en).toBeNull();
    expect(result.description).toBeNull();
    expect(result.image_url).toBeNull();
    expect(result.images).toEqual([]);
    expect(result.discount_price).toBeNull();
    expect(result.stock_qty).toBe(0);
  });

  it("preserves sku as barcode when the storefront supplies it", () => {
    const result = vendorProductToCartProduct(
      { ...baseInput, sku: "6001001" },
      baseVendor,
    );
    expect(result.barcode).toBe("6001001");
  });

  it("treats out-of-stock items as inactive so the cart UI shows them disabled", () => {
    const result = vendorProductToCartProduct(
      { ...baseInput, inStock: false, stock: 0 },
      baseVendor,
    );
    expect(result.is_active).toBe(false);
    expect(result.stock_qty).toBe(0);
  });
});
