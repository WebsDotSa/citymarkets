import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  cache,
  CACHE_KEYS,
  CACHE_TTL,
} from "./cache";

describe("MemoryCache (singleton)", () => {
  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    cache.clear();
  });

  describe("basic set / get / has / delete / clear", () => {
    it("returns null for a missing key", () => {
      expect(cache.get("missing")).toBeNull();
    });

    it("returns the stored value for an existing key", () => {
      cache.set("k", "v", 60);
      expect(cache.get<string>("k")).toBe("v");
    });

    it("supports different value types (object, array, number, boolean)", () => {
      cache.set("obj", { a: 1 }, 60);
      cache.set("arr", [1, 2, 3], 60);
      cache.set("num", 42, 60);
      cache.set("bool", true, 60);
      expect(cache.get("obj")).toEqual({ a: 1 });
      expect(cache.get("arr")).toEqual([1, 2, 3]);
      expect(cache.get("num")).toBe(42);
      expect(cache.get("bool")).toBe(true);
    });

    it("expires entries after their TTL has passed", async () => {
      cache.set("k", "v", 0.05); // 50ms TTL
      expect(cache.get<string>("k")).toBe("v");
      await new Promise((r) => setTimeout(r, 80));
      expect(cache.get<string>("k")).toBeNull();
    });

    it("has() returns false for missing keys and after expiry", async () => {
      expect(cache.has("missing")).toBe(false);
      cache.set("k", "v", 0.05);
      expect(cache.has("k")).toBe(true);
      await new Promise((r) => setTimeout(r, 80));
      expect(cache.has("k")).toBe(false);
    });

    it("delete() removes the key and returns true", () => {
      cache.set("k", "v", 60);
      expect(cache.delete("k")).toBe(true);
      expect(cache.delete("k")).toBe(false); // already gone
      expect(cache.get("k")).toBeNull();
    });

    it("clear() removes all keys", () => {
      cache.set("a", 1, 60);
      cache.set("b", 2, 60);
      cache.clear();
      expect(cache.has("a")).toBe(false);
      expect(cache.has("b")).toBe(false);
    });
  });

  describe("getOrSet", () => {
    it("calls the fetcher on a cache miss and caches the result", async () => {
      const fetcher = vi.fn(async () => 42);
      const v = await cache.getOrSet("k", fetcher, 60);
      expect(v).toBe(42);
      expect(fetcher).toHaveBeenCalledTimes(1);
      // Second call should hit the cache
      const v2 = await cache.getOrSet("k", fetcher, 60);
      expect(v2).toBe(42);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("propagates fetcher errors (does not cache the failure)", async () => {
      const fetcher = vi.fn(async () => {
        throw new Error("boom");
      });
      await expect(cache.getOrSet("k", fetcher, 60)).rejects.toThrow("boom");
    });
  });

  describe("invalidatePattern", () => {
    it("removes only keys with the given prefix", () => {
      cache.set("products:1", "a", 60);
      cache.set("products:2", "b", 60);
      cache.set("categories:1", "c", 60);
      cache.invalidatePattern("products:");
      expect(cache.has("products:1")).toBe(false);
      expect(cache.has("products:2")).toBe(false);
      expect(cache.has("categories:1")).toBe(true);
    });

    it("is a no-op when no keys match", () => {
      cache.set("a", 1, 60);
      cache.invalidatePattern("does-not-match:");
      expect(cache.has("a")).toBe(true);
    });
  });

  describe("getStats", () => {
    it("returns the current size and key count", () => {
      cache.clear();
      expect(cache.getStats()).toEqual({ size: 0, keys: 0 });
      cache.set("a", 1, 60);
      cache.set("b", 2, 60);
      const s = cache.getStats();
      expect(s.size).toBe(2);
      expect(s.keys).toBe(2);
    });
  });

  describe("default TTL", () => {
    it("applies the default TTL when none is provided", () => {
      // We can't test the exact default without faking Date.now(), but we
      // can confirm that omitting ttl still stores the value.
      cache.set("k", "v");
      expect(cache.get("k")).toBe("v");
    });
  });
});

describe("CACHE_KEYS", () => {
  it("includes static keys (categories:all, products:all, settings:site)", () => {
    expect(CACHE_KEYS.CATEGORIES).toBe("categories:all");
    expect(CACHE_KEYS.PRODUCTS).toBe("products:all");
    expect(CACHE_KEYS.SETTINGS).toBe("settings:site");
  });

  it("builds dynamic keys with the id interpolated", () => {
    expect(CACHE_KEYS.CATEGORY("123")).toBe("categories:123");
    expect(CACHE_KEYS.PRODUCT("abc")).toBe("products:abc");
    expect(CACHE_KEYS.PRODUCTS_BY_CATEGORY("cat-1")).toBe(
      "products:category:cat-1",
    );
    expect(CACHE_KEYS.VENDOR("my-shop")).toBe("vendors:my-shop");
  });
});

describe("CACHE_TTL", () => {
  it("exports the standard TTL tiers in seconds", () => {
    expect(CACHE_TTL.SHORT).toBe(60);
    expect(CACHE_TTL.MEDIUM).toBe(300);
    expect(CACHE_TTL.LONG).toBe(3600);
    expect(CACHE_TTL.DAY).toBe(86400);
  });
});