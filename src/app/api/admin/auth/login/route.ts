import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import {
  signAdminSessionToken,
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
} from '@/lib/identity';
import type { AdminRole } from '@/lib/admin-types';
import { checkRateLimit, ADMIN_LOGIN_CONFIG, ADMIN_LOGIN_IP_CONFIG, OTP_VERIFY_CONFIG, OTP_VERIFY_IP_CONFIG, OTP_SEND_CONFIG, OTP_SEND_IP_CONFIG, createRateLimitHeaders } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { normalizeSaudiToE164, phoneForDb } from '@/lib/phone-format';
import { adminLoginInputSchema } from '@/lib/validation/admin';
import {
  isTwilioVerifyConfigured,
  twilioCheckVerification,
  twilioSendVerification,
} from '@/lib/twilio-verify';

import { error as logError } from '@/lib/logger';

/**
 * POST /api/admin/auth/login
 *
 * Two login surfaces, dispatched by which fields the client submits:
 *
 *   1. Password flow (legacy / default):
 *        { email|username, password }
 *      Resolves the admin row by email and verifies bcrypt hash.
 *
 *   2. Phone + OTP flow:
 *        { phone, code }      — verifies a Twilio code
 *        { phone }             — sends a new code (re-routes to Twilio Verify)
 *
 * Phone is REQUIRED on every admin row (see migration
 * 063_admin_vendor_phone_and_more_types.sql); the OTP path reads from
 * the unique `idx_admin_users_phone_ci` index.
 */
