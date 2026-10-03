-- Phase-16: backup / replication infrastructure audit
-- 1. Is WAL archiving enabled? (production need)
SELECT name, setting FROM pg_settings WHERE name IN (
  'wal_level', 'archive_mode', 'archive_command', 'archive_timeout',
  'max_wal_size', 'min_wal_size',
  'max_replication_slots', 'wal_keep_size'
);

-- 2. Is there a basebackup / pg_dump cron? Check `pg_dump` last modified in /etc/cron* via \?
\! ls -la /etc/cron.d/ /etc/cron.daily/ 2>/dev/null | head

-- 3. Are there replication slots active?
SELECT slot_name, plugin, active, restart_lsn
FROM pg_replication_slots;

-- 4. Replica state
SELECT application_name, state, sync_state, sent_lsn, replay_lsn,
       (sent_lsn - replay_lsn) AS byte_lag
FROM pg_stat_replication;

-- 5. Connected backends by application_name (any replicas?)
SELECT application_name, count(*) AS conns
FROM pg_stat_activity
WHERE application_name IS NOT NULL AND application_name <> 'psql'
GROUP BY application_name;