/**
 * Shared CSRF double-submit cookie constants. Imported by both the server
 * proxy (`src/proxy.ts`) and the browser-side helper
 * (`src/lib/csrf-client.ts`). Kept in its own module so the client bundle
 * does NOT pull in `next/headers` (which is server-only and would break
 * the build).
 *
 * IMPORTANT: changing these strings requires updating both sides in the
 * same commit — the server-side gate and the client-side read MUST agree.
 */
export const CSRF_COOKIE_NAME = "csrf_token";
export const CSRF_HEADER_NAME = "x-csrf-token";