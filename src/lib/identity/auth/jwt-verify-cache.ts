/**
 * Tiny TTL+LRU cache for JWT verification results.
 *
 * `jwtVerify` from `jose` runs HMAC-SHA256 over the entire token on every
 * call — that's ~0.5–1ms per protected request. For a popular token
 * (e.g. an active customer's session) that gets verified by:
 *   - middleware (every request that hits a protected prefix)
 *   - getServerUser (when the route needs the full user row)
 *   - validateCsrfRequest (when the request is mutating)
 *   - the route handler itself
 * …the same `jwtVerify` runs 2–4× per request. This cache memoizes
 * verified results by the token string so we only run HMAC once per
 * token per window.
 *
 * Safety properties:
 *   - Only successful verifications are cached. Invalid tokens are
 *     re-verified on every call (a malicious client could otherwise
 *     poison the cache with fabricated tokens).
 *   - TTL is short (60s default) so a stale entry is impossible after
 *     a server restart that loses state, and the blast radius of a
 *     caching bug is small.
 *   - Map size is bounded (500 entries) — Map preserves insertion
 *     order, so eviction drops the oldest key.
 *   - Token strings are used as keys directly. They're at most ~1KB
 *     (typical JWT ~300B), so 500 entries caps memory at ~500KB.
 *
 * Edge-safe: the cache uses only Map + Date.now, no Node-only APIs.
 */

type CacheEntry<T> = { value: T; expiresAt: number };

export interface JwtVerifyCache<T> {
  get(token: string): T | null;
  set(token: string, value: T): void;
  clear(): void;
  /** Test/debug hook — current entry count after a sweep. */
  size(): number;
}

export function createJwtVerifyCache<T>(
  ttlMs: number = 60_000,
  maxEntries: number = 500,
): JwtVerifyCache<T> {
  const store = new Map<string, CacheEntry<T>>();

  function sweep(): void {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now > entry.expiresAt) store.delete(key);
    }
  }

  return {
    get(token) {
      const entry = store.get(token);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        store.delete(token);
        return null;
      }
      return entry.value;
    },
    set(token, value) {
      if (store.size >= maxEntries) {
        sweep();
        if (store.size >= maxEntries) {
          // Drop the oldest entry — Map iteration order is insertion order.
          const oldest = store.keys().next().value;
          if (oldest !== undefined) store.delete(oldest);
        }
      }
      store.set(token, { value, expiresAt: Date.now() + ttlMs });
    },
    clear() {
      store.clear();
    },
    size() {
      sweep();
      return store.size;
    },
  };
}