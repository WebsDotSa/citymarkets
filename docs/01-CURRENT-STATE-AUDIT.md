# City Markets — Current-State Audit

Reviewed: 2026-09-28

## Repository facts
- ~948 tracked files
- ~745 source files
- 108 page files
- >150 API route files
- 134 test/spec files
- 80 SQL migrations

## Stack
Next.js 16.2.11, TypeScript, PostgreSQL, pg, Supabase fallback, Moyasar, Tamara, Redis option, Docker/worker, R2/CDN, SwiftUI iOS.

## Confirmed risks
### R1 Multiple sources of truth
Auth, payments and product data contain compatibility/history paths.

### R2 Database drift
Migration history includes reconciliation and rollback artifacts. Actual production schema must be compared before refactoring.

### R3 Checkout orchestration
checkout/route.ts is ~786 lines and create-checkout.ts is ~596 lines; both mix cross-domain responsibilities.

### R4 Weak DB typing
DB helper generics default to any.

### R5 Auth duplication
Customer JWT/cookie and Supabase fallback coexist; admin/vendor auth are separate.

### R6 Payment fragmentation
Hosted/inline/callback/webhook paths require one normalized state/event model.

### R7 Error leakage
Checkout can include a DB-derived debug value in HTTP responses unless a flag is set.

### R8 Filesystem coupling
Read-only/stateless Docker still has writable mounts and local logging/upload paths.

### R9 Non-blocking lint
CI contains `npm run lint || true`.

### R10 Route/UI duplication
Legacy aliases and multiple data/interaction implementations require consolidation.

## Target decisions
- PostgreSQL is the system of record.
- Keep pg repositories initially unless an ADR proves an ORM migration.
- Supabase auth is compatibility-only.
- /api/v2 is canonical.
- Domain services are canonical.
- R2 is canonical durable asset storage.
