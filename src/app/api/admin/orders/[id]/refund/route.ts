/**
 * POST /api/admin/orders/[id]/refund
 *
 * Admin-side refund execution. Approves a pending refund_request
 * (or starts a fresh refund for an order without one) and calls
 * Moyasar's refund API. Updates:
 *   - orders.payment_status = 'refunded'  on success
 *   - refund_requests.status = 'completed'  (was 'pending' or 'approved')
 *   - refund_requests.gateway_refund_id  from Moyasar response
 *   - order_status_logs row noting the refund
 *
 * Auth: requireAdminApi(request, 'manage_orders')
 *
 * Body:
 *   {
 *     amount_halalas?: number,    // omit / null for full refund
 *     refund_request_id?: string, // explicit pending request; admin may also
 *                                  // issue an ad-hoc refund without one
 *     reason?: string,            // optional admin note
 *   }
 *
 * Returns:
 *   200 → { success: true, refund_request_id, gateway_refund_id, payment_status: 'refunded' }
 *   4xx → { success: false, error }
 *
 * Idempotency:
 *   - If the order's payment_status is already 'refunded', the route
 *     returns 200 with the existing refund_request row (no double charge).
 *   - If two admins race, FOR UPDATE on the order serialises them; the
 *     second one sees payment_status='refunded' and short-circuits.
 *   - The gateway call uses an Idempotency-Key derived from the order
 *     UUID so a double-click of "Approve" cannot create two ledger rows
 *     even if the FOR UPDATE somehow fails.
 */
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import { refundMoyasarPayment } from "@/lib/payments/moyasar";
import { logAdminAction } from "@/lib/admin-audit";
import { error as logError, info as logInfo } from "@/lib/logger";
import { checkRateLimit, REFUND_REQUEST_CONFIG, REFUND_REQUEST_IP_CONFIG, createRateLimitHeaders } from "@/lib/rate-limit";
import { recordPaymentEvent, finalizePaymentEvent } from "@/lib/payments/event-ledger";
import { validateUuidOrError } from "@/lib/api/uuid-guard";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminApi(request, "manage_orders");
  if (gate instanceof NextResponse) return gate;

  // ---- Rate limit ----
  // PCP-114: refund endpoints need rate limiting. Without it a misclick
  // storm from an admin or a stolen admin session could fire many refund
  // calls in seconds (each one a Moyasar API hit + ledger write). The
  // per-user limit (3/hour) is the operational signal; the per-IP limit
  // (10/hour) covers admin sessions reused across shifts.
  const adminUserIdForRate = (gate as { userId?: string }).userId ?? "unknown";
  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const ipLimit = await checkRateLimit(clientIp, REFUND_REQUEST_IP_CONFIG);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { success: false, error: "تجاوز عدد عمليات الاسترداد. حاول بعد ساعة." },
      { status: 429, headers: createRateLimitHeaders(ipLimit) },
    );
  }
  const userLimit = await checkRateLimit(`admin:${adminUserIdForRate}`, REFUND_REQUEST_CONFIG);
  if (!userLimit.allowed) {
    return NextResponse.json(
      { success: false, error: "تجاوز عدد عمليات الاسترداد لهذا المستخدم. حاول بعد ساعة." },
      { status: 429, headers: createRateLimitHeaders(userLimit) },
    );
  }

  const { id: orderId } = await params;
  if (!orderId || typeof orderId !== "string") {
    return NextResponse.json({ success: false, error: "معرّف الطلب مطلوب" }, { status: 400 });
  }
  const badId = validateUuidOrError(orderId, "معرّف الطلب");
  if (badId) return badId;

  let payload: { amount_halazas?: number; refund_request_id?: string; reason?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "بيانات غير صالحة" }, { status: 400 });
  }
  const amountHalalas = typeof payload.amount_halazas === "number" && payload.amount_halazas > 0
    ? payload.amount_halazas
    : null;
  const explicitRequestId = payload.refund_request_id ?? null;
  const reason = (payload.reason ?? "").trim().slice(0, 500) || null;
  const adminUserId = adminUserIdForRate !== "unknown" ? adminUserIdForRate : null;

  const client = await pool.connect();
  let refundRequestId: string | null = null;
  let gatewayRefundId: string | null = null;

  try {
    await client.query("BEGIN");

    // Lock the order row
    const lock = await client.query<{
      id: string;
      payment_status: string;
      status: string;
      payment_reference: string | null;
      total: number;
    }>(
      `SELECT id, payment_status, status, payment_reference, total
         FROM orders
        WHERE id = $1
        FOR UPDATE`,
      [orderId],
    );
    if (lock.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ success: false, error: "الطلب غير موجود" }, { status: 404 });
    }
    const order = lock.rows[0];

    if (!order.payment_reference) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: "لا يوجد مرجع بوابة دفع مرتبط بهذا الطلب." },
        { status: 409 },
      );
    }

    // Already refunded → idempotent return
    if (order.payment_status === "refunded") {
      const existing = await client.query<{ id: string; gateway_refund_id: string | null }>(
        `SELECT id, gateway_refund_id
           FROM refund_requests
          WHERE order_id = $1
            AND status = 'completed'
          LIMIT 1`,
        [orderId],
      );
      await client.query("COMMIT");
      return NextResponse.json(
        {
          success: true,
          already_refunded: true,
          refund_request_id: existing.rows[0]?.id ?? null,
          gateway_refund_id: existing.rows[0]?.gateway_refund_id ?? null,
          payment_status: "refunded",
        },
        { status: 200 },
      );
    }

    if (order.payment_status !== "paid") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          success: false,
          error: "لا يمكن تنفيذ الاسترداد لطلب غير مدفوع.",
        },
        { status: 409 },
      );
    }

    // ---- Resolve refund_requests row ----
    let pendingRow: { id: string } | null = null;
    if (explicitRequestId) {
      const r = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM refund_requests WHERE id = $1 AND order_id = $2 FOR UPDATE`,
        [explicitRequestId, orderId],
      );
      if (r.rowCount === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { success: false, error: "طلب الاسترداد غير موجود" },
          { status: 404 },
        );
      }
      pendingRow = { id: r.rows[0].id };
    } else {
      // Look for the most recent pending request; if none, create one.
      const r = await client.query<{ id: string }>(
        `SELECT id FROM refund_requests
          WHERE order_id = $1
            AND status IN ('pending', 'approved')
          ORDER BY created_at DESC
          FOR UPDATE
          LIMIT 1`,
        [orderId],
      );
      if (r.rowCount && r.rowCount > 0) {
        pendingRow = { id: r.rows[0].id };
      } else {
        const ins = await client.query<{ id: string }>(
          `INSERT INTO refund_requests (order_id, requested_by_user_id, reason, status)
           VALUES ($1, $2, $3, 'approved')
           RETURNING id`,
          [orderId, adminUserId, reason ?? "admin-initiated refund"],
        );
        pendingRow = { id: ins.rows[0].id };
      }
    }
    refundRequestId = pendingRow!.id;

    // ---- Mark approved (the actual gateway call happens next) ----
    await client.query(
      `UPDATE refund_requests
          SET status = 'approved',
              approved_by_user_id = COALESCE($2, approved_by_user_id),
              refund_amount_halalas = $3,
              updated_at = NOW()
        WHERE id = $1`,
      [refundRequestId, adminUserId, amountHalalas],
    );

    // ---- Ledger row FIRST (idempotency guard) ----
    const eventType = "moyasar.refund";
    await recordPaymentEvent(client, {
      invoiceId: order.payment_reference,
      gateway: "moyasar",
      eventType,
      raw: { orderId, amountHalalas, reason, adminUserId },
    });

    // ---- Call Moyasar ----
    const result = await refundMoyasarPayment(order.payment_reference, amountHalalas);
    if (!result.success) {
      await client.query(
        `UPDATE refund_requests
            SET status = 'failed',
                error_message = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [refundRequestId, result.error ?? "unknown gateway error"],
      );
      await finalizePaymentEvent(client, {
        invoiceId: order.payment_reference,
        gateway: "moyasar",
        eventType,
        status: "failed",
        orderId,
      });
      await client.query("COMMIT");
      return NextResponse.json(
        { success: false, error: result.error ?? "تعذّر تنفيذ الاسترداد" },
        { status: 502 },
      );
    }

    gatewayRefundId = result.id ?? null;

    // ---- Success: flip order + refund_requests + log + audit ----
    await client.query(
      `UPDATE orders
          SET payment_status = 'refunded',
              updated_at = NOW()
        WHERE id = $1`,
      [orderId],
    );
    await client.query(
      `UPDATE refund_requests
          SET status = 'completed',
              gateway_refund_id = $2,
              completed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [refundRequestId, gatewayRefundId],
    );
    await client.query(
      `INSERT INTO order_status_logs (order_id, status, notes, created_by)
       VALUES ($1, $2, $3, $4)`,
      [
        orderId,
        order.status,
        `استرداد ${amountHalalas ? `جزئي (${amountHalalas / 100} ر.س)` : "كامل"} عبر ميسر${reason ? `: ${reason}` : ""}`,
        adminUserId,
      ],
    );
    await finalizePaymentEvent(client, {
      invoiceId: order.payment_reference,
      gateway: "moyasar",
      eventType,
      status: "processed",
      orderId,
    });

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logError(`[admin/orders/refund] error on order ${orderId}: ${(err as Error).message}`);
    return NextResponse.json(
      { success: false, error: "تعذّر تنفيذ الاسترداد" },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  logInfo(`[admin/orders/refund] order ${orderId} refunded → ${gatewayRefundId ?? "(no-id)"}`);
  logAdminAction(
    {
      id: adminUserId ?? "unknown",
      email: (gate as { email?: string }).email ?? "unknown",
      name: (gate as { name?: string }).name,
    },
    "refund.execute",
    {
      entityType: "order",
      entityId: orderId,
      details: {
        refund_request_id: refundRequestId,
        gateway_refund_id: gatewayRefundId,
        amount_halalas: amountHalalas,
      },
      request,
    },
  );

  return NextResponse.json(
    {
      success: true,
      refund_request_id: refundRequestId,
      gateway_refund_id: gatewayRefundId,
      payment_status: "refunded",
    },
    { status: 200 },
  );
}