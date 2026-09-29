/**
 * Daily working-hours helpers.
 *
 * Sits next to `delivery-slots.ts` but serves a different purpose:
 * slots describe *bookable windows the customer picks* (capacity,
 * lead-time, look-ahead) while hours describe *when the store is
 * simply open for business at all*. The checkout endpoint enforces
 * hours as a hard gate — outside hours, no order, period.
 *
 * Hours live in `delivery_settings.hours` as JSON, same shape as
 * `pricing` and `slots`. The server timezone is fixed to Asia/Riyadh
 * (Saudi Arabia does not observe DST → +03:00 year round), which
 * matches `delivery-slots.ts` so the two systems stay coherent.
 */

import { query } from "@/lib/db";

export type DeliveryHours = {
  enabled: boolean;
  open_time: string; // "HH:MM" 24h Riyadh wall-clock
  close_time: string; // "HH:MM" 24h Riyadh wall-clock
  timezone: string;
  closed_message: string;
};

export const RIYADH_TZ = "Asia/Riyadh";
const RIYADH_OFFSET_MIN = 3 * 60; // +03:00, no DST

export const DEFAULT_DELIVERY_HOURS: DeliveryHours = {
  enabled: true,
  open_time: "09:00",
  close_time: "23:00",
  timezone: RIYADH_TZ,
  closed_message:
    "التوصيل متاح فقط خلال ساعات العمل — يرجى المحاولة لاحقاً",
};

/**
 * Parse the JSONB value from `delivery_settings.hours`. Falls back to
 * DEFAULT_DELIVERY_HOURS if missing or malformed.
 */
export function parseDeliveryHours(raw: unknown): DeliveryHours {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_DELIVERY_HOURS };
  const v = raw as Partial<DeliveryHours>;
  const minutes = (s: string | undefined, fallback: string) => {
    if (typeof s !== "string") return fallback;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return fallback;
    return s;
  };
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : true,
    open_time: minutes(v.open_time, DEFAULT_DELIVERY_HOURS.open_time),
    close_time: minutes(v.close_time, DEFAULT_DELIVERY_HOURS.close_time),
    timezone: typeof v.timezone === "string" && v.timezone.length > 0
      ? v.timezone
      : RIYADH_TZ,
    closed_message:
      typeof v.closed_message === "string" && v.closed_message.trim().length > 0
        ? v.closed_message.trim()
        : DEFAULT_DELIVERY_HOURS.closed_message,
  };
}

/**
 * Load the live config from `delivery_settings`. Used by both the
 * checkout route and the public /api/v1/store-status endpoint.
 */
export async function getDeliveryHours(): Promise<DeliveryHours> {
  try {
    const res = await query(
      `SELECT value FROM delivery_settings WHERE key = 'hours'`,
    );
    const raw = res.rows[0]?.value;
    return parseDeliveryHours(raw);
  } catch {
    // Never block checkout on a settings hiccup — fall back to defaults
    // (which currently allow ordering) and let the admin toggle persist.
    return { ...DEFAULT_DELIVERY_HOURS };
  }
}

/**
 * Riyadh YYYY-MM-DD for a given Date (avoids host-TZ surprises).
 */
function toRiyadhDateKey(d: Date): string {
  const riyadhMs = d.getTime() + RIYADH_OFFSET_MIN * 60_000;
  const r = new Date(riyadhMs);
  return `${r.getUTCFullYear()}-${String(r.getUTCMonth() + 1).padStart(2, "0")}-${String(r.getUTCDate()).padStart(2, "0")}`;
}

/**
 * "HH:MM" Riyadh wall-clock for a given Date.
 */
function toRiyadhHhmm(d: Date): string {
  const riyadhMs = d.getTime() + RIYADH_OFFSET_MIN * 60_000;
  const r = new Date(riyadhMs);
  return `${String(r.getUTCHours()).padStart(2, "0")}:${String(r.getUTCMinutes()).padStart(2, "0")}`;
}

function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Result of evaluating the current moment against `hours`.
 */
export type HoursCheck = {
  open: boolean;
  message?: string;
  hours?: DeliveryHours;
};

/**
 * Decide whether `now` falls inside the configured working window.
 *
 * Supports overnight ranges (close < open → wraps past midnight).
 * Returns `{ open: false, message }` only when hours are enabled AND
 * we are outside the window — callers want to distinguish "feature
 * disabled" from "outside hours" so they can pick the right user
 * message.
 */
export function evaluateHours(
  hours: DeliveryHours,
  now: Date = new Date(),
): HoursCheck {
  if (!hours.enabled) return { open: true, hours };
  const nowMin = hhmmToMinutes(toRiyadhHhmm(now));
  const openMin = hhmmToMinutes(hours.open_time);
  const closeMin = hhmmToMinutes(hours.close_time);

  let inside: boolean;
  if (closeMin < openMin) {
    // Overnight, e.g. 18:00 → 02:00.
    inside = nowMin >= openMin || nowMin < closeMin;
  } else {
    inside = nowMin >= openMin && nowMin < closeMin;
  }

  return inside
    ? { open: true, hours }
    : { open: false, message: hours.closed_message, hours };
}

/**
 * Convenience for the customer-facing banner: snapshot the current
 * status so the UI can render an explanatory message ("المتجر يفتح
 * غداً الساعة 09:00") without recomputing.
 */
export type HoursStatus = {
  enabled: boolean;
  open: boolean;
  open_time: string;
  close_time: string;
  message: string;
  today_key: string;
};

/**
 * Build the public snapshot for /api/v1/store-status. Always returns a
 * shape even when hours are disabled — the storefront banner needs to
 * know "hours feature is off" vs "open right now".
 */
export function buildHoursStatus(
  hours: DeliveryHours,
  now: Date = new Date(),
): HoursStatus {
  const eval_ = evaluateHours(hours, now);
  return {
    enabled: hours.enabled,
    open: eval_.open,
    open_time: hours.open_time,
    close_time: hours.close_time,
    message: eval_.message ?? hours.closed_message,
    today_key: toRiyadhDateKey(now),
  };
}
