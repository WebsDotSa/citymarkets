-- Phase-16: GRANTs audit — does the app role have what it needs?
-- And which roles are BYPASSRLS (a critical security concern)
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
FROM pg_roles
WHERE rolname NOT LIKE 'pg_%';

-- Search-path safety
SELECT current_setting('search_path');

-- Default isolation level
SHOW default_transaction_isolation;
SHOW default_transaction_read_only;

-- App role for citymarket
SELECT current_user;