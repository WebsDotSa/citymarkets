/**
 * `/api/v1/delivery/slots` — public read-only list of available delivery
 * time slots for a given day. Companion to `/api/v1/delivery/quote`.
 *
 * The slots config lives in `delivery_settings.slots` (see migration
 * 047). Capacity is global per (date, window_id) — every scheduled
 * order in that window counts toward the cap.
 *
 * Migration 060 dropped the `delivery_zones` table and the
 * `orders.delivery_zone_id` column; the previous `?zone=` filter would
 * throw a 500 against the missing column. We accept the param for
 * backward-compat (old iOS clients still pass it) but always return
 * `zone_id: null` and ignore the filter.
 *
 * Query:
 *   ?date=YYYY-MM-DD       (Riyadh, default = today Riyadh)
 *   &zone=<uuid>           (DEPRECATED — ignored, kept for compat)
 *
 * Response:
 *   {
 *     "success": true,
 *     "data": {
 *       "date": "2026-08-10",
 *       "timezone": "Asia/Riyadh",
 *       "enabled": true,
 *       "lead_time_minutes": 120,
 *       "min_date": "2026-08-10",
 *       "max_date": "2026-08-17",
 *       "zone_id": null,
 *       "windows": [
 *         {
 *           "id": "morning", "label_ar": "صباحاً",
 *           "start": "09:00", "end": "11:00",
 *           "start_at": "2026-08-10T06:00:00.000Z",
 *           "end_at":   "2026-08-10T08:00:00.000Z",
 *           "capacity": 20, "booked": 3, "available": true
 *         }, ...
 *       ]
 *     }
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { withCors } from "@/lib/cors";
import { query } from "@/lib/db";
import {
  addDays,
  buildAvailability,
  parseSlotsConfig,
  riyadhWallClockToUtc,
  toRiyadhDateKey,
  DEFAULT_SLOTS_CONFIG,
  type SlotWindow,
} from '@/lib/delivery';

export const dynamic = "force-dynamic";

function isoDateKey(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

async function loadConfig(): Promise<{ enabled: boolean; raw: unknown }> {
  const r = await query<{ value: unknown }>(
    `SELECT value FROM delivery_settings WHERE key = 'slots' LIMIT 1`,
  );
  const raw = r.rows[0]?.value;
  if (!raw) return { enabled: DEFAULT_SLOTS_CONFIG.enabled, raw: null };
  return { enabled: parseSlotsConfig(raw).enabled, raw };
}

/**
 * Count existing scheduled orders per window for a given Riyadh date.
 * Capacity is GLOBAL (post migration 060 — there are no delivery zones
 * anymore). The `zoneId` arg is preserved for the route signature but
 * intentionally unused — we accept-and-ignore the deprecated `?zone=`
 * param so old clients don't break.
 *
 * The DB stores `scheduled_for` as a naive timestamp (server timezone).
 * Since Saudi Arabia doesn't observe DST and all server ops use a fixed
 * +03 offset, comparing against the Riyadh wall-clock day boundary via
 * the `[00:00, 24:00)` UTC+3 window is safe.
 */
async function loadBookedCounts(
  dateKey: string,
  windows: SlotWindow[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  zoneId?: string | null,
): Promise<Record<string, number>> {
  // Build the [day_start_utc, day_end_utc) interval.
  const dayStart = riyadhWallClockToUtc(dateKey, "00:00");
  const dayEnd = riyadhWallClockToUtc(addDays(dateKey, 1), "00:00");
  // Migration 060 dropped `orders.delivery_zone_id` along with the
  // `delivery_zones` table. The previous `zoneId`-based filter would
  // throw a 500 ("column does not exist") here — we now sum across all
  // orders globally, matching the canonical "capacity is global per
  // (date, window_id)" model.
  const r = await query<{ slot_window: string | null; n: string }>(
    `SELECT slot_window, COUNT(*)::int AS n
       FROM orders
      WHERE scheduled = true
        AND scheduled_for >= $1::timestamp
        AND scheduled_for <  $2::timestamp
      GROUP BY slot_window`,
    [dayStart.toISOString(), dayEnd.toISOString()],
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) {
    if (row.slot_window) out[row.slot_window] = parseInt(row.n, 10);
  }
  // Ensure every window has a key (zero counts).
  for (const w of windows) if (!(w.id in out)) out[w.id] = 0;
  return out;
}

const handler = async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const cfg = parseSlotsConfig((await loadConfig()).raw);

  // Date param: default to today (Riyadh).
  let dateKey = isoDateKey(searchParams.get("date") ?? "") ?? toRiyadhDateKey(new Date());
  // Clamp date into [min_date, max_date].
  const todayKey = toRiyadhDateKey(new Date());
  const minDate = addDays(todayKey, cfg.min_days_ahead);
  const maxDate = addDays(todayKey, cfg.max_days_ahead);
  if (dateKey < minDate) dateKey = minDate;
  if (dateKey > maxDate) dateKey = maxDate;

  // Accept-and-ignore the deprecated `?zone=` query param. Migration 060
  // dropped the `delivery_zones` table and `orders.delivery_zone_id`
  // column; capacity is now global per (date, window_id).
  const zoneRaw = searchParams.get("zone");
  // Surface a one-time deprecation header for any client still sending
  // the zone filter so they see the canonical answer in their logs.
  const isLegacyZoneQuery = !!(zoneRaw && zoneRaw.length > 0);

  const booked = await loadBookedCounts(dateKey, cfg.windows);
  const windows = buildAvailability(cfg, dateKey, booked);

  const response = NextResponse.json({
    success: true,
    data: {
      date: dateKey,
      timezone: cfg.timezone,
      enabled: cfg.enabled,
      lead_time_minutes: cfg.lead_time_minutes,
      min_date: minDate,
      max_date: maxDate,
      // Always null post-migration 060 (capacity is global).
      zone_id: null,
      windows,
    },
  });
  if (isLegacyZoneQuery) {
    response.headers.set(
      "X-API-Deprecated",
      "?zone= is ignored since migration 060; capacity is global per (date, window)",
    );
  }
  return response;
};

export const GET = withCors(handler);