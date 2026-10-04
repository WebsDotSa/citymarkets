# CONSOLIDATED REPORT — citymarkets.sa full audit (Temporal)

Generated: 2026-10-04T15:35:03.758Z
Source: 5 Temporal workflows on citymarkets-audit-task-queue

## Executive summary

| Workflow | pages_scanned | issues_found |
|---|---|---|
| customerJourneyAudit | 142 | 14 |
| adminPanelAudit | 42 | 0 |
| vendorDashboardAudit | 29 | 15 |
| iosWebParityAudit | 157 | 20 |
| crossCuttingAudit | 0 | 98 |

Total: **147 issues** across 5 workflows

## Severity counts

- CRITICAL: 3
- HIGH:     12
- MEDIUM:   71
- LOW:      61

## Category counts

- logging: 47
- type: 30
- endpoint: 20
- perf: 20
- validation: 12
- 404: 7
- form: 7
- authz: 3
- design: 1

## CRITICAL issues

- **src/app/api/v1/vendor/auth/login/route.ts** — Vendor route handler missing vendor auth guard
- **src/app/api/v1/vendor/auth/otp/send/route.ts** — Vendor route handler missing vendor auth guard
- **src/app/api/v1/vendor/auth/otp/verify/route.ts** — Vendor route handler missing vendor auth guard

## HIGH issues

- **src/app/api/v1/vendor/auth/logout/route.ts** — Mutation route handler without Zod parse
  _fix:_ Add schema.parse() / safeParse() before mutation
- **src/app/api/v1/vendor/auth/otp/send/route.ts** — Mutation route handler without Zod parse
  _fix:_ Add schema.parse() / safeParse() before mutation
- **src/app/api/v1/vendor/auth/otp/verify/route.ts** — Mutation route handler without Zod parse
  _fix:_ Add schema.parse() / safeParse() before mutation
- **src/app/api/v1/vendor/categories/[id]/route.ts** — Mutation route handler without Zod parse
  _fix:_ Add schema.parse() / safeParse() before mutation
- **src/app/api/v1/vendor/categories/route.ts** — Mutation route handler without Zod parse
  _fix:_ Add schema.parse() / safeParse() before mutation
- **src/app/api/v1/vendor/coupons/[id]/route.ts** — Mutation route handler without Zod parse
  _fix:_ Add schema.parse() / safeParse() before mutation
- **src/app/api/v1/vendor/coupons/route.ts** — Mutation route handler without Zod parse
  _fix:_ Add schema.parse() / safeParse() before mutation
- **src/app/api/v1/vendor/orders/[id]/route.ts** — Mutation route handler without Zod parse
  _fix:_ Add schema.parse() / safeParse() before mutation
- **src/app/api/v1/vendor/products/[id]/route.ts** — Mutation route handler without Zod parse
  _fix:_ Add schema.parse() / safeParse() before mutation
- **src/app/api/v1/vendor/settings/route.ts** — Mutation route handler without Zod parse
  _fix:_ Add schema.parse() / safeParse() before mutation
- **src/app/api/v1/vendor/staff/[id]/route.ts** — Mutation route handler without Zod parse
  _fix:_ Add schema.parse() / safeParse() before mutation
- **src/app/api/v1/vendor/staff/route.ts** — Mutation route handler without Zod parse
  _fix:_ Add schema.parse() / safeParse() before mutation

## MEDIUM issues (top 30)

- **** — Web endpoint  has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/addresses** — Web endpoint /addresses has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/addresses/[id]** — Web endpoint /addresses/[id] has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/addresses/[id]/default** — Web endpoint /addresses/[id]/default has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/ai-chat** — Web endpoint /ai-chat has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/ai-chat/history** — Web endpoint /ai-chat/history has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/analytics/event** — Web endpoint /analytics/event has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/analytics/pageview** — Web endpoint /analytics/pageview has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/api/admin/orders** — Web endpoint /api/admin/orders has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/api/admin/orders/[id]** — Web endpoint /api/admin/orders/[id] has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/api/admin/orders/[id]/items** — Web endpoint /api/admin/orders/[id]/items has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/api/admin/orders/[id]/messages** — Web endpoint /api/admin/orders/[id]/messages has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/api/admin/orders/[id]/refund** — Web endpoint /api/admin/orders/[id]/refund has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/api/admin/orders/direct** — Web endpoint /api/admin/orders/direct has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/auth/config** — Web endpoint /auth/config has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/auth/csrf** — Web endpoint /auth/csrf has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/auth/login** — Web endpoint /auth/login has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/auth/logout** — Web endpoint /auth/logout has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/auth/me** — Web endpoint /auth/me has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **/auth/twilio/send** — Web endpoint /auth/twilio/send has no iOS counterpart
  _fix:_ Either add iOS call site or remove web route
