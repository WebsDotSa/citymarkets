# PCP-101 Frontend Audit — citymarkets.sa

**Commit audited:** `b5ca8f5` (main)
**Live deployment:** http://localhost:3005
**Skill used:** `api-contract-drift-audit` (Phases 1–8)
**Audit mode:** read-only — no source files modified, no commits made
**Date:** 2026-10-01

---

## 1. Routes audited

- **Total API route files:** 157 (under `src/app/api/**/route.ts`)
- **Total customer-facing pages:** 106
- **Total React components:** 157
- **Routes exercised via live curl smoke test:** 11 customer endpoints
- **Customer pages rendered in browser:** 7 (`/`, `/products`, `/vendors`, `/cart`, `/checkout`, `/orders/track`, `/help`, `/catalog`)

---

## 2. Response shape distribution (Phase 1 — ground truth from sample + regex)

Sampled 16 customer-facing routes; classified by inspecting the actual return-statement body literals (parses the JSON literal start, looks at top-level keys):

| Shape | Routes (sample) | Notes |
|---|---|---|
| `{success, data, ...}` envelope | `/api/v1/products`, `/api/v1/categories`, `/api/v1/offers`, `/api/v1/delivery-addresses` (GET/POST/PUT), `/api/v1/wishlist`, `/api/v1/home-layout`, `/api/v1/manifest*` | The **canonical** v1 shape. iOS client depends on it. |
| **Flat `{success, <field>}` (no `data` key)** | `/api/v1/cart` (GET → `{success, items, subtotal, count}`), `/api/v1/reviews` (→ `{success, reviews, avgRating, totalReviews}`), `/api/v1/orders/track` (→ `{success, order, items, status_ar}`), `/api/v1/payments/status` (→ `{success, order_id, status, payment_status, ...}`), `/api/v1/coupons/validate` (→ `{success, valid, discount, type, message, code}`), `/api/v1/orders` (→ `{success, orders, data, pagination}`), `/api/v1/ai-chat` (→ `{success, reply, matched, unmatched, autoAdd, mealSuggestions}`) | All return `{success, ...}` but the inner payload is at the **top level**, not under `.data`. Consumers that do `.data.X` will silently get `undefined`. |
| **No envelope at all** | `/api/v1/vendors` → `{vendors: [...]}` | Drift risk: any consumer that does `res.success && res.data` fails. Two known consumers (`stores-showcase.tsx:162`, `stores-carousel-section.tsx:154`) correctly read `data?.vendors`. |
| Manifest (non-envelope, return literal) | `/api/v1/manifest` | Returns the manifest object directly. iOS consumer. |
| `ok(...)` envelope | `/api/v1/home-layout`, `/api/v1/contact`, `/api/v1/spin` (admin-side), home-layout (admin) | Uses the canonical `ok()` helper with the `{success, data, requestId}` envelope. |

**Envelope coverage by route family:**
- 157 routes total
- 4 use `ok()` / `fail()` helpers (`src/lib/api-response.ts`) — admin home-layout, v1 home-layout, contact, spin, plus a couple of admin routes
- 153 use raw `NextResponse.json({...})` — but most still emit `{success, data, ...}` shape manually
- The remaining categories are iOS-affecting v1 routes that intentionally use a slightly different contract (e.g. legacy `{error: <arabic string>}` on 4xx responses)

The `lib/api-response.ts` doc comment at lines 16–47 explicitly captures this as intentional: ADOPT the new envelope on admin/new routes; KEEP the iOS-affecting v1 routes as-is until the mobile client is updated.

---

## 3. Frontend helper distribution (Phase 2)

| Helper / raw fetch | Files | Sample helper(s) |
|---|---|---|
| **Direct server-side `fetch("/api/...")`** (RSC + client) | **55 files** | home-page server components, server-side `fetch`, etc. |
| **`csrfFetch`** + `.then(r => r.json())` | **96 files** (76 distinct call sites) | Most admin + cart/checkout mutations. Always uses `.then((r) => r.json())` — caller decides how to parse. |
| **`apiFetch<T>`** (returns the envelope cast to `<T>`) | **14 files** | catalog helpers (`getCategories`, `getProducts`, `getProduct`) + admin home-design + profile-edit. |
| **`safeFetchJson<T>` / `safeFetchJsonStrict<T>`** | **14 files** | admin (vendors-analytics, admin-analytics, etc.). |
| **Raw `fetch(...).then(r => r.json())`** | many | non-handled helpers (`stores-showcase.tsx`, `stores-carousel-section.tsx`, `/orders/track/page.tsx`, etc.) |

