-- Step 5a: app_migrations checksum drift (placeholder = drift)
SELECT length(checksum) AS cs_len,
       count(*) AS rows
FROM app_migrations
GROUP BY length(checksum)
ORDER BY rows DESC;

-- Step 5b: latest migrations
SELECT filename, applied_at
FROM app_migrations
ORDER BY applied_at DESC
LIMIT 20;