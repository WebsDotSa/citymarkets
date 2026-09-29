import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getOrderStatusConfig, PAYMENT_STATUS_AR } from '@/lib/orders';
import { checkRateLimit, createRateLimitHeaders } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";

import { error as logError, warn as logWarn, info as logInfo } from '@/lib/logger';

const PHONE_RE = /^[+\d][\d\s\-()]{5,20}$/;

// SECURITY (F2): tighter limit than GENERAL_API_CONFIG (100/min) because
// legitimate use is "I want to track my order" — bursty enumeration has
// no legitimate use case.
const TRACK_RATE_LIMIT = {
  maxRequests: 20,
  windowMs: 60_000,
  keyPrefix: "track-order",
} as const;

export async function GET(request: NextRequest) {
  // SECURITY (F2): rate-limit tracking-code lookups by IP. The previous
  // code was unauthenticated and unthrottled, so an attacker could
  // sweep all 10^6 tracking codes per IP without resistance.
  const ip = getClientIp(request);
  const rl = await checkRateLimit(`track-order:${ip}`, TRACK_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "تجاوزت الحد المسموح من المحاولات، حاول لاحقاً" },
      { status: 429, headers: createRateLimitHeaders(rl) }
    );
  }

  const { searchParams } = new URL(request.url);
  const phone = (searchParams.get("phone") || "").trim();
  const code = (searchParams.get("code") || "").trim();

  if (!phone || !code) {
    return NextResponse.json(
      { error: "رقم الجوال ورمز التتبع مطلوبان" },
      { status: 400 }
    );
  }
  if (!PHONE_RE.test(phone)) {
    return NextResponse.json({ error: "رقم جوال غير صالح" }, { status: 400 });
  }
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "رمز التتبع يجب أن يكون 6 أرقام" }, { status: 400 });
  }

  // Normalize phone: keep digits only, allow leading +.
  const phoneDigits = phone.replace(/[^\d+]/g, "");
  const phoneLast4 = phoneDigits.replace(/[^\d]/g, "").slice(-4);
  if (phoneLast4.length < 4) {
    return NextResponse.json({ error: "رقم جوال غير صالح" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    // SECURITY (F2): The previous filter was
    //   `tracking_code = $1 AND (guest_phone LIKE $2 OR user_id IS NOT NULL)`
    // The `OR user_id IS NOT NULL` short-circuited the phone check for
    // every order placed by a registered user, defeating the comment's
    // stated intent and letting any anonymous caller enumerate all
    // tracking codes by brute-forcing 10^6 values.
    //
    // We now match strictly on (tracking_code, last-4 of phone). This
    // works for guest orders (guest_phone LIKE %last4) and for registered
    // users (their orders store guest_phone at creation too — see
    // orders/route.ts and orders/direct/route.ts).
    const result = await client.query(
      `SELECT id, status, type, total, payment_method,
              guest_name, guest_phone, guest_city, guest_district,
              tracking_code, scheduled, scheduled_for, slot_window,
              created_at, updated_at
       FROM orders
       WHERE tracking_code = $1
         AND guest_phone LIKE $2
       LIMIT 1`,
      [code, `%${phoneLast4}`]
    );

    if (result.rows.length === 0) {
      // Avoid leaking whether the code exists.
      return NextResponse.json(
        { error: "ما قدرنا نلاقي طلب بهذه البيانات" },
        { status: 404 }
      );
    }

    const order = result.rows[0];

    // Order items
    const items = await client.query(
      `SELECT oi.id, oi.product_id, oi.qty as quantity, oi.unit_price,
              p.name_ar AS product_name, p.image_url AS product_image
       FROM order_items oi
       LEFT JOIN products_unified p ON oi.product_id = p.id
       WHERE oi.order_id = $1`,
      [order.id]
    );

    return NextResponse.json({
      success: true,
      order: {
        id: order.id,
        status: order.status,
        status_ar:
          PAYMENT_STATUS_AR[order.status] ?? getOrderStatusConfig(order.status).label,
        type: order.type,
        total: Number(order.total),
        payment_method: order.payment_method,
        tracking_code: order.tracking_code,
        guest: {
          name: order.guest_name,
          phone: order.guest_phone,
          city: order.guest_city,
          district: order.guest_district,
        },
        created_at: order.created_at,
        updated_at: order.updated_at,
        scheduled: order.scheduled,
        scheduled_for: order.scheduled_for,
        slot_window: order.slot_window,
      },
      items: items.rows.map((it) => ({
        id: it.id,
        product_id: it.product_id,
        product_name: it.product_name,
        product_image: it.product_image,
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        line_total: Number(it.unit_price) * Number(it.quantity),
      })),
    });
  } catch (error) {
    logError("Track order error:", error);
    return NextResponse.json({ error: "حدث خطأ" }, { status: 500 });
  } finally {
    client.release();
  }
}
