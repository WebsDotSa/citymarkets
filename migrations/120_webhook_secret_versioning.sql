-- 120_webhook_secret_versioning.sql
-- P0-2 (security Phase 1, 2026-10-03): webhook secret rotation with
-- a configurable grace window.
--
-- Background:
--   Payment gateway webhooks (Moyasar, Tamara) were authenticated by
--   a single env-var secret. Rotating that env var to revoke a leaked
--   secret instantly broke every in-flight webhook from the gateway.
--   The audit report (P0-WEBHOOK-SECRET-NO-VERSIONING) flags this as
--   a critical gap.
--
-- Design:
--   The raw secret never leaves process memory — it lives in env vars
--   only. The DB stores a registry that says "for this provider, the
--   following env-var names hold currently-valid secrets, with this
--   expiry window per entry". The verify path
--   (src/lib/payments/webhook-secrets.ts) reads the candidate token
--   from the Authorization header, looks up the live env-var names
--   from the DB, and runs timingSafeEqual against each.
--
--   Rotation:
--     1. Operator sets the new secret in a NEW env var
--        (e.g. MOYASAR_WEBHOOK_SECRET_V2) and redeploys.
--     2. Operator inserts a row pointing label="v2" at
--        env_var_name="MOYASAR_WEBHOOK_SECRET_V2", with valid_from=NOW
--        and valid_until = NOW() + interval '7 days'.
--     3. Webhooks minted by the gateway with either the old or new
--        secret verify successfully during the 7-day window.
--     4. After 7 days the old env var is removed and the old row's
--        valid_until passes; only the new secret verifies.
--
--   This is a "DB-as-registry" pattern. We deliberately do NOT store
--   raw secrets in the DB — that would require KMS (PII / secret
--   encryption at rest is a separate audit item, P0-PII-PLAINTEXT).
--
-- Columns:
--   id              surrogate key
--   provider        'moyasar' or 'tamara'
--   env_var_name    the env var to read the raw secret from
--   label           human-readable tag ('primary', 'v2', 'rotation-2026-10')
--   valid_from      secrets with this label are accepted from this instant
--   valid_until     secrets stop being accepted after this instant;
--                   NULL = no expiry (the current primary)
--   is_active       soft-delete flag
--   created_at      audit column
--
-- Notes:
--   * No seed data. Existing deployments continue to use the
--     env-var-only fallback until an operator inserts the first row.
--   * The verify path checks DB rows first, then env fallback. This
--     means the first DB insert is the trigger for "rotation mode on".

BEGIN;

CREATE TABLE IF NOT EXISTS webhook_secrets (
  id            BIGSERIAL PRIMARY KEY,
  provider      VARCHAR(32)  NOT NULL,
  env_var_name  VARCHAR(128) NOT NULL,
  label         VARCHAR(64)  NOT NULL DEFAULT 'primary',
  valid_from    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  valid_until   TIMESTAMPTZ,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT webhook_secrets_provider_check
    CHECK (provider IN ('moyasar', 'tamara')),
  CONSTRAINT webhook_secrets_provider_label_unique
    UNIQUE (provider, label)
);

CREATE INDEX IF NOT EXISTS idx_webhook_secrets_provider_active
  ON webhook_secrets (provider, is_active)
  WHERE is_active = TRUE;

-- Rotation audit. Mirrors jwt_secret_rotations (migration 119) so the
-- rotation story is consistent across JWT and webhook secrets.
CREATE TABLE IF NOT EXISTS webhook_secret_rotations (
  id                  BIGSERIAL PRIMARY KEY,
  provider            VARCHAR(32)  NOT NULL,
  old_label           VARCHAR(64),
  new_label           VARCHAR(64)  NOT NULL,
  grace_period_days   INTEGER      NOT NULL DEFAULT 7,
  grace_period_ends_at TIMESTAMPTZ NOT NULL,
  rotated_by          VARCHAR(255),
  reason              TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_secret_rotations_provider_created
  ON webhook_secret_rotations (provider, created_at DESC);

COMMIT;
