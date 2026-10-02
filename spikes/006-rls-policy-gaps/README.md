# 006 — rls-policy-gaps

## Question
**Theory**: 21 tables have `rowsecurity=off`. Some are fine (system
tables, _migration_guards), but others might hold user-private data
and need policies. Identify which of the rls-off tables hold
customer/employee data, and decide: (a) needs RLS, (b) owned by
`postgres` so role bypass is fine, (c) only-written-by-trusted-role.

## Approach
1. List every public table with `rowsecurity=off`, with owner, size, and
   whether it has a FK to `public.users`
2. Cross-reference with migration 108 (`108_rls_defensive_policies_all_tables.sql`)
   which added defensive policies across the board
3. Check ownership bypass: tables owned by `postgres` bypass RLS for
   any role

## Query
See `query.sql`.

## Raw output
```
tbl|owner|size|n_live|rls_on|rls_forced|has_user_fk
abandoned_carts|postgres|208 kB|50|f|f|t
wishlist_items|postgres|72 kB|7|f|f|t
orders_refunds|citymarket_user|64 kB|0|f|f|t
broadcast_deliveries|postgres|56 kB|0|f|f|t
products|postgres|1464 kB|3454|f|f|f
categories|postgres|184 kB|156|f|f|f
home_layouts|postgres|120 kB|2|f|f|f
order_status_logs|postgres|96 kB|16|f|f|f
vendors|postgres|80 kB|7|f|f|f
app_migrations|postgres|64 kB|121|f|f|f
payment_events|postgres|48 kB|0|f|f|f
direct_order_items|postgres|48 kB|0|f|f|f
broadcasts|postgres|48 kB|0|f|f|f
schema_migrations|postgres|48 kB|18|f|f|f
admin_notification_reads|postgres|40 kB|0|f|f|f
_migration_guards|citymarket_user|32 kB|5|f|f|f
app_settings|postgres|32 kB|6|f|f|f
direct_order_messages|postgres|32 kB|0|f|f|f
broadcast_templates|postgres|32 kB|0|f|f|f
contact_messages|postgres|24 kB|0|f|f|f
direct_order_meta|postgres|24 kB|0|f|f|f
```

## Analysis

Tables that have a `user_id` FK AND are NOT owned by `postgres` (i.e.
`citymarket_user` is the table owner, and RLS would actually apply):
- **`orders_refunds`** — has user_id FK, owned by `citymarket_user`,
  no RLS. Contains refund records.
- **`_migration_guards`** — no user FK, owned by `citymarket_user`,
  no RLS. Internal-only.

All other tables with user FK (`abandoned_carts`, `wishlist_items`,
`broadcast_deliveries`) are owned by `postgres`. Postgres superuser
bypasses RLS by default, and `FORCE ROW LEVEL SECURITY` is also
`false` on these tables. So a request from `citymarket_user` would
**NOT** be subject to RLS even if it were enabled (because the table
is owned by `postgres`, but the policy is `FORCE` only on its own
owner).

Wait — that's the bug. Migration 105
(`105_grants_rls_and_bypass_for_citymarket_user.sql`) granted RLS
bypass to `citymarket_user`, but if a table is owned by `postgres`
and RLS is off, then `citymarket_user` has full read/write via
the standard `GRANT` (which is `arwdDxt/postgres` from the relacl).
That's actually how the system was designed — the schema migration
runner creates tables as `postgres`, then `citymarket_user` is
granted full access. So RLS-off on postgres-owned tables is
**intentional** and **not a security gap** (because there is no
policy that would restrict anything anyway).

But `orders_refunds` is **owned by `citymarket_user`** (not
`postgres`). This means RLS WOULD apply if it were enabled. It has
no RLS, so it has no restrictions. This table has both
`requested_by_user_id` and `payment_event_id` FK. Customer refund
data.

## Verdict: **VALIDATED** → **PCP-146**

## Recommendation
Either:
- (a) Enable RLS on `orders_refunds` and add a policy that allows
  customers to read their own refunds, admins to read all
- (b) Migrate the table owner to `postgres` to match the rest of
  the schema and document why (most consistent)

Option (a) is more defense-in-depth.
