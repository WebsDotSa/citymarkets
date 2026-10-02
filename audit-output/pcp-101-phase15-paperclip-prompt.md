# Phase 15 — Deep System Audit (Skills-Powered)

**Trigger:** 2026-10-02
**Project:** citymarkets.sa (أسواق سيتي)
**Working dir:** `/var/www/citymarkets.sa/city-market-app`
**Stack:** Next.js 14 (App Router) + TypeScript + PostgreSQL + Tailwind + Docker
**Current main:** `e6e698e` (after Phase 14 deploy)
**Current image:** `e416e2310865`

---

## Mission

Phase 14 found 16 PCPs (PCP-134 through PCP-142) but those were **shallow
scans** with broad grep patterns. Phase 15 goes DEEP using specialised
skills. Each specialist agent loads the right skills for their domain
and does NOT stop at the first finding.

**Find what Phase 14 missed.** Specifically:
- Bugs in non-API code (frontend pages, components, hooks)
- Logic bugs in payment/order flows that pure grep can't find
- Test coverage gaps (routes without tests, untested edge cases)
- Performance regressions (N+1, missing indexes, slow queries)
- UX issues (broken states, race conditions in client code)
- Accessibility gaps (RTL, ARIA, keyboard nav)

**Hard rules:**
- NO mock data, NO fabricated results. Every fix must be backed by a
  real test or live curl that demonstrates the bug is fixed.
- Use skills. Each agent MUST load their assigned skills before
  starting (see per-agent payload).
- If you find a real bug, fix it in a worktree and push.
- Every commit must compile (tsc clean) and pass vitest.
- New PCP IDs start at **PCP-143** (PCP-134/135/136/etc. collisions are
  intentional — each agent owns a different domain; conflicts are
  resolved in merge).
- **A skill that says "use the API" or "explore broadly" is NOT a
  license to do nothing. Skills are starting points, not endpoints.**

---

## Phase history — READ FIRST (don't repeat)

These files are in `audit-output/`:

```
pcp-101-phase10-report.md
pcp-101-phase11-report.md
pcp-101-phase12-report.md
pcp-101-phase12-wrapup.md
pcp-101-phase13-report.md
pcp-101-phase14-{backend,frontend,checkout,audit}-report.md
pcp-101-phase14-master-report.md
```

If you find an issue already covered, skip it. Look for what is NOT in them.

---

## Project context

### Tech
- Next.js 14 App Router (`src/app/api/v1/...`, `src/app/api/admin/...`)
- PostgreSQL via `pg` library (`src/lib/db.ts` exports `pool` and `query`)
- Auth: cookie-based `customer_session` + `admin_session` + JWT for vendor
- CSRF: `csrf_token` cookie + `x-csrf-token` header (middleware)
- Rate limiting: `src/lib/rate-limit.ts` + `src/lib/request-ip.ts`
- Payments: Moyasar + Tamara + Cash on Delivery
- Ledger: `payment_events` table (wired, no live webhooks yet)

### Live credentials (env vars in `.env`)

```
DATABASE_URL=postgresql://citymarket_user:***@citymarket-db:5432/citymarket_db
TWILIO_ACCOUNT_SID=AC***REDACTED***
TWILIO_VERIFY_SERVICE_SID=VA***REDACTED***
TWILIO_AUTH_TOKEN=***
MOYASAR_PUBLISHABLE_KEY=***
MOYASAR_SECRET_KEY=***
MOYASAR_WEBHOOK_SECRET=***
```

### Container layout

```
docker compose ps
city-market-app-citymarket-app-1   (Next.js, port 3005)
city-market-app-citymarket-worker-1  (BullMQ workers, no port)
citymarket-db                       (PostgreSQL 16 + pgvector)
```

### Test commands

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
npx vitest run src/app/api/v1/employment   # specific file
curl -i http://localhost:3005/api/health
```

---

## What to look for (per category, deeper than Phase 14)

### P0 / P1 — Critical security (must find at least 2 per agent)

- **IDOR** — endpoints that check auth but not ownership
  (e.g. user A can read/modify user B's cart, orders, addresses)
- **Mass assignment** — POST/PATCH bodies that spread into UPDATE
  without field allowlist
- **Webhook auth gaps** — payment webhooks accepting unsigned
  requests on alternate paths
- **Privilege escalation** — admin endpoints accessible via
  customer cookies, vendor endpoints accessible via admin
- **SSRF** — any URL fetched server-side that takes user input
- **Insecure deserialization** — JSON.parse on untrusted nested
  objects, eval on cookie values
- **Cache poisoning** — server-side cache keyed without user
  identity returning other users' data
- **Open redirects** — `redirect()` with user-controlled URLs
- **Session fixation** — session ID not rotated on login

### P2 — Security + reliability (must find at least 3 per agent)

- **Pagination bypass** — `?limit=999999` returning all rows
  (use the `parsePagination` helper from `src/lib/api/pagination.ts`)
- **CSRF gaps on new endpoints** — POST endpoints added since
  Phase 12 not in CSRF check
- **Rate limit gaps on new endpoints** — POST endpoints added
  since Phase 14 not in rate limit
- **Token rotation gaps** — credential changes not bumping
  `token_version`
- **N+1 queries** — `for` loops with `await query()` inside
- **Missing input validation** — Zod schemas absent or too
  permissive (especially numeric bounds, string length)
- **Error response leaks** — stack traces in 500 responses
- **Cookie security** — missing `secure`, `sameSite`, `httpOnly`
- **Soft-delete bypass** — queries that don't filter
  `WHERE deleted_at IS NULL`
- **File upload gaps** — magic bytes check, file size limits,
  path traversal in `filename`

### P3 — Quality / cleanup (must find at least 3 per agent)

- **Dead code** — unused exports, unreachable branches
- **TODO comments** — anything that's been "TODO" for >2 phases
- **Type safety** — `any` casts in route handlers
- **Test coverage** — new endpoints without `route.test.ts`
- **Performance** — missing pagination, missing index hints
- **Memory** — listeners not removed, timers not cleared
- **i18n** — Arabic strings hardcoded in API responses instead
  of using the message catalog
- **Accessibility** — missing alt text, ARIA labels, focus
  management, keyboard nav

---

## Skills each agent MUST load (start here)

### Backend agent → load `api-contract-drift-audit` and `requesting-code-review`

```bash
# After waking up, before doing any work:
# 1. Load the skill:
hermes skill_view api-contract-drift-audit
hermes skill_view requesting-code-review

