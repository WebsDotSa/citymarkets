-- ════════════════════════════════════════════════════════════════════════════
-- 049_addresses_title.sql
-- Add a dedicated `title` column on `addresses` so the iOS app
-- (شيف سيتي / customer checkout) can render a user-facing address
-- label independent of the internal `description` (free-text notes)
-- and `label` (slug like "home" / "work").
--
-- Why a separate column rather than reusing `description`:
--   1. `description` is a free-text memo, often empty. The iOS app needs
--      a guaranteed non-empty display title for the saved-address list.
--   2. Keeping `title` explicit means we never have to disambiguate
--      "description || label" fallback logic in API responses.
--   3. The web checkout already passes `description` separately for
--      notes; introducing `title` does not change its wire format.
--
-- All existing rows are back-filled with `description` (or `label` as
-- last resort) so nothing renders empty after the deploy.
-- ════════════════════════════════════════════════════════════════════════════

-- 001's addresses table does not have `description` (it was added in
-- 004 via CREATE TABLE IF NOT EXISTS, which is a no-op on a fresh DB
-- because 001 already created addresses). Add it here so the back-fill
-- below has a column to read from. Safe to re-run on production.
ALTER TABLE addresses
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE addresses
  ADD COLUMN IF NOT EXISTS title TEXT;

-- Back-fill: prefer description, fall back to label.
UPDATE addresses
   SET title = COALESCE(NULLIF(description, ''), label)
 WHERE title IS NULL;

-- New rows should always carry a title. The API route also enforces this,
-- but a NOT NULL with default makes accidental NULL inserts noisy in
-- logs instead of silently producing empty titles.
ALTER TABLE addresses
  ALTER COLUMN title SET DEFAULT '';
ALTER TABLE addresses
  ALTER COLUMN title SET NOT NULL;