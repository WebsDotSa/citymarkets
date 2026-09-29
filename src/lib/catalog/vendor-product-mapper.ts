// Shared mapper: vendor storefront product → canonical lib `Product`.
//
// Vendor storefronts (src/app/vendors/[slug]/**) and the product detail
// page (src/app/vendors/[slug]/products/[id]) fetch products from
// /api/v1/vendors/<slug>/products, whose response is a thin shape:
//
//   { id, name, nameEn, price, discountPrice, images, inStock, stock, ... }
//
// CartV2 / useCart() expect the canonical `Product` shape from
// src/lib/types.ts (the one returned by /api/v1/products). Without this
// mapping, vendor items were written to a different localStorage key
// with a different schema and silently disappeared from /cart. Vendor
// items therefore need to be coerced into the canonical shape — with
// vendor provenance attached — before they reach the cart context.
//
// This module keeps that mapping in one place so:
//   - the `(Record<string, string|undefined> as CartProduct)` cast that
//     used to smuggle `vendor_id`/`vendor_slug`/`vendor_name` onto the
//     item disappears, and
//   - the catalog fallback ("no category known for this vendor item")
//     stays consistent across the listing + detail pages.
//
// Slice 1 sets the foundation; Slice 2 (vendor-aware cart) uses the
// `vendor_id` field directly from the canonical Product type — see
// src/lib/cart-vendors.ts.

import type { Product } from "@/lib/types";

/**
 * Subset of fields the vendor storefront API actually returns. Either
 * pass it directly (detail page, where the API returns vendor_id/slug/name
 * on the row), or pass a listing-page shape + the vendor metadata
 * separately.
 */
export interface VendorStorefrontProductInput {
  id: string;
  name: string;
  nameEn?: string | null;
  sku?: string | null;
  description?: string | null;
  images?: string[];
  price: number;
  discountPrice?: number | null;
  stock?: number | null;
  inStock: boolean;
}

export interface VendorMetadata {
  vendorId: string;
  vendorSlug: string;
  vendorName?: string | null;
}

/**
 * Coerce a vendor storefront product into the canonical `Product` shape
 * used by CartV2 / useCart(). Populates vendor provenance fields so
 * downstream code (cart UI, checkout, SEO) can disambiguate City Markets
 * catalog items from third-party vendor items.
 */
export function vendorProductToCartProduct(
  product: VendorStorefrontProductInput,
  vendor: VendorMetadata,
): Product {
  const images = product.images ?? [];
  return {
    id: product.id,
    // Vendors are not currently tied to a top-level category in the
    // storefront API — the slice doesn't migrate vendor category
    // taxonomy. Empty string matches the prior behaviour (CartV2 checks
    // `category_id` truthiness, not equality) but the more correct
    // answer for a future migration is to map vendor `category_id` here.
    category_id: "",
    name_ar: product.name,
    name_en: product.nameEn ?? null,
    barcode: product.sku ?? null,
    description: product.description ?? null,
    image_url: images[0] ?? null,
    images,
    price: product.price,
    discount_price: product.discountPrice ?? null,
    stock_qty: product.stock ?? 0,
    unit: "",
    is_featured: false,
    is_active: product.inStock,
    // Vendor provenance — typed, no cast.
    vendor_id: vendor.vendorId,
    vendor_slug: vendor.vendorSlug,
    vendor_name: vendor.vendorName ?? null,
    // Synthetic category marker so the existing CartV2 layout (which
    // reads `category_name` / `category_slug` to render a per-row label)
    // can fall back to the vendor slug when there's no real category.
    category_slug: vendor.vendorSlug,
    category_name: `vendor:${vendor.vendorSlug}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