export async function POST(request: NextRequest) {
  try {
    // M1 (PCP-101 dogfood): guard against empty / non-JSON bodies. Some
    // older admin clients (or curl probes) POST form-encoded bodies with
    // Content-Type: application/x-www-form-urlencoded, which causes
    // request.json() to throw "Unexpected token... in JSON". Catch and
    // return a 400 with a clear Arabic message instead of a 500.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'صيغة البيانات المرسلة غير صالحة' },
        { status: 400 },
      );
    }
    const parsed = adminLoginInputSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { success: false, error: first?.message || 'بيانات الدخول غير صالحة' },
        { status: 400 }
      );
    }
    const input = parsed.data;
    const clientIp = getClientIp(request);

    // ──────────────────────────────────────────────────────────────────
    // Flow A: phone + code → verify Twilio OTP
    // ──────────────────────────────────────────────────────────────────
    if (input.phone && input.code) {
      const e164 = normalizeSaudiToE164(input.phone);
      if (!e164) {
        return NextResponse.json(
          { success: false, error: 'رقم الجوال غير صالح' },
          { status: 400 }
        );
      }

      // Per-IP cap first (mirrors customer OTP endpoint).
      const ipLimit = await checkRateLimit(clientIp, OTP_VERIFY_IP_CONFIG);
      if (!ipLimit.allowed) {
        const response = NextResponse.json(
          { success: false, error: 'تجاوزت عدد المحاولات من هذا الجهاز. انتظر قليلاً ثم أعد المحاولة.' },
          { status: 429 }
        );
        Object.entries(createRateLimitHeaders(ipLimit)).forEach(([k, v]) => response.headers.set(k, v));
        response.headers.set('X-RateLimit-By', 'ip');
        return response;
      }
      const phoneLimit = await checkRateLimit(e164, OTP_VERIFY_CONFIG);
      if (!phoneLimit.allowed) {
        const response = NextResponse.json(
          { success: false, error: 'تجاوزت عدد محاولات هذا الرقم. انتظر قليلاً ثم أعد المحاولة.' },
          { status: 429 }
        );
        Object.entries(createRateLimitHeaders(phoneLimit)).forEach(([k, v]) => response.headers.set(k, v));
        response.headers.set('X-RateLimit-By', 'phone');
        return response;
      }

      if (!isTwilioVerifyConfigured()) {
        return NextResponse.json(
          { success: false, error: 'التحقق عبر الجوال غير مهيأ — استخدم البريد وكلمة المرور.' },
          { status: 503 }
        );
      }

      let approved = false;
      try {
        approved = await twilioCheckVerification(e164, input.code);
      } catch (e) {
        logError('Twilio admin OTP check failed', e, { e164: e164.slice(-4) });
        return NextResponse.json(
          { success: false, error: 'تعذر التحقق من الرمز' },
          { status: 502 }
        );
      }
      if (!approved) {
        return NextResponse.json(
          { success: false, error: 'رمز التحقق غير صحيح أو منتهي الصلاحية' },
          { status: 401 }
        );
      }

      // Lookup the admin row by normalized phone.
      const phoneDb = phoneForDb(e164);
      // SECURITY (PCP-144): also SELECT token_version so we can bake
      // the current value into the JWT claim. The DB-backed verify path
      // (see admin-api-auth-db.ts) compares the claim against the live
      // row to detect logout/password rotations/demotions.
      const result = await query(
        `SELECT id, name, email, phone, role, is_active,
                COALESCE(token_version, 1)::int AS token_version
           FROM admin_users
          WHERE LOWER(phone) = LOWER($1) AND is_active = true`,
        [phoneDb]
      );
      if (result.rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'لا يوجد حساب مرتبط بهذا الرقم، أو لم يتم تفعيله بعد' },
          { status: 403 }
        );
      }
      return finalizeAdminLogin(request, result.rows[0]);
    }

    // ──────────────────────────────────────────────────────────────────
    // Flow A2: phone only → send Twilio OTP
    // ──────────────────────────────────────────────────────────────────
    if (input.phone && !input.code) {
      const e164 = normalizeSaudiToE164(input.phone);
      if (!e164) {
        return NextResponse.json(
          { success: false, error: 'رقم الجوال غير صالح' },
          { status: 400 }
        );
      }
      if (!isTwilioVerifyConfigured()) {
        return NextResponse.json(
          { success: false, error: 'التحقق عبر الجوال غير مهيأ' },
          { status: 503 }
        );
      }

      // SECURITY: this step is unauthenticated, so without caps anyone
      // could make us send unlimited SMS to arbitrary numbers (cost +
      // harassment). Cap per IP and per number, mirroring customer OTP.
      const sendIpLimit = await checkRateLimit(clientIp, OTP_SEND_IP_CONFIG);
      const sendPhoneLimit = sendIpLimit.allowed
        ? await checkRateLimit(`admin:${e164}`, OTP_SEND_CONFIG)
        : sendIpLimit;
      if (!sendIpLimit.allowed || !sendPhoneLimit.allowed) {
        const limit = sendIpLimit.allowed ? sendPhoneLimit : sendIpLimit;
        const response = NextResponse.json(
          { success: false, error: 'تجاوزت عدد محاولات إرسال الرمز. انتظر قليلاً ثم أعد المحاولة.' },
          { status: 429 }
        );
        Object.entries(createRateLimitHeaders(limit)).forEach(([k, v]) => response.headers.set(k, v));
        response.headers.set('X-RateLimit-By', sendIpLimit.allowed ? 'phone' : 'ip');
        return response;
      }

      // Only text numbers that belong to an active staff account. The
      // response body is identical either way. To also close the
      // timing side-channel (the Twilio call adds 200-600ms), the
      // "no staff" branch sleeps for the average observed Twilio
      // round-trip so an attacker cannot enumerate active admin
      // phones by measuring response time.
      const staff = await query(
        `SELECT 1 FROM admin_users WHERE LOWER(phone) = LOWER($1) AND is_active = true LIMIT 1`,
        [phoneForDb(e164)]
      );

      if (staff.rows.length === 0) {
        // Match the Twilio round-trip window so the two branches are
        // indistinguishable by response time. The body is the same as
        // the success path, so neither the timing nor the body leaks
        // whether the phone belongs to a staff account.
        await new Promise((resolve) => setTimeout(resolve, 450));
        return NextResponse.json({
          success: true,
          step: 'otp_sent',
          message: 'تم إرسال رمز التحقق إلى رقمك',
        });
      }

      try {
        await twilioSendVerification(e164);
      } catch (e) {
        logError('Twilio admin OTP send failed', e, { e164: e164.slice(-4) });
        return NextResponse.json(
          { success: false, error: 'تعذر إرسال رمز التحقق' },
          { status: 502 }
        );
      }
      return NextResponse.json({
        success: true,
        step: 'otp_sent',
        message: 'تم إرسال رمز التحقق إلى رقمك',
      });
    }

    // ──────────────────────────────────────────────────────────────────
    // Flow B: email + password (legacy)
    // ──────────────────────────────────────────────────────────────────
    const identifier = (input.email || input.username || '').trim();
    if (!identifier || !input.password) {
      return NextResponse.json(
        { success: false, error: 'البريد الإلكتروني وكلمة المرور مطلوبان' },
        { status: 400 }
      );
    }

    const emailRateLimit = await checkRateLimit(identifier.toLowerCase(), ADMIN_LOGIN_CONFIG);
    if (!emailRateLimit.allowed) {
      const response = NextResponse.json(
        { success: false, error: 'تجاوزت عدد المحاولات. انتظر 15 دقيقة ثم حاول مجدداً.' },
        { status: 429 }
      );
      Object.entries(createRateLimitHeaders(emailRateLimit)).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
      response.headers.set('X-RateLimit-By', 'email');
      return response;
    }

    const ipRateLimit = await checkRateLimit(clientIp, ADMIN_LOGIN_IP_CONFIG);
    if (!ipRateLimit.allowed) {
      const response = NextResponse.json(
        { success: false, error: 'تجاوزت عدد المحاولات. انتظر 15 دقيقة ثم حاول مجدداً.' },
        { status: 429 }
      );
      Object.entries(createRateLimitHeaders(ipRateLimit)).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
      response.headers.set('X-RateLimit-By', 'ip');
      return response;
    }

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    const lookup = isEmail
      ? await query(
          // SECURITY (PCP-144): include token_version so we can bake it
          // into the JWT. Compare happens on every verify.
          'SELECT id, name, email, phone, password_hash, role, is_active, COALESCE(token_version, 1)::int AS token_version FROM admin_users WHERE LOWER(email) = LOWER($1)',
          [identifier]
        )
      : await query(
          // SECURITY (PCP-144): include token_version so we can bake it
          // into the JWT. Compare happens on every verify.
          'SELECT id, name, email, phone, password_hash, role, is_active, COALESCE(token_version, 1)::int AS token_version FROM admin_users WHERE LOWER(email) = LOWER($1) OR LOWER(name) = LOWER($1)',
          [identifier]
        );

    // SECURITY: collapse "user not found", "user disabled", and "wrong
    // password" into a single identical response so the endpoint cannot
    // be used to enumerate which emails are valid admin accounts.
    // Server-side logs preserve the real outcome for audit/forensics.
    const genericAuthError = () =>
      NextResponse.json(
        { success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' },
        { status: 401 }
      );

    if (lookup.rows.length === 0) {
      // Defensive: run a dummy bcrypt compare so the response timing
      // matches the active-user / wrong-password path. This closes the
      // timing channel that would otherwise reveal whether the email
      // exists.
      await verifyPassword(
        input.password,
        '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.Gd0qFjH9F8Xh1bVbpY9mJ6kO7S1u'
      ).catch(() => undefined);
      return genericAuthError();
    }
    const admin = lookup.rows[0];
    if (!admin.is_active) {
      // Audit-log the disabled-account attempt server-side; the client
      // gets the same generic error as for "user not found" / "wrong
      // password" so an attacker cannot distinguish the cases.
      logWarn('Admin login attempt against disabled account', {
        email: identifier.toLowerCase(),
        ip: clientIp,
      });
      await verifyPassword(
        input.password,
        admin.password_hash || '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.Gd0qFjH9F8Xh1bVbpY9mJ6kO7S1u'
      ).catch(() => undefined);
      return genericAuthError();
    }
    const isValid = await verifyPassword(input.password, admin.password_hash);
    if (!isValid) {
      return genericAuthError();
    }
    return finalizeAdminLogin(request, admin);
  } catch (error) {
    logError('Admin login error:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في الخادم' },
      { status: 500 }
    );
  }
}

/**
 * Common tail for both login flows: bump `last_login_at` and issue
 * the admin session cookie.
 */
async function finalizeAdminLogin(
  _request: NextRequest,
  admin: { id: string; name: string; email: string | null; phone: string | null; role: string; token_version?: number }
) {
  await query('UPDATE admin_users SET last_login_at = NOW() WHERE id = $1', [admin.id]);
  // SECURITY (PCP-144): bake the live token_version into the JWT so the
  // verify path (admin-api-auth-db.ts) can detect bumps on the next
  // request after a logout / password rotation / demotion.
  const sessionToken = await signAdminSessionToken({
    id: admin.id,
    email: admin.email ?? '',
    role: admin.role as AdminRole,
    tokenVersion: admin.token_version ?? 1,
  });
  const response = NextResponse.json({
    success: true,
    data: {
      user: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        role: admin.role,
      },
    },
  });
  response.cookies.set(ADMIN_SESSION_COOKIE, sessionToken, adminSessionCookieOptions());
  return response;
}
