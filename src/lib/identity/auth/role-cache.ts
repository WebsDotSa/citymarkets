/**
 * Generic TTL'd in-memory cache for "is this principal still allowed to act
 * right now?" lookups. Used by both the admin and vendor auth layers to
 * bound the blast radius of a stale role/active flag without issuing a
 * DB query on every request.
 *
 * Why this exists
 * ---------------
 * Two near-identical cache implementations lived in:
 *
 *   src/lib/admin-api-auth.ts → `adminRoleCache`  (role + isActive, 60s TTL)
 *   src/lib/vendor-auth.ts    → `vendorSessionCache` (role + isActive +
 *                               vendorIsActive + tokenVersion, 60s TTL)
 *
 * Both had the same shape:
 *   - in-memory `Map<key, { ...data, expiresAt }>`
 *   - 60-second TTL
 *   - explicit `clear*Cache(id?)` function for eviction on role mismatch
 *   - `expiresAt > Date.now()` check on read
 *
 * The duplication was a hazard: any change to TTL semantics, eviction
 * rules, or value shape had to be applied in two places, and the
 * `vendorSessionCache` had already drifted (it added `vendorIsActive`
 * and `tokenVersion` but kept the same Map shape). This factory makes
 * the contract explicit and gives both layers a single source of truth.
 *
 * Why TTL is short
 * ----------------
 * A demoted admin or suspended vendor should lose access within a minute,
 * not at the natural JWT expiry (7 days for admin, 8h for vendor). 60s
 * is the trade-off the two implementations picked; we preserve it here.
 * Future tuning should change `defaultTtlMs` rather than the per-callsite
 * constants the old code used.
 *
 * Why NOT Redis
 * -------------
 * Docs/01 lists Redis as optional infrastructure. The cache lives in
 * the same Node process as the route handler so a per-instance TTL is
 * sufficient: a demoted admin fails auth on whichever instance they
 * hit, and the other instances catch up within 60s. Until Redis is
 * rolled out, an in-process cache is the right primitive.
 */

export interface RoleCacheEntry<T> {
  data: T;
  /** Unix ms timestamp; entry is stale when `Date.now() >= expiresAt`. */
  expiresAt: number;
}

export interface RoleCache<T> {
  /** Returns the cached value when fresh, or `null` when stale / missing. */
  get(key: string): T | null;
  /** Stores `data` under `key` for `ttlMs` (defaults to 60s). */
  set(key: string, data: T, ttlMs?: number): void;
  /** Drops a single entry, or clears the whole cache when `key` is omitted. */
  clear(key?: string): void;
  /** Inspection helper for tests / metrics. Returns the live entry count. */
  size(): number;
}

export interface RoleCacheOptions {
  /** TTL in ms. Defaults to 60s — matches the previous ad-hoc constants. */
  defaultTtlMs?: number;
  /**
   * Optional logger invoked when a TTL elapses while an entry sits
   * untouched, for observability hooks (e.g. metrics). Defaults to no-op.
   */
  onEvict?: (key: string) => void;
}

const DEFAULT_TTL_MS = 60 * 1000;

/**
 * Build a typed TTL cache. The returned object is intentionally minimal:
 * anything richer (LRU, max-size, persistence) belongs in a separate
 * primitive — role/auth caches are small and bounded by the principal
 * count (admins ≤ dozens, vendors ≤ thousands).
 */
export function createRoleCache<T>(
  options: RoleCacheOptions = {},
): RoleCache<T> {
  const defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
  const onEvict = options.onEvict;
  const store = new Map<string, RoleCacheEntry<T>>();

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        onEvict?.(key);
        return null;
      }
      return entry.data;
    },
    set(key, data, ttlMs) {
      store.set(key, {
        data,
        expiresAt: Date.now() + (ttlMs ?? defaultTtlMs),
      });
    },
    clear(key) {
      if (key === undefined) {
        store.clear();
        return;
      }
      store.delete(key);
    },
    size() {
      // Clean up expired entries opportunistically on size() so tests
      // and metrics don't see stale rows. Production code should prefer
      // `get` which already does this.
      const now = Date.now();
      let live = 0;
      for (const [key, entry] of store) {
        if (entry.expiresAt <= now) {
          store.delete(key);
          onEvict?.(key);
        } else {
          live += 1;
        }
      }
      return live;
    },
  };
}