- **src/components/pages/categories/categories-helpers.ts:77** — Tailwind emerald-* class — should be primary-* token
  _fix:_ Replace with primary-{NNN} from tailwind.config.ts brand ramp
- **src/components/admin/admin-loyalty.tsx** — Large client component not lazy-loaded
  _fix:_ Use next/dynamic for heavy client-only components
- **src/components/admin/admin-dashboard.tsx** — Large client component not lazy-loaded
  _fix:_ Use next/dynamic for heavy client-only components
- **src/components/admin/admin-vendor-applications.tsx** — Large client component not lazy-loaded
  _fix:_ Use next/dynamic for heavy client-only components
- **src/components/admin/admin-vendors-analytics.tsx** — Large client component not lazy-loaded
  _fix:_ Use next/dynamic for heavy client-only components
- **src/components/admin/home-design/section-editor.tsx** — Large client component not lazy-loaded
  _fix:_ Use next/dynamic for heavy client-only components
- **src/components/admin/data-table.tsx** — Large client component not lazy-loaded
  _fix:_ Use next/dynamic for heavy client-only components
- **src/components/admin/admin-sidebar.tsx** — Large client component not lazy-loaded
  _fix:_ Use next/dynamic for heavy client-only components
- **src/components/admin/driver-layout.tsx** — Large client component not lazy-loaded
  _fix:_ Use next/dynamic for heavy client-only components
- **src/components/admin/admin-analytics.tsx** — Large client component not lazy-loaded
  _fix:_ Use next/dynamic for heavy client-only components

## LOW issues (top 30)

- **src/app/blog/[slug]/page.tsx** — Page uses notFound() — verify catch-all route exists
- **src/app/catalog/page.tsx** — Empty-state check without loading indicator
  _fix:_ Add Skeleton/Spinner fallback during data fetch
- **src/app/categories/[slug]/page.tsx** — Page uses notFound() — verify catch-all route exists
- **src/app/offers/[id]/page.tsx** — Empty-state check without loading indicator
  _fix:_ Add Skeleton/Spinner fallback during data fetch
- **src/app/offers/[id]/page.tsx** — Page uses notFound() — verify catch-all route exists
- **src/app/page.tsx** — Empty-state check without loading indicator
  _fix:_ Add Skeleton/Spinner fallback during data fetch
- **src/app/products/[id]/page.tsx** — Page uses notFound() — verify catch-all route exists
- **src/app/vendors/page.tsx** — Empty-state check without loading indicator
  _fix:_ Add Skeleton/Spinner fallback during data fetch
- **src/app/wishlist/page.tsx** — Empty-state check without loading indicator
  _fix:_ Add Skeleton/Spinner fallback during data fetch
- **src/app/categories/[slug]/page.tsx** — Page uses notFound() — verify catch-all route exists
- **src/app/products/[id]/page.tsx** — Page uses notFound() — verify catch-all route exists
- **src/app/vendors/page.tsx** — Empty-state check without loading indicator
  _fix:_ Add Skeleton/Spinner fallback during data fetch
- **src/app/wishlist/page.tsx** — Empty-state check without loading indicator
  _fix:_ Add Skeleton/Spinner fallback during data fetch
- **src/app/blog/[slug]/page.tsx** — Page uses notFound() — verify catch-all route exists
- **src/lib/security/pii-crypto.ts:87** — console.* outside structured logger bypasses LOG_LEVEL gate
  _fix:_ Replace with logger.ts/info/warn/error
- **src/lib/security/pii-crypto.ts:238** — console.* outside structured logger bypasses LOG_LEVEL gate
  _fix:_ Replace with logger.ts/info/warn/error
- **src/lib/security/pii-crypto.ts:245** — console.* outside structured logger bypasses LOG_LEVEL gate
  _fix:_ Replace with logger.ts/info/warn/error
- **src/lib/safe-fetch.ts:5** — console.* outside structured logger bypasses LOG_LEVEL gate
  _fix:_ Replace with logger.ts/info/warn/error
- **src/lib/payments/event-ledger.ts:71** — console.* outside structured logger bypasses LOG_LEVEL gate
  _fix:_ Replace with logger.ts/info/warn/error
- **src/lib/queue/redis.ts:39** — console.* outside structured logger bypasses LOG_LEVEL gate
  _fix:_ Replace with logger.ts/info/warn/error
- **src/lib/analytics.ts:282** — console.* outside structured logger bypasses LOG_LEVEL gate
  _fix:_ Replace with logger.ts/info/warn/error
- **src/lib/analytics.ts:289** — console.* outside structured logger bypasses LOG_LEVEL gate
  _fix:_ Replace with logger.ts/info/warn/error
- **src/lib/logger.ts:46** — console.* outside structured logger bypasses LOG_LEVEL gate
  _fix:_ Replace with logger.ts/info/warn/error
