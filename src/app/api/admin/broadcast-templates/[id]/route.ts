// Admin: read/update/delete a single template.

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { broadcastTemplateUpdateSchema, uuidSchema } from "@/lib/validation";
import { logAdminAction } from "@/lib/admin-audit";
import { error as logError } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const gate = await requireAdminApi(request, "manage_broadcasts");
  if (gate instanceof NextResponse) return gate;
  if (!uuidSchema.safeParse(params.id).success) {
    return NextResponse.json({ success: false, error: "معرّف غير صالح" }, { status: 400 });
  }
  try {
    const res = await pool.query(
      `SELECT id, name, description, category, channels, content, variables,
              is_active, created_by, created_at, updated_at
         FROM broadcast_templates WHERE id = $1`,
      [params.id],
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ success: false, error: "غير موجود" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: res.rows[0] });
  } catch (error) {
    logError("template GET", error);
    return NextResponse.json({ success: false, error: "فشل الجلب" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const gate = await requireAdminApi(request, "manage_broadcasts");
  if (gate instanceof NextResponse) return gate;
  if (!uuidSchema.safeParse(params.id).success) {
    return NextResponse.json({ success: false, error: "معرّف غير صالح" }, { status: 400 });
  }
  try {
    const body = await request.json();
    const parsed = broadcastTemplateUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || "بيانات غير صالحة" },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (k === "content") {
        fields.push(`content = $${i++}::jsonb`);
        values.push(JSON.stringify(v));
      } else {
        fields.push(`${k} = $${i++}`);
        values.push(v);
      }
    }
    if (fields.length === 0) {
      return NextResponse.json(
        { success: false, error: "لا يوجد حقول لتحديثها" },
        { status: 400 },
      );
    }
    fields.push(`updated_at = NOW()`);
    values.push(params.id);

    await pool.query(
      `UPDATE broadcast_templates SET ${fields.join(", ")} WHERE id = $${i}`,
      values,
    );
    await logAdminAction(gate.admin, "broadcast.template.update", {
      entityType: "broadcast_template",
      entityId: params.id,
      details: { fields: Object.keys(data) },
      request,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("template PUT", error);
    return NextResponse.json({ success: false, error: "فشل التحديث" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const params = await context.params;
  const gate = await requireAdminApi(request, "manage_broadcasts");
  if (gate instanceof NextResponse) return gate;
  if (!uuidSchema.safeParse(params.id).success) {
    return NextResponse.json({ success: false, error: "معرّف غير صالح" }, { status: 400 });
  }
  try {
    // Soft delete via is_active=false — preserves history.
    await pool.query(
      `UPDATE broadcast_templates SET is_active=FALSE, updated_at=NOW() WHERE id=$1`,
      [params.id],
    );
    await logAdminAction(gate.admin, "broadcast.template.delete", {
      entityType: "broadcast_template",
      entityId: params.id,
      request,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("template DELETE", error);
    return NextResponse.json({ success: false, error: "فشل الحذف" }, { status: 500 });
  }
}