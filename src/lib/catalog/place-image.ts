/**
 * Strict allowlist validator for customer-supplied place-image URLs.
 *
 * Used by both `src/app/api/v1/addresses/route.ts` (web profile +
 * checkout flow) and `src/app/api/v1/delivery-addresses/route.ts`
 * (direct-order guest flow). Centralised here so the C3 RBAC
 * hardening stays in sync — a copy with weaker rules in one of the
 * two routes would be exploitable by anyone who can hit the weaker
 * path.
 *
 * SECURITY (C3 RBAC): rejecting arbitrary `/images/...` paths closes
 * the obvious bypasses:
 *   - path traversal:   `/images/place-images/../../etc/passwd`
 *   - protocol-relative URLs: `//evil.com/x.jpg`
 *   - arbitrary schemes: `javascript:`, `data:text/html`, `file:`
 *   - non-image assets: `/images/place-images/x.html`
 *
 * The check operates on the literal string (not URL-decoded). Next.js
 * path normalisation at the static-file handler is a second line of
 * defence for `%2e%2e` style payloads.
 */

export const ALLOWED_PLACE_IMAGE_PREFIXES = [
  "/images/place-images/",
  "/images/products/",
] as const;

const PLACE_IMAGE_EXTENSION_RE = /\.(jpg|jpeg|png|gif|webp)$/i;
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function isValidPlaceImageUrl(u: unknown): u is string {
  if (typeof u !== "string" || u.length === 0 || u.length > 256) return false;
  if (!ALLOWED_PLACE_IMAGE_PREFIXES.some((p) => u.startsWith(p))) return false;
  if (u.includes("..") || u.includes("//")) return false;
  if (URL_SCHEME_RE.test(u)) return false;
  if (!PLACE_IMAGE_EXTENSION_RE.test(u)) return false;
  return true;
}

/**
 * Convenience wrapper: filter an unknown array of URLs to the first
 * `max` valid entries. Mirrors the legacy inline logic that lived in
 * both address routes before extraction.
 */
export function sanitizePlaceImageUrls(
  input: unknown,
  max = 5,
): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((u): u is string => isValidPlaceImageUrl(u))
    .slice(0, max);
}
