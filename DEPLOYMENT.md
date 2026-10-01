# دليل النشر — City Markets

دليل النشر للإنتاج: من البناء إلى المراقبة بعد الإطلاق.

> للخطط الاستراتيجية، راجع [00-FULLSTACK-MASTER-PLAN.md](./docs/00-FULLSTACK-MASTER-PLAN.md).
> للاستجابة للحوادث، راجع [docs/RUNBOOK.md](./docs/RUNBOOK.md).
> للمساهمة، راجع [docs/CONTRIB.md](./docs/CONTRIB.md).

---

## 1. البنية التحتية (Infrastructure)

### 1.1 المكوّنات
- **Application server:** `citymarket-app` (Next.js 16.2.11, port `3005`)
- **Background worker:** `citymarket-worker` (tsx + scripts/worker.ts)
- **Database:** PostgreSQL 14+ (self-hosted أو Supabase)
- **Redis:** (اختياري) للـ rate limiting + cache
- **Object Storage:** Cloudflare R2 (cdn.citymarkets.sa)
- **CDN:** Cloudflare في المقدمة
- **Reverse Proxy:** Nginx أو Cloudflare

### 1.2 متطلبات الخادم
- **CPU:** 4 cores (للـ Next.js + worker)
- **RAM:** 8 GB كحد أدنى (16 GB موصى به)
- **Disk:** 50 GB (DB + uploads)
- **OS:** Linux (يدعم `read_only` rootfs)
- **Docker:** 24+

---

## 2. الإعداد الأولي

### 2.1 تجهيز الخادم
```bash
# 1. ثبّت Docker + Compose
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# 2. أنشئ المستخدم والمجلدات
useradd -m -s /bin/bash deploy
mkdir -p /var/www/citymarkets.sa/city-market-app
chown -R deploy:deploy /var/www/citymarkets.sa

# 3. استنسخ الـ repo
sudo -u deploy git clone git@github.com:WebsDotSa/citymarkets.git /var/www/citymarkets.sa/city-market-app
cd /var/www/citymarkets.sa/city-market-app
```

### 2.2 متغيرات البيئة
```bash
# 1. انسخ القالب
cp .env.local.example .env.local
chmod 600 .env.local  # owner-only

# 2. املأ القيم الحقيقية (مطلوب):
#    DATABASE_URL — connection string كامل
#    JWT_SECRET, ADMIN_JWT_SECRET, VENDOR_JWT_SECRET — 32+ حرف كل واحد
#    MOYASAR_SECRET_KEY, MOYASAR_WEBHOOK_SECRET
#    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID
#    NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
#    SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN
#    APPLE_REVIEW_* (لمراجعة Apple)

# 3. للتحقق:
./scripts/check-env.sh  # (إن وُجد)
```

### 2.3 تجهيز قاعدة البيانات
```bash
# 1. إنشاء الـ database + user
sudo -u postgres psql <<'SQL'
CREATE USER citymarket_user WITH PASSWORD '...';
CREATE DATABASE citymarket_db OWNER citymarket_user;
GRANT ALL PRIVILEGES ON DATABASE citymarket_db TO citymarket_user;
SQL

# 2. تطبيق الـ migrations
npm ci --legacy-peer-deps
npm run db:migrate

# 3. تحقق
npm run db:drift-report
npm run migration:diagnostics
```

### 2.4 تجهيز Object Storage (R2)
```bash
# 1. أنشئ bucket في Cloudflare R2: citymarkets-prod
# 2. اربط custom domain: cdn.citymarkets.sa
# 3. أنشئ API token
# 4. ضع في .env.r2 (لا تشاركه):
cat > .env.r2 <<EOF
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=citymarkets-prod
EOF
chmod 600 .env.r2
```

---

## 3. البناء والنشر

### 3.1 البناء الأول
```bash
cd /var/www/citymarkets.sa/city-market-app
docker compose build citymarket-app
docker compose build citymarket-worker

# تحقق من الصور
docker images | grep citymarket
```

