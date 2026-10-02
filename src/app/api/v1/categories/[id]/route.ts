/**
 * GET /api/v1/categories/[id] — public single-category detail.
 *
 * PCP-121: a request with a non-UUID `id` used to fall through to
 * Next.js's 404 HTML page (because there was no route handler at this
 * path). That breaks the API contract — every other /api/v1/<resource>/[id]
 * route returns a JSON error envelope. This file fixes that:
 *
 *   • Bad UUID → 400 (consistent with the rest of the UUID-guarded API)
 *   • Unknown UUID → 404
 *   • Soft-deleted (is_active = false) → 404 (don't leak existence)
 *
 * Response shape matches the row from /api/v1/categories (no joins
 * needed for the public detail page).
 */
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { validateUuidOrError } from "@/lib/api/uuid-guard";
import { error as logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const uuidCheck = validateUuidOrError(id, "معرّف الفئة");
  if (uuidCheck) return uuidCheck;

  try {
    const result = await query(
      `SELECT id, name_ar, name_en, slug, parent_id, sort_order,
              is_active, description_ar, description_en
         FROM categories
        WHERE id = $1 AND is_active = TRUE`,
      [id],
    );
    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "الفئة غير موجودة" },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true, category: result.rows[0] });
  } catch (err) {
    logError("categories/[id] GET error:", err);
    return NextResponse.json(
      { success: false, error: "فشل الجلب" },
      { status: 500 },
    );
  }
}
