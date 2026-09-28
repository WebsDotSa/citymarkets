# City Markets — Database Migration Plan

## Process
1. Backup production.
2. Compare actual production schema with tracked migrations.
3. Identify drift/manual SQL/untracked columns.
4. Produce canonical ERD.
5. Classify every table/column: keep, migrate, deprecate, remove.
6. Create forward migrations.
7. Backfill and verify counts/checksums.
8. Add constraints after data is clean.
9. Review indexes/queries.
10. Retire legacy objects after a deprecation window.

## Data checks
- duplicate products/SKUs
- orphan order items
- vendor ownership mismatch
- duplicate payment references
- loyalty double-entry
- coupon usage mismatch
- negative inventory
- invalid status transitions
- order/payment inconsistencies

## Rule
Do not destructively “rollback” production data without a verified restore path.
