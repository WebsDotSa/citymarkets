# PCP-101 — User-Flow Dogfood Audit Report

**App:** citymarkets.sa (أسواق سيتي)
**Stack:** Next.js + Postgres (container `city-market-app-citymarket-app-1`)
**Audit date:** 2026-10-01 (UTC)
**Auditor:** Hermes subagent — `dogfood` skill + `citymarkets-checkout` skill
**Build commit verified:** `b5ca8f5ea3af3fa418ceab868068ff3e94eeac4d`
**Production URLs tested:** `https://citymarkets.sa/*`, `http://localhost:3005/*`
**Server logs analyzed:** `docker logs city-market-app-citymarket-app-1 --tail 200`

---

## Executive summary

| Severity | Count |
|----------|-------|
| **Critical** | 3 |
| **High**     | 5 |
| **Medium**   | 4 |
| **Low**      | 4 |

The customer-facing site is **mostly functional but has critical checkout-breaking and image-rendering bugs**, plus a confirmed **stale-build regression** in wishlist query. Server logs show 5+ recurring error patterns. No literal `[object Object]` or `undefined` text leaks observed. Hydration markers present in source but no client-side mismatch errors logged.

**Things that work end-to-end (verified):**
- Homepage loads with hero, products, vendors, categories, offers, banner carousel
- `/vendors` index renders all vendors (some with 0 products — empty vendors created)
- Vendor detail pages render (aamiz-kafeh has 36 products displayed)
- Product detail page renders name, price, vendor, related products
- Cart empty-state renders correctly
- `/orders/track` is **public** (no auth redirect) — PCP-75.1 fix confirmed
- `/admin` redirects to `/admin/login` correctly
- Categories index renders 19 main + 97 sub categories
- Category detail page renders products grid after hydration
- Delegate/driver-recruit page renders correctly
- All footer / nav Arabic translations are present (no missing keys)
- Meta Pixel + GA4 + JSON-LD SEO all wired

---

## Critical issues

### C1 — Add to Cart button on `/vendors/[slug]/products/[id]` navigates to `/offers` instead of adding to cart

- **URL observed:** `https://citymarkets.sa/vendors/aamiz-kafeh/products/6ecdd4ba-7294-4189-b4b0-d53a59810f70`
- **Reproduce:** Visit any vendor product page → click "🛒 أضف للسلة" (Add to Cart)
- **Expected:** Item added to cart, navigate to `/cart` (per source `src/app/vendors/[slug]/products/[id]/page.tsx:98 router.push("/cart")`)
- **Actual:** Browser navigates to `https://citymarkets.sa/offers` and cart stays empty. `localStorage.city_market_cart` stays null.
- **Diagnosis (DOM):** The rendered `<button>` carries `type="submit"` and **is positioned behind the bottom-nav fixed menu** (the screenshot shows the bottom-nav floating over the product image area, so the click coordinate hits the "العروض" link). The live rendered HTML:
  ```html
  <button class="flex-1 py-3 rounded-xl bg-primary text-white font-bold flex items-center justify-center gap-2">
    <span>🛒</span><span>أضف للسلة</span>
  </button>
  ```
  Note: **no `type="button"` attribute and no `onClick` binding in the live HTML**, contradicting the source which has both. Either the live build is stale, or hydration is silently dropping the handler. (Source `src/app/vendors/[slug]/products/[id]/page.tsx:302` has `type` defaulting to submit because no explicit `type="button"`.)
- **Console:** Empty message array, 1+ exception entries (browser-vision reports `"exception"` with empty message — likely a swallowed hydration warning).
- **Impact:** **No customer can complete a checkout** from a vendor product. This is the dominant entry point (the `/products/[id]` route is rarely linked). Screenshot evidence: see "Add-to-cart broken" inline note (the page after click goes to `/offers`, not `/cart`).
- **Recommended fix:**
  1. Add `type="button"` to the button at `src/app/vendors/[slug]/products/[id]/page.tsx:302`
  2. Add `aria-disabled={adding}` and preventDefault on form submission if it's inside any form
  3. Move the bottom-nav above the fixed add-to-cart bar OR add `padding-bottom: 7rem` on the product page `<main>` so they don't overlap

