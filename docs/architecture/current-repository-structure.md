# Current repository structure

> **Last updated**: 2026-09-30 — `refactor/full-repository-consolidation` branch
>
> The structure below reflects the post-consolidation layout. Each
> module entry includes: canonical domain, key helpers, and the audit
> finding it closed.

## Top-level layout

```
src/
  app/              — Next.js App Router (routes + UI)
  components/       — React UI components (admin, storefront, design, ui)
  contexts/         — React contexts (auth, cart, wishlist, delivery-location)
  hooks/            — Custom hooks
  lib/              — Domain libraries (the heart of the app)
  server/           — Server-only render helpers (invoice PDF, etc.)
  styles/           — Global styles
  __tests__/        — Cross-cutting test suites
docs/
  architecture/     — THIS directory (current-repository-structure, legacy-routes)
  audits/           — Time-stamped audit reports
migrations/         — 001 → 076 (forward-only)
scripts/            — Build / DB / worker / audit / E2E scripts
```

## `src/lib/` — domain libraries

| Directory | Domain | Key helpers | Audit ref |
|---|---|---|---|
| `analytics.ts` | GA4 + Meta Pixel dual-tracker | `analytics.init/event/productView/addToCart/purchase` | — |
| `api-response.ts` | Canonical error envelope | `ok`, `fail`, `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `internalError`, `outOfStock`, `paymentFailed`, `csrfError`, `ErrorCodes` | I40 (partial; 4/153 routes) |
| `cart/pricing.ts` | Cart unit-price formula | `unitPriceForLine`, `lineSubtotal`, `cartSubtotal` | P2-5 |
| `catalog/` | Products, categories, offers, vendor types | `getCategoryEmoji`, `tree`, `product`, `offers`, `vendor-types`, `ai-chat-client-types` | — |
| `cn.ts` | Tailwind classname merger | `cn()` | H32 (split from utils.ts) |
| `csrf.ts` | CSRF token issuance + verification | `applyCsrfProtection`, `issueCsrfToken` | — |
| `db.ts` | pg pool singleton | `pool` | — |
| `delivery/` | Main-store distance + delivery zones | `getMainStoreAndDistance`, `isWithinDeliveryRadius` | — |
| `errors/checkout-error-reporter.ts` | Shared error reporter for checkout + orders | `reportCheckoutError` | I38 |
| `event-ledger.ts` | (under `payments/`) | (see payments) | — |
| `format.ts` | Formatters + parsers | `formatPrice`, `formatDate`, `formatOrderId`, `formatPhone`, `parseCoords`, `buildWhatsAppUrl`, `coerceAmount`, `parseOrderItems`, ... (15 symbols) | H32 (split from utils.ts) |
| `id.ts` | ID generators | `generateId` | H32 |
| `identity/` | Auth + addresses + wishlist | `customer-session`, `vendor-auth`, `admin-api-auth`, `address-service`, `wishlist-service`, `auth-helpers`, `map-db-user` | B6 (partial), B7 (partial) |
| `logger.ts` | Structured logging | `debug`, `info`, `warn`, `error`, `createRequestLogger` | I38 |
| `middleware.ts` | Next.js middleware | (renamed from `proxy.ts`) | Phase 7 |
| `moyasar/` | Moyasar gateway | `createInvoice`, `verifyWebhookSignature`, `mapStatusToDb` | — |
| `native-push/` | iOS/Android push (stub state) | `sendNativePushToUser`, `selectSenders`, `selectSender`, `ApnsSender`, `FcmSender` | K56-K58 |
| `notifications/` | Notification model | (model + types) | — |
| `orders/` | Order lifecycle, state machine, pricing | `state-machine`, `state-machine` split (`order-states`, `order-transitions`, `order-status-display`, `payment-state`), `sql-fragments`, `main-store`, `order-payment-action`, `order-metrics`, `order-notify-admin`, `order-number`, `abandoned-carts` | C10 (partial), D17-D18, F (partial) |
| `payments/` | Payment gateway integration | `payment-service`, `payment-methods`, `event-ledger`, `moyasar`, `tamara` | D16-D20, S6 |
| `push.ts` | Web Push (web-push npm) | `sendPushToUser`, `vapidPublicKey` | — |
| `queue/` | BullMQ + Redis queue machinery | `enqueue`, `workers`, `loaders`, `redis`, `queues`, `index` (server-only barrel) | E22-E26, G30 |
| `rate-limit.ts` | Per-user + per-IP rate limit | `checkRateLimit` | — |
| `safe-fetch.ts` | Client fetch with abort handling | `safeFetch`, `safeJsonFetch` | — |
| `state-machine.ts` | (under `orders/`) | (see orders) | — |
| `tamara/` | Tamara BNPL gateway | `verifyWebhookSignature`, `mapStatusToDb` | — |
| `time.ts` | Time helpers | `delay` | H32 |
| `utils.ts` | Backward-compat barrel for cn/format/time/id | re-exports only | H32 |
| `validation/` | Zod schemas (per feature) | `schemas`, `auth`, `address`, `order`, `checkout`, `product`, `vendor`, `admin`, `broadcast`, `upload`, `home-layout`, `index`, `primitives` | H33 |
| `web-push.ts` | (under `push.ts` semantically) | (see push) | — |

## `src/components/` — UI components

| Subdir | Purpose |
|---|---|
| `admin/` | Admin dashboard widgets (analytics, payments, vendors, etc.) |
| `checkout/` | Checkout-specific UI (Moyasar form, bank-transfer card) |
| `design/` | Skeleton loaders + design tokens |
| `orders/` | Order-related UI (invoice actions, timeline) |
| `pages/` | Page-level React components (home, product, profile, etc.) |
| `pwa/` + `push-opt-in.tsx` + `webmcp-provider.tsx` | PWA + Web Push + WebMCP providers |
| `storefront/` | Customer-facing UI (product cards, category tiles) |
| `ui/` | Design-system primitives (toast, modal, button, etc.) |

Deleted in earlier phases (audit A2):
- `admin/admin-notifications-settings.tsx`
- `storefront/category-tile.tsx`
- `ui/trust-badges.tsx`
- `ui/admin/badge.tsx`
- `orders/invoice-pdf.tsx`
- `pages/home/home-v2.tsx`
- `hooks/useAnalytics.ts`

## `src/app/` — routes

```
app/
  admin/             — admin dashboard
  api/               — route handlers (REST + webhooks)
    v1/              — public/customer-facing
    admin/           — admin-only
    webhooks/        — gateway callbacks
  vendor/            — vendor portal
  driver/            — driver portal
  wishlist/          — customer wishlist
  orders/            — order list + detail
  profile/           — customer profile
  ...
```

## Migration file naming convention

- `NNN_description.sql` — forward-only migrations (001 → 076)
- Avoid filename-sort collisions (e.g. `059_*` must be renamed to
  `059a_*` / `059b_*` if two migrations share the prefix).
- `060_rollback.sql` is **deferred for deletion** in a follow-up
  branch — its silent reverse on every fresh DB is a footgun.

## Cross-cutting invariants

1. **Server-only modules must carry `import "server-only"`** at the
   top of the file if they pull in pg / BullMQ / ioredis. Public
   barrels that re-export such modules must also carry the directive.
2. **State transitions go through `state-machine.ts`** — never
   hand-write SQL `UPDATE orders SET status = ...`.
3. **Address CRUD goes through `identity/address-service.ts`** —
   never inline the SELECT/INSERT/UPDATE in routes.
4. **Payment method enum** comes from `payments/payment-methods.ts` —
   never define a local `ALLOWED_METHODS` set in a route.
5. **Webhook side effects (push / SMS / vendor notify) fire AFTER
   `COMMIT`** — never inside the transaction.
