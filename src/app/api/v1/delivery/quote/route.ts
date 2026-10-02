import { NextRequest, NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { computeOrderFees } from '@/lib/orders';
import { computeDistanceFee } from '@/lib/delivery';
import { getMainStoreAndDistance } from '@/lib/delivery/main-store';
import { getClientIp } from "@/lib/request-ip";
import { checkRateLimit, DELIVERY_QUOTE_IP_CONFIG } from "@/lib/rate-limit";

import { error as logError } from "@/lib/logger";

/**
 * Guest-friendly delivery quote.
 *
 * Unlike /api/v1/calculate-delivery (auth required, now removed), this
 * endpoint is callable from /cart and /checkout for both guests and
 * logged-in users. Returns a structured quote so the cart UI can show
 * the server-canonical fee instead of a hardcoded fallback.
 *
 * Migration 060 — zones are gone. The fee is purely a function of
 * distance from the main store (`stores.is_main = true`) to the
 * customer's lat/lng:
 *
 *   distance ≤ 5 km → 3 SAR
 *   distance > 5 km → 3 + 1.5 × (distance − 5) SAR
 *
 * No `zoneName`, no `freeDeliveryMin`, no `inDeliveryArea` (we accept
 * any distance). The pickup-mode path still applies (subtotal is
 * irrelevant for delivery fee when `deliveryMode === 'pickup'`).
 */
export async function POST(request: NextRequest) {
  // SECURITY (PCP-140): per-IP cap on the delivery-quote endpoint.
  // The route is CSRF-exempt (stateless fee quote) and runs a
  // distance-fee SQL+haversine per call. A scripted attacker could
  // otherwise pin a worker on a flood. 30/min is well above the
  // cart UI's debounce rate. The rate-limit check runs BEFORE
  // input parse so a flood of bad bodies cannot exhaust the bucket
  // (PCP-133 lesson).
  const quoteRl = await checkRateLimit(
    `delivery:quote:${getClientIp(request)}`,
    DELIVERY_QUOTE_IP_CONFIG,
  );
  if (!quoteRl.allowed) {
    return NextResponse.json(
      { success: false, error: "تم تجاوز عدد المحاولات، حاول لاحقاً" },
      { status: 429 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const lat = Number(body?.latitude);
    const lng = Number(body?.longitude);
    const subtotal = Number(body?.subtotal ?? 0);
    const deliveryMode =
      body?.deliveryMode === 'pickup' ? 'pickup' : 'delivery';

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        { success: false, error: "الموقع الجغرافي مطلوب" },
        { status: 400 },
      );
    }

    const settingsResult = await query(
      `SELECT value FROM delivery_settings WHERE key = 'pricing' LIMIT 1`,
    );
    const pricing =
      (settingsResult.rows[0]?.value as Record<string, unknown>) ?? {};

    const { store, distanceKm } = await getMainStoreAndDistance(pool, lat, lng);
    if (
      !store ||
      store.is_active === false ||
      store.lat == null ||
      store.lng == null
    ) {
      return NextResponse.json(
        { success: false, error: "لم يتم تهيئة موقع المتجر الرئيسي" },
        { status: 503 },
      );
    }
    if (distanceKm == null) {
      return NextResponse.json(
        { success: false, error: "تعذّر حساب مسافة التوصيل" },
        { status: 503 },
      );
    }
    const deliveryFee =
      deliveryMode === 'pickup' ? 0 : computeDistanceFee(distanceKm);

    // Pre-compute service + tax against the requested subtotal so the
    // checkout summary can show every cost line the order will persist.
    // The orders route re-runs `computeOrderFees` for the final insert
    // — this is a UX hint, not a contract.
    const fees = computeOrderFees({
      subtotal,
      discount: 0,
      deliveryMode,
      couponFreeDelivery: false,
      distanceKm,
      pricing,
    });

    return NextResponse.json({
      success: true,
      deliveryFee,
      isFreeDelivery: deliveryFee === 0,
      distanceKm: Math.round(distanceKm * 100) / 100,
      serviceFee: fees.serviceFee,
      tax: fees.tax,
    });
  } catch (error) {
    logError("delivery-quote error:", error);
    return NextResponse.json(
      { success: false, error: "حدث خطأ في حساب رسوم التوصيل" },
      { status: 500 },
    );
  }
}
