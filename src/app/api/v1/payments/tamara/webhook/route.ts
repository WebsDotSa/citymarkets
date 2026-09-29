import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  fetchOrderStatus,
  getTamaraWebhookToken,
  verifyWebhookSignature,
} from "@/lib/payments/tamara";
import { awardPointsForOrder, getLoyaltySettings, resolveRedeemForOrder } from '@/lib/orders/loyalty';
import { error as logError, warn as logWarn, info as logInfo } from "@/lib/logger";

/**
 * Tamara webhook — POST from Tamara's servers on order status changes
 * (approved, declined, expired, cancelled, captured, fully_captured, refunded).
 *
 * Payload shape (Tamara docs):
 *   {
 *     "order_id":          "<our order_reference_id, stored as payment_reference>",
 *     "order_status":      "approved" | "declined" | "expired" | ...,
 *     "tamara_order_id":   "<checkout_id from /checkout>",
 *     "payment_type":      "PAY_BY_INSTALMENTS",
 *     "is_mobile":         false,
 *     ...
 *   }
 *
 * Security measures:
 *  1. Verify Authorization: Bearer <TAMARA_WEBHOOK_TOKEN> matches our
 *     configured token (constant-time compare). Refuse when no token is
 *     configured in production.
 *  2. Re-verify the order status by calling Tamara's GET /orders/{id}
 *     endpoint before crediting loyalty — never trust the webhook body
 *     amount or status blindly.
 *  3. Look up the parent order by `payment_reference = tamara_order_id`
 *     (the value we stored at checkout creation). The body `order_id`
 *     is never used as the source of truth.
 *  4. Idempotent (webhook can fire several times for the same event).
 *
 * Maps Tamara → internal payment_status:
 *   approved / captured / fully_captured → paid
 *   declined / cancelled / expired       → failed
 *   otherwise                            → pending
 */
function mapTamaraStatusToDb(remote: string): "paid" | "failed" | "pending" {
  if (remote === "approved" || remote === "captured" || remote === "fully_captured") {
    return "paid";
  }
  if (
    remote === "declined" ||
    remote === "cancelled" ||
    remote === "expired" ||
    remote === "canceled"
  ) {
    return "failed";
  }
  return "pending";
}

