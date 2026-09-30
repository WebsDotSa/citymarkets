# دليل المساهمة — City Markets

دليل سريع للمطورين الذين يعملون على `city-market-app` (Next.js 16 + PostgreSQL).

> هذه الوثيقة جزء من المرحلة الأولى من [خطة الإصلاح الشاملة](./00-FULLSTACK-MASTER-PLAN.md).
> للإصدارات التفصيلية، راجع [iOS README](../ios/README.md).

---

## 1. الإعداد المحلي

### المتطلبات
- **Node.js 22** (نفس إصدار Docker و CI).
- **PostgreSQL 14+** (نستخدم Supabase pooler + self-hosted).
- **Redis 7** (اختياري — rate-limit يعمل بدونه لكن أبطأ).
- **Docker + Docker Compose** (للتشغيل الإنتاجي).

### الخطوات
```bash
# 1. استنساخ وتثبيت
git clone git@github.com:WebsDotSa/citymarkets.git
cd city-market-app
cp .env.local.example .env.local  # ثم املأ القيم الحقيقية
npm ci --legacy-peer-deps

# 2. تجهيز قاعدة البيانات
npm run db:migrate              # تطبيق migrations بالترتيب
npm run db:drift-report         # تحقق من سلامة الـ schema
npm run migration:diagnostics  # فحوصات حرجة

# 3. تشغيل
npm run dev                     # المنفذ 4040
npm run qa:smoke                # تأكد أن 0 إخفاقات
```

### متغيرات البيئة الحرجة
- `DATABASE_URL` أو `{DATABASE_HOST,PORT,NAME,USER,PASSWORD}` — مطلوب.
- `JWT_SECRET` — 32+ حرف عشوائي (تستخدمه Customer JWT).
- `ADMIN_JWT_SECRET` و `VENDOR_JWT_SECRET` — منفصلان عن customer.
- `MOYASAR_*` — للدفع.
- `TWILIO_*` — لـ OTP.
- `APPLE_REVIEW_*` — لحساب مراجعة Apple (اختياري في dev).

القائمة الكاملة في `.env.local.example` (111 سطر، مشروحة بالعربية).

---

## 2. بنية الكود

```
src/
├── app/                 # Next.js App Router
│   ├── (storefront)/   # واجهات المتجر العام
│   ├── admin/          # لوحة الإدارة (22 route)
│   ├── vendor/         # لوحة البائع (per-store)
│   ├── api/v1/         # REST API العمومي (30+ endpoint)
│   ├── api/admin/      # REST API الإدارة (50+ endpoint)
│   └── proxy.ts        # Next.js 16 proxy: CSRF + auth + CSP
├── components/         # React UI (~150 مكون)
├── lib/                # منطق المجال (~150 ملف)
│   ├── db/             # pg wrappers (typed.ts — ليس Drizzle)
│   ├── payments/       # Moyasar + Tamara adapters
│   ├── broadcasts/     # مركز الإشعارات
│   └── validation/     # مخططات Zod
├── hooks/              # 7 React hooks
├── contexts/           # Auth + Cart contexts
├── server/             # Server-only utilities
├── types/              # TypeScript types
└── __tests__/          # اختبارات الوحدة
migrations/             # 72+ ملف SQL مرقّم
scripts/                # أدوات CLI (migrate, smoke, audit, worker)
```

### قواعد معمارية صارمة
1. **UI لا تنفذ SQL خام**. كل استعلام يمر عبر `src/lib/db/` أو repositories متخصصة.
2. **التحقق من الصلاحيات دائماً على الخادم**. الواجهة (UI) للإخفاء فقط.
3. **معرّف العميل يأتي من الـ session**، أبداً من الـ body.
4. **التدفقات الكبيرة (checkout, payment) server-only**. لا client-side state.

---

## 3. الـ Workflow اليومي

### إضافة migration جديدة
```bash
# 1. أنشئ ملف جديد في migrations/ — الترقيم 3 أرقام (مثل 073_)
touch migrations/074_my_change.sql
# اكتب SQL داخله (CREATE TABLE / ALTER / CREATE INDEX)

# 2. تحقق أنه يُكتشف
npm run db:migrate:dry-run

# 3. اختبر محلياً
npm run db:migrate

# 4. تحقق من الـ drift
npm run db:drift-report
```

> ⚠️ الـ migration runner يتتبع الملفات من `018+` فقط في `app_migrations`. الـ migrations قبل ذلك تُسجَّل يدوياً أو تُعتبر "تاريخية".

### إضافة API endpoint جديد
1. أنشئ `src/app/api/v1/<resource>/route.ts`.
2. استخدم helpers من `@/lib/csrf` (`applyCsrfProtection`) و `@/lib/customer-session` (`getCustomerUserIdFromRequest`).
3. تحقق من تسجيل CSRF في `src/proxy.ts:CSRF_EXEMPT_PATHS` لو كانت جلسة bootstrap أو webhook.
4. أضف اختبار `route.test.ts` بجانب الـ route.
5. شغّل `npx tsx scripts/auth-isolation-audit.ts` — يجب أن يمر بدون gaps جديدة.

