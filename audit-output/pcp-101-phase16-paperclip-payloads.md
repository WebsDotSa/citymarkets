# Paperclip Task Payload — Phase 16

## Common context (sent to every agent)

```json
{
  "phase": "phase16",
  "project": "citymarkets.sa (أسواق سيتي)",
  "working_dir": "/var/www/citymarkets.sa/city-market-app",
  "stack": "Next.js 14 (App Router) + TypeScript + PostgreSQL 16 + Prisma + Docker",
  "port": 3005,
  "base_sha": "99e3dff",
  "pcp_id_range_per_agent": {
    "citymarkets-backend": "167-179",
    "citymarkets-frontend": "180-189",
    "citymarkets-checkout": "190-199",
    "citymarkets-audit": "200-219"
  },
  "skills_loaded_v2": {
    "citymarkets-backend": ["api-contract-drift-audit", "requesting-code-review", "playwright-dogfooding"],
    "citymarkets-frontend": ["playwright-dogfooding", "requesting-code-review"],
    "citymarkets-checkout": ["systematic-debugging", "test-driven-development", "deploy-verify"],
    "citymarkets-audit": ["db-inspection", "spike", "merge-phase-report"]
  },
  "report_path": "audit-output/pcp-101-phase16-<agent>-report.md",
  "branch_template": "phase16/<agent-slug>",
  "worktree_template": ".worktrees/phase16-<agent-slug>",
  "common_rules": [
    "Worktree per agent",
    "Commit per fix, push to origin",
    "Live verification (curl) per fix",
    "Test required (vitest) per fix",
    "tsc 0 errors at end",
    "Skill feedback is mandatory",
    "PCP-ID range is sacred"
  ]
}
```

---

## Agent 1: citymarkets-backend

**Issue ID:** TBD (created in API call)
**Branch:** `phase16/citymarkets-backend`
**PCP-ID range:** 167..179
**Skills:** `api-contract-drift-audit`, `requesting-code-review`, `playwright-dogfooding`

### Tasks

**PCP-167 (P1) — admin GET /api/admin/users soft-delete filter**
- File: `src/app/api/admin/users/route.ts`
- Add `WHERE deleted_at IS NULL` if missing
- Test: create soft-deleted user, GET as admin, assert not in response

**PCP-168 (P1) — customer soft-delete zero out loyalty_points + total_spent**
- File: `src/app/api/v1/profile/delete/route.ts`
- After soft-delete: `UPDATE users SET loyalty_points = 0, total_spent = 0 WHERE id = $1`
- Audit log to `users_audit_log` (or `users.deleted_at_metadata` JSON)
- Test: soft-delete a user with points, assert 0 + audit log row

**PCP-169 (P2) — page_views 90-day retention**
- New file: `migrations/116_pcp169_page_views_retention.sql`
- `DELETE FROM page_views WHERE created_at < now() - interval '90 days'`
- Add cron reference (comment, not actual cron)
- Test: insert old row, run DELETE, assert gone

**PCP-170..179 (P2) — Rate-limit sweep of 78 write endpoints**
- Enumerate: `rg -l "export async function (POST|PUT|PATCH|DELETE)" src/app/api/`
- For each missing `checkRateLimit`, add it
- Use existing configs (LOGIN, EMPLOYMENT, COUPON, etc.) or pick from the table in the prompt
- Group commits by endpoint class (auth, user-content, profile, bulk, default)
- Test per endpoint

### Deliverables

- 13 commits (1 per PCP, with sweep batched into 5-10 commits)
- `audit-output/pcp-101-phase16-citymarkets-backend-report.md`
- All tests green, tsc 0 errors
- Branch pushed to origin

---

## Agent 2: citymarkets-frontend

**Issue ID:** TBD
**Branch:** `phase16/citymarkets-frontend`
**PCP-ID range:** 180..189
**Skills:** `playwright-dogfooding`, `requesting-code-review`

### Tasks

**PCP-180..184 (P2) — Suspense boundary sweep**
- `rg "useSearchParams" src/ -l`
- For each file, refactor: extract to child component, wrap in `<Suspense>`
- `npx next build` zero deopt warnings
- 3+ vitest tests for the refactors

**PCP-185..189 (P2) — Mobile/RTL visual regression (NEW class)**
- Use `playwright-dogfooding`: viewport 375x667, locale ar-SA, scale 2
- Scripted visit: /, /categories/test-category, /products/test-product, /cart, /checkout, /account, /orders
- Screenshots under `dogfood-output/2026-10-03-phase16-mobile-baseline/`
- Verify: no h-scroll, CTAs reachable, text not truncated, currency Arabic, date Arabic
- File 1 PCP per visual issue found

