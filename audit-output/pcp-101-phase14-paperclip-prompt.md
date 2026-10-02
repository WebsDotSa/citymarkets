# Phase 14 — Full System Audit via Paperclip Agents

**Trigger:** 2026-10-02
**Project:** citymarkets.sa (أسواق سيتي)
**Working dir:** `/var/www/citymarkets.sa/city-market-app`
**Stack:** Next.js 14 (App Router) + TypeScript + PostgreSQL + Tailwind + Docker

---

## Mission

Find and fix ALL remaining production bugs in citymarkets.sa. The system
has had 13 audit phases (PCP-100 through PCP-133) that fixed or documented
68 issues. We need a fresh pair of eyes to find what was missed.

**Do NOT repeat findings from the previous audit reports.** Read them
FIRST, then look for what is NOT in them.

**Hard rules:**
- NO mock data, NO fabricated results. Every fix must be backed by a
  real test or live curl that demonstrates the bug is fixed.
- If you find a real bug, fix it in a worktree and push. Do NOT just
  document it.
- If you can't reproduce or fix, mark it as "could not reproduce" with
  exact reproduction steps.
- Every commit must compile (`tsc` clean) and pass `vitest`.

---

## Phase history — READ FIRST

These files are in `audit-output/`:
- `pcp-101-phase10-report.md` (PCP-115, 116, 118, 120, 121, 122)
- `pcp-101-phase11-report.md` (PCP-119, 123, 124, 125, 126, 127)
- `pcp-101-phase12-report.md` (PCP-115, 121, 127)
- `pcp-101-phase12-wrapup.md` (PCP-128, 129, 130, 131, 132, 133)
- `pcp-101-phase13-report.md` (PCP-116, 120, 122, 126)

If you find an issue that's already covered in these reports, skip it.
Look for what is NOT in them.

---

## Project context

### Tech
- Next.js 14 App Router (`src/app/api/v1/...`, `src/app/api/admin/...`)
- PostgreSQL via `pg` library (`src/lib/db.ts` exports `pool` and `query`)
- Drizzle for some migrations but most are hand-rolled SQL in `migrations/`
- Auth: cookie-based `customer_session` (customer) + `admin_session` (admin)
  + JWT for vendor. See `src/lib/identity/`
- CSRF: `csrf_token` cookie + `x-csrf-token` header. Enforced by
  `src/middleware.ts` for state-changing requests.
- Rate limiting: `src/lib/rate-limit.ts` + `src/lib/request-ip.ts`
  (in-memory bucket; defaults are per-user + per-IP)
- Payments: Moyasar (primary) + Tamara (BNPL) + Cash on Delivery
  Ledger: `payment_events` table (wired but no live webhooks yet)

### Live credentials (env vars in `.env`)

```
DATABASE_URL=postgresql://citymarket_user:***@citymarket-db:5432/citymarket_db
TWILIO_ACCOUNT_SID=AC***d1294fbdc984103a217907c0406
TWILIO_VERIFY_SERVICE_SID=VA***e82a70757c3826969749872c69e7
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
# Type check
npx tsc --noEmit -p tsconfig.json

# Run all tests
npx vitest run

# Run specific test file
npx vitest run src/app/api/v1/employment

# Live verification (port 3005)
curl -i http://localhost:3005/api/health
curl -i -X POST -H "Content-Type: application/json" \
  -d '{"full_name":"test","phone":"+966500000000","job_id":"delivery"}' \
  http://localhost:3005/api/v1/employment
```

---

## What to look for (categorized)

### P0 / P1 — Critical security

- **Authentication bypass** — endpoints that should require auth but
  don't (use `requireAuth()` for customer, `requireAdminApi(...)` for
  admin, `requireVendorSession()` for vendor)
