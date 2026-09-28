# City Markets — Full-Stack Master Plan

Status: authoritative implementation plan
Reviewed: 2026-09-28

## Target
Consolidate the current Next.js/PostgreSQL/iOS marketplace into a coherent production-grade modular monolith without breaking production data or the iOS contract.

## Current baseline
- Next.js 16.2.11 + TypeScript
- PostgreSQL via node-postgres (pg) and SQL migrations
- Supabase client/auth fallback still present
- Drizzle dependency remains but is not the canonical DB layer
- ~948 tracked files, ~745 under src
- 108 page files, >150 API route files, 134 test/spec files
- 80 SQL migration files
- Customer, admin, vendor and driver surfaces
- Moyasar + Tamara
- Web Push/APNs/FCM/SMS/email
- Redis optional + background worker
- Native iOS SwiftUI client

## Non-negotiable architecture goals
1. One source of truth per domain.
2. No duplicated business logic between UI/API/admin/vendor/iOS.
3. PostgreSQL schema is canonical.
4. API contracts are typed and versioned.
5. Payment state is server/webhook authoritative.
6. Inventory is transactional and concurrency-safe.
7. Authentication and authorization are centralized.
8. Critical background work is queued.
9. Durable files live in object storage.
10. CI blocks type/lint/test/build/contract/E2E regressions.
11. Production errors expose request IDs, not internal DB/provider errors.
12. Existing iOS behavior remains compatible until migration is verified.

## Target architecture
Use a modular monolith first.

```
src/
  app/
    (storefront)/
    admin/
    vendor/
    auth/
    api/
  modules/
    auth/ customers/ catalog/ categories/ vendors/
    cart/ pricing/ checkout/ orders/ payments/
    inventory/ delivery/ promotions/ loyalty/
    notifications/ analytics/ applications/
  infrastructure/
    database/ redis/ queue/ storage/
    payments/ sms/ email/ push/ observability/
  contracts/
  shared/
```

### Dependency rules
- app routes call module application services.
- UI never performs raw SQL.
- SQL lives in repositories/infrastructure.
- provider-specific payment logic lives only in payment adapters.
- authorization is always server-side.

## Phase 0 — Freeze and baseline
- Freeze non-critical feature work.
- Backup production DB and verify restore.
- Inventory web/iOS API consumers.
- Capture actual production schema.
- Create a staging clone.
- Establish baseline error/order/payment/inventory metrics.

## Phase 1 — Audit
Inventory:
- pages/routes
- API endpoints
- components
- hooks/contexts
- DB access
- auth entry points
- payment entry points
- notification entry points
- scripts/dependencies
- legacy aliases
- duplicate implementations
- migrations
- tests

Create a canonicality matrix for every duplicated feature.

## Phase 2 — Foundation
Introduce:
- modules/ structure
- infrastructure/ structure
- contracts/
- shared error envelope
- request/correlation ID
- actor/auth abstraction
- typed transaction primitives
- repositories
- centralized authorization

## Phase 3 — Database stabilization
- Compare real production schema with tracked migrations.
- Identify drift/manual SQL/untracked columns.
- Produce canonical ERD.
- Classify every table/column: keep, migrate, deprecate, remove.
- Canonicalize product/listing model.
- Canonicalize order model.
- Add payment event tables.
- Add constraints/indexes after data cleanup.
- Use forward migrations only.
- Never squash production history blindly.

## Phase 4 — Core commerce
Domains:
- catalog
- categories
- inventory
- cart
- pricing
- checkout
- orders

Server is authoritative for product, price, stock, ownership and totals.

## Phase 5 — Payments
Introduce:
- Payment
- PaymentAttempt
- PaymentEvent
- PaymentWebhookEvent

Provider interface:
- create
- retrieve
- refund
- verifyWebhook
- normalizeStatus

Adapters:
- Moyasar
- Tamara

Rules:
- success page is display only
- webhook is authoritative
- verify order, amount, currency
- webhook event IDs are idempotent
- payment creation is idempotent
- refund is explicit
- actual order lines are used where supported

## Phase 6 — Operations
- order state machines
- vendor fulfillment state machine
- delivery serviceability/scheduling
- driver assignment
- notification service
- queue/worker
- admin audit log

## Phase 7 — Frontend
Server-first data flow:
DB -> domain service -> server page -> client interaction.

Eliminate:
- duplicate route aliases
- duplicate forms
- duplicate product/cart fetching
- avoidable loading shells
- raw DB calls from UI
- domain logic copied into admin/vendor components

Build shared UI primitives.

## Phase 8 — iOS
- versioned v2 contracts
- contract tests
- incremental migration
- verify Auth/Catalog/Cart/Checkout/Orders/Payments
- retain v1 until telemetry proves no consumers

## Phase 9 — Hardening
Test:
- double checkout
- duplicate payment
- duplicate webhook
- stock races
- coupon races
- loyalty races
- auth bypass
- vendor isolation
- admin permissions
- backup restore

## Phase 10 — Cutover
- canary
- observe
- reconcile orders/payments/inventory
- retire compatibility layers
- remove legacy APIs/dependencies after proof

## Definition of Done
Production-ready means:
- no open P0/P1 defects
- typecheck passes
- lint passes
- unit/integration/contract/E2E gates pass
- target schema reproduces from migrations
- payment webhooks are idempotent
- stock cannot oversell in tested concurrency
- vendor authorization isolation passes
- iOS contract smoke passes
- backup restore is verified
- observability is actionable
- no SQL/stack/provider secrets leak to clients

## Existing high-priority findings
- pg + Supabase data/auth coexist; Drizzle remains a non-canonical dependency.
- DB helpers default generics to any.
- checkout/route.ts is ~786 lines and checkout/create-checkout.ts ~596 lines.
- payment logic is spread across hosted/inline/callback/webhook paths.
- production checkout errors can expose DB-derived debug details.
- filesystem logging/upload paths conflict with stateless/read-only container goals.
- migration history contains legacy/reconciliation/rollback artifacts.
- R2 exists alongside local storage paths.
- auth route aliases exist.
- CI allows lint failure with `|| true`.
- README contains historical state claims that must be replaced by current-state docs.

## First backlog
1. repository inventory automation
2. schema/ERD and drift report
3. canonicality matrix
4. domain module skeleton
5. centralized actor/authorization
6. v2 contracts
7. payment event model
8. CheckoutService extraction
9. catalog/product reconciliation
10. safe error envelope
11. blocking CI gates
12. critical E2E
13. frontend consolidation
14. iOS v2 migration
15. legacy retirement
