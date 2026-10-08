# Paperclip Task Payload — Phase 14 Full System Audit

## Common context (sent to every agent)

```json
{
  "project": "citymarkets.sa (أسواق سيتي)",
  "working_dir": "/var/www/citymarkets.sa/city-market-app",
  "stack": "Next.js 14 + TypeScript + PostgreSQL + Docker",
  "current_main": "c1e78dd",
  "current_image": "bd2289a4b162",
  "previous_audits": [
    "audit-output/pcp-101-phase10-report.md",
    "audit-output/pcp-101-phase11-report.md",
    "audit-output/pcp-101-phase12-report.md",
    "audit-output/pcp-101-phase12-wrapup.md",
    "audit-output/pcp-101-phase13-report.md"
  ],
  "rules": [
    "Read previous audit reports FIRST — don't repeat their findings",
    "Each fix must be backed by a real test or live curl",
    "tsc clean + vitest pass required before commit",
    "No mock data, no fabricated results",
    "Use worktree-per-run: git worktree add .worktrees/wt-<name>-phase14 -b phase14/<name>-audit origin/main",
    "New PCP IDs start at PCP-134",
    "Push branch to origin, do NOT merge to main (Lead agent does that)"
  ],
  "test_commands": {
    "typecheck": "npx tsc --noEmit -p tsconfig.json",
    "tests": "npx vitest run",
    "live_health": "curl -i http://localhost:3005/api/health"
  },
  "out_of_scope": [
    "MiniMax API key rotation",
    "Twilio Geo Permissions",
    "aqar.labs.sa"
  ]
}
```

---

## Agent 1: Backend Audit

```json
{
  "agent_id": "2776d3c4-b723-48bb-a479-4fbaa56757ac",
  "agent_name": "Audit Agent (Backend focus)",
  "task_title": "Phase 14 — Backend Security Audit",
  "branch": "phase14/backend-audit",
  "worktree": ".worktrees/wt-backend-phase14",
  "goal": "Find and fix P0/P1/P2 issues in src/app/api/ and src/lib/",
  "focus_areas": [
    "Authentication bypass — POST endpoints without requireAuth/requireAdminApi",
    "Authorization gaps — endpoints that check auth but not ownership",
    "SQL injection — string concatenation in queries",
    "CSRF gaps — state-changing endpoints missing from middleware",
    "Rate limit gaps — POST endpoints without checkRateLimit",
    "Token rotation gaps — credential changes that don't bump token_version",
    "Race conditions — multi-step writes without transactions/FOR UPDATE",
    "N+1 queries — for loops with await query()",
    "Webhook auth — /api/v1/payments/*/webhook accepting unauth",
    "Cryptographic failures — MD5/SHA1, missing timingSafeEqual"
  ],
  "deliverable": "audit-output/pcp-101-phase14-backend-report.md",
  "report_to_lead_at_end": true
}
```

---

## Agent 2: Frontend Audit

```json
{
  "agent_id": "861fae1a-edbf-46fa-824e-a0c08e04f4ce",
  "agent_name": "Frontend Agent",
  "task_title": "Phase 14 — Frontend + UX Audit",
  "branch": "phase14/frontend-audit",
  "worktree": ".worktrees/wt-frontend-phase14",
  "goal": "Find and fix frontend bugs in src/components/, src/app/ (pages), and client-side handlers",
  "focus_areas": [
    "XSS — dangerouslySetInnerHTML without sanitization",
    "Open redirects — redirect() with user-controlled URLs",
    "Cookie security — missing secure/sameSite/httpOnly",
    "Cache poisoning — server-side caches keyed without user identity",
    "Missing rel=noopener noreferrer on target=_blank links",
    "iOS/Android-specific bugs in app-shell components",
    "RTL layout bugs in Arabic locales",
    "Form validation — client-side only without server-side mirror",
    "Loading states — buttons not disabled during async",
    "Race conditions in client-side state",
    "Memory leaks — useEffect without cleanup",
    "Bundle size — heavy imports that could be dynamic"
  ],
  "deliverable": "audit-output/pcp-101-phase14-frontend-report.md",
  "report_to_lead_at_end": true
}
```

---

## Agent 3: Checkout / Payments Audit

