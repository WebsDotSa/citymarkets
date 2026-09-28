"use client";

import { useEffect, useState } from "react";

export interface DeliveryQuote {
  fee: number;
  isFree: boolean;
  /**
   * Straight-line km from the main store to the customer. `null` while
   * the address is still being resolved or the quote endpoint hasn't
   * responded yet. Useful for "fee preview" UIs that want to show the
   * distance alongside the price.
   */
  distanceKm: number | null;
  loading: boolean;
  error: string | null;
  /** True when no address is selected yet — UI should ask the user to pick one. */
  needsAddress: boolean;
  /**
   * Service-fee + tax amounts precomputed against the requested
   * subtotal by the delivery-quote endpoint. The order POST re-runs
   * the computation for the final insert — these values are UX-only.
   * A value of 0 means the admin has the corresponding fee disabled in
   * delivery settings, so the checkout UI should skip the line.
   */
  serviceFee: number;
  tax: number;
}

/**
 * Live delivery-fee quote for the current cart subtotal + selected address.
 *
 * Calls `/api/v1/delivery/quote` (works for both guests and logged-in
 * users) whenever the subtotal or the lat/lng changes. Returns a
 * `needsAddress: true` state when no coords are available so callers
 * can render a "set address to see fee" prompt instead of a fake number.
 *
 * Migration 060 — delivery fee is computed purely from the Haversine
 * distance between the main store and the customer's lat/lng. No more
 * `zoneName` or `freeDeliveryMin` in the response: every distance is
 * accepted and the fee follows the universal formula (3 SAR + 1.5
 * SAR/km beyond 5 km).
 */
export function useDeliveryQuote(
  subtotal: number,
  coords: { lat: number; lng: number } | null,
): DeliveryQuote {
  const [state, setState] = useState<DeliveryQuote>({
    fee: 0,
    isFree: false,
    distanceKm: null,
    loading: Boolean(coords),
    error: null,
    needsAddress: !coords,
    serviceFee: 0,
    tax: 0,
  });

  useEffect(() => {
    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
      setState({
        fee: 0,
        isFree: false,
        distanceKm: null,
        loading: false,
        error: null,
        needsAddress: true,
        serviceFee: 0,
        tax: 0,
      });
      return;
    }

    const ctrl = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetch("/api/v1/delivery/quote", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latitude: coords.lat,
        longitude: coords.lng,
        subtotal,
      }),
      signal: ctrl.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok || !data?.success) {
          setState({
            fee: 0,
            isFree: false,
            distanceKm: null,
            loading: false,
            error: data?.error || "تعذّر حساب رسوم التوصيل",
            needsAddress: false,
            serviceFee: 0,
            tax: 0,
          });
          return;
        }
        setState({
          fee: Number(data.deliveryFee ?? 0),
          isFree: Boolean(data.isFreeDelivery),
          distanceKm:
            data.distanceKm != null ? Number(data.distanceKm) : null,
          loading: false,
          error: null,
          needsAddress: false,
          serviceFee: Number(data.serviceFee ?? 0),
          tax: Number(data.tax ?? 0),
        });
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: "تعذّر الاتصال بالخادم",
        }));
      });

    return () => ctrl.abort();
  }, [subtotal, coords?.lat, coords?.lng]);

  return state;
}
