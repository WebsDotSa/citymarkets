# PCP-210 — citymarket_db nightly backup + restore test

**Status:** DONE. Live since 2026-10-03 01:42 UTC. First scheduled cron run at 2026-10-03 02:00:01 UTC (confirmed in journal: `CRON[2835091]: (root) CMD (/usr/local/bin/citymarket-db-backup)`).

---

## What was missing (audit finding PCP-210)

> No `pg_dump` cron configured — no evidence of a scheduled backup anywhere on host. — `pcp-101-phase16-audit-report.md`, P0

The `citymarket-db` container is the only copy of the production data. Without a backup chain, any of the following is unrecoverable:
- `postgres` user accidentally running `DROP DATABASE`
- Filesystem corruption on the host
- Malicious deletion
- Hardware failure on the host

This was the single highest ROI P0 in Phase 16 (1 hour work; closes one of four disaster-recovery gaps).

---

## Solution

Three files in `scripts/backup/` plus the system-installed copies:

| Repo path | Installed path | Purpose | Mode | Owner |
|-----------|---------------|---------|------|-------|
| `scripts/backup/citymarket-db-backup` | `/usr/local/bin/citymarket-db-backup` | nightly `pg_dump` → gzip → `/var/backups/citymarket_db/` | 700 | root |
| `scripts/backup/citymarket-db-restore-test` | `/usr/local/bin/citymarket-db-restore-test` | weekly restore into a throwaway DB + row-count + RLS-policy assertions | 700 | root |
| `scripts/backup/citymarket-db-backup.cron` | `/etc/cron.d/citymarket-db-backup` | cron schedule: 02:00 UTC daily + 03:30 UTC Sundays | 600 | root |
| `scripts/backup/install.sh` | — | idempotent installer (used to deploy the above) | 700 | root |
| — | `/var/backups/citymarket_db/` | backup dir (14-day retention) | 700 | root |
| — | `/var/log/citymarket-db-backup.log` | append-only run log | 644 | root |
| — | `/var/log/citymarket-db-restore-test.log` | append-only restore-test log | 644 | root |

### Schedule

```
0  2  *  *  *  /usr/local/bin/citymarket-db-backup          # nightly pg_dump
30 3  *  *  0  /usr/local/bin/citymarket-db-restore-test     # Sunday restore test
```

---

## Design choices (the gotchas)

### 1. Run `pg_dump` INSIDE the container, not on the host

The host has `pg_dump` 18.6 (Ubuntu 22.04) but the server inside the container is PG 16.15. The host's `pg_dump` writes `SET transaction_timeout = 0;` in the dump header, which PG16 rejects with:

```
ERROR: unrecognized configuration parameter "transaction_timeout"
```

→ every restore would fail. The fix is to use the container's `pg_dump` 16.15 which matches the server. The script auto-discovers the running container with `docker ps --filter 'name=^/citymarket-db$'`.

### 2. Read `DATABASE_PASSWORD` from the app's `.env`

Hard-coding the password in the cron would leak it to anyone who can read `/etc/cron.d/`. The app already has it in `/var/www/citymarkets.sa/city-market-app/.env` (chmod 600 root). The script `source`s that file at startup so we never drift from the connection string the app itself uses.

### 3. Atomic write pattern

```
pg_dump > tmpfile  →  gzip -6 tmpfile  →  mv tmpfile.gz final-name
```

If `pg_dump` or `gzip` fails, the temp file is removed on the EXIT trap and the previous day's dump is preserved. A partial dump never replaces a good one.

### 4. Sanity check (don't ship a zero-byte dump)

The script grep's the first 3 lines for `PostgreSQL database dump`. A 0-byte output (most common failure mode: wrong password, container killed, permissions) fails loudly instead of silently shipping a useless empty `.sql.gz`.

### 5. Restore test as a separate cron (PCP-215)

A nightly `pg_dump` is worthless if the dump is corrupt. The Phase 16 audit also flagged PCP-215 (backup restore never tested in 90 days). The restore-test script:
- Creates `restore_test_YYYYMMDD_HHMMSS` (throwaway)
- Restores the most recent dump into it
- Compares row counts in `users`, `app_migrations`, `products`, `vendor_products`, `orders` against the live DB
- Asserts ≥35 RLS policies are present (catches the case where the dump skipped the post-105/108 defensive migrations)
- Drops the test DB on exit (success or failure)

Runs Sundays at 03:30, after the 02:00 daily backup. Failures get mailed to `root` via the cron's `MAILTO`.

### 6. Retention 14 days

