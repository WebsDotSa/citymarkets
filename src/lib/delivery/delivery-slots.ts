/**
 * Delivery time-slot helpers.
 *
 * Slot configuration lives in `delivery_settings.slots` as JSON — same
 * pattern as `delivery_settings.pricing`. The default shipped by
 * migration 047 has 4 windows/day with a 2-hour lead time and 7-day
 * max lookahead.
 *
 * Capacity is computed per (zone, date, slot_id) by counting existing
 * scheduled orders in that window. The slot is sold out when the count
 * reaches `capacity`.
 *
 * The server timezone is always `Asia/Riyadh` — Saudi Arabia does not
 * observe DST so the offset is fixed at +03:00 year-round. Clients send
 * `scheduled_for` as ISO-8601 UTC; we convert to Riyadh wall-clock to
 * figure out which window a given instant belongs to.
 */

export type SlotWindow = {
  id: string;
  label_ar: string;
  start: string; // "HH:MM" 24h Riyadh wall-clock
  end: string; // "HH:MM" 24h Riyadh wall-clock
  capacity: number;
};

export type SlotsConfig = {
  enabled: boolean;
  lead_time_minutes: number;
  max_days_ahead: number;
  min_days_ahead: number;
  timezone: string;
  slot_duration_minutes: number;
  windows: SlotWindow[];
};

export const RIYADH_TZ = "Asia/Riyadh";
const RIYADH_OFFSET_MIN = 3 * 60; // +03:00, no DST

export const DEFAULT_SLOTS_CONFIG: SlotsConfig = {
  enabled: true,
  lead_time_minutes: 120,
  max_days_ahead: 7,
  min_days_ahead: 0,
  timezone: RIYADH_TZ,
  slot_duration_minutes: 120,
  windows: [
    { id: "morning", label_ar: "صباحاً", start: "09:00", end: "11:00", capacity: 20 },
    { id: "noon", label_ar: "ظهراً", start: "12:00", end: "14:00", capacity: 25 },
    { id: "afternoon", label_ar: "عصراً", start: "15:00", end: "17:00", capacity: 25 },
    { id: "evening", label_ar: "مساءً", start: "18:00", end: "20:00", capacity: 30 },
  ],
};

/**
 * Parse the JSONB value from `delivery_settings.slots`. Falls back to
 * DEFAULT_SLOTS_CONFIG if missing or malformed.
 */
export function parseSlotsConfig(raw: unknown): SlotsConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_SLOTS_CONFIG;
  const v = raw as Partial<SlotsConfig>;
  return {
    enabled: v.enabled ?? true,
    lead_time_minutes: v.lead_time_minutes ?? 120,
    max_days_ahead: v.max_days_ahead ?? 7,
    min_days_ahead: v.min_days_ahead ?? 0,
    timezone: v.timezone ?? RIYADH_TZ,
    slot_duration_minutes: v.slot_duration_minutes ?? 120,
    windows: Array.isArray(v.windows) && v.windows.length > 0 ? v.windows : DEFAULT_SLOTS_CONFIG.windows,
  };
}

/**
 * Return the Riyadh YYYY-MM-DD for a UTC Date.
 */