- **src/lib/logger.ts:55** — console.* outside structured logger bypasses LOG_LEVEL gate
  _fix:_ Replace with logger.ts/info/warn/error
- **src/lib/logger.ts:67** — console.* outside structured logger bypasses LOG_LEVEL gate
  _fix:_ Replace with logger.ts/info/warn/error
- **src/lib/logger.ts:88** — console.* outside structured logger bypasses LOG_LEVEL gate
  _fix:_ Replace with logger.ts/info/warn/error
- **src/lib/errors/checkout-error-reporter.ts:32** — console.* outside structured logger bypasses LOG_LEVEL gate
  _fix:_ Replace with logger.ts/info/warn/error
- **src/lib/performance/web-vitals.ts:73** — console.* outside structured logger bypasses LOG_LEVEL gate
  _fix:_ Replace with logger.ts/info/warn/error
- **src/lib/performance/web-vitals.ts:109** — console.* outside structured logger bypasses LOG_LEVEL gate
  _fix:_ Replace with logger.ts/info/warn/error
- **src/lib/performance/web-vitals.ts:128** — console.* outside structured logger bypasses LOG_LEVEL gate
  _fix:_ Replace with logger.ts/info/warn/error

## Dead code candidates (top 30)

- src/lib/analytics/page-views-retention
- src/lib/api/with-api-guards
- src/lib/images/blur-placeholder
- src/lib/images/image-utils
- src/lib/performance/code-split-guide
- src/components/admin/admin-button.stories
- src/components/admin/admin-card.stories
- src/components/admin/admin-input.stories
- src/components/admin/admin-page-header.stories
- src/components/admin/form-fields/color-field
- src/components/admin/form-fields/date-time-field
- src/components/admin/form-fields/default-field
- src/components/admin/form-fields/file-field
- src/components/admin/form-fields/form-field-row
- src/components/admin/form-fields/form-layout
- src/components/admin/form-fields/form-section
- src/components/admin/form-fields/image-field
- src/components/admin/form-fields/images-field
- src/components/pages/home/sections/partner-cta
- src/components/pages/home/stores-showcase
- src/components/ui/card.stories
- src/components/ui/chip.stories
- src/components/ui/page-header.stories
- src/components/ui/vendor-card.stories
- src/components/ui/vendor-card

## Missing iOS endpoints (top 30)

- 
- /addresses
- /addresses/[id]
- /addresses/[id]/default
- /ai-chat
- /ai-chat/history
- /analytics/event
- /analytics/pageview
- /api/admin/orders
- /api/admin/orders/[id]
- /api/admin/orders/[id]/items
- /api/admin/orders/[id]/messages
- /api/admin/orders/[id]/refund
- /api/admin/orders/direct
- /auth/config
- /auth/csrf
- /auth/login
- /auth/logout
- /auth/me
- /auth/twilio/send
- /auth/twilio/verify
- /blog
- /blog/[slug]
- /cart
- /categories
- /categories/[id]
- /checkout
- /contact
- /coupons
- /coupons/validate

## Suggested fixes (per workflow, top 10)

### customerJourneyAudit

1. `src/app/blog/[slug]/page.tsx` — Page uses notFound() — verify catch-all route exists
   _Fix:_ (needs triage)
2. `src/app/catalog/page.tsx` — Empty-state check without loading indicator
   _Fix:_ Add Skeleton/Spinner fallback during data fetch
3. `src/app/categories/[slug]/page.tsx` — Page uses notFound() — verify catch-all route exists
   _Fix:_ (needs triage)
4. `src/app/offers/[id]/page.tsx` — Empty-state check without loading indicator
   _Fix:_ Add Skeleton/Spinner fallback during data fetch
5. `src/app/offers/[id]/page.tsx` — Page uses notFound() — verify catch-all route exists
   _Fix:_ (needs triage)
6. `src/app/page.tsx` — Empty-state check without loading indicator
   _Fix:_ Add Skeleton/Spinner fallback during data fetch
7. `src/app/products/[id]/page.tsx` — Page uses notFound() — verify catch-all route exists
   _Fix:_ (needs triage)
8. `src/app/vendors/page.tsx` — Empty-state check without loading indicator
   _Fix:_ Add Skeleton/Spinner fallback during data fetch
9. `src/app/wishlist/page.tsx` — Empty-state check without loading indicator
   _Fix:_ Add Skeleton/Spinner fallback during data fetch
10. `src/app/categories/[slug]/page.tsx` — Page uses notFound() — verify catch-all route exists
   _Fix:_ (needs triage)

### adminPanelAudit


### vendorDashboardAudit

1. `src/app/api/v1/vendor/auth/login/route.ts` — Vendor route handler missing vendor auth guard
   _Fix:_ Add requireVendorRole() / verifyVendorRequest() guard
