-- 007 — migration-checksum-drift
-- Theory: app_migrations has 98/121 rows with short (placeholder) checksums.
-- The migration runner compares every file in /migrations/ against
-- app_migrations and reports drift when checksums mismatch. Need to know:
-- (a) how many files in /migrations/ have NO app_migrations row, (b) how
-- many app_migrations rows have a checksum that doesn't match the file's
-- current SHA-256, (c) what does the runner do for short-checksum rows?

-- 7a: how many migration files vs how many app_migrations rows
SELECT
  (SELECT count(*) FROM app_migrations) AS app_migrations_rows,
  (SELECT count(*) FROM information_schema.tables WHERE table_name='schema_migrations') AS schema_migrations_exists;

-- 7b: list every app_migrations row with checksum length and a "suspicious"
--     flag (short checksum OR a placeholder prefix)
SELECT filename, LENGTH(checksum) AS checksum_len, applied_at
FROM app_migrations
WHERE LENGTH(checksum) < 64
ORDER BY LENGTH(checksum), filename;

-- 7c: app_migrations count by checksum length bucket
SELECT
  CASE
    WHEN LENGTH(checksum) = 64 THEN 'full_sha256'
    WHEN LENGTH(checksum) BETWEEN 10 AND 30 THEN 'short_placeholder'
    ELSE 'other_short'
  END AS bucket,
  count(*)
FROM app_migrations
GROUP BY 1
ORDER BY count(*) DESC;
