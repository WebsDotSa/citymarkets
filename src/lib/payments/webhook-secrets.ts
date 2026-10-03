/**
 * Webhook secret rotation with grace window.
 *
 * Why this exists
 * ---------------
 * Payment gateway webhooks (Moyasar, Tamara) are authenticated by a
 * bearer token. Until P0-2 (security Phase 1, 2026-10-03) the token
 * was a single env var (MOYASAR_WEBHOOK_SECRET, TAMARA_WEBHOOK_TOKEN).
 * Rotating that env var to revoke a leaked secret instantly broke
 * every in-flight webhook from the gateway — no grace period, so the
 * operator had to choose between a window of forged webhooks (no
 * rotation) and a window of unprocessed payments (rotation without
 * grace).
 *
 * Design
 * ------
 * The raw secret never leaves process memory — it lives in env vars.
 * The DB stores a registry: for a given provider, which env-var
 * names hold currently-valid secrets and for how long. The verify
 * path reads the candidate token from the Authorization header,
 * looks up the live env-var names from the DB, and runs
 * timingSafeEqual against each raw secret read from the process env.
 *
 * Rotation procedure (operator runbook)
 * -------------------------------------
 *   1. Set the new secret in a NEW env var
 *      (e.g. MOYASAR_WEBHOOK_SECRET_V2) and redeploy. The old env
 *      var is still set; both are in process memory.
 *   2. INSERT a row pointing label='v2' at env_var_name=
 *      'MOYASAR_WEBHOOK_SECRET_V2', valid_from=NOW(),
 *      valid_until = NOW() + interval '7 days'.
 *   3. UPDATE the previous primary row's valid_until to NOW() so the
 *      old secret stops being accepted at the end of the grace
 *      window. (Optional; if you skip this step the old secret
 *      continues to verify until its own valid_until passes.)
 *   4. After 7 days, remove the old env var from the deployment
 *      config and deactivate the old DB row (is_active=FALSE).
 *
 * Fallback behaviour
 * ------------------
 * If the DB has no active rows for a provider, the helper falls back
 * to the original env-var name. This keeps existing deployments
 * working on the day of apply without requiring a manual row insert
 * before the first deploy.
 */
import crypto from "node:crypto";
import { pool } from "@/lib/db";
import { error as logError, info as logInfo, warn as logWarn } from "@/lib/logger";

export type WebhookProvider = "moyasar" | "tamara";

export interface VerifyResult {
  ok: boolean;
  /** Which label matched (DB row or "env-fallback"). null on failure. */
  matchedLabel: string | null;
  /** True when the verify path used the env-var fallback (no DB row). */
  usedFallback: boolean;
}

interface WebhookSecretRow {
  env_var_name: string;
  label: string;
}

/** Constant-time comparison for two equal-length strings. */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Read all currently-valid secret registry rows for a provider.
 * Returns an empty array on DB error so the caller can fall back to
 * env. We do not throw — a DB outage degrades to env-fallback
 * rather than rejecting every webhook.
 */
async function loadActiveSecrets(provider: WebhookProvider): Promise<WebhookSecretRow[]> {
  try {
    const r = await pool.query<WebhookSecretRow>(
      `SELECT env_var_name, label
         FROM webhook_secrets
        WHERE provider = $1
          AND is_active = TRUE
          AND valid_from <= NOW()
          AND (valid_until IS NULL OR valid_until > NOW())
        ORDER BY created_at DESC`,
      [provider],
    );
    return r.rows;
  } catch (err) {
    logError(`[webhook-secrets] DB lookup failed for ${provider}`, err);
    return [];
  }
}

/**
 * Returns the legacy single-secret env-var name for a provider, used
 * as a fallback when no DB rows exist. The names match the existing
 * convention used by the route handlers before this fix.
 */
function envFallbackName(provider: WebhookProvider): string {
  return provider === "moyasar"
    ? "MOYASAR_WEBHOOK_SECRET"
    : "TAMARA_WEBHOOK_TOKEN";
}

/**
 * Verify a webhook bearer token against the active secret registry
 * for a provider. Tries the DB-backed set first; falls back to env
 * if the DB has no active rows. Returns `{ ok, matchedLabel,
 * usedFallback }`.
 */
export async function verifyWebhookToken(
  provider: WebhookProvider,
  candidate: string,
): Promise<VerifyResult> {
  if (!candidate) return { ok: false, matchedLabel: null, usedFallback: false };

  const dbSecrets = await loadActiveSecrets(provider);

  if (dbSecrets.length > 0) {
    for (const row of dbSecrets) {
      const expected = process.env[row.env_var_name]?.trim();
      if (!expected) {
        // A row references an env var that is not set. This is
        // almost always a config bug (operator inserted the row
        // before the deploy that set the env var). Log and skip.
        logWarn(
          `[webhook-secrets] ${provider} label=${row.label} references ` +
            `unset env var ${row.env_var_name}; skipping`,
        );
        continue;
      }
      if (safeEqual(candidate, expected)) {
        logInfo(
          `[webhook-secrets] ${provider} verified via label=${row.label} (env=${row.env_var_name})`,
        );
        return { ok: true, matchedLabel: row.label, usedFallback: false };
      }
    }
    return { ok: false, matchedLabel: null, usedFallback: false };
  }

  // Fallback: original env-var name. Pre-fix behaviour.
  const envName = envFallbackName(provider);
  const expected = process.env[envName]?.trim();
  if (expected && safeEqual(candidate, expected)) {
    return { ok: true, matchedLabel: "env-fallback", usedFallback: true };
  }
  return { ok: false, matchedLabel: null, usedFallback: false };
}
