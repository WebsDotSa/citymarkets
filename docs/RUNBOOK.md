# دليل التشغيل — City Markets

دليل الاستجابة للحوادث، استكشاف الأخطاء، وإجراءات التراجع.

> للخطط الاستراتيجية والتغييرات المعمارية، راجع [00-FULLSTACK-MASTER-PLAN.md](./00-FULLSTACK-MASTER-PLAN.md).

---

## 1. الفحوصات السريعة (5 دقائق)

```bash
# صحة التطبيق
curl -s http://localhost:3005/api/health | jq

# آخر سطور من الـ logs
tail -50 /var/log/citymarket/app.log

# حالة الـ worker
docker ps | grep citymarket-worker
docker logs --tail 50 citymarket-worker

# حالة DB
psql "$DATABASE_URL" -c "SELECT now(), version();"

# حالة Redis (إن وُجد)
redis-cli ping
```

---

## 2. حالات الطوارئ الشائعة

### 2.1 "الطلبات لا تكتمل" — checkout/route.ts يعرض 500

**الأعراض:**
- `npm run qa:smoke` يفشل في `checkout`
- `server.log` يعرض `payment_status=pending` بكثرة
- دعم العملاء يشتكي من "خطأ في إنشاء الطلب"

**التشخيص:**
```bash
# 1. تحقق من آخر أخطاء
tail -100 /tmp/checkout-errors.log 2>/dev/null
# أو
docker exec citymarket-app cat /tmp/checkout-errors.log | tail -50

# 2. تحقق من السجلات في DB
psql "$DATABASE_URL" -c "SELECT pg_code, pg_message, COUNT(*) FROM logs.checkout_errors WHERE created_at > NOW() - INTERVAL '1 hour' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10;"

# 3. تحقق من الـ migration drift
npm run db:drift-report
npm run migration:diagnostics
```

**الإصلاح المعتاد:**
- إذا ظهر `uq_orders_idempotency_key`: العميل أرسل نفس الطلب مرتين — لا حاجة لتدخل (الـ system يعالجه).
- إذا ظهر `foreign key violation`: الـ catalog drift. شغّل `npm run db:migrate` وتأكد من تطبيق migration `072`.
- إذا ظهر `connection refused`: الـ DB pooler مشغول. أعد تشغيل `citymarket-app`.

### 2.2 "OTP لا يصل" — Twilio Verify يفشل

**الأعراض:**
- المستخدم يدخل رقمه ولا يصل رمز.
- `worker.log` يعرض `Twilio Verify send failed`.

**التشخيص:**
```bash
# 1. تحقق من إعدادات Twilio
curl -s http://localhost:3005/api/admin/twilio/status -H "Cookie: admin_session=..."

# 2. تحقق من الأرصدة
# راجع https://console.twilio.com/usage

# 3. تحقق من rate limiting
redis-cli GET "ratelimit:otp:05XXXXXXXX"
```

**الإصلاح:**
- إذا كان Twilio rate-limited: انتظر 5 دقائق أو ارفع الـ service tier.
- إذا كان `TWILIO_VERIFY_SERVICE_SID` خاطئ: حدِّث `.env.local` وأعد التشغيل.
- إذا كان "رقم غير مدعوم في السعودية": غيّر الـ Verify service إلى Saudi Arabia-enabled.

### 2.3 "البث (broadcast) لا يصل"

**الأعراض:**
- الإشعارات تُسجَّل في `broadcasts` لكن `broadcast_deliveries.status` يبقى `pending`.

**التشخيص:**
```bash
# 1. تحقق من الـ worker
docker logs --tail 100 citymarket-worker | grep -E "broadcast|dispatch"

# 2. تحقق من Web Push (VAPID)
curl -s http://localhost:3005/api/admin/broadcast-providers/status -H "Cookie: admin_session=..."

# 3. تحقق من APNs
# راجع Sentry → citymarket-worker → APNs errors
```

**الإصلاح:**
- إذا كان VAPID keys غير صالحة: ولّد keys جديدة وأعد deploy.
- إذا كان `worker.ts` متوقف: `docker restart citymarket-worker`.
- إذا كان OneSignal quota: قلل الإرسال أو ارفع الخطة.

### 2.4 "Webhooks من Moyasar تفشل"

**الأعراض:**
- الطلبات تبقى `pending` بعد الدفع.
- `payment_events` (migration 073) يعرض events بـ `status='received'` بدون `processed`.

**التشخيص:**
```bash
# 1. تحقق من payment_events
psql "$DATABASE_URL" -c "SELECT gateway, event_type, status, received_at, processed_at, order_id FROM payment_events WHERE received_at > NOW() - INTERVAL '1 hour' ORDER BY received_at DESC LIMIT 20;"

# 2. تحقق من Moyasar dashboard
# https://dashboard.moyasar.com/webhooks

# 3. تحقق من server.log
grep -i "webhook" /var/log/citymarket/app.log | tail -30
```

**الإصلاح:**
- إذا كان `MOYASAR_WEBHOOK_SECRET` تغيَّر: حدِّثه في Moyasar dashboard و `.env.local`.
- إذا كان `payment_events` فيه duplicates: الـ system يعمل بشكل صحيح — استجابة idempotent.
- إذا كان webhook يفشل في التحقق من الـ HMAC: تحقق من `x-webhook-secret` header.

---

## 3. التراجع (Rollback)

### 3.1 تراجع migration

