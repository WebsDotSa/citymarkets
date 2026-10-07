import { NextResponse } from "next/server";
import { query } from "@/lib/db";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  try {
    const { slug, id } = await params;

    // Get vendor
    const vendorResult = await query(
      "SELECT id, slug, name_ar FROM vendors WHERE slug = $1 AND is_active = TRUE",
      [slug]
    );

    if (vendorResult.rows.length === 0) {
      return NextResponse.json({ error: "المتجر غير موجود" }, { status: 404 });
    }

    const vendor = vendorResult.rows[0];

    // Get product
    const productResult = await query(
      `SELECT 
        vp.id, vp.vendor_id, vp.category_id,
        vp.name_ar, vp.name_en, vp.description_ar, vp.description_en,
        vp.image_urls, vp.image_url, vp.price, vp.discount_price, vp.sku,
        vp.stock_quantity, vp.track_stock, vp.metadata,
        c.name_ar as category_name_ar
       FROM vendor_products vp
       LEFT JOIN categories c ON vp.category_id = c.id
       WHERE vp.id = $1 AND vp.vendor_id = $2 AND vp.is_active = TRUE`,
      [id, vendor.id]
    );

    if (productResult.rows.length === 0) {
      return NextResponse.json({ error: "المنتج غير موجود" }, { status: 404 });
    }

    const p = productResult.rows[0];

    // Get related products (same category, excluding current).
    // BUGFIX (2026-10-07): mirror the Slice 5 primary-image COALESCE —
    // the admin product form writes a single upload to `image_url` and
    // leaves `image_urls[]` NULL, so reading image_urls[0] alone
    // returned null and the page rendered the 📦 placeholder for every
    // similar product.
    let relatedProducts: any[] = [];
    if (p.category_id) {
      const relatedResult = await query(
        `SELECT id, name_ar,
                COALESCE(NULLIF(image_urls[1], ''), NULLIF(image_url, '')) as image,
                price, discount_price
         FROM vendor_products
         WHERE vendor_id = $1 AND category_id = $2 AND id != $3 AND is_active = TRUE
         ORDER BY sort_order ASC
         LIMIT 4`,
        [vendor.id, p.category_id, id]
      );

      relatedProducts = relatedResult.rows.map((r) => ({
        id: r.id,
        name: r.name_ar,
        image: r.image ?? null,
        price: parseFloat(r.price),
        discountPrice: r.discount_price ? parseFloat(r.discount_price) : null,
      }));
    }

    const product = {
      id: p.id,
      vendorId: vendor.id,
      vendorSlug: vendor.slug,
      vendorName: vendor.name_ar,
      name: p.name_ar,
      nameEn: p.name_en,
      description: p.description_ar,
      descriptionEn: p.description_en,
      // Same Slice 5 fallback: single-image uploads land in `image_url`
      // with `image_urls[]` NULL — without this the main gallery was
      // empty for those products.
      images: p.image_urls?.length ? p.image_urls : p.image_url ? [p.image_url] : [],
      price: parseFloat(p.price),
      discountPrice: p.discount_price ? parseFloat(p.discount_price) : null,
      sku: p.sku,
      stock: p.track_stock ? p.stock_quantity : null,
      inStock: !p.track_stock || p.stock_quantity > 0,
      metadata: p.metadata,
      category: p.category_id ? {
        id: p.category_id,
        name: p.category_name_ar,
      } : null,
      relatedProducts,
    };

    return NextResponse.json({ product });
  } catch (error) {
    logError("Vendor product error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في جلب المنتج" },
      { status: 500 }
    );
  }
}