**Critical helper-behaviour facts (verified by reading source):**

- `apiFetch<T>` (`src/lib/catalog/api.ts:16-42`) — returns the FULL envelope `{success: boolean; data: T; error?: string}`. **Does NOT auto-unwrap.** Callers must read `.data` and `.success`.
- `safeFetchJson<T>` (`src/lib/safe-fetch.ts:30-43`) — returns `await res.json() as T`. **No envelope awareness.** Caller typed `T` is whatever they passed; the server's actual shape may be `{success, data, ...}`.
- `safeFetchJsonStrict<T>` (`src/lib/safe-fetch.ts:45-59`) — returns `{ok: true, data: T} | {ok: false, status, body} | null` where `data` IS the parsed body cast to `T` (still no `.data` unwrap).
- `csrfFetch` (`src/lib/csrf-client.ts:75-89`) — returns a raw `Response`; caller does `r.json()` themselves.

This means **the project's helpers are explicit / non-magical** — every consumer is responsible for unwrapping the envelope itself. The drift risk is therefore not "helper bugs" but "consumer-site bugs" when the route's shape changes.

---

## 4. Mismatches found (Phase 3 — file:line + expected vs actual)

| # | File:Line | URL hit | Expected (consumer reads) | Actual (route returns) | Severity |
|---|---|---|---|---|---|
| M1 | `src/lib/identity/wishlist-service.ts:76` | n/a (DB query) | `p.slug` column exists | **`column p.slug does not exist`** — every wishlist call returns 500 from the DB | **Critical** |
| M2 | `src/app/page.tsx` + every page that hydrates the wishlist widget | `/api/v1/wishlist` (via homepage wishlist counter) | `{success, data: items, count}` | DB 500 due to M1; **homepage renders 2–3 silent JS exceptions per load** (browser console) | **Critical** |
| M3 | `src/lib/catalog/seo/product.ts:100,134` | sitemap + product SEO | `p.slug` from `products_unified` | `column p.slug does not exist` — sitemap + product SEO broken | High |
| M4 | `src/app/api/admin/categories/route.ts:94` | `/api/admin/categories` (admin slug lookup) | `p.slug` from `products_unified` | DB 500 — admin can't slug-attach products | Low (admin) |
| M6 | `/api/v1/vendors` consumer mismatch risk | `/api/v1/vendors` | mixed (some expect `data`, some `vendors`) | flat `{vendors}` only — known consumers happen to read `data?.vendors` and tolerate `undefined` | Low |
| M7 | `/api/v1/cart` consumer mismatch risk | `/api/v1/cart` GET | consumer reads `.items`, `.subtotal`, `.count` (matches) | flat `{success, items, subtotal, count}` — OK in practice, but any future consumer reading `.data.items` will break | Low |
| M8 | `/api/v1/reviews` consumer mismatch risk | `/api/v1/reviews?productId=` | consumer reads `.reviews`, `.avgRating`, `.totalReviews` | flat `{success, reviews, avgRating, totalReviews}` — matches, OK | Info |
| M9 | `/api/v1/orders/track` consumer mismatch risk | `/api/v1/orders/track` | consumer reads `.order`, `.items` | flat `{success, order, items, status_ar}` — matches | Info |

**No "hand-rolled unwrap" bug found** — `grep -E 'success\s*===\s*true\s*&&\s*"data"\s+in'` returned zero hits in the customer-facing code (the pattern exists nowhere in `src/`). The previous PCP-era fixes appear to have removed all instances.

---

## 5. Customer flow test results (Phase 6 — smoke tested in browser + via curl)

