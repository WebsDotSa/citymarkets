# 2026-09-30 — Duplication Audit (Phase 0)

> Scope: `src/` of `WebsDotSa/citymarkets` (web app + API), with iOS (`citymarkets/`)
> consulted only as an API consumer. Base: `refactor/full-repository-consolidation`
> @ `8730748` (PR #10), which already closed part of the duplication backlog; this
> audit covers what remained. Remediation is recorded in
> [`2026-09-30-duplication-remediation.md`](./2026-09-30-duplication-remediation.md);
> the resulting ownership map is [`../architecture/canonical-sources.md`](../architecture/canonical-sources.md).

## Method

| Technique | Tool |
|---|---|
| AST scan (functions, types, literal vocabularies, SQL literals, constants) | `scripts/scan-duplicates.ts` (TypeScript compiler API) — `npm run dup:scan` |
| Import graph / consumer search | `grep -rn` over imports, re-exports, barrels, `vi.mock` targets, scripts, iOS `APIClient.swift` |
| DB truth for enums | `migrations/001_full_schema.sql` (`order_status_enum`), `010`, `083` |
| Env truth | production `.env.local` keys (values not read) |

Baseline scan on the PR #10 head (646 non-test source files):

| Category | Count |
|---|---|
| Identical files | 0 |
| Exact function clones across files | 17 groups |
| Renamed-identifier function clones | 2 groups |
| Type names declared in >1 file | 58 |
| Identical type shapes across files | 26 |
| Identical SQL statements across files | 27 |
| SCREAMING_CASE constants declared in >1 file | 32 |
| Inline domain vocabularies (payment methods / order states / payment states) | 33 sites (6 canonical) |

## Classification key

`EXACT_DUPLICATE` · `FUNCTIONAL_DUPLICATE` · `DUPLICATE_SOURCE_OF_TRUTH` ·
`INTENTIONAL_COMPATIBILITY` · `LEGACY` · `SPECIALIZED_IMPLEMENTATION` · `FALSE_POSITIVE`

Risk = impact if the copies drift (HIGH: money/state/security, MEDIUM: user-visible
correctness, LOW: maintenance only).

## Findings

### Payment methods

| ID | File / symbol | Duplicate of | Type | Consumers | Risk | Recommended action |
|---|---|---|---|---|---|---|
| PM-1 | `payments/payment-methods.ts` `PaymentMethodId` union + `ALLOWED_METHODS` set | `ALL_PAYMENT_METHODS` tuple (same file) | DUPLICATE_SOURCE_OF_TRUTH | payment-method route, validation, checkout UI | HIGH | Derive both from the tuple |
| PM-2 | `validation/order.ts` `directOrderSchema.payment_method` `z.enum([...7])` | `ALL_PAYMENT_METHODS` | EXACT_DUPLICATE | `POST /api/v1/orders/direct` | HIGH | `z.enum(ALL_PAYMENT_METHODS)` |
| PM-3 | `api/admin/settings/payments/route.ts` `supported_methods` | `ALL_PAYMENT_METHODS` | EXACT_DUPLICATE | admin payments settings UI | LOW | Derive |
| PM-4 | `checkout/moyasar-checkout-form.tsx` `CheckoutMoyasarMethod` | `ONLINE_RETRY_METHODS` + legacy `stc_pay` | FUNCTIONAL_DUPLICATE | checkout-new, checkout-pay | MEDIUM | Derive from tuple; keep `stc_pay` as documented LEGACY deep-link member |
| PM-5 | `components/pages/checkout/checkout-pay.tsx` URL allow-list `mada|visa|apple_pay|stc_pay` | `ONLINE_RETRY_METHODS` | LEGACY | `/checkout/pay?method=` deep links | LOW | Keep (changing it changes which old links fall back to mada); revisit with PM-4 legacy sunset |
| PM-6 | `.well-known/acp.json`, `.well-known/acp/config.json` `methods: card,apple_pay,google_pay,cod`; `api/v1/route.ts` `payment_modes_supported: moyasar,apple_pay,google_pay,cod` | `ALL_PAYMENT_METHODS` | DUPLICATE_SOURCE_OF_TRUTH (divergent, public) | AI-agent discovery clients | MEDIUM | **Decision needed (DUP-PM-AGENT):** manifests advertise `cod` and `google_pay`, neither accepted since 2026-09-20. Changing a public manifest was not done unilaterally |
| PM-7 | `payments/moyasar.ts` `methods: card,mada,applepay,stcpay`; form `supported_networks` | — | SPECIALIZED_IMPLEMENTATION | Moyasar API | — | Keep (provider vocabulary) |
| PM-8 | `payments/event-ledger.ts` `PaymentGateway = moyasar\|tamara\|cod` | — | FALSE_POSITIVE | ledger | — | Gateways, not methods |
| PM-9 | `payments/moyasar-confirm.ts` writes `payment_method = COALESCE(NULLIF(payment_method,''),'moyasar')` | `resolvePaymentMethod()` boundary (P0-3) | DUPLICATE_SOURCE_OF_TRUTH | inline Moyasar confirm | MEDIUM | Can write the LEGACY `moyasar` token when the order has none; fold into PAY-1 |

### Payment confirmation

| ID | File / symbol | Duplicate of | Type | Consumers | Risk | Recommended action |
|---|---|---|---|---|---|---|
| PAY-1 | `payments/moyasar-confirm.ts` `confirmMoyasarPaymentForOrder` (order UPDATE + `pending→confirmed`) | `payments/reconcile-payment.ts` `reconcilePayment` | FUNCTIONAL_DUPLICATE (partial) | `POST /api/v1/payments/moyasar/confirm` | HIGH | **Decision needed:** partial reimplementation — no advisory lock, no `vendor_orders` mirror, no loyalty/abandoned-cart handling (the webhook completes those later). Converging moves those effects to confirm time. Needs a payments-owner decision + staging E2E |

### Order / payment states

| ID | File / symbol | Duplicate of | Type | Consumers | Risk | Recommended action |
|---|---|---|---|---|---|---|
| OS-1 | `lib/types.ts` `OrderStatus` union | `state-machine.ts` `OrderState` | EXACT_DUPLICATE | `Order` type | MEDIUM | Alias |
| OS-2 | `lib/admin-types.ts` `AdminOrderStatus` (`preparing`, `shipped`) | `OrderState` | DUPLICATE_SOURCE_OF_TRUTH (divergent) | `AdminOrder` | MEDIUM | Alias — `order_status_enum` never had those values |
| OS-3 | `lib/admin-types.ts` `AdminPaymentStatus` + `api/admin/orders/route.ts` `[...ALL_PAYMENT_STATES,'unpaid']` | none (no canonical for parent `orders.payment_status`) | DUPLICATE_SOURCE_OF_TRUTH | admin orders list/filter | MEDIUM | Canonical `OrderPaymentStatus` / `ALL_ORDER_PAYMENT_STATUSES` |
| OS-4 | `api/v1/orders/[id]/items/route.ts` ×3 `['pending','shopping','preparing','accepted']` | — (no canonical) | FUNCTIONAL_DUPLICATE | direct-order line edits | MEDIUM | Canonical `isDirectOrderCustomerEditable()`; `preparing`/`accepted` are unreachable on `order_status_enum` |
| OS-5 | `direct-order/order-detail-client.tsx` `isLocked = ['on_the_way','delivered','cancelled']` | OS-4 (inverse) | DUPLICATE_SOURCE_OF_TRUTH (divergent) | customer direct-order page | MEDIUM | Use the same predicate. The UI showed edit controls on `confirmed` that the API always rejects with 409 |
| OS-6 | `admin/(dashboard)/orders/direct/[id]/page.tsx`, `.../direct/chat/page.tsx` `STATUS_OPTIONS` (incl. `accepted`, `in_progress`) | `ORDER_STATUS_DISPLAY` | EXACT_DUPLICATE (2×) + divergent from DB | admin direct-order status dropdown | MEDIUM | Use `ORDER_STATUS_DISPLAY`; `orderEditSchema` rejects the stale options with 400 |
| OS-7 | `api/admin/driver/orders/history/route.ts` filter `delivered,cancelled,on_the_way` | — | SPECIALIZED_IMPLEMENTATION | driver history | LOW | Keep |
| OS-8 | `api/v1/vendors/[slug]/orders/route.ts` timeline `confirmed…delivered` | — | SPECIALIZED_IMPLEMENTATION | vendor order timeline | LOW | Keep |
| OS-9 | `api/v1/orders/[id]/payment-method/route.ts` `LOCKED_PAYMENT_STATUSES` | — | SPECIALIZED_IMPLEMENTATION | method switch | LOW | Keep (a distinct business rule) |
| OS-10 | `orders/order-payment-action.ts` `TERMINAL_PAYMENT_STATUSES` incl. `completed` | `PaymentState` | LEGACY | pay/retry CTA | LOW | Keep until historical `completed` rows are migrated |
| OS-11 | `payments/reconcile-payment.ts` `PaymentDbStatus = paid\|failed\|pending` | `PaymentState` | FUNCTIONAL_DUPLICATE | webhooks | LOW | `Exclude<PaymentState,'refunded'>` |

### Address

| ID | File / symbol | Duplicate of | Type | Consumers | Risk | Recommended action |
|---|---|---|---|---|---|---|
| AD-1 | `api/v1/delivery-addresses/{route,[id]/route,[id]/default/route}.ts` local `Owner` + `ownerFromRequest()` ×3 | `address-service.AddressOwner` | EXACT_DUPLICATE | web + iOS guest address flows | MEDIUM | `resolveAddressOwnerFromRequest()` in address-service |
| AD-2 | same routes `toClientRow()` ×2 | — | EXACT_DUPLICATE | response DTO | LOW | `toPublicAddressRow()` in address-service |
| AD-3 | `/api/v1/addresses*` (user-only, `X-API-Deprecated`) vs `/api/v1/delivery-addresses*` | — | LEGACY / ADAPTER | iOS (logged-in), web | — | Keep (already delegate SQL to address-service; iOS migration tracked in `docs/architecture/legacy-routes.md`) |

### Product pricing & stock

| ID | File / symbol | Duplicate of | Type | Consumers | Risk | Recommended action |
|---|---|---|---|---|---|---|
| PR-1 | `Number(discount_price ?? price)` in `checkout/resolve-items.ts` ×2 (charged price) + 11 UI/GA sites (cart-v2, checkout-new, product-detail, wishlist, catalog page, cart-context) | — (no named rule) | FUNCTIONAL_DUPLICATE | checkout, storefront | HIGH | One named rule `productUnitPrice()` |
| **PRICING-1** | `cart/pricing.ts` `priceCartRow()` (applies live offers; ignores a `discount_price` above list) vs checkout `resolve-items.ts` (`discount_price ?? price`, no offers) | each other | DUPLICATE_SOURCE_OF_TRUTH (divergent, money) | `GET /api/v1/cart` vs `POST /api/v1/checkout` | HIGH | **Decision needed:** the cart can show a different unit price from what checkout charges when an offer is live. Picking one rule changes charged amounts; left for the business owner. After PR-1 the checkout side is one function |
| PR-2 | `catalog-page.tsx` `{discount_price \|\| price}` (display string) | PR-1 | FUNCTIONAL_DUPLICATE (`\|\|` semantics) | catalog grid | LOW | Left as is (display formatting would change); migrate with PRICING-1 |
| ST-1 | `stock_qty` (`products` / `products_unified`) vs `stock_quantity` (`vendor_products`) | — | INTENTIONAL_COMPATIBILITY | — | LOW | Canonical API/frontend field is `stock_qty`; vendor rows are aliased at the SQL boundary (`vp.stock_quantity AS stock_qty`) and in `vendor-product-mapper.ts`. No frontend component reads `stock_quantity`; `available_stock` is unused |

### Queries (SQL)

| ID | SQL | Sites | Type | Risk | Recommended action |
|---|---|---|---|---|---|
| SQL-1 | `SELECT id FROM drivers WHERE admin_user_id = $1` | 4 driver routes | EXACT_DUPLICATE | LOW | `findDriverIdByAdminUser()` |
| SQL-2 | `SELECT d.id FROM drivers d JOIN admin_users … is_active` | admin orders PUT + `[id]` PATCH | EXACT_DUPLICATE | MEDIUM | same, `requireActiveAdmin` |
| SQL-3 | `UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) …` | admin + driver cancel paths (3) | DUPLICATE_SOURCE_OF_TRUTH (business op) | HIGH | `releaseCouponUseForOrder()` |
| SQL-4 | `INSERT INTO direct_order_messages … 'system'` | 5 sites | EXACT_DUPLICATE | LOW | `postDirectOrderSystemMessage()` |
| SQL-5 | `SELECT … FROM vendors WHERE slug = $1 AND is_active` | 4 public vendor routes | EXACT_DUPLICATE | LOW | Remaining — candidate `findActiveVendorBySlug()` in catalog |
| SQL-6 | `delivery_settings key='slots'`, `loyalty_points balance`, `guest_cart` delete, `vendor_products` counts, offer targets, `order_status_logs` history select, broadcast status | 2–3 sites each | EXACT_DUPLICATE | LOW | Remaining — see remediation §Remaining |
| SQL-7 | `UPDATE orders SET status = CASE WHEN status='pending' THEN 'confirmed' …` | moyasar-confirm, reconcile-payment | FUNCTIONAL_DUPLICATE | HIGH | Part of PAY-1 |

### API response handling

| ID | File / symbol | Duplicate of | Type | Consumers | Risk | Recommended action |
|---|---|---|---|---|---|---|
| API-1 | 53× `data.error \|\| "…"` / `json.error ?? "…"` in 34 pages/components/contexts | — | FUNCTIONAL_DUPLICATE | all client forms | MEDIUM | One reader `getApiErrorMessage()` that understands both envelopes |
| API-2 | Two server error envelopes: legacy `{error:"text"}` and `api-response.fail()` `{error:{code,messageAr,messageEn}}` — both in `/api/v1/contact` | — | DUPLICATE_SOURCE_OF_TRUTH | every client | MEDIUM | Client side unified (API-1). Server-side migration to `fail()` is the deferred `withApiGuards` rollout (PR #10 §F) |
| API-3 | `apiFetch` (catalog/api.ts), `csrfFetch`, `safeFetchJson(Strict)`, raw `fetch` (~164 files) | — | FUNCTIONAL_DUPLICATE | client | LOW | Remaining — pick `apiFetch` as the client, migrate per area |
| API-4 | 5× `rateLimitResponse()` in auth/OTP routes | — | EXACT_DUPLICATE | login/OTP clients (web+iOS) | LOW | `rateLimitExceededResponse()` |
| API-5 | 8× admin `idCheck()` | — | EXACT_DUPLICATE | admin UI | LOW | `requireIdParam()` (`admin/products` keeps its stricter UUID variant — SPECIALIZED) |

### Types

| ID | Types | Type | Risk | Recommended action |
|---|---|---|---|---|
| TY-1 | `MealIngredient`/`MealSuggestion` (catalog/ai-shopping-assistant ↔ ai-chat-client-types), `ChatInputMode` (ai-chat-helpers ↔ client types) | EXACT_DUPLICATE | LOW | Define in client-safe module, re-export |
| TY-2 | `LoyaltySettings` (admin-loyalty ↔ orders/loyalty) | EXACT_DUPLICATE | MEDIUM | Type-only import |
| TY-3 | `VendorSessionEntry` (vendor-auth ↔ vendor-auth-with-db) | EXACT_DUPLICATE | LOW | Export once |
| TY-4 | Invoice item/address (invoice-actions ↔ invoice-pdf-server) | EXACT_DUPLICATE | LOW | `orders/invoice-types.ts` |
| TY-5 | `OfferRow` (api/v1/offers ↔ offers/[id]) | EXACT_DUPLICATE | LOW | `catalog/offers.ts` |
| TY-6 | `Product`, `Order`, `OrderItem`, `OrderDetail`, `Address`, `Coupon`, `Banner`, `Vendor` page-local interfaces (4–6 each) | FUNCTIONAL_DUPLICATE (view models) | MEDIUM | Remaining — most are per-page *subsets* of API DTOs that differ field-by-field; consolidating needs the typed API contracts (`api-contracts/`) the unmerged `refactor/api-contract-consistency` branch is introducing, to avoid a third parallel definition |
| TY-7 | `View`, `Props`, `PageProps`, `Window`, `Column`, `FormState`, `ModalState`, `Period`, `Status` | FALSE_POSITIVE | — | Local component names |

### Constants & utilities

| ID | Symbol | Sites | Type | Risk | Recommended action |
|---|---|---|---|---|---|
| CO-1 | `getSiteUrl()` in `lib/env.ts` **and** `lib/seo/site.ts` (different fallback chains) + inline `SITE_URL` literals in moyasar, tamara, 5 `.well-known` routes | 9 | DUPLICATE_SOURCE_OF_TRUTH | MEDIUM | One implementation (seo/site, client-safe); env re-exports. Prod sets only `NEXT_PUBLIC_SITE_URL`, so the output is the same |
| CO-2 | `RIYADH_TZ`, `RIYADH_OFFSET_MIN`, `toRiyadhHhmm`, `hhmmToMinutes`, HH:MM validator | 3–4 delivery modules | EXACT_DUPLICATE | MEDIUM | `delivery/riyadh-time.ts` |
| CO-3 | `UUID_RE` / `UUID_LIKE` | 11 | EXACT_DUPLICATE | LOW | `lib/uuid.ts` |
| CO-4 | `CSRF_COOKIE_NAME` / `CSRF_HEADER_NAME` in `catalog/api.ts` | 2 | DUPLICATE_SOURCE_OF_TRUTH (security) | MEDIUM | Import `csrf-constants` |
| CO-5 | `MAX_WISHLIST_SIZE` (service ↔ context) | 2 | DUPLICATE_SOURCE_OF_TRUTH | LOW | `identity/wishlist-constants.ts` |
| CO-6 | `toNumber` / `toNumberOrZero` | 4 | EXACT_DUPLICATE | LOW | `format.toNumberOrNull/OrZero` |
| CO-7 | `ISS`/`AUD` (admin/customer/vendor sessions) | 3 | SPECIALIZED_IMPLEMENTATION | — | Keep — distinct audiences per token type |
| CO-8 | `STORAGE_KEY`, `PAGE_SIZE`, `STATUS_FILTERS`, `EMPTY_DRAFT`, `TYPE_LABELS`, `BENEFITS`, `STEPS`, `FEATURES`, `SOCIAL_ICONS`, `GET` | — | FALSE_POSITIVE | — | Same name, different values |
| CO-9 | `VENDOR_TYPES` (vendors/register page ↔ catalog/vendors), `VENDOR_TYPE_LABEL` ×2, `TYPE_EMOJI` ×2, `STATUS_META` ×2, `PRIZES` (spin API ↔ page), `ROLE_LABELS`, `VALID_ROLES` ×2, `PHONE_RE` ×2, `UPLOAD_DIR` ×3, `ICON_MAP` ×3 | 2–3 each | FUNCTIONAL_DUPLICATE | LOW–MEDIUM | Remaining — see remediation. `PRIZES` is the one with business impact: the wheel segment values in `app/spin/page.tsx` must match the values `api/v1/spin` awards (odds live only on the server) |

### Frontend state

| ID | Data | Sources | Type | Risk | Recommended action |
|---|---|---|---|---|---|
| FS-1 | Wishlist | server `wishlist` table (authoritative for users) + context cache + per-user localStorage (guests) | INTENTIONAL_COMPATIBILITY | — | Already resolved in PR #10 (B7): authoritative = server, cache = context, temporary guest state = localStorage, merged on login |
| FS-2 | Cart | client `localStorage` (items) + server `cart`/`guest_cart` tables (`/api/v1/cart`) | DUPLICATE_SOURCE_OF_TRUTH | MEDIUM | **Remaining:** checkout takes items from the request body (client state), while the server cart is persisted separately. Needs a decision on which is authoritative (recommend server, as for wishlist) |

### UI components & services

| ID | Components / services | Type | Risk | Recommended action |
|---|---|---|---|---|
| UI-1 | `components/admin/SearchableSelect.tsx` (7 consumers) ↔ `components/ui/searchable-select.tsx` (1 consumer: admin products page) | FUNCTIONAL_DUPLICATE | LOW | Remaining — different props (`hint`, `disabled` option, `name`, `fullWidth`); merge needs visual QA |
| UI-2 | `hexToRgba` (stores-carousel ↔ stores-showcase), `SectionHeader` (featured-offers ↔ featured-products), `formatDay` (admin analytics ×2), direct-order `addItem`/`removeItem` (chat page ↔ detail client), `highlight` (categories ×2), `reload` in notification tabs | EXACT/RENAMED clones | LOW | Remaining — presentational, low value |
| UI-3 | `auth/logout` ↔ `vendor/auth/logout` handlers | SPECIALIZED_IMPLEMENTATION | — | Different cookies |
| SV-1 | `orders/checkout/checkout-service.ts` ↔ `create-checkout.ts` | FALSE_POSITIVE | — | Orchestrator vs transactional writer of one pipeline |

### API contracts

| Endpoint | Status | Notes |
|---|---|---|
| `POST /api/v1/checkout` | CANONICAL | Order creation for web + iOS (`CheckoutService`) |
| `POST /api/v1/orders` | DEPRECATED | 410 → `/api/v1/checkout` (PR #10); only the webmcp agent tool + an e2e script referenced it |
| `GET /api/v1/orders` | CANONICAL | Order list (web, iOS) |
| `POST /api/v1/orders/direct` | SPECIALIZED | Free-text / voice direct orders; different product (service fee, chat), not a checkout duplicate |
| `PATCH /api/v1/orders/[id]/payment-method` | CANONICAL | Uses canonical `ALLOWED_METHODS` |
| `/api/v1/delivery-addresses*` | CANONICAL | user + guest |
| `/api/v1/addresses*` | LEGACY / ADAPTER | user-only, `X-API-Deprecated`, iOS logged-in path; service-backed |

### Documentation

| ID | Document | Issue | Action |
|---|---|---|---|
| DOC-1 | `docs/audits/2026-09-29-*.md`, `docs/01-CURRENT-STATE-AUDIT.md` | Point-in-time findings that are now false (e.g. "wishlist endpoint does not exist", address `[id]` routes missing) | Mark HISTORICAL with a pointer to canonical-sources |
| DOC-2 | `docs/12-DUPLICATE-AND-LEGACY-REGISTER.md` | Target-architecture register without current owners | Point to canonical-sources + this audit |
