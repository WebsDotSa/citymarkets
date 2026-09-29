import { NextRequest, NextResponse } from "next/server";
import { query, pool } from "@/lib/db";
import { getCustomerUserIdFromRequest } from '@/lib/identity';
import { checkRateLimit, createRateLimitHeaders, GENERAL_API_CONFIG } from "@/lib/rate-limit";
// BUGFIX (audit 2026-09-29): replace the local isStoreOpen helper with
// the canonical Riyadh-tz-aware one. See siblings.
import { isVendorOpen, parseVendorHours } from "@/lib/delivery/vendor-store-hours";
import { generateVendorOrderNumber } from "@/lib/orders/order-number";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

/**
 * Order item type for internal use
 */
interface VendorOrderItem {
  productId: string;
  productName: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  notes: string | null;
}

/**
 * Database product row type
 */
interface VendorProductRow {
  id: string;
  name_ar: string;
  price: string;
  discount_price: string | null;
  stock_quantity: number;
  track_stock: boolean;
  image_urls: string[] | null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("id");
    const customerPhone = searchParams.get("phone");

    // SECURITY (C2 RBAC): previously this endpoint was unauthenticated and
    // allowed anyone with a phone number or order number to harvest the
    // full PII (name, address, items, payment method) of every order. We
    // now require authentication and rate-limit, and we never trust the
    // client-supplied phone — we always look up the order by id (or
    // by the authenticated user's phone).
    const userId = await getCustomerUserIdFromRequest(request as NextRequest);
    if (!userId) {
      return NextResponse.json(
        { error: "يجب تسجيل الدخول" },
        { status: 401 }
      );
    }

