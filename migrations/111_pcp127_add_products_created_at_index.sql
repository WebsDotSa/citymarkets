-- 111_pcp127_add_products_created_at_index.sql
-- PCP-127: admin /api/admin/products orders by `p.created_at DESC`
-- for every list call. With 3,454 rows today (and growing), this
-- requires either a sort-on-disk (small now, but grows linearly) or
-- a full sequential scan. Adding a btree index on (created_at DESC)
-- turns the list query into an index-only scan.
--
-- Also adds the matching index on vendor_products because the same
-- admin view joins both tables via the products_unified view.
--
-- REQUIRES SUPERUSER: the products and vendor_products tables are
-- owned by `postgres`, not by `citymarket_user`. The migration runner
-- connects as citymarket_user and will fail with "must be owner of
-- table products" unless you run the file manually as the postgres
-- role. The applied file in this cluster was loaded via:
--   docker exec -i citymarket-db psql -U postgres -d citymarket_db \
--     < migrations/111_pcp127_add_products_created_at_index.sql
-- and then recorded in app_migrations by citymarket_user.
--
-- The IF NOT EXISTS clause means a re-run is safe.

BEGIN;

-- products.created_at
CREATE INDEX IF NOT EXISTS idx_products_created_at
  ON public.products USING btree (created_at DESC);

-- vendor_products.created_at
CREATE INDEX IF NOT EXISTS idx_vendor_products_created_at
  ON public.vendor_products USING btree (created_at DESC);

-- Record the audit marker so operators can confirm.
INSERT INTO _migration_guards (guard_name, active, created_at)
VALUES (
  'pcp127_products_created_at_index',
  TRUE,
  NOW()
)
ON CONFLICT (guard_name) DO UPDATE
  SET active = EXCLUDED.active,
      created_at = EXCLUDED.created_at;

COMMIT;
