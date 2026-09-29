// Admin: read/update/cancel-pending a single broadcast.
// PR1 stubs: edit only allowed while status = 'draft' or 'scheduled'.

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { broadcastUpdateSchema, uuidSchema } from "@/lib/validation";
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
      `SELECT id, title, body, body_html, image_url, cta_label, cta_url,
              channels, audience, template_id, status,
              scheduled_at, started_at, finished_at,
              created_by, created_at, updated_at, stats
         FROM broadcasts WHERE id = $1`,
      [params.id],
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ success: false, error: "غير موجود" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: res.rows[0] });
  } catch (error) {
    logError("broadcast GET", error);
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
    const parsed = broadcastUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || "بيانات غير صالحة" },
        { status: 400 },
      );
    }
    const data = parsed.data;

    // Lock to draft/scheduled — editing a sent broadcast is forbidden.
    const cur = await pool.query(`SELECT status FROM broadcasts WHERE id = $1`, [params.id]);
    if (cur.rows.length === 0) {
      return NextResponse.json({ success: false, error: "غير موجود" }, { status: 404 });
    }
    const curStatus = cur.rows[0].status;
    if (!["draft", "scheduled"].includes(curStatus)) {
      return NextResponse.json(
        { success: false, error: "لا يمكن تعديل بث تم إرساله" },
        { status: 409 },
      );
    }

    const fields: string[] = [];
    const params2: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (k === "audience") {
        fields.push(`audience = $${i++}::jsonb`);
        params2.push(JSON.stringify(v));
      } else {
        fields.push(`${k} = $${i++}`);
        params2.push(v);
      }
    }
    fields.push(`updated_at = NOW()`);
    params2.push(params.id);

    await pool.query(
      `UPDATE broadcasts SET ${fields.join(", ")} WHERE id = $${i}`,
      params2,
    );

    await logAdminAction(gate.admin, "broadcast.update", {
      entityType: "broadcast",
      entityId: params.id,
      details: { fields: Object.keys(data) },
      request,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("broadcast PUT", error);
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
    // Soft delete only — drafts can be hard-deleted; sent broadcasts
    // are kept for audit/metrics.
    const cur = await pool.query(`SELECT status FROM broadcasts WHERE id = $1`, [params.id]);
    if (cur.rows.length === 0) {
      return NextResponse.json({ success: false, error: "غير موجود" }, { status: 404 });
    }
    const status = cur.rows[0].status;
    if (status === "draft") {
      await pool.query(`DELETE FROM broadcasts WHERE id = $1`, [params.id]);
    } else {
      await pool.query(
        `UPDATE broadcasts SET status='cancelled', updated_at=NOW() WHERE id=$1`,
        [params.id],
      );
    }
    await logAdminAction(gate.admin, "broadcast.delete", {
      entityType: "broadcast",
      entityId: params.id,
      details: { status },
      request,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("broadcast DELETE", error);
    return NextResponse.json({ success: false, error: "فشل الحذف" }, { status: 500 });
  }
}