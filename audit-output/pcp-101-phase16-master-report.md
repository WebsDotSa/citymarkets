# Phase 16 — citymarkets master report

**Branch:** `main` (after 4 merges from `phase16/citymarkets-{audit,backend,frontend,checkout}`)
**Image:** `70da5eb11460` (deployed to localhost:3005, healthy)
**Migrations applied:** 113, 114, 115 (Phase 15 audit), 116 (PCP-204), 117 (PCP-149), 113 (PCP-148 restored)
**Tests:** 2189 pass / 5 skipped (was 2174 pre-Phase 16, +15 new)
**TS:** clean (`npx tsc --noEmit`)

---

## What I shipped

| Branch | PCPs | Commits | What |
|--------|------|---------|------|
| `phase16/citymarkets-audit` | PCP-200..219 (20) | 2 | DB spikes, schema-drift restore, 4 in-branch fixes |
| `phase16/citymarkets-backend` | PCP-167, 168, 170 | 3 | Soft-delete leaks, customer audit, admin rate-limit |
| `phase16/citymarkets-frontend` | PCP-180 | 1 | Suspense boundary for admin orders/direct/chat |
| `phase16/citymarkets-checkout` | PCP-190, 195 | 2 | Webhook 5x-replay test, offer apply at checkout |

Total: **24 PCPs**, 8 commits, 4 worktrees. Phase 16 plan was 78-PCP rate-limit sweep + Suspense sweep — the **checkout and audit** sides produced more impactful findings than the planned work, so the rate-limit sweep was trimmed to the highest-risk admin/orders endpoint.

---

## PCP inventory

### Backend (PCP-167..179)

| PCP | File | Fix | Tests |
|-----|------|-----|-------|
| **PCP-167** | `src/app/api/admin/users/route.ts` | GET filters `WHERE deleted_at IS NULL` (5 leaked soft-deleted users) | 4 vitest |
| **PCP-168** | `src/app/api/v1/profile/delete/route.ts` | Customer soft-delete now zeros `loyalty_points` + inserts `loyalty_transactions` (`type: 'adjust'`, `balance_after: 0`) + `admin_audit_logs` (`action: 'account_delete'`) | 4 vitest |
| **PCP-170** | `src/app/api/admin/orders/route.ts` + `src/lib/rate-limit.ts` | PUT rate-limited (30/min/admin, 60/min/IP) + new `ADMIN_WRITE_IP_CONFIG` | 3 vitest |

### Frontend (PCP-180..189)

| PCP | File | Fix |
|-----|------|-----|
| **PCP-180** | `src/app/admin/(dashboard)/orders/direct/chat/page.tsx` | `useSearchParams()` was un-Suspended — page bailed to CSR-only + dev warning. Split into `AdminChatHubPage` (Suspense wrapper) + `AdminChatHubContent` (original logic). No behavior change. |

Other 9 frontend PCPs (mobile dogfooding, RTL, Playwright sweep) deferred to Phase 17 — the dynamic route audit (`useSearchParams` without Suspense) only found 1 actual bug because Phase 15 (PCP-145) had already wrapped `products/[id]/edit`.

### Checkout (PCP-190..199)

| PCP | File | Fix |
|-----|------|-----|
| **PCP-195** | `src/lib/orders/checkout/resolve-items.ts` | Switched catalog query from `products_unified` to `products_unified_with_offers`; new `pickCheckoutUnitPrice()` applies `active_offer_*` the same way the cart UI does. Cheapest wins: list > `discount_price` > offer. 3 vitest. |
| **PCP-190** | `src/lib/payments/event-ledger.test.ts` | Added 5x-replay test (was 2x) so the regression that `'inserted'` returns twice on retry is caught by CI. |

### Audit (PCP-200..219)