### 3.2 النشر
```bash
# 1. ابدأ الخدمات
docker compose up -d

# 2. راقب الـ startup
docker compose logs -f citymarket-app

# 3. تحقق من الصحة
curl -s http://localhost:3005/api/health
# المتوقع: {"status":"ok",...}

# 4. تحقق من الـ worker
docker logs --tail 50 citymarket-worker
# المتوقع: "Worker started, polling every Xm"

# 5. smoke test
npm run qa:smoke
```

### 3.3 النشر المتواصل (CI/CD)

ننشر عبر GitHub Actions إلى staging تلقائياً، والإنتاج يدوياً:

```yaml
# .github/workflows/deploy.yml (موجود في بعض التكوينات)
on:
  push:
    branches: [main]
jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build images
        run: docker compose build
      - name: Push to registry
        run: docker compose push
      - name: Deploy to staging
        run: ./scripts/deploy-staging.sh
```

---

## 4. Nginx Reverse Proxy

### 4.1 الإعداد
```nginx
# /etc/nginx/sites-available/citymarkets.sa
upstream citymarket_app {
    server 127.0.0.1:3005;
    keepalive 64;
}

server {
    listen 443 ssl http2;
    server_name citymarkets.sa www.citymarkets.sa;

    ssl_certificate /etc/letsencrypt/live/citymarkets.sa/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/citymarkets.sa/privkey.pem;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    # الملفات الثابتة — Next.js يخدمها
    location /_next/static {
        proxy_pass http://citymarket_app;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        proxy_pass http://citymarket_app;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

### 4.2 SSL مع Let's Encrypt
```bash
sudo certbot --nginx -d citymarkets.sa -d www.citymarkets.sa
```

---

## 5. المراقبة (Monitoring)

### 5.1 Sentry
- **DSN:** `process.env.SENTRY_DSN`
- **Traces sample rate:** `SENTRY_TRACES_SAMPLE_RATE` (افتراضي: 0.1)
- **المصادر الحرجة:** checkout, payment webhook, broadcast worker, OTP verify.

### 5.2 Health Check Endpoint
```bash
curl -s http://localhost:3005/api/health | jq
# { "status": "ok", "db": "ok", "redis": "ok", "uptime": 12345 }
```

### 5.3 Uptime Monitoring
نوصي بإعداد external pinger:
- [UptimeRobot](https://uptimerobot.com/)
- [BetterStack](https://betterstack.com/)
- [Pingdom](https://www.pingdom.com/)

راقب:
- `https://citymarkets.sa/api/health` (كل دقيقة)
- `https://citymarkets.sa/` (كل 5 دقائق)

### 5.4 السجلات (Logs)
- **stdout containers:** `docker logs citymarket-app` → Sentry تلقائياً.
- **checkout errors:** `process.env.CHECKOUT_ERROR_LOG` → ملف.

### 5.5 التنبيهات (Alerts)
- Sentry → Slack/Email للأخطاء الجديدة (افتراضي).
- UptimeRobot → Email/SMS عند downtime.
- يدوي: راجع `payment_events` يومياً للـ `status='failed'`.

---

## 6. الأداء (Performance)

### 6.1 قبل الإطلاق
- [ ] شغّل Lighthouse على الصفحات الرئيسية (target ≥ 90).
- [ ] تحقق من أن `next.config.mjs` الصور مفعّلة AVIF/WebP.
- [ ] فعّل Cloudflare caching للملفات الثابتة.

### 6.2 بعد الإطلاق
- [ ] راقب `time-to-first-byte` (TTFB) — target < 200ms.
- [ ] راجع Sentry → Performance → Slow transactions.
- [ ] تحقق من `vendor_products.stock_quantity` race conditions عبر load test.

### 6.3 Caching Strategy
- **Server-side:** Redis (إن وُجد) أو in-memory Map.
- **HTTP:** Next.js fetch cache + CDN caching.
- **Client-side:** SWR/React Query للـ data fetching (حيث ينطبق).

