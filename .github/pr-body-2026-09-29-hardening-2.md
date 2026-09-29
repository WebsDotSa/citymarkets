# Production Full-System Hardening (Pass 2)

**Branch**: `production/full-system-hardening-2` → `main`
**Date**: 2026-09-29
**Scope**: 5 P0 + 5 P1 bugs across payment, validation, driver COD flows

## TL;DR

Closed every P0/P1 bug found by the post-PR-#7 audit of the canonical payment paths:

- **5 P0** bugs that violated core invariants (paid-as-fulfillment, atomic COMMIT, idempotent ledger, etc.)
- **5 P1** bugs that caused inconsistent state across same-provider paths
- **+30 regression tests** across 6 test files
- **1795/1795 tests pass**, **0 new TypeScript errors**
- Branch is **NOT merged, NOT deployed** per directive — awaiting review

## Gap Matrix

| # | Priority | Bug | Root Cause | Files |
|---|---|---|---|---|
| P0-1 | **P0** | Broken payment_events audit write | `notify-admin.ts` wrote to pre-073 schema columns; UNIQUE index never saw the rows | `src/lib/orders/order-notify-admin.ts` |
| P0-2 | **P0** | COMMIT after finally block | Vendor fan-out ran BEFORE COMMIT in the try body — vendor got push on rolled-back txn | `src/app/api/v1/payments/webhook/route.ts` |
| P0-3 | **P0** | Currency/amount guards early-returned | Skipped `finalizePaymentEvent` + vendor notify → ledger stuck at `received`, vendor uninformed | `src/app/api/v1/payments/webhook/route.ts` |
| P0-4 | **P0** | orderEditSchema allowed vendor-only statuses | `'preparing'`, `'accepted'`, `'in_progress'` writable via public PATCH → DB-vs-enum drift | `src/lib/validation/order.ts` |
| P0-5 | **P0** | markOrderPaymentFailed also cancelled the order | Single write set both `payment_status='failed'` + `status='cancelled'` — retry blocked | `src/lib/payments/payment-service.ts`, `src/lib/orders/checkout/checkout-service.ts` |
| P1-1 | P1 | COD paid bypassed ledger | Driver PATCH mutated `orders.payment_status` directly — no audit, no idempotency | `src/app/api/admin/driver/orders/[id]/route.ts` |
| P1-2/3/4 | P1 | Two different Moyasar status maps | `refunded` → `pending` in inline-confirm but `failed` in webhook; case-sensitive SAR check | `src/lib/payments/moyasar.ts`, `moyasar-confirm.ts`, `webhook/route.ts` |
| P1-5 | P1 | Duplicate webhook replay never finalized ledger | `recordPaymentEvent` returned `'duplicate'` → handler returned without `finalizePaymentEvent` | `src/app/api/v1/payments/webhook/route.ts`, `tamara/webhook/route.ts` |

## Commits (7 hardening + 1 docs)

```
aa3fd0e docs(audit): full-system-hardening-2 audit report
80417f8 fix(driver): route COD 'paid' through payment_events ledger (P1-1)
9d4be40 fix(payments): share moyasar mapping + currency helpers (P1-2/3/4)
29b408b fix(payments-webhook): finalize ledger on duplicate short-circuit (P1-5)
66d6142 fix(payments): markOrderPaymentFailed dedup + drop lifecycle auto-cancel (P0-5)
3815148 fix(validation): align orderEditSchema with orders.status enum (P0-4)
21d99a4 fix(payments-webhook): COMMIT inside try + drop guard early-returns (P0-2 + P0-3)
e34eee7 fix(notify-admin): drop broken payment_events audit write + log via structured logger (P0-1)
```

(The branch also carries the 22 prior repair commits from `production/full-system-repair` already merged as PR #5 + PR #7.)

## Regression Coverage

| File | New tests | Purpose |
|---|---|---|
| `src/app/api/v1/payments/webhook/route.test.ts` | +3 (15 total) | P0-2 COMMIT ordering, P0-3 guards-don't-skip, P1-5 duplicate finalize |
| `src/app/api/v1/payments/tamara/webhook/route.test.ts` | +1 (16 total) | Duplicate finalize parity with Moyasar |
| `src/lib/payments/moyasar.test.ts` | +6 (31 total) | Lock helper behaviour: refunded→failed, SAR case-insensitive, null/undefined currency |
| `src/lib/validation/order.test.ts` | +11 (NEW) | P0-4: orderEditSchema rejects vendor-only statuses |
| `src/__tests__/payment-service-mark-failed.test.ts` | +5 (NEW) | P0-5: markOrderPaymentFailed writes ONLY payment_status |
| `src/app/api/admin/driver/orders/[id]/route.test.ts` | +4 (5 total) | P1-1: ledger-first COD, duplicate short-circuit, already-paid noop |

## Verification

```bash
npx tsc --noEmit                              # 9 errors, all pre-existing baseline; 0 new
npx vitest run                                # 1795/1795 tests pass (was 1769)
npx vitest run src/lib/payments/              # 130/130 payment tests pass
```

## Acceptance Gate

| Item | Status |
|---|---|
| All P0 bugs fixed | ✅ 5/5 |
| All P1 bugs fixed | ✅ 5/5 |
| Same-provider-same-outcome invariant | ✅ shared `mapMoyasarStatusToDb` + `isSarCurrency` |
| `'paid' is never a fulfillment status` | ✅ Bug A (PR #5/PR #7) + P0-4 closure |
| payment_events ledger is single source of truth | ✅ P0-1, P1-1 close the bypass paths |
| COMMIT inside try, not in finally | ✅ P0-2 (mirrors Tamara pattern) |
| Guards don't short-circuit downstream work | ✅ P0-3 `guardsOk` flag pattern |
| Duplicate replay short-circuits AND finalizes | ✅ P1-5 |
| Regression tests added | ✅ +30 tests |
| Typecheck (no new errors) | ✅ baseline 9 unchanged |
| Tests pass | ✅ 1795/1795 |
| Documentation updated | ✅ `docs/audits/2026-09-29-full-system-hardening-2.md` |

## NOT Included (per directive section 61)

- Merge to main
- Deploy
- Native push senders (APNs/FCM still return `sender_not_implemented`)
- Wishlist server persistence

## Deferred Items (P2/P3 — documented in audit)

State machine centralization, status vocabulary mapping, address service consolidation, wishlist server persistence, cart server-recalculated totals, stock decrement race condition, native push senders, dead `notifyAdminNewOrderJobId` field, duplicate SQL loaders, console.log leftovers.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
