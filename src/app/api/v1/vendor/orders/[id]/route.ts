import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { verifyVendorRequestWithDb } from "@/lib/identity/vendor-auth-with-db";
import { error as logError } from '@/lib/logger';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await verifyVendorRequestWithDb(request as any);
    if (!session) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    const { id } = await params;

    const orderResult = await query(
      `SELECT vo.*, v.name_ar as vendor_name
       FROM vendor_orders vo
       JOIN vendors v ON vo.vendor_id = v.id
       WHERE vo.id = $1 AND vo.vendor_id = $2`,
      [id, session.vendorId]
    );

    if (orderResult.rows.length === 0) {
      return NextResponse.json({ error: "الأوردر غير موجود" }, { status: 404 });
    }

    const order = orderResult.rows[0];

    // Get order items
    // SECURITY: after migration 054, `vendor_order_items.product_id` is
    // nullable (ON DELETE SET NULL). Use a LEFT JOIN so historical rows
    // where the product was later deleted still appear — `vp.id IS NULL`
    // means the product no longer exists, and we render from the snapshot
    // (`product_name_snapshot`) with `image` and `sku` as null.
    const itemsResult = await query(
      `SELECT voi.*, vp.image_urls, vp.sku
       FROM vendor_order_items voi
       LEFT JOIN vendor_products vp ON voi.product_id = vp.id
       WHERE voi.order_id = $1`,
      [id]
    );

    return NextResponse.json({
      order: {
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        paymentStatus: order.payment_status,
        paymentMethod: order.payment_method,
        moyasarPaymentId: order.moyasar_payment_id,
        customer: {
          id: order.customer_id,
          name: order.customer_name,
          phone: order.customer_phone,
          email: order.customer_email,
        },
        address: {
          text: order.address_text,
          lat: order.address_lat,
          lng: order.address_lng,
        },
        items: itemsResult.rows.map((i) => ({
          id: i.id,
          productId: i.product_id,
          name: i.product_name_snapshot,
          sku: i.sku,
          image: i.image_urls?.[0] || null,
          unitPrice: parseFloat(i.unit_price),
          quantity: i.quantity,
          lineTotal: parseFloat(i.line_total),
          notes: i.notes,
        })),
        subtotal: parseFloat(order.subtotal),
        deliveryFee: parseFloat(order.delivery_fee),
        total: parseFloat(order.total),
        notes: order.notes,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        confirmedAt: order.confirmed_at,
        preparedAt: order.prepared_at,
        deliveredAt: order.delivered_at,
        cancelledAt: order.cancelled_at,
      },
      vendor: {
        id: session.vendorId,
        name: order.vendor_name,
      },
    });
  } catch (error) {
    logError("Get order error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في جلب تفاصيل الأوردر" },
      { status: 500 }
    );
  }
}
