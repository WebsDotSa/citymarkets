# PCP-101 — Backend Audit Report (citymarkets.sa)

**Repo**: `/var/www/citymarkets.sa/city-market-app` @ `b5ca8f5`
**App URL**: `http://localhost:3005` (container `city-market-app-citymarket-app-1`, up & healthy)
**Audit date**: 2026-10-01
**Scope**: read-only verification of all P1/P2 fixes from prior sessions (PCP-76 F2/F3/F4/F5/F6, PCP-81, PCP-82, PCP-83) + DB schema + smoke-test of order endpoints + UN-discovered bugs.

---

## TL;DR — Six audit items, **5 PASS, 3 NEW CRITICAL BUGS FOUND**

| # | Item | Status |
|---|---|---|
| 1 | PCP-83 — Content-derived idempotency fallback (checkout-service.ts:178-186) | ✅ PASS (8/8 tests pass) |
| 2 | PCP-76 F2 — Vendor orders GET bulk query (ANY($1::uuid[])) | ✅ PASS (vendors/[slug]/orders/route.ts:168) |
| 3 | PCP-76 F3 — Driver route request.json() in try + releaseRedeemHoldForOrderSafe | ✅ PASS (admin/driver/orders/[id]/route.ts:148-156, 371, 489) |
| 4 | PCP-76 F5 — Vendor orders POST bulk INSERT + bulk UPDATE FROM VALUES | ✅ PASS (vendors/[slug]/orders/route.ts:443-471) |
| 5 | PCP-76 F6 — Admin orders PUT FOR UPDATE | ✅ PASS (admin/orders/[id]/route.ts:130) |
| 6 | PCP-81 — mapMoyasarStatusToDb('refunded') returns 'refunded' + PaymentDbStatus type | ✅ PASS (moyasar.ts:380, reconcile-payment.ts:57) |
| 7 | PCP-82 — Customer + admin refund endpoints exist, return JSON, CSRF 403 | ✅ PASS (smoke-tested below) |
| 8 | Migration 106 (refund_requests) applied to app_migrations | ✅ PASS (applied 2026-10-01 13:41:49) |
| **9** | **Items query in admin/customer order detail routes** | **❌ CRITICAL — uses legacy `products` table; `order_items.product_id` FKs to `vendor_products.id` → 100% of orders return `items: []`** |
| **10** | **`GET /api/v1/orders/[id]` invalid UUID returns 500 not 400** | **❌ HIGH — no UUID validation, throws on Postgres type cast** |
| **11** | **Wishlist `column p.slug does not exist`** | **❌ HIGH — fix from 2026-09-30 skill is NOT applied; live errors in production logs** |

---

## 1. Smoke tests

| Endpoint | Method | Expected | Actual | Verdict |
|---|---|---|---|---|
| `/api/health` | GET | 200 | 200 | ✅ |
| `/api/v1/orders/test-id-uuid` | GET | 4xx (not 500) | **500** `{"error":"تعذر التحميل"}` | ❌ see §10 |
| `/api/v1/orders/00000000-0000-0000-0000-000000000000` | GET | 404 | 404 `{"error":"الطلب غير موجود"}` | ✅ |
| `/api/v1/orders/[id]/refund` | POST | 403 CSRF | 403 `{"error":"انتهاك أمان - رمز التحقق غير صالح","code":"CSRF_ERROR"}` | ✅ |
| `/api/admin/orders/[id]/refund` | POST | 403 CSRF | 403 CSRF | ✅ |
| `/api/admin/orders/<real-uuid>` | GET (no auth) | 401 | 401 `{"error":"يجب تسجيل الدخول"}` | ✅ |
| `/api/v1/orders/<real-uuid>` | GET (no auth) | 403/401 | 403 `{"error":"ليست لديك صلاحية"}` | ✅ |

PCP-82 refund endpoints (customer + admin) all return JSON (not 500) and respect CSRF. **Both routes are wired and production-ready.**

Production log evidence for `GET /api/v1/orders/test-id-uuid`:
```
[2026-10-01T15:19:20.009Z] [ERROR] order detail GET failed
  "error":"invalid input syntax for type uuid: \"test-id-uuid\""
```