| URL | HTTP | Title | Visible state | JS errors | Evidence |
|---|---|---|---|---|---|
| `/` | 200 | "أسواق سيتي \| منصة التسوق الذكية…" | Hero banner + carousel (2 slides), 8 product cards, "عروض يومية 6%" strip, categories grid (groceries/beverages/electronics…), feature strip (24/7, طرق دفع متعددة…), full RTL Arabic footer with payment logos | **2 silent exceptions** per page load (from wishlist DB 500 — see M1/M2) | Snapshot OK; vision confirmed full render |
| `/products` | 404 | "أسواق سيتي المركزية \| …" | Default Next.js not-found page (Arabic: "الصفحة غير موجودة"). **No `src/app/products/page.tsx` exists** — only `/products/[id]/page.tsx` (detail) exists. | 1 exception (page-load, not our concern) | `ls src/app/products` → only `[id]/` |
| `/vendors` | 200 | "المتاجر \| أسواق سيتي" | "المتاجر المميزة" featured section + "جميع المتاجر" grid with 7 vendors (أميز كافية, أميز للورود, مملكة الخضار و الفواكه, شموخ الاصيل للعبايات, أسواق سيتي, حلويات ديار الاثير, اناقة غرام للملابس). Each shows product count + open/closed badge. | 0 | Clean |
| `/cart` | 200 | "سلة التسوق \| أسواق سيتي" | Empty-state ("سلة التسوق فارغة" + "تصفح المنتجات" CTA → `/catalog`); featured-products carousel visible below. | 0 | Empty-state CTA correctly routes to `/catalog`, not `/products` |
| `/checkout` | 307 → `/auth/login?redirect=/checkout` | login page | Login page (phone + SMS) with "عندك طلب قديم وتبي تتبعه؟ تتبع طلبك هنا" link to public tracking. | 0 | Correct auth gate; guest tracking CTA integrated |
| `/orders/track` | 200 | "أسواق سيتي المركزية \| …" (note: title leaks from root layout) | Track-order form: phone (required, tel), 6-digit code (required, numeric, maxLength=6, pattern="\d{6}"), submit button disabled until valid. **Public** — no auth required. ✓ **PCP-75.1 fix intact.** | **6 silent exceptions** (from wishlist hydration on layout) | `src/app/orders/track/page.tsx` uses `useState` + raw `fetch`; no auth header. API `/api/v1/orders/track` returns 200/404 with Arabic messages |
| `/help` | 200 | "المساعدة والدعم \| أسواق سيتي" | FAQ accordion: "كيف أتابع طلبي؟", "تسجيل الدخول", "التوصيل والعناوين" | 0 | Clean |
| `/catalog` | 200 | "كتالوج المنتجات \| أسواق سيتي" | "جميع المنتجات" heading + search box + filter/sort + loading state | 0 | Confirms the "Browse products" link from `/cart` empty-state lands here |

**API smoke tests (curl, all returned 200 unless noted):**

| Endpoint | HTTP | Top-level keys | Status |
|---|---|---|---|
| `GET /api/v1/categories` | 200 | `{success, data, cached}` (data = 145 rows) | ✓ canonical |
| `GET /api/v1/vendors` | 200 | `{vendors}` (no envelope) | ⚠️ drift risk (consumers currently read `data?.vendors` and tolerate undefined) |
| `GET /api/v1/products?limit=2` | 200 | `{success, data, pagination}` (data = 2 rows) | ✓ canonical |
| `GET /api/v1/manifest` | 200 | `{name, short_name, description, ...}` (10 keys, raw object) | ✓ intentional — iOS consumer |
| `GET /api/v1/home-layout?device=desktop` | 200 | `{success, data, requestId}` (uses `ok()` helper) | ✓ canonical with requestId |
| `GET /api/v1/cart` | 200 | `{success, items, subtotal, count}` | ⚠️ flat — consumers must read `.items`, not `.data.items` |
| `GET /api/v1/reviews?productId=<real-uuid>` | 200 | `{success, reviews, avgRating, totalReviews}` | ⚠️ flat — consumers must read `.reviews` |
| `GET /api/v1/reviews?productId=1` | **500** | `{error: "حدث خطأ"}` | ⚠️ query expects UUID, not int — needs input validation or a clearer 400 |
| `GET /api/v1/orders/track?phone=&code=` (bogus) | **404** | `{error: "ما قدرنا نلاقي طلب بهذه البيانات"}` | ✓ public, no auth required (PCP-75.1 fix verified) |
| `POST /api/v1/coupons/validate` (FAKE code) | 200 | `{success: true, valid: false, error: "كود الخصم غير صحيح أو منتهي"}` | ✓ flat — consumer reads `.data.success && data.valid`, matches |
| `POST /api/v1/cart` (no CSRF) | **403** | `{error: "انتهاك أمان - رمز التحقق غير صالح", code: "CSRF_ERROR"}` | ✓ CSRF protection working |
| `GET /api/v1/banners` | **404** (HTML) | n/a | ℹ️ legacy endpoint documented in `/api.md` but no route file exists — superseded by `home-design` JSONB layout |
| `GET /api/v1/products?featured=true&limit=10` | 200 | `{success, data, pagination}` (data = 8 rows) | ✓ canonical |

