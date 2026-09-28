import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { computeDistanceFee } from "@/lib/delivery-distance-fee";
import { haversineKm } from "@/lib/geo";

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
    interface MainStoreRow {
      id: string;
      name_ar: string;
      lat: string | number | null;
      lng: string | number | null;
    }
    const storeResult = await query<MainStoreRow>(
      `SELECT id, name_ar, lat::float AS lat, lng::float AS lng
         FROM stores
        WHERE is_main = true AND is_active = true
        LIMIT 1`,
    );

    const store = storeResult.rows[0];
    if (!store || store.lat == null || store.lng == null) {
      return NextResponse.json(
        { success: false, error: "لا يوجد فرع رئيسي محدد" },
        { status: 503 },
      );
    }

    const distanceKm = haversineKm(
      Number(store.lat),
      Number(store.lng),
      lat,
      lng,
    );

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
          id: store.id,
          name: store.name_ar,
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