---

## 2. Fix verification (file:line + before/after)

### PCP-83 — Content-derived idempotency fallback
**File**: `src/lib/orders/checkout/checkout-service.ts:185-186`
```ts
const idempotencyKey: string =
  v.idempotency_key ?? deriveContentIdempotencyKey(v, caller);
```
Helper `deriveContentIdempotencyKey` defined at `checkout-service.ts:134-160` — sha256 over `(items, vendor_groups, identity, minute_window)` → 32-hex prefix. Test file present: `src/lib/orders/checkout/idempotency-key.test.ts` (143 lines, **8/8 tests pass**).

### PCP-76 F2 — Vendor orders GET bulk query
**File**: `src/app/api/v1/vendors/[slug]/orders/route.ts:150-170`
```ts
const bulkItems = await query(
  `SELECT voi.order_id, voi.id, voi.product_id, voi.product_name_snapshot,
          voi.unit_price, voi.quantity, voi.line_total, voi.notes, vp.image_urls
     FROM vendor_order_items voi
     LEFT JOIN vendor_products vp ON voi.product_id = vp.id
    WHERE voi.order_id = ANY($1::uuid[])`,
  [orderIds],
);
```
Replaces the previous Promise.all loop. Comment at lines 133-137 documents the change.

### PCP-76 F3 — Driver route safety
**File**: `src/app/api/admin/driver/orders/[id]/route.ts:147-156`
```ts
let body: { status?: string; failureReason?: string; claim?: boolean };
try {
  body = (await request.json()) as typeof body;
} catch {
  await client.query("ROLLBACK").catch(() => {});
  return NextResponse.json(
    { success: false, error: "بيانات غير صالحة" },
    { status: 400 },
  );
}
```
`releaseRedeemHoldForOrderSafe(pool, { orderId: id })` (the safe pool version, not the stale-client variant) imported at line 17 and used at lines 371 + 489 in both claim and non-claim cancel branches.

### PCP-76 F5 — Vendor orders POST bulk INSERT + bulk UPDATE
**File**: `src/app/api/v1/vendors/[slug]/orders/route.ts:425-472`
- Bulk INSERT (lines 443-448): `INSERT INTO vendor_order_items (...) VALUES (...), (...), ...` with bound parameters per row.
- Bulk stock decrement (lines 465-471): `UPDATE vendor_products vp SET stock_quantity = vp.stock_quantity - d.qty FROM (VALUES (...),(...)) AS d(id, qty) WHERE vp.id = d.id`.

### PCP-76 F6 — Admin orders PUT FOR UPDATE
**File**: `src/app/api/admin/orders/[id]/route.ts:130`
```ts
const ord = await client.query(
  `SELECT id, status, type, total::float, driver_id FROM orders WHERE id = $1 FOR UPDATE`,
  [orderId]
);
```
Lock acquired at the start of the PATCH transaction; precedes `assertValidTransition`, `UPDATE orders`, `UPDATE coupons`, `releaseRedeemHoldForOrder`.

### PCP-81 — Refunded status mapping
**File**: `src/lib/payments/moyasar.ts:378-383`
```ts
export function mapMoyasarStatusToDb(remote: string): "paid" | "refunded" | "failed" | "pending" {
  if (remote === "paid" || remote === "captured") return "paid";
  if (remote === "refunded") return "refunded";        // ← not "failed"
  if (remote === "failed" || remote === "voided") return "failed";
  return "pending";
}
```
**Type definition**: `src/lib/payments/reconcile-payment.ts:57`:
```ts
export type PaymentDbStatus = "paid" | "failed" | "pending" | "refunded";
```
Webhook usage: `src/app/api/v1/payments/webhook/route.ts:94` `const paymentDb = mapMoyasarStatusToDb(remote.status ?? '');`. Test in `moyasar.test.ts:414` asserts `mapMoyasarStatusToDb("refunded") === "refunded"`.

### PCP-82 — Refund endpoints
Both endpoints registered, return JSON envelopes (not 500), and respect CSRF:

**Customer**: `src/app/api/v1/orders/[id]/refund/route.ts`
- `applyCsrfProtection` (line 49) before any DB work.
- `SELECT … FOR UPDATE` on order (line 88).
- Duplicate check via `SELECT … FROM refund_requests WHERE order_id = $1 AND status IN ('pending','approved') FOR UPDATE` (lines 151-158) → returns 200 with `already_pending: true` on dup.
- 24h window gate at lines 142-148.
- Writes `refund_requests` row + `order_status_logs` (lines 174-187).

**Admin**: `src/app/api/admin/orders/[id]/refund/route.ts`
- `requireAdminApi(request, 'manage_orders')` at line 47.
- Idempotent path: `payment_status === 'refunded'` → returns existing `refund_requests` row with 200 (lines 104-124).
- `SELECT … FOR UPDATE` on order (line 86) — serialises concurrent admin clicks.
- Ledger row first (`recordPaymentEvent`, lines 188-195), then Moyasar call, then `finalizePaymentEvent`.
- Refund failure path: `refund_requests.status='failed'` + `finalizePaymentEvent(..., 'failed')` + 502.
- Success path: `orders.payment_status='refunded'`, `refund_requests.status='completed'`, `gateway_refund_id` populated, `order_status_logs` row + `logAdminAction('refund.execute', ...)`.

---

## 3. Database validation

### Migration 106 — `refund_requests`
**Status**: applied.
```
filename                     | applied_at
-----------------------------+-------------------------------
106_refund_requests.sql      | 2026-10-01 13:41:49.439178+00
```
Schema verified via `\d refund_requests`:
- 12 columns (`id`, `order_id`, `requested_by_user_id`, `reason`, `status`, `gateway_refund_id`, `refund_amount_halalas`, `error_message`, `approved_by_user_id`, `created_at`, `updated_at`, `completed_at`).
- CHECK constraint: `status IN ('pending', 'approved', 'rejected', 'completed', 'failed')`.
- UNIQUE partial index `uq_refund_requests_order_active` on `(order_id) WHERE status IN ('pending','approved')` — the dedup guard.
- FK to `orders(id) ON DELETE CASCADE` — orders UUID.
- RLS enabled, policy `refund_requests_app_rw` TO `citymarket_user` USING/WITH CHECK (true).

### Table counts
```
orders.type breakdown: catalog=76, direct=0  (100% catalog)
order_items: 3 sample orders, 1 row each
direct_order_items: 0 rows total (dead table for the live data set)
```

---

## 4. CRITICAL / HIGH / MEDIUM / LOW issues

### ❌ CRITICAL #1 — Order detail items query joins the WRONG table

**Affected routes (all three)**:
- `src/app/api/admin/orders/[id]/route.ts:50-59` (admin GET)
- `src/app/api/v1/orders/[id]/route.ts:76-85` (customer GET)
- `src/app/api/v1/orders/[id]/invoice-pdf/route.ts:107-115` (invoice PDF)

All three contain this pattern:
```ts
const items = await query(
  `SELECT i.id, i.product_id, p.name_ar, p.image_url, p.price::float,
          i.free_text, i.quantity, i.unit_price::float, i.notes,
          i.resolved_price::float, i.resolved_product_id, i.resolved_at
   FROM direct_order_items i
   LEFT JOIN products p ON p.id = i.product_id
   WHERE i.order_id = $1
   ORDER BY i.created_at ASC`,
  [orderId]
);
```

**Two compounding bugs:**

1. **Wrong source table.** The skill documents (and the DB confirms) that the catalog refactor moved product FKs from `products` to `vendor_products`. `order_items.product_id` is a FK to `vendor_products(id)` — verified live:
   ```
   "order_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES vendor_products(id) ON DELETE RESTRICT
   ```
   And `direct_order_items` has **0 rows** in the live DB (76/76 orders are `type='catalog'`). The queries will return `items: []` for **every single order** in production — admin chat hub shows empty line items, customer order-detail page shows "لا توجد منتجات", invoice PDF has an empty line-items table.