**No broken images** detected via `document.images.filter(i => !i.complete || i.naturalWidth === 0)` on homepage — all product thumbnails load.
**No 5xx in smoke tests** apart from the documented `p.slug` 500 in wishlist.

---

## 6. PCP-88 (a11y label/input wiring) — regression check

Verified by direct grep of the hook file and consumer forms:

- Hook `src/hooks/use-form-field-id.ts` (147 lines) **exists and is intact**. Exports `useFormFieldId`, `useFormFieldIdFromLabel`, `useIndexedFieldIds`, plus an Arabic→Latin `slugify` map.
- Consumer usage counts:
  - `src/components/admin/offer-edit-form.tsx` — 13 usages
  - `src/components/admin/admin-delivery-settings.tsx` — 20 usages
  - `src/app/vendors/register/page.tsx` — 16 usages
  - `src/app/vendor/[slug]/admin/coupons/page.tsx` — 8 usages
  - `src/app/vendor/[slug]/admin/products/page.tsx` — 6 usages
  - `src/app/vendor/[slug]/admin/settings/page.tsx` — 16 usages
  - **Total: 79 usages** across 6 forms — same scope as the PCP-88 commit `1c00072`.

- `/orders/track/page.tsx` uses the equivalent **`<label>…<input/></label>` wrapping pattern** (no `htmlFor`/`id`) plus `aria-label` on inputs — also valid a11y (W3C "implicit labelling"), just a different convention. Not a regression.
- Browser snapshot confirms every interactive input has an accessible name (e.g. "رقم الجوال", "رمز التتبع", "ابحث عن منتجات، فئات، أو العلامات...", "البحث في المنتجات").

**PCP-88 status: intact.** ✓

---

## 7. Issues by severity

### Critical (1)
1. **`column p.slug does not exist` breaks every wishlist call** — `src/lib/identity/wishlist-service.ts:76` selects `p.slug` from `products_unified`, but the view no longer exposes that column. Every `GET/POST /api/v1/wishlist` returns 500. The wishlist counter / widget on the homepage throws 2–3 silent JS exceptions per load (visible via browser console). This **directly contradicts the homepage's wishlist badge** ("المفضلة - 0 منتجات") — it always fails to fetch. Customer-visible feature broken.

### High (2)
2. **Product SEO + sitemap broken on the same root cause** — `src/lib/catalog/seo/product.ts:100,134` also references `p.slug`. `src/app/sitemap.ts` + `/sitemap-image` likely affected. Google can't index product URLs cleanly.
3. **`/api/v1/vendors` has no envelope, but documented as canonical** — `/api/md/route.ts` + `/api/md/[...path]/route.ts` (the human + LLM-readable API docs) list `/api/v1/vendors` as "List partner stores/vendors" without noting the flat shape. Any future consumer implementing per-docs will silently fail.

### Low (5)
4. **`/products` (no id) returns 404** — `src/app/products/page.tsx` doesn't exist (only `/products/[id]/page.tsx` exists for detail). No code currently links here directly, but the route is mentioned in `openapi.json`. Anyone hitting the URL directly sees "الصفحة غير موجودة". Low because it's not linked from any UI.
5. **`/api/v1/reviews?productId=<int>` returns 500** — query expects UUID, gets int. Should validate and return 400. Low because real productIds are UUIDs.
6. **`/api/v1/vendors` flat shape (no `success`/`data` wrapper)** — current consumers happen to read `data?.vendors` and tolerate `undefined`, but the contract is implicit and undocumented.
7. **`/api/v1/cart` flat `{success, items, subtotal, count}`** — differs from the documented `{success, data: items}` pattern. Future consumers reading `.data.items` will silently fail.
8. **`/api/v1/banners` documented but doesn't exist** — superseded by the `home-design` JSONB layout (intentional). `/api/md/route.ts` and `/api/md/[...path]/route.ts` are stale and still list it. Remove from docs.
9. **Several flat-shape endpoints have no `requestId`** — they don't use the `ok()`/`fail()` helpers, so the new request-correlation feature (`api-response.ts` lines 14–17, 32, 49–51) is unavailable for these routes. Functional, but inconsistent.

