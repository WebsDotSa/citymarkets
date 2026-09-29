import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireVendorRole } from "@/lib/identity";
import { verifyVendorRequestWithDb } from "@/lib/identity/vendor-auth-with-db";
import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { id } = await params;

    const result = await query(
      `SELECT id, vendor_id, name_ar, name_en, description_ar, description_en, image_urls, price, discount_price, sku, stock_quantity, track_stock, is_active, sort_order, category_id, metadata, created_at, updated_at
       FROM vendor_products WHERE id = $1 AND vendor_id = $2`,
      [id, session.vendorId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "المنتج غير موجود" }, { status: 404 });
    }

    const p = result.rows[0];

    return NextResponse.json({
      product: {
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
      },
    });
  } catch (error) {
    logError("Get product error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في جلب المنتج" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const unauthorized = requireVendorRole(session, "manager");
    if (unauthorized) return unauthorized;

    const { id } = await params;
    const body = await request.json();

    // Check product exists
    const checkResult = await query(
      "SELECT id FROM vendor_products WHERE id = $1 AND vendor_id = $2",
      [id, session.vendorId]
    );

    if (checkResult.rows.length === 0) {
      return NextResponse.json({ error: "المنتج غير موجود" }, { status: 404 });
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const allowedFields: Record<string, any> = {
      nameAr: "name_ar",
      nameEn: "name_en",
      descriptionAr: "description_ar",
      descriptionEn: "description_en",
      images: "image_urls",
      price: "price",
      discountPrice: "discount_price",
      sku: "sku",
      stockQuantity: "stock_quantity",
      trackStock: "track_stock",
      isActive: "is_active",
      sortOrder: "sort_order",
      categoryId: "category_id",
      metadata: "metadata",
    };

    for (const [key, dbField] of Object.entries(allowedFields)) {
      if (body[key] !== undefined) {
        updates.push(`${dbField} = $${paramIndex}`);
        values.push(body[key]);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "لا توجد بيانات للتحديث" }, { status: 400 });
    }

    values.push(id, session.vendorId);

    const result = await query(
      `UPDATE vendor_products
       SET ${updates.join(", ")}
       WHERE id = $${paramIndex} AND vendor_id = $${paramIndex + 1}
       RETURNING id, vendor_id, name_ar, name_en, description_ar, description_en, image_urls, price, discount_price, sku, stock_quantity, track_stock, is_active, sort_order, category_id, metadata, created_at, updated_at`,
      values
    );

    const p = result.rows[0];

    return NextResponse.json({
      success: true,
      product: {
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
      },
    });
  } catch (error) {
    logError("Update product error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في تحديث المنتج" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    // Only owner can delete products
    const unauthorized = requireVendorRole(session, "owner");
    if (unauthorized) return unauthorized;

    const { id } = await params;

    const result = await query(
      "DELETE FROM vendor_products WHERE id = $1 AND vendor_id = $2 RETURNING id",
      [id, session.vendorId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "المنتج غير موجود" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("Delete product error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في حذف المنتج" },
      { status: 500 }
    );
  }
}
