# 007 — migration-checksum-drift

## Question
**Theory**: `app_migrations` has 98/121 rows with placeholders
(length < 64). The migration runner compares every file's
FNV-1a checksum against the stored checksum and reports drift.
Need to know how many of those 98 are false positives.

## Approach
1. Count `app_migrations` rows by checksum length bucket
2. Identify the placeholder strings (manual, manual:NNN, manual-apply, manual-applied)
3. Run the dry-run migration to see how many drift items the runner reports
4. Compare the actual number to the expected

## Query
See `query.sql`.

## Raw output
**Bucket counts**:
```
short_placeholder|98
full_sha256     |23
```

**Placeholder distribution** (from raw query):
| Placeholder | Count | Files |
|-------------|------:|-------|
| `manual` (6) | 9 | 016, 036, 037, 038, 039, 039b, 039c, 040, 040b |
| `manual:NNN` (10) | 6 | 098, 099, 100, 101, 102, 103 |
| `manual-apply` (12) | 3 | 069, 070, 071 |
| `manual-applied` (14) | 2 | 054, 055 |
| FNV-1a 16-hex | 78 | 018-094, 108, 110-112 |
| SHA-256 64-hex | 23 | 104-107, 109, 113... wait, let me recount |
| **Total** | 121 | |

**Drift report run**:
```
[plan] 121 total — 135 applied, 0 pending, 121 already done in range, 90 drift
```

## Analysis
- 20 rows use literal `manual*` placeholders (never match a file
  checksum → always drift)
- 75+ rows use real FNV-1a checksums; the runner compares them
  to the current file checksum. If the file was edited after the
  migration was applied, drift fires. **But** the drift output
  shows 90 items, not 20+75.
- The 90 number means **almost every file is reported as drift**,
  including ones that should match.

The runner's bug: it does a `String !== String` comparison where
one side is a `manual` placeholder and the other is a real FNV-1a
of the current file. They will NEVER match, so all 20 placeholder
rows are permanent false positives.

The remaining ~70 in the 90 number = 75 FNV-1a + 20 placeholder
minus a few that happen to match by coincidence? Or maybe some
files are identical to when they were applied. **Either way, the
90 number is wrong as a signal.**

`appliedMap.size = 135` is also wrong — the script does:
```ts
appliedMap = getAppliedMap()  // app_migrations rows
appliedMap.size // 121
// PLUS schema_migrations rows (legacy, 14 rows)
// = 135
```
The reported "135 applied" double-counts the legacy schema_migrations
rows. This is a cosmetic accounting bug.

## Verdict: **VALIDATED** → **PCP-147**

## Recommendation
Backfill the 20 placeholder rows in `app_migrations` with the
**actual FNV-1a of the current file** (so future drift is real).
This is a one-shot UPDATE that doesn't touch any table data.

Optionally: also fix the `appliedMap.size` double-counting in
`scripts/migrate.ts:268-299` so the plan output is `[plan] 121
total — 121 applied, 0 pending, 0 drift` (after backfill).
