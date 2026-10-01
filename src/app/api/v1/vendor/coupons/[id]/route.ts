import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireVendorRole } from "@/lib/identity";
import { verifyVendorRequestWithDb } from "@/lib/identity/vendor-auth-with-db";
import { error as logError } from '@/lib/logger';

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

    const checkResult = await query(
      "SELECT id FROM vendor_coupons WHERE id = $1 AND vendor_id = $2",
      [id, session.vendorId]
    );

    if (checkResult.rows.length === 0) {
      return NextResponse.json({ error: "الكوبون غير موجود" }, { status: 404 });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const allowedFields: Record<string, string> = {
      code: "code",
      discountType: "discount_type",
      discountValue: "discount_value",
      minOrder: "min_order",
      maxUses: "max_uses",
      validFrom: "valid_from",
      validUntil: "valid_until",
      isActive: "is_active",
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
      `UPDATE vendor_coupons 
       SET ${updates.join(", ")}
       WHERE id = $${paramIndex} AND vendor_id = $${paramIndex + 1}
       RETURNING *`,
      values
    );

    const coupon = result.rows[0];

    return NextResponse.json({
      success: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        discountType: coupon.discount_type,
        discountValue: parseFloat(coupon.discount_value),
        minOrder: coupon.min_order ? parseFloat(coupon.min_order) : null,
        maxUses: coupon.max_uses,
        currentUses: coupon.current_uses,
        validFrom: coupon.valid_from,
        validUntil: coupon.valid_until,
        isActive: coupon.is_active,
        createdAt: coupon.created_at,
      },
    });
  } catch (error) {
    logError("Update coupon error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في تحديث الكوبون" },
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

    const unauthorized = requireVendorRole(session, "owner");
    if (unauthorized) return unauthorized;

    const { id } = await params;

    const result = await query(
      "DELETE FROM vendor_coupons WHERE id = $1 AND vendor_id = $2 RETURNING id",
      [id, session.vendorId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "الكوبون غير موجود" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("Delete coupon error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في حذف الكوبون" },
      { status: 500 }
    );
  }
}
