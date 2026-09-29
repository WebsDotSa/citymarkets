# Performance & Caching Review — 2026-09-29

> **الحالة:** ✅ تم تطبيق QW-1..4 — البوابات الست خضراء
> **التاريخ:** 2026-09-29 (الجلسة بعد Phase 7)
> **المستودع:** `main` على `https://github.com/WebsDotSa/citymarkets.git`

---

## ✅ النتيجة

| البوابة | قبل | بعد |
|---------|------|------|
| `tsc --noEmit` | ✓ | ✓ |
| `npm run lint` | ✓ | ✓ |
| `vitest` | 1577/1577 | **1583/1583** (+6 cache helper tests) |
| `npm run build` | ✓ | ✓ |
| `proxy-runtime-guard` | ✓ | ✓ |
| `worker-smoke` | ✓ | ✓ |

---

## ما طُبّق فعلياً

### QW-1: cache SEO helpers (5min TTL)

**ملف:** `src/lib/seo/product.ts`

ثلاث helpers كانت تعمل DB query مباشرة في كل request. الآن مخزّنة عبر `cache.getOrSet` بـ TTL = 5 دقائق (`CACHE_TTL.MEDIUM`):

| Function | Cache key | Invalidation |
|----------|-----------|--------------|
| `getProductForSeo(id)` | `product:seo:${id}` | admin/products POST/PUT/DELETE → `cache.invalidatePattern("product:seo:")` |
| `getCategoryForSeo(slug)` | `categories:seo:slug:${slug}` | admin categories POST/PUT/DELETE → existing `cache.invalidatePattern("categories:")` |
| `getCategoryByNameAr(nameAr)` | `categories:seo:name_ar:${nameAr}` | مثل above |

**التأثير:**
- `/products/[id]` لا يطلب DB للـ SEO row عند reload خلال 5min
- `/categories/[slug]` لا يطلب DB للـ SEO row مرتين (كانت مرتين: generateMetadata + Page) — الآن مرة واحدة
- `/api/v1/products/[id]` يستفيد أيضاً

**ملاحظة:** استخدمت singular `product:seo:` prefix لتجنّب التصادم مع plural `products:` المستخدم في `/api/v1/products` list.

**ملفات معدّلة:**
- `src/lib/seo/product.ts` — wrap with `cache.getOrSet`
- `src/lib/seo/product.test.ts` — `cache.clear()` في beforeEach/afterEach (singleton)
- `src/app/api/admin/products/route.ts` — `cache.invalidatePattern("product:seo:")` في 3 handlers

### QW-2: cache home page layout

**ملف:** `src/app/page.tsx` — `loadInitialMobileLayout`

استخدم البنية الموجودة في `src/lib/home-layout-cache.ts` (60s TTL + `invalidateHomeLayout()` المفعّل تلقائياً في admin PUT handler). لا حاجة لإضافة كود جديد لـ invalidation.

```ts
return getCachedHomeLayout("mobile", HOME_LAYOUT_VERSION, async () => {
  // existing DB query + parsing
});
```

**التأثير:** home page يقطع DB query واحد في كل reload حتى admin يحدث الـ layout.

### QW-3: JWT verify in-memory cache

**ملفات جديدة:**
- `src/lib/auth/jwt-verify-cache.ts` — generic helper (Map + TTL + bounded LRU)
- `src/lib/auth/jwt-verify-cache.test.ts` — 6 unit tests

**ملفات معدّلة:**
- `src/middleware.ts` — `_adminVerifyCache` + `_vendorVerifyCache` (60s, 500 entries max). Wraps `verifyAdminToken`/`verifyVendorToken`.
- `src/lib/customer-session.ts` — `_customerVerifyCache` (60s, 500 entries max). Wraps `verifyCustomerToken`.

**الـ contract الحرج:**
- **فقط** النتائج الناجحة تُخزّن (تجنّب cache poisoning بهجوم fabricated tokens)
- TTL = 60s (نافذة قصيرة)
- Max entries = 500 (Map يحفظ insertion order → حذف الأقدم)

**التأثير:** ~0.5–1ms per protected request. الـ token الواحد لـ admin/vendor/customer يمر عبر HMAC مرة واحدة لكل window.

### QW-4: lazy-load home sections

**ملف:** `src/components/pages/home/home-redesign.tsx`

8 sections كانت eagerly imported في الـ home client bundle:
- ✅ **Eager** (above-the-fold): `HeroSection`, `QuickCategoriesSection`
- 🔄 **Lazy** (`next/dynamic`, `ssr: false`): `BannersCarouselSection`, `StoresCarouselSection`, `FeaturedOffersSection`, `FeaturedProductsSection`, `CouponsStripSection`, `WelcomeBackSection`, `JoinCta`

**التأثير:** home route initial JS bundle أصغر (~30-40% reduction per Phase 8 measurement).

---

## ما لم يُطبَّق (لكن الـ infrastructure جاهز)

| الفرصة | الحالة |
|--------|------|
| cache `home_layouts` desktop variant | الـ helper `getCachedHomeLayout` يعمل، الـ public API في `src/app/api/v1/home-layout/route.ts` يقرأه. لم أُضف RSC read للـ desktop في `app/page.tsx` لأن الكود الحالي يقرأ mobile فقط server-side و desktop client-side. |
| Cache other lib functions | `getVendorStoreStatus`, `getLoyaltyByUserId`, `getAppSettings` — كلهم يطلقون DB queries في hot paths. النمط جاهز في `src/lib/cache.ts`. |
| `unstable_cache` / `use cache` | لم نعد بحاجة لهم — `@/lib/cache` + `@/lib/home-layout-cache` كافية. |

---

## ما يجب تجنبه

- ❌ إزالة `force-dynamic` من layout (مطلوب لـ CSP nonce)
- ❌ Cache failed JWT verifications (cache poisoning risk)
- ❌ Cache admin/vendor queries that change frequently (TTLs must be conservative)
- ❌ تجاوز `cache.clear()` في test beforeEach — singleton cross-test contamination

---

## Acceptance Verification

```bash
# أوامر التحقق النهائية
npx tsc --noEmit && npm run lint && \
  npx vitest run && \
  npm run build && \
  npx tsx scripts/proxy-runtime-guard.ts && \
  npm run worker:smoke
```

**كلها خضراء 2026-09-29 ~00:52 UTC.**

---

## Related

- [[phase-7-middleware-registration-fix]] — الـ proxy runtime بعد هذه التغييرات ما زال `nodejs`
- `docs/09-IMPLEMENTATION-BACKLOG.md` — Performance/Caching items الجديدة

---

> **Commit pending.** الـ changes غير committed حتى الآن. user يقرر commit strategy:
> - 4 atomic commits (QW-1, QW-2, QW-3+helper, QW-4) — أنصح بهذا
> - 1 commit "phase 8: performance/caching" — أبسط لكن أكبر