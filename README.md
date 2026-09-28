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
├── migrations/                # SQL migrations (001-046)
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

- [دليل النشر](./DEPLOYMENT.md) - إعداد ونشر الإنتاج
- [دليل المساهمة](./docs/CONTRIB.md) - التطوير، السكربتات، البيئة، الاختبارات، والترحيلات
- [دليل التشغيل](./docs/RUNBOOK.md) - المراقبة، الأعطال الشائعة، والتراجع

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

## حالة التنفيذ الموثقة — 2026-07-29

هذه لقطة تحقق بتاريخ 2026-07-29 وليست ضماناً دائماً للأرقام الحالية:

- اكتملت خمسة تغييرات مترابطة: `1c8b9dc` لمشغل الترحيلات وإصلاح SQL، و`45d53d4` لعقد `proxy.ts` ومسارات البائع، و`ecbcf9d` لاختبارات V2، و`a63fb47` للبنية التحتية، و`bb16129` لإزالة مكونات الصفحة الرئيسية اليتيمة.
- عولجت ستة أسباب جذرية: تمرير `x-pathname` في جهة الاستجابة بدلاً من الطلب، ظهور واجهة العميل في `/vendor`، خطأ UUID في الترحيل 003، أخطاء السياسة والعمود في الترحيل 021، عدم تطابق منفذ healthcheck، وغياب `VENDOR_JWT_SECRET` من إعدادات الحاوية.
- أضيف CI للفحص النوعي وخطة الترحيلات والاختبارات مع التغطية والبناء، مع Dockerfile متعدد المراحل يعمل كمستخدم غير root وCompose على المنفذ `3005`.
- نجحت 202/202 حالة اختبار ضمن 19 ملف اختبار. اختبارات مكونات V2 الحالية اختبارات عقد على مستوى المصدر لعدم توفر jsdom وTesting Library.
- اكتشف مشغل الترحيلات 32/32 ملفاً متتبعاً في قاعدة الإنتاج. تضمنت اللقطة ترحيلات مسجلة يدوياً و15 تحذير drift تحتاج مراجعة؛ لذلك «متتبع» لا يعني أن SQL الحالي نُفذ بواسطة المشغل.
- التفاصيل التشغيلية والقيود وإجراءات التراجع موثقة في [دليل التشغيل](./docs/RUNBOOK.md).

---

## ✅ حالة الإصدار

### Web (this repo)

آخر حالة موثقة: **2026-07-29** (انظر القسم أدناه).

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
