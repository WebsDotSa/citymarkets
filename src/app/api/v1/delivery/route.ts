import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { computeDistanceFee } from '@/lib/delivery';
import { getMainStoreAndDistance } from '@/lib/delivery/main-store';

import { error as logError } from '@/lib/logger';

/**
 * Public GET endpoint that returns the delivery fee for a customer
 * location. Migration 060 — zones are gone. The fee is computed purely
 * from the Haversine distance between the main store
 * (`stores.is_main = true`) and the customer's lat/lng:
 *
 *   distance ≤ 5 km → 3 SAR
 *   distance > 5 km → 3 + 1.5 × (distance − 5) SAR
 *
 * No min-order, no free-delivery threshold, no zone polygon matching.
 * Any distance is accepted.
 *
 * Response is wrapped under `data` for backwards-compat with the
 * existing client (the hook reads `data.deliveryFee`, `data.freeDelivery`,
 * `data.store`, etc.).
 *
 * F27: the main-store SELECT + haversine call now go through
 * `getMainStoreAndDistance` (the canonical helper in
 * `@/lib/delivery/main-store`). The previous inline version filtered
 * `is_active = true` strictly; the helper falls back to inactive rows,
 * so we still 503 here when the resolved store is inactive (matching
 * the old behaviour exactly).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get("lat") || "");
  const lng = parseFloat(searchParams.get("lng") || "");
  const orderAmount = parseFloat(searchParams.get("amount") || "0");

  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    return NextResponse.json(
      { success: false, error: "خط العرض وخط الطول مطلوبان" },
      { status: 400 }
    );
  }

  try {
    const { store, distanceKm } = await getMainStoreAndDistance(
      pool,
      lat,
      lng,
    );

    // Preserve the legacy strict-active behaviour: 503 unless the main
    // store is present, active, and has lat/lng.
    if (
      !store ||
      store.is_active === false ||
      store.lat == null ||
      store.lng == null ||
      distanceKm == null
    ) {
      return NextResponse.json(
        { success: false, error: "لا يوجد فرع رئيسي محدد" },
        { status: 503 }
      );
    }

    // Pickup-mode callers shouldn't be hitting this endpoint, but we
    // still guard against it being passed through.
    const deliveryFee = computeDistanceFee(distanceKm);
    const freeDelivery = deliveryFee === 0;

    return NextResponse.json({
      success: true,
      data: {
        available: true,
        deliveryFee,
        freeDelivery,
        distance: Math.round(distanceKm * 100) / 100,
        store: {
          id: String(store.id ?? ""),
          name: store.name_ar ?? null,
        },
      },
    });
  } catch (error) {
    logError("delivery fee calculation error:", error);
    return NextResponse.json(
      { success: false, error: "فشل حساب رسوم التوصيل" },
      { status: 500 }
    );
  }
}
