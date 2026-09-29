# أسواق سيتي المركزية | City Markets

تطبيق توصيل سوبرماركت ذكي مبني بـ Next.js 16 + TypeScript + PostgreSQL

## 🎯 نظرة عامة

- 🛒 سوبرماركت إلكتروني للسوق السعودي
- 📱 PWA + iOS app (SwiftUI / iOS 17+)
- 🌐 RTL + i18n (عربي/إنجليزي)
- 💳 بوابات دفع: Moyasar + Tamara (BNPL)
- 🔔 إشعارات Push (Web + APNs)
- 📊 لوحة تحكم Admin
- 🏪 لوحة تحكم Vendors

---

## 🚀 التشغيل

```bash
# تطوير
npm run dev

# بناء للإنتاج
npm run build

# تشغيل الإنتاج
npm run start

# تشغيل Tests
npm test

# تشغيل Worker
npx tsx scripts/worker.ts
```

---

## 📁 البنية

```
.
├── src/                       # Next.js web app
│   ├── app/                   #   App Router
│   │   ├── (storefront)/      #   صفحات المتجر
│   │   ├── admin/             #   لوحة التحكم
│   │   ├── vendor/            #   لوحة البائع
│   │   └── api/v1/            #   REST API
│   ├── components/            #   React Components
│   ├── contexts/              #   Auth, Cart contexts
│   ├── lib/                   #   Utilities (db, payments, push, csrf, …)
│   ├── scripts/               #   Worker scripts
│   └── proxy.ts               #   Next.js 16 proxy: auth, CSRF, CSP
├── ios/                       # Native iOS app (SwiftUI / iOS 17+)
│   ├── CityMarkets/           #   App target
│   ├── CityMarketsTests/      #   Unit tests
│   ├── CityMarketsScreenshotTests/  # App Store screenshot harness
│   ├── fastlane/              #   CI/CD lanes + App Store metadata
│   ├── project.yml            #   XcodeGen spec (single source of truth)
│   ├── README.md              #   دليل iOS الكامل
│   ├── RELEASE_READINESS.md   #   go/no-go checklist للإصدار
│   ├── APP_REVIEW.md          #   Apple submission checklist
│   └── PERFORMANCE.md         #   budgets + قياس الأداء
├── scripts/                   # Shared backend scripts (migrate, smoke, …)
├── migrations/                # SQL migrations (001-077)
└── docs/                      # Architecture / runbooks / ADRs
```

---

## 🛠️ التقنيات

| المكون | التقنية |
|--------|--------|
| Web framework | Next.js 16.2.11 + TypeScript |
| Database | PostgreSQL |
| ORM | pg (node-postgres) |
| Payments | Moyasar + Tamara (BNPL) |
| Auth | JWT (Bearer) + Twilio OTP |
| Push | Web Push + APNs |
| Hosting | Docker Compose + Nginx |
| iOS app | SwiftUI + Swift 6 (strict concurrency) + iOS 17+ |
| iOS packages | Alamofire, KeychainAccess, Sentry, moyasar-payments |
| iOS tooling | XcodeGen + Fastlane + SwiftLint |
| iOS CI | GitHub Actions (`.github/workflows/ios.yml`) |

---

## 🌐 API Endpoints

| Endpoint | الوصف |
|----------|-------|
| `GET /api/v1/categories` | الفئات |
| `GET /api/v1/products` | المنتجات |
| `GET /api/v1/products/[id]` | تفاصيل منتج |
| `POST /api/v1/orders` | إنشاء طلب |
| `GET /api/v1/orders/track` | تتبع الطلب |
| `GET /api/health` | فحص الحالة |
| `POST /api/v1/auth/twilio/send` | إرسال OTP |
| `POST /api/v1/auth/twilio/verify` | التحقق من OTP |

### Admin API
| Endpoint | الوصف |
|----------|-------|
| `GET /api/admin/dashboard/stats` | إحصائيات |
| `GET /api/admin/orders` | الطلبات |
| `GET /api/admin/products` | المنتجات |
| `GET /api/admin/users` | المستخدمين |

هذه قائمة مختصرة. المصدر الآلي الأشمل هو [`/openapi.json`](./src/app/openapi.json/route.ts).

---

## ✅ الميزات المنجزة

- [x] صفحة رئيسية (بانرات + فئات + منتجات)
- [x] تسجيل دخول OTP
- [x] الكتالوج (بحث + فلتر + pagination)
- [x] تفاصيل المنتج
- [x] السلة
- [x] الدفع (Cash + Online)
- [x] الطلبات + التتبع
- [x] الملف الشخصي
- [x] لوحة تحكم Admin
- [x] لوحة تحكم Vendors
- [x] إشعارات Push
- [x] PWA + Service Worker
- [x] Error Pages
- [x] Health Check
- [x] Rate Limiting
- [x] In-memory Caching
- [x] Tests

---

## 🔧 الإعداد

1. نسخ `.env.local.example` إلى `.env.local`
2. إضافة المفاتيح المطلوبة
3. `npm install && npm run dev`

---

## 📖 الوثائق

### Backend / Web

