import { NextRequest, NextResponse } from "next/server";
import {
  PAYMENT_INITIATE_CONFIG,
  PAYMENT_INITIATE_IP_CONFIG,
} from "@/lib/rate-limit";
import { error as logError } from "@/lib/logger";
import {
  applyPaymentRateLimits,
  authorizeOrderForPayment,
  commitOrderLock,
  ONLINE_RETRY_METHODS,
  parsePaymentBody,
  rateLimitResponseHeaders,
  rollbackOrderLock,
  validateOrderId,
  MAX_IDEMPOTENCY_KEY,
} from "@/lib/payments/payment-service";
import {
  initiateOnlinePayment,
  initiateTamaraPayment,
  isMoyasarInlineCheckoutEnabled,
  isTamaraEnabled,
} from "@/lib/payments/initiate";

/**
 * POST /api/v1/payments/retry
 *
 * Initiates (or re-initiates) an online payment for an existing customer
 * order. The endpoint covers three flows:
 *   - `pay`     — order was created with cash/wallet and the customer
 *                 wants to switch to online payment, or it's simply unpaid
 *                 with no provider attempt yet.
 *   - `retry`   — a previous online attempt failed (status='failed', and
 *                 possibly 'cancelled' because checkout auto-cancels on
 *                 init failure). The endpoint reactivates the parent and
 *                 its vendor children back to 'pending' so the regular
 *                 confirmation webhooks settle the order normally.
 *   - `none`    — terminal or already-paid orders return 409.
 *
 * Thin handler — the shared "resolve caller + rate-limit + authorize
 * order" pipeline lives in src/lib/payments/payment-service.ts. This
 * route only adds the retry-specific body validation (paymentMethod in
 * ONLINE_RETRY_METHODS, no tamara — that's checkout-only) and the
 * three gateway dispatch branches (inline / Tamara / hosted).
 *
 * SECURITY:
 *   - Server-authoritative total: never read from the request body,
 *     always from `orders.total` via authorizeOrderForPayment.
 *   - SELECT ... FOR UPDATE inside the service locks the parent row
 *     so a concurrent paid webhook can't slip past the eligibility check.
 *   - CSRF is enforced by the proxy because the path is NOT in
 *     CSRF_EXEMPT_PATHS.
 *   - Per-user + per-IP rate limits to cap provider quota burn.
 *   - Provider idempotency key is forwarded so the gateway dedupes
 *     parallel retry clicks.
 */

function errorResponse(status: number, message: string) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function successResponse(body: Record<string, unknown>) {
  return NextResponse.json({ success: true, ...body });
}

