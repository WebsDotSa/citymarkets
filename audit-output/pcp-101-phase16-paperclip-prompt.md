# Phase 16 — Carry-Over + Open-Class Sweep (Skills v2)

**Trigger:** 2026-10-03
**Project:** citymarkets.sa (أسواق سيتي)
**Working dir:** `/var/www/citymarkets.sa/city-market-app`
**Stack:** Next.js 14 (App Router) + TypeScript + PostgreSQL 16 + Prisma + Docker
**Port:** 3005 (host network mode)
**Base SHA:** `99e3dff` (Phase 15 master report)

---

## What's new in Phase 16

Phase 15 closed 24 PCPs across 4 agents. Phase 16 is **carry-over + open-class sweep**:

1. **Carry-overs from Phase 15** (delegated, not done):
   - **PCP-145 audit-side**: `admin GET /api/admin/users` returns soft-deleted users; customer soft-delete does not zero `loyalty_points` / `total_spent` → backend agent
   - **PCP-148**: `page_views` is 5MB heap, no retention, no realtime channel → backend agent
2. **Open-class sweeps** (Phase 15 found partial coverage):
   - **Rate-limit sweep**: 78 write endpoints remain. Phase 12-15 closed 14. Phase 16 closes the rest. → backend agent
   - **Suspense-boundary sweep**: Phase 15 fixed 3 pages (`vendors/[slug]/failed`, `admin/products/new`, `admin/products/[id]/edit`). Likely more pages with `useSearchParams()` outside `<Suspense>`. → frontend agent
3. **NEW classes** (Phase 15 skill gaps):
   - **DB deadlock / blocking audit** (not in Phase 14/15) → audit agent
   - **Webhook idempotency** in `moyasar` callback — Phase 14 audited refund callback but not payment callback → checkout agent
   - **Mobile/RTL visual regression** — Phase 15 used desktop only → frontend agent uses `playwright-dogfooding` skill

## PCP-ID reservation (NEW in Phase 16)

To eliminate the Phase 15 cross-agent collision mess, this phase reserves PCP-ID ranges per agent:

- **Backend agent:** PCP-167..179 (13 IDs)
- **Frontend agent:** PCP-180..189 (10 IDs)
- **Checkout agent:** PCP-190..199 (10 IDs)
- **Audit agent:** PCP-200..219 (20 IDs)

If you find a bug in another agent's domain, log it in your report but assign a PCP-ID in the target agent's range. Do NOT re-use IDs.

---

## Skills loaded per agent (Phase 16 v2)

| Agent | Skill 1 | Skill 2 | Skill 3 (new) | Why this stack |
|-------|---------|---------|---------------|----------------|
| **Backend** | `api-contract-drift-audit` | `requesting-code-review` | `playwright-dogfooding` (new) | token rotation, rate limits, soft-delete, loyalty — last one needs end-to-end verify |
| **Frontend** | `playwright-dogfooding` (new) | `requesting-code-review` | — | mobile/RTL via Playwright, Suspense sweep via static analysis |
| **Checkout** | `systematic-debugging` | `test-driven-development` | `deploy-verify` (new) | webhook idempotency, 4-phase root cause, verify the deploy post-fix |
| **Audit** | `db-inspection` (new) | `spike` | `merge-phase-report` (new) | the 8-step DB runner, spike for new theories, lead will use merge skill |

**The skill feedback section is mandatory.** Every agent must end their report with:

```
## Skill gaps discovered
- <Skill name>: <what it missed or got wrong>
- <What to add / change / drop>
```

If you cannot find a gap, that's suspicious — look harder. Phase 15 found gaps in 4/4 agents.

---

## Agent 1: citymarkets-backend

**Branch:** `phase16/citymarkets-backend`
**PCP-ID range:** 167..179

### Scope (3 carry-overs + 1 sweep)

#### Carry-over A: PCP-167 (P1) — admin `GET /api/admin/users` returns soft-deleted users

**Trigger:** Phase 15 audit spike 004 — soft-delete filter missing on admin listing.

**Steps:**
1. Read `src/app/api/admin/users/route.ts` and `src/app/api/admin/users/[id]/route.ts`
2. Verify the `WHERE deleted_at IS NULL` clause is present
3. If absent, add it; if present, verify it's not bypassed by some other path
4. Add a vitest test that creates a soft-deleted user, calls the endpoint as admin, asserts the user is NOT in the response

#### Carry-over B: PCP-168 (P1) — customer soft-delete does not zero `loyalty_points` / `total_spent`

**Trigger:** Phase 15 audit delegation. Compliance + analytics cleanliness.