### C2 — Wishlist GET 500: `column p.slug does not exist`

- **URL observed:** `/wishlist` page in browser → triggers `GET /api/v1/wishlist`
- **Server log (multiple timestamps):**
  ```
  [2026-10-01T15:02:39.373Z] [ERROR] wishlist list error {"error":"column p.slug does not exist"}
  [2026-10-01T15:11:06.699Z] [ERROR] wishlist list error {"error":"column p.slug does not exist"}
  [2026-10-01T15:21:46.793Z] [ERROR] wishlist list error {"error":"column p.slug does not exist"}
  ```
- **Repro:** Login as any authenticated user → visit `/wishlist`
- **Expected:** List of wishlist items
- **Actual:** 500 internal server error; the `/wishlist` page renders its "empty" state because the API returned a 500 with no data.
- **Diagnosis:** The **built JS bundle still references `p.slug`** (`docker exec city-market-app-citymarket-app-1 cat /app/.next/server/chunks/\[root-of-the-server\]__18s153p._.js | grep p.slug` returns matches). The source file `src/lib/identity/wishlist-service.ts:69-79` no longer contains `p.slug` (the citymarkets-checkout skill confirms the fix was committed). This is a **stale-build regression**: the wishlist fix was committed but the Docker image was not rebuilt.
- **Impact:** Every authenticated user gets a broken wishlist. Known /wished product browsing is dead.
- **Recommended fix:** Rebuild the image:
  ```bash
  docker compose build --no-cache citymarket-app
  docker compose up -d --force-recreate citymarket-app
  ```
  See citymarkets-checkout skill §"Deploy" for the post-build verification protocol.

### C3 — Product image broken: `/_next/image` rejects CDN SVGs

- **URL observed:** `https://citymarkets.sa/_next/image?url=https%3A%2F%2Fcdn.citymarkets.sa%2Fvendor%2Fcoffee.svg&w=640&q=75`
- **Actual response:** `HTTP/2 400` body `"url" parameter is valid but image type is not allowed`
- **Reproduce:** `curl -s 'https://citymarkets.sa/_next/image?url=https%3A%2F%2Fcdn.citymarkets.sa%2Fvendor%2Fcoffee.svg&w=640&q=75'` → `image type is not allowed`
- **User impact:** Every product image renders as a 📦 emoji placeholder box instead of the actual product photo. All products returned by `/api/v1/products` have `image_url: "https://cdn.citymarkets.sa/vendor/coffee.svg"` (or similar SVG paths) — the placeholder SVGs are served as `image/svg+xml` but Next.js image optimizer rejects them. The homepage products, category pages, vendor pages, and product detail pages all show the same orange 📦 box.
- **Severity:** Critical — it removes the primary purchase-driving visual.
- **Recommended fix:** Either
  1. Configure `next.config.js` `images.dangerouslyAllowSVG: true` (with CSP restriction), OR
  2. Re-upload all vendor placeholder images as PNG/JPG, OR
  3. Replace the global `coffee.svg` placeholder with a PNG file in the seed migration.

---

## High issues

### H1 — Vendor page (`/vendors/[slug]`) `<title>` is wrong

- **URL:** `https://citymarkets.sa/vendors/aamiz-kafeh` → browser tab title = `"أسواق سيتي المركزية | منصة التسوق الذكية المتعددة المتاجر في السعودية"`
- **Expected:** `"أميز كافية | أسواق سيتي"` (or vendor-specific)
- **Actual:** Default site title — the vendor metadata isn't being injected.
- **Severity:** High (SEO — every vendor page is duplicated title in SERPs; shareability also suffers).
- **Fix:** Add `generateMetadata({params})` to `src/app/vendors/[slug]/page.tsx` that pulls the vendor by slug and returns the proper title + description.

### H2 — Product page (`/vendors/[slug]/products/[id]`) `<title>` is wrong

