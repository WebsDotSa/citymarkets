-- 069_backfill_drivers_admin_link.sql
-- Purpose: Create a drivers row for every admin_users row with role='delivery_driver'
--          that doesn't have one yet, and link them via admin_user_id. Defense in depth:
--          also re-normalize any driver phones that may still be in non-canonical form
--          (064/065 should already have done this, but drivers are the most load-bearing
--          for OTP login, so we verify explicitly).
--
-- Idempotency: ON CONFLICT (phone) DO UPDATE only fires when admin_user_id is NULL
--              (uses uq_drivers_admin_user unique partial index from migration 030).
--              Phone re-normalization steps filter on bad patterns so re-runs are no-ops.
--
-- Context: T0 (2026-09-28) showed 6 delivery_driver admin_users but 0 drivers rows.
--          create_drivers.js only INSERTs into admin_users, never into drivers.
--          Result: /api/admin/driver/orders scoping falls back to "unassigned only"
--          and no driver can claim orders.
--
-- Phase 1 / Task T1.

BEGIN;

-- 1. Insert drivers rows for every delivery_driver admin_users that doesn't have one.
INSERT INTO drivers (name, phone, status, admin_user_id)
SELECT au.name,
       au.phone,
       'available'::driver_status_enum,
       au.id
  FROM admin_users au
 WHERE au.role = 'delivery_driver'
   AND au.is_active = true
   AND NOT EXISTS (
     SELECT 1 FROM drivers d WHERE d.admin_user_id = au.id
   )
ON CONFLICT (phone) DO UPDATE
   SET admin_user_id = EXCLUDED.admin_user_id
 WHERE drivers.admin_user_id IS NULL;

-- 2. Defense in depth: re-normalize any driver phones still in local form (mirrors 064 logic).
--    Filter on role + local format so this is a no-op when 064/065 already ran.
UPDATE admin_users
   SET phone = '+966' || substring(phone FROM 2)
 WHERE role = 'delivery_driver'
   AND phone LIKE '05%'
   AND phone NOT LIKE '+%'
   AND length(phone) = 10;

-- 3. Defense in depth: fix any "+9660..." corruption (the drift 065 addressed).
UPDATE admin_users
   SET phone = '+9665' || substring(phone FROM 6)
 WHERE role = 'delivery_driver'
   AND phone LIKE '+9660%'
   AND length(phone) = 12;

-- 4. Audit: report drivers created + unlinked admins remaining.
DO $$
DECLARE
  drivers_total   INTEGER;
  drivers_linked INTEGER;
  unlinked_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO drivers_total FROM drivers;
  SELECT COUNT(*) INTO drivers_linked FROM drivers WHERE admin_user_id IS NOT NULL;
  SELECT COUNT(*) INTO unlinked_count
    FROM admin_users au
   WHERE au.role = 'delivery_driver'
     AND au.is_active = true
     AND NOT EXISTS (SELECT 1 FROM drivers d WHERE d.admin_user_id = au.id);

  RAISE NOTICE '[069] drivers: % total, % linked to admin_user, % delivery_driver admin still unlinked',
    drivers_total, drivers_linked, unlinked_count;
END $$;

COMMIT;