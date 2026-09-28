-- 045_job_applications.sql
-- Public-facing /employment form: candidates submit name, phone, email,
-- chosen job and a CV file URL. The CV itself is stored in
--   public/images/employment/<file>
-- and the relative URL lives in cv_url. Admins list applications from
-- /admin/employment and can mark them reviewed / rejected / hired.
--
-- Public write: we allow anonymous INSERT through RLS because the
-- employment form must work for visitors who have not logged in.
-- Service role (citymarket_user, BYPASSRLS) handles the admin read.

BEGIN;

CREATE TABLE IF NOT EXISTS job_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       TEXT NOT NULL,
  phone           TEXT NOT NULL,
  email           TEXT,
  job_id          TEXT NOT NULL,
  job_title       TEXT NOT NULL,
  message         TEXT,
  cv_url          TEXT NOT NULL,
  cv_filename     TEXT NOT NULL,
  cv_size_bytes   INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new','reviewed','shortlisted','rejected','hired')),
  internal_notes  TEXT,
  reviewed_by     UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_applications_status
  ON job_applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_applications_created_at
  ON job_applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_applications_job
  ON job_applications(job_id, created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION job_applications_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_job_applications_updated_at ON job_applications;
CREATE TRIGGER trg_job_applications_updated_at
  BEFORE UPDATE ON job_applications
  FOR EACH ROW EXECUTE FUNCTION job_applications_set_updated_at();

-- RLS
ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;

-- Anonymous public insert (employment form on the storefront).
-- We deliberately do NOT add a public SELECT policy — applicants do
-- not need to read other submissions.
DROP POLICY IF EXISTS job_applications_public_insert ON job_applications;
CREATE POLICY job_applications_public_insert ON job_applications
  FOR INSERT
  WITH CHECK (true);

-- Service role (citymarket_user) has BYPASSRLS, so admin reads/writes
-- through /api/admin/employment work without an explicit policy.

COMMIT;
