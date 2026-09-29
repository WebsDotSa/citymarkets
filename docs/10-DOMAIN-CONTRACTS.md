# Domain Contracts (v2) — Phase 10.7

This document codifies the **public API** of each bounded context extracted in
[Phase 10](./15-PERFORMANCE-CACHING-REVIEW.md). The contract is enforced by
`scripts/check-domain-contracts.ts` (run via `npm run domain:guard`).

## The Rule

**Cross-domain imports must go through the public barrel.** Deep imports
across domain boundaries are forbidden.

```ts
// ✅ ALLOWED — barrel import (single public entrypoint)
import { createCheckout } from "@/lib/orders";

// ❌ FORBIDDEN — cross-domain deep import (reaches into implementation)
import { createCheckout } from "@/lib/orders/checkout/checkout-service";

// ✅ ALLOWED — same-domain deep import (file is inside orders/)
//   (lives at src/lib/orders/checkout/pricing.ts)
import { computeCheckoutTotals } from "@/lib/orders/checkout/pricing";
```

## The Five Bounded Contexts

| Domain     | Barrel                  | Public surface (high-level)                                            |
| ---------- | ----------------------- | ----------------------------------------------------------------------- |
| identity   | `@/lib/identity`        | Customer / admin / vendor session, JWT sign+verify, role gates          |
| catalog    | `@/lib/catalog`         | Products, categories, search, offers, vendors, home layout, AI shopping |
| payments   | `@/lib/payments`        | Moyasar, Tamara, event ledger, payment service, payment methods         |
| orders     | `@/lib/orders`          | Checkout orchestrator, order status, ownership, loyalty, abandoned carts |
| delivery   | `@/lib/delivery`        | Distance fee, hours, slots, geo, vendor closed gate, address model      |

Each barrel lives at `src/lib/<domain>/index.ts` and re-exports the verified
public surface of the domain (see git history for `Phase 10.x` commits).

## Shared Subfolders (free to deep-import)

These are utility buckets, not bounded contexts. They have no business rules,
only helpers. New shared subfolders go here, not into the contract surface.

| Folder          | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `@/lib/db`      | PostgreSQL pool + typed wrappers (`queryOne`, `queryMany`)        |
| `@/lib/seo`     | Site-wide SEO helpers (`seo/site.ts`)                            |
| `@/lib/validation` | Zod schemas, sub-modular by entity (admin, auth, order, etc.)  |
| `@/lib/supabase`  | Browser + server Supabase clients                              |
| `@/lib/errors`    | Sentry reporters (checkout errors)                             |
| `@/lib/broadcasts` | Deferred 6th domain (Phase 10 mapping report)                |

## The Legacy Allowlist

18 pre-Phase-10 consumer files still deep-import from `@/lib/payments/X`,
`@/lib/orders/checkout/*`, or `@/lib/identity/auth/*`. They are exempt from
the guard so Phase 10 could land atomically without a sweeping rename.

| Count | Domain                          | Example                                                          |
| ----- | ------------------------------- | ---------------------------------------------------------------- |
| 13    | `@/lib/payments/payment-service` | `src/app/api/v1/payments/retry/route.ts`                       |
| 2     | `@/lib/orders/checkout/*`        | `src/app/api/v1/checkout/route.ts`                              |
| 3     | `@/lib/identity/auth/*`          | `src/middleware.ts`, `src/__tests__/jwt-helper.test.ts`        |

**Retirement plan:** each entry in
`scripts/check-domain-contracts.ts → LEGACY_DEEP_IMPORTS` should be migrated
to the barrel in a follow-up commit, then removed from the list. The CI gate
will catch any *new* deep import even before the legacy ones are migrated.

## CI Integration

The guard runs as part of pre-merge verification:

```bash
npm run domain:guard        # standalone
npm run proxy:guard && npm run domain:guard   # chained with middleware guard
```

A failing guard returns exit code 1 with a per-file diff-style report. The
message tells you exactly which file and which import to fix:

```
=== Domain Contract Guard ===
Status:            FAIL (1 new violation)

  src/app/api/v1/orders/route.ts:13  @/lib/orders/checkout/checkout-service
    → cross-domain deep import — use `@/lib/orders` (barrel) instead
```

## Adding a New Domain

When a new bounded context emerges (e.g., `analytics`, `notifications`):

1. Create `src/lib/<domain>/<files>.ts` with `git mv` (preserves history).
2. Write `src/lib/<domain>/index.ts` — verify exports with
   `grep -E "^export"` on each file before listing them in the barrel.
3. Add `<domain>` to the `DOMAINS` array in
   `scripts/check-domain-contracts.ts`.
4. Migrate consumers one-by-one to `@/lib/<domain>`.
5. Remove any deep-import shim files (they are migration debt).
6. Update this document with the new domain's public surface.

## Why This Matters

* **Refactor safety** — moving an internal file inside a domain cannot break
  consumers, because consumers only see the barrel.
* **Ownership** — the barrel is the API surface; whoever owns the domain
  owns the barrel.
* **v2 contracts (P1.7)** — these barrels become the v2 API when the
  internal v1 endpoints retire; cross-domain deep imports are the migration
  blast radius that must stay zero.
* **Onboarding** — a new contributor reads `src/lib/<domain>/index.ts` to
  learn what the domain offers, instead of grepping the entire `src/lib/`.