### Deliverables

- 5-10 commits
- `audit-output/pcp-101-phase16-citymarkets-frontend-report.md`
- `dogfood-output/2026-10-03-phase16-mobile-baseline/` (screenshots + script + console log)
- All tests green, tsc 0 errors
- Branch pushed to origin

---

## Agent 3: citymarkets-checkout

**Issue ID:** TBD
**Branch:** `phase16/citymarkets-checkout`
**PCP-ID range:** 190..199
**Skills:** `systematic-debugging`, `test-driven-development`, `deploy-verify`

### Tasks

**PCP-190..194 (P0..P1) — Moyasar webhook idempotency audit (NEW class)**
- File: `src/app/api/v1/payments/moyasar/callback/route.ts`
- Verify: uses `moyasar_payment_id` as dedupe key (not generated UUID)
- Verify: `INSERT ... ON CONFLICT` (not `UPDATE ... WHERE`)
- Verify: same response on replay
- Test: replay same callback 5x, assert 1 row in `payment_events` + 1 status transition

**PCP-195..199 (P1..P2) — Cart pricing race (NEW class)**
- File: `src/lib/cart/cart-service.ts`
- For each pricing fn (subtotal, shipping, tax, total):
  - Same transaction as order?
  - Current DB state of products, or cached?
  - Cache window between cart add and checkout?
- Refactor: re-fetch prices at checkout submit
- Test: add product, change price in DB, submit, assert new price

### Deliverables

- 10 commits (1 per PCP)
- `audit-output/pcp-101-phase16-citymarkets-checkout-report.md`
- All tests green, tsc 0 errors
- Branch pushed to origin

---

## Agent 4: citymarkets-audit

**Issue ID:** TBD
**Branch:** `phase16/citymarkets-audit`
**PCP-ID range:** 200..219
**Skills:** `db-inspection`, `spike`, `merge-phase-report`

### Tasks

**PCP-200..204 (P2) — DB deadlock / blocking audit (NEW class)**
- Use `db-inspection` skill Step 7 (long-running queries)
- Check `pg_locks` for waits > 1s
- Check `pg_stat_database.deadlocks` last 7 days
- Check `idx_blks_read > 0 AND idx_blks_hit = 0` (RAM pressure)
- File 1 PCP per finding

**PCP-205..209 (P2) — Schema drift vs ORM (NEW class)**
- `npx prisma migrate diff` against dev DB
- `npx prisma db pull` in scratch dir
- Compare to Prisma client + tsc
- File 1 PCP per drift direction (DB needs update vs Prisma needs update)

**PCP-210..219 — Replication / backup / DR audit (NEW class)**
- `pg_dump` cron status
- `wal-g` / `pgbackrest` / `barman` setup
- Read replica lag
- Failover procedure (tested in last 90 days?)
- RPO / RTO documentation
- File 1 PCP per finding

### Deliverables

- 20 commits max (1 per PCP, batch if many)
- `audit-output/pcp-101-phase16-citymarkets-audit-report.md`
- `spikes/011-015/` (5 new spike reports for the new theories)
- `migrations/117_*.sql` if any DB fixes
- Branch pushed to origin

---

## Final: Lead agent dispatch

The Lead agent (`citymarkets.sa`, agent_id `64ed9ca3-70c9-4eb7-9b81-5dc748ca6e5c`) is auto-unblocked when all 4 are done. It will:

1. `merge-phase-report` skill → consolidate
2. `deploy-verify` skill → live deploy
3. Write `audit-output/pcp-101-phase16-master-report.md`
4. Push to origin, mark done

---

## curl templates (use these for wakeup)

```bash
# Wake an agent
curl -X POST -H "Authorization: Bearer <agent_api_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "on_demand",
    "triggerDetail": "manual",
    "forceFreshSession": true,
    "payload": {
      "issueId": "<issue_id>",
      "taskId": "<issue_id>",
      "projectId": "101c63c6-8c24-41c4-8d26-661bcf7eae8a"
    }
  }' \
  http://179.198.212.32:3100/api/agents/<agent_id>/wakeup

# Create an issue
curl -X POST -H "Authorization: Bearer <agent_api_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Phase 16 — <agent>",
    "description": "<full prompt content here>",
    "projectId": "101c63c6-8c24-41c4-8d26-661bcf7eae8a",
    "blockedByIssueIds": []
  }' \
  http://179.198.212.32:3100/api/companies/3d4fa289-80ff-49fc-a1d6-5ea72faddfc6/issues
```
