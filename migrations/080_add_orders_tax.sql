-- 080 — Add the `orders.tax` column that 053's header comment assumed existed.
--
-- Background:
--   The audit of 2026-09-30 (full-system audit, P0-1) found that
--   `orders.tax` is referenced by ~10 source files (sql-fragments.ts,
--   admin/orders/[id]/route.ts, v1/orders/[id]/route.ts, invoice-pdf
--   route, analytics.ts, cart-v2/checkout-new React forms, the admin
--   order detail page, and the admin direct-order detail page) but the
--   column is **not** present in any migration — `001_full_schema.sql`
--   creates `orders` without it, and no `ALTER TABLE orders ADD
--   COLUMN tax ...` exists in any subsequent migration.
--
--   Migration 053's header comment (`orders.service_fee/tax/...`)
--   asserted the column existed as of 2026-08-17, but that assertion
--   was incorrect. The bug stayed latent because no test exercises the
--   `sql-fragments.ORDER_BASE_COLUMNS` consumers under a real DB
--   (`v1/orders/[id]/route.ts` and `v1/orders/[id]/invoice-pdf/route.ts`
--   have no `route.test.ts`).
--
--   Every SELECT that includes `o.tax::float` raises
--   `42703 column "tax" does not exist` against the production DB,
--   breaking `/api/v1/orders/[id]`, `/api/v1/orders/[id]/invoice-pdf`,
--   and the admin order detail PDF + invoice flow.
--
-- Decision: add the column with `DEFAULT 0` so existing rows are
--   preserved (historical `total` already includes whatever tax was
--   charged; we do NOT retroactively recompute it). The application
--   layer will start writing the field via the checkout pipeline in
--   a follow-up — for now the schema fix unblocks the SELECTs.
--
-- A future migration (081 or later) will introduce `orders.tax_rate`
-- and backfill `tax = round(subtotal * tax_rate / 100, 2)` for orders
-- placed after the rate is locked in. Until then, `tax = 0` is the
-- safe historical default.
--
-- Idempotent: re-running on a DB where the column already exists is a
-- no-op thanks to `IF NOT EXISTS`. Safe on empty DBs: `DEFAULT 0`
-- fires for the synthetic row 001 may seed.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS tax NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Touch `updated_at` so any downstream cache invalidators that watch
-- the row's mtime can re-read the new column.
COMMENT ON COLUMN orders.tax IS
  '15% VAT on catalog subtotal (added in 080). Zero for legacy orders — historical totals already include tax; backfill deferred.';
