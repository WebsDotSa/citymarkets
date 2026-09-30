import { rateLimitExceededResponse } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { normalizeSaudiToE164 } from "@/lib/phone-format";
import { isTwilioVerifyConfigured, twilioSendVerification } from "@/lib/twilio-verify";
import {
  checkRateLimit,
  VENDOR_OTP_SEND_CONFIG,
  VENDOR_OTP_SEND_IP_CONFIG,
  createRateLimitHeaders,
} from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import {
  isAppleReviewPhone,
  APPLE_REVIEW_OTP,
  APPLE_REVIEW_NAME,
} from "@/lib/apple-review";
import { error as logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/vendor/auth/otp/send
 *
 * Phase 3 — vendor-staff OTP login (send step).
 *
 * Flow:
 *   1. Validate phone is Saudi E.164 (400 if not).
 *   2. Apple Review bypass — synthetic sid so /verify accepts APPLE_REVIEW_OTP.
 *      Skips DB lookup + rate limits so QA can re-run the flow freely.
 *   3. Per-IP rate limit (cost-amplification block) — runs before DB so a
 *      rotating-phone attack can't burn vendor-roster lookups.
 *   4. Per-phone rate limit.
 *   5. Resolve vendor by slug (404 if missing).
 *   6. Look up active vendor_staff by (vendor_id, LOWER(phone)).
 *      401 on miss — don't leak the vendor roster.
 *      403 on inactive.
 *   7. Twilio Verify send.
 *
 * Mirrors /api/v1/auth/twilio/send with three deltas:
 *   - Body shape is `{ phone, vendorSlug }` (no email).
 *   - Vendor-roster gate (step 6) — customer OTP upserts users; vendor
 *     staff are manually provisioned so we must check before burning
 *     Twilio budget.
 *   - Separate rate-limit bucket (VENDOR_OTP_SEND_*) so customer-OTP
 *     abuse can't starve vendor login.
 */

export async function POST(request: NextRequest) {
  if (!isTwilioVerifyConfigured()) {
    return NextResponse.json(
      { error: "خدمة التحقق غير مهيأة على الخادم" },
      { status: 503 },
    );
  }

  let body: { phone?: string; vendorSlug?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const e164 = normalizeSaudiToE164(body.phone ?? "");
  if (!e164) {
    return NextResponse.json(
      { error: "رقم الجوال غير صالح (مثال: 5XXXXXXXX)" },
      { status: 400 },
    );
  }

  const vendorSlug = (body.vendorSlug ?? "").trim();
  if (!vendorSlug) {
    return NextResponse.json(
      { error: "معرّف المتجر مطلوب" },
      { status: 400 },
    );
  }

  // Apple Review bypass — same logic as customer OTP /send. The reviewer
  // never hits the real Twilio path, so the bypass applies here too. We
  // skip BOTH rate limits and the DB lookup; /verify is what enforces
  // the vendor-staff row exists for the actual login.
  if (isAppleReviewPhone(e164)) {
    return NextResponse.json({
      success: true,
      remainingAttempts: 999,
      twilio: {
        sid: "APPLE_REVIEW_BYPASS",
        to: e164,
        channel: "sms",
        status: "pending",
        valid: true,
        sendCodeAttempts: [
          { channel: "sms", attempt_sid: "APPLE_REVIEW_BYPASS" },
        ],
        code: APPLE_REVIEW_OTP,
        message: `[APPLE_REVIEW] رمز التحقق الثابت: ${APPLE_REVIEW_OTP}`,
        dev: true,
        reviewerName: APPLE_REVIEW_NAME,
      },
    });
  }

  // Per-IP cap runs first (cheap to evaluate, blocks rotating-phone
  // cost-amplification before any DB lookup).
  const clientIp = getClientIp(request);
  const ipLimit = await checkRateLimit(clientIp, VENDOR_OTP_SEND_IP_CONFIG);
  if (!ipLimit.allowed) {
    return rateLimitExceededResponse(
      ipLimit,
      "تم تجاوز عدد محاولات الإرسال من هذا الجهاز. انتظر قليلاً ثم أعد المحاولة",
      "ip",
    );
  }

  // Per-phone cap (independent prefix).
  const rateLimitResult = await checkRateLimit(e164, VENDOR_OTP_SEND_CONFIG);
  if (!rateLimitResult.allowed) {
    return rateLimitExceededResponse(
      rateLimitResult,
      "تم تجاوز عدد محاولات الإرسال. انتظر قليلاً ثم أعد المحاولة",
      "phone",
    );
  }

  // Vendor-roster gate — must run BEFORE Twilio so we don't burn budget
  // on phones that don't correspond to any staff row.
  try {
    const vendorResult = await query(
      "SELECT id, slug, is_active FROM vendors WHERE slug = $1",
      [vendorSlug],
    );
    if (vendorResult.rows.length === 0) {
      return NextResponse.json(
        { error: "المتجر غير موجود" },
        { status: 404 },
      );
    }
    const vendor = vendorResult.rows[0] as { id: string; is_active: boolean };
    if (!vendor.is_active) {
      return NextResponse.json(
        { error: "المتجر غير نشط حالياً" },
        { status: 403 },
      );
    }

    // Indexed lookup via idx_vendor_staff_vendor_phone_ci. Don't reveal
    // whether the phone or the staff match failed — collapse to a single
    // 401 so a probe can't enumerate the staff roster.
    //
    // Match BOTH the E.164 and the local 05XXXXXXXX form because the
    // vendor_staff table historically stores phones in local form
    // (`0534800122`), not E.164 (`+966534800122`). Comparing both forms
    // lets the lookup work regardless of which format a given row has,
    // without forcing a one-off data migration in this phase.
    const localForm = `0${e164.slice(4)}`;
    const staffResult = await query(
      `SELECT id, is_active
         FROM vendor_staff
        WHERE vendor_id = $1
          AND LOWER(phone) IN (LOWER($2), LOWER($3))
        LIMIT 1`,
      [vendor.id, e164, localForm],
    );
    if (staffResult.rows.length === 0) {
      return NextResponse.json(
        { error: "هذا الرقم غير مربوط بأي حساب في هذا المتجر" },
        { status: 401 },
      );
    }
    const staff = staffResult.rows[0] as { is_active: boolean };
    if (!staff.is_active) {
      return NextResponse.json(
        { error: "حسابك غير نشط، تواصل مع المالك" },
        { status: 403 },
      );
    }
  } catch (e) {
    logError("vendor OTP send DB error", e, { vendorSlug });
    return NextResponse.json(
      { error: "تعذر التحقق من بيانات المتجر" },
      { status: 500 },
    );
  }

  try {
    const verification = await twilioSendVerification(e164);

    // Surface the actual OTP code in dev (matches customer /send behavior).
    const debugCode = verification.send_code_attempts?.find(
      (a) => typeof a?.code === "string" && a.code.length > 0,
    )?.code;

    const response = NextResponse.json({
      success: true,
      remainingAttempts: rateLimitResult.remaining,
      twilio: {
        sid: verification.sid,
        to: verification.to,
        channel: verification.channel,
        status: verification.status,
        valid: verification.valid,
        sendCodeAttempts: verification.send_code_attempts,
        ...(debugCode
          ? { code: debugCode, message: `[DEBUG] رمز التحقق: ${debugCode}` }
          : {}),
      },
    });

    Object.entries(createRateLimitHeaders(rateLimitResult)).forEach(
      ([key, value]) => {
        response.headers.set(key, String(value));
      },
    );

    return response;
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "twilio_not_configured") {
      return NextResponse.json(
        { error: "خدمة التحقق غير مهيأة" },
        { status: 503 },
      );
    }
    // Twilio error codes — same mapping as customer /send.
    if (msg.includes(":60410")) {
      return NextResponse.json(
        {
          error:
            "تم حظر هذا الرقم من مزوّد الرسائل. استخدم رقماً آخر أو انتظر بضع ساعات.",
          cause: "twilio_60410_blocked",
        },
        { status: 403 },
      );
    }
    if (msg.includes(":21608") || msg.includes(":60200")) {
      return NextResponse.json(
        {
          error:
            "رقم الجوال غير مُفعَّل في حساب Twilio. جرّب رقماً مُحققاً في لوحة Twilio أو تحقّق من إعدادات Geo Permissions",
        },
        { status: 400 },
      );
    }
    if (msg.includes(":60203")) {
      return NextResponse.json(
        {
          error:
            "تم تجاوز حد الإرسال من مزوّد الرسائل. انتظر بضع دقائق ثم حاول مرة أخرى",
          cause: "twilio_60203",
        },
        { status: 429 },
      );
    }
    if (msg.includes(":21610") || msg.includes(":21611")) {
      return NextResponse.json(
        { error: "المستلم غير مشترك في خدمة الرسائل أو خدمة SMS غير مهيأة" },
        { status: 400 },
      );
    }
    if (msg.includes(":21612") || msg.includes(":21635")) {
      return NextResponse.json(
        { error: "رقم الجوال غير صالح أو خط أرضي. أدخل رقم جوال سعودي" },
        { status: 400 },
      );
    }
    if (msg.includes(":20404") || msg.includes(":20429")) {
      return NextResponse.json(
        { error: "تم تجاوز حد الإرسال من Twilio. حاول بعد دقيقة" },
        { status: 429 },
      );
    }
    if (msg.includes(":20003")) {
      return NextResponse.json(
        { error: "بيانات اعتماد Twilio غير صالحة أو الحساب معلّق" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "تعذر إرسال رمز التحقق. حاول لاحقاً" },
      { status: 502 },
    );
  }
}
