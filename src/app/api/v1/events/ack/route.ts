// In-app / native push acknowledgment.
//
// Records `delivered_at` the first time a delivery is seen by the
// client, and `opened_at` on every subsequent ack. Idempotent — a
// repeat ack is a no-op on the same field.

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from '@/lib/identity';
import { error as logError } from "@/lib/logger";
import { eventsAckSchema as ackSchema } from "@/lib/validation";
import { checkRateLimit, createRateLimitHeaders, EVENTS_ACK_CONFIG } from "@/lib/rate-limit";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "invalid_json" }, { status: 400 });
  }
  const parsed = ackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "validation_failed" },
      { status: 400 },
    );
  }

  // SECURITY (PCP-138): per-user rate limit on push ack. Validation
  // above rejects bad input cheaply, so the bucket only sees real
  // ack attempts (PCP-133 lesson). 60/min is well above natural usage
  // and blocks scripted ack storms that would otherwise create
  // unbounded UPDATE churn on broadcast_deliveries.
  const ackRl = await checkRateLimit(`events:ack:${userId}`, EVENTS_ACK_CONFIG);
  if (!ackRl.allowed) {
    return NextResponse.json(
      { success: false, error: "rate_limited" },
      { status: 429, headers: createRateLimitHeaders(ackRl) },
    );
  }

  try {
    // First ensure the delivery belongs to the requesting user —
    // otherwise a logged-in user could ack any delivery.
    const owner = await pool.query(
      `SELECT 1 FROM broadcast_deliveries WHERE id = $1 AND user_id = $2`,
      [parsed.data.delivery_id, userId],
    );
    if (owner.rowCount === 0) {
      return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
    }

    const col = parsed.data.state === "delivered" ? "delivered_at" : "opened_at";
    await pool.query(
      `UPDATE broadcast_deliveries
          SET ${col} = COALESCE(${col}, NOW())
        WHERE id = $1`,
      [parsed.data.delivery_id],
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    logError("[events/ack] failed", err);
    return NextResponse.json({ success: false, error: "server_error" }, { status: 500 });
  }
}
