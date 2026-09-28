import { NextRequest, NextResponse } from "next/server";
import { query, pool } from "@/lib/db";
import { verifyVendorRequestWithDb, requireVendorRole, type VendorRole } from "@/lib/vendor-auth";
import { error as logError } from "@/lib/logger";
import { logVendorAudit } from "@/lib/vendor-audit";
import { clearVendorSessionCache } from "@/lib/vendor-auth";

const VALID_ROLES: VendorRole[] = ["owner", "manager", "staff", "viewer"];

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/v1/vendor/staff/[id]
 * Update role / is_active / names. Manager+ only. When `is_active`
 * flips to false OR role changes, the target staff member's existing
 * JWT is invalidated by bumping `token_version` (their next request
 * fails auth).
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const client = await pool.connect();
  try {
    const session = await verifyVendorRequestWithDb(request);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
    const unauthorized = requireVendorRole(session, "manager");
    if (unauthorized) return unauthorized;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    await client.query("BEGIN");

    // Confirm the row belongs to this vendor and lock it
    const existing = await client.query(
      `SELECT id, role, is_active FROM vendor_staff
       WHERE id = $1 AND vendor_id = $2 FOR UPDATE`,
      [id, session.vendorId]
    );
    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "الموظف غير موجود" }, { status: 404 });
    }

    const current = existing.rows[0];

    // Demoting the only owner is dangerous — refuse unless there is
    // another active owner in the vendor. (Edge case for owner-row
    // edits; protects against lockout.)
    if (current.role === "owner") {
      const otherOwners = await client.query(
        `SELECT COUNT(*)::int AS c FROM vendor_staff
         WHERE vendor_id = $1 AND role = 'owner' AND is_active = TRUE AND id <> $2`,
        [session.vendorId, id]
      );
      if ((otherOwners.rows[0]?.c ?? 0) === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "لا يمكن تعديل المالك الوحيد — أضف مالكاً آخر أولاً" },
          { status: 400 }
        );
      }
    }

    const updates: string[] = [];
    const values: any[] = [];
    let p = 1;

    if (body.fullNameAr !== undefined) {
      updates.push(`full_name_ar = $${p++}`);
      values.push(String(body.fullNameAr).trim() || null);
    }
    if (body.fullNameEn !== undefined) {
      updates.push(`full_name_en = $${p++}`);
      values.push(String(body.fullNameEn).trim() || null);
    }

    let roleChanged = false;
    let activeChanged = false;

    if (body.role !== undefined && body.role !== current.role) {
      if (!VALID_ROLES.includes(body.role)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "دور غير صالح" }, { status: 400 });
      }
      if (body.role === "owner" && session.role !== "owner") {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "فقط المالك يمكنه ترقية أحد إلى مالك" },
          { status: 403 }
        );
      }
      updates.push(`role = $${p++}`);
      values.push(body.role);
      roleChanged = true;
    }

    if (body.isActive !== undefined && body.isActive !== current.is_active) {
      updates.push(`is_active = $${p++}`);
      values.push(body.isActive === true);
      activeChanged = true;
    }

    if (updates.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "لا توجد بيانات للتحديث" },
        { status: 400 }
      );
    }

    // Invalidate the target's JWT when role/active changes
    if (roleChanged || activeChanged) {
      updates.push(`token_version = token_version + 1`);
    }

    values.push(id, session.vendorId);

    const result = await client.query(
      `UPDATE vendor_staff SET ${updates.join(", ")}
       WHERE id = $${p++} AND vendor_id = $${p}
       RETURNING id, email, full_name_ar, full_name_en, role, permissions,
                 is_active, last_login_at, created_at`,
      values
    );

    await client.query("COMMIT");

    // Eject the cached session so the change takes effect within the
    // 60s cache window rather than waiting for the JWT to expire.
    if (roleChanged || activeChanged) {
      clearVendorSessionCache(id);
    }

    const staff = result.rows[0];

    await logVendorAudit({
      vendorId: session.vendorId,
      actorStaffId: session.staffId,
      action: roleChanged
        ? "staff.update_role"
        : activeChanged
        ? "staff.update_active"
        : "staff.update",
      targetType: "vendor_staff",
      targetId: id,
      metadata: {
        roleChanged,
        activeChanged,
        newRole: staff.role,
        newActive: staff.is_active,
      },
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
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    logError("Update vendor staff error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في تحديث الموظف" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/v1/vendor/staff/[id]
 * Owner-only. Removes a staff member. The vendor must always retain
 * at least one active owner.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const client = await pool.connect();
  try {
    const session = await verifyVendorRequestWithDb(request);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }
    const unauthorized = requireVendorRole(session, "owner");
    if (unauthorized) return unauthorized;

    const { id } = await params;

    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id, role, is_active FROM vendor_staff
       WHERE id = $1 AND vendor_id = $2 FOR UPDATE`,
      [id, session.vendorId]
    );
    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "الموظف غير موجود" }, { status: 404 });
    }

    // Refuse self-delete to prevent the only owner from locking
    // themselves out before they can re-add themselves.
    if (id === session.staffId) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "لا يمكنك حذف حسابك بنفسك" },
        { status: 400 }
      );
    }

    if (existing.rows[0].role === "owner") {
      const otherOwners = await client.query(
        `SELECT COUNT(*)::int AS c FROM vendor_staff
         WHERE vendor_id = $1 AND role = 'owner' AND is_active = TRUE`,
        [session.vendorId]
      );
      if ((otherOwners.rows[0]?.c ?? 0) === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "لا يمكن حذف المالك الوحيد" },
          { status: 400 }
        );
      }
    }

    await client.query(
      "DELETE FROM vendor_staff WHERE id = $1 AND vendor_id = $2",
      [id, session.vendorId]
    );

    await client.query("COMMIT");

    clearVendorSessionCache(id);

    await logVendorAudit({
      vendorId: session.vendorId,
      actorStaffId: session.staffId,
      action: "staff.delete",
      targetType: "vendor_staff",
      targetId: id,
      metadata: { role: existing.rows[0].role },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    logError("Delete vendor staff error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في حذف الموظف" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