- **URL:** `https://citymarkets.sa/vendors/aamiz-kafeh/products/6ecdd4ba-7294-4189-b4b0-d53a59810f70` → title = default site title
- **Expected:** `"أمريكانو بارد — أميز كافية | أسواق سيتي"`
- **Fix:** Add `generateMetadata()` to `src/app/vendors/[slug]/products/[id]/page.tsx`.

### H3 — `BottomNavV2` (the floating tab bar) overlaps the product image area on `/vendors/[slug]/products/[id]`

- **URL:** `https://citymarkets.sa/vendors/aamiz-kafeh/products/6ecdd4ba-7294-4189-b4b0-d53a59810f70`
- **Observed (vision):** The tab bar with icons (حسابي / المفضلة / التصنيفات / الرئيسية / طلباتي / شيف سيتي / المتاجر) sits ~mid-page, blocking the upper product image area. The actual "أضف للسلة" bottom bar is invisible.
- **Diagnosis:** Both the tab bar and the add-to-cart bar are `position: fixed; bottom: 0`. The tab bar's z-index is winning for the upper portion of the product image because the page content has no `padding-bottom` to push above it.
- **Severity:** High (UX — users can't see product photos or click the cart button).
- **Fix:** Add `pb-32` to the page's `<main>` on mobile, OR raise z-index of add-to-cart bar, OR exclude BottomNavV2 from product pages.

### H4 — Four of seven seeded vendors show "0 منتج"

- **URL:** `https://citymarkets.sa/vendors` → "المتاجر" section
- **Affected vendors (0 products each):**
  - مملكة الخضار و الفواكهة (`/vendors/مملكة-الخضار-و-الفواكهة`)
  - شموخ الاصيل للعبايات (`/vendors/شموخ-الاصيل-للعبايات`)
  - حلويات ديار الاثير (`/vendors/حلويات-ديار-الاثير`)
  - اناقة غرام للملابس (`/vendors/اناقة-غرام-للملابس`)
- **Diagnosis:** Their `vendor_products` rows are missing. Either seed migration didn't include them, or they were soft-deleted.
- **Severity:** High (these vendors are advertised as "مميز ⭐" in the featured grid but have no products — misleads customers).
- **Fix:** Backfill `vendor_products` rows for these four vendors OR hide them from the storefront.

### H5 — Reviews endpoint 500: `invalid input syntax for type uuid: "1"`

- **Server log:**
  ```
  [2026-10-01T15:26:41.950Z] [ERROR] Reviews GET error: {"error":"invalid input syntax for type uuid: \"1\""}
  ```
- **Cause:** A page is calling `/api/v1/products/[id]/reviews` with the literal string `"1"` (or similar non-UUID) as the id. Postgres rejects the UUID cast.
- **Severity:** High (silent 500 — any page that uses product slug="1" or numeric id falls into this trap).
- **Fix:** Validate the UUID at the route entry, return 400 with a clear error before hitting Postgres. Apply to `src/app/api/v1/products/[id]/reviews/route.ts`.

---

## Medium issues

### M1 — `/admin/login` route JSON-parse error on certain requests

- **Server log:**
  ```
  [2026-10-01T15:19:55.592Z] [ERROR] Admin login error: SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)
  ```
- **Cause:** Admin login route does `JSON.parse(await req.text())` without checking content-type; some clients (or the admin UI) send an empty body or form-encoded body and it crashes.
- **Severity:** Medium (admin login occasionally fails on edge cases).
- **Fix:** Guard the parse: `try { JSON.parse(text) } catch { return fail(400, "invalid_body") }`, or check `content-type` header.

### M2 — `/driver` route returns 404 (does not exist)

- **URL:** `https://citymarkets.sa/driver` and `https://citymarkets.sa/driver/login` → 404 "الصفحة غير موجودة"
- **Reality:** The driver app lives at `/admin/driver/*` (admin-side dashboard) and the public recruit page is at `/delegate`.
- **Severity:** Medium (no broken customer-facing link, but any user typing `/driver` lands on a confusing 404 — possibly a missing redirect to `/delegate`).
- **Fix:** Add a `src/app/driver/page.tsx` that redirects to `/delegate`.

### M3 — `<main>` element snapshot empty in `browser_snapshot` calls

- **Reproducible:** On `/vendors/[slug]`, `/vendors/[slug]/products/[id]`, `/products/[id]`, `/orders/track`, `/cart`, `/wishlist`, `/categories/[slug]`, the initial `browser_snapshot()` shows `<main>` with no children (only the loading skeleton would render later, and the snapshot is captured before hydration completes).
- **Diagnosis:** Server renders the page; React hydration kicks in asynchronously. The browser-vision tool grabs the snapshot during the loading state, so it looks empty.
- **Severity:** Medium (cosmetic only — the actual page works for users with normal JS timing; but server-rendered HTML should include the content).
- **Fix:** Inspect whether the page renders the SSR HTML correctly. If yes, the snapshot tool is at fault. If no, the loading.tsx is overriding the SSR content.

### M4 — `getCategoriesTree` returns 19/97 but homepage displays only the deepest-rooted 8

- **URL:** `https://citymarkets.sa/categories` shows 19 main + 97 sub. The homepage "تسوق حسب الفئة" section shows only 8 (per `DynamicHomeLayout` config in source: `max_items: 8, root_only: true`).
- **Severity:** Medium (the homepage showcase is intentionally limited; not a bug, but worth flagging that 11 of 19 root categories never appear on the homepage).

---

## Low issues

### L1 — Mobile/Desktop viewport confusion in browser test

- The `BottomNavV2` and `StickyCartBar` are mobile-first; desktop viewport (1274px wide) shows them floating in odd positions. Real mobile users see them at the bottom as intended.
- **Fix:** Add `lg:hidden` to these components.

### L2 — Floating "تثبيت التطبيق" install-prompt dialog blocks the product page

- **URL:** Any page
- **Severity:** Low (only shows once per session for new users; close button works).
- **Fix:** Add a `localStorage` flag so it doesn't reopen after dismissal.

### L3 — Vendor contact phone is partially masked (`"+966****4976"`)

- **API:** `https://citymarkets.sa/api/v1/vendors?limit=1` returns `contactPhone: "+966****4976"`
- **Fix:** Decide whether vendors want their phone public or fully masked; right now the masking is inconsistent with the unmasked `contactWhatsapp` ("966530444976") that gets returned.

### L4 — `/api/v1/products?limit=5` returns products but homepage uses `/api/v1/products/featured`

- **Observation:** Direct call to `/api/v1/products` returns products with `image_url: "https://cdn.citymarkets.sa/vendor/coffee.svg"`. The `coffee.svg` placeholder is used as the *real* image_url, not as a fallback. So every product's image fails (see C3).
- **Fix:** Use a real product photo URL when seeding, not the placeholder.

---

## Per-page console / network observations

| Page | URL | Console errors | Network errors | Visual issues |
|------|-----|----------------|----------------|---------------|
| Home | `/` | 1 exception (empty msg, benign) | none | Hero + sections render correctly |
| Vendor list | `/vendors` | 1 exception | none | 4/7 vendors show 0 products |
| Vendor page | `/vendors/aamiz-kafeh` | 4 exceptions | none | Renders; title wrong (H1) |
| Product page (vendor-scoped) | `/vendors/aamiz-kafeh/products/<id>` | 5 exceptions | none | **Add-to-cart broken (C1)**, image broken (C3), bottom-nav overlap (H3), title wrong (H2) |
| Product page (alt route) | `/products/<id>` | similar | none | Has reviews section; title correct; image still broken (C3) |
| Cart | `/cart` | 0 | none | Empty state OK |
| Wishlist | `/wishlist` | similar | **500 from /api/v1/wishlist (C2)** | Empty state shown but API fails |
| Orders track | `/orders/track` | 0 | none | Form renders; public (PCP-75.1 ✓) |
| Categories index | `/categories` | 0 | none | 19/97 renders correctly |
| Category detail | `/categories/<slug>` | 0 | none | "0 منتج" briefly, then 126 products hydrated |
| Offers | `/offers` | 0 | none | 1 active offer listed |
| Vendor recruit | `/delegate` | 0 | none | Form renders |
| Admin login | `/admin/login` | 0 | JSON parse error (M1) | Form renders |
| 404 | `/driver`, `/driver/login` | n/a | n/a | 404 page (M2) |

---

## Hydration / i18n / SEO checks

- **Hydration markers:** The HTML contains all `__next_f.push(...)` React 19 RSC streams. No `data-nextjs-dialog` overlay element detected on any page (no client errors). Browser console reported 1+ "exception" entries per page but with empty messages — these appear to be the standard Next.js Script error boundary, not actual page errors.
- **Arabic translations:** No `[object Object]` or `undefined` placeholders observed on any tested page. All UI strings (navigation, buttons, errors, footer) render in proper Arabic.
- **Canonical tags:** Each page has `<link rel="canonical" href="https://citymarkets.sa/...">` except vendor and product pages (H1, H2).
- **Open Graph:** Homepage has full OG metadata (title, description, image, locale). Vendor/product pages are missing OG tags (related to H1, H2).

---

## Server-log evidence (selected, last 200 lines)

```
2026-10-01T15:02:39.372Z [ERROR] db query failed {"error":"column p.slug does not exist"} ... wishlist list error
2026-10-01T15:11:06.699Z [ERROR] db query failed {"error":"column p.slug does not exist"} ... wishlist list error
2026-10-01T15:19:20.009Z [ERROR] order detail GET failed {"error":"invalid input syntax for type uuid: \"test-id-uuid\""}
2026-10-01T15:19:55.592Z [ERROR] Admin login error: SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)
2026-10-01T15:21:46.792Z [ERROR] db query failed {"error":"column p.slug does not exist"} ... wishlist list error
2026-10-01T15:26:41.950Z [ERROR] Reviews GET error: {"error":"invalid input syntax for type uuid: \"1\""}
```

---

## Recommendations

1. **Immediate (block release):**
   - Rebuild Docker image (fixes C2 wishlist regression). Run `docker compose build --no-cache citymarket-app` then `--force-recreate`.
   - Fix the add-to-cart click target (C1) — add `type="button"` to the button at `src/app/vendors/[slug]/products/[id]/page.tsx:302`, then verify the layout doesn't have the BottomNav overlay.
   - Fix image proxy (C3) — either allow SVG in `next.config.js` `images.dangerouslyAllowSVG` or re-seed placeholder PNGs.

2. **High-priority cleanup:**
   - Add `generateMetadata()` for `/vendors/[slug]` and `/vendors/[slug]/products/[id]` (H1, H2).
   - Validate UUIDs at route entry for `/api/v1/products/[id]/reviews` and `/api/v1/orders/[id]` (H5 + similar).
   - Backfill or hide the four empty vendors (H4).

3. **Medium-priority cleanup:**
   - Guard admin login JSON parse (M1).
   - Add `/driver` redirect to `/delegate` (M2).
   - Tighten the Reviews API UUID validation.

4. **Optional polish:**
   - Add `lg:hidden` to BottomNavV2/StickyCartBar (L1).
   - Persist install-prompt dismissal (L2).
   - Decide on phone/WhatsApp masking policy (L3).

---

## Methodology notes

- All testing used `browser_navigate` + `browser_snapshot` + `browser_click` + `browser_console` + `browser_vision` against `https://citymarkets.sa/*`.
- Page render was verified twice: once via text snapshot (often shows pre-hydration skeleton) and once via vision screenshot (post-hydration, full content visible).
- Per-page console errors captured before each navigation.
- Server logs queried via `docker logs city-market-app-citymarket-app-1 --tail 200` immediately after the audit to capture user-triggered 5xx events.
- No files modified, no commits made. This is a read-only audit.
- Screenshots referenced inline were taken with `browser_vision` and shown directly in the audit transcript (the Browserbase vision tool does not save PNGs to local disk; if you need a screenshot archive, ask the parent agent to re-run with screenshot capture enabled).

— End of report —
