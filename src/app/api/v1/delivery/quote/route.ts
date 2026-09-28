import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { computeOrderFees } from "@/lib/pricing";
import { computeDistanceFee } from "@/lib/delivery-distance-fee";
import { haversineKm } from "@/lib/geo";

import { error as logError } from '@/lib/logger';

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

    interface MainStoreRow {
      lat: string | number | null;
      lng: string | number | null;
      is_active: boolean | null;
    }
    const storeResult = await query<MainStoreRow>(
      `SELECT lat, lng, is_active FROM stores
        WHERE is_main = true
        ORDER BY is_active DESC NULLS LAST
        LIMIT 1`,
    );
    const store = storeResult.rows[0];
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

    const distanceKm = haversineKm(
      Number(store.lat),
      Number(store.lng),
      lat,
      lng,
    );
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
