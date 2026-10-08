# Phase 13 Audit Report — P3 cleanup

Generated: 2026-10-02 21:55 UTC

## Scope

Following the user's prompt: "نفذ p3" (execute P3). This phase
resolves the 4 P3-tracked items: PCP-116, PCP-120, PCP-122, PCP-126.

## ✅ اللي حليته

| # | Title | Action | Severity |
|---|-------|--------|----------|
| **PCP-120** | `initiatePayment()` had bare `UPDATE orders` without `SELECT FOR UPDATE` → race on concurrent initiates | **FIXED**: row lock + idempotent short-circuit when `payment_status != 'unpaid'` | P3 |
| **PCP-126** | `/api/v1/auth/me` in `CSRF_EXEMPT_PATHS` (redundant — GET only) | **FIXED**: removed from exempt list; live test: POST → 403 | P3 |
| **PCP-122** | `/api/v1/search` dead endpoint | **VERIFIED**: zero refs in `src/`, no route file. No code change needed. | P3 (intentional) |
| **PCP-116** | `payment_events` table empty | **VERIFIED** not a bug: `reconcilePayment` → `recordPaymentEvent` chain is wired. The 1 paid order in DB was admin-marked-paid without a webhook hit. Schema + write path correct; no live webhooks have ever hit. | P3 (intentional) |

## PCP-120 detail

**Bug**: `initiatePayment()` in `src/lib/orders/checkout/checkout-service.ts`
was doing bare `UPDATE orders SET payment_reference, payment_status`
without a prior `SELECT FOR UPDATE` on the parent row. Two concurrent
`/initiate` calls on the same `parentOrderId` could race on these
writes — the second call would overwrite the first's
`payment_reference` with its own Moyasar invoice ID, leaving the
order pointing at a stale gateway session.

**Fix**:
1. `SELECT payment_status, payment_reference FROM orders WHERE id = $1 FOR UPDATE`
2. If the row is gone → return `failure` (order doesn't exist)
3. If `payment_status != 'unpaid'` → return `ok` with no redirect
   (another initiate or a webhook already moved the order)
4. Otherwise proceed with the existing gateway call

The second concurrent caller now blocks on the row lock, then sees
the row already moved out of `'unpaid'` state and short-circuits
without calling the gateway again. Single-bucket payment gateway
calls, no orphaned references.

## PCP-126 detail

**Bug**: `/api/v1/auth/me` was in `CSRF_EXEMPT_PATHS` with the
comment `// GET only`. The exempt list is checked against
POST/PUT/PATCH/DELETE only — `requiresCsrfProtection` predicate
short-circuits on safe methods, so the entry was redundant.

**Fix**: removed `/api/v1/auth/me` from the exempt list. The CSRF
exempt list now contains only paths that genuinely need to bypass
CSRF (OTP sends, payment webhooks, guest lookups).

**Live verification**:
```
POST /api/v1/auth/me → 403 (CSRF check now active)
```

## PCP-122 detail

**Status**: dead, no code to remove. `grep -rn "api/v1/search" src/`
returns zero matches. There is no `src/app/api/v1/search/route.ts`
file. Stays documented as "intentionally not implemented".

## PCP-116 detail

**Status**: not a bug. Verified by:
- `recordPaymentEvent` is implemented in `src/lib/payments/event-ledger.ts`
- It is called from `src/lib/payments/reconcile-payment.ts:271`
- `reconcilePayment` is called from `src/app/api/v1/payments/webhook/route.ts:147,201`
- The schema is correct (`UNIQUE INDEX uq_payment_events_invoice_event`)

**Live data**:
- `payment_events` row count: 0
- `orders` with `payment_status = 'paid'`: 1

The single paid order was admin-marked-paid (manual), no webhook
hit. As soon as a live Moyasar/Tamara webhook fires, the row will
be created.

## 📊 Live verification
- ✅ Container healthy on image `bd2289a4b162`
- ✅ `/api/v1/auth/me` POST → 403 (PCP-126 active)
- ✅ `/api/v1/categories/bad-uuid` → 400 (PCP-121 still works)
- ✅ `/api/v1/employment` → 5 OK + 6th 429 (PCP-133 still works)
- ✅ Tests: 2064/2069 pass + 5 skipped (no failures)
- ✅ tsc: 0 errors

## 📦 Deployed
- Commit `ce32a86`
- Image `bd2289a4b162`
- main @ `ce32a86`

## 📋 Open (خارج نطاق)
- Twilio Geo Permissions للـ SA (Twilio Console)
- aqar.labs.sa SSL 525 (Cloudflare-side)
- MiniMax API key rotation (security)

## 🎯 All P3 items resolved

After this phase, the P3 backlog is empty:
- PCP-116 — verified not a bug ✅
- PCP-120 — fixed (FOR UPDATE lock) ✅
- PCP-122 — verified dead, intentional ✅
- PCP-126 — fixed (CSRF exempt list cleanup) ✅

## Lessons learned

1. **Idempotent payment initiates** require a `SELECT FOR UPDATE`
   on the parent order row, not just an idempotency_key. Two
   requests with the same idempotency_key still race on the
   gateway-call step.
2. **CSRF_EXEMPT_PATHS is for the POST-only short-circuit** — adding
   GET endpoints "just in case" creates the impression of a hole.
   Keep the list focused on paths that genuinely need to bypass.
3. **Empty tables aren't always bugs** — `payment_events` being
   empty is a strong signal that no live webhooks have hit, which
   is the right state for a pre-launch system. Always check the
   WRITE PATH before declaring a bug.
