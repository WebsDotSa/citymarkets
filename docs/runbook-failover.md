# citymarket_db — DR / Failover Runbook

**Live replica:** `citymarket-db-replica` (PostgreSQL 16.15, hot-standby)
**Replication network:** `citymarket-net` (Docker bridge, 172.25.0.0/16)
**RPO:** ~0 bytes (streaming replication, no async archive lag in normal operation)
**RTO:** ~30 seconds (stop primary + promote replica + verify app)

This runbook is for the **same-host** replica. A future cross-host replica
changes only the network setup, not the procedure.

---

## When to failover

Any of:
- Primary container unresponsive (docker ps shows `Restarting` or exited)
- `curl http://localhost:3005/api/health` shows `database.status: "down"`
- A planned maintenance window (use the `pg_ctl pause` / graceful path)

Do **not** failover for a transient slowdown — the replica is async
streaming and may have its own brief stalls. Check first.

## Pre-flight

```bash
# Confirm the replica is healthy and the primary is the broken one
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'citymarket-db(-replica)?$'
docker logs citymarket-db --tail 5
docker exec citymarket-db-replica pg_isready
docker exec citymarket-db-replica psql -U postgres -d citymarket_db \
  -c "SELECT pg_is_in_recovery(), pg_last_wal_replay_timestamp()"
```

If `pg_last_wal_replay_timestamp` is recent, the replica is caught up
and the failover will lose at most a few hundred ms of writes.

## Failover (≤30 s)

```bash
# 1. Stop the broken primary so it can't come back and split-brain.
docker stop citymarket-db

# 2. Promote the replica. The WAL replay finishes, then PG exits
#    recovery mode and starts accepting writes.
docker exec -u postgres citymarket-db-replica \
  pg_ctl promote -D /var/lib/postgresql/data

# 3. The replica is now the primary. Verify.
docker exec citymarket-db-replica pg_isready    # accepting connections
docker exec citymarket-db-replica psql -U postgres -d citymarket_db \
  -c "SELECT pg_is_in_recovery()"               # should print 'f'

# 4. The app reads from 127.0.0.1:5432. The promoted replica listens
#    on 5433. Re-bind the port so the app picks up the new primary
#    WITHOUT an .env change.
docker rm -f citymarket-db-replica
docker run -d \
  --name citymarket-db \
  --network citymarket-net \
  -p 127.0.0.1:5432:5432 \
  -v citymarket-db-replica-data:/var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=postgres_secure_2026 \
  --restart unless-stopped \
  pgvector/pgvector:pg16
# Remove the standby.signal so PG starts as primary, not standby.
docker exec citymarket-db rm -f /var/lib/postgresql/data/standby.signal
docker exec citymarket-db bash -c "truncate -s 0 /var/lib/postgresql/data/postgresql.auto.conf"
docker restart citymarket-db
# Confirm
docker exec citymarket-db psql -U postgres -d citymarket_db \
  -c "SELECT pg_is_in_recovery()"

# 5. Verify the app.
curl -s http://localhost:3005/api/health
# Expect: {"status":"healthy",...,"database":{"status":"up",...}}
```

## After failover: rebuild the replica

The old primary is stale and CANNOT rejoin the replication stream as a
follower (it has older data than the new primary). It must be
re-seeded from scratch:

```bash
# 1. Make sure the old primary container is gone.
docker rm -f citymarket-db 2>/dev/null || true
docker volume rm citymarket-db-data 2>/dev/null || true

# 2. Keep the old data volume around for forensics (one-week retention).
#    Rename it; the setup script creates a fresh one.
docker volume create citymarket-db-data-stale-$(date +%F)
# (manual copy if you want to preserve the old data; otherwise skip)

# 3. Re-run the replica setup. It tears down the old replica, does a
#    fresh pg_basebackup from the new primary, and starts a new replica.
REPLICATION_PASSWORD='<the-replicator-password>' \
  /usr/local/bin/citymarket-db-replica-setup.sh
```

The setup script is idempotent — it detects the existing `replica` and
`replica-data` volume, removes them, and re-creates from scratch.

## Reverting a failed-over primary back to a replica

The procedure is the same as the failover itself: the newly-elevated
primary keeps its data, and the **previous** primary must be rebuilt
as a replica. There is no safe "swap back" path that preserves writes
on both sides — once you promote, you cannot demote safely.

## What this runbook does NOT do

- **Cross-host failover.** The replica is on the same host as the
  primary. A host failure takes both down. Add a second host +
  `wal-g` for true DR (PCP-211 territory).
- **Synchronous replication.** Currently `sync_state = async`. A
  primary crash can lose the last few hundred ms of committed
  transactions. Acceptable for our current RPO target (≤1 s of
  writes lost in a crash).
- **Read traffic routing.** The app only reads from the primary.
  Read-heavy queries can be routed to the replica via a separate
  pooler (e.g. PgBouncer in front of `127.0.0.1:5433`) — not
  implemented yet.

## Recovery test cadence

Run this drill every quarter. Record the result in the
`audit-output/` directory with the timestamp.

```bash
# Captures: how long did the failover take? Was the app healthy
# after? Did the new replica start streaming?
time bash -c "$(cat /usr/local/bin/citymarket-db-failover.sh)"
```
