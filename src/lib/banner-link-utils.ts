/**
 * Utilities for normalizing banner and link values.
 *
 * PCP-143: Admin banner editors save `link_value` either as:
 *   1. Raw slug: "الخضروات-والفواكه"
 *   2. Full path: "/categories/الخضروات-والفواكه"
 *
 * Before normalization, renderers concatenated raw onto the route,
 * producing `/categories//categories/...` → 404s. This module provides
 * tolerant parsing for both formats without DB migrations.
 */

/**
 * Strip leading public-route prefixes from a banner link value.
 *
 * Anchored to start-of-string so external URLs are never mangled:
 *   stripPublicPrefix("/categories/الخضروات-والفواكه") → "الخضروات-والفواكه"
 *   stripPublicPrefix("الخضروات-والفواكه") → "الخضروات-والفواكه"
 *   stripPublicPrefix("/products/123") → "123"
 *   stripPublicPrefix("https://example.com/categories/x") → "https://example.com/categories/x"
 */
export function stripPublicPrefix(value: string): string {
  const trimmed = value.trim();
  const prefixes = [`/categories/`, `/products/`, `/vendors/`];
  for (const p of prefixes) {
    if (trimmed.startsWith(p)) {
      return trimmed.slice(p.length);
    }
  }
  return trimmed;
}

/**
 * Validate external URL has http(s) scheme.
 *
 * Rejects relative paths, javascript: and data: URIs, and malformed inputs.
 * Returns the URL string if valid, null otherwise.
 */
export function validateExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}
