/**
 * Canonical Asia/Riyadh wall-clock helpers for the delivery domain.
 *
 * Saudi Arabia is UTC+03:00 with no DST, so a fixed offset is exact and
 * avoids depending on the runtime's ICU timezone data. Previously each of
 * delivery-hours / vendor-store-hours / delivery-slots / store-hours carried
 * its own copy of these constants and helpers.
 */
export const RIYADH_TZ = "Asia/Riyadh";
export const RIYADH_OFFSET_MIN = 3 * 60; // +03:00, no DST

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Format a UTC instant as Riyadh "HH:MM". */
export function toRiyadhHhmm(d: Date): string {
  const riyadhMs = d.getTime() + RIYADH_OFFSET_MIN * 60_000;
  const r = new Date(riyadhMs);
  return `${String(r.getUTCHours()).padStart(2, "0")}:${String(r.getUTCMinutes()).padStart(2, "0")}`;
}

/** "HH:MM" → minutes since midnight. Caller guarantees the format. */
export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

/** Return `s` when it is a valid 24h "HH:MM" string, else `fallback`. */
export function validHhmmOr(s: unknown, fallback: string): string {
  if (typeof s !== "string") return fallback;
  if (!HHMM_RE.test(s)) return fallback;
  return s;
}
