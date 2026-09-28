/**
 * `/api/v1/delivery/slots` — public read-only list of available delivery
 * time slots for a given day. Companion to `/api/v1/delivery/quote`.
 *
 * The slots config lives in `delivery_settings.slots` (see migration
 * 047). Capacity is computed per (zone, date, window_id) by counting
 * scheduled orders in that window — so a zone with 100 orders/day
 * saturates faster than one with 20.
 *
 * Query:
 *   ?date=YYYY-MM-DD       (Riyadh, default = today Riyadh)
 *   &zone=<uuid>           (optional — if omitted, capacity is summed
 *                          across all zones since the cap is global)
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
} from "@/lib/delivery-slots";

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
 * If `zoneId` is provided, scoped to that zone. Otherwise summed across all.
 *
 * The DB stores `scheduled_for` as a naive timestamp (server timezone).
 * Since Saudi Arabia doesn't observe DST and all server ops use a fixed
 * +03 offset, comparing against the Riyadh wall-clock day boundary via
 * the `[00:00, 24:00)` UTC+3 window is safe.
 */
async function loadBookedCounts(
  dateKey: string,
  windows: SlotWindow[],
  zoneId: string | null,
): Promise<Record<string, number>> {
  // Build the [day_start_utc, day_end_utc) interval.
  const dayStart = riyadhWallClockToUtc(dateKey, "00:00");
  const dayEnd = riyadhWallClockToUtc(addDays(dateKey, 1), "00:00");
  const params: unknown[] = [dayStart.toISOString(), dayEnd.toISOString()];
  let where = `scheduled = true
                AND scheduled_for >= $1::timestamp
                AND scheduled_for <  $2::timestamp`;
  if (zoneId) {
    params.push(zoneId);
    where += ` AND delivery_zone_id = $${params.length}::uuid`;
  }
  const r = await query<{ slot_window: string | null; n: string }>(
    `SELECT slot_window, COUNT(*)::int AS n
       FROM orders
      WHERE ${where}
      GROUP BY slot_window`,
    params,
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

  const zoneRaw = searchParams.get("zone");
  const zoneId = zoneRaw && zoneRaw.length > 0 ? zoneRaw : null;

  const booked = await loadBookedCounts(dateKey, cfg.windows, zoneId);
  const windows = buildAvailability(cfg, dateKey, booked);

  return NextResponse.json({
    success: true,
    data: {
      date: dateKey,
      timezone: cfg.timezone,
      enabled: cfg.enabled,
      lead_time_minutes: cfg.lead_time_minutes,
      min_date: minDate,
      max_date: maxDate,
      zone_id: zoneId,
      windows,
    },
  });
};

export const GET = withCors(handler);