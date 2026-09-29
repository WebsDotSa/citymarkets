// Admin: list + create broadcasts.
// PR1 stubs the create path (persists row in `draft` status). PR2 wires
// the actual send trigger + audience expansion.

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from '@/lib/identity';
import {
  broadcastCreateSchema,
} from "@/lib/validation";
import { logAdminAction } from "@/lib/admin-audit";
import { error as logError } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_broadcasts");
  if (gate instanceof NextResponse) return gate;

  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));
    const offset = (page - 1) * limit;
    const status = searchParams.get("status");

    const params: (string | number)[] = [];
    const conditions: string[] = [];
    if (status && ["draft", "scheduled", "sending", "sent", "cancelled", "failed"].includes(status)) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    const whereSQL = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const listSQL = `
      SELECT id, title, status, channels, scheduled_at, started_at, finished_at,
             created_by, created_at, updated_at, stats
        FROM broadcasts
        ${whereSQL}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const countSQL = `SELECT COUNT(*)::int AS total FROM broadcasts ${whereSQL}`;
    const [listRes, countRes] = await Promise.all([
      pool.query(listSQL, [...params, limit, offset]),
      pool.query(countSQL, params),
    ]);

    return NextResponse.json({
      success: true,
      data: listRes.rows,
      pagination: {
        page,
        limit,
        total: countRes.rows[0]?.total ?? 0,
        totalPages: Math.ceil((countRes.rows[0]?.total ?? 0) / limit),
      },
    });
  } catch (error) {
    logError("broadcasts GET", error);
    return NextResponse.json({ success: false, error: "فشل الجلب" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_broadcasts");
  if (gate instanceof NextResponse) return gate;

  try {
    const body = await request.json();
    const parsed = broadcastCreateSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.errors[0];
      return NextResponse.json(
        { success: false, error: firstIssue?.message || "بيانات غير صالحة" },
        { status: 400 },
      );
    }
    const data = parsed.data;
    const adminId = gate.admin.id;

    const status = data.scheduled_at ? "scheduled" : "draft";

    const res = await pool.query(
      `INSERT INTO broadcasts
         (title, body, body_html, image_url, cta_label, cta_url,
          channels, audience, template_id, status, scheduled_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
       RETURNING id`,
      [
        data.title,
        data.body,
        data.body_html ?? null,
        data.image_url ?? null,
        data.cta_label ?? null,
        data.cta_url ?? null,
        data.channels,
        JSON.stringify(data.audience),
        data.template_id ?? null,
        status,
        data.scheduled_at ?? null,
        adminId,
      ],
    );

    await logAdminAction(gate.admin, "broadcast.create", {
      entityType: "broadcast",
      entityId: res.rows[0].id,
      details: { title: data.title, channels: data.channels, status },
      request,
    });

    return NextResponse.json({ success: true, data: { id: res.rows[0].id } });
  } catch (error) {
    logError("broadcasts POST", error);
    return NextResponse.json({ success: false, error: "فشل الحفظ" }, { status: 500 });
  }
}