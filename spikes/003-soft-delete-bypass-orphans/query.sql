-- 003 — soft-delete-bypass-orphans
-- Theory: app code does `UPDATE users SET deleted_at=NOW() WHERE id=$1`.
-- But if any child table has a hard FK to users without ON DELETE SET NULL,
-- and a future code path tries to physically delete the user, it would fail
-- with FK violation. More importantly: if any child holds user-id data and
-- the app does a `SELECT … FROM child WHERE user_id = deleted_user.id`,
-- it still returns rows — soft-delete only filters the *parent* table.
-- We want to find child tables whose user_id is not nullable AND lack a
-- deleted_at filter, so a soft-deleted user's data still leaks.

SELECT
  c.conrelid::regclass::text AS child_table,
  a.attname AS child_user_col,
  c.confdeltype,
  CASE c.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
  END AS on_delete,
  a.attnotnull AS fk_col_notnull,
  -- does the child table have its own deleted_at column?
  EXISTS (
    SELECT 1 FROM pg_attribute ax
    WHERE ax.attrelid = c.conrelid AND ax.attname='deleted_at'
  ) AS child_has_deleted_at
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
WHERE c.contype='f' AND c.confrelid='public.users'::regclass
  AND c.connamespace = 'public'::regnamespace
ORDER BY c.conrelid::regclass::text;
