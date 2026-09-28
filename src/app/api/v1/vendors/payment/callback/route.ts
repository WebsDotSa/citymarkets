import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { fetchInvoice } from "@/lib/payments/moyasar";
import crypto from "crypto";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

/**
 * Verify Moyasar webhook signature
 * Uses HMAC-SHA256 with the webhook secret
 */
function verifyMoyasarSignature(
  payload: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;
  
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  
  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * GET /api/v1/vendors/payment/callback
 * Moyasar payment callback - redirects from payment page
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("order_id");
  const status = searchParams.get("status");
  const id = searchParams.get("id"); // Moyasar invoice ID

  if (!orderId) {
    return NextResponse.redirect(new URL("/?payment=error", request.url));
  }

  try {
    if (id) {
      // Verify with Moyasar
      const result = await fetchInvoice(id);

      if (result.success && result.status === "paid") {
        // Update order status
        await query(
          `UPDATE vendor_orders
           SET payment_status = 'paid',
               status = 'confirmed',
               confirmed_at = NOW(),
               updated_at = NOW()
           WHERE order_number = $1`,
          [orderId]
        );

        // Redirect to success page
        return NextResponse.redirect(
          new URL(`/vendors/success?order=${orderId}`, request.url)
        );
      }
    }

    // Payment failed or not verified
    return NextResponse.redirect(
      new URL(`/vendors/failed?order=${orderId}`, request.url)
    );
  } catch (error) {
    logError("Vendor payment callback error:", error);
    return NextResponse.redirect(
      new URL(`/?payment=error&order=${orderId}`, request.url)
    );
  }
}

/**
 * POST /api/v1/vendors/payment/callback
 * Moyasar webhook callback for payment status updates
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const body = JSON.parse(rawBody);

    // Verify webhook signature if webhook secret is configured
    const webhookSecret = process.env.MOYASAR_WEBHOOK_SECRET;
    const signature = request.headers.get("x-moyasar-signature");
    
    if (webhookSecret) {
      const isValid = verifyMoyasarSignature(rawBody, signature, webhookSecret);
      if (!isValid) {
        logWarn("[Webhook] Invalid signature from Moyasar");
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 401 }
        );
      }
    } else if (process.env.NODE_ENV === "production") {
      // Reject webhooks without signature in production
      logWarn("[Webhook] No webhook secret configured in production");
      return NextResponse.json(
        { error: "Webhook not configured" },
        { status: 500 }
      );
    }

    if (body.type === "invoice.paid") {
      const invoiceId = body.data?.id;
      const metadata = body.data?.metadata;

      if (invoiceId && metadata?.order_id) {
        await query(
          `UPDATE vendor_orders
           SET payment_status = 'paid',
               status = 'confirmed',
               confirmed_at = NOW(),
               updated_at = NOW()
           WHERE order_number = $1`,
          [metadata.order_id]
        );

        logInfo(`[Webhook] Vendor order ${metadata.order_id} marked as paid`);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    logError("[Webhook] Vendor payment webhook error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