# 2. Follow the skill's procedure step by step.
# 3. Only after the skill is exhausted should you do your own exploration.
```

The `api-contract-drift-audit` skill finds routes that have changed
shape (params removed, response fields renamed) but callers weren't
updated. Phase 14 didn't catch this. The `requesting-code-review`
skill has the security gate checklist for pre-commit review — run it
on the recent Phase 14 diff first to find what slipped through.

### Frontend agent → load `dogfood` and `inspecting-hermes-desktop-dom`

```bash
hermes skill_view dogfood
hermes skill_view inspecting-hermes-desktop-dom
```

`dogfood` is exploratory QA: actually click through the live app, find
broken states, capture evidence. Use it against
`http://localhost:3005/` — try every page, every button, every form
on a fresh user session. Don't just read code; the bugs are in the
runtime behaviour, not the source. The `inspecting-hermes-desktop-dom`
skill reads live DOM/CSS for visual issues.

### Checkout agent → load `systematic-debugging` and `test-driven-development`

```bash
hermes skill_view systematic-debugging
hermes skill_view test-driven-development
```

`systematic-debugging` is the 4-phase root-cause procedure: understand
the bug BEFORE fixing it. Apply it to every order flow edge case.
`tD` enforces RED → GREEN → REFACTOR: write a failing test FIRST,
then fix. Don't write a fix and then a test that passes — the test
must come first.

### DB/Audit agent → load `codebase-inspection` and `spike`

```bash
hermes skill_view codebase-inspection
hermes skill_view spike
```

`codebase-inspection` uses pygount to count LOC per language per
directory — find the largest, most-changed files (most likely bug
hotspots). `spike` is for throwaway experiments: write a SQL query,
test it against the live DB, then decide if it's a real bug. Use it
to validate that a "missing index" theory is actually a slow query in
practice.

---

## Worktree workflow (unchanged from Phase 14)

```bash
cd /var/www/citymarkets.sa/city-market-app
git fetch origin
git worktree add .worktrees/wt-<agent>-phase15 -b phase15/<agent>-audit origin/main
cd .worktrees/wt-<agent>-phase15
# ... your work ...
git add -A
git commit -m "fix(...): PCP-XXX — short description"
git push origin phase15/<agent>-audit
# Do NOT merge to main — Lead agent does that
```

Branch names this phase:
- `phase15/citymarkets-backend`
- `phase15/citymarkets-frontend`
- `phase15/citymarkets-checkout`
- `phase15/citymarkets-audit`

---

## Deliverables

For each agent, leave a report at
`audit-output/pcp-101-phase15-<agent>-report.md` with:

1. **Skills loaded** — which skills, what they produced
2. **Findings** — every issue with PCP-143+ ID, title, severity,
   file path, reproduction, fix, commit hash
3. **Verified live** — for each fix, the live curl that confirms
   the bug is gone
4. **Skipped** — issues you considered but decided not to fix
   (with reasoning)
5. **Test results** — `tsc` + `vitest` output at the end
6. **Skill gaps** — what the skills DIDN'T catch that you found
   manually (so the next phase can fix the skills)

The Lead agent's final report aggregates all 4 into
`audit-output/pcp-101-phase15-master-report.md`.

---

## Constraints (unchanged)

- Do NOT rotate MiniMax API key (manual user action)
- Do NOT touch Twilio Geo Permissions (manual user action)
- Do NOT touch aqar.labs.sa (separate project)
- Stay within `/var/www/citymarkets.sa/city-market-app/`
- No breaking changes without strong justification
- Backwards-compatible migrations only — no DROP COLUMN
  without first deprecating in app code
- Each agent works in their own worktree — no shared branches

---

## When you're done

Push your branch and report:
1. Branch name
2. Number of fixes
3. New PCP IDs assigned (PCP-143+)
4. Commit hashes
5. `tsc` + `vitest` final results
6. Which skills you loaded and what they caught vs missed
7. Anything you couldn't fix and why

The Lead agent merges all 4 branches into `main` after each is
verified live. Do not self-merge.

---

## Expected timeline

- 4 agents in parallel
- Each agent: ~60-90 minutes (deeper than Phase 14)
- Lead merge + verify: ~20 minutes
- Deploy: ~10 minutes
- **Total: ~1.5-2 hours wall clock**

## Success criteria

- ≥10 new PCPs fixed (across all 4 agents)
- All fixes live-verified
- main is at a new sha with all changes
- Production image is fresh
- tsc + vitest green
- Master report committed
- Each agent's report includes a "skill gaps" section
