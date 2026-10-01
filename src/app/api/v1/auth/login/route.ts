import { rateLimitExceededResponse } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { isLegacyPhoneOtpAllowed } from "@/lib/env";
import crypto from "crypto";
import {
  checkRateLimit,
  LOGIN_LEGACY_CONFIG,
  LOGIN_LEGACY_IP_CONFIG,
  createRateLimitHeaders,
} from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { isAppleReviewPhone } from "@/lib/apple-review";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

/**
 * Generate a cryptographically secure OTP code
 * @param length - Number of digits (default: 4)
 */
function generateSecureOTP(length: number = 4): string {
  // Generate a secure random number and format as zero-padded string
  const randomBytes = crypto.randomBytes(4);
  const randomNumber = randomBytes.readUInt32BE(0);
  const max = Math.pow(10, length);
  const otp = randomNumber % max;
  return otp.toString().padStart(length, "0");
}

/**
 * Hash an OTP code for secure storage
 */
function hashOTP(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

/**
 * Mask a phone number so log lines never expose a full E.164 string.
 * Keeps country code + last 2 digits so support can still correlate.
 */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return `***${digits.slice(-2)}`;
  return `***${digits.slice(-4)}`;
}

export async function POST(request: NextRequest) {
  if (!isLegacyPhoneOtpAllowed()) {
    return NextResponse.json({ error: "غير متوفر" }, { status: 404 });
  }

  const { phone, name, email } = await request.json();

  if (!phone) {
    return NextResponse.json({ error: 'رقم الجوال مطلوب' }, { status: 400 });
  }

  // Validate phone number format (basic validation)
  const phoneRegex = /^[+]?[\d\s-]{9,15}$/;
  if (!phoneRegex.test(phone)) {
    return NextResponse.json({ error: 'رقم الجوال غير صحيح' }, { status: 400 });
  }

  // Rate limit gates — Apple review account exempted (re-runs the flow
  // repeatedly during a single review session). Per-IP first to blunt
  // enumeration, then per-phone.
  const appleReviewBypass = isAppleReviewPhone(
    phone.startsWith("+") ? phone : `+966${phone.replace(/^0/, "")}`
  );
  const clientIp = getClientIp(request);
  const ipLimit = await checkRateLimit(clientIp, LOGIN_LEGACY_IP_CONFIG);
  if (!ipLimit.allowed && !appleReviewBypass) {
    return rateLimitExceededResponse(
      ipLimit,
      "تم تجاوز عدد محاولات تسجيل الدخول من هذا الجهاز. انتظر قليلاً ثم أعد المحاولة",
      "ip"
    );
  }
  const phoneLimit = await checkRateLimit(phone, LOGIN_LEGACY_CONFIG);
  if (!phoneLimit.allowed && !appleReviewBypass) {
    return rateLimitExceededResponse(
      phoneLimit,
      "تم تجاوز عدد محاولات تسجيل الدخول. انتظر قليلاً ثم أعد المحاولة",
      "phone"
    );
  }

  const client = await pool.connect();

  try {
    // SECURITY (enumeration): both the "user exists" and "new user"
    // branches must touch the database the same number of times and in
    // the same order, so response timing cannot be used to determine
    // whether a phone number is already registered. We:
    //   1. Upsert (no-op if row exists, insert otherwise) — always one op.
    //   2. SELECT the row by phone — always one op.
    // Both branches now perform exactly two queries; previously the
    // new-user path did a SELECT + INSERT, leaking ~1 INSERT's latency.
    // The `users` table has a PARTIAL unique index `uniq_users_phone_active`
    // on `(phone) WHERE deleted_at IS NULL` (lets soft-deleted users
    // re-register their phone). A plain `ON CONFLICT (phone)` would fail
    // with `there is no unique or exclusion constraint matching the ON
    // CONFLICT specification`. We must mirror the WHERE clause in the
    // conflict target so Postgres routes the upsert to the partial index.
    await client.query(
      `INSERT INTO users (phone, name, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone) WHERE deleted_at IS NULL DO NOTHING`,
      [phone, name || null, email || null]
    );
    const userCheck = await client.query(
      'SELECT id, phone, name FROM users WHERE phone = $1 AND deleted_at IS NULL',
      [phone]
    );
    const userId: string = userCheck.rows[0]?.id;
    if (!userId) {
      // Should never happen — the upsert above guarantees the row exists.
      return NextResponse.json({ error: 'تعذر إنشاء الحساب' }, { status: 500 });
    }

    // Generate cryptographically secure OTP code
    const otpCode = generateSecureOTP(4);

    // Hash the OTP before storing (security)
    const hashedOTP = hashOTP(otpCode);

    // Store OTP (expires in 5 minutes)
    await client.query(
      `INSERT INTO user_otps (user_id, code, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '5 minutes')
       ON CONFLICT (user_id) DO UPDATE SET
         code = EXCLUDED.code,
         expires_at = NOW() + INTERVAL '5 minutes'`,
      [userId, hashedOTP]
    );

    // SECURITY (H5): never log OTPs in plaintext. Local development may
    // opt-in via `ALLOW_DEV_OTP_LOG=1` — otherwise the code only logs the
    // masked phone suffix and a non-secret correlation id. This prevents
    // a leaked prod log (or a mis-deployed staging env) from exposing
    // 2FA codes that grant full account takeover.
    if (process.env.ALLOW_DEV_OTP_LOG === "1") {
      logWarn(
        `[DEV-OTP-LOG-ENABLED] phone=${maskPhone(phone)} otp=${otpCode}`
      );
    } else {
      logInfo(`[auth/login] OTP issued for ${maskPhone(phone)} (userId=${userId})`);
    }

    const response = NextResponse.json({
      success: true,
      message: 'تم إرسال رمز التحقق',
      requireVerification: true,
      userId,
    });
    Object.entries(createRateLimitHeaders(phoneLimit)).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;

  } catch (error) {
    logError('Auth error:', error);
    return NextResponse.json({ error: 'حدث خطأ في المصادقة' }, { status: 500 });
  } finally {
    client.release();
  }
}