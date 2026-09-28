# scripts/

أدوات صيانة، migrations، واختبارات للمشروع. التصنيف يوضح: متى يُستخدم كل سكريبت، وما يحتاجه (Docker/DB/env vars).

> **ملاحظة:** الإنتاج يشتغل داخل Docker (memory: `production_runs_in_docker_not_pm2`). الـ `start.sh` يبقى للتشغيل المحلي فقط.

## التشغيل المحلي

```bash
# جميع السكربتات تفترض .env.local في جذر المشروع
cd /var/www/citymarkets.sa/city-market-app
node scripts/<name>.mjs
```

---

## 📁 Cron — مجدول على الـ host

تُسجَّل في crontab الـ root أو `/etc/cron.d/`. الملف `.cron` يحتوي على السطر الجاهز.

| السكريبت | المجدول | يفعل |
|---|---|---|
| [`backup.cron`](backup.cron) → [`backup_db.sh`](backup_db.sh) | يومياً 03:00 | نسخ احتياطي لـ Postgres |
| [`logrotate.cron`](logrotate.cron) → [`rotate_logs.py`](rotate_logs.py) | يومياً 02:00 | تدوير `server.log` + gzip للقدامى |
| [`qa-smoke.sh`](qa-smoke.sh) → [`qa-smoke.mjs`](qa-smoke.mjs) | كل 5 دقائق | فحص سريع للـ DB + routes |

التثبيت:

```bash
sudo cp scripts/backup.cron   /etc/cron.d/citymarket-backup
sudo cp scripts/logrotate.cron /etc/cron.d/citymarket-logrotate
# qa-smoke يُضاف لـ crontab الـ root مباشرة (يحتاج .env.local)
```

---

## 🛠️ One-shot setup — يُنفَّذ مرة واحدة

| السكريبت | الهدف |
|---|---|
| [`backup-images.sh`](backup-images.sh) | نقل `public/images/` إلى `/var/lib/citymarket-images/` وإنشاء symlink (يحمي الصور من `git clean`) |
| [`install-apple-pay-domain.sh`](install-apple-pay-domain.sh) | وضع `apple-developer-merchantid-domain-association` في `public/.well-known/` لـ Apple Pay |
| [`start.sh`](start.sh) | entry قديم لـ PM2 — **لم يعد يُستخدم** في الإنتاج (Docker فقط) |

---

## 🗄️ Database / Migrations

| السكريبت | الهدف |
|---|---|
| [`migrate.ts`](migrate.ts) | الـ runner الرئيسي: يقرأ `migrations/*.sql` بالترتيب ويسجّل في `app_migrations`. **شغّله بعد كل deploy لتغييرات schema** |
| [`migration-diagnostics.ts`](migration-diagnostics.ts) | فحوصات أمان بعد الـ runner: يتحقق من migrations حرجة (018+ tracking gap، 046 loyalty index، 054 FK blocker) |
| [`dry-run-042.mjs`](dry-run-042.mjs) | dry-run صِرف لـ migration 042 (إعادة ترتيب categories). SELECT فقط، لا يكتب |
| [`backfill-category-images.sql`](backfill-category-images.sql) | تعبئة صور الـ categories بعد تطبيق 043 |
| [`grant-products-write.sh`](grant-products-write.sh) | **طوارئ فقط:** rollback لـ Slice 4 إذا ظهر regression على `products` table. يتطلب postgres superuser |

⚠️ الـ migration runner يتصل كـ `citymarket_user` (BYPASSRLS، ليس owner). للـ ALTER/DROP على legacy tables شغّلها كـ postgres ثم سجّلها يدوياً في `app_migrations` (memory: `migration_runner_postgres_override`).

---

## 🔧 Admin / Utility

