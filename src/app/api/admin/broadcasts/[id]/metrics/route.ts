// Admin: aggregate metrics for a single broadcast (per-channel counts +
// open / click rates). Computed live from broadcast_deliveries.

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-api-auth";
import { uuidSchema } from "@/lib/validation";
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
    const [headline, perChannel] = await Promise.all([
      pool.query(
        `SELECT
            COUNT(*) FILTER (WHERE status != 'skipped')::int   AS targeted,
            COUNT(*) FILTER (WHERE status IN ('sent','delivered','opened','clicked'))::int AS delivered,
            COUNT(*) FILTER (WHERE status = 'opened' OR status = 'clicked')::int          AS opened,
            COUNT(*) FILTER (WHERE status = 'clicked')::int                              AS clicked,
            COUNT(*) FILTER (WHERE status = 'failed')::int                               AS failed,
            COUNT(*) FILTER (WHERE status = 'skipped')::int                              AS skipped
           FROM broadcast_deliveries WHERE broadcast_id = $1`,
        [params.id],
      ),
      pool.query(
        `SELECT channel,
            COUNT(*) FILTER (WHERE status != 'skipped')::int AS targeted,
            COUNT(*) FILTER (WHERE status IN ('sent','delivered','opened','clicked'))::int AS sent,
            COUNT(*) FILTER (WHERE status IN ('opened','clicked'))::int AS opened,
            COUNT(*) FILTER (WHERE status = 'clicked')::int AS clicked,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
            COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped
           FROM broadcast_deliveries WHERE broadcast_id = $1
          GROUP BY channel ORDER BY channel`,
        [params.id],
      ),
    ]);
    const h = headline.rows[0] ?? {};
    return NextResponse.json({
      success: true,
      data: {
        targeted: h.targeted ?? 0,
        delivered: h.delivered ?? 0,
        opened: h.opened ?? 0,
        clicked: h.clicked ?? 0,
        failed: h.failed ?? 0,
        skipped: h.skipped ?? 0,
        channels: perChannel.rows,
      },
    });
  } catch (error) {
    logError("broadcast metrics", error);
    return NextResponse.json({ success: false, error: "فشل الجلب" }, { status: 500 });
  }
}