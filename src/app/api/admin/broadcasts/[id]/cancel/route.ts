// Admin: cancel a scheduled broadcast (or any non-terminal state).

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-api-auth";
import { uuidSchema } from "@/lib/validation";
import { logAdminAction } from "@/lib/admin-audit";
import { error as logError } from "@/lib/logger";

export async function POST(
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
    const cur = await pool.query(`SELECT status FROM broadcasts WHERE id = $1`, [params.id]);
    if (cur.rows.length === 0) {
      return NextResponse.json({ success: false, error: "غير موجود" }, { status: 404 });
    }
    const status = cur.rows[0].status;
    if (["sent", "cancelled", "failed"].includes(status)) {
      return NextResponse.json(
        { success: false, error: "البث في حالة نهائية بالفعل" },
        { status: 409 },
      );
    }
    await pool.query(
      `UPDATE broadcasts SET status='cancelled', finished_at=NOW(), updated_at=NOW() WHERE id=$1`,
      [params.id],
    );
    await logAdminAction(gate.admin, "broadcast.cancel", {
      entityType: "broadcast",
      entityId: params.id,
      details: { previousStatus: status },
      request,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logError("broadcast cancel", error);
    return NextResponse.json({ success: false, error: "فشل الإلغاء" }, { status: 500 });
  }
}