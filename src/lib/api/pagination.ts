/**
 * Centralised pagination helpers for v1 + admin + vendor endpoints.
 *
 * Background:
 *   The PCP-101 Phase 10 audit found that list endpoints accept any
 *   `limit` value without validation:
 *     • /api/v1/products?limit=999999  → capped to 100 (some clamps exist)
 *     • /api/v1/categories?limit=999999 → 145 results (NO clamp)
 *     • /api/v1/vendors?limit=999999 → 7 results (NO clamp)
 *     • /api/admin/orders?limit=999999 → 75 (no clamp)
 *     • /api/admin/vendors?limit=999999 → 8 (no clamp)
 *     • /api/admin/categories?limit=999999 → 100 (no clamp)
 *
 *   Inconsistencies:
 *     • limit=999999 → returns all (or capped, depending on endpoint)
 *     • limit=-1     → returns 1
 *     • limit=abc    → returns DEFAULT
 *     • limit= (empty) → returns DEFAULT
 *
 *   This helper produces a consistent behaviour across every list
 * endpoint:
 *     • DEFAULT_LIMIT (50) when value is missing / NaN / empty / out of range
 *     • MAX_LIMIT (100) when value > MAX_LIMIT
 *     • min 1 when value < 1
 *     • page is 1-based; out-of-range page returns empty array (already
 *       the case but we keep it consistent)
 *
 *   Migration plan: replace `Math.min(100, Math.max(1, parseInt(...)))`
 *   patterns across every list route with `parsePagination(params, {limit:
 *   MAX_LIMIT})` and update the SQL builder to use the returned `limit`.
 *
 *   This is PCP-118.
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
export const MAX_PAGE = 10_000; // sanity cap to avoid full scans via OFFSET

export interface ParsedPagination {
  limit: number;
  page: number;
  offset: number;
}

/**
 * Parse `limit` and `page` query string params into clamped integers.
 *
 * Behaviour:
 *   - Missing / empty / NaN → DEFAULT_LIMIT / 1
 *   - Negative or zero → 1 / 1
 *   - limit > MAX_LIMIT → MAX_LIMIT
 *   - page > MAX_PAGE → MAX_PAGE
 *
 * @param params URLSearchParams from NextRequest.nextUrl.searchParams
 *               (or any object with `.get(key)` returning string|null).
 * @param opts   Optional overrides for defaults.
 */
export function parsePagination(
  params: URLSearchParams | { get(key: string): string | null },
  opts?: { defaultLimit?: number; maxLimit?: number; maxPage?: number },
): ParsedPagination {
  const defaultLimit = opts?.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = opts?.maxLimit ?? MAX_LIMIT;
  const maxPage = opts?.maxPage ?? MAX_PAGE;

  const rawLimit = params.get("limit");
  let limit = defaultLimit;
  if (rawLimit != null && rawLimit !== "") {
    const parsed = Number.parseInt(rawLimit, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      limit = Math.min(parsed, maxLimit);
    }
  }

  const rawPage = params.get("page");
  let page = 1;
  if (rawPage != null && rawPage !== "") {
    const parsed = Number.parseInt(rawPage, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      page = Math.min(parsed, maxPage);
    }
  }

  const offset = (page - 1) * limit;
  return { limit, page, offset };
}

/**
 * Clamp an existing limit (when the route already extracted it as a
 * number from a query string). Use this when you need a single
 * `limit` value rather than the full pagination tuple.
 */
export function clampLimit(
  raw: string | number | null | undefined,
  opts?: { defaultLimit?: number; maxLimit?: number },
): number {
  const defaultLimit = opts?.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = opts?.maxLimit ?? MAX_LIMIT;

  if (raw == null || raw === "") return defaultLimit;
  const parsed = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return defaultLimit;
  return Math.min(parsed, maxLimit);
}