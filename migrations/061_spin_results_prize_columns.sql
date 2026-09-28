-- 061_spin_results_prize_columns.sql
-- Add prize_type/prize_value/is_winner/created_at columns that /api/v1/spin/route.ts
-- expects (and app/spin/page.tsx reads). The original schema (001_full_schema.sql)
-- used result_type/result_value/coupon_id/spun_at — that's what coupon/loyalty code
-- uses. The spin-the-wheel endpoint was never migrated forward, so every GET/POST
-- to /api/v1/spin failed with `column "prize_type" does not exist`. The page shows
-- the generic error overlay ("حدث خطأ") when this endpoint 500s during SSR/hydration.
--
-- We add the missing columns instead of rewriting the route — the route hard-codes
-- `prize_type = 'points'` and computes `is_winner = prize_value >= 50` client-side
-- already, so the values are derived and the new columns don't double-store data.
-- `created_at` mirrors `spun_at` (kept for backward compat with the route's ORDER BY).

ALTER TABLE spin_results
  ADD COLUMN IF NOT EXISTS prize_type TEXT,
  ADD COLUMN IF NOT EXISTS prize_value NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS is_winner BOOLEAN,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- The original result_type/result_value are NOT NULL but the route's INSERT
-- only populates the new prize_* columns. Relax the legacy NOT NULL constraints
-- so the existing INSERT (which the route hasn't been changed to update) succeeds.
ALTER TABLE spin_results ALTER COLUMN result_type DROP NOT NULL;
ALTER TABLE spin_results ALTER COLUMN result_value DROP NOT NULL;

-- Backfill from the original columns so existing rows look consistent to the route.
UPDATE spin_results
SET
  prize_type = COALESCE(prize_type, result_type::text),
  prize_value = COALESCE(prize_value, result_value),
  is_winner = COALESCE(is_winner, result_value >= 50),
  created_at = COALESCE(created_at, spun_at)
WHERE prize_type IS NULL OR prize_value IS NULL OR is_winner IS NULL OR created_at IS NULL;

-- Index used by the route's ORDER BY created_at DESC LIMIT 1.
CREATE INDEX IF NOT EXISTS idx_spin_results_created_at
  ON spin_results(user_id, created_at DESC);