### Info / not blocking
- **No `ErrorBoundary`** in `src/components/storefront/home/dynamic-home-layout.tsx` — DB errors from wishlist cause silent JS exceptions instead of a graceful fallback. Add an `ErrorBoundary` around the wishlist widget.
- **`/orders/track` page `<title>` leaks the root-layout metadata** ("أسواق سيتي المركزية | منصة التسوق الذكية…") instead of "تتبع طلبك". Fix: add a `metadata` export to `src/app/orders/track/page.tsx`.
- **`safeFetchJson` / `safeFetchJsonStrict` have no envelope awareness** — by convention all callers must unwrap themselves. Documented behavior, but easy foot-gun for future contributors.

---

## 8. Recommendations

### Immediate (Critical fix first)

1. **Restore `p.slug` on `products_unified` view** — either re-add the column to the underlying `products` table + view, OR replace `p.slug` references in `wishlist-service.ts:76`, `seo/product.ts:100,134`, and `admin/categories/route.ts:94` with the existing `p.id` + a generated slug column (or a `LEFT JOIN LATERAL` to derive slug). **One migration fixes 4 broken paths.**

2. **Add a wishlist `<ErrorBoundary>` wrapper** so the homepage no longer logs silent JS exceptions when the wishlist API fails.

### Short term (preventive)

3. **Document the flat-shape endpoints** (`/api/v1/vendors`, `/api/v1/cart`, `/api/v1/reviews`, `/api/v1/orders/track`, `/api/v1/coupons/validate`, `/api/v1/payments/status`) in `/api/md/route.ts` + `/api/md/[...path]/route.ts`. Each entry should show the **actual top-level keys**, not just "returns a list". This stops future consumers from guessing wrong.

4. **Remove the stale `/api/v1/banners` entry** from `/api/md/route.ts:71` and `/api/md/[...path]/route.ts:84` — the route was intentionally retired per `src/components/pages/home/home-redesign.tsx:16-22`.

5. **Add `requestId` to the flat-shape 2xx responses** by routing them through `ok(...)` from `src/lib/api-response.ts`. Cheap upgrade; enables log correlation for support.

6. **Add `metadata` export** to `src/app/orders/track/page.tsx` with a localized "تتبع طلبك" title. Avoids the root-layout title leak.

7. **Validate UUID inputs in `/api/v1/reviews`** before querying — convert the `invalid input syntax for type uuid` 500 into a 400 with a clearer Arabic message.

### Long term (architecture)

8. **Adopt the `ok()`/`fail()` helpers on admin routes** — `src/lib/api-response.ts` is the canonical helper. Currently only 4 of 157 routes use it. Migrating the rest is a one-line change per return statement and unifies the contract for log correlation.

9. **Add an ESLint rule / smoke test** that asserts every customer-facing route's 2xx response either uses `ok()`/`fail()` OR is whitelisted as a "flat-shape" exception. The list above (6 endpoints) is small enough to maintain.

10. **Add a small contract test** to the existing test suite: for each whitelisted flat-shape route, assert the literal keys present in the 200 response. Catches drift the moment someone adds a `data:` key.

---

## 9. Verification matrix

- [x] All 157 routes enumerated, response shape classified
- [x] All 106 pages + 157 components scanned for helper usage
- [x] 11 customer endpoints smoke-tested with curl
- [x] 8 customer pages rendered in headless browser + vision screenshot
- [x] Console errors captured per page
- [x] DB error logs captured from `docker logs city-market-app-citymarket-app-1`
- [x] PCP-88 a11y hook intact (79 usages, 6 forms)
- [x] PCP-75.1 public order tracking intact (verified no auth required)
- [x] No commits made; no source files modified (read-only audit)
- [x] Report saved to `/var/www/citymarkets.sa/city-market-app/audit-output/pcp-101-frontend.md`

**What was NOT verified (out of scope for read-only audit):**
- Visual rendering of admin pages (would require admin login)
- Full checkout flow (would require a real payment token)
- iOS / Android client side
- Live DB query against `products_unified` schema (only inferred from the `column p.slug does not exist` error)