- [الخطة الشاملة](./docs/00-FULLSTACK-MASTER-PLAN.md) - الخطة الكاملة لـ 10 مراحل
- [تدقيق الحالة الراهنة](./docs/01-CURRENT-STATE-AUDIT.md) - المخاطر R1-R10
- [دليل النشر](./DEPLOYMENT.md) - إعداد ونشر الإنتاج
- [دليل المساهمة](./docs/CONTRIB.md) - التطوير، السكربتات، البيئة، الاختبارات، والترحيلات
- [دليل التشغيل](./docs/RUNBOOK.md) - المراقبة، الأعطال الشائعة، والتراجع
- [خطة الـ Migrations](./docs/06-DATABASE-MIGRATION-PLAN.md) - استراتيجية ترحيل البيانات
- [بوابات QA والإصدار](./docs/08-QA-AND-RELEASE-GATES.md) - الفحوصات المطلوبة للإصدار

### iOS app

- [iOS README](./ios/README.md) - دليل iOS الكامل
- [iOS App Guide](./IOS_APP_GUIDE.md) - مواصفات SwiftUI للتطبيق
- [Release Readiness](./ios/RELEASE_READINESS.md) - go/no-go checklist للإصدار
- [App Review](./ios/APP_REVIEW.md) - Apple submission checklist
- [Performance](./ios/PERFORMANCE.md) - budgets وقياس الأداء
- [QA Report](./ios/QA_REPORT.md) - Phase 6 close-out

### Developer

- [CLAUDE.md](./CLAUDE.md) - ملاحظات للمطور (Claude / agent context)

---

## حالة التنفيذ الموثقة — 2026-09-28

هذه لقطة تحقق بتاريخ 2026-09-28 وليست ضماناً دائماً للأرقام الحالية:

### إصلاحات المرحلة الأولى (P0) — الجلسة 2026-09-28

- **P0-A:** إزالة تسرب debug في `checkout/route.ts` و `orders/route.ts`. الإنتاج لم يعد يكشف رسائل pg constraint في الـ HTTP responses.
- **P0-B:** تشديد CI. `npm run lint || true` أُزيل؛ أصبح `tsc --noEmit` blocking.
- **P0-C:** سكريبت `scripts/migration-drift-report.ts` يكشف الـ drift في الـ schema (17 ملف غير مُتتبَع + 1 app_migrations).
- **P0-D:** اختبار `src/__tests__/stock-concurrency.test.ts` يتحقق من عدم وجود oversell وازدواج idempotency.
- **P0-E:** سكريبت `scripts/auth-isolation-audit.ts` يمشي 152 route بشكل static. 0 gaps، 26 OK، 126 Review (proxy.ts يغطيها وقت التشغيل).
- **P0-F:** migration 073 `payment_events` + helper `src/lib/payments/event-ledger.ts` + ربطه في `webhook/route.ts`. الـ replays تُلتقط فوراً.
- **إصلاحات smoke:** `next.config.mjs` يضيف 6 redirects (308) لـ `/login`، `/auth/register`، `/direct-order`. `npm run qa:smoke` الآن **0 إخفاقات** (كان 3).
- **البنية التحتية:** `docs/` المسحوب من PR #1 (15 ملف)، `docs/09` يوثّق الفجوات التشغيلية.

### الإحصائيات الحالية (2026-09-30)

- **اختبارات Vitest:** 1944 tests passing (1 skipped) — `npm test` على آخر commit في `refactor/full-repository-consolidation`.
- **smoke (`npm run qa:smoke`):** 0 إخفاقات (HTTP).
- **critical paths (`npm run qa:critical-paths`):** 8 passed, 2 skipped (لا توجد بيانات اختبار).
- **drift:** 17 ملف unapplied (16 pre-018 + migration 073 الجديدة)، 0 missing من المتوقع.
- **auth isolation:** 0 critical gaps، 26 OK، 126 Review.

### الفجوات التشغيلية المعروفة (مُوثَّقة في docs/09)

- ~~`src/proxy.ts` غير مُسجَّل في `.next/server/middleware-manifest.json`~~ — مُصلَح في Phase 7 (commit `72bbc46`): تم rename إلى `src/middleware.ts` + nodejs runtime + `functions-config-manifest.json` guard.
- `Dockerfile.worker` ليس مُختبراً في CI.
- ESLint config غير موجود؛ `lint` يستخدم `tsc --noEmit` كبديل.

---

## ✅ حالة الإصدار

### Web (this repo)

آخر حالة موثقة: **2026-09-28** (انظر القسم أعلاه).

### iOS app (`ios/`)

- **حالة التطوير:** Phase 6 (Production Hardening) **مكتملة** — 14/14
  مهمة أُنجزت. التفاصيل في [`ios/QA_REPORT.md`](./ios/QA_REPORT.md).
- **CI:** `.github/workflows/ios.yml` (build, test, lint, contract-smoke).
- **جاهزية الإصدار:** follow [`ios/RELEASE_READINESS.md`](./ios/RELEASE_READINESS.md)
  قبل أي رفع لـ TestFlight / App Store.
- **حالة Smoke:** `node scripts/ios-contract-smoke.mjs`
  يُبلّغ `Passed: 23 / Failed: 0` ضد production API.

---

## 📜 الرخصة

© 2026 City Markets. جميع الحقوق محفوظة.
