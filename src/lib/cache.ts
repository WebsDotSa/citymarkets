/**
 * Simple in-memory cache with TTL support
 * Can be replaced with Redis for production multi-instance deployments
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(private defaultTTL: number = 60 * 1000) {
    // Cleanup expired entries every minute
    if (typeof setInterval !== 'undefined') {
      this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    }
  }

  /**
   * Get a value from cache
   */
  get<T>(key: string): T | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    
    if (!entry) return null;
    
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    
    return entry.value;
  }

  /**
   * Set a value in cache. TTL constants are expressed in seconds.
   */
  set<T>(key: string, value: T, ttl?: number): void {
    const expiresAt = Date.now() + (ttl === undefined ? this.defaultTTL : ttl * 1000);
    this.store.set(key, { value, expiresAt });
  }

  /**
   * Delete a specific key
   */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Check if key exists and is valid
   */
  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * Get or set cache value
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) return cached;
    
    const value = await fetcher();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Invalidate cache by pattern (simple prefix match)
   */
  invalidatePattern(pattern: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(pattern)) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Get cache stats
   */
  getStats(): { size: number; keys: number } {
    this.cleanup();
    return {
      size: this.store.size,
      keys: this.store.size,
    };
  }

  /**
   * Destroy cache instance
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

// Singleton instance
export const cache = new MemoryCache();

// Cache keys
export const CACHE_KEYS = {
  CATEGORIES: 'categories:all',
  CATEGORY: (id: string) => `categories:${id}`,
  PRODUCTS: 'products:all',
  PRODUCT: (id: string) => `products:${id}`,
  PRODUCTS_BY_CATEGORY: (categoryId: string) => `products:category:${categoryId}`,
  VENDOR: (slug: string) => `vendors:${slug}`,
  SETTINGS: 'settings:site',
} as const;

// Cache TTLs (in seconds)
export const CACHE_TTL = {
  SHORT: 60,      // 1 minute
  MEDIUM: 300,    // 5 minutes
  LONG: 3600,     // 1 hour
  DAY: 86400,     // 24 hours
} as const;
