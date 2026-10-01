# PCP-101 Infra & Deployment Audit

**Date:** 2026-10-01 (UTC)
**Branch:** `main` @ `b5ca8f5`
**Auditor:** Hermes subagent
**Scope:** Containers, Postgres integrity, migrations, dependencies, file perms, worktrees, env-file risk.

---

## 1. Container Health — ✅ HEALTHY

| Container | Status | Notes |
|---|---|---|
| `city-market-app-citymarket-app-1` | **Up 16 minutes (healthy)** | App, port 3005 |
| `citymarket-db` | **Up 18 hours** | Postgres, port 5432 |

**Health endpoint:**
```json
{"status":"healthy","timestamp":"2026-10-01T15:19:02.430Z","version":"1.0.0","services":{"database":{"status":"up","latency":2}}}
```

App image hash: `sha256:1a0130ff6a178be8e22340e078730b0fd50dc46d5472cd424547cad849f5477e` — matches `docker images city-market-app-citymarket-app latest` (same ID, same build). Image freshness confirmed.

---

## 2. Database Integrity — ✅ CLEAN

| Check | Result | Verdict |
|---|---|---|
| FORCE RLS tables | **0** | ✅ Clean (post-097 migration; matches skill expectation) |
| `deny_all` policies | **0** | ✅ Clean — no silent write blockers |
| Orphan rows (`orders.user_id → users`) | **0** | ✅ No referential orphans |
| Products triggers (`update_products_updated_at`, `products_readonly_guard`) | **both present** | ✅ Read-only guard intact |
| DB role separation | `citymarket_user=f\|t`, `migrations_user=t\|f`, `postgres=t\|t` | ✅ Correct — see caveat |

**Caveat on `citymarket_user`:** the skill (lesson 7) anticipates `NOBYPASSRLS` for `citymarket_user`, but the live role is `BYPASSRLS`. This is **not a regression** — the role has full table grants and the FORCE RLS count is zero, so no policies are silently filtering reads. The combination `NOSUPERUSER + BYPASSRLS + 0 forced tables + 0 deny_all policies` is consistent with the migration 097 cleanup having been applied. **Keep as-is** unless a future migration reintroduces FORCE RLS — at which point BYPASSRLS will need to be flipped off and policies audited.

### Table inventory

56 tables in `public`. Notable empty-but-referenced tables (all expected per skill "feature-ready, no-traffic-yet" pattern):

| Table | Rows | Notes |
|---|---|---|
| `admin_notification_reads` | 0 | Synthetic notification keys (per skill) |
| `broadcasts`, `broadcast_templates`, `broadcast_deliveries` | 0 | Feature never deployed (per skill) |
| `contact_messages` | 0 | OK |
| `direct_order_items`, `direct_order_messages`, `direct_order_meta` | 0 | Admin chat order surface; 0 rows = feature unused but route exists (split-table query lesson applies) |
| `native_push_tokens` | 0 | Newer push table, duplicates `push_subscriptions` (also 0) |
| `payment_events` | 0 | Per skill: never deployed |
| `push_subscriptions` | 0 | Legacy push (replaced by `native_push_tokens`) |
| `refund_requests`, `orders_refunds` | 0 | Newly added by migration 106 |
| `vendor_coupons`, `vendor_daily_stats` | 0 | Standardized by 094 |
| `wishlist_items` | 0 | OK |
| `banners_legacy_077` | 2 | Intentionally preserved (legacy table kept per migration 077) |

---

## 3. Migration Drift — ⚠️ 1 STALE BOOKKEEPING ENTRY

| | Count |
|---|---|
| Applied migrations (`app_migrations`) | **116** |
| Migrations in repo (`migrations/*.sql`) | **115** |

### Drift detail

**Entries applied but missing from repo** (stale bookkeeping; cannot be replayed):

