# 010 — page_views-bloat-append-only

## Question
**Theory**: `page_views` is the largest table (5MB) and is
INSERT-only. Append-only tables benefit from BRIN indexes on
time, partitioning, and retention policies. Look at growth and
index health.

## Approach
1. Get row count, first/last hit, total size, heap vs index size
2. List all indexes
3. Check how the app queries it

## Query
See `query.sql`.

## Raw output
```
rows | first_hit | last_hit | total_size | heap | idx_size | days_with_data
7796 | 2026-07-25 20:12:53 | 2026-10-02 23:14:06 | 5072 kB | 2336 kB | 2696 kB | 64
```

**Indexes**:
```
page_views_pkey                | UNIQUE btree (id)
idx_page_views_device_time     | btree (device_type, occurred_at DESC) WHERE device_type IS NOT NULL
idx_page_views_event_time      | btree (event_type, occurred_at DESC)
idx_page_views_occurred        | btree (occurred_at DESC)
idx_page_views_path_time       | btree (path, occurred_at DESC)
idx_page_views_session         | btree (session_id)
idx_page_views_vendor_time     | btree (vendor_slug, occurred_at DESC) WHERE vendor_slug IS NOT NULL
uq_page_views_dedupe           | UNIQUE btree (path, session_id, time_bucket)
```

## Analysis
- 7,796 rows / 64 days → ~120 inserts/day
- Index-to-heap ratio is **1.15:1** (2.7 MB of indexes for 2.3 MB
  of data) — high
- 7 indexes for 7,796 rows — way too many for this size
- `idx_page_views_path_time` and `uq_page_views_dedupe` overlap:
  - `uq_page_views_dedupe` is UNIQUE on `(path, session_id, time_bucket)`
  - `idx_page_views_path_time` is non-unique on `(path, occurred_at DESC)`
  - Both serve "find a page view for this path" — the dedupe unique
    can also serve `WHERE path = $1` queries
- `idx_page_views_session` and `idx_page_views_event_time` /
  `idx_page_views_device_time` are all separate, but for 7,796 rows
  they're all tiny

The real question: is this table going to grow? At 120 inserts/day,
1 year = 44,000 rows = 28 MB. Index ratio 1.15x = 32 MB. Manageable.

But: a 5MB total table is NOT a "bloat" problem. The original
theory (index:heap > 1.0 is bad) is over-applied here.

## Verdict: **VALIDATED (minor)** → **PCP-148**

## Recommendation
**Add retention policy**: `page_views` is essentially analytics
data. After 90 days, no UI or admin page uses it. A nightly
`DELETE FROM page_views WHERE occurred_at < NOW() - INTERVAL '90 days'`
would cap the table size.

**Optional**: drop `idx_page_views_path_time` since the dedupe
unique covers `path` lookups for dedup-check queries. But the
non-unique one supports ORDER BY occurred_at DESC LIMIT N, which
the unique cannot. **Keep both.**

If the table grows past 100k rows, consider BRIN on occurred_at
(cheaper than the existing btree, good for time-range queries).

## Test plan
1. Migration adds a cron job (or pg_cron) to run the retention DELETE
2. Verify on a sample day
3. Add a check in qa-smoke: `assert max(occurred_at) < now() + 1 day`
