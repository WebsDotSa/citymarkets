/**
 * Shared sanitiser for redirect-after-login target paths.
 *
 * Rejects absolute URLs, protocol-relative (`//evil.com`),
 * backslash tricks (`/\evil.com`), and the `/auth/*` tree
 * (which would create a login loop). The proxy emits `?redirect=`
 * and the login page reads both `next` and `redirect`.
 */
export const DEFAULT_REDIRECT = "/profile";

export function sanitizeRedirectPath(
  value: string | null | undefined,
  fallback: string = DEFAULT_REDIRECT
): string {
  if (!value) return fallback;
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.startsWith("/auth/") || value === "/auth/login") return fallback;
  return value;
}
