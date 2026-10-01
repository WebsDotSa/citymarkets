# 2026-09-30 — Duplication Remediation

Branch `refactor/remove-duplication`, stacked on `refactor/full-repository-consolidation`
(PR #10 @ `8730748`). Findings and IDs: [`2026-09-30-duplication-audit.md`](./2026-09-30-duplication-audit.md).
Ownership map: [`../architecture/canonical-sources.md`](../architecture/canonical-sources.md).

Rules followed: nothing was deleted for merely *looking* duplicated; every
removed copy had its consumers re-pointed first (imports, re-exports, barrels,
`vi.mock` targets); response bodies, status codes, SQL text and DB schema are
unchanged unless listed under **Behaviour notes**. No migrations.

## Commits

| Commit | Domain | Findings closed |
|---|---|---|
| `refactor: consolidate payment method definitions` | Payments | PM-1, PM-2, PM-3, PM-4 |
| `refactor: unify order state definitions` | Orders | OS-1 … OS-6 |
| `refactor: consolidate address request/DTO logic into address-service` | Address | AD-1, AD-2 |
| `refactor: consolidate product pricing logic` | Pricing | PR-1 |
| `refactor: consolidate duplicated constants and utility functions` | Shared | CO-1 … CO-5, API-4, API-5 |
| `refactor: consolidate order query logic into order-repository` | Orders/SQL | SQL-1 … SQL-4 |
| `refactor: remove duplicate domain types` | Types | TY-1 … TY-5, CO-6 |
| `refactor: consolidate API response handling` | API client | API-1 |
| `test: add duplicate detection gate` | Tooling | scanner + gate, OS-11 |
| `refactor: expose new canonical helpers through domain barrels` | Boundaries | keeps `domain:guard` from regressing |
| `docs: document canonical sources` | Docs | DOC-1, DOC-2 |

## New canonical modules

| Module | Replaces |
|---|---|
| `lib/orders/order-repository.ts` | 6 driver lookups, 3 coupon releases, 5 system-message inserts |
| `lib/catalog/product-price.ts` | 13 `discount_price ?? price` copies (incl. the charged price) |
| `lib/api-error.ts` | 53 hand-rolled error extractions |
| `lib/delivery/riyadh-time.ts` | 3–4 copies of Riyadh TZ constants/helpers |
| `lib/uuid.ts` | 11 UUID regex literals |
| `lib/request-params.ts` | 8 `idCheck()` copies |
| `lib/orders/invoice-types.ts` | 2 invoice type pairs |
| `lib/identity/wishlist-constants.ts` | 2 `MAX_WISHLIST_SIZE` |
| `state-machine.ts` additions: `OrderPaymentStatus`, `ALL_ORDER_PAYMENT_STATUSES`, `isDirectOrderCustomerEditable` | admin/type/route inline lists |
| `address-service.ts` additions: `resolveAddressOwnerFromRequest`, `toPublicAddressRow` | 3 + 2 route-local helpers |
| `rate-limit.ts` addition: `rateLimitExceededResponse` | 5 route-local builders |
| `scripts/scan-duplicates.ts` (`npm run dup:scan`, `npm run dup:gate`) | — |

## Behaviour notes (intentional, all aligning UI to existing server truth)

1. **Direct-order customer page** (`order-detail-client.tsx`) now locks line editing exactly when
   `POST/PATCH/DELETE /api/v1/orders/[id]/items` would return 409. Previously a `confirmed`
   direct order showed edit controls that always failed.
2. **Admin direct-order status dropdowns** now list the `order_status_enum` values
   (`ORDER_STATUS_DISPLAY`: adds `confirmed`, drops `accepted`/`in_progress`). The removed options
   were always rejected by `orderEditSchema` (400).
3. **Client error messages** from routes that already return the canonical envelope
   (`/api/v1/contact` 400/500, etc.) are now read correctly instead of yielding an object.
4. `getSiteUrl()` now also honours `SITE_URL` when `NEXT_PUBLIC_SITE_URL` is unset in
   payment callbacks and agent manifests (production sets `NEXT_PUBLIC_SITE_URL`, so the value is unchanged there).

## Verification

| Gate | Before (PR #10 head) | After |
|---|---|---|
| `npx tsc --noEmit` | clean | clean |
| `npx vitest run` | 1983 passed, 1 failed, 1 skipped | **2009 passed**, 1 failed, 1 skipped |
| `npm run build` | — | success (exit 0) |
| `npm run dup:gate` | n/a | PASS (and verified to FAIL on an injected inline list) |
| `npm run domain:guard` (informational) | 161 findings | 172 findings (+11 deep imports of pure leaf modules `payment-methods`, `state-machine`, `address-service`, `wishlist-constants`, `invoice-types`; the payments barrel was deleted in PR #10 for client-bundle hygiene) |

The one failing test (`customer-session.test.ts › rejects tokens missing required claims`,
jose `"sub" claim must be a string`) fails identically on `main` and on the PR #10 head; it is
unrelated to this branch.

Not run here (need a live DB / deployed stack): `qa:smoke`, `qa:critical-paths`,
`qa:golden-path`, `worker:smoke`, iOS contract smoke. API contracts touched by this branch keep
their response shapes (covered by the route tests above); iOS endpoints
(`/checkout`, `/orders`, `/orders/:id/payment-method`, `/addresses`, `/delivery-addresses`,
`/cart`) are unchanged.

## Duplicate Detection Gate — after

| Category | Before | After |
|---|---|---|
| Exact function clones across files | 17 | 6 |
| Type names declared in >1 file | 58 | 52 |
| Identical type shapes | 26 | 20 |
| Identical SQL across files | 27 | 22 |
| SCREAMING_CASE constants in >1 file | 32 | 25 |
| Inline domain vocabularies | 33 (27 unregistered) | 21 — **0 unregistered** |

### Remaining — intentional / specialized (kept, registered in the gate)

OS-7 driver history filter · OS-8 vendor timeline · OS-9 `LOCKED_PAYMENT_STATUSES` ·
PM-7 Moyasar provider vocabulary · PM-8 gateway ids (false positive) · CO-7 per-token `ISS`/`AUD` ·
ST-1 `stock_qty` ↔ `stock_quantity` boundary alias · SV-1 checkout orchestrator/writer ·
UI-3 customer vs vendor logout.

### Remaining — legacy (kept until consumers migrate)

PM-4/PM-5 `stc_pay` deep link on `/checkout/pay` · OS-10 `completed` payment status ·
`OrderPaymentStatus` `unpaid` · AD-3 `/api/v1/addresses*` (iOS logged-in) ·
`paymentMethodSchema` legacy tokens (reading historical rows).

### Remaining — open decisions (owner needed; not changed because they alter money/state/public contracts)

| ID | Decision |
|---|---|
| **PRICING-1** | Should checkout charge the offer-aware `priceCartRow()` price the cart shows, or should the cart stop applying offers? Today they can differ when an offer is live. After this branch either choice is a one-function change (`productUnitPrice` ↔ `priceCartRow`) |
| **PAY-1 / PM-9** | Fold `confirmMoyasarPaymentForOrder` into `reconcilePayment` (vendor_orders mirror, advisory lock, loyalty at confirm time) and stop writing the legacy `moyasar` method token |
| **DUP-PM-AGENT** (PM-6) | Agent manifests (`/.well-known/acp*`, `/api/v1`) advertise `cod` and `google_pay`. Regenerate them from `ALL_PAYMENT_METHODS`? (public contract for AI agents) |
| **FS-2** | Make the server cart authoritative (as done for wishlist) and demote `cart-context` localStorage to guest cache |

### Remaining — low-value duplicates (candidates for follow-up PRs)

SQL-5/SQL-6 (vendor-by-slug, slot config, loyalty balance, offer targets, status-log select) ·
API-3 raw `fetch` → `apiFetch` migration · TY-6 page-local view models (wait for the typed
API contracts on `refactor/api-contract-consistency` so there is no third definition) ·
UI-1 `SearchableSelect` ×2 (needs visual QA) · UI-2 presentational clones · CO-9 label/emoji maps,
`PRIZES` (spin wheel ↔ award values) · PR-2 catalog grid `||` price display.
