// Admin: trigger a broadcast send (immediate or scheduled).
//
// For immediate sends we expand the audience inline and mark the
// broadcast `sending` so the worker tick picks the rows up. For
// future-dated sends we just flip status to `scheduled` and the
// worker promotes it once the time comes.

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/admin-api-auth";
import { uuidSchema, type BroadcastChannel } from "@/lib/validation";
import { logAdminAction } from "@/lib/admin-audit";
import { error as logError } from "@/lib/logger";
import {
  BROADCAST_SEND_CONFIG,
  BROADCAST_SEND_IP_CONFIG,
  checkRateLimit,
  createRateLimitHeaders,
} from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { expandBroadcastAudience, type AudienceFilter } from "@/lib/broadcasts/audience";

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

  const ip = getClientIp(request);
  const [rlAdmin, rlIp] = await Promise.all([
    checkRateLimit(gate.admin.id, BROADCAST_SEND_CONFIG),
    checkRateLimit(ip, BROADCAST_SEND_IP_CONFIG),
  ]);
  const headers = createRateLimitHeaders(rlAdmin);
  if (!rlAdmin.allowed || !rlIp.allowed) {
    return NextResponse.json(
      { success: false, error: "تم تجاوز حد الإرسال، حاول بعد 10 دقائق" },
      { status: 429, headers },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(
      `SELECT status, scheduled_at, audience, channels
         FROM broadcasts WHERE id = $1 FOR UPDATE`,
      [params.id],
    );
    if (cur.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "غير موجود" }, { status: 404 });
    }
    const status = cur.rows[0].status;
    if (!["draft", "scheduled"].includes(status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: "لا يمكن إعادة إرسال بث قيد الإرسال أو تم إرساله" },
        { status: 409 },
      );
    }

    const now = new Date();
    const scheduledAt = cur.rows[0].scheduled_at ? new Date(cur.rows[0].scheduled_at) : null;
    const isFuture = !!scheduledAt && scheduledAt > now;
    const audience = cur.rows[0].audience as AudienceFilter;
    const channels = (cur.rows[0].channels ?? []) as BroadcastChannel[];

    if (isFuture) {
      await client.query(
        `UPDATE broadcasts SET status='scheduled', updated_at=NOW() WHERE id=$1`,
        [params.id],
      );
    } else {
      await client.query(
        `UPDATE broadcasts SET status='sending', started_at=NOW(), updated_at=NOW()
           WHERE id=$1`,
        [params.id],
      );
      await expandBroadcastAudience(client, params.id, audience, channels);
    }

    await client.query("COMMIT");

    await logAdminAction(gate.admin, "broadcast.send", {
      entityType: "broadcast",
      entityId: params.id,
      details: { immediate: !isFuture },
      request,
    });

    return NextResponse.json(
      { success: true, status: isFuture ? "scheduled" : "sending" },
      { headers },
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    logError("broadcast send POST", error);
    return NextResponse.json({ success: false, error: "فشل الإرسال" }, { status: 500 });
  } finally {
    client.release();
  }
}