- **Authorization bypass** — endpoints that check auth but not
  ownership (e.g. user A can read/modify user B's data)
- **SQL injection** — any string concatenation in SQL queries
  (`pool.query` with `+` operator, dynamic table/column names)
- **CSRF gaps** — POST endpoints missing from the middleware CSRF check
- **Open redirects** — `redirect()` calls with user-controlled URLs
- **XSS** — any `dangerouslySetInnerHTML` without sanitization
- **Path traversal** — file operations with user input
- **Webhook auth bypass** — `/api/v1/payments/*/webhook` routes
  accepting unauthenticated requests
- **Cryptographic failures** — MD5/SHA1 where SHA256/Bcrypt needed,
  constant-time comparison missing, hardcoded secrets

### P2 — Security + reliability

- **Rate limit gaps** — POST endpoints without rate limit (search
  for `export async function POST` and check the file has a
  `checkRateLimit` call)
- **Token rotation gaps** — credential changes (password, email,
  phone) that don't bump `token_version`
- **Race conditions** — multi-step DB writes outside transactions
  or with `UPDATE` without `FOR UPDATE`
- **N+1 queries** — `for` loops with `await query()` inside
- **Missing input validation** — Zod schemas absent or too permissive
- **Error response leaks** — stack traces in 500 responses
- **Cookie security** — missing `secure`, `sameSite`, or `httpOnly`
- **Cache poisoning** — cached responses that include user data
  keyed without user identity
- **Insecure CORS** — `Access-Control-Allow-Origin: *` on authed
  endpoints

### P3 — Quality / cleanup

- **Dead code** — unused exports, unreachable branches, dead routes
- **TODO comments** — anything that's been "TODO" for >1 phase
- **Inconsistent error messages** — same error returned in Arabic
  vs English across endpoints
- **Missing indexes** — `EXPLAIN ANALYZE` on list endpoints that
  seq-scan
- **Type safety** — `any` casts in route handlers
- **Test coverage** — new endpoints without `route.test.ts`

---

## Worktree workflow

Use the worktree-per-run pattern. Each agent picks a unique branch
name to avoid collisions:

```bash
# From /var/www/citymarkets.sa/city-market-app
git fetch origin
git worktree add .worktrees/wt-<agent>-phase14 -b phase14/<agent>-audit origin/main
cd .worktrees/wt-<agent>-phase14
# ... your work ...
git add -A
git commit -m "..."
git push origin phase14/<agent>-audit
# Open a PR to main OR fast-forward main directly
```

Branch names to use:
- `phase14/backend-audit`
- `phase14/frontend-audit`
- `phase14/checkout-audit`
- `phase14/audit-agent`

---

## How to find issues (concrete steps)

### 1. Read the previous reports

```bash
ls audit-output/
cat audit-output/pcp-101-phase13-report.md
# Make a list of issue types that were found
```

### 2. Grep for common anti-patterns

```bash
# Find POST endpoints without auth check
for f in $(grep -rln "export async function POST" src/app/api/ 2>/dev/null); do
  if ! grep -q "requireAuth\|requireAdminApi\|requireVendorSession\|getServerSession" "$f"; then
    if ! grep -q "checkRateLimit\|CONTROL\|CSRF_EXEMPT" "$f"; then
      echo "Possibly unauthenticated POST: $f"
    fi
  fi
done

# Find SQL injection candidates
grep -rn 'query.*+.*\${' src/app/api/ src/lib/ 2>/dev/null
grep -rn 'query.*\${' src/app/api/ src/lib/ 2>/dev/null

# Find files with `any` in route handlers
grep -rln "any" src/app/api/v1/ src/app/api/admin/ | head -20

# Find FOR UPDATE candidates (multi-step writes)
grep -rln "BEGIN\|await client.query" src/lib/ 2>/dev/null
```

### 3. Look at edge cases

- Empty body POST
- Unicode in user input
- Negative numbers in pagination
- Past dates in delivery windows
- Concurrent requests to the same resource
- Cookie tampering (different `userId` in body vs session)

### 4. Live-verify what you find

```bash
# Before the fix
curl -i -X POST http://localhost:3005/api/v1/some/endpoint
# Save the response

# After the fix
# Re-run, confirm the bug is gone
```

---

## Deliverables

For each agent's worktree, leave a report at
`audit-output/pcp-101-phase14-<agent>-report.md` with:

1. **Findings** — every issue with: ID (PCP-134+), title, severity,
   file path, reproduction steps, the fix you applied, commit hash
2. **Verified live** — for each fix, the live curl that confirms
   the bug is gone
3. **Skipped** — issues you considered but decided not to fix
   (with reasoning)
4. **Test results** — `tsc` + `vitest` output at the end

The Lead agent's final report aggregates all 4 into
`audit-output/pcp-101-phase14-master-report.md`.

---

## Constraints

- **Do NOT rotate MiniMax API key** — that's a manual user action
- **Do NOT touch Twilio Geo Permissions** — manual user action
- **Do NOT touch aqar.labs.sa** — separate project
- **Stay within `/var/www/citymarkets.sa/city-market-app/`** —
  do not modify other projects
- **No breaking changes** without strong justification
- **Backwards-compatible migrations only** — no DROP COLUMN
  without first deprecating in app code
- **Each agent works in their own worktree** — no shared branches

---

## When you're done

Push your branch and report:
1. Branch name
2. Number of fixes
3. New PCP IDs assigned (start at PCP-134)
4. Commit hashes
5. `tsc` + `vitest` final results
6. Anything you couldn't fix and why

The Lead agent merges all 4 branches into `main` after each is
verified live. Do not self-merge.