- `039_legacy_products_readonly.sql` — pre-dates the migration-runner era; legacy entry
- `040_offers.sql` — pre-dates the migration-runner era; legacy entry
- `050_delivery_quote_catch_all.sql` — pre-dates the migration-runner era; legacy entry
- `059_grant_direct_order_messages.sql` — pre-dates the migration-runner era; legacy entry
- `059_vendor_applications.sql` — pre-dates the migration-runner era; legacy entry
- `072_order_items_product_fk_to_vendor_products.sql` — pre-dates the migration-runner era; legacy entry
- **`106_payment_refunds.sql`** — **applied 2026-10-01 13:41:21, NOT in repo, NOT in any git history**

The first 6 are pre-runner legacy entries and harmless. **The 7th is a real drift event**: the migration's effects are in the DB (`refunds` columns, `orders_refunds` table) but the file is gone — if the DB is ever rebuilt from a dump that predates the rebuild, the runner cannot reproduce the schema. Verify `106_payment_refunds.sql` content lives in another file or restore it from a backup.

### Migrations 105/106 verification

```
105_grants_rls_and_bypass_for_citymarket_user.sql  applied 2026-10-01 12:22:50  ✅
106_payment_refunds.sql                            applied 2026-10-01 13:41:21  ⚠️ file missing
106_refund_requests.sql                            applied 2026-10-01 13:41:49  ✅
```

### Files in repo but not applied

None — every `migrations/*.sql` in the repo has an `app_migrations` row.

---

## 4. Dependencies — ⚠️ `@supabase/ssr` RE-ADDED

`package.json` line 29:
```json
"@supabase/ssr": "^0.10.2",
"@supabase/supabase-js": "^2.45.0",
```

Both packages are **listed in dependencies** but **NOT imported anywhere in `src/`** (verified — zero `from "@supabase/..."` imports). The only `supabase` mention in `src/` is a comment in `src/contexts/auth-context.tsx`:
> `// session here, but @supabase/supabase-js was removed from the`

