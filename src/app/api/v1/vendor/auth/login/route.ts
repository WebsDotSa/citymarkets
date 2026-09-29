import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';
import { verifyPassword } from "@/lib/password";
import { vendorStaffLoginSchema } from "@/lib/validation/admin";
import { normalizeSaudiToE164 } from "@/lib/phone-format";

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
      staffResult = await query(
        `SELECT id, vendor_id, email, phone, password_hash, full_name_ar, full_name_en,
                role, permissions, is_active
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
      staffResult = await query(
        `SELECT id, vendor_id, email, phone, password_hash, full_name_ar, full_name_en,
                role, permissions, is_active
         FROM vendor_staff
         WHERE LOWER(phone) = LOWER($1) AND vendor_id = $2`,
        [phoneE164, vendor.id]
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
