import { NextRequest, NextResponse } from "next/server";
import {
  getGuestSessionIdFromRequest,
  resolveCustomerUserIdFromRequest,
} from '@/lib/identity';
import { checkRateLimit, ORDER_CREATE_CONFIG, createRateLimitHeaders } from "@/lib/rate-limit";
import { applyCsrfProtection } from "@/lib/csrf";
import { getClientIp } from "@/lib/request-ip";
import { runCheckout, type CheckoutServiceResult } from '@/lib/orders/checkout/checkout-service';

/**
 * POST /api/v1/checkout — Slice 3 unified multi-vendor checkout.
 *
 * Thin handler: CSRF + auth + rate-limit + body parse, then delegate
 * to CheckoutService.runCheckout() (src/lib/checkout/checkout-service.ts).
 * The service owns every business step (store-status gate, hours gate,
 * vendor-closed gate, scheduled-slot validation, transaction, payment
 * init, notify) and returns a discriminated-union result that we map
 * to JSON + status here.
 *
 * Body shape: see multiVendorCheckoutSchema in src/lib/validation.ts.
 * Returns: see CheckoutServiceResult.success.body in checkout-service.ts.
 */
export async function POST(request: NextRequest) {
  const csrf = await applyCsrfProtection(request);
  if (csrf) return csrf;

  const userId = await resolveCustomerUserIdFromRequest(request);
  const sessionId = getGuestSessionIdFromRequest(request);
  if (!userId && !sessionId) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  const rateLimitKey = userId || getClientIp(request);
  const rateLimitResult = await checkRateLimit(
    `checkout:${rateLimitKey}`,
    ORDER_CREATE_CONFIG,
  );
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: "تجاوزت الحد المسموح من الطلبات. حاول لاحقاً.",
        retryAfter: rateLimitResult.retryAfterMs,
      },
      {
        status: 429,
        headers: createRateLimitHeaders(rateLimitResult),
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "نوع البيانات غير صالح" },
      { status: 400 },
    );
  }

  const result = await runCheckout({
    caller: { userId, sessionId, clientIp: getClientIp(request) },
    body,
  });
  return resultToResponse(result);
}

function resultToResponse(result: CheckoutServiceResult): NextResponse {
  switch (result.kind) {
    case "success":
      return NextResponse.json(result.body, { status: result.status });
    case "replay":
      return NextResponse.json(result.body, { status: result.status });
    case "store_closed":
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          store_closed: true,
          ...(result.outOfHours
            ? {
                out_of_hours: true,
                hours: result.hours,
              }
            : {}),
        },
        { status: result.status },
      );
    case "vendor_closed":
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          vendor_closed: true,
          closedVendorIds: result.closedVendorIds,
          closedVendorNames: result.closedVendorNames,
        },
        { status: result.status },
      );
    case "stock_insufficient":
      return NextResponse.json(
        { success: false, error: result.error, kind: result.kind },
        { status: result.status },
      );
    case "payment_init_failed":
      return NextResponse.json(
        { success: false, error: result.error, orderId: result.parentOrderId },
        { status: result.status },
      );
    case "internal_error":
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          ...(result.debug ? { debug: result.debug } : {}),
        },
        { status: result.status },
      );
    case "validation_error":
    case "vendor_min_order":
    case "vendor_inactive":
    case "ownership_mismatch":
    case "product_not_found":
    case "empty_cart":
    case "no_address":
    case "no_main_store":
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          ...("productId" in result && result.productId
            ? { kind: "validation", productId: result.productId }
            : {}),
          ...("vendorId" in result && result.vendorId
            ? { vendorId: result.vendorId }
            : {}),
        },
        { status: result.status },
      );
  }
}
