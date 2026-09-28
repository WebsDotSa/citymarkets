import { NextResponse } from "next/server";
import { getStoreStatusSettings } from "@/lib/app-settings";
import {
  getDeliveryHours,
  buildHoursStatus,
} from "@/lib/delivery-hours";
import { error as logError } from "@/lib/logger";
import { withCors } from "@/lib/cors";

/**
 * GET /api/v1/store-status
 *
 * Public, unauthenticated read of the storefront open/closed toggle so
 * the client-side banner can render immediately on first paint. We
 * cache at the edge for 30 s and serve stale for up to 5 min so an
 * admin who flips the toggle does not need to wait for a hard refresh
 * across every CDN node, but the change still propagates quickly.
 *
 * Also surfaces the daily working-hours config so the storefront can
 * show "مغلق — يفتح غداً الساعة 09:00" without a second round-trip.
 */
const handler = async () => {
  try {
    const [status, hours] = await Promise.all([
      getStoreStatusSettings(),
      getDeliveryHours(),
    ]);
    const hoursStatus = buildHoursStatus(hours);
    // Effective "is the store buyable right now": both the admin
    // master switch AND the working-hours window must be open.
    const isOpen = status.is_open !== false && hoursStatus.open;
    const message = !status.is_open
      ? status.message
      : !hoursStatus.open
        ? hoursStatus.message
        : "";
    return NextResponse.json(
      {
        success: true,
        is_open: isOpen,
        message,
        hours: {
          enabled: hoursStatus.enabled,
          open_time: hoursStatus.open_time,
          close_time: hoursStatus.close_time,
          message: hoursStatus.message,
        },
      },
      {
        headers: {
          "Cache-Control": "public, max-age=30, stale-while-revalidate=300",
        },
      },
    );
  } catch (e) {
    logError("store-status GET:", e);
    // On error default to open so a DB hiccup never accidentally locks
    // out customers. The checkout endpoint has its own (authoritative)
    // check anyway.
    return NextResponse.json(
      { success: true, is_open: true, message: "", hours: null },
      { status: 200 },
    );
  }
};

export const GET = withCors(handler);
