import { NextRequest, NextResponse } from "next/server";
import { createInvoice } from "@/lib/payments/moyasar";
import {
  PAYMENT_INITIATE_CONFIG,
  PAYMENT_INITIATE_IP_CONFIG,
} from "@/lib/rate-limit";
import { error as logError } from "@/lib/logger";
import {
  applyPaymentRateLimits,
  authorizeOrderForPayment,
  commitOrderLock,
  parsePaymentBody,
  rateLimitResponseHeaders,
  rollbackOrderLock,
} from "@/lib/payments/payment-service";

/**
 * POST /api/v1/payments/initiate
 *
 * Creates a Moyasar hosted-checkout invoice for an existing order. The
 * server-authoritative total is loaded from `orders` (never trusted
 * from the client) and the parent row is locked with SELECT ... FOR
 * UPDATE so a concurrent paid webhook can't race past the eligibility
 * check.
 *
 * Thin handler — the shared "resolve caller + rate-limit + authorize
 * order" pipeline lives in src/lib/payments/payment-service.ts. This
 * route only adds the invoice-specific body shape (customerName /
 * customerMobile / customerEmail / idempotencyKey) and the
 * `createInvoice` call.
 */
export async function POST(request: NextRequest) {
  const userId = await import("@/lib/customer-session").then((m) =>
    m.resolveCustomerUserIdFromRequest(request),
  );
  if (!userId) {
    return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
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

  const body = (await parsePaymentBody(request)) as {
    orderId?: unknown;
    customerName?: unknown;
    customerMobile?: unknown;
    customerEmail?: unknown;
    idempotencyKey?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "بيانات الطلب غير صالحة" }, { status: 400 });
  }
  if (typeof body.orderId !== "string" || body.orderId.length === 0) {
    return NextResponse.json({ error: "رقم الطلب غير صالح" }, { status: 400 });
  }
  const orderId = body.orderId;
  if (!body.customerName || !body.customerMobile) {
    return NextResponse.json({ error: "معلومات غير مكتملة" }, { status: 400 });
  }

  const auth = await authorizeOrderForPayment({
    orderId,
    userId,
    skipActionCheck: true, // initiate accepts any non-paid order
  });
  if (auth.kind !== "ok") {
    switch (auth.kind) {
      case "not_found":
        return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
      case "forbidden":
        return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
      case "ineligible":
        return NextResponse.json({ error: "تم دفع الطلب مسبقاً" }, { status: 409 });
      case "invalid_total":
        return NextResponse.json({ error: "إجمالي الطلب غير صالح" }, { status: 400 });
    }
  }

  // With skipActionCheck=true the service accepts any non-paid order,
  // but the original route explicitly rejected `paid` with 409. Mirror
  // that here so the client contract is unchanged.
  if (auth.value.owner.payment_status === "paid") {
    await rollbackOrderLock(auth.value);
    return NextResponse.json(
      { error: "تم دفع الطلب مسبقاً" },
      { status: 409 },
    );
  }

  const { serverTotal } = auth.value;
  try {
    const paymentResult = await createInvoice({
      amount: serverTotal,
      orderId,
      description: `طلب سيتي ماركت #${orderId.slice(-8)}`,
      customerName: String(body.customerName),
      idempotencyKey:
        typeof body.idempotencyKey === "string" && body.idempotencyKey.length > 0
          ? body.idempotencyKey
          : undefined,
    });

    if (!paymentResult.success) {
      await rollbackOrderLock(auth.value);
      return NextResponse.json({ error: paymentResult.error }, { status: 500 });
    }

    await auth.value.client.query(
      `UPDATE orders SET payment_method = 'moyasar', payment_reference = $1 WHERE id = $2`,
      [paymentResult.invoiceId, orderId],
    );
    await commitOrderLock(auth.value);

    return NextResponse.json({
      success: true,
      paymentUrl: paymentResult.paymentUrl,
      invoiceId: paymentResult.invoiceId,
    });
  } catch (error) {
    await rollbackOrderLock(auth.value);
    logError("Payment error:", error);
    return NextResponse.json({ error: "حدث خطأ" }, { status: 500 });
  }
}
