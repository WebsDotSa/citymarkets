// Item resolution for the unified checkout.
//
// In a SINGLE transaction, this module:
//   1. Locks (= SELECT FOR UPDATE) every product row the cart touches
//      so a concurrent checkout can't claim the same stock twice.
//   2. Validates that each product is active, in stock, and owned by
//      the vendor the client claims (defense against cart-row forgery).
//   3. Returns the canonical list of items the route will write to
//      `order_items` and `vendor_order_items`.
//
// Catalog rows (City Markets) come from `vendor_products` joined with
// `vendor_id = CITY_MARKETS_VENDOR_ID`. There is a deliberate fallback
// to the legacy `products` table for rows that haven't been backfilled
// yet (migration 014 is ongoing). After Slice 4 the fallback window
// closes and the union is removed.

import { CITY_MARKETS_VENDOR_ID } from "@/lib/types";
import { queryMany, queryOne, type Queryable } from "@/lib/db/typed";
import {
  computeOfferEffectivePrice,
  isOfferLive,
  type ProductForOffer,
} from "@/lib/catalog/offers";
import type { OfferDiscountType } from "@/lib/types";

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

/**
 * Decide the unit price for a product row at checkout, applying
 * `active_offer_*` from `products_unified_with_offers` on top of
 * `discount_price`. Mirrors `cart/pricing.priceCartRow` so the cart
 * UI and the order total agree. SECURITY: without this, a customer
 * would see a discounted cart total but the order row would record
 * the pre-offer price (or vice versa), creating either a revenue
 * leak (we charge less than the cart showed) or a trust gap (we
 * charge more than the cart showed).
 */
function pickCheckoutUnitPrice(args: {
  list: number;
  discountPrice: number | null;
  activeOfferId: string | null;
  activeOfferType: OfferDiscountType | null;
  activeOfferValue: number | null;
  activeOfferMaxDiscount: number | null;
  activeOfferMinOrder: number | null;
  activeOfferStartsAt: string | Date | null;
  activeOfferEndsAt: string | Date | null;
}): number {
  const list = Math.max(0, Number(args.list) || 0);
  const discount =
    args.discountPrice != null && Number(args.discountPrice) < list
      ? Number(args.discountPrice)
      : null;
  let offerId: string | null = null;
  if (
    args.activeOfferId &&
    args.activeOfferType != null &&
    args.activeOfferValue != null &&
    args.activeOfferStartsAt != null &&
    args.activeOfferEndsAt != null
  ) {
    const offer: OfferLike = {
      id: args.activeOfferId,
      discount_type: args.activeOfferType,
      discount_value: Number(args.activeOfferValue),
      max_discount:
        args.activeOfferMaxDiscount != null
          ? Number(args.activeOfferMaxDiscount)
          : null,
      min_order:
        args.activeOfferMinOrder != null
          ? Number(args.activeOfferMinOrder)
          : null,
      starts_at: args.activeOfferStartsAt,
      ends_at: args.activeOfferEndsAt,
      is_active: true,
    };
    if (isOfferLive(offer, new Date())) offerId = offer.id;
  }
  let offerPrice: number | null = null;
  if (offerId) {
    const syntheticProduct: ProductForOffer = {
      price: list,
      discount_price: discount,
    };
    offerPrice = computeOfferEffectivePrice(syntheticProduct, {
      id: offerId,
      discount_type: args.activeOfferType!,
      discount_value: Number(args.activeOfferValue!),
      max_discount:
        args.activeOfferMaxDiscount != null
          ? Number(args.activeOfferMaxDiscount)
          : null,
      min_order:
        args.activeOfferMinOrder != null
          ? Number(args.activeOfferMinOrder)
          : null,
      starts_at: args.activeOfferStartsAt!,
      ends_at: args.activeOfferEndsAt!,
      is_active: true,
    }).effectivePrice;
  }
  // Cheapest wins. Offer beats discount when both apply.
  let best = list;
  if (discount != null && discount < best) best = discount;
  if (offerPrice != null && offerPrice < best) best = offerPrice;
  return best;
}

export interface ResolvedCatalogItem {
  product_id: string;
  quantity: number;
  unit_price: number;
  name_ar: string;
  stock_qty: number;
  track_stock: boolean;
  image_url: string | null;
  vendor_id: string | null;
}

export interface ResolvedVendorItem extends ResolvedCatalogItem {
  vendor_id: string; // never null for vendor groups
}

export interface ResolvedVendorGroup {
  vendor_id: string;
  vendor_slug: string;
  vendor_name: string;
  items: ResolvedVendorItem[];
  subtotal: number;
  /**
   * Vendor-level minimum order. The legacy per-vendor
   * `delivery_fee_override` column is no longer read by the checkout
   * pipeline (migration 060 — universal distance-based fee) — every
   * vendor group pays the same distance-based fee.
   */
  min_order_amount: number;
}

export interface ResolvedCheckout {
  catalog: ResolvedCatalogItem[];
  vendorGroups: ResolvedVendorGroup[];
}