> ⚠️ القاعدة الذهبية: **لا تتراجع destructive migrations بدون نسخة احتياطية محققة**.

```bash
# 1. نسخة احتياطية فورية
pg_dump "$DATABASE_URL" > /var/backups/citymarket/pre-rollback-$(date +%Y%m%d-%H%M%S).sql

# 2. تراجع migration (dry-run أولاً)
npm run db:migrate -- --mark-applied  # لتسجيل ملف موجود مسبقاً
# أو للتراجع الفعلي (مدمّر):
psql "$DATABASE_URL" -f migrations/<previous_known_good>.sql

# 3. تحقق
npm run db:drift-report
npm run migration:diagnostics
```

### 3.2 تراجع deploy

```bash
# التراجع إلى الـ tag السابق
cd /var/www/citymarkets.sa/city-market-app
git fetch origin
git checkout v1.2.3  # أو commit hash

# إعادة build
docker compose build citymarket-app
docker compose up -d citymarket-app

# تحقق
curl -s http://localhost:3005/api/health
docker logs --tail 30 citymarket-app
```

### 3.3 التراجع الجزئي — feature flag

معظم الـ features خلف متغيرات بيئة. لتعطيل ميزة بدون redeploy:
```bash
# في .env.local:
DISABLE_BROADCASTS=1         # لا ترسل إشعارات
ALLOW_INSECURE_WEBHOOK=1     # webhook بدون HMAC (dev فقط!)
HIDE_CHECKOUT_DEBUG=1        # أخفِ رسائل debug حتى في dev
DEBUG_CHECKOUT=1             # أظهِرها حتى في production

# ثم أعد تشغيل الـ container:
docker compose restart citymarket-app
```

---

## 4. الصيانة الدورية

### يومياً
- [ ] فحص `npm run qa:smoke` (cron 5min).
- [ ] فحص Sentry للـ errors الجديدة.
- [ ] فحص `citymarket-worker` (يجب أن يكون up).

### أسبوعياً
- [ ] مراجعة `payment_events` حيث `status='failed'` (disputes).
- [ ] مراجعة `order_status_logs` للتحولات غير المتوقعة.
- [ ] `npm run db:drift-report` وتوثيق أي drift جديد.

### شهرياً
- [ ] تدوير `MOYASAR_SECRET_KEY` و `TWILIO_AUTH_TOKEN`.
- [ ] مراجعة driver backfill (`drivers.admin_user_id`).
- [ ] تشغيل `npm run test:coverage` ومراجعة التراجع في التغطية.

---

## 5. السجلات (Logging)

### أين تجد الـ logs
- **stdout container:** `docker logs citymarket-app` — Sentry + info logs.
- **checkout-errors.log:** `process.env.CHECKOUT_ERROR_LOG` (افتراضي: `<cwd>/logs/checkout-errors.log`).
- **worker stdout:** `docker logs citymarket-worker` — OTP cleanup + broadcasts + coupon expiry.
- **Postgres logs:** `pg_log` في الـ container (إن وُجد).

### تنسيق السجلات
كل سطر JSON مهيكل:
```json
{
  "ts": "2026-09-28T20:00:00.000Z",
  "level": "error",
  "context": "checkout",
  "userId": "uuid",
  "idempotencyKey": "...",
  "errorName": "PgError",
  "pgCode": "23505",
  "pgMessage": "duplicate key value violates unique constraint",
  "stack": "..."
}
```

---

## 6. النسخ الاحتياطية

### قاعدة البيانات
```bash
# يومياً 03:00 (cron) — السكربت في scripts/backup_db.sh
0 3 * * * /var/www/citymarkets.sa/city-market-app/scripts/backup_db.sh

# الاستعادة
psql "$DATABASE_URL" < /var/backups/citymarket/db-2026-09-28.sql
```

### الصور
- الرفع الجديد يذهب إلى `public/images/products/` (مربوط بـ Docker volume).
- النسخ الاحتياطي في `scripts/backup-images.sh` (يومية، تحفظ خارج الـ repo).

### استعادة كاملة
1. أوقف التطبيق: `docker compose stop citymarket-app citymarket-worker`.
2. استعد DB: `psql ... < backup.sql`.
3. استعد الصور: `rsync -av /var/backups/images/ /var/www/citymarkets.sa/city-market-app/public/images/`.
4. أعد التشغيل: `docker compose up -d`.
5. تحقق: `curl http://localhost:3005/api/health` + `npm run qa:smoke`.

---

## 7. جهات الاتصال

| الدور | المسؤول | الـ escalation |
|------|---------|--------------|
| DBAs | فريق البنية | pg_dump restore failures |
| Payments | فريق المالية | disputes + Moyasar/Tamara outages |
| iOS | فريق الموبايل | TestFlight rejections |
| DevOps | فريق البنية | container/orchestration issues |
| Security | CISO | vulnerability disclosures |

---

## 8. Post-mortem Checklist

عند كل حادثة P0/P1:
1. **احفظ الـ logs فوراً** (Sentry link + raw logs).
2. **اكتب timeline** (UTC) — كل action، كل alert، كل deploy.
3. **حدد root cause** (5 whys).
4. **حدد contributing factors** (deployment gap, monitoring gap, etc.).
5. **اكتب action items** مع owners وdue dates.
6. **شارك في الـ standup التالي**.
7. **حدِّث هذا الـ runbook** بالـ learnings.
