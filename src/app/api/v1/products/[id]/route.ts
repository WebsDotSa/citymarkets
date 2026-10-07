import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

// BUGFIX (audit 2026-09-29): admin endpoint already guards with this
// regex; mirror it on the public detail endpoint so callers passing
// garbage IDs get a clean 404 instead of a Postgres `invalid input
// syntax for type uuid` 500.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Related product type
 */
interface RelatedProduct {
  id: string;
  name_ar: string;
  price: number | string;
  discount_price: number | string | null;
  image_url: string | null;
  unit?: string;
}

/**
 * Look up the best active offer for a given product (Slice 5).
 * The query mirrors the LATERAL shape from the
 * `products_unified_with_offers` view but runs once per product detail
 * fetch (acceptable since this endpoint is not on a hot list path).
 *
 * Returns null when no offer matches.
 */
async function fetchActiveOffer(
  productId: string,
  categoryId: string | null | undefined,
  vendorId: string | null | undefined,
): Promise<{
  offer_id: string;
  title_ar: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  max_discount: number | null;
  min_order: number | null;
  starts_at: string;
  ends_at: string;
} | null> {
  try {
    const res = await query(
      `SELECT o.id AS offer_id, o.title_ar, o.discount_type, o.discount_value::float AS discount_value,
              o.max_discount::float AS max_discount, o.min_order::float AS min_order,
              o.starts_at, o.ends_at
         FROM offers o
         JOIN offer_targets ot ON ot.offer_id = o.id
        WHERE o.is_active = TRUE
          AND NOW() BETWEEN o.starts_at AND o.ends_at
          AND (
               (ot.target_type = 'product'  AND ot.target_id = $1)
            OR (ot.target_type = 'category' AND ot.target_id = $2)
            OR (ot.target_type = 'vendor'   AND ot.target_id = $3)
            OR (ot.target_type = 'all')
          )
        ORDER BY o.discount_value DESC
        LIMIT 1`,
      [productId, categoryId ?? null, vendorId ?? null],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      offer_id: r.offer_id,
      title_ar: r.title_ar,
      discount_type: r.discount_type,
      discount_value: Number(r.discount_value) || 0,
      max_discount: r.max_discount == null ? null : Number(r.max_discount),
      min_order: r.min_order == null ? null : Number(r.min_order),
      starts_at: r.starts_at,
      ends_at: r.ends_at,
    };
  } catch (err) {
    logError('fetchActiveOffer error:', err);
    return null;
  }
}

/**
 * Compute the effective price for a product given an optional active
 * offer. Mirrors the resolver logic in src/lib/offers.ts but stays
 * inline to avoid an HTTP hop in the hot path.
 */
function computeEffectivePrice(
  listPrice: number,
  legacySale: number | null,
  offer: Awaited<ReturnType<typeof fetchActiveOffer>>,
): number | null {
  let unitPrice = listPrice;
  if (offer) {
    let savings: number;
    if (offer.discount_type === 'percentage') {
      savings = (listPrice * offer.discount_value) / 100;
      if (offer.max_discount != null) savings = Math.min(savings, offer.max_discount);
    } else {
      savings = Math.min(offer.discount_value, listPrice);
    }
    savings = Math.min(Math.max(savings, 0), listPrice);
    unitPrice = Math.round((listPrice - savings) * 100) / 100;
  }
  if (legacySale != null && legacySale < listPrice && legacySale < unitPrice) {
    unitPrice = legacySale;
  }
  return unitPrice < listPrice ? unitPrice : null;
}

