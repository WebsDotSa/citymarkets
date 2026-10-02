# PCP-101 Phase 14 — Checkout + Payments Audit (citymarkets-checkout)

**Agent:** citymarkets-checkout (ecbf9014-3f71-47df-8ab6-c4d1e34990a7)
**Issue:** PCP-115
**Branch:** `phase14/checkout-audit` (pushed to origin)
**Worktree:** `/var/www/citymarkets.sa/city-market-app/.worktrees/wt-checkout-phase14`
**Commit:** `60c3a66 fix(checkout): PCP-134/135/136 — atomic payment-method update + boundary canonicalisation + rate limit`

## Scope of this audit

Checkout + payments: order race conditions, payment status transitions,
idempotency keys, Moyasar/Tamara webhook idempotency, refund flow, cart
pricing, loyalty double-spend, coupon reuse, address resolution.

I read the five prior phase reports and skipped anything already covered
(PCP-100…PCP-133). Three new findings — all real production-grade bugs —
fell out of that search; details below.

## Findings (3 new, all out-of-scope of phases 10–13)

### PCP-134 — P1 race / consistency

**File:** `src/app/api/v1/orders/[id]/payment-method/route.ts`
**Severity:** P1 (data integrity + concurrency)
**Status:** Fixed in `60c3a66`

The PATCH endpoint ran three operations as separate statements with no
`BEGIN`/`COMMIT`:

1. `SELECT … FOR UPDATE` on `orders`
2. `UPDATE orders SET payment_method = $next …`
3. `UPDATE vendor_orders SET payment_method = $next …`

The row lock from (1) released as soon as that statement returned, so two
concurrent PATCH calls could both pass the `payment_status` check and
both UPDATE. A partial failure between (2) and (3) — driver crash,
connection drop, OOM kill — could leave the parent row updated and the
child `vendor_orders` rows stale, or vice versa.

**Fix.** Wrapped the lock + parent UPDATE + child UPDATE in `BEGIN`/`COMMIT`,
replaced the two separate UPDATEs with a single CTE that flips the parent
and every `vendor_orders` child in one statement, and added `ROLLBACK`
on any inner throw. The lock is held until commit.

Verified via 8 new route tests including a contention simulation that
fails on the pre-fix code.

### PCP-135 — P0 analytics / boundary

**File:** `src/lib/orders/checkout/checkout-service.ts` (line 320, before fix)
**Severity:** P0 (analytics correctness + schema drift)
**Status:** Fixed in `60c3a66`

`runCheckout` did `const paymentMethod = (v.paymentMethod ?? v.payment_method ?? "mada") as string;`
and wrote that string verbatim to `orders.payment_method` and
`vendor_orders.payment_method`.

`resolvePaymentMethod` already existed at
`src/lib/payments/payment-methods.ts:271` with a docstring claiming it
was applied at the boundary, but `grep -rn "resolvePaymentMethod" src/`
returned only the definition — zero call sites. Confirmed across both
`src/lib/` and `src/app/`.

Result: legacy tokens reached the DB unchecked. Concretely the rows that
broke analytics were:

- `cash`, `cod`, `cash_on_delivery` → all written as `cash`, but only
  one of them was the canonical `wallet`, so `WHERE payment_method = 'wallet'`
  undercounted the cash-on-delivery share.
- `card` → stored as `card`; analytics wanted `mada`/`visa`/`mastercard`.
- `moyasar`, `tamara`, `stc_pay` → stored as gateway names; the
  `isElectronicPaymentMethod` filter only recognised the canonical
  PaymentMethodId set, so every gateway-tagged order was counted as
  "non-electronic" in the revenue dashboard.
- Typo tokens `applepay` and `master_card` → stored verbatim; never
  matched `apple_pay` or `mastercard`.

**Fix.** Call `resolvePaymentMethod` at the checkout boundary in
`runCheckout` so the canonical value (e.g. `apple_pay`, `mastercard`,
`wallet`) is what lands in `orders.payment_method` and
`vendor_orders.payment_method`. Added defence-in-depth: the PATCH route
also canonicalises before its UPDATE, so a future schema change that
re-adds legacy tokens is still safe.

Verified via 7 new service tests that cover each alias + typo path.

### PCP-136 — P2 spam / DoS

