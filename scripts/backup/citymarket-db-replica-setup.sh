#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# citymarket-db replica bring-up (PCP-202)
#
# Initial setup for the read-replica container. Idempotent.
#
# This script assumes the primary `citymarket-db` is already running
# on the default docker bridge, listening on 127.0.0.1:5432. It:
#
#   1. Creates a dedicated bridge network (citymarket-net) so the
#      replica can resolve `citymarket-db` by hostname via Docker DNS.
#   2. Connects the primary to that network.
#   3. Creates the `replicator` role on the primary if missing.
#   4. Adds pg_hba rules allowing replication from 172.17.0.0/16
#      (the default bridge) and 172.25.0.0/16 (citymarket-net).
#   5. Runs `pg_basebackup` into a fresh replica volume with the
#      `-R` flag so the replica starts in hot-standby mode and
#      points at the primary via primary_conninfo.
#   6. Drops `backup_label*` files in the replica volume (left over
#      by pg_basebackup; PG recreates them on first start).
#   7. Replaces the placeholder primary_conninfo with a clean one
#      that points at the new primary by hostname.
#   8. Starts the replica container on 127.0.0.1:5433.
#
# Re-runs are safe: every step is idempotent.
#
# Tested live: 2026-10-03 02:21 UTC (initial), 02:25 UTC (after
# failover drill).
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

PRIMARY_CONTAINER="citymarket-db"
REPLICA_CONTAINER="citymarket-db-replica"
REPLICA_VOLUME="citymarket-db-replica-data"
NETWORK_NAME="citymarket-net"
REPLICA_PORT="5433"
REPL_PASSWORD_FILE="/root/.hermes/cache/scratch/repl_password.txt"
BASEBACKUP_DIR="/tmp/replica-base"

REPL_PASSWORD="${REPLICATION_PASSWORD:-}"
if [[ -z "$REPL_PASSWORD" ]]; then
  echo "ERROR: REPLICATION_PASSWORD env var is required (set it to the replicator role password)." >&2
  exit 1
fi

# 1. Create the dedicated network if it doesn't exist.
if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  echo "==> creating network $NETWORK_NAME"
  docker network create --driver bridge "$NETWORK_NAME" >/dev/null
fi

# 2. Connect the primary to the network so DNS works.
if ! docker network inspect "$NETWORK_NAME" \
     | grep -q "\"Name\": \"$PRIMARY_CONTAINER\""; then
  echo "==> connecting $PRIMARY_CONTAINER to $NETWORK_NAME"
  docker network connect "$NETWORK_NAME" "$PRIMARY_CONTAINER"
fi

# 3. Create the replicator role if missing.
if ! docker exec -u postgres "$PRIMARY_CONTAINER" \
     psql -d citymarket_db -tA -c "SELECT 1 FROM pg_roles WHERE rolname='replicator'" \
     | grep -q 1; then
  echo "==> creating replicator role"
  docker exec -u postgres "$PRIMARY_CONTAINER" \
    psql -d citymarket_db -c \
    "CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '$REPL_PASSWORD'" >/dev/null
fi

# 4. Add pg_hba rules. Idempotent: re-write the same file each run.
echo "==> writing pg_hba.conf on $PRIMARY_CONTAINER"
docker cp "$PRIMARY_CONTAINER:/var/lib/postgresql/data/pg_hba.conf" /tmp/pg_hba.conf
cat > /tmp/pg_hba.conf.new <<EOF
# PCP-202: allow streaming replication from the local docker bridge
# (172.17.0.0/16) and from citymarket-net (172.25.0.0/16).
host    replication     replicator     172.17.0.0/16            scram-sha-256
host    replication     replicator     172.25.0.0/16            scram-sha-256
EOF
# Append the rest of the file (skipping any pre-existing PCP-202 lines
# so we don't double up).
grep -v -E "^host[[:space:]]+replication[[:space:]]+replicator[[:space:]]+172\.(17|25)\.0\.0/(16|24)" \
     /tmp/pg_hba.conf >> /tmp/pg_hba.conf.new
docker cp /tmp/pg_hba.conf.new "$PRIMARY_CONTAINER:/var/lib/postgresql/data/pg_hba.conf"
docker exec "$PRIMARY_CONTAINER" chown postgres:postgres /var/lib/postgresql/data/pg_hba.conf
docker exec -u postgres "$PRIMARY_CONTAINER" psql -d citymarket_db -c "SELECT pg_reload_conf()" >/dev/null

# 5. Run pg_basebackup into a temp host dir.
echo "==> running pg_basebackup"
rm -rf "$BASEBACKUP_DIR"
mkdir -p "$BASEBACKUP_DIR"
docker run --rm \
  -v "$BASEBACKUP_DIR:/basebackup:rw" \
  --network "$NETWORK_NAME" \
  -e "PGPASSWORD=$REPL_PASSWORD" \
  pgvector/pgvector:pg16 \
  pg_basebackup \
    -h "$PRIMARY_CONTAINER" -p 5432 \
    -U replicator -D /basebackup \
    -Fp -Xs -P -R

# 6. Copy the base backup into the replica volume.
echo "==> copying into $REPLICA_VOLUME"
docker volume create "$REPLICA_VOLUME" >/dev/null
docker run --rm \
  -v "$BASEBACKUP_DIR:/source:ro" \
  -v "$REPLICA_VOLUME:/dest:rw" \
  alpine sh -c "cp -a /source/. /dest/ && chown -R 999:999 /dest/"

# 7. Replace primary_conninfo with a clean version that points at
# the primary by hostname. The pg_basebackup -R output includes a
# long sslmode=prefer etc. — we keep it minimal.
echo "==> writing postgresql.auto.conf on replica"
docker run --rm \
  -v "$REPLICA_VOLUME:/dest" \
  alpine sh -c "cat > /dest/postgresql.auto.conf <<EOF
# PCP-202: replica primary_conninfo. Points at the primary by container name
# on citymarket-net (Docker DNS).
primary_conninfo = 'user=replicator password=$REPL_PASSWORD host=$PRIMARY_CONTAINER port=5432 sslmode=disable application_name=citymarket-db-replica'
EOF
chown 999:999 /dest/postgresql.auto.conf
chmod 600 /dest/postgresql.auto.conf"

# 8. Start the replica container (replacing any existing one).
if docker ps -a --format '{{.Names}}' | grep -q "^$REPLICA_CONTAINER\$"; then
  echo "==> removing existing $REPLICA_CONTAINER"
  docker rm -f "$REPLICA_CONTAINER" >/dev/null
fi
echo "==> starting $REPLICA_CONTAINER"
docker run -d \
  --name "$REPLICA_CONTAINER" \
  --network "$NETWORK_NAME" \
  -p "127.0.0.1:$REPLICA_PORT:5432" \
  -v "$REPLICA_VOLUME:/var/lib/postgresql/data" \
  -e "POSTGRES_PASSWORD=postgres_secure_2026" \
  --restart unless-stopped \
  pgvector/pgvector:pg16 >/dev/null

echo
echo "==> replica should be streaming within 5 seconds"
sleep 5
docker exec "$PRIMARY_CONTAINER" psql -d citymarket_db -c \
  "SELECT application_name, client_addr, state, sync_state FROM pg_stat_replication"
