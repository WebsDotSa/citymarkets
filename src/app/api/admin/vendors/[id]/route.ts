import { UUID_RE } from "@/lib/uuid";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { logAdminAction } from "@/lib/admin-audit";
import { vendorPatchSchema } from "@/lib/validation";

import { error as logError } from '@/lib/logger';


// PATCH /api/admin/vendors/[id] — toggles (active/featured) so quick action
// buttons on the list don't need to round-trip the full form.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { success: false, error: "المعرّف غير صالح" },
        { status: 400 }
      );
    }
    const body = await request.json();
    const parsed = vendorPatchSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { success: false, error: first?.message || "بيانات غير صالحة" },
        { status: 400 }
      );
    }
    const v = parsed.data;

    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, val] of Object.entries(v)) {
      if (val === undefined) continue;
      sets.push(`${key} = $${i++}`);
      values.push(val);
    }
    sets.push("updated_at = NOW()");
    values.push(id);

    await query(
      `UPDATE vendors SET ${sets.join(", ")} WHERE id = $${i}`,
      values
    );

    await logAdminAction(gate.admin, "vendor.patch", {
      entityType: "vendor",
      entityId: id,
      details: { keys: Object.keys(v) },
      request,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("admin vendors PATCH:", error);
    return NextResponse.json({ success: false, error: "فشل التحديث" }, { status: 500 });
  }
}
