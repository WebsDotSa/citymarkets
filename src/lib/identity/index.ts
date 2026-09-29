/**
 * Public barrel for the Identity & Access bounded context.
 *
 * Phase 10 (domain-modules refactor): extracted from `src/lib/` root in
 * 2026-09-29 to give users / sessions / roles / OTP / JWT a clear home.
 * Backward-compatibility shims at the old paths
 * (e.g. `@/lib/customer-session`) keep existing imports working — see
 * `docs/15-PERFORMANCE-CACHING-REVIEW.md` for the migration story.
 *
 * Internal organization:
 *   - auth/jwt-helper.ts        — sign/verify helpers (HS256)
 *   - auth/jwt-verify-cache.ts  — memoized verify results (60s TTL)
 *   - auth/role-cache.ts        — role resolution cache
 *   - admin-session.ts          — admin JWT sign + verify
 *   - admin-api-auth.ts         — admin route guard (`requireAdminApi`)
 *   - auth-cookie-name.ts       — canonical cookie name constants
 *   - auth-dev.ts               — dev-only auth helper
 *   - auth-helpers.ts           — full-user loader + `requireAuth`
 *   - customer-session.ts       — customer JWT sign + verify + edge-safe resolution
 *   - map-db-user.ts            — `users` row mapper
 *   - vendor-auth.ts            — vendor JWT sign + verify
 */

// ── Customer session ────────────────────────────────────────────────────
export {
  COOKIE_NAME,
  customerSessionCookieOptions,
  extractBearerToken,
  getCustomerUserIdFromRequest,
  resolveCustomerUserIdFromRequest,
  getGuestSessionIdFromRequest,
  signCustomerToken,
  verifyCustomerToken,
} from "./customer-session";
export type { CustomerJwtPayload } from "./customer-session";

// ── Admin session ───────────────────────────────────────────────────────
export {
  adminSessionCookieOptions,
  signAdminSessionToken,
  verifyAdminRequest,
} from "./admin-session";
export type { VerifiedAdminJwt } from "./admin-session";

// ── Admin API guard ─────────────────────────────────────────────────────
// Pure helpers (no DB). `requireAdminApi` (DB-backed) lives in
// `admin-api-auth-db.ts` — deep import from server code only.
export {
  adminForbidden,
  adminHasPermission,
  adminUnauthorized,
} from "./admin-api-auth";
export type { AdminAuthUser } from "./admin-api-auth-db";

// ── Vendor auth ─────────────────────────────────────────────────────────
// `verifyVendorRequestWithDb` is server-only (uses @/lib/db / pg).
// Deep import only from `@/lib/identity/vendor-auth`.
export {
  clearVendorSessionCache,
  hasMinRole,
  hasPermission,
  requireVendorMatch,
  requireVendorRole,
  signVendorSessionToken,
  vendorSessionCookieOptions,
  verifyVendorRequest,
} from "./vendor-auth";
export type { VendorRole, VendorSession } from "./vendor-auth";

// ── Auth helpers (full user row) ────────────────────────────────────────
// Server-only (`next/headers` + Supabase client). Not re-exported from the
// public barrel to keep it out of the middleware + client-component bundles.
// Import from `@/lib/identity/auth-helpers` directly when needed.
// export { createServerSupabaseClientAsync, getServerUser, requireAuth } from "./auth-helpers";

// ── Cookie names ────────────────────────────────────────────────────────
export {
  ADMIN_SESSION_COOKIE,
  CUSTOMER_SESSION_COOKIE,
  VENDOR_SESSION_COOKIE,
} from "./auth-cookie-name";

// ── User row mapper ─────────────────────────────────────────────────────
export { mapDbUserRow } from "./map-db-user";

// ── JWT helpers (HS256) ─────────────────────────────────────────────────
export { signJwt, verifyJwt } from "./auth/jwt-helper";
export type { SignConfig, VerifyConfig } from "./auth/jwt-helper";

// ── JWT verify cache (60s TTL, no failure caching) ──────────────────────
export { createJwtVerifyCache } from "./auth/jwt-verify-cache";
export type { JwtVerifyCache } from "./auth/jwt-verify-cache";

// ── Role cache ──────────────────────────────────────────────────────────
export {
  createRoleCache,
} from "./auth/role-cache";
export type { RoleCache, RoleCacheEntry, RoleCacheOptions } from "./auth/role-cache";

// ── Auth dev (NODE_ENV !== production bypass) ───────────────────────────
export { isAuthDevBypass } from "./auth-dev";
