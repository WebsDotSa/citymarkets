import { requireIdParam } from "@/lib/request-params";
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { logAdminAction } from "@/lib/admin-audit";
import { validateBody } from "@/lib/validation";
import { z } from "zod";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

const reviewUpdateSchema = z
  .object({
    is_approved: z.boolean().optional(),
  })
  .strict();

export async function GET(request: NextRequest) {
  // SECURITY (RBAC): reviews are not part of "manage_orders"; reviewers
  // (super_admin/admin) must hold the dedicated permission so a future
  // "viewer" role can read orders but not moderate reviews.
  const gate = await requireAdminApi(request, "manage_reviews");
  if (gate instanceof NextResponse) return gate;

  try {
    const result = await query(
      `SELECT r.id, r.product_id, r.rating, r.comment,
              r.is_approved, r.created_at,
              u.name as user_name,
              p.name_ar AS product_name,
              p.image_url AS product_image
       FROM product_reviews r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN products_unified p ON r.product_id = p.id
       ORDER BY r.created_at DESC
       LIMIT 200`
    );
    const avg = await query(
      `SELECT
         ROUND(AVG(rating)::numeric, 2)::float AS avg_rating,
         COUNT(*)::int AS total
       FROM product_reviews WHERE is_approved = true`
    );
    return NextResponse.json({
      success: true,
      data: result.rows,
      summary: avg.rows[0] || { avg_rating: 0, total: 0 },
    });
  } catch (error) {
    logError("reviews GET:", error);
    return NextResponse.json({ success: false, error: "فشل جلب التقييمات" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdminApi(request, "manage_reviews");
  if (gate instanceof NextResponse) return gate;

  try {
    const url = new URL(request.url);
    const id = requireIdParam(url);
    if (id instanceof NextResponse) return id;

    const raw = await request.json();
    const parsed = validateBody(reviewUpdateSchema, raw);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error },
        { status: 400 },
      );
    }
    const body = parsed.data;
    await query(
      `UPDATE product_reviews SET is_approved = $1 WHERE id = $2`,
      [body.is_approved !== false, id]
    );
    await logAdminAction(gate.admin, "review.update", {
      entityType: "review",
      entityId: id,
      details: body,
      request,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("reviews PUT:", error);
    return NextResponse.json({ success: false, error: "فشل التحديث" }, { status: 500 });
  }
}
