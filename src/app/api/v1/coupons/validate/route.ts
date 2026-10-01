import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

import { error as logError } from '@/lib/logger';

/**
 * Public coupon validation endpoint.
 *
 * Used by /cart (CartV2) and /checkout (CheckoutNew) to verify a coupon
 * code is real, active, not expired, and meets the min_order threshold
 * BEFORE the user reaches the order-creation step. The server-side
 * /api/v1/orders route also re-validates at create time (defense-in-depth),
 * so this endpoint only needs to drive the UX display.
 *
 * Returns the server-canonical discount so the UI cannot display a
 * client-fabricated value.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawCode = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
    const subtotal = Number(body?.subtotal ?? 0);

    if (!rawCode) {
      return NextResponse.json(
        { success: false, valid: false, error: 'كود الخصم مطلوب' },
        { status: 400 },
      );
    }

    const result = await query(
      `SELECT code, type::text as type, value, min_order, max_discount,
              max_uses, used_count, expires_at, is_active
         FROM coupons
        WHERE UPPER(code) = $1
        LIMIT 1`,
      [rawCode],
    );

    const coupon = result.rows[0] as
      | {
          code: string;
          type: 'percentage' | 'fixed' | 'free_delivery';
          value: string | number;
          min_order: string | number | null;
          max_discount: string | number | null;
          max_uses: number | null;
          used_count: number | string;
          expires_at: string | Date | null;
          is_active: boolean;
        }
      | undefined;

    if (!coupon || !coupon.is_active) {
      return NextResponse.json({
        success: true,
        valid: false,
        error: 'كود الخصم غير صحيح أو منتهي',
      });
    }

    if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
      return NextResponse.json({
        success: true,
        valid: false,
        error: 'كود الخصم منتهي الصلاحية',
      });
    }

    if (coupon.max_uses != null && Number(coupon.used_count) >= Number(coupon.max_uses)) {
      return NextResponse.json({
        success: true,
        valid: false,
        error: 'تم استنفاد عدد مرات استخدام هذا الكود',
      });
    }

    const minOrder = coupon.min_order != null ? Number(coupon.min_order) : 0;
    if (subtotal > 0 && minOrder > 0 && subtotal < minOrder) {
      return NextResponse.json({
        success: true,
        valid: false,
        error: `الحد الأدنى لاستخدام الكود ${minOrder.toFixed(2)} ر.س`,
      });
    }

    // Compute the discount server-side so the UI cannot be tricked.
    let discount = 0;
    const value = Number(coupon.value);
    const maxDiscount =
      coupon.max_discount != null ? Number(coupon.max_discount) : null;

    if (coupon.type === 'percentage') {
      discount = Math.round(((subtotal * value) / 100) * 100) / 100;
      if (maxDiscount != null) discount = Math.min(discount, maxDiscount);
    } else if (coupon.type === 'fixed') {
      discount = Math.min(value, subtotal);
    } else if (coupon.type === 'free_delivery') {
      // free_delivery returns 0 here — the order route toggles delivery_fee.
      discount = 0;
    }

    const message =
      coupon.type === 'percentage'
        ? `خصم ${value}%`
        : coupon.type === 'fixed'
          ? `خصم ${value.toFixed(2)} ر.س`
          : 'توصيل مجاني';

    return NextResponse.json({
      success: true,
      valid: true,
      code: coupon.code,
      type: coupon.type,
      discount,
      message,
    });
  } catch (error) {
    logError('Coupon validate error:', error);
    return NextResponse.json(
      { success: false, valid: false, error: 'تعذّر التحقق من الكوبون' },
      { status: 500 },
    );
  }
}
