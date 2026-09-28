-- 057_job_applications_cv_optional.sql
-- Make cv_url / cv_filename / cv_size_bytes NULLABLE so the public
-- /employment + /delegate forms can submit applications WITHOUT a CV.
-- The earlier route code (src/app/api/v1/employment/route.ts) already
-- treats the CV as optional — admins collect it during onboarding if
-- the candidate is shortlisted. The original 045 migration declared
-- these columns NOT NULL, which made every CV-less submission 500 with
-- "null value in column \"cv_url\" violates not-null constraint".
-- Discovered 2026-09-21 while verifying the /delegate form flow.

BEGIN;

ALTER TABLE job_applications
  ALTER COLUMN cv_url DROP NOT NULL,
  ALTER COLUMN cv_filename DROP NOT NULL,
  ALTER COLUMN cv_size_bytes DROP NOT NULL;

COMMIT;
