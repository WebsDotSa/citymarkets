import { describe, it, expect, beforeEach } from "vitest";
import { createJwtVerifyCache } from "./jwt-verify-cache";

describe("createJwtVerifyCache", () => {
  let cache: ReturnType<typeof createJwtVerifyCache<string>>;

  beforeEach(() => {
    cache = createJwtVerifyCache<string>(60_000, 3);
  });

  it("returns null for a missing key", () => {
    expect(cache.get("missing")).toBeNull();
  });

  it("returns the stored value for an existing key", () => {
    cache.set("k", "v");
    expect(cache.get("k")).toBe("v");
  });

  it("returns null after TTL has elapsed", async () => {
    const shortCache = createJwtVerifyCache<string>(10, 10); // 10ms TTL
    shortCache.set("k", "v");
    expect(shortCache.get("k")).toBe("v");
    await new Promise((r) => setTimeout(r, 25));
    expect(shortCache.get("k")).toBeNull();
  });

  it("evicts the oldest entry when capacity is exceeded", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("d", "4"); // forces eviction of "a"
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
    expect(cache.get("d")).toBe("4");
    expect(cache.size()).toBe(3);
  });

  it("clear() empties the cache", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get("a")).toBeNull();
  });

  it("supports a variety of value types", () => {
    const obj = { userId: "u-1" };
    const arr = [1, 2, 3];
    const boolCache = createJwtVerifyCache<boolean>(60_000, 10);
    const objCache = createJwtVerifyCache<typeof obj>(60_000, 10);
    const arrCache = createJwtVerifyCache<number[]>(60_000, 10);
    objCache.set("o", obj);
    arrCache.set("a", arr);
    boolCache.set("yes", true);
    expect(objCache.get("o")).toEqual(obj);
    expect(arrCache.get("a")).toEqual(arr);
    expect(boolCache.get("yes")).toBe(true);
  });
});