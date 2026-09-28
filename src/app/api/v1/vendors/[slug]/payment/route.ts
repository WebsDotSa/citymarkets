import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createInvoice, isMoyasarConfigured } from "@/lib/payments/moyasar";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

/**
 * POST /api/v1/vendors/[slug]/payment
 * Initialize payment for a vendor order
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await request.json();
    const { orderId, paymentMethod } = body;

    if (!orderId) {
      return NextResponse.json(
        { error: "رقم الطلب مطلوب" },
        { status: 400 }
      );
    }

    if (!isMoyasarConfigured()) {
      return NextResponse.json(
        { error: "خدمة الدفع غير متاحة حالياً" },
        { status: 503 }
      );
    }

    // Get vendor
    const vendorResult = await query(
      "SELECT id, slug, name_ar FROM vendors WHERE slug = $1 AND is_active = TRUE",
      [slug]
    );

    if (vendorResult.rows.length === 0) {
      return NextResponse.json({ error: "المتجر غير موجود" }, { status: 404 });
    }

    const vendor = vendorResult.rows[0];

    // Get order
    const orderResult = await query(
      `SELECT id, order_number, total, customer_name, status, payment_status, payment_method
       FROM vendor_orders
       WHERE id = $1 AND vendor_id = $2`,
      [orderId, vendor.id]
    );

    if (orderResult.rows.length === 0) {
      return NextResponse.json({ error: "الطلب غير موجود" }, { status: 404 });
    }

    const order = orderResult.rows[0];

    if (order.payment_status === "paid") {
      return NextResponse.json(
        { error: "تم الدفع مسبقاً لهذا الطلب" },
        { status: 400 }
      );
    }

    if (order.payment_method && order.payment_method !== paymentMethod) {
      return NextResponse.json(
        { error: "طريقة الدفع مختلفة عن الطريقة المحددة مسبقاً" },
        { status: 400 }
      );
    }

    // Determine payment type
    const paymentType = paymentMethod === "moyasar_applepay" ? "applepay" : "invoice";

    if (paymentType === "invoice") {
      // Create Moyasar invoice
      const result = await createInvoice({
        amount: parseFloat(order.total),
        orderId: order.order_number,
        description: `طلب #${order.order_number} من ${vendor.name_ar}`,
        customerName: order.customer_name || undefined,
      });

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || "فشل في إنشاء فاتورة الدفع" },
          { status: 500 }
        );
      }

      // Update order with payment info
      await query(
        `UPDATE vendor_orders
         SET payment_method = 'moyasar_card', moyasar_payment_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [result.invoiceId, order.id]
      );

      return NextResponse.json({
        success: true,
        paymentUrl: result.paymentUrl,
        invoiceId: result.invoiceId,
        type: "invoice",
      });
    }

    // For Apple Pay, return a message that inline payment is supported
    return NextResponse.json({
      success: true,
      type: "applepay",
      message: "Apple Pay متاح - سيتم تفعيله عند استخدام الدفع المضمّن",
    });
  } catch (error) {
    logError("Vendor payment error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في معالجة الدفع" },
      { status: 500 }
    );
  }
}
