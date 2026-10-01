import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireVendorRole, type VendorRole } from "@/lib/identity";
import { verifyVendorRequestWithDb } from "@/lib/identity/vendor-auth-with-db";
import { hashPassword } from "@/lib/password";
import { error as logError } from "@/lib/logger";
import { logVendorAudit } from "@/lib/vendor-audit";

const VALID_ROLES: VendorRole[] = ["owner", "manager", "staff", "viewer"];

/**
 * GET /api/v1/vendor/staff
 * List all staff for the current vendor. Manager+ only — staff/viewer
 * cannot enumerate their co-workers.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await verifyVendorRequestWithDb(request);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
    const unauthorized = requireVendorRole(session, "manager");
    if (unauthorized) return unauthorized;

    const result = await query(
      `SELECT id, email, full_name_ar, full_name_en, role, permissions,
              is_active, last_login_at, created_at
       FROM vendor_staff
       WHERE vendor_id = $1
       ORDER BY
         CASE role
           WHEN 'owner' THEN 1
           WHEN 'manager' THEN 2
           WHEN 'staff' THEN 3
           WHEN 'viewer' THEN 4
         END,
         created_at ASC`,
      [session.vendorId]
    );

    const staff = result.rows.map((s) => ({
      id: s.id,
      email: s.email,
      fullNameAr: s.full_name_ar,
      fullNameEn: s.full_name_en,
      role: s.role,
      permissions: s.permissions || [],
      isActive: s.is_active,
      lastLoginAt: s.last_login_at,
      createdAt: s.created_at,
    }));

    return NextResponse.json({ staff });
  } catch (error) {
    logError("List vendor staff error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في جلب الموظفين" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/vendor/staff
 * Add a new staff member to the current vendor. Manager+ only.
 * Body: { email, password, fullNameAr?, fullNameEn?, role }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await verifyVendorRequestWithDb(request);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
    const unauthorized = requireVendorRole(session, "manager");
    if (unauthorized) return unauthorized;

    const body = await request.json().catch(() => ({}));
    const { email, password, fullNameAr, fullNameEn, role } = body || {};

    if (!email || !password) {
      return NextResponse.json(
        { error: "البريد الإلكتروني وكلمة المرور مطلوبان" },
        { status: 400 }
      );
    }

    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json(
        { error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" },
        { status: 400 }
      );
    }

    const requestedRole: VendorRole = VALID_ROLES.includes(role) ? role : "staff";
    // Owners cannot be self-provisioned — there's always exactly one
    // owner per vendor (the founder), so refuse the request loudly
    // instead of silently downgrading.
    if (requestedRole === "owner") {
      return NextResponse.json(
        { error: "لا يمكن إنشاء مالك جديد — اتصل بالدعم لنقل الملكية" },
        { status: 400 }
      );
    }

    // Managers can only create manager-or-below. Owners can be
    // created only via DB migration or admin tools.
    if (requestedRole === "manager" && session.role !== "owner") {
      return NextResponse.json(
        { error: "فقط المالك يمكنه إضافة مدير" },
        { status: 403 }
      );
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const passwordHash = await hashPassword(password);

    const result = await query(
      `INSERT INTO vendor_staff
         (vendor_id, email, password_hash, full_name_ar, full_name_en, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING id, email, full_name_ar, full_name_en, role, permissions,
                 is_active, last_login_at, created_at`,
      [
        session.vendorId,
        normalizedEmail,
        passwordHash,
        fullNameAr?.trim() || null,
        fullNameEn?.trim() || null,
        requestedRole,
      ]
    );

    const staff = result.rows[0];

    await logVendorAudit({
      vendorId: session.vendorId,
      actorStaffId: session.staffId,
      action: "staff.create",
      targetType: "vendor_staff",
      targetId: staff.id,
      metadata: { role: requestedRole, email: normalizedEmail },
    });

    return NextResponse.json({
      success: true,
      staff: {
        id: staff.id,
        email: staff.email,
        fullNameAr: staff.full_name_ar,
        fullNameEn: staff.full_name_en,
        role: staff.role,
        permissions: staff.permissions || [],
        isActive: staff.is_active,
        lastLoginAt: staff.last_login_at,
        createdAt: staff.created_at,
      },
    });
  } catch (error: any) {
    logError("Create vendor staff error:", error);
    if (error?.code === "23505") {
      return NextResponse.json(
        { error: "هذا البريد مسجل مسبقاً في متجرك" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "حدث خطأ في إضافة الموظف" },
      { status: 500 }
    );
  }
}
