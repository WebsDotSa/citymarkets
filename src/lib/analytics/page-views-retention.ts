/**
 * page-views-retention — PCP-148
 *
 * `page_views` is append-only analytics at ~120 rows/day with 7
 * indexes. Without a retention policy it grows to ~28 MB in a year.
 * The retention window is configurable in SQL
 * (`public.page_views_retention_days()`, default 90) so future
 * tuning is a one-line migration, not a code change.
 *
 * The worker (`scripts/worker.ts → cleanup-old-page-views`) calls
 * `cleanupOldPageViews()` on a 24h cadence. The function:
 *   1. Reads the retention window from the SQL function.
 *   2. Computes the cutoff timestamp in JS.
 *   3. Issues a parameterised DELETE on `occurred_at < cutoff`.
 *   4. Returns `{ deleted, cutoffIso, retentionDays }` for the
 *      worker's log line and for tests.
 *
 * Pure SQL helper: no auth, no app-server dependencies. Safe to
 * import from `scripts/worker.ts` (long-lived Node process) and
 * from Next.js routes without crossing the `server-only` boundary.
 */
import { query, pool } from "@/lib/db";

export const DEFAULT_RETENTION_DAYS = 90;

export type CleanupResult = {
  /** Rows removed by the DELETE. */
  deleted: number;
  /** ISO-8601 cutoff used for the DELETE (NOW() - retention). */
  cutoffIso: string;
  /** Window read from `page_views_retention_days()`. */
  retentionDays: number;
};

/**
 * Read the retention window from the SQL function. Falls back to
 * {@link DEFAULT_RETENTION_DAYS} (90) if the function is missing or
 * returns a non-positive integer — defensive in case migration 113
 * has not yet been applied or the function gets dropped.
 */
export async function getRetentionDays(): Promise<number> {
  const result = await query<{ days: number | string }>(
    "SELECT public.page_views_retention_days() AS days"
  );
  const raw = result.rows[0]?.days;
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
  if (typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_RETENTION_DAYS;
}

/**
 * Delete rows older than the retention window. Returns counts and
 * the cutoff so callers can log/verify the run.
 *
 * Uses a parameterised DELETE — the cutoff is bound, never
 * interpolated — and a CTE-anchored RETURNING so the count is read
 * from the deleted rows in a single round-trip even on Postgres
 * versions where `rowCount` is occasionally off.
 */
export async function cleanupOldPageViews(
  now: Date = new Date()
): Promise<CleanupResult> {
  const retentionDays = await getRetentionDays();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  const result = await pool.query<{ id: string }>(
    `WITH cutoff AS (
       SELECT $1::timestamptz AS ts
     ),
     deleted AS (
       DELETE FROM public.page_views
       WHERE occurred_at < (SELECT ts FROM cutoff)
       RETURNING id
     )
     SELECT id FROM deleted`,
    [cutoff.toISOString()]
  );

  return {
    deleted: result.rowCount ?? 0,
    cutoffIso: cutoff.toISOString(),
    retentionDays,
  };
}
