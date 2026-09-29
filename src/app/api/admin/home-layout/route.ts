/**
 * Admin API: home layout composition.
 *
 *   GET  /api/admin/home-layout?device=mobile|desktop
 *   PUT  /api/admin/home-layout?device=mobile|desktop   { name?, is_active?, sections }
 *
 * Gated by `requireAdminApi(..., "manage_banners")` so super_admin,
 * admin, and editor all have access without inventing a new permission.
 *
 * PUT is upsert: INSERT ... ON CONFLICT (device_type) DO UPDATE so the
 * caller doesn't need to know whether the row was seeded.
 */
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { homeLayoutInputSchema } from "@/lib/validation";
import { error as logError } from "@/lib/logger";
import { invalidateHomeLayout } from '@/lib/catalog/home-layout-cache';
import type { DeviceType, Section } from '@/lib/catalog';

const ALLOWED_DEVICES: DeviceType[] = ["mobile", "desktop"];

function parseDevice(raw: string | null): DeviceType | null {
  if (!raw) return null;
  return ALLOWED_DEVICES.includes(raw as DeviceType) ? (raw as DeviceType) : null;
}

export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_banners");
  if (gate instanceof NextResponse) return gate;

  const url = new URL(request.url);
  const device = parseDevice(url.searchParams.get("device"));
  if (!device) {
    return NextResponse.json(
      { success: false, error: "device يجب أن يكون mobile أو desktop" },
      { status: 400 },
    );
  }

  try {
    const result = await pool.query(
      `SELECT id, device_type, name, sections, is_active, updated_at, created_at
       FROM home_layouts
       WHERE device_type = $1`,
      [device],
    );
    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "لا يوجد layout لهذا الجهاز" },
        { status: 404 },
      );
    }
    const row = result.rows[0];
    return NextResponse.json({
      success: true,
      data: {
        id: row.id,
        device_type: row.device_type,
        name: row.name,
        sections: row.sections ?? [],
        is_active: row.is_active,
        updated_at: row.updated_at,
        created_at: row.created_at,
      },
    });
  } catch (error) {
    logError("admin.home-layout.GET", error);
    return NextResponse.json({ success: false, error: "فشل تحميل الـ layout" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_banners");
  if (gate instanceof NextResponse) return gate;

  const url = new URL(request.url);
  const device = parseDevice(url.searchParams.get("device"));
  if (!device) {
    return NextResponse.json(
      { success: false, error: "device يجب أن يكون mobile أو desktop" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "الجسم يجب أن يكون JSON صالح" },
      { status: 400 },
    );
  }

  const parsed = homeLayoutInputSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.errors[0];
    return NextResponse.json(
      {
        success: false,
        error: firstIssue?.message ?? "بيانات الـ layout غير صالحة",
        details: parsed.error.errors,
      },
      { status: 400 },
    );
  }

  const { name, is_active, sections } = parsed.data;
  const adminId = gate.admin?.id ?? null;

  try {
    const result = await pool.query(
      `INSERT INTO home_layouts (device_type, name, sections, is_active, updated_by)
       VALUES ($1, COALESCE($2, 'الافتراضي'), $3::jsonb, COALESCE($4, TRUE), $5)
       ON CONFLICT (device_type) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, home_layouts.name),
         sections = EXCLUDED.sections,
         is_active = COALESCE(EXCLUDED.is_active, home_layouts.is_active),
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING id, updated_at`,
      [
        device,
        name ?? null,
        JSON.stringify(sections as Section[]),
        is_active ?? null,
        adminId,
      ],
    );

    invalidateHomeLayout();

    return NextResponse.json({
      success: true,
      data: {
        id: result.rows[0].id,
        updated_at: result.rows[0].updated_at,
        sections_count: sections.length,
      },
    });
  } catch (error) {
    logError("admin.home-layout.PUT", error);
    return NextResponse.json({ success: false, error: "فشل حفظ الـ layout" }, { status: 500 });
  }
}