import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { error as logError } from '@/lib/logger';
import { verifyPassword } from "@/lib/password";
import { vendorStaffLoginSchema } from "@/lib/validation/admin";
import { normalizeSaudiToE164 } from "@/lib/phone-format";
import { checkRateLimit, VENDOR_LOGIN_CONFIG, VENDOR_LOGIN_IP_CONFIG } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";

import {
  signVendorSessionToken,
  vendorSessionCookieOptions,
  VENDOR_SESSION_COOKIE,
  type VendorRole,
} from '@/lib/identity';

/**
 * POST /api/v1/vendor/auth/login
 *
 * Accepts either:
 *   - `identifier` = email  (legacy field name was `email`)
 *   - `identifier` = phone  (Saudi 5XXXXXXXX / 05… / +9665…)
 *
 * The server determines which path to take from the identifier's shape
 * and looks the staff row up by the appropriate column. Email lookup
 * stays case-insensitive; phone is normalized via `normalizeSaudiToE164`
 * before being matched against `LOWER(vendor_staff.phone)`.
 *
 * Backwards compatible: legacy clients that send `{ email, password,
 * vendorSlug }` keep working — the server treats `email` as an
 * identifier when present and no `identifier` is set.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // Backwards-compatibility shim: legacy clients (older app builds,
    // any external integration) may POST `{ email, password, vendorSlug }`
    // instead of `{ identifier, ... }`. Translate the legacy key before
    // validation so the schema's strictness doesn't 400 them.
    const normalizedBody =
      typeof body?.identifier === "string"
        ? body
        : { ...body, identifier: typeof body?.email === "string" ? body.email : undefined };
    const parsed = vendorStaffLoginSchema.safeParse(normalizedBody);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: first?.message || "بيانات الدخول غير صالحة" },
        { status: 400 }
      );
    }
    const { identifier, password, vendorSlug } = parsed.data;

    // SECURITY (PCP-124): brute-force protection. Without this, an
    // attacker can attempt vendor-staff credentials at full network
    // speed. 5/identifier/15min and 10/IP/15min mirrors the admin login
    // rate limit (ADMIN_LOGIN_CONFIG) because the credential check
    // shape and blast radius are identical.
    const clientIp = getClientIp(request);
    const ipRateLimit = await checkRateLimit(clientIp, VENDOR_LOGIN_IP_CONFIG);
    if (!ipRateLimit.allowed) {
      return NextResponse.json(
        { error: "تجاوزت عدد المحاولات. انتظر 15 دقيقة ثم حاول مجدداً." },
        { status: 429 }
      );
    }
    const idRateLimit = await checkRateLimit(
      `${vendorSlug}:${identifier.toLowerCase()}`,
      VENDOR_LOGIN_CONFIG
    );
    if (!idRateLimit.allowed) {
      return NextResponse.json(
        { error: "تجاوزت عدد المحاولات. انتظر 15 دقيقة ثم حاول مجدداً." },
        { status: 429 }
      );
    }

    // Find vendor by slug
    const vendorResult = await query(
      "SELECT id, slug, name_ar, is_active FROM vendors WHERE slug = $1",
      [vendorSlug]
    );

    if (vendorResult.rows.length === 0) {
      return NextResponse.json(
        { error: "المتجر غير موجود" },
        { status: 404 }
      );
    }

    const vendor = vendorResult.rows[0];

    if (!vendor.is_active) {
      return NextResponse.json(
        { error: "المتجر غير نشط حالياً" },
        { status: 403 }
      );
    }

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    let staffResult;
    if (isEmail) {
      // Phone-or-email lookup. `LOWER(email)` is index-friendly.
      // SECURITY (PCP-144): include token_version so the freshly
      // minted JWT carries the live row value. The DB verify path
      // (vendor-auth-with-db.ts) compares on every request.
      staffResult = await query(
        `SELECT id, vendor_id, email, phone, password_hash, full_name_ar, full_name_en,
                role, permissions, is_active, COALESCE(token_version, 1)::int AS token_version
         FROM vendor_staff
         WHERE LOWER(email) = LOWER($1) AND vendor_id = $2`,
        [identifier, vendor.id]
      );
    } else {
      const phoneE164 = normalizeSaudiToE164(identifier);
      if (!phoneE164) {
        return NextResponse.json(
          { error: "رقم الجوال غير صالح" },
          { status: 400 }
        );
      }
      // BUGFIX (audit 2026-09-29): vendor_staff.phone is stored in local
      // form (`05XXXXXXXX`), not E.164 — see phase-3-vendor-otp memory.
      // Until a future migration normalizes the column we match both
      // shapes in a single SQL with `IN (E.164, local)`. Without this,
      // the 3 phone-only staff couldn't log in via the phone branch.
      // SECURITY (PCP-144): also include token_version (see above).
      const phoneLocal = "0" + phoneE164.slice(4); // +9665XXXXXXXX → 05XXXXXXXX
      staffResult = await query(
        `SELECT id, vendor_id, email, phone, password_hash, full_name_ar, full_name_en,
                role, permissions, is_active, COALESCE(token_version, 1)::int AS token_version
         FROM vendor_staff
         WHERE vendor_id = $1
           AND LOWER(phone) IN (LOWER($2), LOWER($3))
         LIMIT 1`,
        [vendor.id, phoneE164, phoneLocal]
      );
    }

    if (staffResult.rows.length === 0) {
      // Single response for both unknown phone and unknown email so
      // a misconfigured UI can't enumerate which identifier scheme is
      // in use by which vendor.
      return NextResponse.json(
        { error: "بيانات الدخول غير صحيحة" },
        { status: 401 }
      );
    }

    const staff = staffResult.rows[0];

    if (!staff.is_active) {
      return NextResponse.json(
        { error: "حسابك غير نشط، تواصل مع المالك" },
        { status: 403 }
      );
    }

    // Verify password
    const isValid = await verifyPassword(password, staff.password_hash);
    if (!isValid) {
      return NextResponse.json(
        { error: "بيانات الدخول غير صحيحة" },
        { status: 401 }
      );
    }

    // Update last login
    await query(
      "UPDATE vendor_staff SET last_login_at = NOW() WHERE id = $1",
      [staff.id]
    );

    // Create session
    const session = {
      vendorId: staff.vendor_id,
      vendorSlug: vendor.slug,
      staffId: staff.id,
      email: staff.email ?? "",
      fullName: staff.full_name_ar || staff.full_name_en || staff.email || staff.phone || "",
      role: staff.role as VendorRole,
      permissions: staff.permissions || [],
      // SECURITY (PCP-144): bake the live token_version into the
      // JWT. verifyVendorRequestWithDb compares against the DB
      // column on every request, so a logout / password rotation
      // is detected within one request instead of waiting on the
      // 60s role-cache TTL.
      tokenVersion: (staff.token_version ?? 1) as number,
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
  } catch (error) {
    logError("Vendor login error:", error);
    return NextResponse.json(
      { error: "حدث خطأ أثناء تسجيل الدخول" },
      { status: 500 }
    );
  }
}
