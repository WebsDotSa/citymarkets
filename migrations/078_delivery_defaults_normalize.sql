-- 078 — Normalize delivery_settings.pricing defaults (migration 060 drift fix).
--
-- Background: migration 060 replaced the zone-based delivery fee with a
-- distance-based formula (`computeDistanceFee(distanceKm, settings)`),
-- seeded via `DELIVERY_BASE_SAR = 3`, `DELIVERY_INCLUDED_KM = 5`,
-- `DELIVERY_PER_EXTRA_KM_SAR = 1.5` in
-- `src/lib/delivery/delivery-distance-fee.ts`.
--
-- However the admin delivery-settings GET response (and the
-- admin-delivery-settings React form) initially shipped with
-- `includedKm: 2` — so any operator who saved the form before today
-- would have *persisted* `includedKm = 2` to the DB, silently
-- changing the fee formula on every subsequent order.
--
-- This migration rewrites the JSONB value for `delivery_settings.pricing`
-- so that any record carrying the legacy `includedKm = 2` (or missing
-- the key entirely) is brought back into sync with the canonical
-- `DELIVERY_INCLUDED_KM = 5` constant. The form also defaults to 5 from
-- this point on (`src/components/admin/admin-delivery-settings.tsx`).
--
-- Idempotent: a re-run is a no-op once the row already reads 5.
-- Safe on empty DBs: the WHERE guards short-circuit when no row exists.

UPDATE delivery_settings
SET value = jsonb_set(
  value,
  '{includedKm}',
  '5'::jsonb,
  false
),
updated_at = NOW()
WHERE key = 'pricing'
  AND (
    (value #>> '{includedKm}') IS NULL
    OR (value #>> '{includedKm}') IN ('2', '0')
  );

-- 078.b — Drop the legacy `maxDiscount` key from `delivery_settings.pricing`.
--
-- The key was added to the JSONB schema in the early days of the
-- delivery-fee refactor but never wired into `computeOrderFees` — the
-- per-order cap is enforced by `coupons.max_discount` at redemption
-- time, not at the delivery-pricing level. Migration 060 left the
-- key dangling. Removing it from the stored JSON prevents confusion
-- when the admin form renders defaults.

UPDATE delivery_settings
SET value = value - 'maxDiscount',
    updated_at = NOW()
WHERE key = 'pricing'
  AND value ? 'maxDiscount';