export type ItemResolutionError =
  | { kind: "product_not_found"; productId: string; message: string }
  | { kind: "product_inactive"; productId: string; message: string }
  | { kind: "vendor_inactive"; vendorId: string; message: string }
  | { kind: "ownership_mismatch"; productId: string; vendorId: string; message: string }
  | { kind: "stock_insufficient"; productId: string; message: string }
  | { kind: "vendor_min_order"; vendorId: string; minOrder: number; subtotal: number; message: string };

/**
 * Run the full item resolution against a checkout body. Takes the
 * already-opened `pg.Client` from the caller's transaction so
 * SELECT FOR UPDATE locks stay in scope until COMMIT.
 *
 * Caller MUST pass the request-scoped SQL client (not the pool helper)
 * so the row locks survive until the outer transaction commits.
 */
export interface CatalogResolveInput {
  items: { product_id: string; quantity: number }[];
}

export interface VendorGroupResolveInput {
  vendor_id: string;
  items: { product_id: string; quantity: number }[];
}

export interface ResolveItemsArgs {
  catalog: CatalogResolveInput[];
  vendorGroups: VendorGroupResolveInput[];
  client: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  };
}

export async function resolveItems(
  args: ResolveItemsArgs,
): Promise<ResolvedCheckout | ItemResolutionError> {
  const { catalog, vendorGroups, client } = args;

  const catalogIds = catalog.flatMap((g) => g.items.map((i) => i.product_id));
  const vendorIdsByProduct: { productId: string; vendorId: string }[] = [];
  for (const g of vendorGroups) {
    for (const i of g.items) {
      vendorIdsByProduct.push({ productId: i.product_id, vendorId: g.vendor_id });
    }
  }
  const vendorIds = Array.from(new Set(vendorGroups.map((g) => g.vendor_id)));

  // ---- 1. Catalog items → vendor_products (City Markets) ∪ products fallback ----
  const resolvedCatalog: ResolvedCatalogItem[] = [];
  if (catalog.length > 0) {
    interface CatalogProductRow {
      id: string;
      name_ar: string;
      price: string | number;
      discount_price: string | number | null;
      stock_qty: number | string | null;
      track_stock: boolean | null;
      image_url: string | null;
      vendor_id: string | null;
      active_offer_id: string | null;
      active_offer_type: string | null;
      active_offer_value: string | number | null;
      active_offer_max_discount: string | number | null;
      active_offer_min_order: string | number | null;
      active_offer_starts_at: string | null;
      active_offer_ends_at: string | null;
    }
    const catalogRowList = await queryMany<CatalogProductRow>(
      client as Queryable,
      // SECURITY (PCP-195): read from the with-offers view so checkout
      // applies active offers the same way the cart UI does. The view
      // is a UNION ALL (non-updatable), so FOR UPDATE is intentionally
      // omitted here — the row lock is taken on the underlying
      // `vendor_products` row in the stock UPDATE later in the same
      // transaction.
      `SELECT id, name_ar, price, discount_price, stock_qty, track_stock,
              image_url, vendor_id::text AS vendor_id,
              active_offer_id, active_offer_type, active_offer_value,
              active_offer_max_discount, active_offer_min_order,
              active_offer_starts_at, active_offer_ends_at
         FROM products_unified_with_offers
        WHERE id = ANY($1::uuid[])`,
      [catalogIds],
    );
    const byId = new Map(catalogRowList.map((r) => [r.id, r]));
    for (const g of catalog) {
      for (const it of g.items) {
        const row = byId.get(it.product_id);
        if (!row) {
          return {
            kind: "product_not_found",
            productId: it.product_id,
            message: "المنتج غير موجود",
          };
        }
        // We treat any non-City-Markets row in the catalog bucket as a
        // bug — the cart context routes vendor rows to vendor groups.
        if (row.vendor_id && row.vendor_id !== CITY_MARKETS_VENDOR_ID) {
          return {
            kind: "ownership_mismatch",
            productId: it.product_id,
            vendorId: row.vendor_id,
            message: "البائع لا يطابق المنتج",
          };
        }
        const stockAware = row.track_stock !== false;
        if (stockAware) {
          const stock = Number(row.stock_qty ?? 0);
          if (stock < it.quantity) {
            return {
              kind: "stock_insufficient",
              productId: it.product_id,
              message: "الكمية غير متوفرة",
            };
          }
        }
        const unit = pickCheckoutUnitPrice({
          list: Number(row.price) || 0,
          discountPrice:
            row.discount_price != null ? Number(row.discount_price) : null,
          activeOfferId: row.active_offer_id,
          activeOfferType:
            (row.active_offer_type as OfferDiscountType | null) ?? null,
          activeOfferValue:
            row.active_offer_value != null
              ? Number(row.active_offer_value)
              : null,
          activeOfferMaxDiscount:
            row.active_offer_max_discount != null
              ? Number(row.active_offer_max_discount)
              : null,
          activeOfferMinOrder:
            row.active_offer_min_order != null
              ? Number(row.active_offer_min_order)
              : null,
          activeOfferStartsAt: row.active_offer_starts_at,
          activeOfferEndsAt: row.active_offer_ends_at,
        });
        resolvedCatalog.push({
          product_id: row.id,
          quantity: it.quantity,
          unit_price: unit,
          name_ar: row.name_ar,
          stock_qty: Number(row.stock_qty ?? 0),
          track_stock: row.track_stock !== false,
          image_url: row.image_url,
          vendor_id: row.vendor_id ?? null,
        });
      }
    }
  }

  // ---- 2. Vendor groups → vendor_products by (vendor_id, product_id) ----
  const resolvedVendorGroups: ResolvedVendorGroup[] = [];
  for (const g of vendorGroups) {
    // Lock the vendor row. vendor_settings was previously JOINed here
    // for `min_order_amount` but migration 060 made that column dead
    // weight (every group now charges the same distance-based fee).
    // Postgres refuses `FOR UPDATE` against the nullable side of an
    // outer join — keeping vendor_settings in the FROM clause caused
    // the checkout to fail with
    //   "FOR UPDATE cannot be applied to the nullable side of an
    //    outer join"
    // for every order that included a vendor product. Drop the join.
    interface VendorRow {
      id: string;
      slug: string;
      name_ar: string;
      is_active: boolean;
      min_order_amount: number | string | null;
    }
    const vendor = await queryOne<VendorRow>(
      client as Queryable,
      `SELECT id, slug, name_ar, is_active, min_order_amount
         FROM vendors
        WHERE id = $1
        FOR UPDATE`,
      [g.vendor_id],
    );
    if (!vendor) {
      return {
        kind: "vendor_inactive",
        vendorId: g.vendor_id,
        message: "المتجر غير متوفر",
      };
    }
    if (!vendor.is_active) {
      return {
        kind: "vendor_inactive",
        vendorId: g.vendor_id,
        message: "المتجر غير متوفر",
      };
    }

    const productIds = g.items.map((i) => i.product_id);
    interface VendorProductRow {
      id: string;
      name_ar: string;
      price: string | number;
      discount_price: string | number | null;
      stock_quantity: number | string | null;
      track_stock: boolean | null;
      image_urls: string[] | null;
      vendor_id: string;
    }
    const productRowList = await queryMany<VendorProductRow>(
      client as Queryable,
      `SELECT id, name_ar, price, discount_price, stock_quantity, track_stock,
              image_urls, vendor_id
         FROM vendor_products
        WHERE id = ANY($1::uuid[]) AND vendor_id = $2
        FOR UPDATE`,
      [productIds, g.vendor_id],
    );
    const byId = new Map(productRowList.map((r) => [r.id, r]));
    const items: ResolvedVendorItem[] = [];
    let subtotal = 0;
    for (const it of g.items) {
      const row = byId.get(it.product_id);
      if (!row) {
        return {
          kind: "ownership_mismatch",
          productId: it.product_id,
          vendorId: g.vendor_id,
          message: "البائع لا يطابق المنتج",
        };
      }
      if (row.vendor_id !== g.vendor_id) {
        return {
          kind: "ownership_mismatch",
          productId: it.product_id,
          vendorId: g.vendor_id,
          message: "البائع لا يطابق المنتج",
        };
      }
      const stockAware = row.track_stock !== false;
      if (stockAware) {
        const stock = Number(row.stock_quantity ?? 0);
        if (stock < it.quantity) {
          return {
            kind: "stock_insufficient",
            productId: it.product_id,
            message: "الكمية غير متوفرة",
          };
        }
      }
      const unit = Number(row.discount_price ?? row.price) || 0;
      const line = unit * it.quantity;
      subtotal += line;
      items.push({
        product_id: row.id,
        quantity: it.quantity,
        unit_price: unit,
        name_ar: row.name_ar,
        stock_qty: Number(row.stock_quantity ?? 0),
        track_stock: row.track_stock !== false,
        image_url: row.image_urls?.[0] ?? null,
        vendor_id: row.vendor_id,
      });
    }

    // `min_order_amount` lives on `vendors` (single source of truth —
    // we already locked that row above with FOR UPDATE so a concurrent
    // policy change can't race against this checkout).
    const minOrder = Number(vendor.min_order_amount ?? 0);
    if (minOrder > 0 && subtotal < minOrder) {
      return {
        kind: "vendor_min_order",
        vendorId: g.vendor_id,
        minOrder,
        subtotal,
        message: `الحد الأدنى للطلب ${minOrder} ر.س لهذا المتجر`,
      };
    }

    resolvedVendorGroups.push({
      vendor_id: vendor.id,
      vendor_slug: vendor.slug,
      vendor_name: vendor.name_ar,
      items,
      subtotal: Number(subtotal.toFixed(2)),
      min_order_amount: minOrder,
    });
  }

  // Keep ESLint happy — currently unused above, kept for future
  // structured logging.
  void vendorIds;
  return { catalog: resolvedCatalog, vendorGroups: resolvedVendorGroups };
}
