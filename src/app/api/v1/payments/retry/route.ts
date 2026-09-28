import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from "@/lib/customer-session";
import {
  checkRateLimit,
  PAYMENT_INITIATE_CONFIG,
  PAYMENT_INITIATE_IP_CONFIG,
  createRateLimitHeaders,
} from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import {
  initiateOnlinePayment,
  initiateTamaraPayment,
  isMoyasarInlineCheckoutEnabled,
  isTamaraEnabled,
} from "@/lib/payments/initiate";
import { getOrderPaymentAction } from "@/lib/order-payment-action";
import { error as logError, warn as logWarn, info as logInfo } from "@/lib/logger";

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
 * SECURITY:
 *   - Server-authoritative total and customer contact: never read from
 *     the request body, always from `orders` (or the linked `users` row
 *     when the order belongs to a registered user).
 *   - `SELECT ... FOR UPDATE` locks the parent row so a concurrent paid
 *     webhook can't slip past the eligibility check.
 *   - CSRF is enforced by the proxy because the path is NOT in
 *     `CSRF_EXEMPT_PATHS`.
 *   - Per-user + per-IP rate limits to cap provider quota burn.
 *   - Provider idempotency key is forwarded so the gateway dedupes
 *     parallel retry clicks.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IDEMPOTENCY_KEY = 64;

// Operator decision (2026-09-20): stc_pay removed from the retry picker.
// `bank_transfer` is intentionally absent — it is not retryable via this
// endpoint; the customer must re-confirm through the admin (no automated
// gateway to retry against).
const ONLINE_RETRY_METHODS = new Set([
  "mada",
  "visa",
  "mastercard",
  "amex",
  "apple_pay",
]);

type OwnerSnapshot = {
  id: string;
  user_id: string | null;
  total: string;
  payment_status: string;
  status: string;
  payment_method: string;
  guest_name: string | null;
  guest_phone: string | null;
  guest_email: string | null;
};

type UserContact = {
  name: string | null;
  phone: string | null;
  email: string | null;
};

function rateLimitResponse(
  result: { retryAfterMs?: number; remaining: number; resetAt: number },
  message: string,
  by: "user" | "ip",
) {
  const response = NextResponse.json(
    {
      error: message,
      retryAfter: Math.ceil((result.retryAfterMs || 0) / 1000),
    },
    { status: 429 },
  );
  Object.entries(createRateLimitHeaders(result as never)).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  response.headers.set("X-RateLimit-By", by);
  return response;
}

function errorResponse(status: number, message: string) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function successResponse(body: Record<string, unknown>) {
  return NextResponse.json({ success: true, ...body });
}

function pickContact(owner: OwnerSnapshot, user: UserContact | null) {
  return {
    name: owner.guest_name || user?.name || "عميل",
    phone: owner.guest_phone || user?.phone || "0500000000",
    email: owner.guest_email || user?.email || undefined,
  };
}