```json
{
  "agent_id": "ecbf9014-3f71-47df-8ab6-c4d1e34990a7",
  "agent_name": "Checkout Agent",
  "task_title": "Phase 14 — Checkout + Payments Audit",
  "branch": "phase14/checkout-audit",
  "worktree": ".worktrees/wt-checkout-phase14",
  "goal": "Find and fix issues in the order/checkout/payment pipeline",
  "focus_areas": [
    "Order creation race conditions — concurrent /checkout calls",
    "Payment status transitions — invalid state changes",
    "Idempotency key handling — collisions, weak entropy",
    "Moyasar/Tamara webhook idempotency",
    "Refund flow — rate limit, audit trail, RBAC",
    "Cart pricing — discount stacking, max redemption",
    "Order ownership — guests vs users, session-key leakage",
    "Payment events ledger — gaps in write path",
    "Loyalty points — double-spend, race conditions",
    "Coupon code reuse — single-use enforcement",
    "Address resolution — current vs default, ownership",
    "Order total calculation — rounding, currency conversion"
  ],
  "deliverable": "audit-output/pcp-101-phase14-checkout-report.md",
  "report_to_lead_at_end": true
}
```

---

## Agent 4: Database + Migrations Audit

```json
{
  "agent_id": "74dbc25f-41f9-42cb-9b8d-f73492f0cbcb",
  "agent_name": "Backend Agent",
  "task_title": "Phase 14 — Database + Migrations Audit",
  "branch": "phase14/db-audit",
  "worktree": ".worktrees/wt-db-phase14",
  "goal": "Find and fix DB schema, migration, and query issues",
  "focus_areas": [
    "Missing indexes — EXPLAIN ANALYZE on list endpoints",
    "Sequential scans on large tables",
    "Foreign key constraints without ON DELETE behavior",
    "RLS policy gaps — tables missing policies",
    "Migration ordering — dependencies between files",
    "Migration idempotency — re-runnable scripts",
    "Soft-delete vs hard-delete — referential integrity",
    "Column type mismatches — money as float, phone as text",
    "Constraint violations — UNIQUE on nullable columns",
    "Table bloat — unused columns, denormalization issues"
  ],
  "deliverable": "audit-output/pcp-101-phase14-db-report.md",
  "report_to_lead_at_end": true
}
```

---

## Lead Agent — Final aggregation

```json
{
  "agent_id": "64ed9ca3-70c9-4eb7-9b81-5dc748ca6e5c",
  "agent_name": "Lead Agent",
  "task_title": "Phase 14 — Lead coordination + final report",
  "goal": "Coordinate 4 audit agents, merge their branches, write master report",
  "wait_for_agents": [
    "phase14/backend-audit",
    "phase14/frontend-audit",
    "phase14/checkout-audit",
    "phase14/db-audit"
  ],
  "merge_strategy": "fast-forward main to each branch in sequence, verify tsc+vitest after each merge, only proceed if clean",
  "deliverable": "audit-output/pcp-101-phase14-master-report.md",
  "deploy_after_merge": true
}
```

---

## Paperclip API call to start (use Hermes's terminal with curl)

```bash
# 1. Authenticate
curl -X POST http://179.198.212.32:3100/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"__BOOTSTRAP_EMAIL__","password":"__BOOTSTRAP_PASSWORD__"}'

# 2. Get session cookie, then dispatch each agent:
curl -X POST http://179.198.212.32:3100/api/tasks \
  -H "Content-Type: application/json" \
  -H "Cookie: $SESSION" \
  -d '{
    "agentId": "2776d3c4-b723-48bb-a479-4fbaa56757ac",
    "title": "Phase 14 — Backend Security Audit",
    "description": "<contents of audit-output/pcp-101-phase14-paperclip-prompt.md>",
    "payload": {
      "issueId": "PCP-134",
      "taskId": "phase14-backend",
      "context": "Read audit-output/pcp-101-phase10-report.md through phase13 first. Find what is NOT in them.",
      "branch": "phase14/backend-audit"
    }
  }'
```

---

## Expected timeline

- 4 agents in parallel
- Each agent: ~30-60 minutes
- Lead merge + verify: ~15 minutes
- Deploy: ~10 minutes (build + restart)
- **Total: ~1 hour wall clock**

## Success criteria

- ≥10 new PCPs found and fixed (across all 4 agents)
- All fixes live-verified
- main is at a new sha with all changes
- Production image is fresh
- tsc + vitest green
- Master report committed to `audit-output/pcp-101-phase14-master-report.md`
