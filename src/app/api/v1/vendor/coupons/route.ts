import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireVendorRole } from "@/lib/identity";
import { verifyVendorRequestWithDb } from "@/lib/identity/vendor-auth-with-db";
import crypto from "crypto";

import { error as logError } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";

// SECURITY (PCP-148): per-vendor cap on coupon creation. Manager+
// scope is required, but a malicious manager (or one with a stolen
// session) could spam coupons to fill the vendor_coupons table or
// poison customer carts with colliding codes. 30/hour per vendor.
const VENDOR_COUPON_CREATE_CONFIG = {
  maxRequests: 30,
  windowMs: 60 * 60 * 1000,
  keyPrefix: "vendor:coupon:create",
} as const;

function generateCouponCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

export async function GET(request: Request) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const result = await query(
      `SELECT id, code, discount_type, discount_value, min_order, max_uses, current_uses, valid_from, valid_until, is_active, created_at
       FROM vendor_coupons
       WHERE vendor_id = $1
       ORDER BY created_at DESC`,
      [session.vendorId]
    );

    const coupons = result.rows.map((c) => ({
      id: c.id,
      code: c.code,
      discountType: c.discount_type,
      discountValue: parseFloat(c.discount_value),
      minOrder: c.min_order ? parseFloat(c.min_order) : null,
      maxUses: c.max_uses,
      currentUses: c.current_uses,
      validFrom: c.valid_from,
      validUntil: c.valid_until,
      isActive: c.is_active,
      createdAt: c.created_at,
    }));

    return NextResponse.json({ coupons });
  } catch (error) {
    logError("Get coupons error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في جلب الكوبونات" },
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

    // SECURITY (PCP-148): per-vendor rate limit on coupon POST.
    const createLimit = await checkRateLimit(
      `vendor:${session.vendorId}`,
      VENDOR_COUPON_CREATE_CONFIG,
    );
    if (!createLimit.allowed) {
      return NextResponse.json(
        { error: "تجاوزت عدد العمليات، حاول لاحقاً" },
        { status: 429 },
      );
    }

    const body = await request.json();
    const {
      code, discountType, discountValue,
      minOrder, maxUses, validFrom, validUntil
    } = body;

    if (!discountType || !discountValue) {
      return NextResponse.json(
        { error: "نوع وقيمة الخصم مطلوبان" },
        { status: 400 }
      );
    }

    if (!["percent", "fixed"].includes(discountType)) {
      return NextResponse.json(
        { error: "نوع الخصم غير صالح" },
        { status: 400 }
      );
    }

    if (discountType === "percent" && (discountValue < 1 || discountValue > 100)) {
      return NextResponse.json(
        { error: "نسبة الخصم يجب أن تكون بين 1% و 100%" },
        { status: 400 }
      );
    }

    // Generate code if not provided
    const couponCode = code || generateCouponCode();

    // Check if code exists
    const existing = await query(
      "SELECT id FROM vendor_coupons WHERE vendor_id = $1 AND UPPER(code) = UPPER($2)",
      [session.vendorId, couponCode]
    );

    if (existing.rows.length > 0) {
      return NextResponse.json(
        { error: "كود الكوبون موجود مسبقاً" },
        { status: 400 }
      );
    }

    const result = await query(
      `INSERT INTO vendor_coupons
        (vendor_id, code, discount_type, discount_value, min_order, max_uses, valid_from, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, code, discount_type, discount_value, min_order, max_uses, current_uses, valid_from, valid_until, is_active, created_at`,
      [
        session.vendorId, couponCode, discountType, discountValue,
        minOrder || null, maxUses || null,
        validFrom || null, validUntil || null
      ]
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
    logError("Create coupon error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في إنشاء الكوبون" },
      { status: 500 }
    );
  }
}