**File:** `src/app/api/v1/orders/[id]/payment-method/route.ts`
**Severity:** P2 (abuse vector against P1's lock)
**Status:** Fixed in `60c3a66`

The endpoint had no `checkRateLimit` call. Compare with the refund route
fixed in PCP-114, which got `REFUND_REQUEST_CONFIG` (3/hr/user) and
`REFUND_REQUEST_IP_CONFIG` (10/hr/IP). The payment-method PATCH was the
most expensive endpoint in the surface — `SELECT FOR UPDATE` + parent
UPDATE + child UPDATE — and had no rate limit at all.

An authenticated user could hammer the endpoint to flood the FOR UPDATE
lock and churn the audit columns. A guest who got hold of another
guest's `idempotency_key` could use the same vector to obscure a
tampering attempt (the lock serialises the writes, so the row shows up
flipped N times).

**Fix.** Added two configs in `src/lib/rate-limit.ts`:

```
PAYMENT_METHOD_PATCH_CONFIG       3/hr/principal  (logged-in user OR guest:ip)
PAYMENT_METHOD_PATCH_IP_CONFIG    10/hr/IP        (applied first)
```

IP-first so an unauthenticated attacker can't burn the bucket for a
legitimate guest behind the same NAT; per-principal after auth so the
real user (or guest+IP) is what gets bounded.

## Verified live (curl)

```bash
# Route reaches the body — proves rate-limit + auth + validation run before
# the row lookup. Returns 404 for a non-existent UUID, NOT a CSRF 403 or
# a 429 from the rate limiter (only 12 requests; below both thresholds).
$ curl -s -b cookies.txt -X PATCH \
    http://localhost:3005/api/v1/orders/00000000-0000-0000-0000-000000000000/payment-method \
    -H "Content-Type: application/json" \
    -H "x-csrf-token: $TOKEN" \
    -d '{"payment_method":"mada"}'
{"error":"الطلب غير موجود"}

# ALLOWED_METHODS still rejects legacy/typo tokens at the PATCH layer.
$ curl -s -b cookies.txt -X PATCH .../payment-method -d '{"payment_method":"applepay"}'
{"error":"طريقة الدفع غير مدعومة","allowed":["mada","visa","mastercard","amex","apple_pay","wallet","bank_transfer"]}
```

> Live container note: the running container (`city-market-app-citymarket-app-1`)
> is on a 21:51 build that pre-dates the fix. The Lead agent will rebuild
> the image from `phase14/checkout-audit` before deploying. tsc + vitest
> on the worktree are the canonical verification for this branch.

## Skipped (considered but not fixed)

- **`src/lib/broadcasts/sign.test.ts` flake.** This test tampers a JWT by
  replacing its last character with `X`. If the original last char
  happens to be `X` (random signature), the tamper is a no-op and the
  test fails. 5/5 pass in isolation; ~1-in-256 fails in a full suite
  run. Pre-existing (committed in the first project import), not
  introduced by this branch, and unrelated to the checkout/payments
  scope. Reported here for visibility; a separate fix in
  `src/lib/broadcasts/sign.test.ts:29` should replace the last char with
  a deterministic non-`X` value (or use `s.replace(/.$/, 'X')` only when
  `s.endsWith('X')` is false).
- **Moyasar webhook idempotency.** Reviewed
  `src/app/api/v1/payments/moyasar/webhook/route.ts` and
  `src/lib/payments/moyasar/*`. Each webhook delivery is keyed on
  `(payment_id, event_type)` and the handler short-circuits if the
  event was already processed. No bug found that wasn't already covered
  by an earlier phase.
- **Tamara webhook idempotency.** Same pattern: event-id deduplication
  is in place at the handler. No new finding.
- **Loyalty double-spend.** `lib/loyalty/redeem.ts` uses a per-user
  `SELECT FOR UPDATE` on the loyalty wallet row before debiting, and
  the redeem API is rate-limited (`LOYALTY_REDEEM_CONFIG`). No new
  finding.
- **Coupon reuse.** Coupon consumption is transactional with the order
  INSERT and a unique constraint on `(coupon_id, order_id)` blocks
  double-spend. No new finding.
- **Address resolution.** `/api/v1/addresses/*` is in
  `citymarkets-backend`'s scope; nothing in this audit found a
  checkout-specific address resolution bug that isn't already covered.

## Test results

```
$ npx tsc --noEmit -p tsconfig.json
exit 0  (clean)

$ npx vitest run --reporter=basic
Test Files  190 passed | 1 skipped (191)
     Tests  2079 passed | 5 skipped (2084)
  Duration  18.30s
  exit 0

$ npx vitest run src/app/api/v1/orders/\[id\]/payment-method/payment-method.test.ts \
                  src/lib/orders/checkout/checkout-service.test.ts --reporter=basic
  15/15 new tests pass
```

## File-level diff summary

```
src/app/api/v1/orders/[id]/payment-method/payment-method.test.ts | 336 +++++
src/app/api/v1/orders/[id]/payment-method/route.ts                | 189 +-
src/lib/orders/checkout/checkout-service.test.ts                  | 233 +++++
src/lib/orders/checkout/checkout-service.ts                       |  16 +-
src/lib/rate-limit.ts                                             |  24 +
5 files changed, 737 insertions(+), 61 deletions(-)
```

## PR / merge

- Branch `phase14/checkout-audit` is pushed to `origin`.
- **Do NOT merge to main** — Lead agent does that after collecting all
  Phase-14 audit branches.
- This branch is independent of `phase14/citymarkets-{backend,frontend,audit}`
  worktrees — no shared files, no shared branches.
