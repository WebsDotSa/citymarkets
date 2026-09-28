import { NextResponse } from "next/server";
import { query } from "@/lib/db";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get("category");
    const minPrice = searchParams.get("minPrice");
    const maxPrice = searchParams.get("maxPrice");
    const search = searchParams.get("search");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    // Get vendor
    const vendorResult = await query(
      "SELECT id, slug, name_ar FROM vendors WHERE slug = $1 AND is_active = TRUE",
      [slug]
    );

    if (vendorResult.rows.length === 0) {
      return NextResponse.json({ error: "المتجر غير موجود" }, { status: 404 });
    }

    const vendor = vendorResult.rows[0];
    const offset = (page - 1) * limit;

    // Build query
    let whereClause = "WHERE vendor_id = $1 AND is_active = TRUE";
    const values: any[] = [vendor.id];
    let paramIndex = 2;

    if (categoryId) {
      whereClause += ` AND category_id = $${paramIndex}`;
      values.push(categoryId);
      paramIndex++;
    }

    if (minPrice) {
      whereClause += ` AND price >= $${paramIndex}`;
      values.push(minPrice);
      paramIndex++;
    }

    if (maxPrice) {
      whereClause += ` AND price <= $${paramIndex}`;
      values.push(maxPrice);
      paramIndex++;
    }

    if (search) {
      whereClause += ` AND (name_ar ILIKE $${paramIndex} OR name_en ILIKE $${paramIndex} OR description_ar ILIKE $${paramIndex})`;
      values.push(`%${search}%`);
      paramIndex++;
    }

    // Get products
    const productsResult = await query(
      `SELECT 
        id, name_ar, name_en, description_ar, description_en,
        image_urls, price, discount_price, sku,
        stock_quantity, track_stock, sort_order,
        metadata, category_id,
        created_at
       FROM vendor_products
       ${whereClause}
       ORDER BY sort_order ASC, created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, limit, offset]
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total FROM vendor_products ${whereClause}`,
      values
    );

    const products = productsResult.rows.map((p) => ({
      id: p.id,
      vendorId: vendor.id,
      vendorSlug: vendor.slug,
      vendorName: vendor.name_ar,
      name: p.name_ar,
      nameEn: p.name_en,
      description: p.description_ar,
      descriptionEn: p.description_en,
      images: p.image_urls || [],
      price: parseFloat(p.price),
      discountPrice: p.discount_price ? parseFloat(p.discount_price) : null,
      sku: p.sku,
      stock: p.track_stock ? p.stock_quantity : null,
      inStock: !p.track_stock || p.stock_quantity > 0,
      sortOrder: p.sort_order,
      metadata: p.metadata,
      categoryId: p.category_id,
    }));

    return NextResponse.json({
      products,
      vendor: {
        id: vendor.id,
        slug: vendor.slug,
        name: vendor.name_ar,
      },
      pagination: {
        page,
        limit,
        total: parseInt(countResult.rows[0].total),
        totalPages: Math.ceil(parseInt(countResult.rows[0].total) / limit),
      },
    });
  } catch (error) {
    logError("Vendor products error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في جلب المنتجات" },
      { status: 500 }
    );
  }
}