export async function POST(request: NextRequest) {
  const userId = await resolveCustomerUserIdFromRequest(request);
  if (!userId) {
    return errorResponse(401, "يجب تسجيل الدخول");
  }

  // Per-user cap first so a compromised session can't burn provider quota.
  const userLimit = await checkRateLimit(userId, PAYMENT_INITIATE_CONFIG);
  if (!userLimit.allowed) {
    return rateLimitResponse(
      userLimit,
      "تم تجاوز عدد محاولات الدفع. انتظر قليلاً ثم أعد المحاولة",
      "user",
    );
  }
  const clientIp = getClientIp(request);
  const ipLimit = await checkRateLimit(clientIp, PAYMENT_INITIATE_IP_CONFIG);
  if (!ipLimit.allowed) {
    return rateLimitResponse(
      ipLimit,
      "تم تجاوز عدد محاولات الدفع من هذا الجهاز. انتظر قليلاً ثم أعد المحاولة",
      "ip",
    );
  }

  // Body validation: only fields the client is allowed to influence.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "بيانات الطلب غير صالحة");
  }
  if (!body || typeof body !== "object") {
    return errorResponse(400, "بيانات الطلب غير صالحة");
  }
  const { orderId, paymentMethod, idempotencyKey } = body as {
    orderId?: unknown;
    paymentMethod?: unknown;
    idempotencyKey?: unknown;
  };
  if (typeof orderId !== "string" || !UUID_RE.test(orderId)) {
    return errorResponse(400, "رقم الطلب غير صالح");
  }
  if (typeof paymentMethod !== "string") {
    return errorResponse(400, "طريقة الدفع غير صالحة");
  }
  // Tamara is an order-level choice made at checkout, not a per-retry
  // method. Reject early so a stale client never silently re-charges.
  if (paymentMethod === "tamara") {
    return errorResponse(409, "تمارا تتطلب إنشاء طلب جديد");
  }
  if (!ONLINE_RETRY_METHODS.has(paymentMethod)) {
    return errorResponse(400, "طريقة الدفع غير مدعومة");
  }
  if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0 || idempotencyKey.length > MAX_IDEMPOTENCY_KEY) {
    return errorResponse(400, "معرّف المحاولة مطلوب");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockResult = await client.query<OwnerSnapshot>(
      `SELECT id, user_id::text AS user_id, total::text AS total,
              payment_status, status, payment_method,
              guest_name, guest_phone, guest_email
         FROM orders
        WHERE id = $1
        FOR UPDATE`,
      [orderId],
    );
    if (lockResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return errorResponse(404, "الطلب غير موجود");
    }
    const owner = lockResult.rows[0];
    if (String(owner.user_id ?? "") !== userId) {
      await client.query("ROLLBACK");
      // Avoid leaking ownership info; for guest orders the user_id is
      // null and the comparison fails — fall through to the
      // ineligible path below.
      if (owner.user_id === null) {
        return errorResponse(404, "الطلب غير موجود");
      }
      return errorResponse(403, "غير مصرح");
    }

    const action = getOrderPaymentAction({
      status: owner.status,
      paymentStatus: owner.payment_status,
      paymentMethod: owner.payment_method,
    });
    if (action === "none") {
      await client.query("ROLLBACK");
      return errorResponse(409, "لا يمكن إعادة محاولة الدفع على هذا الطلب");
    }
    if (paymentMethod === "tamara" && !isTamaraEnabled()) {
      await client.query("ROLLBACK");
      return errorResponse(409, "تمارا غير مفعّلة");
    }

    const serverTotal = Number(owner.total);
    if (!Number.isFinite(serverTotal) || serverTotal <= 0) {
      await client.query("ROLLBACK");
      return errorResponse(400, "إجمالي الطلب غير صالح");
    }

    // Load the customer contact (registered users fallback to users table).
    let userContact: UserContact | null = null;
    if (owner.user_id) {
      const userRes = await client.query<UserContact>(
        `SELECT name, phone, email FROM users WHERE id = $1`,
        [owner.user_id],
      );
      userContact = userRes.rows[0] ?? null;
    }
    const contact = pickContact(owner, userContact);

    // Reactivate auto-cancelled orders so the new attempt can settle them.
    if (action === "retry" && owner.status === "cancelled") {
      await client.query(
        `UPDATE orders SET status = 'pending' WHERE id = $1`,
        [orderId],
      );
    }

    // Inline (MPF) path: we still mark the parent as 'pending' but skip
    // creating a hosted invoice — the client mounts the inline form.
    if (paymentMethod !== "tamara" && isMoyasarInlineCheckoutEnabled()) {
      await client.query(
        `UPDATE orders SET payment_status = 'pending' WHERE id = $1`,
        [orderId],
      );
      // Mirror to vendor children so the admin views show the same state.
      await client.query(
        `UPDATE vendor_orders SET payment_status = 'pending'
         WHERE parent_order_id = $1`,
        [orderId],
      );
      await client.query("COMMIT");
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
    if (paymentMethod === "tamara") {
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
        await client.query(
          `UPDATE orders SET payment_status = 'failed' WHERE id = $1`,
          [orderId],
        );
        await client.query("COMMIT");
        return errorResponse(502, tResult.error || "تعذّر الاتصال بتمارا");
      }
      await client.query(
        `UPDATE orders SET payment_method = 'tamara', payment_reference = $1,
                payment_status = 'pending' WHERE id = $2`,
        [String(tResult.referenceId), orderId],
      );
      await client.query(
        `UPDATE vendor_orders SET payment_method = 'tamara', payment_status = 'pending'
         WHERE parent_order_id = $1`,
        [orderId],
      );
      await client.query("COMMIT");
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
      await client.query(
        `UPDATE orders SET payment_status = 'failed' WHERE id = $1`,
        [orderId],
      );
      await client.query("COMMIT");
      return errorResponse(502, result.error || "تعذّر فتح بوابة الدفع الإلكتروني");
    }

    await client.query(
      `UPDATE orders SET payment_method = $1, payment_reference = $2,
              payment_status = 'pending' WHERE id = $3`,
      [
        "moyasar",
        String(result.referenceId),
        orderId,
      ],
    );
    await client.query(
      `UPDATE vendor_orders SET payment_method = $1, payment_status = 'pending'
       WHERE parent_order_id = $2`,
      [
        "moyasar",
        orderId,
      ],
    );
    await client.query("COMMIT");

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
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    logError("Payment retry error:", error);
    return errorResponse(500, "حدث خطأ أثناء محاولة الدفع");
  } finally {
    client.release();
  }
}