| السكريبت | الهدف |
|---|---|
| [`reset-admin-password.ts`](reset-admin-password.ts) | تعيين/إعادة تعيين كلمة مرور `super_admin`. bcrypt فقط، لا يطبع الباسورد |
| [`audit-csrf-coverage.ts`](audit-csrf-coverage.ts) | فحص static لكل route تحت `src/app/api/**/route.ts` — يتأكد من وجود CSRF guard |
| [`pick-category-images.mjs`](pick-category-images.mjs) | اختيار صورة ممثلة لكل category (scoring: تطابق الاسم + stock + local file) |
| [`sitemap-count.mjs`](sitemap-count.mjs) | عدّ URLs في `/sitemap.xml` (يتطلب DB) |
| [`diag-zones.js`](diag-zones.js) | تشخيص delivery zones (lat/lng → zone mapping) |
| [`worker.ts`](worker.ts) | background worker للـ scheduled tasks (push، broadcasts). **PM2 أو `tsx` يدوي** |

---

## 🧪 E2E / Smoke tests

كل السكربتات هنا **تنفّذ HTTP حقيقي** ضد BASE_URL. معظمها يتخطى نفسه إذا كانت DB غير متاحة.

### Customer / Public

| السكريبت | يختبر |
|---|---|
| [`e2e-customer-payment.mjs`](e2e-customer-payment.mjs) | تسجيل دخول + سلة + checkout + payment_url + orders list |
| [`test-checkout-payments.mjs`](test-checkout-payments.mjs) | checkout مع 3 وسائل دفع (mada, cash, tamara) |
| [`e2e-checkout-slice3-fanout.mjs`](e2e-checkout-slice3-fanout.mjs) | **Slice 3:** يثبت أن checkout mixed cart يُنشئ parent + N children، وأن fan-out من الـ webhook يحدّثهم بنفس الـ status (regression-safe) |
| [`quick-test.mjs`](quick-test.mjs) | sanity check سريع بعد deploy |
| [`qa-smoke.mjs`](qa-smoke.mjs) | DB connectivity + schema tables + routes (anonymous) |
| [`qa-critical-paths.mjs`](qa-critical-paths.mjs) | integration لـ high-risk endpoints: coupon، delivery quote، cart، catalog، CSRF |

### iOS contract

| السكريبت | يختبر |
|---|---|
| [`ios-auth-smoke.mjs`](ios-auth-smoke.mjs) | CSRF + 401 على protected routes + login form + `/auth/csrf` |
| [`ios-contract-smoke.mjs`](ios-contract-smoke.mjs) | تطابق JSON shapes مع iOS client (snake_case، `{success,data}` envelopes) |

### Admin

| السكريبت | يختبر |
|---|---|
| [`e2e-admin-vendors.sh`](e2e-admin-vendors.sh) → [`e2e-admin-vendors.mjs`](e2e-admin-vendors.mjs) | round-trip كامل: POST vendor بـ logo_url → GET admin list → render storefront |
| [`smoke-admin-pages.mjs`](smoke-admin-pages.mjs) | جميع صفحات `/admin/*` + APIs المقابلة |
| [`smoke-admin-products.mjs`](smoke-admin-products.mjs) | CRUD كامل على `/api/admin/products` + bulk endpoints (Slice 4 scope) |

### متطلبات شائعة للـ E2E

```bash
# تشغيل قبل سكربتات الـ admin
ADMIN_EMAIL=admin@citymarkets.sa ADMIN_PASSWORD=xxx node scripts/...
```

سكربتات الـ iOS contract آمنة ضد staging/production (تعمل ضد `/api/v1` فقط بدون DB writes). الباقي يتطلب بيئة dev مع DB مهيأة.

---

## 🧹 Cleanup

| السكريبت | الهدف |
|---|---|
| [`citymarket-logrotate`](citymarket-logrotate) | config لـ logrotate (alternative لـ `rotate_logs.py` cron) |

---

## 📋 إضافة سكريبت جديد

1. اختر التصنيف المناسب (cron / setup / db / admin / e2e).
2. اجعل السكريبت يتخطى نفسه إذا كانت DB غير متاحة (نمط: `try { pool.query } catch { skip }`).
3. احذف أي state عند الانتهاء — لا تترك orders أو addresses تجريبية في الـ DB.
4. حدّث هذا الـ README.
