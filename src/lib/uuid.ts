/**
 * Canonical UUID shape check (any version, case-insensitive). Pure and
 * client-safe. Replaces ten identical per-file `UUID_RE` / `UUID_LIKE`
 * regex literals. For request-body validation prefer `z.string().uuid()`.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