`find ... -mtime +14 -delete` prunes the oldest dump. 1.6 MB × 14 = 22 MB worst case (the DB is 26 MB raw). 200 GB free disk → 0.01% of free space.

---

## Live verification (2026-10-03)

### First manual run (01:41 UTC)

```
$ time /usr/local/bin/citymarket-db-backup
real    0m0.499s
user    0m0.183s
sys     0m0.133s

$ ls -la /var/backups/citymarket_db/
-rw------- 1 root root 1618182 Oct  3 01:41 citymarket_db-20261003T014120Z.sql.gz

$ tail -2 /var/log/citymarket-db-backup.log
[2026-10-03T01:41:20+00:00] starting pg_dump of citymarket_db on 127.0.0.1:5432 (container: citymarket-db)
[2026-10-03T01:41:21+00:00] ok: 1.6M written; pruned 0 dump(s) older than 14 days
```

### First scheduled cron run (02:00:01 UTC)

```
$ journalctl -t CRON --since "3 minutes ago"
Oct 03 02:00:01 srv2009643 CRON[2835089]: pam_unix(cron:session): session opened for user root(uid=0) by root(uid=0)
Oct 03 02:00:01 srv2009643 CRON[2835091]: (root) CMD ( /usr/local/bin/citymarket-db-backup)
Oct 03 02:00:02 srv2009643 CRON[2835089]: pam_unix(cron:session): session closed for user root

$ ls -la /var/backups/citymarket_db/
-rw------- 1 root root 1618182 Oct  3 01:41 citymarket_db-20261003T014120Z.sql.gz
-rw------- 1 root root 1618177 Oct  3 02:00 citymarket_db-20261003T020001Z.sql.gz

$ tail -2 /var/log/citymarket-db-backup.log
[2026-10-03T02:00:01+00:00] starting pg_dump of citymarket_db on 127.0.0.1:5432 (container: citymarket-db)
[2026-10-03T02:00:02+00:00] ok: 1.6M written; pruned 0 dump(s) older than 14 days
```

### Restore test (manual run before cron)

```
$ time /usr/local/bin/citymarket-db-restore-test
real    0m2.855s

$ tail -1 /var/log/citymarket-db-restore-test.log
[2026-10-03T01:41:49+00:00] ok: restore from /var/backups/citymarket_db/citymarket_db-20261003T014120Z.sql.gz matches live (users/orders/products/app_migrations/policies=36)
```

### Manual restore verification (independent of the script)

```
$ docker exec -u postgres citymarket-db createdb restore_test_20261003_014126
$ gunzip -c citymarket_db-20261003T014120Z.sql.gz | \
    docker exec -i -u postgres citymarket-db psql -d restore_test_20261003_014126 -v ON_ERROR_STOP=1

Tables:      58
users:     19925
products:   4900
orders:       76
app_migrations: 127
```

All five counts match the live DB to the row. 36 RLS policies restored.

---

## Failure modes this catches

| Failure | Detected by | Within |
|---------|-------------|--------|
| `citymarket-db` container killed | backup script's `docker ps` check | next 02:00 run (≤24 h) |
| Wrong `DATABASE_PASSWORD` in `.env` | pg_dump returns nothing → sanity check fails | next 02:00 run (≤24 h) |
| Disk full | `gzip` writes to /var/backups/citymarket_db/ — same filesystem | next 02:00 run (≤24 h) |
| Silent dump corruption (e.g. wrong container, partial) | restore-test row-count assertion | ≤7 days |
| RLS policy dropped from dump | restore-test `pg_policies` count | ≤7 days |
| Cron daemon crashed | mail spool + `systemctl status cron` | depends on monitoring |
| Host filesystem read-only | script fails with EROFS | next 02:00 run (≤24 h) |

What this does NOT catch:
- A bug that corrupts the **live** DB between backup and restore — this is what `pg_dump` + WAL archiving (PCP-211) is for.
- A compromise of the host root account. The dump files are world-readable only by root.

---

## What's next (PCP-211 — the harder sibling)

This solves the no-backup P0. The no-WAL-archiving P0 is **PCP-211**: install `wal-g` or `pgbackrest` and stream WAL to S3. That gives point-in-time recovery (the dump only gives you "the state at 02:00 UTC today" — anything written between 02:00 and the next 02:00 is in the WAL).

PCP-211 is a 2-day job:
1. Pick `wal-g` (lighter, Go binary) or `pgbackrest` (heavier, full PITR)
2. Provision S3 bucket
3. Wire `archive_command` to push every 16 MB WAL segment
4. Add a weekly restore drill that replays a WAL against a base backup

Recommend scheduling this for the next maintenance window.
