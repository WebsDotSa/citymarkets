/**
 * Centralized secret access. In production, required env vars throw when missing.
 */

import { warn as logWarn } from "@/lib/logger";

export const isProd = process.env.NODE_ENV === "production";

function customerFallback(): string {
  return "city-market-dev-jwt-secret-min-32-characters-xx";
}

/** Shared customer JWT signing secret (Twilio OTP session cookie). */
export function getCustomerJwtSecret(): string {
  const v = process.env.JWT_SECRET;
  if (v && v.length > 0) return v;
  if (isProd) throw new Error("JWT_SECRET is required in production");
  return customerFallback();
}

export function getCustomerJwtSecretBytes(): Uint8Array {
  return new TextEncoder().encode(getCustomerJwtSecret());
}

/** Single source of truth for `secure` attribute on auth cookies. */
export function isCookieSecure(): boolean {
  return isProd;
}

/**
 * Admin dashboard API cookie (HS256 JWT).
 * REQUIRES a distinct ADMIN_JWT_SECRET — never falls back to the customer
 * JWT_SECRET, since sharing it would let a stolen customer token be
 * replayed on admin routes.
 */
export function getAdminJwtSecretBytes(): Uint8Array {
  const explicit = process.env.ADMIN_JWT_SECRET;
  if (explicit && explicit.length > 0) {
    return new TextEncoder().encode(explicit);
  }
  if (isProd) {
    throw new Error("ADMIN_JWT_SECRET is required in production (>=32 chars)");
  }
  logWarn(
    "[env] ADMIN_JWT_SECRET is not set — using dev fallback. " +
      "This is UNSAFE in production.",
  );
  return new TextEncoder().encode(
    "city-market-dev-admin-secret-min-32-characters-x",
  );
}

/**
 * Vendor portal API cookie (HS256 JWT).
 * MUST be separate from ADMIN_JWT_SECRET to prevent cross-issuer token forgery.
 * Falls back to a dev-only constant in non-production for local testing.
 */
/**
 * Vendor portal API cookie (HS256 JWT).
 * REQUIRES a distinct VENDOR_JWT_SECRET — never falls back to JWT_SECRET or
 * ADMIN_JWT_SECRET. Cross-issuer token forgery prevention (C-1).
 */
export function getVendorJwtSecretBytes(): Uint8Array {
  const explicit = process.env.VENDOR_JWT_SECRET;
  if (explicit && explicit.length > 0) {
    return new TextEncoder().encode(explicit);
  }
  if (isProd) {
    throw new Error("VENDOR_JWT_SECRET is required in production (>=32 chars)");
  }
  logWarn(
    "[env] VENDOR_JWT_SECRET is not set — using dev fallback. " +
      "This is UNSAFE in production.",
  );
  return new TextEncoder().encode(
    "city-market-dev-vendor-secret-min-32-characters-x",
  );
}

/**
 * مسار المصادقة القديم POST /api/v1/auth/login + verify (OTP في الطابور / السجلات للتطوير فقط).
 * في الإنتاج يكون معطلًا افتراضيًا لتجنب التسرب والتعارض مع Twilio.
 */
export function isLegacyPhoneOtpAllowed(): boolean {
  if (!isProd) return true;
  return process.env.ALLOW_LEGACY_PHONE_OTP === "true";
}

export function getDatabaseConfig() {
  return {
    host: process.env.DATABASE_HOST || "localhost",
    port: parseInt(process.env.DATABASE_PORT || "5432", 10),
    database: process.env.DATABASE_NAME || "citymarket_db",
    user: process.env.DATABASE_USER || "citymarket_user",
    password:
      process.env.DATABASE_PASSWORD ||
      (isProd ? undefined : "city-market-dev-database-password-only"),
    // Supabase pooler requires SSL for every connection. Local Postgres
    // (pre-2026-08-17) was used without TLS, so this is a no-op fallback
    // when the env vars still point at the local instance — `pg` only
    // attempts SSL when a truthy `ssl` option is present. (Pitfall-122)
    ssl: process.env.DATABASE_SSL !== "false" ? { rejectUnauthorized: false } : false,
    // Force IPv4 — Supabase returns both A and AAAA records. Node 18+
    // resolves IPv6 first and ECONNREFUSED if the host's IPv6 stack is
    // not configured for the upstream, leaving the app hanging.
    // `family: 4` is a no-op when only one family is published.
    family: 4,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Public-facing helpers (2026-09-23)
// ──────────────────────────────────────────────────────────────────────
// The helpers below replace ad-hoc `process.env.X ?? "fallback"` reads
// scattered across the API routes. They cover the env vars that are
// referenced from more than one route, or that encode a non-trivial
// default. Single-use env reads in tests or one-off scripts can stay
// inline.

/** Canonical site URL used by mobile-config, manifest, payment callbacks. */
export function getSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://citymarkets.sa"
  );
}

