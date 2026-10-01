/**
 * Per-store opening hours (migration 079, 2026-09-30).
 *
 * Each `stores` row now carries an `opening_hours` JSONB column shaped
 * like:
 *
 *   {
 *     "enabled":        false,
 *     "open_time":      "09:00",
 *     "close_time":     "23:00",
 *     "timezone":       "Asia/Riyadh",
 *     "closed_message": "هذا الفرع مغلق حالياً"
 *   }
 *
 * When `enabled = false` the global `delivery_settings.hours` config
 * wins (preserving pre-079 behaviour). When `enabled = true` the
 * branch's local hours take precedence — useful for branches that
 * close earlier on weekends, run overnight, or carry a different
 * message in the storefront banner.
 *
 * This module owns the read-side resolution + evaluation. The
 * CheckoutService and `/api/v1/orders` POST both consume
 * `getActiveStoreHours(pool, storeId)` so the gate logic stays in
 * one place.
 */
import { validHhmmOr } from "./riyadh-time";
import { query } from "@/lib/db";
import {
  DEFAULT_DELIVERY_HOURS,
  evaluateHours,
  parseDeliveryHours,
  type DeliveryHours,
  type HoursCheck,
} from "./delivery-hours";

export type StoreOpeningHours = {
  enabled: boolean;
  open_time: string;
  close_time: string;
  timezone: string;
  closed_message: string;
};

export const DEFAULT_STORE_OPENING_HOURS: StoreOpeningHours = {
  enabled: false,
  open_time: "09:00",
  close_time: "23:00",
  timezone: "Asia/Riyadh",
  closed_message: "هذا الفرع مغلق حالياً",
};

/**
 * Parse the JSONB value from `stores.opening_hours`. Falls back to
 * `DEFAULT_STORE_OPENING_HOURS` if missing or malformed.
 *
 * Validation mirrors `parseDeliveryHours` (HH:MM 24h, close != open
 * via the parent Zod schema on the admin form). Anything the admin
 * form can't pass through is silently coerced to the default so a
 * bad row never blocks checkout.
 */
export function parseStoreHours(raw: unknown): StoreOpeningHours {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STORE_OPENING_HOURS };
  const v = raw as Partial<StoreOpeningHours>;
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : false,
    open_time: validHhmmOr(v.open_time, DEFAULT_STORE_OPENING_HOURS.open_time),
    close_time: validHhmmOr(v.close_time, DEFAULT_STORE_OPENING_HOURS.close_time),
    timezone:
      typeof v.timezone === "string" && v.timezone.length > 0
        ? v.timezone
        : DEFAULT_STORE_OPENING_HOURS.timezone,
    closed_message:
      typeof v.closed_message === "string" && v.closed_message.trim().length > 0
        ? v.closed_message.trim()
        : DEFAULT_STORE_OPENING_HOURS.closed_message,
  };
}

/**
 * Fetch the global `delivery_settings.hours` config (the pre-079
 * single-source-of-truth). Always returns a usable shape — on a
 * settings hiccup we fall back to the open defaults so checkout
 * doesn't suddenly reject every order.
 */
async function getGlobalHours(): Promise<DeliveryHours> {
  try {
    const res = await query<{ value: unknown }>(
      `SELECT value FROM delivery_settings WHERE key = 'hours' LIMIT 1`,
    );
    return parseDeliveryHours(res.rows[0]?.value);
  } catch {
    return { ...DEFAULT_DELIVERY_HOURS };
  }
}

/**
 * Resolve the active hours for a given store id.
 *
 * Resolution order:
 *   1. `stores.opening_hours` for the given store id.
 *   2. If `enabled = true` → use the branch's local hours.
 *   3. Otherwise → fall back to the global `delivery_settings.hours`.
 *
 * Returns `null` only if the store id is unknown — callers should
 * treat that as a misconfiguration and gate the checkout with a
 * 503-level error.
 */
export async function getActiveStoreHours(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  storeId: string,
): Promise<DeliveryHours | null> {
  const res = await client.query(
    `SELECT opening_hours FROM stores WHERE id = $1::uuid LIMIT 1`,
    [storeId],
  );
  if (res.rows.length === 0) return null;

  const local = parseStoreHours(res.rows[0].opening_hours);
  if (local.enabled) {
    return {
      enabled: true,
      open_time: local.open_time,
      close_time: local.close_time,
      timezone: local.timezone,
      closed_message: local.closed_message,
    };
  }

  return getGlobalHours();
}

/**
 * Evaluate the resolved hours against `now`. Sugar over
 * `evaluateHours` so callers don't have to import both modules.
 */
export function evaluateStoreHours(
  hours: DeliveryHours,
  now: Date = new Date(),
): HoursCheck {
  return evaluateHours(hours, now);
}
