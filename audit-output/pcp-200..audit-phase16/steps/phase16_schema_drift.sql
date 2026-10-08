-- Phase-16: schema drift — does Prisma schema match the DB?
-- We just look at: are there columns in DB not in any migration? Or columns missing in DB that Prisma expects?
-- Simplest check: how does the table count compare vs migration files?

-- (a) Tables in DB
SELECT count(*) AS db_tables FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relkind='r';

-- (b) COUNT of user tables
SELECT count(*) AS user_table_count FROM information_schema.tables WHERE table_schema='public';

-- (c) Migration files applied
SELECT count(*) AS migrations_applied FROM app_migrations;

-- (d) CHECK whether all schema_migrations entries are unique and not duplicate
SELECT sql_name, count(*) AS c FROM schema_migrations GROUP BY sql_name HAVING count(*) > 1;