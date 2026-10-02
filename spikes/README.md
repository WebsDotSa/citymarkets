# Phase 15 — Database Deep Audit (spike plan)

Following the `spike` skill: each theory becomes a spike → research →
query → measure → verdict. New PCPs start at PCP-143.

| # | Spike | Theory (Given/When/Then) | Risk | Status |
|---|-------|--------------------------|------|--------|
| 001 | seq-scans-on-fk-cascade | Given a parent UPDATE/DELETE, when planner checks FK, then no table should seq-scan | High (correctness + perf) | done → PCP-143 |
| 002 | duplicate-or-redundant-indexes | Given the schema, when comparing every index's leading column to other indexes on the same table, then 0 should be subsumed (waste) | Med (write-amp) | done → PCP-144 |
| 003 | soft-delete-bypass-orphans | Given tables with `deleted_at`, when an app does an UPDATE on the parent row, then child rows that have hard FK RESTRICT to it should still resolve | Med (data integrity) | done → PCP-145 |
| 004 | unindexed-soft-delete-filters | Given every `WHERE deleted_at IS NULL` predicate, when the planner runs it, then an index on `deleted_at` (or partial index) should exist if the table is large | Low (perf) | done → DISPROVED |
| 005 | trigger-bloat-and-stale-procs | Given the schema, when listing triggers + functions, then no dead ones; runtime cost acceptable | Low | done → DISPROVED |
| 006 | rls-policy-gaps | Given 21 tables without RLS, when the app uses `citymarket_user` role, then those that hold user-private data must have RLS or be owned by `postgres` | Med (security) | done → PCP-146 |
| 007 | migration-checksum-drift | Given 98/121 app_migrations rows have placeholders, when the runner compares against current files, then 98 should report drift | High (runner) | done → PCP-147 |
| 008 | column-type-mismatches | Given text cols storing UUIDs/ints/dates, when the app does a filter, then either the index is unusable or there's a coercion cost | Med | done → DISPROVED |
| 009 | table-bloat-and-vacuum | Given any table >100k rows, when checking bloat + dead-tuple ratio, then no live table should be >50% bloat | Low | done → DISPROVED |
| 010 | page_views-bloat-append-only | Given `page_views` is 5MB write-heavy, when checking growth + index count, then partitioning or retention is missing | Med | done → PCP-148 |

Each spike: `spikes/00X-name/README.md` with: question, query, raw output, verdict, fix recommendation.
