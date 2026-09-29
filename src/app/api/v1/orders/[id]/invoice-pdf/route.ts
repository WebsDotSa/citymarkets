import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { resolveCustomerUserIdFromRequest } from "@/lib/identity";
import { requireAdminApi } from "@/lib/identity/admin-api-auth-db";
import {
  assertOrderOwnership,
  idempotencyKeyFromQuery,
} from '@/lib/orders';
import {
  getPaymentStatusConfig,
  PAYMENT_METHOD_AR,
  ORDER_STATUS_DISPLAY,
  CUSTOMER_PROGRESS_STEPS,
} from '@/lib/orders';
import {
  ORDER_BASE_COLUMNS,
  ORDER_ADDRESS_COLUMNS_MINIMAL,
  ORDER_USER_COLUMNS,
  ORDER_DETAIL_JOINS,
} from '@/lib/orders/sql-fragments';
import {
  renderInvoicePdf,
  invoiceFilename,
} from "@/server/invoice-pdf-server";
import { error as logError } from "@/lib/logger";

/**
 * GET /api/v1/orders/[id]/invoice-pdf
 *
 * Renders the order invoice as a PDF and streams it back as
 * `application/pdf`. Used by both the customer order-detail page and
 * the admin order-detail page via the shared InvoiceActions component.
 *
 * Auth: customer (must own the order) OR admin (any role).
 *
 * Why server-side? @react-pdf/renderer pulls in Node-only deps
 * (Buffer, stream, fs). Bundling it for the client either breaks SSR
 * or breaks the browser bundle. Keeping the render on the server means
 * the client just downloads the resulting binary.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await ctx.params;

  // 1) Auth — accept either an admin session OR a customer that owns
  // this order (logged-in user_id or matching guest idempotency_key).
  const gate = await requireAdminApi(request, "manage_orders");
  const isAdmin = !(gate instanceof NextResponse);

  const userId = isAdmin ? null : await resolveCustomerUserIdFromRequest(request);
  const url = new URL(request.url);
  const guestKey = idempotencyKeyFromQuery(url);

  // Admin path: no ownership check needed (gate already verified role).
  // Customer path: require positive ownership proof.
  let variant: "customer" | "admin" = "customer";
  if (!isAdmin) {
    const client = await pool.connect();
    try {
      const ownership = await assertOrderOwnership({
        orderId,
        userId,
        providedIdempotencyKey: guestKey,
        client,
        select: `id, user_id::text as user_id, status, idempotency_key`,
      });
      if (!ownership.ok) {
        return NextResponse.json(
          { success: false, error: ownership.error },
          { status: ownership.code }
        );
      }
    } finally {
      client.release();
    }
  } else {
    variant = "admin";
  }

  // 2) Fetch order + items in one round-trip.
  const client = await pool.connect();
  try {
    const ord = await client.query(
      `SELECT ${ORDER_BASE_COLUMNS},
              o.type, o.tracking_code,
              o.guest_city, o.guest_district,
              ${ORDER_ADDRESS_COLUMNS_MINIMAL},
              ${ORDER_USER_COLUMNS}
       ${ORDER_DETAIL_JOINS}
       WHERE o.id = $1
       LIMIT 1`,
      [orderId]
    );
    if (ord.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "الطلب غير موجود" },
        { status: 404 }
      );
    }
    const o = ord.rows[0];

    const items = await client.query(
      `SELECT i.id, i.product_id, p.name_ar,
              i.free_text, i.quantity, i.unit_price::float, i.notes
       FROM direct_order_items i
       LEFT JOIN products p ON p.id = i.product_id
       WHERE i.order_id = $1
       ORDER BY i.created_at ASC`,
      [orderId]
    );

    // 3) Build the props for the server renderer. Use the same Arabic
    // labels as the rest of the app for status + payment_method so the
    // PDF text matches the UI exactly.
    const statusLabel =
      ORDER_STATUS_DISPLAY.find((s) => s.value === String(o.status))?.label ||
      String(o.status);
    const paymentMethodLabel =
      PAYMENT_METHOD_AR[String(o.payment_method)] || String(o.payment_method) || "—";
    const paymentStatus = String(o.payment_status ?? "");
    const paymentConfig = getPaymentStatusConfig(paymentStatus);

    const customerName =
      String(o.user_name || o.guest_name || "").trim() || "عميل";

    // Order number shown to the customer is the short tracking_code, or
    // a fallback derived from the UUID. The orders table doesn't have
    // an explicit `order_number` column in this build.
    const orderNumberShown =
      String(o.tracking_code || "").trim() || String(o.id || "");

    // Build the public tracking URL with the LAST 4 DIGITS of the
    // customer's phone only (privacy). The full phone never leaves
    // the server. Falls back to null when neither code nor phone is
    // available (e.g. legacy order without tracking_code).
    const phoneForTracking = String(o.user_phone || o.guest_phone || "");
    const phoneLast4 = phoneForTracking.replace(/\D/g, "").slice(-4);
    const trackingCode = String(o.tracking_code || "").trim();
    const siteOrigin =
      process.env.NEXT_PUBLIC_SITE_URL || "https://citymarkets.sa";
    const trackingUrl =
      trackingCode && phoneLast4
        ? `${siteOrigin}/orders/track?phone=****${phoneLast4}&code=${encodeURIComponent(trackingCode)}`
        : null;

    // Lifecycle progression steps for the "مسار الطلب" section. Mark a
    // step as reached if the order's current status has reached it.
    const stepOrder: Array<{ key: string; label: string }> =
      CUSTOMER_PROGRESS_STEPS.map((s) => ({ key: s.status, label: s.label }));
    const currentIdx = stepOrder.findIndex((s) => s.key === String(o.status));
    const trackingSteps = stepOrder.map((s, idx) => ({
      key: s.key,
      label: s.label,
      reached: currentIdx === -1 ? false : idx <= currentIdx,
    }));

    // 4) Render PDF.
    const buffer = await renderInvoicePdf({
      orderNumber: orderNumberShown,
      createdAt: String(o.created_at ?? ""),
      status: statusLabel,
      paymentMethodLabel,
      paymentStatus,
      paymentStatusLabel: paymentConfig.label,
      customerName,
      customerPhone: o.user_phone || o.guest_phone || null,
      address: {
        label: o.address_label || null,
        text: o.address_text || null,
        city: o.guest_city || null,
        district: o.guest_district || null,
      },
      items: items.rows.map((it) => ({
        name: String(it.name_ar || it.free_text || "عنصر"),
        quantity: Number(it.quantity ?? 1),
        unit_price: Number(it.unit_price ?? 0),
        notes: it.notes || null,
      })),
      subtotal: Number(o.subtotal ?? 0),
      deliveryFee: Number(o.delivery_fee ?? 0),
      serviceFee: Number(o.service_fee ?? 0),
      tax: Number(o.tax ?? 0),
      discount: Number(o.discount ?? 0),
      total: Number(o.total ?? 0),
      variant,
      trackingCode: trackingCode || null,
      trackingUrl,
      trackingSteps,
    });

    const filename = invoiceFilename(orderNumberShown);

    // 5) Stream the PDF with a friendly filename + a Content-Length so
    // the browser can show a real download progress bar.
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    // Catch-all logging: @react-pdf/renderer occasionally throws
    // non-Error objects, so capture every common shape.
    const e = err as { name?: string; message?: string; stack?: string };
    // Audit I39: routed through the canonical logger.
    logError(
      "[invoice-pdf] render failed",
      err,
      {
        orderId,
        name: e?.name,
        message: e?.message,
        stack: e?.stack?.slice(0, 1000),
        raw: typeof err === "object" ? JSON.stringify(err) : String(err),
      },
    );
    return NextResponse.json(
      { success: false, error: "تعذر إنشاء ملف PDF" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}