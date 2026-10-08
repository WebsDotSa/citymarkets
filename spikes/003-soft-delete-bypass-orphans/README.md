# 003 — soft-delete-bypass-orphans

## Question
**Theory**: When a user is soft-deleted (`UPDATE users SET deleted_at=NOW()`),
the child tables (`cart`, `wishlist_items`, `loyalty_transactions`, etc.) are
NOT touched. Auth tokens are invalidated, but the data still exists. If any
admin API returns "all cart items" or "all wishlist items" without joining to
`users` and filtering `deleted_at IS NULL`, the soft-deleted user's data
leaks.

## Approach
1. List every child table with FK to `public.users`, with `ON DELETE` mode
   and whether the FK is NOT NULL
2. Check whether the child table has its own `deleted_at` column
3. Grep the app for queries against these tables — do they filter by
   `users.deleted_at`?
4. Test the admin user-list endpoint — does it filter out soft-deleted users?

## Query
See `query.sql`.

## Raw output
```
child_table|child_user_col|confdeltype|on_delete|fk_col_notnull|child_has_deleted_at
abandoned_carts|user_id|n|SET NULL|f|f
addresses|user_id|c|CASCADE|f|f
ai_sessions|user_id|c|CASCADE|t|f
broadcast_deliveries|user_id|c|CASCADE|t|f
cart|user_id|c|CASCADE|t|f
coupons|referrer_user_id|n|SET NULL|f|f
coupons|user_id|c|CASCADE|f|f
loyalty_transactions|user_id|c|CASCADE|t|f
orders|user_id|r|RESTRICT|f|f
orders_refunds|requested_by_user_id|n|SET NULL|f|f
product_reviews|user_id|c|CASCADE|t|f
refund_requests|approved_by_user_id|n|SET NULL|f|f
refund_requests|requested_by_user_id|n|SET NULL|f|f
spin_results|user_id|c|CASCADE|t|f
user_otps|user_id|c|CASCADE|t|f
wishlist_items|user_id|c|CASCADE|t|f
```

## App grep results
- Only 3 source files mention `deleted_at`:
  - `src/app/api/v1/auth/login/route.ts` (block login if soft-deleted)
  - `src/app/api/v1/profile/delete/route.ts` (perform the soft-delete)
  - `src/app/api/admin/users/route.ts` (admin-side soft-delete)
- `src/lib/identity/wishlist-service.ts:113` — `listWishlist` queries
  `wishlist_items WHERE user_id = $1` with **no deleted_at filter** on
  the joined `users` row. But this is only called from a customer-side
  endpoint, which already rejects soft-deleted users at login. So the
  data is not exposed to the deleted user themselves. **OK.**
- `src/app/api/v1/loyalty/route.ts:35-40` — same: only callable by the
  logged-in user. The auth check (via `resolveCustomerUserIdFromRequest`)
  already rejects soft-deleted users. **OK.**

## **But** the admin user-list endpoint leaks
- `src/app/api/admin/users/route.ts:31-39` (GET handler):
  ```sql
  SELECT id, phone, name, email, loyalty_points, loyalty_tier,
         spin_count_today, created_at
    FROM users
   ORDER BY created_at DESC
   LIMIT $1 OFFSET $2
  ```
- **No `WHERE deleted_at IS NULL` filter.**
- The DELETE handler anonymizes PII (`phone = 'deleted-' || ...`, `name = NULL`,
  `email = NULL`), so the row IS empty of PII. But:
  - The `id` is still returned → can be cross-referenced with `orders`
  - The `loyalty_points` and `loyalty_tier` are NOT zeroed out
  - The `created_at` reveals the original signup time
  - The `spin_count_today` is still tracked

## Verdict: **VALIDATED** → **PCP-145**

## Recommendation
Add `WHERE deleted_at IS NULL` to the admin GET `/api/admin/users` query.
Also: in the DELETE handler, the soft-delete anonymization does NOT
zero out `loyalty_points` and `loyalty_tier`. These are an attack
surface for "phantom customer with high tier" confusion. Set them
to 0 and 'bronze' (or NULL) in the soft-delete UPDATE.