/** Moyasar publishable key (safe to ship to the client). Null when unset. */
export function getMoyasarPublishableKey(): string | null {
  const v = process.env.MOYASAR_PUBLISHABLE_KEY;
  return v && v.trim().length > 0 ? v : null;
}

/** iOS bundle identifier shipped to the mobile client. */
export function getIOSBundleId(): string {
  return process.env.NEXT_PUBLIC_IOS_APP_ID || "com.citymarkets.app";
}

/** VAPID is fully configured iff BOTH public + private keys are present. */
export function isVapidConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY,
  );
}

/** Web-push VAPID public key (safe to ship). Null when not configured. */
export function getVapidPublicKey(): string | null {
  const v = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  return v && v.trim().length > 0 ? v : null;
}

/**
 * APNs push is fully configured iff the key id + team id + bundle id +
 * key path are all present. This matches the shape consumed by the
 * native push sender (see `isApnsSenderConfigured` below) and the
 * mobile-config endpoint; the legacy `APNS_SIGNING_KEY` form is no
 * longer accepted (no caller in the codebase).
 */
export function isApnsConfigured(): boolean {
  return Boolean(
    process.env.APNS_KEY_ID &&
      process.env.APNS_TEAM_ID &&
      process.env.APNS_BUNDLE_ID &&
      process.env.APNS_KEY_PATH,
  );
}

/**
 * FCM push is fully configured iff a project id is set. Used by the
 * mobile-config endpoint; the concrete sender additionally requires a
 * service account JSON or legacy server key (see `isFcmSenderConfigured`).
 */
export function isFcmConfigured(): boolean {
  return Boolean(process.env.FCM_PROJECT_ID);
}

/** Allow noisy OTP log dumps in non-production. Off in prod by default. */
export function isDevOtpLogAllowed(): boolean {
  return process.env.ALLOW_DEV_OTP_LOG === "1";
}

/** Allow webhook endpoints to skip signature checks (TEST ONLY). */
export function isInsecureWebhookAllowed(): boolean {
  return process.env.ALLOW_INSECURE_WEBHOOK === "1";
}

// ──────────────────────────────────────────────────────────────────────
// Resend (transactional email)
// ──────────────────────────────────────────────────────────────────────

/** Resend is fully configured iff API key + From are present. */
export function isResendConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY &&
      process.env.RESEND_API_KEY.length > 0 &&
      process.env.RESEND_FROM &&
      process.env.RESEND_FROM.length > 0,
  );
}

export function getResendApiKey(): string | null {
  const v = process.env.RESEND_API_KEY;
  return v && v.length > 0 ? v : null;
}

export function getResendFrom(): string | null {
  const v = process.env.RESEND_FROM;
  return v && v.length > 0 ? v : null;
}

export function getResendReplyTo(): string | null {
  const v = process.env.RESEND_REPLY_TO;
  return v && v.length > 0 ? v : null;
}

/**
 * Active payment provider. Always "moyasar" — the only online gateway we
 * integrate with (Tamara is a per-order BNPL choice, not a provider
 * switch). The legacy `PAYMENT_PROVIDER` env var is preserved so old
 * deployments don't crash on import; the value is logged but unused.
 */
export function getPaymentProvider(): string {
  return (process.env.PAYMENT_PROVIDER ?? "moyasar").toLowerCase();
}

/** OpenAI API key — gates the AI shopping assistant. */
export function getOpenAIApiKey(): string | null {
  const v = process.env.OPENAI_API_KEY;
  return v && v.trim().length > 0 ? v : null;
}

/** Moyasar server-side secret key. Null when unset. Never ship to client. */
export function getMoyasarSecretKey(): string | null {
  const v = process.env.MOYASAR_SECRET_KEY;
  return v && v.trim().length > 0 ? v : null;
}