    const rl = await checkRateLimit(`vendor-orders:${userId}`, {
      ...GENERAL_API_CONFIG,
      keyPrefix: "vendor-orders-track",
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "تم تجاوز عدد المحاولات، حاول لاحقاً" },
        { status: 429, headers: createRateLimitHeaders(rl) }
      );
    }

    if (!orderId && !customerPhone) {
      return NextResponse.json(
        { error: "رقم الأوردر أو رقم الجوال مطلوب" },
        { status: 400 }
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

    // Resolve the authenticated user's phone from the DB to prevent a
    // caller from passing any phone they want.
    const meResult = await query(
      `SELECT phone FROM users WHERE id = $1`,
      [userId]
    );
    if (meResult.rows.length === 0) {
      return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 401 });
    }
    const myPhone = meResult.rows[0].phone as string | null;

    let result;
    if (orderId) {
      // Single-order lookup. The query restricts to the authenticated
      // user's phone so attackers can't enumerate `id`.
      result = await query(
        `SELECT vo.*, v.name_ar as vendor_name
         FROM vendor_orders vo
         JOIN vendors v ON vo.vendor_id = v.id
         WHERE vo.order_number = $1
           AND vo.vendor_id = $2
           AND vo.customer_phone = $3`,
        [orderId, vendor.id, myPhone]
      );
    } else {
      // List recent orders by the authenticated user's phone.
      result = await query(
        `SELECT vo.*, v.name_ar as vendor_name
         FROM vendor_orders vo
         JOIN vendors v ON vo.vendor_id = v.id
         WHERE vo.customer_phone = $1 AND vo.vendor_id = $2
         ORDER BY vo.created_at DESC
         LIMIT 10`,
        [myPhone, vendor.id]
      );
    }

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "لا توجد أوردرات" }, { status: 404 });
    }

    const orders = await Promise.all(
      result.rows.map(async (o) => {
        // SECURITY: migration 054 makes vendor_order_items.product_id
        // nullable (ON DELETE SET NULL). Use LEFT JOIN so historical
        // rows where the product was deleted still render — fall back
        // to the snapshot and a null image when `vp.id IS NULL`.
        const itemsResult = await query(
          `SELECT voi.*, vp.image_urls
           FROM vendor_order_items voi
           LEFT JOIN vendor_products vp ON voi.product_id = vp.id
           WHERE voi.order_id = $1`,
          [o.id]
        );

        return {
          id: o.id,
          orderNumber: o.order_number,
          status: o.status,
          paymentStatus: o.payment_status,
          paymentMethod: o.payment_method,
          items: itemsResult.rows.map((i) => ({
            id: i.id,
            productId: i.product_id,
            productName: i.product_name_snapshot,
            image: i.image_urls?.[0] || null,
            unitPrice: parseFloat(i.unit_price),
            quantity: i.quantity,
            lineTotal: parseFloat(i.line_total),
            notes: i.notes,
          })),
          subtotal: parseFloat(o.subtotal),
          deliveryFee: parseFloat(o.delivery_fee),
          total: parseFloat(o.total),
          customerName: o.customer_name,
          customerPhone: o.customer_phone,
          address: o.address_text,
          notes: o.notes,
          createdAt: o.created_at,
          updatedAt: o.updated_at,
          timeline: buildTimeline({
            created_at: o.created_at,
            confirmed_at: o.confirmed_at,
            status: o.status,
            delivered_at: o.delivered_at,
            cancelled_at: o.cancelled_at,
          }),
        };
      })
    );

    return NextResponse.json({
      orders: orderId ? [orders[0]] : orders,
      vendor: {
        id: vendor.id,
        slug: vendor.slug,
        name: vendor.name_ar,
      },
    });
  } catch (error) {
    logError("Vendor orders error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في جلب الأوردرات" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const client = await pool.connect();

  try {
    const { slug } = await params;

    // SECURITY (F3): previously this endpoint accepted fully-anonymous
    // requests. An attacker could spam order rows for any vendor and tie
    // them to arbitrary customer phone/name/address, burning admin/driver
    // time triaging. We now require authentication.
    const userId = await getCustomerUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { error: "يجب تسجيل الدخول" },
        { status: 401 }
      );
    }

    // SECURITY (F3): per-user rate limit on POST to cap order spam.
    const rl = await checkRateLimit(`vendor-order-create:${userId}`, {
      ...GENERAL_API_CONFIG,
      keyPrefix: "vendor-order-create",
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "تم تجاوز عدد المحاولات، حاول لاحقاً" },
        { status: 429, headers: createRateLimitHeaders(rl) }
      );
    }

    const body = await request.json();
    const { items, customerName, customerPhone, customerEmail, address, notes, paymentMethod } = body;

    // Validate
    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: "يجب اختيار منتج واحد على الأقل" },
        { status: 400 }
      );
    }

    if (!customerPhone) {
      return NextResponse.json(
        { error: "رقم الجوال مطلوب" },
        { status: 400 }
      );
    }

    // Get vendor
    const vendorResult = await query(
      `SELECT v.*, vs.delivery_mode, vs.delivery_fee_override, 
              vs.min_order_amount, vs.accepts_cod, vs.accepts_online_payment
       FROM vendors v
       LEFT JOIN vendor_settings vs ON v.id = vs.vendor_id
       WHERE v.slug = $1 AND v.is_active = TRUE`,
      [slug]
    );

    if (vendorResult.rows.length === 0) {
      return NextResponse.json({ error: "المتجر غير موجود" }, { status: 404 });
    }

    const vendor = vendorResult.rows[0];

    // Check if store is open
    if (!isVendorOpen(parseVendorHours(vendor))) {
      return NextResponse.json(
        { error: "المتجر مغلق حالياً. أوقات العمل: " + vendor.open_time + " - " + vendor.close_time },
        { status: 400 }
      );
    }

    // Check COD availability
    if (paymentMethod === "cod" && !vendor.accepts_cod) {
      return NextResponse.json(
        { error: "الدفع عند الاستلام غير متاح لهذا المتجر" },
        { status: 400 }
      );
    }

    // Check online payment availability
    if (paymentMethod !== "cod" && !vendor.accepts_online_payment) {
      return NextResponse.json(
        { error: "الدفع الإلكتروني غير متاح لهذا المتجر" },
        { status: 400 }
      );
    }

    // Get products and calculate totals
    const productIds = items.map((i: { productId: string }) => String(i.productId));
    // BUGFIX (audit 2026-09-29): the BEGIN used to live AFTER the
    // validation/ROLLBACK block — those ROLLBACKs were therefore
    // no-ops (pg emits a NOTICE, no error). Open the transaction
    // before the first `client.query` so a missing product, a
    // stock-exceeded product, or a min-order violation actually
    // releases the implicit statement-level resources we're holding.
    await client.query("BEGIN");
    const productsResult = await client.query<VendorProductRow>(
      `SELECT id, name_ar, price, discount_price, stock_quantity, track_stock, image_urls
       FROM vendor_products
       WHERE id = ANY($1) AND vendor_id = $2 AND is_active = TRUE`,
      [productIds, vendor.id]
    );

    const productMap = new Map(productsResult.rows.map((p) => [p.id, p]));

    let subtotal = 0;
    const orderItems: VendorOrderItem[] = [];

    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: `المنتج غير موجود: ${item.productId}` },
          { status: 400 }
        );
      }

      if (product.track_stock && product.stock_quantity < item.quantity) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: `الكمية غير متوفرة للمنتج: ${product.name_ar}` },
          { status: 400 }
        );
      }

      const price = product.discount_price 
        ? parseFloat(product.discount_price) 
        : parseFloat(product.price);
      const lineTotal = price * item.quantity;

      orderItems.push({
        productId: product.id,
        productName: product.name_ar,
        imageUrl: product.image_urls?.[0] || null,
        unitPrice: price,
        quantity: item.quantity,
        lineTotal,
        notes: item.notes || null,
      });

      subtotal += lineTotal;
    }

    // Calculate delivery fee
    let deliveryFee = vendor.delivery_fee_override
      ? parseFloat(vendor.delivery_fee_override)
      : 0;

    // Check minimum order
    if (vendor.min_order_amount && subtotal < parseFloat(vendor.min_order_amount)) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `الحد الأدنى للطلب: ${vendor.min_order_amount} ر.س` },
        { status: 400 }
      );
    }

    const total = subtotal + deliveryFee;

    // BUGFIX (audit 2026-09-29): BEGIN was here. It's been moved above
    // so the validation ROLLBACKs actually unwind the transaction.

    // Create order — link to authenticated user so it appears in their
    // "my orders" view. Previously customer_id was hardcoded NULL, which
    // made vendor orders invisible to the customer who placed them.
    const orderNumber = generateVendorOrderNumber(slug);
    const orderResult = await client.query(
      `INSERT INTO vendor_orders
        (order_number, vendor_id, customer_id, customer_name, customer_phone, customer_email,
         address_text, address_lat, address_lng, subtotal, delivery_fee, total,
         status, payment_method, payment_status, notes)
       VALUES ($1, $2, $12, $3, $4, $5, $6, NULL, NULL, $7, $8, $9, 'pending', $10, 'pending', $11)
       RETURNING *`,
      [
        orderNumber, vendor.id, customerName, customerPhone, customerEmail,
        address, subtotal, deliveryFee, total, paymentMethod, notes, userId
      ]
    );

    const order = orderResult.rows[0];

    // Create order items
    for (const item of orderItems) {
      await client.query(
        `INSERT INTO vendor_order_items 
          (order_id, product_id, product_name_snapshot, unit_price, quantity, line_total, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [order.id, item.productId, item.productName, item.unitPrice, item.quantity, item.lineTotal, item.notes]
      );

      // Update stock if tracking
      if (productMap.get(item.productId)?.track_stock) {
        await client.query(
          `UPDATE vendor_products 
           SET stock_quantity = stock_quantity - $1 
           WHERE id = $2`,
          [item.quantity, item.productId]
        );
      }
    }

    await client.query("COMMIT");

    // SECURITY (F3): COD previously auto-confirmed the order and marked
    // the payment as 'paid'. In COD the driver collects the cash on
    // delivery — until then the order is awaiting confirmation by the
    // vendor, and the payment has NOT been received. Auto-confirming
    // made it impossible to distinguish a COD order awaiting pickup
    // from one whose cash was already collected, and let an attacker
    // bury the admin dashboard with ghost-confirmed rows. Leave the
    // order in 'pending' and let the driver flip payment_status on
    // delivery.

    return NextResponse.json({
      success: true,
      order: {
        id: order.id,
        orderNumber: order.order_number,
        subtotal,
        deliveryFee,
        total,
        status: "pending",
        paymentStatus: "pending",
      },
      vendor: {
        id: vendor.id,
        slug: vendor.slug,
        name: vendor.name_ar,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    logError("Create vendor order error:", error);
    return NextResponse.json(
      { error: "حدث خطأ في إنشاء الطلب" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

function buildTimeline(order: {
  created_at: Date | null;
  confirmed_at: Date | null;
  status: string;
  delivered_at?: Date | null;
  cancelled_at?: Date | null;
}): Array<{
  status: string;
  label: string;
  timestamp: Date | null | undefined;
  isCompleted: boolean;
}> {
  const timeline: Array<{
    status: string;
    label: string;
    timestamp: Date | null | undefined;
    isCompleted: boolean;
  }> = [
    {
      status: "pending",
      label: "تم استلام الطلب",
      timestamp: order.created_at,
      isCompleted: true,
    },
  ];

  if (order.confirmed_at || ["confirmed", "preparing", "ready", "out_for_delivery", "delivered"].includes(order.status)) {
    timeline.push({
      status: "confirmed",
      label: "تم تأكيد الطلب",
      timestamp: order.confirmed_at,
      isCompleted: true,
    });
  }

  if (order.status === "preparing") {
    timeline.push({
      status: "preparing",
      label: "قيد التحضير",
      timestamp: null,
      isCompleted: true,
    });
  }

  if (order.status === "ready") {
    timeline.push({
      status: "ready",
      label: "الطلب جاهز",
      timestamp: null,
      isCompleted: true,
    });
  }

  if (order.status === "out_for_delivery") {
    timeline.push({
      status: "out_for_delivery",
      label: "خرج للتوصيل",
      timestamp: null,
      isCompleted: true,
    });
  }

  if (order.delivered_at || order.status === "delivered") {
    timeline.push({
      status: "delivered",
      label: "تم التسليم",
      timestamp: order.delivered_at,
      isCompleted: true,
    });
  }

  if (order.status === "cancelled") {
    timeline.push({
      status: "cancelled",
      label: "تم الإلغاء",
      timestamp: order.cancelled_at,
      isCompleted: true,
    });
  }

  return timeline;
}
