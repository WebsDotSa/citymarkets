-- 100_products_readonly_allow_delete.sql
--
-- Migration 091 blocked INSERT/UPDATE/DELETE on the legacy `products`
-- table, but `products_unified` (052/039c) Branch B resurrects a legacy
-- row once its `vendor_products` twin is removed (`NOT EXISTS` check
-- flips back to true). Admin product retirement (deleteProducts()) relies
-- on deleting the legacy row too, so blocking DELETE broke that flow.
--
-- Fix: the anti-drift intent of 091 is to stop new/changed data from
-- being written to the legacy table, not to block its retirement. Only
-- guard INSERT/UPDATE going forward; DELETE is allowed again.

BEGIN;

DROP TRIGGER IF EXISTS products_readonly_guard ON products;

CREATE TRIGGER products_readonly_guard
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION guard_products_readonly();

COMMIT;
