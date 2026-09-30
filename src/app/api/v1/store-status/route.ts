import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getStoreStatusSettings } from "@/lib/app-settings";
import {
  buildHoursStatus,
} from '@/lib/delivery/delivery-hours';
import { getActiveStoreHours } from '@/lib/delivery/store-hours';
import { getMainStoreAndDistance } from '@/lib/delivery/main-store';
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
 *
 * Migration 079 (2026-09-30): now resolves per-branch
 * `stores.opening_hours` via `getActiveStoreHours`. If the main store
 * has `opening_hours.enabled = true`, the branch window is what we
 * report (not the global `delivery_settings.hours`). If the branch is
 * disabled OR unknown we fall back to the global config so the
 * storefront never breaks on a bad row.
 */
const handler = async () => {
  try {
    const status = await getStoreStatusSettings();
    // Parallel-fetch the main-store id + global hours as a fallback so
    // a slow branch query never blocks the public banner.
    const { store: mainStoreRow } = await getMainStoreAndDistance(pool, null, null);
    const mainStoreId = mainStoreRow?.id ?? null;
    const branchHours = mainStoreId ? await getActiveStoreHours(pool, mainStoreId) : null;
    // branchHours is `DeliveryHours | null`. When null (no main store
    // or settings hiccup) we fall back to the open defaults via
    // `buildHoursStatus`'s own fallback (hours arg can be undefined).
    const hoursStatus = branchHours
      ? buildHoursStatus(branchHours)
      : { enabled: true, open: true, open_time: "09:00", close_time: "23:00", message: "", today_key: "" };
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
