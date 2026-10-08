import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { normalizeSaudiToE164, phoneForDb } from "@/lib/phone-format";
import { isTwilioVerifyConfigured, twilioCheckVerification } from "@/lib/twilio-verify";
import {
  COOKIE_NAME,
  signCustomerToken,
  customerSessionCookieOptions,
} from "@/lib/identity";
import { mapDbUserRow } from "@/lib/identity";
import { checkRateLimit, OTP_VERIFY_CONFIG, OTP_VERIFY_IP_CONFIG, createRateLimitHeaders } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import {
  isAppleReviewPhone,
  APPLE_REVIEW_OTP,
  APPLE_REVIEW_NAME,
} from "@/lib/apple-review";
import { encryptPii, piiHmac } from "@/lib/security/pii-crypto";

import { error as logError, info as logInfo } from '@/lib/logger';

// Apple App Store review account — see src/lib/apple-review.ts.
// Accepts the configured OTP without calling Twilio (so we don't burn
// budget on a number we don't own) AND ensures the user row exists in
// the DB with name=APPLE_REVIEW_NAME so the iOS client renders a logged-
// in session — the "Continue as guest" prompt is bypassed.

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
  let body: { phone?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const e164 = normalizeSaudiToE164(body.phone ?? "");
  const code = (body.code ?? "").trim();
  if (!e164 || !code) {
    return NextResponse.json(
      { error: "أدخل رقم الجوال والرمز" },
      { status: 400 }
    );
  }

  // Apple review account: accept the configured OTP without hitting
  // Twilio. Skip rate-limit checks so QA can re-run the flow repeatedly.
  const appleReview = isAppleReviewPhone(e164);
  if (appleReview) {
    if (code !== APPLE_REVIEW_OTP) {
      return NextResponse.json(
        {
          error: "رمز التحقق غير صحيح",
          remainingAttempts: 999,
        },
        { status: 400 }
      );
    }
    logInfo(`[auth/twilio/verify] Apple Review account approved (phone=${e164})`);
  } else {
    if (!isTwilioVerifyConfigured()) {
      return NextResponse.json(
        { error: "خدمة التحقق غير مهيأة على الخادم" },
        { status: 503 }
      );
    }

    // Per-IP cap runs first to blunt code-spraying attacks where one
    // attacker rotates phones from a single IP.
    const clientIp = getClientIp(request);
    const ipLimit = await checkRateLimit(clientIp, OTP_VERIFY_IP_CONFIG);
    if (!ipLimit.allowed) {
      return rateLimitResponse(
        ipLimit,
        "تم تجاوز عدد محاولات التحقق من هذا الجهاز. انتظر قليلاً ثم أعد المحاولة",
        "ip"
      );
    }

    // Per-phone rate limiting (existing).
    const rateLimitResult = await checkRateLimit(e164, OTP_VERIFY_CONFIG);
    if (!rateLimitResult.allowed) {
      return rateLimitResponse(
        rateLimitResult,
        "تم تجاوز عدد محاولات التحقق. انتظر قليلاً ثم أعد المحاولة",
        "phone"
      );
    }

    let approved = false;
    try {
      approved = await twilioCheckVerification(e164, code);
    } catch {
      return NextResponse.json(
        { error: "تعذر التحقق من الرمز" },
        { status: 502 }
      );
    }

    if (!approved) {
      return NextResponse.json(
        {
          error: "رمز التحقق غير صحيح أو منتهي الصلاحية",
          remainingAttempts: rateLimitResult.remaining,
        },
        { status: 400 }
      );
    }
  }

  // Clear rate limit on successful verification
  const phoneDb = phoneForDb(e164);
  const client = await pool.connect();
  try {
    let row = await client.query(
      `SELECT id, phone, name, email, avatar_url, loyalty_points, loyalty_tier,
              spin_count_today, last_spin_at, created_at, updated_at,
              COALESCE(token_version, 1)::int AS token_version
       FROM users WHERE phone = $1`,
      [phoneDb]
    );

    if (row.rows.length === 0) {
      // P0-3 (security Phase 3, 2026-10-03): also write the
      // encrypted + hmac columns so the new PII-at-rest path
      // (login lookup by phone_hmac) finds this row. The plaintext
      // columns are still written for the legacy read sites that
      // have not been migrated yet — they will be removed in a
      // follow-up once every site reads the encrypted columns.
      const phoneHmac = piiHmac(phoneDb);
      const phoneEnc = encryptPii(phoneDb);

      // For the Apple review account, seed the row with the reviewer
      // name so the iOS client renders a logged-in user (no "continue
      // as guest" prompt) and the rest of the API can recognize the
      // account via isAppleReviewUser() guards.
      if (appleReview) {
        const reviewNameEnc = encryptPii(APPLE_REVIEW_NAME);
        row = await client.query(
          `INSERT INTO users (
             phone, name, loyalty_points, loyalty_tier, spin_count_today,
             phone_encrypted, phone_hmac, name_encrypted
           )
           VALUES ($1, $2, 0, 'bronze', 0, $3, $4, $5)
           RETURNING id, phone, name, email, avatar_url, loyalty_points, loyalty_tier,
                     spin_count_today, last_spin_at, created_at, updated_at,
                     COALESCE(token_version, 1)::int AS token_version`,
          [phoneDb, APPLE_REVIEW_NAME, phoneEnc, phoneHmac, reviewNameEnc]
        );
      } else {
        row = await client.query(
          `INSERT INTO users (
             phone, loyalty_points, loyalty_tier, spin_count_today,
             phone_encrypted, phone_hmac
           )
           VALUES ($1, 0, 'bronze', 0, $2, $3)
           RETURNING id, phone, name, email, avatar_url, loyalty_points, loyalty_tier,
                     spin_count_today, last_spin_at, created_at, updated_at,
                     COALESCE(token_version, 1)::int AS token_version`,
          [phoneDb, phoneEnc, phoneHmac]
        );
      }
    } else if (appleReview) {
      // If the row exists but the name is missing or different (e.g.
      // a stale test row), backfill the reviewer name so subsequent
      // /api/v1/auth/me returns the canonical sentinel. P0-3 also
      // updates the encrypted name column if it was never set.
      const existingName = row.rows[0].name;
      if (existingName !== APPLE_REVIEW_NAME) {
        const reviewNameEnc = encryptPii(APPLE_REVIEW_NAME);
        await client.query(
          `UPDATE users SET name = $1, name_encrypted = $2, updated_at = now() WHERE id = $3`,
          [APPLE_REVIEW_NAME, reviewNameEnc, row.rows[0].id]
        );
        row = await client.query(
          `SELECT id, phone, name, email, avatar_url, loyalty_points, loyalty_tier,
                  spin_count_today, last_spin_at, created_at, updated_at,
                  COALESCE(token_version, 1)::int AS token_version
             FROM users WHERE id = $1`,
          [row.rows[0].id]
        );
      }
    }

    const u = row.rows[0];
    const user = mapDbUserRow(u);

    const token = await signCustomerToken({
      userId: user.id,
      phone: user.phone,
      // SECURITY (PCP-144): bake the live token_version into the JWT
      // so the verify path (auth-helpers.ts) can detect bumps on the
      // next request after a logout / password rotation.
      tokenVersion: (u as { token_version?: number }).token_version ?? 1,
    });

    const res = NextResponse.json({ success: true, user });
    res.cookies.set(COOKIE_NAME, token, customerSessionCookieOptions());
    return res;
  } catch (err) {
    logError("twilio verify user error:", err);
    return NextResponse.json({ error: "حدث خطأ أثناء تسجيل الدخول" }, { status: 500 });
  } finally {
    client.release();
  }
}