2. `src/app/api/v1/vendor/auth/otp/send/route.ts` — Vendor route handler missing vendor auth guard
   _Fix:_ Add requireVendorRole() / verifyVendorRequest() guard
3. `src/app/api/v1/vendor/auth/otp/verify/route.ts` — Vendor route handler missing vendor auth guard
   _Fix:_ Add requireVendorRole() / verifyVendorRequest() guard
4. `src/app/api/v1/vendor/auth/logout/route.ts` — Mutation route handler without Zod parse
   _Fix:_ Add schema.parse() / safeParse() before mutation
5. `src/app/api/v1/vendor/auth/otp/send/route.ts` — Mutation route handler without Zod parse
   _Fix:_ Add schema.parse() / safeParse() before mutation
6. `src/app/api/v1/vendor/auth/otp/verify/route.ts` — Mutation route handler without Zod parse
   _Fix:_ Add schema.parse() / safeParse() before mutation
7. `src/app/api/v1/vendor/categories/[id]/route.ts` — Mutation route handler without Zod parse
   _Fix:_ Add schema.parse() / safeParse() before mutation
8. `src/app/api/v1/vendor/categories/route.ts` — Mutation route handler without Zod parse
   _Fix:_ Add schema.parse() / safeParse() before mutation
9. `src/app/api/v1/vendor/coupons/[id]/route.ts` — Mutation route handler without Zod parse
   _Fix:_ Add schema.parse() / safeParse() before mutation
10. `src/app/api/v1/vendor/coupons/route.ts` — Mutation route handler without Zod parse
   _Fix:_ Add schema.parse() / safeParse() before mutation

### iosWebParityAudit

1. `` — Web endpoint  has no iOS counterpart
   _Fix:_ Either add iOS call site or remove web route
2. `/addresses` — Web endpoint /addresses has no iOS counterpart
   _Fix:_ Either add iOS call site or remove web route
3. `/addresses/[id]` — Web endpoint /addresses/[id] has no iOS counterpart
   _Fix:_ Either add iOS call site or remove web route
4. `/addresses/[id]/default` — Web endpoint /addresses/[id]/default has no iOS counterpart
   _Fix:_ Either add iOS call site or remove web route
5. `/ai-chat` — Web endpoint /ai-chat has no iOS counterpart
   _Fix:_ Either add iOS call site or remove web route
6. `/ai-chat/history` — Web endpoint /ai-chat/history has no iOS counterpart
   _Fix:_ Either add iOS call site or remove web route
7. `/analytics/event` — Web endpoint /analytics/event has no iOS counterpart
   _Fix:_ Either add iOS call site or remove web route
8. `/analytics/pageview` — Web endpoint /analytics/pageview has no iOS counterpart
   _Fix:_ Either add iOS call site or remove web route
9. `/api/admin/orders` — Web endpoint /api/admin/orders has no iOS counterpart
   _Fix:_ Either add iOS call site or remove web route
10. `/api/admin/orders/[id]` — Web endpoint /api/admin/orders/[id] has no iOS counterpart
   _Fix:_ Either add iOS call site or remove web route

### crossCuttingAudit

1. `src/components/pages/categories/categories-helpers.ts` — Tailwind emerald-* class — should be primary-* token
   _Fix:_ Replace with primary-{NNN} from tailwind.config.ts brand ramp
2. `src/lib/security/pii-crypto.ts` — console.* outside structured logger bypasses LOG_LEVEL gate
   _Fix:_ Replace with logger.ts/info/warn/error
3. `src/lib/security/pii-crypto.ts` — console.* outside structured logger bypasses LOG_LEVEL gate
   _Fix:_ Replace with logger.ts/info/warn/error
4. `src/lib/security/pii-crypto.ts` — console.* outside structured logger bypasses LOG_LEVEL gate
   _Fix:_ Replace with logger.ts/info/warn/error
5. `src/lib/safe-fetch.ts` — console.* outside structured logger bypasses LOG_LEVEL gate
   _Fix:_ Replace with logger.ts/info/warn/error
6. `src/lib/payments/event-ledger.ts` — console.* outside structured logger bypasses LOG_LEVEL gate
   _Fix:_ Replace with logger.ts/info/warn/error
7. `src/lib/queue/redis.ts` — console.* outside structured logger bypasses LOG_LEVEL gate
   _Fix:_ Replace with logger.ts/info/warn/error
8. `src/lib/analytics.ts` — console.* outside structured logger bypasses LOG_LEVEL gate
   _Fix:_ Replace with logger.ts/info/warn/error
9. `src/lib/analytics.ts` — console.* outside structured logger bypasses LOG_LEVEL gate
   _Fix:_ Replace with logger.ts/info/warn/error
10. `src/lib/logger.ts` — console.* outside structured logger bypasses LOG_LEVEL gate
   _Fix:_ Replace with logger.ts/info/warn/error
