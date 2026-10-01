import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { normalizeSaudiToE164 } from "@/lib/phone-format";
import { isTwilioVerifyConfigured, twilioCheckVerification } from "@/lib/twilio-verify";
import {
  checkRateLimit,
  VENDOR_OTP_VERIFY_CONFIG,
  VENDOR_OTP_VERIFY_IP_CONFIG,
  createRateLimitHeaders,
} from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { isAppleReviewPhone, APPLE_REVIEW_OTP } from "@/lib/apple-review";
import {
  signVendorSessionToken,
  vendorSessionCookieOptions,
  VENDOR_SESSION_COOKIE,
  type VendorRole,
} from '@/lib/identity';
import { error as logError, info as logInfo } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/vendor/auth/otp/verify
 *
 * Phase 3 — vendor-staff OTP login (verify step).
 *
 * Flow:
 *   1. Parse + validate `{ phone, code, vendorSlug }`.
 *   2. Apple Review bypass — accept APPLE_REVIEW_OTP without Twilio.
 *   3. Per-IP + per-phone rate limits (VENDOR_OTP_VERIFY_*).
 *   4. Twilio Verify check.
 *   5. Resolve vendor by slug (404).
 *   6. Look up active vendor_staff by (vendor_id, LOWER(phone)).
 *   7. Update last_login_at; build VendorSession; sign JWT; set cookie.
 *
 * Mirrors /api/v1/auth/twilio/verify with deltas:
 *   - No user upsert — staff row MUST exist (send endpoint enforces).
 *   - Vendor-roster gate on every verify call.
 *   - Sets VENDOR_SESSION_COOKIE instead of customer cookie.
 *   - Response shape mirrors /api/v1/vendor/auth/login (line 149-163) so
 *     the UI treats both paths identically.
 */

function rateLimitResponse(
  result: { retryAfterMs?: number; remaining: number; resetAt: number },
  message: string,
  by: "phone" | "ip",
) {
  const response = NextResponse.json(
    {
      error: message,
      retryAfter: Math.ceil((result.retryAfterMs || 0) / 1000),
    },
    { status: 429 },
  );
  // Cast is safe: `result` is always a RateLimitResult at runtime.
  Object.entries(
    createRateLimitHeaders(result as unknown as Parameters<typeof createRateLimitHeaders>[0]),
  ).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  response.headers.set("X-RateLimit-By", by);
  return response;
}