export async function POST(request: NextRequest) {
  // ---- 1. Verify signature ----
  const authHeader = request.headers.get("authorization");
  // SECURITY (F5): verifyWebhookSignature now THROWS when the token is
  // unset (it no longer silently accepts unsigned webhooks). We catch
  // here so we can return a proper 401. ALLOW_INSECURE_WEBHOOK is now
  // ignored — if a developer needs unsigned webhooks for local testing,
  // they must stub the function in their test harness.
  if (!getTamaraWebhookToken()) {
    logError("Tamara webhook: TAMARA_WEBHOOK_TOKEN is not configured; rejecting webhook");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    if (!verifyWebhookSignature(authHeader)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    order_id?: string;
    order_status?: string;
    tamara_order_id?: string;
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const checkoutId = body.tamara_order_id;
  if (!checkoutId || typeof checkoutId !== "string") {
    // Tamara expects a 2xx so they don't retry; log and ack.
    logWarn("Tamara webhook: missing tamara_order_id", { body });
    return NextResponse.json({ received: true });
  }

  try {
    // ---- 2. Re-verify with Tamara API (defense against spoofed webhooks) ----
    const verified = await fetchOrderStatus(checkoutId);
    if (!verified.success || !verified.status) {
      logWarn("Tamara webhook: re-verify failed", { checkoutId, error: verified.error });
      return NextResponse.json({ received: true });
    }
    const paymentDb = mapTamaraStatusToDb(verified.status);
    const verifiedAmountHalalas =
      typeof verified.amount === "number" ? verified.amount : null;
    const verifiedCurrency =
      typeof verified.currency === "string" ? verified.currency.toUpperCase() : null;

    // ---- 3. Find the parent order via payment_reference (checkout_id) ----
    const owner = await pool.query(
      `SELECT id::text AS id,
              total::numeric AS total,
              catalog_subtotal::numeric AS catalog_subtotal,
              user_id,
              points_redeemed::numeric AS points_redeemed,
              payment_status,
              status,
              guest_phone,
              guest_name
         FROM orders
        WHERE payment_reference = $1`,
      [checkoutId],
    );
    if (owner.rows.length === 0) {
      logWarn("Tamara webhook: no order for checkout", { checkoutId });
      return NextResponse.json({ received: true });
    }
    const orderRow = owner.rows[0];
    const orderId = orderRow.id;
    const orderTotal = Number(orderRow.total);
    let recoveredCount = 0;
    let guestPhone: string | null =
      orderRow.guest_phone != null && orderRow.guest_phone !== ""
        ? String(orderRow.guest_phone)
        : null;

    // ---- 4. Currency / amount guard (mirror Moyasar callback) ----
    if (paymentDb === "paid") {
      if (verifiedCurrency && verifiedCurrency !== "SAR") {
        logWarn(
          `[tamara] order ${orderId} paid in ${verifiedCurrency}, expected SAR`,
        );
        return NextResponse.json({ received: true });
      }
      if (
        verifiedAmountHalalas !== null &&
        verifiedAmountHalalas + 1 < Math.round(orderTotal * 100)
      ) {
        logWarn(
          `[tamara] order ${orderId} paid ${verifiedAmountHalalas / 100} < ${orderTotal}`,
        );
        return NextResponse.json({ received: true });
      }
    }

    // ---- 5. Per-order advisory lock + idempotent update ----
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `order:${orderId}`,
      ]);

      // Never regress a Paid/Failed order back to Pending.
      await client.query(
        `UPDATE orders
            SET payment_status = CASE
              WHEN payment_status = 'paid'   THEN 'paid'
              WHEN payment_status = 'failed' AND $1 = 'pending' THEN 'failed'
              ELSE $1
            END,
            payment_method = COALESCE(payment_method, 'tamara'),
            updated_at = NOW()
          WHERE id = $2`,
        [paymentDb, orderId],
      );
      // Slice 3 fan-out to vendor_orders children.
      await client.query(
        `UPDATE vendor_orders
            SET payment_status = CASE
              WHEN payment_status = 'paid'   THEN 'paid'
              WHEN payment_status = 'failed' AND $1 = 'pending' THEN 'failed'
              ELSE $1
            END,
            updated_at = NOW()
          WHERE parent_order_id = $2`,
        [paymentDb, orderId],
      );

      if (paymentDb === "paid") {
        // Lifecycle: roll status forward but never go backwards.
        await client.query(
          `UPDATE orders
              SET status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END
            WHERE id = $1`,
          [orderId],
        );
        await client.query(
          `UPDATE vendor_orders
              SET status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END
            WHERE parent_order_id = $1`,
          [orderId],
        );

        // Resolve any pending_redeem hold into a real debit.
        const userId = orderRow.user_id;
        const redeemPoints = Math.floor(Number(orderRow.points_redeemed ?? 0));
        if (userId && redeemPoints > 0) {
          try {
            await resolveRedeemForOrder(client, {
              orderId,
              userId,
              pointsRedeemed: redeemPoints,
            });
          } catch (e) {
            logError("[tamara] loyalty redeem resolve failed", e, { orderId });
          }
        }

        // Award loyalty on the catalog_subtotal (Slice 3 policy).
        const catalogSubtotal = Number(orderRow.catalog_subtotal ?? 0);
        if (userId && catalogSubtotal > 0) {
          try {
            const loyaltySettings = await getLoyaltySettings();
            await awardPointsForOrder(client, {
              orderId,
              userId,
              catalogSubtotal,
              settings: loyaltySettings,
            });
          } catch (e) {
            logError("[tamara] loyalty earn failed", e, { orderId });
          }
        }

        // Recover any abandoned carts that belong to this customer.
        // Best-effort: the helper is idempotent — re-running on a webhook
        // replay is safe — and we don't want a snapshot miss to block the
        // payment confirmation.
        try {
          const { markAbandonedCartRecovered } = await import('@/lib/orders/abandoned-carts');
          const { recovered_count } = await markAbandonedCartRecovered(
            orderId,
            {
              user_id: orderRow.user_id || null,
              guest_phone: guestPhone,
            },
          );
          recoveredCount = recovered_count;
        } catch (e) {
          logError("[tamara] abandoned-carts recovery failed", e, { orderId });
        }
      }

      await client.query("COMMIT");
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* noop */
      }
      throw e;
    } finally {
      client.release();
    }

    // ---- 6. Fire-and-forget push notification ----
    try {
      if (orderRow.user_id) {
        const { sendPushToUser } = await import("@/lib/push");
        await sendPushToUser(orderRow.user_id, {
          title: paymentDb === "paid" ? "تم الدفع بنجاح ✅" : "تم تحديث حالة طلبك",
          body: `طلبك #${String(orderId).slice(0, 8)} — ${paymentDb}`,
          url: `/orders`,
          tag: `order-${orderId}`,
        });
      }
    } catch (e) {
      logError("[tamara] push notify failed", e);
    }

    // ---- 7. Fire-and-forget post-payment SMS ----
    if (paymentDb === "paid" && recoveredCount > 0) {
      try {
        const { enqueueOrderPaidSms } = await import("@/lib/queue");
        // Worker re-fetches the order + recovered count, so just pass orderId.
        void enqueueOrderPaidSms(orderId);
      } catch (e) {
        logError("[tamara] paid-confirm sms dispatch failed", e, { orderId });
      }
    }

    logInfo(
      `Tamara webhook order=${orderId} status=${paymentDb} (gateway=${verified.status})`,
    );
    return NextResponse.json({ received: true });
  } catch (error) {
    logError("Tamara webhook error", error, { checkoutId });
    return NextResponse.json({ received: true });
  }
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    status: "ok",
    message: "Tamara webhook endpoint (non-production ping)",
  });
}