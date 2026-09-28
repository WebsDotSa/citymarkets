import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-api-auth";

import { error as logError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const ALLOWED_STATUS = new Set([
  "new",
  "reviewed",
  "shortlisted",
  "rejected",
  "hired",
]);

/**
 * GET /api/admin/employment
 *
 * Admin-only list of job applications with optional status / job
 * filtering. Returns the rows newest first, plus a small summary so
 * the admin page can render counts without a second request.
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const jobId = url.searchParams.get("job_id");
    const search = url.searchParams.get("q")?.trim();

    const where: string[] = [];
    const params: unknown[] = [];
    if (status && ALLOWED_STATUS.has(status)) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (jobId) {
      params.push(jobId);
      where.push(`job_id = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const idx = params.length;
      where.push(
        `(full_name ILIKE $${idx} OR phone ILIKE $${idx} OR email ILIKE $${idx} OR job_title ILIKE $${idx})`
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const listPromise = query(
      `SELECT id, full_name, phone, email, job_id, job_title, message,
              cv_url, cv_filename, cv_size_bytes, status, internal_notes,
              reviewed_at, created_at
         FROM job_applications
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT 200`,
      params
    );
    const summaryPromise = query(
      `SELECT status, COUNT(*)::int AS count
         FROM job_applications
         GROUP BY status`
    );

    const [list, summary] = await Promise.all([listPromise, summaryPromise]);

    const counts: Record<string, number> = {
      new: 0,
      reviewed: 0,
      shortlisted: 0,
      rejected: 0,
      hired: 0,
    };
    for (const row of summary.rows) {
      counts[row.status] = Number(row.count) || 0;
    }

    return NextResponse.json({
      success: true,
      data: list.rows,
      summary: {
        total: Object.values(counts).reduce((a, b) => a + b, 0),
        counts,
      },
    });
  } catch (error) {
    logError("Admin employment list error:", error);
    return NextResponse.json(
      { success: false, error: "فشل تحميل الطلبات" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/employment
 *
 * Body: { id, status?, internal_notes? }
 * Updates the review state for a single application.
 */
export async function PATCH(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_store_settings");
  if (gate instanceof NextResponse) return gate;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = String(body.id ?? "").trim();
    const status = body.status ? String(body.status) : undefined;
    const notes = body.internal_notes !== undefined ? String(body.internal_notes) : undefined;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "معرّف الطلب مطلوب" },
        { status: 400 }
      );
    }
    if (status !== undefined && !ALLOWED_STATUS.has(status)) {
      return NextResponse.json(
        { success: false, error: "الحالة غير صالحة" },
        { status: 400 }
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (status !== undefined) {
      params.push(status);
      sets.push(`status = $${params.length}`);
      // Stamp the reviewer + timestamp on every meaningful state change.
      if (status !== "new") {
        params.push(gate.admin.id);
        sets.push(`reviewed_by = $${params.length}`);
        sets.push(`reviewed_at = NOW()`);
      } else {
        sets.push(`reviewed_by = NULL`);
        sets.push(`reviewed_at = NULL`);
      }
    }
    if (notes !== undefined) {
      params.push(notes || null);
      sets.push(`internal_notes = $${params.length}`);
    }
    if (sets.length === 0) {
      return NextResponse.json(
        { success: false, error: "لا توجد تغييرات" },
        { status: 400 }
      );
    }

    params.push(id);
    await query(
      `UPDATE job_applications SET ${sets.join(", ")} WHERE id = $${params.length}`,
      params
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("Admin employment update error:", error);
    return NextResponse.json(
      { success: false, error: "فشل تحديث الطلب" },
      { status: 500 }
    );
  }
}
