import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import {
  signAdminSessionToken,
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
} from '@/lib/admin-session';
import type { AdminRole } from '@/lib/admin-types';
import { checkRateLimit, ADMIN_LOGIN_CONFIG, ADMIN_LOGIN_IP_CONFIG, OTP_VERIFY_CONFIG, OTP_VERIFY_IP_CONFIG, createRateLimitHeaders } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-ip';
import { normalizeSaudiToE164, phoneForDb } from '@/lib/phone-format';
import { adminLoginInputSchema } from '@/lib/validation/admin';
import {
  isTwilioVerifyConfigured,
  twilioCheckVerification,
  twilioSendVerification,
} from '@/lib/twilio-verify';

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

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
    const body = await request.json();
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
      const result = await query(
        `SELECT id, name, email, phone, role, is_active
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
          'SELECT id, name, email, phone, password_hash, role, is_active FROM admin_users WHERE LOWER(email) = LOWER($1)',
          [identifier]
        )
      : await query(
          'SELECT id, name, email, phone, password_hash, role, is_active FROM admin_users WHERE LOWER(email) = LOWER($1) OR LOWER(name) = LOWER($1)',
          [identifier]
        );

    if (lookup.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' },
        { status: 401 }
      );
    }
    const admin = lookup.rows[0];
    if (!admin.is_active) {
      return NextResponse.json(
        { success: false, error: 'هذا الحساب معطّل، تواصل مع مدير النظام' },
        { status: 403 }
      );
    }
    const isValid = await verifyPassword(input.password, admin.password_hash);
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' },
        { status: 401 }
      );
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
  admin: { id: string; name: string; email: string | null; phone: string | null; role: string }
) {
  await query('UPDATE admin_users SET last_login_at = NOW() WHERE id = $1', [admin.id]);
  const sessionToken = await signAdminSessionToken({
    id: admin.id,
    email: admin.email ?? '',
    role: admin.role as AdminRole,
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
