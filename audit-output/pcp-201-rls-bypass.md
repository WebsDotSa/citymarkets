# PCP-201 — disable BYPASSRLS on `citymarket_user`

**Status:** DONE. Migration 118 applied 2026-10-03 02:08 UTC. Live and verified.

---

## What was missing (audit finding PCP-201)

> `citymarket_user.rolbypassrls=t` — all 38 RLS policies are cosmetic for the app role — `pcp-101-phase16-audit-report.md`, P0

The application connects to PostgreSQL as `citymarket_user`. The role had `BYPASSRLS=t`, which means **every RLS policy on every table was dead code for the role the app actually uses**. The 36 defensive RLS policies shipped in migrations 105, 108, and 115 were not actually protecting anything — a SQL-injection in any endpoint would bypass the row-level security entirely and read/write whatever it wanted.

This was a **production-critical misconfiguration**, not a missing feature: the protection had been built and was sitting in the schema, but a one-line role attribute was turning it off.

---

## Fix

`migrations/118_pcp201_disable_bypassrls.sql`:

```sql
ALTER ROLE citymarket_user NOBYPASSRLS;

INSERT INTO _migration_guards (guard_name, active, created_at)
VALUES ('pcp201_citymarket_user_no_bypassrls', true, now())
ON CONFLICT (guard_name) DO UPDATE SET active = true, created_at = now();
```

The guard record catches accidental re-grants: any later `ALTER ROLE citymarket_user BYPASSRLS;` would leave the guard stale, and `migration-drift-report.ts` will surface the inconsistency.

---

## Why this is safe to apply today

Every RLS policy on every table in this database is `<table>_app_all` with the form:

```sql
TO citymarket_user USING (true) WITH CHECK (true)
```

(see migrations 105, 108, 115). A `USING(true)` policy passes every row through. So turning RLS enforcement on for the app role does **not** change which rows are visible or writable to `citymarket_user`. The change is purely a posture fix: the misconfiguration is removed so that **future** policies (per-tenant, per-role) are actually enforced.

Direct verification, before/after on the live DB:

| Table | Before | After |
|-------|-------:|------:|
| `users` | 19,925 | 19,925 |
| `orders` | 76 | 76 |
| `admin_users` | 11 | 11 |
| `addresses` | 156 | 156 |
| `payment_events` | 0 | 0 |
| `refund_requests` | 0 | 0 |

The row counts are identical because all the policies are `USING(true)`. The change is invisible to existing code, but the door is now open to per-tenant policies.

---

## Negative test (proves RLS is actually enforced)

After the migration, I dropped `users_app_all` and added a restrictive policy that should match zero rows:

```sql
DROP POLICY users_app_all ON users;
CREATE POLICY users_test_strict ON users TO citymarket_user
  USING (id = '00000000-0000-0000-0000-000000000000'::uuid);
```

Result as `citymarket_user`:
- `SELECT count(*) FROM users` → **0** (was 19,925)
- `INSERT INTO users (phone) VALUES ('+966500000001');` → **`new row violates row-level security policy for table "users"`**

Then `ROLLBACK` restored the permissive policy. The DB is back to its pre-test state.

---

## Live app verification

- **App health**: `GET /api/health` → 200, DB up, latency 1 ms
- **Public endpoints**: `/`, `/catalog`, `/auth/login` → all 200
- **Auth-gated endpoints**: `/api/admin/users` → 401 (correct), `/api/v1/cart` → 200 (guest session works)
- **Vitest**: 2189/2189 pass, 5 skipped — same count as before the migration, no regressions
- **TypeScript**: `npx tsc --noEmit` → clean
- **App container logs**: no `RLS`, no `policy`, no `new row violates` errors (the only error in the recent tail is the pre-existing Twilio Geo Permissions block on `+966`, unrelated)

---

## What this fix does NOT do (deferred)

`NOBYPASSRLS` is the **misconfiguration fix**. The actual **isolation fix** requires per-tenant policies that restrict which rows each app role can touch. Out of scope for this PR:

| Deferred | Why | Effort |
|----------|-----|-------|
| `users` SELECT restricted to `id = current_user_id()` | Defense in depth — current state is "RLS enabled but permissive" | medium |
| `addresses` SELECT/UPDATE restricted to owner | Same | medium |
| `orders` SELECT restricted to customer or vendor or admin | Same | large (3 roles, multi-tenant) |
| `admin_users` SELECT restricted to admin role | Same | small |
| The 5 tables with RLS **disabled** (`categories`, `contact_messages`, `payment_events`, `wishlist_items`, `vendors`) | Some may be intentionally world-readable; needs policy review per table | medium |
| Remove the default `arwd` privileges on each table; replace with column-level grants where appropriate | Defense in depth — currently `citymarket_user` can SELECT any column of any RLS-protected table | small |

Each of these is a separate PR. The PCP-201 fix unblocks all of them — they were all blocked on `BYPASSRLS` being on, which would have made any restrictive policy dead code.

---

## Rollback

```sql
ALTER ROLE citymarket_user BYPASSRLS;
```

The migration is idempotent (the `ON CONFLICT` clause). Safe to re-run.