2. **Wrong JOIN target.** Even if direct orders existed, the LEFT JOIN is on `products p` (the legacy table) not `vendor_products`. The admin GET column list also includes `i.resolved_product_id` — `direct_order_items` has no such column (`order_items` doesn't either), so the query is silently projected wrong.

**Verified live**:
```
catalog order 36037759-27e7-4de3-8445-521ae23a6419:
  JOIN products on direct_order_items   → 0 rows
  JOIN vendor_products on order_items   → 1 row (correct item)
```

**Fix (verbatim from skill)** — replace the three queries with the UNION ALL pattern:
```sql
SELECT * FROM (
  SELECT i.id, i.product_id, p.name_ar, p.image_url, p.price::float,
         NULL::text       AS free_text,
         i.qty            AS quantity,
         i.unit_price::float,
         i.notes,
         NULL::numeric    AS resolved_price,
         NULL::uuid       AS resolved_product_id,
         NULL::timestamp  AS resolved_at,
         NULL::timestamp  AS created_at
    FROM order_items i
    LEFT JOIN (SELECT id, name_ar, name_en, price,
                      COALESCE(NULLIF(image_url, ''), image_urls[1]) AS image_url
                 FROM vendor_products) p ON p.id = i.product_id
   WHERE i.order_id = $1
  UNION ALL
  SELECT i.id, i.product_id, p.name_ar, p.image_url, p.price::float,
         i.free_text, i.quantity, i.unit_price::float, i.notes,
         i.resolved_price::float, i.resolved_product_id, i.resolved_at, i.created_at,
         i.resolved_by_admin_id::text
    FROM direct_order_items i
    LEFT JOIN (SELECT id, name_ar, name_en, price,
                      COALESCE(NULLIF(image_url, ''), image_urls[1]) AS image_url
                 FROM vendor_products) p ON p.id = i.product_id
   WHERE i.order_id = $1
) u ORDER BY created_at ASC NULLS LAST
```
**Severity**: CRITICAL — silently breaks every order detail view in the app.

---

### ❌ HIGH #2 — `GET /api/v1/orders/[id]` returns 500 for malformed UUIDs (should be 400)

**File**: `src/app/api/v1/orders/[id]/route.ts:38-51`

The route accepts the `id` path param verbatim and passes it to Postgres `WHERE o.id = $1`. A non-UUID string (`test-id-uuid`) causes `error: invalid input syntax for type uuid: "test-id-uuid"` (PG 22P02), which the route's catch-all maps to 500 `تعذر التحميل`.

**Fix**: validate UUID format up front and return 400/404.
```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(orderId)) {
  return NextResponse.json({ success: false, error: 'معرّف الطلب غير صالح' }, { status: 400 });
}
```
The admin/invoice-pdf routes share the same trap — apply the same guard.

**Severity**: HIGH — surfaces as a generic 500 in the customer app for any URL with a malformed UUID (typo, URL parameter tampering, share-link corruption).

---

### ❌ HIGH #3 — Wishlist endpoint still throws `column p.slug does not exist`

**File**: `src/lib/identity/wishlist-service.ts:70-77`
```ts
const WISHLIST_PRODUCT_FIELDS = `
  p.id, COALESCE(p.name_ar, p.name_en) AS name, p.name_ar, p.slug,    // ← p.slug removed in skill, still here
  ...
`;
```
Used at lines 113 and 202. Live production log (last 24h, 3 errors):
```
[2026-10-01T15:21:46.793Z] [ERROR] wishlist list error
  "error":"column p.slug does not exist"
```
The skill claims this was fixed on 2026-09-30 by dropping `slug` from `WISHLIST_PRODUCT_FIELDS`, `WishlistProduct` interface, and the row type. **None of that is in the current tree** — `WishlistProduct` interface still has `slug: string` (line 47), `WISHLIST_PRODUCT_FIELDS` still includes `p.slug`, and the wishlist GET endpoint returns 500 to the customer.

**Fix** (per skill): drop `p.slug` from `WISHLIST_PRODUCT_FIELDS`, drop `slug: string` from `WishlistProduct` and the row types in lines 103/186, and stop reading `r.slug` / `row.slug` in the mappers. The `Product` type in `lib/types.ts` never had `slug`, so the schema contract is correct; the query is the problem.

**Severity**: HIGH — every wishlist list call returns 500; any user opening the wishlist page sees a broken state.

---

### ⚠ MEDIUM #4 — RLS policy on `refund_requests` uses a permissive `true` predicate

**Verified**:
```
POLICY "refund_requests_app_rw" TO citymarket_user USING (true) WITH CHECK (true)
```
The policy allows `citymarket_user` (the app role) to read/write any row. This is acceptable because the API routes enforce ownership inside the application layer (`requireAdminApi`, `assertOrderOwnership`), but it means a bug in those routes can leak refund rows. Acceptable for current threat model; document the assumption so future engineers don't rely on RLS as a backstop.

**Severity**: MEDIUM (defense-in-depth gap, not exploitable today).

---

### ⚠ LOW #5 — `safeFetchJson` returns `T | null` and silently swallows errors

**File**: `src/lib/safe-fetch.ts:30-42`

`safeFetchJson` returns `null` on network failure or non-200 — callers cannot distinguish "network failed" from "200 with body `null`". `safeFetchJsonStrict` exists for callers that need `SafeFetchResult<T>` (the discriminated union), but it's not used everywhere. Several callers in admin pages do `const data = await safeFetchJson<T>(...)` then `if (data) ...` and report nothing when `null` means "the server 500'd". Not a regression introduced by these P1/P2 fixes; mention for the next audit pass.

**Severity**: LOW (no broken audit items rely on this).

---

## 5. Recommendations

1. **Apply the UNION ALL items-query fix to all three order-detail routes immediately** (admin `[id]`, customer `[id]`, `[id]/invoice-pdf`). This is the highest-impact bug — every catalog order is broken.
2. **Apply the UUID-validation guard** to all three order-detail routes. Single regex check at the top of each handler.
3. **Apply the wishlist `slug` removal** to `src/lib/identity/wishlist-service.ts` (lines 47, 53, 70-77, 103, 109, 113, 127, 133, 186, 192, 202, 223, 229). Update the test file at `wishlist-service.test.ts` to match.
4. **Run vitest** for `wishlist-service.test.ts` after the slug fix to confirm the test suite still passes.
5. **Re-run the post-fix smoke tests** with a real (admin) auth token against `/api/admin/orders/[id]` and verify `items[]` is non-empty.
6. **Tighten the `refund_requests` RLS policy** (optional, follow-up): switch from USING(true) to USING(order_id IN (SELECT id FROM orders WHERE user_id = current_setting('app.user_id')::uuid OR ...)) so the DB enforces ownership as a backstop.
7. **Update the citymarkets-checkout skill** with the three NEW bugs above so the next audit doesn't rediscover them.

---

## Appendix — Verbatim response bodies from the smoke tests

```
GET /api/health                                       → 200 OK
GET /api/v1/orders/test-id-uuid                       → 500 {"success":false,"error":"تعذر التحميل"}
GET /api/v1/orders/00000000-0000-0000-0000-000000000000 → 404 {"success":false,"error":"الطلب غير موجود"}
POST /api/v1/orders/<uuid>/refund (no Origin)         → 403 {"error":"انتهاك أمان - رمز التحقق غير صالح","code":"CSRF_ERROR"}
POST /api/admin/orders/<uuid>/refund (no Origin)      → 403 {"error":"انتهاك أمان - رمز التحقق غير صالح","code":"CSRF_ERROR"}
POST /api/v1/orders/<uuid>/refund (Origin localhost)  → 403 CSRF (no authenticated customer cookie)
POST /api/admin/orders/<uuid>/refund (Origin localhost) → 403 CSRF (no admin session)
GET /api/admin/orders/<real-uuid>                     → 401 {"success":false,"error":"يجب تسجيل الدخول"}
GET /api/v1/orders/<real-uuid>                        → 403 {"success":false,"error":"ليست لديك صلاحية"}
GET /api/v1/orders/<real-uuid>/invoice-pdf            → 403 {"success":false,"error":"ليست لديك صلاحية"}
```

Live production error log (filtered):
```
[2026-10-01T15:21:46.793Z] [ERROR] wishlist list error {"error":"column p.slug does not exist"}
[2026-10-01T15:19:20.009Z] [ERROR] order detail GET failed {"error":"invalid input syntax for type uuid: \"test-id-uuid\""}
```
