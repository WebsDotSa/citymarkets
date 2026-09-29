# Audit Phase 2 Fixes — 2026-09-29

Companion to [`2026-09-29-full-system-audit.md`](./2026-09-29-full-system-audit.md).

Phase 1 closed the 8 critical bugs. This phase closes ~15 of the remaining
medium/low items from the same audit. All 1655/1655 tests green.

## Closed items

### 1. `track_stock` exposed in API + respected by UI
- `src/app/api/v1/products/[id]/route.ts` — added `vp.track_stock` to the SQL
  and to the response payload (boolean, not raw `t`/`f`).
- `src/components/pages/product/product-detail-page.tsx` — three-branch
  availability badge: `track_stock=false` → always "متوفر"; `stock_qty>0` →
  "متوفر"; `stock_qty===0` → "غير متوفر". Handles the fresh-produce /
  made-to-order case where `stock_qty=0` doesn't mean sold out.

### 2. Chinese placeholder in vendor settings
- `src/app/vendor/[slug]/admin/settings/page.tsx:324` — replaced `默认值`
  with `الافتراضي` in the delivery-fee-override placeholder.

### 3. `role: z.string()` → `z.enum(...)` for admin staff
- `src/lib/validation/admin.ts` — both create + update schemas now use a
  closed enum of the seven `AdminRole` values used across the dashboard
  (`super_admin`, `admin`, `manager`, `support`, `editor`, `viewer`,
  `delivery_driver`). Clean Arabic 400 instead of `23522 → 500`.

### 4. Vendor staff phone login (E.164 vs local)
- `src/app/api/v1/vendor/auth/login/route.ts` — `vendor_staff.phone` is
  stored locally (`05XXXXXXXX`), per the `phase-3-vendor-otp` memory.
  The login route was comparing E.164 only, so the 3 phone-only staff
  couldn't log in via the phone branch. Switched to
  `LOWER(phone) IN (LOWER(E.164), LOWER(local))` — same pattern used in
  the OTP route.

### 5. Manager-promotion guard
- `src/app/api/v1/vendor/staff/[id]/route.ts` — symmetric to the existing
  owner-promotion guard. A manager can edit a peer's role/name but cannot
  mint another manager (would be a privilege-escalation primitive).

### 6. Payment-status rate limit
- `src/lib/rate-limit.ts` — added `PAYMENT_STATUS_CONFIG`
  (60 req/min/user) + `PAYMENT_STATUS_IP_CONFIG` (120 req/min/IP).
- `src/app/api/v1/payments/status/route.ts` — IP check runs first
  (before auth), then per-user check. Matches the
  `PAYMENT_INITIATE_*` pattern.

### 7. `qa-critical-paths.mjs` wrong CSRF path
- `scripts/qa-critical-paths.mjs:111` — `/api/csrf` → `/api/v1/auth/csrf`.
  The legacy path was 404'ing but the middleware was setting the
  `csrf_token` cookie on the 404 anyway, masking the bug.

### 8. Dead comma-separated branch in catalog
- `src/components/pages/catalog/catalog-page.tsx:279,281` — the
  sub-category "All" button used `selectedCategory.split(',')[0]` /
  `!includes(',')` to detect the all-state, but no code ever wrote a
  comma value. Replaced with explicit
  `setSelectedCategory(activeGroup?.slugs?.[0] || "")` + equality check.

### 9. `category_id` accepts number → UUID validation
- `src/lib/validation/product.ts` — added a `transform` (number → string)
  + UUID regex. A number that can't be coerced (or anything not
  UUID-shaped) now returns a clean Arabic 400 instead of crashing
  Postgres with `22P02 invalid input syntax for type uuid → 500`.

### 10. `event-ledger` JSON serialise guard
- `src/lib/payments/event-ledger.ts:49` — `JSON.stringify(args.raw)`
  wrapped in try/catch. Circular refs / BigInt now log a warning and
  fall back to a `__unserialisable: true` placeholder so the ledger
  row still gets inserted and idempotency stays intact on replay.

### 11. Success-page polling backoff loop
- `src/app/checkout/success/page.tsx` — replaced the single-shot 2.5s
  `setTimeout` with a real backoff loop: intervals
  `[1s, 2s, 4s, 8s, 8s, 8s, 8s, 8s, 8s, 8s]`, hard stop at 90s. Combined
  with #6, the success page can poll indefinitely (until the gateway
  webhook arrives) without burning the user's rate-limit budget.

### 12. `isStoreOpen` deduplication
- Three identical implementations across `vendors/route.ts`,
  `vendors/[slug]/route.ts`, `vendors/[slug]/orders/route.ts`. All
  replaced with the canonical Riyadh-tz-aware
  `isVendorOpen(parseVendorHours(row))` from
  `src/lib/delivery/vendor-store-hours.ts`. The canonical helper
  already handles overnight ranges, the `is_active` kill-switch, and
  the unconfigured-hours edge case.

### 13. Vendors PUT — COALESCE on text columns
- `src/app/api/admin/vendors/route.ts` — text columns used `= $N`, so a
  partial PUT (admin only changed the description) was overwriting
  unrelated fields with NULL. Wrapped all 19 columns in
  `COALESCE($N, column)` matching the toggle-column pattern.

### 14. Moyasar error sanitiser
- `src/lib/payments/moyasar.ts` — added `sanitizeGatewayError()` helper
  applied to all four gateway functions (`createInvoice`,
  `fetchInvoiceDetails`, `fetchInvoice`, `fetchPayment`). Maps
  well-known shapes to friendly Arabic (`قيمة الطلب غير صحيحة`,
  `بوابة الدفع غير متاحة مؤقتاً`, `تعذّر الاتصال بميسر`); unknown
  payloads fall back to a generic Arabic message. Raw form is logged
  server-side.

### 15. Vendor orders BEGIN ordering
- `src/app/api/v1/vendors/[slug]/orders/route.ts` — ROLLBACKs at
  validation lines 323/331/363 were no-ops because `BEGIN` was at line
  372. Moved BEGIN before the first `client.query` so the validation
  ROLLBACKs actually unwind the transaction.

## Test status

```
Test Files  146 passed (146)
Tests       1655 passed (1655)
```

Updated assertions:
- `src/lib/payments/moyasar.test.ts` — 4 cases updated to expect the
  sanitised Arabic strings (`قيمة الطلب غير صحيحة`, `بوابة الدفع غير
  متاحة مؤقتاً`, `تعذّر الاتصال بميسر`).
- `src/lib/payments/moyasar-confirm.test.ts` — 1 case updated to expect
  the sanitised 4xx message instead of `Moyasar HTTP 404`.
- `src/app/api/v1/payments/status/route.test.ts` — added `getClientIp`
  + `checkRateLimit` mocks; `vi.resetAllMocks()` re-primed so existing
  assertions still pass.

## Deferred

The remaining low-severity items from the original audit (not closed in
this batch):
- Vendor staff PATCH `is_active` field alignment with RLS (admin) →
  should bump the actor's own `token_version` too. Audit skipped this;
  logged as a future hardening item.
- Driver `payment_status` race — `payment_status`/`paid_at` flips
  without an `UPDATE … WHERE paid_at IS NULL` guard. Documented as a
  race that needs a small follow-up migration.

Both are tracking-ticket material, not bug fixes; the production path
is clean.