export function toRiyadhDateKey(d: Date): string {
  // Compute Riyadh wall-clock Y/M/D manually (avoids relying on the host TZ).
  const utcMs = d.getTime();
  const riyadhMs = utcMs + RIYADH_OFFSET_MIN * 60_000;
  const riyadh = new Date(riyadhMs);
  const y = riyadh.getUTCFullYear();
  const m = String(riyadh.getUTCMonth() + 1).padStart(2, "0");
  const day = String(riyadh.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Add days to a YYYY-MM-DD string (avoids TZ shenanigans).
 */
export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Build the UTC `Date` for a Riyadh (dateKey, HH:MM).
 */
export function riyadhWallClockToUtc(dateKey: string, hhmm: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  // Riyadh wall-clock = UTC + 3h, so UTC = wall - 3h.
  const utcMs = Date.UTC(y, m - 1, d, hh, mm, 0, 0) - RIYADH_OFFSET_MIN * 60_000;
  return new Date(utcMs);
}

/**
 * Find the window containing the given Riyadh wall-clock time.
 * Returns null if outside any window (e.g., 14:30 between noon and afternoon).
 */
export function windowForTime(
  cfg: SlotsConfig,
  dateKey: string,
  hhmm: string,
): SlotWindow | null {
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  const target = toMin(hhmm);
  for (const w of cfg.windows) {
    const s = toMin(w.start);
    const e = toMin(w.end);
    if (target >= s && target < e) return w;
  }
  void dateKey;
  return null;
}

/**
 * Look up a window by id.
 */
export function findWindow(cfg: SlotsConfig, id: string): SlotWindow | null {
  return cfg.windows.find((w) => w.id === id) ?? null;
}

export type SlotAvailability = {
  id: string;
  label_ar: string;
  start: string; // HH:MM Riyadh
  end: string; // HH:MM Riyadh
  start_at: string; // ISO-8601 UTC
  end_at: string; // ISO-8601 UTC
  capacity: number;
  booked: number;
  available: boolean;
};

/**
 * Build availability for every window on a given Riyadh date.
 *
 * @param cfg        parsed slots config
 * @param dateKey    YYYY-MM-DD (Riyadh)
 * @param bookedById map of window id → already-booked count (caller
 *                   computes via DB query)
 * @param now        reference clock; default `new Date()`
 */
export function buildAvailability(
  cfg: SlotsConfig,
  dateKey: string,
  bookedById: Record<string, number>,
  now: Date = new Date(),
): SlotAvailability[] {
  const earliest = new Date(now.getTime() + cfg.lead_time_minutes * 60_000);
  const earliestKey = toRiyadhDateKey(earliest);
  const earliestMin = earliest.getUTCHours() * 60 + earliest.getUTCMinutes() + RIYADH_OFFSET_MIN * 60;
  const isToday = dateKey === earliestKey || dateKey === toRiyadhDateKey(now);

  return cfg.windows.map((w) => {
    const startUtc = riyadhWallClockToUtc(dateKey, w.start);
    const endUtc = riyadhWallClockToUtc(dateKey, w.end);
    const booked = bookedById[w.id] ?? 0;
    const isFull = booked >= w.capacity;
    // Past-window check: if window end is before `earliest`, it's gone.
    const startsAfterCutoff =
      isToday && startUtc.getTime() < earliest.getTime();
    return {
      id: w.id,
      label_ar: w.label_ar,
      start: w.start,
      end: w.end,
      start_at: startUtc.toISOString(),
      end_at: endUtc.toISOString(),
      capacity: w.capacity,
      booked,
      available: cfg.enabled && !isFull && !startsAfterCutoff,
    };
  });
}

/**
 * Validate that a `scheduled_for` ISO timestamp + `slot_id` is acceptable
 * for a new order. Returns `{ ok: true }` or `{ ok: false, error }` —
 * intended to be surfaced as a 400 in the checkout/orders POST.
 */
export function validateSlotSelection(
  cfg: SlotsConfig,
  slotId: string,
  scheduledForIso: string,
  bookedCount: number,
  now: Date = new Date(),
): { ok: true; window: SlotWindow; scheduled_for: Date } | { ok: false; error: string } {
  if (!cfg.enabled) {
    return { ok: false, error: "جدولة التوصيل غير متاحة حالياً" };
  }
  const win = findWindow(cfg, slotId);
  if (!win) {
    return { ok: false, error: "فترة التوصيل غير صالحة" };
  }
  const when = new Date(scheduledForIso);
  if (Number.isNaN(when.getTime())) {
    return { ok: false, error: "تاريخ الفترة غير صالح" };
  }
  // Window must match scheduled_for's wall-clock.
  const dateKey = toRiyadhDateKey(when);
  const hhmm = (() => {
    const riyadhMs = when.getTime() + RIYADH_OFFSET_MIN * 60_000;
    const r = new Date(riyadhMs);
    return `${String(r.getUTCHours()).padStart(2, "0")}:${String(r.getUTCMinutes()).padStart(2, "0")}`;
  })();
  if (windowForTime(cfg, dateKey, hhmm)?.id !== slotId) {
    return { ok: false, error: "الفترة المختارة لا تطابق الوقت المحدد" };
  }
  // Lead-time + lookahead checks.
  if (when.getTime() < now.getTime() + cfg.lead_time_minutes * 60_000) {
    return { ok: false, error: `يجب أن يكون موعد التوصيل بعد ${cfg.lead_time_minutes} دقيقة من الآن` };
  }
  const today = toRiyadhDateKey(now);
  const minDate = addDays(today, cfg.min_days_ahead);
  const maxDate = addDays(today, cfg.max_days_ahead);
  if (dateKey < minDate || dateKey > maxDate) {
    return {
      ok: false,
      error: `يمكن الجدولة بين ${cfg.min_days_ahead} و ${cfg.max_days_ahead} أيام من اليوم`,
    };
  }
  if (bookedCount >= win.capacity) {
    return { ok: false, error: "فترة التوصيل ممتلئة" };
  }
  return { ok: true, window: win, scheduled_for: when };
}