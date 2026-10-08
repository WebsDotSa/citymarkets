import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

import { error as logError } from '@/lib/logger';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { code, subtotal } = await request.json();

    if (!code) {
      return NextResponse.json(
        { error: "كود الكوبون مطلوب" },
        { status: 400 }
      );
    }

    // Get vendor
    const vendorResult = await query(
      "SELECT id, slug, name_ar FROM vendors WHERE slug = $1 AND is_active = TRUE",
      [slug]
    );

    if (vendorResult.rows.length === 0) {
      return NextResponse.json({ error: "المتجر غير موجود" }, { status: 404 });
    }

    const vendor = vendorResult.rows[0];

    // Get coupon
    const couponResult = await query(
      `SELECT id, code, discount_type, discount_value, min_order, max_uses, current_uses, valid_from, valid_until
       FROM vendor_coupons
       WHERE vendor_id = $1 AND UPPER(code) = UPPER($2) AND is_active = TRUE`,
      [vendor.id, code]
    );

    if (couponResult.rows.length === 0) {
      return NextResponse.json(
        { error: "الكوبون غير موجود" },
        { status: 404 }
      );
    }

    const coupon = couponResult.rows[0];

    // Check validity dates
    const now = new Date();
    if (coupon.valid_from && new Date(coupon.valid_from) > now) {
      return NextResponse.json(
        { error: "الكوبون غير ساري بعد" },
        { status: 400 }
      );
    }

    if (coupon.valid_until && new Date(coupon.valid_until) < now) {
      return NextResponse.json(
        { error: "الكوبون منتهي الصلاحية" },
        { status: 400 }
      );
    }

    // Check usage limit
    if (coupon.max_uses && coupon.current_uses >= coupon.max_uses) {
      return NextResponse.json(
        { error: "تم استخدام جميع مرات هذا الكوبون" },
        { status: 400 }
      );
    }

    // Check minimum order
    const orderSubtotal = subtotal || 0;
    if (coupon.min_order && orderSubtotal < parseFloat(coupon.min_order)) {
      return NextResponse.json(
        { error: `الحد الأدنى للطلب لاستخدام الكوبون: ${coupon.min_order} ر.س` },
        { status: 400 }
      );
    }

    // Calculate discount
    let discount = 0;
    if (coupon.discount_type === "percent") {
      discount = (orderSubtotal * parseFloat(coupon.discount_value)) / 100;
    } else {
      discount = parseFloat(coupon.discount_value);
    }

    // Ensure discount doesn't exceed subtotal
    discount = Math.min(discount, orderSubtotal);

    return NextResponse.json({
      valid: true,
      coupon: {
        code: coupon.code,
        discountType: coupon.discount_type,
        discountValue: parseFloat(coupon.discount_value),
        discount,
        minOrder: coupon.min_order ? parseFloat(coupon.min_order) : null,
      },
    });
  } catch (error) {
    logError("Coupon validation error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في التحقق من الكوبون" },
      { status: 500 }
    );
  }
}
