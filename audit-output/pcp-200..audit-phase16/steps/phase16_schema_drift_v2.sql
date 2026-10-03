-- Phase-16: schema drift details
-- Check schema_migrations columns
\d schema_migrations

-- check for duplicate or missing numbers
SELECT version, count(*) AS c
FROM schema_migrations GROUP BY version HAVING count(*) > 1;

-- check app_migrations placeholder rows
SELECT filename, length(checksum) AS cs_len, applied_at
FROM app_migrations
WHERE length(checksum) <> 64
ORDER BY filename;