These are dead dependencies:
- They bloat `npm install` time and lockfile.
- They are **inert at runtime** (no import → never evaluated), so the live app is unaffected.
- They WILL fail `npm install --omit=dev` only if the packages themselves vanish from the registry (they're still published, so today this is purely a hygiene issue).
- The skill explicitly says `@supabase/ssr` should NOT be in dependencies. The drop was reverted at some point.

**Recommendation:** drop both `@supabase/*` packages from `package.json` and re-run `npm install` + `npm run lint` (tsc green) to confirm.

### `npm ls --depth=0` warnings

```
UNMET/invalid: (none)
extraneous: 10+ @eslint/* dev-tooling packages
```

The "extraneous" warnings are dev-only ESLint packages present on disk but not declared in `devDependencies`. They don't affect the production build but should be cleaned up:
```
@eslint-community/eslint-utils, @eslint-community/regexpp,
@eslint/config-array, @eslint/config-helpers, @eslint/core,
@eslint/eslintrc, @eslint/js, @eslint/object-schema,
@eslint/plugin-kit, @humanfs/core
```

---

## 5. File Permissions — ✅ CORRECT

| Path | Owner | Verdict |
|---|---|---|
| `/var/www/citymarkets.sa/city-market-app/.next-cache-host` | `1001:1001` | ✅ Matches `nextjs` in-container user |
| `/var/www/citymarkets.sa/city-market-app/public/images` | `1001:1001` | ✅ Same |

No EACCES risk on the bind-mounted cache or image directories.

---

## 6. env-File Risk — ✅ SAFE

```
.env           mtime 2026-10-01 14:34:06  size 2152  perms 0600  owner root
.env.local     -> .env (symlink, target unmodified since 14:20)  perms 0777
.env.local.example  5003 bytes  0644
.env.r2        573 bytes  0600  owner root  mtime Aug 17
```

- `.env` modify time (`2026-10-01 14:34`) is AFTER the last commit affecting it — there is no commit history touching `.env` (it's gitignored as expected).
- `.env.local` is a symlink to `.env` (per skill lesson 19c — defends against accidental deletion via worktree cleanup).
- `.env.r2` predates this audit by ~6 weeks — likely a stable Cloudflare R2 config file; not touched.

No accidental overwrite detected. **Caveat (per skill lesson 19a0):** the `.env` modify time is recent (14:34 today). If a vitest setup script or test-mode env-loader overwrites `.env` with test values between audits, the next `docker compose up` will break. Today the values appear intact (DB connection works), but this audit cannot prove what was overwritten earlier — only that the current state is healthy.

---

## 7. Worktree State — ❌ EXCESSIVE

```
git worktree list  →  27 worktrees
.worktrees/        →  23 directories
```

The target was `< 5`. **23 active worktrees** is the principal hygiene problem in this audit. Many have merged commits (e.g. `hermes-pcp82` is on `1c00072` which is already on `main`); they're orphaned branches from completed PCP tickets.

**Recommendation:** prune worktrees whose branches are merged into `main`:
```bash
cd /var/www/citymarkets.sa/city-market-app
git worktree list --porcelain | awk '/^worktree/ {wt=$2} /^branch/ {print wt, $2}' \
  | while read wt br; do
      base=$(git merge-base "$br" main 2>/dev/null)
      [ "$base" = "$(git rev-parse "$br")" ] && echo "MERGED: $wt $br"
    done
# Then: git worktree remove --force <path> for merged ones
# And: git branch -d <branch>
```

Spot-check: of the 23 worktrees, roughly **15–18** are on commits already present in `main` history and can be deleted without data loss. The 7 hermes-a* / pcp-* in-flight ones (hermes-ff12f19e on b5ca8f5, hermes-pcp-97, hermes-pcp100, etc.) need a human check before pruning.

---

## 8. Dead Imports — ✅ FALSE POSITIVE

The audit's grep `import.*logInfo|import.*logWarn` matched **50 files**, but on inspection all 50 import aliases from `@/lib/logger` (which exists at `src/lib/logger.ts` with `logger.test.ts`). The aliases `logInfo`, `logWarn`, `logError` are correctly used; no dead imports.

```
src/lib/logger.ts       ✅ exists
src/lib/logger.test.ts  ✅ exists
```

No action needed.

---

## 9. Other Observations

- **`docker compose ps`:** app container healthy, DB container up 18h. No worker container running (no `city-market-app-citymarket-worker-1` service visible). `package.json` declares `worker:run` script referencing `scripts/worker.ts`; per skill lesson 19 this means rebuilds of `Dockerfile.worker` will succeed but the service is intentionally off. ✅
- **`npm ls` extraneous:** the `@eslint/*` packages are stale leftovers from a previous lint setup; safe to remove via `npm prune` after declaring them in `devDependencies` or removing the lint tooling.

---

## 10. Severity Summary

| Severity | Count | Items |
|---|---|---|
| **Critical** | 0 | — |
| **High** | 2 | (a) `106_payment_refunds.sql` applied but not in repo; (b) `@supabase/*` dead deps in `package.json` |
| **Medium** | 2 | (c) 23 stale worktrees; (d) 10 extraneous `@eslint/*` dev packages |
| **Low** | 2 | (e) `.env.local` symlink uses `0777` perms; (f) `.env` recent modify time (audit cannot prove no overwrite happened, only current health) |

---

## 11. Recommendations (priority order)

1. **Restore `migrations/106_payment_refunds.sql`** — recover from a backup or the migration runner's audit log; commit it. Otherwise any future DB rebuild will silently lose the refund schema. *(High)*
2. **Remove `@supabase/ssr` and `@supabase/supabase-js` from `package.json`**, re-run `npm install` + `npm run lint` to confirm no imports break. *(High)*
3. **Prune merged worktrees**: identify the 15–18 worktrees whose branches are already in `main`, then `git worktree remove --force` them. Leave the in-flight hermes-* / pcp-* alone. *(Medium)*
4. **`npm prune` or formally declare the 10 `@eslint/*` packages** in `devDependencies` (or remove the lint tooling that uses them). *(Medium)*
5. **Optional:** tighten `.env.local` symlink perms to `0755` (currently `0777`). *(Low)*
6. **Future-proofing:** add a CI step that runs `npm run db:drift-report` (already a package.json script) and fails the build if `app_migrations` ↔ `migrations/` drift exceeds 0. *(Process)*

---

## 12. Files Created by This Audit

- `/var/www/citymarkets.sa/city-market-app/audit-output/pcp-101-infra.md` (this report)

No files modified, no DB state changed, no commits made.