### إضافة vendor type جديد
```bash
# 1. حدّث CHECK في vendors.vendor_type (migration جديدة)
# 2. حدّث vendor-types enum في src/lib/vendor-types.ts
# 3. حدّث Arabic labels في نفس الملف
# 4. اختبر عبر /vendors/register
```

### إضافة route محمي بـ CSRF
```bash
# 1. في الـ route:
import { applyCsrfProtection } from '@/lib/csrf';
const csrfCheck = applyCsrfProtection(request);
if (csrfCheck) return csrfCheck;

# 2. لا تضف الـ route لـ CSRF_EXEMPT_PATHS إلا إذا كان:
#    - webhook (HMAC-auth)
#    - session-establishing (login/register)
#    - GET-only read-only
```

---

## 4. الاختبارات

```bash
npm test                  # ~1500 اختبار (vitest)
npm run test:coverage     # تغطية (target: src/lib ≥ 80%)
npm run qa:smoke          # HTTP routes + DB tables (cron 5m)
npm run qa:critical-paths # checkout + payment + cart E2E

# الفحوصات الثابتة الجديدة (2026-09-28):
npm run db:drift-report   # مقارنة schema/migrations
npx tsx scripts/auth-isolation-audit.ts  # static walk لكل routes
```

### فلسفة الاختبار
- **Source-level regressions** للـ routes المعقدة (الـ proxy، CSP، إلخ).
- **DB-level integration** عبر Vitest مع CI Postgres service.
- **HTTP-level E2E** عبر `qa:critical-paths.mjs` (يحتاج server شغّال).

---

## 5. Git Workflow

- **default branch:** `main` (محمي، يتطلب PR).
- **branch naming:** `feat/<scope>`, `fix/<scope>`, `chore/<scope>`.
- **commit format:** Conventional Commits (سيُفرض قريباً).
- **قبل الـ PR:** `npm test && npm run qa:smoke` محلياً.

---

## 6. CI

`.github/workflows/ci.yml` يشغّل على كل push/PR إلى `main`:
1. `npm ci --legacy-peer-deps`
2. `npx tsc --noEmit`
3. `npm run lint` (= `tsc --noEmit` — لا ESLint config حالياً)
4. `npm run db:migrate:dry-run`
5. `npm run test:coverage`
6. `npx tsx scripts/auth-isolation-audit.ts`
7. `npm run build`
8. حارس `middleware-manifest.json` (soft warning حالياً — Turbopack bug).

> ملاحظة: `Dockerfile.worker` ليس مُختبراً في CI. راجع [docs/09](./09-IMPLEMENTATION-BACKLOG.md) "Operational gaps".

---

## 7. الأداء والمراقبة

- **Sentry:** `@sentry/nextjs 10.67` مُفعَّل عبر `SENTRY_DSN`. تأكيد DSN قبل deploy.
- **Logs:** `process.env.CHECKOUT_ERROR_LOG` للـ checkout errors (افتراضي: `<cwd>/logs/checkout-errors.log`).
- **Rate limit:** Redis (اختياري) أو in-memory fallback. الـ presets في `src/lib/rate-limit.ts`.
- **Caching:** Next.js fetch cache + per-request nonces في `src/proxy.ts`.

---

## 8. ما يجب تجنبه

- ❌ لا تستخدم `supabase.auth.*` في كود الإنتاج — Supabase client موجود **للتوافق فقط** (R5 في audit).
- ❌ لا تضع `process.env.JWT_SECRET` مباشرة في الـ client — استخدم Server Components فقط.
- ❌ لا تستورد من `next/headers` في client components.
- ❌ لا تستخدم `Drizzle` — `drizzle-orm` dependency متبقّية لكن النظام يستخدم raw SQL عبر `src/lib/db/typed.ts`.
- ❌ لا تضع `dangerouslySetInnerHTML` على محتوى مدخل من المستخدم دون `sanitizeHtml` (F9).

---

## 9. المراجع

- [00-FULLSTACK-MASTER-PLAN.md](./00-FULLSTACK-MASTER-PLAN.md) — الخطة الكاملة.
- [06-DATABASE-MIGRATION-PLAN.md](./06-DATABASE-MIGRATION-PLAN.md) — استراتيجية الـ migrations.
- [07-AUTHORIZATION-MATRIX.md](./07-AUTHORIZATION-MATRIX.md) — من يملك ماذا.
- [08-QA-AND-RELEASE-GATES.md](./08-QA-AND-RELEASE-GATES.md) — بوابات الإصدار.
- [12-DUPLICATE-AND-LEGACY-REGISTER.md](./12-DUPLICATE-AND-LEGACY-REGISTER.md) — قائمة الـ duplicates والـ legacy.
