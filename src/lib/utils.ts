/**
 * Backward-compatibility barrel for `src/lib/utils.ts`.
 *
 * The single 145-line utils.ts file was split (audit H32) into four
 * focused modules:
 *   - `@/lib/cn`     — Tailwind classname merger
 *   - `@/lib/format` — formatters / parsers (price, date, phone, geo)
 *   - `@/lib/time`   — time helpers (delay)
 *   - `@/lib/id`     — id generators (generateId)
 *
 * This barrel re-exports every symbol from the new modules so the 19
 * existing importers continue to compile unchanged. New code SHOULD
 * import from the focused module directly; this barrel is kept only
 * for the duration of the consolidation migration and is slated for
 * removal in a follow-up audit branch.
 */
export { cn } from "./cn";
export {
  formatPrice,
  formatDate,
  formatOrderId,
  googleMapsPlaceUrl,
  googleMapsDirectionsUrl,
  parseCoords,
  normalizeSaudiPhoneForWhatsApp,
  buildOrderPreparingWhatsAppMessage,
  buildWhatsAppUrl,
  coerceAmount,
  parseOrderItems,
  normalizeOrdersListPayload,
  formatPhone,
} from "./format";
export type { ParsedOrderItem } from "./format";
export { delay } from "./time";
export { generateId } from "./id";