// GET /api/v1/products/[id] - Get single product detail
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // BUGFIX (audit 2026-09-29): reject non-UUID IDs with 404 instead of
    // letting Postgres raise `invalid input syntax for type uuid` →
    // HTTP 500. The admin handler uses the same regex; mirror here.
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { success: false, error: 'المنتج غير موجود' },
        { status: 404 },
      );
    }

    // First try to find in vendor_products table
    let result = await query(
      `SELECT vp.id, vp.vendor_id, vp.category_id, vp.name_ar, vp.name_en,
              vp.description_ar, vp.description_en,
              vp.image_urls as images,
              -- Slice 5 (image_url fix): fall back to the dedicated
              -- image_url column when the gallery is empty. The admin
              -- product form writes to image_url only when uploading a
              -- single primary image, leaving image_urls[] NULL.
              COALESCE(NULLIF(vp.image_urls[1], ''), NULLIF(vp.image_url, '')) as primary_image,
              vp.price::float as price, vp.discount_price::float as discount_price,
              vp.stock_quantity as stock_qty, vp.track_stock, vp.is_active, vp.sort_order,
              vp.created_at as created_at, vp.updated_at as updated_at,
              v.name_ar as vendor_name, v.slug as vendor_slug,
              c.name_ar as category_name, c.slug as category_slug
       FROM vendor_products vp
       LEFT JOIN vendors v ON vp.vendor_id = v.id
       LEFT JOIN categories c ON vp.category_id = c.id
       WHERE vp.id = $1`,
      [id]
    );

    // If not found in vendor_products, check products table
    if (result.rows.length === 0) {
      result = await query(
        `SELECT p.id, p.category_id, p.name_ar, p.name_en, p.barcode,
                p.description,
                p.image_url, p.images,
                p.price::float as price, p.discount_price::float as discount_price,
                p.stock_qty, p.unit, p.is_featured, p.is_active,
                p.created_at, p.updated_at,
                c.id as category_id_ref, c.name_ar as category_name, c.slug as category_slug, c.icon_url as category_icon
         FROM products_unified p
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE p.id = $1`,
        [id]
      );
    }

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Product not found' }, { status: 404 });
    }

    const product = result.rows[0];

    // Slice 5 — fetch active offer for this product.
    const activeOffer = await fetchActiveOffer(
      product.id,
      product.category_id ?? product.category_id_ref ?? null,
      product.vendor_id ?? null,
    );
    const listPrice = parseFloat(product.price) || 0;
    const legacySale = product.discount_price ? parseFloat(product.discount_price) : null;
    const effectivePrice = computeEffectivePrice(listPrice, legacySale, activeOffer);

    // Format vendor product response
    if (product.vendor_id) {
      const data = {
        id: product.id,
        vendor_id: product.vendor_id,
        vendor_name: product.vendor_name,
        vendor_slug: product.vendor_slug,
        name_ar: product.name_ar,
        name_en: product.name_en,
        description: product.description_ar || product.description_en,
        image_url: product.primary_image || (Array.isArray(product.images) ? product.images[0] : null),
        images: Array.isArray(product.images) ? product.images : [],
        price: listPrice,
        discount_price: legacySale,
        stock_qty: parseInt(product.stock_qty) || 0,
        // BUGFIX (audit 2026-09-29): expose `track_stock` so the storefront
        // can decide whether stock_qty=0 means "out of stock" or "untracked".
        // The legacy `products_unified` branch below defaults to false (the
        // legacy table never had a stock-tracking toggle).
        track_stock: product.track_stock === true || product.track_stock === 't',
        is_active: product.is_active,
        category_name: product.category_name,
        category_slug: product.category_slug,
        created_at: product.created_at,
        updated_at: product.updated_at,
        // Slice 5
        active_offer: activeOffer,
        effective_price: effectivePrice,
      };

      // Get related products from same vendor. BUGFIX (2026-10-07):
      // mirror the Slice 5 primary-image COALESCE — the admin product
      // form writes a single upload to `image_url` and leaves
      // `image_urls[]` NULL, so reading image_urls[0] alone returned
      // null and the storefront rendered the 📦 placeholder for every
      // similar product.
      const related = await query(
        `SELECT id, name_ar, price::float as price, discount_price::float as discount_price,
                COALESCE(NULLIF(image_urls[1], ''), NULLIF(image_url, '')) as image_url
         FROM vendor_products
         WHERE vendor_id = $1 AND id != $2 AND is_active = true
         LIMIT 4`,
        [product.vendor_id, id]
      );

      const relatedProducts = related.rows.map((r: RelatedProduct) => ({
        id: r.id,
        name_ar: r.name_ar,
        price: typeof r.price === 'number' ? r.price : (parseFloat(String(r.price)) || 0),
        discount_price: r.discount_price ? (typeof r.discount_price === 'number' ? r.discount_price : parseFloat(String(r.discount_price))) : null,
        image_url: r.image_url ?? null,
      }));

      return NextResponse.json({
        success: true,
        data,
        related: relatedProducts
      });
    }

    // Format regular product response. Slice 1 normalises this branch
    // to the same shape as the vendor_products branch above so the
    // storefront can render vendor provenance UI without a per-row
    // type guard. Legacy catalog rows point at the City Markets
    // pseudo-vendor (migration 014) — set explicitly so downstream
    // helpers (isCityMarketsVendor) keep their single null-or-string
    // invariant.
    const data = {
      id: product.id,
      vendor_id: null,
      vendor_name: null,
      vendor_slug: null,
      category_id: product.category_id,
      name_ar: product.name_ar,
      name_en: product.name_en,
      barcode: product.barcode,
      description: product.description,
      image_url: product.image_url,
      images: Array.isArray(product.images) ? product.images : [],
      price: listPrice,
      discount_price: legacySale,
      stock_qty: parseInt(product.stock_qty) || 0,
      unit: product.unit,
      is_featured: product.is_featured,
      is_active: product.is_active,
      category_name: product.category_name,
      category_slug: product.category_slug,
      category_icon: product.category_icon,
      created_at: product.created_at,
      updated_at: product.updated_at,
      // Slice 5
      active_offer: activeOffer,
      effective_price: effectivePrice,
    };

    // Get related products
    const related = await query(
      `SELECT id, name_ar, price::float as price, discount_price::float as discount_price, image_url, unit
       FROM products_unified
       WHERE category_id = $1 AND id != $2 AND is_active = true
       LIMIT 4`,
      [product.category_id, id]
    );

    const relatedProducts = related.rows.map((r: RelatedProduct) => ({
      id: r.id,
      name_ar: r.name_ar,
      price: typeof r.price === 'number' ? r.price : (parseFloat(String(r.price)) || 0),
      discount_price: r.discount_price ? (typeof r.discount_price === 'number' ? r.discount_price : parseFloat(String(r.discount_price))) : null,
      image_url: r.image_url,
      unit: r.unit,
    }));

    return NextResponse.json({
      success: true,
      data,
      related: relatedProducts
    });
  } catch (error) {
    logError('Error fetching product:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch product' }, { status: 500 });
  }
}
