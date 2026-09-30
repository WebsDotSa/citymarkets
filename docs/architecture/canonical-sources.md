# Canonical Sources of Truth

One responsibility → one canonical implementation → many consumers.

Before adding a list, type, query or helper for any domain below, import the
canonical source. If it does not fit, change the canonical source (and its
tests) instead of creating a local copy. `npm run dup:gate` fails CI-style on
new inline payment-method / order-state / payment-state vocabularies outside
the registries.

Last verified: 2026-09-30 (see
[`../audits/2026-09-30-duplication-audit.md`](../audits/2026-09-30-duplication-audit.md)).

| Domain | Canonical source | Derived / notes |
|---|---|---|
| **Payment methods** | `src/lib/payments/payment-methods.ts` — `ALL_PAYMENT_METHODS` tuple | `PaymentMethodId`, `ALLOWED_METHODS`, `PAYMENT_METHODS_UI` (picker), `ONLINE_RETRY_METHODS(_SET)`, `NON_ELECTRONIC_METHODS`, `LEGACY_PAYMENT_METHODS` + `resolvePaymentMethod()` (legacy → canonical at the boundary). Validation: `paymentMethodSchema` (active ∪ legacy, for reading old rows), `directOrderSchema.payment_method` (active only). Classification: **ACTIVE** = `ALL_PAYMENT_METHODS`; **LEGACY** = `cash, card, moyasar, stc_pay, tamara` (readable, never offered); **INTERNAL_ONLY** = `ONLINE_RETRY_METHODS` subset used by retry/inline-card flows; **UNSUPPORTED** = anything else (`resolvePaymentMethod` throws) |
| **Order states** (`orders.status`) | `src/lib/orders/state-machine.ts` — `OrderState`, `ALL_ORDER_STATES` (= `order_status_enum`) | Transitions: `PARENT_ORDER_TRANSITIONS_BY_ROLE`, `canTransition`, `assertValidTransition`. Aliases: `lib/types.OrderStatus`, `lib/admin-types.AdminOrderStatus`. Display: `order-status-display.ts` → `ORDER_STATUSES`, `ORDER_STATUS_DISPLAY` (admin dropdowns). Direct orders: `isDirectOrderCustomerEditable()` |
| **Vendor order states** | same file — `VendorOrderState`, `ALL_VENDOR_ORDER_STATES`, `VENDOR_ORDER_TRANSITIONS_BY_ROLE` | |
| **Payment states** | same file — `PaymentState` / `ALL_PAYMENT_STATES` (`vendor_orders`); `OrderPaymentStatus` / `ALL_ORDER_PAYMENT_STATUSES` (parent `orders.payment_status`, adds LEGACY `unpaid`) | `AdminPaymentStatus` and `reconcile-payment.PaymentDbStatus` derive from these |
| **Payment reconciliation** | `src/lib/payments/reconcile-payment.ts` `reconcilePayment()` | Moyasar + Tamara webhooks. ⚠ `moyasar-confirm.ts` is still a partial parallel path (audit PAY-1, open decision) |
| **Orders — creation** | `POST /api/v1/checkout` → `src/lib/orders/checkout/checkout-service.ts` (`runCheckout`) → `create-checkout.ts` | `POST /api/v1/orders` = 410 (deprecated). `POST /api/v1/orders/direct` = specialized direct/voice flow |
| **Orders — shared queries** | `src/lib/orders/order-repository.ts` (via `@/lib/orders`) | `findDriverIdByAdminUser`, `releaseCouponUseForOrder`, `postDirectOrderSystemMessage` |
| **Checkout pricing** | `src/lib/orders/checkout/pricing.ts` (`computeCheckoutTotals`, fees, coupon, loyalty) | |
| **Product unit price** | `src/lib/catalog/product-price.ts` `productUnitPrice()` (via `@/lib/catalog`) | The `discount_price ?? price` rule checkout charges and the storefront shows. Offers: `src/lib/catalog/offers.ts` (resolver) + `src/lib/cart/pricing.ts` `priceCartRow()` (cart GET). ⚠ Cart (offers) vs checkout (no offers) diverge — audit PRICING-1, open decision |
| **Stock** | API/frontend field **`stock_qty`** | DB: `products.stock_qty` (catalog), `vendor_products.stock_quantity` (vendor). Vendor rows are aliased to `stock_qty` at the SQL boundary and in `catalog/vendor-product-mapper.ts`. `stock_quantity` appears only in vendor-owned APIs. Do not introduce `available_stock` |
| **Address** | `src/lib/identity/address-service.ts` | SQL + ownership (`AddressOwner`), `resolveAddressOwnerFromRequest()`, `toPublicAddressRow()`, set/clear default, `resolveOrderAddress()`. Routes: `/api/v1/delivery-addresses*` (canonical, user+guest); `/api/v1/addresses*` (legacy adapter, user-only) |
| **Wishlist** | Server: `src/lib/identity/wishlist-service.ts` (authoritative for signed-in users). Limit: `identity/wishlist-constants.ts` | Context = cache; per-user localStorage = temporary guest state, merged on login |
| **Cart** | Server: `/api/v1/cart` + `cart`/`guest_cart` tables; line pricing `cart/pricing.ts` | ⚠ Client `cart-context` localStorage is still a second item source (audit FS-2, open) |
| **API errors (server)** | `src/lib/api-response.ts` — `fail()` / `ok()` + `ErrorCodes` | Legacy `{ error: "text" }` responses remain on most routes (rollout deferred with `withApiGuards`) |
| **API errors (client)** | `src/lib/api-error.ts` — `getApiErrorMessage()`, `getApiErrorCode()` | Reads both envelopes. Never hand-roll `data.error \|\| "…"` |
| **API client** | `src/lib/catalog/api.ts` `apiFetch()` (CSRF + credentials) / `src/lib/csrf-client.ts` `csrfFetch()` | CSRF names: `src/lib/csrf-constants.ts`. Many components still call `fetch` directly (audit API-3) |
| **Rate-limit 429 (auth/OTP)** | `src/lib/rate-limit.ts` `rateLimitExceededResponse()` | |
| **Admin `?id=` param** | `src/lib/request-params.ts` `requireIdParam()` | |
| **Site URL** | `src/lib/seo/site.ts` `getSiteUrl()` (re-exported by `@/lib/env`) | |
| **Riyadh time** | `src/lib/delivery/riyadh-time.ts` | `RIYADH_TZ`, `RIYADH_OFFSET_MIN`, `toRiyadhHhmm`, `hhmmToMinutes`, `validHhmmOr` |
| **UUID check** | `src/lib/uuid.ts` | Prefer `z.string().uuid()` for request bodies |
| **Numeric parsing** | `src/lib/format.ts` — `toNumberOrNull`, `toNumberOrZero`, `coerceAmount` | |
| **Invoice shapes** | `src/lib/orders/invoice-types.ts` | |
| **Loyalty** | `src/lib/orders/loyalty.ts` (`LoyaltySettings`, earn/redeem/hold) | |
| **Validation schemas** | `src/lib/validation/*` (barrel `@/lib/validation`) | Enums derive from the registries above |
