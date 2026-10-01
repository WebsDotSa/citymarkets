/**
 * POST /api/v1/orders/[id]/refund
 *
 * Customer-initiated refund request. Customers can request a full refund
 * for orders they own (logged-in OR guest via the order's idempotency_key)
 * within a 24-hour window of confirmation. The endpoint is a *request*
 * endpoint: it queues the refund for admin approval so a customer cannot
 * reverse a paid order without operator oversight. The actual Moyasar
 * refund call is performed by the admin endpoint at
 * `/api/admin/orders/[id]/refund` (PCP-82).
 *
 * Auth (ownership):
 *   • Logged-in customer → `orders.user_id = <jwt-userId>`
 *   • Guest              → the body's `idempotency_key` must match the
 *     order's stored `idempotency_key` (the secret minted at checkout
 *     time and only the order creator ever sees it).
 *
 * Body:
 *   {
 *     reason?: string,    // free-text reason (stored in order_status_logs)
 *     idempotency_key?: string  // required for guest checkouts
 *   }
 *
 * Returns:
 *   200 → { success: true, status: 'refund_requested', refund_request_id }
 *   400 → { error }
 *   401 → { error: 'auth required' }    (when neither auth path matches)
 *   403 → { error: 'not order owner' }
 *   409 → { error: 'not in refundable state' }
 *
 * Side effects:
 *   - Inserts a `refund_requests` row (UNIQUE per order_id) — admin approval
 *     picks it up and executes the gateway call.
 *   - Inserts an `order_status_logs` row noting the request was filed.
 */
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from "@/lib/identity";
import { applyCsrfProtection } from "@/lib/csrf";
import { info as logInfo } from "@/lib/logger";

import { validateUuidOrError } from "@/lib/api/uuid-guard";
const REFUND_WINDOW_HOURS = 24;
const ALLOWED_PRE_STATUSES = new Set(["confirmed", "preparing", "ready", "out_for_delivery", "delivered"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrf = await applyCsrfProtection(request);
  if (csrf) return csrf;

  const { id: orderId } = await params;
  const badId = validateUuidOrError(orderId, "معرّف الطلب");
  if (badId) return badId;
  if (!orderId || typeof orderId !== "string") {
    return NextResponse.json({ error: "معرّف الطلب مطلوب" }, { status: 400 });
  }

  // ---- Body ----
  let body: { reason?: string; idempotency_key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "بيانات غير صالحة" }, { status: 400 });
  }
  const reason = (body.reason ?? "").trim().slice(0, 500) || null;
  const idempotencyKey = (body.idempotency_key ?? "").trim();

  // ---- Auth ----
  const userId = await resolveCustomerUserIdFromRequest(request);

  const client = await pool.connect();
  let refundRequestId: string | null = null;
  try {
    await client.query("BEGIN");

    // ---- Lock the order + ownership check ----
    const lock = await client.query<{
      id: string;
      user_id: string | null;
      idempotency_key: string | null;
      payment_status: string;
      status: string;
      payment_reference: string | null;
      created_at: Date;
    }>(
      `SELECT id, user_id, idempotency_key, payment_status, status, payment_reference, created_at
         FROM orders
        WHERE id = $1
        FOR UPDATE`,
      [orderId],
    );

    if (lock.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
    }
    const order = lock.rows[0];

    // ownership
    if (userId) {
      if (order.user_id !== userId) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "هذا الطلب ليس ملكك" }, { status: 403 });
      }
    } else if (idempotencyKey && order.idempotency_key === idempotencyKey) {
      // guest path accepted
    } else {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "يلزم تسجيل الدخول أو مفتاح الارتباط لإتمام الاسترداد." },
        { status: 401 },
      );
    }

    // must have a paid payment we can refund
    if (order.payment_status !== "paid") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "لا يمكن طلب استرداد لهذا الطلب في حالته الحالية." },
        { status: 409 },
      );
    }
    if (!order.payment_reference) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "لا يوجد مرجع بوابة دفع مرتبط بهذا الطلب." },
        { status: 409 },
      );
    }

    // refuse if the order is in a state the customer cannot unilaterally refund)
    if (!ALLOWED_PRE_STATUSES.has(order.status)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "لا يمكن استرداد الطلب في حالته الحالية. تواصل مع الدعم." },
        { status: 409 },
      );
    }

    // 24-hour window from order creation (not payment time — order.created_at
    // is the only timestamp the customer can read).
    const ageMs = Date.now() - new Date(order.created_at).getTime();
    if (ageMs > REFUND_WINDOW_HOURS * 60 * 60 * 1000) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "انتهت مهلة طلب الاسترداد (24 ساعة من إنشاء الطلب)." },
        { status: 409 },
      );
    }

    // ---- Idempotency: refuse duplicate pending requests ----
    const dup = await client.query<{ id: string; status: string }>(
      `SELECT id, status
         FROM refund_requests
        WHERE order_id = $1
          AND status IN ('pending', 'approved')
        FOR UPDATE`,
      [orderId],
    );
    if (dup.rowCount && dup.rowCount > 0) {
      const existing = dup.rows[0];
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          success: true,
          status: existing.status === "approved" ? "refund_approved" : "refund_requested",
          refund_request_id: existing.id,
          already_pending: true,
        },
        { status: 200 },
      );
    }

    // ---- Insert refund_requests row ----
    const ins = await client.query<{ id: string }>(
      `INSERT INTO refund_requests (order_id, requested_by_user_id, reason, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id`,
      [orderId, userId ?? null, reason],
    );
    refundRequestId = ins.rows[0]?.id ?? null;

    // ---- Write to order_status_logs ----
    await client.query(
      `INSERT INTO order_status_logs (order_id, status, notes, created_by)
       VALUES ($1, $2, $3, $4)`,
      [orderId, order.status, `طلب استرداد: ${reason ?? "بدون سبب"}`, userId ?? null],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logInfo(`[orders/refund] error on order ${orderId}: ${(err as Error).message}`);
    return NextResponse.json({ error: "تعذّر تسجيل طلب الاسترداد" }, { status: 500 });
  } finally {
    client.release();
  }

  return NextResponse.json(
    { success: true, status: "refund_requested", refund_request_id: refundRequestId },
    { status: 200 },
  );
}