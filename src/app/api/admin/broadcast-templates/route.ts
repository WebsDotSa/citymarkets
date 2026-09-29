// Admin: list + create broadcast templates.

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { broadcastTemplateCreateSchema } from "@/lib/validation";
import { logAdminAction } from "@/lib/admin-audit";
import { error as logError } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_broadcasts");
  if (gate instanceof NextResponse) return gate;

  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const onlyActive = searchParams.get("is_active") !== "false";

    const params: unknown[] = [];
    const conditions: string[] = [];
    if (onlyActive) conditions.push("is_active = TRUE");
    if (category && ["promo", "order", "loyalty", "blog", "system"].includes(category)) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    const whereSQL = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const res = await pool.query(
      `SELECT id, name, description, category, channels, content, variables,
              is_active, created_by, created_at, updated_at
         FROM broadcast_templates
         ${whereSQL}
        ORDER BY updated_at DESC`,
      params,
    );
    return NextResponse.json({ success: true, data: res.rows });
  } catch (error) {
    logError("templates GET", error);
    return NextResponse.json({ success: false, error: "فشل الجلب" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_broadcasts");
  if (gate instanceof NextResponse) return gate;

  try {
    const body = await request.json();
    const parsed = broadcastTemplateCreateSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || "بيانات غير صالحة" },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const res = await pool.query(
      `INSERT INTO broadcast_templates
         (name, description, category, channels, content, variables, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING id`,
      [
        data.name,
        data.description ?? null,
        data.category ?? null,
        data.channels,
        JSON.stringify(data.content),
        data.variables,
        gate.admin.id,
      ],
    );
    await logAdminAction(gate.admin, "broadcast.template.create", {
      entityType: "broadcast_template",
      entityId: res.rows[0].id,
      details: { name: data.name },
      request,
    });
    return NextResponse.json({ success: true, data: { id: res.rows[0].id } });
  } catch (error) {
    logError("templates POST", error);
    return NextResponse.json({ success: false, error: "فشل الحفظ" }, { status: 500 });
  }
}