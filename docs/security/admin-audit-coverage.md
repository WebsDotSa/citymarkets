# Admin Audit Trail — Coverage Status

P1-2 (security audit, 2026-10-03) called out that 10 admin routes
lacked `logAdminAction` calls. Phase 4 closes the high-value gaps; the
remaining routes are documented here so the next reviewer knows what
is and is not audited, and what the rationale is.

## Audited (Phase 4, this commit)

- `src/app/api/admin/coupons/route.ts` — POST, PUT, DELETE
  Coupons are the highest-value abuse vector (admin-issued codes for
  self or accomplices). All three handlers log the full payload on
  create, the changed fields on update, and the id on delete.

- `src/app/api/admin/offers/route.ts` — POST
  Discount offer creation. Logs title + discount config + target count.

- `src/app/api/admin/offers/[id]/route.ts` — PUT, DELETE
  Discount offer updates and deletes. Same fields as create + the row id.

- `src/app/api/admin/categories/route.ts` — POST
  Category creation. Logs name + slug + parent. PUT/DELETE remain
  unaudited (low rate of change, no abuse pattern observed in the
  audit). If a follow-up is needed it is a one-line patch per handler.

- `src/app/api/admin/upload/route.ts` — POST
  File uploads can carry XSS payloads. Fire-and-forget audit so the
  upload response is not blocked on the insert.

## Already audited before Phase 4

The audit listed these as "missing" but the survey found they were
already wired up. Listed here so the next reviewer does not double-
check:

- `src/app/api/admin/reviews/route.ts` — PUT
- `src/app/api/admin/admin-users/route.ts` — POST, PUT, DELETE
- `src/app/api/admin/vendors/[id]/route.ts` — PATCH
- `src/app/api/admin/broadcasts/*` — all 5 routes
- `src/app/api/admin/broadcast-templates/*` — both routes
- `src/app/api/admin/users/route.ts`
- `src/app/api/admin/vendor-applications/*` — both routes
- `src/app/api/admin/inventory/route.ts`
- `src/app/api/admin/loyalty/route.ts`
- `src/app/api/admin/stores/route.ts`
- `src/app/api/admin/orders/*` — all routes
- `src/app/api/admin/products/bulk-activate/route.ts`
- `src/app/api/admin/settings/*` — both routes
- `src/app/api/admin/delivery-settings/route.ts`

## Not audited — read-only endpoints

These have a mutating export (POST/PUT/PATCH/DELETE) but the handler
is a pure read; the audit row would be empty and the cost of the
insert is not justified:

- `src/app/api/admin/abandoned-carts/route.ts` — GET only
- `src/app/api/admin/payments/route.ts` — GET only
- `src/app/api/admin/coupons/route.ts` — GET is unaudited (read)
- `src/app/api/admin/offers/route.ts` — GET is unaudited
- `src/app/api/admin/vendors/[id]/analytics/route.ts` — GET only
- `src/app/api/admin/categories/route.ts` — GET is unaudited
- `src/app/api/admin/broadcast-providers/status/route.ts` — GET only
- `src/app/api/admin/broadcasts/audience-preview/route.ts` — POST is
  a read-only audience query, no row mutation
- `src/app/api/admin/broadcasts/[id]/metrics/route.ts` — GET only

## Not audited — low-value endpoints

These are mutating but the audit row would be the same as the
existing rate-limit or activity log; the added value is low:

- `src/app/api/admin/auth/login/route.ts` — POST
  Login attempts are recorded in the rate-limit log and the JWT
  `tokenVersion` claim provides post-incident attribution. Adding an
  admin_audit_log row on top of that is duplication.

- `src/app/api/admin/employment/route.ts` — PATCH
  Employment is operational data, not a high-value abuse vector.
  Rate of change is low; can be added if an incident review needs it.

- `src/app/api/admin/driver/orders/[id]/route.ts` — PATCH
  Driver order status updates. Already captured in the
  `payment_events` ledger (vendor push, SMS dispatch) and the
  order status transitions. Admin_audit row would be the third
  copy of the same event.

- `src/app/api/admin/orders/[id]/messages/route.ts` — POST
  Internal admin-to-vendor message thread. Low value, no
  observed abuse pattern.

## Follow-up

If the next audit identifies a missing route, add `logAdminAction`
following the pattern in any of the routes listed in the first
section above. The helper at `src/lib/admin-audit.ts` is
fire-and-forget by design — a logging failure never blocks the
caller's response.
