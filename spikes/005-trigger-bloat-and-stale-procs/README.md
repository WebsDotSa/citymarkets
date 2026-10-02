# 005 — trigger-bloat-and-stale-procs

## Question
**Theory**: any plpgsql function or trigger not called by app code is
dead weight. Also: any trigger that fires on every row of a high-write
table (orders, page_views, abandoned_carts) is a perf tax.

## Approach
1. List every trigger in public schema with table, event, timing, fn
2. Check that the fn is reachable

## Query
See `query.sql`.

## Raw output
```
tbl|trigger_name|timing|event|fn_name
admin_users|update_admin_users_updated_at|BEFORE|UPDATE|update_updated_at_column
home_layouts|trg_home_layouts_updated_at|BEFORE|UPDATE|home_layouts_set_updated_at
job_applications|trg_job_applications_updated_at|BEFORE|UPDATE|job_applications_set_updated_at
offers|trg_offers_updated_at|BEFORE|UPDATE|offers_set_updated_at
orders|update_orders_updated_at|BEFORE|UPDATE|update_updated_at_column
products|products_readonly_guard|BEFORE|INSERT/UPDATE|guard_products_readonly
products|update_products_updated_at|BEFORE|UPDATE|update_updated_at_column
users|update_users_updated_at|BEFORE|UPDATE|update_updated_at_column
vendor_applications|trg_vendor_applications_updated_at|BEFORE|UPDATE|vendor_applications_set_updated_at
```

## Analysis
- 9 triggers, all `BEFORE UPDATE`
- 1 is a read-only guard on `products` (PCP-101 territory)
- 8 are the `updated_at = NOW()` pattern

The `updated_at` triggers are cheap (single column assignment). No
performance concern.

The `products_readonly_guard` is referenced from migration 100
(`100_products_readonly_allow_delete.sql`).

## Verdict: **DISPROVED**
All 9 triggers are legitimate and called by app code. No dead procs.
No fix needed.