// ──────────────────────────────────────────────────────────────────────
// Native push — APNs + FCM (sender-side configuration)
// ──────────────────────────────────────────────────────────────────────
//
// `isApnsConfigured` (defined in the public-facing helpers section
// above) and the sender-side configuration are now the same shape —
// APNS_KEY_ID + APNS_TEAM_ID + APNS_BUNDLE_ID + APNS_KEY_PATH — so
// we reuse it directly rather than duplicating the predicate. FCM
// still needs the extra service-account JSON or legacy server key.

/**
 * FCM sender (firebase-admin / legacy server key) configured. APNs
 * configuration reuses `isApnsConfigured()` above.
 */
export function isFcmSenderConfigured(): boolean {
  return Boolean(
    (process.env.FCM_PROJECT_ID && process.env.FCM_SERVICE_ACCOUNT_JSON) ||
      process.env.FCM_SERVER_KEY,
  );
}

/** True iff at least one of APNs or FCM sender is configured. */
export function isNativePushSenderConfigured(): boolean {
  return isApnsConfigured() || isFcmSenderConfigured();
}

// ──────────────────────────────────────────────────────────────────────
// Apple App Store Review account
// ──────────────────────────────────────────────────────────────────────
//
// SECURITY (Phase 4, 2026-10-03, P2-1 from the audit):
// `isAppleReviewEnabled` previously returned true whenever
// APPLE_REVIEW_ENABLED=true, regardless of NODE_ENV. If the env var
// was set in production — by an operator who wanted to test the
// review flow, or by a leaked env file — the production deployment
// would accept a hard-coded OTP for the configured phone. The
// audit rated this as a "high" finding because the OTP is a static
// value in env and the phone is known, so anyone with the env
// could log in as the Apple Reviewer.
//
// The fix: hard-refuse to enable the feature in production, even if
// APPLE_REVIEW_ENABLED=true. The iOS App Store review process
// happens against builds that are submitted for review; the
// reviewer's login happens in a non-production environment. The
// dev / staging deployments where the feature is needed are
// NODE_ENV !== "production" by definition.
//
// To re-enable in production temporarily (e.g. for an Apple review
// of a production build), set APPLE_ALLOW_PRODUCTION_REVIEW=1 in
// addition to APPLE_REVIEW_ENABLED=true. The double-key is
// intentional: a misconfigured env file alone is not enough.
// ──────────────────────────────────────────────────────────────────────
export function isAppleReviewEnabled(): boolean {
  if ((process.env.APPLE_REVIEW_ENABLED ?? "").toLowerCase() !== "true") {
    return false;
  }
  // Hard-block in production unless explicitly overridden.
  if (process.env.NODE_ENV === "production") {
    if (process.env.APPLE_ALLOW_PRODUCTION_REVIEW === "1") {
      return true;
    }
    return false;
  }
  return true;
}

/** Phone number (E.164) Apple reviewers will sign in with. */
export function getAppleReviewPhone(): string {
  return process.env.APPLE_REVIEW_PHONE ?? "";
}

/** Static OTP that the Apple review account will send at verify-time. */
export function getAppleReviewOtp(): string {
  return process.env.APPLE_REVIEW_OTP ?? "";
}

/** Display name to seed the Apple review account with. */
export function getAppleReviewName(): string {
  return process.env.APPLE_REVIEW_NAME ?? "Apple Reviewer";
}

// ──────────────────────────────────────────────────────────────────────
// Supabase (anon + URL for client / SSR)
// ──────────────────────────────────────────────────────────────────────

/**
 * Supabase anon config — the public URL + anon JWT used by both the
 * browser (`NEXT_PUBLIC_*`) and SSR helpers. Throws in production if
 * either is missing so a misconfigured deploy fails loud instead of
 * silently breaking auth.
 */
export function getSupabasePublicConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && url.length > 0 && anonKey && anonKey.length > 0) {
    return { url, anonKey };
  }
  if (isProd) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required in production",
    );
  }
  // Dev fallback mirrors what `proxy.ts` already expects locally.
  return {
    url: url || "http://localhost:54321",
    anonKey: anonKey || "dev-anon-key",
  };
}
