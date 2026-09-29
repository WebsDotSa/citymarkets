import { describe, it, expect } from "vitest";
import {
  isCategoryImageUrl,
  getCategoryEmoji,
  resolveCategoryImageSrc,
} from "./category-media";

describe("isCategoryImageUrl", () => {
  it("returns false for empty / null / undefined", () => {
    expect(isCategoryImageUrl("")).toBe(false);
    expect(isCategoryImageUrl(null)).toBe(false);
    expect(isCategoryImageUrl(undefined)).toBe(false);
  });

  it("returns true for absolute http(s) URLs", () => {
    expect(isCategoryImageUrl("https://example.com/img.png")).toBe(true);
    expect(isCategoryImageUrl("http://example.com/img.png")).toBe(true);
  });

  it("returns true for root-relative paths (e.g. /images/foo.jpg)", () => {
    expect(isCategoryImageUrl("/images/category/foo.jpg")).toBe(true);
  });

  it("returns true for bare filenames with a recognized image extension", () => {
    expect(isCategoryImageUrl("foo.jpg")).toBe(true);
    expect(isCategoryImageUrl("foo.jpeg")).toBe(true);
    expect(isCategoryImageUrl("foo.png")).toBe(true);
    expect(isCategoryImageUrl("foo.webp")).toBe(true);
    expect(isCategoryImageUrl("foo.gif")).toBe(true);
    expect(isCategoryImageUrl("foo.svg")).toBe(true);
  });

  it("matches extension case-insensitively", () => {
    expect(isCategoryImageUrl("foo.JPG")).toBe(true);
    expect(isCategoryImageUrl("foo.PNG")).toBe(true);
  });

  it("preserves query strings when checking the extension", () => {
    expect(isCategoryImageUrl("foo.png?v=1")).toBe(true);
    expect(isCategoryImageUrl("foo.png?token=abc")).toBe(true);
  });

  it("returns false for Material icon keys (not a URL or filename)", () => {
    expect(isCategoryImageUrl("local_grocery_store")).toBe(false);
    expect(isCategoryImageUrl("restaurant")).toBe(false);
  });

  it("returns false for plain text that happens to contain 'jpg' but isn't a filename", () => {
    // E.g. a slugified identifier that includes an extension-like token
    // mid-string should NOT be matched (must be end-of-string).
    expect(isCategoryImageUrl("foo.jpg.bak")).toBe(false);
  });

  it("trims surrounding whitespace before checking", () => {
    expect(isCategoryImageUrl("  https://example.com/x.png  ")).toBe(true);
  });
});

describe("getCategoryEmoji", () => {
  it("returns the fallback when iconUrl is null/undefined/empty", () => {
    expect(getCategoryEmoji(null)).toBe("📦");
    expect(getCategoryEmoji(undefined)).toBe("📦");
    expect(getCategoryEmoji("")).toBe("📦");
  });

  it("returns the fallback when iconUrl is an actual image URL (not a Material key)", () => {
    // If the value is a URL, getCategoryEmoji has no emoji to return —
    // we don't crash, we just hand back the default so callers can use
    // the URL via `resolveCategoryImageSrc` instead.
    expect(getCategoryEmoji("https://example.com/cat.png")).toBe("📦");
    expect(getCategoryEmoji("/images/cat.svg")).toBe("📦");
  });

  it("returns the Material-icon emoji for known keys", () => {
    expect(getCategoryEmoji("local_grocery_store")).toBe("🛒");
    expect(getCategoryEmoji("coffee")).toBe("☕");
    expect(getCategoryEmoji("kitchen")).toBe("🍵");
    expect(getCategoryEmoji("icecream")).toBe("🍦");
    expect(getCategoryEmoji("restaurant")).toBe("🍞");
    expect(getCategoryEmoji("milk")).toBe("🥛");
    expect(getCategoryEmoji("local_pizza")).toBe("🍕");
    expect(getCategoryEmoji("fastfood")).toBe("🍔");
    expect(getCategoryEmoji("poultry")).toBe("🍗");
    expect(getCategoryEmoji("grass")).toBe("🥬");
    expect(getCategoryEmoji("eco")).toBe("🍎");
    expect(getCategoryEmoji("ac_unit")).toBe("🧊");
    expect(getCategoryEmoji("water_drop")).toBe("💧");
    expect(getCategoryEmoji("breakfast_dining")).toBe("🥣");
    expect(getCategoryEmoji("bakery_dining")).toBe("🥐");
    expect(getCategoryEmoji("cookie")).toBe("🍪");
    expect(getCategoryEmoji("apps")).toBe("🍜");
    expect(getCategoryEmoji("nutrition")).toBe("🥫");
    expect(getCategoryEmoji("local_drink")).toBe("🥤");
    expect(getCategoryEmoji("set_meal")).toBe("🥫");
    expect(getCategoryEmoji("egg_alt")).toBe("🥚");
  });

  it("returns the fallback (default) for an unknown Material key", () => {
    expect(getCategoryEmoji("not_a_real_key")).toBe("📦");
  });

  it("respects the caller-supplied fallback", () => {
    expect(getCategoryEmoji(null, "❓")).toBe("❓");
    expect(getCategoryEmoji("not_a_real_key", "❓")).toBe("❓");
  });
});

describe("resolveCategoryImageSrc", () => {
  it("returns null for null/undefined/empty", () => {
    expect(resolveCategoryImageSrc(null)).toBeNull();
    expect(resolveCategoryImageSrc(undefined)).toBeNull();
    expect(resolveCategoryImageSrc("")).toBeNull();
  });

  it("returns null for Material icon keys", () => {
    expect(resolveCategoryImageSrc("local_grocery_store")).toBeNull();
    expect(resolveCategoryImageSrc("restaurant")).toBeNull();
  });

  it("returns the URL when it's an http(s) or root-relative path", () => {
    expect(resolveCategoryImageSrc("https://cdn.example.com/c.png")).toBe(
      "https://cdn.example.com/c.png",
    );
    expect(resolveCategoryImageSrc("/images/foo.jpg")).toBe("/images/foo.jpg");
  });

  it("returns the filename when it has a recognized image extension", () => {
    expect(resolveCategoryImageSrc("foo.jpg")).toBe("foo.jpg");
    expect(resolveCategoryImageSrc("foo.png?v=2")).toBe("foo.png?v=2");
  });
});