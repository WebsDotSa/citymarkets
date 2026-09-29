import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoleCache } from '@/lib/identity';

describe("createRoleCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when key is missing", () => {
    const cache = createRoleCache<{ role: string }>();
    expect(cache.get("missing")).toBeNull();
  });

  it("returns the cached value within TTL", () => {
    const cache = createRoleCache<{ role: string }>();
    cache.set("k", { role: "admin" });
    expect(cache.get("k")).toEqual({ role: "admin" });
  });

  it("returns null after TTL elapses and evicts the entry", () => {
    const cache = createRoleCache<{ role: string }>({ defaultTtlMs: 1000 });
    cache.set("k", { role: "admin" });
    vi.advanceTimersByTime(1001);
    expect(cache.get("k")).toBeNull();
    expect(cache.size()).toBe(0);
  });

  it("honours a per-call TTL override", () => {
    const cache = createRoleCache<{ role: string }>({ defaultTtlMs: 60_000 });
    cache.set("k", { role: "admin" }, 1000);
    vi.advanceTimersByTime(1500);
    expect(cache.get("k")).toBeNull();
  });

  it("clear(key) drops a single entry", () => {
    const cache = createRoleCache<{ role: string }>();
    cache.set("a", { role: "a" });
    cache.set("b", { role: "b" });
    cache.clear("a");
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toEqual({ role: "b" });
  });

  it("clear() with no argument drops every entry", () => {
    const cache = createRoleCache<{ role: string }>();
    cache.set("a", { role: "a" });
    cache.set("b", { role: "b" });
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it("invokes onEvict when an entry expires", () => {
    const onEvict = vi.fn();
    const cache = createRoleCache<{ role: string }>({
      defaultTtlMs: 1000,
      onEvict,
    });
    cache.set("k", { role: "admin" });
    vi.advanceTimersByTime(1500);
    cache.get("k");
    expect(onEvict).toHaveBeenCalledWith("k");
  });

  it("size() purges stale entries opportunistically", () => {
    const cache = createRoleCache<{ role: string }>({ defaultTtlMs: 1000 });
    // "fresh" set at t=0, expires at t=1000.
    cache.set("fresh", { role: "a" });
    // Advance to t=500 and set "stale" — it expires at t=1500.
    vi.advanceTimersByTime(500);
    cache.set("stale", { role: "b" });
    // Advance to t=1100: "fresh" is now stale, "stale" is still alive.
    vi.advanceTimersByTime(600);
    expect(cache.size()).toBe(1);
    expect(cache.get("fresh")).toBeNull();
    expect(cache.get("stale")).toEqual({ role: "b" });
  });
});
