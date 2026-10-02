# Paperclip Task Payload — Phase 15 Deep Audit

## Common context (sent to every agent)

```json
{
  "project": "citymarkets.sa (أسواق سيتي)",
  "working_dir": "/var/www/citymarkets.sa/city-market-app",
  "stack": "Next.js 14 + TypeScript + PostgreSQL + Docker",
  "current_main": "e6e698e",
  "current_image": "e416e2310865",
  "phase14_commits": [
    "d32325d Merge phase14/citymarkets-audit into main",
    "5b4b475 Merge phase14/checkout-audit into main",
    "aad9599 Merge phase14/citymarkets-frontend into main",
    "2200d3b Merge phase14/citymarkets-backend into main"
  ],
  "previous_audits": [
    "audit-output/pcp-101-phase10-report.md",
    "audit-output/pcp-101-phase11-report.md",
    "audit-output/pcp-101-phase12-report.md",
    "audit-output/pcp-101-phase12-wrapup.md",
    "audit-output/pcp-101-phase13-report.md",
    "audit-output/pcp-101-phase14-{backend,frontend,checkout,audit}-report.md",
    "audit-output/pcp-101-phase14-master-report.md"
  ],
  "rules": [
    "Read previous audit reports FIRST — don't repeat their findings",
    "Each fix must be backed by a real test or live curl",
    "tsc clean + vitest pass required before commit",
    "No mock data, no fabricated results",
    "Use worktree-per-run: git worktree add .worktrees/wt-<name>-phase15 -b phase15/<name>-audit origin/main",
    "New PCP IDs start at PCP-143",
    "Push branch to origin, do NOT merge to main (Lead agent does that)",
    "Load the skills listed in your payload BEFORE doing any work",
    "Document what the skills caught vs missed in your report"
  ],
  "test_commands": {
    "typecheck": "npx tsc --noEmit -p tsconfig.json",
    "tests": "npx vitest run",
    "single_test": "npx vitest run src/app/api/v1/employment",
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

## Agent 1: Backend Audit (DEEP)

**Skills to load FIRST:**
- `api-contract-drift-audit` — find routes whose shape changed but callers weren't updated
- `requesting-code-review` — security gate checklist for pre-commit review

```json
{
  "agent_id": "74dbc25f-41f9-42cb-9b8d-f73492f0cbcb",
  "agent_name": "citymarkets-backend",
  "task_title": "Phase 15 — Backend Deep Audit (skill-driven)",
  "branch": "phase15/citymarkets-backend",
  "worktree": ".worktrees/wt-citymarkets-backend-phase15",
  "goal": "Find and fix P0/P1/P2 issues in src/app/api/ and src/lib/ using api-contract-drift-audit + requesting-code-review skills",
  "skill_load_order": [
    "1. hermes skill_view api-contract-drift-audit",
    "2. hermes skill_view requesting-code-review",
    "3. Read ALL Phase 10-14 audit reports",
    "4. Map every route handler in src/app/api/ → list params + response shape",
    "5. Find every frontend caller of each route → check for drift",
    "6. Apply the security gate checklist from requesting-code-review to the Phase 14 diff"
  ],
  "focus_areas": [
    "IDOR — endpoints that check auth but not ownership (cart, orders, addresses)",
    "Mass assignment — POST/PATCH bodies that spread into UPDATE without field allowlist",
    "CSRF gaps on POST endpoints added since Phase 12",
    "Rate limit gaps on POST endpoints added since Phase 14",
    "Token rotation gaps — any credential change not bumping token_version",
    "Webhook auth — payment webhooks on alternate paths",
    "Privilege escalation — admin endpoints accessible via customer cookies",
    "N+1 queries — for loops with await query() inside",
    "Missing input validation — Zod schemas absent or too permissive",
    "Soft-delete bypass — queries that don't filter WHERE deleted_at IS NULL",
    "File upload gaps — magic bytes check, file size limits, path traversal"
  ],
  "minimum_findings": "≥5 fixes (Phase 14 found 9, expect to find similar or more)",
  "deliverable": "audit-output/pcp-101-phase15-backend-report.md",
  "skill_gaps_section": "Required — list which skill didn't catch what you found manually",
  "report_to_lead_at_end": true
}
```

---

## Agent 2: Frontend Audit (DEEP)

**Skills to load FIRST:**
- `dogfood` — exploratory QA, actually click through the live app
- `inspecting-hermes-desktop-dom` — read live DOM/CSS for visual issues

```json
{
  "agent_id": "861fae1a-edbf-46fa-824e-a0c08e04f4ce",
  "agent_name": "citymarkets-frontend",
  "task_title": "Phase 15 — Frontend Deep Audit (skill-driven)",
  "branch": "phase15/citymarkets-frontend",
  "worktree": ".worktrees/wt-citymarkets-frontend-phase15",
  "goal": "Find and fix frontend bugs by actually USING the app via dogfood + inspecting live DOM",
  "skill_load_order": [
    "1. hermes skill_view dogfood",
    "2. hermes skill_view inspecting-hermes-desktop-dom",
    "3. Read ALL Phase 10-14 audit reports (esp. Phase 14 frontend)",
    "4. Spin up the live app at http://localhost:3005/ if not already running",
    "5. Click through every page, every button, every form on a fresh user session",
    "6. Document each broken state with curl + screenshot evidence",
    "7. Use the DOM inspection skill to find CSS/ARIA issues"
  ],
  "focus_areas": [
    "Open redirects — redirect() with user-controlled URLs",
    "XSS via DOM clobbering — names that conflict with window globals",
    "Cache poisoning — server-side caches keyed without user identity",
    "Cookie security — missing secure/sameSite/httpOnly",
    "RTL layout bugs in Arabic locales",
    "iOS/Android-specific bugs in app-shell components",
    "Form validation — client-side only without server-side mirror",
    "Loading states — buttons not disabled during async",
    "Race conditions in client-side state",
    "Memory leaks — useEffect without cleanup",
    "Bundle size — heavy imports that could be dynamic",
    "Accessibility — missing alt text, ARIA labels, focus management, keyboard nav",
    "PWA / service worker — stale caches after deploy",
    "Image lazy loading — above-fold images not eager-loaded"
  ],
  "minimum_findings": "≥3 fixes",
  "deliverable": "audit-output/pcp-101-phase15-frontend-report.md",
  "skill_gaps_section": "Required — what dogfood missed that you found manually",
  "report_to_lead_at_end": true
}
```

---

## Agent 3: Checkout / Payments Audit (DEEP)

**Skills to load FIRST:**
- `systematic-debugging` — 4-phase root cause debugging
- `test-driven-development` — RED → GREEN → REFACTOR

```json
{
  "agent_id": "ecbf9014-3f71-47df-8ab6-c4d1e34990a7",
  "agent_name": "citymarkets-checkout",
  "task_title": "Phase 15 — Checkout Deep Audit (skill-driven)",
  "branch": "phase15/citymarkets-checkout",
  "worktree": ".worktrees/wt-citymarkets-checkout-phase15",
  "goal": "Find and fix checkout/payment bugs using systematic-debugging + TDD",
  "skill_load_order": [
    "1. hermes skill_view systematic-debugging",
    "2. hermes skill_view test-driven-development",
    "3. Read ALL Phase 10-14 audit reports (esp. Phase 14 checkout + Phase 13 PCP-120)",
    "4. For each finding: follow the 4 phases (reproduce → isolate → understand → fix)",
    "5. For each fix: write the failing test FIRST, then make it pass"
  ],
  "focus_areas": [
    "Order creation race conditions — concurrent /checkout calls (PCP-120 follow-ups)",
    "Payment status transitions — invalid state changes (e.g. paid → unpaid)",
    "Idempotency key handling — collisions, weak entropy, replay windows",
    "Moyasar/Tamara webhook idempotency on retry storms",
    "Refund flow — partial refunds, refund-then-cancel order, audit trail",
    "Cart pricing — discount stacking, max redemption, expired coupon edge cases",
    "Order ownership — guests vs users, session-key leakage, session expiry mid-checkout",
    "Payment events ledger — gaps in write path, missed events",
    "Loyalty points — double-spend, race conditions, refund-resets-points",
    "Coupon code reuse — single-use enforcement, time-bound enforcement",
    "Address resolution — current vs default, ownership, deleted-but-referenced",
    "Order total calculation — rounding errors, currency conversion edge cases",
    "Order cancellation — partial fulfillment, customer cancel mid-vendor-accept",
    "Tip / donation handling — does it reach the right party"
  ],
  "minimum_findings": "≥3 fixes",
  "deliverable": "audit-output/pcp-101-phase15-checkout-report.md",
  "skill_gaps_section": "Required — which systematic-debugging phase broke for you",
  "report_to_lead_at_end": true
}
```

---

## Agent 4: Database + Migrations Audit (DEEP)

**Skills to load FIRST:**
- `codebase-inspection` — pygount LOC per language, find bug hotspots
- `spike` — throwaway experiments to validate theories

```json
{
  "agent_id": "2776d3c4-b723-48bb-a479-4fbaa56757ac",
  "agent_name": "citymarkets-audit",
  "task_title": "Phase 15 — Database Deep Audit (skill-driven)",
  "branch": "phase15/citymarkets-audit",
  "worktree": ".worktrees/wt-citymarkets-audit-phase15",
  "goal": "Find and fix DB schema/migration/query issues using codebase-inspection + spike",
  "skill_load_order": [
    "1. hermes skill_view codebase-inspection",
    "2. hermes skill_view spike",
    "3. Read ALL Phase 10-14 audit reports (esp. Phase 14 audit)",
    "4. Run pygount to find the largest, most-changed files (bug hotspots)",
    "5. For each 'is this slow?' theory: write a spike query, run it, measure"
  ],
  "focus_areas": [
    "Missing indexes — EXPLAIN ANALYZE on the top-20 most-queried endpoints",
    "Sequential scans on large tables (orders, products, vendor_products, users)",
    "Foreign key constraints without ON DELETE behavior (or with default RESTRICT)",
    "RLS policy gaps — tables missing policies, or policies that don't cover the access path",
    "Migration ordering — dependencies between files (FK references to non-existent tables)",
    "Migration idempotency — re-runnable scripts, IF NOT EXISTS",
    "Soft-delete vs hard-delete — referential integrity, cascade order",
    "Column type mismatches — money as float, phone as text without E.164 normalization",
    "Constraint violations — UNIQUE on nullable columns, CHECK constraints that allow garbage",
    "Table bloat — unused columns, denormalization that drifted",
    "Query plan regressions — comparing EXPLAIN before/after Phase 14 changes",
    "Connection pool exhaustion — long-running queries, missing timeouts"
  ],
  "minimum_findings": "≥2 fixes",
  "deliverable": "audit-output/pcp-101-phase15-audit-report.md",
  "skill_gaps_section": "Required — what codebase-inspection didn't reveal that you found",
  "report_to_lead_at_end": true
}
```

---

## Lead Agent — Final aggregation

```json
{
  "agent_id": "64ed9ca3-70c9-4eb7-9b81-5dc748ca6e5c",
  "agent_name": "citymarkets.sa",
  "task_title": "Phase 15 — Lead coordination + skill-effectiveness report",
  "goal": "Wait for the 4 specialist agents, merge their branches, write the master report with a new section on SKILL EFFECTIVENESS",
  "wait_for_agents": [
    "phase15/citymarkets-backend",
    "phase15/citymarkets-frontend",
    "phase15/citymarkets-checkout",
    "phase15/citymarkets-audit"
  ],
  "merge_strategy": "fast-forward main to each branch in sequence, verify tsc+vitest after each merge, only proceed if clean",
  "deliverable": "audit-output/pcp-101-phase15-master-report.md",
  "extra_sections_required": [
    "## Skill effectiveness",
    "For each skill loaded this phase, document:",
    "- What it caught (with PCP numbers)",
    "- What it missed (with examples from any agent's report)",
    "- Recommendation: keep, fix, or replace"
  ],
  "deploy_after_merge": true
}
```

---

## Paperclip API call to start (use Hermes's terminal with curl)

```bash
# 1. Login to Paperclip
curl -X POST http://179.198.212.32:3100/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"__BOOTSTRAP_EMAIL__","password":"__BOOTSTRAP_PASSWORD__"}'

# 2. Get the session cookie and use it to dispatch each agent.
# See audit-output/pcp-101-phase14-paperclip-payloads.md for the
# canonical wakeup body. Each new issue must include:
#   payload: { issueId, taskId, projectId }
# so the Hermes adapter wires PAPERCLIP_TASK_ID correctly.
```

---

## Expected timeline

- 4 agents in parallel: ~60-90 minutes each
- Lead merge + verify: ~20 minutes
- Deploy: ~10 minutes
- **Total: ~1.5-2 hours wall clock**

## Success criteria

- ≥10 new PCPs fixed (across all 4 agents)
- All fixes live-verified
- main is at a new sha with all changes
- Production image is fresh
- tsc + vitest green
- Master report includes "Skill effectiveness" section
- Each agent's report includes "Skill gaps" section
- Total Phase 15 PCP count is published in the master report