export async function POST(request: NextRequest) {
  const userId = await import('@/lib/identity').then((m) =>
    m.resolveCustomerUserIdFromRequest(request),
  );
  if (!userId) {
    return errorResponse(401, "يجب تسجيل الدخول");
  }

  const rl = await applyPaymentRateLimits(
    request,
    userId,
    PAYMENT_INITIATE_CONFIG,
    PAYMENT_INITIATE_IP_CONFIG,
  );
  if (rl.kind === "rate_limited") {
    const message =
      rl.by === "user"
        ? "تم تجاوز عدد محاولات الدفع. انتظر قليلاً ثم أعد المحاولة"
        : "تم تجاوز عدد محاولات الدفع من هذا الجهاز. انتظر قليلاً ثم أعد المحاولة";
    return NextResponse.json(
      {
        error: message,
        retryAfter: Math.ceil((rl.result.retryAfterMs || 0) / 1000),
      },
      { status: 429, headers: rateLimitResponseHeaders(rl.by, rl.result) },
    );
  }

  const body = (await parsePaymentBody(request)) as
    | {
        orderId?: unknown;
        paymentMethod?: unknown;
        idempotencyKey?: unknown;
      }
    | null;
  if (!body) return errorResponse(400, "بيانات الطلب غير صالحة");

  const orderId = validateOrderId(body.orderId);
  if (!orderId) return errorResponse(400, "رقم الطلب غير صالح");

  if (typeof body.paymentMethod !== "string") {
    return errorResponse(400, "طريقة الدفع غير صالحة");
  }
  const paymentMethod = body.paymentMethod;
  // Tamara is an order-level choice made at checkout, not a per-retry
  // method. Reject early so a stale client never silently re-charges.
  if (paymentMethod === "tamara") {
    return errorResponse(409, "تمارا تتطلب إنشاء طلب جديد");
  }
  if (!ONLINE_RETRY_METHODS.has(paymentMethod)) {
    return errorResponse(400, "طريقة الدفع غير مدعومة");
  }
  if (
    typeof body.idempotencyKey !== "string" ||
    body.idempotencyKey.length === 0 ||
    body.idempotencyKey.length > MAX_IDEMPOTENCY_KEY
  ) {
    return errorResponse(400, "معرّف المحاولة مطلوب");
  }
  const idempotencyKey = body.idempotencyKey;

  const auth = await authorizeOrderForPayment({ orderId, userId });
  if (auth.kind !== "ok") {
    return mapAuthError(auth);
  }

  const { owner, serverTotal } = auth.value;

  // Load the customer contact (registered users fallback to users table).
  let userContact: { name: string | null; phone: string | null; email: string | null } | null = null;
  if (owner.user_id) {
    const userRes = await auth.value.client.query<{
      name: string | null;
      phone: string | null;
      email: string | null;
    }>(`SELECT name, phone, email FROM users WHERE id = $1`, [owner.user_id]);
    userContact = userRes.rows[0] ?? null;
  }
  const contact = pickContact(owner, userContact);

  try {
    // Reactivate auto-cancelled orders so the new attempt can settle them.
    if (owner.status === "cancelled") {
      await auth.value.client.query(
        `UPDATE orders SET status = 'pending' WHERE id = $1`,
        [orderId],
      );
    }

    // Inline (MPF) path: we still mark the parent as 'pending' but skip
    // creating a hosted invoice — the client mounts the inline form.
    if (isMoyasarInlineCheckoutEnabled()) {
      await auth.value.client.query(
        `UPDATE orders SET payment_status = 'pending' WHERE id = $1`,
        [orderId],
      );
      await auth.value.client.query(
        `UPDATE vendor_orders SET payment_status = 'pending'
         WHERE parent_order_id = $1`,
        [orderId],
      );
      await commitOrderLock(auth.value);
      return successResponse({
        orderId,
        mode: "inline",
        inlinePayment: true,
        paymentUrl: null,
        paymentReference: null,
        total: serverTotal,
        paymentMethod,
        totalSar: serverTotal,
      });
    }

    const items = [{ name: "طلب سيتي ماركت", quantity: 1, unitPrice: serverTotal }];

    // Tamara retry: opt-in only — most failed Tamara orders should be
    // recreated from checkout instead of re-initiated here.
    if (paymentMethod === "tamara" && isTamaraEnabled()) {
      const tResult = await initiateTamaraPayment({
        orderId,
        totalSar: serverTotal,
        description: `طلب سيتي ماركت #${orderId.slice(-8)}`,
        customerName: contact.name,
        customerPhone: contact.phone,
        customerEmail: contact.email,
        items: items.map((i) => ({ ...i, unitPriceSar: i.unitPrice })),
        idempotencyKey,
      });
      if (!tResult.success || !tResult.paymentUrl || !tResult.referenceId) {
        await auth.value.client.query(
          `UPDATE orders SET payment_status = 'failed' WHERE id = $1`,
          [orderId],
        );
        await commitOrderLock(auth.value);
        return errorResponse(502, tResult.error || "تعذّر الاتصال بتمارا");
      }
      await auth.value.client.query(
        `UPDATE orders SET payment_method = 'tamara', payment_reference = $1,
                payment_status = 'pending' WHERE id = $2`,
        [String(tResult.referenceId), orderId],
      );
      await auth.value.client.query(
        `UPDATE vendor_orders SET payment_method = 'tamara', payment_status = 'pending'
         WHERE parent_order_id = $1`,
        [orderId],
      );
      await commitOrderLock(auth.value);
      return successResponse({
        orderId,
        mode: "hosted",
        inlinePayment: false,
        paymentUrl: tResult.paymentUrl,
        paymentReference: tResult.referenceId,
        provider: "tamara",
        total: serverTotal,
      });
    }

    // Hosted Moyasar path.
    const result = await initiateOnlinePayment({
      amount: serverTotal,
      orderId,
      customerName: contact.name,
      customerMobile: contact.phone,
      customerEmail: contact.email,
      items,
      idempotencyKey,
    });
    if (!result.success || !result.paymentUrl || !result.referenceId) {
      await auth.value.client.query(
        `UPDATE orders SET payment_status = 'failed' WHERE id = $1`,
        [orderId],
      );
      await commitOrderLock(auth.value);
      return errorResponse(502, result.error || "تعذّر فتح بوابة الدفع الإلكتروني");
    }

    await auth.value.client.query(
      `UPDATE orders SET payment_method = $1, payment_reference = $2,
              payment_status = 'pending' WHERE id = $3`,
      ["moyasar", String(result.referenceId), orderId],
    );
    await auth.value.client.query(
      `UPDATE vendor_orders SET payment_method = $1, payment_status = 'pending'
       WHERE parent_order_id = $2`,
      ["moyasar", orderId],
    );
    await commitOrderLock(auth.value);

    return successResponse({
      orderId,
      mode: "hosted",
      inlinePayment: false,
      paymentUrl: result.paymentUrl,
      paymentReference: result.referenceId,
      provider: result.provider,
      total: serverTotal,
      paymentMethod,
      totalSar: serverTotal,
    });
  } catch (error) {
    await rollbackOrderLock(auth.value);
    logError("Payment retry error:", error);
    return errorResponse(500, "حدث خطأ أثناء محاولة الدفع");
  }
}

function pickContact(
  owner: { guest_name: string | null; guest_phone: string | null; guest_email: string | null },
  user: { name: string | null; phone: string | null; email: string | null } | null,
) {
  return {
    name: owner.guest_name || user?.name || "عميل",
    phone: owner.guest_phone || user?.phone || "0500000000",
    email: owner.guest_email || user?.email || undefined,
  };
}

function mapAuthError(
  auth: Exclude<
    Awaited<ReturnType<typeof authorizeOrderForPayment>>,
    { kind: "ok" }
  >,
): NextResponse {
  switch (auth.kind) {
    case "not_found":
      return errorResponse(404, "الطلب غير موجود");
    case "forbidden":
      return errorResponse(403, "غير مصرح");
    case "ineligible":
      return errorResponse(409, auth.error);
    case "invalid_total":
      return errorResponse(400, "إجمالي الطلب غير صالح");
  }
}