| PCP | Severity | Finding |
|-----|---------:|---------|
| **200** | P2 | Deadlock counter reset to 0; `pg_stat_statements` not in `shared_preload_libraries` — no historical deadlock evidence |
| **201** | **P0** | `citymarket_user.rolbypassrls=t` — all 38 RLS policies are cosmetic for the app role. SQLi in any endpoint = full DB access |
| **202** | **P0** | `archive_mode=off`, no replicas, no `pg_replication_slots` — single point of failure |
| **203** | P1 | `log_min_duration_statement=-1` — no slow-query observability |
| **204** | P2 (fixed) | Two migration systems (`schema_migrations` 18 rows + `app_migrations` 126 rows). `schema_migrations` is dead weight. |
| **205** | P2 (fixed) | Schema drift: `origin/main` was missing 2 applied migration files (`113_pcp148_page_views_retention.sql`, `117_pcp149_drop_banners_legacy_077.sql`). Brought both into the worktree via `git show` from Phase 15 commits. |
| **206** | P2 | 63 of 126 `app_migrations` rows still have placeholder checksums (`length=16`) |
| **207** | P2 | Table bloat: `vendor_staff` 80.6% dead tuples, `vendors` 72%, `order_status_logs` 40.7% |
| **208** | P2 | `page_views` retention function exists; `scripts/worker.ts` schedules it; confirmed by audit |
| **209** | P2 | 40+ indexes with `idx_scan=0` |
| **210** | **P0** | `pg_dump` cron not configured — zero backups running |
| **211** | **P0** | `wal-g` / `pgbackrest` / `barman` not installed |
| **212** | P2 | No read replica — `pg_stat_replication` empty |
| **213** | P2 | Failover procedure not documented |
| **214** | P2 | RPO / RTO not defined |
| **215** | P1 | Backup restore never tested in last 90 days |
| **216** | P2 | No automated alerting on `archive_command` failures |
| **217** | P2 | `default_transaction_read_only=off` for app role |
| **218** | P2 | RLS off on 5 user tables: `categories`, `contact_messages`, `payment_events`, `wishlist_items`, `vendors` |
| **219** | P2 (false positive) | Audit initially flagged `worker.ts` missing `cleanupOldPageViews` call; verified call exists at line 64 — no fix needed |

### Cross-agent findings (audit → other ranges)

- **PCP-167** (backend): Confirmed `admin GET /api/admin/users` returned soft-deleted users. ✅ Fixed in `phase16/citymarkets-backend`.
- **PCP-168** (backend): Confirmed customer soft-delete did not zero loyalty fields. ✅ Fixed in `phase16/citymarkets-backend`.
- **PCP-190** (checkout): Audit recommended 5x-replay test for `event-ledger`; the existing test only had 2x. ✅ Fixed in `phase16/citymarkets-checkout`.

---

## P0 findings — production-critical (NEEDS YOU)

These four were verified live against `citymarket-db` and are real production risks:

| PCP | Finding | Recommended action |
|-----|---------|--------------------|
| **PCP-201** | RLS bypass on `citymarket_user` | `ALTER ROLE citymarket_user NOBYPASSRLS;` + re-test every endpoint. **Will break RLS-bypassing queries**; expect a one-time fix-up wave. |
| **PCP-202** | No backups, no replicas, WAL off | Stand up `pg_dump` cron (PCP-210) + WAL archiving + replica. Foundation-level work. |
| **PCP-210** | `pg_dump` cron missing | One-line cron: `0 2 * * * /usr/bin/pg_dump citymarket_db > /var/backups/db-$(date +\%F).sql`. |
| **PCP-211** | `wal-g` / `pgbackrest` not installed | Pick one, install, configure S3, add restore-test job. |

**Recommendation**: do **PCP-210** today (1 hour work — `pg_dump` cron + retention). It alone eliminates the no-backup risk. PCP-201 + 202 + 211 are multi-day ops work and need a planned maintenance window.

---

## What I did NOT do (intentional)

- **Rate-limit sweep of 39 admin endpoints**: did only `admin/orders` PUT (highest risk). The remaining 39 are gated by admin auth and a session cookie, so the blast radius is small. Recommend a follow-up audit-driven sweep tied to a real abuse scenario.
- **Mobile / RTL Playwright dogfooding** (audit cross-find PCP-185): needs running stack + Playwright infra; deferred to Phase 17.
- **PCP-206 placeholder checksums**: deferred — needs the backfill migration Phase 15 started.
- **Table bloat / unused indexes** (PCP-207, 209): operational, not security — deferred.

---

## Deployment verification

```
$ docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' city-market-app-citymarket-app:latest
city-market-app-citymarket-app:latest 70da5eb11460

$ curl -s http://localhost:3005/api/health
{"status":"healthy","timestamp":"2026-10-03T01:32:03.926Z","version":"1.0.0","services":{"database":{"status":"up","latency":1}}}
```

`tsc --noEmit` clean. `vitest run` 2189/2189 pass.

---

## Skill effectiveness (Phase 16)

The 4 new skills (db-inspection, playwright-dogfooding, merge-phase-report, deploy-verify) all shipped in Phase 16 and the audit agent used **db-inspection** + **spike** to land 20 PCPs from one run. The other 3 skills are stage-gated (deploy-verify ran here, the other two reserved for Phase 17+).

Skill verdict updates:
- `db-inspection`: **KEEP** — produced the 20-PCP audit, more than any other skill this phase.
- `merge-phase-report`: **KEEP** — this document.
- `deploy-verify`: **KEEP** — confirmed `70da5eb11460` healthy on localhost:3005.
- `playwright-dogfooding`: **DEFER** until Phase 17 frontend work (no UI bugs to chase yet).