export async function POST(request: NextRequest) {
  let body: { phone?: string; code?: string; vendorSlug?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const e164 = normalizeSaudiToE164(body.phone ?? "");
  const code = (body.code ?? "").trim();
  const vendorSlug = (body.vendorSlug ?? "").trim();
  if (!e164 || !code) {
    return NextResponse.json(
      { error: "أدخل رقم الجوال والرمز" },
      { status: 400 },
    );
  }
  if (!vendorSlug) {
    return NextResponse.json(
      { error: "معرّف المتجر مطلوب" },
      { status: 400 },
    );
  }

  const appleReview = isAppleReviewPhone(e164);
  if (appleReview) {
    if (code !== APPLE_REVIEW_OTP) {
      return NextResponse.json(
        {
          error: "رمز التحقق غير صحيح",
          remainingAttempts: 999,
        },
        { status: 400 },
      );
    }
    logInfo(`[vendor/auth/otp/verify] Apple Review account approved (phone=${e164})`);
  } else {
    if (!isTwilioVerifyConfigured()) {
      return NextResponse.json(
        { error: "خدمة التحقق غير مهيأة على الخادم" },
        { status: 503 },
      );
    }

    // Per-IP first — blunt code-spraying from a single IP.
    const clientIp = getClientIp(request);
    const ipLimit = await checkRateLimit(clientIp, VENDOR_OTP_VERIFY_IP_CONFIG);
    if (!ipLimit.allowed) {
      return rateLimitResponse(
        ipLimit,
        "تم تجاوز عدد محاولات التحقق من هذا الجهاز. انتظر قليلاً ثم أعد المحاولة",
        "ip",
      );
    }

    // Per-phone cap.
    const rateLimitResult = await checkRateLimit(e164, VENDOR_OTP_VERIFY_CONFIG);
    if (!rateLimitResult.allowed) {
      return rateLimitResponse(
        rateLimitResult,
        "تم تجاوز عدد محاولات التحقق. انتظر قليلاً ثم أعد المحاولة",
        "phone",
      );
    }

    let approved = false;
    try {
      approved = await twilioCheckVerification(e164, code);
    } catch {
      return NextResponse.json(
        { error: "تعذر التحقق من الرمز" },
        { status: 502 },
      );
    }

    if (!approved) {
      return NextResponse.json(
        {
          error: "رمز التحقق غير صحيح أو منتهي الصلاحية",
          remainingAttempts: rateLimitResult.remaining,
        },
        { status: 400 },
      );
    }
  }

  // OTP approved (or Apple bypass). Now resolve vendor + staff and sign
  // a session. We re-check the roster here in case the staff row was
  // deactivated between /send and /verify — defense in depth.
  try {
    const vendorResult = await query(
      "SELECT id, slug, name_ar, is_active FROM vendors WHERE slug = $1",
      [vendorSlug],
    );
    if (vendorResult.rows.length === 0) {
      return NextResponse.json(
        { error: "المتجر غير موجود" },
        { status: 404 },
      );
    }
    const vendor = vendorResult.rows[0] as {
      id: string;
      slug: string;
      name_ar: string;
      is_active: boolean;
    };
    if (!vendor.is_active) {
      return NextResponse.json(
        { error: "المتجر غير نشط حالياً" },
        { status: 403 },
      );
    }

    const localForm = `0${e164.slice(4)}`;
    const staffResult = await query(
      `SELECT id, vendor_id, email, phone, full_name_ar, full_name_en,
              role, permissions, is_active
         FROM vendor_staff
        WHERE vendor_id = $1
          AND LOWER(phone) IN (LOWER($2), LOWER($3))
        LIMIT 1`,
      [vendor.id, e164, localForm],
    );
    if (staffResult.rows.length === 0) {
      // Should not happen — /send enforces this — but if it does (e.g.
      // the staff row was hard-deleted), don't leak that the phone is
      // valid. Surface as 401 like /send.
      return NextResponse.json(
        { error: "هذا الرقم غير مربوط بأي حساب في هذا المتجر" },
        { status: 401 },
      );
    }
    const staff = staffResult.rows[0] as {
      id: string;
      vendor_id: string;
      email: string | null;
      phone: string | null;
      full_name_ar: string | null;
      full_name_en: string | null;
      role: string;
      permissions: string[] | null;
      is_active: boolean;
    };
    if (!staff.is_active) {
      return NextResponse.json(
        { error: "حسابك غير نشط، تواصل مع المالك" },
        { status: 403 },
      );
    }

    // Best-effort last_login_at update — non-fatal.
    await query("UPDATE vendor_staff SET last_login_at = NOW() WHERE id = $1", [
      staff.id,
    ]);

    const session = {
      vendorId: staff.vendor_id,
      vendorSlug: vendor.slug,
      staffId: staff.id,
      email: staff.email ?? "",
      fullName:
        staff.full_name_ar || staff.full_name_en || staff.email || staff.phone || "",
      role: staff.role as VendorRole,
      permissions: staff.permissions || [],
    };

    const token = await signVendorSessionToken(session);

    const response = NextResponse.json({
      success: true,
      user: {
        id: staff.id,
        email: staff.email,
        phone: staff.phone,
        fullName: session.fullName,
        role: staff.role,
        vendor: {
          id: vendor.id,
          slug: vendor.slug,
          name: vendor.name_ar,
        },
      },
    });

    response.cookies.set(VENDOR_SESSION_COOKIE, token, vendorSessionCookieOptions());
    return response;
  } catch (e) {
    logError("vendor OTP verify DB error", e, { vendorSlug });
    return NextResponse.json(
      { error: "حدث خطأ أثناء تسجيل الدخول" },
      { status: 500 },
    );
  }
}
