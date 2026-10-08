import { NextRequest, NextResponse } from "next/server";
import { normalizeSaudiToE164 } from "@/lib/phone-format";
import { isTwilioVerifyConfigured, twilioSendVerification } from "@/lib/twilio-verify";
import {
  checkRateLimit,
  OTP_SEND_CONFIG,
  OTP_SEND_IP_CONFIG,
  createRateLimitHeaders,
} from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import {
  isAppleReviewPhone,
  APPLE_REVIEW_OTP,
  APPLE_REVIEW_NAME,
} from "@/lib/apple-review";

// Apple App Store review account — see src/lib/apple-review.ts for full
// rationale. When the reviewer hits /send on their device, we short-
// circuit the Twilio call AND the rate limit so the reviewer can keep
// re-running the flow during a session. Twilio fraud-blocks numbers
// we don't own, so calling Verify would fail anyway.
function rateLimitResponse(
  result: { retryAfterMs?: number; remaining: number; resetAt: number },
  message: string,
  by: "phone" | "ip"
) {
  const response = NextResponse.json(
    {
      error: message,
      retryAfter: Math.ceil((result.retryAfterMs || 0) / 1000),
    },
    { status: 429 }
  );
  Object.entries(createRateLimitHeaders(result as any)).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  response.headers.set("X-RateLimit-By", by);
  return response;
}

export async function POST(request: NextRequest) {
  if (!isTwilioVerifyConfigured()) {
    return NextResponse.json(
      { error: "خدمة التحقق غير مهيأة على الخادم" },
      { status: 503 }
    );
  }

  let body: { phone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const e164 = normalizeSaudiToE164(body.phone ?? "");
  if (!e164) {
    return NextResponse.json(
      { error: "رقم الجوال غير صالح (مثال: 5XXXXXXXX)" },
      { status: 400 }
    );
  }

  // Apple review account: skip Twilio + skip both per-IP and per-phone
  // rate-limit gates. Returns a synthetic Verification so the client
  // renders the OTP entry screen and the fixed OTP can be entered.
  // The actual OTP validation happens in /twilio/verify.
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

  // Per-IP limit runs first so cost-amplification attacks (rotating
  // phones from one IP) get blocked before Twilio is called.
  const clientIp = getClientIp(request);
  const ipLimit = await checkRateLimit(clientIp, OTP_SEND_IP_CONFIG);
  if (!ipLimit.allowed) {
    return rateLimitResponse(
      ipLimit,
      "تم تجاوز عدد محاولات الإرسال من هذا الجهاز. انتظر قليلاً ثم أعد المحاولة",
      "ip"
    );
  }

  // Per-phone limit (the existing one). Distinct bucket from the IP
  // limit because the two `keyPrefix`es differ.
  const rateLimitResult = await checkRateLimit(e164, OTP_SEND_CONFIG);
  if (!rateLimitResult.allowed) {
    return rateLimitResponse(
      rateLimitResult,
      "تم تجاوز عدد محاولات الإرسال. انتظر قليلاً ثم أعد المحاولة",
      "phone"
    );
  }

  try {
    const verification = await twilioSendVerification(e164);

    // يُعاد جسم استجابة Twilio كما هو لتسهيل التشخيص من جهة العميل.
    // عند تفعيل Debugger في خدمة Verify، يحتوي send_code_attempts[].code
    // على رمز التحقق الفعلي المُرسَل عبر SMS (وإلا يكون الحقل غائباً).
    const debugCode = verification.send_code_attempts?.find(
      (a) => typeof a?.code === "string" && a.code.length > 0
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

    Object.entries(createRateLimitHeaders(rateLimitResult)).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "twilio_not_configured") {
      return NextResponse.json(
        { error: "خدمة التحقق غير مهيأة" },
        { status: 503 }
      );
    }
    // Twilio Verify error codes — see https://www.twilio.com/docs/errors
    // 60410: Twilio blocked this number for fraud-reasons. Common when
    // the same number has been hammered by automated tests (the QA
    // review account, for instance). Twilio's block is on their side;
    // we can only surface a clear message. If this fires on a real
    // customer's number, support must contact Twilio to unblock.
    if (msg.includes(":60410")) {
      return NextResponse.json(
        {
          error:
            "تم حظر هذا الرقم من مزوّد الرسائل. استخدم رقماً آخر أو انتظر بضع ساعات.",
          cause: "twilio_60410_blocked",
        },
        { status: 403 }
      );
    }
    if (msg.includes(":21608") || msg.includes(":60200") || msg.includes(":60238")) {
      // 21608: unverified caller/recipient on trial account
      // 60200: geographic permissions / invalid "To" parameter
      // 60238: Verification Creation Attempt blocked by Twilio
      //        (Geo Permissions / fraud / regulatory block — same
      //        resolution path: tell the operator to enable the country
      //        in Twilio Console → Verify → Services → Geo Permissions)
      return NextResponse.json(
        {
          error:
            "رقم الجوال غير مُفعَّل في حساب Twilio. جرّب رقماً مُحققاً في لوحة Twilio أو تحقّق من إعدادات Geo Permissions",
        },
        { status: 400 }
      );
    }
    if (msg.includes(":60203")) {
      // 60203: max sends per service exceeded — this is a Twilio-side
      // quota issue, not a client-side rate limit. Surface it so QA
      // understands the cause (the review account exemption on the
      // in-memory rate limit is irrelevant when Twilio is rejecting).
      return NextResponse.json(
        {
          error:
            "تم تجاوز حد الإرسال من مزوّد الرسائل. انتظر بضع دقائق ثم حاول مرة أخرى",
          cause: "twilio_60203",
        },
        { status: 429 }
      );
    }
    if (msg.includes(":21610") || msg.includes(":21611")) {
      // 21610: recipient unsubscribed / 21611: SMS service not configured
      return NextResponse.json(
        { error: "المستلم غير مشترك في خدمة الرسائل أو خدمة SMS غير مهيأة" },
        { status: 400 }
      );
    }
    if (msg.includes(":21612") || msg.includes(":21635")) {
      // 21612: not a valid mobile number / 21635: landline cannot receive SMS
      return NextResponse.json(
        { error: "رقم الجوال غير صالح أو خط أرضي. أدخل رقم جوال سعودي" },
        { status: 400 }
      );
    }
    if (msg.includes(":20404") || msg.includes(":20429")) {
      // 20404/20429: rate-limit from Twilio (per-service throttle)
      return NextResponse.json(
        { error: "تم تجاوز حد الإرسال من Twilio. حاول بعد دقيقة" },
        { status: 429 }
      );
    }
    if (msg.includes(":20003")) {
      // 20003: authentication error — account suspended or invalid credentials
      return NextResponse.json(
        { error: "بيانات اعتماد Twilio غير صالحة أو الحساب معلّق" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "تعذر إرسال رمز التحقق. حاول لاحقاً" },
      { status: 502 }
    );
  }
}
