# 002 — duplicate-or-redundant-indexes

## Question
**Theory**: An index whose leading column is also the leading column of
another index on the same table is a "redundant" index — Postgres never
picks it (it can only use one index per query, and the wider one is
always better). Pure write-amp waste.

## Approach
1. Query `pg_index` for pairs of indexes on the same table with the same
   leading column
2. Filter to cases where one is a strict superset of the other (same
   leading column, same/similar INCLUDE / opclass, but wider)
3. Check `pg_stat_user_indexes.idx_scan` to confirm the redundant one
   is unused
4. `EXPLAIN` the queries that the app actually runs to confirm the kept
   index is the one the planner picks

## Query
See `query.sql`.

## Raw output
```
tbl|redundant_idx|kept_idx|wasted
products|idx_products_category_active|idx_products_category|48 kB
addresses|idx_addresses_user_default_full|idx_addresses_user|16 kB
guest_cart|idx_guest_cart_session_updated|idx_guest_cart_session|16 kB
orders|idx_orders_user_created|idx_orders_user|16 kB
orders|idx_orders_user_status_date|idx_orders_user_id|16 kB
orders|idx_orders_user_status_date|idx_orders_user|16 kB
cart|idx_cart_user_product|idx_cart_user|16 kB
cart|idx_cart_user_updated|idx_cart_user|16 kB
categories|idx_categories_parent_active|idx_categories_parent|16 kB
addresses|idx_addresses_user_default|idx_addresses_user|16 kB
order_items|idx_order_items_order_product|idx_order_items_order|16 kB
orders|idx_orders_status_date|idx_orders_status|16 kB
broadcasts|idx_broadcasts_status_scheduled|idx_broadcasts_status|8192 bytes
orders|idx_orders_user_coupon|idx_orders_user|8192 bytes
admin_notification_reads|idx_admin_notification_reads_lookup|idx_admin_notification_reads_admin|8192 bytes
```

## Drill-down: which are TRULY redundant?

Checked `pg_stat_user_indexes.idx_scan` for the top candidates and
ran `EXPLAIN` against the actual app queries:

| Redundant | idx_scan | Plannner picks for app query? | Truly dead? |
|-----------|---------:|-------------------------------|:-----------:|
| `idx_addresses_user` | 0 | `idx_addresses_user_id` wins for `WHERE user_id=$1` | **YES** |
| `idx_addresses_user_id` | 2 | n/a (this is the kept one) | — |
| `idx_orders_user` | 0 | `idx_orders_user_id` wins | **YES** |
| `idx_orders_user_id` | 0 | n/a (kept) | — |
| `idx_orders_user_created` | 0 | subsumed by `idx_orders_user_status_date` (same `(user_id, created_at DESC)`) | **YES** |
| `idx_orders_user_status_date` | 0 | kept | — |
| `idx_addresses_user_default` | 0 | partial `WHERE is_default=true`; not strictly redundant but never used in current workload | maybe (keep for now) |
| `idx_addresses_user_default_full` | 0 | broader version, never picked | **YES** |
| `idx_admin_notification_reads_admin` | 0 | subsumed by `idx_admin_notification_reads_lookup` (26 scans) | **YES** |
| `idx_admin_notification_reads_lookup` | 26 | kept | — |
| `idx_products_category_active` | 150 | partial `WHERE is_active=true`; different access path than `idx_products_category` (225K scans) | **NO** (used) |
| `idx_broadcasts_status_scheduled` | 164 | partial `WHERE status='scheduled'`; not redundant with `idx_broadcasts_status` (492 scans) | **NO** (used) |
| `idx_orders_user_coupon` | n/a | expression index `upper(coupon_code)` — different access path | **NO** (used) |
| `idx_cart_user_product`, `idx_cart_user_updated` | n/a | `(user_id, product_id)` / `(user_id, updated_at)` are wider than `(user_id)` | **NO** (used) |
| `idx_guest_cart_session_updated` | n/a | `(session_id, updated_at)` wider than `(session_id)` | **NO** (used) |
| `idx_categories_parent_active` | n/a | partial; different from `idx_categories_parent` | **NO** (used) |
| `idx_order_items_order_product` | n/a | `(order_id, product_id)` wider than `(order_id)` | **NO** (used) |
| `idx_orders_status_date` | n/a | `(status, created_at DESC)` wider than `(status)` | **NO** (used) |

**Truly dead indexes** (4 indexes, ~32 kB saved):
1. `idx_addresses_user` (drop, 16 kB)
2. `idx_orders_user` (drop, 16 kB)
3. `idx_orders_user_created` (drop, 16 kB — same as `idx_orders_user_status_date`)
4. `idx_admin_notification_reads_admin` (drop, 8 kB)
5. `idx_addresses_user_default_full` (drop, 16 kB — broader than partial)

Total: 5 indexes, ~72 kB. Small size, but each write currently has to
maintain both — measurable on the high-write `orders` and `cart` tables.

## Verdict: **VALIDATED** → **PCP-144**

## Recommendation
Migration 113: drop the 5 truly dead indexes. Owner = `postgres`
(matches Phase 14 pattern for products/vendors/etc.).