---

## 7. الأمان (Security)

### 7.1 Hardening Checklist
- [x] Non-root container user (`1001:1001`).
- [x] `read_only` rootfs مع tmpfs mounts.
- [x] `cap_drop: ALL`.
- [x] `security_opt: no-new-privileges`.
- [x] CSP nonce per-request (`src/proxy.ts`).
- [x] HSTS + X-Frame-Options + Permissions-Policy.
- [x] Triple-secret JWT (customer/admin/vendor).
- [x] CSRF double-submit cookie.
- [x] HMAC verification على webhooks.

### 7.2 Secrets Rotation (كل 90 يوم)
```bash
# JWT secrets
NEW_JWT=$(openssl rand -base64 48)
# حدِّث في .env.local، أعد deploy.

# Database password
NEW_DB_PW=$(openssl rand -base64 32)
# حدِّث في .env.local وفي DB نفسها:
sed -i "s|^DATABASE_PASSWORD=.*|DATABASE_PASSWORD=$NEW_DB_PW|" .env.local
./scripts/sync-db-password.sh   # يطبّق التغيير على Postgres بدون لمس الـ schema
docker compose restart citymarket-app

# ملاحظة: بعد أي `docker compose up` على نسخة جديدة، شغّل
# ./scripts/sync-db-password.sh مرة واحدة للتأكد أن الـ role
# password في Postgres يطابق DATABASE_PASSWORD في الـ env.
# migration 105_grants_rls_and_bypass_for_citymarket_user.sql
# يضمن أن الـ grants والـ RLS state ثابتة بين الـ deploys.

# API tokens
# Moyasar, Twilio, Supabase — عبر dashboardsهم.
```

### 7.3 Vulnerability Scanning
```bash
npm audit --json  # الـ deps
docker scan citymarket-app  # الـ container
```

---

## 8. خطة التراجع (Rollback Plan)

راجع [docs/RUNBOOK.md](./docs/RUNBOOK.md) §3 للتفاصيل الكاملة.

### 8.1 التراجع السريع (أقل من 5 دقائق)
```bash
cd /var/www/citymarkets.sa/city-market-app
git log --oneline -5  # اعرف الـ commit السابق الجيد
git checkout <previous-good-commit>
docker compose build citymarket-app
docker compose up -d citymarket-app
curl http://localhost:3005/api/health
```

### 8.2 متى تتراجع
- downtime > 5 دقائق بدون سبب معروف.
- أكثر من 5% من الطلبات ترجع 5xx.
- فقدان بيانات مؤكد.
- ثغرة أمنية جديدة مكتشفة.

---

## 9. Checklist للإطلاق

### قبل الإطلاق (T-24h)
- [ ] نسخة احتياطية كاملة من DB (تم اختبار الاستعادة).
- [ ] كل الاختبارات تمر محلياً (1491+ passed).
- [ ] `npm run qa:critical-paths` يمر.
- [ ] `npm run db:drift-report` نظيف أو مُوثَّق.
- [ ] Sentry يستقبل events من staging.
- [ ] Twilio Verify تم اختباره مع رقم سعودي.
- [ ] Moyasar webhook تم اختباره end-to-end.

### يوم الإطلاق (T-0)
- [ ] Deploy إلى production.
- [ ] Health check returns 200.
- [ ] smoke test على production domain.
- [ ] طلب تجريبي كامل (ضيف → بائع → بائع يفّعل → driver → delivered).
- [ ] مراقبة Sentry للأخطاء الأولى.

### بعد الإطلاق (T+1h, T+24h, T+7d)
- [ ] T+1h: لا أخطاء حرجة في Sentry.
- [ ] T+24h: metrics طبيعية (طلبات/دقيقة، conversion rate).
- [ ] T+7d: لا drift في الـ DB، لا شكاوى متكررة.

---

## 10. جهات الاتصال عند الطوارئ

راجع [docs/RUNBOOK.md](./docs/RUNBOOK.md) §7.