**Steps:**
1. Read `src/app/api/v1/profile/delete/route.ts` (the existing customer soft-delete)
2. After the soft-delete, also `UPDATE users SET loyalty_points = 0, total_spent = 0 WHERE id = $1`
3. Keep the values in a `users_audit_log` table for finance reconciliation (or a JSON column on `users.deleted_at_metadata` if the audit log table doesn't exist)
4. Add a test that verifies after soft-delete, the loyalty balance is 0 and a record exists in the audit log

#### Carry-over C: PCP-169 (P2) — `page_views` retention policy

**Trigger:** Phase 15 audit spike 010. 5MB heap, no retention, no realtime.

**Steps:**
1. Read `migrations/` for any prior `page_views` retention work (probably none)
2. Decide: cron-based deletion vs partitioning vs TTL view
3. Recommended: a 90-day retention cron (`DELETE FROM page_views WHERE created_at < now() - interval '90 days'`) — simple, reversible, can be partitioned later
4. Write a migration `116_pcp169_page_views_retention.sql` with the DELETE + a comment about the cron
5. Add a vitest test that inserts an old `page_views` row, runs the DELETE, asserts it's gone

#### Sweep: PCP-170..179 (P2) — Rate-limit coverage of remaining 78 write endpoints

**Trigger:** Phase 15 master report §9 "Rate-limit sweep".

**Steps:**
1. Enumerate every write endpoint (`POST` / `PATCH` / `PUT` / `DELETE` in `src/app/api/`) — should be 92 total, 14 done = 78 remaining
2. For each, check if `checkRateLimit` is called
3. If not, pick a config from `src/lib/rate-limit.ts` based on the endpoint's blast radius:
   - Auth/credential: 5/min/IP (LOGIN_CONFIG_IP pattern)
   - User-generated content (review, comment, post): 10/min/user
   - Profile data (address, payment-method, etc.): 10/min/user
   - Bulk/expensive (product create, bulk update): 5/min/user
   - Default: 30/min/IP
4. Add the rate limit. Use the existing `ADDRESS_CREATE_IP_CONFIG` / `PROFILE_DELETE_IP_CONFIG` / `EMPLOYMENT_IP_CONFIG` patterns — no new configs needed unless the blast radius is genuinely new
5. Add a vitest test per endpoint that asserts the rate limit triggers on the N+1th request

**Group commits**: 1 commit per logical batch (e.g. "all auth endpoints", "all user-content endpoints", etc.), not 1 per endpoint.

---

## Agent 2: citymarkets-frontend

**Branch:** `phase16/citymarkets-frontend`
**PCP-ID range:** 180..189

### Scope (1 sweep + 1 new class)

#### Sweep: PCP-180..184 (P2) — Suspense boundaries around `useSearchParams()`

**Trigger:** Phase 15 PCP-145 FE found 3 pages. Likely more.

**Steps:**
1. Use `rg "useSearchParams" src/ -l` to find every file
2. For each file, check if the component is wrapped in a `<Suspense>` boundary in the page file
3. If not, refactor: extract the `useSearchParams` usage into a child component, wrap the child in `<Suspense fallback={...}>`
4. Run `npx next build` and confirm zero "deopted into client-side rendering" warnings
5. Add a vitest test for at least 3 of the fixes

**The Playwright skill is your friend here** — `playwright-dogfooding` can verify the fallback renders correctly while the real content loads.

#### New class: PCP-185 (P2) — Mobile/RTL visual regression

**Trigger:** Phase 15 used desktop (1280x800) only. Saudi users are 80%+ mobile, 100% RTL.

**Steps:**
1. Use `playwright-dogfooding` skill — viewport `375x667`, locale `ar-SA`, `device_scale_factor=2`
2. Run a scripted visit to: `/`, `/categories/test-category`, `/products/test-product`, `/cart`, `/checkout`, `/account`, `/orders`
3. Capture full-page screenshots under `dogfood-output/YYYY-MM-DD-phase16-mobile-baseline/`
4. Verify: no horizontal scroll, all CTAs reachable, text not truncated, currency in Arabic (`ر.س` not `SAR`), date in Arabic format
5. For each visual issue found, file a PCP-186..189 with: file:line, screenshot, expected behavior, actual behavior

---

## Agent 3: citymarkets-checkout

**Branch:** `phase16/citymarkets-checkout`
**PCP-ID range:** 190..199

### Scope (1 carry-over + 1 new class)

#### New class: PCP-190..194 (P0..P1) — Webhook idempotency audit

**Trigger:** Phase 14 audited `moyasar refund callback`. Phase 15 audited nothing about payment callback. The callback likely has the same problems.

**Steps:**
1. Read `src/app/api/v1/payments/moyasar/callback/route.ts`
2. Verify the idempotency check: does it use the `moyasar_payment_id` (not a generated UUID) as the dedupe key?
3. Verify the DB update is `INSERT ... ON CONFLICT (moyasar_payment_id) DO UPDATE` (not `UPDATE ... WHERE id = $1`)
4. Verify the response is the same on replay (idempotency property)
5. If any of these are missing, add them
6. Add a test: replay the same callback 5 times, assert only 1 row in `payment_events` + 1 transition in `orders.status`

#### New class: PCP-195..199 (P1..P2) — Cart-pricing race conditions

**Trigger:** Phase 14 found order race. Phase 15 found idempotency leak. Cart pricing not audited.

**Steps:**
1. Read `src/lib/cart/cart-service.ts` (or wherever the cart-pricing lives)
2. For each pricing function (subtotal, shipping, tax, total), check: is it computed in the same transaction as the order? Is it based on the current DB state of the products, or a cached value?
3. If cached, can the cache go stale between cart add and checkout submit? What's the window?
4. Recommend: re-fetch product prices at checkout submit (not at cart add) and use the actual server-side value for the order, not the cart's stored value
5. Add a test: add a product, change its price in DB, submit checkout, assert the order uses the new price

---

## Agent 4: citymarkets-audit

**Branch:** `phase16/citymarkets-audit`
**PCP-ID range:** 200..219

### Scope (1 carry-over + 2 new classes)

#### Carry-over: PCP-200 (P2) — DB deadlock / blocking audit

**Trigger:** Phase 14/15 found N+1 and missing indexes but not deadlocks.

**Steps:**
1. Use `db-inspection` skill Step 7 (long-running queries) on the production DB
2. For every table with > 1M rows, check `pg_locks` for `AccessExclusiveLock` waits > 1 second
3. Check `pg_stat_database.deadlocks` for the last 7 days
4. For every index with `idx_blks_read > 0` AND `idx_blks_hit = 0`, the index is being read but never cached — possible RAM pressure
5. File PCPs 200..204 for each finding

#### New class: PCP-205..209 (P2) — Schema drift vs ORM expectations

**Trigger:** Phase 15 found migration drift. Phase 16 finds ORM-vs-DB drift.

**Steps:**
1. `npx prisma migrate diff` (against the dev DB) — does it match `migrations/`?
2. `npx prisma db pull` (in a scratch dir) — does the schema match the Prisma client?
3. `npx tsc --noEmit` (already done in CI but worth a re-run) — any type drift?
4. For each drift, decide: DB needs update (write migration) or Prisma schema needs update (rewrite + migrate)
5. File PCPs 205..209

#### New class: PCP-210..219 — Replication / backup / disaster recovery audit

**Trigger:** Phase 14/15 never touched infra. Production has been running 2 weeks without a tested backup.

**Steps:**
1. Is there a `pg_dump` cron? When did it last run? Verify a restore works (in a scratch DB).
2. Is there a `wal-g` / `pgbackrest` / `barman` setup? What's the RPO / RTO?
3. Is there a read replica? Is it lagging? What's the lag SLA?
4. What's the failover procedure? Has it been tested in the last 90 days?
5. File PCPs 210..219 for each finding

---

## Cross-agent rules (apply to ALL agents)

1. **Worktree per agent**: `git worktree add -b phase16/<agent-slug> .worktrees/phase16-<agent-slug> main`
2. **Commit early, commit often**: don't wait until the end. A commit per logical fix.
3. **Update the issue**: post a comment after each major fix (not just at the end).
4. **Live verification**: every fix must have a live curl in your report. Not a "would work if deployed" — an actual curl.
5. **Test required**: every fix must have a vitest test. No test = no fix.
6. **tsc clean**: at the end of your work, `npx tsc --noEmit` must be 0 errors.
7. **Vitest green**: at the end, `npx vitest run --reporter=basic` must be 100% (or only pre-existing skips).
8. **Skill feedback is mandatory**: end your report with `## Skill gaps discovered`.
9. **PCP-ID range is sacred**: if you find a bug in another agent's domain, log it in your report but assign a PCP-ID in the target agent's range.

## Report structure (each agent writes this)

```markdown
# Phase 16 — <agent> report

**Issue:** <PCP-XXX>
**Branch:** phase16/<agent-slug>
**Worktree:** .worktrees/phase16-<agent-slug>
**Skills loaded:** <list>

## PCPs found (in this agent's range)

| PCP | Class | File:line | Severity | Verified live |
|-----|-------|-----------|---------:|---------------|
| PCP-167 | soft-delete filter | src/app/api/admin/users/route.ts:42 | P1 | ✓ curl 200 + 1 user returned |
| ... |

## Skill gaps discovered
- `<skill-name>`: <what it missed or got wrong>
- <what to add / change / drop>

## Cross-agent findings (bugs found in other agent's domain)
- PCP-XXX-in-range: <description> (file:line, expected fix)
```

## Final: Lead agent dispatch

After all 4 specialists complete, the Lead agent (`citymarkets.sa`) wakes automatically (Paperclip `blockedBy: [4]`). It will:

1. Use the `merge-phase-report` skill to consolidate
2. Use the `deploy-verify` skill for the live deploy
3. Write `audit-output/pcp-101-phase16-master-report.md`
4. Push to origin, deploy, mark done

---

## Anti-patterns (DO NOT do these)

- ❌ "I'll commit later" — commit per fix, push to origin
- ❌ "The test would be redundant" — write the test
- ❌ "It's not in the test plan" — add a test, then it IS in the test plan
- ❌ "I'll just describe the fix" — write code, commit, push
- ❌ "The skill loaded but I didn't use it" — load = use, every time
- ❌ "I'll use PCP-167 for a frontend bug" — use the frontend range, not yours
