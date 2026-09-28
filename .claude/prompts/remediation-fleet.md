# Fleet-wide `products` → `products_unified` migration (14 files)

## Context

The project is mid-migration from a single-vendor catalog (`products` table, ~3857 rows owned by City Markets) to a multi-vendor model (`vendor_products` owned by `vendors`). Migrations 014 + 039 backfilled legacy rows and 039 marked `products` read-only. Migration 036 created the `products_unified` view that JOINs both tables so reads still see all rows.

In the last review, two routes had been silently broken because they joined the legacy `products` table:
- `/api/v1/orders` — fixed
- `/api/v1/payments/initiate` — fixed

A grep across `src/**` reveals **14 more files** with the same pattern. Every one of them will return 0 rows for products/orders created after the 039 backfill, manifesting as either empty lists or confusing 404s. Fix the same way: switch reads to `products_unified`, keep writes on `vendor_products` (admin) or `orders`/`order_items` (customer).

## Affected files (verified by grep)

### Admin reads — 8 files
- `src/app/api/admin/inventory/route.ts:21,34` — `FROM products p` (×2)
- `src/app/api/admin/driver/orders/route.ts:81` — `JOIN products p ON oi.product_id = p.id`
- `src/app/api/admin/driver/orders/[id]/route.ts:49` — same
- `src/app/api/admin/products/[id]/route.ts:24` — `FROM products p`
- `src/app/api/admin/categories/route.ts:91,107,310` — `FROM products pr`, `FROM products p`, `FROM products` (×3)
- `src/app/api/admin/notifications/route.ts:83,109` — `FROM products` (×2)
- `src/app/api/admin/orders/route.ts:49` — `JOIN products p ON oi.product_id = p.id`

### Customer reads — 4 files
- `src/app/api/v1/products/[id]/route.ts:136,246` — `FROM products p`, `FROM products` (×2)
- `src/app/api/v1/orders/route.ts:108` — `LEFT JOIN products p ON oi.product_id = p.id`
- `src/app/api/v1/orders/track/route.ts:63` — same
- (Already fixed: `src/app/api/v1/orders/route.ts` lines 265/297/305, `src/app/api/v1/payments/initiate/route.ts:99`)

### Analytics — 1 file
- `src/lib/analytics-queries.ts:131,132` — `(SELECT COUNT(*) FROM products WHERE ...)` (×2)

## Rules for the fix

1. **Reads only**. The legacy `products` table is read-only; never write to it.
2. **Replace `FROM products` with `FROM products_unified`** (and `JOIN products` → `JOIN products_unified`). Keep the alias short (`p`) for minimal diff.
3. **If the query uses integer id columns** (e.g. `category_id` is `int4` in the legacy table but a UUID in `vendor_products`), check the `products_unified` view definition before assuming the cast. The view uses `COALESCE` to expose whichever id the source row carries. Use the column as-is.
4. **For COUNT(\*) in `analytics-queries.ts`**, `products_unified` exposes `is_active` and `stock_qty`; the column names match the legacy table, so the migration is a one-token swap.
5. **Do NOT change** `vendor_products` joins — those are correct. Only touch the `products` (bare) and `JOIN products` (without `_unified` suffix) sites.
6. **Add a regression test** for each route you touch. The test must assert the SQL string contains `products_unified` and does not contain `FROM products` or `JOIN products` (without the suffix). Use the `mockRequest` pattern from `src/app/api/v1/orders/route.test.ts` as a template.
7. **Driver / customer / order-tracking routes** that join `order_items` to products must use the unified view. Order items may now carry `product_id` values that exist in `vendor_products` but not in the legacy `products` table.

## Verification

After the migration:
- `grep -RIn --include='*.ts' --include='*.tsx' -E 'FROM products|JOIN products' src/` should return **no matches** other than `products_unified` / `vendor_products` and the regex word boundary test from `route.test.ts` files.
- `npx tsc --noEmit` clean.
- `npx vitest run` — 422 baseline + (14 × ~1) new regression tests = ~436 passing.

## Out of scope

- Writes to `products` (none should exist; spot-check confirms).
- The `vendor_products` schema itself (already correct).
- RLS policies on `products` (separate task; file under "admin/vendor authorization matrix" if needed).
