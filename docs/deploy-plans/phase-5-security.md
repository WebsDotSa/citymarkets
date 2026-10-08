# citymarkets.sa — Phase 5 Security Deploy Plan

> **Status**: Pending execution. Site is live at https://citymarkets.sa/. main branch has all 5 phases merged (49 commits). Container `city-market-app-citymarket-app-1` runs old code without the security fixes.
>
> **Effort**: 2–3 hours end-to-end. Production customers are live — every step is reversible until the final smoke test.

---

## Prereqs (gather before starting)

- [ ] Moyasar webhook signing secret (from https://dashboard.moyasar.com/ → Settings → Webhooks)
- [ ] TAMARA_API_KEY (from https://dashboard.tamara.co/ → API)
- [ ] TAMARA_WEBHOOK_SECRET (from https://dashboard.tamara.co/ → Webhooks)
- [ ] SSH access to `srv2009643` (this host)
- [ ] Backup disk ≥ 2× DB size at `/var/backups/`
- [ ] Confirm business hours — best window is low traffic (midnight Saudi)

---

## Step 0 — Pre-deploy backups (10 min)

```bash
# DB backup
sudo -u postgres pg_dump citymarket_db \
  | gzip > /var/backups/citymarket-pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz
ls -la /var/backups/citymarket-pre-deploy-*.sql.gz | tail -1
# Expect: ~500MB–2GB gzip

# Container snapshot
docker commit city-market-app-citymarket-app-1 citymarkets:pre-deploy-snapshot
docker images | grep pre-deploy

# Capture running config
cd /var/www/citymarkets.sa/city-market-app
git rev-parse HEAD > /tmp/pre-deploy-commit.txt
docker exec city-market-app-citymarket-app-1 printenv \
  | grep -E "^[A-Z_]+=" | sort > /tmp/pre-deploy-env.txt
```

**Stop here if any backup fails.**

---

## Step 1 — Generate PII envelope keys (2 min)

```bash
cd /var/www/citymarkets.sa/city-market-app

# Generate KEK (master key, wraps the DEK)
KEK=$(openssl rand -base64 32)
echo "PII_MASTER_KEY=$KEK"

# Generate DEK wrapped by KEK
export PII_MASTER_KEY="$KEK"
npx tsx scripts/generate-pii-dek.ts
# Output:
#   DEK (base64): <random 32 bytes>
#   Wrapped DEK:  <40 bytes base64>  ← PII_DATA_KEY
#   KEK fingerprint: <16 hex chars>
```

**Save to a temporary secure location (NOT in the repo):**

```bash
mkdir -p /root/.citymarket-keys
cat > /root/.citymarket-keys/pre-deploy.env <<EOF
PII_MASTER_KEY=$KEK
PII_DATA_KEY=<from script output>
KEK_FINGERPRINT=<from script output>
EOF
chmod 600 /root/.citymarket-keys/pre-deploy.env
```

---

## Step 2 — Add new vars to `.env.local` (5 min)

```bash
cd /var/www/citymarkets.sa/city-market-app

# Append without overwriting the existing recovery file
cat >> .env.local <<EOF

# ─── Phase 5 envelope encryption ───
REDIS_URL=redis://citymarket-redis:6379
PII_MASTER_KEY=$KEK
PII_DATA_KEY=<from step 1>
PII_KEY_VERSION=1
EOF

# Also fill the webhook placeholders with the dashboard values
nano .env.local
# Replace:
#   MOYASAR_WEBHOOK_SECRET=*** ← real value
#   TAMARA_API_KEY=*** ← real value
#   TAMARA_WEBHOOK_SECRET=*** ← real value
```

**Verify the file is still parseable:**

```bash
docker compose config > /dev/null && echo "OK" || echo "PARSE FAIL"
```

---

## Step 3 — DB migrations (5 min)

```bash
cd /var/www/citymarkets.sa/city-market-app

# Apply pending migrations (119 cleanup, 121, 122, 123)
docker exec city-market-app-citymarket-app-1 npx tsx scripts/migrate.ts up 2>&1 | tail -30

# Verify
docker exec city-market-app-citymarket-app-1 psql citymarket_database -c \
  "SELECT name FROM app_migrations ORDER BY id DESC LIMIT 5"
# Expect: 123_pii_envelope_keys, 122_jwt_secret_versioning_cleanup, 121_pii_encryption_columns, 119_jwt_secret_versioning
```

**Stop if any migration fails. Run `npx tsx scripts/migrate.ts down` to roll back, or restore from the backup.**

---

## Step 4 — Backfill PII (depends on row count, 30 min – 2 h)

```bash
cd /var/www/citymarkets.sa/city-market-app

# Dry-run first
docker exec -e PII_MASTER_KEY="$KEK" -e PII_DATA_KEY="<from step 1>" \
  city-market-app-citymarket-app-1 npx tsx scripts/backfill-pii-encryption.ts --dry-run 2>&1 | tail -20

# Count rows that would be touched
docker exec city-market-app-citymarket-app-1 psql citymarket_database -c \
  "SELECT
     (SELECT COUNT(*) FROM users WHERE phone IS NOT NULL AND phone_encrypted IS NULL) AS users_todo,
     (SELECT COUNT(*) FROM drivers WHERE phone IS NOT NULL AND phone_encrypted IS NULL) AS drivers_todo,
     (SELECT COUNT(*) FROM addresses WHERE address_text IS NOT NULL AND address_text_encrypted IS NULL) AS addresses_todo"

# Apply in batches
docker exec -e PII_MASTER_KEY="$KEK" -e PII_DATA_KEY="<from step 1>" \
  city-market-app-citymarket-app-1 npx tsx scripts/backfill-pii-encryption.ts --apply --batch-size 500

# Verify zero pending
docker exec city-market-app-citymarket-app-1 psql citymarket_database -c \
  "SELECT COUNT(*) FROM users WHERE phone IS NOT NULL AND phone_encrypted IS NULL"
# Expect: 0
```

**This is irreversible. Stop if errors. Re-run from a fresh backup if needed.**

---

## Step 5 — Rebuild + restart (15 min)

```bash
cd /var/www/citymarkets.sa/city-market-app

# Build new image with the merged Phase 0–5 code
docker compose build citymarket-app 2>&1 | tail -10

# Stop old container gracefully
docker compose stop citymarket-app
docker compose rm -f citymarket-app

# Start with new image + same env_file
docker compose up -d citymarket-app

# Wait for healthcheck
sleep 15
docker compose ps citymarket-app
# Expect: Up (healthy)
```

---

## Step 6 — Smoke tests (10 min)

```bash
echo "=== Health ==="
curl -s -o /dev/null -w "%{http_code}\n" https://citymarkets.sa/api/health

echo "=== CSRF (new endpoint from Phase 5) ==="
curl -s https://citymarkets.sa/api/v1/auth/csrf | head -c 200
echo ""

echo "=== Logo (regression check) ==="
curl -s -o /dev/null -w "%{http_code}\n" https://citymarkets.sa/images/city-markets-logo.png

echo "=== Catalog page ==="
curl -s -o /dev/null -w "%{http_code}\n" https://citymarkets.sa/catalog

echo "=== Login flow (verify PII decryption works) ==="
# Send OTP, log in, check that the user object has decrypted phone
PHONE="+966500000000"
curl -s -X POST https://citymarkets.sa/api/v1/auth/twilio/send-otp \
  -H "Content-Type: application/json" -d "{\"phone\":\"$PHONE\"}"
# Get OTP from Twilio console, then:
curl -s -X POST https://citymarkets.sa/api/v1/auth/twilio/verify \
  -H "Content-Type: application/json" -d "{\"phone\":\"$PHONE\",\"code\":\"<otp>\"}" | head -c 400
echo ""

echo "=== Admin audit (fire-and-forget, just trigger one) ==="
# Login as admin first, then:
curl -s -X POST https://citymarkets.sa/api/admin/categories \
  -H "Cookie: admin_token=***" -H "x-csrf-token: ***" \
  -H "Content-Type: application/json" -d '{"name":"deploy-test","slug":"deploy-test"}'
# Verify it landed in admin_audit_log
docker exec citymarket-db psql citymarket_db -c "SELECT action, entity_type FROM admin_audit_log ORDER BY created_at DESC LIMIT 3"

echo "=== Webhook tamper test (should reject) ==="
curl -s -X POST https://citymarkets.sa/api/v1/payments/webhook \
  -H "Content-Type: application/json" -d '{"id":"fake","status":"paid"}'
# Expect 401 or 403
```

---

## Step 7 — Monitor (24 h)

```bash
# Watch server.log for pii-crypto errors
docker exec city-market-app-citymarket-app-1 tail -f /app/server.log | grep -iE "pii|error"

# Spike in 5xx?
docker exec city-market-app-citymarket-app-1 grep -c " 5[0-9][0-9] " /app/server.log
# Compare to yesterday's baseline

# Redis health
docker exec city-market-redis redis-cli ping
# Expect: PONG
```

---

## Rollback plan

If anything goes wrong in steps 5–6:

```bash
cd /var/www/citymarkets.sa/city-market-app

# Stop new container, start old snapshot
docker compose down
docker run -d --name city-market-app-citymarket-app-1 \
  --network host \
  -v /var/www/citymarkets.sa/city-market-app/server.log:/app/server.log:rw \
  -v /var/www/citymarkets.sa/city-market-app/.next-cache-host:/app/.next/cache \
  -v /var/www/citymarkets.sa/city-market-app/public/images:/app/public/images:rw \
  --env-file /var/www/citymarkets.sa/city-market-app/.env.local \
  citymarkets:pre-deploy-snapshot

# Restore DB
gunzip -c /var/backups/citymarket-pre-deploy-*.sql.gz | sudo -u postgres psql citymarket_db
```

---

## What this deploy activates

| Fix | Status before | Status after |
|---|---|---|
| P0-1 JWT secret rotation (kid header) | code-only | ✅ active |
| P0-1b JWT token_version centralized | code-only | ✅ active |
| P0-2 Webhook secret rotation (grace window) | code-only | ✅ active |
| P0-3 PII encryption (envelope, AES-KW) | not deployed | ✅ active (after backfill) |
| P1-1 Rate limit Redis | code-only | ✅ active (after REDIS_URL) |
| P1-2 Admin audit trail | code-only | ✅ active |
| P2-1 Apple Review OTP guard | code-only | ✅ active |
| P2-2 CSRF HTTPOnly | code-only | ✅ active |

---

## What does NOT happen in this deploy

- The 65+ remaining plaintext SELECT sites — left for a follow-up pass
- KMS integration — the env KEK is still a single point of compromise; upgrade path is documented in `docs/security/pii-encryption.md`
- Migration 119 cleanup of any applied-but-unused objects beyond `jwt_secret_version` columns — handle in a separate housekeeping PR
- `customer-session.test.ts` flake (jose sub-must-be-string) — pre-existing, separate fix

---

## End-of-deploy checklist

- [ ] Step 0 backups exist on disk
- [ ] Step 1 KEK + wrapped DEK saved securely
- [ ] Step 2 `.env.local` parses with `docker compose config`
- [ ] Step 3 migrations 119/121/122/123 in `app_migrations`
- [ ] Step 4 zero plaintext-PII rows pending
- [ ] Step 5 new container is `(healthy)`
- [ ] Step 6 all smoke tests pass
- [ ] Step 7 server.log shows no pii-crypto errors
- [ ] 24 h post-deploy: no spike in 5xx, no customer reports of login failures