import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireVendorRole, type VendorRole } from "@/lib/identity";
import { verifyVendorRequestWithDb } from "@/lib/identity/vendor-auth-with-db";
import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export async function GET(request: Request) {
  try {
    const session = await verifyVendorRequestWithDb(request as NextRequest);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const search = searchParams.get("search");
    const isActive = searchParams.get("isActive");
    const lowStock = searchParams.get("lowStock");

    const offset = (page - 1) * limit;

    let whereClause = "WHERE vendor_id = $1";
    const values: (string | number | boolean)[] = [session.vendorId];
    let paramIndex = 2;

    if (search) {
      whereClause += ` AND (name_ar ILIKE $${paramIndex} OR name_en ILIKE $${paramIndex})`;
      values.push(`%${search}%`);
      paramIndex++;
    }

    if (isActive !== null && isActive !== undefined) {
      whereClause += ` AND is_active = $${paramIndex}`;
      values.push(isActive === "true");
      paramIndex++;
    }

    if (lowStock === "true") {
      whereClause += ` AND track_stock = TRUE AND stock_quantity <= 5`;
    }

    const result = await query(
      `SELECT 
        id, name_ar, name_en, description_ar, description_en,
        image_urls, price, discount_price, sku,
        stock_quantity, track_stock, is_active, sort_order,
        category_id, metadata, created_at, updated_at
       FROM vendor_products
       ${whereClause}
       ORDER BY sort_order ASC, created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...values, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as total FROM vendor_products ${whereClause}`,
      values
    );

    const products = result.rows.map((p) => ({
      id: p.id,
      name: p.name_ar,
      nameEn: p.name_en,
      description: p.description_ar,
      descriptionEn: p.description_en,
      images: p.image_urls || [],
      price: parseFloat(p.price),
      discountPrice: p.discount_price ? parseFloat(p.discount_price) : null,
      sku: p.sku,
      stock: p.track_stock ? p.stock_quantity : null,
      trackStock: p.track_stock,
      isActive: p.is_active,
      sortOrder: p.sort_order,
      categoryId: p.category_id,
      metadata: p.metadata,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }));

    return NextResponse.json({
      products,
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

export async function POST(request: NextRequest) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const unauthorized = requireVendorRole(session, "manager");
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const {
      nameAr, nameEn, descriptionAr, descriptionEn,
      images, price, discountPrice, sku,
      stockQuantity, trackStock, isActive, sortOrder,
      categoryId, metadata
    } = body;

    if (!nameAr || !price) {
      return NextResponse.json(
        { error: "اسم المنتج والسعر مطلوبان" },
        { status: 400 }
      );
    }

    // Validate that the supplied categoryId refers to an ACTIVE row in
    // the global `categories` table. Without this check, a stale UI
    // dropdown (vendor sees a category that was archived in the admin
    // panel) could attach products to hidden rows and silently break
    // the storefront. Returns 400 with an Arabic message so the vendor
    // form can prompt the user to pick another category.
    if (categoryId) {
      const catRes = await query(
        `SELECT id FROM categories WHERE id = $1 AND is_active = TRUE LIMIT 1`,
        [categoryId],
      );
      if (catRes.rows.length === 0) {
        return NextResponse.json(
          { error: "القسم المختار غير متاح. اختر قسماً آخر." },
          { status: 400 },
        );
      }
    }

    const result = await query(
      `INSERT INTO vendor_products 
        (vendor_id, name_ar, name_en, description_ar, description_en,
         image_urls, price, discount_price, sku, stock_quantity, track_stock,
         is_active, sort_order, category_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        session.vendorId, nameAr, nameEn || null, descriptionAr || null, descriptionEn || null,
        images || [], price, discountPrice || null, sku || null,
        stockQuantity || 0, trackStock || false, isActive !== false, sortOrder || 0,
        categoryId || null, metadata || {}
      ]
    );

    const product = result.rows[0];

    return NextResponse.json({
      success: true,
      product: {
        id: product.id,
        name: product.name_ar,
        nameEn: product.name_en,
        description: product.description_ar,
        descriptionEn: product.description_en,
        images: product.image_urls || [],
        price: parseFloat(product.price),
        discountPrice: product.discount_price ? parseFloat(product.discount_price) : null,
        sku: product.sku,
        stock: product.track_stock ? product.stock_quantity : null,
        trackStock: product.track_stock,
        isActive: product.is_active,
        sortOrder: product.sort_order,
        categoryId: product.category_id,
        metadata: product.metadata,
        createdAt: product.created_at,
      },
    });
  } catch (error) {
    logError("Create product error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في إنشاء المنتج" },
      { status: 500 }
    );
  }
}
